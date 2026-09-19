import 'server-only';

import type { SqlSession } from './sql-connection.ts';

/**
 * EFFECTIVE authority of the least-privilege runtime principal.
 *
 * ## Why the previous proof was not enough
 *
 * It read the grant script and checked a handful of named denials on
 * `dbo.AuditLog`. Both can be true while the principal holds sweeping rights
 * arriving from somewhere else:
 *
 *   - membership of `db_datareader` grants SELECT on EVERY table. The AuditLog
 *     checks still pass, because AuditLog SELECT is supposed to be allowed.
 *   - membership of `db_datawriter` grants INSERT/UPDATE/DELETE everywhere. The
 *     AuditLog UPDATE/DELETE checks still pass, because the script's explicit
 *     DENY outranks the role — on that one table, and nowhere else.
 *   - a database- or schema-level `GRANT SELECT` behaves the same way.
 *
 * So the boundary has to be measured, not inferred: what can this login
 * ACTUALLY do, including everything inherited, and against an object nobody
 * granted it anything on.
 *
 * Everything here runs as the runtime principal itself, except the sentinel
 * lifecycle, which needs administrative authority and says so in its signature.
 */

/**
 * Fixed database roles that would defeat the runtime boundary.
 *
 * Not a speculative blacklist of every role SQL Server defines: `public` is
 * unavoidable, `db_denydatareader` and `db_denydatawriter` only ever subtract,
 * and membership of those is not a finding. These seven grant authority the
 * Phase 1 runtime principal must not have.
 */
export const BROAD_DATABASE_ROLES = [
  'db_owner',
  'db_ddladmin',
  'db_securityadmin',
  'db_accessadmin',
  'db_datareader',
  'db_datawriter',
  'db_backupoperator',
];

/**
 * Database-scoped permissions that would be broad authority if effective.
 *
 * Checked with `HAS_PERMS_BY_NAME`, which answers for the CURRENT principal and
 * already accounts for role inheritance, ownership and DENY — the three routes
 * by which a permission arrives without appearing in the grant script.
 *
 * Permissions `public` holds by default are deliberately absent from this list
 * (`CONNECT`, the `VIEW ANY … DEFINITION` pair). Listing them would make the
 * proof fail on a correctly configured server, which trains people to weaken it.
 */
export const BROAD_DATABASE_PERMISSIONS = [
  'CONTROL',
  'ALTER',
  'ALTER ANY SCHEMA',
  'CREATE TABLE',
  'CREATE VIEW',
  'CREATE PROCEDURE',
  'CREATE FUNCTION',
  'CREATE SCHEMA',
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'EXECUTE',
  'REFERENCES',
  'TAKE OWNERSHIP',
  'BACKUP DATABASE',
  'BACKUP LOG',
  'ALTER ANY USER',
  'ALTER ANY ROLE',
];

/** The same question at schema scope, where `dbo` holds every Phase 1 object. */
export const BROAD_SCHEMA_PERMISSIONS = [
  'CONTROL',
  'ALTER',
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'EXECUTE',
  'REFERENCES',
  'TAKE OWNERSHIP',
];

/**
 * Database-scope permissions the runtime principal may legitimately hold.
 *
 * `CONNECT` is created with the user. The two `VIEW ANY … DEFINITION`
 * permissions are granted to `public` by SQL Server itself and cannot be
 * withheld from this account without withholding them from everyone.
 */
const ALLOWED_DATABASE_SCOPE_GRANTS = [
  'CONNECT',
  'VIEW ANY COLUMN ENCRYPTION KEY DEFINITION',
  'VIEW ANY COLUMN MASTER KEY DEFINITION',
];

/** One effective-permission answer. */
export interface EffectivePermission {
  permission: string;
  held: boolean;
}

/** One permission the catalogue records against the principal directly. */
export interface RecordedPermission {
  class: string;
  object: string;
  permission: string;
  state: string;
}

export interface PrincipalAuthorityReport {
  /** Every database role the principal belongs to. */
  roles: string[];
  /** Those of them that are broad — must be empty. */
  broadRoles: string[];
  /** Effective database-scope answers for `BROAD_DATABASE_PERMISSIONS`. */
  databasePermissions: EffectivePermission[];
  /** Effective `dbo`-schema answers for `BROAD_SCHEMA_PERMISSIONS`. */
  schemaPermissions: EffectivePermission[];
}

function quoteLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

/**
 * Reads what the CURRENT session's principal can actually do.
 *
 * Must be called on a session opened AS the runtime principal:
 * `HAS_PERMS_BY_NAME` answers for whoever is asking, which is the entire point
 * — an administrative session would report the administrator's authority and
 * the proof would be of nothing.
 */
