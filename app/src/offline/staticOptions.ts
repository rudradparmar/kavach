import type { ActionOption, Scenario } from "../api/types";

/**
 * Option ranking for a static scenario card, with no session behind it.
 *
 * **This is a port of `kavach-engine/src/engine/options.ts`.** It exists only
 * because that module reaches `corpus/loader.ts`, which imports `node:fs` and
 * therefore cannot be bundled into the app. `scripts/units.ts` runs this and
 * the real `buildOptions` side by side over all ten scenarios and fails if
 * they disagree, so the duplication cannot quietly drift.
 *
 * Two things about the corpus shape make this less trivial than it looks, and
 * both would be easy to get wrong by reading the JSON naively:
 *
 *   · `rank` and `safest` in the corpus are *inputs to ordering*, not the
 *     answer. The engine re-ranks from scratch and marks exactly one option
 *     safest afterwards. `search-frisk` carries two `safest: true` entries in
 *     its JSON for precisely this reason.
 *   · An option with unmet `requires` is not offered at all. On a static card
 *     no fact is ever established, and — following the engine's tri-state rule
 *     that `unknown` satisfies no predicate — every gated option is therefore
 *     dropped. That is what withholds "ask for a female officer" from a card
 *     being read by someone the app knows nothing about.
 *
 * The second point has teeth: `search-frisk`'s gated option is also its
 * rank-1 safest one. Dropping it and then trusting the corpus `safest` flag
 * would leave that card with no safest action, on the scenario where it
 * matters most. Re-ranking is what prevents that.
 */
export function staticOptions(scenario: Scenario): ActionOption[] {
  const available = scenario.options.filter((o) => !o.requires || o.requires.length === 0);

  const ranked = [...available]
    .sort((a, b) => a.rank - b.rank)
    .map((o, i) => ({ ...o, rank: i + 1, safest: false }));

  if (ranked[0]) ranked[0].safest = true;
  return ranked;
}

/** True when the card is hiding actions that a live session could offer. */
export function hasGatedOptions(scenario: Scenario): boolean {
  return scenario.options.some((o) => o.requires && o.requires.length > 0);
}
