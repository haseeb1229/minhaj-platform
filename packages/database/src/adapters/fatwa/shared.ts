import 'server-only';

import { createHash } from 'node:crypto';

import { Prisma } from '@prisma/client';

import {
  FATWA_MAX_OFFSET,
  type FatwaAuthority,
  type FatwaCategoryName,
} from '@minhaj/contracts/fatwa';

/**
 * What the Fatwa adapter's halves share — refusal mapping, the live-permission
 * predicate, THE PUBLIC RULE, bounds and the search stamp — so the public
 * reader, the staff reader and the workflow cannot disagree about what a stale
 * version, a current holder or a public ruling means.
 *
 * PACKAGE-INTERNAL. Only `FatwaDataError` leaves this package; none of the rest
 * is a capability: `Client` is a type the adapter's own transactions use.
 */

export type Client = Prisma.TransactionClient;

/**
 * A database refusal in Fatwa's own vocabulary. The service maps `reason` onto
 * its refusal list; nothing here carries a question, a ruling or a name.
 */
export class FatwaDataError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'FatwaDataError';
  }
}

/* ===========================================================================
 * Refusals
 * ========================================================================= */

/**
 * The migration's own refusals (`THROW 51230`–`51248`), by number, as the
 * context's vocabulary. Read from the STRUCTURED fields the driver populates —
 * never from message text, which a stored value could otherwise imitate.
 */