export async function inspectPrincipalAuthority(
  app: SqlSession,
): Promise<PrincipalAuthorityReport> {
  const roleRows = await app.query<{ role: string }>(`
    SELECT r.name AS role
    FROM sys.database_role_members m
    JOIN sys.database_principals r ON r.principal_id = m.role_principal_id
    JOIN sys.database_principals u ON u.principal_id = m.member_principal_id
    WHERE u.name = USER_NAME()
    ORDER BY r.name;
  `);
  const roles = roleRows.map((row) => row.role);

  // `IS_ROLEMEMBER` is asked as well as reading the membership table: it
  // resolves nested role membership, which a single join does not.
  const nestedRows = await app.query<{ role: string; member: number | null }>(
    BROAD_DATABASE_ROLES.map(
      (role) =>
        `SELECT N'${quoteLiteral(role)}' AS role, IS_ROLEMEMBER(N'${quoteLiteral(role)}') AS member`,
    ).join('\nUNION ALL\n') + ';',
  );

  if (nestedRows.length !== BROAD_DATABASE_ROLES.length) {
    throw new Error(
      `Expected ${BROAD_DATABASE_ROLES.length} role-membership answers, received ` +
        `${nestedRows.length}.`,
    );
  }
  const unansweredRoles = nestedRows
    .filter((row) => row.member !== 0 && row.member !== 1)
    .map((row) => row.role);
  if (unansweredRoles.length > 0) {
    throw new Error(
      `IS_ROLEMEMBER returned no valid answer for: ${unansweredRoles.join(', ')}. ` +
        `An unanswered role probe is not evidence that membership is absent.`,
    );
  }

  const broadRoles = [
    ...new Set([
      ...roles.filter((role) => BROAD_DATABASE_ROLES.includes(role)),
      ...nestedRows.filter((row) => row.member === 1).map((row) => row.role),
    ]),
  ].sort();

  const databasePermissions = await effectivePermissions(
    app,
    BROAD_DATABASE_PERMISSIONS,
    // The database is named explicitly. `HAS_PERMS_BY_NAME(NULL, NULL, ...)`
    // asks at SERVER scope, where these permission names do not exist — it
    // answers NULL, which this module refuses to read as "not held".
    (permission) =>
      `HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'${quoteLiteral(permission)}')`,
  );

  const schemaPermissions = await effectivePermissions(
    app,
    BROAD_SCHEMA_PERMISSIONS,
    (permission) =>
      `HAS_PERMS_BY_NAME(N'dbo', N'SCHEMA', N'${quoteLiteral(permission)}')`,
  );

  return { roles, broadRoles, databasePermissions, schemaPermissions };
}

async function effectivePermissions(
  app: SqlSession,
  permissions: readonly string[],
  probe: (permission: string) => string,
): Promise<EffectivePermission[]> {
  const rows = await app.query<{ permission: string; held: number | null }>(
    permissions
      .map(
        (permission) =>
          `SELECT N'${quoteLiteral(permission)}' AS permission, ${probe(permission)} AS held`,
      )
      .join('\nUNION ALL\n') + ';',
  );

  // A NULL answer means SQL Server did not recognise the permission name for
  // that class. Reported as "not held" would be a fail-open reading of an
  // inconclusive probe, so it fails instead.
  const unanswered = rows
    .filter((row) => row.held !== 0 && row.held !== 1)
    .map((row) => row.permission);
  if (unanswered.length > 0) {
    throw new Error(
      `HAS_PERMS_BY_NAME returned no answer for: ${unanswered.join(', ')}. ` +
        `An unanswered permission probe is not evidence that the permission is absent.`,
    );
  }
  if (rows.length !== permissions.length) {
    throw new Error(
      `Expected ${permissions.length} permission answers, received ${rows.length}.`,
    );
  }

  return rows.map((row) => ({
    permission: row.permission,
    held: row.held === 1,
  }));
}

/**
 * The permissions the catalogue records against the principal, read with
 * ADMINISTRATIVE authority.
 *
 * `HAS_PERMS_BY_NAME` above answers "can it?"; this answers "what was written
 * down?". Both are needed: the first catches authority arriving through a role,
 * the second catches a direct database- or schema-level GRANT that a DENY
 * elsewhere currently happens to mask.
 */
