import { randomUUID } from "node:crypto";
import { loadCorpus, provisionsFor, scenarioOrFallback, type Corpus } from "../corpus/loader.js";
import { FACT_KEYS } from "../corpus/validate.js";
import type { LlmProvider } from "../llm/provider.js";
import type {
  Classification, FactObservation, GuidanceUpdate, SessionState, TranscriptTurn,
} from "../types.js";
import { applyObservation, initialFacts, knownForProvider } from "./facts.js";
import { checkDetentionClock, evaluateRules } from "./rules.js";
import { buildOptions } from "./options.js";
import { degradeToFallback, guard, type GuardViolation } from "./guard.js";

const CONFIDENCE_FLOOR = 0.5;

export interface TurnResult {
  update: GuidanceUpdate;
  violations: GuardViolation[];
  latencyMs: number;
}

/**
 * A live encounter.
 *
 * The loop the PRD was missing: every turn re-classifies, re-evaluates the
 * facts, re-runs the rules, and re-ranks the options. The scenario is allowed
 * to change mid-session — a document check becoming a detention becoming an
 * arrest is the normal case, not an edge case.
 */
export class Session {
  readonly state: SessionState;
  private corpus: Corpus;
  private provider: LlmProvider;

  constructor(
    provider: LlmProvider,
    opts: {
      sessionId?: string;
      corpus?: Corpus;
      /**
       * Rehydrate an existing session instead of starting one. Used by the
       * server to survive a restart — an encounter's packet is worthless if it
       * dies with the process it was recorded in.
       *
       * The restored state keeps the corpus version it was recorded under.
       * That is deliberate: PRD R6 requires every answer to record which
       * corpus produced it, so the caller must refuse to add turns to a
       * session whose version no longer matches the loaded corpus rather than
       * quietly mixing two versions into one audit trail.
       */
      state?: SessionState;
    } = {},
  ) {
    this.corpus = opts.corpus ?? loadCorpus();
    this.provider = provider;
    if (opts.state) {
      this.state = opts.state;
      return;
    }
    this.state = {
      sessionId: opts.sessionId ?? randomUUID(),
      startedAt: new Date().toISOString(),
      corpusVersion: this.corpus.meta.corpusVersion,
      jurisdiction: "IN-CENTRAL",
      turns: [],
      facts: initialFacts(),
      observations: [],
      classifications: [],
      currentScenarioId: null,
      flags: [],
      updates: [],
      rejectedByBoundary: [],
    };
  }

