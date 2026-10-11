import { randomUUID } from 'node:crypto';

import { createProofAccount } from '../people/harness.ts';
import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';

/**
 * Phase 18 fixture rows that ONLY the owner/operator may write — registered
 * sources, their structure and text, the corpus activation — and the Identity,
 * People, Taxonomy and Storage rows the Quran proofs reference. Every statement
 * here runs on the MIGRATION (owner) session; nothing the application does is
 * written through it.
 *
 * NOTHING HERE IS THE QURAN. Every text is an unmistakable sentinel —
 * `NON_QURAN_FIXTURE_<TAG>_<surah>_<ayah>` followed by the neutral phrase "non-
 * Quranic test text" — and the structure (three ayat in Surah 1, four in Surah
 * 2, Juz 2 starting at 2:3) is engineering scaffolding that claims nothing
 * about any real Surah, count or Juz boundary. Code-point proofs use a letter
 * with a mark (`بَ`) and Arabic yeh (`ي`), never a verse.
 */

/** A SQL Server Unicode literal. Values are this file's own constants. */
export const n = (value: string) => `N'${value.replaceAll("'", "''")}'`;

/** The neutral Arabic phrase "non-Quranic test text". */
export const NEUTRAL = 'نص اختبار غير قرآني';

/** Beh with fatha — the combining mark the code-point proof replaces. */
export const BEH_FATHA = 'بَ';
export const BEH_KASRA = 'بِ';
export const ARABIC_YEH = 'ي';
export const FARSI_YEH = 'ی';

export interface FixtureAyah {
  readonly surah: number;
  readonly ayah: number;
  readonly juz: number;
  readonly text: string;
}

/** The fixture structure every source below shares. */
export const STRUCTURE: readonly { surah: number; ayah: number; juz: number }[] = [
  { surah: 1, ayah: 1, juz: 1 },
  { surah: 1, ayah: 2, juz: 1 },
  { surah: 1, ayah: 3, juz: 1 },
  { surah: 2, ayah: 1, juz: 1 },
  { surah: 2, ayah: 2, juz: 1 },
  { surah: 2, ayah: 3, juz: 2 },
  { surah: 2, ayah: 4, juz: 2 },
];

/** One sentinel text, carrying the marked letter or the yeh where a proof needs one. */
export function fixtureText(tag: string, surah: number, ayah: number): string {
  const marked =
    surah === 1 && ayah === 1
      ? ` ${BEH_FATHA}`
      : surah === 1 && ayah === 2
        ? ` ${ARABIC_YEH}`
        : '';
  return `NON_QURAN_FIXTURE_${tag}_${surah}_${ayah} ${NEUTRAL}${marked}`;
}

export function fixtureAyat(
  tag: string,
  structure: readonly { surah: number; ayah: number; juz: number }[] = STRUCTURE,
): FixtureAyah[] {
  return structure.map((entry) => ({
    ...entry,
    text: fixtureText(tag, entry.surah, entry.ayah),
  }));
}

export interface RegisteredSource {
  readonly id: string;
  readonly code: string;
  readonly ayat: readonly FixtureAyah[];
}

/**
 * Registers a source exactly as the operator would: the source row, its Surah
 * counts derived from the ayat given, and the ayat themselves.
 */
export async function registerSource(
  admin: SqlSession,
  input: {
    readonly code: string;
    readonly authority: 'fixture' | 'approved';
    readonly ayat: readonly FixtureAyah[];
  },
): Promise<RegisteredSource> {
  const id = randomUUID();
  const counts = new Map<number, number>();
  for (const entry of input.ayat)
    counts.set(entry.surah, (counts.get(entry.surah) ?? 0) + 1);
  const reference =
    input.authority === 'approved' ? n('NON_QURAN_FIXTURE evidence reference') : 'NULL';
  await admin.query(`
    INSERT INTO [dbo].[QuranSource] ([id],[code],[authority],[title],[version],[encoding],[script],[reference])
    VALUES (${n(id)}, ${n(input.code)}, ${n(input.authority)}, ${n(`NON_QURAN_FIXTURE source ${input.code}`)},
            N'fixture-1', N'utf-8', N'fixture', ${reference});
  `);
  for (const [surah, ayahCount] of counts)
    await admin.query(`
      INSERT INTO [dbo].[QuranSourceSurah] ([sourceId],[number],[ayahCount],[revelation],[nameArabic])
      VALUES (${n(id)}, ${surah}, ${ayahCount}, NULL, ${n(`NON_QURAN_FIXTURE_SURAH_${surah}`)});
    `);
  for (const entry of input.ayat)
    await admin.query(`
      INSERT INTO [dbo].[QuranSourceAyah] ([sourceId],[surahNumber],[ayahNumber],[juzNumber],[text])
      VALUES (${n(id)}, ${entry.surah}, ${entry.ayah}, ${entry.juz}, ${n(entry.text)});
    `);
  return { id, code: input.code, ayat: input.ayat };
}

