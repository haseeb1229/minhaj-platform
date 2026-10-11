import { randomUUID } from 'node:crypto';
import { newPhase5Fixture, writePhase5Fixture } from '../src/lifecycle/phase5-fixture.ts';
import {
  newPhase6Fixture,
  writePhase6Fixture,
  capturePhase6Fixture,
  verifyRestoredPhase6,
} from '../src/lifecycle/phase6-fixture.ts';
import {
  capturePhase13Fixture,
  newPhase13Fixture,
  PHASE13_FAMILIES,
  phase13Slugs,
  verifyRestoredPhase13,
  writePhase13Fixture,
} from '../src/lifecycle/phase13-fixture.ts';
import {
  capturePhase14Fixture,
  newPhase14Fixture,
  verifyRestoredPhase14,
  writePhase14Fixture,
} from '../src/lifecycle/phase14-fixture.ts';
import {
  capturePhase15Fixture,
  newPhase15Fixture,
  PHASE15_MEMBERS,
  verifyRestoredPhase15,
  writePhase15Fixture,
} from '../src/lifecycle/phase15-fixture.ts';
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

/**
 * Asserts a statement is refused by ONE NAMED schema constraint.
 *
 * A SIBLING OF `expectRefusedByInvariant`, stricter rather than looser. Every
 * foreign key and every CHECK in SQL Server raises the same 547, so the number
 * alone cannot tell a composite same-Country key from a plain parent key, or
 * one CHECK from another on the same table — and a proof meant for one would
 * pass on the other. This one requires an expected number AND the constraint's
 * own name in the engine's message, and fails on anything else, including an
 * access denial.
 */
async function expectRefusedByConstraint(
  session: SqlSession,
  label: string,
  statement: string,
  expected: ReadonlySet<number>,
  constraint: string,
): Promise<void> {
  try {
    await session.query(statement);
  } catch (error) {
    const number = errorNumber(error);
    const message = (error as Error).message;
    if (number !== undefined && expected.has(number) && message.includes(constraint)) {
      pass(label, `refused by ${constraint}, SQL Server error ${number}`);
      return;
    }
    fail(
      label,
      `rejected for the WRONG reason (error ${number ?? 'unknown'}): ` +
        `${message.split('\n')[0]}`,
    );
    return;
  }
  fail(label, `statement SUCCEEDED but ${constraint} must refuse it`);
}

