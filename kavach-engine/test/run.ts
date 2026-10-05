import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadCorpus, scenarioOrFallback } from "../src/corpus/loader.js";
import { validateCorpus } from "../src/corpus/validate.js";
import { Session } from "../src/engine/session.js";
import { MockProvider } from "../src/llm/mock.js";
import { buildOptions } from "../src/engine/options.js";
import { guard } from "../src/engine/guard.js";
import { applyObservation, evaluate, initialFacts } from "../src/engine/facts.js";
import { buildPacket, escalationToMarkdown, packetToHtml, packetToMarkdown } from "../src/engine/summary.js";
import { buildEscalation, renderDraft } from "../src/engine/escalation.js";
import { guardEscalation } from "../src/engine/guard.js";
import { debriefState, debriefWindow, submitDebrief } from "../src/engine/debrief.js";
import { isEmptyOfficer, removeOfficer, upsertOfficer } from "../src/engine/officers.js";
import { reviewCorpus } from "../src/engine/review.js";
import { SessionStore } from "../src/server/store.js";
import { startRetentionSweep } from "../../shared/lifecycle.js";
import { clientKey, createRateLimiter } from "../../shared/ratelimit.js";
import {
  mintSessionToken,
  requireApiKey,
  requireSession,
  verifySessionToken,
  type AuthConfig,
} from "../../shared/auth.js";
import type { ExtractionResult, LlmProvider } from "../src/llm/provider.js";
import type { GuidanceUpdate, SessionState, TranscriptTurn } from "../src/types.js";

