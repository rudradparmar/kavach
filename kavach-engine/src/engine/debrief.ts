import type { Corpus } from "../corpus/loader.js";
import type { DebriefAnswer, DebriefState, DebriefWindow, SessionState } from "../types.js";

/**
 * PRD R13 — the post-incident debrief.
 *
 * "Structured questions within 24 hours while memory is fresh, appended to
 * the packet."
 *
 * ## Late answers are kept
 *
 * The window is real and it is shown, because memory genuinely decays and a
 * product that pretends otherwise is lying to the advocate who reads the
 * result. But an answer that arrives on day three is not discarded — it is
 * stored with `afterWindow: true` and the packet says so. Dropping it would
 * throw away the only account of an encounter to protect a property of the
 * account, which is the wrong trade in both directions: the advocate loses
 * the content, and nobody is warned about anything they would not have been
 * warned about by a date stamp.
 *
 * ## What this is not
 *
 * It is not a re-engagement loop. There is no streak, no reminder cadence
 * beyond the one window, and nothing here counts as a metric of use.
 * CLAUDE.md invariant 7.
 */

const HOUR_MS = 60 * 60 * 1000;

export function debriefWindow(c: Corpus, state: SessionState, now = new Date()): DebriefWindow {
  const opens = new Date(state.startedAt);
  const closes = new Date(opens.getTime() + c.debrief.windowHours * HOUR_MS);
  const remaining = (closes.getTime() - now.getTime()) / HOUR_MS;
  return {
    opensAt: opens.toISOString(),
    closesAt: closes.toISOString(),
    open: now.getTime() <= closes.getTime(),
    hoursRemaining: Math.max(0, Math.round(remaining * 10) / 10),
  };
}

export function debriefState(c: Corpus, state: SessionState, now = new Date()): DebriefState {
  const window = debriefWindow(c, state, now);
  const answered = new Set(state.debrief.map((a) => a.questionId));
  const required = c.debrief.questions.filter((q) => !q.optional);
  return {
    sessionId: state.sessionId,
    window,
    questions: c.debrief.questions,
    answers: state.debrief,
    complete: required.every((q) => answered.has(q.id)),
  };
}

export interface DebriefSubmission {
  /** questionId -> answer. Unknown ids are dropped, not stored. */
  answers: Record<string, string>;
}

export interface DebriefResult {
  state: DebriefState;
  /** Question ids in the payload that are not in the corpus. Audit trail. */
  rejected: string[];
}

/**
 * Record answers.
 *
 * The same boundary discipline as the provider boundary in `session.ts`: an
 * id that is not in the corpus is dropped and reported, never stored. A
 * client that invents a question would otherwise be able to put arbitrary
 * text into a document an advocate reads as a structured record.
 */
export function submitDebrief(
  c: Corpus,
  state: SessionState,
  submission: DebriefSubmission,
  now = new Date(),
): DebriefResult {
  const known = new Map(c.debrief.questions.map((q) => [q.id, q]));
  const window = debriefWindow(c, state, now);
  const rejected: string[] = [];

  for (const [questionId, raw] of Object.entries(submission.answers ?? {})) {
    const question = known.get(questionId);
    if (!question) {
      rejected.push(questionId);
      continue;
    }
    const value = typeof raw === "string" ? raw.trim().slice(0, 4000) : "";
    if (value.length === 0) {
      // An emptied answer is a retraction, not a blank record.
      state.debrief = state.debrief.filter((a) => a.questionId !== questionId);
      continue;
    }
    // A choice question that arrives with something not on the list is stored
    // as given rather than coerced: the packet is a record of what the person
    // said, and quietly rounding it to the nearest option is a small lie in a
    // document meant to be relied on.
    const answer: DebriefAnswer = {
      questionId,
      value,
      answeredAt: now.toISOString(),
      afterWindow: !window.open,
    };
    const idx = state.debrief.findIndex((a) => a.questionId === questionId);
    if (idx >= 0) state.debrief[idx] = answer;
    else state.debrief.push(answer);
  }

  return { state: debriefState(c, state, now), rejected };
}
