import { loadCorpus } from "./loader.js";
import type { FactKey } from "../types.js";

export interface CorpusIssue {
  level: "error" | "warn";
  where: string;
  message: string;
}

/**
 * Structural integrity of the corpus. This is not a legal review — it only
 * proves the corpus is internally consistent and honestly labelled.
 */
export function validateCorpus(): CorpusIssue[] {
  const c = loadCorpus(true);
  const issues: CorpusIssue[] = [];
  const err = (where: string, message: string) => issues.push({ level: "error", where, message });
  const warn = (where: string, message: string) => issues.push({ level: "warn", where, message });

  const allOptionIds = new Set<string>();

  for (const [id, s] of c.scenarios) {
    for (const pid of s.provisionIds) {
      if (!c.provisions.has(pid)) err(`scenario/${id}`, `references unknown provision "${pid}"`);
    }
    if (s.options.filter((o) => o.safest).length < 1) {
      err(`scenario/${id}`, "no option is marked safest — PRD requires one recommended safe action");
    }
    for (const o of s.options) allOptionIds.add(o.id);

    for (const lang of ["en", "hi"] as const) {
      const line = s.quotableLine[lang];
      if (!line) { err(`scenario/${id}`, `quotableLine.${lang} is empty`); continue; }
      const words = line.trim().split(/\s+/).length;
      if (words > 25) warn(`scenario/${id}`, `quotableLine.${lang} is ${words} words (PRD R3 limit is 25)`);
    }
    if (s.doNotSay.length === 0) warn(`scenario/${id}`, "empty doNotSay list — PRD R3 requires one");
    if (s.verification.status === "unverified") {
      warn(`scenario/${id}`, "UNVERIFIED — must not ship to a user");
    }
    if (s.jurisdiction !== "IN-CENTRAL") {
      warn(`scenario/${id}`, `jurisdiction is ${s.jurisdiction}; v1 scope is central law only`);
    }
  }

  for (const o of c.fallback.options) allOptionIds.add(o.id);

  const factKeys = new Set<string>(FACT_KEYS);
  for (const r of c.rules) {
    if (r.when.length === 0) err(`rule/${r.id}`, "rule has no predicates — would fire always");
    for (const p of r.when) {
      if (!factKeys.has(p.fact)) err(`rule/${r.id}`, `predicate on unknown fact "${p.fact}"`);
      if (p.value === "unknown") err(`rule/${r.id}`, `predicate matches "unknown" — a rule must never fire on an unestablished fact`);
    }
    for (const pid of r.provisionIds) {
      if (!c.provisions.has(pid)) err(`rule/${r.id}`, `references unknown provision "${pid}"`);
    }
    for (const oid of r.optionIds) {
      if (!allOptionIds.has(oid)) err(`rule/${r.id}`, `references unknown option "${oid}"`);
    }
  }

  if (c.fallback.provisionIds.length > 0) {
    err("fallback", "the fallback must cite no provisions — PRD Design Principle 3");
  }
  if (c.meta.status !== "counsel-signed-off") {
    warn("meta", `corpus status is "${c.meta.status}" — engine will attach the unverified warning to every output`);
  }
  return issues;
}

/** Kept in sync with SituationFacts by the type-level check in test/run.ts. */
export const FACT_KEYS = [
  "officerIdentified","officerInUniform","femaleOfficerPresent","userIsFemale","inPublicPlace","isNight",
  "vehicleStopped","helmetWorn","licenceHeld","licenceCarried","documentsProduced","keysTaken","vehicleBlocked",
  "cashDemanded","amountDemanded","formalChallanOffered",
  "askedToComeToStation","arrestAsserted","groundsGiven","noticeUnderS35Given","relativeInformed",
  "producedBeforeMagistrate","detentionStartedAt",
  "searchRequested","searchBegun","phoneDemanded","unlockDemanded","seizureMemoOffered",
  "dispersalOrderGiven","orderUnderS163Cited","assemblyPeaceful","forceUsed",
] as const satisfies readonly FactKey[];
