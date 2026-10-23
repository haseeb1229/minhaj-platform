import type {
  MigrationFetchPort,
  MigrationSourceAdapter,
} from '@minhaj/contracts/migration';

import { composeMigrationRunner } from '../../apps/web/src/composition/migration-runner.ts';
import { createFixtureExportAdapter } from './adapters/fixture-export.ts';
import { createFixtureVideoAdapter } from './adapters/fixture-video.ts';
import { CommandError, positiveInteger, required, runCommand } from './cli.ts';
import { openSyntheticExport } from './export/export-source.ts';
import { startFixtureServer } from './fixture-server.ts';
import { createFixtureFetcher } from './safe-fetch.ts';

/**
 * `npm run migration:run-fixture -- --source <key> --operator <accountId> [--max-items <n>]`
 *
 * Runs — or resumes — one FIXTURE source's pipeline as the named operator,
 * whose `migration.administer` is read live like every other key.
 *
 *   - an `http` source is served by the local fixture server, started here on
 *     loopback and reached only through the fixture resolver — no real host,
 *     no DNS, no network beyond 127.0.0.1;
 *   - an `export` source is the synthetic legacy export, opened in memory; its
 *     adapter never fetches, and the fetcher it is handed refuses everything.
 *
 * `--max-items` stops early and leaves the run open; running the command again
 * resumes it. The final stdout line is one JSON summary; a refusal exits 1.
 *
 * The database is `DATABASE_URL` — the runtime principal's. Nothing here
 * reaches the database package; `../../apps/web/src/composition/migration-runner.ts`
 * is the composition that does.
 */

const USAGE =
  'migration:run-fixture -- --source <key> --operator <accountId> [--max-items <n>]';

/** An export has no network: a fetch is refused, never attempted. */
const NO_NETWORK: MigrationFetchPort = {
  fetcherKey: 'no-network',
  fetcherVersion: '1',
  fetch: async (url) => ({
    kind: 'refused',
    classification: 'scope-refused',
    requestedUrl: url,
    detail: 'an export source has no network',
  }),
};

await runCommand('migration:run-fixture', async () => {
  const sourceKey = required('--source', USAGE);
  const operator = required('--operator', USAGE);
  const maxItems = positiveInteger('--max-items', USAGE);

  const runner = composeMigrationRunner();
  const actor = { accountId: operator };
  const source = await runner.sources.sourceByKey(actor, sourceKey);
  if (source === null)
    throw new CommandError(`no source is registered as '${sourceKey}'`);

  const cleanup: (() => Promise<void> | void)[] = [];
  try {
    let adapter: MigrationSourceAdapter;
    let fetcher: MigrationFetchPort;
    if (source.accessMethod === 'http') {
      const server = await startFixtureServer();
      cleanup.push(() => server.close());
      adapter = createFixtureVideoAdapter(
        source.baseUrl === null ? {} : { baseUrl: source.baseUrl },
      );
      fetcher = createFixtureFetcher(source, server.endpoint);
    } else {
      const exported = openSyntheticExport();
      cleanup.push(() => exported.close());
      adapter = createFixtureExportAdapter(exported);
      fetcher = NO_NETWORK;
    }

    const summary = await runner.pipeline.run(actor, {
      sourceId: source.id,
      adapter,
      fetcher,
      options: { maxItems, codeRevision: runner.codeRevision },
    });
    return {
      source: source.key,
      runId: summary.runId,
      resumed: summary.resumed,
      state: summary.state,
      processed: summary.processed,
      counts: summary.counts,
      balanced: summary.reconciliation?.balanced ?? null,
      discrepancies: summary.reconciliation?.discrepancies ?? [],
      missing: summary.missing,
    };
  } finally {
    for (const close of cleanup.reverse()) await close();
  }
});
