import { randomUUID } from 'node:crypto';

import { createProofAccount } from '../people/harness.ts';
import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';

/**
 * Phase 22 fixture rows that ONLY the owner/operator — or another context —
 * may write: accounts (Identity's), the Topics a Course is filed under
 * (Taxonomy's) and the People attributed as its teachers (People's). Every
 * statement here runs on the MIGRATION (owner) session; nothing Learning does
 * is written through it.
 *
 * NOTHING HERE IS CONTENT. Every title, name and summary is an unmistakable
 * `NON_LEARNING_FIXTURE_…` sentinel, every slug a `non-learning-fixture-…`
 * one, and every account address sits on the reserved `.invalid` TLD.
 */

/** A SQL Server Unicode literal. Values are this file's own constants or generated ids. */
export const n = (value: string) => `N'${value.replaceAll("'", "''")}'`;

/** A sentinel no real title, summary or lesson could be mistaken for. */
export const sentinel = (kind: string, index: number | string) =>
  `NON_LEARNING_FIXTURE_${kind}_${index}`;

/** A fresh slug in the fixture's own namespace — valid for the Learning grammar. */
let sequence = 0;
export function freshSlug(prefix = 'course'): string {
  sequence += 1;
  return `non-learning-fixture-${prefix}-${String(sequence)}-${Date.now().toString(36)}`;
}

/* ===========================================================================
 * Identity
 * ========================================================================= */

/** An active synthetic account, `…@people-proof.invalid`. */
export const account = (admin: SqlSession) => createProofAccount(admin);

/* ===========================================================================
 * Rows a Course references — owned elsewhere, written here directly
 * ========================================================================= */

/** An active Topic with an English name. */
export async function topic(admin: SqlSession): Promise<string> {
  const id = randomUUID();
  sequence += 1;
  await admin.query(`
    INSERT INTO [dbo].[Topic] ([id],[slug],[parentId],[position],[status],[system])
    VALUES (${n(id)}, ${n(`non-learning-fixture-topic-${id}`)}, NULL, ${String(9000 + sequence)}, N'active', 0);
    INSERT INTO [dbo].[TopicTranslation] ([topicId],[locale],[name],[description])
    VALUES (${n(id)}, N'en', ${n(sentinel('TOPIC', id))}, NULL);
  `);
  return id;
}

/** A published People contributor with an English name. */
export async function person(admin: SqlSession): Promise<string> {
  const id = randomUUID();
  await admin.query(`
    INSERT INTO [dbo].[Person] ([id],[slug],[primaryLocale],[status])
    VALUES (${n(id)}, ${n(`non-learning-fixture-person-${id}`)}, N'en', N'published');
    INSERT INTO [dbo].[PersonTranslation] ([personId],[locale],[name],[biography])
    VALUES (${n(id)}, N'en', ${n(sentinel('PERSON', id))}, NULL);
  `);
  return id;
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

/** Every Learning row one account owns. */
export async function ownedRows(admin: SqlSession, accountId: string): Promise<number> {
  const owner = `[userId] = ${n(accountId)}`;
  return (
    (await count(admin, 'Enrolment', owner)) +
    (await count(admin, 'LessonProgress', owner)) +
    (await count(admin, 'TrialClassRequest', owner))
  );
}

/** Positions of a Course's modules, in order — for "dense and unique" proofs. */
export async function modulePositions(
  admin: SqlSession,
  courseId: string,
): Promise<{ id: string; position: number }[]> {
  return admin.query<{ id: string; position: number }>(
    `SELECT [id], [position] FROM [dbo].[CourseModule] WHERE [courseId] = ${n(courseId)} ORDER BY [position];`,
  );
}
