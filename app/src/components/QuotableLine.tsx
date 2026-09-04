import { Pressable, StyleSheet, Text, View } from "react-native";
import type { QuotableLine as Line } from "../api/types";
import type { SpeechLang, SpeechState } from "../tts/speech";
import { unavailableReason } from "../tts/speech";
import { colour, radius, space, TAP_MIN, type } from "../theme";

/**
 * PRD R3 — the highest-risk surface in the product, because this is the text
 * the user reads out loud to a police officer.
 *
 * Rules that shape it:
 *   · The text is shown, not just spoken, so the user can read at their own
 *     pace and repeat it. Playback never replaces the words on screen —
 *     nothing here is ever audio-only. (HANDOFF: "the screen must show the
 *     text simultaneously so the user can read rather than listen".)
 *   · Both languages are always present. English carries the display size;
 *     Hindi sits directly beneath at reading size. Neither is ever omitted —
 *     the user may need to speak one and understand the other.
 *   · Playback is per language and always a deliberate tap. Where the device
 *     has no voice for a language the control is disabled and says so, rather
 *     than letting the platform substitute a voice and mispronounce a line the
 *     user is about to repeat to an officer.
 *
 * Both strings are rendered verbatim from the corpus. Nothing here trims,
 * reflows, translates or abbreviates them.
 */
export function QuotableLineCard({ line, speech }: { line: Line; speech: SpeechState }) {
  return (
    <View style={s.card}>
      <Text style={s.label}>SAY THIS</Text>

      <View style={s.block}>
        <Text style={s.en} selectable accessibilityLanguage="en-IN">
          {line.en}
        </Text>
        <PlayControl lang="en" text={line.en} speech={speech} />
      </View>

      <View style={s.rule} />

      <View style={s.block}>
        <Text style={s.hi} selectable accessibilityLanguage="hi-IN">
          {line.hi}
        </Text>
        <PlayControl lang="hi" text={line.hi} speech={speech} />
      </View>

      {speech.error ? <Text style={s.error}>{speech.error}</Text> : null}
    </View>
  );
}

function PlayControl({
  lang,
  text,
  speech,
}: {
  lang: SpeechLang;
  text: string;
  speech: SpeechState;
}) {
  const reason = unavailableReason(lang, speech.available);
  const disabled = reason !== null;
  const isSpeaking = speech.speaking === lang;

  return (
    <View style={s.controlRow}>
      <Pressable
        onPress={() => (isSpeaking ? speech.stop() : speech.speak(lang, text))}
        disabled={disabled}
        style={({ pressed }) => [
          s.play,
          isSpeaking && s.playActive,
          disabled && s.playDisabled,
          pressed && !disabled && s.playPressed,
        ]}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        accessibilityLabel={
          disabled
            ? `${reason}`
            : isSpeaking
              ? `Stop reading the ${lang === "hi" ? "Hindi" : "English"} line`
              : `Read the ${lang === "hi" ? "Hindi" : "English"} line aloud, slowly`
        }
      >
        <Text style={[s.playIcon, disabled && s.playTextDisabled]}>{isSpeaking ? "■" : "▶"}</Text>
        <Text style={[s.playText, disabled && s.playTextDisabled]}>
          {isSpeaking ? "Stop" : "Play"}
        </Text>
      </Pressable>

      {disabled ? (
        <Text style={s.reason}>{reason}</Text>
      ) : isSpeaking && speech.startedInMs !== null ? (
        // The only slice of the PRD's "time to first spoken word" the client
        // can measure without timing the human.
        <Text style={s.timing}>spoke in {speech.startedInMs}ms</Text>
      ) : (
        <Text style={s.reason}>slowed for repeating</Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colour.surfaceRaised,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colour.border,
    padding: space.lg,
    gap: space.md,
  },
  label: {
    color: colour.textFaint,
    fontSize: type.small,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  block: { gap: space.sm },
  en: {
    color: colour.text,
    fontSize: type.display,
    lineHeight: type.display * 1.32,
    fontWeight: "700",
  },
  rule: { height: 1, backgroundColor: colour.border },
  hi: {
    color: colour.text,
    fontSize: type.displaySecondary,
    // Devanagari matras sit above and below the baseline; it needs the room.
    lineHeight: type.displaySecondary * 1.62,
    fontWeight: "600",
  },

  controlRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  play: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: TAP_MIN - 8,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colour.action,
    backgroundColor: colour.surface,
  },
  playPressed: { opacity: 0.8 },
  playActive: { borderColor: colour.safest, backgroundColor: colour.safestBg },
  playDisabled: { borderColor: colour.border, backgroundColor: "transparent" },
  playIcon: { color: colour.text, fontSize: type.label },
  playText: { color: colour.text, fontSize: type.label, fontWeight: "700" },
  playTextDisabled: { color: colour.textFaint },

  reason: { color: colour.textFaint, fontSize: type.small, flex: 1 },
  timing: { color: colour.textFaint, fontSize: type.small, flex: 1, fontVariant: ["tabular-nums"] },

  error: { color: colour.unlawful, fontSize: type.small, lineHeight: 17 },
});
