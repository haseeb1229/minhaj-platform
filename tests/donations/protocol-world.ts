import { randomUUID } from 'node:crypto';

import type { PaymentScope } from '../../packages/contracts/src/donations/index.ts';
import type * as DatabaseModule from '../../packages/database/src/index.ts';
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

/**
 * Phase 27 — the world the provider-protocol proof runs in: one disposable
 * database, the provisioned RUNTIME principal, and Donations' REAL adapter
 * factories built from the package entry the web composition imports.
 *
 * The only rows written on the MIGRATION (owner) session are the ones no
 * Donations act may write: Identity's accounts, roles, sessions and step-up
 * grants (the refund authority the database re-checks), the operator's
 * activation row, and "time passing" — moving a scheduled reconcile instant
 * into the past, a scheduling-only change the triggers admit without a
 * version move. Everything Donations itself does runs as the runtime
 * principal, through its services and adapters.
 *
 * NOTHING HERE IS CONTENT OR A CREDENTIAL. Every title and name is a
 * `NON_DONATION_FIXTURE_…` sentinel, every address sits on the reserved
 * `.invalid` TLD, and every key and secret is a synthetic `…_fixture_…` value.
 */

/** A SQL Server Unicode literal. Values are this file's constants or generated ids. */
export const n = (value: string) => `N'${value.replaceAll("'", "''")}'`;

export const sentinel = (kind: string, index: number | string) =>
  `NON_DONATION_FIXTURE_${kind}_${index}`;

const PROOF_DOMAIN = '@donation-protocol-proof.invalid';

let sequence = 0;

/** A row count, for "wrote nothing" and "wrote exactly one" proofs. */
export async function count(
  admin: SqlSession,
  table: string,
  where = '1 = 1',
): Promise<number> {
  const [row] = await admin.query<{ total: number }>(
    `SELECT COUNT_BIG(*) AS [total] FROM [dbo].[${table}] WHERE ${where};`,
  );
  return Number(row?.total ?? 0);
}

/* ===========================================================================
 * Identity — the live answers the database re-checks
 * ========================================================================= */

/** A synthetic account. The id fits every account bound (36) and is plain ASCII. */
export async function account(
  admin: SqlSession,
  status: 'active' | 'closed' = 'active',
): Promise<string> {
  sequence += 1;
  const id = `dpp-${String(sequence).padStart(4, '0')}-${randomUUID().slice(0, 8)}`;
  await admin.query(`
    INSERT INTO [dbo].[User]
      ([id], [name], [email], [emailVerified], [createdAt], [updatedAt],
       [locale], [status], [twoFactorEnabled])
    VALUES
      (${n(id)}, ${n(sentinel('ACCOUNT', id))}, ${n(`${id}${PROOF_DOMAIN}`)}, 0,
       SYSUTCDATETIME(), SYSUTCDATETIME(), N'en', ${n(status)}, 0);
  `);
  return id;
}

/**
 * The refund authority the refund-admission trigger re-checks: an active role
 * holding `donations.refund`, a live assignment of it, a live session and a
 * live `donation-refund` step-up bound to that session. With
 * `stepUp: false` the key is held but no step-up exists.
 */
export async function refundAuthority(
  admin: SqlSession,
  accountId: string,
  options: { readonly stepUp: boolean } = { stepUp: true },
): Promise<void> {
  const roleId = randomUUID();
  const sessionId = randomUUID();
  await admin.query(`
    INSERT INTO [dbo].[Role] ([id],[key],[name],[description],[system])
    VALUES (${n(roleId)}, ${n(`proof-donations-${roleId}`)}, N'Synthetic Donations role', N'Test fixture', 0);
    INSERT INTO [dbo].[RolePermission] ([roleId],[permissionKey]) VALUES (${n(roleId)}, N'donations.refund');
    INSERT INTO [dbo].[RoleAssignment] ([userId],[roleId]) VALUES (${n(accountId)}, ${n(roleId)});
    INSERT INTO [dbo].[Session] ([id],[token],[userId],[expiresAt],[createdAt],[updatedAt])
    VALUES (${n(sessionId)}, ${n(`proof-donations-${sessionId}`)}, ${n(accountId)},
            DATEADD(hour, 1, SYSUTCDATETIME()), SYSUTCDATETIME(), SYSUTCDATETIME());
  `);
  if (options.stepUp)
    await admin.query(`
      INSERT INTO [dbo].[StepUpGrant] ([id],[userId],[sessionId],[purpose],[expiresAt])
      VALUES (${n(randomUUID())}, ${n(accountId)}, ${n(sessionId)}, N'donation-refund',
              DATEADD(minute, 30, SYSUTCDATETIME()));
    `);
}

