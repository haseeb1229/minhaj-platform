import 'server-only';

import { randomUUID } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import {
  donationIntentKey,
  type CampaignCurrencyPolicy,
  type CampaignLabel,
  type DonationAttention,
  type DonationClosure,
  type DonationCommunicationPurpose,
  type DonationCreateState,
  type DonationCurrency,
  type DonationDispute,
  type DonationFacts,
  type DonationRecord,
  type DonationRefundRecord,
  type DonationRefundState,
  type DonationState,
  type PaymentEnvironment,
  type PaymentProviderName,
  type PaymentScope,
  type StaffDonation,
} from '@minhaj/contracts/donations';

import { DonationsDataError } from './errors.ts';

/** An interface locale, as the contract's records carry it. */
export type Locale = DonationRecord['locale'];

/**
 * What the Donations adapter's halves share — refusal mapping, the campaign
 * and donation serialisation, the record shapes, the reconcile schedule and
 * the intent writer — so the catalogue, the donor's surface, the ledger, the
 * refund path, the operator surface, the relay and closure cannot disagree
 * about what a stale version, a captured donation or an owed message means.
 *
 * PACKAGE-INTERNAL, AND NEVER NAMED BY THE ADAPTER'S ENTRY: it holds the
 * Prisma value its SQL fragments are built from. Only `DonationsDataError`
 * (defined in `./errors.ts`) leaves this package.
 *
 * DONATIONS' OWN TABLES ONLY. Nothing here reads a User row, a role or any
 * other context's table: whether an account is active or closed, and whether
 * an operator holds a key, is Identity's answer, asked by the service — and
 * re-checked by the migration's own triggers beneath every write.
 *
 * MONEY IS `bigint` FROM END TO END. Prisma's BigInt columns arrive as
 * `bigint` and are written as `bigint`; nothing here converts an amount to a
 * `number`, and the state rules are the contract's own functions, never a
 * re-implementation.
 */

export type Client = Prisma.TransactionClient;

export { DonationsDataError };

/* ===========================================================================
 * Refusals
 * ========================================================================= */

/**
 * The migration's own refusals (`THROW 51340`–`51358`), by number. They are the
 * FLOOR beneath the adapter's own questions, which are asked first under the
 * lock each needs, so a caller is told precisely. Read from the STRUCTURED
 * fields the driver populates, never from message text, which a stored value
 * could otherwise imitate.
 */
const THROW_REASONS: ReadonlyMap<number, string> = new Map([
  // A campaign, its words or its policy re-keyed, or a campaign off its lifecycle.
  [51340, 'invalid-state'],
  // A campaign published without its primary words or a currency, or left without them.
  [51341, 'incomplete'],
  // The owner's activation changed or removed.
  [51342, 'invalid-state'],
  // A donation for a campaign that is not published.
  [51343, 'campaign-unavailable'],
  // A donation whose amount the campaign's current policy refuses.
  [51344, 'amount-refused'],
  // A donation outside the activated provider scope.
  [51345, 'not-activated'],
  // A linked donation for an account that is not active.
  [51346, 'account-closed'],
  // A donation created other than pending and uncaptured.
  [51347, 'invalid-state'],
  // A donation's identity, request or expected money rewritten.
  [51348, 'invalid-state'],
  // A donation's facts regressed, or moved without its version.
  [51349, 'invalid-state'],
  // A donor link changed other than released for a closed account.
  [51350, 'invalid-state'],
  // A provider event re-keyed or completed twice.
  [51351, 'conflict'],
  // A refund of a donation not captured, or charged back.
  [51352, 'invalid-state'],
  // A refund in another currency or scope than its donation.
  [51353, 'invalid'],
  // A refund without `donations.refund` and a live `donation-refund` step-up.
  [51354, 'denied'],
  // Refunds reserved beyond the captured amount.
  [51355, 'over-refund'],
  // A refund moved backwards or re-keyed.
  [51356, 'invalid-state'],
  // A settled intent reopened or re-keyed.
  [51357, 'conflict'],
  // A refund created other than requested.
  [51358, 'invalid-state'],
]);

const UNIQUE_VIOLATION = 'UniqueConstraintViolation';
const CONSTRAINT_VIOLATIONS: ReadonlySet<string> = new Set([
  'ForeignKeyConstraintViolation',
  'NullConstraintViolation',
]);

/** A uniqueness rule: its constraint name and the table that holds it. */
export interface UniqueKey {
  readonly name: string;
  readonly table: string;
}

