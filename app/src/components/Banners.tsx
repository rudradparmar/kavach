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
 * PRD R6: "provisions unreviewed for 6 months are flagged in-product."
 *
 * A governance rule nothing reads is a comment, and `reviewDueAt` was a field
 * in every corpus file that nothing read. This is the "in-product" half.
 *
 * It is separate from the unverified banner because the two say different
 * things and both can be true: "no advocate has ever signed this" and "the
 * signed content is now past its review date" are different failures, and
 * collapsing them would hide the second one behind the first for as long as
 * the first is true — which is exactly the period where nobody notices.
 *
 * Rendered only when the engine reports something overdue. Nothing here
 * decides what counts as overdue; the engine does.
 */
export function ReviewBanner({
  review,
}: {
  review:
    | { overdue: number; dueSoon: number; neverReviewed: number; total: number; reviewIntervalDays: number }
    | null
    | undefined;
}) {
  if (!review) return null;
  if (review.overdue === 0 && review.dueSoon === 0) return null;

  const allNever = review.neverReviewed >= review.overdue && review.overdue > 0;
  return (
    <View style={s.review}>
      <Text style={s.reviewTitle}>
        {review.overdue > 0
          ? `${review.overdue} of ${review.total} corpus items are past review`
          : `${review.dueSoon} corpus item${review.dueSoon === 1 ? "" : "s"} fall due for review soon`}
      </Text>
      <Text style={s.reviewBody}>
        {allNever
          ? `Nothing in this corpus has ever been reviewed. Review is due every ${review.reviewIntervalDays} days once it starts.`
          : `Review is due every ${review.reviewIntervalDays} days. Law changes; content that has lapsed may be out of date.`}
      </Text>
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

  review: {
    backgroundColor: colour.surface,
    borderColor: colour.border,
    borderLeftColor: colour.warn,
    borderLeftWidth: 3,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xs,
  },
  reviewTitle: { color: colour.text, fontSize: type.small, fontWeight: "800" },
  reviewBody: { color: colour.textMuted, fontSize: type.small, lineHeight: 17 },

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
