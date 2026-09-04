import { detectScript, type TranscribeInput, type TranscribeResult, type TranscriptionProvider } from "./provider.js";

/**
 * A provider that cannot hear.
 *
 * It exists for the same reason kavach-engine ships a mock LLM: the whole
 * pipeline — record, upload, transcribe, turn, guidance — has to be runnable
 * with no API key, no network, and no cost, or it will not get exercised.
 *
 * It is deliberately conspicuous. Every result it returns is marked
 * `simulated: true`, and the text itself says so, so that a canned transcript
 * can never be mistaken on screen for something the officer actually said.
 * PRD Design Principle 3 applied to perception: a confidently wrong transcript
 * is as dangerous as a confidently wrong section number, because everything
 * downstream is built to trust it.
 */
export class MockProvider implements TranscriptionProvider {
  readonly name = "mock";
  readonly model = null;
  readonly simulated = true;

  /**
   * Cycles through the canonical escalation so the client can be driven
   * end-to-end without speaking. Romanised, because that is what the engine's
   * classifier cues match — see detectScript().
   */
  private static readonly SCRIPT = [
    "Licence dikhao. Papers nikalo.",
    "Digital nahi chalega. Chaabi do.",
    "Ab 2000 rupees do aur nikal jao. Challan nahi banega, cash de do.",
    "Nahi dena hai to thane chalo. Station chalo abhi.",
  ];

  private index = 0;

  async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
    const started = Date.now();
    const line = MockProvider.SCRIPT[this.index % MockProvider.SCRIPT.length] ?? "";
    this.index += 1;

    // Length of the audio is the only real signal available, and it is used
    // for nothing except making the shape of the response honest.
    const text = `${line} [SIMULATED — ${input.audio.byteLength} bytes of audio were not transcribed]`;

    return {
      text,
      script: detectScript(text),
      provider: this.name,
      model: this.model,
      language: input.language,
      providerMs: Date.now() - started,
      simulated: true,
    };
  }
}
