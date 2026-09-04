/**
 * The engine contract, imported rather than copied.
 *
 * These are type-only re-exports resolved through the "@engine/*" path alias
 * in tsconfig.json. Babel erases `export type` entirely, so Metro never tries
 * to resolve ../kavach-engine at runtime — nothing from the engine package is
 * bundled into the app. The point is that the client cannot silently drift
 * from the engine's contract: change GuidanceUpdate in the engine and this
 * app stops typechecking.
 */

export type {
  ActionOption,
  Classification,
  CorpusMeta,
  FactPredicate,
  FlagSeverity,
  GuidanceUpdate,
  IncidentPacket,
  Provision,
  QuotableLine,
  RaisedFlag,
  Scenario,
  SessionState,
  TranscriptTurn,
} from "@engine/types";

import type { CorpusMeta, GuidanceUpdate, Provision, Scenario } from "@engine/types";

/** Mirrors GuardViolation in engine/guard.ts. */
export interface GuardViolation {
  kind: "ungrounded-citation" | "forbidden-phrase" | "missing-disclaimer" | "fallback-cites-law";
  detail: string;
}

/** POST /session/:id/turn — mirrors TurnResult in engine/session.ts. */
export interface TurnResult {
  update: GuidanceUpdate;
  violations: GuardViolation[];
  latencyMs: number;
}

/** POST /session */
export interface SessionCreated {
  sessionId: string;
  corpusVersion: string;
  /**
   * A capability for this one encounter, carried to all three services.
   * Null only when the deployment has auth switched off.
   */
  sessionToken: string | null;
}

/** GET /corpus — everything needed to render the scenarios with no model call. */
export interface CorpusPayload {
  meta: CorpusMeta;
  scenarios: Scenario[];
  fallback: Scenario;
  provisions: Provision[];
}

/** GET /health */
export interface Health {
  ok: boolean;
  provider: string;
  corpusVersion: string;
  corpusStatus: "unverified" | "counsel-reviewed" | "counsel-signed-off";
  scenarios: number;
  rules: number;
  sessions?: number;
  /** false when the engine keeps sessions in memory only. */
  persistence?: { retentionDays: number } | false;
}

export type Speaker = "user" | "officer" | "unknown";
