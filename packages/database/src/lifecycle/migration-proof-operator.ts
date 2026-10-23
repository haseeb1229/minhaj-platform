import 'server-only';

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isDisposableDatabaseName } from './disposable-database.ts';
import type { SqlServerConnection, SqlSession } from './sql-connection.ts';
import { STAGING_DATABASE } from './staging-target.ts';

/**
 * The OWNER side of the Phase-29 migration fixture proof
 * (`scripts/migration/staging-fixture-proof.ts`).
 *
 * ## What it writes, and as whom
 *
 * One disposable synthetic OPERATOR, written by the MIGRATION principal as
 * Identity's own rows would hold it: an account at `@migration-proof.invalid`,
 * a custom role carrying exactly `migration.read`, `migration.administer`,
 * `migration.publish`, `media.read` and `media.administer`, its assignment, a
 * live session, a verified second factor with confirmed recovery codes, and a
 * live `migration-publication` step-up grant on that session. Nothing else.
 * `migration.publish` is externally gated and bundled to no standing role, so
 * the proof must bring its own holder rather than borrow a real person's.
 *
 * Removal revokes the assignment, deactivates the role and deletes the session
 * and the grant; the account and every audit row the proof caused remain, as
 * evidence of what was done and by whom.
 *
 * ## Where it may run
 *
 * Only on `MinhajStaging` or a disposable `MinhajPhase1Test_<32 hex>` database,
 * proven from the CONNECTED database's own name (`DB_NAME()`), never from a URL
 * the caller describes. Callers have already run the staging or local target
 * guard before opening the session; this is the second, independent check.
 *
 * ## The proof itself runs as the RUNTIME principal, in a child process
 *
 * `runMigrationFixtureProof` starts the proof under Node with an allowlisted
 * environment whose only database setting is the runtime principal's URL: the
 * process that exercises the services never holds schema authority, the
 * migration URL or any other principal's password.
 */

export const MIGRATION_PROOF_EMAIL_DOMAIN = 'migration-proof.invalid';

/** Every key the synthetic operator holds, and no other. */
export const MIGRATION_PROOF_PERMISSIONS = Object.freeze([
  'migration.read',
  'migration.administer',
  'migration.publish',
  'media.read',
  'media.administer',
] as const);

const ROLE_KEY_PREFIX = 'migration-proof-';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface MigrationProofOperator {
  readonly accountId: string;
  readonly email: string;
  readonly roleId: string;
  readonly sessionId: string;
  readonly grantId: string;
}

/** The address the operator's account carries — derivable from its id alone. */
export function migrationProofEmail(accountId: string): string {
  return `migration-proof-${accountId}@${MIGRATION_PROOF_EMAIL_DOMAIN}`;
}

/** Which kind of approved target a database name is, or a refusal. */
export function assertMigrationProofDatabase(name: string): 'staging' | 'disposable' {
  if (name === STAGING_DATABASE) return 'staging';
  if (isDisposableDatabaseName(name)) return 'disposable';
  throw new Error(
    `Refusing to run the migration proof against '${name}': only ${STAGING_DATABASE} ` +
      `or a disposable MinhajPhase1Test_<32 hex> database is approved.`,
  );
}

async function assertConnectedDatabase(
  sql: SqlSession,
): Promise<'staging' | 'disposable'> {
  const rows = await sql.query<{ name: string | null }>('SELECT DB_NAME() AS [name];');
  const name = rows.length === 1 ? rows[0]?.name : null;
  if (typeof name !== 'string')
    throw new Error('The connected database could not be identified; refusing.');
  return assertMigrationProofDatabase(name);
}

function assertUuid(value: string, label: string): void {
  if (!UUID.test(value)) throw new Error(`${label} is not a generated identifier.`);
}

/**
 * Writes the synthetic operator. Every value is generated here or a constant of
 * this module, so nothing a caller typed is spliced into a statement.
 */
