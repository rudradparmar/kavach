import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  CorpusMeta, DebriefQuestion, EscalationRoute, LanguageEntry, LanguageCode,
  MisconductRule, OfficerFieldPrompt, Provision, Scenario,
} from "../types.js";

/** Re-exported so existing importers keep working; defined in types.ts. */
export type { CorpusMeta } from "../types.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = path.resolve(HERE, "../../corpus");

/** corpus/languages.json — PRD R12. */
export interface LanguageRegistry {
  default: LanguageCode;
  launchPair: LanguageCode[];
  languages: LanguageEntry[];
}

/** corpus/escalation.json — PRD R9. */
export interface EscalationCorpus {
  routes: EscalationRoute[];
  placeholders: Array<{ token: string; filledBy: string; note?: string }>;
}

/** corpus/debrief.json — PRD R13. */
export interface DebriefCorpus {
  windowHours: number;
  intro: string;
  questions: DebriefQuestion[];
}

/** corpus/capture/officer-fields.json — PRD R11. */
export interface OfficerCaptureCorpus {
  intro: string;
  fields: OfficerFieldPrompt[];
}

export interface Corpus {
  meta: CorpusMeta;
  provisions: Map<string, Provision>;
  scenarios: Map<string, Scenario>;
  fallback: Scenario;
  rules: MisconductRule[];
  languages: LanguageRegistry;
  escalation: EscalationCorpus;
  debrief: DebriefCorpus;
  officerCapture: OfficerCaptureCorpus;
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
  const languages = readJson<LanguageRegistry>(path.join(CORPUS_DIR, "languages.json"));
  const escalation = readJson<EscalationCorpus>(path.join(CORPUS_DIR, "escalation.json"));
  const debrief = readJson<DebriefCorpus>(path.join(CORPUS_DIR, "debrief.json"));
  const officerCapture = readJson<OfficerCaptureCorpus>(path.join(CORPUS_DIR, "capture", "officer-fields.json"));

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

  cached = { meta, provisions, scenarios, fallback, rules, languages, escalation, debrief, officerCapture, groundedIds };
  return cached;
}

export function scenarioOrFallback(c: Corpus, id: string | null): Scenario {
  if (!id) return c.fallback;
  return c.scenarios.get(id) ?? c.fallback;
}

export function provisionsFor(c: Corpus, ids: string[]): Provision[] {
  return ids.map((id) => c.provisions.get(id)).filter((p): p is Provision => Boolean(p));
}

/** The languages this corpus can actually speak in, in registry order. */
export function languageCodes(c: Corpus): LanguageCode[] {
  return c.languages.languages.map((l) => l.code);
}