/* ===========================================================================
 * The operator
 * ========================================================================= */

/** The operator's single, immutable activation of one non-production scope. */
export async function activate(admin: SqlSession, scope: PaymentScope): Promise<void> {
  await admin.query(`
    INSERT INTO [dbo].[DonationActivation]
      ([id],[provider],[environment],[accountKey],[authority],[authorisedBy],[reference])
    VALUES (1, ${n(scope.provider)}, ${n(scope.environment)}, ${n(scope.accountKey)},
            N'fixture', N'NON_DONATION_FIXTURE operator', NULL);
  `);
}

/** Time passing: a donation's scheduled reconcile instant is now due. */
export async function dueNow(admin: SqlSession, donationId: string): Promise<void> {
  await admin.query(`
    UPDATE [dbo].[Donation]
    SET [reconcileDueAt] = DATEADD(second, -1, SYSUTCDATETIME())
    WHERE [id] = ${n(donationId)} AND [reconcileDueAt] IS NOT NULL;
  `);
}

/** Time passing: a refund's scheduled reconcile instant is now due. */
export async function refundDueNow(admin: SqlSession, refundId: string): Promise<void> {
  await admin.query(`
    UPDATE [dbo].[DonationRefund]
    SET [reconcileDueAt] = DATEADD(second, -1, SYSUTCDATETIME())
    WHERE [id] = ${n(refundId)} AND [reconcileDueAt] IS NOT NULL;
  `);
}

/* ===========================================================================
 * Observations — every money column read back as exact TEXT
 * ========================================================================= */

export interface DonationColumns {
  readonly id: string;
  readonly donorUserId: string | null;
  readonly operationId: string;
  readonly statusTokenDigest: string;
  readonly locale: string;
  readonly currency: string;
  readonly currencyExponent: number;
  readonly expectedMinor: string;
  readonly provider: string;
  readonly environment: string;
  readonly accountKey: string;
  readonly createState: string;
  readonly checkoutReference: string | null;
  readonly paymentReference: string | null;
  readonly state: string;
  readonly capturedMinor: string | null;
  readonly refundedMinor: string;
  readonly refundReservedMinor: string;
  readonly dispute: string;
  readonly closure: string | null;
  readonly cancelRequestedAt: Date | null;
  readonly attention: string | null;
  readonly reconcileDueAt: Date | null;
  readonly reconcileAttempts: number;
  readonly version: number;
  readonly succeededAt: Date | null;
}

export async function donationColumns(
  admin: SqlSession,
  where: string,
): Promise<DonationColumns | undefined> {
  const [row] = await admin.query<DonationColumns>(`
    SELECT [id],[donorUserId],[operationId],[statusTokenDigest],[locale],[currency],
           CAST([currencyExponent] AS INT) AS [currencyExponent],
           CAST([expectedMinor] AS NVARCHAR(20)) AS [expectedMinor],
           [provider],[environment],[accountKey],[createState],[checkoutReference],
           [paymentReference],[state],
           CAST([capturedMinor] AS NVARCHAR(20)) AS [capturedMinor],
           CAST([refundedMinor] AS NVARCHAR(20)) AS [refundedMinor],
           CAST([refundReservedMinor] AS NVARCHAR(20)) AS [refundReservedMinor],
           [dispute],[closure],[cancelRequestedAt],[attention],[reconcileDueAt],
           [reconcileAttempts],[version],[succeededAt]
    FROM [dbo].[Donation] WHERE ${where};
  `);
  return row;
}

export interface EventColumns {
  readonly eventId: string;
  readonly eventType: string;
  readonly donationId: string | null;
  readonly result: string | null;
  readonly processedAt: Date | null;
  readonly payloadDigest: string;
}

export function eventRows(admin: SqlSession, where = '1 = 1'): Promise<EventColumns[]> {
  return admin.query<EventColumns>(`
    SELECT [eventId],[eventType],[donationId],[result],[processedAt],[payloadDigest]
    FROM [dbo].[DonationProviderEvent] WHERE ${where} ORDER BY [receivedAt], [id];
  `);
}

