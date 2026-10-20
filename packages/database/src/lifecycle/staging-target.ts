import 'server-only';

import { getDatabaseMigrationUrl } from '../config.ts';
import {
  BACKUP_SOURCE_DATABASE,
  isRestoreDatabaseName,
  STAGING_BACKUP_NAMING,
  STAGING_RESTORE_PREFIX,
  STAGING_SOURCE_DATABASE,
} from './backup.ts';
import { principalRefusal, type PrincipalPolicy } from './principal-policy.ts';
import {
  parseSqlServerUrl,
  type SqlServerConnection,
  type SqlSession,
} from './sql-connection.ts';

/**
 * POSITIVE identification of the staging database target, run before any
 * staging lifecycle command opens a session, spawns the Prisma CLI or runs a
 * statement (DELIVERY_PLAN.md Phase 28).
 *
 * ## The governing rule: a database NAME alone is insufficient
 *
 * `MinhajStaging` is a string anybody can type, and a production-like
 * database restored under that name, a foreign instance answering on the same
 * port, or a URL pointed at the wrong server would all satisfy a name check.
 * So the staging target is identified by FOUR independent facts, every one of
 * which must hold before anything is mutated:
 *
 *   1. CONFIGURATION — the process declares itself staging
 *      (`MINHAJ_DEPLOYMENT_ENVIRONMENT=staging`, exactly) and names its
 *      environment instance (`MINHAJ_STAGING_ENVIRONMENT_ID`, a lowercase
 *      UUID v4 generated once per staging environment);
 *   2. ADDRESS — the URL names the internal Docker-network SQL host
 *      `sqlserver` on port 1433, the approved database for this operation,
 *      the expected principal, and the encrypted internal TLS posture;
 *   3. SERVER — once connected, `SERVERPROPERTY('MachineName')` is the staging
 *      SQL container's hostname, `minhaj-staging-sql`;
 *   4. DATABASE — the live database carries the database-level extended
 *      properties `minhaj.environment = staging` and
 *      `minhaj.environment_id = <the configured id>`, which only
 *      `staging:db:create` writes. A database lacking or mismatching them was
 *      not created by this environment's tooling and is never adopted.
 *
 * The first two are pure configuration checks (`assertApprovedStagingTarget`);
 * the last two need a session and are separate functions taking the session as
 * an argument, so tests drive them with a fake.
 *
 * ## Why an allowlist and not a blocklist
 *
 * Exactly the reasoning `./local-target.ts` records: a blocklist fails open on
 * every name nobody thought of. The two names refused explicitly below —
 * `MinhajPlatform` and every `MinhajPhase1*` — are refused by the allowlist
 * anyway; they are named only so the refusal says WHY those are wrong.
 *
 * ## No `docker/.env`
 *
 * Staging configuration arrives as process environment from root-only env
 * files on the staging host. Nothing here, or in any staging command, reads
 * the local `docker/.env` or uses the local bootstrap.
 *
 * Errors never carry the URL or a password (SECURITY_BASELINE.md §18.1).
 */

/** `MINHAJ_DEPLOYMENT_ENVIRONMENT` must equal this, exactly. */
export const STAGING_ENVIRONMENT = 'staging';

/** The SQL Server service name on the internal staging Docker network. */
export const STAGING_SQL_HOST = 'sqlserver';

/** The container-internal SQL Server port; nothing else is approved. */
export const STAGING_SQL_PORT = 1433;

/** The staging SQL container's hostname, as `SERVERPROPERTY('MachineName')` reports it. */
export const STAGING_SQL_MACHINE_NAME = 'minhaj-staging-sql';

/** The live staging database. */
export const STAGING_DATABASE = STAGING_SOURCE_DATABASE;

export { STAGING_RESTORE_PREFIX };

/** Database-level extended property naming the environment kind. */
export const FINGERPRINT_ENVIRONMENT_PROPERTY = 'minhaj.environment';

/** Database-level extended property naming the environment INSTANCE. */
export const FINGERPRINT_ENVIRONMENT_ID_PROPERTY = 'minhaj.environment_id';

