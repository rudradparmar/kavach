import { detectScript, type TranscribeInput, type TranscribeResult, type TranscriptionProvider } from "./provider.js";

/**
 * Any endpoint that speaks the /v1/audio/transcriptions shape.
 *
 * One implementation covers OpenAI, Groq, and a self-hosted whisper.cpp
 * server. The last one is the reason this is written against the generic shape
 * rather than a vendor SDK: the PRD has an open question about where evidence
 * lives and who can be compelled to produce it, and "the audio never leaves a
 * machine we control" needs to stay reachable without a rewrite.
 */
export class OpenAiCompatibleProvider implements TranscriptionProvider {
  readonly name = "openai-compatible";
  readonly simulated = false;

  constructor(
    private readonly url: string,
    private readonly apiKey: string,
    readonly model: string,
    private readonly timeoutMs = 30_000,
  ) {}

  async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
    const started = Date.now();

    const form = new FormData();
    form.append("file", new File([new Uint8Array(input.audio)], input.filename, { type: input.contentType }));
    form.append("model", this.model);
    // Verbose JSON carries the detected language back, which the client shows.
    form.append("response_format", "verbose_json");
    if (input.language) form.append("language", input.language);
    if (input.prompt) form.append("prompt", input.prompt);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await fetch(this.url, {
        method: "POST",
        headers: this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {},
        body: form,
        signal: controller.signal,
      });
    } catch (e) {
      const aborted = (e as Error)?.name === "AbortError";
      throw new Error(
        aborted ? `Transcription timed out after ${this.timeoutMs}ms.` : `Could not reach the transcription endpoint.`,
      );
    } finally {
      clearTimeout(timer);
    }

    const body = await res.text();
    if (!res.ok) throw new Error(`Transcription endpoint returned ${res.status}: ${body.slice(0, 300)}`);

    let parsed: { text?: string; language?: string };
    try {
      parsed = JSON.parse(body) as { text?: string; language?: string };
    } catch {
      throw new Error("Transcription endpoint returned a response this service could not parse.");
    }

    const text = (parsed.text ?? "").trim();

    return {
      text,
      script: detectScript(text),
      provider: this.name,
      model: this.model,
      language: parsed.language ?? input.language,
      providerMs: Date.now() - started,
      simulated: false,
    };
  }
}

/**
 * Bias text pushing Hindi towards Latin script.
 *
 * Whisper writes Hindi in Devanagari by default, and the engine's classifier
 * cues are all romanised — so "चाबी दो" classifies to the fallback while the
 * identical utterance written "chaabi do" classifies correctly. A prompt is a
 * soft bias, not a guarantee, which is exactly why the response also reports
 * the script it actually got instead of assuming this worked.
 *
 * The real fix is romanised cues in the corpus. This makes the pipeline usable
 * in the meantime and makes the failure visible when it happens.
 */
export const ROMANISATION_PROMPT =
  "Traffic stop in India. Hindi and English are mixed. Write Hindi words in " +
  "Latin script, not Devanagari. Example: chaabi do, paise, challan, thane " +
  "chalo, licence dikhao.";
