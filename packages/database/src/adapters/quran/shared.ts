import 'server-only';

import { createHash } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import type { Locale } from '@minhaj/contracts';
import {
  citationOf,
  QURAN_AYAH_NUMBER_MAX,
  type QuranLayerState,
  type QuranRef,
  type QuranSourceAuthority,
} from '@minhaj/contracts/quran';

import { auditRow } from '../../audit-row.ts';
import { requestSearchIndexingMany } from '../../search-intent.ts';

/**
 * What the Quran adapter's administrative, canonical and public halves share —
 * refusal mapping, THE PUBLIC PREDICATE, bounds and the search stamp — so the
 * three cannot disagree about what a stale version, a public work or a current
 * projection means.
 *
 * PACKAGE-INTERNAL. Nothing here is exported from `@minhaj/database`, and none
 * of it is a capability: `Client` is a type the adapter's own transactions use.
 */

export type Client = Prisma.TransactionClient;

export class QuranDataError extends Error {
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
 * The migration's own refusals (`THROW 51180`–`51199`), by number, as the
 * context's vocabulary. Read from the STRUCTURED fields the driver populates —
 * never from message text, which a stored value could otherwise imitate.
 */
const THROW_REASONS: ReadonlyMap<number, string> = new Map([
  // Sources, canonical structure, history and activation are never written by
  // this principal; meeting one of these means a write outside its contract.
  [51180, 'invalid'],
  [51181, 'invalid'],
  [51182, 'invalid'],
  [51183, 'invalid'],
  [51184, 'corpus-exists'],
  [51185, 'invalid'],
  [51186, 'overlap'],
  [51187, 'overlap'],
  [51188, 'audio-required'],
  [51189, 'text-required'],
  [51190, 'denied'],
  [51191, 'corpus-exists'],
  [51192, 'not-found'],
  [51193, 'invalid'],
  [51194, 'invalid'],
  [51195, 'not-found'],
  [51196, 'conflict'],
  [51197, 'invalid'],
  [51198, 'fixture-over-approved'],
  [51199, 'unchanged'],
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
 * TABLE, and a unique INDEX violation (2601) by the index. Each table below has
 * exactly one caller-chosen unique value — its primary key is server-generated
 * or, for an assignment, IS the value — so the table answers which rule spoke.
 */
const KEY_REASONS: ReadonlyMap<string, string> = new Map([
  ['dbo.QuranTranslation', 'duplicate-slug'],
  ['dbo.QuranTransliteration', 'duplicate-slug'],
  ['dbo.QuranTafsir', 'duplicate-slug'],
  ['dbo.QuranRecitation', 'duplicate-slug'],
  ['dbo.QuranTajweedRule', 'duplicate-slug'],
  // Two entries or segments starting at one Ayah cover it twice.
  ['dbo.QuranTafsirText', 'overlap'],
  ['dbo.QuranRecitationSegment', 'overlap'],
  // The assignment already exists: nothing changed.
  ['dbo.QuranTopic', 'unchanged'],
  // A fresh asset is attached to exactly the segment it was uploaded for, so
  // meeting this filtered index means two writers raced; neither silently wins.
  ['QuranRecitationSegment_assetId_key', 'conflict'],
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
 * Structured database refusals, and ONLY those, become domain answers. A
 * migration refusal is mapped by its number first — the authoritative rule
 * that spoke — then Prisma's classification of a model write, then the driver
 * adapter's constraint category for a raw statement. Everything unrecognised,
 * including a permission refusal this principal should never meet, is
 * rethrown and reported as unavailable, never as a rule that was not
 * evaluated (DOMAIN_MODEL.md §19.8).
 */
export function refuse(error: unknown): never {
  if (error instanceof QuranDataError) throw error;
  const { numbers, kinds, indexes } = errorFacts(error);
  for (const number of numbers) {
    const reason = THROW_REASONS.get(number);
    if (reason !== undefined) throw new QuranDataError(reason);
  }
  const known = error as { code?: unknown } | null;
  if (known?.code === 'P2002' || kinds.has(UNIQUE_VIOLATION))
    throw new QuranDataError(
      indexes.map((index) => KEY_REASONS.get(index)).find((r) => r !== undefined) ??
        'invalid',
    );
  if (known?.code === 'P2025') throw new QuranDataError('conflict');
  if (
    known?.code === 'P2003' ||
    known?.code === 'P2004' ||
    [...kinds].some((kind) => CONSTRAINT_VIOLATIONS.has(kind))
  )
    throw new QuranDataError('invalid');
  throw error;
}

/* ===========================================================================
 * Bounds and ordering
 * ========================================================================= */

export function boundedOffset(value: number): number {
  return Math.max(0, Math.min(10_000_000, Math.trunc(value) || 0));
}

export function bounded(value: number, max: number): number {
  return Math.min(max, Math.max(1, Math.trunc(value) || 1));
}

/** A batch of citations or identifiers a caller may ask about at once. */
export const TARGET_BATCH = 500;

/** How many layered works of one kind a public list or one Ayah's layers hold. */
export const WORK_LIST = 200;

/** How many canonical versions of one Ayah its history shows. */
export const HISTORY = 200;

export const BY_SLUG = [{ slug: 'asc' }, { id: 'asc' }] as const;

export const CANONICAL_ORDER = [{ surahNumber: 'asc' }, { ayahNumber: 'asc' }] as const;

/** Clamps a requested Ayah range to one that a whole Surah fits and nothing beyond. */
export function ayahRange(from: number, to: number): { gte: number; lte: number } {
  const start = Math.max(1, Math.trunc(from) || 1);
  const end = Math.min(QURAN_AYAH_NUMBER_MAX, Math.trunc(to) || 0);
  return { gte: start, lte: end };
}

/** Citations strictly after `after`, in canonical order. */
export function citationsAfter(after: QuranRef | null): object {
  return after === null
    ? {}
    : {
        OR: [
          { surahNumber: { gt: after.surah } },
          { surahNumber: after.surah, ayahNumber: { gt: after.ayah } },
        ],
      };
}

/** Citations from `first` to `last` inclusive, in canonical order. */
export function citationsBetween(first: QuranRef, last: QuranRef): object {
  return {
    AND: [
      {
        OR: [
          { surahNumber: { gt: first.surah } },
          { surahNumber: first.surah, ayahNumber: { gte: first.ayah } },
        ],
      },
      {
        OR: [
          { surahNumber: { lt: last.surah } },
          { surahNumber: last.surah, ayahNumber: { lte: last.ayah } },
        ],
      },
    ],
  };
}

/* ===========================================================================
 * The public predicate
 * ========================================================================= */

/**
 * The corpus's public mode: `null` while no activation row exists, otherwise
 * the activating source's authority. Every public read asks this FIRST, so an
 * inactive corpus answers nothing at all.
 */
export async function activeMode(db: Client): Promise<QuranSourceAuthority | null> {
  const row = await db.quranActivation.findUnique({
    where: { id: 1 },
    select: { source: { select: { authority: true } } },
  });
  return row === null ? null : (row.source.authority as QuranSourceAuthority);
}

/**
 * A layered work is public when it is published AND names a registered source
 * — and, beside an APPROVED corpus, only when that source is approved too. A
 * fixture-sourced work is never shown with approved text (Phase 18 §3).
 *
 * The same shape serves every layered model — Translation, Transliteration,
 * Tafsir, Recitation and Tajweed rule — so they cannot disagree.
 */
export function publicWork(mode: QuranSourceAuthority) {
  return {
    state: 'published',
    sourceId: { not: null },
    ...(mode === 'approved' ? { source: { is: { authority: 'approved' } } } : {}),
  } as const;
}

/** The same predicate, decided over a row already read. */
export function isPublicWork(
  mode: QuranSourceAuthority | null,
  row: { readonly state: string; readonly source: { readonly authority: string } | null },
): boolean {
  return (
    mode !== null &&
    row.state === 'published' &&
    row.source !== null &&
    (mode === 'fixture' || row.source.authority === 'approved')
  );
}

/* ===========================================================================
 * Writing — one transaction, one claimed version, one audit entry
 * ========================================================================= */

export type WorkKind =
  'translation' | 'transliteration' | 'tafsir' | 'recitation' | 'tajweed';

/** What every layered work's lifecycle decisions read. */
export interface WorkHead {
  readonly slug: string;
  readonly state: string;
  readonly version: number;
  readonly sourceId: string | null;
  readonly publishedAt: Date | null;
}

const HEAD = {
  slug: true,
  state: true,
  version: true,
  sourceId: true,
  publishedAt: true,
} as const;

function headOf(tx: Client, kind: WorkKind, id: string): Promise<WorkHead | null> {
  const query = { where: { id }, select: HEAD };
  switch (kind) {
    case 'translation':
      return tx.quranTranslation.findUnique(query);
    case 'transliteration':
      return tx.quranTransliteration.findUnique(query);
    case 'tafsir':
      return tx.quranTafsir.findUnique(query);
    case 'recitation':
      return tx.quranRecitation.findUnique(query);
    case 'tajweed':
      return tx.quranTajweedRule.findUnique(query);
  }
}

interface Lifecycle {
  readonly state: QuranLayerState;
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
  if (previous === null) throw new QuranDataError('not-found');
  if (previous.version !== expectedVersion) throw new QuranDataError('conflict');

  const data = {
    ...(lifecycle === undefined ? {} : await lifecycle(previous)),
    version: { increment: 1 },
    updatedAt: new Date(),
  };
  const where = { id, version: expectedVersion };
  let changed: { count: number };
  switch (kind) {
    case 'translation':
      changed = await tx.quranTranslation.updateMany({ where, data });
      break;
    case 'transliteration':
      changed = await tx.quranTransliteration.updateMany({ where, data });
      break;
    case 'tafsir':
      changed = await tx.quranTafsir.updateMany({ where, data });
      break;
    case 'recitation':
      changed = await tx.quranRecitation.updateMany({ where, data });
      break;
    case 'tajweed':
      changed = await tx.quranTajweedRule.updateMany({ where, data });
      break;
  }
  if (changed.count !== 1) throw new QuranDataError('conflict');
  return previous;
}

/**
 * What publication asks before the database is asked: a REGISTERED source —
 * which only the owner/operator can create, so no administrator self-approves —
 * and something to show. The database's own CHECK and triggers refuse the same
 * states; asking first gives the precise answer. `publishedAt` is the FIRST
 * publication and survives archiving.
 */
export async function publication(
  previous: WorkHead,
  state: QuranLayerState,
  carried: () => Promise<number>,
  missing: 'text-required' | 'audio-required',
): Promise<Lifecycle> {
  if (state === 'published') {
    if (previous.sourceId === null) throw new QuranDataError('source-required');
    if ((await carried()) === 0) throw new QuranDataError(missing);
  }
  return {
    state,
    publishedAt:
      state === 'published' ? (previous.publishedAt ?? new Date()) : previous.publishedAt,
  };
}

/**
 * An edit of a work's own fields: it exists, it is the version the operator
 * read, its slug is the one it was given — the column refuses UPDATE, so a
 * public address never changes — and a published work keeps a source.
 */
export function guardEdit(
  previous: WorkHead | null,
  expectedVersion: number,
  value: { readonly slug: string; readonly sourceId: string | null },
): asserts previous is WorkHead {
  if (previous === null) throw new QuranDataError('not-found');
  if (previous.version !== expectedVersion) throw new QuranDataError('conflict');
  if (previous.slug !== value.slug) throw new QuranDataError('invalid');
  if (previous.state === 'published' && value.sourceId === null)
    throw new QuranDataError('source-required');
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
 * counts and field NAMES only — never a religious text, a translation, a name
 * or a description (SECURITY_BASELINE.md §13.4).
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
      authorisingSource: 'quran.administer',
    }),
  });
}

/* ===========================================================================
 * Mapping
 * ========================================================================= */

export function authorityOf(
  source: { readonly authority: string } | null,
): QuranSourceAuthority | null {
  return source === null ? null : (source.authority as QuranSourceAuthority);
}

export function stateOf(value: string): QuranLayerState {
  return value as QuranLayerState;
}

export function namesOf(
  rows: readonly { readonly locale: string; readonly name: string }[],
): Partial<Record<Locale, string>> {
  const names: Partial<Record<Locale, string>> = {};
  for (const row of rows) names[row.locale as Locale] = row.name;
  return names;
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

/**
 * The first code point at which two texts differ, or `null` when they are
 * identical. Code points, not UTF-16 units, so a supplementary character is one
 * position — the same index the verifier reports.
 */
export function firstDifference(a: string, b: string): number | null {
  const left = Array.from(a);
  const right = Array.from(b);
  const shorter = Math.min(left.length, right.length);
  for (let index = 0; index < shorter; index += 1)
    if (left[index] !== right[index]) return index;
  return left.length === right.length ? null : shorter;
}

/* ===========================================================================
 * Search
 * ========================================================================= */

export interface StampLayer {
  readonly kind: 'translation' | 'transliteration';
  readonly id: string;
  readonly slug: string;
  readonly version: number;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Deterministic work-slug order, the kind breaking a tie between two families. */
export function bySlug<T extends { readonly slug: string; readonly kind: string }>(
  a: T,
  b: T,
): number {
  return compare(a.slug, b.slug) || compare(a.kind, b.kind);
}

/**
 * An Ayah projection's staleness stamp: SHA-256 over the canonical version,
 * the topic assignments and the identity and version of every PUBLIC layer
 * that carries text for it. Every change a projection can see moves one of
 * those — a correction the Ayah's version, any text, name, language or
 * publication change its work's version or membership — so the stamp moves
 * with it. Ordered here, in code-unit order, so the single read and the
 * batched reconciliation read cannot disagree. 64 hex characters: exactly the
 * stamp bound.
 */
export function stampOf(
  version: number,
  topicIds: readonly string[],
  layers: readonly StampLayer[],
): string {
  const material = JSON.stringify([
    version,
    [...topicIds].sort(compare),
    [...layers].sort(bySlug).map((layer) => [layer.kind, layer.id, layer.version]),
  ]);
  return createHash('sha256').update(material).digest('hex');
}

/**
 * Durable search intent for the given Ayah scopes, inside the caller's
 * transaction (ARCHITECTURE.md §8.5), through the one shared helper.
 */
export async function requestAyahScopes(
  tx: Client,
  refs: readonly QuranRef[],
): Promise<void> {
  await requestSearchIndexingMany(tx, 'quran-ayah', refs.map(citationOf));
}

/** Every Ayah a Translation or Transliteration carries text for — its search reach. */
export async function workReach(
  tx: Client,
  kind: 'translation' | 'transliteration',
  workId: string,
): Promise<readonly QuranRef[]> {
  const select = { surahNumber: true, ayahNumber: true } as const;
  const rows =
    kind === 'translation'
      ? await tx.quranTranslationText.findMany({
          where: { translationId: workId },
          select,
          orderBy: [...CANONICAL_ORDER],
        })
      : await tx.quranTransliterationText.findMany({
          where: { transliterationId: workId },
          select,
          orderBy: [...CANONICAL_ORDER],
        });
  return rows.map((row) => ({ surah: row.surahNumber, ayah: row.ayahNumber }));
}