/** A lowercase UUID v4 — the exact shape `crypto.randomUUID()` produces. */
const ENVIRONMENT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Which database names a staging operation may touch.
 *
 *   - `live`    — only `MinhajStaging`;
 *   - `restore` — only `MinhajStagingRestore_<32 hex>`, the restore proof's
 *                 disposable target. Never the live database.
 */
export type StagingDatabasePolicy = 'live' | 'restore';

export interface StagingTargetPolicy {
  database: StagingDatabasePolicy;
  principal: PrincipalPolicy;
  /** `DATABASE_APP_LOGIN`. */
  runtimeLogin: string | undefined;
  /** `DATABASE_OPERATOR_LOGIN`. */
  operatorLogin: string | undefined;
}

/** Raised when a target cannot be positively identified as this staging environment. */
export class StagingTargetError extends Error {
  readonly property: string;

  constructor(property: string, reason: string) {
    super(`Refusing to run against this staging target: ${reason} (${property}).`);
    this.name = 'StagingTargetError';
    this.property = property;
  }
}

/**
 * Proves the process declares itself THIS staging environment, and returns
 * its instance identifier.
 *
 * `Staging`, `STAGING`, `staging ` and `production` are all refusals: the
 * value is compared exactly, because a tolerant comparison is how a
 * production host that happens to carry a similar string gets accepted.
 */
export function resolveStagingIdentity(values: Record<string, string | undefined>): {
  environmentId: string;
} {
  const environment = values['MINHAJ_DEPLOYMENT_ENVIRONMENT'];
  if (environment !== STAGING_ENVIRONMENT) {
    throw new StagingTargetError(
      'MINHAJ_DEPLOYMENT_ENVIRONMENT',
      environment === undefined || environment === ''
        ? 'the process does not declare a deployment environment'
        : `the process declares a deployment environment other than exactly '${STAGING_ENVIRONMENT}'`,
    );
  }

  const environmentId = values['MINHAJ_STAGING_ENVIRONMENT_ID'];
  if (environmentId === undefined || !ENVIRONMENT_ID.test(environmentId)) {
    throw new StagingTargetError(
      'MINHAJ_STAGING_ENVIRONMENT_ID',
      'the staging environment id is missing or is not a lowercase UUID v4',
    );
  }

  return { environmentId };
}

/** Whether `host` is exactly the internal staging SQL service name. */
export function isApprovedStagingHost(host: string): boolean {
  // Exact equality on the PARSED host. `sqlserver.evil`, `SQLSERVER`,
  // `sqlserver.` and every address are refused: the internal network resolves
  // this one service name, and nothing else was approved.
  return host === STAGING_SQL_HOST;
}

export function isStagingRestoreDatabaseName(name: string): boolean {
  return isRestoreDatabaseName(name, STAGING_BACKUP_NAMING);
}

/** Throws unless `database` is a name this staging operation may touch. */
export function assertApprovedStagingDatabase(
  database: string,
  policy: StagingDatabasePolicy,
): void {
  if (database === BACKUP_SOURCE_DATABASE) {
    throw new StagingTargetError(
      'database',
      `${BACKUP_SOURCE_DATABASE} is the local engineering database and is never a staging target`,
    );
  }
  if (database.startsWith('MinhajPhase1')) {
    throw new StagingTargetError(
      'database',
      `'${database}' is in the local Phase 1 rehearsal namespace and is never a staging target`,
    );
  }

  if (policy === 'live') {
    if (database !== STAGING_DATABASE) {
      throw new StagingTargetError(
        'database',
        `this operation may only touch ${STAGING_DATABASE}, and '${database}' is not it`,
      );
    }
    return;
  }

  if (!isStagingRestoreDatabaseName(database)) {
    throw new StagingTargetError(
      'database',
      `this operation may only touch a disposable ${STAGING_RESTORE_PREFIX}<32 hex> ` +
        `database, and '${database}' is not one`,
    );
  }
}

/**
 * Proves an already-parsed connection names the approved staging target.
 *
 * Every check is positive, and the whole set must hold: the internal host, the
 * internal port, a database this operation may touch, the expected principal
 * among three distinct configured accounts, and the encrypted internal TLS
 * posture.
 */
