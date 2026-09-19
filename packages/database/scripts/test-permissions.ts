import 'server-only';

import { getApplicationPrincipalCredentials } from '../src/config.ts';
import { provisionApplicationPrincipal } from '../src/lifecycle/application-principal.ts';
import {
  createDisposableDatabase,
  dropDisposableDatabase,
  newDisposableDatabaseName,
  openMasterSession,
} from '../src/lifecycle/disposable-database.ts';
import { deployMigrations, loadMigrations } from '../src/lifecycle/migrations.ts';
import {
  allowedObjectGrants,
  assertSentinelIntact,
  createUngrantedSentinel,
  inspectPrincipalAuthority,
  overreachingGrants,
  recordedPermissions,
  SENTINEL_PROHIBITIONS,
  SENTINEL_TABLE,
} from '../src/lifecycle/principal-authority.ts';
import {
  openSession,
  withDatabase,
  type SqlSession,
} from '../src/lifecycle/sql-connection.ts';
import {
  reportConfiguration,
  retargetAtDisposable,
  startLocalCommand,
} from './local-bootstrap.ts';

/**
 * `npm run db:test:permissions` — proves the least-privilege boundary using the
 * ACTUAL application principal, against a disposable database.
 *
 * The negative cases matter only if they fail for the RIGHT reason. SQL Server
 * raises 229 (`permission was denied`) and 262 (`permission denied in
 * database`) for a refused right; a typo, a missing table or a bad password
 * produces a different number. Every prohibition below asserts the error
 * number, so a test cannot pass because the statement was broken.
 */

/**
 * Error numbers SQL Server raises when it refuses a statement for permissions.
 *
 * 229/230 (`permission was denied on object`) and 262 (`permission denied in
 * database`) are the direct refusals. 1088 and 3701 are the DDL refusals, and
 * they read as "does not exist OR you do not have permission" — SQL Server
 * deliberately conflates the two so a denied caller cannot probe the schema.
 *
 * That conflation is precisely why a passing DDL case is not self-evidently
 * meaningful: the same error appears for a table that was never created. Each
 * DDL prohibition is therefore paired with `assertObjectVisible`, which proves
 * through this same connection that the principal CAN see and read the object.
 * Denial plus visibility is a permission boundary; denial alone is not.
 */
const PERMISSION_DENIED = new Set([229, 230, 262, 1088, 3701]);

interface SqlError extends Error {
  number?: number;
}

function errorNumber(error: unknown): number | undefined {
  return (error as SqlError | undefined)?.number;
}

let failures = 0;

function pass(label: string, detail: string): void {
  process.stdout.write(`  PASS  ${label.padEnd(38)} ${detail}\n`);
}

function fail(label: string, detail: string): void {
  failures += 1;
  process.stdout.write(`  FAIL  ${label.padEnd(38)} ${detail}\n`);
}

/** Asserts a statement is refused BY THE PERMISSION SYSTEM, not by anything else. */
async function expectDenied(
  session: SqlSession,
  label: string,
  statement: string,
): Promise<void> {
  try {
    await session.query(statement);
  } catch (error) {
    const number = errorNumber(error);
    if (number !== undefined && PERMISSION_DENIED.has(number)) {
      pass(label, `denied, SQL Server error ${number}`);
      return;
    }
    fail(
      label,
      `rejected for the WRONG reason (error ${number ?? 'unknown'}): ` +
        `${(error as Error).message.split('\n')[0]}`,
    );
    return;
  }
  fail(label, 'statement SUCCEEDED but must be denied');
}

/**
 * Proves the principal can resolve and read the object, so a later "does not
 * exist or you do not have permission" on it can only mean the second.
 */
async function assertObjectVisible(session: SqlSession, table: string): Promise<void> {
  const [row] = await session.query<{ objectId: number | null }>(
    `SELECT OBJECT_ID(N'[dbo].[${table}]') AS objectId;`,
  );
  if (row?.objectId == null) {
    fail(
      `${table} is visible to the principal`,
      'OBJECT_ID is NULL — a DDL denial on it would be ambiguous',
    );
    return;
  }
  await session.query(`SELECT TOP 0 * FROM [dbo].[${table}];`);
  pass(`${table} is visible to the principal`, `object_id ${row.objectId}, readable`);
}