let pass = 0, fail = 0;
const t = (name: string, fn: () => void | Promise<void>) =>
  Promise.resolve()
    .then(fn)
    .then(() => { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); })
    .catch((e) => { fail++; console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${(e as Error).message}`); });

const assert = (c: unknown, m: string) => { if (!c) throw new Error(m); };

const corpus = loadCorpus();

console.log("\ncorpus integrity");
await t("validator reports zero structural errors", () => {
  const errs = validateCorpus().filter((i) => i.level === "error");
  assert(errs.length === 0, `${errs.length} errors: ${errs.map((e) => e.where).join(", ")}`);
});
await t("every scenario yields exactly one safest option", () => {
  for (const id of corpus.scenarios.keys()) {
    const opts = buildOptions(corpus, id, initialFacts(), []);
    const n = opts.filter((o) => o.safest).length;
    assert(n === 1, `${id} produced ${n} safest options`);
  }
});
await t("the fallback cites no provisions", () => {
  assert(corpus.fallback.provisionIds.length === 0, "fallback has provisionIds");
});

console.log("\nfact semantics");
await t('"unknown" never satisfies a predicate', () => {
  const f = initialFacts();
  assert(!evaluate(f, { fact: "keysTaken", op: "eq", value: "unknown" }), "unknown matched eq unknown");
  assert(!evaluate(f, { fact: "keysTaken", op: "neq", value: "yes" }), "unknown matched neq yes");
});
await t("an established fact never regresses to unknown", () => {
  const f = initialFacts();
  applyObservation(f, { fact: "keysTaken", value: "yes", turnIndex: 0, evidence: "x", at: "" });
  applyObservation(f, { fact: "keysTaken", value: "unknown", turnIndex: 1, evidence: "y", at: "" });
  assert(f.keysTaken === "yes", `regressed to ${f.keysTaken}`);
});
await t("gendered option is withheld until the fact is established", () => {
  const f = initialFacts();
  const before = buildOptions(corpus, "search-frisk", f, []);
  assert(!before.some((o) => o.id === "request-female-officer"), "offered without the fact");
  applyObservation(f, { fact: "userIsFemale", value: "yes", turnIndex: 0, evidence: "x", at: "" });
  const after = buildOptions(corpus, "search-frisk", f, []);
  assert(after.some((o) => o.id === "request-female-officer"), "not offered once established");
});

console.log("\noutput guard");
const baseUpdate = (over: Partial<GuidanceUpdate>): GuidanceUpdate => ({
  turnIndex: 0, at: "", changed: true, changeReason: null,
  scenarioId: "keys-taken", scenarioTitle: "x", fallback: false,
  quotableLine: { en: "ok", hi: "ok" }, doNotSay: [], documentNow: "ok",
  options: [], newFlags: [], provisionsCited: [],
  disclaimer: corpus.meta.disclaimer, corpusVersion: corpus.meta.corpusVersion, ...over,
});
await t("catches a section number that is not in the corpus", () => {
  const v = guard(corpus, baseUpdate({ documentNow: "Tell him this violates Section 419B of the Act." }));
  assert(v.some((x) => x.kind === "ungrounded-citation"), "hallucinated section passed the guard");
});
await t("allows a section number that IS in the corpus", () => {
  const v = guard(corpus, baseUpdate({ documentNow: "Detention under s.207 requires those circumstances." }));
  assert(!v.some((x) => x.kind === "ungrounded-citation"), `real section rejected: ${JSON.stringify(v)}`);
});
await t("catches guidance that tells the user to refuse", () => {
  const v = guard(corpus, baseUpdate({ documentNow: "Refuse to hand over anything." }));
  assert(v.some((x) => x.kind === "forbidden-phrase"), "escalating instruction passed");
});
await t("catches an outcome prediction", () => {
  const v = guard(corpus, baseUpdate({ documentNow: "Do this and you will win the case." }));
  assert(v.some((x) => x.kind === "forbidden-phrase"), "outcome prediction passed");
});
await t("catches a missing disclaimer", () => {
  const v = guard(corpus, baseUpdate({ disclaimer: "" }));
  assert(v.some((x) => x.kind === "missing-disclaimer"), "missing disclaimer passed");
});
await t("every real scenario passes its own guard", () => {
  for (const id of corpus.scenarios.keys()) {
    const s = scenarioOrFallback(corpus, id);
    const v = guard(corpus, baseUpdate({
      scenarioId: id, quotableLine: s.quotableLine, doNotSay: s.doNotSay,
      documentNow: s.documentNow, options: buildOptions(corpus, id, initialFacts(), []),
    }));
    assert(v.length === 0, `${id}: ${v.map((x) => `${x.kind} — ${x.detail}`).join(" | ")}`);
  }
});

console.log("\nadversarial provider");
class RogueProvider implements LlmProvider {
  readonly name = "rogue";
  async extract(): Promise<ExtractionResult> {
    return {
      scenarioId: "made-up-scenario-that-does-not-exist",
      confidence: 0.99,
      facts: [
        { fact: "notARealFact" as never, value: "yes", evidence: "invented" },
        { fact: "keysTaken", value: "yes", evidence: "" },
      ],
    };
  }
  async narrate() { return "The officer has committed a crime under Section 999 and you will certainly win."; }
}
await t("a scenario id outside the corpus degrades to the fallback", async () => {
  const s = new Session(new RogueProvider());
  const { update } = await s.ingest("anything");
  assert(update.fallback, `engine accepted "${update.scenarioId}"`);
  assert(update.provisionsCited.length === 0, "fallback cited provisions");
});
await t("a fact key outside the schema is discarded", async () => {
  const s = new Session(new RogueProvider());
  await s.ingest("anything");
  assert(!s.state.observations.some((o) => (o.fact as string) === "notARealFact"), "invented fact was stored");
});
await t("a fact with no supporting quote is discarded", async () => {
  const s = new Session(new RogueProvider());
  await s.ingest("anything");
  assert(!s.state.observations.some((o) => o.fact === "keysTaken"), "unevidenced fact was stored");
});
await t("everything the boundary refused is recorded for audit", async () => {
  const s = new Session(new RogueProvider());
  await s.ingest("anything");
  assert(s.state.rejectedByBoundary.length >= 3, `only ${s.state.rejectedByBoundary.length} rejections logged`);
});

console.log("\nlive session behaviour");
await t("scenario reclassifies as the encounter escalates", async () => {
  const s = new Session(new MockProvider());
  const script: Array<[TranscriptTurn["speaker"], string]> = [
    ["officer", "Licence dikhao. Papers nikalo."],
    ["user", "Sir I have a valid licence but I forgot my licence at home."],
    ["officer", "Chaabi do."],
    ["officer", "2000 rupees cash de do, challan nahi banega."],
    ["officer", "Nahi to thane chalo, station chalo."],
  ];
  for (const [sp, text] of script) await s.ingest(text, sp);
  const seen = s.state.updates.map((u) => u.scenarioId).filter(Boolean);
  assert(new Set(seen).size >= 3, `only saw ${JSON.stringify([...new Set(seen)])}`);
  assert(s.state.currentScenarioId === "come-to-station", `ended on ${s.state.currentScenarioId}`);
});
await t("keys flag fires only once and carries its evidence", async () => {
  const s = new Session(new MockProvider());
  await s.ingest("I have a valid licence", "user");
  await s.ingest("Chaabi do", "officer");
  await s.ingest("He took the keys again", "user");
  const keyFlags = s.state.flags.filter((f) => f.ruleId === "keys-no-legal-basis");
  assert(keyFlags.length === 1, `fired ${keyFlags.length} times`);
  assert((keyFlags[0]?.basis.length ?? 0) >= 2, "flag has no evidence trail");
});
await t("a flag does not fire while its facts are unestablished", async () => {
  const s = new Session(new MockProvider());
  await s.ingest("Chaabi do", "officer"); // keysTaken=yes, licenceHeld still unknown
  assert(!s.state.flags.some((f) => f.ruleId === "keys-no-legal-basis"), "fired on an unestablished fact");
});
await t("an unclassifiable session stays on the fallback with no citations", async () => {
  const s = new Session(new MockProvider());
  await s.ingest("I am not sure what is happening here", "user");
  const u = s.state.updates[0]!;
  assert(u.fallback, "classified something unclassifiable");
  assert(u.provisionsCited.length === 0, "fallback cited law");
  assert(!/section|s\.\d|article/i.test(u.quotableLine?.en ?? ""), "fallback line contains a citation");
});

console.log("\nlawyer packet");
await t("packet builds with timeline, flags, evidence and the unverified warning", async () => {
  const p = new MockProvider();
  const s = new Session(p);
  await s.ingest("I have a valid licence", "user");
  await s.ingest("Chaabi do", "officer");
  await s.ingest("2000 cash de do, challan nahi", "officer");
  const packet = await buildPacket(s.state, p);
  assert(packet.flags.length >= 2, `only ${packet.flags.length} flags`);
  assert(packet.timeline.length >= 3, "timeline too short");
  assert(packet.provisionsSurfaced.length > 0, "no provisions surfaced");
  assert(packet.unverifiedContentWarning !== null, "unverified corpus produced no warning");
  assert(packet.factsEstablished.every((f) => f.evidence.length > 0), "a fact has no evidence");
  const md = packetToMarkdown(packet);
  assert(md.includes("UNVERIFIED CORPUS"), "markdown omits the warning");
  assert(md.includes("Verbatim transcript"), "markdown omits the transcript");
});

/* ------------------------------------------------------------------ */
/* Fact polarity                                                        */
/*                                                                      */
/* Within a fact, the first matching cue wins, so a broad affirmative    */
/* listed before a specific negative silently swallows it. That shipped: */
/* "I am not under arrest" recorded arrestAsserted=yes, and              */
/* "no female officer" recorded femaleOfficerPresent=yes, which made     */
/* female-search-no-female-officer — an UNLAWFUL flag — unable to fire.  */
/*                                                                      */
/* engine/rules.ts guarantees a flag never fires on an *unestablished*   */
/* fact. Nothing downstream can catch an *inverted* one; the rule engine */
/* trusts what extraction hands it. So the guarantee is asserted here.   */
/* ------------------------------------------------------------------ */
console.log("\nfact polarity");

const extractOne = async (text: string, fact: string) => {
  const s = new Session(new MockProvider());
  await s.ingest(text, "user");
  return s.state.observations.find((o) => o.fact === fact)?.value;
};

const POLARITY: Array<[string, string, string]> = [
  // text                                        fact                    expected
  ["He has not said I am under arrest.", "arrestAsserted", "no"],
  ["I am not under arrest.", "arrestAsserted", "no"],
  ["You are under arrest.", "arrestAsserted", "yes"],
  ["उन्होंने गिरफ़्तार नहीं कहा है।", "arrestAsserted", "no"],
  ["He gave no receipt.", "formalChallanOffered", "no"],
  ["He is settling without a receipt.", "formalChallanOffered", "no"],
  ["Here is the challan book.", "formalChallanOffered", "yes"],
  ["चालान नहीं बनेगा।", "formalChallanOffered", "no"],
  ["There is no female officer here.", "femaleOfficerPresent", "no"],
  ["koi mahila nahi hai", "femaleOfficerPresent", "no"],
  ["A female officer is present.", "femaleOfficerPresent", "yes"],
  ["I am wearing a helmet.", "helmetWorn", "yes"],
  ["helmet pehna hai", "helmetWorn", "yes"],
  ["I have no helmet.", "helmetWorn", "no"],
  ["They gave me no notice.", "noticeUnderS35Given", "no"],
  ["Here is the written notice.", "noticeUnderS35Given", "yes"],
  ["The crowd was not peaceful.", "assemblyPeaceful", "no"],
  ["We are sitting quietly, it is peaceful.", "assemblyPeaceful", "yes"],
  ["Nobody was violent.", "assemblyPeaceful", "yes"],
  ["Some of them were violent.", "assemblyPeaceful", "no"],
  // A licence left at home is not the same fact as holding no licence.
  ["I forgot my licence at home.", "licenceCarried", "no"],
  ["लाइसेंस घर पर रह गया।", "licenceCarried", "no"],
  ["I have a valid licence.", "licenceHeld", "yes"],
  ["I don't have a licence at all.", "licenceHeld", "no"],
  // "not wearing a helmet" contains "wearing a helmet" (found by npm run eval).
  ["I am not wearing a helmet today.", "helmetWorn", "no"],
  ["I didn't wear my helmet.", "helmetWorn", "no"],
  ["बिना हेलमेट के", "helmetWorn", "no"],
  ["You are not being arrested.", "arrestAsserted", "no"],
  ["You are being arrested.", "arrestAsserted", "yes"],
  // Latin negation of the arrest cue (previously recorded "yes").
  ["usne giraftar nahi kaha", "arrestAsserted", "no"],
  // groundsGiven: a question is not an answer; only a statement is.
  ["They won't tell me why I am being arrested.", "groundsGiven", "no"],
  ["He arrested me without giving any reason.", "groundsGiven", "no"],
  ["kaaran nahi bata rahe", "groundsGiven", "no"],
  ["You are being arrested for obstruction.", "groundsGiven", "yes"],
  // relativeInformed: a statement beats a request, and the user's own
  // inaction is not the police's.
  ["They are not letting me call my family.", "relativeInformed", "no"],
  ["Nobody has informed my family.", "relativeInformed", "no"],
  ["घर वालों को किसी ने नहीं बताया", "relativeInformed", "no"],
  ["I informed my family.", "relativeInformed", "yes"],
  ["My father has been told.", "relativeInformed", "yes"],
  ["घर पर बता दिया", "relativeInformed", "yes"],
];

// Questions and requests: the fact must stay unestablished. Recording "no"
// here fired an UNLAWFUL flag off a question.
const SHIELDED: Array<[string, string]> = [
  ["Why am I being arrested?", "groundsGiven"],
  ["On what grounds?", "groundsGiven"],
  ["किस आधार पर?", "groundsGiven"],
  ["Let me inform my family.", "relativeInformed"],
  ["Can I call my mother?", "relativeInformed"],
  ["I haven't told my family yet.", "relativeInformed"],
  ["ghar par batana hai", "relativeInformed"],
  ["फ़ोन करने दो", "relativeInformed"],
];

for (const [text, fact] of SHIELDED) {
  await t(`${fact} stays unknown — ${JSON.stringify(text)}`, async () => {
    const got = await extractOne(text, fact);
    assert(got === undefined, `got ${JSON.stringify(got)}`);
  });
}

for (const [text, fact, expected] of POLARITY) {
  await t(`${fact} = ${expected} — ${JSON.stringify(text)}`, async () => {
    const got = await extractOne(text, fact);
    assert(got === expected, `got ${JSON.stringify(got)}`);
  });
}

await t("a suppressed UNLAWFUL flag now fires: search of a woman, no female officer", async () => {
  const s = new Session(new MockProvider());
  await s.ingest("I am a woman and there is no female officer here.", "user");
  await s.ingest("They are searching me now.", "user");
  assert(
    s.state.flags.some((f) => f.ruleId === "female-search-no-female-officer"),
    `flags raised: ${JSON.stringify(s.state.flags.map((f) => f.ruleId))}`,
  );
});

await t("asking for the grounds does not fire arrest-without-grounds", async () => {
  const s = new Session(new MockProvider());
  await s.ingest("You are under arrest.", "officer");
  await s.ingest("Why am I being arrested? Let me inform my family.", "user");
  const ids = s.state.flags.map((f) => f.ruleId);
  assert(!ids.includes("arrest-without-grounds"), `flags raised: ${JSON.stringify(ids)}`);
  assert(!ids.includes("arrest-relative-not-informed"), `flags raised: ${JSON.stringify(ids)}`);
});

await t("an explicit refusal still fires both arrest flags", async () => {
  const s = new Session(new MockProvider());
  await s.ingest("You are under arrest.", "officer");
  await s.ingest("They won't tell me the reason and are not letting me call my family.", "user");
  const ids = s.state.flags.map((f) => f.ruleId);
  assert(ids.includes("arrest-without-grounds"), `flags raised: ${JSON.stringify(ids)}`);
  assert(ids.includes("arrest-relative-not-informed"), `flags raised: ${JSON.stringify(ids)}`);
});

await t("a negated Latin arrest cue does not classify as an arrest", async () => {
  const s = new Session(new MockProvider());
  const r = await s.ingest("usne giraftar nahi kaha, bas thane chalo bola", "user");
  assert(r.update.scenarioId !== "arrest-now", `classified as ${r.update.scenarioId}`);
});

console.log("\nlive provider configuration");

await t("the Anthropic model comes from KAVACH_ANTHROPIC_MODEL, not the code", async () => {
  const { AnthropicProvider, DEFAULT_ANTHROPIC_MODEL } = await import("../src/llm/anthropic.js");
  const before = process.env.KAVACH_ANTHROPIC_MODEL;
  try {
    delete process.env.KAVACH_ANTHROPIC_MODEL;
    assert(new AnthropicProvider("test-key").name === `anthropic:${DEFAULT_ANTHROPIC_MODEL}`, "default not used");
    process.env.KAVACH_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
    assert(new AnthropicProvider("test-key").name === "anthropic:claude-haiku-4-5-20251001", "env not read");
  } finally {
    if (before === undefined) delete process.env.KAVACH_ANTHROPIC_MODEL;
    else process.env.KAVACH_ANTHROPIC_MODEL = before;
  }
});

await t("an unknown provider name is refused, not defaulted", async () => {
  const { makeProviderAsync } = await import("../src/llm/anthropic.js");
  const before = process.env.KAVACH_LLM_PROVIDER;
  process.env.KAVACH_LLM_PROVIDER = "antropic";
  try {
    let threw = false;
    try { await makeProviderAsync(); } catch { threw = true; }
    assert(threw, "a typo fell through to a provider");
  } finally {
    if (before === undefined) delete process.env.KAVACH_LLM_PROVIDER;
    else process.env.KAVACH_LLM_PROVIDER = before;
  }
});

/* ------------------------------------------------------------------ */
/* Script parity                                                        */
/*                                                                      */
/* Speech recognition returns Hindi in Devanagari; the classifier cues   */
/* were romanised Latin only. The same sentence therefore classified     */
/* two different ways, and a Hindi speaker — most of the people this     */
/* product is for — got the fallback on every turn.                     */
/* ------------------------------------------------------------------ */
console.log("\nscript parity");

const classify = async (text: string) => {
  const s = new Session(new MockProvider());
  await s.ingest(text, "officer");
  return s.state.updates[0]!;
};

const PAIRS: Array<[string, string, string]> = [
  ["Licence dikhao. Papers nikalo.", "लाइसेंस दिखाओ। कागज़ात निकालो।", "traffic-no-documents"],
  ["Digital nahi chalega. Chaabi do.", "डिजिटल नहीं चलेगा। चाबी दो।", "keys-taken"],
  [
    "Ab 2000 rupees do aur nikal jao. Challan nahi banega, cash de do.",
    "अब 2000 रुपये दो और निकल जाओ। चालान नहीं बनेगा, नकद दे दो।",
    "cash-demanded",
  ],
  ["Nahi dena hai to thane chalo.", "नहीं देना है तो थाने चलो।", "come-to-station"],
  ["Talashi leni hai, bag kholo.", "तलाशी लेनी है, बैग खोलो।", "search-frisk"],
  ["Phone do, password batao.", "फ़ोन दो, पासवर्ड बताओ।", "phone-demanded"],
];

for (const [latin, deva, expected] of PAIRS) {
  await t(`both scripts reach ${expected}`, async () => {
    const a = await classify(latin);
    const b = await classify(deva);
    assert(a.scenarioId === expected, `latin gave ${a.scenarioId}`);
    assert(b.scenarioId === expected, `devanagari gave ${b.scenarioId}`);
  });
}

await t("Devanagari amounts are extracted, in either digit set", async () => {
  for (const [text, want] of [
    ["अब 2000 रुपये दो।", 2000],
    ["अब २००० रुपये दो।", 2000],
    ["Ab 2000 rupees do.", 2000],
  ] as Array<[string, number]>) {
    const got = await extractOne(text, "amountDemanded");
    assert(got === want, `${JSON.stringify(text)} gave ${JSON.stringify(got)}`);
  }
});

await t("the Hindi escalation reaches the same scenarios and flags as the Latin one", async () => {
  const run = async (file: string) => {
    const fixture = JSON.parse(
      readFileSync(new URL(`../fixtures/transcripts/${file}`, import.meta.url), "utf8"),
    ) as { turns: Array<{ speaker: TranscriptTurn["speaker"]; text: string }> };
    const s = new Session(new MockProvider());
    for (const turn of fixture.turns) await s.ingest(turn.text, turn.speaker);
    return {
      scenarios: [...new Set(s.state.updates.map((u) => u.scenarioId).filter(Boolean))],
      flags: s.state.flags.map((f) => f.ruleId).sort(),
      ended: s.state.currentScenarioId,
    };
  };

  const latin = await run("escalating-traffic-stop.json");
  const hindi = await run("escalating-traffic-stop-hi.json");

  assert(
    JSON.stringify(latin.scenarios) === JSON.stringify(hindi.scenarios),
    `scenarios differ:\n        latin  ${JSON.stringify(latin.scenarios)}\n        hindi  ${JSON.stringify(hindi.scenarios)}`,
  );
  assert(
    JSON.stringify(latin.flags) === JSON.stringify(hindi.flags),
    `flags differ: latin ${JSON.stringify(latin.flags)} vs hindi ${JSON.stringify(hindi.flags)}`,
  );
  assert(hindi.flags.length === 2, `expected 2 flags, got ${JSON.stringify(hindi.flags)}`);
  assert(latin.ended === hindi.ended, `ended on ${latin.ended} vs ${hindi.ended}`);
});

/* ------------------------------------------------------------------ */
/* Session store                                                        */
/*                                                                      */
/* Sessions used to die with the process, taking the lawyer packet with  */
/* them. Persisting them fixes that and creates a different problem: a   */
/* verbatim transcript of a police encounter now sits on disk. So the    */
/* deletion path and the retention sweep are tested as hard as the save  */
/* path — they are what make durability defensible, not extras.          */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Rate limiting. The instance key is one shared secret that does not   */
/* rotate, so guessing at it has to get slower. The harder requirement  */
/* is the other direction: a valid credential must never be refused.    */
/* ------------------------------------------------------------------ */
console.log("\nrate limiting");

await t("a burst is allowed up to capacity, then refused", () => {
  const limiter = createRateLimiter({ capacity: 5, refillPerMinute: 60, now: () => 0 });
  for (let i = 0; i < 5; i++) {
    assert(limiter.take("a").allowed, `request ${i + 1} of the burst was refused`);
  }
  const over = limiter.take("a");
  assert(!over.allowed, "capacity+1 was allowed");
  assert(over.retryAfterSeconds >= 1, "retry-after must be at least a second");
});

await t("tokens come back over time", () => {
  let clock = 0;
  const limiter = createRateLimiter({ capacity: 2, refillPerMinute: 60, now: () => clock });
  limiter.take("a");
  limiter.take("a");
  assert(!limiter.take("a").allowed, "bucket should be empty");

  clock += 1000; // one token per second at 60/min
  assert(limiter.take("a").allowed, "a token never came back");
});

await t("one client's failures do not throttle another", () => {
  const limiter = createRateLimiter({ capacity: 2, refillPerMinute: 1, now: () => 0 });
  limiter.take("attacker");
  limiter.take("attacker");
  assert(!limiter.take("attacker").allowed, "attacker not throttled");
  assert(limiter.take("someone-else").allowed, "an unrelated client was punished");
});

await t("refund returns a token without exceeding capacity", () => {
  const limiter = createRateLimiter({ capacity: 2, refillPerMinute: 0, now: () => 0 });
  limiter.take("a");
  limiter.refund("a");
  limiter.refund("a");
  limiter.refund("a");
  assert(limiter.take("a").allowed, "first");
  assert(limiter.take("a").allowed, "second");
  assert(!limiter.take("a").allowed, "refund pushed the bucket past capacity");
});

await t("the client is identified through the proxy, not as the proxy", () => {
  // Behind Cloudflare Tunnel every request arrives from cloudflared, so the
  // socket address is identical for every user on earth. Limiting on it would
  // throttle all of them as one client and stop no attacker.
  const req = (headers: Record<string, string>, socketAddr = "10.0.0.1") =>
    ({ headers, socket: { remoteAddress: socketAddr } }) as never;

  const is = (actual: string, expected: string, why: string) =>
    assert(actual === expected, `${why}: expected ${expected}, got ${actual}`);

  is(clientKey(req({ "cf-connecting-ip": "203.0.113.9" })), "203.0.113.9", "cf-connecting-ip wins");
  is(
    clientKey(req({ "x-forwarded-for": "203.0.113.9, 70.41.3.18" })),
    "203.0.113.9",
    "left-most x-forwarded-for is the original client",
  );
  is(clientKey(req({})), "10.0.0.1", "falls back to the socket in development");
  is(
    clientKey(req({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "1.2.3.4" })),
    "203.0.113.9",
    "cf-connecting-ip is preferred over a header a client could set",
  );
});

console.log("\nsession store");

const tmpDir = mkdtempSync(path.join(tmpdir(), "kavach-store-"));
const newStore = (retentionDays = 7) =>
  new SessionStore({ enabled: true, dir: mkdtempSync(path.join(tmpDir, "s-")), retentionDays });

const ranSession = async () => {
  const s = new Session(new MockProvider());
  await s.ingest("I have a valid licence", "user");
  await s.ingest("Chaabi do", "officer");
  return s;
};

await t("a session survives being written and read back", async () => {
  const store = newStore();
  const s = await ranSession();
  store.save(s.state);

  const restored = store.loadAll();
  assert(restored.length === 1, `expected 1 session, got ${restored.length}`);
  const back = restored[0]!;
  assert(back.sessionId === s.state.sessionId, "session id changed");
  assert(back.turns.length === 2, `expected 2 turns, got ${back.turns.length}`);
  assert(back.flags.length === s.state.flags.length, "flags lost in the round trip");
});

await t("a restored session still builds its packet", async () => {
  const store = newStore();
  const p = new MockProvider();
  const s = await ranSession();
  store.save(s.state);

  // What the server does on boot: rehydrate rather than start fresh.
  const revived = new Session(p, { state: store.loadAll()[0]! });
  const packet = await buildPacket(revived.state, p);
  assert(packet.transcript.length === 2, "transcript did not survive the restart");
  assert(packet.flags.length > 0, "flags did not survive the restart");
  assert(packet.unverifiedContentWarning !== null, "unverified warning lost");
});

await t("a restored session keeps the corpus version it was recorded under", async () => {
  // PRD R6: every answer records which corpus produced it, so a later
  // correction can identify who received bad guidance. A restore that adopted
  // the current version would silently break that trail.
  const store = newStore();
  const s = await ranSession();
  store.save(s.state);
  const revived = new Session(new MockProvider(), { state: store.loadAll()[0]! });
  assert(
    revived.state.corpusVersion === s.state.corpusVersion,
    `version changed on restore: ${s.state.corpusVersion} -> ${revived.state.corpusVersion}`,
  );
});

await t("deletion is immediate and permanent (PRD R4)", async () => {
  const store = newStore();
  const s = await ranSession();
  store.save(s.state);
  assert(store.loadAll().length === 1, "session was not saved");

  assert(store.remove(s.state.sessionId), "remove reported failure");
  assert(store.loadAll().length === 0, "session survived deletion");
});

await t("deleting something that is not there is not an error", () => {
  const store = newStore();
  store.remove("11111111-2222-3333-4444-555555555555");
  assert(store.loadAll().length === 0, "phantom session appeared");
});

await t("a session id that is not a uuid cannot touch the filesystem", () => {
  // remove() is reachable from a URL path segment. A store that will delete
  // ../../anything because someone asked is not hardening.
  const store = newStore();
  for (const evil of ["../../package", "..", "a/b", "*.json", ""]) {
    assert(!store.remove(evil), `accepted a bad id: ${JSON.stringify(evil)}`);
  }
  // And the same guard on the way in.
  store.save({ ...({} as SessionState), sessionId: "../../escape", startedAt: "" } as SessionState);
  assert(store.loadAll().length === 0, "wrote a file for a non-uuid session id");
});

await t("retention sweeps sessions older than the window, and spares the rest", async () => {
  const store = newStore(7);
  const old = await ranSession();
  const recent = await ranSession();

  // Age is taken from startedAt, so an old encounter rewritten on its last
  // turn still ages from when it happened.
  old.state.startedAt = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  store.save(old.state);
  store.save(recent.state);
  assert(store.loadAll().length === 2, "setup failed");

  const swept = store.sweep();
  assert(swept === 1, `swept ${swept}, expected 1`);
  const left = store.loadAll();
  assert(left.length === 1, `expected 1 left, got ${left.length}`);
  assert(left[0]!.sessionId === recent.state.sessionId, "swept the wrong session");
});

await t("retention keeps sweeping without a restart", async () => {
  // The defect this pins: sweep() ran once before listen() and never again,
  // so a deployment that stayed up -- the whole point of a host that never
  // sleeps -- stopped enforcing retention the moment it finished booting.
  // Everything below happens in one process, with no reboot.
  const store = newStore(7);
  const sweeper = startRetentionSweep({
    label: "test",
    sweep: () => store.sweep(),
    intervalMinutes: 0.002, // 120ms
    log: () => {},
  });

  try {
    // Written *after* the boot sweep has already run, which is exactly the
    // case the old code could never collect.
    const stale = await ranSession();
    stale.state.startedAt = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    store.save(stale.state);
    assert(store.loadAll().length === 1, "setup failed: session not saved");

    await new Promise((r) => setTimeout(r, 400));

    assert(store.loadAll().length === 0, "the timer never swept the stale session");
  } finally {
    sweeper.stop();
  }
});

await t("a sweep that throws does not take the service down", async () => {
  // Retention that is late is recoverable. A process that died trying to
  // enforce it is not, and it takes the live encounters with it.
  const sweeper = startRetentionSweep({
    label: "test",
    sweep: () => { throw new Error("disk on fire"); },
    intervalMinutes: 0.002,
    log: () => {},
  });
  try {
    assert(sweeper.sweptAtBoot === 0, "a failed sweep reported a count");
    await new Promise((r) => setTimeout(r, 200));
  } finally {
    sweeper.stop();
  }
});

await t("a corrupt file is skipped, not fatal", async () => {
  const store = newStore();
  const s = await ranSession();
  store.save(s.state);
  writeFileSync(path.join(store.dir, "99999999-9999-9999-9999-999999999999.json"), "{ not json");
  writeFileSync(path.join(store.dir, "88888888-8888-8888-8888-888888888888.json"), '{"nope":true}');

  const loaded = store.loadAll();
  assert(loaded.length === 1, `expected the one good session, got ${loaded.length}`);
  assert(loaded[0]!.sessionId === s.state.sessionId, "wrong session survived");
});

await t("persistence can be turned off entirely", async () => {
  const store = new SessionStore({ enabled: false, dir: tmpDir });
  const s = await ranSession();
  store.save(s.state);
  assert(store.loadAll().length === 0, "wrote to disk while disabled");
  assert(!store.remove(s.state.sessionId), "reported a deletion while disabled");
});

rmSync(tmpDir, { recursive: true, force: true });

/* ------------------------------------------------------------------ */
/* Auth                                                                 */
/*                                                                      */
/* PRD R1 forbids a login, so authorisation attaches to the session      */
/* rather than to a person. The property that matters is containment: a  */
/* token for one encounter must not open another. Everything else is     */
/* ordinary signature hygiene.                                          */
/* ------------------------------------------------------------------ */
console.log("\nauth");

const authConfig: AuthConfig = {
  enabled: true,
  apiKey: "test-instance-key",
  acceptedApiKeys: ["test-instance-key"],
  sessionSecret: "test-session-secret",
  acceptedSessionSecrets: ["test-session-secret"],
  ttlMs: 60_000,
  source: "env",
};

const SID_A = "3c24bce5-7110-4342-a56d-26f43546089e";
const SID_B = "11111111-2222-3333-4444-555555555555";
const asReq = (token: string | null) =>
  ({ headers: token === null ? {} : { authorization: `Bearer ${token}` } }) as never;

await t("a minted token verifies for its own session", () => {
  const token = mintSessionToken(authConfig, SID_A);
  const check = verifySessionToken(authConfig, token);
  assert(check.ok, `rejected its own token: ${JSON.stringify(check)}`);
  assert(check.ok && check.sessionId === SID_A, "wrong session id came back");
});

await t("a token for one session does not open another", () => {
  // The whole reason these are per-session rather than one shared password.
  const token = mintSessionToken(authConfig, SID_A);
  assert(requireSession(authConfig, asReq(token), SID_A) === null, "own session refused");
  const denied = requireSession(authConfig, asReq(token), SID_B);
  assert(denied !== null, "a token for session A opened session B");
  assert(denied?.status === 403, `expected 403, got ${denied?.status}`);
});

await t("a tampered signature is refused", () => {
  const token = mintSessionToken(authConfig, SID_A);
  const parts = token.split(".");
  parts[3] = `${(parts[3] ?? "").slice(0, -1)}X`;
  const check = verifySessionToken(authConfig, parts.join("."));
  assert(!check.ok && check.reason === "bad-signature", `forgery accepted: ${JSON.stringify(check)}`);
});

await t("a token cannot be re-pointed at another session by editing it", () => {
  // The session id is inside the signed body, not just alongside it.
  const token = mintSessionToken(authConfig, SID_A);
  const parts = token.split(".");
  parts[1] = SID_B;
  const check = verifySessionToken(authConfig, parts.join("."));
  assert(!check.ok, "an edited session id passed verification");
});

await t("the expiry cannot be extended by editing it", () => {
  const token = mintSessionToken(authConfig, SID_A);
  const parts = token.split(".");
  parts[2] = String(Date.now() + 10 * 365 * 24 * 3600 * 1000);
  const check = verifySessionToken(authConfig, parts.join("."));
  assert(!check.ok, "an edited expiry passed verification");
});

await t("an expired token is refused, and says so", () => {
  const token = mintSessionToken(authConfig, SID_A, Date.now() - 120_000);
  const check = verifySessionToken(authConfig, token);
  assert(!check.ok && check.reason === "expired", `expected expired, got ${JSON.stringify(check)}`);
  assert(requireSession(authConfig, asReq(token), SID_A)?.status === 401, "wrong status for expired");
});

await t("a token from a different deployment is refused", () => {
  const other: AuthConfig = { ...authConfig, sessionSecret: "someone-elses-secret" };
  const token = mintSessionToken(other, SID_A);
  assert(!verifySessionToken(authConfig, token).ok, "accepted a token signed with another secret");
});

await t("garbage is refused without throwing", () => {
  for (const junk of ["", "x", "kv1", "kv1.a.b", "a.b.c.d", "kv1..0.", "kv1.a.notanumber.sig"]) {
    const check = verifySessionToken(authConfig, junk);
    assert(!check.ok, `accepted junk: ${JSON.stringify(junk)}`);
  }
});

await t("the instance key guards session creation and the corpus", () => {
  assert(requireApiKey(authConfig, asReq(null))?.status === 401, "no token should be 401");
  assert(requireApiKey(authConfig, asReq("wrong"))?.status === 403, "wrong key should be 403");
  assert(requireApiKey(authConfig, asReq(authConfig.apiKey)) === null, "correct key refused");
});

await t("a session token is not an instance key", () => {
  // Otherwise one encounter's capability would let you enumerate the corpus
  // and open new sessions forever.
  const token = mintSessionToken(authConfig, SID_A);
  assert(requireApiKey(authConfig, asReq(token)) !== null, "a session token acted as the instance key");
});

await t("the instance key still opens any session, for operations", () => {
  assert(requireSession(authConfig, asReq(authConfig.apiKey), SID_B) === null, "ops key locked out");
});

await t("a rotated instance key keeps the old one working", () => {
  // PRD R1 forbids a login, so there is no account to push a new key to.
  // Without an overlap, rotating locks every installed app out at the same
  // instant — and the instant anyone notices is a police stop.
  const rotating: AuthConfig = {
    ...authConfig,
    apiKey: "new-instance-key",
    acceptedApiKeys: ["new-instance-key", "test-instance-key"],
  };
  assert(requireApiKey(rotating, asReq("new-instance-key")) === null, "the new key was refused");
  assert(requireApiKey(rotating, asReq("test-instance-key")) === null, "the retired key was refused mid-rotation");
  assert(requireApiKey(rotating, asReq("never-a-key"))?.status === 403, "an unrelated key was accepted");
});

await t("a retired key stops working once it leaves the list", () => {
  const after: AuthConfig = { ...authConfig, apiKey: "new-instance-key", acceptedApiKeys: ["new-instance-key"] };
  assert(requireApiKey(after, asReq("test-instance-key"))?.status === 403, "the retired key still opens the door");
});

await t("a live session token survives a signing-secret rotation", () => {
  // These live for hours and are held by a phone mid-encounter. Rotating
  // without an overlap stops the audio uploading for everyone at once.
  const before = mintSessionToken(authConfig, SID_A);
  const rotating: AuthConfig = {
    ...authConfig,
    sessionSecret: "new-session-secret",
    acceptedSessionSecrets: ["new-session-secret", "test-session-secret"],
  };
  assert(verifySessionToken(rotating, before).ok, "a token minted before the rotation was refused");
  const after = mintSessionToken(rotating, SID_A);
  assert(verifySessionToken(rotating, after).ok, "a token minted after the rotation was refused");
  // And the new secret alone must not verify the old token, or retiring the
  // old secret would be a no-op.
  const done: AuthConfig = { ...rotating, acceptedSessionSecrets: ["new-session-secret"] };
  assert(!verifySessionToken(done, before).ok, "a retired secret still verified its tokens");
});

await t("disabling auth is total and explicit", () => {
  // KAVACH_AUTH=0 exists so the previous behaviour is reachable deliberately
  // rather than by forgetting to set something.
  const off: AuthConfig = { ...authConfig, enabled: false };
  assert(requireApiKey(off, asReq(null)) === null, "api key still enforced while disabled");
  assert(requireSession(off, asReq(null), SID_A) === null, "session still enforced while disabled");
});

/* ------------------------------------------------------------------ */
/* PRD R12 — language expansion                                         */
/* ------------------------------------------------------------------ */

console.log("\nlanguages (R12)");

await t("every scenario carries a line in every advertised language", () => {
  const codes = corpus.languages.languages.map((l) => l.code);
  for (const [id, sc] of corpus.scenarios) {
    for (const code of codes) {
      const line = sc.quotableLine[code];
      assert(typeof line === "string" && line.trim().length > 0, `${id} has no ${code} line`);
    }
  }
  for (const code of codes) {
    const line = corpus.fallback.quotableLine[code];
    assert(typeof line === "string" && line.trim().length > 0, `fallback has no ${code} line`);
  }
});

await t("no scenario carries a line in a language the registry does not advertise", () => {
  // The reverse of the check above, and the one that actually bites: the app
  // decides which buttons to draw from the registry, so a line for a language
  // that is not in it is content no user can ever reach.
  const codes = new Set(corpus.languages.languages.map((l) => l.code));
  for (const [id, sc] of corpus.scenarios) {
    for (const key of Object.keys(sc.quotableLine)) {
      assert(codes.has(key as never), `${id} has a ${key} line and the registry has no ${key}`);
    }
  }
});

await t("no language claims counsel review inside an unverified corpus", () => {
  for (const [id, sc] of corpus.scenarios) {
    for (const [code, status] of Object.entries(sc.translationStatus ?? {})) {
      assert(
        status !== "counsel-reviewed" || corpus.meta.status === "counsel-signed-off",
        `${id}.${code} claims counsel-reviewed while the corpus is ${corpus.meta.status}`,
      );
    }
  }
});

await t("every scenario is reachable from speech in every script", () => {
  // The defect the Hindi pass found, generalised. Cues in one script only
  // means the scenario is unreachable for everyone who speaks another —
  // silently, on every turn, with no error anywhere.
  const ranges: Record<string, RegExp> = {
    Latin: /[A-Za-z]/, Devanagari: /[\u0900-\u097F]/, Bengali: /[\u0980-\u09FF]/,
    Tamil: /[\u0B80-\u0BFF]/, Telugu: /[\u0C00-\u0C7F]/, Kannada: /[\u0C80-\u0CFF]/,
  };
  const scripts = [...new Set(corpus.languages.languages.map((l) => l.script))];
  for (const [id, sc] of corpus.scenarios) {
    for (const script of scripts) {
      const re = ranges[script];
      assert(re !== undefined, `no range known for script ${script}`);
      assert(sc.classifierCues.some((c) => re!.test(c)), `${id} has no ${script} cue`);
    }
  }
});

await t("classifier cue counts stay balanced across scenarios", () => {
  // Cue count is a thumb on the scale: a cue matched anywhere in history
  // scores, so a scenario with far more cues drifts upward as a session gets
  // longer, whatever was actually said. Adding a language unevenly is how
  // that happens by accident.
  const counts = [...corpus.scenarios.values()].map((s) => s.classifierCues.length);
  const spread = Math.max(...counts) - Math.min(...counts);
  assert(spread <= 8, `cue counts spread by ${spread} (${Math.min(...counts)}–${Math.max(...counts)})`);
});

await t("the guard scans every language, not just the launch pair", () => {
  // A forbidden phrase hidden in the seventh language would otherwise ship.
  const v = guard(corpus, baseUpdate({
    quotableLine: { en: "ok", hi: "ok", ta: "please refuse to comply" },
  }));
  assert(v.some((x) => x.kind === "forbidden-phrase"), "guard ignored a non-launch language");
});

/* ------------------------------------------------------------------ */
/* PRD R11 — officer detail capture                                     */
/* ------------------------------------------------------------------ */

console.log("\nofficer capture (R11)");

const officerSession = () => new Session(new MockProvider(), { corpus }).state;

await t("a partial record is accepted", () => {
  // A person doing this is standing in front of the officer. A form that
  // demands completeness gets abandoned, and the buckle number alone is
  // exactly the record that turns out to matter.
  const st = officerSession();
  const rec = upsertOfficer(st, { buckleNumber: "1234" });
  assert(rec.buckleNumber === "1234", "buckle not stored");
  assert(rec.name === null, "absent field should be null, not empty string");
  assert(st.officers.length === 1, "not appended to the session");
});

await t("an entirely empty submission is refused by the caller's check", () => {
  assert(isEmptyOfficer({ name: "  ", buckleNumber: "" }), "whitespace counted as content");
  assert(!isEmptyOfficer({ station: "MG Road" }), "real content counted as empty");
});

await t("a correction touches only the fields it sends", () => {
  const st = officerSession();
  const rec = upsertOfficer(st, { buckleNumber: "1234", station: "MG Road" });
  upsertOfficer(st, { buckleNumber: "1243" }, rec.id);
  assert(st.officers[0]!.buckleNumber === "1243", "correction not applied");
  assert(st.officers[0]!.station === "MG Road", "an untouched field was blanked");
  assert(st.officers.length === 1, "correction created a second record");
});

await t("officer records are user-sourced and say so", () => {
  const st = officerSession();
  const rec = upsertOfficer(st, { name: "R. Sharma" });
  assert(rec.source === "user", "source is not marked user");
});

await t("a record can be removed", () => {
  const st = officerSession();
  const rec = upsertOfficer(st, { buckleNumber: "1" });
  assert(removeOfficer(st, rec.id), "remove returned false");
  assert(st.officers.length === 0, "record survived removal");
  assert(!removeOfficer(st, rec.id), "removing twice reported success");
});

await t("officer details reach the packet, labelled as entered", async () => {
  const s = new Session(new MockProvider(), { corpus });
  await s.ingest("Show me your licence", "officer");
  upsertOfficer(s.state, { buckleNumber: "4417", name: "K. Rao" });
  const packet = await buildPacket(s.state, new MockProvider());
  assert(packet.officers.length === 1, "officer missing from packet");
  const md = packetToMarkdown(packet);
  assert(md.includes("4417"), "buckle number not rendered");
  assert(md.includes("Nothing in this section is inferred"), "provenance not stated");
});

await t("an empty officer section says nobody entered one, not that none exists", async () => {
  const s = new Session(new MockProvider(), { corpus });
  await s.ingest("Show me your licence", "officer");
  const md = packetToMarkdown(await buildPacket(s.state, new MockProvider()));
  assert(md.includes("did not enter one"), "empty section is ambiguous");
});

/* ------------------------------------------------------------------ */
/* PRD R9 — escalation guidance                                         */
/* ------------------------------------------------------------------ */

console.log("\nescalation (R9)");

const escalated = async () => {
  const s = new Session(new MockProvider(), { corpus });
  await s.ingest("Give me two thousand rupees and I will let you go", "officer");
  await s.ingest("No receipt, just cash", "officer");
  return s;
};

await t("a matched scenario brings its route to the front", async () => {
  const s = await escalated();
  const g = buildEscalation(corpus, s.state);
  assert(g.options.length > 0, "no routes offered");
  assert(g.options[0]!.route.id === "bribe-demand", `first route was ${g.options[0]!.route.id}`);
});

await t("a universal route is always offered", () => {
  const st = new Session(new MockProvider(), { corpus }).state;
  const g = buildEscalation(corpus, st);
  assert(g.options.length > 0, "a session that matched nothing was offered nothing");
  assert(g.options.every((o) => o.route.appliesToScenarioIds.length === 0), "a specific route matched an empty session");
});

await t("the draft never contains an unfilled token", async () => {
  const s = await escalated();
  const g = buildEscalation(corpus, s.state);
  for (const o of g.options) {
    assert(!/\{\{[a-zA-Z]+\}\}/.test(o.draft), `${o.route.id} left a raw placeholder in the draft`);
  }
});

await t("what the engine cannot fill is reported, not invented", async () => {
  const s = await escalated();
  const g = buildEscalation(corpus, s.state);
  for (const o of g.options) {
    // The user's own name and their account of what happened are structurally
    // unfillable. If either ever stops being reported as unfilled, something
    // has started composing on their behalf.
    assert(o.unfilled.includes("complainantName"), `${o.route.id} claims to know the complainant's name`);
    assert(o.unfilled.includes("whatHappened"), `${o.route.id} filled in an account of the incident`);
  }
});

