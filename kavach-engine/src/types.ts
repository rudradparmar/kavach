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

/* ------------------------------------------------------------------ */
/* Languages (PRD R12)                                                  */
/* ------------------------------------------------------------------ */

/**
 * Every language the corpus can carry a quotable line in.
 *
 * `en` and `hi` are the launch pair PRD R3 names. The rest are R12. The union
 * is closed on purpose: a language reaches a user only by being added here,
 * to `corpus/languages.json`, and to the client's voice table — three places
 * that each fail loudly rather than one that fails silently.
 */
export type LanguageCode = "en" | "hi" | "ta" | "te" | "bn" | "mr" | "kn";

/**
 * How a line in a given language came to exist.
 *
 * `source` is the language the line was written in. `unreviewed` is a rendering
 * of it that no advocate has read. Nothing claims *how* a rendering was
 * produced, because the only thing that matters to a user is whether a lawyer
 * has signed it.
 */
export type TranslationStatus = "source" | "unreviewed" | "counsel-reviewed";

export interface LanguageEntry {
  code: LanguageCode;
  /** English name, for logs and developer surfaces. */
  name: string;
  /** The language's own name, which is what a user should see. */
  endonym: string;
  /** What the platform is asked for when synthesising speech. */
  bcp47: string;
  /** Subtags that count as a match on a device voice list. */
  subtags: string[];
  script: string;
}

/**
 * The quotable line, per language.
 *
 * `en` and `hi` stay required so nothing that already reads `.en` / `.hi` has
 * to change and so a scenario can never ship without the launch pair.
 */
export type QuotableLine = { en: string; hi: string } & Partial<
  Record<Exclude<LanguageCode, "en" | "hi">, string>
>;

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
  /**
   * Per-language review state for `quotableLine`. Absent means the same thing
   * as `unreviewed` — the honest default, since nothing here is signed.
   */
  translationStatus?: Partial<Record<LanguageCode, TranslationStatus>>;
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
  /** PRD R11 — what the user managed to record about who stopped them. */
  officers: OfficerRecord[];
  /** PRD R13 — answered after the encounter, appended to the packet. */
  debrief: DebriefAnswer[];
}

/* ------------------------------------------------------------------ */
/* Officer detail capture (PRD R11)                                     */
/* ------------------------------------------------------------------ */

/**
 * Who stopped them.
 *
 * Every field is user-entered and nullable, and the record says so. The corpus
 * repeatedly tells a user that the officer's identity is the fact most often
 * missing later; before this existed the product said that while giving them
 * nowhere to put it, and R8's packet had an officer section with nothing in it.
 *
 * Nothing here is inferred. The engine does not guess a name out of the
 * transcript and never will: a guessed attribution in an advocate's packet is
 * worse than a blank, because it looks like evidence.
 */
export interface OfficerRecord {
  id: string;
  name: string | null;
  buckleNumber: string | null;
  rank: string | null;
  station: string | null;
  vehicleNumber: string | null;
  unit: string | null;
  /** Free text: what they looked like, what they were wearing, how many there were. */
  description: string | null;
  /** Always "user". Present so the packet can state provenance rather than imply it. */
  source: "user";
  recordedAt: string;
  updatedAt: string;
}

/** One prompt on the guided capture form. Corpus content — the client renders it. */
export interface OfficerFieldPrompt {
  field: Exclude<keyof OfficerRecord, "id" | "source" | "recordedAt" | "updatedAt">;
  label: string;
  /** Placeholder / example, so the user knows what shape of thing is wanted. */
  hint: string;
  /** Why it matters later. Plain language, no legal claim. */
  why: string;
  /** Rough order of usefulness to an advocate. 1 is most useful. */
  priority: number;
  keyboard: "default" | "numeric";
}

/* ------------------------------------------------------------------ */
/* Escalation guidance (PRD R9)                                         */
/* ------------------------------------------------------------------ */

export interface EscalationAuthority {
  /** e.g. "Police complaint authority for the district". */
  name: string;
  /** Which layer this sits at, for a user deciding where to start. */
  level: "station" | "district" | "state" | "national" | "court" | "other";
  /** Concrete routes in. Corpus text, never generated. */
  howToReach: string[];
  /** What the body can actually do about it, stated plainly. */
  remit: string;
}

export interface EscalationDeadline {
  /** Days from the incident, when the corpus states one. null when it does not. */
  days: number | null;
  /** The deadline in words, including "no fixed statutory deadline" where true. */
  text: string;
}

/**
 * One route a complaint can take.
 *
 * Selected deterministically from the scenarios traversed and the flags raised
 * — never chosen by a model. The draft is filled from the session record by
 * substitution only; no prose about the incident is generated here.
 */
export interface EscalationRoute {
  id: string;
  title: string;
  jurisdiction: Jurisdiction;
  /** Matches on either. An empty list on both makes the route universal. */
  appliesToScenarioIds: string[];
  appliesToFlagIds: string[];
  authority: EscalationAuthority;
  deadline: EscalationDeadline;
  /** What the complaint has to contain to be actionable. */
  requiredContents: string[];
  /** Things that make a complaint fail, stated as cautions rather than advice. */
  cautions: string[];
  provisionIds: string[];
  /**
   * The editable draft, with `{{placeholders}}` the engine fills from the
   * session. Anything it cannot fill becomes a visible blank the user
   * completes, never an invented value.
   */
  draftTemplate: string;
  verification: Verification;
}

