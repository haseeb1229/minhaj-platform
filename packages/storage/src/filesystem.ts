import 'server-only';

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, realpath, stat, open } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import { isBeneath, resolveWithinRoot } from './keys.ts';
import { SNIFF_PREFIX_BYTES } from './sniff.ts';

/**
 * The V1 filesystem adapter (DELIVERY_PLAN.md Phase 7).
 *
 * Bytes live on the company's own filesystem, OUTSIDE the web root, outside
 * `public/`, outside the repository source and outside `.next`. Nothing here
 * is reachable by a URL: the only way out is the serving route, and the only
 * way the serving route resolves anything is a clean asset plus an explicit
 * allow.
 *
 * No S3 adapter exists yet, and the port is shaped so adding one later does
 * not require the service above to change.
 */

/** What a completed write measured about the bytes it wrote. */
export interface WrittenBytes {
  readonly byteSize: number;
  /** SHA-256 over exactly the bytes that landed on disk, lowercase hex. */
  readonly checksum: string;
  /** The leading bytes, bounded, for content sniffing. */
  readonly prefix: Uint8Array;
}

/** Raised when the caller's or the foundation's byte ceiling is passed. */
export class ByteLimitExceeded extends Error {
  constructor() {
    super('Upload exceeded the permitted size.');
  }
}

export interface FilesystemStore {
  write(
    key: string,
    bytes: AsyncIterable<Uint8Array>,
    maxBytes: number,
  ): Promise<WrittenBytes>;
  /**
   * The absolute path for a key, for the ONE caller that needs a path: the
   * malware scanner. It is derived through the same containment rules as every
   * other access, so it cannot be aimed by anything a caller supplied.
   */
  pathOf(key: string): string;
  read(key: string): AsyncIterable<Uint8Array>;
  verify(key: string, expected: { byteSize: number; checksum: string }): Promise<boolean>;
  remove(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

/**
 * Binds a store to one validated root.
 *
 * The root is resolved through `realpath` ONCE, at construction. Every later
 * containment check compares against that resolved value, so a symlinked root
 * is handled correctly and a root that is itself moved out from under the
 * process does not silently start resolving elsewhere.
 */
export async function createFilesystemStore(root: string): Promise<FilesystemStore> {
  await mkdir(root, { recursive: true });
  const resolvedRoot = await realpath(root);

  /**
   * The absolute path for a key, re-proving containment after resolution.
   *
   * `resolveWithinRoot` already refuses anything that is not a generated key,
   * which is what actually stops traversal. This adds the check that survives
   * a SYMLINK: a path can satisfy every string rule and still resolve outside
   * the root if a component of it is a link somebody planted. Only an existing
   * path can be `realpath`ed, so the link check runs where a link could exist
   * — on read, verify and remove — and on write the parent directory is
   * checked after it is created.
   */
  const pathFor = (key: string): string => resolveWithinRoot(resolvedRoot, key);

  /** Throws if the real, link-resolved path escapes the root. */
  const assertRealContained = async (absolute: string): Promise<void> => {
    let real: string;
    try {
      real = await realpath(absolute);
    } catch {
      // Nothing there to follow. Absence is handled by the caller; it is not
      // an escape, and it must not be reported as one.
      return;
    }

    if (!isBeneath(resolvedRoot, real)) {
      throw new Error('Refusing a storage path that resolves outside the root.');
    }
  };

  return {
    pathOf: (key) => pathFor(key),

    /**
     * Stream bytes to disk under a hard ceiling, hashing as they pass.
     *
     * NOTHING IS BUFFERED WHOLE. The file is written chunk by chunk, the
     * digest is updated chunk by chunk, and only a bounded prefix is retained
     * in memory for sniffing. A caller cannot make this allocate in proportion
     * to the upload.
     *
     * The ceiling is enforced DURING the stream, not after: a partial write is
     * removed and the limit error is raised as soon as the byte count passes,
     * so an oversized upload costs the limit and not the whole file.
     */
    async write(key, bytes, maxBytes) {
      const absolute = pathFor(key);
      await mkdir(path.dirname(absolute), { recursive: true });
      await assertRealContained(path.dirname(absolute));

      const digest = createHash('sha256');
      const prefix: number[] = [];
      let byteSize = 0;
      let exceeded = false;

      const bounded = async function* (): AsyncGenerator<Uint8Array> {
        for await (const chunk of bytes) {
          byteSize += chunk.byteLength;

          if (byteSize > maxBytes) {
            exceeded = true;
            return;
          }

          digest.update(chunk);

          if (prefix.length < SNIFF_PREFIX_BYTES) {
            for (const byte of chunk.subarray(0, SNIFF_PREFIX_BYTES - prefix.length)) {
              prefix.push(byte);
            }
          }

          yield chunk;
        }
      };

      try {
        await pipeline(bounded(), createWriteStream(absolute, { flags: 'wx' }));
      } catch (error) {
        await rm(absolute, { force: true });
        throw error;
      }

      if (exceeded) {
        await rm(absolute, { force: true });
        throw new ByteLimitExceeded();
      }

      return {
        byteSize,
        checksum: digest.digest('hex'),
        prefix: Uint8Array.from(prefix),
      };
    },

    read(key) {
      const absolute = pathFor(key);

      return (async function* () {
        await assertRealContained(absolute);
        yield* createReadStream(absolute);
      })();
    },

    /**
     * Does the stored file still match what the metadata claims?
     *
     * Re-reads and re-hashes, so it detects a file that has been truncated,
     * replaced or corrupted since it was cleared. This is the RECOVERY and
     * integrity path — it is deliberately not run on every ordinary read,
     * because the lifecycle already ties clearance to a checksum and hashing
     * every byte of every request would be a performance defect, not a
     * security gain.
     */
    async verify(key, expected) {
      const absolute = pathFor(key);

      try {
        await assertRealContained(absolute);
        const information = await stat(absolute);
        if (!information.isFile() || information.size !== expected.byteSize) return false;

        const digest = createHash('sha256');
        for await (const chunk of createReadStream(absolute)) digest.update(chunk);

        return digest.digest('hex') === expected.checksum;
      } catch {
        return false;
      }
    },

    async remove(key) {
      const absolute = pathFor(key);
      await assertRealContained(absolute);
      await rm(absolute, { force: true });
    },

    async exists(key) {
      const absolute = pathFor(key);

      try {
        await assertRealContained(absolute);
        const handle = await open(absolute, 'r');
        await handle.close();
        return true;
      } catch {
        return false;
      }
    },
  };
}
