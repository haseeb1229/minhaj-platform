import 'server-only';

import { Prisma } from '@prisma/client';

import {
  PERSONAL_LIMITS,
  type BookmarkEntry,
  type CollectionMember,
  type CollectionSummary,
  type NoteEntry,
  type PersonalSavedPort,
  type PersonalTarget,
  type SavedEntry,
} from '@minhaj/contracts/personalisation';

import { getDatabaseClient } from '../../client.ts';
import {
  PAGE,
  PersonalDataError,
  boundedOffset,
  bounded,
  columnsOf,
  iso,
  isUniqueViolation,
  refuse,
  targetOf,
  targetPredicate,
  targetSelect,
  type Client,
  type TargetRow,
} from './shared.ts';

/**
 * Bookmarks, notes and private collections — one account's own, always.
 *
 * THE ANCHOR. A `SavedItem` is the account's typed handle on one target. It is
 * created by the first bookmark, note or collection membership that needs it
 * and removed, in the same transaction, by the last one that let go — so the
 * target's identity is held once and nothing about the target is held at all.
 *
 * EVERY STATEMENT NAMES THE OWNER. A collection, note or anchor that belongs to
 * somebody else is not found, exactly like one that does not exist.
 */

type SavedRow = TargetRow & { readonly id: string; readonly createdAt: Date };

function entry(row: SavedRow): SavedEntry {
  return { savedItemId: row.id, target: targetOf(row), savedAt: iso(row.createdAt) };
}

/** The account's anchor on one target, locked for this transaction. */
async function findAnchor(
  tx: Client,
  accountId: string,
  target: PersonalTarget,
): Promise<string | null> {
  const [row] = await tx.$queryRaw<{ id: string }[]>`
    SELECT s.[id] FROM [dbo].[SavedItem] s WITH (UPDLOCK, HOLDLOCK)
    WHERE s.[userId] = ${accountId} AND ${targetPredicate(target, 's')}`;
  return row?.id ?? null;
}

/**
 * The account's anchor on one target, created if absent and the account is
 * under its ceiling. A lost insert race is the winner's row.
 */
async function anchor(
  tx: Client,
  accountId: string,
  target: PersonalTarget,
  newId: string,
): Promise<string> {
  const existing = await findAnchor(tx, accountId, target);
  if (existing !== null) return existing;

  const [counted] = await tx.$queryRaw<{ total: number }[]>`
    SELECT COUNT(*) AS [total] FROM [dbo].[SavedItem] WITH (UPDLOCK, HOLDLOCK)
    WHERE [userId] = ${accountId}`;
  if (Number(counted?.total ?? 0) >= PERSONAL_LIMITS.savedItems)
    throw new PersonalDataError('limit');

  const columns = columnsOf(target);
  await tx.$executeRaw`
    INSERT INTO [dbo].[SavedItem]
      ([id], [userId], [articleId], [workId], [videoId], [surahNumber], [ayahNumber], [hadithCitationId], [createdAt])
    VALUES
      (${newId}, ${accountId}, ${columns.articleId}, ${columns.workId}, ${columns.videoId},
       ${columns.surahNumber}, ${columns.ayahNumber}, ${columns.hadithCitationId}, SYSUTCDATETIME())`;
  return newId;
}

/** Removes an anchor nothing holds any more. */
async function releaseIfUnused(tx: Client, accountId: string, savedItemId: string) {
  await tx.$executeRaw`
    DELETE FROM [dbo].[SavedItem]
    WHERE [id] = ${savedItemId} AND [userId] = ${accountId}
      AND NOT EXISTS (SELECT 1 FROM [dbo].[Bookmark] b WHERE b.[savedItemId] = ${savedItemId})
      AND NOT EXISTS (SELECT 1 FROM [dbo].[Note] n WHERE n.[savedItemId] = ${savedItemId})
      AND NOT EXISTS (SELECT 1 FROM [dbo].[PrivateCollectionItem] i WHERE i.[savedItemId] = ${savedItemId})`;
}

