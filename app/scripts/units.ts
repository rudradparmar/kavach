/**
 * Unit checks for the client's pure logic — the parts with no engine, no
 * network and no device behind them.
 *
 *   npm run units
 *
 * Same hand-rolled shape as kavach-engine/test/run.ts: no framework, no
 * config, runs under tsx. Anything imported here must stay free of React
 * Native, which is why the logic under test lives in its own modules
 * (src/tts/languages.ts, src/api/url.ts) rather than beside the hooks.
 */

import { loadCorpus } from "../../kavach-engine/src/corpus/loader.js";
import { initialFacts } from "../../kavach-engine/src/engine/facts.js";
import { buildOptions } from "../../kavach-engine/src/engine/options.js";
import { normalise, siblingUrl } from "../src/api/url";
import { composeAlert, isDialable, mapsUrl, normalisePhone } from "../src/contacts/message";
import { staticOptions } from "../src/offline/staticOptions";
import { isPanicUrl, PANIC_URL } from "../src/entry/panicLink";
import { backgroundRecordingAvailable } from "../src/evidence/background";
import {
  BCP47, ENDONYM, ENGLISH_NAME, matchAvailable, primarySubtag, SPEECH_LANGS,
  SUBTAGS, unavailableReason, type SpeechLang,
} from "../src/tts/languages";
import { percentile, summarise, withinBudget, type TurnTiming } from "../src/telemetry/latency";

const engineCorpus = loadCorpus();

let pass = 0;
let fail = 0;

const group = (name: string) => console.log(`\n${name}`);

