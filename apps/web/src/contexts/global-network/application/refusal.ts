import { z } from 'zod';

/**
 * Global Network's refusal vocabulary — ONE list, so an interface never meets a
 * reason it has no words for and never shows one it was not meant to.
 */

export class GlobalRefusal extends Error {
  // A declared field, not a parameter property: the migration tooling loads
  // this module under plain Node, whose type stripping refuses those (30-R).
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

/** Every answer a Global mutation can give that the interface has words for. */
const FAILURES: ReadonlySet<string> = new Set([
  'denied',
  'invalid',
  'conflict',
  'not-found',
  'duplicate-slug',
  'duplicate-code',
  'duplicate-contact',
  'duplicate-city',
  'limit',
  // A Region or City never leaves its Country.
  'country-fixed',
  // A Centre cannot change Country while it serves Cities of the old one.
  'served-cities',
]);

/** A thrown value mapped onto that fixed vocabulary; anything else is `unavailable`. */
export function globalFailure(error: unknown): string {
  if (error instanceof z.ZodError) return 'invalid';
  const reason = (error as { reason?: unknown } | null)?.reason;
  return typeof reason === 'string' && FAILURES.has(reason) ? reason : 'unavailable';
}