/** One donation per operation — the race floor beneath `begin`. */
export const DONATION_OPERATION_KEY: UniqueKey = Object.freeze({
  name: 'Donation_operationId_key',
  table: 'Donation',
});
/** One refund per operation — the race floor beneath `reserve`. */
export const REFUND_OPERATION_KEY: UniqueKey = Object.freeze({
  name: 'DonationRefund_operationId_key',
  table: 'DonationRefund',
});
/** One dedup record per scoped provider event — the race floor beneath `admitEvent`. */
export const EVENT_KEY: UniqueKey = Object.freeze({
  name: 'DonationProviderEvent_event_key',
  table: 'DonationProviderEvent',
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
 * Whether the database refused a write on ONE uniqueness rule — the signal
 * that an idempotent insert met its own twin.
 *
 * SQL Server names a violated unique INDEX (2601), but for a UNIQUE
 * CONSTRAINT or primary key (2627) the driver reports only the OBJECT that
 * holds it (`dbo.<table>`), never the constraint. Every Donations key is a
 * unique constraint, so the table counts too — and every caller then
 * CONFIRMS by reading the row the key names, so a refusal on any other rule
 * of that table is never mistaken for this one.
 */
export function isUniqueViolationOn(error: unknown, key: UniqueKey): boolean {
  if (!isUnique(error)) return false;
  const { indexes } = errorFacts(error);
  return indexes.includes(key.name) || indexes.includes(`dbo.${key.table}`);
}

/**
 * Structured database refusals, and ONLY those, become domain answers. A
 * migration refusal is mapped by its number first — the authoritative rule
 * that spoke — then a uniqueness refusal (a scoped provider reference or an
 * identifier already taken: `conflict`), then a constraint refusal by its
 * category. Everything unrecognised — a deadlock, a lock timeout, an outage,
 * a permission refusal this principal should never meet — is rethrown
 * unchanged and reported as unavailable, NEVER as a business rule that was
 * not evaluated.
 */
export function refuse(error: unknown): never {
  if (error instanceof DonationsDataError) throw error;
  const { numbers, kinds } = errorFacts(error);
  for (const number of numbers) {
    const reason = THROW_REASONS.get(number);
    if (reason !== undefined) throw new DonationsDataError(reason);
  }
  if (isUnique(error)) throw new DonationsDataError('conflict');
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'P2025') throw new DonationsDataError('conflict');
  if (
    code === 'P2003' ||
    code === 'P2004' ||
    numbers.includes(547) ||
    [...kinds].some((kind) => CONSTRAINT_VIOLATIONS.has(kind))
  )
    throw new DonationsDataError('invalid');
  throw error;
}

/* ===========================================================================
 * Serialisation — campaign applock | refund ledger applock → donation row → refund rows
 * ========================================================================= */

/** How long one writer waits for a lock before giving up. */
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
 * >= 0 when granted and < 0 when not; every negative value is `unavailable` —
 * a transient condition, never a rule that said no. Released on commit and on
 * rollback alike.
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
    throw new DonationsDataError('unavailable');
}

/** Serialises campaign creation, so the `limit` count and the insert agree. */
export function lockCatalogue(tx: Client): Promise<void> {
  return acquire(tx, 'donations-catalogue');
}

/**
 * THE CAMPAIGN SERIALISATION. Every campaign change (words, policy,
 * transition) and every initiation of a donation for it takes
 * `donations:campaign:{id}` FIRST, so an archive and an initiation are
 * ordered: a donation begun after an archive commits is refused, one begun
 * before it stands; a policy change and an initiation likewise.
 */
export function lockCampaign(tx: Client, campaignId: string): Promise<void> {
  return acquire(tx, `donations:campaign:${campaignId}`);
}

/**
 * THE REFUND LEDGER SERIALISATION. Every transaction that writes a refund row —
 * a reservation, a submission's answer, a settlement, a deferral and the
 * sweeper's lease — takes `donations:refunds` FIRST, before any donation or
 * refund row.
 *
 * WHY ONE LOCK FOR ALL REFUNDS, not one per donation: the admission and
 * integrity triggers sum a donation's live refunds after the write, and while
 * the refund table is small the optimiser answers that sum with a SCAN — which
 * waits on every other transaction's uncommitted refund row. Two refund
 * writers on two different donations would each hold their own new row and
 * wait on the other's: a deadlock (proved by the concurrency suite). Refunds
 * are rare operator and provider acts, so serialising them costs nothing that
 * matters and removes the cycle. Lock order: this lock, then the donation row,
 * then its refund rows.
 */
export function lockRefundLedger(tx: Client): Promise<void> {
  return acquire(tx, 'donations:refunds');
}

