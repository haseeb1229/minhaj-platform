import 'server-only';

import { Prisma } from '@prisma/client';

import type {
  AyahTarget,
  PersonalDispositionPort,
  PersonalPurgePort,
} from '@minhaj/contracts/personalisation';

import { getDatabaseClient } from '../../client.ts';
import { bounded, refuse, type Client } from './shared.ts';

/**
 * Personalisation's part of account closure and of a content hard purge.
 *
 * BOUNDED, IDEMPOTENT, RESUMABLE. Each call removes at most `limit` rows per
 * table, in an order no foreign key objects to, and reports how much it did.
 * An interruption leaves only rows the next call finds; nothing is marked and
 * no progress record is needed, because the rows themselves are the pending
 * work (SECURITY_BASELINE.md §19.1, DOMAIN_MODEL.md §14.3).
 *
 * NO CROSS-CONTEXT TRANSACTION. Every statement touches only this context's
 * tables. Whether an account is closed is Identity's answer, asked by the
 * caller; whether a target may be deleted is its owner's decision afterwards.
 */

const DISPOSAL_MAX = 1_000;
const RELEASE_MAX = 1_000;

/** The account's rows, children before parents, `limit` per table. */
async function disposeBatch(
  tx: Client,
  accountId: string,
  limit: number,
): Promise<number> {
  const statements = [
    Prisma.sql`DELETE TOP (${limit}) FROM [dbo].[PrivateCollectionItem] WHERE [userId] = ${accountId}`,
    Prisma.sql`DELETE TOP (${limit}) FROM [dbo].[PrivateCollection] WHERE [userId] = ${accountId}
               AND NOT EXISTS (SELECT 1 FROM [dbo].[PrivateCollectionItem] i WHERE i.[collectionId] = [PrivateCollection].[id])`,
    // A SavedItem takes its own bookmark and note with it.
    Prisma.sql`DELETE TOP (${limit}) FROM [dbo].[SavedItem] WHERE [userId] = ${accountId}
               AND NOT EXISTS (SELECT 1 FROM [dbo].[PrivateCollectionItem] i WHERE i.[savedItemId] = [SavedItem].[id])`,
    Prisma.sql`DELETE TOP (${limit}) FROM [dbo].[ReadingHistory] WHERE [userId] = ${accountId}`,
    Prisma.sql`DELETE TOP (${limit}) FROM [dbo].[WatchHistory] WHERE [userId] = ${accountId}`,
    Prisma.sql`DELETE FROM [dbo].[QuranReadingProgress] WHERE [userId] = ${accountId}`,
    Prisma.sql`DELETE TOP (${limit}) FROM [dbo].[Notification] WHERE [userId] = ${accountId}`,
    Prisma.sql`DELETE FROM [dbo].[NotificationPreference] WHERE [userId] = ${accountId}`,
    // The profile takes its own interests and goals with it.
    Prisma.sql`DELETE FROM [dbo].[PersonalisationProfile] WHERE [userId] = ${accountId}`,
  ];
  let removed = 0;
  for (const statement of statements) removed += await tx.$executeRaw(statement);
  return removed;
}

/**
 * Removes up to `limit` references to one target, collection members first,
 * and answers how many of this context's references to it remain.
 */
async function release(
  tx: Client,
  limit: number,
  saved: Prisma.Sql,
  history: readonly Prisma.Sql[],
  historyCounts: readonly Prisma.Sql[],
): Promise<number> {
  // Members of the owners' private collections that hold this target. Their
  // collections' versions move, so an order read before the purge is refused.
  await tx.$executeRaw`
    UPDATE c SET [version] = c.[version] + 1, [updatedAt] = SYSUTCDATETIME()
    FROM [dbo].[PrivateCollection] c
    WHERE EXISTS (
      SELECT 1 FROM [dbo].[PrivateCollectionItem] i
      JOIN [dbo].[SavedItem] s ON s.[id] = i.[savedItemId]
      WHERE i.[collectionId] = c.[id] AND ${saved})`;
  await tx.$executeRaw`
    DELETE TOP (${limit}) i FROM [dbo].[PrivateCollectionItem] i
    JOIN [dbo].[SavedItem] s ON s.[id] = i.[savedItemId]
    WHERE ${saved}`;
  await tx.$executeRaw`
    DELETE TOP (${limit}) s FROM [dbo].[SavedItem] s
    WHERE ${saved}
      AND NOT EXISTS (SELECT 1 FROM [dbo].[PrivateCollectionItem] i WHERE i.[savedItemId] = s.[id])`;
  for (const statement of history) await tx.$executeRaw(statement);

  const [left] = await tx.$queryRaw<{ total: number }[]>`
    SELECT (SELECT COUNT(*) FROM [dbo].[SavedItem] s WHERE ${saved}) AS [total]`;
  let remaining = Number(left?.total ?? 0);
  for (const count of historyCounts) {
    const [row] = await tx.$queryRaw<{ total: number }[]>(count);
    remaining += Number(row?.total ?? 0);
  }
  return remaining;
}