await t("officer details flow into the draft", async () => {
  const s = await escalated();
  upsertOfficer(s.state, { buckleNumber: "9021", station: "Ashok Nagar" });
  const g = buildEscalation(corpus, s.state);
  const draft = g.options[0]!.draft;
  assert(draft.includes("9021"), "buckle number not substituted");
  assert(draft.includes("Ashok Nagar"), "station not substituted");
  assert(!g.options[0]!.unfilled.includes("officerBuckle"), "a filled token still reported unfilled");
});

await t("a second officer is carried into the draft rather than dropped", async () => {
  const s = await escalated();
  upsertOfficer(s.state, { buckleNumber: "9021" });
  upsertOfficer(s.state, { buckleNumber: "9022", name: "S. Iyer" });
  const draft = buildEscalation(corpus, s.state).options[0]!.draft;
  assert(draft.includes("9022") || draft.includes("S. Iyer"), "the second officer vanished from the draft");
});

await t("every route in the corpus passes the output guard", () => {
  // The same three checks live guidance gets. A section number invented in a
  // complaint letter is wrong in exactly the same way as one said aloud.
  const st = new Session(new MockProvider(), { corpus }).state;
  const g = buildEscalation(corpus, st);
  const all = { ...g, options: corpus.escalation.routes.map((route) => ({
    route, because: [], draft: route.draftTemplate, unfilled: [], provisions: [],
  })) };
  const checked = guardEscalation(corpus, all);
  assert(checked.withheld.length === 0, `withheld: ${checked.withheld.map((w) => `${w.routeId} (${w.violations.map((v) => v.detail).join("; ")})`).join(", ")}`);
});

