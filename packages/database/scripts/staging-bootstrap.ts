import 'server-only';

import {
  getApplicationPrincipalCredentials,
  getOperatorPrincipalCredentials,
} from '../src/config.ts';
import { provisionApplicationPrincipal } from '../src/lifecycle/application-principal.ts';
import { deployMigrations, migrationStatus } from '../src/lifecycle/migrations.ts';
import { provisionOperatorPrincipal } from '../src/lifecycle/operator-principal.ts';
import {
  openSession,
  type SqlServerConnection,
  type SqlSession,
} from '../src/lifecycle/sql-connection.ts';
import {
  assertLeastPrivilege,
  assertMigrationsCurrent,
  migrationReport,
  summariseLeastPrivilege,
  type LeastPrivilegeSummary,
  type MigrationReport,
} from '../src/lifecycle/staging-database.ts';
import {
  assertApprovedStagingConnection,
  assertStagingFingerprint,
  assertStagingServer,
  resolveStagingConfiguration,
  stagingTargetPolicy,
  STAGING_DATABASE,
  type StagingConfiguration,
  type StagingDatabasePolicy,
  type StagingServerFacts,
} from '../src/lifecycle/staging-target.ts';

/**
 * The single entry every STAGING database command starts from
 * (DELIVERY_PLAN.md Phase 28).
 *
 * ## Where configuration comes from — and where it never does
 *
 * ONLY the process environment, which on the staging host is populated from
 * root-only env files by the container runtime. This module does not read
 * `docker/.env`, does not import the local bootstrap, and has no fallback: a
 * missing variable is a refusal, never a default borrowed from local tooling.
 *
 * ## What it proves before a command does anything
 *
 * `startStagingCommand` runs the configuration half of the staging guard —
 * declared environment and instance id, internal host and port, the live
 * database name, a migration principal distinct from the runtime and operator
 * principals, and the TLS posture. `openVerifiedMaster` then runs the server
 * half on a `master` session — the staging container's machine name, and
 * (unless the command is the one that creates it) the live database's
 * fingerprint. A command calls both before its first mutation.
 *
 * Everything this module prints is non-secret metadata: host, port, database,
 * login names and the environment id. Never a password, never a URL.
 */

export interface StagingCommand extends StagingConfiguration {
  /** The process environment, the only configuration source. */
  values: Record<string, string | undefined>;
  /** One line of safe metadata: never the password, never the URL. */
  describe: () => string;
}

export function startStagingCommand(): StagingCommand {
  const values = process.env;
  const configuration = resolveStagingConfiguration(values);
  const { connection } = configuration;

  return {
    ...configuration,
    values,
    describe: () =>
      `environment=staging id=${configuration.environmentId} ` +
      `host=${connection.server}:${connection.port} database=${connection.database} ` +
      `user=${connection.user} encrypt=${connection.encrypt} ` +
      `trustServerCertificate=${connection.trustServerCertificate}`,
  };
}

/**
 * Opens `master` on the proven server and proves the server is the staging
 * container, then — when `requireFingerprint` — that `MinhajStaging` carries
 * this environment's fingerprint. The session is closed if a proof fails.
 */
export async function openVerifiedMaster(
  command: StagingCommand,
  options: { requireFingerprint: boolean },
): Promise<{ master: SqlSession; server: StagingServerFacts }> {
  const master = await openSession({ ...command.connection, database: 'master' });
  try {
    const server = await assertStagingServer(master);
    if (options.requireFingerprint) {
      await assertStagingFingerprint(master, STAGING_DATABASE, command.environmentId);
    }
    return { master, server };
  } catch (error) {
    await master.close();
    throw error;
  }
}

/** Opens a migration-principal session on a database the staging policy admits. */
export async function openAdminSession(
  command: StagingCommand,
  database: string,
  policy: StagingDatabasePolicy,
): Promise<SqlSession> {
  const connection = assertApprovedStagingConnection(
    { ...command.connection, database },
    stagingTargetPolicy(command.values, policy, 'migration'),
  );
  return openSession(connection);
}

/** The runtime principal's connection to `database`, proven by the same guard. */
export function runtimeConnection(
  command: StagingCommand,
  database: string,
  policy: StagingDatabasePolicy,
): SqlServerConnection {
  const credentials = getApplicationPrincipalCredentials(command.values);
  return assertApprovedStagingConnection(
    {
      ...command.connection,
      database,
      user: credentials.DATABASE_APP_LOGIN,
      password: credentials.DATABASE_APP_PASSWORD,
    },
    stagingTargetPolicy(command.values, policy, 'runtime'),
  );
}

