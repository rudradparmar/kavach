import type { Corpus } from "../corpus/loader.js";
import type { FactObservation, RaisedFlag, SituationFacts } from "../types.js";
import { evaluateAll } from "./facts.js";

/**
 * Deterministic misconduct detection.
 *
 * The model is not in this path. A flag fires because facts the model could
 * quote from the transcript satisfied a rule an advocate wrote and signed.
 * That separation is the whole safety argument: a hallucinated fact is a bad
 * input to a correct rule, which is recoverable. A hallucinated legal
 * conclusion is not.
 */
export function evaluateRules(
  corpus: Corpus,
  facts: SituationFacts,
  observations: FactObservation[],
  alreadyRaised: RaisedFlag[],
  turnIndex: number,
  now: string
): RaisedFlag[] {
  const seen = new Set(alreadyRaised.map((f) => f.ruleId));
  const fresh: RaisedFlag[] = [];

  for (const rule of corpus.rules) {
    if (seen.has(rule.id)) continue;
    if (!evaluateAll(facts, rule.when)) continue;

    const relevant = new Set(rule.when.map((p) => p.fact));
    const basis = observations.filter((o) => relevant.has(o.fact));

    fresh.push({
      ruleId: rule.id,
      severity: rule.severity,
      statement: rule.statement,
      provisionIds: rule.provisionIds,
      raisedAtTurn: turnIndex,
      at: now,
      basis,
    });
  }
  return fresh;
}

/**
 * Time-based check that no fact predicate can express: the 24-hour production
 * rule. Called separately because it depends on the clock, not the transcript.
 */
export function checkDetentionClock(
  facts: SituationFacts,
  alreadyRaised: RaisedFlag[],
  now: Date
): RaisedFlag | null {
  const started = facts.detentionStartedAt;
  if (!started) return null;
  if (facts.producedBeforeMagistrate === "yes") return null;
  if (alreadyRaised.some((f) => f.ruleId === "detention-exceeds-24h")) return null;

  const elapsedH = (now.getTime() - new Date(started).getTime()) / 3_600_000;
  if (elapsedH < 24) return null;

  return {
    ruleId: "detention-exceeds-24h",
    severity: "unlawful",
    statement:
      "More than 24 hours have passed since the recorded start of detention with no production before a Magistrate recorded. Travel time is excluded from that period, so the exact margin is a question for a lawyer — but the elapsed time is a fact worth acting on now.",
    provisionIds: ["BNSS-58", "CONST-22"],
    raisedAtTurn: -1,
    at: now.toISOString(),
    basis: [],
  };
}
