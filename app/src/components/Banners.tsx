import { StyleSheet, Text, View } from "react-native";
import { colour, radius, space, type } from "../theme";

/**
 * CLAUDE.md invariant 5: the corpus is unverified and must say so.
 *
 * This banner is keyed off the engine's reported corpus status, never off a
 * constant in this file. It disappears when — and only when — an advocate has
 * actually signed the corpus off and /health starts saying so. There is no
 * prop, flag, or build variant that hides it before then.
 */
export function UnverifiedBanner({
  corpusStatus,
  corpusVersion,
}: {
  corpusStatus: string | null;
  corpusVersion: string | null;
}) {
  if (corpusStatus === "counsel-signed-off") return null;

  return (
    <View style={s.unverified}>
      <Text style={s.unverifiedTitle}>UNVERIFIED CONTENT — NOT FOR USE</Text>
      <Text style={s.unverifiedBody}>
        Every section number below is a placeholder. No advocate has reviewed any of it.
        Do not repeat any of this to a police officer.
      </Text>
      {corpusVersion ? (
        <Text style={s.unverifiedMeta}>
          corpus {corpusVersion}
          {corpusStatus ? ` · ${corpusStatus}` : ""}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * PRD R7. Present on every answer screen, in compressed form, with no way to
 * dismiss it. It takes the text the engine sends rather than holding its own
 * copy, so the wording stays a corpus decision.
 */
export function Disclaimer({ text }: { text: string }) {
  return (
    <View style={s.disclaimer}>
      <Text style={s.disclaimerText}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  unverified: {
    backgroundColor: colour.warnBg,
    borderColor: colour.warn,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xs,
  },
  unverifiedTitle: {
    color: colour.warn,
    fontSize: type.label,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  unverifiedBody: { color: colour.text, fontSize: type.small, lineHeight: 18 },
  unverifiedMeta: { color: colour.textFaint, fontSize: type.small, fontVariant: ["tabular-nums"] },

  disclaimer: {
    borderTopWidth: 1,
    borderTopColor: colour.border,
    paddingTop: space.md,
  },
  disclaimerText: {
    color: colour.textFaint,
    fontSize: type.small,
    lineHeight: 17,
  },
});