function t(name: string, fn: () => void) {
  try {
    fn();
    pass += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (e) {
    fail += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${(e as Error).message}`);
  }
}

/** Declared as an assertion function so it narrows, not just throws. */
function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}

const eq = <T,>(actual: T, expected: T, m: string) => {
  if (actual !== expected) throw new Error(`${m}: expected ${String(expected)}, got ${String(actual)}`);
};

/* ------------------------------------------------------------------ */
group("speech language matching");

// The failure here is silent and one-directional: too strict a matcher greys
// out the Hindi button on a device that can in fact speak Hindi, and the user
// is quietly told to read the line themselves.
const FORMATS: Array<[string, string]> = [
  ["hi-IN", "hi"],
  ["hi_IN", "hi"],
  ["hi", "hi"],
  ["HI-in", "hi"],
  ["hin-IND", "hin"],
  ["en-IN", "en"],
  ["en_US", "en"],
];

for (const [reported, expected] of FORMATS) {
  t(`primary subtag of ${JSON.stringify(reported)} is ${expected}`, () => {
    eq(primarySubtag(reported), expected, "subtag");
  });
}

t("a device reporting hi-IN can speak Hindi", () => {
  const a = matchAvailable(["en-US", "hi-IN"]);
  assert(a.has("hi"), "Hindi not detected");
  assert(a.has("en"), "English not detected");
});

t("underscore and three-letter variants still count", () => {
  assert(matchAvailable(["hi_IN"]).has("hi"), "hi_IN missed");
  assert(matchAvailable(["hin-IND"]).has("hi"), "hin-IND missed");
  assert(matchAvailable(["eng-USA"]).has("en"), "eng-USA missed");
});

t("an English-only device does not claim Hindi", () => {
  const a = matchAvailable(["en-US", "en-GB", "fr-FR"]);
  assert(a.has("en"), "English missed");
  assert(!a.has("hi"), "claimed a Hindi voice it does not have");
});

t("empty, null and malformed entries are survivable", () => {
  const a = matchAvailable([undefined, null, "", "-", "??"]);
  eq(a.size, 0, "matched something from junk");
});

/* ------------------------------------------------------------------ */
group("speech control reasons");

t("no Hindi voice disables the Hindi control with a reason", () => {
  const reason = unavailableReason("hi", new Set<SpeechLang>(["en"]));
  assert(reason !== null, "control would have stayed enabled");
  assert(/hindi/i.test(reason ?? ""), `unhelpful reason: ${reason}`);
});

t("an available language has no reason to be disabled", () => {
  eq(unavailableReason("hi", new Set<SpeechLang>(["en", "hi"])), null, "hi");
  eq(unavailableReason("en", new Set<SpeechLang>(["en", "hi"])), null, "en");
});

t("while voices are still loading, nothing is claimed either way", () => {
  const reason = unavailableReason("hi", null);
  assert(reason !== null, "enabled a control before knowing if it works");
  assert(/check/i.test(reason ?? ""), `should say it is still checking: ${reason}`);
});

/* ------------------------------------------------------------------ */
group("latency reporting");

const timing = (total: number): TurnTiming => ({
  source: "voice",
  capture: null,
  transcribe: null,
  engine: null,
  total,
  at: 0,
});

t("the PRD budget boundaries are reported honestly", () => {
  eq(withinBudget(1_000), "ok", "1s");
  eq(withinBudget(8_000), "ok", "exactly p95");
  eq(withinBudget(8_001), "over-p95", "just over p95");
  eq(withinBudget(12_001), "over-p99", "over p99");
});

t("percentiles over an empty set are null, not zero", () => {
  eq(percentile([], 50), null, "median of nothing");
  eq(summarise([]).lastMs, null, "last of nothing");
});

t("a handful of turns is not called a percentile", () => {
  const few = summarise([timing(100), timing(200), timing(300)]);
  eq(few.count, 3, "count");
  assert(!few.meaningful, "claimed a percentile from 3 samples");
});

t("median and last are computed over the right values", () => {
  const s = summarise([timing(300), timing(100), timing(200)]);
  eq(s.medianMs, 200, "median");
  eq(s.lastMs, 200, "last should be insertion order, not sorted order");
});

/* ------------------------------------------------------------------ */
group("static option ranking matches the engine");

// src/offline/staticOptions.ts is a port of kavach-engine/src/engine/options.ts,
// which cannot be bundled into the app because it reaches corpus/loader.ts and
// therefore node:fs. A port that drifts would show the wrong "safest" action on
// an offline card, so the two are run side by side here over every scenario.
//
// This is the one place the app imports engine *runtime* code rather than
// types, and it is deliberate: the check is worthless if it tests a copy.
for (const scenario of engineCorpus.scenarios.values()) {
  t(`${scenario.id}: same options, same order, same safest`, () => {
    const mine = staticOptions(scenario);
    const theirs = buildOptions(engineCorpus, scenario.id, initialFacts(), []);

    eq(mine.length, theirs.length, "option count");
    eq(
      mine.map((o) => o.id).join(","),
      theirs.map((o) => o.id).join(","),
      "order",
    );
    eq(
      mine.find((o) => o.safest)?.id,
      theirs.find((o) => o.safest)?.id,
      "safest option",
    );
    eq(mine.filter((o) => o.safest).length, 1, "exactly one safest");
  });
}

t("a fact-gated option is withheld from a static card", () => {
  const searchFrisk = engineCorpus.scenarios.get("search-frisk");
  assert(searchFrisk !== undefined, "search-frisk missing from the corpus");

  const gated = searchFrisk.options.filter((o) => o.requires && o.requires.length > 0);
  assert(gated.length > 0, "fixture assumption broken: nothing is gated any more");

  const shown = staticOptions(searchFrisk).map((o) => o.id);
  for (const o of gated) {
    assert(!shown.includes(o.id), `${o.id} was offered without its fact established`);
  }
});

t("dropping the gated option still leaves a safest one", () => {
  const searchFrisk = engineCorpus.scenarios.get("search-frisk");
  assert(searchFrisk !== undefined, "search-frisk missing");
  const safest = staticOptions(searchFrisk).filter((o) => o.safest);
  eq(safest.length, 1, "safest count");
  assert(
    !safest[0]?.requires || safest[0].requires.length === 0,
    "the safest option on a static card must not be fact-gated",
  );
});

t("re-ranks rather than trusting the corpus flags", () => {
  // The corpus comparison above cannot catch this on its own: search-frisk
  // happens to carry TWO safest:true entries, so simply filtering and keeping
  // the original flags gives the right answer there by luck of the content.
  //
  // This is the shape that breaks it — the only safest option is fact-gated.
  // Filtering without re-ranking leaves a card with no safest action at all,
  // and the corpus is one edit away from looking like this.
  const synthetic = {
    ...engineCorpus.scenarios.get("keys-taken")!,
    options: [
      {
        id: "gated-safest",
        label: "x",
        rationale: "x",
        rank: 1,
        safest: true,
        tradeoff: null,
        requires: [{ fact: "userIsFemale" as const, op: "eq" as const, value: "yes" as const }],
      },
      { id: "second", label: "x", rationale: "x", rank: 2, safest: false, tradeoff: null },
      { id: "third", label: "x", rationale: "x", rank: 3, safest: false, tradeoff: null },
    ],
  };

  const out = staticOptions(synthetic);
  eq(out.length, 2, "gated option should be dropped");
  eq(out.filter((o) => o.safest).length, 1, "exactly one safest must survive");
  eq(out.find((o) => o.safest)?.id, "second", "safest should fall to the next available option");
  eq(out.map((o) => o.rank).join(","), "1,2", "ranks should be renumbered from 1");

  // And the engine agrees, which is the whole point of the port.
  const theirs = buildOptions(
    { ...engineCorpus, scenarios: new Map([[synthetic.id, synthetic]]) },
    synthetic.id,
    initialFacts(),
    [],
  );
  eq(out.map((o) => o.id).join(","), theirs.map((o) => o.id).join(","), "order vs engine");
  eq(out.find((o) => o.safest)?.id, theirs.find((o) => o.safest)?.id, "safest vs engine");
});

/* ------------------------------------------------------------------ */
group("trusted-contact alert");

const alertAt = new Date("2026-09-04T14:32:00");
const baseAlert = {
  userName: "Rudra",
  scenarioTitle: "Officer takes the keys or blocks the vehicle",
  at: alertAt,
  location: { latitude: 28.613939, longitude: 77.209023, accuracyM: 12.4, at: alertAt },
  locationProblem: null,
  sessionRef: "ae0612d7",
};

t("the message states no law", () => {
  // CLAUDE.md invariant 1, applied to a message that goes to a third party who
  // was not there, may forward it, and may read it out to the officer. The
  // corpus it would be quoting is unverified placeholder text.
  const msg = composeAlert(baseAlert);
  const forbidden = [
    /\bsection\b/i,
    /\barticle\b/i,
    /\bs\.\d/i,
    /\bunlawful\b/i,
    /\billegal\b/i,
    /\byour rights?\b/i,
    /\bMotor Vehicles Act\b/i,
    /\bBNSS\b/i,
  ];
  for (const re of forbidden) {
    assert(!re.test(msg), `message contains ${re}: ${JSON.stringify(msg)}`);
  }
});

t("the scenario is offered as a guess, not asserted", () => {
  // The engine can misclassify — that is why there is a confidence floor.
  // Telling somebody's sister "the officer took his keys" when it misheard is
  // misinformation with consequences.
  const msg = composeAlert(baseAlert);
  assert(/may be wrong/i.test(msg), "no hedge on the classification");
  assert(msg.includes(baseAlert.scenarioTitle), "scenario title missing");
});

t("a low-confidence session says so rather than guessing", () => {
  const msg = composeAlert({ ...baseAlert, scenarioTitle: null });
  assert(/could not work out/i.test(msg), "fallback not stated plainly");
  assert(!/may be wrong/i.test(msg), "hedged a classification it does not have");
});

t("the recipient needs no app and no context", () => {
  // PRD R5: "a plain-language message that assumes zero context and no app
  // install".
  const msg = composeAlert(baseAlert);
  assert(/do not need to install/i.test(msg), "does not tell them no install is needed");
  assert(msg.includes("https://maps.google.com/"), "no universally openable location link");
  assert(msg.startsWith("Rudra"), `does not open with who it is about: ${msg.slice(0, 40)}`);
});

t("no name still produces a usable opening", () => {
  const msg = composeAlert({ ...baseAlert, userName: null });
  assert(/^Someone you know/.test(msg), `unusable opening: ${msg.slice(0, 40)}`);
});

t("a missing location is stated, not silently dropped", () => {
  // Silence would read as "no location was needed".
  const msg = composeAlert({
    ...baseAlert,
    location: null,
    locationProblem: "location permission was not given on their phone",
  });
  assert(/Location not available/i.test(msg), "missing location not mentioned");
  assert(/permission was not given/i.test(msg), "reason not passed through");
  assert(!msg.includes("maps.google.com"), "linked to a location it does not have");
  // The closing line has to stop promising a place when there is not one.
  assert(!/where and when they last were/i.test(msg), "claimed a location it does not have");
  assert(/time they last used their phone/i.test(msg), "closing line lost its meaning");
});

t("coordinates round to a sane precision", () => {
  assert(
    mapsUrl(28.613939123, 77.209023456) === "https://maps.google.com/?q=28.61394,77.20902",
    mapsUrl(28.613939123, 77.209023456),
  );
});

t("phone numbers people actually save are accepted", () => {
  for (const ok of ["+91 98765 43210", "098765-43210", "9876543210", "+919876543210"]) {
    assert(isDialable(ok), `rejected a real number: ${ok}`);
  }
  for (const bad of ["", "12", "not a number", "1".repeat(20)]) {
    assert(!isDialable(bad), `accepted a bad number: ${JSON.stringify(bad)}`);
  }
});

t("normalising a number keeps a leading plus and drops the rest", () => {
  eq(normalisePhone("+91 98765-43210"), "+919876543210", "indian mobile");
  eq(normalisePhone("(098) 765 43210"), "09876543210", "with brackets");
  eq(normalisePhone("+1+2+3"), "+123", "only the leading plus survives");
});

/* ------------------------------------------------------------------ */
group("url handling");

t("trailing slashes are stripped so paths concatenate", () => {
  eq(normalise("http://x:8787/"), "http://x:8787", "one slash");
  eq(normalise("  http://x:8787///  "), "http://x:8787", "several, plus whitespace");
  eq(normalise("http://x:8787"), "http://x:8787", "already clean");
});

const STT = { port: 8788, segment: "stt" };
const EVIDENCE = { port: 8789, segment: "evidence" };

t("a port-mounted engine puts its siblings on sibling ports", () => {
  // Development: three processes, one host, a port each.
  eq(siblingUrl("http://192.168.1.5:8787", STT), "http://192.168.1.5:8788", "stt");
  eq(siblingUrl("http://192.168.1.5:8787", EVIDENCE), "http://192.168.1.5:8789", "evidence");
  eq(siblingUrl("http://localhost:8787/", STT), "http://localhost:8788", "trailing slash");
});

t("a path-mounted engine puts its siblings on sibling paths", () => {
  // Deployment: one hostname, one certificate, a proxy routing by prefix.
  // This is the shape the old port-rebuilding version could not express, and
  // could not express it silently -- it returned a :8788 URL on a :443 host.
  eq(siblingUrl("https://api.example.com/engine", STT), "https://api.example.com/stt", "stt");
  eq(
    siblingUrl("https://api.example.com/engine", EVIDENCE),
    "https://api.example.com/evidence",
    "evidence",
  );
  eq(
    siblingUrl("https://api.example.com/kavach/engine", STT),
    "https://api.example.com/kavach/stt",
    "mounted below a prefix",
  );
});

t("a path-mounted sibling never carries a port, whatever the engine had", () => {
  // The bug this whole function exists to prevent: TLS terminates on 443,
  // so any port in a derived URL means the request goes nowhere.
  for (const url of [
    siblingUrl("https://api.example.com/engine", STT),
    siblingUrl("https://api.example.com/engine", EVIDENCE),
  ]) {
    assert(!/:\d+/.test(new URL(url).host), `derived a port on a TLS host: ${url}`);
  }
});

t("garbage in gives a usable localhost address, not a throw", () => {
  // A session must never fail to start because a stored address is malformed.
  eq(siblingUrl("not a url", STT), "http://localhost:8788", "stt");
  eq(siblingUrl("", EVIDENCE), "http://localhost:8789", "evidence");
});

/* ------------------------------------------------------------------ */
group("language registry parity with the corpus (R12)");

// The client keeps its own copy of the language table because it has to know
// what it can speak before it has ever reached the engine — offline, on first
// launch, with a cached corpus or none. A duplicate is only safe while
// something fails when the two drift. This is that something.

t("the client speaks exactly the languages the corpus advertises", () => {
  const corpusCodes = engineCorpus.languages.languages.map((l) => l.code).sort();
  const clientCodes = [...SPEECH_LANGS].sort();
  eq(clientCodes.join(","), corpusCodes.join(","), "language sets differ");
});

t("every language has a BCP-47 tag, an endonym and an English name", () => {
  for (const lang of SPEECH_LANGS) {
    assert(BCP47[lang]?.includes("-"), `${lang} has no region-qualified tag`);
    assert(ENDONYM[lang]?.length > 0, `${lang} has no endonym`);
    assert(ENGLISH_NAME[lang]?.length > 0, `${lang} has no English name`);
  }
});

t("the client's subtags match the corpus registry", () => {
  for (const entry of engineCorpus.languages.languages) {
    const mine = SUBTAGS[entry.code as SpeechLang];
    assert(mine !== undefined, `client has no subtags for ${entry.code}`);
    for (const sub of entry.subtags) {
      assert(mine.includes(sub), `corpus lists subtag "${sub}" for ${entry.code}, client does not`);
    }
  }
});

t("each language's own tag matches its own subtags and nothing else's", () => {
  // The failure this catches is a copy-paste in the table: a language whose
  // BCP-47 tag points at another language's voice. The device would then
  // speak, fluently, in the wrong language, and the user would repeat it.
  for (const lang of SPEECH_LANGS) {
    const matched = matchAvailable([BCP47[lang]]);
    assert(matched.has(lang), `${lang} does not match its own tag ${BCP47[lang]}`);
    eq(matched.size, 1, `${BCP47[lang]} matched more than ${lang}`);
  }
});

t("a device with no voice for a language disables it and says which", () => {
  // The silent failure: Android hands Devanagari to an English engine and
  // produces confident gibberish, which the user says to an officer.
  const onlyEnglish = matchAvailable(["en-IN"]);
  for (const lang of SPEECH_LANGS) {
    const reason = unavailableReason(lang, onlyEnglish);
    if (lang === "en") {
      eq(reason, null, "English was disabled on a device that has it");
    } else {
      assert(reason !== null, `${lang} was left enabled with no voice`);
      assert(reason.includes(ENGLISH_NAME[lang]), `the reason for ${lang} does not name the language`);
    }
  }
});

/* ------------------------------------------------------------------ */
group("corpus content the client renders (R9, R11, R13)");

t("every officer prompt names a field the client can send", () => {
  // The client builds its payload from these field names. One that does not
  // exist on the record is a form field whose contents go nowhere.
  const allowed = new Set(["name", "buckleNumber", "rank", "station", "vehicleNumber", "unit", "description"]);
  for (const f of engineCorpus.officerCapture.fields) {
    assert(allowed.has(f.field), `unknown officer field "${f.field}"`);
    assert(f.label.length > 0 && f.why.length > 0, `${f.field} is missing a label or a reason`);
  }
});

t("the buckle number is prompted first", () => {
  const first = [...engineCorpus.officerCapture.fields].sort((a, b) => a.priority - b.priority)[0];
  eq(first?.field, "buckleNumber", "the most useful identifier is not asked for first");
});

t("every choice question offers choices the UI can render", () => {
  for (const q of engineCorpus.debrief.questions) {
    if (q.kind === "choice") {
      assert((q.choices?.length ?? 0) >= 2, `${q.id} is a choice with fewer than two options`);
    }
  }
});

t("every escalation route has something for each section the screen draws", () => {
  for (const r of engineCorpus.escalation.routes) {
    assert(r.authority.name.length > 0, `${r.id} has no authority`);
    assert(r.authority.howToReach.length > 0, `${r.id} has no way in`);
    assert(r.deadline.text.length > 0, `${r.id} has no deadline text`);
    assert(r.requiredContents.length > 0, `${r.id} lists no required contents`);
    assert(r.cautions.length > 0, `${r.id} has no cautions`);
    assert(r.draftTemplate.length > 0, `${r.id} has no draft`);
  }
});

/* ------------------------------------------------------------------ */
/* Native entry and background capture (UNTESTED ON A DEVICE)           */
/* ------------------------------------------------------------------ */
console.log("\nnative entry and background capture");

t("the shortcut URL starts a session, and only it does", () => {
  for (const u of [PANIC_URL, "kavach://start/", "kavach:///start", "KAVACH://Start?from=shortcut"]) {
    assert(isPanicUrl(u), `${u} should start`);
  }
  for (const u of [null, "", "kavach://", "kavach://settings", "kavach://startle", "https://kavach.example/start", "exp://192.168.1.2:8081"]) {
    assert(!isPanicUrl(u), `${u} must not start a session`);
  }
});

t("background recording is promised only by a real build, never by Expo Go", () => {
  assert(!backgroundRecordingAvailable("storeClient"), "Expo Go carries no foreground service");
  assert(!backgroundRecordingAvailable(undefined), "unknown environment must not promise it");
  assert(backgroundRecordingAvailable("standalone"), "an EAS build carries it");
  assert(backgroundRecordingAvailable("bare"), "a prebuilt project carries it");
});

/* ------------------------------------------------------------------ */
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