await t("a route with an invented citation is withheld, and named", () => {
  const st = new Session(new MockProvider(), { corpus }).state;
  const g = buildEscalation(corpus, st);
  const poisoned = {
    ...g,
    options: [
      { ...g.options[0]!, draft: "You are entitled to relief under section 999 of the Act." },
      g.options[1]!,
    ].filter(Boolean),
  };
  const checked = guardEscalation(corpus, poisoned);
  assert(checked.withheld.length === 1, `expected one withheld route, got ${checked.withheld.length}`);
  assert(checked.withheld[0]!.routeId === g.options[0]!.route.id, "the wrong route was withheld");
  assert(checked.kept.every((o) => !o.draft.includes("999")), "the poisoned draft survived");
});

await t("renderDraft leaves a visible blank, never an empty string", () => {
  const { draft, unfilled } = renderDraft("Name: {{complainantName}}.", new Map());
  assert(unfilled.includes("complainantName"), "not reported unfilled");
  assert(/_{4,}/.test(draft), `no visible blank in: ${draft}`);
});

await t("escalation renders to markdown with the unverified warning first", async () => {
  const s = await escalated();
  const md = escalationToMarkdown(buildEscalation(corpus, s.state));
  assert(md.includes("UNVERIFIED CORPUS"), "no unverified banner");
  assert(md.indexOf("UNVERIFIED CORPUS") < md.indexOf("Who hears it"), "banner is below the content");
});

