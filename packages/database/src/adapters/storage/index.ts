import 'server-only';

import type { AssetPersistencePort, AssetRecord } from '@minhaj/contracts/platform';

import { getDatabaseClient } from '../../client.ts';

/**
 * Asset metadata persistence.
 *
 * Semantic owner: the Layer-0 `storage` concern, declared in this package's
 * manifest alongside email, rate limiting and auditing. Physical location in
 * `packages/database` does NOT make this a bounded context, and it depends on
 * none (DOMAIN_MODEL.md §1.1).
 *
 * METADATA ONLY. File bytes never pass through this module — they are on the
 * filesystem, behind `@minhaj/storage`. Nothing here returns a Prisma client,
 * a delegate or a transaction handle; the exported surface is the port and
 * nothing else.
 */

/** Where a structured error fact can sit once Prisma and the driver wrap it. */
const NESTED_KEYS = ['cause', 'meta', 'driverAdapterError', 'originalError', 'info'];

/** One own DATA property — never an accessor, and never one that throws. */
function ownData(record: object, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor !== undefined && 'value' in descriptor
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether a delete met a foreign key — Prisma's `P2003`, the driver adapter's
 * `ForeignKeyConstraintViolation`, or SQL Server's 547 — read from STRUCTURED
 * fields only, never from message text. Bounded, so a wrapped error cannot
 * cost unbounded work to classify.
 */
function isForeignKeyRefusal(error: unknown): boolean {
  return carriesFact(error, {
    prisma: 'P2003',
    numbers: [547],
    kind: 'ForeignKeyConstraintViolation',
  });
}

/**
 * R2. Whether an insert met a unique key — Prisma's `P2002`, the driver
 * adapter's `UniqueConstraintViolation`, or SQL Server's 2627 / 2601 — read
 * the same way, from structured fields only.
 */
function isUniqueRefusal(error: unknown): boolean {
  return carriesFact(error, {
    prisma: 'P2002',
    numbers: [2627, 2601],
    kind: 'UniqueConstraintViolation',
  });
}

function carriesFact(
  error: unknown,
  fact: {
    readonly prisma: string;
    readonly numbers: readonly number[];
    readonly kind: string;
  },
): boolean {
  const seen = new Set<object>();
  const pending: unknown[] = [error];
  while (pending.length > 0 && seen.size < 32) {
    const current = pending.shift();
    if (current === null || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    const code = ownData(current, 'code');
    const number = ownData(current, 'number');
    if (
      code === fact.prisma ||
      (typeof code === 'number' && fact.numbers.includes(code)) ||
      (typeof number === 'number' && fact.numbers.includes(number))
    )
      return true;
    if (ownData(current, 'kind') === fact.kind) return true;
    for (const key of NESTED_KEYS) {
      const value = ownData(current, key);
      if (value !== undefined) pending.push(value);
    }
  }
  return false;
}

/** `BigInt` is how SQL Server returns `BIGINT`; the domain works in numbers. */
function toRecord(row: {
  id: string;
  storageKey: string;
  mediaType: string | null;
  byteSize: bigint | null;
  checksum: string | null;
  state: string;
  rejection: string | null;
  displayName: string | null;
  scanAttempts: number;
  createdAt: Date;
  updatedAt: Date;
}): AssetRecord {
  return {
    id: row.id,
    storageKey: row.storageKey,
    mediaType: row.mediaType ?? 'application/octet-stream',
    byteSize: row.byteSize === null ? 0 : Number(row.byteSize),
    checksum: row.checksum ?? '',
    state: row.state as AssetRecord['state'],
    rejection: row.rejection as AssetRecord['rejection'],
    displayName: row.displayName,
    scanAttempts: row.scanAttempts,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createAssetPersistence(): AssetPersistencePort {
  const database = getDatabaseClient();

  return {
    async begin(input) {
      await database.asset.create({
        data: {
          id: input.id,
          storageKey: input.storageKey,
          displayName: input.displayName,
          releaseDigest: input.releaseDigest ?? null,
          state: 'uploading',
          updatedAt: new Date(),
        },
      });
    },

    /**
     * Record what the bytes turned out to be, and hold them.
     *
     * Scoped to `uploading` so this cannot resurrect an asset that has already
     * been rejected or cleared. A write that matches nothing is not an error
     * here: it means the lifecycle moved on, and the caller's later clearance
     * will fail its own checksum guard.
     */
    async quarantine(input) {
      await database.asset.updateMany({
        where: { id: input.id, state: 'uploading' },
        data: {
          mediaType: input.mediaType,
          byteSize: BigInt(input.byteSize),
          checksum: input.checksum,
          state: 'quarantined',
          updatedAt: new Date(),
        },
      });
    },

    /**
     * Clear ONLY the exact bytes that were scanned.
     *
     * The checksum is part of the WHERE clause, not a value being written. If
     * the row's checksum has changed since the scan, the bytes behind it are
     * not the bytes that were cleared, no row matches, and the asset stays
     * quarantined. This is what makes "clearance is tied to bytes" a property
     * of the statement rather than a promise in a comment.
     */
    async clear(input) {
      const { count } = await database.asset.updateMany({
        where: { id: input.id, state: 'quarantined', checksum: input.checksum },
        data: { state: 'clean', updatedAt: new Date() },
      });

      return count === 1;
    },

    /** Terminal. A rejected asset is never revisited by the lifecycle. */
    async reject(input) {
      await database.asset.updateMany({
        where: { id: input.id, state: { in: ['uploading', 'quarantined'] } },
        data: { state: 'rejected', rejection: input.rejection, updatedAt: new Date() },
      });
    },

    async fail(id) {
      await database.asset.updateMany({
        where: { id, state: { in: ['uploading', 'quarantined'] } },
        data: { state: 'failed', updatedAt: new Date() },
      });
    },

    /**
     * Count one scan attempt and report the new total.
     *
     * Incremented in SQL rather than read-modify-written, so two concurrent
     * sweeps cannot both read the same value and retry past the ceiling.
     */
    async countScanAttempt(id) {
      const [row] = await database.$queryRaw<{ scanAttempts: number }[]>`
        UPDATE [dbo].[Asset]
        SET [scanAttempts] = [scanAttempts] + 1, [updatedAt] = SYSUTCDATETIME()
        OUTPUT INSERTED.[scanAttempts] AS [scanAttempts]
        WHERE [id] = ${id}
      `;

      return row?.scanAttempts ?? Number.MAX_SAFE_INTEGER;
    },

    async find(id) {
      const row = await database.asset.findUnique({ where: { id } });
      return row === null ? null : toRecord(row);
    },

    /**
     * Bounded by the caller's question — Storage asks about one page at a time,
     * never more than a hundred — so the IN list stays far below SQL Server's
     * parameter ceiling.
     */
    async findMany(ids) {
      if (ids.length === 0) return [];
      const rows = await database.asset.findMany({ where: { id: { in: [...ids] } } });
      return rows.map(toRecord);
    },

    /** Bounded sweep of rows a crash or an outage left mid-lifecycle. */
    async staleBefore(cutoff, limit) {
      const rows = await database.asset.findMany({
        where: { state: { in: ['uploading', 'quarantined'] }, updatedAt: { lt: cutoff } },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: Math.min(Math.max(limit, 1), 200),
      });

      return rows.map(toRecord);
    },

    /**
     * Remove a row by its own identifier.
     *
     * Reachable only for an asset the service already resolved from this
     * table. There is no delete-by-path and no delete-by-filter on this port,
     * so nothing here can be aimed at unrelated rows.
     */
    async remove(id) {
      await database.asset.deleteMany({ where: { id } });
    },

    /**
     * Phase 24. Withdraw the asset its release digest names from service, in
     * ONE statement, whatever state it is in.
     *
     * `rejected` / `released` is unservable at once — `open` and `servable`
     * serve `clean` alone — so from this statement on nothing can stream the
     * bytes being removed. The digest is the whole predicate: the only way to
     * reach a row here is to hold the token whose SHA-256 it is, and an asset
     * stored without one carries `NULL`, which no digest equals. Repeatable:
     * an interrupted release finds the same row again and moves nothing new.
     */
    async beginRelease(releaseDigest) {
      const [row] = await database.$queryRaw<{ id: string; storageKey: string }[]>`
        UPDATE [dbo].[Asset]
        SET [state] = N'rejected', [rejection] = N'released', [updatedAt] = SYSUTCDATETIME()
        OUTPUT INSERTED.[id] AS [id], INSERTED.[storageKey] AS [storageKey]
        WHERE [releaseDigest] = ${releaseDigest}
      `;

      return row === undefined ? null : { id: row.id, storageKey: row.storageKey };
    },

    /**
     * Phase 24. Delete a RELEASED record — the rejection is in the predicate, so
     * this can never remove a live asset. A consumer's foreign key that still
     * names it refuses the delete (547): that is an answer, `false`, and the
     * record stays released and unservable. Anything else is rethrown.
     */
    async removeReleased(id) {
      try {
        await database.asset.deleteMany({ where: { id, rejection: 'released' } });
        return true;
      } catch (error) {
        if (isForeignKeyRefusal(error)) return false;
        throw error;
      }
    },

    /** R2. A source's derivative links: one small indexed read (≤ 4 rows). */
    async derivatives(sourceAssetId) {
      return database.assetDerivative.findMany({
        where: { sourceAssetId },
        select: { width: true, assetId: true },
      });
    },

    async derivative(sourceAssetId, width) {
      const row = await database.assetDerivative.findUnique({
        where: { sourceAssetId_width: { sourceAssetId, width } },
        select: { asset: true },
      });
      return row === null ? null : toRecord(row.asset);
    },

    /**
     * R2. The link is the primary key `(source, width)`: a concurrent
     * derivation of the same width meets it, and that is an answer — `false` —
     * not a failure. Anything else is rethrown.
     */
    async recordDerivative(input) {
      try {
        await database.assetDerivative.create({
          data: {
            sourceAssetId: input.sourceAssetId,
            width: input.width,
            assetId: input.assetId,
          },
        });
        return true;
      } catch (error) {
        if (isUniqueRefusal(error)) return false;
        throw error;
      }
    },

    /**
     * R2. Withdraws every derivative of a source in ONE statement — the same
     * `rejected` / `released` Phase 24 gives the source — before any byte is
     * touched. Repeatable: an interrupted release finds them again.
     */
    async beginReleaseDerivatives(sourceAssetId) {
      return database.$queryRaw<{ id: string; storageKey: string }[]>`
        UPDATE a
        SET a.[state] = N'rejected', a.[rejection] = N'released', a.[updatedAt] = SYSUTCDATETIME()
        OUTPUT INSERTED.[id] AS [id], INSERTED.[storageKey] AS [storageKey]
        FROM [dbo].[Asset] a
        JOIN [dbo].[AssetDerivative] d ON d.[assetId] = a.[id]
        WHERE d.[sourceAssetId] = ${sourceAssetId}
      `;
    },

    /**
     * R2. The links go first, then the derivative records they named — and only
     * released ones, so a live asset can never be deleted from here.
     */
    async removeDerivatives(sourceAssetId) {
      const links = await database.assetDerivative.findMany({
        where: { sourceAssetId },
        select: { assetId: true },
      });
      if (links.length === 0) return;
      await database.$transaction([
        database.assetDerivative.deleteMany({ where: { sourceAssetId } }),
        database.asset.deleteMany({
          where: { id: { in: links.map((link) => link.assetId) }, rejection: 'released' },
        }),
      ]);
    },
  };
}
