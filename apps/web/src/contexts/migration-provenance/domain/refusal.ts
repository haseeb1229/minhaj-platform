import { z } from 'zod';

/**
 * Migration & Provenance's refusal vocabulary — ONE list, shared by every
 * Migration service and by the persistence adapter's data errors, so an
 * operator screen never meets a reason it has no words for.
 *
 * A REFUSAL NAMES A CATEGORY, NEVER CONTENT. No reason carries a URL, a body,
 * a payload, a title or a constraint name, so every one is safe to render and
 * to log.
 */
export const MIGRATION_REFUSAL_REASONS = Object.freeze([
  'denied',
  'invalid',
  'not-found',
  /** The record changed since it was read (a stale expected version). */
  'conflict',
  /** That step is not open for the run, manifest, promotion or record in its current state. */
  'invalid-state',
  /** A real source without its written authorisation reference and date, or a fixture asked to become one. */
  'real-source-not-authorised',
  'source-inactive',
  /** The adapter is not the source's kind or access method, or not the open run's code. */
  'adapter-mismatch',
  /** Another holder's lease on the source's open run is live. */
  'run-busy',
  /** The run is not completed and balanced, so nothing of it may be published. */
  'run-unreconciled',
  /** The revision is invalid or carries personal data, so it cannot be approved. */
  'not-publishable',
  'approval-withdrawn',
  /** The publication target did not answer; nothing was assumed. Resumable. */
  'target-unavailable',
  /** The pair is in two languages: related records, never duplicates. */
  'cross-language',
  /** A host or base URL outside the source's kind of scope: synthetic for a fixture, real `https` for an authorised source. */
  'unsafe-scope',
  /** The Topic named does not exist. */
  'topic-unknown',
  /** The error is not retry-eligible (an access failure, a parse failure, …). */
  'not-retryable',
  /** A source key already registered. */
  'duplicate',
  /** The run's lease passed to another holder while this one worked. */
  'lease-lost',
  /** The database refused a host: a fixture's outside `*.fixture.invalid`, or an authorised source's inside it. */
  'host-refused',
  /**
   * Religious material (Fatwa, Quran) is preserved and reviewed as evidence
   * only: migration never publishes it, and a manifest refuses it.
   */
  'review-only-kind',
  /** The store did not answer; nothing was assumed. */
  'unavailable',
] as const);

export type MigrationRefusalReason = (typeof MIGRATION_REFUSAL_REASONS)[number];

const REASONS: ReadonlySet<string> = new Set(MIGRATION_REFUSAL_REASONS);

function reasonOf(error: unknown): MigrationRefusalReason | null {
  const reason = (error as { reason?: unknown } | null)?.reason;
  return isMigrationRefusalReason(reason) ? reason : null;
}

export class MigrationRefusal extends Error {
  readonly reason: MigrationRefusalReason;

  constructor(reason: MigrationRefusalReason) {
    super(reason);
    this.reason = reason;
    this.name = 'MigrationRefusal';
  }
}

/** Is this a reason the vocabulary names? */
export function isMigrationRefusalReason(
  value: unknown,
): value is MigrationRefusalReason {
  return typeof value === 'string' && REASONS.has(value);
}

/**
 * A thrown value mapped onto that fixed vocabulary; anything else is
 * `unavailable`. A data error from the adapter carries its reason the same way
 * a refusal does, so the database's second refusal reads like the first.
 */
export function migrationFailure(error: unknown): MigrationRefusalReason {
  if (error instanceof z.ZodError) return 'invalid';
  return reasonOf(error) ?? 'unavailable';
}

/**
 * Re-throws an adapter's data error as the refusal it names, and anything
 * unrecognised unchanged — an outage stays an outage, never a made-up reason.
 */
export function asMigrationRefusal(error: unknown): never {
  if (error instanceof MigrationRefusal) throw error;
  const reason = reasonOf(error);
  if (reason !== null) throw new MigrationRefusal(reason);
  throw error;
}