/* ------------------------------------------------------------------ */
/* PRD R13 — post-incident debrief                                      */
/* ------------------------------------------------------------------ */

console.log("\ndebrief (R13)");

await t("the window opens with the session and closes 24 hours later", () => {
  const st = new Session(new MockProvider(), { corpus }).state;
  st.startedAt = new Date("2026-09-01T10:00:00Z").toISOString();
  const w = debriefWindow(corpus, st, new Date("2026-09-01T22:00:00Z"));
  assert(w.open, "window closed 12 hours in");
  assert(Math.round(w.hoursRemaining) === 12, `hoursRemaining was ${w.hoursRemaining}`);
  const later = debriefWindow(corpus, st, new Date("2026-09-03T10:00:00Z"));
  assert(!later.open, "window still open two days later");
  assert(later.hoursRemaining === 0, "negative hours reported");
});

await t("a late answer is kept and marked, not discarded", () => {
  // Dropping it would throw away the only account of an encounter to protect
  // a property of the account. The date stamp already carries that warning.
  const st = new Session(new MockProvider(), { corpus }).state;
  st.startedAt = new Date("2026-09-01T10:00:00Z").toISOString();
  submitDebrief(corpus, st, { answers: { paperwork: "challan 4471" } }, new Date("2026-09-05T10:00:00Z"));
  assert(st.debrief.length === 1, "the answer was dropped");
  assert(st.debrief[0]!.afterWindow, "a late answer was not marked");
});