export function assertApprovedStagingConnection(
  connection: SqlServerConnection,
  policy: StagingTargetPolicy,
): SqlServerConnection {
  if (!isApprovedStagingHost(connection.server)) {
    throw new StagingTargetError(
      'host',
      `'${connection.server}' is not the internal staging SQL host. Approved: ${STAGING_SQL_HOST}`,
    );
  }

  if (connection.port !== STAGING_SQL_PORT) {
    throw new StagingTargetError(
      'port',
      `port ${connection.port} is not the internal staging SQL Server port ${STAGING_SQL_PORT}`,
    );
  }

  assertApprovedStagingDatabase(connection.database, policy.database);

  // Staging always runs with all three principals configured, so their
  // distinctness is PROVEN here rather than assumed: an operator that is the
  // runtime account, or a runtime account nobody named, is a refusal.
  const { runtimeLogin, operatorLogin } = policy;
  if (runtimeLogin === undefined || runtimeLogin === '') {
    throw new StagingTargetError(
      'user',
      'DATABASE_APP_LOGIN is not configured, so the runtime principal cannot be ' +
        'positively identified',
    );
  }
  if (operatorLogin === undefined || operatorLogin === '') {
    throw new StagingTargetError(
      'user',
      'DATABASE_OPERATOR_LOGIN is not configured, so the privileged-operations ' +
        'principal cannot be positively identified',
    );
  }
  if (runtimeLogin === operatorLogin) {
    throw new StagingTargetError(
      'user',
      `the operator principal is the same account as the runtime principal ` +
        `('${runtimeLogin}'); a web request must never be able to run operator procedures`,
    );
  }

  const refusal = principalRefusal(connection.user, policy.principal, {
    runtimeLogin,
    operatorLogin,
  });
  if (refusal !== undefined) throw new StagingTargetError('user', refusal);

  if (policy.principal === 'migration' && connection.user === operatorLogin) {
    // The shared rule proves migration is not the runtime account; staging
    // also proves it is not the operator. Routine bootstrap and recovery must
    // never run with schema authority, nor schema change with operator rights.
    throw new StagingTargetError(
      'user',
      `the migration principal is the same account as the operator principal ` +
        `('${connection.user}'); migration authority must be held separately`,
    );
  }

  if (!connection.encrypt) {
    throw new StagingTargetError(
      'encrypt',
      'the connection is not encrypted; encrypt=true is required',
    );
  }
  if (!connection.trustServerCertificate) {
    // The staging SQL container serves a self-signed certificate on the
    // internal network only, exactly like the local container: without this
    // the Prisma CLI fails with P1011 several steps later.
    throw new StagingTargetError(
      'trustServerCertificate',
      'trustServerCertificate=true is required for the self-signed internal ' +
        'staging SQL Server certificate',
    );
  }

  return connection;
}

/**
 * Proves a URL names the approved staging target, and returns the parsed
 * connection. Throws `StagingTargetError` or `SqlConnectionUrlError`; neither
 * carries the URL or the password.
 */
export function assertApprovedStagingTarget(
  url: string,
  policy: StagingTargetPolicy,
): SqlServerConnection {
  return assertApprovedStagingConnection(parseSqlServerUrl(url), policy);
}

/** Builds a policy from the staging process environment. */
export function stagingTargetPolicy(
  values: Record<string, string | undefined>,
  database: StagingDatabasePolicy,
  principal: PrincipalPolicy,
): StagingTargetPolicy {
  const runtimeLogin = values['DATABASE_APP_LOGIN'];
  const operatorLogin = values['DATABASE_OPERATOR_LOGIN'];

  return {
    database,
    principal,
    runtimeLogin: runtimeLogin === '' ? undefined : runtimeLogin,
    operatorLogin: operatorLogin === '' ? undefined : operatorLogin,
  };
}

/** The resolved, CONFIGURATION-verified staging target for a lifecycle command. */
export interface StagingConfiguration {
  environmentId: string;
  /** The validated migration URL, for the Prisma CLI and for sessions. */
  migrationUrl: string;
  /** The parsed migration connection, proven against the live policy. */
  connection: SqlServerConnection;
  runtimeLogin: string;
  operatorLogin: string;
}

