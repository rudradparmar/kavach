/**
 * Kavach engine — core types.
 *
 * Design rule that governs this whole file: the model never authors a legal
 * claim. The model's only jobs are (a) extract structured facts from a
 * transcript and (b) pick a scenario id. Every provision, every quotable line,
 * every "officer cannot do this" comes out of the versioned corpus verbatim.
 */

export type Jurisdiction = "IN-CENTRAL" | `IN-${string}`;

export type VerificationStatus = "unverified" | "counsel-reviewed" | "counsel-signed-off";

export interface Verification {
  status: VerificationStatus;
  /** Named advocate who signed off. null until someone actually has. */
  advocate: string | null;
  signedOffAt: string | null;
  /** Next review due. PRD R6: flag anything unreviewed for 6 months. */
  reviewDueAt: string | null;
  notes?: string;
}

/**
 * Corpus-level metadata. Lives here rather than in corpus/loader.ts so that a
 * client can import the type without dragging in the loader's node:fs
 * dependency — the Expo app consumes this shape over GET /corpus.
 */
export interface CorpusMeta {
  corpusVersion: string;
  jurisdiction: string;
  builtAt: string;
  signedOffBy: string | null;
  status: string;
  disclaimer: string;
  unverifiedContentWarning: string;
}

export interface Provision {
  /** Stable id used for grounding checks, e.g. "MVA-194D". */
  id: string;
  act: string;
  section: string;
  jurisdiction: Jurisdiction;
  /** One-line plain statement of what the provision does. */
  summary: string;
  /** Primary source only. PRD R6: no blogs, no news, no SEO pages. */
  sourceUrl: string | null;
  verification: Verification;
}

/** A single thing the user can do right now. */
export interface ActionOption {
  id: string;
  /** Imperative, calm, <= 20 words. */
  label: string;
  /** Why this is available, in plain language. */
  rationale: string;
  /** Ranked 1 = safest. Exactly one option per set carries safest: true. */
  rank: number;
  safest: boolean;
  /** Consequence the user should understand before choosing. */
  tradeoff: string | null;
  /** Facts that must hold for this option to be offered at all. */
  requires?: FactPredicate[];
}

export interface QuotableLine {
  en: string;
  hi: string;
}

export interface Scenario {
  id: string;
  title: string;
  jurisdiction: Jurisdiction;
  /** Free-text cues used only to help the classifier. Never shown to a user. */
  classifierCues: string[];
  provisionIds: string[];
  officerCan: string[];
  officerCannot: string[];
  quotableLine: QuotableLine;
  doNotSay: string[];
  /** The single most important thing to capture right now. */
  documentNow: string;
  options: ActionOption[];
  verification: Verification;
}

/* ------------------------------------------------------------------ */
/* Situation state — what the engine believes is true, right now.      */
/* ------------------------------------------------------------------ */

/**
 * Every fact is tri-state. "unknown" is load-bearing: a rule must never fire
 * because a fact defaulted to false. PRD Design Principle 3.
 */
export type Tri = "yes" | "no" | "unknown";

export interface SituationFacts {
  // Who and where
  officerIdentified: Tri;
  officerInUniform: Tri;
  femaleOfficerPresent: Tri;
  userIsFemale: Tri;
  inPublicPlace: Tri;
  isNight: Tri;

  // Traffic branch
  vehicleStopped: Tri;
  helmetWorn: Tri;
  licenceHeld: Tri;          // does the user hold a licence at all
  licenceCarried: Tri;       // is it physically on them
  documentsProduced: Tri;
  keysTaken: Tri;
  vehicleBlocked: Tri;
  cashDemanded: Tri;
  amountDemanded: number | null;
  formalChallanOffered: Tri;

  // Detention / arrest branch
  askedToComeToStation: Tri;
  arrestAsserted: Tri;
  groundsGiven: Tri;
  noticeUnderS35Given: Tri;
  relativeInformed: Tri;
  producedBeforeMagistrate: Tri;
  detentionStartedAt: string | null;

