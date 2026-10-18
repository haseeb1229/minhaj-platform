import 'server-only';

import { randomUUID } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import {
  MEMBERSHIP_LIMITS,
  membershipIntentKey,
  type ApplicationRecord,
  type ApplicationStatus,
  type ClosureSource,
  type MembershipCommunicationPurpose,
  type MembershipRecord,
  type MembershipStatus,
  type MembershipTypeReference,
  type MembershipTypeState,
  type PublicMembershipType,
  type StaffApplication,
  type StaffMembership,
  type WithdrawalSource,
} from '@minhaj/contracts/membership';

import { MembershipDataError } from './errors.ts';

/**
 * What the Membership adapter's halves share — refusal mapping, the account
 * and type serialisation, the record shapes and the intent writer — so the
 * catalogue, the applicant's own surface, the operator surface, the relay and
 * closure cannot disagree about what a stale version, an open application or
 * an owed message means.
 *
 * PACKAGE-INTERNAL, AND NEVER NAMED BY THE ADAPTER'S ENTRY: it holds the
 * Prisma value its SQL fragments are built from. Only `MembershipDataError`
 * (defined in `./errors.ts`) leaves this package.
 *
 * MEMBERSHIP'S OWN TABLES ONLY. Nothing here reads a User row, a role or any
 * other context's table: whether an account is closed or active is Identity's
 * answer, asked by the service before it calls in.
 */

export type Client = Prisma.TransactionClient;

export { MembershipDataError };

/* ===========================================================================
 * Refusals
 * ========================================================================= */

/**
 * The migration's own refusals (`THROW 51320`–`51325`), by number. They are the
 * FLOOR beneath the adapter's own questions, which are asked first under the
 * lock each needs, so a caller is told precisely — `already-member` rather
 * than the trigger's single answer for "not published, or already a member".
 * Read from the STRUCTURED fields the driver populates, never from message
 * text, which a stored value could otherwise imitate.
 */
const THROW_REASONS: ReadonlyMap<number, string> = new Map([
  // A type created other than as a draft, returned to draft, or re-keyed.
  [51320, 'invalid-state'],
  // A type published without its primary locale's words.
  [51321, 'incomplete'],
  // An application moved other than along its lifecycle.
  [51322, 'invalid-state'],
  // An application on a type that is not published (or while already a member).
  [51323, 'type-unavailable'],
  // A Membership reopened, re-keyed or created other than from an approval.
  [51324, 'invalid-state'],
  // A settled intent reopened or re-keyed.
  [51325, 'conflict'],
]);

const UNIQUE_VIOLATION = 'UniqueConstraintViolation';
const CONSTRAINT_VIOLATIONS: ReadonlySet<string> = new Set([
  'ForeignKeyConstraintViolation',
  'NullConstraintViolation',
]);

/** One OPEN application per account and type — the race floor beneath `submit`. */
export const OPEN_APPLICATION_KEY = 'MembershipApplication_open_key';

/**
 * What meeting a uniqueness rule means, by the constraint the driver adapter
 * names. A filtered unique INDEX (2601) is named by the index; a key
 * constraint (2627) by its table. One ACTIVE Membership per account and type
 * is the floor beneath an approval's own question. Everything else — a reused
 * identifier, a twin intent key — is a write that raced its twin: `conflict`.
 */
