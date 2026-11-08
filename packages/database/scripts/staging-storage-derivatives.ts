import 'server-only';

import {
  runMigrationTool,
  STORAGE_DERIVATIVES_TOOL_ENTRY,
} from '../src/lifecycle/migration-proof-operator.ts';
import { STAGING_DATABASE } from '../src/lifecycle/staging-target.ts';
import {
  argumentValue,
  openVerifiedMaster,
  runStagingCommand,
  runtimeConnection,
  startStagingCommand,
} from './staging-bootstrap.ts';

/**
 * `staging-storage-derivatives [--limit <n>]` — Storage's derivative backfill on
 * the staging database (Rebaseline R2). `docker/staging/bin/derivatives-backfill.sh`
 * runs it in the exact-SHA operations image, in the `ops` service, with the
 * staging storage root mounted and the scanner reachable.
 *
 * TWO STEPS, ONE PRINCIPAL FOR THE WORK:
 *
 *   1. the whole staging guard — declared environment and instance, internal
 *      host and port, `MinhajStaging`, distinct principals, TLS posture, the
 *      SQL container's machine name and the database's fingerprint;
 *   2. the backfill in a child process as the RUNTIME principal, exactly as the
 *      application derives: every picture a published record shows is put to
 *      its owning context's public policy, and Storage stores each derivative
 *      through its own custody (`scripts/storage/derivatives-backfill.ts`).
 *
 * Idempotent and resumable; the final stdout line is one JSON object of
 * counts — never a URL, a key or a password.
 */

await runStagingCommand('staging:storage:derivatives', async () => {
  const limit = argumentValue('--limit');
  if (limit !== undefined && !/^[1-9][0-9]{0,4}$/.test(limit))
    throw new Error('usage: staging-storage-derivatives [--limit <n>]');

  const command = startStagingCommand();
  const { master } = await openVerifiedMaster(command, { requireFingerprint: true });
  await master.close();

  const result = await runMigrationTool({
    runtime: runtimeConnection(command, STAGING_DATABASE, 'live'),
    entry: STORAGE_DERIVATIVES_TOOL_ENTRY,
    args: limit === undefined ? [] : ['--limit', limit],
    environment: command.values,
    label: 'storage derivatives',
  });
  return { environmentId: command.environmentId, database: STAGING_DATABASE, result };
});
