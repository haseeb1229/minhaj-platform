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
  };
}
