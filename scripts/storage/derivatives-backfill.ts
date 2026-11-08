import {
  assertApprovedLocalTarget,
  localTargetPolicy,
} from '../../packages/database/src/lifecycle/local-target.ts';
import { parseSqlServerUrl } from '../../packages/database/src/lifecycle/sql-connection.ts';
import {
  isApprovedStagingHost,
  STAGING_DATABASE,
  STAGING_SQL_PORT,
} from '../../packages/database/src/lifecycle/staging-target.ts';
import { backfillDerivatives } from '../../apps/web/src/composition/storage-derivatives-backfill.ts';
import { CommandError, positiveInteger, runCommand } from '../migration/cli.ts';

/**
 * `npm run storage:derivatives:backfill -- [--limit <n>]` (Rebaseline R2)
 *
 * Renders the missing WebP derivatives (320, 640, 960 and 1440 pixels wide,
 * never wider than the picture) of every picture a published record shows NOW
 * — Editorial lead images, Library covers, Media photographs and posters,
 * People portraits — each first put to its owning context's public policy, so
 * nothing restricted, drafted or withdrawn is ever decoded
 * (`apps/web/src/composition/storage-derivatives-backfill.ts`).
 *
 * Idempotent and resumable: a derived width is kept, so running it again
 * creates nothing new and continues anything an earlier run left. Bounded:
 * `--limit` pictures per run (default 1,000, at most 10,000).
 *
 * THE TARGET IS PROVED BEFORE ANYTHING IS READ. `DATABASE_URL` must be either
 * the staging database on the internal staging SQL host — which
 * `staging-storage-derivatives` proves in full before it starts this command
 * as the runtime principal — or, locally, the approved loopback SQL Server,
 * `MinhajPlatform` or a disposable test database, as the configured runtime
 * principal (`DATABASE_APP_LOGIN`). Anything else is refused. Storage's own
 * root, ceiling and scanner come from `STORAGE_ROOT`, `STORAGE_MAX_BYTES` and
 * `CLAMAV_*`, as for the application.
 *
 * The final stdout line is one JSON object of counts: never a URL, a key or a
 * password.
 */

const USAGE = 'storage:derivatives:backfill -- [--limit <n>]';

function provedTarget(url: string | undefined): 'staging' | 'local' {
  if (url === undefined) throw new CommandError('DATABASE_URL is not set; refusing.');
  const connection = parseSqlServerUrl(url);
  if (isApprovedStagingHost(connection.server)) {
    if (connection.port !== STAGING_SQL_PORT || connection.database !== STAGING_DATABASE)
      throw new CommandError(
        `Only ${STAGING_DATABASE} on the staging SQL host is approved there; refusing.`,
      );
    return 'staging';
  }
  assertApprovedLocalTarget(
    url,
    localTargetPolicy(process.env, 'migration-target', 'runtime'),
  );
  return 'local';
}

await runCommand('storage:derivatives:backfill', async () => {
  const target = provedTarget(process.env['DATABASE_URL']);
  const limit = positiveInteger('--limit', USAGE) ?? 1_000;
  if (limit > 10_000) throw new CommandError('--limit is at most 10000');
  const result = await backfillDerivatives(limit);
  return { target, limit, ...result };
});
