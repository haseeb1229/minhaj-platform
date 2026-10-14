import 'server-only';

import { Prisma } from '@prisma/client';

import {
  PERSONAL_LIMITS,
  type PersonalTarget,
  type ReadableTarget,
} from '@minhaj/contracts/personalisation';

/**
 * What Personalisation's adapter halves share: refusal mapping, the typed
 * target columns and bounds. PACKAGE-INTERNAL — only `PersonalDataError`
 * leaves this package, and none of the rest is a capability.
 */

export type Client = Prisma.TransactionClient;

/**
 * A database refusal in Personalisation's vocabulary. It carries a category and
 * never a note, a title, an address or a target.
 */
export class PersonalDataError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'PersonalDataError';
  }
}

/* ===========================================================================
 * Refusals
 * ========================================================================= */

/** The migration's own refusals, by number. */
const THROW_REASONS: ReadonlyMap<number, string> = new Map([[51260, 'denied']]);

const UNIQUE_VIOLATION = 'UniqueConstraintViolation';
const CONSTRAINT_VIOLATIONS: ReadonlySet<string> = new Set([
  'ForeignKeyConstraintViolation',
  'NullConstraintViolation',
]);
const NESTED_KEYS = ['cause', 'meta', 'driverAdapterError', 'originalError', 'info'];
const MAX_VISITED_NODES = 32;

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
 * Every numeric `code`/`number` and every driver `kind` in a wrapped error —
 * STRUCTURED fields only, never message text a stored value could imitate.
 */
function errorFacts(error: unknown): {
  readonly numbers: readonly number[];
  readonly kinds: ReadonlySet<string>;
} {
  const numbers: number[] = [];
  const kinds = new Set<string>();
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
    for (const key of NESTED_KEYS) {
      const value = ownData(current, key);
      if (value !== undefined) pending.push(value);
    }
  }
  return { numbers, kinds };
}

/** A uniqueness collision — the signal an insert race was lost. */
export function isUniqueViolation(error: unknown): boolean {
  const { numbers, kinds } = errorFacts(error);
  return (
    (error as { code?: unknown } | null)?.code === 'P2002' ||
    kinds.has(UNIQUE_VIOLATION) ||
    numbers.includes(2627) ||
    numbers.includes(2601)
  );
}

/**
 * Structured refusals, and only those, become domain answers. A foreign key or
 * CHECK refusal is `invalid` — a target that does not exist, or a value the
 * schema forbids. Anything else — an outage, a permission refusal this
 * principal should never meet — is rethrown and reported as unavailable,
 * never as a rule that was not evaluated.
 */
export function refuse(error: unknown): never {
  if (error instanceof PersonalDataError) throw error;
  const { numbers, kinds } = errorFacts(error);
  for (const number of numbers) {
    const reason = THROW_REASONS.get(number);
    if (reason !== undefined) throw new PersonalDataError(reason);
  }
  if (isUniqueViolation(error)) throw new PersonalDataError('conflict');
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'P2025') throw new PersonalDataError('conflict');
  if (
    code === 'P2003' ||
    code === 'P2004' ||
    numbers.includes(547) ||
    [...kinds].some((kind) => CONSTRAINT_VIOLATIONS.has(kind))
  )
    throw new PersonalDataError('invalid');
  throw error;
}

/* ===========================================================================
 * Typed targets
 * ========================================================================= */

/** The typed columns of one target. Exactly one kind is set. */
export interface TargetColumns {
  readonly articleId: string | null;
  readonly workId: string | null;
  readonly videoId: string | null;
  readonly surahNumber: number | null;
  readonly ayahNumber: number | null;
  readonly hadithCitationId: string | null;
}

export function columnsOf(target: PersonalTarget): TargetColumns {
  return {
    articleId: target.kind === 'article' ? target.id : null,
    workId: target.kind === 'work' ? target.id : null,
    videoId: target.kind === 'video' ? target.id : null,
    surahNumber: target.kind === 'ayah' ? target.surah : null,
    ayahNumber: target.kind === 'ayah' ? target.ayah : null,
    hadithCitationId: target.kind === 'hadith' ? target.id : null,
  };
}

/**
 * The target a row names, read off whichever typed column is set. The kind is
 * INFERRED from the foreign key that holds a value — there is no type column
 * to trust or to forge.
 */
export function targetOf(row: {
  readonly articleId?: string | null;
  readonly workId?: string | null;
  readonly videoId?: string | null;
  readonly surahNumber?: number | null;
  readonly ayahNumber?: number | null;
  readonly hadithCitationId?: string | null;
}): PersonalTarget {
  if (row.articleId) return { kind: 'article', id: row.articleId };
  if (row.workId) return { kind: 'work', id: row.workId };
  if (row.videoId) return { kind: 'video', id: row.videoId };
  if (row.hadithCitationId) return { kind: 'hadith', id: row.hadithCitationId };
  if (row.surahNumber != null && row.ayahNumber != null)
    return { kind: 'ayah', surah: Number(row.surahNumber), ayah: Number(row.ayahNumber) };
  // The CHECK makes this unreachable; a row that reaches it is not ours.
  throw new PersonalDataError('invalid');
}

export function readableOf(row: Parameters<typeof targetOf>[0]): ReadableTarget {
  const target = targetOf(row);
  if (target.kind === 'video') throw new PersonalDataError('invalid');
  return target;
}

/**
 * A SQL predicate matching one target on a table carrying the typed columns,
 * aliased `alias`. Built from the typed value, never from a column name a
 * caller supplied.
 */
export function targetPredicate(target: PersonalTarget, alias: string): Prisma.Sql {
  const column = (name: string) => Prisma.raw(`${alias}.[${name}]`);
  switch (target.kind) {
    case 'article':
      return Prisma.sql`${column('articleId')} = ${target.id}`;
    case 'work':
      return Prisma.sql`${column('workId')} = ${target.id}`;
    case 'video':
      return Prisma.sql`${column('videoId')} = ${target.id}`;
    case 'hadith':
      return Prisma.sql`${column('hadithCitationId')} = ${target.id}`;
    case 'ayah':
      return Prisma.sql`${column('surahNumber')} = ${target.surah} AND ${column('ayahNumber')} = ${target.ayah}`;
  }
}

/** The six typed target columns, selected from `alias`. */
export function targetSelect(alias: string): Prisma.Sql {
  return Prisma.raw(
    ['articleId', 'workId', 'videoId', 'surahNumber', 'ayahNumber', 'hadithCitationId']
      .map((name) => `${alias}.[${name}]`)
      .join(', '),
  );
}

/**
 * The five READABLE target columns — what reading history holds. It has no
 * `videoId`: a video is watched, never read.
 */
export function readableSelect(alias: string): Prisma.Sql {
  return Prisma.raw(
    ['articleId', 'workId', 'surahNumber', 'ayahNumber', 'hadithCitationId']
      .map((name) => `${alias}.[${name}]`)
      .join(', '),
  );
}

export interface TargetRow {
  readonly articleId: string | null;
  readonly workId: string | null;
  readonly videoId: string | null;
  readonly surahNumber: number | null;
  readonly ayahNumber: number | null;
  readonly hadithCitationId: string | null;
}

/* ===========================================================================
 * Bounds and values
 * ========================================================================= */

export function boundedOffset(value: number): number {
  return Math.max(0, Math.min(PERSONAL_LIMITS.offsetMax, Math.trunc(value) || 0));
}

export function bounded(value: number, max: number): number {
  return Math.min(max, Math.max(1, Math.trunc(value) || 1));
}

export function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export function maybeIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

export const PAGE = PERSONAL_LIMITS.page;
