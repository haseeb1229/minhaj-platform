import { createHash, randomUUID } from 'node:crypto';

import type {
  DonationActivationReaderPort,
  DonationBeginInput,
  DonationCampaignPort,
  DonationCatalogueReaderPort,
  DonationCommunicationPort,
  DonationCurrency,
  DonationDispositionPort,
  DonationDonorPort,
  DonationLedgerPort,
  DonationOwnerPort,
  DonationRecord,
  DonationRefundPort,
  DonationStaffPort,
  PaymentObservation,
  PaymentScope,
  RefundObservation,
} from '../../packages/contracts/src/donations/index.ts';
import {
  getApplicationPrincipalCredentials,
  getDatabaseRuntimeUrl,
} from '../../packages/database/src/config.ts';
import { provisionApplicationPrincipal } from '../../packages/database/src/lifecycle/application-principal.ts';
import {
  assertApprovedLocalTarget,
  localTargetPolicy,
} from '../../packages/database/src/lifecycle/local-target.ts';
import {
  openSession,
  parseSqlServerUrl,
  type SqlSession,
} from '../../packages/database/src/lifecycle/sql-connection.ts';
import { createProofDatabase, type DisposableDatabase } from '../identity/harness.ts';
import { count, n } from '../learning/fixture-sql.ts';

export { count, n } from '../learning/fixture-sql.ts';

/**
 * Phase 27 fixture rows that ONLY the owner — or another context — may write:
 * accounts (Identity's), the activation (the owner's: the runtime holds SELECT
 * and nothing else on it), and the refund authority a refund's trigger demands
 * (a role holding `donations.refund`, its assignment, a live session and a
 * live `donation-refund` step-up — Identity's rows). Every such statement runs
 * on the MIGRATION (owner) session. Everything Donations itself does is done
 * through Donations' own adapter, as the provisioned RUNTIME principal.
 *
 * NOTHING HERE IS CONTENT OR MONEY. Every title and name is an unmistakable
 * `NON_DONATION_FIXTURE_…` sentinel, every account address sits on the
 * reserved `.invalid` TLD (`@donations-proof.invalid`), every provider
 * reference is a synthetic `…_fixture_…` string in the `fixture` environment,
 * and every digest is the SHA-256 of a sentinel.
 */

/** A sentinel no real campaign's words or a person's name could be mistaken for. */
export const sentinel = (kind: string, index: number | string) =>
  `NON_DONATION_FIXTURE_${kind}_${index}`;

/** The reserved address domain every fixture account sits on. */
export const PROOF_DOMAIN = '@donations-proof.invalid';

/** The one activated scope of every world. */
export const SCOPE: PaymentScope = Object.freeze({
  provider: 'stripe',
  environment: 'fixture',
  accountKey: 'acct_integration_fixture',
});

/** SHA-256 hex of a sentinel — a request or token digest, never a real token's. */
export function digest(seed: string): string {
  return createHash('sha256').update(`donations-proof:${seed}`).digest('hex');
}

let sequence = 0;

/* ===========================================================================
 * Identity and the owner
 * ========================================================================= */

/**
 * A synthetic account, `…@donations-proof.invalid`. The id fits Donations'
 * account bound (36) and is plain ASCII, so SQL and JavaScript ordering agree.
 */
export async function account(
  admin: SqlSession,
  status: 'active' | 'closed' | 'suspended' = 'active',
): Promise<string> {
  sequence += 1;
  const id = `don-${String(sequence).padStart(4, '0')}-${randomUUID().slice(0, 8)}`;
  await admin.query(`
    INSERT INTO [dbo].[User]
      ([id], [name], [email], [emailVerified], [createdAt], [updatedAt],
       [locale], [status], [twoFactorEnabled], [closedAt])
    VALUES
      (${n(id)}, ${n(sentinel('ACCOUNT', id))}, ${n(`${id}${PROOF_DOMAIN}`)}, 0,
       SYSUTCDATETIME(), SYSUTCDATETIME(), N'en', ${n(status)}, 0,
       ${status === 'closed' ? 'SYSUTCDATETIME()' : 'NULL'});
  `);
  return id;
}

