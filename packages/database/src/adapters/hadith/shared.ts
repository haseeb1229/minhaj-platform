import 'server-only';

import { createHash } from 'node:crypto';

import { Prisma } from '@prisma/client';

import type {
  HadithContributorRole,
  HadithLayerState,
  HadithSourceAuthority,
} from '@minhaj/contracts/hadith';

import { auditRow } from '../../audit-row.ts';
import { requestSearchIndexingMany } from '../../search-intent.ts';

/**
 * What the Hadith adapter's administrative, canonical and public halves share —
 * refusal mapping, THE PUBLIC RULE, bounds, the claimed version and the search
 * stamp — so the three cannot disagree about what a stale version, a public
 * citation or a current projection means.
 *
 * PACKAGE-INTERNAL. Nothing here is exported from `@minhaj/database`, and none
 * of it is a capability: `Client` is a type the adapter's own transactions use.
 */

export type Client = Prisma.TransactionClient;

export class HadithDataError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

/* ===========================================================================
 * Refusals
 * ========================================================================= */

/**
 * The migration's own refusals (`THROW 51200`–`51229`), by number, as the
 * context's vocabulary. Read from the STRUCTURED fields the driver populates —
 * never from message text, which a stored value could otherwise imitate.
 */
const THROW_REASONS: ReadonlyMap<number, string> = new Map([
  // Sources, canonical structure, history and activation are never written by
  // this principal outside the procedures; meeting one of these means a write
  // outside its contract.
  [51200, 'invalid'],
  [51201, 'invalid'],
  [51202, 'invalid'],
  [51203, 'invalid'],
  [51204, 'citation-conflicted'],
  [51205, 'fixture-over-approved'],
  [51206, 'invalid'],
  [51207, 'text-required'],
  // The mirror of 51205: an approved record never enters a collection
  // activated as fixture proof. Both are one answer — the record's source and
  // the collection's activation disagree in authority.
  [51208, 'fixture-over-approved'],
  [51210, 'denied'],
  [51211, 'not-found'],
  [51212, 'not-found'],
  [51213, 'conflict'],
  [51214, 'citation-kept'],
  [51215, 'structure-mismatch'],
  [51216, 'invalid'],
  [51217, 'invalid'],
  [51218, 'unchanged'],
  [51219, 'not-verified'],
  [51220, 'not-candidate'],
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
 * What meeting a uniqueness rule means, by what the driver adapter reports.
 *
 * SQL Server names a UNIQUE CONSTRAINT or PRIMARY KEY violation (2627) by its
 * TABLE, and every Hadith key is a constraint. Each table below has exactly one
 * caller-chosen unique value — its primary key is server-generated or, for an
 * assignment, IS the value — so the table answers which rule spoke. Books and
 * chapters hold two (slug, and source reference or position); the canonical
 * half asks which one was taken (`duplicateStructure`).
 */
const KEY_REASONS: ReadonlyMap<string, string> = new Map([
  ['dbo.HadithCollection', 'duplicate-slug'],
  ['dbo.HadithCommentary', 'duplicate-slug'],
  ['dbo.HadithScience', 'duplicate-slug'],
  ['dbo.Hadith', 'duplicate-reference'],
  ['dbo.HadithBook', 'duplicate-reference'],
  ['dbo.HadithChapter', 'duplicate-reference'],
  // A verification of a version already verified: nothing would change.
  ['dbo.HadithVerification', 'unchanged'],
  // The assignment already exists: nothing changed.
  ['dbo.HadithTopic', 'unchanged'],
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
 * and no message text is read at all, so a stored value cannot impersonate a
 * refusal.
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
 * Whether the database refused a write on the given table's uniqueness — and
 * on nothing the migration numbered first. Structured facts only.
 */
export function uniqueViolationOn(error: unknown, table: string): boolean {
  const { numbers, kinds, indexes } = errorFacts(error);
  if (numbers.some((number) => THROW_REASONS.has(number))) return false;
  const known = error as { code?: unknown } | null;
  return (
    (known?.code === 'P2002' || kinds.has(UNIQUE_VIOLATION)) && indexes.includes(table)
  );
}

/**
 * Structured database refusals, and ONLY those, become domain answers. A
 * migration refusal is mapped by its number first — the authoritative rule
 * that spoke — then Prisma's classification of a model write, then the driver
 * adapter's constraint category for a raw statement. Everything unrecognised,
 * including a permission refusal this principal should never meet, is
 * rethrown and reported as unavailable, never as a rule that was not
 * evaluated (DOMAIN_MODEL.md §19.8).
 */
export function refuse(error: unknown): never {
  if (error instanceof HadithDataError) throw error;
  const { numbers, kinds, indexes } = errorFacts(error);
  for (const number of numbers) {
    const reason = THROW_REASONS.get(number);
    if (reason !== undefined) throw new HadithDataError(reason);
  }
  const known = error as { code?: unknown } | null;
  if (known?.code === 'P2002' || kinds.has(UNIQUE_VIOLATION))
    throw new HadithDataError(
      indexes.map((index) => KEY_REASONS.get(index)).find((r) => r !== undefined) ??
        'invalid',
    );
  if (known?.code === 'P2025') throw new HadithDataError('conflict');
  if (
    known?.code === 'P2003' ||
    known?.code === 'P2004' ||
    [...kinds].some((kind) => CONSTRAINT_VIOLATIONS.has(kind))
  )
    throw new HadithDataError('invalid');
  throw error;
}

/* ===========================================================================
 * Bounds
 * ========================================================================= */

export function boundedOffset(value: number): number {
  return Math.max(0, Math.min(10_000_000, Math.trunc(value) || 0));
}

export function bounded(value: number, max: number): number {
  return Math.min(max, Math.max(1, Math.trunc(value) || 1));
}

/** A batch of citations or identifiers a caller may ask about at once. */
export const TARGET_BATCH = 500;

/** How many layered works one list or one record's layers hold. */
export const WORK_LIST = 200;

/** How many versions, verifications or conflict rows one record's history shows. */
export const HISTORY = 200;

/** How many books of one collection, or chapters of one book, one list holds. */
export const STRUCTURE_LIST = 1_000;

/** How many search intents one statement carries while a work's reach is walked. */
export const INTENT_BATCH = 1_000;

/* ===========================================================================
 * THE PUBLIC RULE
 * ========================================================================= */

/**
 * The section's public mode: `null` while no activation row exists, otherwise
 * the authority the activation rows share. Every public read asks this FIRST,
 * so an inactive section answers nothing at all. Should the rows ever disagree
 * — a trigger forbids it — the stricter authority wins: fail closed.
 */
export async function activeMode(db: Client): Promise<HadithSourceAuthority | null> {
  const rows = await db.hadithActivation.findMany({
    select: { authority: true },
    distinct: ['authority'],
    take: 2,
  });
  if (rows.length === 0) return null;
  return rows.every((row) => row.authority === 'fixture') ? 'fixture' : 'approved';
}

/** Whether a human verification covers the record `h`'s CURRENT version. */
export const VERIFIED = Prisma.sql`EXISTS (SELECT 1 FROM [dbo].[HadithVerification] v
  WHERE v.[hadithId] = h.[id] AND v.[version] = h.[version])`;

/**
 * A public citation, as SQL — the FROM and WHERE every public listing, the
 * sitemap and the search resolver select from, over `c` (the citation), `col`
 * (its collection), `h` (the record it names) and `s` (that record's source).
 * A citation is public iff ALL of:
 *
 *   1. its collection is activated;
 *   2. it is mapped;
 *   3. no conflict evidence stands against its collection and number;
 *   4. a human verification covers the named record's CURRENT version;
 *   5. the record's source has the section's own authority — approved text
 *      beside an approved section, fixture text beside a fixture one, so a
 *      fixture banner never stands over approved text.
 *
 * `isPublicCitation` is the same rule decided over facts already read.
 */
export function publicCitations(mode: HadithSourceAuthority): Prisma.Sql {
  return Prisma.sql`FROM [dbo].[HadithCitation] c
    JOIN [dbo].[HadithCollection] col ON col.[id] = c.[collectionId]
    JOIN [dbo].[HadithActivation] a ON a.[collectionId] = c.[collectionId]
    JOIN [dbo].[Hadith] h ON h.[id] = c.[hadithId]
    JOIN [dbo].[HadithSourceSystem] s ON s.[id] = h.[sourceSystemId]
    WHERE c.[state] = N'mapped'
      AND NOT EXISTS (SELECT 1 FROM [dbo].[HadithConflict] x
        WHERE x.[collectionId] = c.[collectionId] AND x.[citationNumber] = c.[number])
      AND ${VERIFIED}
      AND s.[authority] = ${mode}`;
}

/** The facts the public rule reads about one citation. */
export interface CitationFacts {
  readonly activated: boolean;
  readonly state: string;
  readonly conflicted: boolean;
  readonly verified: boolean;
  readonly sourceAuthority: string;
}

/** `publicCitations`, decided over facts already read. */
export function isPublicCitation(
  mode: HadithSourceAuthority | null,
  facts: CitationFacts,
): boolean {
  return (
    mode !== null &&
    facts.activated &&
    facts.state === 'mapped' &&
    !facts.conflicted &&
    facts.verified &&
    facts.sourceAuthority === mode
  );
}

/**
 * A layered work — Translation, Commentary or Science — is public when it is
 * published AND names a registered source of the section's own authority. A
 * Translation or a Commentary entry is further public only while its record's
 * citation is.
 */
export function publicLayer(mode: HadithSourceAuthority) {
  return {
    state: 'published',
    sourceSystemId: { not: null },
    sourceSystem: { is: { authority: mode } },
  } as const;
}

/** `publicLayer`, as SQL over the fixed alias `t` of a layered table. */
export function publicLayerSql(mode: HadithSourceAuthority): Prisma.Sql {
  return Prisma.sql`t.[state] = N'published' AND t.[sourceSystemId] IS NOT NULL
    AND EXISTS (SELECT 1 FROM [dbo].[HadithSourceSystem] ls
      WHERE ls.[id] = t.[sourceSystemId] AND ls.[authority] = ${mode})`;
}

/* ===========================================================================
 * Writing — one transaction, one claimed version, one audit entry
 * ========================================================================= */

export type WorkKind = 'translation' | 'commentary' | 'science';

/** What every layered work's lifecycle decisions read. */
export interface WorkHead {
  readonly state: string;
  readonly version: number;
  readonly sourceSystemId: string | null;
  readonly publishedAt: Date | null;
}

const HEAD = {
  state: true,
  version: true,
  sourceSystemId: true,
  publishedAt: true,
} as const;

function headOf(tx: Client, kind: WorkKind, id: string): Promise<WorkHead | null> {
  const query = { where: { id }, select: HEAD };
  switch (kind) {
    case 'translation':
      return tx.hadithTranslation.findUnique(query);
    case 'commentary':
      return tx.hadithCommentary.findUnique(query);
    case 'science':
      return tx.hadithScience.findUnique(query);
  }
}

interface Lifecycle {
  readonly state: HadithLayerState;
  readonly publishedAt: Date | null;
}

/**
 * THE VERSION IS THE LOCK. Claims `expectedVersion` and moves it on — FIRST,
 * before any dependent row is touched — so of two operators acting on one work
 * exactly one succeeds and the other is told it changed. No last write wins.
 *
 * `lifecycle`, when given, decides the new state from the row as it was, and
 * is written by the same conditional update.
 */
export async function claim(
  tx: Client,
  kind: WorkKind,
  id: string,
  expectedVersion: number,
  lifecycle?: (previous: WorkHead) => Promise<Lifecycle>,
): Promise<WorkHead> {
  const previous = await headOf(tx, kind, id);
  if (previous === null) throw new HadithDataError('not-found');
  if (previous.version !== expectedVersion) throw new HadithDataError('conflict');

  const data = {
    ...(lifecycle === undefined ? {} : await lifecycle(previous)),
    version: { increment: 1 },
    updatedAt: new Date(),
  };
  const where = { id, version: expectedVersion };
  let changed: { count: number };
  switch (kind) {
    case 'translation':
      changed = await tx.hadithTranslation.updateMany({ where, data });
      break;
    case 'commentary':
      changed = await tx.hadithCommentary.updateMany({ where, data });
      break;
    case 'science':
      changed = await tx.hadithScience.updateMany({ where, data });
      break;
  }
  if (changed.count !== 1) throw new HadithDataError('conflict');
  return previous;
}

/**
 * What publication asks before the database is asked: a REGISTERED source —
 * which only the owner/operator can create, so no administrator self-approves —
 * and something to show. The database's own CHECK and triggers (51207) refuse
 * the same states; asking first gives the precise answer. `publishedAt` is the
 * FIRST publication and survives archiving.
 */
export async function publication(
  previous: WorkHead,
  state: HadithLayerState,
  carried: () => Promise<number>,
): Promise<Lifecycle> {
  if (state === 'published') {
    if (previous.sourceSystemId === null) throw new HadithDataError('source-required');
    if ((await carried()) === 0) throw new HadithDataError('text-required');
  }
  return {
    state,
    publishedAt:
      state === 'published' ? (previous.publishedAt ?? new Date()) : previous.publishedAt,
  };
}

/**
 * An edit of a work's own fields: it exists, it is the version the operator
 * read, and a published work keeps a source.
 */
export function guardEdit<T extends WorkHead>(
  previous: T | null,
  expectedVersion: number,
  value: { readonly sourceSystemId: string | null },
): asserts previous is T {
  if (previous === null) throw new HadithDataError('not-found');
  if (previous.version !== expectedVersion) throw new HadithDataError('conflict');
  if (previous.state === 'published' && value.sourceSystemId === null)
    throw new HadithDataError('source-required');
}

export interface AuditEntry {
  readonly actorId: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly before?: Readonly<Record<string, string>>;
  readonly after: Readonly<Record<string, string>>;
}

/**
 * The audit entry, in the writing transaction. Identifiers, versions, states,
 * counts and field NAMES only — never a Hadith, a translation, a commentary, a
 * name or a description (SECURITY_BASELINE.md §13.4).
 */
export async function audit(tx: Client, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: auditRow({
      actorType: 'user',
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      before: entry.before,
      after: entry.after,
      authorisingSource: 'hadith.administer',
    }),
  });
}

/**
 * Which of a record's facts changed — NAMES ONLY, never values, so an audit
 * entry carries no name, description or text (SECURITY_BASELINE.md §13.4).
 */
export function changedFields(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): string {
  const changed = Object.keys(after)
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .sort()
    .join(',');
  return changed === '' ? 'none' : changed;
}

/* ===========================================================================
 * Mapping
 * ========================================================================= */

export function authorityOf(
  source: { readonly authority: string } | null,
): HadithSourceAuthority | null {
  return source === null ? null : (source.authority as HadithSourceAuthority);
}

export function stateOf(value: string): HadithLayerState {
  return value as HadithLayerState;
}

export function roleOf(value: string): HadithContributorRole {
  return value as HadithContributorRole;
}

/* ===========================================================================
 * Search
 * ========================================================================= */

/**
 * Durable search intent for every citation that NAMES one of these records,
 * inside the caller's transaction (ARCHITECTURE.md §8.5). A citation projects
 * only the record it names — so a layered change on any other candidate moves
 * nothing it shows — and a mapped record's citation number cannot change
 * (51214), so the citation naming a record is exactly the one its layers reach.
 */
export async function requestRecordScopes(
  tx: Client,
  hadithIds: readonly string[],
): Promise<void> {
  if (hadithIds.length === 0) return;
  const citations = await tx.hadithCitation.findMany({
    where: { hadithId: { in: [...hadithIds] } },
    select: { id: true },
    take: hadithIds.length,
  });
  await requestSearchIndexingMany(
    tx,
    'hadith',
    citations.map((citation) => citation.id),
  );
}

/**
 * The same intent for every citation whose record a commentary carries an
 * entry for — its whole reach, walked in bounded batches so no single read is
 * unbounded and no citation it reaches is skipped.
 */
export async function requestCommentaryScopes(
  tx: Client,
  commentaryId: string,
): Promise<void> {
  let after: string | null = null;
  for (;;) {
    const page: { id: string }[] = await tx.hadithCitation.findMany({
      where: {
        hadith: { commentaryEntries: { some: { commentaryId } } },
        ...(after === null ? {} : { id: { gt: after } }),
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: INTENT_BATCH,
    });
    await requestSearchIndexingMany(
      tx,
      'hadith',
      page.map((citation) => citation.id),
    );
    const last = page.at(-1);
    if (last === undefined || page.length < INTENT_BATCH) return;
    after = last.id;
  }
}

/** What a citation's search projection reads, and so what its stamp covers. */
export interface StampInput {
  readonly citationVersion: number;
  readonly hadithId: string;
  readonly hadithVersion: number;
  readonly verificationId: string | null;
  readonly translations: readonly {
    readonly id: string;
    readonly version: number;
    readonly state: string;
  }[];
  readonly topicIds: readonly string[];
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * A citation projection's staleness stamp: SHA-256 over the citation's
 * version, the named record's identity and version, the verification that
 * covers it, the identity, version and state of every PUBLIC translation, and
 * the topic assignments. Every change a projection can see moves one of those
 * — a re-mapping the citation's version, a correction the record's version,
 * any translation edit or publication change its version or membership — so
 * the stamp moves with it. Ordered here, in code-unit order, so the single
 * read and the batched reconciliation read cannot disagree. 64 hex characters:
 * exactly the stamp bound.
 */
export function stampOf(input: StampInput): string {
  const material = JSON.stringify([
    input.citationVersion,
    input.hadithId,
    input.hadithVersion,
    input.verificationId,
    [...input.translations]
      .sort((a, b) => compare(a.id, b.id))
      .map((translation) => [translation.id, translation.version, translation.state]),
    [...input.topicIds].sort(compare),
  ]);
  return createHash('sha256').update(material).digest('hex');
}
