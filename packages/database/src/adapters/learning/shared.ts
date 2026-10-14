import 'server-only';

import type { Prisma } from '@prisma/client';

/**
 * What the Learning adapter's halves share — refusal mapping, THE PUBLIC RULE
 * and bounds — so the catalogue, the public reader, the learner's own surface
 * and closure cannot disagree about what a stale version, a frozen syllabus or
 * a published Course means.
 *
 * PACKAGE-INTERNAL. Only `LearningDataError` leaves this package; none of the
 * rest is a capability: `Client` is a type the adapter's own transactions use.
 */

export type Client = Prisma.TransactionClient;

/**
 * A database refusal in Learning's own vocabulary. The service maps `reason`
 * onto its refusal list; nothing here carries a title, a lesson or a learner.
 */
export class LearningDataError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'LearningDataError';
  }
}

/* ===========================================================================
 * Refusals
 * ========================================================================= */

/**
 * The migration's own refusals (`THROW 51270`–`51277`), by number. These are
 * the FLOOR beneath the adapter's own checks: the adapter asks each question
 * first, under the lock the question needs, so an operator is told what to do —
 * and a write that slipped past it still meets the same answer here. Read from
 * the STRUCTURED fields the driver populates, never from message text, which a
 * stored value could otherwise imitate.
 */
const THROW_REASONS: ReadonlyMap<number, string> = new Map([
  // A published Course with an incomplete syllabus, or a published path with
  // no Course: both are "finish it before it goes public".
  [51270, 'incomplete'],
  [51274, 'incomplete'],
  // The outline is frozen while public.
  [51271, 'not-draft'],
  // A Course that is not published, met where only a published one may stand:
  // in a published path, under an Enrolment, a request or Progress.
  [51272, 'course-unavailable'],
  [51275, 'course-unavailable'],
  [51276, 'course-unavailable'],
  [51277, 'course-unavailable'],
  [51273, 'in-published-path'],
]);

/**
 * The driver adapter's own constraint categories — a STRUCTURED field it sets
 * on a raw statement's error, which carries no SQL number for these.
 */
const UNIQUE_VIOLATION = 'UniqueConstraintViolation';
const CONSTRAINT_VIOLATIONS: ReadonlySet<string> = new Set([
  'ForeignKeyConstraintViolation',
  'NullConstraintViolation',
]);

/**
 * What meeting a uniqueness rule means, by the TABLE the driver adapter names.
 *
 * SQL Server reports a UNIQUE CONSTRAINT or PRIMARY KEY violation (2627) by its
 * table, and each Learning table below holds exactly one caller-reachable
 * uniqueness:
 *
 *   - a Course's or a path's slug — on the record itself, and on its slug
 *     history when the trigger reserving it meets another record's former slug;
 *   - a path's place: the Course already on the path. Its position key cannot
 *     collide, because places are renumbered under the claimed version;
 *   - a module's or a lesson's position: two writers raced past the version
 *     claim, which the claim makes impossible, so neither silently wins.
 *
 * A duplicate Enrolment, Progress row or trial request is never mapped here:
 * the learner surface treats each as the idempotent answer it is, before this
 * function is reached.
 */
const KEY_REASONS: ReadonlyMap<string, string> = new Map([
  ['dbo.Course', 'duplicate-slug'],
  ['dbo.CourseSlugHistory', 'duplicate-slug'],
  ['dbo.LearningPath', 'duplicate-slug'],
  ['dbo.LearningPathSlugHistory', 'duplicate-slug'],
  ['dbo.LearningPathCourse', 'duplicate-member'],
  ['dbo.CourseModule', 'conflict'],
  ['dbo.Lesson', 'conflict'],
]);

/** Where a structured error fact can sit once Prisma and the driver wrap it. */
const NESTED_KEYS = ['cause', 'meta', 'driverAdapterError', 'originalError', 'info'];

/** Bounded, so a wrapped error cannot cost unbounded work to classify. */
const MAX_VISITED_NODES = 32;

