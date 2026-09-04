import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CorpusMeta, Provision, Scenario } from "../types.js";
import type { MisconductRule } from "../types.js";

/** Re-exported so existing importers keep working; defined in types.ts. */
export type { CorpusMeta } from "../types.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = path.resolve(HERE, "../../corpus");

export interface Corpus {
  meta: CorpusMeta;
  provisions: Map<string, Provision>;
  scenarios: Map<string, Scenario>;
  fallback: Scenario;
  rules: MisconductRule[];
  /** Every provision id and every section string that legitimately exists. Used by the guard. */
  groundedIds: Set<string>;
}

const readJson = <T>(p: string): T => JSON.parse(fs.readFileSync(p, "utf8")) as T;

let cached: Corpus | null = null;

export function loadCorpus(force = false): Corpus {
  if (cached && !force) return cached;

  const meta = readJson<CorpusMeta>(path.join(CORPUS_DIR, "meta.json"));
  const provisionList = readJson<Provision[]>(path.join(CORPUS_DIR, "provisions.json"));
  const fallback = readJson<Scenario>(path.join(CORPUS_DIR, "fallback.json"));
  const rules = readJson<MisconductRule[]>(path.join(CORPUS_DIR, "rules", "misconduct.json"));

  const scenarioDir = path.join(CORPUS_DIR, "scenarios");
  const scenarios = new Map<string, Scenario>();
  for (const f of fs.readdirSync(scenarioDir).filter((f) => f.endsWith(".json"))) {
    const s = readJson<Scenario>(path.join(scenarioDir, f));
    scenarios.set(s.id, s);
  }

  const provisions = new Map(provisionList.map((p) => [p.id, p]));

  const groundedIds = new Set<string>();
  for (const p of provisionList) {
    groundedIds.add(p.id);
    groundedIds.add(`${p.act} ${p.section}`);
    groundedIds.add(p.section);
  }

  cached = { meta, provisions, scenarios, fallback, rules, groundedIds };
  return cached;
}

export function scenarioOrFallback(c: Corpus, id: string | null): Scenario {
  if (!id) return c.fallback;
  return c.scenarios.get(id) ?? c.fallback;
}

export function provisionsFor(c: Corpus, ids: string[]): Provision[] {
  return ids.map((id) => c.provisions.get(id)).filter((p): p is Provision => Boolean(p));
}