/**
 * One donation row `WITH (UPDLOCK, HOLDLOCK)`, then read whole. Every writer
 * of a donation (or of its refunds) takes this first, so applying provider
 * truth, reserving a refund and settling one cannot interleave.
 */
export async function lockDonation(tx: Client, id: string): Promise<DonationRow | null> {
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT [id] FROM [dbo].[Donation] WITH (UPDLOCK, HOLDLOCK, ROWLOCK) WHERE [id] = ${id}`;
  if (locked.length === 0) return null;
  return tx.donation.findFirst({ where: { id }, select: DONATION_SELECT });
}

/** One refund row under `UPDLOCK, HOLDLOCK` — taken only after its donation's. */
export async function lockRefund(tx: Client, id: string): Promise<RefundRow | null> {
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT [id] FROM [dbo].[DonationRefund] WITH (UPDLOCK, HOLDLOCK, ROWLOCK) WHERE [id] = ${id}`;
  if (locked.length === 0) return null;
  return tx.donationRefund.findFirst({ where: { id }, select: REFUND_SELECT });
}

/* ===========================================================================
 * Record shapes
 * ========================================================================= */

/*
 * THE ROW SHAPES ARE PLAIN INTERFACES, never Prisma payload types: a mapper a
 * factory method returns through is part of the adapter's surface, and that
 * surface names no raw database type. Each `…_SELECT` produces exactly the row
 * its interface states, which the compiler checks at every call.
 */

export const CAMPAIGN_LABEL_SELECT = {
  id: true,
  primaryLocale: true,
  translations: { select: { locale: true, title: true }, orderBy: { locale: 'asc' } },
} as const satisfies Prisma.DonationCampaignSelect;

export interface CampaignLabelRow {
  readonly id: string;
  readonly primaryLocale: string;
  readonly translations: readonly { readonly locale: string; readonly title: string }[];
}

export function toCampaignLabel(row: CampaignLabelRow): CampaignLabel {
  return {
    campaignId: row.id,
    primaryLocale: row.primaryLocale as Locale,
    translations: row.translations.map((entry) => ({
      locale: entry.locale as Locale,
      title: entry.title,
    })),
  };
}

export const POLICY_SELECT = {
  currency: true,
  minimumMinor: true,
  maximumMinor: true,
  suggested1Minor: true,
  suggested2Minor: true,
  suggested3Minor: true,
} as const satisfies Prisma.DonationCampaignCurrencySelect;

export interface PolicyRow {
  readonly currency: string;
  readonly minimumMinor: bigint;
  readonly maximumMinor: bigint;
  readonly suggested1Minor: bigint | null;
  readonly suggested2Minor: bigint | null;
  readonly suggested3Minor: bigint | null;
}

export function toPolicy(row: PolicyRow): CampaignCurrencyPolicy {
  const suggestedMinor: bigint[] = [];
  for (const value of [row.suggested1Minor, row.suggested2Minor, row.suggested3Minor])
    if (value !== null) suggestedMinor.push(value);
  return {
    currency: row.currency as DonationCurrency,
    minimumMinor: row.minimumMinor,
    maximumMinor: row.maximumMinor,
    suggestedMinor,
  };
}

export const DONATION_SELECT = {
  id: true,
  campaignId: true,
  donorUserId: true,
  operationId: true,
  requestDigest: true,
  locale: true,
  checkoutLabel: true,
  currency: true,
  expectedMinor: true,
  provider: true,
  environment: true,
  accountKey: true,
  createState: true,
  checkoutReference: true,
  checkoutExpiresAt: true,
  paymentReference: true,
  state: true,
  capturedMinor: true,
  refundedMinor: true,
  refundReservedMinor: true,
  dispute: true,
  closure: true,
  cancelRequestedAt: true,
  attention: true,
  reconcileDueAt: true,
  reconcileAttempts: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  succeededAt: true,
} as const satisfies Prisma.DonationSelect;

export interface DonationRow {
  readonly id: string;
  readonly campaignId: string;
  readonly donorUserId: string | null;
  readonly operationId: string;
  readonly requestDigest: string;
  readonly locale: string;
  readonly checkoutLabel: string;
  readonly currency: string;
  readonly expectedMinor: bigint;
  readonly provider: string;
  readonly environment: string;
  readonly accountKey: string;
  readonly createState: string;
  readonly checkoutReference: string | null;
  readonly checkoutExpiresAt: Date | null;
  readonly paymentReference: string | null;
  readonly state: string;
  readonly capturedMinor: bigint | null;
  readonly refundedMinor: bigint;
  readonly refundReservedMinor: bigint;
  readonly dispute: string;
  readonly closure: string | null;
  readonly cancelRequestedAt: Date | null;
  readonly attention: string | null;
  readonly reconcileDueAt: Date | null;
  readonly reconcileAttempts: number;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly succeededAt: Date | null;
}

