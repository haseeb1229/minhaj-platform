import 'server-only';

import { createStagingDatabase } from '../src/lifecycle/staging-database.ts';
import { STAGING_DATABASE } from '../src/lifecycle/staging-target.ts';
import {
  openAdminSession,
  openVerifiedMaster,
  runStagingCommand,
  startStagingCommand,
} from './staging-bootstrap.ts';

/**
 * `npm run staging:db:create` — creates `MinhajStaging` and writes this
 * environment's fingerprint (`minhaj.environment`, `minhaj.environment_id`).
 *
 * Idempotent: a database that already carries THIS environment's fingerprint
 * is left untouched. One that exists WITHOUT it is refused, never adopted —
 * the fingerprint is what every later staging command trusts, so writing it
 * onto an unknown database would launder that database into a trusted one.
 *
 * The only staging command that does not require the fingerprint up front,
 * because it is the command that establishes it. It still requires the
 * configuration guard and the server identity first. It connects to `master`
 * for both and for `CREATE DATABASE` — the migration URL names a database that
 * may not exist yet — and to `MinhajStaging` only to write the properties.
 */

await runStagingCommand('staging:db:create', async () => {
  const command = startStagingCommand();
  const { master, server } = await openVerifiedMaster(command, {
    requireFingerprint: false,
  });

  try {
    const outcome = await createStagingDatabase(master, command.environmentId, () =>
      openAdminSession(command, STAGING_DATABASE, 'live'),
    );
    return {
      environmentId: command.environmentId,
      machineName: server.machineName,
      database: STAGING_DATABASE,
      created: outcome.created,
      fingerprintOk: true,
    };
  } finally {
    await master.close();
  }
});
