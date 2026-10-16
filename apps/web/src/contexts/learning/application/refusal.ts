import { z } from 'zod';

/**
 * Learning's refusal vocabulary — ONE list, shared by the catalogue's
 * administration and a learner's own acts, so an interface never meets a
 * reason it has no words for. A refusal is a CATEGORY: it never carries a
 * title, a lesson, an account or anything a person wrote.
 */
export const LEARNING_REFUSAL_REASONS = Object.freeze([
  'denied',
  'invalid',
  'conflict',
  'not-found',
  'duplicate-slug',
  'duplicate-member',
  'limit',
  /** A published Course's syllabus is frozen; return it to draft first. */
  'not-draft',
  /** Publication needs a complete syllabus, or a path at least one Course. */
  'incomplete',
  /** A published LearningPath holds this Course; update that path first. */
  'in-published-path',
  /** The Course is not one this act may name now (not published, not live). */
  'course-unavailable',
  /** The account is not enrolled on that Course. */
  'not-enrolled',
  'rate-limited',
  'unavailable',
  /* ---- Phase 23 ------------------------------------------------------ */
  /** Live learning is not activated (no activation row, or none in force). */
  'not-activated',
  /** No live `teaching.perform` grant, or no current scope on the Course named. */
  'not-a-teacher',
  /** A request confirmed into a Booking is withdrawn through the Booking, not deleted. */
  'booked',
  /** Two windows or two sessions of one teacher would overlap. */
  'overlap',
  /** The window is withdrawn, claimed by another Booking, or not the teacher's. */
  'window-unavailable',
  /** The session or Booking is completed or cancelled. */
  'terminal',
  /** The time is in the past, or beyond the scheduling horizon. */
  'past',
  /** The local time does not exist in that zone (a daylight-saving gap). */
  'nonexistent-time',
  /** The local time occurs twice in that zone; a choice is needed. */
  'ambiguous-time',
  /** Not an HTTPS meet.google.com address, or inconsistent with its provider. */
  'invalid-meeting',
  /** The account is not a participant of that session. */
  'not-participant',
  /** A Course cannot leave publication while future classes or confirmed bookings depend on it. */
  'has-classes',
] as const);

export type LearningRefusalReason = (typeof LEARNING_REFUSAL_REASONS)[number];

const REASONS: ReadonlySet<string> = new Set(LEARNING_REFUSAL_REASONS);

export function isLearningRefusalReason(value: unknown): value is LearningRefusalReason {
  return typeof value === 'string' && REASONS.has(value);
}

export class LearningRefusal extends Error {
  constructor(readonly reason: LearningRefusalReason) {
    super(reason);
    this.name = 'LearningRefusal';
  }
}

/** The reason to show for any failure; anything unrecognised is an outage. */
export function learningFailure(error: unknown): LearningRefusalReason {
  if (error instanceof z.ZodError) return 'invalid';
  const reason = (error as { reason?: unknown } | null)?.reason;
  return isLearningRefusalReason(reason) ? reason : 'unavailable';
}

/**
 * Re-throws an adapter refusal as a domain refusal; an outage — a lost
 * connection, a transaction the database could not serialise — stays an
 * outage and is never reported as a rule that said no (DOMAIN_MODEL.md §19.8).
 */
export function asLearningRefusal(error: unknown): never {
  if (error instanceof LearningRefusal) throw error;
  const reason = (error as { reason?: unknown } | null)?.reason;
  if (isLearningRefusalReason(reason)) throw new LearningRefusal(reason);
  throw error;
}
