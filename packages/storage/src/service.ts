import 'server-only';

import { createHash, randomBytes, randomUUID } from 'node:crypto';

import {
  DERIVATIVE_SOURCE_LIMITS,
  IMAGE_DERIVATIVE_WIDTHS,
  isImageDerivativeWidth,
  RELEASE_TOKEN_PATTERN,
  type AssetAuthorizationPort,
  type AssetPersistencePort,
  type AssetRecord,
  type AssetRejection,
  type AssetStream,
  type MalwareScannerPort,
  type StorageServicePort,
  type StoredAsset,
} from '@minhaj/contracts/platform';

import { renderDerivatives } from './derivative.ts';
import { ByteLimitExceeded, type FilesystemStore } from './filesystem.ts';
import { ImageRefused, sanitiseImage, SANITISABLE_IMAGE_TYPES } from './image.ts';
import { displayNameFrom, generateStorageKey } from './keys.ts';
import { archiveOrExecutable, detectMediaType } from './sniff.ts';

/** How many assets one `servable` question may name. */
const SERVABLE_BATCH = 100;

/**
 * Phase 24. What Storage keeps of a release token: its SHA-256, in lowercase
 * hex. The token itself is never stored, logged or returned, so reading the
 * Asset table yields nothing that can release an asset.
 */
