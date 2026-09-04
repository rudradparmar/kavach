/**
 * Which languages a device can actually pronounce.
 *
 * Split out of speech.ts, which imports expo-speech and React, so this can be
 * exercised from a plain Node script. That matters more here than it looks:
 * the failure mode is silent. If the matcher is too strict, a device that does
 * have a Hindi voice gets the Hindi button greyed out and the user is told to
 * read the line themselves — a regression nobody would notice without a
 * Hindi-capable handset to hand.
 */

export type SpeechLang = "en" | "hi";

export const SPEECH_LANGS: SpeechLang[] = ["en", "hi"];

/** What we ask the platform for. */
export const BCP47: Record<SpeechLang, string> = { en: "en-IN", hi: "hi-IN" };

/**
 * Subtags that count as a match.
 *
 * The Expo docs do not pin the format the platform reports — Android has used
 * "hi-IN", "hi_IN" and three-letter variants across versions — so matching is
 * on the primary subtag against both the ISO 639-1 and 639-2 codes rather than
 * on an exact string.
 */
export const SUBTAGS: Record<SpeechLang, string[]> = {
  en: ["en", "eng"],
  hi: ["hi", "hin"],
};

export function primarySubtag(language: string): string {
  return language.toLowerCase().replace(/_/g, "-").split("-")[0] ?? "";
}

/** Reduce a platform voice list to the languages this product speaks. */
export function matchAvailable(voiceLanguages: Array<string | undefined | null>): Set<SpeechLang> {
  const present = new Set(voiceLanguages.map((l) => primarySubtag(l ?? "")));
  const available = new Set<SpeechLang>();
  for (const lang of SPEECH_LANGS) {
    if (SUBTAGS[lang].some((s) => present.has(s))) available.add(lang);
  }
  return available;
}

/**
 * Why a language's button is disabled, in words a user can act on.
 * `null` means the control is usable.
 */
export function unavailableReason(
  lang: SpeechLang,
  available: Set<SpeechLang> | null,
): string | null {
  if (available === null) return "Checking voices…";
  if (available.has(lang)) return null;
  return lang === "hi" ? "No Hindi voice on this device" : "No English voice on this device";
}