await t("an unknown question id is rejected, never stored", () => {
  const st = new Session(new MockProvider(), { corpus }).state;
  const r = submitDebrief(corpus, st, { answers: { "not-a-question": "arbitrary text" } });
  assert(r.rejected.includes("not-a-question"), "not reported as rejected");
  assert(st.debrief.length === 0, "arbitrary text reached a document a lawyer reads");
});

await t("an emptied answer is a retraction", () => {
  const st = new Session(new MockProvider(), { corpus }).state;
  submitDebrief(corpus, st, { answers: { paperwork: "challan 4471" } });
  submitDebrief(corpus, st, { answers: { paperwork: "  " } });
  assert(st.debrief.length === 0, "the retracted answer survived");
});

await t("answering the same question twice replaces rather than appends", () => {
  const st = new Session(new MockProvider(), { corpus }).state;
  submitDebrief(corpus, st, { answers: { paperwork: "first" } });
  submitDebrief(corpus, st, { answers: { paperwork: "second" } });
  assert(st.debrief.length === 1, `${st.debrief.length} answers for one question`);
  assert(st.debrief[0]!.value === "second", "the correction was not applied");
});

await t("completeness ignores optional questions", () => {
  const st = new Session(new MockProvider(), { corpus }).state;
  const required = corpus.debrief.questions.filter((q) => !q.optional);
  const answers: Record<string, string> = {};
  for (const q of required) answers[q.id] = "x";
  submitDebrief(corpus, st, { answers });
  assert(debriefState(corpus, st).complete, "still incomplete with every required answer given");
});

