import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { QuotableLine as Line, TranslationStatus } from "../api/types";
import type { SpeechLang, SpeechState } from "../tts/speech";
import { unavailableReason } from "../tts/speech";
import { BCP47, ENDONYM, ENGLISH_NAME, SPEECH_LANGS } from "../tts/languages";
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
 *   · The launch pair is always present. English carries the display size;
 *     Hindi sits directly beneath at reading size. Neither is ever omitted —
 *     the user may need to speak one and understand the other.
 *   · The other languages (PRD R12) sit under a row of chips, in their own
 *     scripts, and open one at a time. They are not stacked above the fold
 *     because seven blocks of text is not something anyone reads at a police
 *     stop — and the pair that must always be visible is the one PRD R3 names.
 *   · Playback is per language and always a deliberate tap. Where the device
 *     has no voice for a language the control is disabled and says so, rather
 *     than letting the platform substitute a voice and mispronounce a line the
 *     user is about to repeat to an officer.
 *
 * Both strings are rendered verbatim from the corpus. Nothing here trims,
 * reflows, translates or abbreviates them.
 */
export function QuotableLineCard({
  line,
  speech,
  translationStatus,
}: {
  line: Line;
  speech: SpeechState;
  translationStatus?: Partial<Record<SpeechLang, TranslationStatus>>;
}) {
  // Only languages this line actually carries, and only ones the app knows
  // how to ask a voice for. A chip for a language with no text behind it is
  // a control that does nothing, discovered mid-encounter.
  const extras = SPEECH_LANGS.filter(
    (l) => l !== "en" && l !== "hi" && typeof line[l] === "string" && (line[l] as string).trim().length > 0,
  );
  const [open, setOpen] = useState<SpeechLang | null>(null);
  const openText = open ? (line[open] as string | undefined) : undefined;

  // True when anything on this card is a rendering rather than the original.
  // Said once, about all of them, rather than per language: singling out the
  // newer languages would imply the Hindi line has been reviewed, and it has
  // not been.
  const anyRendered =
    translationStatus === undefined ||
    Object.entries(translationStatus).some(([code, st]) => code !== "en" && st !== "source");

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

      {extras.length > 0 ? (
        <View style={s.extras}>
          <View style={s.chipRow}>
            {extras.map((lang) => {
              const active = open === lang;
              return (
                <Pressable
                  key={lang}
                  onPress={() => setOpen(active ? null : lang)}
                  style={({ pressed }) => [s.chip, active && s.chipActive, pressed && s.chipPressed]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${active ? "Hide" : "Show"} the ${ENGLISH_NAME[lang]} version`}
                >
                  <Text
                    style={[s.chipText, active && s.chipTextActive]}
                    accessibilityLanguage={BCP47[lang]}
                  >
                    {ENDONYM[lang]}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {open && openText ? (
            <View style={s.block}>
              <Text style={s.other} selectable accessibilityLanguage={BCP47[open]}>
                {openText}
              </Text>
              <PlayControl lang={open} text={openText} speech={speech} />
            </View>
          ) : null}

          {anyRendered ? (
            <Text style={s.caveat}>
              The English wording is the original. Every other language here is a rendering of it that no
              advocate has read.
            </Text>
          ) : null}
        </View>
      ) : null}

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
              ? `Stop reading the ${ENGLISH_NAME[lang]} line`
              : `Read the ${ENGLISH_NAME[lang]} line aloud, slowly`
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

  other: {
    color: colour.text,
    fontSize: type.displaySecondary,
    // Tamil, Telugu, Bengali and Kannada all carry marks above and below the
    // baseline, same as Devanagari. Give them the same room.
    lineHeight: type.displaySecondary * 1.62,
    fontWeight: "600",
  },
  extras: { gap: space.sm, borderTopWidth: 1, borderTopColor: colour.border, paddingTop: space.md },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: {
    minHeight: TAP_MIN - 12,
    justifyContent: "center",
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colour.border,
    backgroundColor: colour.surface,
  },
  chipPressed: { opacity: 0.8 },
  chipActive: { borderColor: colour.action, backgroundColor: colour.surfaceRaised },
  chipText: { color: colour.textFaint, fontSize: type.label, fontWeight: "600" },
  chipTextActive: { color: colour.text },
  caveat: { color: colour.textFaint, fontSize: type.small, lineHeight: 16 },

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
