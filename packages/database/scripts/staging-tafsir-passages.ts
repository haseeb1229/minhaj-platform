import 'server-only';

import {
  runMigrationTool,
  TAFSIR_PASSAGES_TOOL_ENTRY,
} from '../src/lifecycle/migration-proof-operator.ts';
import { STAGING_DATABASE } from '../src/lifecycle/staging-target.ts';
import { ACCOUNT_ID } from './operator-arguments.ts';
import {
  argumentValue,
  openVerifiedMaster,
  runStagingCommand,
  runtimeConnection,
  startStagingCommand,
} from './staging-bootstrap.ts';

/**
 * `staging-tafsir-passages` — Quran Part 8's Quran passages proposed from
 * titles, on the staging database. `docker/staging/bin/tafsir-passages.sh`
 * runs it in the exact-SHA operations image, in the `ops` service.
 *
 *   propose --operator <accountId>
 *     The plan: every PUBLISHED Library Work and Media Video whose title names
 *     a Surah (and optionally an ayah range) by the strict, documented rule
 *     (`scripts/quran/title-passages.ts`), that carries no passage yet — its
 *     counts, its size and its SHA-256 fingerprint. Nothing is changed.
 *
 *   apply --operator <accountId> --confirm-count <n> --confirm-fingerprint <hex>
 *     The same plan, rebuilt and compared: anything but exactly the confirmed
 *     size and fingerprint is refused before a single write. Then each record's
 *     passages are set through its OWNER's service under the version the plan
 *     read — `library.administer` or `media.administer`, re-read live — which
 *     audits the change with the operator command as its origin and refuses to
 *     overwrite any passage an editor recorded.
 *
 * The operator account needs quran.read, library.read, library.administer,
 * media.read and media.administer (the platform administrator holds them).
 *
 * THE WHOLE STAGING GUARD FIRST — declared environment and instance, internal
 * host and port, `MinhajStaging`, distinct principals, TLS posture, the SQL
 * container's machine name and the database's fingerprint — then the tool, as
 * the RUNTIME principal, with no owner session at all: it writes only what the
 * runtime may write. The final stdout line is one JSON object of counts.
 */

const USAGE =
  'staging-tafsir-passages propose --operator <accountId> | ' +
  'apply --operator <accountId> --confirm-count <n> --confirm-fingerprint <hex>';

await runStagingCommand('staging:tafsir:passages', async () => {
  const [mode] = process.argv.slice(2);
  if (mode !== 'propose' && mode !== 'apply') throw new Error(`usage: ${USAGE}`);
  const operator = argumentValue('--operator');
  if (operator === undefined || !ACCOUNT_ID.test(operator))
    throw new Error('--operator must be an internal identifier, not an email address.');
  const args = ['--operator', operator];
  if (mode === 'apply') {
    const count = argumentValue('--confirm-count');
    const fingerprint = argumentValue('--confirm-fingerprint');
    if (
      count === undefined ||
      fingerprint === undefined ||
      !/^(0|[1-9][0-9]{0,6})$/u.test(count) ||
      !/^[0-9a-f]{64}$/u.test(fingerprint)
    )
      throw new Error(`usage: ${USAGE}`);
    args.push('--confirm-count', count, '--confirm-fingerprint', fingerprint);
  }

  const command = startStagingCommand();
  const { master } = await openVerifiedMaster(command, { requireFingerprint: true });
  await master.close();
  const result = await runMigrationTool({
    runtime: runtimeConnection(command, STAGING_DATABASE, 'live'),
    entry: TAFSIR_PASSAGES_TOOL_ENTRY,
    args: [mode, ...args],
    environment: command.values,
    label: 'tafsir passages',
  });
  return {
    environmentId: command.environmentId,
    database: STAGING_DATABASE,
    mode,
    result,
  };
});