/**
 * Asserts a statement is refused BY A DATA INVARIANT rather than by a grant.
 *
 * A SEPARATE HELPER FROM `expectDenied`, deliberately. That one proves the
 * PERMISSION system refused — one of a known set of access-denied error numbers
 * — and collapsing the two would let a trigger refusal satisfy a permission
 * assertion, or a permission denial satisfy an invariant one. They are
 * different guarantees and a suite that could not tell them apart would be
 * proving neither.
 *
 * The number is the migration's own `THROW`, so a refusal for any other reason
 * — including an access denial — fails.
 */
async function expectRefusedByInvariant(
  session: SqlSession,
  label: string,
  statement: string,
  expected: number,
): Promise<void> {
  try {
    await session.query(statement);
  } catch (error) {
    const number = errorNumber(error);
    const message = (error as Error).message;

    // `\\b` rather than `\b`: inside a template literal the single form is a
    // BACKSPACE character, not a word boundary, so the pattern would never
    // match and the assertion would fail for the wrong reason.
    if (number === expected || new RegExp(`\\b${expected}\\b`).test(message)) {
      pass(label, `refused by the invariant, SQL Server error ${expected}`);
      return;
    }
    fail(
      label,
      `rejected for the WRONG reason (error ${number ?? 'unknown'}): ` +
        `${message.split('\n')[0]}`,
    );
    return;
  }
  fail(label, 'statement SUCCEEDED but the invariant must refuse it');
}

async function expectAllowed(
  session: SqlSession,
  label: string,
  statement: string,
  detail: string,
): Promise<void> {
  try {
    await session.query(statement);
    pass(label, detail);
  } catch (error) {
    fail(
      label,
      `should be permitted but failed: ${(error as Error).message.split('\n')[0]}`,
    );
  }
}

// Resolves docker/.env as the sole authority and proves the approved local
// target before a disposable database is created.
const command = startLocalCommand('migration-target');
const migrationConnection = command.connection;
const environment = command.environment;
const principal = getApplicationPrincipalCredentials(environment.values);
const databaseName = newDisposableDatabaseName();

// Retarget the SAME encrypted migration configuration at the disposable
// database; only the database name differs, and the result is re-proven.
const { url: disposableUrl } = retargetAtDisposable(command, databaseName);

const master = await openMasterSession(migrationConnection);
let admin: SqlSession | undefined;
let app: SqlSession | undefined;

process.stdout.write(`Phase 1 permission proof on ${databaseName}\n`);

// Safe metadata only: never the password, never the whole URL.
reportConfiguration(command, 38);

