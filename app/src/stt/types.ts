/**
 * The speech-to-text boundary.
 *
 * Everything on this side of the line deals in audio. Everything on the other
 * side — the engine, the guidance, the packet — deals in a plain text turn
 * plus a speaker label, and knows nothing about microphones.
 *
 * That boundary is the point. It is why the text composer still exists and
 * still works: it is a second implementation of the same contract, and the
 * offline baseline any STT path has to beat.
 */

export type Script = "latin" | "devanagari" | "mixed" | "other";

/** Mirrors the response of POST /transcribe in stt-service. */
export interface Transcript {
  /** Verbatim provider output. Never edited before the user sees it. */
  text: string;
  script: Script;
  provider: string;
  model: string | null;
  language: string | null;
  providerMs: number;
  totalMs: number;
  bytes: number;
  /**
   * The provider cannot actually hear — this is canned text. Must be shown.
   * Guidance produced from a simulated transcript describes a situation that
   * is not happening, which is the most dangerous thing this pipeline can do.
   */
  simulated: boolean;
  /**
   * The transcript is in a script the engine's classifier cues do not cover,
   * so the guidance below it will fall back. Correct transcript, unusable by
   * the classifier. The user is told which of the two failed.
   */
  classifierScriptMismatch: boolean;
}

export interface SttHealth {
  ok: boolean;
  provider: string;
  model: string | null;
  simulated: boolean;
}

/** A recording ready to be transcribed. */
export interface Recording {
  uri: string;
  /** MIME type; expo-audio writes .m4a by default. */
  contentType: string;
  durationMs: number;
}
