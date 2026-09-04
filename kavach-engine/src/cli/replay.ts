import fs from "node:fs";
import path from "node:path";
import { Session } from "../engine/session.js";
import { buildPacket, packetToMarkdown } from "../engine/summary.js";
import { makeProviderAsync } from "../llm/anthropic.js";
import type { TranscriptTurn } from "../types.js";

/**
 * Replays a scripted transcript through the engine, turn by turn, printing the
 * state as it evolves. This is how the engine is exercised without a phone,
 * without audio, and without an API key.
 *
 *   npm run replay -- fixtures/transcripts/escalating-traffic-stop.json
 *   npm run replay -- <file> --packet     also print the lawyer packet
 */

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--")) ?? "fixtures/transcripts/escalating-traffic-stop.json";
const wantPacket = args.includes("--packet");

const B = (s: string) => `\x1b[1m${s}\x1b[0m`;
const DIM = (s: string) => `\x1b[2m${s}\x1b[0m`;
const RED = (s: string) => `\x1b[31m${s}\x1b[0m`;
const YEL = (s: string) => `\x1b[33m${s}\x1b[0m`;
const GRN = (s: string) => `\x1b[32m${s}\x1b[0m`;
const sev = (s: string) => (s === "unlawful" ? RED(s.toUpperCase()) : s === "irregular" ? YEL(s.toUpperCase()) : s.toUpperCase());

const fixture = JSON.parse(fs.readFileSync(path.resolve(file), "utf8")) as {
  name: string; description: string; turns: Array<Pick<TranscriptTurn, "speaker" | "text">>;
};

const provider = await makeProviderAsync();
const session = new Session(provider);

console.log(B(`\n▸ ${fixture.name}`));
console.log(DIM(`  ${fixture.description}`));
console.log(DIM(`  provider=${provider.name}  corpus=${session.state.corpusVersion}\n`));

let maxLatency = 0;
for (const t of fixture.turns) {
  const { update, violations, latencyMs } = await session.ingest(t.text, t.speaker);
  maxLatency = Math.max(maxLatency, latencyMs);

  console.log(DIM("─".repeat(78)));
  console.log(`${B(`[${update.turnIndex}] ${t.speaker}`)}: ${t.text}`);

  if (!update.changed) {
    console.log(DIM(`     (no change — guidance unchanged, ${latencyMs}ms)`));
    continue;
  }

  console.log(DIM(`     ${latencyMs}ms · ${update.changeReason}`));
  console.log(`  ${update.fallback ? YEL("⚠ NOT CONFIDENT") : GRN("▸ " + update.scenarioTitle)}`);

  if (update.newFlags.length) {
    for (const f of update.newFlags) {
      console.log(`  ${sev(f.severity)}  ${f.statement}`);
      console.log(DIM(`           provisions: ${f.provisionIds.join(", ") || "—"}`));
      for (const b of f.basis) console.log(DIM(`           because ${b.fact}=${String(b.value)} · "${b.evidence}"`));
    }
  }

  console.log(`  ${B("SAY")}   "${update.quotableLine?.en}"`);
  console.log(DIM(`         "${update.quotableLine?.hi}"`));
  console.log(`  ${B("DO")}    ${update.options.map((o, i) => `${i === 0 ? GRN("◆") : "◇"} ${o.label}`).join("\n          ")}`);
  console.log(`  ${B("NOTE")}  ${update.documentNow}`);

  if (violations.length) {
    console.log(RED(`  GUARD TRIPPED:`));
    for (const v of violations) console.log(RED(`    ${v.kind}: ${v.detail}`));
  }
}

console.log(DIM("─".repeat(78)));
console.log(`\n${B("session")}  ${session.state.turns.length} turns · ${session.state.flags.length} flags · max ${maxLatency}ms/turn`);
console.log(`${B("flags")}    ${session.state.flags.map((f) => f.ruleId).join(", ") || "none"}`);

if (wantPacket) {
  const packet = await buildPacket(session.state, provider);
  console.log(`\n${DIM("═".repeat(78))}\n`);
  console.log(packetToMarkdown(packet));
}
