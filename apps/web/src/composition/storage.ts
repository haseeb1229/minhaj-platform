import 'server-only';

import { createAssetPersistence } from '@minhaj/database';
import {
  createClamAvScanner,
  createFilesystemStore,
  createStorageService,
  storageEnvSchema,
} from '@minhaj/storage';
import type { StorageServicePort } from '@minhaj/contracts/platform';

/**
 * Composition for the Layer-0 storage foundation.
 *
 * WHERE THE PIECES COME FROM. The filesystem store and the scanner are
 * `@minhaj/storage`; Asset metadata is the `storage` Layer-0 adapter in
 * `packages/database`. They are joined HERE, at Layer 4, because that is the
 * layer allowed to name both — the service itself receives ports and never
 * learns that Prisma exists.
 *
 * WHY IT IS LAZY. The storage root is validated and created on first use, not
 * at import. A production build imports modules to collect page data, and a
 * build machine has no storage root; creating one at import time would make
 * the build depend on runtime infrastructure.
 */

let runtime: Promise<StorageServicePort> | null = null;

export function storageRuntime(): Promise<StorageServicePort> {
  return (runtime ??= build());
}

async function build(): Promise<StorageServicePort> {
  const environment = storageEnvSchema.parse({
    STORAGE_ROOT: process.env['STORAGE_ROOT'],
    STORAGE_MAX_BYTES: process.env['STORAGE_MAX_BYTES'],
    CLAMAV_HOST: process.env['CLAMAV_HOST'],
    CLAMAV_PORT: process.env['CLAMAV_PORT'],
    CLAMAV_TIMEOUT_MS: process.env['CLAMAV_TIMEOUT_MS'],
  });

  return createStorageService({
    files: await createFilesystemStore(environment.STORAGE_ROOT),
    assets: createAssetPersistence(),
    scanner: createClamAvScanner({
      host: environment.CLAMAV_HOST,
      port: environment.CLAMAV_PORT,
      timeoutMs: environment.CLAMAV_TIMEOUT_MS,
    }),
    maxBytes: environment.STORAGE_MAX_BYTES,
  });
}