export async function recordedPermissions(
  admin: SqlSession,
  login: string,
): Promise<RecordedPermission[]> {
  assertLoginIdentifier(login);

  const rows = await admin.query<{
    class: string;
    object: string | null;
    permission: string;
    state: string;
  }>(`
    SELECT
      p.class_desc                                   AS [class],
      CASE p.class
        WHEN 0 THEN N'(database)'
        WHEN 1 THEN QUOTENAME(OBJECT_SCHEMA_NAME(p.major_id)) + N'.' +
                    QUOTENAME(OBJECT_NAME(p.major_id))
        WHEN 3 THEN SCHEMA_NAME(p.major_id)
        ELSE CAST(p.major_id AS nvarchar(32))
      END                                            AS [object],
      p.permission_name                              AS [permission],
      p.state_desc                                   AS [state]
    FROM sys.database_permissions p
    JOIN sys.database_principals u
      ON u.principal_id = p.grantee_principal_id
    WHERE u.name = N'${quoteLiteral(login)}'
    ORDER BY p.class, p.permission_name;
  `);

  return rows.map((row) => ({
    class: row.class,
    object: row.object ?? '(unknown)',
    permission: row.permission,
    state: row.state,
  }));
}

/**
 * THE complete inventory of object rights the runtime principal may hold.
 *
 * Exhaustive and per verb, mirroring `sql/permissions/grant-application-principal.sql`
 * exactly. Anything recorded against the principal that is not listed here is a
 * finding — which is the point: this catches a right added directly in the
 * database, or added to the grant script without anybody deciding it was
 * needed.
 *
 * Two shapes of DELETE are visible here, and the difference is deliberate:
 *
 *   - `Session`, `Account`, `Verification` and `RateLimitCounter` MUST be
 *     deletable. Revoking a session, unlinking an authentication method,
 *     consuming a single-use token and expiring a rate-limit window are all
 *     deletions; without the right, each of those controls stops working.
 *   - `User`, `AuditLog`, `IdentityCommunicationIntent`,
 *     `IdentitySecurityOperation`, `EmailDelivery`, `EmailSuppression` and
 *     `ProviderEvent` must NOT be. Each is evidence —
 *     of who existed, what happened, what was owed, what was refused and what
 *     was already processed — and evidence the runtime can delete is evidence
 *     an attacker with the runtime's authority can delete.
 */
