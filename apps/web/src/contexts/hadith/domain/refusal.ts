import { z } from 'zod';

/**
 * Hadith's refusal vocabulary — ONE list, shared by the administrative service
 * and the canonical service, so an interface never meets a reason it has no
 * words for and never shows one it was not meant to.
 *
 * A REFUSAL NAMES A CATEGORY, NEVER CONTENT. No reason carries text, a source
 * reference, a constraint name or a grader, so every one of them is safe to
 * render and to log.
 */

export const HADITH_REFUSAL_REASONS = Object.freeze([
  'denied',
  'not-found',
  'conflict',
  'invalid',
  'duplicate-slug',
  /** A source reference or a structural position already taken in its edition or book. */
  'duplicate-reference',
  /** Publication needs a registered source; only the operator registers one. */
  'source-required',
  /** A published Translation, Commentary or Science has text. */
  'text-required',
  /** A canonical write or verification that would change nothing. */
  'unchanged',
  /** A book, chapter or edition that does not belong where the record places it. */
  'structure-mismatch',
  /** A record a citation names keeps the citation number it declared. */
  'citation-kept',
  /** A citation names only a record that declared its number. */
  'not-candidate',
  /** Conflict evidence stands against the citation; nothing is chosen silently. */
  'citation-conflicted',
  /** A citation names only a record verified at its current version. */
  'not-verified',
  /** A fixture source never displaces or sits beside approved text. */
  'fixture-over-approved',
  'unavailable',
] as const);

export type HadithRefusalReason = (typeof HADITH_REFUSAL_REASONS)[number];

const REASONS: ReadonlySet<string> = new Set(HADITH_REFUSAL_REASONS);

export class HadithRefusal extends Error {
  constructor(readonly reason: HadithRefusalReason) {
    super(reason);
    this.name = 'HadithRefusal';
  }
}

/** Is this a reason the vocabulary names? */
export function isHadithRefusalReason(value: unknown): value is HadithRefusalReason {
  return typeof value === 'string' && REASONS.has(value);
}

/**
 * A thrown value mapped onto that fixed vocabulary; anything else is
 * `unavailable`. A data error from the adapter carries its reason the same way
 * a refusal does, so the database's second refusal reads like the first.
 */
export function hadithFailure(error: unknown): HadithRefusalReason {
  if (error instanceof z.ZodError) return 'invalid';
  const reason = (error as { reason?: unknown } | null)?.reason;
  return isHadithRefusalReason(reason) ? reason : 'unavailable';
}

/**
 * Re-throws an adapter's data error as the refusal it names, and anything
 * unrecognised unchanged — an outage stays an outage, never a made-up reason.
 */
export function asRefusal(error: unknown): never {
  if (error instanceof HadithRefusal) throw error;
  const reason = (error as { reason?: unknown } | null)?.reason;
  if (isHadithRefusalReason(reason)) throw new HadithRefusal(reason);
  throw error;
}
