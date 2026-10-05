import type { Corpus } from "../corpus/loader.js";
import { provisionsFor } from "../corpus/loader.js";
import type {
  EscalationGuidance, EscalationOption, EscalationRoute,
  LocationFix, MediaBundle, SessionState,
} from "../types.js";
import { describeOfficer } from "./officers.js";

/**
 * PRD R9 — what to do afterwards.
 *
 * "After the incident: which authority hears this complaint, the deadline,
 * the required contents, and a draft complaint the user edits."
 *
 * ## Selection is deterministic
 *
 * Routes are chosen by matching the scenarios the session actually traversed
 * and the flags that actually fired against lists in the corpus. No model is
 * consulted, at any point, for any part of this. The same session produces
 * the same routes in the same order, forever, which is the property that
 * makes it reviewable by an advocate.
 *
 * ## The draft is filled, never written
 *
 * `draftTemplate` is corpus text with `{{placeholders}}`. This module
 * substitutes values it can take straight from the session record — a date,
 * an officer's buckle number, the corpus statement of a flag — and nothing
 * else. It does not narrate. `{{whatHappened}}` is a placeholder the engine
 * is structurally incapable of filling, and that is on purpose: a machine
 * account of a police encounter, inserted into a document the user signs and
 * hands to an authority, is theirs to answer for and not theirs to have
 * written.
 *
 * Anything unfilled becomes a visible blank and is listed in `unfilled`, so
 * the client can show the user exactly what is still missing rather than
 * letting a plausible-looking letter go out with a silent hole in it.
 */

const BLANK = "________________";

export interface EscalationInputs {
  locationTrail?: LocationFix[] | null;
  mediaBundle?: MediaBundle | null;
  /** IANA zone for the dates in the draft. A complaint dated in UTC is wrong. */
  timeZone?: string;
  now?: Date;
}

function formatDate(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-IN", { dateStyle: "long", timeZone }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

function formatTime(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-IN", { timeStyle: "short", timeZone }).format(new Date(iso));
  } catch {
    return iso.slice(11, 16);
  }
}

/**
 * Values the engine can take from the record without composing anything.
 *
 * A value that is absent is left out of the map entirely rather than set to
 * an empty string, so `render` can tell "not known" from "known to be blank"
 * and report the first as unfilled.
 */
function substitutions(
  corpus: Corpus,
  state: SessionState,
  inputs: Required<Pick<EscalationInputs, "timeZone">> & EscalationInputs,
): Map<string, string> {
  const tz = inputs.timeZone;
  const map = new Map<string, string>();

  map.set("date", formatDate(state.startedAt, tz));
  map.set("time", formatTime(state.startedAt, tz));
  map.set("sessionRef", state.sessionId);

  const firstFix = inputs.locationTrail?.[0];
  if (firstFix) {
    map.set(
      "place",
      `approximately ${firstFix.latitude.toFixed(5)}, ${firstFix.longitude.toFixed(5)} ` +
        `(position recorded by the device at ${formatTime(firstFix.at, tz)}; add the street or landmark)`,
    );
  }

  const officer = state.officers[0];
  if (officer) {
    if (officer.name) map.set("officerName", officer.name);
    if (officer.buckleNumber) map.set("officerBuckle", officer.buckleNumber);
    if (officer.station) map.set("officerStation", officer.station);
    if (officer.vehicleNumber) map.set("officerVehicle", officer.vehicleNumber);
  }
  // More than one officer recorded: the extras go into the account rather
  // than into fields that only hold one, so none of them is silently dropped.
  if (state.officers.length > 1) {
    const extras = state.officers.slice(1).map(describeOfficer).join("; ");
    map.set("officerName", `${map.get("officerName") ?? BLANK} (also present: ${extras})`);
  }

  const titles = new Set<string>();
  for (const u of state.updates) if (u.scenarioId && u.scenarioTitle) titles.add(u.scenarioTitle);
  if (titles.size > 0) map.set("scenarioTitles", [...titles].join("; "));

  if (state.flags.length > 0) {
    map.set(
      "flagsSummary",
      state.flags.map((f) => `  - [${f.severity}] ${f.statement}`).join("\n"),
    );
  } else {
    map.set("flagsSummary", "  - None were recorded during the encounter.");
  }

  const bundle = inputs.mediaBundle;
  if (bundle && bundle.chunks.length > 0) {
    const mb = (bundle.totalBytes / (1024 * 1024)).toFixed(1);
    map.set(
      "evidenceSummary",
      `Audio of the encounter is held by ${bundle.serviceLabel}: ${bundle.chunks.length} segment(s), ` +
        `${mb}MB in total, each with a receipt time and a content hash recorded when it arrived. ` +
        `The first was received at ${bundle.firstReceivedAt ?? "an unrecorded time"}.`,
    );
  } else {
    map.set(
      "evidenceSummary",
      "A transcript of the encounter is attached. Whether any audio was retained is stated in the attached packet.",
    );
  }

  void corpus;
  return map;
}

