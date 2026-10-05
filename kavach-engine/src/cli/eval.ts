import fs from "node:fs";
import path from "node:path";
import { Session } from "../engine/session.js";
import { makeProviderAsync } from "../llm/anthropic.js";
import type { TranscriptTurn } from "../types.js";

/**
 * Scores the perception layer — whichever provider KAVACH_LLM_PROVIDER picks —
 * against labelled transcripts in eval/cases.json.
 *
 *   npm run eval                              mock, prints the scorecard
 *   KAVACH_LLM_PROVIDER=anthropic npm run eval
 *   npm run eval -- --out eval/results.json   also write the full report
 *   npm run eval -- --min-accuracy 0.85       fail below this scenario accuracy
 *   npm run eval -- --case arrest             only cases whose id contains this
 *
 * Two numbers are gates, not scores, and fail the run at any value above
 * zero: an **inverted** fact (labelled yes, extracted no, or the reverse) and
 * a **false flag** (a misconduct flag the labels say must not fire). Both are
 * the direction CLAUDE.md calls worse than silence — the rule engine trusts
 * extraction, so an inverted fact defeats every layer below it, and a false
 * flag tells someone an officer is acting unlawfully when the transcript does
 * not say so. Everything else (accuracy, recall, missed flags) is a score: a
 * missed fact is a quieter product, not a more dangerous one.
 *
 * Labels are only what a careful reader takes from the words. A fact absent
 * from both `facts` and `absent` is not scored, so extending a case never
 * makes an existing provider look worse by accident.
 */

type Speaker = TranscriptTurn["speaker"];
interface Case {
  id: string;
  lang: string;
  scenario: string | null;
  turns: Array<[Speaker, string]>;
  facts?: Record<string, string | number>;
  absent?: string[];
  flags?: string[];
  noFlags?: string[];
}

interface CaseResult {
  id: string;
  lang: string;
  scenarioExpected: string | null;
  scenarioGot: string | null;
  scenarioOk: boolean;
  factsExpected: number;
  factsHit: number;
  missedFacts: string[];
  inverted: string[];
  spurious: string[];
  missedFlags: string[];
  falseFlags: string[];
  turnLatencyMs: number[];
  error?: string;
}

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const file = path.resolve(opt("--cases") ?? "eval/cases.json");
const out = opt("--out");
const minAccuracy = opt("--min-accuracy") !== undefined ? Number(opt("--min-accuracy")) : undefined;
const only = opt("--case");

const B = (s: string) => `\x1b[1m${s}\x1b[0m`;
const DIM = (s: string) => `\x1b[2m${s}\x1b[0m`;
const RED = (s: string) => `\x1b[31m${s}\x1b[0m`;
const YEL = (s: string) => `\x1b[33m${s}\x1b[0m`;
const GRN = (s: string) => `\x1b[32m${s}\x1b[0m`;

const all = (JSON.parse(fs.readFileSync(file, "utf8")) as { cases: Case[] }).cases;
const cases = only ? all.filter((c) => c.id.includes(only)) : all;
const provider = await makeProviderAsync();

const opposite = (v: unknown) => (v === "yes" ? "no" : v === "no" ? "yes" : undefined);

async function runCase(c: Case): Promise<CaseResult> {
  const r: CaseResult = {
    id: c.id, lang: c.lang, scenarioExpected: c.scenario, scenarioGot: null, scenarioOk: false,
    factsExpected: 0, factsHit: 0, missedFacts: [], inverted: [], spurious: [],
    missedFlags: [], falseFlags: [], turnLatencyMs: [],
  };
  try {
    const s = new Session(provider);
    for (const [speaker, text] of c.turns) {
      const t = await s.ingest(text, speaker);
      r.turnLatencyMs.push(t.latencyMs);
    }
    const facts = s.state.facts as unknown as Record<string, unknown>;
    r.scenarioGot = s.state.currentScenarioId;
    r.scenarioOk = r.scenarioGot === c.scenario;

    for (const [k, want] of Object.entries(c.facts ?? {})) {
      r.factsExpected++;
      const got = facts[k];
      if (got === want) r.factsHit++;
      else if (got !== "unknown" && got !== null && got !== undefined && got === opposite(want)) {
        r.inverted.push(`${k}: labelled ${want}, extracted ${got}`);
      } else {
        r.missedFacts.push(`${k}=${want} (got ${JSON.stringify(got)})`);
      }
    }
    for (const k of c.absent ?? []) {
      const got = facts[k];
      if (got !== "unknown" && got !== null && got !== undefined) r.spurious.push(`${k}=${JSON.stringify(got)}`);
    }
    const fired = new Set(s.state.flags.map((f) => f.ruleId));
    r.missedFlags = (c.flags ?? []).filter((f) => !fired.has(f));
    r.falseFlags = (c.noFlags ?? []).filter((f) => fired.has(f));
  } catch (e) {
    r.error = (e as Error).message;
  }
  return r;
}

const results: CaseResult[] = [];
for (const c of cases) results.push(await runCase(c));

const pct = (n: number, d: number) => (d === 0 ? "—" : `${((100 * n) / d).toFixed(1)}%`);
const quantile = (xs: number[], q: number) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