export async function createMigrationProofOperator(
  sql: SqlSession,
): Promise<MigrationProofOperator> {
  await assertConnectedDatabase(sql);
  const operator: MigrationProofOperator = (() => {
    const accountId = randomUUID();
    return {
      accountId,
      email: migrationProofEmail(accountId),
      roleId: randomUUID(),
      sessionId: randomUUID(),
      grantId: randomUUID(),
    };
  })();
  const o = operator;
  const grants = MIGRATION_PROOF_PERMISSIONS.map(
    (key) => `(N'${o.roleId}', N'${key}')`,
  ).join(', ');

  await sql.query(`
    SET XACT_ABORT ON;
    BEGIN TRANSACTION;
    INSERT INTO [dbo].[User] ([id],[name],[email],[emailVerified],[createdAt],[updatedAt],[locale],[status],[twoFactorEnabled])
      VALUES (N'${o.accountId}', N'NON_MIGRATION_FIXTURE operator', N'${o.email}', 1, SYSUTCDATETIME(), SYSUTCDATETIME(), N'en', N'active', 1);
    INSERT INTO [dbo].[Role] ([id],[key],[name],[description],[system])
      VALUES (N'${o.roleId}', N'${ROLE_KEY_PREFIX}${o.roleId.slice(0, 8)}', N'NON_MIGRATION_FIXTURE proof operator',
              N'Holds the migration and media keys for one synthetic migration proof only.', 0);
    INSERT INTO [dbo].[RolePermission] ([roleId],[permissionKey]) VALUES ${grants};
    INSERT INTO [dbo].[RoleAssignment] ([userId],[roleId],[grantedById],[grantedReason])
      VALUES (N'${o.accountId}', N'${o.roleId}', N'${o.accountId}', N'migration fixture proof');
    INSERT INTO [dbo].[Session] ([id],[token],[userId],[expiresAt],[createdAt],[updatedAt])
      VALUES (N'${o.sessionId}', N'migration-proof-${o.sessionId}', N'${o.accountId}', DATEADD(hour, 2, SYSUTCDATETIME()), SYSUTCDATETIME(), SYSUTCDATETIME());
    INSERT INTO [dbo].[TwoFactor] ([secret],[backupCodes],[userId],[verified])
      VALUES (N'not-a-real-secret-migration-proof', N'not-real-codes-migration-proof', N'${o.accountId}', 1);
    INSERT INTO [dbo].[PrivilegedSecurityPosture] ([userId],[secondFactorVerifiedAt],[recoveryCodesIssuedAt],[recoveryCodesConfirmedAt])
      VALUES (N'${o.accountId}', SYSUTCDATETIME(), SYSUTCDATETIME(), SYSUTCDATETIME());
    INSERT INTO [dbo].[StepUpGrant] ([id],[userId],[sessionId],[purpose],[expiresAt])
      VALUES (N'${o.grantId}', N'${o.accountId}', N'${o.sessionId}', N'migration-publication', DATEADD(hour, 1, SYSUTCDATETIME()));
    COMMIT TRANSACTION;
  `);
  return operator;
}

export interface MigrationProofRemoval {
  readonly assignmentsRevoked: number;
  readonly sessionsDeleted: number;
  readonly grantsDeleted: number;
}

/**
 * Takes the operator's authority away and PROVES it is gone: no live
 * assignment of a proof role, no session, no grant. Refuses any account that
 * is not a proof operator's, so it can never be turned on a real person.
 * Idempotent.
 */
export async function removeMigrationProofOperator(
  sql: SqlSession,
  accountId: string,
): Promise<MigrationProofRemoval> {
  await assertConnectedDatabase(sql);
  assertUuid(accountId, 'The operator account id');
  const email = migrationProofEmail(accountId);
  const owner = await sql.query<{ id: string }>(
    `SELECT [id] FROM [dbo].[User] WHERE [id] = N'${accountId}' AND [email] = N'${email}';`,
  );
  if (owner.length !== 1)
    throw new Error(
      'The account is not a migration proof operator; nothing was changed.',
    );

  const [removed] = await sql.query<MigrationProofRemoval>(`
    SET XACT_ABORT ON;
    BEGIN TRANSACTION;
    DECLARE @revoked int, @grants int, @sessions int;
    UPDATE ra SET [revokedAt] = SYSUTCDATETIME(), [revokedById] = ra.[userId],
                  [revokedReason] = N'migration fixture proof finished'
      FROM [dbo].[RoleAssignment] ra
      JOIN [dbo].[Role] r ON r.[id] = ra.[roleId]
      WHERE ra.[userId] = N'${accountId}' AND ra.[revokedAt] IS NULL
        AND r.[key] LIKE N'${ROLE_KEY_PREFIX}%' AND r.[system] = 0;
    SET @revoked = @@ROWCOUNT;
    UPDATE r SET [deactivatedAt] = SYSUTCDATETIME(), [updatedAt] = SYSUTCDATETIME()
      FROM [dbo].[Role] r
      WHERE r.[deactivatedAt] IS NULL AND r.[key] LIKE N'${ROLE_KEY_PREFIX}%' AND r.[system] = 0
        AND EXISTS (SELECT 1 FROM [dbo].[RoleAssignment] ra WHERE ra.[roleId] = r.[id] AND ra.[userId] = N'${accountId}');
    DELETE FROM [dbo].[StepUpGrant] WHERE [userId] = N'${accountId}';
    SET @grants = @@ROWCOUNT;
    DELETE FROM [dbo].[Session] WHERE [userId] = N'${accountId}';
    SET @sessions = @@ROWCOUNT;
    COMMIT TRANSACTION;
    SELECT @revoked AS [assignmentsRevoked], @sessions AS [sessionsDeleted], @grants AS [grantsDeleted];
  `);

  const [left] = await sql.query<{
    assignments: number;
    sessions: number;
    grants: number;
  }>(`
    SELECT
      (SELECT COUNT(*) FROM [dbo].[RoleAssignment] WHERE [userId] = N'${accountId}' AND [revokedAt] IS NULL) AS [assignments],
      (SELECT COUNT(*) FROM [dbo].[Session] WHERE [userId] = N'${accountId}') AS [sessions],
      (SELECT COUNT(*) FROM [dbo].[StepUpGrant] WHERE [userId] = N'${accountId}') AS [grants];
  `);
  if (
    left === undefined ||
    Number(left.assignments) !== 0 ||
    Number(left.sessions) !== 0 ||
    Number(left.grants) !== 0
  )
    throw new Error('The proof operator still holds authority after removal.');

  return {
    assignmentsRevoked: Number(removed?.assignmentsRevoked ?? 0),
    sessionsDeleted: Number(removed?.sessionsDeleted ?? 0),
    grantsDeleted: Number(removed?.grantsDeleted ?? 0),
  };
}