try {
  // ---- a migrated database with the principal provisioned ------------------
  await createDisposableDatabase(master, databaseName);
  admin = await openSession(withDatabase(migrationConnection, databaseName));

  // Fails when a forward migration is missing its reviewed rollback.
  if ((await loadMigrations()).length === 0) {
    throw new Error('No migrations to test against.');
  }

  // The real Prisma CLI, over the same encrypted configuration the normal
  // migration path uses — never a direct replay of migration.sql.
  await deployMigrations(disposableUrl, environment.values);
  await provisionApplicationPrincipal(
    admin,
    principal.DATABASE_APP_LOGIN,
    principal.DATABASE_APP_PASSWORD,
  );

  // ---- an object nobody granted the runtime principal anything on ----------
  //
  // Created AFTER the grant script has run, so it cannot be caught by it, and
  // proven to exist by this administrative session — SQL Server answers "does
  // not exist" and "you may not see it" with the same silence to a denied
  // caller, so existence has to be established by someone who can see it.
  //
  // It lives only in this disposable database and dies with it. No Phase 1
  // migration is touched to make this proof possible.
  const sentinel = await createUngrantedSentinel(admin);
  pass(
    `${SENTINEL_TABLE} exists`,
    `object_id ${sentinel.objectId}, ${sentinel.rowCount} row, no grant to the principal`,
  );

  // Connect AS the application principal. Everything below is its authority.
  app = await openSession({
    ...withDatabase(migrationConnection, databaseName),
    user: principal.DATABASE_APP_LOGIN,
    password: principal.DATABASE_APP_PASSWORD,
  });

  // ---- identity ------------------------------------------------------------
  const [identity] = await app.query<{
    login: string;
    dbUser: string;
    isSysadmin: number;
    isDbOwnerRole: number;
    isDbOwnerUser: number;
  }>(`
    SELECT
      SUSER_SNAME()                                   AS login,
      USER_NAME()                                     AS dbUser,
      IS_SRVROLEMEMBER('sysadmin')                    AS isSysadmin,
      IS_ROLEMEMBER('db_owner')                       AS isDbOwnerRole,
      CASE WHEN EXISTS (
        SELECT 1 FROM sys.databases d
        WHERE d.name = DB_NAME() AND d.owner_sid = SUSER_SID()
      ) THEN 1 ELSE 0 END                             AS isDbOwnerUser;
  `);

  if (identity === undefined) {
    fail('principal identity', 'no identity row returned');
  } else {
    if (identity.login.toLowerCase() === 'sa') {
      fail('principal is not sa', `connected as ${identity.login}`);
    } else {
      pass('principal is not sa', `connected as ${identity.login}`);
    }

    if (Number(identity.isSysadmin) !== 0) {
      fail('principal is not sysadmin', 'IS_SRVROLEMEMBER(sysadmin) = 1');
    } else {
      pass('principal is not sysadmin', 'IS_SRVROLEMEMBER(sysadmin) = 0');
    }

    if (Number(identity.isDbOwnerRole) !== 0) {
      fail('principal is not db_owner', 'IS_ROLEMEMBER(db_owner) = 1');
    } else {
      pass('principal is not db_owner', 'IS_ROLEMEMBER(db_owner) = 0');
    }

    if (Number(identity.isDbOwnerUser) !== 0) {
      fail('principal does not own the DB', 'owner_sid matches the runtime login');
    } else {
      pass('principal does not own the DB', 'database owner_sid differs');
    }
  }

  // ---- EFFECTIVE authority -------------------------------------------------
  //
  // Role membership and permission text are the design; this is what the
  // principal can actually do. `HAS_PERMS_BY_NAME` answers for the CURRENT
  // login and already accounts for role inheritance, ownership and DENY — the
  // three routes by which authority arrives without appearing in the grant
  // script.
  //
  // The old check looked only for four administrative roles, so
  // `db_datareader` and `db_datawriter` — the two that grant read and write
  // across EVERY table — passed it, while the AuditLog assertions below stayed
  // green because AuditLog has its own explicit rules.
  const authority = await inspectPrincipalAuthority(app);

  if (authority.broadRoles.length > 0) {
    fail('no broad database roles', `member of ${authority.broadRoles.join(', ')}`);
  } else {
    pass(
      'no broad database roles',
      `roles: ${authority.roles.join(', ') || '(none)'}; db_datareader/db_datawriter ` +
        `and the administrative roles all absent`,
    );
  }

  const heldDatabase = authority.databasePermissions
    .filter((entry) => entry.held)
    .map((entry) => entry.permission);
  if (heldDatabase.length > 0) {
    fail('no broad database-scope rights', `effective: ${heldDatabase.join(', ')}`);
  } else {
    pass(
      'no broad database-scope rights',
      `${authority.databasePermissions.length} probes, none effective`,
    );
  }

  const heldSchema = authority.schemaPermissions
    .filter((entry) => entry.held)
    .map((entry) => entry.permission);
  if (heldSchema.length > 0) {
    fail('no broad dbo-schema rights', `effective: ${heldSchema.join(', ')}`);
  } else {
    pass(
      'no broad dbo-schema rights',
      `${authority.schemaPermissions.length} probes, none effective`,
    );
  }

  // ---- permitted runtime operation ----------------------------------------
  await expectAllowed(
    app,
    'audit INSERT succeeds',
    `INSERT INTO [dbo].[AuditLog]
       ([id], [actorType], [action], [targetType], [targetId], [authorisingSource], [ipAddress])
     VALUES
       (NEWID(), N'system', N'phase1.permission.probe', N'Database', N'${databaseName}',
        N'db:test:permissions', N'127.0.0.1');`,
    'row inserted by the runtime principal',
  );

  // THE PROBE ROW, not the whole table. A freshly migrated database is no
  // longer empty of audit rows: the Phase-3B migration records the privilege
  // change it makes when it extends the protected administrator bundle, which
  // is exactly the kind of event the audit log exists for. Counting every row
  // would make this check about how many migrations have shipped rather than
  // about whether the runtime principal may write and read one.
  const [inserted] = await app.query<{ total: number }>(
    `SELECT COUNT_BIG(*) AS total FROM [dbo].[AuditLog]
     WHERE [action] = N'phase1.permission.probe';`,
  );
  if (Number(inserted?.total ?? 0) !== 1) {
    fail('audit row is readable', `expected 1 probe row, found ${inserted?.total ?? 0}`);
  } else {
    pass('audit row is readable', 'the probe row is visible to the runtime principal');
  }

  // ---- prohibited audit mutation ------------------------------------------
  await expectDenied(
    app,
    'audit UPDATE denied',
    `UPDATE [dbo].[AuditLog] SET [action] = N'tampered';`,
  );
  await expectDenied(app, 'audit DELETE denied', 'DELETE FROM [dbo].[AuditLog];');

  // ---- prohibited DDL ------------------------------------------------------
  //
  // Established first: the DDL refusals below name the object as possibly
  // missing, so the proof that it is present and readable is what turns those
  // refusals into evidence of a permission boundary.
  await assertObjectVisible(app, 'AuditLog');

  // TRUNCATE is a DDL-permission operation (it needs ALTER), not a DELETE, so
  // it is proven here rather than beside the DML cases.
  await expectDenied(app, 'audit TRUNCATE denied', 'TRUNCATE TABLE [dbo].[AuditLog];');
  await expectDenied(
    app,
    'CREATE TABLE denied',
    'CREATE TABLE [dbo].[RuntimeShouldNotCreateThis] ([id] INT NOT NULL);',
  );
  await expectDenied(
    app,
    'ALTER TABLE denied',
    'ALTER TABLE [dbo].[AuditLog] ADD [injectedColumn] NVARCHAR(16) NULL;',
  );
  await expectDenied(app, 'DROP TABLE denied', 'DROP TABLE [dbo].[AuditLog];');
  await expectDenied(
    app,
    'migration history is not readable',
    'SELECT TOP 1 [migration_name] FROM [dbo].[_prisma_migrations];',
  );

  // ---- Phase 3B: the taxonomy is administrable but not destructible --------
  //
  // The runtime genuinely administers this data, so the permitted operations
  // are proven to WORK rather than merely being listed. What it must not be
  // able to do is remove a row: a later context's typed topic assignment will
  // hold a real foreign key to a `Topic`, and "deleting a topic cannot orphan
  // an assignment" is enforced by the absence of the right rather than by an
  // application check somebody could forget.
  await expectAllowed(
    app,
    'topic INSERT succeeds',
    `INSERT INTO [dbo].[Topic] ([id], [slug], [parentId], [position], [status], [system])
     VALUES (NEWID(), N'permission-probe-topic', NULL, 990, N'active', 0);`,
    'the runtime may create a topic',
  );
  // The translation too, in the same shape the adapter writes it: a topic
  // without its fallback name is a topic that renders as nothing, and a probe
  // that left one behind would be modelling the state the application never
  // produces.
  await expectAllowed(
    app,
    'topic translation INSERT succeeds',
    `INSERT INTO [dbo].[TopicTranslation] ([topicId], [locale], [name])
     SELECT [id], N'en', N'Permission probe topic' FROM [dbo].[Topic]
     WHERE [slug] = N'permission-probe-topic';`,
    'the runtime may name a topic in the fallback locale',
  );

  await expectAllowed(
    app,
    'topic UPDATE succeeds',
    `UPDATE [dbo].[Topic] SET [status] = N'archived'
     WHERE [slug] = N'permission-probe-topic';`,
    'the runtime may archive a topic',
  );

  await expectDenied(
    app,
    'topic slug UPDATE denied',
    `UPDATE [dbo].[Topic] SET [slug] = N'permission-probe-topic-renamed'
     WHERE [slug] = N'permission-probe-topic';`,
  );

  const [stableSlug] = await admin.query<{ total: number }>(
    `SELECT COUNT_BIG(*) AS total FROM [dbo].[Topic]
     WHERE [slug] = N'permission-probe-topic';`,
  );
  if (Number(stableSlug?.total ?? 0) !== 1) {
    fail('topic slug remains stable', 'the runtime-principal rename attempt changed it');
  } else {
    pass('topic slug remains stable', 'the create-time slug is unchanged');
  }

  await expectDenied(app, 'topic DELETE denied', 'DELETE FROM [dbo].[Topic];');

  // The FALLBACK translation is protected by the trigger rather than by the
  // grant — the runtime legitimately holds DELETE on this table, because
  // removing a locale's name is a real administrative act. What it may not do
  // is leave a topic with no name at all, and that refusal has to hold for a
  // caller that never touches the adapter.
  await expectRefusedByInvariant(
    app,
    'fallback translation DELETE refused by the invariant',
    `DELETE FROM [dbo].[TopicTranslation] WHERE [locale] = N'en';`,
    51033,
  );
  await expectDenied(app, 'language DELETE denied', 'DELETE FROM [dbo].[Language];');
  await expectDenied(app, 'tag DELETE denied', 'DELETE FROM [dbo].[Tag];');

  // The canonical seed is still exactly what the migration wrote, after the
  // runtime has had its turn. A probe that archived a seeded topic, or removed
  // one, would show up here rather than in a later phase.
  const [seeded] = await admin.query<{ total: number; archived: number }>(`
    SELECT COUNT_BIG(*) AS total,
           SUM(CASE WHEN [status] <> N'active' THEN 1 ELSE 0 END) AS archived
    FROM [dbo].[Topic] WHERE [system] = 1;
  `);
  if (Number(seeded?.total ?? 0) !== 19 || Number(seeded?.archived ?? -1) !== 0) {
    fail(
      'canonical topics intact',
      `expected 19 active canonical topics, found ${seeded?.total ?? 0} with ` +
        `${seeded?.archived ?? 0} archived`,
    );
  } else {
    pass('canonical topics intact', '19 seeded topics, all active');
  }

  // ---- Phase 5: contributors are administrable but not destructible --------
  //
  // THE SAME POSTURE AS THE TAXONOMY, AND FOR A SHARPER REASON. A later content
  // context's contributor reference will hold a real foreign key to `Person` or
  // to one of the four profile aggregates, so "removing a contributor cannot
  // orphan an attribution" is enforced by the ABSENCE of DELETE rather than by
  // an application check somebody could forget.
  //
  // The permitted operations are proven to WORK rather than merely listed: a
  // suite that only asserted denials would pass just as well against a
  // principal that had been granted nothing at all.
  await expectDenied(
    app,
    'direct person INSERT denied',
    `INSERT INTO [dbo].[Person] ([id], [slug], [primaryLocale], [status])
     VALUES (N'permission-probe-person', N'permission-probe-person', N'en', N'draft');`,
  );

  // The one admitted creation capability creates the parent and its primary
  // translation atomically. Direct INSERT is denied above so no runtime SQL
  // path can commit the parent-only state.
  await expectAllowed(
    app,
    'atomic person creation procedure succeeds',
    `EXEC [dbo].[PeopleCreatePerson]
       @id=N'permission-probe-person',
       @slug=N'permission-probe-person',
       @primaryLocale=N'en',
       @name=N'Permission probe contributor',
       @biography=NULL,
       @at='2026-09-19T00:00:00Z';`,
    'the runtime may create a contributor only with its primary translation',
  );

  await expectAllowed(
    app,
    'person UPDATE succeeds',
    `UPDATE [dbo].[Person] SET [status] = N'published'
     WHERE [id] = N'permission-probe-person';`,
    'the runtime may publish and archive a contributor',
  );

  // THE SLUG IS IMMUTABLE AT THE GRANT, not merely in the service.
  // DOMAIN_MODEL.md §19.7 permits an editable canonical slug only alongside
  // native slug history and automatic 301s, and Phase 5 ships neither — so the
  // column-level DENY is what makes "the public URL is stable" true for a
  // caller holding the runtime principal and bypassing the adapter entirely.
  await expectDenied(
    app,
    'person slug UPDATE denied',
    `UPDATE [dbo].[Person] SET [slug] = N'permission-probe-person-renamed'
     WHERE [id] = N'permission-probe-person';`,
  );

  const [stablePersonSlug] = await admin.query<{ total: number }>(
    `SELECT COUNT_BIG(*) AS total FROM [dbo].[Person]
     WHERE [slug] = N'permission-probe-person';`,
  );
  if (Number(stablePersonSlug?.total ?? 0) !== 1) {
    fail('person slug remains stable', 'the runtime-principal rename attempt changed it');
  } else {
    pass('person slug remains stable', 'the create-time slug is unchanged');
  }

  await expectDenied(app, 'person DELETE denied', 'DELETE FROM [dbo].[Person];');

  // The PRIMARY-LOCALE translation is protected by the trigger rather than by
  // the grant — the runtime legitimately holds DELETE on this table, because
  // removing a locale's entry is a real administrative act. What it may not do
  // is leave a contributor with no entry in their own original language, and
  // that refusal has to hold for a caller that never touches the adapter.
  await expectRefusedByInvariant(
    app,
    'primary translation DELETE refused by the invariant',
    `DELETE FROM [dbo].[PersonTranslation]
     WHERE [personId] = N'permission-probe-person' AND [locale] = N'en';`,
    51040,
  );

  // The parent side is guarded too: moving primaryLocale to a translation that
  // does not exist is the same invalid state reached from the other direction.
  await expectRefusedByInvariant(
    app,
    'missing primaryLocale UPDATE refused by the invariant',
    `UPDATE [dbo].[Person] SET [primaryLocale] = N'ur'
     WHERE [id] = N'permission-probe-person';`,
    51040,
  );

  // Direct INSERT is denied because only the procedure can acquire the
  // per-Person/locale lock before counting. The procedure remains an ordinary
  // runtime capability; variants are still added and removed, never edited.
  await expectDenied(
    app,
    'direct name variant INSERT denied',
    `INSERT INTO [dbo].[PersonNameVariant] ([id], [personId], [locale], [value], [normalised])
     VALUES (NEWID(), N'permission-probe-person', N'en', N'Probe Variant', N'probe variant');`,
  );
  await expectAllowed(
    app,
    'serialised name variant procedure succeeds',
    `EXEC [dbo].[PeopleAddNameVariant]
       @id=N'permission-probe-variant',
       @personId=N'permission-probe-person',
       @locale=N'en',
       @value=N'Probe Variant',
       @normalised=N'probe variant',
       @at='2026-09-19T00:00:00Z';`,
    'the runtime may record an alternative spelling',
  );
  await expectDenied(
    app,
    'name variant UPDATE denied',
    `UPDATE [dbo].[PersonNameVariant] SET [value] = N'Edited'
     WHERE [personId] = N'permission-probe-person';`,
  );

  // The four profile aggregates, each proven separately. One loop over a list
  // would have been shorter and would have proven one table four times if a
  // later change collapsed them; naming them is what keeps the claim about
  // FOUR distinct aggregates (DOMAIN_MODEL.md §5.2).
  for (const table of [
    'AuthorProfile',
    'SpeakerProfile',
    'ScholarProfile',
    'TeacherProfile',
  ]) {
    await expectAllowed(
      app,
      `${table} INSERT succeeds`,
      `INSERT INTO [dbo].[${table}] ([id], [personId], [status])
       VALUES (NEWID(), N'permission-probe-person', N'draft');`,
      'the runtime may add this facet',
    );
    await expectAllowed(
      app,
      `${table} UPDATE succeeds`,
      `UPDATE [dbo].[${table}] SET [status] = N'archived'
       WHERE [personId] = N'permission-probe-person';`,
      'the runtime may archive this facet',
    );
    await expectDenied(app, `${table} DELETE denied`, `DELETE FROM [dbo].[${table}];`);
  }

  // A profile's language list is a SET: a language is listed or it is not, so
  // INSERT and DELETE are the operations and UPDATE is denied — there is no
  // third state for a composite-key membership row to be moved into.
  await expectAllowed(
    app,
    'profile language INSERT succeeds',
    `INSERT INTO [dbo].[TeacherProfileLanguage] ([teacherProfileId], [languageCode])
     SELECT [id], N'ur' FROM [dbo].[TeacherProfile]
     WHERE [personId] = N'permission-probe-person';`,
    'the runtime may list a teaching language',
  );
  await expectDenied(
    app,
    'profile language UPDATE denied',
    `UPDATE [dbo].[TeacherProfileLanguage] SET [languageCode] = N'ar';`,
  );
  await expectAllowed(
    app,
    'profile language DELETE succeeds',
    `DELETE FROM [dbo].[TeacherProfileLanguage];`,
    'the runtime may replace the whole set',
  );

  // NO CONTRIBUTOR RECORD MAY GRANT ANYTHING, proved at the grant level rather
  // than only in the service. Even holding the runtime principal and writing
  // SQL directly, a caller administering People cannot create an assignment:
  // `RoleAssignment` is INSERT-able by the runtime because Identity's own
  // privileged path needs it, so the claim worth proving here is the one the
  // application makes — no People statement above touched it.
  const [assignments] = await admin.query<{ total: number }>(
    `SELECT COUNT_BIG(*) AS total FROM [dbo].[RoleAssignment];`,
  );
  if (Number(assignments?.total ?? -1) !== 0) {
    fail(
      'contributor probes granted nothing',
      `the People probes left ${assignments?.total ?? 0} role assignments behind`,
    );
  } else {
    pass('contributor probes granted nothing', 'no role assignment exists');
  }

  // ---- the ungranted object ------------------------------------------------
  //
  // The sharpest of these cases. Every Phase 1 object carries an explicit rule,
  // so a denial on one of them cannot distinguish "the rule works" from "the
  // rule is masking a broad grant underneath": `db_datareader` plus the
  // script's DENY on AuditLog produces exactly the results every check above
  // expects. This table has no rule at all, so a SELECT that succeeds on it
  // could only have come from authority that should not exist.
  //
  // Its existence was established by the admin session, so "does not exist or
  // you do not have permission" here can only mean the second.
  for (const [label, statement] of SENTINEL_PROHIBITIONS) {
    await expectDenied(app, `ungranted ${label} denied`, statement);
  }

  // ---- the audit rows survived every attempt --------------------------------
  //
  // THREE SEPARATE FACTS, because the single row count used to stand in for all
  // of them and can no longer: the migration's own privilege-change record is a
  // legitimate second row.
  //
  //   - the probe row is still there, and still says what it said;
  //   - the UPDATE wrote nothing, so no row carries the tampered value;
  //   - the DELETE removed nothing, so every row that was there still is.
  const [survivor] = await admin.query<{
    total: number;
    probe: number;
    tampered: number;
    taxonomyProvisioned: number;
    navigationProvisioned: number;
    peopleProvisioned: number;
  }>(`
    SELECT COUNT_BIG(*) AS total,
           SUM(CASE WHEN [action] = N'phase1.permission.probe' THEN 1 ELSE 0 END) AS probe,
           SUM(CASE WHEN [action] = N'tampered' THEN 1 ELSE 0 END) AS tampered,
           SUM(CASE WHEN [action] = N'taxonomy.permissions.provisioned'
                     AND [actorType] = N'migration' THEN 1 ELSE 0 END)
             AS taxonomyProvisioned,
           SUM(CASE WHEN [action] = N'navigation.permissions.provisioned'
                     AND [actorType] = N'migration' THEN 1 ELSE 0 END)
             AS navigationProvisioned,
           SUM(CASE WHEN [action] = N'people.permissions.provisioned'
                     AND [actorType] = N'migration' THEN 1 ELSE 0 END)
             AS peopleProvisioned
    FROM [dbo].[AuditLog];
  `);

  // Exactly four rows: the Phase-3B, Phase-4 and Phase-5 privilege extensions,
  // and this run's probe. Naming every migration action is load-bearing:
  // deriving the expected total from whatever provisioning rows happened to
  // survive would pass if a phase omitted its own audit, and each privilege
  // extension must be able to show that it paid for itself
  // (SECURITY_BASELINE.md §8.1).
  const EXPECTED_AUDIT_ROWS = 4;

  if (
    Number(survivor?.taxonomyProvisioned ?? 0) !== 1 ||
    Number(survivor?.navigationProvisioned ?? 0) !== 1 ||
    Number(survivor?.peopleProvisioned ?? 0) !== 1 ||
    Number(survivor?.probe ?? 0) !== 1 ||
    Number(survivor?.tampered ?? -1) !== 0 ||
    Number(survivor?.total ?? 0) !== EXPECTED_AUDIT_ROWS
  ) {
    fail(
      'audit rows unmodified',
      `expected ${EXPECTED_AUDIT_ROWS} rows with 1 taxonomy provisioning, ` +
        `1 navigation provisioning, 1 people provisioning, 1 probe and ` +
        `0 tampered; found ${survivor?.total ?? 0} rows, ` +
        `${survivor?.taxonomyProvisioned ?? 0} taxonomy provisioning, ` +
        `${survivor?.navigationProvisioned ?? 0} navigation provisioning, ` +
        `${survivor?.peopleProvisioned ?? 0} people provisioning, ` +
        `${survivor?.probe ?? 0} probe, ${survivor?.tampered ?? 0} tampered`,
    );
  } else {
    pass(
      'audit rows unmodified',
      'the probe row and all three exact migration records are intact after ' +
        'UPDATE/DELETE attempts',
    );
  }

  // ---- the ungranted object was not merely unreadable, it is unchanged -----
  await assertSentinelIntact(admin);
  pass(`${SENTINEL_TABLE} unchanged`, 'one row, marker intact after four attempts');

  // ---- what the catalogue actually records ---------------------------------
  //
  // The probes above ask "can it?". This asks "what was written down?", with
  // administrative authority, and catches a direct database- or schema-level
  // GRANT that some DENY elsewhere currently happens to mask. Together they
  // close both routes; either alone leaves one open.
  const recorded = await recordedPermissions(admin, principal.DATABASE_APP_LOGIN);
  const overreaching = overreachingGrants(recorded);

  if (overreaching.length > 0) {
    fail(
      'no grant beyond the approved inventory',
      overreaching
        .map((entry) => `${entry.state} ${entry.permission} on ${entry.object}`)
        .join('; '),
    );
  } else {
    const objects = Object.keys(allowedObjectGrants).length;
    pass(
      'no grant beyond the approved inventory',
      `${recorded.length} recorded entries; object GRANTs confined to the ` +
        `${objects} approved objects, per verb`,
    );
  }

  // ---- migration authority is separate -------------------------------------
  const runtimeUrl = environment.values['DATABASE_URL'] ?? '';
  const runtimeUser = /(?:^|;)user=([^;]*)/i.exec(runtimeUrl)?.[1] ?? '';
  if (runtimeUser.toLowerCase() === 'sa' || runtimeUser === '') {
    fail(
      'runtime URL uses the app principal',
      `DATABASE_URL user is '${runtimeUser || '(absent)'}', not the least-privilege login`,
    );
  } else if (runtimeUser !== principal.DATABASE_APP_LOGIN) {
    fail(
      'runtime URL uses the app principal',
      `DATABASE_URL user is '${runtimeUser}', expected '${principal.DATABASE_APP_LOGIN}'`,
    );
  } else {
    pass('runtime URL uses the app principal', `user=${runtimeUser}`);
  }

  const migrationUser = migrationConnection.user;
  if (migrationUser === runtimeUser) {
    fail(
      'migration authority is separate',
      'DATABASE_MIGRATION_URL uses the same principal as the runtime',
    );
  } else {
    pass('migration authority is separate', `migration user differs from runtime user`);
  }
} finally {
  await app?.close();
  await admin?.close();
  await dropDisposableDatabase(master, databaseName);
  await master.close();
}

if (failures > 0) {
  process.stdout.write(`\n${failures} permission check(s) FAILED.\n`);
  process.exit(1);
}

process.stdout.write('\nLeast-privilege boundary verified against the live principal.\n');
