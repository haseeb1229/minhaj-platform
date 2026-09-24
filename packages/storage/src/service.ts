import 'server-only';

import { randomUUID } from 'node:crypto';

import type {
  AssetPersistencePort,
  AssetRejection,
  AssetStream,
  MalwareScannerPort,
  StorageServicePort,
  StoredAsset,
} from '@minhaj/contracts/platform';

import { ByteLimitExceeded, type FilesystemStore } from './filesystem.ts';
import { ImageRefused, sanitiseImage, SANITISABLE_IMAGE_TYPES } from './image.ts';
import { displayNameFrom, generateStorageKey } from './keys.ts';
import { archiveOrExecutable, detectMediaType } from './sniff.ts';

/** How many assets one `servable` question may name. */
const SERVABLE_BATCH = 100;

/**
 * THE storage service (DELIVERY_PLAN.md Phase 7).
 *
 * The whole point of this file is that the safe path is the only path. There
 * is no parameter that disables quarantine, no flag that skips the scanner, no
 * way to supply a storage key and no way to read a file that is not `clean`.
 * A consumer can be stricter than this; it has no expression for being looser.
 *
 * FILESYSTEM AND SQL ARE NOT ONE TRANSACTION, and this service never pretends
 * they are. The order below is chosen so that every crash window leaves a
 * state that withholds the file:
 *
 *   1. metadata `uploading`   — a row exists, no file is promised
 *   2. bytes written          — a crash here leaves `uploading`, not servable
 *   3. metadata `quarantined` — bytes are durable and measured, still withheld
 *   4. scan                   — a crash here leaves `quarantined`, still withheld
 *   5. metadata `clean`       — the ONLY servable state, tied to a checksum
 *
 * There is no ordering that makes a half-finished upload servable, because the
 * servable state is written last and names the exact bytes it cleared.
 *
 * STILL IMAGES (Phase 12). A policy that carries `image` limits admits only a
 * structurally whole JPEG or PNG within them, and the bytes WRITTEN — and so
 * measured, hashed, sniffed, scanned and later served — are the image with its
 * hidden metadata removed (`./image.ts`). The validation runs as the upload
 * streams to disk, so it adds no buffering and no second pass.
 */

export interface StorageDependencies {
  readonly files: FilesystemStore;
  readonly assets: AssetPersistencePort;
  readonly scanner: MalwareScannerPort;
  /**
   * The absolute ceiling, whatever a caller asks for.
   *
   * A caller's `maxBytes` narrows this; it can never raise it.
   */
  readonly maxBytes: number;
  /** How many times a transient scanner failure may be retried. */
  readonly scanAttempts?: number;
}

