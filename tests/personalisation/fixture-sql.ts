import { randomUUID } from 'node:crypto';

import { createProofAccount } from '../people/harness.ts';
import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';

/**
 * Phase 21 fixture rows that ONLY the owner/operator — or another context —
 * may write: accounts and their closure (Identity's), the content rows a saved
 * target references (Editorial's Article, Library's Work, Media's Video,
 * Quran's Ayah), and the direct inserts a bound proof needs. Every statement
 * here runs on the MIGRATION (owner) session; nothing Personalisation does is
 * written through it.
 *
 * NOTHING HERE IS CONTENT. Every title, slug, note and text is an unmistakable
 * `NON_PERSONAL_FIXTURE_…` sentinel, and the Quran structure is engineering
 * scaffolding that claims nothing about any real Surah or Ayah.
 */

/** A SQL Server Unicode literal. Values are this file's own constants or generated ids. */
export const n = (value: string) => `N'${value.replaceAll("'", "''")}'`;

/** A sentinel no real note, title or address could be mistaken for. */
export const sentinel = (kind: string, index: number | string) =>
  `NON_PERSONAL_FIXTURE_${kind}_${index}`;

/* ===========================================================================
 * Identity
 * ========================================================================= */

export const account = (admin: SqlSession) => createProofAccount(admin);

export async function emailOf(admin: SqlSession, accountId: string): Promise<string> {
  const [row] = await admin.query<{ email: string }>(
    `SELECT [email] FROM [dbo].[User] WHERE [id] = ${n(accountId)};`,
  );
  if (row === undefined) throw new Error('fixture account missing');
  return row.email;
}

/**
 * Closes an account as Identity's closure does: the status, and the address
 * replaced by its tombstone so the original can be registered again.
 */
export async function closeAccount(
  admin: SqlSession,
  accountId: string,
  tombstone: string,
): Promise<void> {
  await admin.query(
    `UPDATE [dbo].[User] SET [status] = N'closed', [email] = ${n(tombstone)} WHERE [id] = ${n(accountId)};`,
  );
}

/** A NEW account registered with an address an earlier account once held. */
export async function accountWithEmail(
  admin: SqlSession,
  email: string,
): Promise<string> {
  const id = `proof-personal-${randomUUID().slice(0, 18)}`;
  await admin.query(`
    INSERT INTO [dbo].[User]
      ([id], [name], [email], [emailVerified], [createdAt], [updatedAt], [locale], [status], [twoFactorEnabled])
    VALUES
      (${n(id)}, N'Proof Account', ${n(email)}, 0, SYSUTCDATETIME(), SYSUTCDATETIME(), N'en', N'active', 0);
  `);
  return id;
}

/* ===========================================================================
 * Content rows a target references — owned elsewhere, written here directly
 * ========================================================================= */

/** Draft Articles, in one statement per hundred. */
export async function articles(
  admin: SqlSession,
  creatorId: string,
  total: number,
): Promise<string[]> {
  const ids = Array.from({ length: total }, () => randomUUID());
  for (let start = 0; start < ids.length; start += 100) {
    const values = ids
      .slice(start, start + 100)
      .map(
        (id) =>
          `(${n(id)}, ${n(`non-personal-fixture-${id}`)}, N'draft', 1, ${n(creatorId)}, SYSUTCDATETIME())`,
      )
      .join(',\n');
    await admin.query(`
      INSERT INTO [dbo].[Article] ([id],[slug],[state],[version],[creatorId],[updatedAt])
      VALUES ${values};
    `);
  }
  return ids;
}

export async function work(admin: SqlSession): Promise<string> {
  const id = randomUUID();
  await admin.query(`
    INSERT INTO [dbo].[Work] ([id],[slug],[primaryLocale],[state],[isFeatured],[version],[updatedAt])
    VALUES (${n(id)}, ${n(`non-personal-fixture-${id}`)}, N'en', N'draft', 0, 1, SYSUTCDATETIME());
  `);
  return id;
}

export async function video(admin: SqlSession): Promise<string> {
  const id = randomUUID();
  const provider = randomUUID().replaceAll('-', '').slice(0, 11);
  await admin.query(`
    INSERT INTO [dbo].[Video] ([id],[slug],[primaryLocale],[state],[isFeatured],[provider],[providerVideoId],[availability],[languageCode],[version],[updatedAt])
    VALUES (${n(id)}, ${n(`non-personal-fixture-${id}`)}, N'en', N'draft', 0, N'youtube', '${provider}', N'available', N'en', 1, SYSUTCDATETIME());
  `);
  return id;
}

/**
 * A scaffold canonical Quran structure: one fixture source, Juz 1, Surah 1
 * with `ayat` ayat. Written directly as the owner, never activated.
 */
export async function quranScaffold(admin: SqlSession, ayat: number): Promise<void> {
  const source = randomUUID();
  await admin.query(`
    INSERT INTO [dbo].[QuranSource] ([id],[code],[authority],[title],[version],[encoding],[script],[reference])
    VALUES (${n(source)}, N'non-personal-fixture', N'fixture', N'NON_PERSONAL_FIXTURE source', N'fixture-1', N'utf-8', N'fixture', NULL);
    INSERT INTO [dbo].[Juz] ([number],[sourceId]) VALUES (1, ${n(source)});
    INSERT INTO [dbo].[Surah] ([number],[ayahCount],[revelation],[nameArabic],[sourceId])
    VALUES (1, ${ayat}, NULL, N'NON_PERSONAL_FIXTURE_SURAH', ${n(source)});
  `);
  const values = Array.from(
    { length: ayat },
    (_, index) =>
      `(1, ${index + 1}, 1, ${n(sentinel('AYAH_TEXT', index + 1))}, ${n(source)}, 1)`,
  ).join(',\n');
  await admin.query(`
    INSERT INTO [dbo].[Ayah] ([surahNumber],[ayahNumber],[juzNumber],[text],[sourceId],[version])
    VALUES ${values};
  `);
}

/* ===========================================================================
 * Observations
 * ========================================================================= */

/** A row count, for "wrote nothing" and "wrote exactly one" proofs. */
export async function count(
  admin: SqlSession,
  table: string,
  where = '1 = 1',
): Promise<number> {
  const [row] = await admin.query<{ total: number }>(
    `SELECT COUNT_BIG(*) AS [total] FROM [dbo].[${table}] WHERE ${where};`,
  );
  return Number(row?.total ?? 0);
}

/** Every Personalisation row one account owns, across every owner table. */
export async function ownedRows(admin: SqlSession, accountId: string): Promise<number> {
  const owner = `[userId] = ${n(accountId)}`;
  const saved = `[savedItemId] IN (SELECT [id] FROM [dbo].[SavedItem] WHERE ${owner})`;
  let total = 0;
  for (const [table, where] of [
    ['PersonalisationProfile', owner],
    ['PersonalisationInterest', owner],
    ['PersonalisationGoal', owner],
    ['SavedItem', owner],
    ['Bookmark', saved],
    ['Note', saved],
    ['PrivateCollection', owner],
    ['PrivateCollectionItem', owner],
    ['ReadingHistory', owner],
    ['WatchHistory', owner],
    ['QuranReadingProgress', owner],
    ['NotificationPreference', owner],
    ['Notification', owner],
  ] as const)
    total += await count(admin, table, where);
  return total;
}
