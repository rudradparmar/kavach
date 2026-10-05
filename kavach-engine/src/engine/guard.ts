import type { Corpus } from "../corpus/loader.js";
import type { EscalationGuidance, EscalationOption, GuidanceUpdate, QuotableLine } from "../types.js";

export interface GuardViolation {
  kind: "ungrounded-citation" | "forbidden-phrase" | "missing-disclaimer" | "fallback-cites-law";
  detail: string;
}

/**
 * Last line of defence before anything reaches a user.
 *
 * PRD Design Principle 3: a confidently hallucinated section number is the
 * most dangerous output this system can produce, because the user repeats it
 * out loud to an officer. So: nothing that looks like a citation leaves the
 * engine unless that exact provision is in the corpus.
 */

// Matches "s.194D", "Section 35(3)", "Article 22", "u/s 207".
const CITATION = /\b(?:u\/s|under\s+section|section|sec\.?|s\.|art(?:icle)?\.?)\s*([0-9]+[A-Za-z]*(?:\([0-9a-z]+\))?)/gi;

const FORBIDDEN = [
  { re: /\brefuse\b|\bdon'?t comply\b|\bdo not comply\b/i, why: "tells the user to refuse an instruction" },
  { re: /\brun\b|\bflee\b|\bwalk away\b|\bdrive off\b/i, why: "tells the user to leave" },
  { re: /\bresist\b|\bpush (back|him|them)\b|\bgrab\b|\bsnatch\b/i, why: "suggests physical resistance" },
  { re: /you (will|'ll) win|you (will|'ll) be fine|nothing will happen|guaranteed/i, why: "predicts an outcome (PRD Non-Goal 3)" },
  { re: /\bhe (can'?t|cannot) do that\b|\bthey (can'?t|cannot) do that\b/i, why: "confrontational framing (PRD Design Principle 1)" },
];

/** Every language a quotable line carries, not just the launch pair (PRD R12). */
function allLines(line: QuotableLine | null | undefined): string[] {
  if (!line) return [];
  return Object.values(line).filter((v): v is string => typeof v === "string");
}

/**
 * The citation and phrase checks, over any set of user-facing strings.
 *
 * Extracted so escalation drafts (PRD R9) go through exactly the same filter
 * as live guidance. A complaint letter is read by an authority rather than
 * said to an officer, but it is still corpus text the product put in front of
 * a person as if it were reliable, and a section number invented there is
 * wrong in the same way.
 */
export function scanText(corpus: Corpus, surfaces: string[], versionLabel: string): GuardViolation[] {
  const violations: GuardViolation[] = [];

  const groundedSections = new Set<string>();
  for (const p of corpus.provisions.values()) {
    groundedSections.add(normalise(p.section));
  }

  for (const text of surfaces) {
    if (!text) continue;
    for (const m of text.matchAll(CITATION)) {
      const cited = normalise(m[1] ?? "");
      if (!groundedSections.has(cited)) {
        violations.push({
          kind: "ungrounded-citation",
          detail: `"${m[0]}" is not in corpus v${versionLabel} (normalised: ${cited})`,
        });
      }
    }
    for (const f of FORBIDDEN) {
      if (f.re.test(text)) {
        violations.push({ kind: "forbidden-phrase", detail: `${f.why}: "${truncate(text)}"` });
      }
    }
  }
  return violations;
}

export function guard(corpus: Corpus, update: GuidanceUpdate): GuardViolation[] {
  const surfaces: string[] = [
    ...allLines(update.quotableLine),
    update.documentNow ?? "",
    ...update.doNotSay,
    ...update.options.flatMap((o) => [o.label, o.rationale, o.tradeoff ?? ""]),
    ...update.newFlags.map((f) => f.statement),
  ];

  const violations = scanText(corpus, surfaces, update.corpusVersion);

  if (!update.disclaimer || update.disclaimer.trim().length === 0) {
    violations.push({ kind: "missing-disclaimer", detail: "PRD R7 requires a disclaimer on every answer screen" });
  }

  if (update.fallback && update.provisionsCited.length > 0) {
    violations.push({
      kind: "fallback-cites-law",
      detail: "low-confidence fallback must not cite provisions (PRD Design Principle 3)",
    });
  }

  return violations;
}

/**
 * Applied when the guard trips. The engine degrades to the fallback rather
 * than suppressing the violation and shipping it anyway.
 */
export function degradeToFallback(corpus: Corpus, update: GuidanceUpdate, violations: GuardViolation[]): GuidanceUpdate {
  const fb = corpus.fallback;
  return {
    ...update,
    scenarioId: null,
    scenarioTitle: fb.title,
    fallback: true,
    quotableLine: fb.quotableLine,
    doNotSay: fb.doNotSay,
    documentNow: fb.documentNow,
    options: fb.options,
    newFlags: [],
    provisionsCited: [],
    changed: true,
    changeReason: `output guard tripped (${violations.map((v) => v.kind).join(", ")}) — degraded to universal safe actions`,
  };
}

/**
 * PRD R9 — the same three checks, applied to escalation guidance.
 *
 * There is deliberately no "degrade to fallback" counterpart here. A tripped
 * guard on a complaint draft means the corpus is wrong, and the honest
 * response is to withhold that route and say so, not to hand over a
 * de-escalated version of a legal document.
 */
export function guardEscalationOption(
  corpus: Corpus,
  option: EscalationOption,
  corpusVersion: string,
): GuardViolation[] {
  const r = option.route;
  return scanText(
    corpus,
    [
      r.title, r.authority.name, r.authority.remit, r.deadline.text,
      ...r.authority.howToReach, ...r.requiredContents, ...r.cautions,
      option.draft,
    ],
    corpusVersion,
  );
}

export interface EscalationGuardResult {
  /** Routes that passed. Substituted in place of the original list. */
  kept: EscalationOption[];
  /** Route id -> why it was withheld. Surfaced, never swallowed. */
  withheld: Array<{ routeId: string; violations: GuardViolation[] }>;
  /** Everything found, including the disclaimer check. */
  violations: GuardViolation[];
}

export function guardEscalation(corpus: Corpus, guidance: EscalationGuidance): EscalationGuardResult {
  const kept: EscalationOption[] = [];
  const withheld: EscalationGuardResult["withheld"] = [];
  const violations: GuardViolation[] = [];

  // Checked one route at a time so a bad route is withheld on its own rather
  // than taking the others with it, and so the client can name which one.
  for (const option of guidance.options) {
    const found = guardEscalationOption(corpus, option, guidance.corpusVersion);
    if (found.length === 0) kept.push(option);
    else {
      withheld.push({ routeId: option.route.id, violations: found });
      violations.push(...found);
    }
  }

  if (!guidance.disclaimer || guidance.disclaimer.trim().length === 0) {
    violations.push({ kind: "missing-disclaimer", detail: "PRD R7 requires a disclaimer on every answer screen" });
  }
  return { kept, withheld, violations };
}

const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, "").replace(/^article/, "");
const truncate = (s: string) => (s.length > 80 ? `${s.slice(0, 77)}...` : s);
