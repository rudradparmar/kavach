/**
 * Replays the engine's scripted fixtures through the real Session with the
 * MOCK provider and writes a masked, deterministic JSON file per fixture.
 *
 *   npm run demo:build      (runs from the repo root so the corpus path resolves)
 *
 * Masking only ever REMOVES text. Nothing here composes legal wording
 * (CLAUDE.md invariant 1), and the corpus is placeholder law (invariant 5), so
 * citations, quotable lines and flag statements are replaced by fixed notices.
 *
 * Output is deterministic (no timestamps, ids or latencies) because CI fails
 * when the committed JSON differs from a fresh run.
 */
import fs from "node:fs";
import path from "node:path";
import { Session } from "../../kavach-engine/src/engine/session.js";
import { MockProvider } from "../../kavach-engine/src/llm/mock.js";
import type { TranscriptTurn } from "../../kavach-engine/src/types.js";

const FIXTURES = path.resolve("kavach-engine/fixtures/transcripts");
const OUT = path.resolve("site/src/data/demo");

export const MASK = {
  provision: "§ — pending advocate review",
  line: "[Line shown here once an advocate has reviewed it]",
  flag: "[Statement shown here once an advocate has reviewed it]",
} as const;

/** Fixtures that ship on the public site, in display order. */
const INCLUDE = [
  "escalating-traffic-stop",
  "escalating-traffic-stop-hi",
  "protest-force",
  "ambiguous",
];

type Fixture = {
  name: string;
  description: string;
  turns: Array<Pick<TranscriptTurn, "speaker" | "text">>;
};

const failures: string[] = [];
fs.mkdirSync(OUT, { recursive: true });

for (const id of INCLUDE) {
  const fx = JSON.parse(fs.readFileSync(path.join(FIXTURES, `${id}.json`), "utf8")) as Fixture;
  const session = new Session(new MockProvider());
  const frames = [];

  for (const t of fx.turns) {
    const { update, violations } = await session.ingest(t.text, t.speaker);
    // A demo built on a tripped guard would present a defect as the product.
    for (const v of violations) failures.push(`${id} turn ${update.turnIndex}: ${v.kind}: ${v.detail}`);

    frames.push({
      speaker: t.speaker,
      text: t.text,
      scenarioTitle: update.scenarioTitle,
      fallback: update.fallback,
      newFlags: update.newFlags.map((f) => ({
        severity: f.severity,
        statement: MASK.flag,
      })),
      options: update.options.map((o) => ({ label: o.label, safest: o.safest })),
      documentNow: update.documentNow,
      quotableLine: update.quotableLine ? { en: MASK.line, hi: MASK.line } : null,
      provisions: update.provisionsCited.map(() => MASK.provision),
    });
  }

  fs.writeFileSync(
    path.join(OUT, `${id}.json`),
    JSON.stringify({ id, frames }, null, 2) + "\n",
  );
  console.log(`  ${id}: ${frames.length} turns`);
}

if (failures.length) {
  console.error("\nDemo generation FAILED — the output guard tripped:");
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