/** What a race-safe write answers: the new version, or nothing. */
type Written = { readonly version: number } | undefined;

/** Runs `work` once, and once more if it lost an insert race to its own twin. */
async function raceSafe(work: () => Promise<Written>): Promise<Written> {
  try {
    return await work();
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return work();
  }
}

/** A race-safe write that must answer a version. */
async function versioned(
  work: () => Promise<Written>,
): Promise<{ readonly version: number }> {
  const written = await raceSafe(work);
  if (written === undefined) throw new PersonalDataError('conflict');
  return written;
}

/** Locks one of the account's collections and checks the version that was read. */
async function lockCollection(
  tx: Client,
  accountId: string,
  collectionId: string,
  expectedVersion: number,
): Promise<number> {
  const [row] = await tx.$queryRaw<{ version: number }[]>`
    SELECT [version] FROM [dbo].[PrivateCollection] WITH (UPDLOCK, HOLDLOCK)
    WHERE [id] = ${collectionId} AND [userId] = ${accountId}`;
  if (row === undefined) throw new PersonalDataError('not-found');
  if (Number(row.version) !== expectedVersion) throw new PersonalDataError('conflict');
  return Number(row.version);
}

async function bumpCollection(tx: Client, collectionId: string, version: number) {
  await tx.$executeRaw`
    UPDATE [dbo].[PrivateCollection]
    SET [version] = ${version + 1}, [updatedAt] = SYSUTCDATETIME()
    WHERE [id] = ${collectionId}`;
  return version + 1;
}

/**
 * Closes the gaps a removal left, in ONE statement so the unique order holds.
 * The base table is the UPDATE target: SQL Server refuses an update through a
 * windowed CTE under the runtime principal's column-level denials.
 */
async function compact(tx: Client, collectionId: string) {
  await tx.$executeRaw`
    UPDATE i SET [position] = o.[next]
    FROM [dbo].[PrivateCollectionItem] i
    JOIN (
      SELECT [savedItemId], ROW_NUMBER() OVER (ORDER BY [position]) - 1 AS [next]
      FROM [dbo].[PrivateCollectionItem] WHERE [collectionId] = ${collectionId}
    ) AS o ON o.[savedItemId] = i.[savedItemId]
    WHERE i.[collectionId] = ${collectionId} AND i.[position] <> o.[next]`;
}

