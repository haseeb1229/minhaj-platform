import 'server-only';

import type { Prisma } from '@prisma/client';

import {
  MIGRATION_LIMITS,
  type ManifestEntryRecord,
  type ManifestEntryMode,
  type ManifestEntryState,
  type ManifestRecord,
  type ManifestState,
  type MigrationContentKind,
  type MigrationPublishableKind,
  type MigrationTargetRef,
  type PromotionDestination,
  type PromotionRecord,
  type PromotionState,
  type ReconciliationState,
  type RunRecord,
  type RunState,
  type SourceAccessMethod,
  type SourceAuthorityKind,
  type SourceRecord,
  type SourceState,
  type TargetStage,
} from '@minhaj/contracts/migration';

import { auditRow } from '../../audit-row.ts';
import { MigrationDataError } from './errors.ts';

/**
 * What the Migration & Provenance adapter's halves share — refusal mapping,
 * row locks, the record shapes and the audit writer — so the pipeline, the
 * decisions, raw evidence, publication, promotion and the reads cannot
 * disagree about what a stale version or a finished run means.
 *
 * PACKAGE-INTERNAL, AND NEVER NAMED BY THE ADAPTER'S ENTRY: it holds the
 * Prisma value its SQL fragments are built from. Only `MigrationDataError`
 * (defined in `./errors.ts`) leaves this package.
 *
 * MIGRATION'S OWN TABLES ONLY. User, Topic, Asset and Video rows are named
 * only as the typed foreign keys Migration's rows hold; whether an operator
 * holds a key is Identity's answer, asked by the service and re-checked by
 * the Phase-29 triggers beneath every publication and promotion approval.
 */

export type Client = Prisma.TransactionClient;

export { MigrationDataError };

/* ===========================================================================
 * Refusals
 * ========================================================================= */

/**
 * The migration's own refusals (`THROW 51370`–`51384`), by number. They are
 * the FLOOR beneath the adapter's own questions, which are asked first, so a
 * caller is told precisely. Read from the STRUCTURED fields the driver
 * populates, never from message text, which a stored value could imitate.
 */
const THROW_REASONS: ReadonlyMap<number, string> = new Map([
  // A source re-keyed or re-kinded, or its version moved other than by one.
  [51370, 'invalid-state'],
  // A source host changed, or a fixture source given a non-fixture host.
  [51371, 'host-refused'],
  // A raw snapshot rewritten or deleted.
  [51372, 'invalid-state'],
  // A raw snapshot created without its body.
  [51373, 'invalid'],
  // A staged revision created wrongly, rewritten, or its review moved invalidly.
  [51374, 'invalid-state'],
  // A run re-identified, or a finished run changed.
  [51375, 'invalid-state'],
  // A record re-identified.
  [51376, 'invalid-state'],
  // A run item re-identified, or moved out of a terminal outcome.
  [51377, 'invalid-state'],
  // A manifest published or rolled back without live publication authority.
  [51378, 'denied'],
  // A manifest entry for an unapproved revision, or moved outside its phase.
  [51379, 'invalid-state'],
  // A legacy mapping re-identified or re-targeted.
  [51380, 'invalid-state'],
  // A promotion approved without live authority, or carrying an unpublished entry.
  [51381, 'denied'],
  // An asset acquisition re-identified.
  [51382, 'invalid-state'],
  // An error reopened, or a duplicate pair re-identified.
  [51383, 'invalid-state'],
  // A topic mapping re-identified.
  [51384, 'invalid-state'],
]);

const UNIQUE_VIOLATION = 'UniqueConstraintViolation';
const CONSTRAINT_VIOLATIONS: ReadonlySet<string> = new Set([
  'ForeignKeyConstraintViolation',
  'NullConstraintViolation',
]);

/** A uniqueness rule: its constraint or index name and the table that holds it. */
export interface UniqueKey {
  readonly name: string;
  readonly table: string;
}

/** One source per key. */
export const SOURCE_KEY: UniqueKey = Object.freeze({
  name: 'MigrationSource_key_key',
  table: 'MigrationSource',
});
/** At most one open run per source — a filtered unique INDEX. */
export const OPEN_RUN_KEY: UniqueKey = Object.freeze({
  name: 'MigrationRun_open_key',
  table: 'MigrationRun',
});
/** One acquisition per (source, URL, bytes). */
export const ACQUISITION_KEY: UniqueKey = Object.freeze({
  name: 'MigrationAssetProvenance_acquisition_key',
  table: 'MigrationAssetProvenance',
});

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
 * `index` in a wrapped error. A string is never read as an error number and
 * no message text is read at all.
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

