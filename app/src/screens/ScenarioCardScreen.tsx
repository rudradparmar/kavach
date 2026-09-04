import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { CorpusMeta, Provision, Scenario } from "../api/types";
import { Disclaimer, UnverifiedBanner } from "../components/Banners";
import { OptionList } from "../components/Options";
import { QuotableLineCard } from "../components/QuotableLine";
import { hasGatedOptions, staticOptions } from "../offline/staticOptions";
import type { SpeechState } from "../tts/speech";
import { colour, radius, space, TAP_MIN, type } from "../theme";

/**
 * One scenario, read straight from the cached corpus (PRD R10, and the R1
 * criterion that the ten scenarios stay reachable for someone who cannot
 * speak).
 *
 * This is deliberately *less* than a live session, and says so. No turns have
 * happened, so no fact is established, so no misconduct rule can have fired
 * and no detention clock is running. Presenting a card as though it were live
 * guidance would be claiming the engine had assessed a situation it has never
 * seen.
 */
export function ScenarioCardScreen({
  scenario,
  provisions,
  meta,
  speech,
  offline,
  corpusFetchedAt,
  stale,
  onStartSession,
  onBack,
}: {
  scenario: Scenario;
  /** Only the provisions this scenario cites. */
  provisions: Provision[];
  meta: CorpusMeta;
  speech: SpeechState;
  /** True when this is being read with no reachable engine. */
  offline: boolean;
  corpusFetchedAt: string | null;
  stale: boolean;
  onStartSession: () => void;
  onBack: () => void;
}) {
  const options = staticOptions(scenario);
  const gated = hasGatedOptions(scenario);

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Pressable onPress={onBack} style={s.back} accessibilityRole="button" hitSlop={10}>
          <Text style={s.backText}>‹ Back</Text>
        </Pressable>
        <Text style={s.headerLabel}>{offline ? "OFFLINE CARD" : "REFERENCE CARD"}</Text>
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        <UnverifiedBanner corpusStatus={meta.status} corpusVersion={meta.corpusVersion} />

        <View>
          <Text style={s.eyebrow}>SITUATION</Text>
          <Text style={s.title}>{scenario.title}</Text>
        </View>

        {/* The one thing this screen must not let a reader assume. */}
        <View style={s.notLive}>
          <Text style={s.notLiveTitle}>This is the general card, not live guidance</Text>
          <Text style={s.notLiveBody}>
            Nothing has been assessed about what is happening to you. There are no flags for
            unlawful conduct here and no custody clock, because no facts have been established.
            {gated ? " Some actions are only offered once a session knows they apply to you." : ""}
          </Text>
          <Pressable onPress={onStartSession} style={s.startButton} accessibilityRole="button">
            <Text style={s.startButtonText}>Start a live session instead</Text>
          </Pressable>
        </View>

        <QuotableLineCard line={scenario.quotableLine} speech={speech} />

        {scenario.doNotSay.length > 0 ? (
          <Section title="DO NOT SAY">
            <View style={s.card}>
              {scenario.doNotSay.map((item, i) => (
                <View key={i} style={s.row}>
                  <Text style={s.cross}>✕</Text>
                  <Text style={s.rowText}>{item}</Text>
                </View>
              ))}
            </View>
          </Section>
        ) : null}

        <Section title="WHAT YOU CAN DO">
          <OptionList options={options} />
        </Section>

        {scenario.officerCan.length > 0 ? (
          <Section title="WHAT THE OFFICER CAN DO">
            <View style={s.card}>
              {scenario.officerCan.map((item, i) => (
                <View key={i} style={s.row}>
                  <Text style={s.bullet}>•</Text>
                  <Text style={s.rowText}>{item}</Text>
                </View>
              ))}
            </View>
          </Section>
        ) : null}

        {scenario.officerCannot.length > 0 ? (
          <Section title="WHAT THE OFFICER CANNOT DO">
            <View style={s.card}>
              {scenario.officerCannot.map((item, i) => (
                <View key={i} style={s.row}>
                  <Text style={s.cross}>✕</Text>
                  <Text style={s.rowText}>{item}</Text>
                </View>
              ))}
            </View>
          </Section>
        ) : null}

        <Section title="CAPTURE THIS">
          <View style={s.card}>
            <Text style={s.documentText}>{scenario.documentNow}</Text>
          </View>
        </Section>

        {provisions.length > 0 ? (
          <Section title="PROVISIONS BEHIND THIS">
            <View style={[s.card, { gap: space.md }]}>
              {provisions.map((p) => (
                <View key={p.id} style={{ gap: 2 }}>
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
        ) : null}

        <Disclaimer text={meta.disclaimer} />

        <Text style={s.provenance}>
          corpus {meta.corpusVersion}
          {corpusFetchedAt ? ` · saved ${corpusFetchedAt.slice(0, 10)}` : ""}
          {stale ? " · the engine now has a newer version" : ""}
        </Text>
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Text style={s.eyebrow}>{title}</Text>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colour.border,
  },
  back: { minHeight: 36, justifyContent: "center", paddingRight: space.md },
  backText: { color: colour.action, fontSize: type.body, fontWeight: "700" },
  headerLabel: { color: colour.textFaint, fontSize: type.small, fontWeight: "800", letterSpacing: 1.2 },

  scroll: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },

  eyebrow: { color: colour.textFaint, fontSize: type.small, fontWeight: "800", letterSpacing: 1.4 },
  title: { color: colour.text, fontSize: type.heading, fontWeight: "700", lineHeight: 25 },

  notLive: {
    backgroundColor: colour.surface,
    borderWidth: 1,
    borderColor: colour.border,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
  },
  notLiveTitle: { color: colour.textMuted, fontSize: type.label, fontWeight: "700" },
  notLiveBody: { color: colour.textFaint, fontSize: type.small, lineHeight: 18 },
  startButton: {
    minHeight: TAP_MIN - 8,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colour.action,
    backgroundColor: colour.surfaceRaised,
  },
  startButtonText: { color: colour.text, fontSize: type.label, fontWeight: "700" },

  card: {
    backgroundColor: colour.surface,
    borderWidth: 1,
    borderColor: colour.border,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
  },
  row: { flexDirection: "row", gap: space.sm, alignItems: "flex-start" },
  cross: { color: colour.unlawful, fontSize: type.label, fontWeight: "800", lineHeight: 21 },
  bullet: { color: colour.textFaint, fontSize: type.label, lineHeight: 21 },
  rowText: { color: colour.textMuted, fontSize: type.label, lineHeight: 21, flex: 1 },
  documentText: { color: colour.text, fontSize: type.body, lineHeight: 23 },

  provisionCite: { color: colour.text, fontSize: type.label, fontWeight: "700" },
  provisionSummary: { color: colour.textMuted, fontSize: type.small, lineHeight: 18 },
  provisionUnverified: { color: colour.warn, fontSize: type.small, fontWeight: "600" },

  provenance: { color: colour.textFaint, fontSize: type.small, fontVariant: ["tabular-nums"] },
});
