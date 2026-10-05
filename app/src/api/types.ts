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
  CorpusReview,
  DebriefAnswer,
  DebriefQuestion,
  DebriefState,
  DebriefWindow,
  EscalationGuidance,
  EscalationOption,
  EscalationRoute,
  FactPredicate,
  FlagSeverity,
  GuidanceUpdate,
  IncidentPacket,
  LanguageCode,
  LanguageEntry,
  LocationFix,
  MediaBundle,
  MediaChunkRef,
  OfficerFieldPrompt,
  OfficerRecord,
  PacketSupplement,
  Provision,
  QuotableLine,
  RaisedFlag,
  Scenario,
  SessionState,
  TranscriptTurn,
  TranslationStatus,
} from "@engine/types";

import type {
  CorpusMeta, CorpusReview, DebriefQuestion, DebriefWindow, EscalationGuidance,
  GuidanceUpdate, LanguageCode, LanguageEntry, OfficerFieldPrompt, OfficerRecord,
  Provision, Scenario,
} from "@engine/types";

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

/**
 * GET /corpus — everything needed with no model call and no signal.
 *
 * The offline cards were never the only thing that has to work offline. A
 * person entering a buckle number at the roadside, or writing a complaint on
 * a train afterwards, is in the same position, so the prompts, the routes and
 * the debrief questions are cached alongside the scenarios (PRD R10).
 */
export interface CorpusPayload {
  meta: CorpusMeta;
  scenarios: Scenario[];
  fallback: Scenario;
  provisions: Provision[];
  languages: { default: LanguageCode; launchPair: LanguageCode[]; languages: LanguageEntry[] };
  escalation: { routes: EscalationRouteLike[]; placeholders: Array<{ token: string; filledBy: string; note?: string }> };
  debrief: { windowHours: number; intro: string; questions: DebriefQuestion[] };
  officerCapture: { intro: string; fields: OfficerFieldPrompt[] };
  review: CorpusReview;
}

/** Narrowed locally so this file does not need the route type at value level. */
type EscalationRouteLike = import("@engine/types").EscalationRoute;

/** POST /session/:id/officer (PRD R11). */
export interface OfficerResult {
  officer: OfficerRecord;
  officers: OfficerRecord[];
}

/** GET /session/:id/escalation (PRD R9). */
export interface EscalationResult {
  guidance: EscalationGuidance;
  violations: GuardViolation[];
  /**
   * Routes the output guard withheld, with the reason.
   *
   * Returned rather than dropped: a route that vanishes without explanation
   * looks like the corpus has nothing to offer, when what it actually means
   * is that the corpus has something wrong with it that someone must fix.
   */
  withheld: Array<{ routeId: string; violations: GuardViolation[] }>;
}

/** GET and POST /session/:id/debrief (PRD R13). */
export interface DebriefResponse {
  sessionId: string;
  window: DebriefWindow;
  questions: DebriefQuestion[];
  answers: Array<{ questionId: string; value: string; answeredAt: string; afterWindow: boolean }>;
  complete: boolean;
  intro: string;
  rejected?: string[];
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
  languages?: LanguageCode[];
  escalationRoutes?: number;
  /**
   * PRD R6 — "provisions unreviewed for 6 months are flagged in-product".
   * On /health because that is the one endpoint every client already calls;
   * behind a flag it would be a governance requirement nobody sees.
   */
  corpusReview?: {
    overdue: number;
    dueSoon: number;
    neverReviewed: number;
    total: number;
    reviewIntervalDays: number;
  };
}

export type Speaker = "user" | "officer" | "unknown";
