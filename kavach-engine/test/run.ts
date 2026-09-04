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
import { buildPacket, packetToMarkdown } from "../src/engine/summary.js";
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
  // A licence left at home is not the same fact as holding no licence.
  ["I forgot my licence at home.", "licenceCarried", "no"],
  ["लाइसेंस घर पर रह गया।", "licenceCarried", "no"],
  ["I have a valid licence.", "licenceHeld", "yes"],
  ["I don't have a licence at all.", "licenceHeld", "no"],
];

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
  sessionSecret: "test-session-secret",
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

await t("disabling auth is total and explicit", () => {
  // KAVACH_AUTH=0 exists so the previous behaviour is reachable deliberately
  // rather than by forgetting to set something.
  const off: AuthConfig = { ...authConfig, enabled: false };
  assert(requireApiKey(off, asReq(null)) === null, "api key still enforced while disabled");
  assert(requireSession(off, asReq(null), SID_A) === null, "session still enforced while disabled");
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