console.log(B(`\n▸ perception eval  provider=${provider.name}  cases=${results.length}`));
for (const r of results) {
  const bad = r.inverted.length + r.falseFlags.length + r.spurious.length + (r.error ? 1 : 0);
  const mark = bad > 0 ? RED("✗") : r.scenarioOk && r.missedFacts.length === 0 && r.missedFlags.length === 0 ? GRN("✓") : YEL("~");
  const sc = r.scenarioOk ? "" : DIM(`  scenario ${r.scenarioExpected ?? "fallback"} → got ${r.scenarioGot ?? "fallback"}`);
  console.log(`  ${mark} ${r.id.padEnd(30)} ${DIM(r.lang.padEnd(8))} facts ${r.factsHit}/${r.factsExpected}${sc}`);
  for (const x of r.inverted) console.log(RED(`      INVERTED  ${x}`));
  for (const x of r.falseFlags) console.log(RED(`      FALSE FLAG  ${x}`));
  for (const x of r.spurious) console.log(RED(`      SHOULD BE UNKNOWN  ${x}`));
  if (r.error) console.log(RED(`      ERROR  ${r.error}`));
  for (const x of r.missedFacts) console.log(DIM(`      missed  ${x}`));
  for (const x of r.missedFlags) console.log(DIM(`      missed flag  ${x}`));
}

const sum = (f: (r: CaseResult) => number) => results.reduce((a, r) => a + f(r), 0);
const byLang = new Map<string, CaseResult[]>();
for (const r of results) byLang.set(r.lang, [...(byLang.get(r.lang) ?? []), r]);
const latencies = results.flatMap((r) => r.turnLatencyMs);

const report = {
  provider: provider.name,
  at: new Date().toISOString(),
  cases: results.length,
  scenarioAccuracy: sum((r) => (r.scenarioOk ? 1 : 0)) / Math.max(1, results.length),
  factRecall: sum((r) => r.factsHit) / Math.max(1, sum((r) => r.factsExpected)),
  invertedFacts: sum((r) => r.inverted.length),
  falseFlags: sum((r) => r.falseFlags.length),
  shouldBeUnknown: sum((r) => r.spurious.length),
  missedFlags: sum((r) => r.missedFlags.length),
  expectedFlags: cases.reduce((a, c) => a + (c.flags?.length ?? 0), 0),
  errors: sum((r) => (r.error ? 1 : 0)),
  latencyMs: { p50: quantile(latencies, 0.5), p95: quantile(latencies, 0.95), max: Math.max(0, ...latencies) },
  byLanguage: Object.fromEntries(
    [...byLang].map(([lang, rs]) => [lang, {
      cases: rs.length,
      scenarioAccuracy: rs.filter((r) => r.scenarioOk).length / rs.length,
      factRecall: rs.reduce((a, r) => a + r.factsHit, 0) / Math.max(1, rs.reduce((a, r) => a + r.factsExpected, 0)),
    }]),
  ),
  results,
};
const flagsExpected = report.expectedFlags;

console.log(B("\n  scorecard"));
console.log(`  scenario accuracy   ${pct(sum((r) => (r.scenarioOk ? 1 : 0)), results.length)}  ${DIM("PRD target ≥85%")}`);
console.log(`  fact recall         ${pct(sum((r) => r.factsHit), sum((r) => r.factsExpected))}`);
console.log(`  flag recall         ${pct(flagsExpected - report.missedFlags, flagsExpected)}`);
for (const [lang, v] of Object.entries(report.byLanguage)) {
  console.log(DIM(`    ${lang.padEnd(8)} scenario ${pct(v.scenarioAccuracy * v.cases, v.cases)}  facts ${(v.factRecall * 100).toFixed(1)}%  (${v.cases} cases)`));
}
console.log(`  latency per turn    p50 ${report.latencyMs.p50}ms  p95 ${report.latencyMs.p95}ms  ${DIM("(engine only — no speech, no network to the phone)")}`);
const gate = (label: string, n: number) => console.log(`  ${label.padEnd(19)} ${n === 0 ? GRN("0") : RED(String(n))}`);
gate("inverted facts", report.invertedFacts);
gate("false flags", report.falseFlags);
gate("should be unknown", report.shouldBeUnknown);
gate("errors", report.errors);

if (out) {
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(path.resolve(out), JSON.stringify(report, null, 2));
  console.log(DIM(`\n  report written to ${out}`));
}

const failures: string[] = [];
if (report.invertedFacts > 0) failures.push(`${report.invertedFacts} inverted fact(s)`);
if (report.falseFlags > 0) failures.push(`${report.falseFlags} false flag(s)`);
if (report.shouldBeUnknown > 0) failures.push(`${report.shouldBeUnknown} fact(s) established from a question or request`);
if (report.errors > 0) failures.push(`${report.errors} case(s) errored`);
if (minAccuracy !== undefined && report.scenarioAccuracy < minAccuracy) {
  failures.push(`scenario accuracy ${(report.scenarioAccuracy * 100).toFixed(1)}% below ${(minAccuracy * 100).toFixed(1)}%`);
}
if (failures.length) {
  console.log(RED(B(`\n  FAIL — ${failures.join(", ")}\n`)));
  process.exit(1);
}
console.log(GRN(B("\n  PASS — no inverted facts, no false flags\n")));
