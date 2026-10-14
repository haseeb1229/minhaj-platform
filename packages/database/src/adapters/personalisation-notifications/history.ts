import 'server-only';

import {
  PERSONAL_LIMITS,
  type PersonalHistoryPort,
  type ReadingEntry,
  type WatchEntry,
} from '@minhaj/contracts/personalisation';

import { getDatabaseClient } from '../../client.ts';
import {
  PAGE,
  PersonalDataError,
  boundedOffset,
  columnsOf,
  iso,
  isUniqueViolation,
  readableOf,
  readableSelect,
  refuse,
  targetPredicate,
  type TargetRow,
} from './shared.ts';

/**
 * Reading and watch history, and the one Quran position.
 *
 * ONE ROW PER TARGET, NOT AN EVENT STREAM. A read updates the row's latest
 * instant; it never appends. Only the newest `PERSONAL_LIMITS.history` rows of
 * each list are kept.
 *
 * NOTHING IS RECORDED WHILE HISTORY IS OFF — decided inside the same
 * transaction as the write, under a lock the switch must wait for, so a
 * request racing the person turning history off cannot slip a row in after.
 *
 * MONOTONIC. `lastReadAt` only ever moves forward: a request that arrives late
 * carries an older server instant and leaves the newer one in place.
 */

export function createPersonalHistory(): PersonalHistoryPort {
  const db = getDatabaseClient();

  /** Runs once, then once more if a concurrent first read won the insert. */
  async function recordOnce(work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      await work();
    }
  }

  return {
    async recordRead(accountId, target, at) {
      try {
        const columns = columnsOf(target);
        await recordOnce(() =>
          db.$transaction(async (tx) => {
            const [profile] = await tx.$queryRaw<{ on: number }[]>`
              SELECT CAST([historyEnabled] AS INT) AS [on]
              FROM [dbo].[PersonalisationProfile] WITH (HOLDLOCK)
              WHERE [userId] = ${accountId}`;
            if (Number(profile?.on ?? 0) !== 1) return;
            const updated = await tx.$executeRaw`
              UPDATE h SET [lastReadAt] = CASE WHEN h.[lastReadAt] < ${at} THEN ${at} ELSE h.[lastReadAt] END
              FROM [dbo].[ReadingHistory] h WITH (UPDLOCK, HOLDLOCK)
              WHERE h.[userId] = ${accountId} AND ${targetPredicate(target, 'h')}`;
            if (updated > 0) return;
            await tx.$executeRaw`
              INSERT INTO [dbo].[ReadingHistory]
                ([id], [userId], [articleId], [workId], [surahNumber], [ayahNumber], [hadithCitationId], [firstReadAt], [lastReadAt])
              VALUES
                (CONVERT(NVARCHAR(36), NEWID()), ${accountId}, ${columns.articleId}, ${columns.workId},
                 ${columns.surahNumber}, ${columns.ayahNumber}, ${columns.hadithCitationId}, ${at}, ${at})`;
            await tx.$executeRaw`
              DELETE FROM [dbo].[ReadingHistory]
              WHERE [userId] = ${accountId} AND [id] IN (
                SELECT [id] FROM [dbo].[ReadingHistory] WHERE [userId] = ${accountId}
                ORDER BY [lastReadAt] DESC, [id]
                OFFSET ${PERSONAL_LIMITS.history} ROWS)`;
          }),
        );
      } catch (error) {
        refuse(error);
      }
    },

    async recordWatch(accountId, videoId, at) {
      try {
        await recordOnce(() =>
          db.$transaction(async (tx) => {
            const [profile] = await tx.$queryRaw<{ on: number }[]>`
              SELECT CAST([historyEnabled] AS INT) AS [on]
              FROM [dbo].[PersonalisationProfile] WITH (HOLDLOCK)
              WHERE [userId] = ${accountId}`;
            if (Number(profile?.on ?? 0) !== 1) return;
            const updated = await tx.$executeRaw`
              UPDATE [dbo].[WatchHistory] WITH (UPDLOCK, HOLDLOCK)
              SET [lastWatchedAt] = CASE WHEN [lastWatchedAt] < ${at} THEN ${at} ELSE [lastWatchedAt] END
              WHERE [userId] = ${accountId} AND [videoId] = ${videoId}`;
            if (updated > 0) return;
            await tx.$executeRaw`
              INSERT INTO [dbo].[WatchHistory] ([userId], [videoId], [firstWatchedAt], [lastWatchedAt])
              VALUES (${accountId}, ${videoId}, ${at}, ${at})`;
            await tx.$executeRaw`
              DELETE FROM [dbo].[WatchHistory]
              WHERE [userId] = ${accountId} AND [videoId] IN (
                SELECT [videoId] FROM [dbo].[WatchHistory] WHERE [userId] = ${accountId}
                ORDER BY [lastWatchedAt] DESC, [videoId]
                OFFSET ${PERSONAL_LIMITS.history} ROWS)`;
          }),
        );
      } catch (error) {
        refuse(error);
      }
    },

    async reading(accountId, offset) {
      try {
        const skip = boundedOffset(offset);
        const [counted, rows] = await Promise.all([
          db.$queryRaw<{ total: number }[]>`
            SELECT COUNT(*) AS [total] FROM [dbo].[ReadingHistory] WHERE [userId] = ${accountId}`,
          db.$queryRaw<
            (Omit<TargetRow, 'videoId'> & { firstReadAt: Date; lastReadAt: Date })[]
          >`
            SELECT h.[firstReadAt], h.[lastReadAt], ${readableSelect('h')}
            FROM [dbo].[ReadingHistory] h
            WHERE h.[userId] = ${accountId}
            ORDER BY h.[lastReadAt] DESC, h.[id]
            OFFSET ${skip} ROWS FETCH NEXT ${PAGE} ROWS ONLY`,
        ]);
        return {
          items: rows.map((row): ReadingEntry => ({
            target: readableOf(row),
            firstReadAt: iso(row.firstReadAt),
            lastReadAt: iso(row.lastReadAt),
          })),
          total: Number(counted[0]?.total ?? 0),
          offset: skip,
        };
      } catch (error) {
        refuse(error);
      }
    },

    async watching(accountId, offset) {
      try {
        const skip = boundedOffset(offset);
        const [counted, rows] = await Promise.all([
          db.$queryRaw<{ total: number }[]>`
            SELECT COUNT(*) AS [total] FROM [dbo].[WatchHistory] WHERE [userId] = ${accountId}`,
          db.$queryRaw<{ videoId: string; firstWatchedAt: Date; lastWatchedAt: Date }[]>`
            SELECT [videoId], [firstWatchedAt], [lastWatchedAt]
            FROM [dbo].[WatchHistory]
            WHERE [userId] = ${accountId}
            ORDER BY [lastWatchedAt] DESC, [videoId]
            OFFSET ${skip} ROWS FETCH NEXT ${PAGE} ROWS ONLY`,
        ]);
        return {
          items: rows.map((row): WatchEntry => ({
            videoId: row.videoId,
            firstWatchedAt: iso(row.firstWatchedAt),
            lastWatchedAt: iso(row.lastWatchedAt),
          })),
          total: Number(counted[0]?.total ?? 0),
          offset: skip,
        };
      } catch (error) {
        refuse(error);
      }
    },

    async removeRead(accountId, target) {
      try {
        await db.$executeRaw`
          DELETE h FROM [dbo].[ReadingHistory] h
          WHERE h.[userId] = ${accountId} AND ${targetPredicate(target, 'h')}`;
      } catch (error) {
        refuse(error);
      }
    },

    async removeWatch(accountId, videoId) {
      try {
        await db.$executeRaw`
          DELETE FROM [dbo].[WatchHistory] WHERE [userId] = ${accountId} AND [videoId] = ${videoId}`;
      } catch (error) {
        refuse(error);
      }
    },

    async clear(accountId) {
      try {
        await db.$transaction([
          db.$executeRaw`DELETE FROM [dbo].[ReadingHistory] WHERE [userId] = ${accountId}`,
          db.$executeRaw`DELETE FROM [dbo].[WatchHistory] WHERE [userId] = ${accountId}`,
        ]);
      } catch (error) {
        refuse(error);
      }
    },

    async quranProgress(accountId) {
      try {
        const [row] = await db.$queryRaw<
          { surahNumber: number; ayahNumber: number; version: number; updatedAt: Date }[]
        >`
          SELECT [surahNumber], [ayahNumber], [version], [updatedAt]
          FROM [dbo].[QuranReadingProgress] WHERE [userId] = ${accountId}`;
        if (row === undefined) return null;
        return {
          surah: Number(row.surahNumber),
          ayah: Number(row.ayahNumber),
          version: Number(row.version),
          updatedAt: iso(row.updatedAt),
        };
      } catch (error) {
        refuse(error);
      }
    },

    async setQuranProgress(accountId, value, at) {
      try {
        return await db.$transaction(async (tx) => {
          const [current] = await tx.$queryRaw<{ version: number }[]>`
            SELECT [version] FROM [dbo].[QuranReadingProgress] WITH (UPDLOCK, HOLDLOCK)
            WHERE [userId] = ${accountId}`;
          // A STALE write is refused, never applied: the position moves only
          // under the version the reader saw (DOMAIN_MODEL.md §19.8).
          if (
            (current === undefined ? 0 : Number(current.version)) !==
            value.expectedVersion
          )
            throw new PersonalDataError('conflict');
          if (current === undefined) {
            await tx.$executeRaw`
              INSERT INTO [dbo].[QuranReadingProgress] ([userId], [surahNumber], [ayahNumber], [version], [updatedAt])
              VALUES (${accountId}, ${value.surah}, ${value.ayah}, 1, ${at})`;
            return { version: 1 };
          }
          await tx.$executeRaw`
            UPDATE [dbo].[QuranReadingProgress]
            SET [surahNumber] = ${value.surah}, [ayahNumber] = ${value.ayah},
                [version] = ${value.expectedVersion + 1}, [updatedAt] = ${at}
            WHERE [userId] = ${accountId}`;
          return { version: value.expectedVersion + 1 };
        });
      } catch (error) {
        refuse(error);
      }
    },

    async clearQuranProgress(accountId, expectedVersion) {
      try {
        const removed = await db.$executeRaw`
          DELETE FROM [dbo].[QuranReadingProgress]
          WHERE [userId] = ${accountId} AND [version] = ${expectedVersion}`;
        if (removed !== 1) throw new PersonalDataError('conflict');
      } catch (error) {
        refuse(error);
      }
    },
  };
}
