import type { Corpus } from "../corpus/loader.js";
import { scenarioOrFallback } from "../corpus/loader.js";
import type { ActionOption, RaisedFlag, Scenario, SituationFacts } from "../types.js";
import { evaluateAll } from "./facts.js";

/**
 * Builds the ranked option set.
 *
 * This is the piece the PRD did not have. The PRD gave one line and one thing
 * to document; the product as described gives the user a choice with a
 * recommendation. Both are honoured: options are ranked, exactly one carries
 * safest=true, and the safest one is always a de-escalating action.
 */
export function buildOptions(
  corpus: Corpus,
  scenarioId: string | null,
  facts: SituationFacts,
  flags: RaisedFlag[]
): ActionOption[] {
  const scenario: Scenario = scenarioOrFallback(corpus, scenarioId);

  // Options whose preconditions are unmet are not offered at all. Offering a
  // "ask for a female officer" line to a man is the kind of error that costs
  // the user their trust in everything else the app says.
  const available = scenario.options.filter(
    (o) => !o.requires || o.requires.length === 0 || evaluateAll(facts, o.requires)
  );

  // Options a fired rule points at get promoted — that is how a live flag
  // changes what the user is told to do, not just what they are told.
  const promoted = new Set<string>();
  for (const f of flags) {
    const rule = corpus.rules.find((r) => r.id === f.ruleId);
    for (const id of rule?.optionIds ?? []) promoted.add(id);
  }

  const scored = available.map((o) => ({ o, key: (promoted.has(o.id) ? 0 : 1000) + o.rank }));
  scored.sort((a, b) => a.key - b.key);

  const ranked = scored.map(({ o }, i) => ({ ...o, rank: i + 1, safest: false }));
  if (ranked[0]) ranked[0].safest = true;
  return ranked;
}