/**
 * Resolves and validates staging configuration from an EXPLICIT record — the
 * process environment in every command, a synthetic record in the tests.
 *
 * Only the configuration half of the identification. The server and database
 * fingerprints need a session, and every mutating command runs them next.
 */
export function resolveStagingConfiguration(
  values: Record<string, string | undefined>,
): StagingConfiguration {
  const { environmentId } = resolveStagingIdentity(values);
  const migrationUrl = getDatabaseMigrationUrl(values);
  const policy = stagingTargetPolicy(values, 'live', 'migration');
  const connection = assertApprovedStagingTarget(migrationUrl, policy);

  return {
    environmentId,
    migrationUrl,
    connection,
    // Proven non-empty by the guard above.
    runtimeLogin: policy.runtimeLogin ?? '',
    operatorLogin: policy.operatorLogin ?? '',
  };
}

/* ---------------------------------------------------------------------------
 * Fingerprints — need a session, read nothing but catalogue metadata
 * ------------------------------------------------------------------------- */

/** Non-secret facts about the SQL Server instance, safe to print. */
export interface StagingServerFacts {
  machineName: string | null;
  productVersion: string | null;
  productUpdateLevel: string | null;
  edition: string | null;
  fullTextInstalled: boolean | null;
}

export async function readServerFacts(session: SqlSession): Promise<StagingServerFacts> {
  const rows = await session.query<{
    machineName: string | null;
    productVersion: string | null;
    productUpdateLevel: string | null;
    edition: string | null;
    fullTextInstalled: number | null;
  }>(`
    SELECT
      CAST(SERVERPROPERTY('MachineName') AS nvarchar(128))        AS machineName,
      CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128))     AS productVersion,
      CAST(SERVERPROPERTY('ProductUpdateLevel') AS nvarchar(128)) AS productUpdateLevel,
      CAST(SERVERPROPERTY('Edition') AS nvarchar(128))            AS edition,
      CAST(FULLTEXTSERVICEPROPERTY('IsFullTextInstalled') AS int) AS fullTextInstalled;
  `);

  if (rows.length !== 1) {
    throw new StagingTargetError(
      'server',
      `the server identity probe returned ${rows.length} rows; the server is unidentified`,
    );
  }
  const row = rows[0];
  const fullText = row?.fullTextInstalled;

  return {
    machineName: row?.machineName ?? null,
    productVersion: row?.productVersion ?? null,
    productUpdateLevel: row?.productUpdateLevel ?? null,
    edition: row?.edition ?? null,
    fullTextInstalled: fullText === 0 || fullText === 1 ? fullText === 1 : null,
  };
}

/**
 * Proves the session reached the staging SQL container, by its hostname.
 *
 * A missing or different machine name is a refusal: a URL that resolved to a
 * different instance on the same network is exactly what the address check
 * alone cannot rule out.
 */
export async function assertStagingServer(
  session: SqlSession,
): Promise<StagingServerFacts> {
  const facts = await readServerFacts(session);
  if (facts.machineName !== STAGING_SQL_MACHINE_NAME) {
    throw new StagingTargetError(
      'server',
      facts.machineName === null
        ? 'the server reports no machine name, so it cannot be identified as staging'
        : `the server's machine name '${facts.machineName}' is not the staging SQL ` +
            `container '${STAGING_SQL_MACHINE_NAME}'`,
    );
  }
  return facts;
}

/** What a database's own catalogue says about which environment it belongs to. */
export interface DatabaseFingerprint {
  exists: boolean;
  /** `minhaj.environment`, or `null` when absent. */
  environment: string | null;
  /** `minhaj.environment_id`, or `null` when absent. */
  environmentId: string | null;
}

/**
 * Reads a database's fingerprint through a session on `master`.
 *
 * The name is validated against the staging policies before it is embedded,
 * so this can only ever look at `MinhajStaging` or a staging restore target.
 * Existence must be ANSWERED: an unanswered probe throws, because "could not
 * tell" is not evidence that the database is absent.
 */
