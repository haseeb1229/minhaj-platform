import 'server-only';

import {
  assertResetConfirmation,
  assertResetSafe,
  createStagingDatabase,
  dropStagingDatabase,
} from '../src/lifecycle/staging-database.ts';
import { STAGING_DATABASE } from '../src/lifecycle/staging-target.ts';
import {
  argumentValue,
  migrateStaging,
  openAdminSession,
  openVerifiedMaster,
  provisionStaging,
  runStagingCommand,
  startStagingCommand,
} from './staging-bootstrap.ts';

/**
 * `npm run staging:db:reset -- --confirm "reset MinhajStaging <environment-id>"`
 * — the explicit, destructive reset of the staging DATABASE, and nothing else.
 *
 * NEVER AUTOMATIC. Nothing invokes this as a side effect: no deploy, no
 * startup, no other command. It runs only when a person types the phrase that
 * names this environment instance.
 *
 * Refused, before any statement runs, unless ALL of:
 *
 *   1. `--confirm` is EXACTLY `reset MinhajStaging <MINHAJ_STAGING_ENVIRONMENT_ID>`;
 *   2. the staging configuration guard holds, and the connection is the
 *      MIGRATION principal — the runtime and operator principals are refused
 *      by the same guard, so neither the web application's login nor the
 *      operator's can drop the database;
 *   3. the server is the staging container and `MinhajStaging` carries THIS
 *      environment's fingerprint;
 *   4. either `MinhajStaging` holds no material data (the rule is documented
 *      on `materialData` in `src/lifecycle/staging-database.ts`: any row in
 *      any table other than Prisma's history and the migration-seeded
 *      catalogue), or a verified full staging backup of the CURRENT database
 *      finished within the last 60 minutes and its artifact still exists.
 *
 * Then: drop, recreate with the fingerprint, migrate with the real Prisma CLI,
 * provision both principals and prove least privilege.
 *
 * It does NOT touch storage. The host script stops web/realtime first and
 * handles the storage root only after this succeeds.
 */

await runStagingCommand('staging:db:reset', async () => {
  const command = startStagingCommand();
  assertResetConfirmation(argumentValue('--confirm'), command.environmentId);

  const { master } = await openVerifiedMaster(command, { requireFingerprint: true });
  let safety;
  try {
    const live = await openAdminSession(command, STAGING_DATABASE, 'live');
    try {
      safety = await assertResetSafe(master, live);
    } finally {
      await live.close();
    }

    await dropStagingDatabase(master);
    await createStagingDatabase(master, command.environmentId, () =>
      openAdminSession(command, STAGING_DATABASE, 'live'),
    );
  } finally {
    await master.close();
  }

  const migrations = await migrateStaging(command);
  const principals = await provisionStaging(command);

  return {
    environmentId: command.environmentId,
    database: STAGING_DATABASE,
    materialTables: safety.material.tables.length,
    authorisingBackup: safety.backup,
    dropped: true,
    recreated: true,
    fingerprintOk: true,
    migrations: { count: migrations.appliedCount, latest: migrations.latest },
    leastPrivilege: {
      runtime: principals.runtime.login,
      operator: principals.operator.login,
    },
    storageTouched: false,
  };
});
