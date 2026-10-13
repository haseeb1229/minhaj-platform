import { z } from 'zod';

/**
 * Fatwa's refusal vocabulary — ONE list, shared by every Fatwa service, so an
 * interface never meets a reason it has no words for and never shows one it
 * was not meant to.
 *
 * A REFUSAL NAMES A CATEGORY, NEVER CONTENT. No reason carries a question, a
 * ruling, a note, a constraint name or an account, so every one of them is safe
 * to render and to log.
 */

export const FATWA_REFUSAL_REASONS = Object.freeze([
  'denied',
  'not-found',
  'conflict',
  'invalid',
  /** The service is not activated: no question is accepted, nothing is published. */
  'inactive',
  /** That step is not open for the question or ruling in its current state. */
  'invalid-state',
  /** Only a current `fatwa.answer` holder who is not the asker can be assigned. */
  'invalid-assignee',
  /** The category does not exist or is archived. */
  'invalid-category',
  /** A published ruling keeps its address. */
  'slug-frozen',
  'duplicate-slug',
  /** The author of a revision, or the asker, cannot publish it. */
  'self-publication',
  /** A correction states its public reason; a first draft does not. */
  'correction-reason',
  /** Publication and withdrawal need `fatwa.publish` and a live `fatwa-publication` step-up. */
  'step-up-required',
  /** Too many questions too quickly. */
  'rate-limited',
  'unavailable',
] as const);

export type FatwaRefusalReason = (typeof FATWA_REFUSAL_REASONS)[number];

const REASONS: ReadonlySet<string> = new Set(FATWA_REFUSAL_REASONS);

export class FatwaRefusal extends Error {
  constructor(readonly reason: FatwaRefusalReason) {
    super(reason);
    this.name = 'FatwaRefusal';
  }
}

/** Is this a reason the vocabulary names? */
export function isFatwaRefusalReason(value: unknown): value is FatwaRefusalReason {
  return typeof value === 'string' && REASONS.has(value);
}

/**
 * A thrown value mapped onto that fixed vocabulary; anything else is
 * `unavailable`. A data error from the adapter carries its reason the same way
 * a refusal does, so the database's second refusal reads like the first.
 */
export function fatwaFailure(error: unknown): FatwaRefusalReason {
  if (error instanceof z.ZodError) return 'invalid';
  const reason = (error as { reason?: unknown } | null)?.reason;
  return isFatwaRefusalReason(reason) ? reason : 'unavailable';
}

/**
 * Re-throws an adapter's data error as the refusal it names, and anything
 * unrecognised unchanged — an outage stays an outage, never a made-up reason.
 */
export function asRefusal(error: unknown): never {
  if (error instanceof FatwaRefusal) throw error;
  const reason = (error as { reason?: unknown } | null)?.reason;
  if (isFatwaRefusalReason(reason)) throw new FatwaRefusal(reason);
  throw error;
}
