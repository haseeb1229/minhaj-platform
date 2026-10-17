import { lstat, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Runner-owned cleanup for the disposable browser database and storage root.
 *
 * `scripts/browser-server.mjs` also cleans up on SIGTERM/SIGINT. Playwright's
 * Windows process-tree termination does not reliably deliver either signal,
 * however, so server-owned cleanup alone can leave a completed run's database
 * behind. The same applies to its temporary storage root. Global teardown runs
 * in Playwright's own process and closes both gaps. The database helper checks
 * its exact disposable name; the storage path is checked below before removal.
 *
 * PHASE 25. The run also owns a realtime process and an NGINX container. A
 * spec may have restarted the realtime process from its own worker, which no
 * process-tree termination reaches, so this teardown stops the CURRENT one
 * (positively identified by its marker, never by PID alone) and removes the
 * proxy (only by its generated name), and proves both gone — BEFORE the
 * database either of them could still be using is dropped.
 */
async function removeBrowserStorageRoot(value: unknown): Promise<void> {
  if (typeof value !== 'string') {
    throw new Error('Browser environment does not identify its disposable storage root.');
  }

  const root = path.resolve(value);
  const name = path.basename(root);
  const temp = await realpath(tmpdir());
  const parent = await realpath(path.dirname(root));
  if (
    !/^minhaj-browser-storage-[A-Za-z0-9]{6}$/u.test(name) ||
    parent.toLowerCase() !== temp.toLowerCase()
  ) {
    throw new Error('Browser storage root is outside the generated temporary namespace.');
  }

  let info;
  try {
    info = await lstat(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('Browser storage root is not a real directory.');
  }
  const actual = await realpath(root);
  if (
    path.dirname(actual).toLowerCase() !== temp.toLowerCase() ||
    path.basename(actual) !== name
  ) {
    throw new Error('Browser storage root resolves outside the generated namespace.');
  }

  await rm(root, { recursive: true, force: true });
}

/** Stops the run's realtime process and removes its proxy, proving both gone. */
async function stopRunProcesses(marker: unknown, proxyContainer: unknown): Promise<void> {
  if (typeof marker !== 'string' || typeof proxyContainer !== 'string') {
    throw new Error(
      'Browser environment does not identify its realtime process and proxy.',
    );
  }
  const { recordedRealtimePid, removeFrontDoor, stopOwnRealtime } =
    await import('../../scripts/shared/realtime-harness.mjs');

  const pid = recordedRealtimePid();
  if (pid !== null) await stopOwnRealtime(pid, marker);
  await removeFrontDoor(proxyContainer);
}

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

  const environment = JSON.parse(source) as {
    databaseName?: unknown;
    storageRoot?: unknown;
    proxyContainer?: unknown;
    realtime?: { marker?: unknown };
  };
  if (typeof environment.databaseName !== 'string') {
    throw new Error('Browser environment does not identify its disposable database.');
  }

  // A failure here is reported, but only AFTER the database is dropped: a
  // process that would not stop must not also leave the database behind.
  let stopFailure: unknown = null;
  try {
    await stopRunProcesses(environment.realtime?.marker, environment.proxyContainer);
  } catch (error) {
    stopFailure = error;
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

  await removeBrowserStorageRoot(environment.storageRoot);
  await rm(path.join(repoRoot, 'test-results', 'browser-realtime.json'), { force: true });
  await rm(environmentFile, { force: true });
  if (stopFailure !== null) throw stopFailure;
}