function isUnique(error: unknown): boolean {
  const { numbers, kinds } = errorFacts(error);
  if (numbers.some((number) => THROW_REASONS.has(number))) return false;
  return (
    (error as { code?: unknown } | null)?.code === 'P2002' ||
    kinds.has(UNIQUE_VIOLATION) ||
    numbers.includes(2627) ||
    numbers.includes(2601)
  );
}

/**
 * Whether the database refused a write on ONE uniqueness rule. SQL Server
 * names a violated unique INDEX (2601), but for a UNIQUE CONSTRAINT (2627)
 * the driver reports only the table that holds it — so the table counts too,
 * and every caller confirms by reading the row the key names.
 */
export function isUniqueViolationOn(error: unknown, key: UniqueKey): boolean {
  if (!isUnique(error)) return false;
  const { indexes } = errorFacts(error);
  return indexes.includes(key.name) || indexes.includes(`dbo.${key.table}`);
}

/**
 * Structured database refusals, and ONLY those, become domain answers: a
 * trigger refusal by its number first, then a uniqueness refusal
 * (`conflict`), then a CHECK or foreign-key refusal (`invalid`). Everything
 * unrecognised — a deadlock, a lock timeout, an outage, a permission refusal
 * this principal should never meet — is rethrown unchanged, NEVER reported as
 * a business rule that was not evaluated.
 */
export function refuse(error: unknown): never {
  if (error instanceof MigrationDataError) throw error;
  const { numbers, kinds } = errorFacts(error);
  for (const number of numbers) {
    const reason = THROW_REASONS.get(number);
    if (reason !== undefined) throw new MigrationDataError(reason);
  }
  if (isUnique(error)) throw new MigrationDataError('conflict');
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'P2025') throw new MigrationDataError('conflict');
  if (
    code === 'P2003' ||
    code === 'P2004' ||
    numbers.includes(547) ||
    [...kinds].some((kind) => CONSTRAINT_VIOLATIONS.has(kind))
  )
    throw new MigrationDataError('invalid');
  throw error;
}

/* ===========================================================================
 * Transactions and locks
 * ========================================================================= */

/**
 * How long a transaction that takes a row lock may live. Explicit, because the
 * interactive-transaction default (5s) is short for a staging checkpoint.
 */
export const LOCKED_TRANSACTION = {
  timeout: 30_000,
  maxWait: 5_000,
} as const;

/**
 * One row `WITH (UPDLOCK, HOLDLOCK, ROWLOCK)`: every writer of a run, a record,
 * a manifest or a promotion that decides from what it read takes this first,
 * so two writers cannot both decide from the same stale state.
 */
export async function lockRow(
  tx: Client,
  table:
    | 'MigrationRun'
    | 'MigrationRecord'
    | 'MigrationPublishManifest'
    | 'MigrationManifestEntry'
    | 'MigrationPromotion',
  id: string,
): Promise<boolean> {
  let rows: { id: string }[];
  switch (table) {
    case 'MigrationRun':
      rows = await tx.$queryRaw`
        SELECT [id] FROM [dbo].[MigrationRun] WITH (UPDLOCK, HOLDLOCK, ROWLOCK) WHERE [id] = ${id}`;
      break;
    case 'MigrationRecord':
      rows = await tx.$queryRaw`
        SELECT [id] FROM [dbo].[MigrationRecord] WITH (UPDLOCK, HOLDLOCK, ROWLOCK) WHERE [id] = ${id}`;
      break;
    case 'MigrationPublishManifest':
      rows = await tx.$queryRaw`
        SELECT [id] FROM [dbo].[MigrationPublishManifest] WITH (UPDLOCK, HOLDLOCK, ROWLOCK) WHERE [id] = ${id}`;
      break;
    case 'MigrationManifestEntry':
      rows = await tx.$queryRaw`
        SELECT [id] FROM [dbo].[MigrationManifestEntry] WITH (UPDLOCK, HOLDLOCK, ROWLOCK) WHERE [id] = ${id}`;
      break;
    case 'MigrationPromotion':
      rows = await tx.$queryRaw`
        SELECT [id] FROM [dbo].[MigrationPromotion] WITH (UPDLOCK, HOLDLOCK, ROWLOCK) WHERE [id] = ${id}`;
      break;
  }
  return rows.length > 0;
}

