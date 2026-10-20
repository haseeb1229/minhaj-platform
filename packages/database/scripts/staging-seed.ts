import 'server-only';

import {
  createClamAvScanner,
  createFilesystemStore,
  storageEnvSchema,
} from '@minhaj/storage';

import {
  removeStagingFixture,
  seedStagingFixture,
  STAGING_SEED_ASSET_ID,
  STAGING_SEED_BYTE_SIZE,
  STAGING_SEED_CHECKSUM,
  STAGING_SEED_MEDIA_TYPE,
  STAGING_SEED_STORAGE_KEY,
} from '../src/lifecycle/staging-fixture.ts';
import { STAGING_DATABASE } from '../src/lifecycle/staging-target.ts';
import {
  openAdminSession,
  openVerifiedMaster,
  runStagingCommand,
  startStagingCommand,
} from './staging-bootstrap.ts';

/**
 * `npm run staging:db:seed [-- --remove]` — the ONE staging seed: a single,
 * unmistakably synthetic stored asset the restore proof recovers on both sides
 * of the database/filesystem boundary (see `src/lifecycle/staging-fixture.ts`
 * for exactly what it is and how it reaches `clean`).
 *
 * Deterministic and idempotent: a fixed id, a fixed storage key and fixed
 * bytes, and a second run on a seeded environment changes nothing. `--remove`
 * deletes exactly that row and those bytes, and proves both are gone.
 *
 * The bytes are written under `STORAGE_ROOT` through the storage package's own
 * filesystem store, and scanned through its own ClamAV adapter at
 * `CLAMAV_HOST`/`CLAMAV_PORT` — the same configuration the web runtime reads.
 * The row is written by the migration principal, as every staging lifecycle
 * write is; the runtime principal is never used by this tooling.
 */

const remove = process.argv.slice(2).includes('--remove');

await runStagingCommand('staging:db:seed', async () => {
  const command = startStagingCommand();
  const { master } = await openVerifiedMaster(command, { requireFingerprint: true });
  await master.close();

  const storage = storageEnvSchema.parse({
    STORAGE_ROOT: process.env['STORAGE_ROOT'],
    STORAGE_MAX_BYTES: process.env['STORAGE_MAX_BYTES'],
    CLAMAV_HOST: process.env['CLAMAV_HOST'],
    CLAMAV_PORT: process.env['CLAMAV_PORT'],
    CLAMAV_TIMEOUT_MS: process.env['CLAMAV_TIMEOUT_MS'],
  });
  const files = await createFilesystemStore(storage.STORAGE_ROOT);

  const fixture = {
    assetId: STAGING_SEED_ASSET_ID,
    storageKey: STAGING_SEED_STORAGE_KEY,
    mediaType: STAGING_SEED_MEDIA_TYPE,
    byteSize: STAGING_SEED_BYTE_SIZE,
    sha256: STAGING_SEED_CHECKSUM,
  };

  const live = await openAdminSession(command, STAGING_DATABASE, 'live');
  try {
    if (remove) {
      const outcome = await removeStagingFixture(live, files);
      return {
        environmentId: command.environmentId,
        action: 'remove',
        fixture,
        ...outcome,
        absent: true,
      };
    }

    const outcome = await seedStagingFixture(
      live,
      files,
      createClamAvScanner({
        host: storage.CLAMAV_HOST,
        port: storage.CLAMAV_PORT,
        timeoutMs: storage.CLAMAV_TIMEOUT_MS,
      }),
    );
    return {
      environmentId: command.environmentId,
      action: 'seed',
      fixture: { ...fixture, state: 'clean' },
      changed: outcome.changed,
      steps: outcome.steps,
    };
  } finally {
    await live.close();
  }
});
