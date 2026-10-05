import { useRef } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { GuidanceUpdate, RaisedFlag, Scenario, Speaker } from "../api/types";
import { ReviewBanner, UnverifiedBanner } from "../components/Banners";
import { Composer } from "../components/Composer";
import { EvidenceStatus } from "../components/EvidenceStatus";
import { Guidance } from "../components/Guidance";
import { LatencyReadout, TranscriptChip } from "../components/TurnStatus";
import type { Transcript } from "../stt/types";
import type { PermissionState } from "../evidence/useCapture";
import type { SpeechState } from "../tts/speech";
import type { LatencySummary, TurnTiming } from "../telemetry/latency";
import { colour, radius, space, type } from "../theme";

/**
 * The live session.
 *
 * Turns reach the engine as plain text plus a speaker label, whether they were
 * spoken or typed. Nothing below this screen knows a microphone exists — that
 * is the boundary the whole speech path was built behind, and it is what lets
 * the text composer stay a first-class input rather than a debug affordance.
 */
export function SessionScreen({
  sessionId,
  update,
  translationStatus,
  officerCount,
  onRecordOfficer,
  allFlags,
  transcript,
  evidence,
  speech,
  timing,
  latency,
  turnCount,
  corpusStatus,
  corpusReview,
  corpusVersion,
  speaker,
  onSpeakerChange,
  busy,
  busyLabel,
  error,
  isRecording,
  recordingMs,
  permission,
  sttReady,
  onSendText,
  onStartRecording,
  onStopRecording,
  onAlert,
  onEnd,
}: {
  sessionId: string;
  update: GuidanceUpdate | null;
  /** From the cached corpus, for the scenario this update names. */
  translationStatus?: Scenario["translationStatus"];
  /** How many officer records exist so far (PRD R11). */
  officerCount: number;
  onRecordOfficer: () => void;
  allFlags: RaisedFlag[];
  transcript: Transcript | null;
  evidence: {
    capturing: boolean;
    safe: number;
    pendingCount: number;
    serviceReachable: boolean;
    error: string | null;
    background: boolean;
  };
  speech: SpeechState;
  timing: TurnTiming | null;
  latency: LatencySummary;
  turnCount: number;
  corpusStatus: string | null;
  /** PRD R6, straight from /health. Absent when the engine did not report it. */
  corpusReview?: {
    overdue: number;
    dueSoon: number;
    neverReviewed: number;
    total: number;
    reviewIntervalDays: number;
  } | null;
  corpusVersion: string | null;
  speaker: Speaker;
  onSpeakerChange: (s: Speaker) => void;
  busy: boolean;
  busyLabel: string | null;
  error: string | null;
  isRecording: boolean;
  recordingMs: number;
  permission: PermissionState;
  sttReady: boolean;
  onSendText: (text: string) => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onAlert: () => void;
  onEnd: () => void;
}) {
  const scrollRef = useRef<ScrollView>(null);

  return (
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={s.header}>
        <View style={s.headerLeft}>
          <View style={[s.liveDot, isRecording && s.liveDotRecording]} />
          <Text style={s.headerTitle}>{isRecording ? "Recording" : "Session live"}</Text>
        </View>
        <View style={s.headerActions}>
          {/* The corpus itself ranks "send the trusted-contact alert" as an
              action in several scenarios, so it has to be reachable without
              leaving the guidance. */}
          <Pressable onPress={onAlert} style={s.alertButton} accessibilityRole="button" hitSlop={8}>
            <Text style={s.alertButtonText}>Alert</Text>
          </Pressable>
          {/* PRD R11 asks for these to be captured "while it is still
              visible", which means from here rather than from the packet
              afterwards. The count is shown so the user can see that what
              they typed was kept. */}
          <Pressable
            onPress={onRecordOfficer}
            style={s.officerButton}
            accessibilityRole="button"
            accessibilityLabel="Record who stopped you"
            hitSlop={8}
          >
            <Text style={s.officerButtonText}>
              Officer{officerCount > 0 ? ` ${officerCount}` : ""}
            </Text>
          </Pressable>
          <Pressable onPress={onEnd} style={s.endButton} accessibilityRole="button" hitSlop={8}>
            <Text style={s.endButtonText}>End</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={s.flex}
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <UnverifiedBanner corpusStatus={corpusStatus} corpusVersion={corpusVersion} />

        <ReviewBanner review={corpusReview} />

        <EvidenceStatus
          capturing={evidence.capturing}
          safe={evidence.safe}
          pendingCount={evidence.pendingCount}
          serviceReachable={evidence.serviceReachable}
          error={evidence.error}
          background={evidence.background}
        />

        {transcript ? <TranscriptChip transcript={transcript} /> : null}

        {busy && busyLabel ? (
          <View style={s.busy}>
            <Text style={s.busyText}>{busyLabel}</Text>
          </View>
        ) : null}

        {update ? (
          <Guidance
            update={update}
            allFlags={allFlags}
            speech={speech}
            translationStatus={translationStatus}
          />
        ) : (
          <View style={s.empty}>
            <Text style={s.emptyTitle}>Describe what is happening</Text>
            <Text style={s.emptyBody}>
              Hold the button below and speak, or type what was said. Guidance appears as soon as
              the engine has enough to work with.
            </Text>
          </View>
        )}

        {error ? (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={s.meta}>
          <LatencyReadout timing={timing} summary={latency} />
          {update?.changeReason ? <Text style={s.metaReason}>{update.changeReason}</Text> : null}
          <Text style={s.metaLine}>
            {turnCount} turn{turnCount === 1 ? "" : "s"} · {sessionId.slice(0, 8)}
          </Text>
        </View>
      </ScrollView>

      <Composer
        speaker={speaker}
        onSpeakerChange={onSpeakerChange}
        onSendText={onSendText}
        onStartRecording={onStartRecording}
        onStopRecording={onStopRecording}
        isRecording={isRecording}
        recordingMs={recordingMs}
        permission={permission}
        busy={busy}
        sttReady={sttReady}
      />
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colour.border,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: space.sm },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colour.textFaint },
  liveDotRecording: { backgroundColor: colour.unlawful },
  headerTitle: { color: colour.text, fontSize: type.label, fontWeight: "700", letterSpacing: 0.4 },
  endButton: {
    minHeight: 36,
    paddingHorizontal: space.md,
    justifyContent: "center",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colour.border,
  },
  endButtonText: { color: colour.textMuted, fontSize: type.label, fontWeight: "600" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: space.sm },
  alertButton: {
    minHeight: 36,
    paddingHorizontal: space.md,
    justifyContent: "center",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colour.warn,
    backgroundColor: colour.warnBg,
  },
  officerButton: {
    minHeight: 36,
    paddingHorizontal: space.md,
    justifyContent: "center",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colour.border,
  },
  officerButtonText: { color: colour.textMuted, fontSize: type.label, fontWeight: "700" },
  alertButtonText: { color: colour.warn, fontSize: type.label, fontWeight: "700" },

  scroll: { padding: space.lg, gap: space.lg, paddingBottom: space.xl },

  busy: {
    backgroundColor: colour.surface,
    borderWidth: 1,
    borderColor: colour.border,
    borderRadius: radius.md,
    padding: space.md,
  },
  busyText: { color: colour.textMuted, fontSize: type.label },

  empty: { paddingVertical: space.xxl, gap: space.sm },
  emptyTitle: { color: colour.text, fontSize: type.heading, fontWeight: "700" },
  emptyBody: { color: colour.textMuted, fontSize: type.label, lineHeight: 21 },

  errorBox: {
    backgroundColor: colour.unlawfulBg,
    borderColor: colour.unlawful,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
  },
  errorText: { color: colour.text, fontSize: type.label, lineHeight: 20 },

  meta: { gap: space.xs, paddingTop: space.sm },
  metaReason: { color: colour.textFaint, fontSize: type.small, lineHeight: 16, fontStyle: "italic" },
  metaLine: { color: colour.textFaint, fontSize: type.small, fontVariant: ["tabular-nums"] },
});
