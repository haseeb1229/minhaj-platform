import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Runner-owned cleanup for the disposable browser database.
 *
 * `scripts/browser-server.mjs` also cleans up on SIGTERM/SIGINT. Playwright's
 * Windows process-tree termination does not reliably deliver either signal,
 * however, so server-owned cleanup alone can leave a completed run's database
 * behind. Global teardown runs in Playwright's own process and closes that
 * platform gap. Both paths call the same exact-name-guarded, residue-checking
 * helper, and that helper is deliberately idempotent.
 */
export default async function globalTeardown(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, '..', '..');
  const environmentFile = path.join(repoRoot, 'test-results', 'browser-environment.json');

  let source: string;
  try {
    source = await readFile(environmentFile, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }

  const environment = JSON.parse(source) as { databaseName?: unknown };
  if (typeof environment.databaseName !== 'string') {
    throw new Error('Browser environment does not identify its disposable database.');
  }

  const { loadLocalDatabaseEnvironment } =
    await import('../../packages/database/src/lifecycle/local-environment.ts');
  loadLocalDatabaseEnvironment(process.env, { requireLocalFile: false });

  const { getDatabaseMigrationUrl } =
    await import('../../packages/database/src/config.ts');
  const { dropDisposableDatabase, openMasterSession } =
    await import('../../packages/database/src/lifecycle/disposable-database.ts');
  const { assertApprovedLocalTarget, localTargetPolicy } =
    await import('../../packages/database/src/lifecycle/local-target.ts');

  const connection = assertApprovedLocalTarget(
    getDatabaseMigrationUrl(),
    localTargetPolicy(process.env, 'source', 'migration'),
  );
  const master = await openMasterSession(connection);

  try {
    await dropDisposableDatabase(master, environment.databaseName);
  } finally {
    await master.close();
  }

  await rm(environmentFile, { force: true });
}