export async function readDatabaseFingerprint(
  master: SqlSession,
  database: string,
): Promise<DatabaseFingerprint> {
  assertApprovedStagingDatabase(
    database,
    database === STAGING_DATABASE ? 'live' : 'restore',
  );

  const presence = await master.query<{ present: number | null }>(
    `SELECT CASE WHEN DB_ID(N'${database}') IS NULL THEN 0 ELSE 1 END AS present;`,
  );
  const present = presence.length === 1 ? presence[0]?.present : undefined;
  if (present !== 0 && present !== 1) {
    throw new StagingTargetError(
      'database',
      `the existence probe for ${database} gave no valid answer; its state is unknown`,
    );
  }
  if (present === 0) return { exists: false, environment: null, environmentId: null };

  const rows = await master.query<{ name: string; value: string | null }>(`
    SELECT CAST([name] AS nvarchar(128)) AS [name],
           CAST([value] AS nvarchar(256)) AS [value]
    FROM [${database}].sys.extended_properties
    WHERE [class] = 0
      AND [name] IN (N'${FINGERPRINT_ENVIRONMENT_PROPERTY}', N'${FINGERPRINT_ENVIRONMENT_ID_PROPERTY}');
  `);

  const valueOf = (name: string): string | null =>
    rows.find((row) => row.name === name)?.value ?? null;

  return {
    exists: true,
    environment: valueOf(FINGERPRINT_ENVIRONMENT_PROPERTY),
    environmentId: valueOf(FINGERPRINT_ENVIRONMENT_ID_PROPERTY),
  };
}

/**
 * Why a fingerprint is NOT this staging environment's, or `undefined` when it
 * is. Pure, so the decision is testable without a server. The foreign values
 * themselves are deliberately not echoed: they belong to some other database.
 */
export function fingerprintRefusal(
  fingerprint: DatabaseFingerprint,
  environmentId: string,
): string | undefined {
  if (!fingerprint.exists) return 'the database does not exist';
  if (fingerprint.environment === null) {
    return (
      `the database carries no '${FINGERPRINT_ENVIRONMENT_PROPERTY}' property, so ` +
      `staging:db:create did not create it; it is never adopted`
    );
  }
  if (fingerprint.environment !== STAGING_ENVIRONMENT) {
    return `the database is marked as an environment other than '${STAGING_ENVIRONMENT}'`;
  }
  if (fingerprint.environmentId === null) {
    return `the database carries no '${FINGERPRINT_ENVIRONMENT_ID_PROPERTY}' property`;
  }
  if (fingerprint.environmentId !== environmentId) {
    return (
      'the database belongs to a different staging environment instance than ' +
      'MINHAJ_STAGING_ENVIRONMENT_ID'
    );
  }
  return undefined;
}

/** Throws unless `database` exists and carries THIS environment's fingerprint. */
export async function assertStagingFingerprint(
  master: SqlSession,
  database: string,
  environmentId: string,
): Promise<DatabaseFingerprint> {
  const fingerprint = await readDatabaseFingerprint(master, database);
  const refusal = fingerprintRefusal(fingerprint, environmentId);
  if (refusal !== undefined) {
    throw new StagingTargetError('fingerprint', `${database}: ${refusal}`);
  }
  return fingerprint;
}

/**
 * Runs `mutate` ONLY after all four identifications hold: configuration,
 * address, server and database fingerprint.
 *
 * The seam the "the guard gates the mutation" tests use. `openMaster` is
 * injected so a test supplies a fake session and observes that the mutation
 * was never called for a refused target.
 */
export async function withVerifiedStagingTarget<T>(
  values: Record<string, string | undefined>,
  openMaster: (connection: SqlServerConnection) => Promise<SqlSession>,
  mutate: (target: StagingConfiguration, master: SqlSession) => Promise<T>,
): Promise<T> {
  const configuration = resolveStagingConfiguration(values);
  const master = await openMaster({ ...configuration.connection, database: 'master' });
  try {
    await assertStagingServer(master);
    await assertStagingFingerprint(master, STAGING_DATABASE, configuration.environmentId);
    return await mutate(configuration, master);
  } finally {
    await master.close();
  }
}
