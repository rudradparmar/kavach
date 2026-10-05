import { loadCorpus } from "./loader.js";
import { reviewCorpus } from "../engine/review.js";
import type { FactKey, LanguageCode, OfficerRecord } from "../types.js";

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
  const registryCodes = c.languages.languages.map((l) => l.code);
  const launchPair = new Set<LanguageCode>(c.languages.launchPair);
  // Scripts, not languages: Hindi and Marathi share Devanagari, so cue
  // coverage can only be checked at the script level and this says so rather
  // than pretending to check seven.
  const scriptsInRegistry = [...new Set(c.languages.languages.map((l) => l.script))].filter(
    (name) => name in SCRIPT_RANGES,
  );
  const cueCounts = new Map<string, number>();

  for (const [id, s] of c.scenarios) {
    for (const pid of s.provisionIds) {
      if (!c.provisions.has(pid)) err(`scenario/${id}`, `references unknown provision "${pid}"`);
    }
    if (s.options.filter((o) => o.safest).length < 1) {
      err(`scenario/${id}`, "no option is marked safest — PRD requires one recommended safe action");
    }
    for (const o of s.options) allOptionIds.add(o.id);

    // PRD R12: every language the registry advertises must actually be there.
    // A language the app offers and the corpus does not carry is a button
    // that produces nothing, which the user discovers mid-encounter.
    for (const lang of registryCodes) {
      const line = s.quotableLine[lang];
      if (!line || line.trim().length === 0) {
        const fatal = launchPair.has(lang);
        (fatal ? err : warn)(
          `scenario/${id}`,
          `quotableLine.${lang} is missing${fatal ? "" : " — the language registry advertises it"}`,
        );
        continue;
      }
      const words = line.trim().split(/\s+/).length;
      if (words > 25) warn(`scenario/${id}`, `quotableLine.${lang} is ${words} words (PRD R3 limit is 25)`);
      const status = s.translationStatus?.[lang];
      if (status === "counsel-reviewed" && c.meta.status === "unverified") {
        err(`scenario/${id}`, `quotableLine.${lang} claims counsel-reviewed inside an unverified corpus`);
      }
    }
    for (const lang of Object.keys(s.quotableLine) as LanguageCode[]) {
      if (!registryCodes.includes(lang)) {
        err(`scenario/${id}`, `quotableLine.${lang} is not a language in corpus/languages.json`);
      }
    }

    cueCounts.set(id, s.classifierCues.length);
    // Classification is what routes a speaker to the right scenario, so a
    // scenario carrying cues in only one script is unreachable for everyone
    // else — the exact defect the Hindi pass found, one script wider.
    for (const script of scriptsInRegistry) {
      if (!s.classifierCues.some((cue) => SCRIPT_RANGES[script]!.test(cue))) {
        warn(`scenario/${id}`, `no classifier cue in ${script} — speech in that script cannot reach this scenario`);
      }
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

  /* --- language registry ------------------------------------------- */

  {
    const seen = new Set<string>();
    for (const l of c.languages.languages) {
      if (seen.has(l.code)) err("languages", `duplicate language code "${l.code}"`);
      seen.add(l.code);
      if (l.subtags.length === 0) err("languages", `${l.code} declares no subtags — no device voice can match it`);
      if (!l.endonym) warn("languages", `${l.code} has no endonym; a user will see an English label for their own language`);
    }
    for (const code of c.languages.launchPair) {
      if (!seen.has(code)) err("languages", `launchPair names "${code}", which is not in the registry`);
    }
    if (!seen.has(c.languages.default)) err("languages", `default language "${c.languages.default}" is not in the registry`);
    for (const lang of registryCodes) {
      const line = c.fallback.quotableLine[lang];
      if (!line || line.trim().length === 0) {
        (launchPair.has(lang) ? err : warn)("fallback", `quotableLine.${lang} is missing`);
      }
    }
  }

  /* --- classifier cue balance -------------------------------------- */

  // A cue matched anywhere in history scores 0.5, so cue *count* is a thumb
  // on the scale: a scenario with far more cues than its neighbours drifts
  // upward as a session gets longer, independent of what was actually said.
  // This is the guard that keeps a language pass from quietly re-weighting
  // classification.
  if (cueCounts.size > 1) {
    const counts = [...cueCounts.values()];
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    if (max - min > CUE_SPREAD_LIMIT) {
      const lowest = [...cueCounts.entries()].filter(([, n]) => n === min).map(([k]) => k);
      const highest = [...cueCounts.entries()].filter(([, n]) => n === max).map(([k]) => k);
      err(
        "scenarios",
        `classifier cue counts range ${min}–${max} (limit is a spread of ${CUE_SPREAD_LIMIT}). ` +
          `Fewest: ${lowest.join(", ")}. Most: ${highest.join(", ")}. ` +
          `Uneven counts bias long-session classification.`,
      );
    }
  }

  /* --- escalation routes (PRD R9) ----------------------------------- */

  {
    const declared = new Set(c.escalation.placeholders.map((p) => p.token));
    const routeIds = new Set<string>();
    const ruleIds = new Set(c.rules.map((r) => r.id));

    for (const r of c.escalation.routes) {
      const where = `escalation/${r.id}`;
      if (routeIds.has(r.id)) err(where, "duplicate route id");
      routeIds.add(r.id);

      for (const pid of r.provisionIds) {
        if (!c.provisions.has(pid)) err(where, `references unknown provision "${pid}"`);
      }
      for (const sid of r.appliesToScenarioIds) {
        if (!c.scenarios.has(sid)) err(where, `applies to unknown scenario "${sid}"`);
      }
      for (const fid of r.appliesToFlagIds) {
        if (!ruleIds.has(fid)) err(where, `applies to unknown misconduct rule "${fid}"`);
      }
      if (r.requiredContents.length === 0) err(where, "no requiredContents — PRD R9 asks what the complaint must contain");
      if (!r.deadline.text) err(where, "no deadline text — PRD R9 asks for the deadline, including when there is none");
      if (r.authority.howToReach.length === 0) err(where, "no way to reach the authority");
      if (!r.draftTemplate.trim()) err(where, "no draft — PRD R9 asks for a draft the user edits");

      // Every token in a draft must be one the engine knows how to fill or
      // deliberately leaves blank. An undeclared token silently renders as a
      // blank the user is never told about.
      for (const m of r.draftTemplate.matchAll(/\{\{[a-zA-Z]+\}\}/g)) {
        if (!declared.has(m[0])) err(where, `draft uses undeclared placeholder ${m[0]}`);
      }
      if (r.verification.status === "unverified") warn(where, "UNVERIFIED — must not ship to a user");
      if (r.jurisdiction !== "IN-CENTRAL") warn(where, `jurisdiction is ${r.jurisdiction}; v1 scope is central law only`);
    }
    if (!c.escalation.routes.some((r) => r.appliesToScenarioIds.length === 0 && r.appliesToFlagIds.length === 0)) {
      err("escalation", "no universal route — a session that matched nothing would be offered nothing");
    }
  }

  /* --- debrief (PRD R13) -------------------------------------------- */

  {
    const seen = new Set<string>();
    for (const q of c.debrief.questions) {
      if (seen.has(q.id)) err("debrief", `duplicate question id "${q.id}"`);
      seen.add(q.id);
      if (q.kind === "choice" && (!q.choices || q.choices.length < 2)) {
        err("debrief", `question "${q.id}" is a choice with fewer than two options`);
      }
      if (!q.why) warn("debrief", `question "${q.id}" does not say why it is being asked`);
    }
    const accuracy = c.debrief.questions.filter((q) => q.accuracySignal);
    if (accuracy.length !== 1) {
      err("debrief", `expected exactly one accuracySignal question, found ${accuracy.length} — PRD R6 needs one and only one`);
    }
    if (c.debrief.windowHours <= 0) err("debrief", "windowHours must be positive");
  }

  /* --- officer capture (PRD R11) ------------------------------------ */

  {
    const seen = new Set<string>();
    for (const f of c.officerCapture.fields) {
      if (!OFFICER_FIELDS.includes(f.field)) err("officer-capture", `unknown officer field "${f.field}"`);
      if (seen.has(f.field)) err("officer-capture", `duplicate officer field "${f.field}"`);
      seen.add(f.field);
      if (!f.why) warn("officer-capture", `field "${f.field}" does not say why it matters`);
    }
    if (!seen.has("buckleNumber")) {
      err("officer-capture", "no buckle-number prompt — the corpus names it as the detail most often missing later");
    }
  }

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

  /* --- review state (PRD R6) ---------------------------------------- */

  {
    const review = reviewCorpus(c);
    if (review.overdue.length > 0) {
      warn(
        "review",
        `${review.overdue.length}/${review.total} corpus items are overdue for review` +
          (review.neverReviewed > 0 ? ` (${review.neverReviewed} have never been reviewed)` : "") +
          ` — PRD R6 requires these to be flagged in-product, and they are`,
      );
    }
    if (review.dueSoon.length > 0) {
      warn("review", `${review.dueSoon.length} item(s) fall due for review within 30 days`);
    }
  }

  return issues;
}

/**
 * Cue counts may differ by at most this much between scenarios.
 *
 * Not a style rule. Cues are scored, a cue matched anywhere in history
 * contributes, and so a scenario with many more cues than its neighbours wins
 * long sessions on volume rather than on what was said.
 */
export const CUE_SPREAD_LIMIT = 8;

/** Unicode ranges for the scripts the language registry can name. */
const SCRIPT_RANGES: Record<string, RegExp> = {
  Latin: /[A-Za-z]/,
  Devanagari: /[\u0900-\u097F]/,
  Bengali: /[\u0980-\u09FF]/,
  Tamil: /[\u0B80-\u0BFF]/,
  Telugu: /[\u0C00-\u0C7F]/,
  Kannada: /[\u0C80-\u0CFF]/,
};

/** The user-fillable fields of an OfficerRecord, kept honest by the type. */
const OFFICER_FIELDS = [
  "name", "buckleNumber", "rank", "station", "vehicleNumber", "unit", "description",
] as const satisfies ReadonlyArray<keyof OfficerRecord>;

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