/** The operator principal's connection to `MinhajStaging`, proven by the same guard. */
export function operatorConnection(command: StagingCommand): SqlServerConnection {
  const credentials = getOperatorPrincipalCredentials(command.values);
  return assertApprovedStagingConnection(
    {
      ...command.connection,
      user: credentials.DATABASE_OPERATOR_LOGIN,
      password: credentials.DATABASE_OPERATOR_PASSWORD,
    },
    stagingTargetPolicy(command.values, 'live', 'operator'),
  );
}

/**
 * The environment the Prisma CLI child receives: the process environment
 * WITHOUT the runtime and operator passwords, which `migrate deploy` never
 * needs. `DATABASE_MIGRATION_URL` is replaced by the validated URL downstream.
 */
export function prismaChildEnvironment(command: StagingCommand): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...command.values };
  delete environment['DATABASE_APP_PASSWORD'];
  delete environment['DATABASE_OPERATOR_PASSWORD'];
  return environment;
}

/**
 * Applies pending migrations with the REAL `prisma migrate deploy`, then
 * requires `migrate status` to report the schema up to date AND the history to
 * be exactly this repository's. Shared by `staging:db:migrate` and the reset.
 */
export async function migrateStaging(command: StagingCommand): Promise<MigrationReport> {
  const child = prismaChildEnvironment(command);
  await deployMigrations(command.migrationUrl, child);

  const status = await migrationStatus(command.migrationUrl, child);
  if (!status.output.includes('Database schema is up to date!')) {
    throw new Error('prisma migrate status is not healthy after deploy.');
  }

  const live = await openAdminSession(command, STAGING_DATABASE, 'live');
  try {
    const report = await migrationReport(live);
    assertMigrationsCurrent(report);
    return report;
  } finally {
    await live.close();
  }
}

/**
 * Provisions the runtime and operator principals with the reviewed grant
 * scripts (idempotent), then MEASURES each one's effective authority through a
 * session opened as that principal. Any broad role or permission fails.
 */
export async function provisionStaging(command: StagingCommand): Promise<{
  runtime: LeastPrivilegeSummary;
  operator: LeastPrivilegeSummary;
}> {
  const runtime = getApplicationPrincipalCredentials(command.values);
  const operator = getOperatorPrincipalCredentials(command.values);

  const admin = await openAdminSession(command, STAGING_DATABASE, 'live');
  try {
    await provisionApplicationPrincipal(
      admin,
      runtime.DATABASE_APP_LOGIN,
      runtime.DATABASE_APP_PASSWORD,
    );
    await provisionOperatorPrincipal(
      admin,
      operator.DATABASE_OPERATOR_LOGIN,
      operator.DATABASE_OPERATOR_PASSWORD,
    );

    const app = await openSession(runtimeConnection(command, STAGING_DATABASE, 'live'));
    let runtimeSummary: LeastPrivilegeSummary;
    try {
      runtimeSummary = await summariseLeastPrivilege(
        app,
        admin,
        runtime.DATABASE_APP_LOGIN,
        {
          checkObjectInventory: true,
        },
      );
    } finally {
      await app.close();
    }
    assertLeastPrivilege(runtimeSummary);

    const op = await openSession(operatorConnection(command));
    let operatorSummary: LeastPrivilegeSummary;
    try {
      // The operator's object rights are EXECUTE on two procedures through its
      // role, which the runtime inventory does not describe; its BROAD
      // authority is measured exactly as the runtime's is.
      operatorSummary = await summariseLeastPrivilege(
        op,
        admin,
        operator.DATABASE_OPERATOR_LOGIN,
        { checkObjectInventory: false },
      );
    } finally {
      await op.close();
    }
    assertLeastPrivilege(operatorSummary);

    return { runtime: runtimeSummary, operator: operatorSummary };
  } finally {
    await admin.close();
  }
}

/**
 * Runs a staging command and makes its FINAL stdout line exactly one JSON
 * object — the contract the host scripts read with `tail -n 1 | jq`.
 *
 * On success the line is the command's summary with `ok: true`. On failure it
 * is `{command, ok: false, error}` with the error's FIRST LINE only and the
 * exit code is 1. Every error raised by the staging guards, the URL parser and
 * the configuration schemas is built never to contain a URL or a password;
 * taking only the first line additionally keeps multi-line tool output (such
 * as the Prisma CLI's) out of the machine-readable record. The full message
 * goes to stderr for the operator.
 */
export async function runStagingCommand(
  name: string,
  body: () => Promise<Record<string, unknown>>,
): Promise<void> {
  try {
    const summary = await body();
    process.stdout.write(`${JSON.stringify({ command: name, ok: true, ...summary })}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${name} failed: ${message}\n`);
    process.stdout.write(
      `${JSON.stringify({ command: name, ok: false, error: message.split('\n')[0] ?? '' })}\n`,
    );
    process.exitCode = 1;
  }
}

/** The value after `flag` in the command line, or `undefined`. */
export function argumentValue(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}
