import path from 'node:path';

import { composeMigrationRunner } from '../../apps/web/src/composition/migration-runner.ts';
import { positiveInteger, required, runCommand } from './cli.ts';
import { createBundleDestination } from './promotion-bundle.ts';

/**
 * `npm run migration:promote -- --promotion <id> --operator <accountId> --out <dir> [--max-items <n>]`
 *
 * Carries — or resumes carrying — one APPROVED promotion into a local,
 * checksummed bundle directory (`./promotion-bundle.ts`): one file per
 * promotion entry, adopted rather than rewritten when an interrupted run left
 * it, and, once every entry is there, the bundle manifest re-verifying each.
 *
 * The promotion is re-read before every batch, so withdrawing its approval
 * stops a running promotion at the next batch. `--max-items` stops early and
 * leaves it `promoting`; running the command again resumes it.
 *
 * The bundle holds content, provenance, mappings and checksums only — never an
 * account, session, credential or configuration.
 */

const USAGE =
  'migration:promote -- --promotion <id> --operator <accountId> --out <dir> [--max-items <n>]';

await runCommand('migration:promote', async () => {
  const promotionId = required('--promotion', USAGE);
  const operator = required('--operator', USAGE);
  const directory = path.resolve(required('--out', USAGE));
  const maxItems = positiveInteger('--max-items', USAGE);

  const runner = composeMigrationRunner();
  const destination = createBundleDestination(directory);
  const summary = await runner.promotion.execute(
    { accountId: operator },
    { promotionId, destination, maxItems },
  );
  const manifest =
    summary.state === 'promoted'
      ? await destination.writeManifest({ promotionId })
      : null;
  return {
    promotionId: summary.promotionId,
    state: summary.state,
    promoted: summary.promoted,
    stopped: summary.stopped,
    bundle: directory,
    manifest:
      manifest === null
        ? null
        : { entries: manifest.entries.length, sha256: manifest.sha256 },
  };
});
