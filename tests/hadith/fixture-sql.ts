import { randomUUID } from 'node:crypto';

import { createProofAccount } from '../people/harness.ts';
import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';

/**
 * Phase 19 fixture rows that ONLY the owner/operator may write — registered
 * source systems, their editions, a collection's activation — and the
 * Identity, People and Taxonomy rows the Hadith proofs reference. Every
 * statement here runs on the MIGRATION (owner) session; nothing the
 * application does is written through it.
 *
 * NOTHING HERE IS A HADITH. Every text, chain, grading, grader, reference and
 * evidence a proof writes is an unmistakable `NON_HADITH_FIXTURE_<KIND>_<n>`
 * sentinel; the only Arabic is the neutral phrase "test text" and single
 * letters carrying a mark, never a narration. Source systems are named as
 * fixtures even when a proof registers one of `approved` authority, so no
 * real authority is ever implied.
 *
 * The identity helpers are this file's own small copies rather than an import
 * of the Quran proofs' fixtures: Hadith and the Quran are parallel contexts,
 * and neither's proofs depend on the other's.
 */

/** A SQL Server Unicode literal. Values are this file's own constants or generated ids. */
export const n = (value: string) => `N'${value.replaceAll("'", "''")}'`;

/** The neutral Arabic phrase "test text" — never a narration. */
export const NEUTRAL = 'نص اختبار';

/** One sentinel of one kind: `NON_HADITH_FIXTURE_TEXT_3`, `..._CHAIN_1`, … */
export function sentinel(
  kind:
    | 'TEXT'
    | 'TRANSLATION'
    | 'CHAIN'
    | 'GRADING'
    | 'GRADER'
    | 'REFERENCE'
    | 'COMMENTARY'
    | 'SCIENCE'
    | 'EVIDENCE',
  index: number,
): string {
  return `NON_HADITH_FIXTURE_${kind}_${index}`;
}

/** The UTF-16LE bytes SQL Server stores for an NVARCHAR value, as upper hex. */
export function utf16(text: string): string {
  return Buffer.from(text, 'utf16le').toString('hex').toUpperCase();
}

/* ===========================================================================
 * Sources: what only the operator registers
 * ========================================================================= */

/** Registers a source system exactly as the operator would. */
export async function registerSourceSystem(
  admin: SqlSession,
  input: { readonly code: string; readonly authority: 'fixture' | 'approved' },
): Promise<string> {
  const id = randomUUID();
  // An approved source carries the reference to its evidence (the CHECK).
  const reference =
    input.authority === 'approved'
      ? n(`${sentinel('EVIDENCE', 9)} registration`)
      : 'NULL';
  await admin.query(`
    INSERT INTO [dbo].[HadithSourceSystem] ([id],[code],[authority],[title],[version],[encoding],[reference])
    VALUES (${n(id)}, ${n(input.code)}, ${n(input.authority)}, ${n(`NON_HADITH_FIXTURE source ${input.code}`)},
            N'fixture-1', N'utf-8', ${reference});
  `);
  return id;
}

/** Registers one edition of one collection as one source system carries it. */
export async function registerEdition(
  admin: SqlSession,
  input: {
    readonly collectionId: string;
    readonly sourceSystemId: string;
    readonly code: string;
  },
): Promise<string> {
  const id = randomUUID();
  await admin.query(`
    INSERT INTO [dbo].[HadithEdition] ([id],[collectionId],[sourceSystemId],[code],[title],[reference])
    VALUES (${n(id)}, ${n(input.collectionId)}, ${n(input.sourceSystemId)}, ${n(input.code)},
            ${n(`NON_HADITH_FIXTURE edition ${input.code}`)}, NULL);
  `);
  return id;
}

/** The operator's activation of one collection, under one authority. */
export async function activate(
  admin: SqlSession,
  collectionId: string,
  authority: 'fixture' | 'approved',
): Promise<void> {
  await admin.query(`
    INSERT INTO [dbo].[HadithActivation] ([collectionId],[authority],[authorisedBy])
    VALUES (${n(collectionId)}, ${n(authority)}, N'NON_HADITH_FIXTURE operator');
  `);
}

