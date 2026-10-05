import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Health, Scenario } from "../api/types";
import type { CorpusCacheState } from "../offline/corpusCache";
import type { SttHealth } from "../stt/types";
import { ReviewBanner, UnverifiedBanner } from "../components/Banners";
import { colour, radius, space, type } from "../theme";

/**
 * PRD R1 — one tap starts a session. No login, no menu, no scenario picker.
 *
 * Everything else on this screen is subordinate to the button: the engine
 * status is a thin strip, settings is a small corner affordance. A person
 * reaching for this phone at a checkpoint should not have to read anything
 * before pressing.
 */
export function StartScreen({
  health,
  healthError,
  checking,
  baseUrl,
  sttHealth,
  corpus,
  contactCount,
  starting,
  startError,
  onStart,
  onOpenSettings,
  onRetryHealth,
  onOpenScenario,
  onOpenContacts,
}: {
  health: Health | null;
  healthError: string | null;
  checking: boolean;
  baseUrl: string;
  sttHealth: SttHealth | null;
  corpus: CorpusCacheState;
  contactCount: number;
  starting: boolean;
  startError: string | null;
  onStart: () => void;
  onOpenSettings: () => void;
  onRetryHealth: () => void;
  onOpenScenario: (id: string) => void;
  onOpenContacts: () => void;
}) {
  const reachable = health !== null;

  return (
    <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
      <View style={s.topRow}>
        <View>
          <Text style={s.wordmark}>KAVACH</Text>
          <Text style={s.tagline}>Rights in the moment · India, central law</Text>
        </View>
        <Pressable
          onPress={onOpenSettings}
          style={s.settingsButton}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Settings"
        >
          <Text style={s.settingsIcon}>⚙</Text>
        </Pressable>
      </View>

      <UnverifiedBanner
        corpusStatus={health?.corpusStatus ?? "unverified"}
        corpusVersion={health?.corpusVersion ?? null}
      />

      {/* PRD R6, before a session rather than only during one: staleness is
          a reason not to rely on the content at all, so it belongs where the
          decision to start is made. */}
      <ReviewBanner review={health?.corpusReview ?? null} />

      <View style={s.buttonArea}>
        <Pressable
          onPress={onStart}
          disabled={starting}
          style={({ pressed }) => [s.start, pressed && s.startPressed, starting && s.startBusy]}
          accessibilityRole="button"
          accessibilityLabel="Start a session"
          accessibilityHint="Begins a live encounter session and shows guidance"
        >
          {starting ? (
            <ActivityIndicator size="large" color={colour.bg} />
          ) : (
            <>
              <Text style={s.startText}>START</Text>
              <Text style={s.startSub}>I have been stopped</Text>
            </>
          )}
        </Pressable>
      </View>

      {startError ? (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{startError}</Text>
        </View>
      ) : null}

      <EngineStrip
        reachable={reachable}
        checking={checking}
        health={health}
        healthError={healthError}
        baseUrl={baseUrl}
        sttHealth={sttHealth}
        onRetry={onRetryHealth}
        onOpenSettings={onOpenSettings}
      />

      {/* PRD R5: contacts are "configured during onboarding, before the
          product is ever needed". With none set this is a prompt rather than a
          settings row — nobody types a phone number mid-encounter, so the only
          moment this can be done is a quiet one. */}
      <Pressable
        onPress={onOpenContacts}
        style={({ pressed }) => [
          s.contacts,
          contactCount === 0 && s.contactsEmpty,
          pressed && s.contactsPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Trusted contacts"
      >
        <Text style={[s.contactsTitle, contactCount === 0 && s.contactsTitleEmpty]}>
          {contactCount === 0
            ? "Set up your trusted contacts"
            : `${contactCount} trusted contact${contactCount === 1 ? "" : "s"}`}
        </Text>
        <Text style={s.contactsSub}>
          {contactCount === 0
            ? "One tap during a stop tells them where you are. Do this before you need it."
            : "One tap during a stop tells them where you are."}
        </Text>
      </Pressable>

      <ScenarioGrid corpus={corpus} onOpenScenario={onOpenScenario} />
    </ScrollView>
  );
}

/** Dev-facing, but honest: if the engine is unreachable the user must know
 *  before they tap, not after. */
function EngineStrip({
  reachable,
  checking,
  health,
  healthError,
  baseUrl,
  sttHealth,
  onRetry,
  onOpenSettings,
}: {
  reachable: boolean;
  checking: boolean;
  health: Health | null;
  healthError: string | null;
  baseUrl: string;
  sttHealth: SttHealth | null;
  onRetry: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <View style={s.strip}>
      <View style={s.stripRow}>
        <View style={[s.dot, { backgroundColor: checking ? colour.textFaint : reachable ? colour.safest : colour.unlawful }]} />
        <Text style={s.stripText}>
          {checking ? "Checking engine…" : reachable ? `Engine up · ${health?.provider} · ${health?.scenarios} scenarios` : "Engine unreachable"}
        </Text>
      </View>

      <Text style={s.stripUrl} numberOfLines={1}>
        {baseUrl}
      </Text>

      {/* Speech is optional and its absence is not a failure — typing is a
          complete input. Saying so plainly stops "no microphone" from reading
          as "the product is broken". A simulated provider is called out
          loudly, because canned transcripts produce guidance for a situation
          that is not happening. */}
      <View style={s.stripRow}>
        <View
          style={[
            s.dot,
            {
              backgroundColor: sttHealth
                ? sttHealth.simulated
                  ? colour.warn
                  : colour.safest
                : colour.textFaint,
            },
          ]}
        />
        <Text style={s.stripText}>
          {sttHealth
            ? sttHealth.simulated
              ? "Speech: SIMULATED — audio is not transcribed"
              : `Speech: ${sttHealth.provider}${sttHealth.model ? ` · ${sttHealth.model}` : ""}`
            : "Speech: unavailable — you can still type"}
        </Text>
      </View>

      {healthError ? <Text style={s.stripError}>{healthError}</Text> : null}

      {!checking && !reachable ? (
        <View style={s.stripActions}>
          <Pressable onPress={onRetry} style={s.stripButton} accessibilityRole="button">
            <Text style={s.stripButtonText}>Retry</Text>
          </Pressable>
          <Pressable onPress={onOpenSettings} style={s.stripButton} accessibilityRole="button">
            <Text style={s.stripButtonText}>Change address</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { padding: space.lg, gap: space.lg, flexGrow: 1 },

  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  wordmark: { color: colour.text, fontSize: 22, fontWeight: "800", letterSpacing: 3 },
  tagline: { color: colour.textFaint, fontSize: type.small, marginTop: 2 },
  settingsButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colour.surface,
  },
  settingsIcon: { color: colour.textMuted, fontSize: 19 },

  buttonArea: { flex: 1, justifyContent: "center", alignItems: "center", paddingVertical: space.xl },
  start: {
    width: 236,
    height: 236,
    borderRadius: 118,
    backgroundColor: colour.safest,
    alignItems: "center",
    justifyContent: "center",
    gap: space.xs,
  },
  startPressed: { opacity: 0.82, transform: [{ scale: 0.97 }] },
  startBusy: { opacity: 0.75 },
  startText: { color: colour.bg, fontSize: 40, fontWeight: "900", letterSpacing: 3 },
  startSub: { color: colour.bg, fontSize: type.label, fontWeight: "600", opacity: 0.72 },

  errorBox: {
    backgroundColor: colour.unlawfulBg,
    borderColor: colour.unlawful,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
  },
  errorText: { color: colour.text, fontSize: type.label, lineHeight: 20 },

  strip: {
    backgroundColor: colour.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colour.border,
    padding: space.md,
    gap: space.xs,
  },
  stripRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  dot: { width: 9, height: 9, borderRadius: 5 },
  stripText: { color: colour.textMuted, fontSize: type.small, flex: 1 },
  stripUrl: { color: colour.textFaint, fontSize: type.small, fontFamily: undefined },
  stripError: { color: colour.unlawful, fontSize: type.small, lineHeight: 17 },
  stripActions: { flexDirection: "row", gap: space.sm, marginTop: space.xs },
  stripButton: {
    minHeight: 38,
    paddingHorizontal: space.md,
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colour.surfaceRaised,
    borderWidth: 1,
    borderColor: colour.border,
  },
  stripButtonText: { color: colour.text, fontSize: type.small, fontWeight: "600" },

  contacts: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colour.border,
    backgroundColor: colour.surface,
    padding: space.md,
    gap: 2,
  },
  contactsEmpty: { borderColor: colour.warn, backgroundColor: colour.warnBg },
  contactsPressed: { opacity: 0.85 },
  contactsTitle: { color: colour.text, fontSize: type.label, fontWeight: "700" },
  contactsTitleEmpty: { color: colour.warn },
  contactsSub: { color: colour.textFaint, fontSize: type.small, lineHeight: 17 },

  grid: { gap: space.md, paddingTop: space.sm },
  gridHead: { gap: space.xs },
  gridTitle: { color: colour.textFaint, fontSize: type.small, fontWeight: "800", letterSpacing: 1.4 },
  gridSub: { color: colour.textFaint, fontSize: type.small, lineHeight: 17 },
  gridItems: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  tile: {
    flexGrow: 1,
    flexBasis: "46%",
    minHeight: 78,
    justifyContent: "center",
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colour.border,
    backgroundColor: colour.surface,
  },
  tilePressed: { backgroundColor: colour.surfaceRaised, borderColor: colour.action },
  tileText: { color: colour.text, fontSize: type.label, fontWeight: "600", lineHeight: 19 },
  gridStale: { color: colour.warn, fontSize: type.small, lineHeight: 17 },
});

/**
 * The ten scenarios as large tap targets (PRD R1).
 *
 * R1 contradicts itself: "no scenario picker" on one line, and "given the user
 * cannot speak, the 10 covered scenarios are reachable as large tap targets on
 * the first screen" on another. Both are satisfied by position — the START
 * button is the only thing on first paint, and this sits below the fold for
 * someone who cannot speak, has no signal, or simply wants to read ahead.
 *
 * It renders from the cached corpus, so it works with no engine at all. That
 * is the point of caching: the PRD says policing is heaviest where signal is
 * worst.
 */
function ScenarioGrid({
  corpus,
  onOpenScenario,
}: {
  corpus: CorpusCacheState;
  onOpenScenario: (id: string) => void;
}) {
  const scenarios: Scenario[] = corpus.payload?.scenarios ?? [];
  if (scenarios.length === 0) return null;

  return (
    <View style={s.grid}>
      <View style={s.gridHead}>
        <Text style={s.gridTitle}>CANNOT SPEAK? TAP A SITUATION</Text>
        <Text style={s.gridSub}>
          General cards, not live guidance — no flags and no custody clock, because nothing has
          been assessed about your situation.
          {corpus.source === "cache" ? " Saved on this phone, so they work with no signal." : ""}
        </Text>
      </View>

      <View style={s.gridItems}>
        {scenarios.map((sc) => (
          <Pressable
            key={sc.id}
            onPress={() => onOpenScenario(sc.id)}
            style={({ pressed }) => [s.tile, pressed && s.tilePressed]}
            accessibilityRole="button"
            accessibilityLabel={sc.title}
          >
            <Text style={s.tileText}>{sc.title}</Text>
          </Pressable>
        ))}
      </View>

      {corpus.stale ? (
        <Text style={s.gridStale}>
          These cards are from corpus {corpus.payload?.meta.corpusVersion}; the engine now has a
          newer version. They will update next time it is reachable.
        </Text>
      ) : null}
    </View>
  );
}