/** Closes an account the way Identity does: status and instant. */
export function closeAccount(admin: SqlSession, id: string): Promise<unknown> {
  return admin.query(
    `UPDATE [dbo].[User] SET [status] = N'closed', [closedAt] = SYSUTCDATETIME() WHERE [id] = ${n(id)};`,
  );
}

/** The owner's fixture activation for `SCOPE` — the one row, immutable once written. */
export function activate(admin: SqlSession): Promise<unknown> {
  return admin.query(`
    INSERT INTO [dbo].[DonationActivation]
      ([id], [provider], [environment], [accountKey], [authority], [authorisedBy])
    VALUES (1, N'stripe', N'fixture', ${n(SCOPE.accountKey)}, N'fixture', ${n(sentinel('OWNER', 'activation'))});
  `);
}

/**
 * An account that holds `donations.refund` through a live assignment of a live
 * role, with a live session and a live `donation-refund` step-up — exactly
 * what the refund-admission trigger demands, written as Identity would.
 */
export async function refunder(admin: SqlSession): Promise<string> {
  const id = await account(admin);
  const role = randomUUID();
  const session = randomUUID();
  await admin.query(`
    INSERT INTO [dbo].[Role] ([id],[key],[name],[description],[system])
      VALUES (${n(role)}, ${n(`proof-donations-refund-${role.slice(0, 8)}`)}, N'NON_DONATION_FIXTURE refund role', N'Holds donations.refund for the integration proof only.', 0);
    INSERT INTO [dbo].[RolePermission] ([roleId],[permissionKey]) VALUES (${n(role)}, N'donations.refund');
    INSERT INTO [dbo].[RoleAssignment] ([userId],[roleId]) VALUES (${n(id)}, ${n(role)});
    INSERT INTO [dbo].[Session] ([id],[token],[userId],[expiresAt],[createdAt],[updatedAt])
      VALUES (${n(session)}, ${n(`proof-donations-${session}`)}, ${n(id)}, DATEADD(hour,2,SYSUTCDATETIME()), SYSUTCDATETIME(), SYSUTCDATETIME());
    INSERT INTO [dbo].[StepUpGrant] ([userId],[sessionId],[purpose],[expiresAt])
      VALUES (${n(id)}, ${n(session)}, N'donation-refund', DATEADD(hour,1,SYSUTCDATETIME()));
  `);
  return id;
}

/* ===========================================================================
 * Observations
 * ========================================================================= */

export interface AuditRow {
  readonly action: string;
  readonly actorId: string | null;
  readonly targetType: string | null;
  readonly targetId: string | null;
  readonly authorisingSource: string | null;
  readonly beforeState: string | null;
  readonly afterState: string | null;
}

/** The audit rows one target received, oldest first. */
export function auditFor(admin: SqlSession, targetId: string): Promise<AuditRow[]> {
  return admin.query<AuditRow>(`
    SELECT [action],[actorId],[targetType],[targetId],[authorisingSource],[beforeState],[afterState]
    FROM [dbo].[AuditLog] WHERE [targetId] = ${n(targetId)} ORDER BY [occurredAt], [id];
  `);
}

/** Every Donations audit row of one action, oldest first. */
export function auditOf(admin: SqlSession, action: string): Promise<AuditRow[]> {
  return admin.query<AuditRow>(`
    SELECT [action],[actorId],[targetType],[targetId],[authorisingSource],[beforeState],[afterState]
    FROM [dbo].[AuditLog] WHERE [action] = ${n(action)} ORDER BY [occurredAt], [id];
  `);
}

export interface IntentRow {
  readonly id: string;
  readonly purpose: string;
  readonly donationId: string;
  readonly refundId: string | null;
  readonly recipientUserId: string;
  readonly state: string;
  readonly idempotencyKey: string;
}

