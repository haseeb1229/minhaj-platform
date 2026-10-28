import 'server-only';

import {
  MIGRATION_TOOL_ENTRIES,
  runMigrationTool,
} from '../src/lifecycle/migration-proof-operator.ts';
import { STAGING_DATABASE } from '../src/lifecycle/staging-target.ts';
import { isMigrationRunMode, toolArguments } from './staging-migration-arguments.ts';
import {
  openVerifiedMaster,
  runStagingCommand,
  runtimeConnection,
  startStagingCommand,
} from './staging-bootstrap.ts';

/**
 * `staging-migration-run` — registers or runs ONE authorised migration source
 * on the staging database (Phase 30). `docker/staging/bin/migration-run.sh`
 * runs it in the exact-SHA operations image, in the `ingest` service: the one
 * operator container with an outbound network, used for nothing else.
 *
 *   register --source <key> --operator <accountId>
 *            --authorisation-reference <reference> --authorised-on <YYYY-MM-DD> [--activate]
 *   run      --source <key> --operator <accountId> --pages <n> --limit <n>
 *            [--items <a,b,…>] [--max-items <n>]
 *
 * TWO STEPS, ONE PRINCIPAL FOR THE WORK:
 *
 *   1. the whole staging guard — declared environment and instance, internal
 *      host and port, `MinhajStaging`, distinct principals, TLS posture, the
 *      SQL container's machine name and the database's fingerprint;
 *   2. the tool in a child process as the RUNTIME principal, exactly as the
 *      application runs it: the operator's `migration.administer` is read
 *      live, the source's written authorisation is required, and fetching
 *      goes only through the safe boundary bound to the source's own hosts.
 *
 * Every argument is checked against a strict shape before it reaches the child
 * (`staging-migration-arguments.ts`), so nothing an operator typed is ever
 * interpreted as more than a key, an account identifier, a date or a number.
 * The final stdout line is one JSON object; nothing printed is a URL, a password
 * or content.
 */

await runStagingCommand('staging:migration:run', async () => {
  const [mode, ...rest] = process.argv.slice(2);
  if (!isMigrationRunMode(mode))
    throw new Error('usage: staging-migration-run register|run --source <key> …');
  const args = toolArguments(mode, rest);

  const command = startStagingCommand();
  const { master } = await openVerifiedMaster(command, { requireFingerprint: true });
  await master.close();

  const result = await runMigrationTool({
    runtime: runtimeConnection(command, STAGING_DATABASE, 'live'),
    entry: MIGRATION_TOOL_ENTRIES[mode],
    args,
    environment: command.values,
    label: `migration ${mode}`,
  });
  return {
    environmentId: command.environmentId,
    database: STAGING_DATABASE,
    mode,
    result,
  };
});
