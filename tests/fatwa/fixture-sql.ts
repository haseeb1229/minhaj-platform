import { randomUUID } from 'node:crypto';

import { createProofAccount } from '../people/harness.ts';
import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';

/**
 * Phase 20 fixture rows that ONLY the owner/operator may write — the service's
 * activation — and the Identity and Taxonomy rows the Fatwa proofs reference.
 * Every statement here runs on the MIGRATION (owner) session; nothing the
 * application does is written through it.
 *
 * NOTHING HERE IS A RULING OR A REAL QUESTION. Every question, public question,
 * ruling, title, note, reason and category name a proof writes is an
 * unmistakable `NON_FATWA_FIXTURE_<KIND>_<n>` sentinel.
 *
 * The identity helpers are this file's own small copies rather than an import
 * of another context's proof fixtures: Fatwa's proofs depend on no other
 * content context's.
 */

/** A SQL Server Unicode literal. Values are this file's own constants or generated ids. */
export const n = (value: string) => `N'${value.replaceAll("'", "''")}'`;

/**
 * One sentinel of one kind, padded past every minimum length the schemas and
 * procedures apply (20 characters for a question, public question or ruling).
 */
export function sentinel(
  kind:
    'QUESTION' | 'PUBLIC_QUESTION' | 'RULING' | 'TITLE' | 'NOTE' | 'REASON' | 'CATEGORY',
  index: number,
): string {
  return `NON_FATWA_FIXTURE_${kind}_${index} padded past every minimum`;
}

/* ===========================================================================
 * The operator
 * ========================================================================= */

/** The operator's activation of the service. Immutable once written. */
export async function activate(
  admin: SqlSession,
  authority: 'fixture' | 'approved',
): Promise<void> {
  const reference = authority === 'approved' ? n('NON_FATWA_FIXTURE evidence') : 'NULL';
  await admin.query(`
    INSERT INTO [dbo].[FatwaActivation] ([id],[authority],[authorisedBy],[reference])
    VALUES (1, ${n(authority)}, N'NON_FATWA_FIXTURE operator', ${reference});
  `);
}

/* ===========================================================================
 * Identity: the live authority the procedures and staff reads re-check
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
    VALUES (${n(roleId)}, ${n(`proof-fatwa-${roleId}`)}, N'Synthetic Fatwa role', N'Test fixture', 0);
    INSERT INTO [dbo].[RoleAssignment] ([userId],[roleId]) VALUES (${n(accountId)}, ${n(roleId)});
  `);
  for (const key of permissions)
    await admin.query(
      `INSERT INTO [dbo].[RolePermission] ([roleId],[permissionKey]) VALUES (${n(roleId)}, ${n(key)});`,
    );
  return { accountId, roleId };
}

/** Revokes one role assignment, as Identity would. */
export async function revoke(
  admin: SqlSession,
  holder: { readonly accountId: string; readonly roleId: string },
): Promise<void> {
  await admin.query(
    `UPDATE [dbo].[RoleAssignment] SET [revokedAt] = SYSUTCDATETIME() WHERE [userId] = ${n(holder.accountId)} AND [roleId] = ${n(holder.roleId)};`,
  );
}

/** Closes an account, as Identity's closure would (status only — Fatwa reads nothing else). */
export async function closeAccount(admin: SqlSession, accountId: string): Promise<void> {
  await admin.query(
    `UPDATE [dbo].[User] SET [status] = N'closed' WHERE [id] = ${n(accountId)};`,
  );
}

/** A live session of the account. */
export async function sessionFor(admin: SqlSession, accountId: string): Promise<string> {
  const id = randomUUID();
  await admin.query(`
    INSERT INTO [dbo].[Session] ([id],[token],[userId],[expiresAt],[createdAt],[updatedAt])
    VALUES (${n(id)}, ${n(`proof-fatwa-${id}`)}, ${n(accountId)},
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

/* ===========================================================================
 * Taxonomy rows the Fatwa proofs reference
 * ========================================================================= */

export async function topic(admin: SqlSession, slug: string): Promise<string> {
  const id = randomUUID();
  await admin.query(`
    INSERT INTO [dbo].[Topic] ([id],[slug],[parentId],[position],[status],[system])
    VALUES (${n(id)}, ${n(slug)}, NULL, 952, N'active', 0);
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

/** Search intent rows owed for one ruling. */
export async function intents(admin: SqlSession, fatwaId: string): Promise<number> {
  return count(
    admin,
    'SearchIndexRequest',
    `[scopeKind] = N'fatwa' AND [scopeId] = ${n(fatwaId)}`,
  );
}

/** Audited accesses of one question's text at one stage. */
export async function accesses(
  admin: SqlSession,
  questionId: string,
  stage: 'intake' | 'assigned' | 'review',
): Promise<number> {
  return count(
    admin,
    'AuditLog',
    `[action] = N'fatwa.question.accessed' AND [targetId] = ${n(questionId)} AND [afterState] = ${n(JSON.stringify({ stage }))}`,
  );
}
