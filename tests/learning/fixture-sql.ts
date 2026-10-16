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

/* ===========================================================================
 * Phase 23 — the owner's activation and Identity's teaching authority
 * ========================================================================= */

/** The operator's activation of live learning. Immutable once written. */
export async function activateLive(
  admin: SqlSession,
  authority: 'fixture' | 'approved',
): Promise<void> {
  const reference =
    authority === 'approved' ? n('NON_LEARNING_FIXTURE evidence') : 'NULL';
  await admin.query(`
    INSERT INTO [dbo].[LiveLearningActivation] ([id],[authority],[authorisedBy],[reference])
    VALUES (1, ${n(authority)}, N'NON_LEARNING_FIXTURE operator', ${reference});
  `);
}

export interface TeacherFixture {
  readonly accountId: string;
  readonly roleId: string;
  readonly roleAssignmentId: string;
}

/**
 * A synthetic active account holding a LIVE assignment of a role carrying
 * exactly the keys named (`teaching.perform` by default) — what Identity
 * would report as a live teaching assignment. The assignment id is what a
 * scope must name.
 */
export async function teacherAccount(
  admin: SqlSession,
  permissions: readonly string[] = ['teaching.perform'],
): Promise<TeacherFixture> {
  const accountId = await createProofAccount(admin);
  const roleId = randomUUID();
  const roleAssignmentId = randomUUID();
  await admin.query(`
    INSERT INTO [dbo].[Role] ([id],[key],[name],[description],[system])
    VALUES (${n(roleId)}, ${n(`proof-learning-${roleId}`)}, N'Synthetic teaching role', N'Test fixture', 0);
    INSERT INTO [dbo].[RoleAssignment] ([id],[userId],[roleId])
    VALUES (${n(roleAssignmentId)}, ${n(accountId)}, ${n(roleId)});
  `);
  for (const key of permissions)
    await admin.query(
      `INSERT INTO [dbo].[RolePermission] ([roleId],[permissionKey]) VALUES (${n(roleId)}, ${n(key)});`,
    );
  return { accountId, roleId, roleAssignmentId };
}

/** Revokes one assignment, as Identity would. */
export async function revokeAssignment(
  admin: SqlSession,
  roleAssignmentId: string,
): Promise<void> {
  await admin.query(
    `UPDATE [dbo].[RoleAssignment] SET [revokedAt] = SYSUTCDATETIME() WHERE [id] = ${n(roleAssignmentId)};`,
  );
}

/** A scope written directly by the owner — for trigger-floor proofs. */
export async function scope(
  admin: SqlSession,
  courseId: string,
  teacher: { readonly accountId: string; readonly roleAssignmentId: string },
): Promise<string> {
  const id = randomUUID();
  await admin.query(`
    INSERT INTO [dbo].[CourseTeachingAssignment] ([id],[courseId],[userId],[roleAssignmentId],[grantedAt])
    VALUES (${n(id)}, ${n(courseId)}, ${n(teacher.accountId)}, ${n(teacher.roleAssignmentId)}, SYSUTCDATETIME());
  `);
  return id;
}

/** A window written directly by the owner — the only way a PAST window exists. */
export async function pastWindow(admin: SqlSession, accountId: string): Promise<string> {
  const id = randomUUID();
  await admin.query(`
    INSERT INTO [dbo].[Availability] ([id],[userId],[startsAt],[endsAt],[timeZone],[startsLocal],[endsLocal],[state])
    VALUES (${n(id)}, ${n(accountId)}, DATEADD(hour, -3, SYSUTCDATETIME()), DATEADD(hour, -2, SYSUTCDATETIME()),
            N'UTC', N'2026-01-01T00:00', N'2026-01-01T01:00', N'open');
  `);
  return id;
}

/** Intents owed for one session, by state and purpose. */
export async function intentsFor(
  admin: SqlSession,
  sessionId: string,
): Promise<{ purpose: string; userId: string; state: string; dueAt: Date }[]> {
  return admin.query<{ purpose: string; userId: string; state: string; dueAt: Date }>(
    `SELECT [purpose], [userId], [state], [dueAt] FROM [dbo].[ClassCommunicationIntent]
     WHERE [sessionId] = ${n(sessionId)} ORDER BY [purpose], [userId], [dueAt];`,
  );
}

/** A session's private columns, read by the owner for "cleared" proofs. */
export async function sessionColumns(
  admin: SqlSession,
  sessionId: string,
): Promise<{ state: string; meetingUrl: string | null; scopeId: string } | undefined> {
  const [row] = await admin.query<{
    state: string;
    meetingUrl: string | null;
    scopeId: string;
  }>(
    `SELECT [state], [meetingUrl], [scopeId] FROM [dbo].[ClassSession] WHERE [id] = ${n(sessionId)};`,
  );
  return row;
}

/** Every Phase 23 row one account owns that disposition may remove or end. */
export async function classRows(admin: SqlSession, accountId: string): Promise<number> {
  const owner = `[userId] = ${n(accountId)}`;
  return (
    (await count(admin, 'Booking', owner)) +
    (await count(admin, 'Attendance', owner)) +
    (await count(admin, 'ClassCommunicationIntent', owner)) +
    (await count(admin, 'Availability', owner)) +
    (await count(admin, 'CourseTeachingAssignment', `${owner} AND [endedAt] IS NULL`))
  );
}
