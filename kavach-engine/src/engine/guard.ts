import type { Corpus } from "../corpus/loader.js";
import type { GuidanceUpdate } from "../types.js";

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

export function guard(corpus: Corpus, update: GuidanceUpdate): GuardViolation[] {
  const violations: GuardViolation[] = [];

  const surfaces: string[] = [
    update.quotableLine?.en ?? "",
    update.quotableLine?.hi ?? "",
    update.documentNow ?? "",
    ...update.doNotSay,
    ...update.options.flatMap((o) => [o.label, o.rationale, o.tradeoff ?? ""]),
    ...update.newFlags.map((f) => f.statement),
  ];

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
          detail: `"${m[0]}" is not in corpus v${update.corpusVersion} (normalised: ${cited})`,
        });
      }
    }
    for (const f of FORBIDDEN) {
      if (f.re.test(text)) {
        violations.push({ kind: "forbidden-phrase", detail: `${f.why}: "${truncate(text)}"` });
      }
    }
  }

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

const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, "").replace(/^article/, "");
const truncate = (s: string) => (s.length > 80 ? `${s.slice(0, 77)}...` : s);