/** The intents naming one donation, in purpose order. */
export function intentsFor(admin: SqlSession, donationId: string): Promise<IntentRow[]> {
  return admin.query<IntentRow>(`
    SELECT [id],[purpose],[donationId],[refundId],[recipientUserId],[state],[idempotencyKey]
    FROM [dbo].[DonationCommunicationIntent]
    WHERE [donationId] = ${n(donationId)}
    ORDER BY [purpose], [id];
  `);
}

export interface DonationColumns {
  readonly state: string;
  readonly version: number;
  readonly donorUserId: string | null;
  readonly donorReleasedAt: Date | null;
  readonly capturedMinor: string | null;
  readonly refundedMinor: string;
  readonly refundReservedMinor: string;
  readonly reconcileDueAt: Date | null;
  readonly reconcileAttempts: number;
  readonly reconcileLeaseUntil: Date | null;
  readonly attention: string | null;
}

/** One donation's stored columns, money as exact decimal TEXT. */
export async function donationColumns(
  admin: SqlSession,
  id: string,
): Promise<DonationColumns | undefined> {
  const [row] = await admin.query<DonationColumns>(`
    SELECT [state], [version], [donorUserId], [donorReleasedAt],
      CONVERT(NVARCHAR(20), [capturedMinor]) AS [capturedMinor],
      CONVERT(NVARCHAR(20), [refundedMinor]) AS [refundedMinor],
      CONVERT(NVARCHAR(20), [refundReservedMinor]) AS [refundReservedMinor],
      [reconcileDueAt], [reconcileAttempts], [reconcileLeaseUntil], [attention]
    FROM [dbo].[Donation] WHERE [id] = ${n(id)};
  `);
  return row;
}

/* ===========================================================================
 * The world: one disposable database and Donations' REAL adapter over it
 * ========================================================================= */

export interface DonationsWorld {
  readonly db: DisposableDatabase;
  /** A session as the provisioned RUNTIME principal, for grant-floor proofs. */
  readonly app: SqlSession;
  readonly reader: DonationCatalogueReaderPort;
  readonly activation: DonationActivationReaderPort;
  readonly campaigns: DonationCampaignPort;
  readonly donor: DonationDonorPort;
  readonly ledger: DonationLedgerPort;
  readonly refunds: DonationRefundPort;
  readonly staff: DonationStaffPort;
  readonly owner: DonationOwnerPort;
  readonly communication: DonationCommunicationPort;
  readonly disposition: DonationDispositionPort;
  close(): Promise<void>;
}

/**
 * Creates the disposable database, provisions the runtime principal, repoints
 * the runtime URL at it and builds Donations' own adapter factories from the
 * package entry the web composition imports — so every write below runs as the
 * least-privilege principal under the real grants, keys and triggers. The
 * activation is NOT written here: a suite writes it with `activate` once it
 * has proved what happens without one.
 */
export async function donationsWorld(): Promise<DonationsWorld> {
  // Read BEFORE the database exists: creating it repoints `DATABASE_URL`.
  const runtimeSource = getDatabaseRuntimeUrl();
  const db = await createProofDatabase();
  // A failure while wiring must not orphan the database it just made.
  try {
    return await wire(db, runtimeSource);
  } catch (error) {
    await db.close();
    throw error;
  }
}

async function wire(
  db: DisposableDatabase,
  runtimeSource: string,
): Promise<DonationsWorld> {
  const runtimeTarget = parseSqlServerUrl(runtimeSource);
  const runtimeUrl = runtimeSource.replace(
    `database=${runtimeTarget.database}`,
    `database=${db.name}`,
  );
  if (runtimeUrl === runtimeSource)
    throw new Error('The runtime URL could not be repointed at the disposable database.');
  const connection = assertApprovedLocalTarget(
    runtimeUrl,
    localTargetPolicy(process.env, 'disposable', 'runtime'),
  );
  const principal = getApplicationPrincipalCredentials();
  await provisionApplicationPrincipal(
    db.admin,
    principal.DATABASE_APP_LOGIN,
    principal.DATABASE_APP_PASSWORD,
  );
  const app = await openSession(connection);
  process.env['DATABASE_URL'] = runtimeUrl;

  const database = await import('../../packages/database/src/index.ts');
  return {
    db,
    app,
    reader: database.createDonationCatalogueReader(),
    activation: database.createDonationActivationReader(),
    campaigns: database.createDonationCampaigns(),
    donor: database.createDonationDonor(),
    ledger: database.createDonationLedger(),
    refunds: database.createDonationRefunds(),
    staff: database.createDonationStaff(),
    owner: database.createDonationOwner(),
    communication: database.createDonationCommunication(),
    disposition: database.createDonationDisposition(),
    async close() {
      await app.close();
      await db.close();
    },
  };
}

