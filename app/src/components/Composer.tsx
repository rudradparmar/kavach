import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { Speaker } from "../api/types";
import type { PermissionState } from "../evidence/useCapture";
import { colour, radius, space, TAP_MIN, type } from "../theme";

/**
 * Where a turn comes from.
 *
 * Two inputs, one contract. Both produce exactly what the engine takes — plain
 * text plus a speaker label — and nothing downstream can tell which was used.
 * The text box is not a fallback bolted on beside the microphone; it is the
 * offline baseline, the thing that still works when there is no signal, no
 * permission, and no transcription service.
 *
 * The speaker toggle is sticky and defaults to Officer: officer utterances
 * carry most of the classifier cues, and an unattributed transcript is close
 * to worthless to the advocate who reads the packet afterwards. Speech
 * recognition cannot tell who is talking, so this stays a human decision
 * rather than a guess.
 */
export function Composer({
  speaker,
  onSpeakerChange,
  onSendText,
  onStartRecording,
  onStopRecording,
  isRecording,
  recordingMs,
  permission,
  busy,
  sttReady,
}: {
  speaker: Speaker;
  onSpeakerChange: (s: Speaker) => void;
  onSendText: (text: string) => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  isRecording: boolean;
  recordingMs: number;
  permission: PermissionState;
  busy: boolean;
  sttReady: boolean;
}) {
  const [text, setText] = useState("");
  const canSend = text.trim().length > 0 && !busy;

  const submit = () => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || busy) return;
    onSendText(trimmed);
    setText("");
  };

  const placeholder =
    speaker === "officer"
      ? "What the officer said..."
      : speaker === "user"
        ? "What you said..."
        : "What was said...";

  const micDisabled = busy || !sttReady || permission !== "granted";

  return (
    <View style={s.wrap}>
      <View style={s.speakerRow}>
        <SpeakerTab label="Officer" active={speaker === "officer"} onPress={() => onSpeakerChange("officer")} />
        <SpeakerTab label="Me" active={speaker === "user"} onPress={() => onSpeakerChange("user")} />
        <SpeakerTab label="Unsure" active={speaker === "unknown"} onPress={() => onSpeakerChange("unknown")} />
      </View>

      {/* Press and hold rather than tap-to-toggle. A held button cannot be
          left recording by accident, and releasing is the same motion as
          lowering the phone. */}
      <Pressable
        onPressIn={micDisabled ? undefined : onStartRecording}
        onPressOut={micDisabled ? undefined : onStopRecording}
        disabled={micDisabled}
        style={({ pressed }) => [
          s.mic,
          isRecording && s.micRecording,
          pressed && !isRecording && s.micPressed,
          micDisabled && s.micDisabled,
        ]}
        accessibilityRole="button"
        accessibilityLabel={isRecording ? "Recording, release to send" : "Hold to speak"}
      >
        {isRecording ? (
          <>
            <View style={s.recDot} />
            <Text style={s.micTextRecording}>RECORDING  {fmtDuration(recordingMs)}</Text>
            <Text style={s.micHint}>Release to send</Text>
          </>
        ) : (
          <>
            <Text style={s.micText}>{micReason(permission, sttReady)}</Text>
            {micDisabled && permission === "denied" ? (
              <Text style={s.micHint}>Type below instead — it works the same</Text>
            ) : null}
          </>
        )}
      </Pressable>

      <View style={s.inputRow}>
        <TextInput
          style={s.input}
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor={colour.textFaint}
          multiline
          returnKeyType="send"
          blurOnSubmit={false}
          onSubmitEditing={submit}
          editable={!busy}
          accessibilityLabel="Turn text"
        />
        <Pressable
          onPress={submit}
          disabled={!canSend}
          style={({ pressed }) => [s.send, !canSend && s.sendDisabled, pressed && canSend && s.sendPressed]}
          accessibilityRole="button"
          accessibilityLabel="Send turn"
        >
          {busy ? <ActivityIndicator color={colour.text} /> : <Text style={s.sendText}>Send</Text>}
        </Pressable>
      </View>
    </View>
  );
}

function micReason(permission: PermissionState, sttReady: boolean): string {
  if (permission === "denied") return "MICROPHONE UNAVAILABLE";
  if (permission === "unknown") return "CHECKING MICROPHONE…";
  if (!sttReady) return "TRANSCRIPTION UNREACHABLE";
  return "HOLD TO SPEAK";
}

function SpeakerTab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[s.speakerTab, active && s.speakerTabActive]}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
    >
      <Text style={[s.speakerTabText, active && s.speakerTabTextActive]}>{label}</Text>
    </Pressable>
  );
}

const fmtDuration = (ms: number) => {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

const s = StyleSheet.create({
  wrap: {
    borderTopWidth: 1,
    borderTopColor: colour.border,
    backgroundColor: colour.surface,
    padding: space.md,
    gap: space.sm,
  },

  speakerRow: { flexDirection: "row", gap: space.xs },
  speakerTab: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colour.border,
  },
  speakerTabActive: { backgroundColor: colour.surfaceRaised, borderColor: colour.action },
  speakerTabText: { color: colour.textFaint, fontSize: type.small, fontWeight: "600" },
  speakerTabTextActive: { color: colour.text },

  mic: {
    minHeight: 68,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colour.action,
    backgroundColor: colour.surfaceRaised,
  },
  micPressed: { opacity: 0.85 },
  micRecording: { borderColor: colour.unlawful, backgroundColor: colour.unlawfulBg },
  micDisabled: { borderColor: colour.border, backgroundColor: colour.surface, opacity: 0.6 },
  micText: { color: colour.text, fontSize: type.body, fontWeight: "800", letterSpacing: 1.2 },
  micTextRecording: { color: colour.unlawful, fontSize: type.body, fontWeight: "800", letterSpacing: 1.2 },
  micHint: { color: colour.textFaint, fontSize: type.small },
  recDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colour.unlawful },

  inputRow: { flexDirection: "row", gap: space.sm, alignItems: "flex-end" },
  input: {
    flex: 1,
    minHeight: TAP_MIN,
    maxHeight: 120,
    backgroundColor: colour.bg,
    borderWidth: 1,
    borderColor: colour.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    color: colour.text,
    fontSize: type.body,
  },
  send: {
    minHeight: TAP_MIN,
    minWidth: 78,
    paddingHorizontal: space.lg,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colour.action,
  },
  sendPressed: { opacity: 0.8 },
  sendDisabled: { backgroundColor: colour.border },
  sendText: { color: colour.text, fontSize: type.body, fontWeight: "700" },
});