export function scopeOf(row: {
  readonly provider: string;
  readonly environment: string;
  readonly accountKey: string;
}): PaymentScope {
  return {
    provider: row.provider as PaymentProviderName,
    environment: row.environment as PaymentEnvironment,
    accountKey: row.accountKey,
  };
}

export function toDonationRecord(row: DonationRow): DonationRecord {
  return {
    id: row.id,
    campaignId: row.campaignId,
    locale: row.locale as Locale,
    checkoutLabel: row.checkoutLabel,
    state: row.state as DonationState,
    expected: { currency: row.currency as DonationCurrency, minor: row.expectedMinor },
    linked: row.donorUserId !== null,
    scope: scopeOf(row),
    createState: row.createState as DonationCreateState,
    checkoutReference: row.checkoutReference,
    paymentReference: row.paymentReference,
    capturedMinor: row.capturedMinor,
    refundedMinor: row.refundedMinor,
    refundReservedMinor: row.refundReservedMinor,
    dispute: row.dispute as DonationDispute,
    attention: row.attention as DonationAttention | null,
    checkoutExpiresAt: row.checkoutExpiresAt,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    succeededAt: row.succeededAt,
  };
}

/** The donation's monotonic facts, as the contract's rules take them. */
export function factsOf(row: DonationRow): DonationFacts {
  return {
    capturedMinor: row.capturedMinor,
    refundedMinor: row.refundedMinor,
    dispute: row.dispute as DonationDispute,
    closure: row.closure as DonationClosure | null,
    cancelRequested: row.cancelRequestedAt !== null,
  };
}

/** A donation joined with the words of its campaign, as listings read it. */
export const STAFF_DONATION_SELECT = {
  ...DONATION_SELECT,
  campaign: { select: CAMPAIGN_LABEL_SELECT },
} as const satisfies Prisma.DonationSelect;

export interface StaffDonationRow extends DonationRow {
  readonly campaign: CampaignLabelRow;
}

export function toStaffDonation(row: StaffDonationRow): StaffDonation {
  return {
    ...toDonationRecord(row),
    donorAccountId: row.donorUserId,
    campaign: toCampaignLabel(row.campaign),
    reconcileDueAt: row.reconcileDueAt,
    reconcileAttempts: row.reconcileAttempts,
  };
}

export const REFUND_SELECT = {
  id: true,
  donationId: true,
  operationId: true,
  requestDigest: true,
  currency: true,
  amountMinor: true,
  state: true,
  provider: true,
  environment: true,
  accountKey: true,
  refundReference: true,
  requestedAt: true,
  completedAt: true,
  reconcileAttempts: true,
  version: true,
} as const satisfies Prisma.DonationRefundSelect;

export interface RefundRow {
  readonly id: string;
  readonly donationId: string;
  readonly operationId: string;
  readonly requestDigest: string;
  readonly currency: string;
  readonly amountMinor: bigint;
  readonly state: string;
  readonly provider: string;
  readonly environment: string;
  readonly accountKey: string;
  readonly refundReference: string | null;
  readonly requestedAt: Date;
  readonly completedAt: Date | null;
  readonly reconcileAttempts: number;
  readonly version: number;
}

export function toRefundRecord(row: RefundRow): DonationRefundRecord {
  return {
    id: row.id,
    donationId: row.donationId,
    amount: { currency: row.currency as DonationCurrency, minor: row.amountMinor },
    state: row.state as DonationRefundState,
    refundReference: row.refundReference,
    requestedAt: row.requestedAt,
    completedAt: row.completedAt,
    version: row.version,
  };
}

/** One donation re-read in the writing transaction, after its change. */
export async function donationRow(tx: Client, id: string): Promise<DonationRow> {
  const row = await tx.donation.findFirst({ where: { id }, select: DONATION_SELECT });
  if (row === null) throw new DonationsDataError('conflict');
  return row;
}

export async function refundRow(tx: Client, id: string): Promise<RefundRow> {
  const row = await tx.donationRefund.findFirst({ where: { id }, select: REFUND_SELECT });
  if (row === null) throw new DonationsDataError('conflict');
  return row;
}

/**
 * What this platform's own refunds of one donation amount to: `live` — the
 * reservation (requested, pending, succeeded) — and `succeeded` alone.
 */