/** Foreign-key and CHECK violations. */
const CONSTRAINT_VIOLATION = new Set([547]);
/** Primary-key, unique-constraint and unique-index violations. */
const DUPLICATE_KEY = new Set([2627, 2601]);

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
    editorialProvisioned: number;
    libraryProvisioned: number;
    searchProvisioned: number;
    mediaProvisioned: number;
    globalProvisioned: number;
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
             AS peopleProvisioned,
           SUM(CASE WHEN [action] = N'editorial.permissions.provisioned'
                     AND [actorType] = N'migration' THEN 1 ELSE 0 END)
             AS editorialProvisioned,
           SUM(CASE WHEN [action] = N'library.permissions.provisioned'
                     AND [actorType] = N'migration' THEN 1 ELSE 0 END)
             AS libraryProvisioned,
           SUM(CASE WHEN [action] = N'search.permissions.provisioned'
                     AND [actorType] = N'migration' THEN 1 ELSE 0 END)
             AS searchProvisioned,
           SUM(CASE WHEN [action] = N'media.permissions.provisioned'
                     AND [actorType] = N'migration' THEN 1 ELSE 0 END)
             AS mediaProvisioned,
           SUM(CASE WHEN [action] = N'global.permissions.provisioned'
                     AND [actorType] = N'migration' THEN 1 ELSE 0 END)
             AS globalProvisioned
    FROM [dbo].[AuditLog];
  `);

  // Exactly nine rows: the Phase-3B through Phase-17 privilege extensions
  // (Phase 10's and Phase 16's included), and this run's probe. Naming every migration action is load-bearing:
  // deriving the expected total from whatever provisioning rows happened to
  // survive would pass if a phase omitted its own audit, and each privilege
  // extension must be able to show that it paid for itself
  // (SECURITY_BASELINE.md §8.1).
  const EXPECTED_AUDIT_ROWS = 9;

  if (
    Number(survivor?.taxonomyProvisioned ?? 0) !== 1 ||
    Number(survivor?.navigationProvisioned ?? 0) !== 1 ||
    Number(survivor?.peopleProvisioned ?? 0) !== 1 ||
    Number(survivor?.editorialProvisioned ?? 0) !== 1 ||
    Number(survivor?.libraryProvisioned ?? 0) !== 1 ||
    Number(survivor?.searchProvisioned ?? 0) !== 1 ||
    Number(survivor?.mediaProvisioned ?? 0) !== 1 ||
    Number(survivor?.globalProvisioned ?? 0) !== 1 ||
    Number(survivor?.probe ?? 0) !== 1 ||
    Number(survivor?.tampered ?? -1) !== 0 ||
    Number(survivor?.total ?? 0) !== EXPECTED_AUDIT_ROWS
  ) {
    fail(
      'audit rows unmodified',
      `expected ${EXPECTED_AUDIT_ROWS} rows with 1 taxonomy provisioning, ` +
        `1 navigation provisioning, 1 people provisioning, 1 editorial provisioning, ` +
        `1 library provisioning, 1 search provisioning, 1 media provisioning, ` +
        `1 global provisioning, 1 probe and ` +
        `0 tampered; found ${survivor?.total ?? 0} rows, ` +
        `${survivor?.taxonomyProvisioned ?? 0} taxonomy provisioning, ` +
        `${survivor?.navigationProvisioned ?? 0} navigation provisioning, ` +
        `${survivor?.peopleProvisioned ?? 0} people provisioning, ` +
        `${survivor?.editorialProvisioned ?? 0} editorial provisioning, ` +
        `${survivor?.libraryProvisioned ?? 0} library provisioning, ` +
        `${survivor?.searchProvisioned ?? 0} search provisioning, ` +
        `${survivor?.mediaProvisioned ?? 0} media provisioning, ` +
        `${survivor?.globalProvisioned ?? 0} global provisioning, ` +
        `${survivor?.probe ?? 0} probe, ${survivor?.tampered ?? 0} tampered`,
    );
  } else {
    pass(
      'audit rows unmodified',
      'the probe row and all eight exact migration records are intact after ' +
        'UPDATE/DELETE attempts',
    );
  }

  // Phase 6: actual writes through the runtime login, then exact refusal probes.
  const editorialPeople = newPhase5Fixture();
  await writePhase5Fixture(admin, editorialPeople);
  const editorialReviewer = randomUUID();
  await admin.query(
    `INSERT INTO [User] ([id],[name],[email],[emailVerified],[createdAt],[updatedAt],[locale],[status],[twoFactorEnabled]) VALUES (N'${editorialReviewer}',N'Synthetic reviewer',N'${editorialReviewer}@proof.invalid',0,SYSUTCDATETIME(),SYSUTCDATETIME(),N'en',N'active',0);`,
  );
  const [editorialTopic] = await admin.query<{ id: string }>(
    "SELECT TOP 1 [id] FROM [Topic] WHERE [status]=N'active' ORDER BY [id];",
  );
  if (!editorialTopic) throw new Error('No fixture Topic found.');
  const editorialFixture = newPhase6Fixture();
  await writePhase6Fixture(app, editorialFixture, {
    authorId: editorialPeople.accountId,
    reviewerId: editorialReviewer,
    personId: editorialPeople.linkedPersonId,
    topicId: editorialTopic.id,
  });
  const editorialSnapshot = await capturePhase6Fixture(app, editorialFixture);
  pass(
    'Editorial runtime writes',
    '14 tables written and read through the actual application principal',
  );
  for (const table of [
    'Article',
    'Page',
    'ArticleRevision',
    'PageRevision',
    'ArticleRevisionTranslation',
    'PageRevisionTranslation',
    'ArticleTopic',
    'PageTopic',
    'ArticleContributor',
    'PageContributor',
    'ArticleSlugHistory',
    'PageSlugHistory',
  ]) {
    await expectDenied(
      app,
      table + ' DELETE denied',
      'DELETE FROM [dbo].[' + table + '];',
    );
    await expectDenied(
      app,
      table + ' ALTER denied',
      'ALTER TABLE [dbo].[' + table + '] ADD [probe] INT NULL;',
    );
    if (!['Article', 'Page'].includes(table)) {
      const column = table.includes('RevisionTranslation')
        ? 'title'
        : table.endsWith('Revision')
          ? 'slug'
          : table.endsWith('SlugHistory')
            ? 'slug'
            : 'ownerId';
      await expectDenied(
        app,
        table + ' UPDATE denied',
        'UPDATE [dbo].[' + table + '] SET [' + column + ']=[' + column + '];',
      );
    }
  }
  await verifyRestoredPhase6(admin, editorialFixture, editorialSnapshot);
  for (const [table, id] of [
    ['ContactInquiry', editorialFixture.contactId],
    ['Feedback', editorialFixture.feedbackId],
  ]) {
    await expectAllowed(
      app,
      table + ' triage UPDATE',
      `UPDATE [${table}] SET [version]=[version]+1,[state]=N'closed' WHERE [id]=N'${id}';`,
      'private triage remains writable',
    );
    await expectAllowed(
      app,
      table + ' retention DELETE',
      `DELETE FROM [${table}] WHERE [id]=N'${id}';`,
      'expired data disposition remains possible',
    );
  }

  // ---- Phase 13: the four News families, by the Phase-6 postures -----------
  //
  // Written through the RUNTIME login — create, revise, rename, approve,
  // publish, archive and schedule, with the search intent each owes — so the
  // grants the application relies on are proven sufficient. Then every removal
  // and every rewrite of history is refused: no News record, revision,
  // translation, typed reference or slug reservation can be deleted, and none
  // but the record itself can be updated.
  const newsFixture = newPhase13Fixture();
  await writePhase13Fixture(app, newsFixture, {
    authorId: editorialPeople.accountId,
    reviewerId: editorialReviewer,
    personId: editorialPeople.linkedPersonId,
    topicId: editorialTopic.id,
  });
  const newsSnapshot = await capturePhase13Fixture(app, newsFixture);
  pass(
    'News runtime writes',
    '24 tables written and read through the actual application principal',
  );
  for (const family of PHASE13_FAMILIES) {
    for (const suffix of [
      '',
      'Revision',
      'RevisionTranslation',
      'Topic',
      'Contributor',
      'SlugHistory',
    ]) {
      const table = family + suffix;
      await expectDenied(app, table + ' DELETE denied', `DELETE FROM [dbo].[${table}];`);
      await expectDenied(
        app,
        table + ' ALTER denied',
        `ALTER TABLE [dbo].[${table}] ADD [probe] INT NULL;`,
      );
      if (suffix !== '') {
        const column =
          suffix === 'RevisionTranslation'
            ? 'title'
            : suffix === 'Revision' || suffix === 'SlugHistory'
              ? 'slug'
              : 'ownerId';
        await expectDenied(
          app,
          table + ' UPDATE denied',
          `UPDATE [dbo].[${table}] SET [${column}]=[${column}];`,
        );
      }
    }
  }
  await verifyRestoredPhase13(admin, newsFixture, newsSnapshot);

  // ---- Phase 7: storage custody metadata -----------------------------------
  //
  // The runtime owns the whole Asset lifecycle, including DELETE, because
  // reconciliation removes rows a crash left mid-upload. What it must NOT have
  // is ALTER: the CHECK constraints are what make "an unmeasured asset can
  // never be clean" true against any writer, and a principal that could drop
  // them could serve an unscanned file.
  const assetId = randomUUID();
  const assetKey = 'ab/cd/' + randomUUID().replaceAll('-', '');

  await expectAllowed(
    app,
    'Asset INSERT',
    `INSERT INTO [dbo].[Asset] ([id],[storageKey],[state],[updatedAt]) VALUES (N'${assetId}',N'${assetKey}',N'uploading',SYSUTCDATETIME());`,
    'custody rows are created by the runtime',
  );
  await expectAllowed(
    app,
    'Asset UPDATE',
    `UPDATE [dbo].[Asset] SET [state]=N'quarantined',[mediaType]=N'image/png',[byteSize]=12,[checksum]=REPLICATE(N'a',64) WHERE [id]=N'${assetId}';`,
    'the custody lifecycle advances',
  );
  await expectAllowed(
    app,
    'Asset reconciliation DELETE',
    `DELETE FROM [dbo].[Asset] WHERE [id]=N'${assetId}';`,
    'stale upload rows can be reconciled away',
  );
  await expectDenied(
    app,
    'Asset ALTER denied',
    'ALTER TABLE [dbo].[Asset] DROP CONSTRAINT [Asset_clean_measured_ck];',
  );

  // ---- Phase 8: Library aggregates and the permanent slug namespace ---------
  //
  // THREE DISTINCT POSTURES here, and the differences are the rule rather than
  // an accident of how the grant script was written:
  //
  //   - the AGGREGATES — `Work`, `Edition`, `SalePoint` — are INSERT and UPDATE
  //     and never DELETE. A Work is withdrawn by moving its state to `archived`,
  //     which keeps the row that a slug reservation, an audit entry and a
  //     contributor attribution all point at. A runtime that could delete one
  //     could break all three at once.
  //
  //   - the RELATION SETS — `WorkLabel`, `WorkContributor`, `WorkTopic`,
  //     `WorkSalePoint`, `BookTranslator` — are replaced wholesale on every
  //     save, so INSERT and DELETE are the operations and UPDATE is DENIED:
  //     a composite-key membership row has no third state to be moved into.
  //     The same posture `RolePermission` has, for the same reason.
  //
  //   - `WorkSlugHistory` is APPEND ONLY. It is the namespace that makes "a
  //     slug is permanent and never reused" true (DOMAIN_MODEL.md §19.7), and a
  //     runtime that could update or delete a reservation could hand one Work's
  //     established public address to another Work.
  //
  // THE RESERVATION IS PROVED, NOT ASSUMED. The row is written by a trigger on
  // `Work`, so the check below is the only thing that can tell "the trigger
  // fires under the least-privilege principal" from "the trigger exists".
  const libraryWorkId = randomUUID();
  const librarySlug = `library-proof-${libraryWorkId.replaceAll('-', '')}`;
  const libraryEditionId = randomUUID();
  const librarySalePointId = randomUUID();

  await expectAllowed(
    app,
    'Work INSERT',
    `INSERT INTO [dbo].[Work] ([id],[slug],[primaryLocale],[state],[isFeatured],[version],[updatedAt]) VALUES (N'${libraryWorkId}',N'${librarySlug}',N'en',N'draft',0,1,SYSUTCDATETIME());`,
    'Library aggregates are created by the runtime',
  );

  const [reserved] = await admin.query<{ total: number }>(
    `SELECT COUNT_BIG(*) AS total FROM [dbo].[WorkSlugHistory] WHERE [slug]=N'${librarySlug}' AND [workId]=N'${libraryWorkId}';`,
  );
  if (Number(reserved?.total ?? 0) !== 1) {
    fail(
      'Work slug reserved by the database',
      `expected exactly one reservation for the new Work, found ${reserved?.total ?? 0}`,
    );
  } else {
    pass(
      'Work slug reserved by the database',
      'the trigger reserved the slug under the least-privilege principal',
    );
  }

  await expectAllowed(
    app,
    'Work UPDATE',
    `UPDATE [dbo].[Work] SET [state]=N'published',[version]=[version]+1 WHERE [id]=N'${libraryWorkId}';`,
    'the publication lifecycle advances',
  );
  await expectAllowed(
    app,
    'WorkLabel INSERT',
    `INSERT INTO [dbo].[WorkLabel] ([workId],[locale],[title],[description]) VALUES (N'${libraryWorkId}',N'en',N'Least-privilege proof work',N'');`,
    'localized descriptive metadata is written',
  );
  await expectAllowed(
    app,
    'WorkContributor INSERT',
    `INSERT INTO [dbo].[WorkContributor] ([workId],[personId],[role],[position]) VALUES (N'${libraryWorkId}',N'${editorialPeople.linkedPersonId}',N'author',0);`,
    'attribution references People',
  );
  await expectAllowed(
    app,
    'WorkTopic INSERT',
    `INSERT INTO [dbo].[WorkTopic] ([workId],[topicId]) VALUES (N'${libraryWorkId}',N'${editorialTopic.id}');`,
    'classification references Taxonomy',
  );
  await expectAllowed(
    app,
    'Edition INSERT',
    `INSERT INTO [dbo].[Edition] ([id],[workId],[languageCode],[label],[state],[reading],[download],[version],[updatedAt]) VALUES (N'${libraryEditionId}',N'${libraryWorkId}',N'en',N'Proof edition',N'draft',N'unavailable',N'denied',1,SYSUTCDATETIME());`,
    'manifestations are created by the runtime',
  );
  await expectAllowed(
    app,
    'BookTranslation INSERT',
    `INSERT INTO [dbo].[BookTranslation] ([editionId],[workId],[sourceEditionId]) VALUES (N'${libraryEditionId}',N'${libraryWorkId}',NULL);`,
    'a translation relation is recorded',
  );
  await expectAllowed(
    app,
    'BookTranslator INSERT',
    `INSERT INTO [dbo].[BookTranslator] ([editionId],[personId]) VALUES (N'${libraryEditionId}',N'${editorialPeople.historicalPersonId}');`,
    'translators reference People',
  );
  await expectAllowed(
    app,
    'SalePoint INSERT',
    `INSERT INTO [dbo].[SalePoint] ([id],[name],[address],[contact],[url],[state],[version]) VALUES (N'${librarySalePointId}',N'Proof sale point',N'',N'',NULL,N'draft',1);`,
    'printed-book availability is recorded',
  );
  await expectAllowed(
    app,
    'WorkSalePoint INSERT',
    `INSERT INTO [dbo].[WorkSalePoint] ([workId],[salePointId]) VALUES (N'${libraryWorkId}',N'${librarySalePointId}');`,
    'a Work is linked to where it can be bought',
  );

  // The replacement half of "replaced wholesale": each set must be removable,
  // in dependency order, so the save path is not relying on an UPDATE it does
  // not hold.
  for (const [table, where] of [
    ['BookTranslator', `[editionId]=N'${libraryEditionId}'`],
    ['BookTranslation', `[editionId]=N'${libraryEditionId}'`],
    ['WorkSalePoint', `[workId]=N'${libraryWorkId}'`],
    ['WorkTopic', `[workId]=N'${libraryWorkId}'`],
    ['WorkContributor', `[workId]=N'${libraryWorkId}'`],
    ['WorkLabel', `[workId]=N'${libraryWorkId}'`],
  ] as const) {
    await expectAllowed(
      app,
      `${table} DELETE`,
      `DELETE FROM [dbo].[${table}] WHERE ${where};`,
      'a replaceable relation set can be cleared before it is rewritten',
    );
  }

  // The aggregates are not deletable, so a withdrawal cannot become an erasure.
  for (const [table, where] of [
    ['Work', `[id]=N'${libraryWorkId}'`],
    ['Edition', `[id]=N'${libraryEditionId}'`],
    ['SalePoint', `[id]=N'${librarySalePointId}'`],
  ] as const) {
    await expectDenied(
      app,
      `${table} DELETE denied`,
      `DELETE FROM [dbo].[${table}] WHERE ${where};`,
    );
  }

  // A membership row has no third state, so UPDATE is denied on every set.
  for (const [table, column] of [
    ['WorkLabel', 'title'],
    ['WorkContributor', 'position'],
    ['WorkTopic', 'topicId'],
    ['WorkSalePoint', 'salePointId'],
    ['BookTranslator', 'personId'],
  ] as const) {
    await expectDenied(
      app,
      `${table} UPDATE denied`,
      `UPDATE [dbo].[${table}] SET [${column}]=[${column}];`,
    );
  }

  // The slug namespace is append-only: a reservation cannot be moved or removed.
  await expectDenied(
    app,
    'WorkSlugHistory UPDATE denied',
    'UPDATE [dbo].[WorkSlugHistory] SET [workId]=[workId];',
  );
  await expectDenied(
    app,
    'WorkSlugHistory DELETE denied',
    `DELETE FROM [dbo].[WorkSlugHistory] WHERE [slug]=N'${librarySlug}';`,
  );

  // No ALTER anywhere, so the availability and version CHECK constraints that
  // make "reading allowed implies a readable source" true stay beyond reach.
  await expectDenied(
    app,
    'Edition ALTER denied',
    'ALTER TABLE [dbo].[Edition] DROP CONSTRAINT [Edition_reading_ck];',
  );
  await expectDenied(
    app,
    'Work ALTER denied',
    'ALTER TABLE [dbo].[Work] DROP CONSTRAINT [Work_state_ck];',
  );

  // ---- Phase 9: the scholarly and periodical aggregates --------------------
  //
  // THE SAME THREE POSTURES AS PHASE 8, across six more aggregates: records are
  // INSERT and UPDATE and never DELETE; relation sets are INSERT and DELETE and
  // never UPDATE; slug histories are append-only. Each is proved to WORK and to
  // REFUSE, and two invariants are proved as refusals BY THE DATABASE rather than
  // by a grant: a renamed record keeps its former slug (the trigger), and an issue
  // can never move to another Magazine (its reservations' composite foreign key).
  const magazineId = randomUUID();
  const otherMagazineId = randomUUID();
  const issueId = randomUUID();
  const researchId = randomUUID();
  const scholarlyRun = researchId.replaceAll('-', '');
  const magazineSlug = `magazine-proof-${scholarlyRun}`;
  const researchSlug = `research-proof-${scholarlyRun}`;

  await expectAllowed(
    app,
    'Magazine INSERT',
    `INSERT INTO [dbo].[Magazine] ([id],[slug],[primaryLocale],[state],[version],[updatedAt]) VALUES (N'${magazineId}',N'${magazineSlug}',N'en',N'draft',1,SYSUTCDATETIME()),(N'${otherMagazineId}',N'${magazineSlug}-other',N'en',N'draft',1,SYSUTCDATETIME());`,
    'Phase-9 aggregates are created by the runtime',
  );
  await expectAllowed(
    app,
    'Magazine issue serialisation lock',
    `BEGIN TRAN; SELECT [id] FROM [dbo].[Magazine] WITH (UPDLOCK, HOLDLOCK) WHERE [id]=N'${magazineId}'; COMMIT TRAN;`,
    'an issue write serialises at its Magazine with SELECT alone',
  );
  await expectAllowed(
    app,
    'MagazineIssue INSERT',
    `INSERT INTO [dbo].[MagazineIssue] ([id],[magazineId],[slug],[primaryLocale],[languageCode],[state],[volume],[issueNumber],[version],[updatedAt]) VALUES (N'${issueId}',N'${magazineId}',N'issue-proof',N'en',N'en',N'draft',1,1,1,SYSUTCDATETIME());`,
    'an issue is created beneath its Magazine',
  );
  await expectAllowed(
    app,
    'Research INSERT',
    `INSERT INTO [dbo].[Research] ([id],[slug],[primaryLocale],[languageCode],[state],[version],[updatedAt]) VALUES (N'${researchId}',N'${researchSlug}',N'en',N'en',N'draft',1,SYSUTCDATETIME());`,
    'a research record is created',
  );
  await expectAllowed(
    app,
    'Research UPDATE (rename)',
    `UPDATE [dbo].[Research] SET [slug]=N'${researchSlug}-renamed',[version]=[version]+1 WHERE [id]=N'${researchId}';`,
    'a record is edited and its slug changed',
  );

  const [reservations] = await app.query<{ research: number; issue: number }>(
    `SELECT (SELECT COUNT_BIG(*) FROM [dbo].[ResearchSlugHistory] WHERE [researchId]=N'${researchId}') AS research,
            (SELECT COUNT_BIG(*) FROM [dbo].[MagazineIssueSlugHistory] WHERE [magazineIssueId]=N'${issueId}' AND [magazineId]=N'${magazineId}') AS issue;`,
  );
  if (Number(reservations?.research) === 2 && Number(reservations?.issue) === 1) {
    pass(
      'Phase-9 slugs reserved by the database',
      'the former and current research slug, and the issue slug within its Magazine',
    );
  } else {
    fail(
      'Phase-9 slugs reserved by the database',
      `expected 2 research and 1 issue reservation, found ${String(reservations?.research ?? 0)} and ${String(reservations?.issue ?? 0)}`,
    );
  }

  await expectRefusedByInvariant(
    app,
    'MagazineIssue cannot change Magazine',
    `UPDATE [dbo].[MagazineIssue] SET [magazineId]=N'${otherMagazineId}' WHERE [id]=N'${issueId}';`,
    547,
  );

  for (const [label, statement] of [
    [
      'ResearchLabel INSERT',
      `INSERT INTO [dbo].[ResearchLabel] ([researchId],[locale],[title],[summary]) VALUES (N'${researchId}',N'en',N'Least-privilege proof research',N'');`,
    ],
    [
      'ResearchContributor INSERT',
      `INSERT INTO [dbo].[ResearchContributor] ([researchId],[personId],[role],[position]) VALUES (N'${researchId}',N'${editorialPeople.linkedPersonId}',N'author',0);`,
    ],
    [
      'ResearchTopic INSERT',
      `INSERT INTO [dbo].[ResearchTopic] ([researchId],[topicId]) VALUES (N'${researchId}',N'${editorialTopic.id}');`,
    ],
    [
      'ResearchCitation INSERT',
      `INSERT INTO [dbo].[ResearchCitation] ([researchId],[position],[text],[url],[doi]) VALUES (N'${researchId}',0,N'Synthetic proof citation',N'https://example.org/proof',N'10.1234/proof');`,
    ],
    [
      'MagazineIssueLabel INSERT',
      `INSERT INTO [dbo].[MagazineIssueLabel] ([magazineIssueId],[locale],[title],[summary]) VALUES (N'${issueId}',N'en',N'Least-privilege proof issue',N'');`,
    ],
    [
      'SearchIndexRequest INSERT (issue scope)',
      `INSERT INTO [dbo].[SearchIndexRequest] ([scopeKind],[scopeId]) VALUES (N'magazine-issue',N'${issueId}');`,
    ],
  ] as const) {
    await expectAllowed(app, label, statement, 'the save path writes its own rows');
  }

  for (const [table, where] of [
    ['ResearchCitation', `[researchId]=N'${researchId}'`],
    ['ResearchTopic', `[researchId]=N'${researchId}'`],
    ['ResearchContributor', `[researchId]=N'${researchId}'`],
    ['ResearchLabel', `[researchId]=N'${researchId}'`],
    ['MagazineIssueLabel', `[magazineIssueId]=N'${issueId}'`],
  ] as const) {
    await expectAllowed(
      app,
      `${table} DELETE`,
      `DELETE FROM [dbo].[${table}] WHERE ${where};`,
      'a replaceable relation set can be cleared before it is rewritten',
    );
  }

  for (const table of [
    'Research',
    'ResearchPaper',
    'Publication',
    'Magazine',
    'MagazineIssue',
    'Encyclopedia',
  ]) {
    await expectDenied(app, `${table} DELETE denied`, `DELETE FROM [dbo].[${table}];`);
    await expectDenied(
      app,
      `${table}SlugHistory UPDATE denied`,
      `UPDATE [dbo].[${table}SlugHistory] SET [slug]=[slug];`,
    );
    await expectDenied(
      app,
      `${table}SlugHistory DELETE denied`,
      `DELETE FROM [dbo].[${table}SlugHistory];`,
    );
    await expectDenied(
      app,
      `${table}Label UPDATE denied`,
      `UPDATE [dbo].[${table}Label] SET [title]=[title];`,
    );
    await expectDenied(
      app,
      `${table}Contributor UPDATE denied`,
      `UPDATE [dbo].[${table}Contributor] SET [position]=[position];`,
    );
    await expectDenied(
      app,
      `${table}Topic UPDATE denied`,
      `UPDATE [dbo].[${table}Topic] SET [topicId]=[topicId];`,
    );
    await expectDenied(
      app,
      `${table} ALTER denied`,
      `ALTER TABLE [dbo].[${table}] DROP CONSTRAINT [${table}_state_ck];`,
    );
  }
  for (const table of ['ResearchCitation', 'ResearchPaperCitation']) {
    await expectDenied(
      app,
      `${table} UPDATE denied`,
      `UPDATE [dbo].[${table}] SET [text]=[text];`,
    );
  }

  // ---- Phase 10: Media — Video, Series, Playlist ---------------------------
  //
  // THE SAME THREE POSTURES, across three more aggregates, each proved to WORK
  // and to REFUSE. Four invariants are proved as refusals BY THE DATABASE rather
  // than by a grant: a renamed Video keeps its former slug (the trigger), a
  // provider identifier differing only in case is a DIFFERENT video (the binary
  // collation), two episodes of one Series cannot share a position (the filtered
  // unique index), and a Playlist's order is dense and bounded (its CHECK).
  const mediaRun = randomUUID().replaceAll('-', '');
  const seriesId = randomUUID();
  const firstVideoId = randomUUID();
  const secondVideoId = randomUUID();
  const thirdVideoId = randomUUID();
  const playlistId = randomUUID();
  const videoSlug = `video-proof-${mediaRun}`;
  const videoColumns =
    '[id],[slug],[primaryLocale],[state],[isFeatured],[provider],[providerVideoId],[availability],[languageCode],[captions],[seriesId],[seriesPosition],[version],[updatedAt]';

  await expectAllowed(
    app,
    'Series INSERT',
    `INSERT INTO [dbo].[Series] ([id],[slug],[kind],[primaryLocale],[state],[version],[updatedAt]) VALUES (N'${seriesId}',N'series-proof-${mediaRun}',N'program',N'en',N'draft',1,SYSUTCDATETIME());`,
    'a Series is created by the runtime',
  );
  await expectAllowed(
    app,
    'Video INSERT (case-distinct provider identifiers)',
    `INSERT INTO [dbo].[Video] (${videoColumns}) VALUES
       (N'${firstVideoId}',N'${videoSlug}',N'en',N'draft',0,N'youtube','abcDEF12345',N'available',N'en',0,N'${seriesId}',1,1,SYSUTCDATETIME()),
       (N'${secondVideoId}',N'${videoSlug}-two',N'en',N'draft',0,N'youtube','ABCdef12345',N'available',N'en',0,NULL,NULL,1,SYSUTCDATETIME());`,
    'two YouTube identifiers differing only in case are two videos',
  );
  await expectAllowed(
    app,
    'Video UPDATE (rename)',
    `UPDATE [dbo].[Video] SET [slug]=N'${videoSlug}-renamed',[version]=[version]+1 WHERE [id]=N'${firstVideoId}';`,
    'a Video is edited and its slug changed',
  );

  const [videoReservations] = await app.query<{ count: number }>(
    `SELECT COUNT_BIG(*) AS count FROM [dbo].[VideoSlugHistory] WHERE [videoId]=N'${firstVideoId}';`,
  );
  if (Number(videoReservations?.count) === 2) {
    pass('Video slugs reserved by the database', 'the former and the current slug');
  } else {
    fail(
      'Video slugs reserved by the database',
      `expected 2 reservations, found ${String(videoReservations?.count ?? 0)}`,
    );
  }

  await expectRefusedByInvariant(
    app,
    'Video provider identifier is unique, exactly',
    `INSERT INTO [dbo].[Video] (${videoColumns}) VALUES (N'${thirdVideoId}',N'${videoSlug}-three',N'en',N'draft',0,N'youtube','abcDEF12345',N'available',N'en',0,NULL,NULL,1,SYSUTCDATETIME());`,
    2627,
  );
  await expectRefusedByInvariant(
    app,
    'Video episode position is unique within its Series',
    `UPDATE [dbo].[Video] SET [seriesId]=N'${seriesId}',[seriesPosition]=1 WHERE [id]=N'${secondVideoId}';`,
    2601,
  );
  await expectRefusedByInvariant(
    app,
    'Video provider identifier grammar',
    `UPDATE [dbo].[Video] SET [providerVideoId]='javascript:1' WHERE [id]=N'${secondVideoId}';`,
    547,
  );

  await expectAllowed(
    app,
    'Playlist INSERT',
    `INSERT INTO [dbo].[Playlist] ([id],[slug],[primaryLocale],[state],[version],[updatedAt]) VALUES (N'${playlistId}',N'playlist-proof-${mediaRun}',N'en',N'draft',1,SYSUTCDATETIME());`,
    'a Playlist is created by the runtime',
  );
  // A real Playlist and a real Video with no membership yet, so the ONLY rule a
  // position of 200 can break is the order's bound.
  await expectRefusedByInvariant(
    app,
    'PlaylistVideo order is bounded',
    `INSERT INTO [dbo].[PlaylistVideo] ([playlistId],[videoId],[position]) VALUES (N'${playlistId}',N'${firstVideoId}',200);`,
    547,
  );

  for (const [label, statement] of [
    [
      'VideoLabel INSERT',
      `INSERT INTO [dbo].[VideoLabel] ([videoId],[locale],[title],[description]) VALUES (N'${firstVideoId}',N'en',N'Least-privilege proof video',N'');`,
    ],
    [
      'VideoSpeaker INSERT',
      `INSERT INTO [dbo].[VideoSpeaker] ([videoId],[personId],[position]) VALUES (N'${firstVideoId}',N'${editorialPeople.linkedPersonId}',0);`,
    ],
    [
      'VideoTopic INSERT',
      `INSERT INTO [dbo].[VideoTopic] ([videoId],[topicId]) VALUES (N'${firstVideoId}',N'${editorialTopic.id}');`,
    ],
    [
      'SeriesLabel INSERT',
      `INSERT INTO [dbo].[SeriesLabel] ([seriesId],[locale],[title],[description]) VALUES (N'${seriesId}',N'en',N'Least-privilege proof series',N'');`,
    ],
    [
      'PlaylistLabel INSERT',
      `INSERT INTO [dbo].[PlaylistLabel] ([playlistId],[locale],[title],[description]) VALUES (N'${playlistId}',N'en',N'Least-privilege proof playlist',N'');`,
    ],
    [
      'PlaylistVideo INSERT',
      `INSERT INTO [dbo].[PlaylistVideo] ([playlistId],[videoId],[position]) VALUES (N'${playlistId}',N'${firstVideoId}',0),(N'${playlistId}',N'${secondVideoId}',1);`,
    ],
    [
      'SearchIndexRequest INSERT (video scope)',
      `INSERT INTO [dbo].[SearchIndexRequest] ([scopeKind],[scopeId]) VALUES (N'video',N'${firstVideoId}');`,
    ],
  ] as const) {
    await expectAllowed(app, label, statement, 'the save path writes its own rows');
  }

  for (const [table, where] of [
    ['PlaylistVideo', `[playlistId]=N'${playlistId}'`],
    ['VideoTopic', `[videoId]=N'${firstVideoId}'`],
    ['VideoSpeaker', `[videoId]=N'${firstVideoId}'`],
    ['VideoLabel', `[videoId]=N'${firstVideoId}'`],
    ['SeriesLabel', `[seriesId]=N'${seriesId}'`],
    ['PlaylistLabel', `[playlistId]=N'${playlistId}'`],
  ] as const) {
    await expectAllowed(
      app,
      `${table} DELETE`,
      `DELETE FROM [dbo].[${table}] WHERE ${where};`,
      'a replaceable relation set can be cleared before it is rewritten',
    );
  }

  for (const table of ['Video', 'Series', 'Playlist']) {
    await expectDenied(app, `${table} DELETE denied`, `DELETE FROM [dbo].[${table}];`);
    await expectDenied(
      app,
      `${table}SlugHistory UPDATE denied`,
      `UPDATE [dbo].[${table}SlugHistory] SET [slug]=[slug];`,
    );
    await expectDenied(
      app,
      `${table}SlugHistory DELETE denied`,
      `DELETE FROM [dbo].[${table}SlugHistory];`,
    );
    await expectDenied(
      app,
      `${table}Label UPDATE denied`,
      `UPDATE [dbo].[${table}Label] SET [title]=[title];`,
    );
    await expectDenied(
      app,
      `${table} ALTER denied`,
      `ALTER TABLE [dbo].[${table}] DROP CONSTRAINT [${table}_state_ck];`,
    );
  }
  for (const table of ['VideoSpeaker', 'VideoTopic', 'PlaylistVideo']) {
    await expectDenied(
      app,
      `${table} UPDATE denied`,
      `UPDATE [dbo].[${table}] SET [videoId]=[videoId];`,
    );
  }

  // ---- Phase 11: Media — AudioTrack, AudioSeries ---------------------------
  //
  // THE SAME THREE POSTURES, across two more aggregates, each proved to WORK and
  // to REFUSE. Five invariants are proved as refusals BY THE DATABASE rather
  // than by a grant: a renamed track keeps its former slug (the trigger), a
  // published track must have a file (its CHECK), one file serves one track and
  // one place in a series holds one track (the filtered unique indexes), and an
  // Asset a track names cannot be deleted out from under it (the foreign key).
  // The Asset rows are written with Storage's OWN grant, as the storage service
  // writes them; nothing here widens what the runtime may do to an Asset.
  const audioRun = randomUUID().replaceAll('-', '');
  const audioSeriesId = randomUUID();
  const trackId = randomUUID();
  const secondTrackId = randomUUID();
  const audioAssetId = randomUUID();
  const trackSlug = `audio-proof-${audioRun}`;
  const trackColumns =
    '[id],[slug],[primaryLocale],[state],[languageCode],[assetId],[seriesId],[seriesPosition],[version],[updatedAt]';

  await expectAllowed(
    app,
    'Asset INSERT (a cleared audio file, as Storage records it)',
    `INSERT INTO [dbo].[Asset] ([id],[storageKey],[mediaType],[byteSize],[checksum],[state],[updatedAt]) VALUES (N'${audioAssetId}',N'aa/bb/${audioRun}',N'audio/mpeg',834,N'${'e'.repeat(64)}',N'clean',SYSUTCDATETIME());`,
    'Storage records the file it cleared',
  );
  await expectAllowed(
    app,
    'AudioSeries INSERT',
    `INSERT INTO [dbo].[AudioSeries] ([id],[slug],[primaryLocale],[state],[version],[updatedAt]) VALUES (N'${audioSeriesId}',N'audio-series-proof-${audioRun}',N'en',N'draft',1,SYSUTCDATETIME());`,
    'an AudioSeries is created by the runtime',
  );
  await expectAllowed(
    app,
    'AudioTrack INSERT',
    `INSERT INTO [dbo].[AudioTrack] (${trackColumns}) VALUES
       (N'${trackId}',N'${trackSlug}',N'en',N'draft',N'en',N'${audioAssetId}',N'${audioSeriesId}',1,1,SYSUTCDATETIME()),
       (N'${secondTrackId}',N'${trackSlug}-two',N'en',N'draft',N'en',NULL,NULL,NULL,1,SYSUTCDATETIME());`,
    'a track with its file and a track with none yet',
  );
  await expectAllowed(
    app,
    'AudioTrack UPDATE (rename and publish)',
    `UPDATE [dbo].[AudioTrack] SET [slug]=N'${trackSlug}-renamed',[state]=N'published',[version]=[version]+1 WHERE [id]=N'${trackId}';`,
    'a track with a file is renamed and published',
  );

  const [trackReservations] = await app.query<{ count: number }>(
    `SELECT COUNT_BIG(*) AS count FROM [dbo].[AudioTrackSlugHistory] WHERE [trackId]=N'${trackId}';`,
  );
  if (Number(trackReservations?.count) === 2) {
    pass('AudioTrack slugs reserved by the database', 'the former and the current slug');
  } else {
    fail(
      'AudioTrack slugs reserved by the database',
      `expected 2 reservations, found ${String(trackReservations?.count ?? 0)}`,
    );
  }

  await expectRefusedByInvariant(
    app,
    'A published AudioTrack has a file',
    `UPDATE [dbo].[AudioTrack] SET [state]=N'published' WHERE [id]=N'${secondTrackId}';`,
    547,
  );
  await expectRefusedByInvariant(
    app,
    'One audio file serves one track',
    `UPDATE [dbo].[AudioTrack] SET [assetId]=N'${audioAssetId}' WHERE [id]=N'${secondTrackId}';`,
    2601,
  );
  await expectRefusedByInvariant(
    app,
    'A place in an AudioSeries holds one track',
    `UPDATE [dbo].[AudioTrack] SET [seriesId]=N'${audioSeriesId}',[seriesPosition]=1 WHERE [id]=N'${secondTrackId}';`,
    2601,
  );
  await expectRefusedByInvariant(
    app,
    'An Asset a track names cannot be deleted',
    `DELETE FROM [dbo].[Asset] WHERE [id]=N'${audioAssetId}';`,
    547,
  );

  for (const [label, statement] of [
    [
      'AudioTrackLabel INSERT',
      `INSERT INTO [dbo].[AudioTrackLabel] ([trackId],[locale],[title],[description]) VALUES (N'${trackId}',N'en',N'Least-privilege proof recording',N'');`,
    ],
    [
      'AudioTrackSpeaker INSERT',
      `INSERT INTO [dbo].[AudioTrackSpeaker] ([trackId],[personId],[position]) VALUES (N'${trackId}',N'${editorialPeople.linkedPersonId}',0);`,
    ],
    [
      'AudioTrackTopic INSERT',
      `INSERT INTO [dbo].[AudioTrackTopic] ([trackId],[topicId]) VALUES (N'${trackId}',N'${editorialTopic.id}');`,
    ],
    [
      'AudioSeriesLabel INSERT',
      `INSERT INTO [dbo].[AudioSeriesLabel] ([seriesId],[locale],[title],[description]) VALUES (N'${audioSeriesId}',N'en',N'Least-privilege proof audio series',N'');`,
    ],
    [
      'SearchIndexRequest INSERT (audio scope)',
      `INSERT INTO [dbo].[SearchIndexRequest] ([scopeKind],[scopeId]) VALUES (N'audio',N'${trackId}');`,
    ],
  ] as const) {
    await expectAllowed(app, label, statement, 'the save path writes its own rows');
  }

  for (const [table, where] of [
    ['AudioTrackTopic', `[trackId]=N'${trackId}'`],
    ['AudioTrackSpeaker', `[trackId]=N'${trackId}'`],
    ['AudioTrackLabel', `[trackId]=N'${trackId}'`],
    ['AudioSeriesLabel', `[seriesId]=N'${audioSeriesId}'`],
  ] as const) {
    await expectAllowed(
      app,
      `${table} DELETE`,
      `DELETE FROM [dbo].[${table}] WHERE ${where};`,
      'a replaceable relation set can be cleared before it is rewritten',
    );
  }

  for (const table of ['AudioTrack', 'AudioSeries']) {
    await expectDenied(app, `${table} DELETE denied`, `DELETE FROM [dbo].[${table}];`);
    await expectDenied(
      app,
      `${table}SlugHistory UPDATE denied`,
      `UPDATE [dbo].[${table}SlugHistory] SET [slug]=[slug];`,
    );
    await expectDenied(
      app,
      `${table}SlugHistory DELETE denied`,
      `DELETE FROM [dbo].[${table}SlugHistory];`,
    );
    await expectDenied(
      app,
      `${table}Label UPDATE denied`,
      `UPDATE [dbo].[${table}Label] SET [title]=[title];`,
    );
    await expectDenied(
      app,
      `${table} ALTER denied`,
      `ALTER TABLE [dbo].[${table}] DROP CONSTRAINT [${table}_state_ck];`,
    );
  }
  for (const table of ['AudioTrackSpeaker', 'AudioTrackTopic']) {
    await expectDenied(
      app,
      `${table} UPDATE denied`,
      `UPDATE [dbo].[${table}] SET [trackId]=[trackId];`,
    );
  }

  // ---- Phase 12: Media — Photo, Gallery, GalleryItem ------------------------
  //
  // THE SAME THREE POSTURES, across the photograph shapes, each proved to WORK
  // and to REFUSE. The invariants are proved as refusals BY THE DATABASE rather
  // than by a grant: a renamed Gallery keeps its former slug (the trigger); a
  // published Photo must have an image, recorded dimensions exist exactly with
  // an image and within bounds, and a date is a real partial date (the CHECKs);
  // one image serves one Photo and one place in a Gallery holds one Photo (the
  // unique indexes); a Gallery holds at most 240 (the position CHECK); and
  // neither an Asset a Photo names nor a Photo a Gallery holds can be deleted
  // out from under it (the foreign keys). Removing a Gallery's membership
  // leaves its Photos exactly where they were.
  const photoRun = randomUUID().replaceAll('-', '');
  const photoId = randomUUID();
  const secondPhotoId = randomUUID();
  const thirdPhotoId = randomUUID();
  const imageAssetId = randomUUID();
  const galleryId = randomUUID();
  const gallerySlug = `gallery-proof-${photoRun}`;

  await expectAllowed(
    app,
    'Asset INSERT (a cleared image, as Storage records it)',
    `INSERT INTO [dbo].[Asset] ([id],[storageKey],[mediaType],[byteSize],[checksum],[state],[updatedAt]) VALUES (N'${imageAssetId}',N'cc/dd/${photoRun}',N'image/png',361,N'${'f'.repeat(64)}',N'clean',SYSUTCDATETIME());`,
    'Storage records the image it cleared',
  );
  await expectAllowed(
    app,
    'Photo INSERT',
    `INSERT INTO [dbo].[Photo] ([id],[primaryLocale],[state],[takenYear],[takenMonth],[assetId],[width],[height]) VALUES
       (N'${photoId}',N'en',N'draft',1995,3,N'${imageAssetId}',48,32),
       (N'${secondPhotoId}',N'en',N'draft',NULL,NULL,NULL,NULL,NULL),
       (N'${thirdPhotoId}',N'en',N'draft',NULL,NULL,NULL,NULL,NULL);`,
    'a Photo with its image and two with none yet',
  );
  await expectAllowed(
    app,
    'Photo UPDATE (publish)',
    `UPDATE [dbo].[Photo] SET [state]=N'published',[version]=[version]+1 WHERE [id]=N'${photoId}';`,
    'a Photo with an image is published',
  );
  await expectAllowed(
    app,
    'Gallery INSERT and rename',
    `INSERT INTO [dbo].[Gallery] ([id],[slug],[primaryLocale],[state]) VALUES (N'${galleryId}',N'${gallerySlug}',N'en',N'draft');
     UPDATE [dbo].[Gallery] SET [slug]=N'${gallerySlug}-renamed',[version]=[version]+1 WHERE [id]=N'${galleryId}';`,
    'a Gallery is created and renamed by the runtime',
  );

  const [galleryReservations] = await app.query<{ count: number }>(
    `SELECT COUNT_BIG(*) AS count FROM [dbo].[GallerySlugHistory] WHERE [galleryId]=N'${galleryId}';`,
  );
  if (Number(galleryReservations?.count) === 2) {
    pass('Gallery slugs reserved by the database', 'the former and the current slug');
  } else {
    fail(
      'Gallery slugs reserved by the database',
      `expected 2 reservations, found ${String(galleryReservations?.count ?? 0)}`,
    );
  }

  for (const [label, statement] of [
    [
      'PhotoLabel INSERT',
      `INSERT INTO [dbo].[PhotoLabel] ([photoId],[locale],[altText],[caption]) VALUES (N'${photoId}',N'en',N'Least-privilege proof alternative text',NULL);`,
    ],
    [
      'GalleryLabel INSERT',
      `INSERT INTO [dbo].[GalleryLabel] ([galleryId],[locale],[title],[description]) VALUES (N'${galleryId}',N'en',N'Least-privilege proof gallery',N'');`,
    ],
    [
      'GalleryItem INSERT',
      `INSERT INTO [dbo].[GalleryItem] ([galleryId],[photoId],[position]) VALUES (N'${galleryId}',N'${photoId}',0),(N'${galleryId}',N'${secondPhotoId}',1);`,
    ],
  ] as const) {
    await expectAllowed(app, label, statement, 'the save path writes its own rows');
  }

  await expectRefusedByInvariant(
    app,
    'A published Photo has an image',
    `UPDATE [dbo].[Photo] SET [state]=N'published' WHERE [id]=N'${secondPhotoId}';`,
    547,
  );
  await expectRefusedByInvariant(
    app,
    'Dimensions exist only with an image',
    `UPDATE [dbo].[Photo] SET [width]=10,[height]=10 WHERE [id]=N'${secondPhotoId}';`,
    547,
  );
  await expectRefusedByInvariant(
    app,
    'Recorded dimensions stay within the admission bound',
    `UPDATE [dbo].[Photo] SET [width]=16384,[height]=16384 WHERE [id]=N'${photoId}';`,
    547,
  );
  for (const [label, columns] of [
    [
      'A date is a real day of its month',
      '[takenYear]=2023,[takenMonth]=2,[takenDay]=29',
    ],
    [
      'A day never stands without its month',
      '[takenYear]=1989,[takenMonth]=NULL,[takenDay]=4',
    ],
    ['A month is one of twelve', '[takenYear]=1989,[takenMonth]=13,[takenDay]=NULL'],
    [
      'A year is not before photography',
      '[takenYear]=1700,[takenMonth]=NULL,[takenDay]=NULL',
    ],
  ] as const) {
    await expectRefusedByInvariant(
      app,
      label,
      `UPDATE [dbo].[Photo] SET ${columns} WHERE [id]=N'${secondPhotoId}';`,
      547,
    );
  }
  await expectRefusedByInvariant(
    app,
    'A label says something',
    `INSERT INTO [dbo].[PhotoLabel] ([photoId],[locale],[altText],[caption]) VALUES (N'${secondPhotoId}',N'en',NULL,NULL);`,
    547,
  );
  await expectRefusedByInvariant(
    app,
    'One image serves one Photo',
    `UPDATE [dbo].[Photo] SET [assetId]=N'${imageAssetId}',[width]=48,[height]=32 WHERE [id]=N'${secondPhotoId}';`,
    2601,
  );
  await expectRefusedByInvariant(
    app,
    'A Photo is in a Gallery once',
    `INSERT INTO [dbo].[GalleryItem] ([galleryId],[photoId],[position]) VALUES (N'${galleryId}',N'${photoId}',5);`,
    2627,
  );
  await expectRefusedByInvariant(
    app,
    'A place in a Gallery holds one Photo',
    `INSERT INTO [dbo].[GalleryItem] ([galleryId],[photoId],[position]) VALUES (N'${galleryId}',N'${thirdPhotoId}',0);`,
    2627,
  );
  await expectRefusedByInvariant(
    app,
    'A Gallery holds at most 240 Photos',
    `INSERT INTO [dbo].[GalleryItem] ([galleryId],[photoId],[position]) VALUES (N'${galleryId}',N'${thirdPhotoId}',240);`,
    547,
  );
  await expectRefusedByInvariant(
    app,
    'A Photo a Gallery holds exists',
    `INSERT INTO [dbo].[GalleryItem] ([galleryId],[photoId],[position]) VALUES (N'${galleryId}',N'${randomUUID()}',7);`,
    547,
  );
  await expectRefusedByInvariant(
    app,
    'An Asset a Photo names cannot be deleted',
    `DELETE FROM [dbo].[Asset] WHERE [id]=N'${imageAssetId}';`,
    547,
  );

  // Membership is replaceable, and removing it removes no Photo.
  await expectAllowed(
    app,
    'GalleryItem DELETE',
    `DELETE FROM [dbo].[GalleryItem] WHERE [galleryId]=N'${galleryId}';`,
    'a membership is cleared before it is rewritten',
  );
  const [photosLeft] = await app.query<{ count: number }>(
    `SELECT COUNT_BIG(*) AS count FROM [dbo].[Photo] WHERE [id] IN (N'${photoId}',N'${secondPhotoId}',N'${thirdPhotoId}');`,
  );
  if (Number(photosLeft?.count) === 3) {
    pass('Clearing a Gallery removes no Photo', 'every Photo remains');
  } else {
    fail(
      'Clearing a Gallery removes no Photo',
      `found ${String(photosLeft?.count ?? 0)}`,
    );
  }
  for (const [table, where] of [
    ['PhotoLabel', `[photoId]=N'${photoId}'`],
    ['GalleryLabel', `[galleryId]=N'${galleryId}'`],
  ] as const) {
    await expectAllowed(
      app,
      `${table} DELETE`,
      `DELETE FROM [dbo].[${table}] WHERE ${where};`,
      'a replaceable label set can be cleared before it is rewritten',
    );
  }

  for (const table of ['Photo', 'Gallery']) {
    await expectDenied(app, `${table} DELETE denied`, `DELETE FROM [dbo].[${table}];`);
    await expectDenied(
      app,
      `${table}Label UPDATE denied`,
      `UPDATE [dbo].[${table}Label] SET [locale]=[locale];`,
    );
    await expectDenied(
      app,
      `${table} ALTER denied`,
      `ALTER TABLE [dbo].[${table}] DROP CONSTRAINT [${table}_state_ck];`,
    );
  }
  await expectDenied(
    app,
    'GallerySlugHistory UPDATE denied',
    'UPDATE [dbo].[GallerySlugHistory] SET [slug]=[slug];',
  );
  await expectDenied(
    app,
    'GallerySlugHistory DELETE denied',
    'DELETE FROM [dbo].[GallerySlugHistory];',
  );
  await expectDenied(
    app,
    'GalleryItem UPDATE denied',
    'UPDATE [dbo].[GalleryItem] SET [photoId]=[photoId];',
  );

  // ---- Phase 16: Global Network — Country, Region, City, Centre -------------
  //
  // THE SAME THREE POSTURES, each proved to WORK and to REFUSE, through the
  // RUNTIME login. The directory's integrity is proved as refusals BY THE
  // DATABASE, each by the ONE constraint that owns it, so a proof of the
  // composite same-Country key cannot pass on a plain parent key:
  //
  //   - every reference below Country names a parent OF THE SAME Country (the
  //     composite foreign keys), and no Region or City can leave its Country
  //     (the slug histories reference (id, countryId));
  //   - a Centre holds at most one locality fact, a virtual Centre none and no
  //     coordinates, and coordinates are both-or-neither and in range (CHECKs);
  //   - a former slug stays reserved — globally for a Country and a Centre, per
  //     Country for a Region — and the same Region slug in ANOTHER Country is
  //     lawful (the triggers and the history primary keys);
  //   - a contact is a phone, an email or an HTTPS website, in one of twelve
  //     places, listed once; a City is served once (CHECKs and keys);
  //   - a News revision names a Centre that exists (the foreign key).
  //
  // Synthetic throughout: user-assigned ISO codes (QM, QN), `lp-proof-` slugs,
  // a placeholder telephone number and `.invalid` addresses.
  const globalRun = randomUUID().replaceAll('-', '').slice(0, 16);
  const g = (name: string): string => `lp-proof-${name}-${globalRun}`;
  const countryA = randomUUID();
  const countryB = randomUUID();
  const regionA1 = randomUUID();
  const regionA2 = randomUUID();
  const regionA3 = randomUUID();
  const regionB1 = randomUUID();
  const cityA1 = randomUUID();
  const cityA2 = randomUUID();
  const cityA3 = randomUUID();
  const cityB1 = randomUUID();
  const centreA = randomUUID();
  const centreRegional = randomUUID();
  const centreVirtual = randomUUID();

  const globalRuntime = app;
  async function globalReservations(
    label: string,
    table: string,
    column: string,
    id: string,
    expected: number,
  ): Promise<void> {
    const [row] = await globalRuntime.query<{ count: number }>(
      `SELECT COUNT_BIG(*) AS count FROM [dbo].[${table}] WHERE [${column}]=N'${id}';`,
    );
    if (Number(row?.count) === expected) {
      pass(label, `${String(expected)} reservation(s), written by the database`);
    } else {
      fail(label, `expected ${String(expected)}, found ${String(row?.count ?? 0)}`);
    }
  }

  await expectAllowed(
    app,
    'Country INSERT and rename',
    `INSERT INTO [dbo].[Country] ([id],[code],[slug],[primaryLocale],[state]) VALUES
       (N'${countryA}',N'QM',N'${g('country-a')}',N'en',N'draft'),
       (N'${countryB}',N'QN',N'${g('country-b')}',N'en',N'draft');
     UPDATE [dbo].[Country] SET [slug]=N'${g('country-a-renamed')}',[state]=N'published',[version]=[version]+1 WHERE [id]=N'${countryA}';`,
    'two Countries are created, and one renamed and published',
  );
  await globalReservations(
    'Country slugs reserved',
    'CountrySlugHistory',
    'countryId',
    countryA,
    2,
  );
  await expectAllowed(
    app,
    'Region INSERT and rename',
    `INSERT INTO [dbo].[Region] ([id],[countryId],[slug],[primaryLocale],[state]) VALUES
       (N'${regionA1}',N'${countryA}',N'${g('region')}',N'en',N'draft'),
       (N'${regionA2}',N'${countryA}',N'${g('region-two')}',N'en',N'draft'),
       (N'${regionA3}',N'${countryA}',N'${g('region-three')}',N'en',N'draft');
     UPDATE [dbo].[Region] SET [slug]=N'${g('region-renamed')}',[version]=[version]+1 WHERE [id]=N'${regionA1}';`,
    'three Regions of one Country, one renamed',
  );
  await globalReservations(
    'Region slugs reserved',
    'RegionSlugHistory',
    'regionId',
    regionA1,
    2,
  );
  await expectAllowed(
    app,
    'Same Region slug in another Country',
    `INSERT INTO [dbo].[Region] ([id],[countryId],[slug],[primaryLocale],[state]) VALUES (N'${regionB1}',N'${countryB}',N'${g('region-renamed')}',N'en',N'draft');`,
    'Region slugs are scoped by their Country',
  );
  await expectAllowed(
    app,
    'City INSERT and rename',
    `INSERT INTO [dbo].[City] ([id],[countryId],[regionId],[slug],[primaryLocale],[state]) VALUES
       (N'${cityA1}',N'${countryA}',N'${regionA1}',N'${g('city')}',N'en',N'draft'),
       (N'${cityA2}',N'${countryA}',NULL,N'${g('city-two')}',N'en',N'draft'),
       (N'${cityA3}',N'${countryA}',NULL,N'${g('city-three')}',N'en',N'draft'),
       (N'${cityB1}',N'${countryB}',N'${regionB1}',N'${g('city')}',N'en',N'draft');
     UPDATE [dbo].[City] SET [slug]=N'${g('city-renamed')}',[version]=[version]+1 WHERE [id]=N'${cityA1}';`,
    'Cities with and without a Region, one renamed',
  );
  await globalReservations('City slugs reserved', 'CitySlugHistory', 'cityId', cityA1, 2);
  await expectAllowed(
    app,
    'City moves between its Country Regions',
    `UPDATE [dbo].[City] SET [regionId]=N'${regionA2}',[version]=[version]+1 WHERE [id]=N'${cityA1}';`,
    'a City changes Region within its own Country',
  );
  await expectAllowed(
    app,
    'Centre INSERT, rename and return',
    `INSERT INTO [dbo].[Centre] ([id],[slug],[countryId],[regionId],[cityId],[isVirtual],[latitude],[longitude],[primaryLocale],[state]) VALUES
       (N'${centreA}',N'${g('centre')}',N'${countryA}',NULL,N'${cityA1}',0,24.860700,67.001100,N'en',N'draft'),
       (N'${centreRegional}',N'${g('centre-regional')}',N'${countryA}',N'${regionA2}',NULL,0,NULL,NULL,N'en',N'draft'),
       (N'${centreVirtual}',N'${g('centre-virtual')}',N'${countryA}',NULL,NULL,1,NULL,NULL,N'en',N'draft');
     UPDATE [dbo].[Centre] SET [slug]=N'${g('centre-renamed')}',[version]=[version]+1 WHERE [id]=N'${centreA}';
     UPDATE [dbo].[Centre] SET [slug]=N'${g('centre')}',[state]=N'published',[version]=[version]+1 WHERE [id]=N'${centreA}';`,
    'physical, regional and virtual Centres; a slug returning to its own Centre',
  );
  await globalReservations(
    'Centre slugs reserved',
    'CentreSlugHistory',
    'centreId',
    centreA,
    2,
  );

  for (const [label, statement] of [
    [
      'CountryLabel INSERT',
      `INSERT INTO [dbo].[CountryLabel] ([countryId],[locale],[name]) VALUES (N'${countryA}',N'en',N'Least-privilege proof country');`,
    ],
    [
      'RegionLabel INSERT',
      `INSERT INTO [dbo].[RegionLabel] ([regionId],[locale],[name]) VALUES (N'${regionA1}',N'en',N'Least-privilege proof region');`,
    ],
    [
      'CityLabel INSERT',
      `INSERT INTO [dbo].[CityLabel] ([cityId],[locale],[name]) VALUES (N'${cityA1}',N'en',N'Least-privilege proof city');`,
    ],
    [
      'CentreLabel INSERT',
      `INSERT INTO [dbo].[CentreLabel] ([centreId],[locale],[name],[description],[address]) VALUES (N'${centreA}',N'en',N'Least-privilege proof centre',NULL,N'Least-privilege proof address');`,
    ],
    [
      'CentreServiceCity INSERT',
      `INSERT INTO [dbo].[CentreServiceCity] ([centreId],[cityId],[countryId]) VALUES
         (N'${centreA}',N'${cityA2}',N'${countryA}'),
         (N'${centreA}',N'${cityA3}',N'${countryA}'),
         (N'${centreVirtual}',N'${cityA1}',N'${countryA}');`,
    ],
    [
      'CentreContact INSERT',
      `INSERT INTO [dbo].[CentreContact] ([centreId],[position],[channel],[value]) VALUES
         (N'${centreA}',0,N'phone',N'+00 000 0000'),
         (N'${centreA}',1,N'email',N'proof@example.invalid'),
         (N'${centreA}',2,N'website',N'https://proof.example.invalid/');`,
    ],
  ] as const) {
    await expectAllowed(app, label, statement, 'the save path writes its own rows');
  }
  await expectAllowed(
    app,
    'CentreServiceCity DELETE',
    `DELETE FROM [dbo].[CentreServiceCity] WHERE [centreId]=N'${centreA}' AND [cityId]=N'${cityA3}';`,
    'a served-City set is replaced wholesale',
  );
  await expectAllowed(
    app,
    'CentreContact DELETE',
    `DELETE FROM [dbo].[CentreContact] WHERE [centreId]=N'${centreA}' AND [position]=1;`,
    'a contact list is replaced wholesale',
  );

  // Refused by the database, each by its own constraint.
  const centreColumns =
    '[id],[slug],[countryId],[regionId],[cityId],[isVirtual],[latitude],[longitude],[primaryLocale],[state]';
  for (const [label, statement, numbers, constraint] of [
    [
      'A Region belongs to a real Country',
      `INSERT INTO [dbo].[Region] ([id],[countryId],[slug],[primaryLocale],[state]) VALUES (N'${randomUUID()}',N'${randomUUID()}',N'${g('orphan')}',N'en',N'draft');`,
      CONSTRAINT_VIOLATION,
      'Region_countryId_fkey',
    ],
    [
      'A City names its own Country Region',
      `INSERT INTO [dbo].[City] ([id],[countryId],[regionId],[slug],[primaryLocale],[state]) VALUES (N'${randomUUID()}',N'${countryA}',N'${regionB1}',N'${g('cross-city')}',N'en',N'draft');`,
      CONSTRAINT_VIOLATION,
      'City_regionId_countryId_fkey',
    ],
    [
      'A Centre names its own Country City',
      `INSERT INTO [dbo].[Centre] (${centreColumns}) VALUES (N'${randomUUID()}',N'${g('cross-centre')}',N'${countryA}',NULL,N'${cityB1}',0,NULL,NULL,N'en',N'draft');`,
      CONSTRAINT_VIOLATION,
      'Centre_cityId_countryId_fkey',
    ],
    [
      'A Centre names its own Country Region',
      `INSERT INTO [dbo].[Centre] (${centreColumns}) VALUES (N'${randomUUID()}',N'${g('cross-centre')}',N'${countryA}',N'${regionB1}',NULL,0,NULL,NULL,N'en',N'draft');`,
      CONSTRAINT_VIOLATION,
      'Centre_regionId_countryId_fkey',
    ],
    [
      'A Centre holds one locality fact',
      `INSERT INTO [dbo].[Centre] (${centreColumns}) VALUES (N'${randomUUID()}',N'${g('two-facts')}',N'${countryA}',N'${regionA2}',N'${cityA2}',0,NULL,NULL,N'en',N'draft');`,
      CONSTRAINT_VIOLATION,
      'Centre_locality_ck',
    ],
    [
      'A virtual Centre has no City',
      `INSERT INTO [dbo].[Centre] (${centreColumns}) VALUES (N'${randomUUID()}',N'${g('virtual-city')}',N'${countryA}',NULL,N'${cityA2}',1,NULL,NULL,N'en',N'draft');`,
      CONSTRAINT_VIOLATION,
      'Centre_virtual_ck',
    ],
    [
      'A virtual Centre has no coordinates',
      `UPDATE [dbo].[Centre] SET [latitude]=1,[longitude]=1 WHERE [id]=N'${centreVirtual}';`,
      CONSTRAINT_VIOLATION,
      'Centre_virtual_ck',
    ],
    [
      'Latitude stays within -90..90',
      `UPDATE [dbo].[Centre] SET [latitude]=91 WHERE [id]=N'${centreA}';`,
      CONSTRAINT_VIOLATION,
      'Centre_coordinates_ck',
    ],
    [
      'Longitude stays within -180..180',
      `UPDATE [dbo].[Centre] SET [longitude]=-181 WHERE [id]=N'${centreA}';`,
      CONSTRAINT_VIOLATION,
      'Centre_coordinates_ck',
    ],
    [
      'Coordinates are both or neither',
      `UPDATE [dbo].[Centre] SET [longitude]=NULL WHERE [id]=N'${centreA}';`,
      CONSTRAINT_VIOLATION,
      'Centre_coordinates_ck',
    ],
    [
      'A served City is of its Country',
      `INSERT INTO [dbo].[CentreServiceCity] ([centreId],[cityId],[countryId]) VALUES (N'${centreA}',N'${cityB1}',N'${countryA}');`,
      CONSTRAINT_VIOLATION,
      'CentreServiceCity_cityId_countryId_fkey',
    ],
    [
      'A served Country is the Centre one',
      `INSERT INTO [dbo].[CentreServiceCity] ([centreId],[cityId],[countryId]) VALUES (N'${centreA}',N'${cityB1}',N'${countryB}');`,
      CONSTRAINT_VIOLATION,
      'CentreServiceCity_centreId_countryId_fkey',
    ],
    [
      'A City is served once',
      `INSERT INTO [dbo].[CentreServiceCity] ([centreId],[cityId],[countryId]) VALUES (N'${centreA}',N'${cityA2}',N'${countryA}');`,
      DUPLICATE_KEY,
      'CentreServiceCity_pkey',
    ],
    [
      'A contact is listed once',
      `INSERT INTO [dbo].[CentreContact] ([centreId],[position],[channel],[value]) VALUES (N'${centreA}',5,N'phone',N'+00 000 0000');`,
      DUPLICATE_KEY,
      'CentreContact_centreId_channel_value_key',
    ],
    [
      'A website is HTTPS',
      `INSERT INTO [dbo].[CentreContact] ([centreId],[position],[channel],[value]) VALUES (N'${centreA}',6,N'website',N'http://proof.example.invalid/');`,
      CONSTRAINT_VIOLATION,
      'CentreContact_channel_ck',
    ],
    [
      'A website is never a script',
      `INSERT INTO [dbo].[CentreContact] ([centreId],[position],[channel],[value]) VALUES (N'${centreA}',7,N'website',N'javascript:void(0)');`,
      CONSTRAINT_VIOLATION,
      'CentreContact_channel_ck',
    ],
    [
      'A Centre lists at most twelve contacts',
      `INSERT INTO [dbo].[CentreContact] ([centreId],[position],[channel],[value]) VALUES (N'${centreA}',12,N'email',N'twelve@example.invalid');`,
      CONSTRAINT_VIOLATION,
      'CentreContact_position_ck',
    ],
    [
      'A Country code is upper-case ISO',
      `INSERT INTO [dbo].[Country] ([id],[code],[slug],[primaryLocale],[state]) VALUES (N'${randomUUID()}',N'pk',N'${g('lower-code')}',N'en',N'draft');`,
      CONSTRAINT_VIOLATION,
      'Country_code_ck',
    ],
    [
      'A Region never leaves its Country',
      `UPDATE [dbo].[Region] SET [countryId]=N'${countryB}' WHERE [id]=N'${regionA3}';`,
      CONSTRAINT_VIOLATION,
      'RegionSlugHistory_regionId_countryId_fkey',
    ],
    [
      'A City never leaves its Country',
      `UPDATE [dbo].[City] SET [countryId]=N'${countryB}' WHERE [id]=N'${cityA3}';`,
      CONSTRAINT_VIOLATION,
      'CitySlugHistory_cityId_countryId_fkey',
    ],
    [
      'A former Region slug stays reserved',
      `INSERT INTO [dbo].[Region] ([id],[countryId],[slug],[primaryLocale],[state]) VALUES (N'${randomUUID()}',N'${countryA}',N'${g('region')}',N'en',N'draft');`,
      DUPLICATE_KEY,
      'RegionSlugHistory_pkey',
    ],
    [
      'A former Country slug stays reserved',
      `INSERT INTO [dbo].[Country] ([id],[code],[slug],[primaryLocale],[state]) VALUES (N'${randomUUID()}',N'QO',N'${g('country-a')}',N'en',N'draft');`,
      DUPLICATE_KEY,
      'CountrySlugHistory_pkey',
    ],
    [
      'A former Centre slug stays reserved',
      `INSERT INTO [dbo].[Centre] (${centreColumns}) VALUES (N'${randomUUID()}',N'${g('centre-renamed')}',N'${countryA}',NULL,NULL,1,NULL,NULL,N'en',N'draft');`,
      DUPLICATE_KEY,
      'CentreSlugHistory_pkey',
    ],
    [
      'A News revision names a real Centre',
      `INSERT INTO [dbo].[NewsArticleRevision] ([ownerId],[number],[editorId],[slug],[primaryLanguage],[centreId]) VALUES (N'${newsFixture.ids.NewsArticle}',3,N'${editorialPeople.accountId}',N'${phase13Slugs(newsFixture, 'NewsArticle').current}',N'en',N'${randomUUID()}');`,
      CONSTRAINT_VIOLATION,
      'NewsArticleRevision_centreId_fkey',
    ],
  ] as const) {
    await expectRefusedByConstraint(app, label, statement, numbers, constraint);
  }

  // Centre-scoped News is the ordinary revision write: no grant of its own.
  await expectAllowed(
    app,
    'NewsArticleRevision naming a Centre',
    `INSERT INTO [dbo].[NewsArticleRevision] ([ownerId],[number],[editorId],[slug],[primaryLanguage],[centreId]) VALUES (N'${newsFixture.ids.NewsArticle}',3,N'${editorialPeople.accountId}',N'${phase13Slugs(newsFixture, 'NewsArticle').current}',N'en',N'${centreA}');`,
    'a new revision names an existing Centre',
  );
  await expectDenied(
    app,
    'NewsArticleRevision Centre UPDATE denied',
    'UPDATE [dbo].[NewsArticleRevision] SET [centreId]=NULL;',
  );

  for (const [table, where] of [
    ['CountryLabel', `[countryId]=N'${countryA}'`],
    ['RegionLabel', `[regionId]=N'${regionA1}'`],
    ['CityLabel', `[cityId]=N'${cityA1}'`],
    ['CentreLabel', `[centreId]=N'${centreA}'`],
  ] as const) {
    await expectAllowed(
      app,
      `${table} DELETE`,
      `DELETE FROM [dbo].[${table}] WHERE ${where};`,
      'a replaceable label set can be cleared before it is rewritten',
    );
  }

  // Denied by the grants: no directory record is ever removed, no reservation
  // is rewritten or released, and replaceable sets are never edited in place.
  for (const table of ['Country', 'Region', 'City', 'Centre']) {
    await expectDenied(app, `${table} DELETE denied`, `DELETE FROM [dbo].[${table}];`);
    await expectDenied(
      app,
      `${table}SlugHistory UPDATE denied`,
      `UPDATE [dbo].[${table}SlugHistory] SET [slug]=[slug];`,
    );
    await expectDenied(
      app,
      `${table}SlugHistory DELETE denied`,
      `DELETE FROM [dbo].[${table}SlugHistory];`,
    );
    await expectDenied(
      app,
      `${table}Label UPDATE denied`,
      `UPDATE [dbo].[${table}Label] SET [name]=[name];`,
    );
  }
  await expectDenied(
    app,
    'CentreServiceCity UPDATE denied',
    'UPDATE [dbo].[CentreServiceCity] SET [cityId]=[cityId];',
  );
  await expectDenied(
    app,
    'CentreContact UPDATE denied',
    'UPDATE [dbo].[CentreContact] SET [value]=[value];',
  );
  for (const table of [
    'Country',
    'CountryLabel',
    'CountrySlugHistory',
    'Region',
    'RegionLabel',
    'RegionSlugHistory',
    'City',
    'CityLabel',
    'CitySlugHistory',
    'Centre',
    'CentreLabel',
    'CentreSlugHistory',
    'CentreServiceCity',
    'CentreContact',
  ]) {
    await assertObjectVisible(app, table);
    await expectDenied(
      app,
      `${table} ALTER denied`,
      `ALTER TABLE [dbo].[${table}] ADD [probe] INT NULL;`,
    );
  }
  await expectDenied(
    app,
    'Centre CHECK DROP denied',
    'ALTER TABLE [dbo].[Centre] DROP CONSTRAINT [Centre_virtual_ck];',
  );

  // ---- Phase 14: Event, by the Phase-6 postures ------------------------------
  //
  // FIRST THE WRITE PATH, through the RUNTIME login: the populated recovery
  // fixture — a renamed, independently approved, published Event whose
  // occurrences in a daylight-saving zone store local time and UTC instant,
  // held at the Centre above and associated with the Gallery above — so the
  // grants the application relies on are proven sufficient.
  //
  // THEN EVERY INVARIANT AS A REFUSAL BY THE DATABASE, each by the one
  // constraint or trigger number that owns it, on a second synthetic Event
  // built step by step: an IANA zone name and never an offset; an occurrence in
  // whole minutes, with an end that is both-or-neither and strictly after its
  // start, one start and one place per revision, twelve places and an offset no
  // zone exceeds; a Gallery associated once per revision, in twelve places,
  // that exists; a Centre that exists; and the editorial workflow's 51141–51146
  // and approval CHECKs. 51140 — immutable history — is BELOW the grants, so it
  // is proved through the migration login, which the trigger refuses too.
  //
  // LAST, LEAST PRIVILEGE: no Event row can be deleted, no revision-side row
  // updated or deleted (so no Gallery association can be removed), no Event
  // table altered; and holding a Centre or a Gallery reference grants nothing
  // on Global's or Media's tables, whose rows no Event write touched.
  const ownerSession: SqlSession = admin;
  const ownerRows = async (): Promise<string> =>
    JSON.stringify([
      await ownerSession.query(`SELECT * FROM [dbo].[Centre] WHERE [id]=N'${centreA}';`),
      await ownerSession.query(
        `SELECT * FROM [dbo].[CentreSlugHistory] WHERE [centreId]=N'${centreA}' ORDER BY [slug];`,
      ),
      await ownerSession.query(
        `SELECT * FROM [dbo].[Gallery] WHERE [id]=N'${galleryId}';`,
      ),
      await ownerSession.query(
        `SELECT * FROM [dbo].[GalleryItem] WHERE [galleryId]=N'${galleryId}' ORDER BY [position];`,
      ),
      await ownerSession.query(
        `SELECT * FROM [dbo].[GallerySlugHistory] WHERE [galleryId]=N'${galleryId}' ORDER BY [slug];`,
      ),
    ]);
  const ownerRowsBefore = await ownerRows();

  const eventFixture = newPhase14Fixture();
  const eventReferences = { centreId: centreA, galleryId };
  await writePhase14Fixture(app, eventFixture, {
    authorId: editorialPeople.accountId,
    reviewerId: editorialReviewer,
    personId: editorialPeople.linkedPersonId,
    topicId: editorialTopic.id,
    ...eventReferences,
  });
  const eventSnapshot = await capturePhase14Fixture(app, eventFixture);
  pass(
    'Event runtime writes',
    '8 tables and the audit trail written and read through the actual application principal',
  );

  const eventRun = randomUUID().replaceAll('-', '').slice(0, 16);
  const proofEvent = randomUUID();
  const proofSlug = `lp-proof-event-${eventRun}`;
  const proofRenamed = `lp-proof-event-renamed-${eventRun}`;
  const secondGallery = randomUUID();
  const author = editorialPeople.accountId;
  const eventRevision = (
    number: number,
    editor: string,
    slug: string,
    timezone: string,
    centre: string | null,
  ): string =>
    `INSERT INTO [dbo].[EventRevision] ([ownerId],[number],[editorId],[slug],[primaryLanguage],[timezone],[centreId]) VALUES (N'${proofEvent}',${number},N'${editor}',N'${slug}',N'en',N'${timezone}',${centre === null ? 'NULL' : `N'${centre}'`});`;
  const eventTranslation = (number: number, language = 'en'): string =>
    `INSERT INTO [dbo].[EventRevisionTranslation] ([ownerId],[revisionNumber],[languageCode],[title],[excerpt],[seoTitle],[seoDescription],[document],[html]) VALUES (N'${proofEvent}',${number},N'${language}',N'Least-privilege proof event',N'',N'',N'',N'{"type":"doc","content":[]}',N'<p></p>');`;
  const occurrence = (
    number: number,
    position: number,
    startsLocal: string,
    startsAt: string,
    endsLocal: string | null = null,
    endsAt: string | null = null,
  ): string =>
    `INSERT INTO [dbo].[EventSchedule] ([ownerId],[revisionNumber],[position],[startsLocal],[startsAt],[endsLocal],[endsAt]) VALUES (N'${proofEvent}',${number},${position},'${startsLocal}','${startsAt}',${endsLocal === null ? 'NULL' : `'${endsLocal}'`},${endsAt === null ? 'NULL' : `'${endsAt}'`});`;
  const association = (number: number, position: number, gallery: string): string =>
    `INSERT INTO [dbo].[EventGallery] ([ownerId],[revisionNumber],[position],[galleryId]) VALUES (N'${proofEvent}',${number},${position},N'${gallery}');`;
  const moveTo = (number: number, extra = ''): string =>
    `UPDATE [dbo].[Event] SET [currentRevision]=${number}${extra},[version]=[version]+1 WHERE [id]=N'${proofEvent}';`;

  await expectAllowed(
    app,
    'Event INSERT, first revision and move',
    `INSERT INTO [dbo].[Event] ([id],[slug],[state],[version],[creatorId],[updatedAt]) VALUES (N'${proofEvent}',N'${proofSlug}',N'draft',1,N'${author}',SYSUTCDATETIME());
     INSERT INTO [dbo].[EventSlugHistory] ([ownerId],[slug]) VALUES (N'${proofEvent}',N'${proofSlug}');
     ${eventRevision(1, author, proofSlug, 'America/New_York', centreA)}
     ${eventTranslation(1)}
     ${occurrence(1, 0, '2034-03-04T18:00:00', '2034-03-04T23:00:00', '2034-03-04T19:30:00', '2034-03-05T00:30:00')}
     ${association(1, 0, galleryId)}
     ${moveTo(1)}`,
    'a draft Event with a zone, a Centre, an occurrence and a Gallery',
  );
  await expectAllowed(
    app,
    'Gallery INSERT (a second, for Event proofs)',
    `INSERT INTO [dbo].[Gallery] ([id],[slug],[primaryLocale],[state]) VALUES (N'${secondGallery}',N'lp-proof-event-gallery-${eventRun}',N'en',N'draft');`,
    'Media creates its own Gallery',
  );

  // A revision's zone is a NAME, its Centre real, its number the next one.
  for (const [label, timezone] of [
    ['A zone is never a numeric offset', '+05:00'],
    ['A zone is never a GMT offset', 'GMT+5'],
    ['A zone is never an Etc offset alias', 'Etc/GMT+5'],
    ['A zone is never a bare abbreviation', 'PKT'],
  ] as const) {
    await expectRefusedByConstraint(
      app,
      label,
      eventRevision(2, editorialReviewer, proofSlug, timezone, null),
      CONSTRAINT_VIOLATION,
      'EventRevision_timezone_ck',
    );
  }
  await expectRefusedByConstraint(
    app,
    'An Event revision names a real Centre',
    eventRevision(2, editorialReviewer, proofSlug, 'Asia/Karachi', randomUUID()),
    CONSTRAINT_VIOLATION,
    'EventRevision_centreId_fkey',
  );
  await expectRefusedByInvariant(
    app,
    'Event revisions follow in sequence',
    eventRevision(3, editorialReviewer, proofSlug, 'Asia/Karachi', null),
    51144,
  );
  // Revision 2 is edited by the REVIEWER, so its own approval is self-approval.
  await expectAllowed(
    app,
    'EventRevision INSERT (the next revision)',
    `${eventRevision(2, editorialReviewer, proofSlug, 'Asia/Karachi', null)}
     ${eventTranslation(2)}`,
    'a second revision in another zone with no Centre',
  );
  await expectRefusedByInvariant(
    app,
    'A current Event revision has an occurrence',
    moveTo(2),
    51146,
  );

  // Occurrences of revision 2 (Asia/Karachi, UTC+5): every rule by its CHECK.
  for (const [label, statement, constraint] of [
    [
      'An end is never before its start',
      occurrence(
        2,
        0,
        '2034-03-01T19:00:00',
        '2034-03-01T14:00:00',
        '2034-03-01T18:00:00',
        '2034-03-01T13:00:00',
      ),
      'EventSchedule_end_ck',
    ],
    [
      'An end is never equal to its start',
      occurrence(
        2,
        0,
        '2034-03-01T19:00:00',
        '2034-03-01T14:00:00',
        '2034-03-01T19:00:00',
        '2034-03-01T14:00:00',
      ),
      'EventSchedule_end_ck',
    ],
    [
      'An end has its instant',
      occurrence(
        2,
        0,
        '2034-03-01T19:00:00',
        '2034-03-01T14:00:00',
        '2034-03-01T20:00:00',
      ),
      'EventSchedule_end_ck',
    ],
    [
      'An end instant has its local time',
      occurrence(
        2,
        0,
        '2034-03-01T19:00:00',
        '2034-03-01T14:00:00',
        null,
        '2034-03-01T15:00:00',
      ),
      'EventSchedule_end_ck',
    ],
    [
      'An occurrence is in whole minutes',
      occurrence(2, 0, '2034-03-01T19:00:30', '2034-03-01T14:00:30'),
      'EventSchedule_minute_ck',
    ],
    [
      'An occurrence has at most twelve places',
      occurrence(2, 12, '2034-03-01T19:00:00', '2034-03-01T14:00:00'),
      'EventSchedule_position_ck',
    ],
    [
      'An occurrence place is never negative',
      occurrence(2, -1, '2034-03-01T19:00:00', '2034-03-01T14:00:00'),
      'EventSchedule_position_ck',
    ],
    [
      'Local and UTC differ by no more than a zone',
      occurrence(2, 0, '2034-03-01T19:00:00', '2034-03-02T14:00:00'),
      'EventSchedule_offset_ck',
    ],
    [
      'An occurrence belongs to a real revision',
      occurrence(9, 0, '2034-03-01T19:00:00', '2034-03-01T14:00:00'),
      'EventSchedule_ownerId_revisionNumber_fkey',
    ],
  ] as const) {
    await expectRefusedByConstraint(
      app,
      label,
      statement,
      CONSTRAINT_VIOLATION,
      constraint,
    );
  }
  await expectAllowed(
    app,
    'EventSchedule INSERT (two occurrences)',
    `${occurrence(2, 0, '2034-03-01T19:00:00', '2034-03-01T14:00:00', '2034-03-01T21:00:00', '2034-03-01T16:00:00')}
     ${occurrence(2, 1, '2034-03-02T19:00:00', '2034-03-02T14:00:00')}`,
    'occurrences with and without an end',
  );
  for (const [label, statement, constraint] of [
    [
      'One revision never starts twice at once',
      occurrence(2, 2, '2034-03-01T19:00:00', '2034-03-01T14:00:00'),
      'EventSchedule_ownerId_revisionNumber_startsAt_key',
    ],
    [
      'An occurrence place holds one occurrence',
      occurrence(2, 0, '2034-03-03T19:00:00', '2034-03-03T14:00:00'),
      'EventSchedule_pkey',
    ],
  ] as const) {
    await expectRefusedByConstraint(app, label, statement, DUPLICATE_KEY, constraint);
  }

  // Galleries of revision 2: once each, twelve places, real Galleries.
  await expectAllowed(
    app,
    'EventGallery INSERT',
    association(2, 0, galleryId),
    'a Gallery is associated with the revision',
  );
  await expectRefusedByConstraint(
    app,
    'A Gallery is associated once per revision',
    association(2, 1, galleryId),
    DUPLICATE_KEY,
    'EventGallery_ownerId_revisionNumber_galleryId_key',
  );
  await expectRefusedByConstraint(
    app,
    'A Gallery place holds one Gallery',
    association(2, 0, secondGallery),
    DUPLICATE_KEY,
    'EventGallery_pkey',
  );
  await expectRefusedByConstraint(
    app,
    'An Event has at most twelve Galleries',
    association(2, 12, secondGallery),
    CONSTRAINT_VIOLATION,
    'EventGallery_position_ck',
  );
  await expectRefusedByConstraint(
    app,
    'An Event names a real Gallery',
    association(2, 1, randomUUID()),
    CONSTRAINT_VIOLATION,
    'EventGallery_galleryId_fkey',
  );

  // The workflow, refused by the database whoever writes.
  await expectAllowed(
    app,
    'Event moves to a complete revision',
    moveTo(2),
    'a revision with an occurrence becomes current',
  );
  for (const [label, statement, number] of [
    [
      'A historical occurrence is never added',
      occurrence(1, 1, '2034-03-05T18:00:00', '2034-03-05T23:00:00'),
      51141,
    ],
    [
      'A current revision gains no occurrence',
      occurrence(2, 2, '2034-03-06T19:00:00', '2034-03-06T14:00:00'),
      51141,
    ],
    ['A current revision gains no Gallery', association(2, 1, secondGallery), 51141],
    ['A historical revision gains no translation', eventTranslation(1, 'ur'), 51141],
    [
      'A historical revision gains no Topic',
      `INSERT INTO [dbo].[EventTopic] ([ownerId],[revisionNumber],[topicId]) VALUES (N'${proofEvent}',1,N'${editorialTopic.id}');`,
      51141,
    ],
    [
      'A historical revision gains no speaker',
      `INSERT INTO [dbo].[EventContributor] ([ownerId],[revisionNumber],[personId],[role],[position]) VALUES (N'${proofEvent}',1,N'${editorialPeople.linkedPersonId}',N'speaker',0);`,
      51141,
    ],
    ['Revision history never rewinds', moveTo(1), 51145],
    [
      'An Event is approved by someone other than its editor',
      `UPDATE [dbo].[Event] SET [approvedRevision]=2,[approvedById]=N'${editorialReviewer}' WHERE [id]=N'${proofEvent}';`,
      51142,
    ],
  ] as const) {
    await expectRefusedByInvariant(app, label, statement, number);
  }
  for (const [label, statement] of [
    [
      'An Event is never published unapproved',
      `UPDATE [dbo].[Event] SET [state]=N'published',[publishedAt]=SYSUTCDATETIME() WHERE [id]=N'${proofEvent}';`,
    ],
    [
      'An Event is never approved by its creator',
      `UPDATE [dbo].[Event] SET [approvedRevision]=2,[approvedById]=N'${author}' WHERE [id]=N'${proofEvent}';`,
    ],
    [
      'Approval names the current revision',
      `UPDATE [dbo].[Event] SET [approvedRevision]=1,[approvedById]=N'${editorialReviewer}' WHERE [id]=N'${proofEvent}';`,
    ],
    [
      'An Event is never scheduled unapproved',
      `UPDATE [dbo].[Event] SET [state]=N'scheduled',[scheduledRevision]=2,[scheduledAt]='2099-01-01T00:00:00',[scheduledTimezone]=N'Asia/Karachi',[scheduledById]=N'${editorialReviewer}',[scheduleStatus]=N'pending' WHERE [id]=N'${proofEvent}';`,
    ],
  ] as const) {
    await expectRefusedByConstraint(
      app,
      label,
      statement,
      CONSTRAINT_VIOLATION,
      label === 'An Event is never published unapproved' ||
        label === 'An Event is never scheduled unapproved'
        ? 'Event_publication_ck'
        : 'Event_approval_ck',
    );
  }

  // A rename: the revision's slug must be the record's, and must be reserved.
  await expectAllowed(
    app,
    'EventRevision INSERT (a renamed revision)',
    `${eventRevision(3, author, proofRenamed, 'UTC', centreA)}
     ${eventTranslation(3)}
     ${occurrence(3, 0, '2034-04-01T09:00:00', '2034-04-01T09:00:00')}`,
    'a third revision under a new slug, in UTC',
  );
  await expectRefusedByInvariant(
    app,
    'A current revision carries the record slug',
    moveTo(3),
    51142,
  );
  await expectRefusedByInvariant(
    app,
    'A renamed Event slug is reserved first',
    moveTo(3, `,[slug]=N'${proofRenamed}'`),
    51143,
  );
  await expectAllowed(
    app,
    'Event rename, approval and publication',
    `INSERT INTO [dbo].[EventSlugHistory] ([ownerId],[slug]) VALUES (N'${proofEvent}',N'${proofRenamed}');
     ${moveTo(3, `,[slug]=N'${proofRenamed}'`)}
     UPDATE [dbo].[Event] SET [approvedRevision]=3,[approvedById]=N'${editorialReviewer}',[state]=N'published',[publishedAt]=SYSUTCDATETIME(),[version]=[version]+1 WHERE [id]=N'${proofEvent}';`,
    'reserved, moved, approved independently and published',
  );
  await expectRefusedByConstraint(
    app,
    'A former Event slug stays reserved',
    `INSERT INTO [dbo].[EventSlugHistory] ([ownerId],[slug]) VALUES (N'${eventFixture.eventId}',N'${proofSlug}');`,
    DUPLICATE_KEY,
    'EventSlugHistory_pkey',
  );
  await expectRefusedByConstraint(
    app,
    'Events are not searchable in Phase 14',
    `INSERT INTO [dbo].[SearchIndexRequest] ([scopeKind],[scopeId]) VALUES (N'event',N'${proofEvent}');`,
    CONSTRAINT_VIOLATION,
    'SearchIndexRequest_scopeKind_ck',
  );

  // 51140 is beneath the grants: the MIGRATION login cannot rewrite history
  // either, so an Event's past occurrences and Galleries are history, not data.
  for (const [label, statement] of [
    [
      'EventSchedule is immutable',
      `UPDATE [dbo].[EventSchedule] SET [startsAt]=[startsAt] WHERE [ownerId]=N'${proofEvent}';`,
    ],
    [
      'EventSchedule rows are never deleted',
      `DELETE FROM [dbo].[EventSchedule] WHERE [ownerId]=N'${proofEvent}';`,
    ],
    [
      'EventGallery is immutable',
      `UPDATE [dbo].[EventGallery] SET [position]=[position] WHERE [ownerId]=N'${proofEvent}';`,
    ],
    [
      'EventGallery rows are never deleted',
      `DELETE FROM [dbo].[EventGallery] WHERE [ownerId]=N'${proofEvent}';`,
    ],
    [
      'EventRevision is immutable',
      `UPDATE [dbo].[EventRevision] SET [timezone]=[timezone] WHERE [ownerId]=N'${proofEvent}';`,
    ],
    [
      'EventRevisionTranslation rows are never deleted',
      `DELETE FROM [dbo].[EventRevisionTranslation] WHERE [ownerId]=N'${proofEvent}';`,
    ],
    [
      'EventTopic rows are never deleted',
      `DELETE FROM [dbo].[EventTopic] WHERE [ownerId]=N'${eventFixture.eventId}';`,
    ],
    [
      'EventContributor rows are never deleted',
      `DELETE FROM [dbo].[EventContributor] WHERE [ownerId]=N'${eventFixture.eventId}';`,
    ],
    [
      'EventSlugHistory rows are never deleted',
      `DELETE FROM [dbo].[EventSlugHistory] WHERE [ownerId]=N'${proofEvent}';`,
    ],
  ] as const) {
    await expectRefusedByInvariant(admin, `${label} (migration login)`, statement, 51140);
  }

  // Denied by the grants.
  for (const table of [
    'Event',
    'EventRevision',
    'EventRevisionTranslation',
    'EventTopic',
    'EventContributor',
    'EventSchedule',
    'EventGallery',
    'EventSlugHistory',
  ]) {
    await expectDenied(app, `${table} DELETE denied`, `DELETE FROM [dbo].[${table}];`);
    if (table !== 'Event') {
      const column =
        table === 'EventRevisionTranslation'
          ? 'title'
          : table === 'EventRevision' || table === 'EventSlugHistory'
            ? 'slug'
            : 'ownerId';
      await expectDenied(
        app,
        `${table} UPDATE denied`,
        `UPDATE [dbo].[${table}] SET [${column}]=[${column}];`,
      );
    }
    await assertObjectVisible(app, table);
    await expectDenied(
      app,
      `${table} ALTER denied`,
      `ALTER TABLE [dbo].[${table}] ADD [probe] INT NULL;`,
    );
  }
  await expectDenied(
    app,
    'EventGallery association removal denied',
    `DELETE FROM [dbo].[EventGallery] WHERE [ownerId]=N'${eventFixture.eventId}' AND [galleryId]=N'${galleryId}';`,
  );
  await expectDenied(
    app,
    'EventSchedule CHECK DROP denied',
    'ALTER TABLE [dbo].[EventSchedule] DROP CONSTRAINT [EventSchedule_end_ck];',
  );
  await expectDenied(
    app,
    'EventGallery Gallery key DROP denied',
    'ALTER TABLE [dbo].[EventGallery] DROP CONSTRAINT [EventGallery_galleryId_fkey];',
  );

  // Holding a reference grants nothing on the referenced owner's tables.
  const [ownerAuthority] = await app.query<{ held: number }>(`
    SELECT
      ISNULL(HAS_PERMS_BY_NAME(N'dbo.Centre', N'OBJECT', N'DELETE'), 0)
      + ISNULL(HAS_PERMS_BY_NAME(N'dbo.Centre', N'OBJECT', N'ALTER'), 0)
      + ISNULL(HAS_PERMS_BY_NAME(N'dbo.Centre', N'OBJECT', N'REFERENCES'), 0)
      + ISNULL(HAS_PERMS_BY_NAME(N'dbo.Centre', N'OBJECT', N'CONTROL'), 0)
      + ISNULL(HAS_PERMS_BY_NAME(N'dbo.Centre', N'OBJECT', N'TAKE OWNERSHIP'), 0)
      + ISNULL(HAS_PERMS_BY_NAME(N'dbo.Gallery', N'OBJECT', N'DELETE'), 0)
      + ISNULL(HAS_PERMS_BY_NAME(N'dbo.Gallery', N'OBJECT', N'ALTER'), 0)
      + ISNULL(HAS_PERMS_BY_NAME(N'dbo.Gallery', N'OBJECT', N'REFERENCES'), 0)
      + ISNULL(HAS_PERMS_BY_NAME(N'dbo.Gallery', N'OBJECT', N'CONTROL'), 0)
      + ISNULL(HAS_PERMS_BY_NAME(N'dbo.Gallery', N'OBJECT', N'TAKE OWNERSHIP'), 0) AS held;
  `);
  if (Number(ownerAuthority?.held ?? -1) === 0) {
    pass(
      'Event references grant no owner rights',
      'no DELETE, ALTER, REFERENCES, CONTROL or TAKE OWNERSHIP on Centre or Gallery',
    );
  } else {
    fail(
      'Event references grant no owner rights',
      `${String(ownerAuthority?.held ?? 'unknown')} broad right(s) held on Centre or Gallery`,
    );
  }
  await expectDenied(
    app,
    'Centre DELETE denied to an Event writer',
    `DELETE FROM [dbo].[Centre] WHERE [id]=N'${centreA}';`,
  );
  await expectDenied(
    app,
    'Gallery DELETE denied to an Event writer',
    `DELETE FROM [dbo].[Gallery] WHERE [id]=N'${galleryId}';`,
  );
  if ((await ownerRows()) === ownerRowsBefore) {
    pass(
      'Centre and Gallery untouched by Events',
      'the referenced Centre, Gallery, their slugs and items are exactly as before',
    );
  } else {
    fail(
      'Centre and Gallery untouched by Events',
      'an Event write changed a row Global or Media owns',
    );
  }
  // The populated fixture is exactly as written after every refusal above.
  pass(
    'Event fixture intact',
    await verifyRestoredPhase14(admin, eventFixture, eventSnapshot, eventReferences),
  );

  // ---- Phase 15: Collection, by the Phase-6 postures -------------------------
  //
  // FIRST THE WRITE PATH, through the RUNTIME login: the populated recovery
  // fixture — a renamed, independently approved, published Collection whose
  // current revision gathers all seven member types in one mixed order, and a
  // second Collection scheduled for later — over the Article, News records,
  // Work and Video written above, so the grants the application relies on are
  // proven sufficient.
  //
  // THEN THE MEMBERSHIP INVARIANTS AS REFUSALS BY THE DATABASE, still through
  // the runtime login, each by the constraint, index or trigger that owns it:
  // a place holds exactly one member, in one of one hundred places, of a record
  // that exists in ITS type's table, once per revision; nothing is added to a
  // current revision (51151); an empty revision never becomes current (51156).
  // 51150 — immutable history — is BELOW the grants, so it is proved through
  // the migration login, which the trigger refuses too.
  //
  // LAST, LEAST PRIVILEGE: no Collection row can be deleted, no revision-side
  // row updated or deleted (so no member can be removed, moved or retargeted in
  // place), no Collection table altered; and naming an Article, a News record,
  // a Work or a Video as a member grants nothing on its owner's table, whose
  // rows no Collection write touched.
  const collectionMembers = {
    article: editorialFixture.articleId,
    'news-article': newsFixture.ids.NewsArticle,
    'press-release': newsFixture.ids.PressRelease,
    statement: newsFixture.ids.Statement,
    'media-coverage': newsFixture.ids.MediaCoverage,
    work: libraryWorkId,
    video: firstVideoId,
  } as const;
  const memberOwnerRows = async (): Promise<string> => {
    const rows: unknown[] = [];
    for (const member of PHASE15_MEMBERS)
      rows.push(
        await ownerSession.query(
          `SELECT * FROM [dbo].[${member.table}] WHERE [id]=N'${collectionMembers[member.kind]}';`,
        ),
      );
    return JSON.stringify(rows);
  };
  const memberOwnersBefore = await memberOwnerRows();

  const collectionFixture = newPhase15Fixture();
  const collectionReferences = {
    authorId: editorialPeople.accountId,
    reviewerId: editorialReviewer,
    personId: editorialPeople.linkedPersonId,
    topicId: editorialTopic.id,
    members: collectionMembers,
  };
  await writePhase15Fixture(app, collectionFixture, collectionReferences);
  const collectionSnapshot = await capturePhase15Fixture(app, collectionFixture);
  pass(
    'Collection runtime writes',
    '7 tables and the audit trail written and read through the actual application principal',
  );

  const collectionRun = randomUUID().replaceAll('-', '').slice(0, 16);
  const proofCollection = randomUUID();
  const proofCollectionSlug = `lp-proof-collection-${collectionRun}`;
  const collectionRevision = (number: number): string =>
    `INSERT INTO [dbo].[CollectionRevision] ([ownerId],[number],[editorId],[slug],[primaryLanguage]) VALUES (N'${proofCollection}',${number},N'${author}',N'${proofCollectionSlug}',N'en');
     INSERT INTO [dbo].[CollectionRevisionTranslation] ([ownerId],[revisionNumber],[languageCode],[title],[excerpt],[seoTitle],[seoDescription],[document],[html]) VALUES (N'${proofCollection}',${number},N'en',N'Least-privilege proof collection',N'',N'',N'',N'{"type":"doc","content":[]}',N'<p></p>');`;
  const collectionPlace = (
    number: number,
    position: number,
    members: Readonly<Record<string, string>>,
  ): string =>
    `INSERT INTO [dbo].[CollectionItem] ([ownerId],[revisionNumber],[position]${Object.keys(
      members,
    )
      .map((column) => `,[${column}]`)
      .join('')}) VALUES (N'${proofCollection}',${number},${position}${Object.values(
      members,
    )
      .map((id) => `,N'${id}'`)
      .join('')});`;
  const moveCollection = (number: number): string =>
    `UPDATE [dbo].[Collection] SET [currentRevision]=${number},[version]=[version]+1 WHERE [id]=N'${proofCollection}';`;

  await expectAllowed(
    app,
    'Collection INSERT and a first revision',
    `INSERT INTO [dbo].[Collection] ([id],[slug],[state],[version],[creatorId],[updatedAt]) VALUES (N'${proofCollection}',N'${proofCollectionSlug}',N'draft',1,N'${author}',SYSUTCDATETIME());
     INSERT INTO [dbo].[CollectionSlugHistory] ([ownerId],[slug]) VALUES (N'${proofCollection}',N'${proofCollectionSlug}');
     ${collectionRevision(1)}`,
    'a draft Collection with a revision and no member yet',
  );
  await expectRefusedByInvariant(
    app,
    'A current Collection revision has a member',
    moveCollection(1),
    51156,
  );
  await expectAllowed(
    app,
    'CollectionItem INSERT (a mixed order)',
    `${collectionPlace(1, 0, { workId: libraryWorkId })}
     ${collectionPlace(1, 1, { articleId: editorialFixture.articleId })}
     ${collectionPlace(1, 2, { videoId: firstVideoId })}`,
    'a Work, an Article and a Video share one order',
  );
  for (const [label, statement, numbers, constraint] of [
    [
      'Two Collection members never share a place',
      collectionPlace(1, 0, { statementId: newsFixture.ids.Statement }),
      DUPLICATE_KEY,
      'CollectionItem_pkey',
    ],
    [
      'A record is a member of a revision once',
      collectionPlace(1, 3, { workId: libraryWorkId }),
      DUPLICATE_KEY,
      'CollectionItem_work_key',
    ],
    [
      'A Collection place holds a member',
      `INSERT INTO [dbo].[CollectionItem] ([ownerId],[revisionNumber],[position]) VALUES (N'${proofCollection}',1,4);`,
      CONSTRAINT_VIOLATION,
      'CollectionItem_one_member_ck',
    ],
    [
      'A Collection place holds one member',
      collectionPlace(1, 4, {
        statementId: newsFixture.ids.Statement,
        mediaCoverageId: newsFixture.ids.MediaCoverage,
      }),
      CONSTRAINT_VIOLATION,
      'CollectionItem_one_member_ck',
    ],
    [
      'A Collection holds at most one hundred places',
      collectionPlace(1, 100, { statementId: newsFixture.ids.Statement }),
      CONSTRAINT_VIOLATION,
      'CollectionItem_position_ck',
    ],
    [
      'An Article member is an Article',
      collectionPlace(1, 5, { articleId: libraryWorkId }),
      CONSTRAINT_VIOLATION,
      'CollectionItem_articleId_fkey',
    ],
    [
      'A Video member is a Video',
      collectionPlace(1, 5, { videoId: newsFixture.ids.NewsArticle }),
      CONSTRAINT_VIOLATION,
      'CollectionItem_videoId_fkey',
    ],
  ] as const) {
    await expectRefusedByConstraint(app, label, statement, numbers, constraint);
  }
  await expectAllowed(
    app,
    'Collection moves to a revision with members',
    moveCollection(1),
    'a revision with three members becomes current',
  );
  await expectRefusedByInvariant(
    app,
    'A current Collection revision gains no member',
    collectionPlace(1, 3, { statementId: newsFixture.ids.Statement }),
    51151,
  );
  await expectRefusedByConstraint(
    app,
    'Collections are not searchable in Phase 15',
    `INSERT INTO [dbo].[SearchIndexRequest] ([scopeKind],[scopeId]) VALUES (N'collection',N'${proofCollection}');`,
    CONSTRAINT_VIOLATION,
    'SearchIndexRequest_scopeKind_ck',
  );

  // 51150 is beneath the grants: the MIGRATION login cannot rewrite a
  // Collection's history either, so a published order is history, not data.
  for (const [label, statement] of [
    [
      'CollectionItem is never reordered',
      `UPDATE [dbo].[CollectionItem] SET [position]=[position]+10 WHERE [ownerId]=N'${proofCollection}';`,
    ],
    [
      'CollectionItem is never retargeted',
      `UPDATE [dbo].[CollectionItem] SET [workId]=NULL,[statementId]=N'${newsFixture.ids.Statement}' WHERE [ownerId]=N'${proofCollection}' AND [position]=0;`,
    ],
    [
      'CollectionItem rows are never deleted',
      `DELETE FROM [dbo].[CollectionItem] WHERE [ownerId]=N'${collectionFixture.collectionId}';`,
    ],
    [
      'CollectionRevision is immutable',
      `UPDATE [dbo].[CollectionRevision] SET [slug]=[slug] WHERE [ownerId]=N'${proofCollection}';`,
    ],
    [
      'CollectionRevisionTranslation rows are never deleted',
      `DELETE FROM [dbo].[CollectionRevisionTranslation] WHERE [ownerId]=N'${collectionFixture.collectionId}';`,
    ],
    [
      'CollectionTopic rows are never deleted',
      `DELETE FROM [dbo].[CollectionTopic] WHERE [ownerId]=N'${collectionFixture.collectionId}';`,
    ],
    [
      'CollectionContributor rows are never deleted',
      `DELETE FROM [dbo].[CollectionContributor] WHERE [ownerId]=N'${collectionFixture.collectionId}';`,
    ],
    [
      'CollectionSlugHistory rows are never deleted',
      `DELETE FROM [dbo].[CollectionSlugHistory] WHERE [ownerId]=N'${proofCollection}';`,
    ],
  ] as const) {
    await expectRefusedByInvariant(admin, `${label} (migration login)`, statement, 51150);
  }

  // Denied by the grants.
  for (const table of [
    'Collection',
    'CollectionRevision',
    'CollectionRevisionTranslation',
    'CollectionTopic',
    'CollectionContributor',
    'CollectionItem',
    'CollectionSlugHistory',
  ]) {
    await expectDenied(app, `${table} DELETE denied`, `DELETE FROM [dbo].[${table}];`);
    if (table !== 'Collection') {
      const column =
        table === 'CollectionRevisionTranslation'
          ? 'title'
          : table === 'CollectionRevision' || table === 'CollectionSlugHistory'
            ? 'slug'
            : table === 'CollectionItem'
              ? 'position'
              : 'ownerId';
      await expectDenied(
        app,
        `${table} UPDATE denied`,
        `UPDATE [dbo].[${table}] SET [${column}]=[${column}];`,
      );
    }
    await assertObjectVisible(app, table);
    await expectDenied(
      app,
      `${table} ALTER denied`,
      `ALTER TABLE [dbo].[${table}] ADD [probe] INT NULL;`,
    );
  }
  await expectDenied(
    app,
    'Collection member removal denied',
    `DELETE FROM [dbo].[CollectionItem] WHERE [ownerId]=N'${collectionFixture.collectionId}' AND [workId]=N'${libraryWorkId}';`,
  );
  await expectDenied(
    app,
    'Collection member retarget denied',
    `UPDATE [dbo].[CollectionItem] SET [videoId]=[videoId] WHERE [ownerId]=N'${collectionFixture.collectionId}';`,
  );
  await expectDenied(
    app,
    'CollectionItem CHECK DROP denied',
    'ALTER TABLE [dbo].[CollectionItem] DROP CONSTRAINT [CollectionItem_one_member_ck];',
  );
  await expectDenied(
    app,
    'CollectionItem member key DROP denied',
    'ALTER TABLE [dbo].[CollectionItem] DROP CONSTRAINT [CollectionItem_workId_fkey];',
  );
  await expectDenied(
    app,
    'CollectionItem member index DROP denied',
    'DROP INDEX [CollectionItem_article_key] ON [dbo].[CollectionItem];',
  );

  // Naming a record as a member grants nothing on its owner's table: the
  // runtime's effective rights on each of the seven are exactly the owner's own
  // posture — SELECT, INSERT and UPDATE — and never DELETE, ALTER, REFERENCES,
  // CONTROL or TAKE OWNERSHIP.
  const memberRights = await app.query<{ name: string; held: string | null }>(`
    SELECT t.name,
      (SELECT STRING_AGG(p.permission, N',') WITHIN GROUP (ORDER BY p.permission)
         FROM (VALUES (N'ALTER'),(N'CONTROL'),(N'DELETE'),(N'INSERT'),(N'REFERENCES'),
                      (N'SELECT'),(N'TAKE OWNERSHIP'),(N'UPDATE')) AS p(permission)
        WHERE HAS_PERMS_BY_NAME(N'dbo.' + t.name, N'OBJECT', p.permission) = 1) AS held
    FROM (VALUES ${PHASE15_MEMBERS.map((member) => `(N'${member.table}')`).join(',')}) AS t(name)
    ORDER BY t.name;
  `);
  const unexpectedRights = memberRights.filter(
    (row) => row.held !== 'INSERT,SELECT,UPDATE',
  );
  if (memberRights.length === PHASE15_MEMBERS.length && unexpectedRights.length === 0) {
    pass(
      'Collection members grant no owner rights',
      `exactly SELECT, INSERT and UPDATE on ${memberRights.map((row) => row.name).join(', ')}`,
    );
  } else {
    fail(
      'Collection members grant no owner rights',
      `unexpected effective rights: ${JSON.stringify(unexpectedRights)} of ${String(memberRights.length)}`,
    );
  }
  for (const member of PHASE15_MEMBERS)
    await expectDenied(
      app,
      `${member.table} DELETE denied to a Collection writer`,
      `DELETE FROM [dbo].[${member.table}] WHERE [id]=N'${collectionMembers[member.kind]}';`,
    );
  if ((await memberOwnerRows()) === memberOwnersBefore) {
    pass(
      'Members untouched by Collections',
      'the Article, News records, Work and Video are exactly as before',
    );
  } else {
    fail('Members untouched by Collections', 'a Collection write changed a member row');
  }
  // The populated fixture is exactly as written after every refusal above.
  pass(
    'Collection fixture intact',
    await verifyRestoredPhase15(
      admin,
      collectionFixture,
      collectionSnapshot,
      collectionReferences,
    ),
  );

  // ---- Phase 17: the derived search projection ------------------------------
  //
  // FOUR POSTURES, one per table, and each is the operation the indexer
  // genuinely performs:
  //
  //   - `SearchIndexRequest` is appended to by owners and CONSUMED by the
  //     indexer, so INSERT and DELETE — never UPDATE: a request has no second
  //     state to be moved into.
  //   - `SearchIndexScope` is the per-scope indexing history, never deleted.
  //   - `SearchDocument` is the rebuildable projection, rewritten and removed.
  //   - `SearchDocumentTopic` is a membership set, like every other one here.
  //
  // THE ENGINE IS QUERIED, NEVER CONTROLLED. The runtime must be able to run a
  // full-text query and read the population lag the operator view reports, and
  // must NOT be able to disable, repopulate or drop the index: an index the
  // runtime can switch off is a search a compromised runtime can blind.
  const searchScopeId = randomUUID();

  await expectAllowed(
    app,
    'SearchIndexRequest INSERT',
    `INSERT INTO [dbo].[SearchIndexRequest] ([scopeKind],[scopeId]) VALUES (N'work',N'${searchScopeId}');`,
    'an owner records indexing intent inside its own transaction',
  );
  await expectAllowed(
    app,
    'SearchIndexScope INSERT',
    `INSERT INTO [dbo].[SearchIndexScope] ([scopeKind],[scopeId],[status],[generation],[attempts],[dueAt]) VALUES (N'work',N'${searchScopeId}',N'pending',1,0,SYSUTCDATETIME());`,
    'the indexer folds requests into scope state',
  );
  await expectAllowed(
    app,
    'SearchIndexScope UPDATE',
    `UPDATE [dbo].[SearchIndexScope] SET [status]=N'current',[generation]=[generation]+1 WHERE [scopeKind]=N'work' AND [scopeId]=N'${searchScopeId}';`,
    'scope state advances',
  );
  await expectAllowed(
    app,
    'SearchDocument INSERT',
    `INSERT INTO [dbo].[SearchDocument] ([scopeKind],[scopeId],[kind],[resourceId],[textLanguage],[title],[summary],[matchEnglish],[checksum],[indexedAt]) VALUES (N'work',N'${searchScopeId}',N'work',N'${searchScopeId}',N'en',N'Least-privilege proof document',N'',N'least privilege proof',REPLICATE(N'a',64),SYSUTCDATETIME());`,
    'the projection is written',
  );
  await expectAllowed(
    app,
    'SearchDocumentTopic INSERT',
    `INSERT INTO [dbo].[SearchDocumentTopic] ([documentId],[topicId]) SELECT [id], N'${editorialTopic.id}' FROM [dbo].[SearchDocument] WHERE [scopeId]=N'${searchScopeId}';`,
    'a document carries its derived topic identifiers',
  );
  await expectAllowed(
    app,
    'SearchDocument UPDATE',
    `UPDATE [dbo].[SearchDocument] SET [summary]=N'rewritten' WHERE [scopeId]=N'${searchScopeId}';`,
    'a changed projection is rewritten',
  );

  // THE VISIBILITY HALF of every full-text denial below. SQL Server answers an
  // unauthorised full-text DDL statement with error 7658 — "does not have a
  // full-text index OR user does not have permission" — the same conflation the
  // DDL probes above pair with `assertObjectVisible`. A CONTAINSTABLE query
  // fails with 7601 on a table that is not full-text indexed, so its success
  // through THIS connection proves the index exists, and 7658 afterwards can only
  // mean the second half of that message. The catalogue's refusal, 7641, has the
  // same conflated wording; a full-text index cannot exist outside a catalogue,
  // so the same proof covers it.
  let fullTextVisible = false;
  try {
    await app.query(
      `SELECT COUNT_BIG(*) AS total FROM CONTAINSTABLE([dbo].[SearchDocument], [matchEnglish], N'"proof"', LANGUAGE 1033, 10);`,
    );
    fullTextVisible = true;
    pass(
      'full-text query as the runtime',
      'CONTAINSTABLE is answerable with SELECT alone',
    );
  } catch (error) {
    fail(
      'full-text query as the runtime',
      error instanceof Error ? error.message : 'refused',
    );
  }

  const runtime = app;
  async function expectFullTextDdlDenied(
    label: string,
    statement: string,
  ): Promise<void> {
    if (!fullTextVisible) {
      fail(
        label,
        'the index was not proven visible, so a 7658 refusal would be ambiguous',
      );
      return;
    }
    try {
      await runtime.query(statement);
    } catch (error) {
      const number = errorNumber(error);
      if (
        number === 7658 ||
        number === 7641 ||
        (number !== undefined && PERMISSION_DENIED.has(number))
      ) {
        pass(label, `denied, SQL Server error ${number}`);
        return;
      }
      fail(label, `rejected for the WRONG reason (error ${number ?? 'unknown'})`);
      return;
    }
    fail(label, 'statement SUCCEEDED but must be denied');
  }

  const [lag] = await app.query<{ pending: number | null }>(
    `SELECT CAST(OBJECTPROPERTYEX(OBJECT_ID(N'[dbo].[SearchDocument]'), 'TableFulltextPendingChanges') AS INT) AS pending;`,
  );
  if (lag?.pending === null || lag?.pending === undefined) {
    fail(
      'full-text population lag readable',
      'the runtime cannot read the pending-changes count the operator view reports',
    );
  } else {
    pass('full-text population lag readable', `pending changes: ${String(lag.pending)}`);
  }

  await expectFullTextDdlDenied(
    'full-text index DISABLE denied',
    'ALTER FULLTEXT INDEX ON [dbo].[SearchDocument] DISABLE;',
  );
  await expectFullTextDdlDenied(
    'full-text repopulation denied',
    'ALTER FULLTEXT INDEX ON [dbo].[SearchDocument] START FULL POPULATION;',
  );
  await expectFullTextDdlDenied(
    'full-text index DROP denied',
    'DROP FULLTEXT INDEX ON [dbo].[SearchDocument];',
  );
  await expectFullTextDdlDenied(
    'full-text catalogue DROP denied',
    'DROP FULLTEXT CATALOG [SearchCatalog];',
  );
  await expectDenied(
    app,
    'SearchDocument ALTER denied',
    'ALTER TABLE [dbo].[SearchDocument] DROP CONSTRAINT [SearchDocument_kind_ck];',
  );
  await expectDenied(
    app,
    'SearchIndexRequest UPDATE denied',
    'UPDATE [dbo].[SearchIndexRequest] SET [scopeId]=[scopeId];',
  );
  await expectDenied(
    app,
    'SearchDocumentTopic UPDATE denied',
    'UPDATE [dbo].[SearchDocumentTopic] SET [topicId]=[topicId];',
  );
  await expectDenied(
    app,
    'SearchIndexScope DELETE denied',
    `DELETE FROM [dbo].[SearchIndexScope] WHERE [scopeId]=N'${searchScopeId}';`,
  );
  await expectAllowed(
    app,
    'SearchDocument DELETE',
    `DELETE FROM [dbo].[SearchDocument] WHERE [scopeId]=N'${searchScopeId}';`,
    'a withdrawn projection is removed (its topics cascade)',
  );
  await expectAllowed(
    app,
    'SearchIndexRequest DELETE',
    `DELETE FROM [dbo].[SearchIndexRequest] WHERE [scopeId]=N'${searchScopeId}';`,
    'a relayed request is consumed',
  );

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
