import { z } from 'zod';

/**
 * Media's refusal vocabulary — ONE list, shared by the administrative service
 * and the audio upload, so an interface never meets a reason it has no words
 * for and never shows one it was not meant to.
 */

export class MediaRefusal extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/** Every answer a Media mutation can give that the interface has words for. */
const FAILURES: ReadonlySet<string> = new Set([
  'denied',
  'invalid',
  'conflict',
  'not-found',
  'duplicate-slug',
  'duplicate-video',
  'duplicate-position',
  'duplicate-member',
  'limit',
  // Phase 11 — audio.
  'no-audio',
  'too-large',
  'unsupported',
  'not-cleared',
]);

/** A thrown value mapped onto that fixed vocabulary; anything else is `unavailable`. */
export function mediaFailure(error: unknown): string {
  if (error instanceof z.ZodError) return 'invalid';
  const reason = (error as { reason?: unknown } | null)?.reason;
  return typeof reason === 'string' && FAILURES.has(reason) ? reason : 'unavailable';
}
