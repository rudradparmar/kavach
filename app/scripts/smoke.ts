/**
 * Drives the app's own API client against a running engine and prints what
 * each screen would render.
 *
 * The point is to be able to check the client contract without a phone in
 * hand. It imports src/api/client.ts directly — the same code the app runs —
 * so a break in the request shape, the response parsing, or the flag
 * accumulation shows up here rather than on a device.
 *
 *   cd kavach-engine && npm run dev
 *   cd app && npm run smoke
 *   npm run smoke -- http://192.168.1.8:8787 ../kavach-engine/fixtures/transcripts/protest-force.json
 */

import { readFileSync } from "node:fs";
import {
  createSession,
  deleteSession,
  getHealth,
  getPacketJson,
  getPacketMarkdown,
  sendTurn,
} from "../src/api/client";
import type { RaisedFlag, Speaker } from "../src/api/types";
import { apiKey } from "./creds";

const KEY = apiKey();

const BASE = process.argv[2] ?? "http://localhost:8787";
const FIXTURE =
  process.argv[3] ?? "../kavach-engine/fixtures/transcripts/escalating-traffic-stop.json";

interface Fixture {
  name?: string;
  description?: string;
  turns: Array<{ speaker: Speaker; text: string }>;
}

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

const severityColour = { unlawful: red, irregular: yellow, info: dim } as const;

async function main() {
  const health = await getHealth(BASE);
  console.log(
    `\n${bold("engine")}  ${BASE}  provider=${health.provider}  corpus=${health.corpusVersion} (${health.corpusStatus})`,
  );
  if (health.corpusStatus !== "counsel-signed-off") {
    console.log(yellow("  UNVERIFIED banner will render — this is correct.\n"));
  }

  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as Fixture;
  const { sessionId, sessionToken } = await createSession(BASE, KEY);
  console.log(dim(`session ${sessionId}\n`));

  // The app accumulates flags itself, because the engine only reports what is
  // new on each turn. This mirrors that logic exactly.
  const accumulated: RaisedFlag[] = [];
  const seen = new Set<string>();
  let guardTrips = 0;

  for (const [i, turn] of fixture.turns.entries()) {
    const { update, violations, latencyMs } = await sendTurn(
      BASE,
      sessionId,
      turn.text,
      turn.speaker,
      sessionToken,
    );

    for (const f of update.newFlags) {
      if (!seen.has(f.ruleId)) {
        seen.add(f.ruleId);
        accumulated.push(f);
      }
    }
    guardTrips += violations.length > 0 ? 1 : 0;

    console.log(`${bold(`[${i}] ${turn.speaker}`)}: ${turn.text}`);
    console.log(dim(`    ${latencyMs}ms · ${update.changeReason ?? "no change"}`));

    if (update.fallback) {
      console.log(`  ${yellow("FALLBACK")} — not confidently identified, no provisions cited`);
    } else {
      console.log(`  ${green("SCENARIO")} ${update.scenarioTitle}`);
    }

    // What FlagList would draw: everything raised so far, newest first.
    for (const [j, f] of [...accumulated].sort((a, b) => b.raisedAtTurn - a.raisedAtTurn).entries()) {
      const paint = severityColour[f.severity] ?? dim;
      const mark = j === 0 ? "▶" : " ";
      console.log(`  ${mark} ${paint(f.severity.toUpperCase())} ${dim(f.ruleId)}`);
    }

    if (update.quotableLine) {
      console.log(`  ${bold("SAY")}  ${update.quotableLine.en}`);
      console.log(`       ${dim(update.quotableLine.hi)}`);
    }

    const safest = update.options.find((o) => o.safest);
    console.log(`  ${bold("DO")}   ${green("◆")} ${safest?.label ?? "(none)"}`);
    for (const o of update.options.filter((o) => !o.safest)) {
      console.log(`         ${dim(`◇ ${o.label}`)}`);
    }

    if (violations.length > 0) {
      console.log(`  ${yellow("GUARD TRIPPED")} ${violations.map((v) => v.kind).join(", ")}`);
    }

    // PRD R7 — if this is ever absent the client has a bug worth failing on.
    if (!update.disclaimer) {
      console.log(red("  !! NO DISCLAIMER IN UPDATE — PRD R7 violated"));
      process.exitCode = 1;
    }
    console.log("");
  }

  console.log(
    `${bold("result")}  ${fixture.turns.length} turns · ${accumulated.length} flags accumulated · ${guardTrips} guard trip(s)`,
  );
  console.log(`${bold("flags")}   ${accumulated.map((f) => `${f.ruleId} (${f.severity})`).join(", ") || "none"}`);

  /* ---------------------------------------------------------------- */
  // The packet is what makes the ninety seconds worth anything afterwards, so
  // it gets checked on the same session the guidance loop just walked.
  console.log(`\n${bold("packet")}`);

  const packet = await getPacketJson(BASE, sessionId, sessionToken);
  const markdown = await getPacketMarkdown(BASE, sessionId, sessionToken);

  const checks: Array<[string, boolean]> = [
    ["timeline is populated", packet.timeline.length > 0],
    ["transcript matches the turns sent", packet.transcript.length === fixture.turns.length],
    ["flags carry through to the packet", packet.flags.length === accumulated.length],
    ["every established fact has a verbatim quote", packet.factsEstablished.every((f) => f.evidence.trim().length > 0)],
    ["provisions surfaced", packet.provisionsSurfaced.length > 0],
    // PRD R6 / CLAUDE.md invariant 5 — this must survive all the way to the
    // artifact an advocate reads, and it is the first thing they should see.
    ["unverified warning present", packet.unverifiedContentWarning !== null],
    ["markdown carries the warning too", /UNVERIFIED CORPUS/.test(markdown)],
    ["markdown carries the transcript", /Verbatim transcript/i.test(markdown)],
  ];

  for (const [label, ok] of checks) {
    console.log(`  ${ok ? green("✓") : red("✗")} ${label}`);
    if (!ok) process.exitCode = 1;
  }
  console.log(dim(`  ${markdown.length} bytes of markdown · ${packet.durationSeconds}s session`));

  /* ---------------------------------------------------------------- */
  // PRD R4 — the engine now keeps this on disk, so deletion is the other half
  // of that trade and gets exercised on every run rather than assumed.
  console.log(`\n${bold("deletion")}`);

  await deleteSession(BASE, sessionId, sessionToken);
  let goneFromEngine = false;
  try {
    await getPacketJson(BASE, sessionId, sessionToken);
  } catch {
    goneFromEngine = true;
  }
  console.log(`  ${goneFromEngine ? green("✓") : red("✗")} the session is gone after deletion`);
  if (!goneFromEngine) process.exitCode = 1;
  console.log("");
}

main().catch((e) => {
  console.error(red(`\n${(e as Error).message}\n`));
  console.error(dim("Is the engine running?  cd kavach-engine && npm run dev\n"));
  process.exit(1);
});
