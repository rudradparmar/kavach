import { StyleSheet, Text, View } from "react-native";
import type { FlagSeverity, RaisedFlag } from "../api/types";
import { colour, radius, space, type } from "../theme";

/**
 * Misconduct flags.
 *
 * GuidanceUpdate.newFlags carries only what fired on the current turn, but a
 * flag does not stop being true because the conversation moved on — keys taken
 * without a legal basis is still the case five turns later. So the session
 * accumulates flags and this renders all of them, with the most recent held at
 * full weight and earlier ones condensed.
 *
 * Severity is conveyed three ways — icon, colour, and the word itself. Colour
 * alone fails in direct sunlight and for a colourblind user, and this is the
 * part of the screen that most needs to survive both.
 */

const SEVERITY: Record<FlagSeverity, { label: string; icon: string; fg: string; bg: string }> = {
  unlawful: { label: "APPEARS UNLAWFUL", icon: "⛔", fg: colour.unlawful, bg: colour.unlawfulBg },
  irregular: { label: "IRREGULAR", icon: "⚠", fg: colour.irregular, bg: colour.irregularBg },
  info: { label: "NOTE", icon: "ⓘ", fg: colour.info, bg: colour.infoBg },
};

export function FlagList({ flags }: { flags: RaisedFlag[] }) {
  if (flags.length === 0) return null;

  // Most recently raised first — the newest is the one that needs attention.
  const ordered = [...flags].sort((a, b) => b.raisedAtTurn - a.raisedAtTurn);

  return (
    <View style={s.wrap}>
      {ordered.map((flag, i) => (
        <FlagCard key={flag.ruleId} flag={flag} prominent={i === 0} />
      ))}
    </View>
  );
}

function FlagCard({ flag, prominent }: { flag: RaisedFlag; prominent: boolean }) {
  const sev = SEVERITY[flag.severity] ?? SEVERITY.info;

  return (
    <View
      style={[
        s.card,
        { backgroundColor: sev.bg, borderColor: sev.fg },
        prominent ? s.cardProminent : s.cardCondensed,
      ]}
      accessibilityRole="alert"
    >
      <View style={s.header}>
        <Text style={[s.icon, { color: sev.fg }]}>{sev.icon}</Text>
        <Text style={[s.severity, { color: sev.fg }]}>{sev.label}</Text>
      </View>

      <Text style={[s.statement, !prominent && s.statementCondensed]}>{flag.statement}</Text>

      {prominent && flag.provisionIds.length > 0 ? (
        <Text style={s.provisions}>{flag.provisionIds.join(" · ")}</Text>
      ) : null}

      {/* The audit trail: the verbatim words that caused this to fire. An
          advocate reading the packet needs it, and so does a user deciding
          whether the engine has understood what is happening. */}
      {prominent && flag.basis.length > 0 ? (
        <View style={s.basis}>
          {flag.basis.map((b, i) => (
            <Text key={`${b.fact}-${i}`} style={s.basisLine} numberOfLines={2}>
              <Text style={s.basisFact}>{b.fact}</Text>
              {` = ${String(b.value)} — “${b.evidence.trim()}”`}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: space.sm },
  card: {
    borderWidth: 1,
    borderRadius: radius.md,
    gap: space.xs,
  },
  cardProminent: { padding: space.md },
  cardCondensed: { paddingHorizontal: space.md, paddingVertical: space.sm, opacity: 0.78 },

  header: { flexDirection: "row", alignItems: "center", gap: space.sm },
  icon: { fontSize: type.body },
  severity: { fontSize: type.small, fontWeight: "800", letterSpacing: 0.9 },

  statement: { color: colour.text, fontSize: type.body, lineHeight: 22 },
  statementCondensed: { fontSize: type.label, lineHeight: 19 },

  provisions: {
    color: colour.textMuted,
    fontSize: type.small,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  basis: {
    marginTop: space.xs,
    paddingTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colour.border,
    gap: 2,
  },
  basisLine: { color: colour.textFaint, fontSize: type.small, lineHeight: 16 },
  basisFact: { fontWeight: "700", color: colour.textMuted },
});
