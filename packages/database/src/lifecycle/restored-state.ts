import 'server-only';

import { BROAD_DATABASE_ROLES } from './principal-authority.ts';
import type { SqlSession } from './sql-connection.ts';

/**
 * Inspection of a RESTORED database's actual state.
 *
 * Every function here reads SQL Server catalogue views in the restored
 * database. None of them trusts the exit status of the RESTORE statement: a
 * restore reports success when it has written files and brought the database
 * online, which says nothing about whether the objects and rows the Phase 1
 * foundation depends on are present and intact.
 *
 * The expectations here are stated once and consumed by both the recovery
 * command and the live recovery test.
 *
 * `scripts/migrate-test.ts` (Chunk 2) carries its own private copies of the
 * same audit-column, index and business-table lists. That duplication is
 * acknowledged rather than hidden: consolidating it would mean editing a
 * closed chunk's gate, which Chunk 3 has no cause to touch. The lists describe
 * one migration and change only when that migration does — at which point
 * `db:migrate:test` and `db:recovery:test` both fail, so the copies cannot
 * drift apart silently. Whoever next changes the audit schema should collapse
 * them into this module.
 */

/** The audit columns the Phase 1 migration creates, in `sys.columns` order. */
export const EXPECTED_AUDIT_COLUMNS = [
  'action',
  'actorId',
  'actorType',
  'afterState',
  'authorisingSource',
  'beforeState',
  'id',
  'ipAddress',
  'occurredAt',
  'targetId',
  'targetType',
];

/** The audit indexes the Phase 1 migration creates, excluding the PK. */
export const EXPECTED_AUDIT_INDEXES = [
  'AuditLog_actorId_idx',
  'AuditLog_occurredAt_idx',
  'AuditLog_targetType_targetId_idx',
  // Chunk 2: the read-only admin audit view filters by action and orders by
  // time, and only indexed filters are offered (SECURITY_BASELINE.md §28).
  'AuditLog_action_occurredAt_idx',
];

/**
 * Tables belonging to phases that have not happened.
 *
 * A restore that produced any of these would mean the artifact came from some
 * other database, so the check is evidence about the backup's provenance as
 * much as about premature schema.
 *
 * `User`, `Account` and `Session` USED to be on this list and are not any
 * more: Phase 2 owns them, and they are now legitimate content of a current
 * artifact. Leaving them here would have turned the first correct Phase-2
 * backup into a failure. `Role`, `Permission`, `RolePermission` and
 * `RoleAssignment` left it for the same reason when Chunk 2 delivered
 * authorisation. `Topic`, `TopicTranslation`, `Language` and `Tag` were never
 * on it and are now required by `PHASE3B_TABLES` instead. Every table remaining
 * belongs to a phase that has not happened, or to a design that is prohibited.
 */
const FUTURE_DOMAIN_TABLES = [
  // Prohibited outright rather than merely early: a single shared assignment
  // table carrying a target type and identifier is the polymorphic reference
  // DOMAIN_MODEL.md §6.2 forbids, and no later phase makes it acceptable. A
  // RESTORE is the one operation that can introduce schema this repository
  // never wrote, so the check belongs here as well as in the migration gate.
  'TopicAssignment',
  'TaxonomyAssignment',
  'EntityTopic',
  // `NewsArticle` left this list in Phase 13, `Event` in Phase 14 and
  // `Collection` in Phase 15, which deliver them; their restored rows are proved
  // by the Phase-13, Phase-14 and Phase-15 recovery fixtures instead.
  'Quran',
  'Hadith',
  'Book',
  'Fatwa',
  'Scholar',
  'Teacher',
  'Course',
  'Message',
  'Notification',
  'Membership',
  'Donation',
  'MigrationProvenance',
];

/**
 * Tables the Phase-2 migration creates.
 *
 * Checked as REQUIRED whenever the Phase-2 migration is among those the caller
 * expects, so a restore cannot satisfy the history check while having lost the
 * schema that history describes.
 */
export const PHASE2_TABLES = [
  'Account',
  'EmailDelivery',
  'EmailSuppression',
  'IdentityCommunicationIntent',
  'IdentitySecurityOperation',
  'ProviderEvent',
  'RateLimitCounter',
  'Session',
  'User',
  'Verification',
  // Chunk 2 — authorisation, step-up and the privileged second factor. An
  // artifact that restored the accounts but not who may administer them would
  // be a restore that looks complete and leaves the platform ungoverned.
  'Permission',
  'Role',
  'RolePermission',
  'RoleAssignment',
  'StepUpGrant',
  'TwoFactor',
  'PrivilegedSecurityPosture',
  'IdentityBootstrap',
];

/**
 * Tables the Phase-3B migration creates.
 *
 * Checked as REQUIRED whenever the Phase-3B migration is among those the caller
 * expects. A restore that carried the history row but not the canonical
 * taxonomy would be a restore that looks complete and has lost the vocabulary
 * every later context classifies its content by.
 */
