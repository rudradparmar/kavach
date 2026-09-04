import type { FactKey, Tri, TranscriptTurn } from "../types.js";

/**
 * The ONLY thing a model is allowed to do in this system.
 *
 * It reads the transcript so far and returns (a) which covered scenario this
 * looks like and (b) structured facts it can justify from the words spoken.
 * It never writes legal text, never names a section, never phrases advice.
 * Everything the user hears comes from the corpus.
 */
export interface ExtractionInput {
  turns: TranscriptTurn[];
  /** Scenario ids the model may choose from. Anything else is rejected. */
  allowedScenarioIds: string[];
  /** Cue words per scenario, to steer classification without free reasoning. */
  cues: Record<string, string[]>;
  allowedFactKeys: readonly FactKey[];
  /** Facts already established, so the model only reports changes. */
  known: Partial<Record<FactKey, Tri | number | null>>;
}

export interface ExtractedFact {
  fact: FactKey;
  value: Tri | number | null;
  /** Verbatim snippet from the transcript. Required — no snippet, no fact. */
  evidence: string;
}

export interface ExtractionResult {
  scenarioId: string | null;
  confidence: number;
  facts: ExtractedFact[];
}

export interface LlmProvider {
  readonly name: string;
  extract(input: ExtractionInput): Promise<ExtractionResult>;
  /** Plain-language narrative for the lawyer packet. No legal claims. */
  narrate(input: { transcript: TranscriptTurn[]; factSummary: string; flagSummary: string }): Promise<string>;
}
