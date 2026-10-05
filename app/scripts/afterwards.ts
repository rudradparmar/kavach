/**
 * The half of the product that happens after the encounter ends.
 *
 * PRD R11 (officer details), R9 (escalation guidance), R13 (post-incident
 * debrief) and the parts of R8 the packet was missing — the location trail
 * and the media bundle. All four are things a person does once the phone is
 * back in their pocket, and all four were previously unbuilt and untestable
 * without a handset.
 *
 * This drives the app's own client modules against live services, so a break
 * in the request shape or the response parsing shows up here rather than on a
 * device.
 *
 *   cd kavach-engine   && npm run dev     # :8787
 *   cd evidence-service && npm run dev    # :8789   (optional but exercised)
 *   cd app && npm run afterwards
 */

import { createHash } from "node:crypto";
import {
  buildPacketJson,
  createSession,
  deleteOfficer,
  deleteSession,
  getDebrief,
  getEscalation,
  getHealth,
  getPacketHtml,
  saveOfficer,
  sendTurn,
  submitDebriefAnswers,
} from "../src/api/client";
import type { LocationFix, MediaBundle, PacketSupplement } from "../src/api/types";
import { defaultEvidenceUrl, getManifest, getTrail, uploadChunk } from "../src/evidence/client";
import { apiKey } from "./creds";

const BASE = process.argv[2] ?? "http://localhost:8787";
const KEY = apiKey();
const EVIDENCE = defaultEvidenceUrl(BASE);

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

let pass = 0;
let fail = 0;
const group = (n: string) => console.log(`\n${bold(n)}`);