const ALLOWED_OBJECT_GRANTS: Readonly<Record<string, readonly string[]>> = {
  // Phase 1 — append-oriented audit (SECURITY_BASELINE.md §13.1).
  '[dbo].[auditlog]': ['INSERT', 'SELECT'],

  // Phase 2 Chunk 1 — Identity & Access.
  '[dbo].[user]': ['SELECT', 'INSERT', 'UPDATE'],
  '[dbo].[session]': ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  '[dbo].[account]': ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  '[dbo].[verification]': ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  '[dbo].[identitycommunicationintent]': ['SELECT', 'INSERT', 'UPDATE'],
  '[dbo].[identitysecurityoperation]': ['SELECT', 'INSERT', 'UPDATE'],

  // Phase 2 Chunk 2 — authorisation, step-up and privileged second factor.
  //
  // `permission` and `identitybootstrap` are SELECT-only: one is an immutable
  // catalogue and the other is the record that the one-time bootstrap has
  // happened. A runtime that could write either could invent a capability or
  // erase the fact that the first administrator was provisioned.
  //
  // `role`, `roleassignment` and `privilegedsecurityposture` carry no DELETE:
  // each is privilege HISTORY, and history the runtime can delete is history an
  // attacker with the runtime's authority can delete.
  //
  // `rolepermission` and `stepupgrant` do, because for them a delete is the
  // operation rather than an erasure — removing a permission from a bundle, and
  // revoking an elevation.
  '[dbo].[permission]': ['SELECT'],
  '[dbo].[role]': ['SELECT', 'INSERT', 'UPDATE'],
  '[dbo].[rolepermission]': ['SELECT', 'INSERT', 'DELETE'],
  '[dbo].[roleassignment]': ['SELECT', 'INSERT', 'UPDATE'],
  '[dbo].[stepupgrant]': ['SELECT', 'INSERT', 'DELETE'],
  '[dbo].[twofactor]': ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  '[dbo].[privilegedsecurityposture]': ['SELECT', 'INSERT', 'UPDATE'],
  '[dbo].[identitybootstrap]': ['SELECT'],

  // Phase 2 Chunk 1 — Layer-0 platform concerns.
  '[dbo].[emaildelivery]': ['SELECT', 'INSERT', 'UPDATE'],
  '[dbo].[emailsuppression]': ['SELECT', 'INSERT'],
  '[dbo].[providerevent]': ['SELECT', 'INSERT', 'UPDATE'],
  '[dbo].[ratelimitcounter]': ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],

  // Phase 3B - Taxonomy.
  //
  // NO DELETE ON `topic`, `language` OR `tag`, and that is the phase's central
  // integrity claim rather than a preference. A later context's typed topic
  // assignment will carry a real foreign key to a `topic`; a runtime that could
  // delete the row could either orphan that assignment or be blocked by it at
  // an arbitrary moment. Archive and retire are the lifecycles, exactly as
  // `role` is soft-deactivated.
  //
  // `topictranslation` is the one exception, and a bounded one: removing a
  // locale's name is a real administrative act - an Urdu name entered in error
  // has to be removable - and the FALLBACK row is still not removable, because
  // the `TaxonomyTopicFallback` trigger refuses any delete that would leave a
  // topic without it.
  '[dbo].[topic]': ['SELECT', 'INSERT', 'UPDATE'],
  '[dbo].[topictranslation]': ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  '[dbo].[language]': ['SELECT', 'INSERT', 'UPDATE'],
  '[dbo].[tag]': ['SELECT', 'INSERT', 'UPDATE'],

  // Phase 5 - People & Contributors.
  //
  // NO DELETE ON `person` OR ON ANY OF THE FOUR PROFILE AGGREGATES, for the
  // reason the taxonomy has none: a later content context's contributor
  // reference will carry a real foreign key to one of them, and a runtime that
  // could delete the row could either orphan that attribution or be blocked by
  // it at an arbitrary moment. Archive is the lifecycle.
  //
  // `person` additionally carries a COLUMN-level DENY on `slug`, which this
  // inventory cannot express because it is recorded against the column rather
  // than the object. The probe suite proves it directly.
  //
  // The CHILD rows are deletable, and the asymmetry is deliberate: removing a
  // locale's entry entered in error is a real administrative act, and blanking
  // it to an empty string would be a translation that exists and says nothing.
  // The primary-locale entry is still not removable, because the
  // `PeoplePersonPrimaryName` trigger refuses any delete that would leave a
  // contributor without one.
  //
  // Direct INSERT on `person` and `personnamevariant` is absent too. Their
  // narrow procedures are the only runtime creation paths: one atomically
  // creates the primary translation, and one serialises the per-locale variant
  // count before inserting. Both procedures use ownership chaining and expose
  // only EXECUTE, not broader table authority.
  //
  // The two language tables are SETS - a language is listed or it is not - so
  // they take INSERT and DELETE and no UPDATE, exactly as `rolepermission`
  // does.
  '[dbo].[peoplecreateperson]': ['EXECUTE'],
  '[dbo].[peopleaddnamevariant]': ['EXECUTE'],
  '[dbo].[person]': ['SELECT', 'UPDATE'],
  '[dbo].[persontranslation]': ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  '[dbo].[personnamevariant]': ['SELECT', 'DELETE'],
  '[dbo].[authorprofile]': ['SELECT', 'INSERT', 'UPDATE'],
  '[dbo].[speakerprofile]': ['SELECT', 'INSERT', 'UPDATE'],
  '[dbo].[scholarprofile]': ['SELECT', 'INSERT', 'UPDATE'],
  '[dbo].[scholarprofiletranslation]': ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  '[dbo].[scholarprofilelanguage]': ['SELECT', 'INSERT', 'DELETE'],
  '[dbo].[teacherprofile]': ['SELECT', 'INSERT', 'UPDATE'],
  '[dbo].[teacherprofiletranslation]': ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  '[dbo].[teacherprofilelanguage]': ['SELECT', 'INSERT', 'DELETE'],
};

/**
 * Recorded GRANTs broader than the runtime principal is meant to hold —
 * database scope, schema scope, an object nothing grants on, or a verb beyond
 * what that object's row in `ALLOWED_OBJECT_GRANTS` permits.
 *
 * DENY rows are never findings: the grant script writes many deliberately.
 */
export function overreachingGrants(
  recorded: readonly RecordedPermission[],
): RecordedPermission[] {
  return recorded.filter((entry) => {
    if (entry.state !== 'GRANT' && entry.state !== 'GRANT_WITH_GRANT_OPTION')
      return false;

    if (entry.class === 'DATABASE') {
      return !ALLOWED_DATABASE_SCOPE_GRANTS.includes(entry.permission);
    }

    // A schema-level grant silently extends to every table a later phase adds,
    // so it is never permitted regardless of the right.
    if (entry.class === 'SCHEMA') return true;

    const permitted = ALLOWED_OBJECT_GRANTS[entry.object.toLowerCase()];
    return permitted === undefined || !permitted.includes(entry.permission);
  });
}

