/**
 * Which languages a device can actually pronounce.
 *
 * Split out of speech.ts, which imports expo-speech and React, so this can be
 * exercised from a plain Node script. That matters more here than it looks:
 * the failure mode is silent. If the matcher is too strict, a device that does
 * have a Hindi voice gets the Hindi button greyed out and the user is told to
 * read the line themselves — a regression nobody would notice without a
 * Hindi-capable handset to hand.
 *
 * ## Why this table is duplicated from the corpus
 *
 * `corpus/languages.json` is the source of truth and carries the same subtags.
 * This copy exists because the app must know what it can speak before it has
 * ever reached the engine — offline, on first launch, with a cached corpus or
 * none. `app/scripts/units.ts` pins the two together and fails if they drift,
 * which is the mechanism that keeps a duplicate honest.
 *
 * ## The failure this file exists to prevent
 *
 * A language with no voice on the device must produce a **disabled** control,
 * never a fall-through to the platform's substitute. Android hands Devanagari
 * to an English engine and produces confident gibberish — and the user says it
 * out loud to a police officer. The same is true of every script added since:
 * Tamil, Telugu, Bengali and Kannada voices are all absent from many handsets,
 * and absent quietly.
 */

export type SpeechLang = "en" | "hi" | "ta" | "te" | "bn" | "mr" | "kn";

export const SPEECH_LANGS: SpeechLang[] = ["en", "hi", "ta", "te", "bn", "mr", "kn"];

/** What we ask the platform for. */
export const BCP47: Record<SpeechLang, string> = {
  en: "en-IN",
  hi: "hi-IN",
  ta: "ta-IN",
  te: "te-IN",
  bn: "bn-IN",
  mr: "mr-IN",
  kn: "kn-IN",
};

/** The language's own name. What a user should see, in every menu. */
export const ENDONYM: Record<SpeechLang, string> = {
  en: "English",
  hi: "हिन्दी",
  ta: "தமிழ்",
  te: "తెలుగు",
  bn: "বাংলা",
  mr: "मराठी",
  kn: "ಕನ್ನಡ",
};

/** English name, for a disabled-reason string and for logs. */
export const ENGLISH_NAME: Record<SpeechLang, string> = {
  en: "English",
  hi: "Hindi",
  ta: "Tamil",
  te: "Telugu",
  bn: "Bengali",
  mr: "Marathi",
  kn: "Kannada",
};

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
  ta: ["ta", "tam"],
  te: ["te", "tel"],
  bn: ["bn", "ben"],
  mr: ["mr", "mar"],
  kn: ["kn", "kan"],
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
  return `No ${ENGLISH_NAME[lang]} voice on this device`;
}

/** Type guard for a code arriving from the corpus or from storage. */
export function isSpeechLang(code: string): code is SpeechLang {
  return (SPEECH_LANGS as string[]).includes(code);
}
