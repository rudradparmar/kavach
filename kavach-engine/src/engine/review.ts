import type { Corpus } from "../corpus/loader.js";
import type { CorpusReview, ReviewItem, Verification } from "../types.js";

/**
 * PRD R6: "A monthly review checks for amendments; provisions unreviewed for
 * 6 months are flagged in-product."
 *
 * `reviewDueAt` has been a field in every corpus file since the schema was
 * written and nothing read it. A governance requirement that nothing reads is
 * a comment.
 *
 * ## The decision that matters here
 *
 * `reviewDueAt: null` means **overdue**, not exempt.
 *
 * Every entry in the corpus currently has it null, because nothing has ever
 * been reviewed. Treating null as "no deadline set" would mean the least
 * reviewed content in the system is the only content that never gets flagged,
 * and the flag would light up for the first time only after someone had
 * already done the work. Inverted exactly wrong. So: something never reviewed
 * is overdue from the moment it exists, and the count of those is reported
 * separately so the difference between "nobody has started" and "this lapsed"
 * stays visible.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** PRD R6 says six months. */
export const REVIEW_INTERVAL_DAYS = 182;

/** Flag before it lapses, not after. */
const DUE_SOON_DAYS = 30;

function itemFor(kind: ReviewItem["kind"], id: string, v: Verification, now: number): ReviewItem {
  const due = v.reviewDueAt ? Date.parse(v.reviewDueAt) : NaN;
  const daysRemaining = Number.isFinite(due) ? Math.floor((due - now) / DAY_MS) : null;
  return { kind, id, status: v.status, reviewDueAt: v.reviewDueAt, daysRemaining };
}

export function reviewCorpus(c: Corpus, at: Date = new Date()): CorpusReview {
  const now = at.getTime();
  const items: ReviewItem[] = [];

  for (const [id, p] of c.provisions) items.push(itemFor("provision", id, p.verification, now));
  for (const [id, s] of c.scenarios) items.push(itemFor("scenario", id, s.verification, now));
  for (const r of c.rules) items.push(itemFor("rule", r.id, r.verification, now));
  for (const r of c.escalation.routes) items.push(itemFor("escalation", r.id, r.verification, now));
  items.push(itemFor("fallback", c.fallback.id, c.fallback.verification, now));

  // null daysRemaining is overdue — see the note above. Sorted worst first so
  // a truncated display shows the thing most in need of attention.
  const overdue = items
    .filter((i) => i.daysRemaining === null || i.daysRemaining < 0)
    .sort((a, b) => (a.daysRemaining ?? -Infinity) - (b.daysRemaining ?? -Infinity));

  const dueSoon = items
    .filter((i) => i.daysRemaining !== null && i.daysRemaining >= 0 && i.daysRemaining <= DUE_SOON_DAYS)
    .sort((a, b) => (a.daysRemaining ?? 0) - (b.daysRemaining ?? 0));

  return {
    checkedAt: at.toISOString(),
    reviewIntervalDays: REVIEW_INTERVAL_DAYS,
    overdue,
    dueSoon,
    neverReviewed: items.filter((i) => i.reviewDueAt === null).length,
    total: items.length,
  };
}

/** One line for a boot banner or a health payload. */
export function describeReview(r: CorpusReview): string {
  if (r.overdue.length === 0 && r.dueSoon.length === 0) {
    return `corpus review: ${r.total} item(s), none overdue`;
  }
  return (
    `corpus review: ${r.overdue.length}/${r.total} overdue` +
    (r.neverReviewed > 0 ? ` (${r.neverReviewed} never reviewed)` : "") +
    (r.dueSoon.length > 0 ? `, ${r.dueSoon.length} due within 30 days` : "")
  );
}