/**
 * After a guarded `updateMany` changed nothing: was the row missing, in the
 * wrong state, or merely at another version? Answered from one re-read.
 */
export function missedBecause(
  row: { readonly version: number; readonly state: string } | null,
  expectedVersion: number,
  allowedStates: readonly string[],
): never {
  if (row === null) throw new MigrationDataError('not-found');
  if (row.version !== expectedVersion) throw new MigrationDataError('conflict');
  if (!allowedStates.includes(row.state)) throw new MigrationDataError('invalid-state');
  throw new MigrationDataError('conflict');
}

/* ===========================================================================
 * Bounds
 * ========================================================================= */

/** The largest page any operator list returns. */
export const MAX_PAGE = 100;

export function bounded(value: number, max: number): number {
  return Math.min(max, Math.max(1, Math.trunc(value) || 1));
}

export function boundedOffset(value: number): number {
  return Math.max(0, Math.min(MIGRATION_LIMITS.maxOffset, Math.trunc(value) || 0));
}

/** A raw query's timestamp, whatever shape the driver hands back. */
export function dateOf(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/** A raw query's number, whatever shape the driver hands back. */
export function numberOf(value: number | bigint | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : Number(value);
}

/** A `DATE` column as `YYYY-MM-DD`. */
export function dateOnly(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10);
}

/** A raw query's VARBINARY, as a plain byte array. */
export function bytesOf(value: unknown): Uint8Array | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (typeof value === 'string') return new Uint8Array(Buffer.from(value, 'base64'));
  throw new MigrationDataError('unavailable');
}

/* ===========================================================================
 * Audit
 * ========================================================================= */

/** The permission an operator act was authorised under. */
export const ADMINISTER = 'migration.administer';
export const PUBLISH = 'migration.publish';

/**
 * One audit row, committed IN THE CALLER'S TRANSACTION beside the change it
 * describes. States and identifiers only — never a body, a payload, a URL, a
 * header, a note or a person's details (SECURITY_BASELINE.md §13.4).
 */
export async function audit(
  tx: Client,
  event: {
    readonly action: string;
    readonly actorId: string | null;
    readonly targetType: string;
    readonly targetId: string;
    readonly before?: Readonly<Record<string, string>>;
    readonly after?: Readonly<Record<string, string>>;
    readonly authorisingSource: string;
  },
): Promise<void> {
  await tx.auditLog.create({
    data: auditRow({
      actorType: event.actorId === null ? 'system' : 'user',
      actorId: event.actorId,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId,
      before: event.before,
      after: event.after,
      authorisingSource: event.authorisingSource,
    }),
    select: { id: true },
  });
}

/* ===========================================================================
 * Record shapes
 * ========================================================================= */

/*
 * THE ROW SHAPES ARE PLAIN INTERFACES, never Prisma payload types: a mapper a
 * factory method returns through is part of the adapter's surface, and that
 * surface names no raw database type.
 */

export const SOURCE_SELECT = {
  id: true,
  key: true,
  name: true,
  authorityKind: true,
  accessMethod: true,
  contentKind: true,
  baseUrl: true,
  authorisationReference: true,
  authorisedOn: true,
  licensingEvidence: true,
  policyNotes: true,
  defaultLanguageCode: true,
  minIntervalMs: true,
  maxConcurrency: true,
  maxAttempts: true,
  timeoutMs: true,
  maxBodyBytes: true,
  maxRedirects: true,
  state: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  hosts: { select: { host: true, role: true }, orderBy: { host: 'asc' } },
} as const satisfies Prisma.MigrationSourceSelect;