  async ingest(text: string, speaker: TranscriptTurn["speaker"] = "unknown"): Promise<TurnResult> {
    const t0 = Date.now();
    const now = new Date();
    const nowIso = now.toISOString();

    const turn: TranscriptTurn = { index: this.state.turns.length, speaker, text, at: nowIso };
    this.state.turns.push(turn);

    const extraction = await this.provider.extract({
      turns: this.state.turns,
      allowedScenarioIds: [...this.corpus.scenarios.keys()],
      cues: Object.fromEntries([...this.corpus.scenarios].map(([id, s]) => [id, s.classifierCues])),
      allowedFactKeys: FACT_KEYS,
      known: knownForProvider(this.state.facts),
    });

    // --- provider boundary ----------------------------------------------
    // Never trust the model's output shape. A provider may be a third party,
    // a future on-device model, or a compromised one. Anything outside the
    // corpus and the fact schema is dropped here, before it can reach a rule.
    const allowedFacts = new Set<string>(FACT_KEYS);
    const rejected: string[] = [];

    const safeScenarioId =
      extraction.scenarioId && this.corpus.scenarios.has(extraction.scenarioId)
        ? extraction.scenarioId
        : null;
    if (extraction.scenarioId && !safeScenarioId) {
      rejected.push(`scenarioId "${extraction.scenarioId}" is not in the corpus`);
    }

    const safeFacts = extraction.facts.filter((f) => {
      if (!allowedFacts.has(f.fact)) { rejected.push(`fact "${f.fact}" is not in the schema`); return false; }
      // PRD Design Principle 3, applied to facts: no quote, no fact. An
      // unevidenced fact is exactly how a false misconduct flag would fire.
      if (typeof f.evidence !== "string" || f.evidence.trim().length === 0) {
        rejected.push(`fact "${f.fact}" arrived with no evidence`);
        return false;
      }
      return true;
    });
    this.state.rejectedByBoundary.push(...rejected.map((r) => ({ turnIndex: turn.index, detail: r })));

    // --- facts ---------------------------------------------------------
    const newObservations: FactObservation[] = [];
    for (const f of safeFacts) {
      const obs: FactObservation = {
        fact: f.fact, value: f.value, turnIndex: turn.index, evidence: f.evidence, at: nowIso,
      };
      if (applyObservation(this.state.facts, obs)) {
        this.state.observations.push(obs);
        newObservations.push(obs);
      }
    }
    // Detention clock starts the moment either is asserted, once.
    if (
      !this.state.facts.detentionStartedAt &&
      (this.state.facts.arrestAsserted === "yes" || this.state.facts.askedToComeToStation === "yes")
    ) {
      this.state.facts.detentionStartedAt = nowIso;
    }

    // --- classification -------------------------------------------------
    const fallback = extraction.confidence < CONFIDENCE_FLOOR || !safeScenarioId;
    const classification: Classification = {
      scenarioId: fallback ? null : safeScenarioId,
      confidence: extraction.confidence,
      fallback,
    };
    this.state.classifications.push(classification);

    const previousScenarioId = this.state.currentScenarioId;
    // A confident new classification wins. A low-confidence turn does NOT
    // erase a scenario already established — losing the thread mid-encounter
    // because one sentence was noisy is worse than being slightly stale.
    if (!fallback) this.state.currentScenarioId = classification.scenarioId;
    const scenarioChanged = this.state.currentScenarioId !== previousScenarioId;

    // --- rules ----------------------------------------------------------
    const newFlags = evaluateRules(
      this.corpus, this.state.facts, this.state.observations, this.state.flags, turn.index, nowIso
    );
    const clockFlag = checkDetentionClock(this.state.facts, this.state.flags, now);
    if (clockFlag) newFlags.push(clockFlag);
    this.state.flags.push(...newFlags);

    // --- guidance -------------------------------------------------------
    const effectiveId = this.state.currentScenarioId;
    const scenario = scenarioOrFallback(this.corpus, effectiveId);
    const isFallback = effectiveId === null;

    const changed = scenarioChanged || newFlags.length > 0 || newObservations.length > 0 || this.state.updates.length === 0;
    const reasons: string[] = [];
    if (this.state.updates.length === 0) reasons.push("first guidance");
    if (scenarioChanged) reasons.push(`scenario ${previousScenarioId ?? "none"} → ${effectiveId ?? "fallback"}`);
    if (newFlags.length) reasons.push(`${newFlags.length} new flag(s): ${newFlags.map((f) => f.ruleId).join(", ")}`);
    if (newObservations.length) reasons.push(`${newObservations.length} new fact(s): ${newObservations.map((o) => o.fact).join(", ")}`);

    let update: GuidanceUpdate = {
      turnIndex: turn.index,
      at: nowIso,
      changed,
      changeReason: reasons.length ? reasons.join("; ") : null,
      scenarioId: effectiveId,
      scenarioTitle: scenario.title,
      fallback: isFallback,
      quotableLine: scenario.quotableLine,
      doNotSay: scenario.doNotSay,
      documentNow: scenario.documentNow,
      options: buildOptions(this.corpus, effectiveId, this.state.facts, this.state.flags),
      newFlags,
      provisionsCited: isFallback ? [] : provisionsFor(this.corpus, scenario.provisionIds),
      disclaimer: this.corpus.meta.disclaimer,
      corpusVersion: this.corpus.meta.corpusVersion,
    };

    const violations = guard(this.corpus, update);
    if (violations.length > 0) update = degradeToFallback(this.corpus, update, violations);

    this.state.updates.push(update);
    return { update, violations, latencyMs: Date.now() - t0 };
  }
}