function releaseDigestOf(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

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
 *
 * DERIVATIVES (Rebaseline R2). A clean still image a policy allows may be
 * rendered at a few narrower WebP widths (`./derivative.ts`); each is stored
 * through `store` itself and linked to its source, and is served only while
 * the source would be (`openDerivative`). Releasing the source releases them.
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

  /**
   * `open`'s two decisions, for any caller that needs them: the record when the
   * asset is clean, its bytes present and the policy's answer is exactly
   * `allow` — and `null` for every other case, a throwing policy included.
   */
  async function released(
    assetId: string,
    authorization: AssetAuthorizationPort,
  ): Promise<AssetRecord | null> {
    const record = await assets.find(assetId);
    if (record === null || record.state !== 'clean') return null;
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
    if (!(await files.exists(record.storageKey))) return null;
    return record;
  }

  /** A clean asset's whole bytes, bounded by its recorded size. */
  async function readWhole(record: AssetRecord): Promise<Uint8Array | null> {
    const whole = new Uint8Array(record.byteSize);
    let offset = 0;
    for await (const chunk of files.read(record.storageKey)) {
      if (offset + chunk.byteLength > whole.byteLength) return null;
      whole.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return offset === whole.byteLength ? whole : null;
  }

  function streamOf(record: AssetRecord): AssetStream {
    return {
      mediaType: record.mediaType,
      byteSize: record.byteSize,
      checksum: record.checksum,
      displayName: record.displayName,
      body: files.read(record.storageKey),
      range: (start, end) => {
        if (end >= record.byteSize) {
          throw new RangeError('A byte range must end within the asset.');
        }
        return files.read(record.storageKey, { start, end });
      },
    };
  }

  const service: StorageServicePort = {
    async store(bytes, policy) {
      // An image policy is a promise to validate every type it admits; a type
      // this foundation cannot structurally validate would be admitted blind.
      if (
        policy.image !== undefined &&
        !policy.allowedMediaTypes.every((type) => SANITISABLE_IMAGE_TYPES.includes(type))
      ) {
        throw new Error(
          'An image upload policy may admit only JPEG, PNG and still WebP.',
        );
      }

      // A release token is a caller's secret of a fixed grammar. A malformed
      // one is a programming error, refused before anything is written — never
      // stored as a weaker secret, and never silently dropped.
      if (
        policy.releaseToken !== undefined &&
        !RELEASE_TOKEN_PATTERN.test(policy.releaseToken)
      ) {
        throw new Error('A release token must be 64 lowercase hexadecimal characters.');
      }

      const id = randomUUID();
      const key = generateStorageKey();
      const ceiling = Math.min(policy.maxBytes, dependencies.maxBytes);
      const image =
        policy.image === undefined
          ? null
          : sanitiseImage(bytes, policy.image, ceiling, {
              webp: policy.allowedMediaTypes.includes('image/webp'),
            });

      await assets.begin({
        id,
        storageKey: key,
        displayName: displayNameFrom(policy.displayName),
        releaseDigest:
          policy.releaseToken === undefined ? null : releaseDigestOf(policy.releaseToken),
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
      /**
       * DEFAULT DENY (`released`).
       *
       * Only a `clean` record is considered. Anything the policy answers that
       * is not the exact string `allow` is a denial — including a throw, a
       * rejected promise and a malformed answer: a consumer's policy is
       * ordinary code that can return anything at runtime, and a policy that
       * breaks fails closed rather than open. Metadata saying clean is half the
       * truth; a file that has gone missing is not served as an empty body.
       */
      const record = await released(assetId, authorization);
      if (record === null) return null;

      /**
       * The stream's `range` reads the bytes this SAME decision released — so a
       * range request is authorised exactly as a whole-file one, and there is
       * no way to ask for a slice without first passing `open`. The bounds are
       * checked against the recorded size: a range past the end is the
       * caller's error, reported rather than silently shortened.
       */
      return streamOf(record);
    },

    /**
     * R2. A derivative is served only after its SOURCE passed `open`'s two
     * decisions — the owning context's policy is asked about the source, the
     * asset its record names — so a derivative can never be reachable where its
     * source is not. The derivative's own custody is then required too: a
     * width not stored, not yet cleared, or whose file is gone is
     * `not-derived`, never an empty body.
     */
    async openDerivative(assetId, width, authorization) {
      if (!isImageDerivativeWidth(width)) return null;
      const source = await released(assetId, authorization);
      if (source === null) return null;
      const derivative = await assets.derivative(source.id, width);
      if (
        derivative === null ||
        derivative.state !== 'clean' ||
        !(await files.exists(derivative.storageKey))
      )
        return 'not-derived';
      return streamOf(derivative);
    },

    /**
     * R2. Renders the missing widths of a still image the policy allows.
     *
     * Each derivative is STORED, not written beside its source: it passes the
     * whole upload pipeline — WebP structure validation, sniffing, the
     * scanner, clearance by checksum — and so has the same custody as anything
     * else Storage serves. It is stored under a one-time release token, so a
     * derivation that loses a race to link the same width releases its own
     * copy instead of leaving bytes nobody names.
     */
    async derive(assetId, authorization) {
      const source = await released(assetId, authorization);
      if (source === null || !SANITISABLE_IMAGE_TYPES.includes(source.mediaType))
        return { status: 'refused' };

      const have = new Set(
        (await assets.derivatives(source.id)).map((derivative) => derivative.width),
      );
      const missing = IMAGE_DERIVATIVE_WIDTHS.filter((width) => !have.has(width));
      if (missing.length === 0)
        return { status: 'derived', created: 0, existing: have.size, withheld: 0 };

      if (source.byteSize > dependencies.maxBytes) return { status: 'failed' };
      const bytes = await readWhole(source);
      if (bytes === null) return { status: 'failed' };
      const rendered = await renderDerivatives(bytes, DERIVATIVE_SOURCE_LIMITS, missing);
      if (rendered === null) return { status: 'failed' };

      let created = 0;
      let existing = have.size;
      let withheld = 0;
      for (const derivative of rendered) {
        const releaseToken = randomBytes(32).toString('hex');
        const stored = await service.store(
          (async function* () {
            yield derivative.bytes;
          })(),
          {
            allowedMediaTypes: ['image/webp'],
            maxBytes: derivative.bytes.byteLength,
            image: DERIVATIVE_SOURCE_LIMITS,
            displayName: null,
            releaseToken,
          },
        );
        if (stored.state === 'rejected') return { status: 'failed' };
        const linked = await assets.recordDerivative({
          sourceAssetId: source.id,
          width: derivative.width,
          assetId: stored.id,
        });
        if (!linked) {
          await service.release(releaseToken);
          existing += 1;
        } else if (stored.state === 'clean') created += 1;
        else withheld += 1;
      }
      return { status: 'derived', created, existing, withheld };
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

    async servableImages(assetIds) {
      const unique = [...new Set(assetIds)];
      if (unique.length === 0) return new Set<string>();
      if (unique.length > SERVABLE_BATCH) {
        throw new RangeError('A servability question names too many assets.');
      }
      const records = await assets.findMany(unique);
      const present = await Promise.all(
        records
          .filter(
            (record) =>
              record.state === 'clean' &&
              SANITISABLE_IMAGE_TYPES.includes(record.mediaType),
          )
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

    /**
     * Phase 24. Release the asset stored under `releaseToken` — by the secret,
     * never by an identifier.
     *
     * THE ORDER WITHHOLDS FIRST. The record leaves service (`rejected` /
     * `released`) before its bytes are touched, so no request can stream a file
     * mid-removal; the bytes go next (removal is idempotent: a missing file is
     * already the goal); the record goes last. A crash between any two steps
     * leaves a record the same token finds again, so a retry resumes rather
     * than leaking either half. A consumer foreign key still naming the record
     * stops only the last step: the bytes are gone, the record is released and
     * never served, and the caller is told `referenced`.
     */
    async release(releaseToken) {
      if (!RELEASE_TOKEN_PATTERN.test(releaseToken)) {
        throw new RangeError(
          'A release token must be 64 lowercase hexadecimal characters.',
        );
      }

      const record = await assets.beginRelease(releaseDigestOf(releaseToken));
      if (record === null) return 'absent';

      // R2. Its derivatives follow it, in the same order: withheld, bytes,
      // records. They were already unreachable — a derivative is served only
      // while its source is clean — and now nothing of them is left behind.
      for (const derivative of await assets.beginReleaseDerivatives(record.id))
        await files.remove(derivative.storageKey);
      await assets.removeDerivatives(record.id);

      await files.remove(record.storageKey);
      return (await assets.removeReleased(record.id)) ? 'released' : 'referenced';
    },
  };

  return service;

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
