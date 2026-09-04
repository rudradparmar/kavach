/**
 * Latency instrumentation.
 *
 * PRD Design Principle 4 makes this a correctness property, not a performance
 * goal: "an accurate answer delivered in 40 seconds is a failed answer." The
 * budget is 8s p95, 12s p99, measured tap to first spoken word.
 *
 * Two honesty rules govern this file:
 *
 *   · It measures what it can actually see and says so. The span here ends at
 *     "guidance on screen". The PRD's figure ends at the first spoken word,
 *     and because playback is a deliberate tap, the gap between the two is
 *     mostly the user reaching for the button — not something the client can
 *     honestly time. The synthesis half is measured separately, in
 *     `tts/speech.ts`, and shown beside the control that triggers it.
 *     Reporting the smaller number as if it were the PRD's would be a lie
 *     that gets more comfortable over time.
 *   · The numbers are local and per-session. PRD anti-metrics forbid DAU,
 *     session length and retention; nothing here is sent anywhere, and nothing
 *     here counts how often the product is opened.
 */

export type Phase = "capture" | "transcribe" | "engine" | "render";

export interface TurnTiming {
  /** Where the turn came from. Typed turns skip capture and transcribe. */
  source: "voice" | "text";
  capture: number | null;
  transcribe: number | null;
  engine: number | null;
  /** Everything measured: the user's action to guidance on screen. */
  total: number;
  at: number;
}

/** A running span. Call mark() at each boundary, finish() at the end. */
export class TurnTimer {
  private readonly t0: number;
  private last: number;
  private readonly spans = new Map<Phase, number>();

  constructor(private readonly source: "voice" | "text") {
    this.t0 = Date.now();
    this.last = this.t0;
  }

  mark(phase: Phase): void {
    const now = Date.now();
    this.spans.set(phase, now - this.last);
    this.last = now;
  }

  finish(): TurnTiming {
    return {
      source: this.source,
      capture: this.spans.get("capture") ?? null,
      transcribe: this.spans.get("transcribe") ?? null,
      engine: this.spans.get("engine") ?? null,
      total: Date.now() - this.t0,
      at: this.t0,
    };
  }
}

/** PRD budget, for colouring the readout. Not enforced — reported. */
export const BUDGET_MS = { p95: 8_000, p99: 12_000 } as const;

export function withinBudget(totalMs: number): "ok" | "over-p95" | "over-p99" {
  if (totalMs > BUDGET_MS.p99) return "over-p99";
  if (totalMs > BUDGET_MS.p95) return "over-p95";
  return "ok";
}

/**
 * Percentile over the session's turns.
 *
 * Nearest-rank on a sorted copy. A handful of turns is not a distribution and
 * the readout says so rather than implying a p95 from four samples.
 */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[index] ?? null;
}

export interface LatencySummary {
  count: number;
  lastMs: number | null;
  medianMs: number | null;
  p95Ms: number | null;
  /** False until there are enough turns for a percentile to mean anything. */
  meaningful: boolean;
}

export function summarise(timings: TurnTiming[]): LatencySummary {
  const totals = timings.map((t) => t.total);
  return {
    count: totals.length,
    lastMs: totals.length > 0 ? (totals[totals.length - 1] ?? null) : null,
    medianMs: percentile(totals, 50),
    p95Ms: percentile(totals, 95),
    meaningful: totals.length >= 20,
  };
}
