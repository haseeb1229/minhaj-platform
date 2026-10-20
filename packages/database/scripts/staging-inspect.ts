import 'server-only';

import { openSession, type SqlSession } from '../src/lifecycle/sql-connection.ts';
import {
  migrationReport,
  summariseLeastPrivilege,
  type LeastPrivilegeSummary,
} from '../src/lifecycle/staging-database.ts';
import {
  fingerprintRefusal,
  readDatabaseFingerprint,
  STAGING_DATABASE,
} from '../src/lifecycle/staging-target.ts';
import {
  openAdminSession,
  openVerifiedMaster,
  runStagingCommand,
  runtimeConnection,
  startStagingCommand,
} from './staging-bootstrap.ts';

/**
 * `npm run staging:db:inspect` — a READ-ONLY report on the staging database.
 *
 * Nothing here writes: every statement is a catalogue read, a `SELECT` or a
 * `HAS_PERMS_BY_NAME` probe. It still runs the configuration guard and the
 * server identity check first, so it can never report on — and so never be
 * mistaken for a report on — some other server.
 *
 * It SUCCEEDS when `MinhajStaging` does not exist yet (`databaseExists:
 * false`), because that is the legitimate state before `staging:db:create`.
 * A database that exists WITHOUT this environment's fingerprint is reported
 * (`fingerprintOk: false`), is not read any further, and fails the command:
 * the report must not present a foreign database's contents as staging's.
 *
 * The runtime least-privilege summary is measured through a session opened AS
 * the runtime principal; before provisioning that login does not exist, which
 * is reported rather than treated as a failure.
 */

await runStagingCommand('staging:db:inspect', async () => {
  const command = startStagingCommand();
  const { master, server } = await openVerifiedMaster(command, {
    requireFingerprint: false,
  });

  try {
    const fingerprint = await readDatabaseFingerprint(master, STAGING_DATABASE);
    const refusal = fingerprint.exists
      ? fingerprintRefusal(fingerprint, command.environmentId)
      : undefined;

    const report: Record<string, unknown> = {
      environmentId: command.environmentId,
      machineName: server.machineName,
      sqlVersion: server.productVersion,
      sqlUpdateLevel: server.productUpdateLevel,
      edition: server.edition,
      fullTextInstalled: server.fullTextInstalled,
      database: STAGING_DATABASE,
      databaseExists: fingerprint.exists,
      fingerprintOk: fingerprint.exists && refusal === undefined,
      migrations: null,
      runtimePrincipal: null,
      assetCount: null,
      donationActivationCount: null,
    };

    if (!fingerprint.exists) return report;
    if (refusal !== undefined) {
      throw new Error(
        `${STAGING_DATABASE} exists but is not this environment's: ${refusal}. ` +
          `Report: ${JSON.stringify(report)}`,
      );
    }

    const live = await openAdminSession(command, STAGING_DATABASE, 'live');
    try {
      const hasHistory = await tableExists(live, '_prisma_migrations');
      if (hasHistory) {
        const migrations = await migrationReport(live);
        report['migrations'] = {
          count: migrations.appliedCount,
          latest: migrations.latest,
          unfinished: migrations.unfinished,
          pending: migrations.pending.length,
          unknown: migrations.unknown,
        };
      }

      report['assetCount'] = (await tableExists(live, 'Asset'))
        ? await countRows(live, 'Asset')
        : null;
      report['donationActivationCount'] = (await tableExists(live, 'DonationActivation'))
        ? await countRows(live, 'DonationActivation')
        : null;

      report['runtimePrincipal'] = await runtimeSummary(command, live);
    } finally {
      await live.close();
    }

    return report;
  } finally {
    await master.close();
  }
});

async function tableExists(session: SqlSession, table: string): Promise<boolean> {
  const [row] = await session.query<{ present: number }>(
    `SELECT CASE WHEN OBJECT_ID(N'[dbo].[${table}]', N'U') IS NULL THEN 0 ELSE 1 END AS present;`,
  );
  return row?.present === 1;
}

async function countRows(session: SqlSession, table: string): Promise<number> {
  const [row] = await session.query<{ total: number | string }>(
    `SELECT COUNT_BIG(*) AS total FROM [dbo].[${table}];`,
  );
  return Number(row?.total);
}

async function runtimeSummary(
  command: ReturnType<typeof startStagingCommand>,
  admin: SqlSession,
): Promise<
  | ({ status: 'measured'; leastPrivilege: boolean } & LeastPrivilegeSummary)
  | { status: 'unavailable'; reason: string }
> {
  let app: SqlSession;
  try {
    app = await openSession(runtimeConnection(command, STAGING_DATABASE, 'live'));
  } catch (error) {
    // Typically "Login failed" before provisioning. The driver's first line
    // names the login, never the password.
    return {
      status: 'unavailable',
      reason: ((error as Error).message.split('\n')[0] ?? '').slice(0, 200),
    };
  }

  try {
    const summary = await summariseLeastPrivilege(app, admin, command.runtimeLogin, {
      checkObjectInventory: true,
    });
    const leastPrivilege =
      summary.broadRoles.length === 0 &&
      summary.heldDatabasePermissions.length === 0 &&
      summary.heldSchemaPermissions.length === 0 &&
      summary.overreachingGrants.length === 0;
    return { status: 'measured', leastPrivilege, ...summary };
  } finally {
    await app.close();
  }
}