await t("exactly one question carries the accuracy signal", () => {
  // PRD R6's "did this match what happened?" metric has one collection point.
  // Two would double-count it; none would leave the metric unmeasurable.
  const n = corpus.debrief.questions.filter((q) => q.accuracySignal).length;
  assert(n === 1, `${n} accuracy questions`);
});

await t("debrief answers reach the packet with their prompts", async () => {
  const s = new Session(new MockProvider(), { corpus });
  await s.ingest("Show me your licence", "officer");
  submitDebrief(corpus, s.state, { answers: { paperwork: "challan 4471" } });
  const md = packetToMarkdown(await buildPacket(s.state, new MockProvider()));
  assert(md.includes("challan 4471"), "answer missing from packet");
  assert(md.includes("What paper"), "prompt missing — the answer alone is not a record");
});

/* ------------------------------------------------------------------ */
/* PRD R8 — packet completion                                           */
/* ------------------------------------------------------------------ */

console.log("\npacket completion (R8)");

const withSupplement = async () => {
  const s = new Session(new MockProvider(), { corpus });
  await s.ingest("Show me your licence", "officer");
  return buildPacket(s.state, new MockProvider(), {
    locationTrail: [{ at: "2026-09-01T10:00:05Z", latitude: 21.7645, longitude: 72.1519, seq: 0 }],
    mediaBundle: {
      serviceLabel: "kavach-evidence",
      chunks: [{ seq: 0, receivedAt: "2026-09-01T10:00:12Z", capturedAt: "2026-09-01T10:00:02Z", sha256: "abc123", bytes: 81234, mime: "audio/m4a" }],
      totalBytes: 81234,
      firstReceivedAt: "2026-09-01T10:00:12Z",
      lastReceivedAt: "2026-09-01T10:00:12Z",
    },
  });
};

