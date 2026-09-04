import * as Speech from "expo-speech";
import { useCallback, useEffect, useRef, useState } from "react";
import { BCP47, matchAvailable, type SpeechLang } from "./languages";

/**
 * Reading the quotable line aloud.
 *
 * This is the highest-risk output in the product. The user does not hear it and
 * act on it privately — they repeat it, out loud, to a police officer. Three
 * things follow from that, and each is enforced below rather than left to the
 * caller:
 *
 *   1. **Never speak unasked.** Playback is always a deliberate tap. A phone
 *      that starts talking by itself mid-encounter is a variable the user
 *      cannot take back, and the officer can hear it too.
 *   2. **Never speak a language the device cannot pronounce.** Android will
 *      happily hand Devanagari to an English engine and produce confident
 *      gibberish. A disabled button that explains itself is a good outcome; a
 *      mangled Hindi line the user then says aloud is not. Availability is
 *      checked, not assumed.
 *   3. **Slow enough to repeat.** The point is for a frightened person to say
 *      the sentence back, not for the phone to sound natural.
 */

export type { SpeechLang } from "./languages";
export { unavailableReason } from "./languages";

/**
 * PRD R3: "spoken slowly enough to repeat". 1.0 is the platform's normal pace,
 * which is comfortably faster than someone can follow and say back under
 * stress. This is tuned for repeatability, not for sounding natural.
 */
const RATE = 0.78;

/** Which of our two languages this device can actually pronounce. */
export async function loadAvailableLanguages(): Promise<Set<SpeechLang>> {
  const available = new Set<SpeechLang>();
  let voices: Speech.Voice[];
  try {
    voices = await Speech.getAvailableVoicesAsync();
  } catch {
    // Some devices reject the query outright. Reporting "none available"
    // disables the buttons with an explanation, which is the safe direction.
    return available;
  }

  for (const lang of matchAvailable(voices.map((v) => v.language))) available.add(lang);
  return available;
}

/** Safe to call when nothing is speaking; the platform behaviour is undocumented. */
export function stopSpeaking(): void {
  try {
    void Speech.stop();
  } catch {
    // Nothing to stop, or the platform objected. Either way there is no
    // recovery to attempt and no reason to surface it.
  }
}

export interface SpeechState {
  /** null while the voice list is still being read. */
  available: Set<SpeechLang> | null;
  /** Which language is being spoken right now, if any. */
  speaking: SpeechLang | null;
  /**
   * Milliseconds from the tap to the platform reporting speech started, for
   * the language last played. This is the only part of the PRD's "time to
   * first spoken word" the client can measure without timing the user.
   */
  startedInMs: number | null;
  error: string | null;
  speak: (lang: SpeechLang, text: string) => void;
  stop: () => void;
}

export function useSpeech(): SpeechState {
  const [available, setAvailable] = useState<Set<SpeechLang> | null>(null);
  const [speaking, setSpeaking] = useState<SpeechLang | null>(null);
  const [startedInMs, setStartedInMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    loadAvailableLanguages().then((set) => {
      if (mounted.current) setAvailable(set);
    });
    return () => {
      mounted.current = false;
      // A line left speaking after the screen is gone is a line being said
      // aloud with nothing on screen to check it against.
      stopSpeaking();
    };
  }, []);

  const stop = useCallback(() => {
    stopSpeaking();
    setSpeaking(null);
  }, []);

  const speak = useCallback((lang: SpeechLang, text: string) => {
    setError(null);
    setStartedInMs(null);

    // Replace rather than queue: tapping the other language should switch to
    // it, not line up behind what is already playing.
    stopSpeaking();

    const t0 = Date.now();
    setSpeaking(lang);

    try {
      Speech.speak(text, {
        language: BCP47[lang],
        rate: RATE,
        pitch: 1.0,
        onStart: () => {
          if (mounted.current) setStartedInMs(Date.now() - t0);
        },
        onDone: () => {
          if (mounted.current) setSpeaking(null);
        },
        onStopped: () => {
          if (mounted.current) setSpeaking(null);
        },
        onError: (e: Error) => {
          if (!mounted.current) return;
          setSpeaking(null);
          setError(e?.message ?? "The device could not speak this line.");
        },
      });
    } catch (e) {
      setSpeaking(null);
      setError((e as Error).message);
    }
  }, []);

  return { available, speaking, startedInMs, error, speak, stop };
}