export const PHASE3B_TABLES = ['Topic', 'TopicTranslation', 'Language', 'Tag'];

async function userTables(session: SqlSession): Promise<string[]> {
  const rows = await session.query<{ name: string }>(`
    SELECT t.name FROM sys.tables t
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE s.name = 'dbo' ORDER BY t.name;
  `);
  return rows.map((row) => row.name);
}

async function auditColumns(session: SqlSession): Promise<string[]> {
  const rows = await session.query<{ name: string }>(`
    SELECT c.name FROM sys.columns c
    WHERE c.object_id = OBJECT_ID(N'[dbo].[AuditLog]') ORDER BY c.name;
  `);
  return rows.map((row) => row.name);
}

async function auditIndexes(session: SqlSession): Promise<string[]> {
  const rows = await session.query<{ name: string }>(`
    SELECT name FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'[dbo].[AuditLog]') AND name IS NOT NULL
    ORDER BY name;
  `);
  return rows.map((row) => row.name);
}

/** Migration names the RESTORED history reports as applied. */
async function restoredMigrationHistory(session: SqlSession): Promise<string[]> {
  const rows = await session.query<{ migration_name: string }>(`
    SELECT [migration_name] FROM [dbo].[_prisma_migrations]
    WHERE [finished_at] IS NOT NULL AND [rolled_back_at] IS NULL
    ORDER BY [migration_name];
  `);
  return rows.map((row) => row.migration_name);
}

/** What a restored database must show for the Phase 1 foundation to be intact. */
export interface RestoredSchemaReport {
  tables: string[];
  columns: string[];
  indexes: string[];
  migrations: string[];
  auditRowCount: number;
}

/**
 * Verifies restored schema, indexes and migration history, and throws on the
 * first discrepancy.
 *
 * The premature-business-table check runs here rather than only in the
 * migration gate, because a restore is the one operation that can introduce
 * schema this repository never wrote.
 */
export async function verifyRestoredSchema(
  restored: SqlSession,
  expectedMigrationIds: readonly string[],
): Promise<RestoredSchemaReport> {
  if (expectedMigrationIds.length === 0) {
    throw new Error('No expected migrations supplied; the check would prove nothing.');
  }

  const tables = await userTables(restored);

  if (!tables.includes('AuditLog')) {
    throw new Error(
      `Restored database has no dbo.AuditLog. Tables: ${tables.join(', ') || '(none)'}`,
    );
  }
  if (!tables.includes('_prisma_migrations')) {
    throw new Error('Restored database has no Prisma migration-history table.');
  }

  const premature = tables.filter((table) => FUTURE_DOMAIN_TABLES.includes(table));
  if (premature.length > 0) {
    throw new Error(
      `Restored database contains future-domain tables: ${premature.join(', ')}`,
    );
  }

  // The SCHEMA the expected history describes must actually be there. A
  // restore that carried the history row but not the tables would otherwise
  // report a migration as applied over a database that cannot honour it.
  if (expectedMigrationIds.some((id) => id.includes('phase2'))) {
    const missing = PHASE2_TABLES.filter((table) => !tables.includes(table));
    if (missing.length > 0) {
      throw new Error(
        `Restored database is missing Phase-2 tables: ${missing.join(', ')}`,
      );
    }
  }

  if (expectedMigrationIds.some((id) => id.includes('phase3b'))) {
    const missing = PHASE3B_TABLES.filter((table) => !tables.includes(table));
    if (missing.length > 0) {
      throw new Error(
        `Restored database is missing Phase-3B taxonomy tables: ${missing.join(', ')}`,
      );
    }
  }

  if (expectedMigrationIds.some((id) => id.includes('phase6'))) {
    const expected = [
      'Article',
      'ArticleRevision',
      'ArticleRevisionTranslation',
      'ArticleTopic',
      'ArticleContributor',
      'ArticleSlugHistory',
      'Page',
      'PageRevision',
      'PageRevisionTranslation',
      'PageTopic',
      'PageContributor',
      'PageSlugHistory',
      'ContactInquiry',
      'Feedback',
    ];
    const missing = expected.filter((table) => !tables.includes(table));
    if (missing.length)
      throw new Error(
        'Restored database is missing Phase 6 tables: ' + missing.join(', '),
      );
  }
  const columns = await auditColumns(restored);
  if (columns.join(',') !== EXPECTED_AUDIT_COLUMNS.join(',')) {
    throw new Error(
      `Restored AuditLog columns differ.\n  expected: ${EXPECTED_AUDIT_COLUMNS.join(', ')}\n` +
        `  actual:   ${columns.join(', ')}`,
    );
  }

  const indexes = await auditIndexes(restored);
  for (const expected of EXPECTED_AUDIT_INDEXES) {
    if (!indexes.includes(expected)) {
      throw new Error(
        `Restored AuditLog is missing index ${expected}. Present: ${indexes.join(', ')}`,
      );
    }
  }

  // EVERY expected migration, not merely the first one. Checking only
  // `migrations[0]` let a restore that had lost later history pass, which is
  // precisely the state a partial or stale artifact produces.
  const migrations = await restoredMigrationHistory(restored);
  const absent = expectedMigrationIds.filter((id) => !migrations.includes(id));
  if (absent.length > 0) {
    throw new Error(
      `Restored migration history is missing ${absent.join(', ')}. ` +
        `Found: ${migrations.join(', ') || '(none)'}`,
    );
  }

  const [count] = await restored.query<{ total: number }>(
    'SELECT COUNT_BIG(*) AS total FROM [dbo].[AuditLog];',
  );

  return {
    tables,
    columns,
    indexes,
    migrations,
    auditRowCount: Number(count?.total ?? 0),
  };
}

