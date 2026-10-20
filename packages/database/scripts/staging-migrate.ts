import 'server-only';

import { STAGING_DATABASE } from '../src/lifecycle/staging-target.ts';
import {
  migrateStaging,
  openVerifiedMaster,
  runStagingCommand,
  startStagingCommand,
} from './staging-bootstrap.ts';

/**
 * `npm run staging:db:migrate` — applies pending migrations to `MinhajStaging`
 * with the REAL `prisma migrate deploy`, deliberately and explicitly
 * (ARCHITECTURE.md §10.3: never automatically on deploy).
 *
 * Identification first: the configuration guard, the staging container's
 * machine name and this environment's database fingerprint. Then the CLI, then
 * `migrate status`, then the history compared with this repository's
 * migrations — unfinished, pending or unknown entries all fail.
 *
 * The Prisma child receives the process environment minus the runtime and
 * operator passwords, with `DATABASE_MIGRATION_URL` replaced by the validated
 * URL; the URL travels by environment, never by command line.
 */

await runStagingCommand('staging:db:migrate', async () => {
  const command = startStagingCommand();
  const { master } = await openVerifiedMaster(command, { requireFingerprint: true });
  await master.close();

  const report = await migrateStaging(command);

  return {
    environmentId: command.environmentId,
    database: STAGING_DATABASE,
    migrations: {
      count: report.appliedCount,
      latest: report.latest,
      unfinished: report.unfinished,
      pending: report.pending,
    },
    upToDate: true,
  };
});