export function createPersonalSaved(): PersonalSavedPort {
  const db = getDatabaseClient();

  return {
    async targetState(accountId, target) {
      try {
        const [saved] = await db.$queryRaw<
          {
            id: string;
            bookmarked: number;
            body: string | null;
            version: number | null;
          }[]
        >`
          SELECT s.[id],
                 CASE WHEN b.[savedItemId] IS NULL THEN 0 ELSE 1 END AS [bookmarked],
                 n.[body], n.[version]
          FROM [dbo].[SavedItem] s
          LEFT JOIN [dbo].[Bookmark] b ON b.[savedItemId] = s.[id]
          LEFT JOIN [dbo].[Note] n ON n.[savedItemId] = s.[id]
          WHERE s.[userId] = ${accountId} AND ${targetPredicate(target, 's')}`;
        const collections = await db.$queryRaw<
          { id: string; title: string; version: number; member: number }[]
        >`
          SELECT c.[id], c.[title], c.[version],
                 CASE WHEN i.[savedItemId] IS NULL THEN 0 ELSE 1 END AS [member]
          FROM [dbo].[PrivateCollection] c
          LEFT JOIN [dbo].[PrivateCollectionItem] i
            ON i.[collectionId] = c.[id] AND i.[savedItemId] = ${saved?.id ?? null}
          WHERE c.[userId] = ${accountId}
          ORDER BY c.[updatedAt] DESC, c.[id]`;
        return {
          bookmarked: Number(saved?.bookmarked ?? 0) === 1,
          note:
            saved?.body != null && saved.version != null
              ? { body: saved.body, version: Number(saved.version) }
              : null,
          collections: collections.map((row) => ({
            id: row.id,
            title: row.title,
            version: Number(row.version),
            member: Number(row.member) === 1,
          })),
        };
      } catch (error) {
        refuse(error);
      }
    },

    async bookmark(accountId, target, savedItemId) {
      try {
        await raceSafe(() =>
          db.$transaction(async (tx) => {
            const id = await anchor(tx, accountId, target, savedItemId);
            await tx.$executeRaw`
              IF NOT EXISTS (SELECT 1 FROM [dbo].[Bookmark] WITH (UPDLOCK, HOLDLOCK) WHERE [savedItemId] = ${id})
                INSERT INTO [dbo].[Bookmark] ([savedItemId], [createdAt]) VALUES (${id}, SYSUTCDATETIME())`;
            return undefined;
          }),
        );
      } catch (error) {
        refuse(error);
      }
    },

    async unbookmark(accountId, target) {
      try {
        await db.$transaction(async (tx) => {
          const id = await findAnchor(tx, accountId, target);
          if (id === null) return;
          await tx.$executeRaw`DELETE FROM [dbo].[Bookmark] WHERE [savedItemId] = ${id}`;
          await releaseIfUnused(tx, accountId, id);
        });
      } catch (error) {
        refuse(error);
      }
    },

    async bookmarks(accountId, offset) {
      try {
        const skip = boundedOffset(offset);
        const [counted, rows] = await Promise.all([
          db.$queryRaw<{ total: number }[]>`
            SELECT COUNT(*) AS [total] FROM [dbo].[Bookmark] b
            JOIN [dbo].[SavedItem] s ON s.[id] = b.[savedItemId]
            WHERE s.[userId] = ${accountId}`,
          db.$queryRaw<(SavedRow & { bookmarkedAt: Date })[]>`
            SELECT s.[id], s.[createdAt], b.[createdAt] AS [bookmarkedAt], ${targetSelect('s')}
            FROM [dbo].[Bookmark] b
            JOIN [dbo].[SavedItem] s ON s.[id] = b.[savedItemId]
            WHERE s.[userId] = ${accountId}
            ORDER BY b.[createdAt] DESC, s.[id]
            OFFSET ${skip} ROWS FETCH NEXT ${PAGE} ROWS ONLY`,
        ]);
        return {
          items: rows.map((row): BookmarkEntry => ({
            ...entry(row),
            bookmarkedAt: iso(row.bookmarkedAt),
          })),
          total: Number(counted[0]?.total ?? 0),
          offset: skip,
        };
      } catch (error) {
        refuse(error);
      }
    },

    async writeNote(accountId, value, savedItemId) {
      try {
        return await versioned(() =>
          db.$transaction(async (tx) => {
            const id = await anchor(tx, accountId, value.target, savedItemId);
            const [current] = await tx.$queryRaw<{ version: number }[]>`
              SELECT [version] FROM [dbo].[Note] WITH (UPDLOCK, HOLDLOCK) WHERE [savedItemId] = ${id}`;
            if (current === undefined) {
              if (value.expectedVersion !== 0) throw new PersonalDataError('conflict');
              await tx.$executeRaw`
                INSERT INTO [dbo].[Note] ([savedItemId], [body], [version], [createdAt], [updatedAt])
                VALUES (${id}, ${value.body}, 1, SYSUTCDATETIME(), SYSUTCDATETIME())`;
              return { version: 1 };
            }
            if (Number(current.version) !== value.expectedVersion)
              throw new PersonalDataError('conflict');
            await tx.$executeRaw`
              UPDATE [dbo].[Note]
              SET [body] = ${value.body}, [version] = ${value.expectedVersion + 1}, [updatedAt] = SYSUTCDATETIME()
              WHERE [savedItemId] = ${id}`;
            return { version: value.expectedVersion + 1 };
          }),
        );
      } catch (error) {
        refuse(error);
      }
    },

    async removeNote(accountId, value) {
      try {
        await db.$transaction(async (tx) => {
          const id = await findAnchor(tx, accountId, value.target);
          if (id === null) throw new PersonalDataError('not-found');
          const removed = await tx.$executeRaw`
            DELETE FROM [dbo].[Note] WHERE [savedItemId] = ${id} AND [version] = ${value.expectedVersion}`;
          if (removed !== 1) {
            const [exists] = await tx.$queryRaw<{ one: number }[]>`
              SELECT 1 AS [one] FROM [dbo].[Note] WHERE [savedItemId] = ${id}`;
            throw new PersonalDataError(exists === undefined ? 'not-found' : 'conflict');
          }
          await releaseIfUnused(tx, accountId, id);
        });
      } catch (error) {
        refuse(error);
      }
    },

    async notes(accountId, offset) {
      try {
        const skip = boundedOffset(offset);
        const [counted, rows] = await Promise.all([
          db.$queryRaw<{ total: number }[]>`
            SELECT COUNT(*) AS [total] FROM [dbo].[Note] n
            JOIN [dbo].[SavedItem] s ON s.[id] = n.[savedItemId]
            WHERE s.[userId] = ${accountId}`,
          db.$queryRaw<(SavedRow & { body: string; version: number; updatedAt: Date })[]>`
            SELECT s.[id], s.[createdAt], n.[body], n.[version], n.[updatedAt], ${targetSelect('s')}
            FROM [dbo].[Note] n
            JOIN [dbo].[SavedItem] s ON s.[id] = n.[savedItemId]
            WHERE s.[userId] = ${accountId}
            ORDER BY n.[updatedAt] DESC, s.[id]
            OFFSET ${skip} ROWS FETCH NEXT ${PAGE} ROWS ONLY`,
        ]);
        return {
          items: rows.map((row): NoteEntry => ({
            ...entry(row),
            body: row.body,
            version: Number(row.version),
            updatedAt: iso(row.updatedAt),
          })),
          total: Number(counted[0]?.total ?? 0),
          offset: skip,
        };
      } catch (error) {
        refuse(error);
      }
    },

    async collections(accountId) {
      try {
        const rows = await db.$queryRaw<
          {
            id: string;
            title: string;
            description: string | null;
            version: number;
            updatedAt: Date;
            itemCount: number;
          }[]
        >`
          SELECT TOP (${PERSONAL_LIMITS.collections})
                 c.[id], c.[title], c.[description], c.[version], c.[updatedAt],
                 (SELECT COUNT(*) FROM [dbo].[PrivateCollectionItem] i WHERE i.[collectionId] = c.[id]) AS [itemCount]
          FROM [dbo].[PrivateCollection] c
          WHERE c.[userId] = ${accountId}
          ORDER BY c.[updatedAt] DESC, c.[id]`;
        return rows.map((row): CollectionSummary => ({
          id: row.id,
          title: row.title,
          description: row.description,
          itemCount: Number(row.itemCount),
          version: Number(row.version),
          updatedAt: iso(row.updatedAt),
        }));
      } catch (error) {
        refuse(error);
      }
    },

    async collection(accountId, collectionId) {
      try {
        const [row] = await db.$queryRaw<
          {
            id: string;
            title: string;
            description: string | null;
            version: number;
            updatedAt: Date;
          }[]
        >`
          SELECT [id], [title], [description], [version], [updatedAt]
          FROM [dbo].[PrivateCollection]
          WHERE [id] = ${collectionId} AND [userId] = ${accountId}`;
        if (row === undefined) return null;
        const members = await db.$queryRaw<(SavedRow & { position: number })[]>`
          SELECT TOP (${PERSONAL_LIMITS.collectionMembers})
                 s.[id], s.[createdAt], i.[position], ${targetSelect('s')}
          FROM [dbo].[PrivateCollectionItem] i
          JOIN [dbo].[SavedItem] s ON s.[id] = i.[savedItemId] AND s.[userId] = i.[userId]
          WHERE i.[collectionId] = ${collectionId} AND i.[userId] = ${accountId}
          ORDER BY i.[position]`;
        return {
          id: row.id,
          title: row.title,
          description: row.description,
          version: Number(row.version),
          updatedAt: iso(row.updatedAt),
          itemCount: members.length,
          members: members.map((member): CollectionMember => ({
            ...entry(member),
            position: Number(member.position),
          })),
        };
      } catch (error) {
        refuse(error);
      }
    },

    async createCollection(accountId, collectionId, value) {
      try {
        await db.$transaction(async (tx) => {
          const [counted] = await tx.$queryRaw<{ total: number }[]>`
            SELECT COUNT(*) AS [total] FROM [dbo].[PrivateCollection] WITH (UPDLOCK, HOLDLOCK)
            WHERE [userId] = ${accountId}`;
          if (Number(counted?.total ?? 0) >= PERSONAL_LIMITS.collections)
            throw new PersonalDataError('limit');
          await tx.$executeRaw`
            INSERT INTO [dbo].[PrivateCollection]
              ([id], [userId], [title], [description], [version], [createdAt], [updatedAt])
            VALUES
              (${collectionId}, ${accountId}, ${value.title}, ${value.description}, 1, SYSUTCDATETIME(), SYSUTCDATETIME())`;
        });
      } catch (error) {
        refuse(error);
      }
    },

    async updateCollection(accountId, value) {
      try {
        return await db.$transaction(async (tx) => {
          const version = await lockCollection(
            tx,
            accountId,
            value.collectionId,
            value.expectedVersion,
          );
          await tx.$executeRaw`
            UPDATE [dbo].[PrivateCollection]
            SET [title] = ${value.title}, [description] = ${value.description},
                [version] = ${version + 1}, [updatedAt] = SYSUTCDATETIME()
            WHERE [id] = ${value.collectionId} AND [userId] = ${accountId}`;
          return { version: version + 1 };
        });
      } catch (error) {
        refuse(error);
      }
    },

    async removeCollection(accountId, value) {
      try {
        await db.$transaction(async (tx) => {
          await lockCollection(tx, accountId, value.collectionId, value.expectedVersion);
          const members = await tx.$queryRaw<{ savedItemId: string }[]>`
            SELECT [savedItemId] FROM [dbo].[PrivateCollectionItem]
            WHERE [collectionId] = ${value.collectionId} AND [userId] = ${accountId}`;
          // The collection takes its own members with it (an internal cascade);
          // the anchors they held go too unless a bookmark or note still needs them.
          await tx.$executeRaw`
            DELETE FROM [dbo].[PrivateCollection]
            WHERE [id] = ${value.collectionId} AND [userId] = ${accountId}`;
          for (const member of members)
            await releaseIfUnused(tx, accountId, member.savedItemId);
        });
      } catch (error) {
        refuse(error);
      }
    },

    async addToCollection(accountId, value, savedItemId) {
      try {
        return await versioned(() =>
          db.$transaction(async (tx) => {
            const version = await lockCollection(
              tx,
              accountId,
              value.collectionId,
              value.expectedVersion,
            );
            const id = await anchor(tx, accountId, value.target, savedItemId);
            const [state] = await tx.$queryRaw<
              { total: number; last: number | null; member: number }[]
            >`
              SELECT COUNT(*) AS [total], MAX([position]) AS [last],
                     SUM(CASE WHEN [savedItemId] = ${id} THEN 1 ELSE 0 END) AS [member]
              FROM [dbo].[PrivateCollectionItem]
              WHERE [collectionId] = ${value.collectionId}`;
            // Already a member: nothing changes and the version is not spent.
            if (Number(state?.member ?? 0) > 0) return { version };
            const total = Number(state?.total ?? 0);
            if (total >= PERSONAL_LIMITS.collectionMembers)
              throw new PersonalDataError('limit');
            if (
              state?.last != null &&
              Number(state.last) + 1 >= PERSONAL_LIMITS.collectionMembers
            )
              await compact(tx, value.collectionId);
            await tx.$executeRaw`
              INSERT INTO [dbo].[PrivateCollectionItem]
                ([collectionId], [savedItemId], [userId], [position], [addedAt])
              SELECT ${value.collectionId}, ${id}, ${accountId},
                     COALESCE(MAX([position]) + 1, 0), SYSUTCDATETIME()
              FROM [dbo].[PrivateCollectionItem] WHERE [collectionId] = ${value.collectionId}`;
            return { version: await bumpCollection(tx, value.collectionId, version) };
          }),
        );
      } catch (error) {
        refuse(error);
      }
    },

    async removeFromCollection(accountId, value) {
      try {
        return await db.$transaction(async (tx) => {
          const version = await lockCollection(
            tx,
            accountId,
            value.collectionId,
            value.expectedVersion,
          );
          const id = await findAnchor(tx, accountId, value.target);
          if (id === null) return { version };
          const removed = await tx.$executeRaw`
            DELETE FROM [dbo].[PrivateCollectionItem]
            WHERE [collectionId] = ${value.collectionId} AND [savedItemId] = ${id} AND [userId] = ${accountId}`;
          if (removed === 0) return { version };
          await compact(tx, value.collectionId);
          await releaseIfUnused(tx, accountId, id);
          return { version: await bumpCollection(tx, value.collectionId, version) };
        });
      } catch (error) {
        refuse(error);
      }
    },

    async reorderCollection(accountId, value) {
      try {
        return await db.$transaction(async (tx) => {
          const version = await lockCollection(
            tx,
            accountId,
            value.collectionId,
            value.expectedVersion,
          );
          const current = await tx.$queryRaw<{ savedItemId: string }[]>`
            SELECT [savedItemId] FROM [dbo].[PrivateCollectionItem]
            WHERE [collectionId] = ${value.collectionId} AND [userId] = ${accountId}`;
          const held = new Set(current.map((row) => row.savedItemId));
          // EXACTLY the current members, each once — anything else was read
          // from a different collection than the one that exists now.
          if (
            held.size !== value.savedItemIds.length ||
            value.savedItemIds.some((id) => !held.has(id))
          )
            throw new PersonalDataError('conflict');
          const rows = Prisma.join(
            value.savedItemIds.map((id, position) => Prisma.sql`(${id}, ${position})`),
          );
          // ONE statement, so the unique order is checked once, after every move.
          await tx.$executeRaw`
            UPDATE i SET [position] = v.[position]
            FROM [dbo].[PrivateCollectionItem] i
            JOIN (VALUES ${rows}) AS v([savedItemId], [position]) ON v.[savedItemId] = i.[savedItemId]
            WHERE i.[collectionId] = ${value.collectionId} AND i.[userId] = ${accountId}`;
          return { version: await bumpCollection(tx, value.collectionId, version) };
        });
      } catch (error) {
        refuse(error);
      }
    },

    async recent(accountId, limit) {
      try {
        const rows = await db.$queryRaw<SavedRow[]>`
          SELECT TOP (${bounded(limit, PAGE)}) s.[id], s.[createdAt], ${targetSelect('s')}
          FROM [dbo].[SavedItem] s
          WHERE s.[userId] = ${accountId}
          ORDER BY s.[createdAt] DESC, s.[id]`;
        return rows.map(entry);
      } catch (error) {
        refuse(error);
      }
    },

    async counts(accountId) {
      try {
        const [row] = await db.$queryRaw<
          { bookmarks: number; notes: number; collections: number }[]
        >`
          SELECT
            (SELECT COUNT(*) FROM [dbo].[Bookmark] b JOIN [dbo].[SavedItem] s ON s.[id] = b.[savedItemId] WHERE s.[userId] = ${accountId}) AS [bookmarks],
            (SELECT COUNT(*) FROM [dbo].[Note] n JOIN [dbo].[SavedItem] s ON s.[id] = n.[savedItemId] WHERE s.[userId] = ${accountId}) AS [notes],
            (SELECT COUNT(*) FROM [dbo].[PrivateCollection] c WHERE c.[userId] = ${accountId}) AS [collections]`;
        return {
          bookmarks: Number(row?.bookmarks ?? 0),
          notes: Number(row?.notes ?? 0),
          collections: Number(row?.collections ?? 0),
        };
      } catch (error) {
        refuse(error);
      }
    },
  };
}