export function createPersonalDisposition(): PersonalDispositionPort {
  const db = getDatabaseClient();

  return {
    async disposeAccount(accountId, limit) {
      try {
        const size = bounded(limit, DISPOSAL_MAX);
        return await db.$transaction((tx) => disposeBatch(tx, accountId, size));
      } catch (error) {
        refuse(error);
      }
    },

    async accountsWithData(after, limit) {
      try {
        const size = bounded(limit, DISPOSAL_MAX);
        const rows = await db.$queryRaw<{ userId: string }[]>`
          SELECT TOP (${size}) [userId] FROM (
            SELECT [userId] FROM [dbo].[PersonalisationProfile]
            UNION SELECT [userId] FROM [dbo].[SavedItem]
            UNION SELECT [userId] FROM [dbo].[PrivateCollection]
            UNION SELECT [userId] FROM [dbo].[ReadingHistory]
            UNION SELECT [userId] FROM [dbo].[WatchHistory]
            UNION SELECT [userId] FROM [dbo].[QuranReadingProgress]
            UNION SELECT [userId] FROM [dbo].[NotificationPreference]
            UNION SELECT [userId] FROM [dbo].[Notification]
          ) AS owners
          WHERE ${after} IS NULL OR [userId] > ${after}
          ORDER BY [userId]`;
        return rows.map((row) => row.userId);
      } catch (error) {
        refuse(error);
      }
    },
  };
}

export function createPersonalPurge(): PersonalPurgePort {
  const db = getDatabaseClient();

  /**
   * One target family's release: `saved` matches the anchors on the target,
   * `history` names each history table holding it and the predicate there.
   */
  async function run(
    limit: number,
    saved: Prisma.Sql,
    history: readonly { readonly table: string; readonly where: Prisma.Sql }[],
  ): Promise<number> {
    try {
      const size = bounded(limit, RELEASE_MAX);
      const deletes = history.map(
        ({ table, where }) =>
          Prisma.sql`DELETE TOP (${size}) FROM ${Prisma.raw(`[dbo].[${table}]`)} WHERE ${where}`,
      );
      const counts = history.map(
        ({ table, where }) =>
          Prisma.sql`SELECT COUNT(*) AS [total] FROM ${Prisma.raw(`[dbo].[${table}]`)} WHERE ${where}`,
      );
      return await db.$transaction((tx) => release(tx, size, saved, deletes, counts));
    } catch (error) {
      refuse(error);
    }
  }

  return {
    releaseArticle: (articleId, limit) =>
      run(limit, Prisma.sql`s.[articleId] = ${articleId}`, [
        { table: 'ReadingHistory', where: Prisma.sql`[articleId] = ${articleId}` },
      ]),
    releaseWork: (workId, limit) =>
      run(limit, Prisma.sql`s.[workId] = ${workId}`, [
        { table: 'ReadingHistory', where: Prisma.sql`[workId] = ${workId}` },
      ]),
    releaseVideo: (videoId, limit) =>
      run(limit, Prisma.sql`s.[videoId] = ${videoId}`, [
        { table: 'WatchHistory', where: Prisma.sql`[videoId] = ${videoId}` },
      ]),
    releaseAyah: (target: AyahTarget, limit) =>
      run(
        limit,
        Prisma.sql`s.[surahNumber] = ${target.surah} AND s.[ayahNumber] = ${target.ayah}`,
        [
          {
            table: 'ReadingHistory',
            where: Prisma.sql`[surahNumber] = ${target.surah} AND [ayahNumber] = ${target.ayah}`,
          },
          {
            table: 'QuranReadingProgress',
            where: Prisma.sql`[surahNumber] = ${target.surah} AND [ayahNumber] = ${target.ayah}`,
          },
        ],
      ),
    releaseHadith: (citationId, limit) =>
      run(limit, Prisma.sql`s.[hadithCitationId] = ${citationId}`, [
        {
          table: 'ReadingHistory',
          where: Prisma.sql`[hadithCitationId] = ${citationId}`,
        },
      ]),
  };
}
