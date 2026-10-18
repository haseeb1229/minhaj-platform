import { z } from 'zod';

/**
 * Donations' refusal vocabulary — ONE list, shared by every Donations service
 * and by the persistence adapter's data errors, so an interface never meets a
 * reason it has no words for and never shows one it was not meant to.
 *
 * A REFUSAL NAMES A CATEGORY, NEVER CONTENT. No reason carries an amount, a
 * provider reference, a token, an account or a constraint name, so every one
 * is safe to render and to log.
 */

export const DONATIONS_REFUSAL_REASONS = Object.freeze([
  'denied',
  'not-found',
  /** The record changed since it was read (a stale expected version). */
  'conflict',
  'invalid',
  /** That step is not open for the donation, refund or campaign in its current state. */
  'invalid-state',
  /** A campaign is published only with its primary locale's words and a currency. */
  'incomplete',
  /** No more campaigns or currencies may be added. */
  'limit',
  'rate-limited',
  'unavailable',
  /** No activation permits the configured provider scope: online giving is off. */
  'not-activated',
  /** The campaign is not published, so it takes no donation. */
  'campaign-unavailable',
  /** The campaign's policy, or the provider, does not admit that amount or currency. */
  'amount-refused',
  /** The same operation id was already used for a different request. */
  'operation-conflict',
  /** The linked account is closed, so nothing new is linked to it. */
  'account-closed',
  /** More than what remains refundable was asked for. */
  'over-refund',
  /** The payment provider did not answer; nothing was assumed. */
  'provider-unavailable',
  /** This form was already used and its checkout is no longer open. */
  'already-submitted',
] as const);

export type DonationsRefusalReason = (typeof DONATIONS_REFUSAL_REASONS)[number];

const REASONS: ReadonlySet<string> = new Set(DONATIONS_REFUSAL_REASONS);

export class DonationsRefusal extends Error {
  constructor(readonly reason: DonationsRefusalReason) {
    super(reason);
    this.name = 'DonationsRefusal';
  }
}

/** Is this a reason the vocabulary names? */
export function isDonationsRefusalReason(
  value: unknown,
): value is DonationsRefusalReason {
  return typeof value === 'string' && REASONS.has(value);
}

/**
 * A thrown value mapped onto that fixed vocabulary; anything else is
 * `unavailable`. A data error from the adapter carries its reason the same way
 * a refusal does, so the database's second refusal reads like the first.
 */
export function donationsFailure(error: unknown): DonationsRefusalReason {
  if (error instanceof z.ZodError) return 'invalid';
  const reason = (error as { reason?: unknown } | null)?.reason;
  return isDonationsRefusalReason(reason) ? reason : 'unavailable';
}

/**
 * Re-throws an adapter's data error as the refusal it names, and anything
 * unrecognised unchanged — an outage stays an outage, never a made-up reason.
 */
export function asDonationsRefusal(error: unknown): never {
  if (error instanceof DonationsRefusal) throw error;
  const reason = (error as { reason?: unknown } | null)?.reason;
  if (isDonationsRefusalReason(reason)) throw new DonationsRefusal(reason);
  throw error;
}