/** Removes every activation: the operator's act of taking the section down. */
export async function deactivateAll(admin: SqlSession): Promise<void> {
  await admin.query(`DELETE FROM [dbo].[HadithActivation];`);
}

/* ===========================================================================
 * Identity: the canonical authority the procedures re-verify
 * ========================================================================= */

/** A synthetic active account holding exactly these permission keys, and its role id. */
export async function accountWithRole(
  admin: SqlSession,
  permissions: readonly string[],
): Promise<{ readonly accountId: string; readonly roleId: string }> {
  const accountId = await createProofAccount(admin);
  const roleId = randomUUID();
  await admin.query(`
    INSERT INTO [dbo].[Role] ([id],[key],[name],[description],[system])
    VALUES (${n(roleId)}, ${n(`proof-hadith-${roleId}`)}, N'Synthetic Hadith role', N'Test fixture', 0);
    INSERT INTO [dbo].[RoleAssignment] ([userId],[roleId]) VALUES (${n(accountId)}, ${n(roleId)});
  `);
  for (const key of permissions)
    await admin.query(
      `INSERT INTO [dbo].[RolePermission] ([roleId],[permissionKey]) VALUES (${n(roleId)}, ${n(key)});`,
    );
  return { accountId, roleId };
}

/** A synthetic active account holding exactly these permission keys. */
export async function accountWith(
  admin: SqlSession,
  permissions: readonly string[],
): Promise<string> {
  return (await accountWithRole(admin, permissions)).accountId;
}

/** A live session of the account. */
export async function sessionFor(admin: SqlSession, accountId: string): Promise<string> {
  const id = randomUUID();
  await admin.query(`
    INSERT INTO [dbo].[Session] ([id],[token],[userId],[expiresAt],[createdAt],[updatedAt])
    VALUES (${n(id)}, ${n(`proof-hadith-${id}`)}, ${n(accountId)},
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
  minutes = 30,
): Promise<string> {
  const id = randomUUID();
  await admin.query(`
    INSERT INTO [dbo].[StepUpGrant] ([id],[userId],[sessionId],[purpose],[expiresAt])
    VALUES (${n(id)}, ${n(accountId)}, ${n(sessionId)}, ${n(purpose)},
            DATEADD(minute, ${minutes}, SYSUTCDATETIME()));
  `);
  return id;
}

/** The three identifiers a canonical write carries into the database. */
export interface FixtureAuthority {
  readonly actorId: string;
  readonly sessionId: string;
  readonly stepUpGrantId: string;
}

/** A holder of `hadith.editCanonical` with a live, correctly purposed grant. */
export async function canonicalEditor(admin: SqlSession): Promise<FixtureAuthority> {
  const actorId = await accountWith(admin, ['hadith.editCanonical']);
  const sessionId = await sessionFor(admin, actorId);
  return {
    actorId,
    sessionId,
    stepUpGrantId: await grantFor(admin, actorId, sessionId, 'hadith-canonical-edit'),
  };
}

/* ===========================================================================
 * People and Taxonomy rows the Hadith proofs reference
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
    VALUES (${n(id)}, ${n(slug)}, NULL, 951, N'active', 0);
  `);
  return id;
}

/* ===========================================================================
 * Observations
 * ========================================================================= */

/** Search intent rows owed for one citation scope. */
export async function intents(admin: SqlSession, citationId: string): Promise<number> {
  const [row] = await admin.query<{ total: number }>(`
    SELECT COUNT_BIG(*) AS [total] FROM [dbo].[SearchIndexRequest]
    WHERE [scopeKind] = N'hadith' AND [scopeId] = ${n(citationId)};
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

/** A citation's identity by its collection and number, or null. */
export async function citationIdOf(
  admin: SqlSession,
  collectionId: string,
  number: number,
): Promise<string | null> {
  const [row] = await admin.query<{ id: string }>(
    `SELECT [id] FROM [dbo].[HadithCitation] WHERE [collectionId] = ${n(collectionId)} AND [number] = ${number};`,
  );
  return row?.id ?? null;
}