await t("not supplied and none held read differently", async () => {
  const s = new Session(new MockProvider(), { corpus });
  await s.ingest("Show me your licence", "officer");
  const bare = packetToMarkdown(await buildPacket(s.state, new MockProvider()));
  assert(bare.includes("Not supplied"), "an absent trail read as an empty one");

  const empty = packetToMarkdown(
    await buildPacket(s.state, new MockProvider(), { locationTrail: [], mediaBundle: { serviceLabel: "x", chunks: [], totalBytes: 0, firstReceivedAt: null, lastReceivedAt: null } }),
  );
  assert(empty.includes("Supplied, and empty"), "an empty trail read as an absent one");
});

await t("the location trail and media manifest render", async () => {
  const md = packetToMarkdown(await withSupplement());
  assert(md.includes("21.764500"), "latitude missing");
  assert(md.includes("abc123"), "content hash missing");
  assert(md.includes("not one continuous recording"), "the rotation gap was not disclosed");
});

await t("the packet renders as self-contained print HTML", async () => {
  const html = packetToHtml(await withSupplement());
  assert(html.startsWith("<!doctype html>"), "not a document");
  assert(html.includes("@page"), "no print geometry");
  assert(!/<(script|iframe)\b/i.test(html), "the packet loads executable content");
  assert(!/(src|href)=["']https?:/i.test(html), "the packet fetches something over the network");
});

await t("HTML output escapes transcript text rather than rendering it", async () => {
  const s = new Session(new MockProvider(), { corpus });
  await s.ingest("<img src=x onerror=alert(1)> show me your licence", "officer");
  const html = packetToHtml(await buildPacket(s.state, new MockProvider()));
  assert(!html.includes("<img src=x"), "transcript text was rendered as markup");
  assert(html.includes("&lt;img"), "transcript text was dropped instead of escaped");
});

await t("Devanagari and Tamil survive into the HTML unmangled", async () => {
  const s = new Session(new MockProvider(), { corpus });
  await s.ingest("चाबी दो, वरना गाड़ी नहीं जाएगी", "officer");
  const html = packetToHtml(await buildPacket(s.state, new MockProvider()));
  assert(html.includes("चाबी"), "Devanagari lost from the transcript");
  assert(html.includes("<html lang=\"en\">") && html.includes('charset="utf-8"'), "no encoding declared");
});

/* ------------------------------------------------------------------ */
/* PRD R6 — corpus review state                                         */
/* ------------------------------------------------------------------ */

console.log("\ncorpus review (R6)");

await t("never reviewed counts as overdue, not as exempt", () => {
  // The inversion worth guarding: if null meant "no deadline", the least
  // reviewed content in the system would be the only content never flagged.
  const r = reviewCorpus(corpus);
  assert(r.neverReviewed > 0, "fixture expects an unreviewed corpus");
  assert(r.overdue.length >= r.neverReviewed, "an unreviewed item escaped the overdue list");
});

await t("a future review date is neither overdue nor due soon", () => {
  const future = new Date(Date.now() + 200 * 24 * 60 * 60 * 1000).toISOString();
  const patched = {
    ...corpus,
    provisions: new Map([["X", { ...corpus.provisions.values().next().value!, id: "X", verification: { status: "counsel-signed-off" as const, advocate: "A", signedOffAt: "2026-01-01", reviewDueAt: future } } ]]),
    scenarios: new Map(),
    rules: [],
    escalation: { routes: [], placeholders: [] },
    fallback: { ...corpus.fallback, verification: { ...corpus.fallback.verification, reviewDueAt: future, status: "counsel-signed-off" as const } },
  };
  const r = reviewCorpus(patched);
  assert(r.overdue.length === 0, "a future date was reported overdue");
  assert(r.dueSoon.length === 0, "200 days out was reported due soon");
});

await t("a date inside 30 days is due soon", () => {
  const soon = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
  const patched = {
    ...corpus,
    provisions: new Map([["X", { ...corpus.provisions.values().next().value!, id: "X", verification: { status: "counsel-signed-off" as const, advocate: "A", signedOffAt: "2026-01-01", reviewDueAt: soon } } ]]),
    scenarios: new Map(),
    rules: [],
    escalation: { routes: [], placeholders: [] },
    fallback: { ...corpus.fallback, verification: { ...corpus.fallback.verification, reviewDueAt: soon, status: "counsel-signed-off" as const } },
  };
  const r = reviewCorpus(patched);
  assert(r.dueSoon.length === 2, `expected both items due soon, got ${r.dueSoon.length}`);
});

await t("the review state travels with the packet", async () => {
  const s = new Session(new MockProvider(), { corpus });
  await s.ingest("Show me your licence", "officer");
  const p = await buildPacket(s.state, new MockProvider());
  assert(p.corpusReview.total > 0, "no review state in the packet");
  assert(packetToMarkdown(p).includes("overdue for review"), "review state not rendered");
});

/* ------------------------------------------------------------------ */
/* Restored sessions                                                    */
/* ------------------------------------------------------------------ */

console.log("\nrestored sessions");

await t("a session persisted before these fields existed still opens", async () => {
  // The failure this prevents lands at the worst moment: someone opening the
  // packet after the encounter, on a session written by an older build.
  const s = new Session(new MockProvider(), { corpus });
  await s.ingest("Show me your licence", "officer");
  const legacy = JSON.parse(JSON.stringify(s.state)) as Record<string, unknown>;
  delete legacy["officers"];
  delete legacy["debrief"];

  const restored = new Session(new MockProvider(), { corpus, state: legacy as unknown as SessionState });
  assert(Array.isArray(restored.state.officers), "officers did not default");
  assert(Array.isArray(restored.state.debrief), "debrief did not default");
  const p = await buildPacket(restored.state, new MockProvider());
  assert(p.officers.length === 0, "packet build threw or invented officers");
  assert(typeof packetToMarkdown(p) === "string", "packet did not render");
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
