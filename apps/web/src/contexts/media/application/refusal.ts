import { z } from 'zod';

import type { AssetRejection } from '@minhaj/contracts/platform';

/**
 * Media's refusal vocabulary — ONE list, shared by the administrative service
 * and the file uploads, so an interface never meets a reason it has no words
 * for and never shows one it was not meant to.
 */

export class MediaRefusal extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.reason = reason;
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
  // Phase 12 — photographs.
  'no-image',
  'dimensions',
]);

/** A thrown value mapped onto that fixed vocabulary; anything else is `unavailable`. */
export function mediaFailure(error: unknown): string {
  if (error instanceof z.ZodError) return 'invalid';
  const reason = (error as { reason?: unknown } | null)?.reason;
  return typeof reason === 'string' && FAILURES.has(reason) ? reason : 'unavailable';
}

/**
 * Storage's refusal of an upload, in the words the operator's screen has.
 *
 * A scanner's verdict is Storage's to record, not this screen's to display: an
 * infected or unscannable file is "not cleared", like one still in quarantine.
 * Too many bytes and too many pixels are different mistakes with different
 * remedies, so they keep different words.
 */
export function storageRefusal(rejection: AssetRejection | null): string {
  if (rejection === 'too-large') return 'too-large';
  if (rejection === 'dimensions-too-large') return 'dimensions';
  if (rejection === 'infected' || rejection === 'unscannable') return 'not-cleared';
  return 'unsupported';
}
