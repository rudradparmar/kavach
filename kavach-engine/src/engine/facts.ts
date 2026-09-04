import type { FactKey, FactObservation, FactPredicate, SituationFacts, Tri } from "../types.js";
import { FACT_KEYS } from "../corpus/validate.js";

const NUMERIC: FactKey[] = ["amountDemanded"];
const STRINGY: FactKey[] = ["detentionStartedAt"];

export function initialFacts(): SituationFacts {
  const f = {} as Record<string, unknown>;
  for (const k of FACT_KEYS) {
    f[k] = NUMERIC.includes(k) || STRINGY.includes(k) ? null : ("unknown" satisfies Tri);
  }
  return f as unknown as SituationFacts;
}

export const isTriFact = (k: FactKey) => !NUMERIC.includes(k) && !STRINGY.includes(k);

/**
 * Apply an observation. Returns true if this actually changed the state —
 * the session uses that to decide whether guidance needs to be re-emitted.
 */
export function applyObservation(facts: SituationFacts, obs: FactObservation): boolean {
  const key = obs.fact;
  const current = (facts as unknown as Record<string, unknown>)[key];
  let next = obs.value;

  if (isTriFact(key)) {
    if (next !== "yes" && next !== "no" && next !== "unknown") return false;
    // A fact never regresses to unknown once established. Noise in one turn
    // must not erase something the user said three turns ago.
    if (next === "unknown") return false;
  } else if (NUMERIC.includes(key)) {
    if (typeof next !== "number" || !Number.isFinite(next)) return false;
  }

  if (current === next) return false;
  (facts as unknown as Record<string, unknown>)[key] = next;
  return true;
}

/**
 * Predicate evaluation. "unknown" satisfies nothing, ever. A misconduct flag
 * must never fire because a fact was never established.
 */
export function evaluate(facts: SituationFacts, p: FactPredicate): boolean {
  const v = (facts as unknown as Record<string, unknown>)[p.fact];
  if (v === "unknown" || v === null || v === undefined) return false;
  switch (p.op) {
    case "eq": return v === p.value;
    case "neq": return v !== p.value;
    case "gt": return typeof v === "number" && typeof p.value === "number" && v > p.value;
    case "lt": return typeof v === "number" && typeof p.value === "number" && v < p.value;
    default: return false;
  }
}

export const evaluateAll = (facts: SituationFacts, ps: FactPredicate[]) =>
  ps.length > 0 && ps.every((p) => evaluate(facts, p));

export function establishedFacts(facts: SituationFacts): Array<{ fact: FactKey; value: unknown }> {
  const out: Array<{ fact: FactKey; value: unknown }> = [];
  for (const k of FACT_KEYS) {
    const v = (facts as unknown as Record<string, unknown>)[k];
    if (v === "unknown" || v === null || v === undefined) continue;
    out.push({ fact: k, value: v });
  }
  return out;
}

export function knownForProvider(facts: SituationFacts): Partial<Record<FactKey, Tri | number | null>> {
  const out: Record<string, unknown> = {};
  for (const { fact, value } of establishedFacts(facts)) out[fact] = value;
  return out as Partial<Record<FactKey, Tri | number | null>>;
}