  // Search / phone branch
  searchRequested: Tri;
  searchBegun: Tri;
  phoneDemanded: Tri;
  unlockDemanded: Tri;
  seizureMemoOffered: Tri;

  // Protest branch
  dispersalOrderGiven: Tri;
  orderUnderS163Cited: Tri;
  assemblyPeaceful: Tri;
  forceUsed: Tri;
}

export type FactKey = keyof SituationFacts;

export interface FactPredicate {
  fact: FactKey;
  /** eq is the only operator for Tri facts; gt/lt only for numeric facts. */
  op: "eq" | "neq" | "gt" | "lt";
  value: Tri | number | null;
}

export interface FactObservation {
  fact: FactKey;
  value: Tri | number | null;
  /** Which transcript turn produced this. Every fact is traceable. */
  turnIndex: number;
  /** Verbatim snippet that justified it. Goes into the lawyer packet. */
  evidence: string;
  at: string;
}

/* ------------------------------------------------------------------ */
/* Misconduct rules                                                     */
/* ------------------------------------------------------------------ */

export type FlagSeverity = "info" | "irregular" | "unlawful";

export interface MisconductRule {
  id: string;
  /** All predicates must hold. No "unknown" ever satisfies a predicate. */
  when: FactPredicate[];
  severity: FlagSeverity;
  /** Plain statement of what appears to be wrong. Corpus text, not generated. */
  statement: string;
  provisionIds: string[];
  /** What the user should do about it, if anything, right now. */
  optionIds: string[];
  verification: Verification;
}

export interface RaisedFlag {
  ruleId: string;
  severity: FlagSeverity;
  statement: string;
  provisionIds: string[];
  raisedAtTurn: number;
  at: string;
  /** The observations that caused it to fire — the audit trail. */
  basis: FactObservation[];
}

/* ------------------------------------------------------------------ */
/* Session                                                              */
/* ------------------------------------------------------------------ */

export interface TranscriptTurn {
  index: number;
  speaker: "user" | "officer" | "unknown";
  text: string;
  at: string;
}

export interface Classification {
  scenarioId: string | null;
  confidence: number;
  /** True when confidence is below threshold — engine falls back to universal safe actions. */
  fallback: boolean;
}

/** What the client renders after each turn. */
export interface GuidanceUpdate {
  turnIndex: number;
  at: string;
  changed: boolean;
  changeReason: string | null;
  scenarioId: string | null;
  scenarioTitle: string | null;
  fallback: boolean;
  quotableLine: QuotableLine | null;
  doNotSay: string[];
  documentNow: string | null;
  options: ActionOption[];
  newFlags: RaisedFlag[];
  provisionsCited: Provision[];
  /** PRD R7 — always present, never suppressible. */
  disclaimer: string;
  corpusVersion: string;
}

export interface SessionState {
  sessionId: string;
  startedAt: string;
  corpusVersion: string;
  jurisdiction: Jurisdiction;
  turns: TranscriptTurn[];
  facts: SituationFacts;
  observations: FactObservation[];
  classifications: Classification[];
  currentScenarioId: string | null;
  flags: RaisedFlag[];
  updates: GuidanceUpdate[];
  /** Anything the provider returned that the engine refused. Audit trail. */
  rejectedByBoundary: Array<{ turnIndex: number; detail: string }>;
}

/* ------------------------------------------------------------------ */
/* Lawyer packet (PRD R8)                                               */
/* ------------------------------------------------------------------ */

export interface IncidentPacket {
  sessionId: string;
  generatedAt: string;
  corpusVersion: string;
  durationSeconds: number;
  timeline: Array<{ at: string; kind: "turn" | "flag" | "scenario-change"; detail: string }>;
  factsEstablished: Array<{ fact: FactKey; value: Tri | number | null; evidence: string; at: string }>;
  scenariosTraversed: Array<{ scenarioId: string; title: string; fromTurn: number }>;
  flags: RaisedFlag[];
  provisionsSurfaced: Provision[];
  transcript: TranscriptTurn[];
  /** Plain-language narrative. The ONLY generated prose in the packet. */
  narrative: string;
  unverifiedContentWarning: string | null;
}