/** A route with its draft rendered against one session. */
export interface EscalationOption {
  route: EscalationRoute;
  /** Why this route was offered — the scenario ids and flag ids that matched. */
  because: string[];
  /** `draftTemplate` with the session's values substituted. */
  draft: string;
  /** Placeholders the session could not fill; left blank in `draft`. */
  unfilled: string[];
  provisions: Provision[];
}

export interface EscalationGuidance {
  sessionId: string;
  generatedAt: string;
  corpusVersion: string;
  /** Ordered: most specific match first, universal routes last. */
  options: EscalationOption[];
  /** Shown above everything. PRD R7. */
  disclaimer: string;
  unverifiedContentWarning: string | null;
}

/* ------------------------------------------------------------------ */
/* Post-incident debrief (PRD R13)                                      */
/* ------------------------------------------------------------------ */

export interface DebriefQuestion {
  id: string;
  prompt: string;
  kind: "text" | "yesno" | "choice";
  choices?: string[];
  /** Why this is being asked. The user is entitled to know before answering. */
  why: string;
  /** Marks the "did the guidance match what happened?" question (PRD R6 metric). */
  accuracySignal?: boolean;
  optional?: boolean;
}

export interface DebriefAnswer {
  questionId: string;
  value: string;
  answeredAt: string;
  /**
   * True when this arrived after the 24-hour window closed. Late answers are
   * kept, never dropped — memory fades but a late account is still an account,
   * and an advocate can weigh it if the packet says which it is.
   */
  afterWindow: boolean;
}

export interface DebriefWindow {
  opensAt: string;
  closesAt: string;
  open: boolean;
  hoursRemaining: number;
}

export interface DebriefState {
  sessionId: string;
  window: DebriefWindow;
  questions: DebriefQuestion[];
  answers: DebriefAnswer[];
  complete: boolean;
}

/* ------------------------------------------------------------------ */
/* Corpus review state (PRD R6)                                         */
/* ------------------------------------------------------------------ */

export interface ReviewItem {
  kind: "provision" | "scenario" | "rule" | "escalation" | "fallback";
  id: string;
  status: VerificationStatus;
  reviewDueAt: string | null;
  /** Days until due; negative when overdue. null when nothing has ever been reviewed. */
  daysRemaining: number | null;
}

/**
 * PRD R6: "provisions unreviewed for 6 months are flagged in-product".
 *
 * Something never reviewed at all is overdue, not exempt. `reviewDueAt: null`
 * on an unverified item therefore counts as overdue rather than as "no
 * deadline" — the alternative is that the least-reviewed content is the only
 * content that never gets flagged.
 */
export interface CorpusReview {
  checkedAt: string;
  reviewIntervalDays: number;
  overdue: ReviewItem[];
  dueSoon: ReviewItem[];
  neverReviewed: number;
  total: number;
}

/* ------------------------------------------------------------------ */
/* Location and media (PRD R4, R8)                                      */
/* ------------------------------------------------------------------ */

/**
 * One position fix, as recorded by the evidence service alongside a chunk.
 *
 * The engine never collects these itself and never calls the evidence service
 * — the two are separately deployable and that separation is the point. They
 * reach a packet only because the client, which holds a capability for both,
 * supplies them. The packet says so.
 */
export interface LocationFix {
  at: string;
  latitude: number;
  longitude: number;
  /** Which audio chunk this fix arrived with, so the trail lines up with the audio. */
  seq: number | null;
}

/** One stored chunk, as the evidence service describes it. */
export interface MediaChunkRef {
  seq: number;
  receivedAt: string;
  capturedAt: string | null;
  sha256: string;
  bytes: number;
  mime: string;
}

export interface MediaBundle {
  /** Where the bytes actually live. Not a link the packet can guarantee. */
  serviceLabel: string;
  chunks: MediaChunkRef[];
  totalBytes: number;
  firstReceivedAt: string | null;
  lastReceivedAt: string | null;
}

/** Everything the client can add to a packet that the engine cannot see. */
export interface PacketSupplement {
  locationTrail?: LocationFix[];
  mediaBundle?: MediaBundle;
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
  /** PRD R11 — user-entered, never inferred. Empty when nothing was recorded. */
  officers: OfficerRecord[];
  /** PRD R13 — answers given after the encounter. */
  debrief: DebriefAnswer[];
  debriefQuestions: DebriefQuestion[];
  /**
   * PRD R8 "location trail" and "media bundle". Both come from the evidence
   * service via the client; the engine never fetches them. `null` means not
   * supplied, which the packet renders as "not supplied" rather than "none" —
   * an advocate reading an empty section must be able to tell the difference
   * between no audio existing and no audio being handed over.
   */
  locationTrail: LocationFix[] | null;
  mediaBundle: MediaBundle | null;
  /** PRD R6 — the review state of the corpus that produced this packet. */
  corpusReview: CorpusReview;
  unverifiedContentWarning: string | null;
}