/* ===========================================================================
 * Shared steps
 * ========================================================================= */

let order = 0;

export interface PolicyInput {
  readonly currency: DonationCurrency;
  readonly minimumMinor: bigint;
  readonly maximumMinor: bigint;
  readonly suggestedMinor: readonly bigint[];
}

/** The default policies: USD at 2, JPY at 0 and KWD at 3 decimals. */
export const POLICIES: readonly PolicyInput[] = Object.freeze([
  {
    currency: 'USD',
    minimumMinor: 100n,
    maximumMinor: 1_000_000n,
    suggestedMinor: [500n, 2500n],
  },
  {
    currency: 'JPY',
    minimumMinor: 100n,
    maximumMinor: 10_000_000n,
    suggestedMinor: [5000n],
  },
  { currency: 'KWD', minimumMinor: 1000n, maximumMinor: 5_000_000n, suggestedMinor: [] },
]);

/**
 * A new PUBLISHED campaign, created, worded, priced and published through the
 * adapter; its id and version.
 */
export async function publishedCampaign(
  world: DonationsWorld,
  actorId: string,
  policies: readonly PolicyInput[] = POLICIES,
): Promise<{ readonly id: string; readonly version: number }> {
  const id = randomUUID();
  order += 1;
  let record = await world.campaigns.createCampaign({
    id,
    actorId,
    value: { primaryLocale: 'en', displayOrder: order % 9000 },
  });
  record = await world.campaigns.saveTranslation({
    actorId,
    id,
    expectedVersion: record.version,
    translation: {
      locale: 'en',
      title: sentinel('TITLE', id),
      summary: sentinel('SUMMARY', id),
      description: sentinel('DESCRIPTION', id),
    },
  });
  for (const policy of policies)
    record = await world.campaigns.saveCurrencyPolicy({
      actorId,
      id,
      expectedVersion: record.version,
      policy: { ...policy, suggestedMinor: [...policy.suggestedMinor] },
    });
  record = await world.campaigns.transitionCampaign({
    actorId,
    id,
    expectedVersion: record.version,
    to: 'published',
  });
  return { id, version: record.version };
}

/** A begin input for one campaign; every field overridable. */
export function beginInput(
  campaignId: string,
  overrides: Partial<DonationBeginInput> = {},
): DonationBeginInput {
  const id = overrides.id ?? randomUUID();
  return {
    id,
    operationId: randomUUID(),
    requestDigest: digest(`request-${id}`),
    campaignId,
    locale: 'en',
    checkoutLabel: sentinel('LABEL', campaignId),
    donorAccountId: null,
    expected: { currency: 'USD', minor: 2500n },
    statusTokenDigest: digest(`token-${id}`),
    scope: SCOPE,
    ...overrides,
  };
}

/** The provider checkout reference a fixture donation is given. */
export const checkoutOf = (donationId: string) =>
  `cs_fixture_${donationId.replaceAll('-', '')}`;
/** The provider payment reference a fixture donation is given. */
export const paymentOf = (donationId: string) =>
  `pi_fixture_${donationId.replaceAll('-', '')}`;
/** A provider refund reference. */
export const refundReferenceOf = (refundId: string) =>
  `re_fixture_${refundId.replaceAll('-', '')}`;