/**
 * The security posture of the application principal INSIDE the restored
 * database, read from the restored catalogue.
 *
 * ## Why this needs care
 *
 * A SQL Server database user is bound to a server login by SID. `RESTORE`
 * brings the DATABASE's users across in the restored database; it does not
 * create server logins, which live in `master` and are outside the artifact.
 * On this instance the `minhaj_app` login already exists with the same SID, so
 * the restored user maps straight back to it. On a different instance it would
 * be an "orphaned user" until re-mapped.
 *
 * That distinction is reported rather than papered over: `loginMapped` says
 * whether the SERVER-LEVEL binding is intact, separately from the DATABASE
 * permissions, which are restored either way. Nothing here grants anything to
 * make a check pass.
 */
export interface RestoredSecurityReport {
  /** The user exists in the restored database. */
  userPresent: boolean;
  /** The restored user's SID resolves to an existing server login. */
  loginMapped: boolean;
  /** The user owns the restored database. */
  ownsDatabase: boolean;
  /** Membership of broad database roles, which must be empty. */
  broadRoles: string[];
  /** Effective permissions on `dbo.AuditLog`, as GRANT/DENY pairs. */
  auditPermissions: { permission: string; state: string }[];
}

/**
 * Broad roles, shared with the live permission proof.
 *
 * `db_datareader` and `db_datawriter` were missing here, and they are the two
 * that matter most: either one grants authority across every table while the
 * explicit `dbo.AuditLog` denials below still read as correct.
 */
const BROAD_ROLES = BROAD_DATABASE_ROLES;

export async function inspectRestoredSecurity(
  restored: SqlSession,
  login: string,
): Promise<RestoredSecurityReport> {
  if (!/^[A-Za-z][A-Za-z0-9_]{2,63}$/.test(login)) {
    throw new Error(`Invalid application login name '${login}'.`);
  }

  const [presence] = await restored.query<{
    userPresent: number;
    loginMapped: number;
    ownsDatabase: number;
  }>(`
    SELECT
      CASE WHEN EXISTS (
        SELECT 1 FROM sys.database_principals
        WHERE name = N'${login}' AND type IN ('S', 'U')
      ) THEN 1 ELSE 0 END AS userPresent,
      -- The restored user's SID still resolves to a server login. This is the
      -- SERVER-LEVEL binding, which is not part of the backup artifact.
      CASE WHEN EXISTS (
        SELECT 1 FROM sys.database_principals dp
        JOIN sys.server_principals sp ON sp.sid = dp.sid
        WHERE dp.name = N'${login}'
      ) THEN 1 ELSE 0 END AS loginMapped,
      CASE WHEN EXISTS (
        SELECT 1 FROM sys.databases d
        JOIN sys.database_principals dp ON dp.sid = d.owner_sid
        WHERE d.name = DB_NAME() AND dp.name = N'${login}'
      ) THEN 1 ELSE 0 END AS ownsDatabase;
  `);

  const roles = await restored.query<{ role: string }>(`
    SELECT r.name AS role
    FROM sys.database_role_members m
    JOIN sys.database_principals r ON r.principal_id = m.role_principal_id
    JOIN sys.database_principals u ON u.principal_id = m.member_principal_id
    WHERE u.name = N'${login}';
  `);

  const permissions = await restored.query<{ permission: string; state: string }>(`
    SELECT p.permission_name AS permission, p.state_desc AS state
    FROM sys.database_permissions p
    JOIN sys.database_principals u ON u.principal_id = p.grantee_principal_id
    WHERE u.name = N'${login}'
      AND p.major_id = OBJECT_ID(N'[dbo].[AuditLog]')
    ORDER BY p.permission_name;
  `);

  return {
    userPresent: Number(presence?.userPresent ?? 0) === 1,
    loginMapped: Number(presence?.loginMapped ?? 0) === 1,
    ownsDatabase: Number(presence?.ownsDatabase ?? 0) === 1,
    broadRoles: roles.map((row) => row.role).filter((role) => BROAD_ROLES.includes(role)),
    auditPermissions: permissions.map((row) => ({
      permission: row.permission,
      state: row.state,
    })),
  };
}