/** The inventory, for tests that assert it matches the grant script. */
export const allowedObjectGrants = ALLOWED_OBJECT_GRANTS;

function assertLoginIdentifier(login: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_]{2,63}$/.test(login)) {
    throw new Error(`Invalid application login name '${login}'.`);
  }
}

/**
 * A table the runtime principal is granted NOTHING on.
 *
 * ## Why an extra object is needed
 *
 * Every Phase 1 object already carries an explicit rule, so a passing check
 * against one of them cannot distinguish "the rule works" from "the rule is
 * masking a broad grant underneath". `db_datareader` plus the script's DENY on
 * AuditLog produces exactly the results the old proof expected.
 *
 * A table with no rule at all has no such cover: if SELECT succeeds on it, the
 * authority came from somewhere broad, and there is nowhere else it could have
 * come from.
 *
 * It lives ONLY inside the disposable permission-proof database and dies with
 * it. It is deliberately NOT a migration: no Phase 1 schema changes to make a
 * test possible.
 */
export const SENTINEL_TABLE = 'Phase1UngrantedSentinel';

export interface SentinelProof {
  objectId: number;
  rowCount: number;
}

/**
 * Creates the sentinel and PROVES it exists, through the administrative session.
 *
 * SQL Server answers "invalid object name" and "permission denied" with
 * different errors for a table that exists, but a caller cannot tell an absent
 * table from a hidden one by asking the denied principal. So existence is
 * established here, by the session that can see it, and the runtime principal's
 * failures below can then only mean permission.
 */
export async function createUngrantedSentinel(admin: SqlSession): Promise<SentinelProof> {
  await admin.query(`
    CREATE TABLE [dbo].[${SENTINEL_TABLE}] (
      [id] INT NOT NULL PRIMARY KEY,
      [marker] NVARCHAR(64) NOT NULL
    );
  `);
  await admin.query(`
    INSERT INTO [dbo].[${SENTINEL_TABLE}] ([id], [marker])
    VALUES (1, N'phase1-ungranted-sentinel');
  `);

  // `rowCount` is bracket-quoted: SQL Server reserves ROWCOUNT, and an
  // unquoted alias is a syntax error rather than a column.
  const [row] = await admin.query<{ objectId: number | null; rowCount: number }>(`
    SELECT
      OBJECT_ID(N'[dbo].[${SENTINEL_TABLE}]')                       AS [objectId],
      (SELECT COUNT_BIG(*) FROM [dbo].[${SENTINEL_TABLE}])          AS [rowCount];
  `);

  if (row?.objectId == null) {
    throw new Error(
      `The ungranted sentinel table was not created; a denial on a table that ` +
        `does not exist would prove nothing.`,
    );
  }
  if (Number(row.rowCount) !== 1) {
    throw new Error(
      `The ungranted sentinel table holds ${row.rowCount} row(s); expected exactly 1.`,
    );
  }

  return { objectId: Number(row.objectId), rowCount: Number(row.rowCount) };
}

/** Statements the runtime principal must be refused on the sentinel. */
export const SENTINEL_PROHIBITIONS: readonly [string, string][] = [
  ['SELECT', `SELECT [id] FROM [dbo].[${SENTINEL_TABLE}];`],
  [
    'INSERT',
    `INSERT INTO [dbo].[${SENTINEL_TABLE}] ([id], [marker]) VALUES (2, N'injected');`,
  ],
  ['UPDATE', `UPDATE [dbo].[${SENTINEL_TABLE}] SET [marker] = N'tampered';`],
  ['DELETE', `DELETE FROM [dbo].[${SENTINEL_TABLE}];`],
];

/**
 * Confirms the sentinel survived every refused attempt, with its row intact.
 *
 * A denial that nevertheless changed data would be a far worse finding than a
 * missing denial, so it is checked rather than assumed.
 */
export async function assertSentinelIntact(admin: SqlSession): Promise<void> {
  const [row] = await admin.query<{ total: number; marker: string | null }>(`
    SELECT COUNT_BIG(*) AS total, MIN([marker]) AS marker
    FROM [dbo].[${SENTINEL_TABLE}];
  `);

  if (Number(row?.total ?? 0) !== 1 || row?.marker !== 'phase1-ungranted-sentinel') {
    throw new Error(
      `The ungranted sentinel changed during the permission proof: ` +
        `${row?.total ?? 0} row(s), marker '${row?.marker ?? ''}'.`,
    );
  }
}