async function t(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    pass += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (e) {
    fail += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${(e as Error).message}`);
  }
}

function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}

async function main(): Promise<void> {
  const health = await getHealth(BASE);
  console.log(
    `\n${bold("engine")}  ${BASE}  corpus=${health.corpusVersion} (${health.corpusStatus})` +
      `  languages=${(health.languages ?? []).join(",")}`,
  );
  if (health.corpusReview) {
    console.log(
      dim(
        `  corpus review: ${health.corpusReview.overdue}/${health.corpusReview.total} overdue, ` +
          `${health.corpusReview.neverReviewed} never reviewed`,
      ),
    );
  }

  const { sessionId, sessionToken } = await createSession(BASE, KEY);
  console.log(dim(`session ${sessionId}`));

  // An encounter with something to escalate about: cash asked for, no receipt.
  for (const line of [
    "Show me your licence and registration",
    "Give me two thousand rupees and I will let you go",
    "No receipt, just cash, and I will keep the keys until you pay",
  ]) {
    await sendTurn(BASE, sessionId, line, "officer", sessionToken);
  }

  /* --- officer details (R11) -------------------------------------- */
  group("officer details (R11)");

  let officerId = "";

  await t("a partial record saves", async () => {
    const r = await saveOfficer(BASE, sessionId, { buckleNumber: "4417" }, sessionToken);
    officerId = r.officer.id;
    assert(r.officer.buckleNumber === "4417", "buckle not stored");
    assert(r.officer.name === null, "an absent field came back as something other than null");
    assert(r.officer.source === "user", "the record does not say it was user-entered");
  });

  await t("a correction leaves untouched fields alone", async () => {
    await saveOfficer(BASE, sessionId, { id: officerId, station: "Ashok Nagar" }, sessionToken);
    const r = await saveOfficer(BASE, sessionId, { id: officerId, buckleNumber: "4418" }, sessionToken);
    assert(r.officer.buckleNumber === "4418", "correction not applied");
    assert(r.officer.station === "Ashok Nagar", "an untouched field was blanked");
    assert(r.officers.length === 1, "a correction created a second record");
  });

  await t("a second officer is a second record", async () => {
    const r = await saveOfficer(BASE, sessionId, { name: "S. Iyer", rank: "Sub-Inspector" }, sessionToken);
    assert(r.officers.length === 2, `expected two officers, got ${r.officers.length}`);
    await deleteOfficer(BASE, sessionId, r.officer.id, sessionToken);
  });

  await t("an empty submission is refused rather than stored", async () => {
    let refused = false;
    try {
      await saveOfficer(BASE, sessionId, { name: "   " }, sessionToken);
    } catch {
      refused = true;
    }
    assert(refused, "a row of blanks was accepted into a lawyer's packet");
  });

  /* --- escalation (R9) --------------------------------------------- */
  group("escalation guidance (R9)");

  const esc = await getEscalation(BASE, sessionId, sessionToken, "Asia/Kolkata");

  await t("the matched route comes first", () => {
    assert(esc.guidance.options.length > 0, "no routes offered");
    const first = esc.guidance.options[0]!;
    assert(first.route.id === "bribe-demand", `first route was ${first.route.id}`);
    console.log(dim(`      ${esc.guidance.options.map((o) => o.route.id).join(" → ")}`));
  });

  await t("no route was withheld by the output guard", () => {
    assert(
      esc.withheld.length === 0,
      `withheld: ${esc.withheld.map((w) => `${w.routeId} (${w.violations.map((v) => v.kind).join(",")})`).join("; ")}`,
    );
  });

  await t("no draft leaves a raw placeholder on screen", () => {
    for (const o of esc.guidance.options) {
      assert(!/\{\{[a-zA-Z]+\}\}/.test(o.draft), `${o.route.id} rendered a raw token`);
    }
  });

  await t("the officer details reached the draft", () => {
    const draft = esc.guidance.options[0]!.draft;
    assert(draft.includes("4418"), "buckle number missing from the draft");
    assert(draft.includes("Ashok Nagar"), "station missing from the draft");
  });

  await t("what only the user can write is reported as blank, not invented", () => {
    for (const o of esc.guidance.options) {
      assert(o.unfilled.includes("whatHappened"), `${o.route.id} composed an account of the incident`);
      assert(o.unfilled.includes("complainantName"), `${o.route.id} claims to know the complainant`);
    }
  });

  await t("the draft is dated in the requested zone, not in UTC", () => {
    // A complaint letter dated in UTC is simply the wrong date for half of
    // every Indian evening.
    const expected = new Intl.DateTimeFormat("en-IN", { dateStyle: "long", timeZone: "Asia/Kolkata" }).format(
      new Date(),
    );
    assert(esc.guidance.options[0]!.draft.includes(expected), `expected the draft to carry "${expected}"`);
  });

  /* --- debrief (R13) ----------------------------------------------- */
  group("post-incident debrief (R13)");

  await t("the window is open and counted in hours", async () => {
    const d = await getDebrief(BASE, sessionId, sessionToken);
    assert(d.window.open, "the window was closed on a session that just started");
    assert(d.window.hoursRemaining > 23, `hoursRemaining was ${d.window.hoursRemaining}`);
    assert(d.questions.length > 0, "no questions");
  });

  await t("answers are stored and come back with the questions", async () => {
    const d = await submitDebriefAnswers(
      BASE,
      sessionId,
      { paperwork: "no challan issued", outcome: "Money paid" },
      sessionToken,
    );
    assert(d.answers.length === 2, `expected two answers, got ${d.answers.length}`);
    assert(d.answers.every((a) => !a.afterWindow), "a fresh answer was marked late");
  });

  await t("an invented question id is rejected, never stored", async () => {
    const d = await submitDebriefAnswers(BASE, sessionId, { "made-up": "arbitrary" }, sessionToken);
    assert(d.rejected?.includes("made-up"), "not reported as rejected");
    assert(!d.answers.some((a) => a.questionId === "made-up"), "arbitrary text entered the packet");
  });

  await t("an emptied answer is a retraction", async () => {
    const d = await submitDebriefAnswers(BASE, sessionId, { paperwork: "" }, sessionToken);
    assert(!d.answers.some((a) => a.questionId === "paperwork"), "the retracted answer survived");
  });

  /* --- packet completion (R8) --------------------------------------- */
  group("packet completion (R8)");

  // Two chunks with position fixes, so the trail and the manifest are real
  // rather than mocked. The evidence service is optional; when it is not
  // running the packet must still build and must say the sections were not
  // supplied rather than that nothing exists.
  let supplement: PacketSupplement = {};
  let evidenceUp = true;
  try {
    for (const [i, coords] of [
      [21.7645, 72.1519],
      [21.7648, 72.1523],
    ].entries()) {
      const body = new Uint8Array(2048).fill(i + 1);
      await uploadChunk(
        EVIDENCE,
        sessionId,
        i,
        body,
        {
          capturedAt: new Date().toISOString(),
          mime: "audio/m4a",
          latitude: coords[0]!,
          longitude: coords[1]!,
        },
        sessionToken,
      );
    }
  } catch {
    evidenceUp = false;
    console.log(dim("      evidence service unreachable — checking the not-supplied path instead"));
  }

  if (evidenceUp) {
    await t("the trail comes back with a fix per chunk", async () => {
      const trail = await getTrail(EVIDENCE, sessionId, sessionToken);
      assert(trail.length === 2, `expected two fixes, got ${trail.length}`);
      assert(Math.abs(trail[0]!.latitude - 21.7645) < 1e-6, "latitude changed in transit");
      supplement.locationTrail = trail.map(
        (f): LocationFix => ({ at: f.at, latitude: f.latitude, longitude: f.longitude, seq: f.seq }),
      );
    });

    await t("the manifest hashes what actually arrived", async () => {
      const m = await getManifest(EVIDENCE, sessionId, sessionToken);
      assert(m !== null, "no manifest");
      const expected = createHash("sha256").update(new Uint8Array(2048).fill(1)).digest("hex");
      assert(m.chunks[0]!.sha256 === expected, "the hash is not over the bytes that arrived");
      const bundle: MediaBundle = {
        serviceLabel: "the Kavach evidence service",
        chunks: m.chunks.map((c) => ({
          seq: c.seq,
          receivedAt: c.receivedAt,
          capturedAt: c.capturedAt ?? null,
          sha256: c.sha256,
          bytes: c.bytes,
          mime: c.mime ?? "audio/m4a",
        })),
        totalBytes: m.totalBytes,
        firstReceivedAt: m.firstReceivedAt,
        lastReceivedAt: m.lastReceivedAt,
      };
      supplement.mediaBundle = bundle;
    });
  }

  await t("a packet built with no supplement says 'not supplied'", async () => {
    const p = await buildPacketJson(BASE, sessionId, {}, sessionToken);
    assert(p.locationTrail === null, "an unsupplied trail came back as an empty one");
    assert(p.mediaBundle === null, "an unsupplied bundle came back as an empty one");
  });

  await t("the supplied trail, officers and debrief all reach the packet", async () => {
    const p = await buildPacketJson(BASE, sessionId, supplement, sessionToken);
    assert(p.officers.length === 1, `expected one officer, got ${p.officers.length}`);
    assert(p.debrief.length >= 1, "the debrief answers are missing");
    assert(p.corpusReview.total > 0, "no corpus review state");
    if (evidenceUp) {
      assert(p.locationTrail?.length === 2, "the trail did not survive the round trip");
      assert(p.mediaBundle?.chunks.length === 2, "the media bundle did not survive the round trip");
    }
  });

  await t("the PDF source is self-contained and fetches nothing", async () => {
    const html = await getPacketHtml(BASE, sessionId, supplement, sessionToken);
    assert(html.startsWith("<!doctype html>"), "not a document");
    assert(!/<(script|iframe)\b/i.test(html), "the packet loads executable content");
    assert(!/(src|href)=["']https?:/i.test(html), "the packet fetches something over the network");
    assert(html.includes("@page"), "no print geometry — this is what makes it a page rather than a scroll");
    assert(html.includes("4418"), "the officer details are missing from the printable packet");
  });

  await deleteSession(BASE, sessionId, sessionToken);
  console.log(dim(`\nsession ${sessionId} deleted`));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`\n\x1b[31m${(e as Error).message}\x1b[0m\n`);
  process.exit(1);
});