/** One own DATA property — never an accessor, and never one that throws. */
function ownData(record: object, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor !== undefined && 'value' in descriptor
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Every NUMERIC `code` / `number`, every adapter `kind` and every constraint
 * `index` in a wrapped error. A string is never read as an error number —
 * `code` is `'P2010'` on Prisma's error and the SQL number on the driver's —
 * and no message text is read at all.
 */
function errorFacts(error: unknown): {
  readonly numbers: readonly number[];
  readonly kinds: ReadonlySet<string>;
  readonly indexes: readonly string[];
} {
  const numbers: number[] = [];
  const kinds = new Set<string>();
  const indexes: string[] = [];
  const seen = new Set<object>();
  const pending: unknown[] = [error];
  while (pending.length > 0 && seen.size < MAX_VISITED_NODES) {
    const current = pending.shift();
    if (current === null || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    for (const key of ['code', 'number']) {
      const value = ownData(current, key);
      if (typeof value === 'number' && Number.isInteger(value)) numbers.push(value);
    }
    const kind = ownData(current, 'kind');
    if (typeof kind === 'string') kinds.add(kind);
    const constraint = ownData(current, 'constraint');
    if (constraint !== null && typeof constraint === 'object') {
      const index = ownData(constraint, 'index');
      if (typeof index === 'string') indexes.push(index);
    }
    for (const key of NESTED_KEYS) {
      const value = ownData(current, key);
      if (value !== undefined) pending.push(value);
    }
  }
  return { numbers, kinds, indexes };
}

/**
 * Whether the database refused a write on a uniqueness rule — and on nothing
 * the migration numbered first. The signal that an idempotent insert lost a
 * race to its own twin.
 */
export function isUniqueViolation(error: unknown): boolean {
  const { numbers, kinds } = errorFacts(error);
  if (numbers.some((number) => THROW_REASONS.has(number))) return false;
  return (
    (error as { code?: unknown } | null)?.code === 'P2002' ||
    kinds.has(UNIQUE_VIOLATION) ||
    numbers.includes(2627) ||
    numbers.includes(2601)
  );
}

/** The migration refusal a write met, if any — for a learner act that answers `false`. */
export function refusalNumber(error: unknown): number | null {
  return errorFacts(error).numbers.find((number) => THROW_REASONS.has(number)) ?? null;
}

/**
 * Structured database refusals, and ONLY those, become domain answers. A
 * migration refusal is mapped by its number first — the authoritative rule
 * that spoke — then Prisma's classification of a model write, then the driver
 * adapter's constraint category for a raw statement. Everything unrecognised —
 * a deadlock, an outage, a permission refusal this principal should never
 * meet — is rethrown and reported as unavailable, never as a rule that was
 * not evaluated.
 */
export function refuse(error: unknown): never {
  if (error instanceof LearningDataError) throw error;
  const { numbers, kinds, indexes } = errorFacts(error);
  for (const number of numbers) {
    const reason = THROW_REASONS.get(number);
    if (reason !== undefined) throw new LearningDataError(reason);
  }
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'P2002' || kinds.has(UNIQUE_VIOLATION))
    throw new LearningDataError(
      indexes.map((index) => KEY_REASONS.get(index)).find((r) => r !== undefined) ??
        'invalid',
    );
  if (code === 'P2025') throw new LearningDataError('conflict');
  if (
    code === 'P2003' ||
    code === 'P2004' ||
    numbers.includes(547) ||
    [...kinds].some((kind) => CONSTRAINT_VIOLATIONS.has(kind))
  )
    throw new LearningDataError('invalid');
  throw error;
}

/* ===========================================================================
 * The public rule and bounds
 * ========================================================================= */

/**
 * THE PUBLIC PREDICATE, one for both aggregates: a Course or a LearningPath is
 * public when it is `published`. Every public read composes it IN THE QUERY.
 */
export const PUBLISHED = { state: 'published' } as const;

export const RECENTLY_CHANGED = [{ updatedAt: 'desc' }, { id: 'asc' }] as const;

export function boundedOffset(value: number): number {
  return Math.max(0, Math.min(10_000_000, Math.trunc(value) || 0));
}

export function bounded(value: number, max: number): number {
  return Math.min(max, Math.max(1, Math.trunc(value) || 1));
}

/** A batch of identifiers a caller may ask about at once. */
export const TARGET_BATCH = 500;

/**
 * A version no row can hold (`CHECK ([version] > 0)`). An edit that somehow
 * arrived without an expected version conflicts rather than overwriting.
 */
export const UNMATCHABLE_VERSION = 0;

/**
 * Search's opaque stamp. Every catalogue or outline change moves BOTH the
 * version and `updatedAt` of its Course or path, so the pair moves whenever
 * anything a search document reads moves.
 */
export function stampOf(row: {
  readonly version: number;
  readonly updatedAt: Date;
}): string {
  return `${String(row.version)}:${row.updatedAt.toISOString()}`;
}

/** An administrative text match: the slug or any title. Bounded by the schema. */
export function textMatch(text: string | null): object {
  return text === null || text.length === 0
    ? {}
    : {
        OR: [
          { slug: { contains: text } },
          { labels: { some: { title: { contains: text } } } },
        ],
      };
}

export function iso(value: Date): string {
  return value.toISOString();
}