/** A pending donation whose provider checkout now exists. */
export async function createdDonation(
  world: DonationsWorld,
  campaignId: string,
  overrides: Partial<DonationBeginInput> = {},
): Promise<DonationRecord> {
  const { donation } = await world.donor.begin(beginInput(campaignId, overrides));
  return world.donor.recordCheckout({
    id: donation.id,
    checkoutReference: checkoutOf(donation.id),
    expiresAt: new Date(donation.createdAt.getTime() + 3_600_000),
    now: new Date(),
  });
}

/** What the provider says about one donation's checkout; every field overridable. */
export function observation(
  donation: DonationRecord,
  overrides: Partial<PaymentObservation> = {},
): PaymentObservation {
  return {
    scope: SCOPE,
    checkoutReference: donation.checkoutReference ?? checkoutOf(donation.id),
    donationReference: donation.id,
    checkout: 'complete',
    payment: 'succeeded',
    paymentReference: paymentOf(donation.id),
    amount: donation.expected,
    capturedMinor: donation.expected.minor,
    refundedMinor: 0n,
    dispute: 'none',
    ...overrides,
  };
}

/** A created donation whose capture the ledger has applied. */
export async function capturedDonation(
  world: DonationsWorld,
  campaignId: string,
  overrides: Partial<DonationBeginInput> = {},
): Promise<DonationRecord> {
  const created = await createdDonation(world, campaignId, overrides);
  const { donation } = await world.ledger.applyObservation({
    donationId: created.id,
    observation: observation(created),
    source: 'webhook',
    actorId: null,
    now: new Date(),
  });
  return donation;
}

/** What the provider says about one refund; every field overridable. */
export function refundObservation(
  donation: DonationRecord,
  refundId: string,
  amountMinor: bigint,
  overrides: Partial<RefundObservation> = {},
): RefundObservation {
  return {
    scope: SCOPE,
    refundReference: refundReferenceOf(refundId),
    refundId,
    paymentReference: donation.paymentReference ?? paymentOf(donation.id),
    state: 'succeeded',
    amount: { currency: donation.expected.currency, minor: amountMinor },
    ...overrides,
  };
}

/** A reservation input for one donation; every field overridable. */
export function reserveInput(
  donation: DonationRecord,
  actorId: string,
  amountMinor: bigint,
  overrides: Partial<Parameters<DonationRefundPort['reserve']>[0]> = {},
): Parameters<DonationRefundPort['reserve']>[0] {
  const operationId = overrides.operationId ?? randomUUID();
  return {
    refundId: randomUUID(),
    operationId,
    requestDigest: digest(`refund-${operationId}`),
    donationId: donation.id,
    expectedVersion: donation.version,
    amount: { currency: donation.expected.currency, minor: amountMinor },
    actorId,
    ...overrides,
  };
}

/** A refusal's reason (`DonationsDataError`), `accepted`, or `unclassified`. */
export async function reasonOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const named = error as { name?: unknown; reason?: unknown } | null;
    return named?.name === 'DonationsDataError' && typeof named.reason === 'string'
      ? named.reason
      : 'unclassified';
  }
  return 'accepted';
}

/** The SQL error number a raw statement met, or `null` when it succeeded. */
export async function sqlNumber(promise: Promise<unknown>): Promise<number | null> {
  try {
    await promise;
  } catch (error) {
    const number = (error as { number?: unknown } | null)?.number;
    return typeof number === 'number' ? number : -1;
  }
  return null;
}

/** Every outcome of a set of competitors: `accepted` or the refusal reason. */
export function outcomes(promises: readonly Promise<unknown>[]): Promise<string[]> {
  return Promise.all(promises.map((promise) => reasonOf(promise)));
}

/** Donations rows of every account-linked table, by account. */
export async function ownedRows(admin: SqlSession, accountId: string): Promise<number> {
  return (
    (await count(admin, 'Donation', `[donorUserId] = ${n(accountId)}`)) +
    (await count(
      admin,
      'DonationCommunicationIntent',
      `[recipientUserId] = ${n(accountId)}`,
    ))
  );
}
