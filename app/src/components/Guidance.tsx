import { StyleSheet, Text, View } from "react-native";
import type { GuidanceUpdate, Provision, RaisedFlag, Scenario } from "../api/types";
import type { SpeechState } from "../tts/speech";
import { colour, radius, space, type } from "../theme";
import { Disclaimer } from "./Banners";
import { FlagList } from "./Flags";
import { OptionList } from "./Options";
import { QuotableLineCard } from "./QuotableLine";

/**
 * One rendered GuidanceUpdate.
 *
 * Order is deliberate and matches what a person needs in the order they need
 * it: what is wrong right now, what to say, what not to say, what to do, what
 * to capture. The disclaimer closes every frame.
 *
 * This component renders. It does not decide. Every string below comes from
 * the engine, and nothing here rewrites, summarises, or supplements it — in
 * particular the fallback is rendered exactly as bare as the engine made it.
 */
export function Guidance({
  update,
  allFlags,
  speech,
  translationStatus,
}: {
  update: GuidanceUpdate;
  /** Every flag raised this session, not just this turn's. */
  allFlags: RaisedFlag[];
  speech: SpeechState;
  /**
   * Per-language review state for this scenario's line, from the cached
   * corpus. A GuidanceUpdate does not carry it — the update is what the
   * engine decided this turn, and how a translation was produced is a
   * property of the corpus, not of the turn.
   */
  translationStatus?: Scenario["translationStatus"];
}) {
  return (
    <View style={s.wrap}>
      <ScenarioHeader update={update} />

      <FlagList flags={allFlags} />

      {update.quotableLine ? (
        <QuotableLineCard
          line={update.quotableLine}
          speech={speech}
          translationStatus={translationStatus}
        />
      ) : null}

      {update.doNotSay.length > 0 ? <DoNotSay items={update.doNotSay} /> : null}

      <Section title="WHAT YOU CAN DO">
        <OptionList options={update.options} />
      </Section>

      {update.documentNow ? (
        <Section title="CAPTURE THIS NOW">
          <View style={s.documentCard}>
            <Text style={s.documentText}>{update.documentNow}</Text>
          </View>
        </Section>
      ) : null}

      {update.provisionsCited.length > 0 ? <Provisions provisions={update.provisionsCited} /> : null}

      <Disclaimer text={update.disclaimer} />
    </View>
  );
}

/**
 * When the engine is not confident it says so plainly, and that plainness is
 * the feature — HANDOFF is explicit that the fallback must not be dressed up
 * in the client. So this states the uncertainty and adds nothing to it.
 */
function ScenarioHeader({ update }: { update: GuidanceUpdate }) {
  if (update.fallback) {
    return (
      <View style={s.fallbackHeader}>
        <Text style={s.fallbackTitle}>Not confidently identified</Text>
        <Text style={s.fallbackBody}>
          This does not match a covered situation closely enough to name the provisions.
          What follows is the general safe guidance only.
        </Text>
      </View>
    );
  }

  return (
    <View style={s.scenarioHeader}>
      <Text style={s.scenarioEyebrow}>SITUATION</Text>
      <Text style={s.scenarioTitle}>{update.scenarioTitle}</Text>
    </View>
  );
}

function DoNotSay({ items }: { items: string[] }) {
  return (
    <Section title="DO NOT SAY">
      <View style={s.doNotCard}>
        {items.map((item, i) => (
          <View key={i} style={s.doNotRow}>
            <Text style={s.doNotMark}>✕</Text>
            <Text style={s.doNotText}>{item}</Text>
          </View>
        ))}
      </View>
    </Section>
  );
}

function Provisions({ provisions }: { provisions: Provision[] }) {
  return (
    <Section title="PROVISIONS BEHIND THIS">
      <View style={s.provisionCard}>
        {provisions.map((p) => (
          <View key={p.id} style={s.provisionRow}>
            <Text style={s.provisionCite}>
              {p.act} {p.section}
            </Text>
            <Text style={s.provisionSummary}>{p.summary}</Text>
            {p.verification.status !== "counsel-signed-off" ? (
              <Text style={s.provisionUnverified}>
                {p.verification.status} — not checked against the bare act
              </Text>
            ) : null}
          </View>
        ))}
      </View>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: space.lg },

  scenarioHeader: { gap: 2 },
  scenarioEyebrow: {
    color: colour.textFaint,
    fontSize: type.small,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  scenarioTitle: { color: colour.text, fontSize: type.heading, fontWeight: "700", lineHeight: 25 },

  fallbackHeader: {
    backgroundColor: colour.surface,
    borderWidth: 1,
    borderColor: colour.border,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xs,
  },
  fallbackTitle: { color: colour.textMuted, fontSize: type.heading, fontWeight: "700" },
  fallbackBody: { color: colour.textFaint, fontSize: type.label, lineHeight: 20 },

  section: { gap: space.sm },
  sectionTitle: {
    color: colour.textFaint,
    fontSize: type.small,
    fontWeight: "800",
    letterSpacing: 1.4,
  },

  doNotCard: {
    backgroundColor: colour.surface,
    borderWidth: 1,
    borderColor: colour.border,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
  },
  doNotRow: { flexDirection: "row", gap: space.sm, alignItems: "flex-start" },
  doNotMark: { color: colour.unlawful, fontSize: type.label, fontWeight: "800", lineHeight: 21 },
  doNotText: { color: colour.textMuted, fontSize: type.label, lineHeight: 21, flex: 1 },

  documentCard: {
    backgroundColor: colour.surface,
    borderWidth: 1,
    borderColor: colour.border,
    borderRadius: radius.md,
    padding: space.md,
  },
  documentText: { color: colour.text, fontSize: type.body, lineHeight: 23 },

  provisionCard: {
    backgroundColor: colour.surface,
    borderWidth: 1,
    borderColor: colour.border,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.md,
  },
  provisionRow: { gap: 2 },
  provisionCite: { color: colour.text, fontSize: type.label, fontWeight: "700" },
  provisionSummary: { color: colour.textMuted, fontSize: type.small, lineHeight: 18 },
  provisionUnverified: {
    color: colour.warn,
    fontSize: type.small,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
});