const THROW_REASONS: ReadonlyMap<number, string> = new Map([
  // The activation is the operator's and immutable; meeting it here means a
  // write outside the runtime's contract.
  [51230, 'denied'],
  [51231, 'inactive'],
  // An asker who is not an active account is refused like any other actor.
  [51232, 'denied'],
  [51233, 'denied'],
  [51234, 'denied'],
  [51235, 'step-up-required'],
  [51236, 'not-found'],
  [51237, 'conflict'],
  [51238, 'invalid-state'],
  [51239, 'invalid-assignee'],
  [51240, 'invalid-category'],
  [51241, 'slug-frozen'],
  [51242, 'denied'],
  [51243, 'self-publication'],
  // Naming a revision other than the one awaiting the step is a stale read.
  [51244, 'conflict'],
  [51245, 'correction-reason'],
  [51246, 'denied'],
  [51247, 'invalid'],
  [51248, 'denied'],
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
 * What meeting a uniqueness rule means. SQL Server names a UNIQUE CONSTRAINT or
 * PRIMARY KEY violation (2627) by its TABLE. A ruling's caller-chosen unique
 * value is its slug — its id is generated and its question is locked by the
 * procedure before the insert — and a category's is its slug likewise.
 * Every other table's keys are generated, so a collision there is `invalid`.
 */
const KEY_REASONS: ReadonlyMap<string, string> = new Map([
  ['dbo.Fatwa', 'duplicate-slug'],
  ['dbo.FatwaCategory', 'duplicate-slug'],
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
 * `index` in a wrapped error. A string is never read as an error number and no
 * message text is read at all, so a stored value cannot impersonate a refusal.
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
 * Structured database refusals, and ONLY those, become domain answers: a
 * migration refusal by its number first, then Prisma's classification of a
 * model write, then the driver adapter's constraint category for a raw
 * statement (a CHECK and a foreign key both arrive as 547 → `invalid`).
 * Everything unrecognised — a permission refusal (229) this principal should
 * never meet, an outage — is rethrown unchanged and reported as unavailable,
 * never as a rule that was not evaluated.
 */
export function refuse(error: unknown): never {
  if (error instanceof FatwaDataError) throw error;
  const { numbers, kinds, indexes } = errorFacts(error);
  for (const number of numbers) {
    const reason = THROW_REASONS.get(number);
    if (reason !== undefined) throw new FatwaDataError(reason);
  }
  const known = error as { code?: unknown } | null;
  if (known?.code === 'P2002' || kinds.has(UNIQUE_VIOLATION))
    throw new FatwaDataError(
      indexes.map((index) => KEY_REASONS.get(index)).find((r) => r !== undefined) ??
        'invalid',
    );
  if (known?.code === 'P2025') throw new FatwaDataError('conflict');
  if (
    known?.code === 'P2003' ||
    known?.code === 'P2004' ||
    [...kinds].some((kind) => CONSTRAINT_VIOLATIONS.has(kind))
  )
    throw new FatwaDataError('invalid');
  throw error;
}

/* ===========================================================================
 * Bounds
 * ========================================================================= */

/** A listing offset: an integer in [0, FATWA_MAX_OFFSET]. */
export function boundedOffset(value: number): number {
  return Math.max(0, Math.min(FATWA_MAX_OFFSET, Math.trunc(value) || 0));
}

/** A requested size: an integer in [1, max]. */
export function bounded(value: number, max: number): number {
  return Math.min(max, Math.max(1, Math.trunc(value) || 1));
}

/** A batch of rulings Search may ask about at once. */
export const TARGET_BATCH = 500;

/** How many categories one list holds — far beyond any classification scheme. */
export const CATEGORY_LIST = 1_000;

/** A raw query's timestamp, whatever shape the driver hands back. */
export function dateOf(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/** A raw query's nullable timestamp. */
export function maybeDate(value: Date | string | null): Date | null {
  return value === null ? null : dateOf(value);
}

/** Category display names, typed by the locales the CHECK admits. */
export function namesOf(
  rows: readonly { readonly locale: string; readonly name: string }[],
): FatwaCategoryName[] {
  return rows.map((row) => ({
    locale: row.locale as FatwaCategoryName['locale'],
    name: row.name,
  }));
}

/* ===========================================================================
 * Authority, as SQL
 * ========================================================================= */

/**
 * Does `actorId` hold `permission` NOW? A live, unrevoked assignment of an
 * active role carrying the key, held by an active account — the same shape as
 * the migration's `FatwaAssertPermission`, which the runtime may not call.
 * Every staff read places this inside its own WHERE clause, so a stale route
 * guard, a revoked role or a closed account reads nothing.
 */
export function holdsNow(actorId: string, permission: string): Prisma.Sql {
  return Prisma.sql`EXISTS (SELECT 1 FROM [dbo].[RoleAssignment] ra
    JOIN [dbo].[Role] r ON r.[id] = ra.[roleId] AND r.[deactivatedAt] IS NULL
    JOIN [dbo].[RolePermission] rp ON rp.[roleId] = r.[id] AND rp.[permissionKey] = ${permission}
    JOIN [dbo].[User] u ON u.[id] = ra.[userId] AND u.[status] = N'active'
    WHERE ra.[userId] = ${actorId} AND ra.[revokedAt] IS NULL)`;
}

/* ===========================================================================
 * THE PUBLIC RULE
 * ========================================================================= */

/**
 * A ruling `f` is public NOW iff the service is activated, it has a current
 * published revision, and it has not been withdrawn. Every public read, the
 * owner's `answerSlug`, the sitemap and the search resolver use this one
 * fragment, so none of them can disagree about what is public.
 */
export const PUBLIC_NOW = Prisma.sql`EXISTS (SELECT 1 FROM [dbo].[FatwaActivation])
  AND f.[publishedRevisionId] IS NOT NULL AND f.[withdrawnAt] IS NULL`;

/**
 * Whether the service is open, and under which authority; null while no
 * activation row exists. Every public read asks this FIRST.
 */
export async function activeMode(db: Client): Promise<FatwaAuthority | null> {
  const row = await db.fatwaActivation.findFirst({ select: { authority: true } });
  if (row === null) return null;
  // The CHECK admits two values; anything else fails closed to the stricter.
  return row.authority === 'approved' ? 'approved' : 'fixture';
}

/* ===========================================================================
 * Search
 * ========================================================================= */

/** What a ruling's search projection reads, and so what its stamp covers. */
export interface StampInput {
  readonly publishedRevisionId: string;
  readonly version: number;
  readonly categoryTopicId: string;
  readonly topicIds: readonly string[];
  readonly withdrawn: boolean;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * A ruling projection's staleness stamp: SHA-256 hex over the current published
 * revision (immutable, so its text is covered by its id), the ruling's version,
 * the topic its category maps to now, the revision's own topics in code-unit
 * order, and the withdrawn flag. A publication, a correction, a withdrawal and
 * a category re-mapping each move one of those.
 */
export function stampOf(input: StampInput): string {
  const material = JSON.stringify([
    input.publishedRevisionId,
    input.version,
    input.categoryTopicId,
    [...input.topicIds].sort(compare),
    input.withdrawn,
  ]);
  return createHash('sha256').update(material).digest('hex');
}

/** The topics a ruling is on: its revision's own, and its category's. Sorted, distinct. */
export function topicUnion(
  revisionTopicIds: readonly string[],
  categoryTopicId: string,
): string[] {
  return [...new Set([...revisionTopicIds, categoryTopicId])].sort(compare);
}
