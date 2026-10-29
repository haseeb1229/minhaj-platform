import { composeMigrationRunner } from '../../apps/web/src/composition/migration-runner.ts';
import { argument, CommandError, positiveInteger, required, runCommand } from './cli.ts';
import { createAuthorisedAssetFetcher, createAuthorisedFetcher } from './safe-fetch.ts';
import { authorisedSource } from './sources/catalogue.ts';

/**
 * `npm run migration:run -- --source <key> --operator <accountId>
 *    --pages <n> --limit <n> [--items <a,b,…>] [--max-items <n>]`
 *
 * Runs — or resumes — one AUTHORISED source's pipeline as the named operator,
 * over the bounded SELECTION given: at most `--pages` listing pages and
 * `--limit` items (and, for sources that need them, the explicit `--items`).
 * Stage 1A is a representative selection; Stage 1B widens the same options
 * over the same source keys, so every record keeps its identity.
 *
 * THE NETWORK IS THE SOURCE'S SCOPE AND NOTHING ELSE. The fetcher is the
 * hardened boundary bound to the source's exact recorded hosts, resolving
 * through the system resolver and connecting only to validated PUBLIC
 * addresses, pinned per hop (MIGRATION_STRATEGY.md §8.1); the service refuses
 * a source without recorded written authorisation, an inactive one, or a
 * scope that is not real `https`.
 *
 * `--max-items` stops early and leaves the run open; running the command again
 * — with the same selection — resumes it.
 *
 * `--replay` (Phase 30-R) re-reads the source's RETAINED raw evidence with the
 * current code instead of fetching its pages: every record the source holds is
 * parsed again from its snapshot, and only images not yet acquired are
 * fetched — through the source's asset fetcher, its page and first-party asset
 * hosts only. The final stdout line is one JSON
 * summary (counts and codes only, never content); a refusal exits 1.
 */

const USAGE =
  'migration:run -- --source <key> --operator <accountId> --pages <n> --limit <n> ' +
  '[--items <a,b,...>] [--max-items <n>] [--replay]';

await runCommand('migration:run', async () => {
  const key = required('--source', USAGE);
  const operator = required('--operator', USAGE);
  const pages = positiveInteger('--pages', USAGE);
  const limit = positiveInteger('--limit', USAGE);
  const maxItems = positiveInteger('--max-items', USAGE);
  const itemsText = argument('--items');
  const replay = process.argv.includes('--replay');
  if (pages === null || limit === null) throw new CommandError(`usage: ${USAGE}`);
  if (pages > 1000 || limit > 100_000)
    throw new CommandError('selection bounds too large');
  const items =
    itemsText === undefined ? [] : itemsText.split(',').map((item) => item.trim());
  if (items.some((item) => !/^[A-Za-z0-9._-]{1,80}$/.test(item)))
    throw new CommandError('--items takes comma-separated simple identifiers');

  const definition = authorisedSource(key);
  if (definition === null)
    throw new CommandError(`'${key}' is not in the source catalogue`);

  const runner = composeMigrationRunner();
  const actor = { accountId: operator };
  const source = await runner.sources.sourceByKey(actor, key);
  if (source === null) throw new CommandError(`no source is registered as '${key}'`);
  if (source.authorityKind !== 'authorised')
    throw new CommandError(`'${key}' is not an authorised source`);

  const adapter = definition.adapter({ pages, limit, items });
  const fetcher = createAuthorisedFetcher(source);
  const assetFetcher = createAuthorisedAssetFetcher(source);
  const summary = await runner.pipeline.run(actor, {
    sourceId: source.id,
    adapter,
    fetcher,
    assetFetcher,
    options: { maxItems, codeRevision: runner.codeRevision, replay },
  });
  return {
    source: source.key,
    selection: { pages, limit, items: items.length, replay },
    runId: summary.runId,
    resumed: summary.resumed,
    state: summary.state,
    processed: summary.processed,
    counts: summary.counts,
    balanced: summary.reconciliation?.balanced ?? null,
    discrepancies: summary.reconciliation?.discrepancies ?? [],
    missing: summary.missing,
  };
});
