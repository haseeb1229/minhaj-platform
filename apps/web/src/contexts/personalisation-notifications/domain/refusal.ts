import { z } from 'zod';

/**
 * Personalisation's refusal vocabulary — a CATEGORY, never content. A refusal
 * never carries a note, a title, an address, a token or a target.
 */
export const PERSONAL_REFUSAL_REASONS = Object.freeze([
  'denied',
  'not-found',
  'conflict',
  'invalid',
  'invalid-state',
  'limit',
  'rate-limited',
  'unavailable',
] as const);

export type PersonalRefusalReason = (typeof PERSONAL_REFUSAL_REASONS)[number];

const REASONS: ReadonlySet<string> = new Set(PERSONAL_REFUSAL_REASONS);

export function isPersonalRefusalReason(value: unknown): value is PersonalRefusalReason {
  return typeof value === 'string' && REASONS.has(value);
}

export class PersonalRefusal extends Error {
  constructor(readonly reason: PersonalRefusalReason) {
    super(reason);
    this.name = 'PersonalRefusal';
  }
}

/** The reason to show for any failure; an outage is `unavailable`. */
export function personalFailure(error: unknown): PersonalRefusalReason {
  if (error instanceof z.ZodError) return 'invalid';
  const reason = (error as { reason?: unknown } | null)?.reason;
  return isPersonalRefusalReason(reason) ? reason : 'unavailable';
}

/**
 * Re-throws an adapter refusal as a domain refusal; an outage stays an outage
 * and is never reported as a rule that said no.
 */
export function asRefusal(error: unknown): never {
  if (error instanceof PersonalRefusal) throw error;
  const reason = (error as { reason?: unknown } | null)?.reason;
  if (isPersonalRefusalReason(reason)) throw new PersonalRefusal(reason);
  throw error;
}