const KEY_REASONS: ReadonlyMap<string, string> = new Map([
  ['Membership_active_key', 'already-member'],
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
 * Whether the database refused a write on ONE named uniqueness rule — the
 * signal that an idempotent insert lost a race to its own twin.
 */
export function isUniqueViolationOn(error: unknown, index: string): boolean {
  return isUnique(error) && errorFacts(error).indexes.includes(index);
}

/**
 * Structured database refusals, and ONLY those, become domain answers. A
 * migration refusal is mapped by its number first — the authoritative rule
 * that spoke — then a uniqueness refusal by the key it met, then a constraint
 * refusal by its category. Everything unrecognised — a deadlock, a lock
 * timeout, an outage, a permission refusal this principal should never meet —
 * is rethrown unchanged and reported as unavailable, NEVER as a business rule
 * that was not evaluated.
 */
export function refuse(error: unknown): never {
  if (error instanceof MembershipDataError) throw error;
  const { numbers, kinds, indexes } = errorFacts(error);
  for (const number of numbers) {
    const reason = THROW_REASONS.get(number);
    if (reason !== undefined) throw new MembershipDataError(reason);
  }
  if (isUnique(error))
    throw new MembershipDataError(
      indexes.map((index) => KEY_REASONS.get(index)).find((r) => r !== undefined) ??
        'conflict',
    );
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'P2025') throw new MembershipDataError('conflict');
  if (
    code === 'P2003' ||
    code === 'P2004' ||
    numbers.includes(547) ||
    [...kinds].some((kind) => CONSTRAINT_VIOLATIONS.has(kind))
  )
    throw new MembershipDataError('invalid');
  throw error;
}

/* ===========================================================================
 * Serialisation (DOMAIN_MODEL.md §19.8)
 * ========================================================================= */

/** How long one writer waits for an account-and-type lock before giving up. */
const LOCK_TIMEOUT_MS = 5_000;

/**
 * How long a transaction that takes a lock may live. Explicit, because the
 * interactive-transaction default (5s) is no longer than the lock wait itself.
 */
export const LOCKED_TRANSACTION = {
  timeout: 20_000,
  maxWait: LOCK_TIMEOUT_MS,
} as const;

/**
 * A transaction-owned exclusive application lock. `sp_getapplock` returns
 * >= 0 when granted and < 0 when not (-1 timeout, -2 cancelled, -3 deadlock
 * victim, -999 parameter error); every negative value is `unavailable` — a
 * transient condition, never a rule that said no. Released on commit and on
 * rollback alike, so a thrown refusal cannot leave it held.
 */
async function acquire(tx: Client, resource: string): Promise<void> {
  const rows = await tx.$queryRaw<{ granted: number }[]>`
    DECLARE @granted int;
    EXEC @granted = sys.sp_getapplock
      @Resource = ${resource},
      @LockMode = 'Exclusive',
      @LockOwner = 'Transaction',
      @LockTimeout = ${LOCK_TIMEOUT_MS};
    SELECT @granted AS granted;`;
  const granted = rows[0];
  if (granted === undefined || Number(granted.granted) < 0)
    throw new MembershipDataError('unavailable');
}

/** Serialises type creation, so the `limit` count and the insert agree. */
export function lockCatalogue(tx: Client): Promise<void> {
  return acquire(tx, 'membership-catalogue');
}

/**
 * THE ACCOUNT-AND-TYPE SERIALISATION every write touching an account's
 * application or Membership of one type takes BEFORE its first protected
 * write: the application lock `membership:{accountId}:{typeId}`, then the
 * type row read `WITH (HOLDLOCK)` — a shared lock held to commit, which a type
 * transition (`UPDLOCK`, then its update) must wait for. So an archive and an
 * approval, or an archive and a submission, are ordered: whichever reads the
 * type first decides what the other sees.
 *
 * Returns the type's state as it now stands, or `null` for no such type.
 */
export async function serialise(
  tx: Client,
  accountId: string,
  membershipTypeId: string,
): Promise<MembershipTypeState | null> {
  await acquire(tx, `membership:${accountId}:${membershipTypeId}`);
  const [row] = await tx.$queryRaw<{ state: string }[]>`
    SELECT [state] FROM [dbo].[MembershipType] WITH (HOLDLOCK)
    WHERE [id] = ${membershipTypeId}`;
  return row === undefined ? null : (row.state as MembershipTypeState);
}

/* ===========================================================================
 * Locked reads
 * ========================================================================= */

export interface LockedApplication {
  readonly id: string;
  readonly applicantUserId: string;
  readonly membershipTypeId: string;
  readonly status: ApplicationStatus;
  readonly version: number;
  readonly submittedAt: Date;
  readonly reviewStartedAt: Date | null;
}

/**
 * One application, found, serialised on and re-read `WITH (UPDLOCK,
 * HOLDLOCK)` — or `null` when no such application exists for `owner` (or at
 * all, for an operator: `owner` null). Its applicant and type never change
 * (51322), so the unlocked first read is a safe key for the lock.
 */
export async function claimApplication(
  tx: Client,
  id: string,
  owner: string | null,
): Promise<{
  readonly row: LockedApplication;
  readonly typeState: MembershipTypeState | null;
} | null> {
  const found = await tx.membershipApplication.findFirst({
    where: { id, ...(owner === null ? {} : { applicantUserId: owner }) },
    select: { applicantUserId: true, membershipTypeId: true },
  });
  if (found === null) return null;
  const typeState = await serialise(tx, found.applicantUserId, found.membershipTypeId);
  const [row] = await tx.$queryRaw<
    {
      id: string;
      applicantUserId: string;
      membershipTypeId: string;
      status: string;
      version: number;
      submittedAt: Date | string;
      reviewStartedAt: Date | string | null;
    }[]
  >`
    SELECT [id], [applicantUserId], [membershipTypeId], [status], [version],
           [submittedAt], [reviewStartedAt]
    FROM [dbo].[MembershipApplication] WITH (UPDLOCK, HOLDLOCK)
    WHERE [id] = ${id} AND [applicantUserId] = ${found.applicantUserId}`;
  if (row === undefined) return null;
  return {
    row: {
      id: row.id,
      applicantUserId: row.applicantUserId,
      membershipTypeId: row.membershipTypeId,
      status: row.status as ApplicationStatus,
      version: Number(row.version),
      submittedAt: dateOf(row.submittedAt),
      reviewStartedAt: maybeDate(row.reviewStartedAt),
    },
    typeState,
  };
}

export interface LockedMembership {
  readonly id: string;
  readonly memberUserId: string;
  readonly membershipTypeId: string;
  readonly status: MembershipStatus;
  readonly version: number;
  readonly activatedAt: Date;
}

/** One Membership, found, serialised on and re-read under lock — as above. */
export async function claimMembership(
  tx: Client,
  id: string,
  owner: string | null,
): Promise<LockedMembership | null> {
  const found = await tx.membership.findFirst({
    where: { id, ...(owner === null ? {} : { memberUserId: owner }) },
    select: { memberUserId: true, membershipTypeId: true },
  });
  if (found === null) return null;
  await serialise(tx, found.memberUserId, found.membershipTypeId);
  const [row] = await tx.$queryRaw<
    {
      id: string;
      memberUserId: string;
      membershipTypeId: string;
      status: string;
      version: number;
      activatedAt: Date | string;
    }[]
  >`
    SELECT [id], [memberUserId], [membershipTypeId], [status], [version], [activatedAt]
    FROM [dbo].[Membership] WITH (UPDLOCK, HOLDLOCK)
    WHERE [id] = ${id} AND [memberUserId] = ${found.memberUserId}`;
  if (row === undefined) return null;
  return {
    id: row.id,
    memberUserId: row.memberUserId,
    membershipTypeId: row.membershipTypeId,
    status: row.status as MembershipStatus,
    version: Number(row.version),
    activatedAt: dateOf(row.activatedAt),
  };
}

/** Whether the account holds an ACTIVE Membership of the type — read under lock. */
export async function holdsActiveMembership(
  tx: Client,
  accountId: string,
  membershipTypeId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT TOP (1) [id] FROM [dbo].[Membership] WITH (UPDLOCK, HOLDLOCK)
    WHERE [memberUserId] = ${accountId} AND [membershipTypeId] = ${membershipTypeId}
      AND [status] = N'active'`;
  return rows.length > 0;
}

/* ===========================================================================
 * Durable intent
 * ========================================================================= */

/**
 * One owed service mail, committed IN THE CALLER'S TRANSACTION beside the
 * change that owes it. The key is the purpose and the record, so a retried or
 * replayed transition inserts nothing: `WHERE NOT EXISTS` answers the ordinary
 * replay, the unique key the race.
 */
export async function commitIntent(
  tx: Client,
  input: {
    readonly purpose: MembershipCommunicationPurpose;
    readonly recipientUserId: string;
    readonly record:
      { readonly applicationId: string } | { readonly membershipId: string };
    readonly dueAt: Date;
  },
): Promise<void> {
  const applicationId =
    'applicationId' in input.record ? input.record.applicationId : null;
  const membershipId = 'membershipId' in input.record ? input.record.membershipId : null;
  const key = membershipIntentKey(input.purpose, applicationId ?? membershipId ?? '');
  await tx.$executeRaw`
    INSERT INTO [dbo].[MembershipCommunicationIntent]
      ([id], [purpose], [recipientUserId], [applicationId], [membershipId], [dueAt],
       [state], [idempotencyKey])
    SELECT ${randomUUID()}, ${input.purpose}, ${input.recipientUserId}, ${applicationId},
           ${membershipId}, ${input.dueAt}, N'pending', ${key}
    WHERE NOT EXISTS (
      SELECT 1 FROM [dbo].[MembershipCommunicationIntent] WHERE [idempotencyKey] = ${key})`;
}

/* ===========================================================================
 * Record shapes
 * ========================================================================= */

export const LABEL_SELECT = {
  locale: true,
  title: true,
  summary: true,
  description: true,
  guidance: true,
} as const;

export const TYPE_REFERENCE_SELECT = {
  id: true,
  state: true,
  primaryLocale: true,
  displayOrder: true,
  translations: { select: LABEL_SELECT, orderBy: { locale: 'asc' } },
} as const satisfies Prisma.MembershipTypeSelect;

export const BY_DISPLAY_ORDER = [{ displayOrder: 'asc' }, { id: 'asc' }] as const;

/*
 * THE ROW SHAPES ARE PLAIN INTERFACES, never Prisma payload types: a mapper a
 * factory method returns through is part of the adapter's surface, and that
 * surface names no raw database type. Each `…_SELECT` above produces exactly
 * the row its interface states, which the compiler checks at every call.
 */

interface LabelRow {
  readonly locale: string;
  readonly title: string;
  readonly summary: string;
  readonly description: string;
  readonly guidance: string | null;
}

export interface TypeReferenceRow {
  readonly id: string;
  readonly state: string;
  readonly primaryLocale: string;
  readonly displayOrder: number;
  readonly translations: readonly LabelRow[];
}

export function toPublicType(row: TypeReferenceRow): PublicMembershipType {
  return {
    id: row.id,
    primaryLocale: row.primaryLocale as PublicMembershipType['primaryLocale'],
    displayOrder: row.displayOrder,
    labels: row.translations.map((label) => ({
      locale: label.locale as PublicMembershipType['primaryLocale'],
      title: label.title,
      summary: label.summary,
      description: label.description,
      guidance: label.guidance,
    })),
  };
}

export function toTypeReference(row: TypeReferenceRow): MembershipTypeReference {
  return { ...toPublicType(row), state: row.state as MembershipTypeState };
}

/**
 * THE PUBLIC QUERY, one definition for the public list and the applicant's
 * choice: published types only, in display order then id, bounded by
 * `MEMBERSHIP_LIMITS.types`.
 */
export const PUBLISHED_TYPES = {
  where: { state: 'published' },
  select: TYPE_REFERENCE_SELECT,
  orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
  take: MEMBERSHIP_LIMITS.types,
} satisfies Prisma.MembershipTypeFindManyArgs;

export const APPLICATION_SELECT = {
  id: true,
  applicantUserId: true,
  membershipTypeId: true,
  status: true,
  withdrawalSource: true,
  version: true,
  submittedAt: true,
  reviewStartedAt: true,
  decidedAt: true,
  withdrawnAt: true,
  membership: { select: { id: true } },
} as const satisfies Prisma.MembershipApplicationSelect;

interface ApplicationRow {
  readonly id: string;
  readonly applicantUserId: string;
  readonly membershipTypeId: string;
  readonly status: string;
  readonly withdrawalSource: string | null;
  readonly version: number;
  readonly submittedAt: Date;
  readonly reviewStartedAt: Date | null;
  readonly decidedAt: Date | null;
  readonly withdrawnAt: Date | null;
  readonly membership: { readonly id: string } | null;
}

/** An application as its applicant sees it — no account id. */
export function toApplication(row: ApplicationRow): ApplicationRecord {
  return {
    id: row.id,
    membershipTypeId: row.membershipTypeId,
    status: row.status as ApplicationStatus,
    withdrawalSource: row.withdrawalSource as WithdrawalSource | null,
    version: row.version,
    submittedAt: row.submittedAt,
    reviewStartedAt: row.reviewStartedAt,
    decidedAt: row.decidedAt,
    withdrawnAt: row.withdrawnAt,
    membershipId: row.membership?.id ?? null,
  };
}

export function toStaffApplication(row: ApplicationRow): StaffApplication {
  return { ...toApplication(row), applicantAccountId: row.applicantUserId };
}

export const MEMBERSHIP_SELECT = {
  id: true,
  memberUserId: true,
  membershipTypeId: true,
  sourceApplicationId: true,
  status: true,
  closureSource: true,
  version: true,
  activatedAt: true,
  closedAt: true,
} as const satisfies Prisma.MembershipSelect;

interface MembershipRow {
  readonly id: string;
  readonly memberUserId: string;
  readonly membershipTypeId: string;
  readonly sourceApplicationId: string;
  readonly status: string;
  readonly closureSource: string | null;
  readonly version: number;
  readonly activatedAt: Date;
  readonly closedAt: Date | null;
}

/** A Membership as its member sees it — no account id. */
export function toMembership(row: MembershipRow): MembershipRecord {
  return {
    id: row.id,
    membershipTypeId: row.membershipTypeId,
    sourceApplicationId: row.sourceApplicationId,
    status: row.status as MembershipStatus,
    closureSource: row.closureSource as ClosureSource | null,
    version: row.version,
    activatedAt: row.activatedAt,
    closedAt: row.closedAt,
  };
}

export function toStaffMembership(row: MembershipRow): StaffMembership {
  return { ...toMembership(row), memberAccountId: row.memberUserId };
}

/** One application re-read in the writing transaction, after its change. */
export async function applicationRow(tx: Client, id: string): Promise<ApplicationRow> {
  const row = await tx.membershipApplication.findFirst({
    where: { id },
    select: APPLICATION_SELECT,
  });
  if (row === null) throw new MembershipDataError('conflict');
  return row;
}

export async function membershipRow(tx: Client, id: string): Promise<MembershipRow> {
  const row = await tx.membership.findFirst({ where: { id }, select: MEMBERSHIP_SELECT });
  if (row === null) throw new MembershipDataError('conflict');
  return row;
}

/* ===========================================================================
 * The clock and bounds
 * ========================================================================= */

/**
 * An instant no earlier than every instant it must follow. The migration's
 * CHECKs order each record's instants (review after submission, decision
 * after review, closure after activation); a wall clock that stepped back
 * between two writes must never turn a lawful transition into a refusal.
 */
export function later(now: Date, ...after: readonly (Date | null)[]): Date {
  let at = now.getTime();
  for (const instant of after) if (instant !== null) at = Math.max(at, instant.getTime());
  return new Date(at);
}

export function bounded(value: number, max: number): number {
  return Math.min(max, Math.max(1, Math.trunc(value) || 1));
}

export function boundedOffset(value: number): number {
  return Math.max(0, Math.min(10_000, Math.trunc(value) || 0));
}

/** A raw query's timestamp, whatever shape the driver hands back. */
export function dateOf(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export function maybeDate(value: Date | string | null): Date | null {
  return value === null ? null : dateOf(value);
}
