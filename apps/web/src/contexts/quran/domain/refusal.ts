import { z } from 'zod';

import type { AssetRejection } from '@minhaj/contracts/platform';

/**
 * Quran's refusal vocabulary — ONE list, shared by the administrative service,
 * the canonical service and the recitation upload, so an interface never meets
 * a reason it has no words for and never shows one it was not meant to.
 *
 * A REFUSAL NAMES A CATEGORY, NEVER CONTENT. No reason carries text, a storage
 * key, a constraint name or a scanner signature, so every one of them is safe
 * to render and to log.
 */

export const QURAN_REFUSAL_REASONS = Object.freeze([
  'denied',
  'not-found',
  'conflict',
  'invalid',
  'duplicate-slug',
  /** Publication needs a registered source; only the operator registers one. */
  'source-required',
  /** A published Translation, Transliteration, Tafsir or Tajweed rule has text. */
  'text-required',
  /** A published Recitation has at least one segment with audio. */
  'audio-required',
  /** Tafsir entries or recitation segments of one work may not overlap. */
  'overlap',
  /** A range or an Ayah lies outside the Surah the source defines. */
  'outside-surah',
  'not-cleared',
  'too-large',
  'type-not-allowed',
  'infected',
  'unavailable',
  /** Corpus acceptance materialises an EMPTY canonical store, never another. */
  'corpus-exists',
  /** A canonical correction that would change nothing. */
  'unchanged',
  /** A fixture source never displaces or sits beside approved text. */
  'fixture-over-approved',
] as const);

export type QuranRefusalReason = (typeof QURAN_REFUSAL_REASONS)[number];

const REASONS: ReadonlySet<string> = new Set(QURAN_REFUSAL_REASONS);

export class QuranRefusal extends Error {
  constructor(readonly reason: QuranRefusalReason) {
    super(reason);
    this.name = 'QuranRefusal';
  }
}

/** Is this a reason the vocabulary names? */
export function isQuranRefusalReason(value: unknown): value is QuranRefusalReason {
  return typeof value === 'string' && REASONS.has(value);
}

/**
 * A thrown value mapped onto that fixed vocabulary; anything else is
 * `unavailable`. A data error from the adapter carries its reason the same way
 * a refusal does, so the database's second refusal reads like the first.
 */
export function quranFailure(error: unknown): QuranRefusalReason {
  if (error instanceof z.ZodError) return 'invalid';
  const reason = (error as { reason?: unknown } | null)?.reason;
  return isQuranRefusalReason(reason) ? reason : 'unavailable';
}

/**
 * Re-throws an adapter's data error as the refusal it names, and anything
 * unrecognised unchanged — an outage stays an outage, never a made-up reason.
 */
export function asRefusal(error: unknown): never {
  if (error instanceof QuranRefusal) throw error;
  const reason = (error as { reason?: unknown } | null)?.reason;
  if (isQuranRefusalReason(reason)) throw new QuranRefusal(reason);
  throw error;
}

/**
 * Storage's refusal of an upload, in the words the operator's screen has.
 *
 * Too many bytes, the wrong kind of file and a file the scanner found infected
 * are different mistakes with different remedies, so each keeps its own word;
 * a file the scanner could not decide is "not cleared", like one still in
 * quarantine. The scanner's signature is Storage's record and never shown.
 */
export function storageRefusal(rejection: AssetRejection | null): QuranRefusalReason {
  if (rejection === 'too-large') return 'too-large';
  if (rejection === 'infected') return 'infected';
  if (rejection === 'unscannable') return 'not-cleared';
  if (rejection === 'empty') return 'invalid';
  if (rejection === null) return 'unavailable';
  return 'type-not-allowed';
}
