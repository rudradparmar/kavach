import Anthropic from "@anthropic-ai/sdk";
import type { LlmProvider, ExtractionInput, ExtractionResult, ExtractedFact } from "./provider.js";
import type { FactKey, TranscriptTurn } from "../types.js";

/**
 * Live provider. Note what is NOT here: no prompt asks the model for legal
 * content, and the tool schema gives it nowhere to put any. It returns a
 * scenario id from a fixed enum and facts from a fixed key list. That is all.
 */
/**
 * The model is configuration, not code. It was hardcoded, which meant a
 * retired model id could only be replaced by a code change and redeploy —
 * and the failure would surface as every turn erroring at a police stop.
 * Set KAVACH_ANTHROPIC_MODEL to move; the default tracks the current Sonnet.
 */
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5";

export class AnthropicProvider implements LlmProvider {
  /** Carries the model id so /health, replay and the packet record which model perceived the encounter. */
  readonly name: string;
  private client: Anthropic;
  private model: string;

  constructor(
    apiKey = process.env.ANTHROPIC_API_KEY,
    model = process.env.KAVACH_ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL,
  ) {
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing. Use KAVACH_LLM_PROVIDER=mock for offline runs.");
    this.client = new Anthropic({ apiKey });
    this.model = model;
    this.name = `anthropic:${model}`;
  }

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const tool: Anthropic.Tool = {
      name: "report_situation",
      description: "Report the scenario and any facts you can justify with a verbatim quote from the transcript.",
      input_schema: {
        type: "object",
        properties: {
          scenarioId: {
            type: ["string", "null"],
            enum: [...input.allowedScenarioIds, null],
            description: "The covered scenario this best matches, or null if none fits confidently.",
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          facts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                fact: { type: "string", enum: [...input.allowedFactKeys] },
                value: { description: "yes, no, unknown, a number, or null" },
                evidence: { type: "string", description: "Verbatim words from the transcript that justify this. Required." },
              },
              required: ["fact", "value", "evidence"],
            },
          },
        },
        required: ["scenarioId", "confidence", "facts"],
      } as Anthropic.Tool.InputSchema,
    };

    const system = [
      "You are the perception layer of a rights-information system used during live police encounters in India.",
      "",
      "Your ONLY job is to (1) classify the situation into one of the allowed scenario ids and (2) extract structured facts.",
      "You must NEVER produce legal text, section numbers, advice, or reassurance. Another component does that from a verified corpus.",
      "",
      "Rules:",
      "- Report a fact ONLY if a specific phrase in the transcript justifies it. Put that phrase in `evidence` verbatim.",
      "- If you are inferring rather than reading, do not report the fact. An unreported fact is safe; a wrong fact fires a false accusation of misconduct.",
      "- Report a fact only if it is new or has changed from the known values given.",
      "- A question or a request is not evidence of a fact. \"Why am I being arrested?\" does NOT establish groundsGiven=no; \"Let me call my family\" does NOT establish relativeInformed=no. Report `no` only from an explicit statement that it has not happened or is being prevented.",
      "- Watch negation: \"I am not under arrest\" is arrestAsserted=no; \"no receipt\" is formalChallanOffered=no. A fact reported backwards is worse than one not reported.",
      "- Set confidence below 0.5 whenever the situation is ambiguous. Low confidence is a correct answer.",
      "- Transcripts are noisy, code-mixed Hindi/English, and often incomplete.",
      "",
      `Known facts so far: ${JSON.stringify(input.known)}`,
      `Scenario cues: ${JSON.stringify(input.cues)}`,
    ].join("\n");

    const transcript = input.turns.map((t) => `[${t.index}] ${t.speaker}: ${t.text}`).join("\n");

    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system,
      tools: [tool],
      tool_choice: { type: "tool", name: "report_situation" },
      messages: [{ role: "user", content: `Transcript so far:\n\n${transcript}` }],
    });

    const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!block) return { scenarioId: null, confidence: 0, facts: [] };
    const out = block.input as { scenarioId: string | null; confidence: number; facts: ExtractedFact[] };

    // Belt and braces — the enum should make these impossible, so enforce them.
    const scenarioId =
      out.scenarioId && input.allowedScenarioIds.includes(out.scenarioId) ? out.scenarioId : null;
    const allowed = new Set<string>(input.allowedFactKeys);
    const facts = (out.facts ?? []).filter(
      (f) => allowed.has(f.fact) && typeof f.evidence === "string" && f.evidence.trim().length > 0
    );
    return { scenarioId, confidence: clamp(out.confidence), facts: facts as ExtractedFact[] };
  }

  async narrate(input: { transcript: TranscriptTurn[]; factSummary: string; flagSummary: string }): Promise<string> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 900,
      system: [
        "Write a factual, chronological summary of a police encounter for an advocate reading the file cold.",
        "Describe only what was said and done. Do NOT cite sections, do NOT assess legality, do NOT recommend anything.",
        "The legal analysis is attached separately and was produced by a verified rule engine, not by you.",
        "Plain English. No adjectives about the officer's conduct. Under 250 words.",
      ].join("\n"),
      messages: [
        {
          role: "user",
          content: `Transcript:\n${input.transcript.map((t) => `[${t.index}] ${t.speaker}: ${t.text}`).join("\n")}\n\nFacts recorded:\n${input.factSummary}\n\nFlags raised (for your context only — do not restate the legal reasoning):\n${input.flagSummary}`,
        },
      ],
    });
    return res.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join("\n").trim();
  }
}

const clamp = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

export function makeProvider(): LlmProvider {
  const which = (process.env.KAVACH_LLM_PROVIDER ?? "mock").toLowerCase();
  if (which === "anthropic") return new AnthropicProvider();
  // Lazy import avoids a cycle; mock is the default so the engine always runs.
  throw new Error("use makeProviderAsync()");
}

export async function makeProviderAsync(): Promise<LlmProvider> {
  const which = (process.env.KAVACH_LLM_PROVIDER ?? "mock").toLowerCase();
  if (which === "anthropic") return new AnthropicProvider();

  // Anything unrecognised is a mistake, not a request for the default. This
  // used to fall through to the mock silently, so a typo on a deployed
  // instance left a keyword matcher classifying real encounters with nothing
  // in the logs to say so. stt-service already refuses the same way, and the
  // two behaving differently was itself the bug worth removing.
  if (which !== "mock") {
    throw new Error(
      `Unknown KAVACH_LLM_PROVIDER "${which}". Use "mock" or "anthropic".`,
    );
  }

  const { MockProvider } = await import("./mock.js");
  return new MockProvider();
}

export type { FactKey };