/* ---------------------------------------------------------------------------
 * The proof process
 * ------------------------------------------------------------------------- */

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
);

/** The proof entry, relative to the repository (and to `/app` in the ops image). */
export const MIGRATION_PROOF_ENTRY = path.join(
  'scripts',
  'migration',
  'staging-fixture-proof.ts',
);

/**
 * What the proof process inherits from this one: the platform basics Node
 * needs, Storage's and the scanner's settings, and the release identity —
 * never a database URL, a login or a password.
 */
const INHERITED = Object.freeze([
  'PATH',
  'Path',
  'SystemRoot',
  'HOME',
  'USERPROFILE',
  'TEMP',
  'TMP',
  'TMPDIR',
  'NODE_ENV',
  'STORAGE_ROOT',
  'STORAGE_MAX_BYTES',
  'CLAMAV_HOST',
  'CLAMAV_PORT',
  'CLAMAV_TIMEOUT_MS',
  'MINHAJ_RELEASE_SHA',
]);

/** The runtime principal's URL, in the shape the application's own `DATABASE_URL` has. */
function runtimeUrl(connection: SqlServerConnection): string {
  // A brace or separator in the password would need escaping the URL grammar
  // does not reliably round-trip; such a credential is refused, never printed.
  if (/[{};]/.test(connection.password))
    throw new Error(
      'The runtime principal password cannot be carried in a connection URL.',
    );
  return (
    `sqlserver://${connection.server}:${String(connection.port)};database=${connection.database};` +
    `user=${connection.user};password={${connection.password}};` +
    `encrypt=${String(connection.encrypt)};trustServerCertificate=${String(connection.trustServerCertificate)}`
  );
}

/**
 * Runs the proof as the RUNTIME principal against `connection`'s database and
 * returns its final JSON line. Its stderr passes through; its stdout is
 * captured, and only that last line is read.
 */
export async function runMigrationFixtureProof(input: {
  /** The RUNTIME principal's connection, already proven by the caller's guard. */
  readonly runtime: SqlServerConnection;
  readonly operator: MigrationProofOperator;
  readonly environment: Record<string, string | undefined>;
}): Promise<Record<string, unknown>> {
  assertMigrationProofDatabase(input.runtime.database);
  const environment: Record<string, string> = {};
  for (const key of INHERITED) {
    const value = input.environment[key];
    if (value !== undefined && value !== '') environment[key] = value;
  }
  environment['DATABASE_URL'] = runtimeUrl(input.runtime);

  const child = spawn(
    process.execPath,
    [
      '--conditions=react-server',
      MIGRATION_PROOF_ENTRY,
      '--operator',
      input.operator.accountId,
      '--session',
      input.operator.sessionId,
    ],
    { cwd: repoRoot, env: environment, stdio: ['ignore', 'pipe', 'inherit'] },
  );
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });

  const last = output.trimEnd().split('\n').at(-1) ?? '';
  let summary: Record<string, unknown>;
  try {
    summary = JSON.parse(last) as Record<string, unknown>;
  } catch {
    throw new Error(
      `The migration proof ended without a JSON summary (exit ${String(exitCode)}).`,
    );
  }
  if (exitCode !== 0 || summary['ok'] !== true)
    throw new Error(
      `The migration proof failed: ${typeof summary['error'] === 'string' ? summary['error'] : `exit ${String(exitCode)}`}.`,
    );
  return summary;
}