/* ===========================================================================
 * Identity: the canonical authority the procedures re-verify
 * ========================================================================= */

/** A synthetic active account holding exactly these permission keys. */
export async function accountWith(
  admin: SqlSession,
  permissions: readonly string[],
): Promise<string> {
  const accountId = await createProofAccount(admin);
  const roleId = randomUUID();
  await admin.query(`
    INSERT INTO [dbo].[Role] ([id],[key],[name],[description],[system])
    VALUES (${n(roleId)}, ${n(`proof-quran-${roleId}`)}, N'Synthetic Quran role', N'Test fixture', 0);
    INSERT INTO [dbo].[RoleAssignment] ([userId],[roleId]) VALUES (${n(accountId)}, ${n(roleId)});
  `);
  for (const key of permissions)
    await admin.query(
      `INSERT INTO [dbo].[RolePermission] ([roleId],[permissionKey]) VALUES (${n(roleId)}, ${n(key)});`,
    );
  return accountId;
}

export async function sessionFor(admin: SqlSession, accountId: string): Promise<string> {
  const id = randomUUID();
  await admin.query(`
    INSERT INTO [dbo].[Session] ([id],[token],[userId],[expiresAt],[createdAt],[updatedAt])
    VALUES (${n(id)}, ${n(`proof-quran-${id}`)}, ${n(accountId)},
            DATEADD(hour, 1, SYSUTCDATETIME()), SYSUTCDATETIME(), SYSUTCDATETIME());
  `);
  return id;
}

/** A step-up grant for one purpose, expiring `minutes` from now (negative: already expired). */
export async function grantFor(
  admin: SqlSession,
  accountId: string,
  sessionId: string,
  purpose: string,
  minutes = 10,
): Promise<string> {
  const id = randomUUID();
  await admin.query(`
    INSERT INTO [dbo].[StepUpGrant] ([id],[userId],[sessionId],[purpose],[expiresAt])
    VALUES (${n(id)}, ${n(accountId)}, ${n(sessionId)}, ${n(purpose)},
            DATEADD(minute, ${minutes}, SYSUTCDATETIME()));
  `);
  return id;
}

/* ===========================================================================
 * People, Taxonomy and Storage rows the Quran proofs reference
 * ========================================================================= */

export async function person(admin: SqlSession, slug: string): Promise<string> {
  const id = randomUUID();
  await admin.query(`
    INSERT INTO [dbo].[Person] ([id],[slug],[primaryLocale],[status])
    VALUES (${n(id)}, ${n(slug)}, N'en', N'published');
  `);
  return id;
}

export async function topic(admin: SqlSession, slug: string): Promise<string> {
  const id = randomUUID();
  await admin.query(`
    INSERT INTO [dbo].[Topic] ([id],[slug],[parentId],[position],[status],[system])
    VALUES (${n(id)}, ${n(slug)}, NULL, 950, N'active', 0);
  `);
  return id;
}

/** A clean audio Asset row — an identifier for a segment to name, no bytes. */
export async function asset(admin: SqlSession): Promise<string> {
  const id = randomUUID();
  const hex = randomUUID().replaceAll('-', '');
  await admin.query(`
    INSERT INTO [dbo].[Asset] ([id],[storageKey],[mediaType],[byteSize],[checksum],[state],[updatedAt])
    VALUES (${n(id)}, ${n(`${hex.slice(0, 2)}/${hex.slice(2, 4)}/${hex}`)}, N'audio/mpeg', 834,
            ${n('c'.repeat(64))}, N'clean', SYSUTCDATETIME());
  `);
  return id;
}

/** Search intent rows owed for one Ayah scope. */
export async function intents(admin: SqlSession, scopeId: string): Promise<number> {
  const [row] = await admin.query<{ total: number }>(`
    SELECT COUNT_BIG(*) AS [total] FROM [dbo].[SearchIndexRequest]
    WHERE [scopeKind] = N'quran-ayah' AND [scopeId] = ${n(scopeId)};
  `);
  return Number(row?.total ?? 0);
}

/** A row count, for "wrote nothing" proofs. */
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
