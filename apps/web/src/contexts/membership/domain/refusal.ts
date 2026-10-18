import { z } from 'zod';

/**
 * Membership's refusal vocabulary — ONE list, shared by every Membership
 * service, so an interface never meets a reason it has no words for and never
 * shows one it was not meant to.
 *
 * A REFUSAL NAMES A CATEGORY, NEVER CONTENT. No reason carries a type's words,
 * an account, an address or a constraint name, so every one is safe to render
 * and to log.
 */

export const MEMBERSHIP_REFUSAL_REASONS = Object.freeze([
  'denied',
  'not-found',
  /** The record changed since it was read (a stale expected version). */
  'conflict',
  'invalid',
  /** That step is not open for the application, Membership or type in its current state. */
  'invalid-state',
  /** The type is not published, so it takes no application or approval. */
  'type-unavailable',
  /** The account already holds an active Membership of this type. */
  'already-member',
  /** The applicant's account is closed, so nothing more is decided for it. */
  'applicant-closed',
  /** A type is published only with its primary locale's words. */
  'incomplete',
  /** No more types may be created. */
  'limit',
  'rate-limited',
  'unavailable',
] as const);

export type MembershipRefusalReason = (typeof MEMBERSHIP_REFUSAL_REASONS)[number];

const REASONS: ReadonlySet<string> = new Set(MEMBERSHIP_REFUSAL_REASONS);

export class MembershipRefusal extends Error {
  constructor(readonly reason: MembershipRefusalReason) {
    super(reason);
    this.name = 'MembershipRefusal';
  }
}

/** Is this a reason the vocabulary names? */
export function isMembershipRefusalReason(
  value: unknown,
): value is MembershipRefusalReason {
  return typeof value === 'string' && REASONS.has(value);
}

/**
 * A thrown value mapped onto that fixed vocabulary; anything else is
 * `unavailable`. A data error from the adapter carries its reason the same way
 * a refusal does, so the database's second refusal reads like the first.
 */
export function membershipFailure(error: unknown): MembershipRefusalReason {
  if (error instanceof z.ZodError) return 'invalid';
  const reason = (error as { reason?: unknown } | null)?.reason;
  return isMembershipRefusalReason(reason) ? reason : 'unavailable';
}

/**
 * Re-throws an adapter's data error as the refusal it names, and anything
 * unrecognised unchanged — an outage stays an outage, never a made-up reason.
 */
export function asMembershipRefusal(error: unknown): never {
  if (error instanceof MembershipRefusal) throw error;
  const reason = (error as { reason?: unknown } | null)?.reason;
  if (isMembershipRefusalReason(reason)) throw new MembershipRefusal(reason);
  throw error;
}