export function createStorageService(
  dependencies: StorageDependencies,
): StorageServicePort {
  const { files, assets, scanner } = dependencies;
  const maxAttempts = dependencies.scanAttempts ?? 3;

  /** Record a refusal and remove the bytes it refers to. */
  async function refuse(
    id: string,
    key: string,
    rejection: AssetRejection,
  ): Promise<StoredAsset> {
    await files.remove(key).catch(() => undefined);
    await assets.reject({ id, rejection });

    return {
      id,
      state: 'rejected',
      mediaType: 'application/octet-stream',
      byteSize: 0,
      checksum: '',
      rejection,
    };
  }

  return {
    async store(bytes, policy) {
      // An image policy is a promise to validate every type it admits; a type
      // this foundation cannot structurally validate would be admitted blind.
      if (
        policy.image !== undefined &&
        !policy.allowedMediaTypes.every((type) => SANITISABLE_IMAGE_TYPES.includes(type))
      ) {
        throw new Error('An image upload policy may admit only JPEG and PNG.');
      }

      const id = randomUUID();
      const key = generateStorageKey();
      const ceiling = Math.min(policy.maxBytes, dependencies.maxBytes);
      const image =
        policy.image === undefined ? null : sanitiseImage(bytes, policy.image, ceiling);

      await assets.begin({
        id,
        storageKey: key,
        displayName: displayNameFrom(policy.displayName),
      });

      let written;
      try {
        written = await files.write(key, image?.bytes ?? bytes, ceiling);
      } catch (error) {
        await files.remove(key).catch(() => undefined);

        // The image's own structure refused it — malformed, truncated, or a
        // header asking for more pixels than the policy allows. A judgement on
        // the content, so `rejected`, never `failed`.
        if (error instanceof ImageRefused) {
          await assets.reject({ id, rejection: error.rejection });
          return {
            id,
            state: 'rejected',
            mediaType: 'application/octet-stream',
            byteSize: 0,
            checksum: '',
            rejection: error.rejection,
          };
        }

        if (error instanceof ByteLimitExceeded) {
          await assets.reject({ id, rejection: 'too-large' });
          return {
            id,
            state: 'rejected',
            mediaType: 'application/octet-stream',
            byteSize: 0,
            checksum: '',
            rejection: 'too-large',
          };
        }

        // The write itself broke. `failed` is not `rejected`: the content was
        // never judged, and the difference matters to reconciliation.
        await assets.fail(id);
        throw error;
      }

      if (written.byteSize === 0) return refuse(id, key, 'empty');

      const detected = detectMediaType(written.prefix);

      // Unrecognised bytes are refused. Being unsure is never an acceptance.
      if (detected === null) return refuse(id, key, 'unreadable');

      // The foundation's own floor, checked BEFORE the caller's allowlist so a
      // permissive caller cannot admit an archive by listing its type.
      if (archiveOrExecutable(detected)) {
        return refuse(id, key, 'detected-type-not-allowed');
      }

      if (!policy.allowedMediaTypes.includes(detected)) {
        return refuse(id, key, 'detected-type-not-allowed');
      }

      // A declared type that disagrees with the bytes is the mislabelled-file
      // case. The declared value never grants anything; it can only refuse.
      if (
        typeof policy.declaredMediaType === 'string' &&
        policy.declaredMediaType.trim() !== '' &&
        policy.declaredMediaType.split(';')[0]?.trim().toLowerCase() !== detected
      ) {
        return refuse(id, key, 'declared-type-mismatch');
      }

      // An image policy admits only what the image module actually VALIDATED.
      // Bytes it forwarded unrecognised — too short to be an image, say, yet
      // carrying a JPEG's three magic bytes — never pass on their magic alone.
      const dimensions = image?.dimensions() ?? null;
      if (image !== null && dimensions === null) return refuse(id, key, 'unreadable');
      const facts = dimensions === null ? {} : { image: dimensions };

      await assets.quarantine({
        id,
        mediaType: detected,
        byteSize: written.byteSize,
        checksum: written.checksum,
      });

      const outcome = await scanWithRetry(id, key);

      if (outcome.status === 'infected') {
        // The bytes are removed; the RECORD stays, so the identifier is spent
        // and the refusal is auditable. No signature name is persisted — it is
        // scanner detail, and it is not needed to justify the refusal.
        await files.remove(key).catch(() => undefined);
        await assets.reject({ id, rejection: 'infected' });

        return {
          id,
          state: 'rejected',
          mediaType: detected,
          byteSize: written.byteSize,
          checksum: written.checksum,
          rejection: 'infected',
        };
      }

      if (outcome.status !== 'clean') {
        /**
         * The scanner could not clear the file.
         *
         * The bytes STAY, in quarantine, and the asset stays unreachable. This
         * is the fail-closed branch: an outage must not delete a user's upload
         * and must not release it either. Reconciliation deals with anything
         * that stays here.
         */
        return {
          id,
          state: 'quarantined',
          mediaType: detected,
          byteSize: written.byteSize,
          checksum: written.checksum,
          rejection: null,
          ...facts,
        };
      }

      /**
       * Clearance names the checksum it cleared.
       *
       * If the row's checksum is no longer this one, the bytes behind it are
       * not the bytes that were scanned and the clearance does not apply.
       */
      const cleared = await assets.clear({ id, checksum: written.checksum });

      return {
        id,
        state: cleared ? 'clean' : 'quarantined',
        mediaType: detected,
        byteSize: written.byteSize,
        checksum: written.checksum,
        rejection: null,
        ...facts,
      };
    },

    /**
     * Resolve a stream for a clean, authorised asset — and nothing else.
     *
     * Every refusal returns the SAME `null`. A caller cannot tell "no such
     * asset" from "quarantined" from "denied", so the route cannot be used to
     * enumerate assets or to watch one move through its lifecycle.
     */
    async open(assetId, authorization) {
      const record = await assets.find(assetId);

      if (record === null || record.state !== 'clean') return null;

      /**
       * DEFAULT DENY.
       *
       * Anything that is not the exact string `allow` is a denial — including
       * a throw, a rejected promise and a malformed answer from a consumer's
       * policy. A policy that breaks fails closed rather than open.
       */
      // Typed `unknown` on purpose: a consumer's policy is ordinary code that
      // can return anything at runtime, and the comparison below is what makes
      // every one of those answers a denial.
      let decision: unknown;
      try {
        decision = await authorization.decide({
          assetId: record.id,
          mediaType: record.mediaType,
          byteSize: record.byteSize,
          checksum: record.checksum,
        });
      } catch {
        return null;
      }

      if (decision !== 'allow') return null;

      // Metadata says clean; the filesystem is the other half of the truth. A
      // file that has gone missing must not be served as a healthy empty body.
      if (!(await files.exists(record.storageKey))) return null;

      const stream: AssetStream = {
        mediaType: record.mediaType,
        byteSize: record.byteSize,
        checksum: record.checksum,
        displayName: record.displayName,
        body: files.read(record.storageKey),
        /**
         * A range of the bytes this SAME decision released — so a range
         * request is authorised exactly as a whole-file one, and there is no
         * way to ask for a slice without first passing `open`. The bounds are
         * checked against the recorded size: a range past the end is the
         * caller's error, reported rather than silently shortened.
         */
        range: (start, end) => {
          if (end >= record.byteSize) {
            throw new RangeError('A byte range must end within the asset.');
          }
          return files.read(record.storageKey, { start, end });
        },
      };

      return stream;
    },

    /**
     * Which assets could be served now, technically — ONE metadata read and one
     * existence check per clean asset, for a whole page at once.
     *
     * The same two technical conditions `open` applies before it consults a
     * policy: `clean` custody and bytes present. No policy is consulted because
     * nothing is released; the caller already holds authorised records naming
     * these assets, and the byte route decides again, fully, per request.
     */
    async servable(assetIds) {
      const unique = [...new Set(assetIds)];
      if (unique.length === 0) return new Set<string>();
      if (unique.length > SERVABLE_BATCH) {
        throw new RangeError('A servability question names too many assets.');
      }

      const records = await assets.findMany(unique);
      const present = await Promise.all(
        records
          .filter((record) => record.state === 'clean')
          .map(async (record) =>
            (await files.exists(record.storageKey)) ? record.id : null,
          ),
      );
      return new Set(present.filter((id): id is string => id !== null));
    },

    /**
     * Bounded, idempotent reconciliation of Storage-owned resources ONLY.
     *
     * It touches nothing it did not create: candidates come from the asset
     * table, and the only paths it removes are the generated keys on those
     * rows. It never walks the root and never deletes by an outside path.
     */
    async reconcile(cutoff, limit) {
      const stale = await assets.staleBefore(cutoff, limit);
      let settled = 0;

      for (const record of stale) {
        if (record.state === 'uploading') {
          // A crash before the bytes were measured. Nothing can ever clear
          // this row, so the partial file and the row both go.
          await files.remove(record.storageKey).catch(() => undefined);
          await assets.remove(record.id);
          settled += 1;
          continue;
        }

        if (record.state === 'quarantined') {
          // Bytes survived an outage. Try the scan again rather than
          // discarding an upload the scanner never got to judge.
          const outcome = await scanWithRetry(record.id, record.storageKey);

          if (outcome.status === 'clean') {
            await assets.clear({ id: record.id, checksum: record.checksum });
            settled += 1;
          } else if (outcome.status === 'infected') {
            await files.remove(record.storageKey).catch(() => undefined);
            await assets.reject({ id: record.id, rejection: 'infected' });
            settled += 1;
          }
        }
      }

      return settled;
    },
  };

  /**
   * Scan, retrying ONLY a transient unavailability.
   *
   * `infected` and `unscannable` are answers, not failures, and retrying them
   * would just be asking the same question again. Attempts are counted in the
   * database so a scanner that is down for an hour cannot be retried forever
   * across many sweeps.
   */
  async function scanWithRetry(id: string, key: string) {
    let outcome = await scanner.scan(absolutePathProxy(key));

    while (outcome.status === 'unavailable') {
      const attempts = await assets.countScanAttempt(id);
      if (attempts >= maxAttempts) return outcome;
      outcome = await scanner.scan(absolutePathProxy(key));
    }

    return outcome;
  }

  /**
   * The scanner is handed a path the FOUNDATION owns.
   *
   * It is derived from the generated key through the same containment rules as
   * every other access, so the scanner port cannot be turned into a reader for
   * an arbitrary path by anything a caller supplies.
   */
  function absolutePathProxy(key: string): string {
    return files.pathOf(key);
  }
}
