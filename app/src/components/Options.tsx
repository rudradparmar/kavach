import { StyleSheet, Text, View } from "react-native";
import type { ActionOption } from "../api/types";
import { colour, radius, space, type } from "../theme";

/**
 * The ranked action set.
 *
 * The engine guarantees exactly one option per set carries safest: true, and
 * CLAUDE.md invariant 3 guarantees that option is always a de-escalating one.
 * This component's job is to make that option unmissable — it sits first, in
 * the only green in the product, at a larger size, with its own label.
 *
 * The others stay visible and legible. They are not hidden behind a tap: PRD
 * Design Principle 5 is that the product says what you *may* do, and hiding
 * the alternatives would quietly turn a menu into an instruction.
 */
export function OptionList({ options }: { options: ActionOption[] }) {
  if (options.length === 0) return null;

  const ordered = [...options].sort((a, b) => {
    if (a.safest !== b.safest) return a.safest ? -1 : 1;
    return a.rank - b.rank;
  });

  return (
    <View style={s.wrap}>
      {ordered.map((o) => (o.safest ? <Safest key={o.id} option={o} /> : <Other key={o.id} option={o} />))}
    </View>
  );
}

function Safest({ option }: { option: ActionOption }) {
  return (
    <View style={[s.card, s.safestCard]}>
      <Text style={s.safestLabel}>◆ SAFEST</Text>
      <Text style={s.safestText}>{option.label}</Text>
      <Text style={s.rationale}>{option.rationale}</Text>
      {option.tradeoff ? <Tradeoff text={option.tradeoff} accent={colour.safest} /> : null}
    </View>
  );
}

function Other({ option }: { option: ActionOption }) {
  return (
    <View style={[s.card, s.otherCard]}>
      <View style={s.otherHead}>
        <Text style={s.rank}>{option.rank}</Text>
        <Text style={s.otherText}>{option.label}</Text>
      </View>
      <Text style={s.rationale}>{option.rationale}</Text>
      {option.tradeoff ? <Tradeoff text={option.tradeoff} accent={colour.textMuted} /> : null}
    </View>
  );
}

/** The consequence the user should understand before choosing. Never buried. */
function Tradeoff({ text, accent }: { text: string; accent: string }) {
  return (
    <View style={[s.tradeoff, { borderLeftColor: accent }]}>
      <Text style={s.tradeoffText}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: space.sm },
  card: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: space.md,
    gap: space.xs,
  },

  safestCard: {
    backgroundColor: colour.safestBg,
    borderColor: colour.safest,
    borderWidth: 1.5,
  },
  safestLabel: {
    color: colour.safest,
    fontSize: type.small,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  safestText: {
    color: colour.text,
    fontSize: type.heading,
    lineHeight: 26,
    fontWeight: "700",
  },

  otherCard: {
    backgroundColor: colour.surface,
    borderColor: colour.border,
  },
  otherHead: { flexDirection: "row", gap: space.sm, alignItems: "baseline" },
  rank: {
    color: colour.textFaint,
    fontSize: type.label,
    fontWeight: "800",
    minWidth: 14,
    fontVariant: ["tabular-nums"],
  },
  otherText: {
    color: colour.text,
    fontSize: type.body,
    lineHeight: 22,
    fontWeight: "600",
    flex: 1,
  },

  rationale: { color: colour.textMuted, fontSize: type.label, lineHeight: 20 },

  tradeoff: {
    borderLeftWidth: 2,
    paddingLeft: space.sm,
    marginTop: space.xs,
  },
  tradeoffText: { color: colour.textMuted, fontSize: type.small, lineHeight: 18, fontStyle: "italic" },
});