const TOKEN = /\{\{([a-zA-Z]+)\}\}/g;

export function renderDraft(template: string, values: Map<string, string>): { draft: string; unfilled: string[] } {
  const unfilled: string[] = [];
  const draft = template.replace(TOKEN, (_m, name: string) => {
    const v = values.get(name);
    if (v === undefined) {
      if (!unfilled.includes(name)) unfilled.push(name);
      return BLANK;
    }
    return v;
  });
  return { draft, unfilled };
}

function matches(route: EscalationRoute, scenarioIds: Set<string>, flagIds: Set<string>): string[] {
  const because: string[] = [];
  for (const id of route.appliesToScenarioIds) if (scenarioIds.has(id)) because.push(`scenario: ${id}`);
  for (const id of route.appliesToFlagIds) if (flagIds.has(id)) because.push(`flag: ${id}`);
  return because;
}

const isUniversal = (r: EscalationRoute) =>
  r.appliesToScenarioIds.length === 0 && r.appliesToFlagIds.length === 0;

/**
 * Build the escalation guidance for one session.
 *
 * Ordering: routes matched by something specific come first, most matches
 * first, and the universal routes come last. A person reading this has just
 * had a bad afternoon; the thing that speaks to what happened to them should
 * not be the fourth item.
 */
export function buildEscalation(
  corpus: Corpus,
  state: SessionState,
  inputs: EscalationInputs = {},
): EscalationGuidance {
  const now = inputs.now ?? new Date();
  const timeZone = inputs.timeZone ?? "Asia/Kolkata";
  const values = substitutions(corpus, state, { ...inputs, timeZone });

  const scenarioIds = new Set<string>();
  for (const u of state.updates) if (u.scenarioId) scenarioIds.add(u.scenarioId);
  const flagIds = new Set(state.flags.map((f) => f.ruleId));

  const specific: Array<{ option: EscalationOption; score: number }> = [];
  const universal: EscalationOption[] = [];

  for (const route of corpus.escalation.routes) {
    const because = matches(route, scenarioIds, flagIds);
    if (because.length === 0 && !isUniversal(route)) continue;

    const { draft, unfilled } = renderDraft(route.draftTemplate, values);
    const option: EscalationOption = {
      route,
      because: because.length > 0 ? because : ["applies to any encounter"],
      draft,
      unfilled,
      provisions: provisionsFor(corpus, route.provisionIds),
    };
    if (because.length > 0) specific.push({ option, score: because.length });
    else universal.push(option);
  }

  specific.sort((a, b) => b.score - a.score);

  return {
    sessionId: state.sessionId,
    generatedAt: now.toISOString(),
    corpusVersion: state.corpusVersion,
    options: [...specific.map((s) => s.option), ...universal],
    disclaimer: corpus.meta.disclaimer,
    unverifiedContentWarning:
      corpus.meta.status === "counsel-signed-off" ? null : corpus.meta.unverifiedContentWarning,
  };
}