export interface RefundColumns {
  readonly id: string;
  readonly state: string;
  readonly amountMinor: string;
  readonly refundReference: string | null;
  readonly completedAt: Date | null;
  readonly reconcileDueAt: Date | null;
  readonly version: number;
}

export function refundRows(
  admin: SqlSession,
  donationId: string,
): Promise<RefundColumns[]> {
  return admin.query<RefundColumns>(`
    SELECT [id],[state],CAST([amountMinor] AS NVARCHAR(20)) AS [amountMinor],
           [refundReference],[completedAt],[reconcileDueAt],[version]
    FROM [dbo].[DonationRefund] WHERE [donationId] = ${n(donationId)}
    ORDER BY [requestedAt], [id];
  `);
}

export interface IntentColumns {
  readonly purpose: string;
  readonly refundId: string | null;
  readonly recipientUserId: string;
  readonly idempotencyKey: string;
}

export function intentRows(
  admin: SqlSession,
  donationId: string,
): Promise<IntentColumns[]> {
  return admin.query<IntentColumns>(`
    SELECT [purpose],[refundId],[recipientUserId],[idempotencyKey]
    FROM [dbo].[DonationCommunicationIntent] WHERE [donationId] = ${n(donationId)}
    ORDER BY [purpose], [idempotencyKey];
  `);
}

/**
 * Every value every Donations table — and every audit row about a donation,
 * refund or campaign — holds, as one string, for "nothing secret was stored"
 * proofs.
 */
export async function everyStoredValue(admin: SqlSession): Promise<string> {
  const tables = await admin.query<{ name: string }>(`
    SELECT [TABLE_NAME] AS [name] FROM [INFORMATION_SCHEMA].[TABLES]
    WHERE [TABLE_SCHEMA] = N'dbo' AND [TABLE_TYPE] = N'BASE TABLE' AND [TABLE_NAME] LIKE N'Donation%'
    ORDER BY [TABLE_NAME];
  `);
  const parts: string[] = [];
  for (const { name } of tables) {
    const rows = await admin.query<Record<string, unknown>>(
      `SELECT * FROM [dbo].[${name}];`,
    );
    parts.push(
      name,
      JSON.stringify(rows, (_key, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
    );
  }
  const audit = await admin.query<Record<string, unknown>>(`
    SELECT * FROM [dbo].[AuditLog] WHERE [action] LIKE N'donations.%';
  `);
  parts.push('AuditLog', JSON.stringify(audit));
  return parts.join('\n');
}

/* ===========================================================================
 * The world
 * ========================================================================= */

type DatabaseEntry = typeof DatabaseModule;

export interface ProtocolWorld {
  readonly db: DisposableDatabase;
  readonly admin: SqlSession;
  /** The package entry the web composition imports, loaded AFTER the URL was repointed. */
  readonly database: DatabaseEntry;
  close(): Promise<void>;
}

/**
 * Creates the disposable database, provisions the runtime principal and
 * repoints the runtime URL at it, so every adapter built from `database` runs
 * as the least-privilege principal under the real grants, keys and triggers.
 */
export async function protocolWorld(): Promise<ProtocolWorld> {
  // Read BEFORE the database exists: creating it repoints `DATABASE_URL`.
  const runtimeSource = getDatabaseRuntimeUrl();
  const db = await createProofDatabase();
  try {
    const runtimeTarget = parseSqlServerUrl(runtimeSource);
    const runtimeUrl = runtimeSource.replace(
      `database=${runtimeTarget.database}`,
      `database=${db.name}`,
    );
    if (runtimeUrl === runtimeSource)
      throw new Error(
        'The runtime URL could not be repointed at the disposable database.',
      );
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
    // Proves the runtime principal can sign in to THIS database before use.
    const probe = await openSession(connection);
    await probe.close();
    process.env['DATABASE_URL'] = runtimeUrl;

    const database = await import('../../packages/database/src/index.ts');
    return {
      db,
      admin: db.admin,
      database,
      async close() {
        await db.close();
      },
    };
  } catch (error) {
    // A failure while wiring must not orphan the database it just made.
    await db.close();
    throw error;
  }
}
