/**
 * Transcription provider interface.
 *
 * This service is perception, and only perception. It turns audio into words.
 * It does not read the corpus, does not know what a scenario is, and never
 * produces a legal claim — that is `kavach-engine`'s job and its alone.
 *
 * The separation is physical rather than a comment in a shared file, because
 * CLAUDE.md's first invariant is that the model never authors a legal claim.
 * An advocate auditing kavach-engine/ should find nothing in it but corpus,
 * deterministic rules, and the guard. A speech model living next to that code
 * would blur exactly the line the invariants exist to hold.
 */

export type Script = "latin" | "devanagari" | "mixed" | "other";

export interface TranscribeInput {
  audio: Buffer;
  /** MIME type as reported by the client, e.g. "audio/m4a". */
  contentType: string;
  /** Filename hint; some providers key their decoder off the extension. */
  filename: string;
  /**
   * BCP-47-ish hint from the client, or null to let the provider detect.
   * Indian roadside speech is routinely Hindi-English code-mixed, so a wrong
   * forced language is worse than none.
   */
  language: string | null;
  /**
   * Bias text passed to providers that accept one. Used to push Hindi output
   * towards Latin script — see romanisation note in openaiCompatible.ts.
   */
  prompt: string | null;
}

export interface TranscribeResult {
  /** Exactly what the provider returned. Never edited, never cleaned up. */
  text: string;
  /** Which script `text` came back in. Drives the client's script warning. */
  script: Script;
  provider: string;
  model: string | null;
  language: string | null;
  /** Wall-clock time spent inside the provider call. */
  providerMs: number;
  /**
   * True when the text is placeholder rather than a real transcription of the
   * audio. The client MUST surface this. A canned transcript silently treated
   * as real speech would produce guidance for a situation that is not
   * happening, which is the worst failure this pipeline can have.
   */
  simulated: boolean;
}

export interface TranscriptionProvider {
  readonly name: string;
  readonly model: string | null;
  /** True when this provider cannot actually hear the audio. */
  readonly simulated: boolean;
  transcribe(input: TranscribeInput): Promise<TranscribeResult>;
}

/* ------------------------------------------------------------------ */
/* Script detection                                                     */
/* ------------------------------------------------------------------ */

const DEVANAGARI = /[ऀ-ॿ]/;
const LATIN = /[A-Za-z]/;

/**
 * Which script the transcript came back in.
 *
 * This matters more than it looks. The engine's classifier cues are all
 * romanised Latin — "chaabi", "paise", "thane chalo" — so a Devanagari
 * transcript of the very same sentence classifies to the fallback instead of
 * the right scenario. Reporting the script lets the client say so rather than
 * silently degrading for the users the product exists for.
 */
export function detectScript(text: string): Script {
  const hasDeva = DEVANAGARI.test(text);
  const hasLatin = LATIN.test(text);
  if (hasDeva && hasLatin) return "mixed";
  if (hasDeva) return "devanagari";
  if (hasLatin) return "latin";
  return "other";
}
