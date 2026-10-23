import 'server-only';

import {
  MIGRATION_LIMITS,
  type MigrationRawPort,
  type PersonalDataState,
} from '@minhaj/contracts/migration';

import { getDatabaseClient } from '../../client.ts';
import {
  ADMINISTER,
  LOCKED_TRANSACTION,
  MigrationDataError,
  audit,
  bounded,
  bytesOf,
  numberOf,
  refuse,
} from './shared.ts';

/**
 * Raw evidence — read and disposal, both audited, both bounded.
 *
 * A READ IS AN ACCOUNTABLE ACT whether or not the caller then shows the bytes:
 * its audit row commits in the same transaction as the read, naming the
 * snapshot, the purpose and how many bytes left the database — never the
 * bytes. Only `SUBSTRING(body, 1, @maxBytes)` is read, so a preview of an
 * 8 MiB body never moves 8 MiB.
 */
export function createMigrationRaw(): MigrationRawPort {
  const db = getDatabaseClient();

  return {
    async readSnapshot(input) {
      const maxBytes = bounded(input.maxBytes, MIGRATION_LIMITS.maxBodyBytes);
      try {
        return await db.$transaction(async (tx) => {
          const rows = await tx.$queryRaw<
            {
              id: string;
              contentType: string | null;
              byteSize: number;
              checksum: string;
              personalData: string;
              body: unknown;
            }[]
          >`
            SELECT [id], [contentType], [byteSize], [checksum], [personalData],
                   CASE WHEN [body] IS NULL THEN NULL ELSE SUBSTRING([body], 1, ${maxBytes}) END AS [body]
            FROM [dbo].[MigrationRawSnapshot] WHERE [id] = ${input.snapshotId}`;
          const row = rows[0];
          if (row === undefined) return null;
          const body = bytesOf(row.body);
          await audit(tx, {
            action: 'migration.snapshot.read',
            actorId: input.actorId,
            targetType: 'migration-raw-snapshot',
            targetId: row.id,
            after: {
              purpose: input.purpose,
              byteSize: String(row.byteSize),
              bytesRead: String(body?.byteLength ?? 0),
              disposed: String(body === null),
            },
            authorisingSource: ADMINISTER,
          });
          return {
            id: row.id,
            contentType: row.contentType,
            byteSize: numberOf(row.byteSize),
            checksum: row.checksum,
            personalData: row.personalData as PersonalDataState,
            body,
          };
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    async disposeSnapshot(input) {
      const reason = input.reason.trim();
      if (reason.length === 0 || reason.length > MIGRATION_LIMITS.note)
        throw new MigrationDataError('invalid');
      try {
        await db.$transaction(async (tx) => {
          // Only the body goes; metadata and checksum remain (51372 holds the rest).
          const disposed = await tx.migrationRawSnapshot.updateMany({
            where: { id: input.snapshotId, disposedAt: null },
            data: {
              body: null,
              disposedAt: input.now,
              disposedByUserId: input.actorId,
              disposalReason: reason,
            },
          });
          if (disposed.count !== 1) {
            const exists = await tx.migrationRawSnapshot.findFirst({
              where: { id: input.snapshotId },
              select: { id: true },
            });
            throw new MigrationDataError(exists === null ? 'not-found' : 'invalid-state');
          }
          await audit(tx, {
            action: 'migration.snapshot.disposed',
            actorId: input.actorId,
            targetType: 'migration-raw-snapshot',
            targetId: input.snapshotId,
            after: { disposed: 'true' },
            authorisingSource: ADMINISTER,
          });
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },
  };
}
