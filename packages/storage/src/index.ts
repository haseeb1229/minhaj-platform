import 'server-only';

/**
 * `@minhaj/storage` — the Layer-0 storage foundation.
 *
 * WHAT THIS SURFACE DELIBERATELY DOES NOT EXPORT: the storage root, any
 * absolute path, a file descriptor, a Prisma client, a delegate, a transaction
 * handle, a raw query facility, a scanner socket, or any delete-by-path
 * capability. A consumer receives a service that takes bytes and a policy, and
 * returns bytes only against an explicit allow.
 *
 * Asset METADATA is persisted through `AssetPersistencePort`, whose adapter
 * lives in `packages/database` as the declared Layer-0 `storage` concern —
 * the same arrangement as email, rate limiting and auditing. Physical adapter
 * location does not transfer semantic ownership, and nothing here holds a
 * database capability.
 */

export { createFilesystemStore, ByteLimitExceeded } from './filesystem.ts';
export type { FilesystemStore, WrittenBytes } from './filesystem.ts';

export { createClamAvScanner, interpret } from './scanner.ts';
export type { ClamAvOptions } from './scanner.ts';

export { createStorageService } from './service.ts';
export type { StorageDependencies } from './service.ts';

export {
  displayNameFrom,
  generateStorageKey,
  isBeneath,
  isValidStorageKey,
  resolveWithinRoot,
} from './keys.ts';

export { archiveOrExecutable, detectMediaType, SNIFF_PREFIX_BYTES } from './sniff.ts';

export { storageEnvSchema } from './config.ts';
export type { StorageEnvironment } from './config.ts';