export interface SourceRow {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly authorityKind: string;
  readonly accessMethod: string;
  readonly contentKind: string;
  readonly baseUrl: string | null;
  readonly authorisationReference: string | null;
  readonly authorisedOn: Date | null;
  readonly licensingEvidence: string | null;
  readonly policyNotes: string | null;
  readonly defaultLanguageCode: string | null;
  readonly minIntervalMs: number;
  readonly maxConcurrency: number;
  readonly maxAttempts: number;
  readonly timeoutMs: number;
  readonly maxBodyBytes: number;
  readonly maxRedirects: number;
  readonly state: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly hosts: readonly { readonly host: string; readonly role: string }[];
}

export function toSourceRecord(row: SourceRow): SourceRecord {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    authorityKind: row.authorityKind as SourceAuthorityKind,
    accessMethod: row.accessMethod as SourceAccessMethod,
    contentKind: row.contentKind as MigrationContentKind,
    baseUrl: row.baseUrl,
    hosts: row.hosts.filter((entry) => entry.role === 'page').map((entry) => entry.host),
    assetHosts: row.hosts
      .filter((entry) => entry.role === 'asset')
      .map((entry) => entry.host),
    authorisationReference: row.authorisationReference,
    authorisedOn: dateOnly(row.authorisedOn),
    licensingEvidence: row.licensingEvidence,
    policyNotes: row.policyNotes,
    defaultLanguageCode: row.defaultLanguageCode,
    policy: {
      minIntervalMs: row.minIntervalMs,
      maxConcurrency: row.maxConcurrency,
      maxAttempts: row.maxAttempts,
      timeoutMs: row.timeoutMs,
      maxBodyBytes: row.maxBodyBytes,
      maxRedirects: row.maxRedirects,
    },
    state: row.state as SourceState,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const RUN_SELECT = {
  id: true,
  sourceId: true,
  operatorUserId: true,
  state: true,
  adapterKey: true,
  adapterVersion: true,
  parserKey: true,
  parserVersion: true,
  normalizerVersion: true,
  codeRevision: true,
  discoveryCursor: true,
  discoveryComplete: true,
  leaseToken: true,
  leaseExpiresAt: true,
  startedAt: true,
  endedAt: true,
  reconciliation: true,
  reconciledAt: true,
  reconciliationDetail: true,
  version: true,
  source: { select: { key: true, authorityKind: true, state: true } },
} as const satisfies Prisma.MigrationRunSelect;

export interface RunRow {
  readonly id: string;
  readonly sourceId: string;
  readonly operatorUserId: string;
  readonly state: string;
  readonly adapterKey: string;
  readonly adapterVersion: string;
  readonly parserKey: string;
  readonly parserVersion: string;
  readonly normalizerVersion: string;
  readonly codeRevision: string;
  readonly discoveryCursor: string | null;
  readonly discoveryComplete: boolean;
  readonly leaseToken: string | null;
  readonly leaseExpiresAt: Date | null;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  readonly reconciliation: string;
  readonly reconciledAt: Date | null;
  readonly reconciliationDetail: string | null;
  readonly version: number;
  readonly source: {
    readonly key: string;
    readonly authorityKind: string;
    readonly state: string;
  };
}

export function toRunRecord(row: RunRow): RunRecord {
  return {
    id: row.id,
    sourceId: row.sourceId,
    sourceKey: row.source.key,
    operatorUserId: row.operatorUserId,
    state: row.state as RunState,
    provenance: {
      adapterKey: row.adapterKey,
      adapterVersion: row.adapterVersion,
      parserKey: row.parserKey,
      parserVersion: row.parserVersion,
      normalizerVersion: row.normalizerVersion,
      codeRevision: row.codeRevision,
    },
    discoveryCursor: row.discoveryCursor,
    discoveryComplete: row.discoveryComplete,
    leaseExpiresAt: row.leaseExpiresAt,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    reconciliation: row.reconciliation as ReconciliationState,
    reconciledAt: row.reconciledAt,
    version: row.version,
  };
}

/** One run re-read in the writing transaction. */
export async function runRow(tx: Client, id: string): Promise<RunRow> {
  const row = await tx.migrationRun.findFirst({ where: { id }, select: RUN_SELECT });
  if (row === null) throw new MigrationDataError('not-found');
  return row;
}

/**
 * The run a pipeline checkpoint writes for, locked, and still this holder's:
 * open, and leased by `leaseToken`. A run another runner resumed answers
 * `lease-lost`, so a superseded runner can never write over its successor.
 */
export async function heldRun(
  tx: Client,
  runId: string,
  leaseToken: string,
): Promise<RunRow> {
  if (!(await lockRow(tx, 'MigrationRun', runId)))
    throw new MigrationDataError('not-found');
  const run = await runRow(tx, runId);
  if (run.state !== 'open') throw new MigrationDataError('invalid-state');
  if (run.leaseToken !== leaseToken) throw new MigrationDataError('lease-lost');
  return run;
}

export const MANIFEST_SELECT = {
  id: true,
  sourceId: true,
  runId: true,
  state: true,
  createdByUserId: true,
  createdAt: true,
  publishedByUserId: true,
  publishedAt: true,
  rollbackByUserId: true,
  rollbackReason: true,
  rolledBackAt: true,
  version: true,
} as const satisfies Prisma.MigrationPublishManifestSelect;

export interface ManifestRow {
  readonly id: string;
  readonly sourceId: string;
  readonly runId: string;
  readonly state: string;
  readonly createdByUserId: string;
  readonly createdAt: Date;
  readonly publishedByUserId: string | null;
  readonly publishedAt: Date | null;
  readonly rollbackByUserId: string | null;
  readonly rollbackReason: string | null;
  readonly rolledBackAt: Date | null;
  readonly version: number;
}

export function toManifestRecord(row: ManifestRow): ManifestRecord {
  return { ...row, state: row.state as ManifestState };
}

export async function manifestRow(tx: Client, id: string): Promise<ManifestRow> {
  const row = await tx.migrationPublishManifest.findFirst({
    where: { id },
    select: MANIFEST_SELECT,
  });
  if (row === null) throw new MigrationDataError('not-found');
  return row;
}

/**
 * THE TYPED TARGET COLUMN of each publishable kind — the SavedItem pattern.
 * A target is stored ONLY in its own kind's foreign-key column; there is no
 * `targetType` / `targetId` pair, and `kind` exists only in this mapping.
 */
export const TARGET_COLUMNS = Object.freeze({
  'media.video': 'videoId',
  'library.work': 'workId',
  'library.magazine': 'magazineId',
  'library.magazine-issue': 'magazineIssueId',
  'editorial.news': 'newsArticleId',
  'editorial.article': 'articleId',
  'editorial.press-release': 'pressReleaseId',
  'editorial.page': 'pageId',
  'people.person': 'personId',
  'global.country': 'countryId',
} as const satisfies Record<MigrationPublishableKind, string>);

export type TargetColumn = (typeof TARGET_COLUMNS)[MigrationPublishableKind];

const TARGET_KINDS = Object.entries(TARGET_COLUMNS) as readonly (readonly [
  MigrationPublishableKind,
  TargetColumn,
])[];

/** The target columns, every one null but the target's own. */
export function targetColumns(
  target: MigrationTargetRef,
): Readonly<Record<TargetColumn, string | null>> {
  const columns = Object.fromEntries(
    TARGET_KINDS.map(([, column]) => [column, null]),
  ) as Record<TargetColumn, string | null>;
  columns[TARGET_COLUMNS[target.kind]] = target.id;
  return columns;
}

/** The one target a row names, or null; a row naming two is corrupt. */
export function targetOf(
  row: Readonly<Record<TargetColumn, string | null>>,
): MigrationTargetRef | null {
  const named = TARGET_KINDS.filter(([, column]) => row[column] !== null);
  if (named.length === 0) return null;
  const [only] = named;
  if (named.length > 1 || only === undefined) throw new MigrationDataError('invalid');
  const [kind, column] = only;
  return { kind, id: row[column] ?? '' };
}

/** Select every target column. */
export const TARGET_SELECT = {
  videoId: true,
  workId: true,
  magazineId: true,
  magazineIssueId: true,
  newsArticleId: true,
  articleId: true,
  pressReleaseId: true,
  pageId: true,
  personId: true,
  countryId: true,
} as const;

export const ENTRY_SELECT = {
  id: true,
  manifestId: true,
  position: true,
  stagedRecordId: true,
  recordId: true,
  state: true,
  mode: true,
  ...TARGET_SELECT,
  targetStage: true,
  targetVersion: true,
  canonicalPath: true,
  refusal: true,
  publishedAt: true,
  rolledBackAt: true,
  version: true,
} as const satisfies Prisma.MigrationManifestEntrySelect;

export interface EntryRow {
  readonly id: string;
  readonly manifestId: string;
  readonly position: number;
  readonly stagedRecordId: string;
  readonly recordId: string;
  readonly state: string;
  readonly mode: string;
  readonly videoId: string | null;
  readonly workId: string | null;
  readonly magazineId: string | null;
  readonly magazineIssueId: string | null;
  readonly newsArticleId: string | null;
  readonly articleId: string | null;
  readonly pressReleaseId: string | null;
  readonly pageId: string | null;
  readonly personId: string | null;
  readonly countryId: string | null;
  readonly targetStage: string | null;
  readonly targetVersion: number | null;
  readonly canonicalPath: string | null;
  readonly refusal: string | null;
  readonly publishedAt: Date | null;
  readonly rolledBackAt: Date | null;
  readonly version: number;
}

export function toEntryRecord(row: EntryRow): ManifestEntryRecord {
  return {
    id: row.id,
    manifestId: row.manifestId,
    position: row.position,
    stagedRecordId: row.stagedRecordId,
    recordId: row.recordId,
    state: row.state as ManifestEntryState,
    mode: row.mode as ManifestEntryMode,
    target: targetOf(row),
    targetStage: row.targetStage === null ? null : (row.targetStage as TargetStage),
    targetVersion: row.targetVersion,
    canonicalPath: row.canonicalPath,
    refusal: row.refusal,
    publishedAt: row.publishedAt,
    rolledBackAt: row.rolledBackAt,
    version: row.version,
  };
}

export async function entryRow(tx: Client, id: string): Promise<EntryRow> {
  const row = await tx.migrationManifestEntry.findFirst({
    where: { id },
    select: ENTRY_SELECT,
  });
  if (row === null) throw new MigrationDataError('not-found');
  return row;
}

/** A promotion's columns with its two counts, as one raw row. */
interface PromotionRawRow {
  readonly id: string;
  readonly state: string;
  readonly destination: string;
  readonly createdByUserId: string;
  readonly createdAt: Date | string;
  readonly approvedByUserId: string | null;
  readonly approvedAt: Date | string | null;
  readonly withdrawnAt: Date | string | null;
  readonly completedAt: Date | string | null;
  readonly entryCount: number | bigint;
  readonly promotedCount: number | bigint;
  readonly version: number;
}

export function toPromotionRecord(row: PromotionRawRow): PromotionRecord {
  return {
    id: row.id,
    state: row.state as PromotionState,
    destination: row.destination as PromotionDestination,
    createdByUserId: row.createdByUserId,
    createdAt: dateOf(row.createdAt),
    approvedByUserId: row.approvedByUserId,
    approvedAt: row.approvedAt === null ? null : dateOf(row.approvedAt),
    withdrawnAt: row.withdrawnAt === null ? null : dateOf(row.withdrawnAt),
    completedAt: row.completedAt === null ? null : dateOf(row.completedAt),
    entryCount: numberOf(row.entryCount),
    promotedCount: numberOf(row.promotedCount),
    version: row.version,
  };
}

/**
 * Promotions with their entry and promoted counts — one statement per page,
 * whatever the page holds. `filter` and `paging` are fragments this module
 * builds itself, never a caller's text.
 */
export function promotionRows(
  tx: Client,
  filter: Prisma.Sql,
  paging: Prisma.Sql,
): Promise<PromotionRawRow[]> {
  return tx.$queryRaw<PromotionRawRow[]>`
    SELECT p.[id], p.[state], p.[destination], p.[createdByUserId], p.[createdAt],
           p.[approvedByUserId], p.[approvedAt], p.[withdrawnAt], p.[completedAt], p.[version],
           CAST((SELECT COUNT(*) FROM [dbo].[MigrationPromotionEntry] e
                 WHERE e.[promotionId] = p.[id]) AS INT) AS [entryCount],
           CAST((SELECT COUNT(*) FROM [dbo].[MigrationPromotionEntry] e
                 WHERE e.[promotionId] = p.[id] AND e.[state] = N'promoted') AS INT) AS [promotedCount]
    FROM [dbo].[MigrationPromotion] p
    WHERE ${filter}
    ORDER BY p.[createdAt] DESC, p.[id] DESC
    ${paging}`;
}