export async function ownRefundTotals(
  tx: Client,
  donationId: string,
): Promise<{ readonly live: bigint; readonly succeeded: bigint }> {
  const rows = await tx.donationRefund.findMany({
    where: { donationId, state: { in: ['requested', 'pending', 'succeeded'] } },
    select: { state: true, amountMinor: true },
  });
  let live = 0n;
  let succeeded = 0n;
  for (const row of rows) {
    live += row.amountMinor;
    if (row.state === 'succeeded') succeeded += row.amountMinor;
  }
  return { live, succeeded };
}

/* ===========================================================================
 * Durable intent
 * ========================================================================= */

/**
 * One owed payment acknowledgement, committed IN THE CALLER'S TRANSACTION
 * beside the change that owes it, to the donation's LINKED donor only. The key
 * is the purpose and the record (`donationIntentKey`), so a retried or
 * replayed transition inserts nothing: `WHERE NOT EXISTS` answers the ordinary
 * replay, the unique key the race. The composite key in the migration makes
 * the recipient the donation's own donor and nobody else.
 */
export async function commitIntent(
  tx: Client,
  input: {
    readonly purpose: DonationCommunicationPurpose;
    readonly donationId: string;
    readonly refundId: string | null;
    readonly recipientUserId: string;
    readonly dueAt: Date;
  },
): Promise<void> {
  const key = donationIntentKey(input.purpose, input.refundId ?? input.donationId);
  await tx.$executeRaw`
    INSERT INTO [dbo].[DonationCommunicationIntent]
      ([id], [purpose], [donationId], [refundId], [recipientUserId], [dueAt], [state], [idempotencyKey])
    SELECT ${randomUUID()}, ${input.purpose}, ${input.donationId}, ${input.refundId},
           ${input.recipientUserId}, ${input.dueAt}, N'pending', ${key}
    WHERE NOT EXISTS (
      SELECT 1 FROM [dbo].[DonationCommunicationIntent] WHERE [idempotencyKey] = ${key})`;
}

/* ===========================================================================
 * The reconcile schedule
 * ========================================================================= */

const MINUTE = 60_000;

/** A crash between `begin` and the provider create is picked up this soon. */
export const BEGIN_RECOVERY_MS = 2 * MINUTE;
/** An ambiguous create is re-asked (same key, same parameters) this soon. */
export const AMBIGUOUS_RETRY_MS = 1 * MINUTE;
/** A created checkout is first re-read this long after creation, at the latest. */
export const PENDING_FIRST_CHECK_MS = 15 * MINUTE;
/** A checkout is re-read this long after its expiry, when the webhook is missing. */
export const EXPIRY_GRACE_MS = 5 * MINUTE;
/** A requested refund's provider outcome is first re-read this soon. */
export const REFUND_FIRST_CHECK_MS = 2 * MINUTE;
/** A provider-accepted (pending) refund is re-read this often. */
export const REFUND_PENDING_CHECK_MS = 15 * MINUTE;
/** A refund submission whose answer was unknown is re-read this soon. */
export const REFUND_UNKNOWN_RETRY_MS = 1 * MINUTE;

/**
 * The bounded backoff between unanswered provider questions: 1 min, 5 min,
 * 15 min, 1 h, 3 h, 6 h, 12 h, 24 h. Once all eight waits are spent, the next
 * unanswered question stops automatic progress (`attention: unresolved`, no
 * due instant) — a person's question, never a guess.
 */
const BACKOFF_MS = [
  1 * MINUTE,
  5 * MINUTE,
  15 * MINUTE,
  60 * MINUTE,
  180 * MINUTE,
  360 * MINUTE,
  720 * MINUTE,
  1440 * MINUTE,
] as const;

export function later(now: Date, ms: number): Date {
  return new Date(now.getTime() + ms);
}

/** The next attempt after `attempts` earlier unanswered ones, or exhaustion. */
export function backoff(
  now: Date,
  attempts: number,
): { readonly attempts: number; readonly dueAt: Date | null } {
  const next = attempts + 1;
  const wait = BACKOFF_MS[next - 1];
  return { attempts: next, dueAt: wait === undefined ? null : later(now, wait) };
}

/** When a created checkout's provider truth is first re-read. */
export function firstCheckoutCheck(createdAt: Date, expiresAt: Date): Date {
  return new Date(
    Math.min(
      createdAt.getTime() + PENDING_FIRST_CHECK_MS,
      expiresAt.getTime() + EXPIRY_GRACE_MS,
    ),
  );
}

/* ===========================================================================
 * Bounds and audit shaping
 * ========================================================================= */

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

/**
 * A provider reference as an audit row may hold it: its last six characters
 * only, enough to correlate with the provider's dashboard, never the whole.
 */
export function tail(reference: string | null): string {
  return reference === null ? 'none' : reference.slice(-6);
}
