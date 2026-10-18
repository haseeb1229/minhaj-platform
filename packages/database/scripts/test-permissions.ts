import { createHash, randomUUID } from 'node:crypto';
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
    quranProvisioned: number;
    hadithProvisioned: number;
    newsletterProvisioned: number;
    learningProvisioned: number;
    classesProvisioned: number;
    membershipProvisioned: number;
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
             AS globalProvisioned,
           SUM(CASE WHEN [action] = N'quran.permissions.provisioned'
                     AND [actorType] = N'migration' THEN 1 ELSE 0 END)
             AS quranProvisioned,
           SUM(CASE WHEN [action] = N'hadith.permissions.provisioned'
                     AND [actorType] = N'migration' THEN 1 ELSE 0 END)
             AS hadithProvisioned,
           SUM(CASE WHEN [action] = N'newsletter.permissions.provisioned'
                     AND [actorType] = N'migration' THEN 1 ELSE 0 END)
             AS newsletterProvisioned,
           SUM(CASE WHEN [action] = N'learning.permissions.provisioned'
                     AND [actorType] = N'migration' THEN 1 ELSE 0 END)
             AS learningProvisioned,
           SUM(CASE WHEN [action] = N'learning.classes.permissions.provisioned'
                     AND [actorType] = N'migration' THEN 1 ELSE 0 END)
             AS classesProvisioned,
           SUM(CASE WHEN [action] = N'membership.permissions.provisioned'
                     AND [actorType] = N'migration' THEN 1 ELSE 0 END)
             AS membershipProvisioned
    FROM [dbo].[AuditLog];
  `);

  // Exactly fifteen rows: the Phase-3B through Phase-26 privilege extensions
  // (Phase 10's and Phase 16's included; Phases 20 and 24 bundle nothing and so
  // record nothing), and this run's probe. Naming every migration action is load-bearing:
  // deriving the expected total from whatever provisioning rows happened to
  // survive would pass if a phase omitted its own audit, and each privilege
  // extension must be able to show that it paid for itself
  // (SECURITY_BASELINE.md §8.1).
  const EXPECTED_AUDIT_ROWS = 15;

  if (
    Number(survivor?.taxonomyProvisioned ?? 0) !== 1 ||
    Number(survivor?.navigationProvisioned ?? 0) !== 1 ||
    Number(survivor?.peopleProvisioned ?? 0) !== 1 ||
    Number(survivor?.editorialProvisioned ?? 0) !== 1 ||
    Number(survivor?.libraryProvisioned ?? 0) !== 1 ||
    Number(survivor?.searchProvisioned ?? 0) !== 1 ||
    Number(survivor?.mediaProvisioned ?? 0) !== 1 ||
    Number(survivor?.globalProvisioned ?? 0) !== 1 ||
    Number(survivor?.quranProvisioned ?? 0) !== 1 ||
    Number(survivor?.hadithProvisioned ?? 0) !== 1 ||
    Number(survivor?.newsletterProvisioned ?? 0) !== 1 ||
    Number(survivor?.learningProvisioned ?? 0) !== 1 ||
    Number(survivor?.classesProvisioned ?? 0) !== 1 ||
    Number(survivor?.membershipProvisioned ?? 0) !== 1 ||
    Number(survivor?.probe ?? 0) !== 1 ||
    Number(survivor?.tampered ?? -1) !== 0 ||
    Number(survivor?.total ?? 0) !== EXPECTED_AUDIT_ROWS
  ) {
    fail(
      'audit rows unmodified',
      `expected ${EXPECTED_AUDIT_ROWS} rows with 1 taxonomy provisioning, ` +
        `1 navigation provisioning, 1 people provisioning, 1 editorial provisioning, ` +
        `1 library provisioning, 1 search provisioning, 1 media provisioning, ` +
        `1 global provisioning, 1 quran provisioning, 1 hadith provisioning, 1 newsletter provisioning, ` +
        `1 learning provisioning, 1 classes provisioning, 1 membership provisioning, ` +
        `1 probe and ` +
        `0 tampered; found ${survivor?.total ?? 0} rows, ` +
        `${survivor?.taxonomyProvisioned ?? 0} taxonomy provisioning, ` +
        `${survivor?.navigationProvisioned ?? 0} navigation provisioning, ` +
        `${survivor?.peopleProvisioned ?? 0} people provisioning, ` +
        `${survivor?.editorialProvisioned ?? 0} editorial provisioning, ` +
        `${survivor?.libraryProvisioned ?? 0} library provisioning, ` +
        `${survivor?.searchProvisioned ?? 0} search provisioning, ` +
        `${survivor?.mediaProvisioned ?? 0} media provisioning, ` +
        `${survivor?.globalProvisioned ?? 0} global provisioning, ` +
        `${survivor?.quranProvisioned ?? 0} quran provisioning, ` +
        `${survivor?.hadithProvisioned ?? 0} hadith provisioning, ` +
        `${survivor?.newsletterProvisioned ?? 0} newsletter provisioning, ` +
        `${survivor?.learningProvisioned ?? 0} learning provisioning, ` +
        `${survivor?.classesProvisioned ?? 0} classes provisioning, ` +
        `${survivor?.membershipProvisioned ?? 0} membership provisioning, ` +
        `${survivor?.probe ?? 0} probe, ${survivor?.tampered ?? 0} tampered`,
    );
  } else {
    pass(
      'audit rows unmodified',
      'the probe row and all fourteen exact migration records are intact after ' +
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

  // ---- Phase 18: Quran, in four postures ------------------------------------
  //
  // THE SOURCE AND ITS ACTIVATION are the owner's. The runtime reads them and
  // writes nothing, so no permission it carries can register an authority, turn
  // a fixture into one or switch a corpus on.
  //
  // THE CANONICAL TABLES are read-only to it as well. It reaches them ONLY by
  // executing the canonical procedures, which re-check the live
  // `quran.editCanonical` grant and purpose-bound step-up grant in SQL — proved
  // here by the runtime naming an account that holds nothing, and a grant that
  // does not exist, and being refused (51190) — and the authority check itself
  // is denied to it outright. A Surah's display-name version is the one
  // canonical column it may advance.
  //
  // LAYERED WORKS by the Library postures: inserted and updated, never deleted,
  // a slug chosen once; texts, contributors, segments, display names and topic
  // assignments are child rows. Naming a Person, a Topic, a Language or an Asset
  // grants nothing on those owners' tables beyond their own postures.
  //
  // Every statement below is REAL SQL as the runtime principal, over sentinel
  // NON-QURAN text and a fictional two-Surah structure; the sources and the
  // canonical authority are the owner's rows, written first.
  const quranRun = randomUUID().replaceAll('-', '').slice(0, 16);
  const quranText = (label: string, surah: number, ayah: number): string =>
    `NON_QURAN_FIXTURE_${label}_${String(surah)}_${String(ayah)} نص اختبار غير قرآني`;
  const quranAyat = [
    [1, 1, 1],
    [1, 2, 1],
    [1, 3, 1],
    [2, 1, 1],
    [2, 2, 2],
  ] as const;
  const quranSource = randomUUID();
  const quranCorrection = randomUUID();
  const quranHolder = randomUUID();
  const quranRole = randomUUID();
  const quranSession = randomUUID();
  const quranGrant = randomUUID();
  const quranCorrected = quranText('CORRECTED', 1, 2);
  await admin.query(`
    INSERT INTO [dbo].[QuranSource] ([id],[code],[authority],[title],[version],[encoding]) VALUES
      (N'${quranSource}',N'NON_QURAN_FIXTURE_LP_${quranRun}',N'fixture',N'NON_QURAN_FIXTURE least-privilege source',N'proof-1',N'utf-8'),
      (N'${quranCorrection}',N'NON_QURAN_FIXTURE_LP_CORRECTION_${quranRun}',N'fixture',N'NON_QURAN_FIXTURE least-privilege correction',N'proof-1',N'utf-8');
    INSERT INTO [dbo].[QuranSourceSurah] ([sourceId],[number],[ayahCount]) VALUES
      (N'${quranSource}',1,3),(N'${quranSource}',2,2),(N'${quranCorrection}',1,3);
    INSERT INTO [dbo].[QuranSourceAyah] ([sourceId],[surahNumber],[ayahNumber],[juzNumber],[text]) VALUES
      ${quranAyat.map(([surah, ayah, juz]) => `(N'${quranSource}',${String(surah)},${String(ayah)},${String(juz)},N'${quranText('CANONICAL', surah, ayah)}')`).join(',')},
      (N'${quranCorrection}',1,2,1,N'${quranCorrected}');
    INSERT INTO [dbo].[User] ([id],[name],[email],[emailVerified],[createdAt],[updatedAt],[locale],[status],[twoFactorEnabled])
      VALUES (N'${quranHolder}',N'Synthetic Quran canonical holder',N'${quranHolder}@proof.invalid',0,SYSUTCDATETIME(),SYSUTCDATETIME(),N'en',N'active',0);
    INSERT INTO [dbo].[Role] ([id],[key],[name],[description],[system])
      VALUES (N'${quranRole}',N'lp-quran-canonical-${quranRun}',N'Synthetic Quran canonical role',N'Least-privilege proof only.',0);
    INSERT INTO [dbo].[RolePermission] ([roleId],[permissionKey]) VALUES (N'${quranRole}',N'quran.editCanonical');
    INSERT INTO [dbo].[RoleAssignment] ([userId],[roleId]) VALUES (N'${quranHolder}',N'${quranRole}');
    INSERT INTO [dbo].[Session] ([id],[token],[userId],[expiresAt],[createdAt],[updatedAt])
      VALUES (N'${quranSession}',N'lp-quran-${quranSession}',N'${quranHolder}',DATEADD(hour,1,SYSUTCDATETIME()),SYSUTCDATETIME(),SYSUTCDATETIME());
    INSERT INTO [dbo].[StepUpGrant] ([id],[userId],[sessionId],[purpose],[expiresAt])
      VALUES (N'${quranGrant}',N'${quranHolder}',N'${quranSession}',N'quran-canonical-edit',DATEADD(minute,30,SYSUTCDATETIME()));
  `);
  const quranCandidate = JSON.stringify(
    quranAyat.map(([surah, ayah, juz]) => ({
      surah,
      ayah,
      juz,
      text: quranText('CANONICAL', surah, ayah),
    })),
  );
  const quranAccept = (actor: string, grantId: string): string =>
    `EXEC [dbo].[QuranAcceptCorpus] @runId=N'${randomUUID()}', @sourceId=N'${quranSource}', @candidate=N'${quranCandidate}', @actorId=N'${actor}', @sessionId=N'${quranSession}', @stepUpGrantId=N'${grantId}', @at='2026-10-02T00:00:00';`;

  // The runtime cannot borrow an authority it does not hold, nor forge a grant.
  await expectRefusedByInvariant(
    app,
    'Quran acceptance naming an account without authority',
    quranAccept(editorialReviewer, quranGrant),
    51190,
  );
  await expectRefusedByInvariant(
    app,
    'Quran acceptance with a forged step-up grant',
    quranAccept(quranHolder, randomUUID()),
    51190,
  );
  await expectDenied(
    app,
    'QuranAssertCanonicalAuthority EXECUTE denied',
    `EXEC [dbo].[QuranAssertCanonicalAuthority] @actorId=N'${quranHolder}', @sessionId=N'${quranSession}', @stepUpGrantId=N'${quranGrant}';`,
  );
  await expectAllowed(
    app,
    'QuranAcceptCorpus EXECUTE',
    quranAccept(quranHolder, quranGrant),
    'the canonical corpus is written by the procedure, under the live authority',
  );
  await expectAllowed(
    app,
    'QuranCorrectAyah EXECUTE',
    `EXEC [dbo].[QuranCorrectAyah] @runId=N'${randomUUID()}', @surah=1, @ayah=2, @expectedVersion=1, @sourceId=N'${quranCorrection}', @reviewedText=N'${quranCorrected}', @reason=N'Least-privilege proof correction.', @actorId=N'${quranHolder}', @sessionId=N'${quranSession}', @stepUpGrantId=N'${quranGrant}', @at='2026-10-02T00:00:00';`,
    'a correction appends version 2 through the procedure alone',
  );
  await expectAllowed(
    app,
    'QuranRecordVerificationFailure EXECUTE',
    `EXEC [dbo].[QuranRecordVerificationFailure] @runId=N'${randomUUID()}', @kind=N'ayah-correction', @sourceId=N'${quranCorrection}', @checked=1, @mismatches=1, @firstSurah=1, @firstAyah=2, @firstOffset=0, @firstReason=N'text-mismatch', @actorId=N'${quranHolder}', @at='2026-10-02T00:00:00';`,
    'a failed verification is recorded as evidence',
  );

  const QURAN_READ_ONLY = [
    'QuranSource',
    'QuranSourceSurah',
    'QuranSourceAyah',
    'QuranActivation',
    'Juz',
    'Surah',
    'Ayah',
    'QuranAyahRevision',
    'QuranVerificationRun',
  ] as const;
  for (const table of QURAN_READ_ONLY)
    await expectAllowed(
      app,
      `${table} SELECT`,
      `SELECT COUNT_BIG(*) AS [total] FROM [dbo].[${table}];`,
      'the runtime reads it',
    );
  for (const [label, statement] of [
    [
      'QuranSource INSERT denied',
      `INSERT INTO [dbo].[QuranSource] ([id],[code],[authority],[title],[version],[encoding],[reference]) VALUES (N'${randomUUID()}',N'NON_QURAN_FIXTURE_LP_FORGED_${quranRun}',N'approved',N'NON_QURAN_FIXTURE forged',N'proof-1',N'utf-8',N'urn:example:forged');`,
    ],
    [
      'QuranSource UPDATE denied',
      `UPDATE [dbo].[QuranSource] SET [authority]=N'approved',[reference]=N'urn:example:forged' WHERE [id]=N'${quranSource}';`,
    ],
    [
      'QuranSource DELETE denied',
      `DELETE FROM [dbo].[QuranSource] WHERE [id]=N'${quranSource}';`,
    ],
    [
      'QuranSourceSurah INSERT denied',
      `INSERT INTO [dbo].[QuranSourceSurah] ([sourceId],[number],[ayahCount]) VALUES (N'${quranSource}',3,1);`,
    ],
    [
      'QuranSourceAyah UPDATE denied',
      `UPDATE [dbo].[QuranSourceAyah] SET [text]=N'${quranText('TAMPERED', 1, 1)}' WHERE [sourceId]=N'${quranSource}';`,
    ],
    ['QuranSourceAyah DELETE denied', 'DELETE FROM [dbo].[QuranSourceAyah];'],
    [
      'QuranActivation INSERT denied',
      `INSERT INTO [dbo].[QuranActivation] ([id],[sourceId],[authorisedBy]) VALUES (1,N'${quranSource}',N'runtime');`,
    ],
    ['QuranActivation DELETE denied', 'DELETE FROM [dbo].[QuranActivation];'],
    [
      'Juz INSERT denied',
      `INSERT INTO [dbo].[Juz] ([number],[sourceId]) VALUES (3,N'${quranSource}');`,
    ],
    ['Juz DELETE denied', 'DELETE FROM [dbo].[Juz];'],
    [
      'Surah INSERT denied',
      `INSERT INTO [dbo].[Surah] ([number],[ayahCount],[sourceId]) VALUES (3,1,N'${quranSource}');`,
    ],
    [
      'Surah ayahCount UPDATE denied',
      'UPDATE [dbo].[Surah] SET [ayahCount]=[ayahCount];',
    ],
    [
      'Surah nameArabic UPDATE denied',
      'UPDATE [dbo].[Surah] SET [nameArabic]=[nameArabic];',
    ],
    ['Surah DELETE denied', 'DELETE FROM [dbo].[Surah];'],
    [
      'Ayah INSERT denied',
      `INSERT INTO [dbo].[Ayah] ([surahNumber],[ayahNumber],[juzNumber],[text],[sourceId],[version]) VALUES (2,3,2,N'${quranText('DIRECT', 2, 3)}',N'${quranSource}',1);`,
    ],
    [
      'Ayah text UPDATE denied',
      `UPDATE [dbo].[Ayah] SET [text]=N'${quranText('TAMPERED', 1, 1)}' WHERE [surahNumber]=1 AND [ayahNumber]=1;`,
    ],
    ['Ayah DELETE denied', 'DELETE FROM [dbo].[Ayah];'],
    [
      'QuranAyahRevision INSERT denied',
      `INSERT INTO [dbo].[QuranAyahRevision] ([surahNumber],[ayahNumber],[version],[text],[sourceId],[verificationRunId],[actorId],[stepUpGrantId],[reason]) SELECT 1,1,2,N'${quranText('FORGED', 1, 1)}',N'${quranSource}',[id],N'${quranHolder}',N'${quranGrant}',N'forged' FROM [dbo].[QuranVerificationRun] WHERE [kind]=N'corpus-acceptance';`,
    ],
    [
      'QuranAyahRevision UPDATE denied',
      `UPDATE [dbo].[QuranAyahRevision] SET [text]=N'${quranText('TAMPERED', 1, 1)}';`,
    ],
    ['QuranAyahRevision DELETE denied', 'DELETE FROM [dbo].[QuranAyahRevision];'],
    [
      'QuranVerificationRun INSERT denied',
      `INSERT INTO [dbo].[QuranVerificationRun] ([id],[kind],[outcome],[sourceId],[checked],[mismatches]) VALUES (N'${randomUUID()}',N'corpus-acceptance',N'passed',N'${quranSource}',5,0);`,
    ],
    [
      'QuranVerificationRun UPDATE denied',
      `UPDATE [dbo].[QuranVerificationRun] SET [outcome]=[outcome];`,
    ],
    ['QuranVerificationRun DELETE denied', 'DELETE FROM [dbo].[QuranVerificationRun];'],
  ] as const)
    await expectDenied(app, label, statement);
  await expectAllowed(
    app,
    'Surah display-name version UPDATE',
    'UPDATE [dbo].[Surah] SET [namesVersion]=[namesVersion]+1,[updatedAt]=SYSUTCDATETIME() WHERE [number]=1;',
    'the one canonical column the application may advance',
  );

  // The canonical store is exactly what the procedures wrote, after every
  // refused direct write: five ayat, six revisions, the corrected Ayah at
  // version 2, the sources untouched and no activation.
  const [canonicalState] = await admin.query<Record<string, number>>(`
    SELECT
      (SELECT COUNT(*) FROM [dbo].[Ayah]) AS [ayat],
      (SELECT COUNT(*) FROM [dbo].[QuranAyahRevision]) AS [revisions],
      (SELECT COUNT(*) FROM [dbo].[Ayah] a JOIN [dbo].[QuranSourceAyah] s
         ON s.[sourceId]=a.[sourceId] AND s.[surahNumber]=a.[surahNumber] AND s.[ayahNumber]=a.[ayahNumber]
        WHERE CAST(a.[text] AS VARBINARY(8000))=CAST(s.[text] AS VARBINARY(8000))) AS [exact],
      (SELECT [version] FROM [dbo].[Ayah] WHERE [surahNumber]=1 AND [ayahNumber]=2) AS [corrected],
      (SELECT COUNT(*) FROM [dbo].[QuranSource] WHERE [authority]=N'fixture' AND [reference] IS NULL) AS [sources],
      (SELECT COUNT(*) FROM [dbo].[QuranActivation]) AS [activations];
  `);
  if (
    JSON.stringify(canonicalState) ===
    '{"ayat":5,"revisions":6,"exact":5,"corrected":2,"sources":2,"activations":0}'
  ) {
    pass(
      'Quran canonical state intact',
      'only the procedures wrote it; every direct write was refused',
    );
  } else {
    fail('Quran canonical state intact', JSON.stringify(canonicalState));
  }

  // ---- the layered works, through the runtime login --------------------------
  const quranTranslation = randomUUID();
  const quranTransliteration = randomUUID();
  const quranTafsir = randomUUID();
  const quranRecitation = randomUUID();
  const quranRule = randomUUID();
  const quranEntry = randomUUID();
  const quranSegment = randomUUID();
  const quranAsset = randomUUID();
  const quranPerson = editorialPeople.linkedPersonId;
  await expectAllowed(
    app,
    'Quran layered works INSERT',
    `INSERT INTO [dbo].[QuranTranslation] ([id],[slug],[languageCode],[name],[state],[version],[updatedAt]) VALUES (N'${quranTranslation}',N'lp-quran-translation-${quranRun}',N'en',N'NON_QURAN_FIXTURE translation',N'draft',1,SYSUTCDATETIME());
     INSERT INTO [dbo].[QuranTransliteration] ([id],[slug],[languageCode],[name],[state],[version],[updatedAt]) VALUES (N'${quranTransliteration}',N'lp-quran-transliteration-${quranRun}',N'en',N'NON_QURAN_FIXTURE transliteration',N'draft',1,SYSUTCDATETIME());
     INSERT INTO [dbo].[QuranTafsir] ([id],[slug],[languageCode],[name],[state],[version],[updatedAt]) VALUES (N'${quranTafsir}',N'lp-quran-tafsir-${quranRun}',N'en',N'NON_QURAN_FIXTURE tafsir',N'draft',1,SYSUTCDATETIME());
     INSERT INTO [dbo].[QuranRecitation] ([id],[slug],[personId],[name],[state],[version],[updatedAt]) VALUES (N'${quranRecitation}',N'lp-quran-recitation-${quranRun}',N'${quranPerson}',N'NON_QURAN_FIXTURE recitation',N'draft',1,SYSUTCDATETIME());
     INSERT INTO [dbo].[QuranTajweedRule] ([id],[slug],[position],[state],[version],[updatedAt]) VALUES (N'${quranRule}',N'lp-quran-tajweed-${quranRun}',0,N'draft',1,SYSUTCDATETIME());`,
    'five draft works with a registered language and a typed reciter',
  );
  await expectAllowed(
    app,
    'Quran child rows INSERT',
    `INSERT INTO [dbo].[QuranTranslationText] ([translationId],[surahNumber],[ayahNumber],[text]) VALUES (N'${quranTranslation}',1,1,N'${quranText('TRANSLATION', 1, 1)}'),(N'${quranTranslation}',1,2,N'${quranText('TRANSLATION', 1, 2)}');
     INSERT INTO [dbo].[QuranTranslationContributor] ([translationId],[personId],[role],[position]) VALUES (N'${quranTranslation}',N'${quranPerson}',N'translator',0);
     INSERT INTO [dbo].[QuranTransliterationText] ([transliterationId],[surahNumber],[ayahNumber],[text]) VALUES (N'${quranTransliteration}',1,1,N'NON_QURAN_FIXTURE_TRANSLITERATION_1_1');
     INSERT INTO [dbo].[QuranTafsirText] ([id],[tafsirId],[surahNumber],[startAyah],[endAyah],[text]) VALUES (N'${quranEntry}',N'${quranTafsir}',1,1,2,N'${quranText('TAFSIR', 1, 1)}');
     INSERT INTO [dbo].[QuranTafsirContributor] ([tafsirId],[personId],[role],[position]) VALUES (N'${quranTafsir}',N'${quranPerson}',N'author',0);
     INSERT INTO [dbo].[Asset] ([id],[storageKey],[state],[updatedAt]) VALUES (N'${quranAsset}',N'ab/cd/${quranRun}',N'uploading',SYSUTCDATETIME());
     INSERT INTO [dbo].[QuranRecitationSegment] ([id],[recitationId],[surahNumber],[startAyah],[endAyah]) VALUES (N'${quranSegment}',N'${quranRecitation}',1,1,3);
     INSERT INTO [dbo].[QuranTajweedRuleText] ([ruleId],[languageCode],[title],[body]) VALUES (N'${quranRule}',N'en',N'NON_QURAN_FIXTURE rule',N'NON_QURAN_FIXTURE rule body');
     INSERT INTO [dbo].[SurahName] ([surahNumber],[locale],[name]) VALUES (1,N'en',N'NON_QURAN_FIXTURE name'),(1,N'ur',N'NON_QURAN_FIXTURE name ur');
     INSERT INTO [dbo].[QuranTopic] ([surahNumber],[ayahNumber],[topicId]) VALUES (1,1,N'${editorialTopic.id}');
     INSERT INTO [dbo].[SearchIndexRequest] ([scopeKind],[scopeId]) VALUES (N'quran-ayah',N'1:1');`,
    'texts, entries, contributors, a segment, display names, a topic and Ayah search intent',
  );
  await expectAllowed(
    app,
    'Quran layered works UPDATE',
    `UPDATE [dbo].[QuranTranslation] SET [name]=N'NON_QURAN_FIXTURE translation renamed',[version]=[version]+1,[updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${quranTranslation}';
     UPDATE [dbo].[QuranTranslationText] SET [text]=N'${quranText('TRANSLATION_REVISED', 1, 1)}' WHERE [translationId]=N'${quranTranslation}' AND [ayahNumber]=1;
     UPDATE [dbo].[QuranTransliterationText] SET [text]=N'NON_QURAN_FIXTURE_TRANSLITERATION_REVISED_1_1' WHERE [transliterationId]=N'${quranTransliteration}';
     UPDATE [dbo].[QuranTafsirText] SET [text]=N'${quranText('TAFSIR_REVISED', 1, 1)}' WHERE [id]=N'${quranEntry}';
     UPDATE [dbo].[QuranTajweedRuleText] SET [body]=N'NON_QURAN_FIXTURE rule body revised' WHERE [ruleId]=N'${quranRule}';
     UPDATE [dbo].[QuranRecitationSegment] SET [assetId]=N'${quranAsset}' WHERE [id]=N'${quranSegment}';
     UPDATE [dbo].[SurahName] SET [name]=N'NON_QURAN_FIXTURE name revised' WHERE [surahNumber]=1 AND [locale]=N'en';
     UPDATE [dbo].[QuranTranslation] SET [state]=N'published',[sourceId]=N'${quranSource}',[publishedAt]=SYSUTCDATETIME(),[version]=[version]+1 WHERE [id]=N'${quranTranslation}';`,
    'names, texts, the audio relation and publication against a registered source',
  );
  await expectAllowed(
    app,
    'Quran child rows DELETE',
    `DELETE FROM [dbo].[QuranTranslationText] WHERE [translationId]=N'${quranTranslation}' AND [ayahNumber]=2;
     DELETE FROM [dbo].[QuranTranslationContributor] WHERE [translationId]=N'${quranTranslation}';
     DELETE FROM [dbo].[QuranTransliterationText] WHERE [transliterationId]=N'${quranTransliteration}';
     DELETE FROM [dbo].[QuranTafsirContributor] WHERE [tafsirId]=N'${quranTafsir}';
     DELETE FROM [dbo].[QuranTafsirText] WHERE [id]=N'${quranEntry}';
     DELETE FROM [dbo].[QuranTajweedRuleText] WHERE [ruleId]=N'${quranRule}';
     DELETE FROM [dbo].[QuranRecitationSegment] WHERE [id]=N'${quranSegment}';
     DELETE FROM [dbo].[SurahName] WHERE [surahNumber]=1 AND [locale]=N'ur';
     DELETE FROM [dbo].[QuranTopic] WHERE [surahNumber]=1 AND [ayahNumber]=1;`,
    'child rows of draft works are replaced',
  );
  for (const table of [
    'QuranTranslation',
    'QuranTransliteration',
    'QuranTafsir',
    'QuranRecitation',
    'QuranTajweedRule',
  ]) {
    await expectDenied(
      app,
      `${table} slug UPDATE denied`,
      `UPDATE [dbo].[${table}] SET [slug]=[slug];`,
    );
    await expectDenied(app, `${table} DELETE denied`, `DELETE FROM [dbo].[${table}];`);
  }
  for (const [label, statement] of [
    [
      'QuranTranslationContributor UPDATE denied',
      'UPDATE [dbo].[QuranTranslationContributor] SET [position]=[position];',
    ],
    [
      'QuranTafsirContributor UPDATE denied',
      'UPDATE [dbo].[QuranTafsirContributor] SET [position]=[position];',
    ],
    [
      'QuranRecitationSegment range UPDATE denied',
      'UPDATE [dbo].[QuranRecitationSegment] SET [startAyah]=[startAyah];',
    ],
    [
      'QuranRecitationSegment owner UPDATE denied',
      'UPDATE [dbo].[QuranRecitationSegment] SET [recitationId]=[recitationId];',
    ],
    ['QuranTopic UPDATE denied', 'UPDATE [dbo].[QuranTopic] SET [topicId]=[topicId];'],
    // A text is never re-parented: moving a published work's last text to
    // another work would empty it as surely as deleting it.
    [
      'QuranTranslationText work UPDATE denied',
      `UPDATE [dbo].[QuranTranslationText] SET [translationId]=N'${quranTranslation}';`,
    ],
    [
      'QuranTranslationText Ayah UPDATE denied',
      'UPDATE [dbo].[QuranTranslationText] SET [ayahNumber]=[ayahNumber];',
    ],
    [
      'QuranTransliterationText work UPDATE denied',
      `UPDATE [dbo].[QuranTransliterationText] SET [transliterationId]=N'${quranTransliteration}';`,
    ],
    [
      'QuranTafsirText work UPDATE denied',
      `UPDATE [dbo].[QuranTafsirText] SET [tafsirId]=N'${quranTafsir}';`,
    ],
    [
      'QuranTajweedRuleText rule UPDATE denied',
      `UPDATE [dbo].[QuranTajweedRuleText] SET [ruleId]=N'${quranRule}';`,
    ],
    [
      'QuranTajweedRuleText language UPDATE denied',
      'UPDATE [dbo].[QuranTajweedRuleText] SET [languageCode]=[languageCode];',
    ],
  ] as const)
    await expectDenied(app, label, statement);

  // No Quran table is alterable, each proved visible first so a DDL denial can
  // only mean permission.
  for (const table of [
    ...QURAN_READ_ONLY,
    'SurahName',
    'QuranTranslation',
    'QuranTranslationContributor',
    'QuranTranslationText',
    'QuranTransliteration',
    'QuranTransliterationText',
    'QuranTafsir',
    'QuranTafsirContributor',
    'QuranTafsirText',
    'QuranRecitation',
    'QuranRecitationSegment',
    'QuranTajweedRule',
    'QuranTajweedRuleText',
    'QuranTopic',
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
    'Ayah trigger DISABLE denied',
    'DISABLE TRIGGER [dbo].[AyahCanonicalChange] ON [dbo].[Ayah];',
  );

  // THE EXACT EFFECTIVE POSTURE, table by table and column by column. Object
  // verbs other than UPDATE are probed on the object; UPDATE is probed on every
  // column, because the canonical exceptions and the slug denials are column
  // rules an object-level answer would blur.
  const QURAN_POSTURE: Readonly<Record<string, readonly [string, string]>> = {
    ...Object.fromEntries(
      QURAN_READ_ONLY.map((table) => [table, ['SELECT', ''] as const]),
    ),
    Surah: ['SELECT', 'namesVersion,updatedAt'],
    QuranTranslation: ['INSERT,SELECT', 'all but slug'],
    QuranTransliteration: ['INSERT,SELECT', 'all but slug'],
    QuranTafsir: ['INSERT,SELECT', 'all but slug'],
    QuranRecitation: ['INSERT,SELECT', 'all but slug'],
    QuranTajweedRule: ['INSERT,SELECT', 'all but slug'],
    SurahName: ['DELETE,INSERT,SELECT', 'all'],
    // A text's identity — its work, and its Ayah or language — is fixed; only
    // what it says (and a tafsir entry's range) is edited in place.
    QuranTranslationText: ['DELETE,INSERT,SELECT', 'text'],
    QuranTransliterationText: ['DELETE,INSERT,SELECT', 'text'],
    QuranTafsirText: ['DELETE,INSERT,SELECT', 'surahNumber,startAyah,endAyah,text'],
    QuranTajweedRuleText: ['DELETE,INSERT,SELECT', 'title,body'],
    QuranTranslationContributor: ['DELETE,INSERT,SELECT', ''],
    QuranTafsirContributor: ['DELETE,INSERT,SELECT', ''],
    QuranRecitationSegment: ['DELETE,INSERT,SELECT', 'assetId'],
    QuranTopic: ['DELETE,INSERT,SELECT', ''],
  };
  const posture = await app.query<{
    name: string;
    held: string | null;
    updatable: string | null;
    columns: string | null;
  }>(`
    SELECT t.[name],
      (SELECT STRING_AGG(p.[permission], N',') WITHIN GROUP (ORDER BY p.[permission])
         FROM (VALUES (N'ALTER'),(N'CONTROL'),(N'DELETE'),(N'INSERT'),(N'REFERENCES'),
                      (N'SELECT'),(N'TAKE OWNERSHIP')) AS p([permission])
        WHERE HAS_PERMS_BY_NAME(N'dbo.' + t.[name], N'OBJECT', p.[permission]) = 1) AS [held],
      (SELECT STRING_AGG(c.[name], N',') WITHIN GROUP (ORDER BY c.[column_id])
         FROM sys.columns c WHERE c.[object_id] = OBJECT_ID(N'dbo.' + t.[name])
          AND HAS_PERMS_BY_NAME(N'dbo.' + t.[name], N'OBJECT', N'UPDATE', c.[name], N'COLUMN') = 1) AS [updatable],
      (SELECT STRING_AGG(c.[name], N',') WITHIN GROUP (ORDER BY c.[column_id])
         FROM sys.columns c WHERE c.[object_id] = OBJECT_ID(N'dbo.' + t.[name])) AS [columns]
    FROM (VALUES ${Object.keys(QURAN_POSTURE)
      .map((table) => `(N'${table}')`)
      .join(',')}) AS t([name]);
  `);
  const postureFindings = posture.flatMap((row) => {
    const [verbs, scope] = QURAN_POSTURE[row.name] ?? ['?', '?'];
    const columns = (row.columns ?? '').split(',');
    const expectedColumns =
      scope === 'all'
        ? columns.join(',')
        : scope === 'all but slug'
          ? columns.filter((column) => column !== 'slug').join(',')
          : scope;
    return (row.held ?? '') === verbs && (row.updatable ?? '') === expectedColumns
      ? []
      : [`${row.name}: ${row.held ?? '(none)'} / UPDATE ${row.updatable ?? '(none)'}`];
  });
  if (
    posture.length === Object.keys(QURAN_POSTURE).length &&
    postureFindings.length === 0
  ) {
    pass(
      'Quran effective posture exact',
      `${String(posture.length)} tables, object verbs and UPDATE columns as granted`,
    );
  } else {
    fail('Quran effective posture exact', postureFindings.join('; ') || 'tables missing');
  }
  const [quranExecute] = await app.query<{ granted: number; denied: number }>(`
    SELECT
      HAS_PERMS_BY_NAME(N'dbo.QuranAcceptCorpus', N'OBJECT', N'EXECUTE')
        + HAS_PERMS_BY_NAME(N'dbo.QuranCorrectAyah', N'OBJECT', N'EXECUTE')
        + HAS_PERMS_BY_NAME(N'dbo.QuranRecordVerificationFailure', N'OBJECT', N'EXECUTE') AS [granted],
      HAS_PERMS_BY_NAME(N'dbo.QuranAssertCanonicalAuthority', N'OBJECT', N'EXECUTE') AS [denied];
  `);
  if (Number(quranExecute?.granted) === 3 && Number(quranExecute?.denied) === 0) {
    pass(
      'Quran procedures EXECUTE exact',
      'three canonical procedures executable; the authority check is not',
    );
  } else {
    fail('Quran procedures EXECUTE exact', JSON.stringify(quranExecute ?? null));
  }

  // ---- Phase 19: Hadith, in four postures -----------------------------------
  //
  // THE SOURCE SYSTEMS, EDITIONS AND ACTIVATIONS are the owner's. The runtime
  // reads them and writes nothing, so no permission it carries can register an
  // authority, turn a fixture into one or make a collection public.
  //
  // THE CANONICAL TABLES are read-only to it as well. It reaches them ONLY by
  // executing the six canonical procedures, which re-check the live
  // `hadith.editCanonical` grant and purpose-bound step-up grant in SQL —
  // proved here by the runtime naming an account that holds nothing, and a
  // grant that does not exist, and being refused (51210) — while the authority
  // check and conflict detection are denied to it outright. A collection's,
  // book's or chapter's display-name version is the one canonical column it may
  // advance.
  //
  // LAYERED WORKS by the Quran postures: inserted and updated, never deleted, a
  // slug or parent record chosen once; display names, entries, texts,
  // contributors and topic assignments are child rows. Naming a Person, a Topic,
  // a Language or a source system grants nothing on those owners' tables.
  //
  // Every statement below is REAL SQL as the runtime principal over sentinel
  // NON_HADITH_FIXTURE text; the source system, the edition and the canonical
  // authority are the owner's rows.
  const hadithRun = randomUUID().replaceAll('-', '').slice(0, 16);
  const hadithAt = '2026-10-03T00:00:00';
  const hadithSource = randomUUID();
  const hadithCollection = randomUUID();
  const hadithEdition = randomUUID();
  const hadithBook = randomUUID();
  const hadithChapter = randomUUID();
  const hadithRecord = randomUUID();
  const hadithCitation = randomUUID();
  const hadithHolder = randomUUID();
  const hadithRole = randomUUID();
  const hadithSession = randomUUID();
  const hadithGrant = randomUUID();
  await admin.query(`
    INSERT INTO [dbo].[User] ([id],[name],[email],[emailVerified],[createdAt],[updatedAt],[locale],[status],[twoFactorEnabled])
      VALUES (N'${hadithHolder}',N'Synthetic Hadith canonical holder',N'${hadithHolder}@proof.invalid',0,SYSUTCDATETIME(),SYSUTCDATETIME(),N'en',N'active',0);
    INSERT INTO [dbo].[Role] ([id],[key],[name],[description],[system])
      VALUES (N'${hadithRole}',N'lp-hadith-canonical-${hadithRun}',N'Synthetic Hadith canonical role',N'Least-privilege proof only.',0);
    INSERT INTO [dbo].[RolePermission] ([roleId],[permissionKey]) VALUES (N'${hadithRole}',N'hadith.editCanonical');
    INSERT INTO [dbo].[RoleAssignment] ([userId],[roleId]) VALUES (N'${hadithHolder}',N'${hadithRole}');
    INSERT INTO [dbo].[Session] ([id],[token],[userId],[expiresAt],[createdAt],[updatedAt])
      VALUES (N'${hadithSession}',N'lp-hadith-${hadithSession}',N'${hadithHolder}',DATEADD(hour,1,SYSUTCDATETIME()),SYSUTCDATETIME(),SYSUTCDATETIME());
    INSERT INTO [dbo].[StepUpGrant] ([id],[userId],[sessionId],[purpose],[expiresAt])
      VALUES (N'${hadithGrant}',N'${hadithHolder}',N'${hadithSession}',N'hadith-canonical-edit',DATEADD(minute,30,SYSUTCDATETIME()));
  `);
  const hadithAuthority = (actor: string, grantId: string): string =>
    `@actorId=N'${actor}', @sessionId=N'${hadithSession}', @stepUpGrantId=N'${grantId}', @at='${hadithAt}'`;
  const hadithCreateCollection = (actor: string, grantId: string, id: string): string =>
    `EXEC [dbo].[HadithCreateCollection] @id=N'${id}', @slug=N'lp-collection-${hadithRun}', @position=0, ${hadithAuthority(actor, grantId)};`;

  // The runtime cannot borrow an authority it does not hold, nor forge a grant.
  await expectRefusedByInvariant(
    app,
    'Hadith collection naming an account without authority',
    hadithCreateCollection(editorialReviewer, hadithGrant, randomUUID()),
    51210,
  );
  await expectRefusedByInvariant(
    app,
    'Hadith collection with a forged step-up grant',
    hadithCreateCollection(hadithHolder, randomUUID(), randomUUID()),
    51210,
  );
  await expectDenied(
    app,
    'HadithAssertCanonicalAuthority EXECUTE denied',
    `EXEC [dbo].[HadithAssertCanonicalAuthority] @actorId=N'${hadithHolder}', @sessionId=N'${hadithSession}', @stepUpGrantId=N'${hadithGrant}';`,
  );
  await expectDenied(
    app,
    'HadithDetectConflicts EXECUTE denied',
    `EXEC [dbo].[HadithDetectConflicts] @hadithId=N'${hadithRecord}', @at='${hadithAt}';`,
  );
  await expectAllowed(
    app,
    'HadithCreateCollection EXECUTE',
    hadithCreateCollection(hadithHolder, hadithGrant, hadithCollection),
    'a collection is created by the procedure, under the live authority',
  );
  await admin.query(`
    INSERT INTO [dbo].[HadithSourceSystem] ([id],[code],[authority],[title],[version],[encoding])
      VALUES (N'${hadithSource}',N'NON_HADITH_FIXTURE_LP_${hadithRun}',N'fixture',N'NON_HADITH_FIXTURE least-privilege source',N'proof-1',N'utf-8');
    INSERT INTO [dbo].[HadithEdition] ([id],[collectionId],[sourceSystemId],[code],[title])
      VALUES (N'${hadithEdition}',N'${hadithCollection}',N'${hadithSource}',N'NON_HADITH_FIXTURE_LP_EDITION',N'NON_HADITH_FIXTURE least-privilege edition');
  `);
  const hadithGradings = JSON.stringify([
    {
      position: 0,
      grader: 'NON_HADITH_FIXTURE_GRADER_1',
      label: 'NON_HADITH_FIXTURE_GRADING_1',
      labelLanguage: 'ar',
      reference: 'NON_HADITH_FIXTURE_REFERENCE_3',
    },
  ]);
  for (const [label, statement, detail] of [
    [
      'HadithCreateBook EXECUTE',
      `EXEC [dbo].[HadithCreateBook] @id=N'${hadithBook}', @editionId=N'${hadithEdition}', @slug=N'lp-book-${hadithRun}', @reference=N'NON_HADITH_FIXTURE_REFERENCE_1', @position=1, @title=NULL, @titleLanguage=NULL, ${hadithAuthority(hadithHolder, hadithGrant)};`,
      'a book is created in its edition by the procedure',
    ],
    [
      'HadithCreateChapter EXECUTE',
      `EXEC [dbo].[HadithCreateChapter] @id=N'${hadithChapter}', @bookId=N'${hadithBook}', @slug=N'lp-chapter-${hadithRun}', @reference=N'NON_HADITH_FIXTURE_REFERENCE_2', @position=1, @title=NULL, @titleLanguage=NULL, ${hadithAuthority(hadithHolder, hadithGrant)};`,
      'a chapter is created in its book by the procedure',
    ],
    [
      'HadithWriteRecord EXECUTE',
      `EXEC [dbo].[HadithWriteRecord] @hadithId=N'${hadithRecord}', @editionId=N'${hadithEdition}', @expectedVersion=0, @sourceReference=N'NON_HADITH_FIXTURE_REFERENCE_7', @citationNumber=7, @bookId=N'${hadithBook}', @chapterId=N'${hadithChapter}', @text=N'NON_HADITH_FIXTURE_TEXT_1', @textLanguage=N'ar', @chain=N'NON_HADITH_FIXTURE_CHAIN_1', @chainLanguage=N'ar', @gradings=N'${hadithGradings}', @evidence=N'NON_HADITH_FIXTURE_EVIDENCE_1', @reason=NULL, ${hadithAuthority(hadithHolder, hadithGrant)};`,
      'a source-qualified record, its history and grading are written by the procedure alone',
    ],
    [
      'HadithVerifyRecord EXECUTE',
      `EXEC [dbo].[HadithVerifyRecord] @id=N'${randomUUID()}', @hadithId=N'${hadithRecord}', @expectedVersion=1, @evidence=N'NON_HADITH_FIXTURE_EVIDENCE_2', ${hadithAuthority(hadithHolder, hadithGrant)};`,
      'version 1 is verified by the procedure',
    ],
    [
      'HadithSetCitation EXECUTE',
      `EXEC [dbo].[HadithSetCitation] @id=N'${hadithCitation}', @collectionId=N'${hadithCollection}', @number=7, @hadithId=N'${hadithRecord}', @state=N'mapped', @expectedVersion=0, @evidence=N'NON_HADITH_FIXTURE_EVIDENCE_3', @reason=NULL, ${hadithAuthority(hadithHolder, hadithGrant)};`,
      'the citation is mapped to its verified candidate by the procedure',
    ],
  ] as const)
    await expectAllowed(app, label, statement, detail);

  const HADITH_READ_ONLY = [
    'HadithSourceSystem',
    'HadithEdition',
    'HadithActivation',
    'Hadith',
    'HadithRevision',
    'HadithGrading',
    'HadithVerification',
    'HadithCitation',
    'HadithCitationRevision',
    'HadithConflict',
  ] as const;
  const HADITH_STRUCTURE = ['HadithCollection', 'HadithBook', 'HadithChapter'] as const;
  for (const table of [...HADITH_READ_ONLY, ...HADITH_STRUCTURE])
    await expectAllowed(
      app,
      `${table} SELECT`,
      `SELECT COUNT_BIG(*) AS [total] FROM [dbo].[${table}];`,
      'the runtime reads it',
    );
  for (const [label, statement] of [
    [
      'HadithSourceSystem INSERT denied',
      `INSERT INTO [dbo].[HadithSourceSystem] ([id],[code],[authority],[title],[version],[encoding],[reference]) VALUES (N'${randomUUID()}',N'NON_HADITH_FIXTURE_LP_FORGED_${hadithRun}',N'approved',N'NON_HADITH_FIXTURE forged',N'proof-1',N'utf-8',N'urn:example:forged');`,
    ],
    [
      'HadithSourceSystem UPDATE denied',
      `UPDATE [dbo].[HadithSourceSystem] SET [authority]=N'approved',[reference]=N'urn:example:forged' WHERE [id]=N'${hadithSource}';`,
    ],
    ['HadithSourceSystem DELETE denied', 'DELETE FROM [dbo].[HadithSourceSystem];'],
    [
      'HadithEdition INSERT denied',
      `INSERT INTO [dbo].[HadithEdition] ([id],[collectionId],[sourceSystemId],[code],[title]) VALUES (N'${randomUUID()}',N'${hadithCollection}',N'${hadithSource}',N'NON_HADITH_FIXTURE_LP_FORGED',N'NON_HADITH_FIXTURE forged');`,
    ],
    ['HadithEdition UPDATE denied', 'UPDATE [dbo].[HadithEdition] SET [code]=[code];'],
    ['HadithEdition DELETE denied', 'DELETE FROM [dbo].[HadithEdition];'],
    [
      'HadithActivation INSERT denied',
      `INSERT INTO [dbo].[HadithActivation] ([collectionId],[authority],[authorisedBy]) VALUES (N'${hadithCollection}',N'fixture',N'runtime');`,
    ],
    ['HadithActivation DELETE denied', 'DELETE FROM [dbo].[HadithActivation];'],
    [
      'HadithCollection INSERT denied',
      `INSERT INTO [dbo].[HadithCollection] ([id],[slug],[position]) VALUES (N'${randomUUID()}',N'lp-forged-${hadithRun}',1);`,
    ],
    [
      'HadithCollection slug UPDATE denied',
      'UPDATE [dbo].[HadithCollection] SET [slug]=[slug];',
    ],
    [
      'HadithCollection position UPDATE denied',
      'UPDATE [dbo].[HadithCollection] SET [position]=[position];',
    ],
    ['HadithCollection DELETE denied', 'DELETE FROM [dbo].[HadithCollection];'],
    [
      'HadithBook INSERT denied',
      `INSERT INTO [dbo].[HadithBook] ([id],[collectionId],[editionId],[slug],[reference],[position]) VALUES (N'${randomUUID()}',N'${hadithCollection}',N'${hadithEdition}',N'lp-forged-${hadithRun}',N'NON_HADITH_FIXTURE_REFERENCE_9',9);`,
    ],
    [
      'HadithBook reference UPDATE denied',
      'UPDATE [dbo].[HadithBook] SET [reference]=[reference];',
    ],
    [
      'HadithBook edition UPDATE denied',
      'UPDATE [dbo].[HadithBook] SET [editionId]=[editionId];',
    ],
    ['HadithBook DELETE denied', 'DELETE FROM [dbo].[HadithBook];'],
    [
      'HadithChapter slug UPDATE denied',
      'UPDATE [dbo].[HadithChapter] SET [slug]=[slug];',
    ],
    ['HadithChapter DELETE denied', 'DELETE FROM [dbo].[HadithChapter];'],
    [
      'Hadith INSERT denied',
      `INSERT INTO [dbo].[Hadith] ([id],[collectionId],[sourceSystemId],[editionId],[sourceReference],[bookId],[text],[textLanguage],[version]) VALUES (N'${randomUUID()}',N'${hadithCollection}',N'${hadithSource}',N'${hadithEdition}',N'NON_HADITH_FIXTURE_REFERENCE_8',N'${hadithBook}',N'NON_HADITH_FIXTURE_TEXT_DIRECT',N'ar',1);`,
    ],
    [
      'Hadith text UPDATE denied',
      `UPDATE [dbo].[Hadith] SET [text]=N'NON_HADITH_FIXTURE_TEXT_TAMPERED' WHERE [id]=N'${hadithRecord}';`,
    ],
    ['Hadith chain UPDATE denied', 'UPDATE [dbo].[Hadith] SET [chain]=[chain];'],
    ['Hadith DELETE denied', 'DELETE FROM [dbo].[Hadith];'],
    [
      'HadithRevision INSERT denied',
      `INSERT INTO [dbo].[HadithRevision] ([hadithId],[version],[operation],[sourceReference],[bookId],[text],[textLanguage],[evidence],[reason],[actorId],[stepUpGrantId]) VALUES (N'${hadithRecord}',2,N'corrected',N'NON_HADITH_FIXTURE_REFERENCE_7',N'${hadithBook}',N'NON_HADITH_FIXTURE_TEXT_FORGED',N'ar',N'forged',N'forged',N'${hadithHolder}',N'${hadithGrant}');`,
    ],
    ['HadithRevision UPDATE denied', 'UPDATE [dbo].[HadithRevision] SET [text]=[text];'],
    ['HadithRevision DELETE denied', 'DELETE FROM [dbo].[HadithRevision];'],
    [
      'HadithGrading INSERT denied',
      `INSERT INTO [dbo].[HadithGrading] ([hadithId],[version],[position],[grader],[label],[labelLanguage],[reference]) VALUES (N'${hadithRecord}',1,1,N'NON_HADITH_FIXTURE_GRADER_2',N'NON_HADITH_FIXTURE_GRADING_2',N'ar',N'NON_HADITH_FIXTURE_REFERENCE_3');`,
    ],
    ['HadithGrading UPDATE denied', 'UPDATE [dbo].[HadithGrading] SET [label]=[label];'],
    ['HadithGrading DELETE denied', 'DELETE FROM [dbo].[HadithGrading];'],
    [
      'HadithVerification INSERT denied',
      `INSERT INTO [dbo].[HadithVerification] ([id],[hadithId],[version],[evidence],[actorId],[stepUpGrantId]) VALUES (N'${randomUUID()}',N'${hadithRecord}',1,N'forged',N'${hadithHolder}',N'${hadithGrant}');`,
    ],
    ['HadithVerification DELETE denied', 'DELETE FROM [dbo].[HadithVerification];'],
    [
      'HadithCitation INSERT denied',
      `INSERT INTO [dbo].[HadithCitation] ([collectionId],[number],[id],[hadithId],[state],[version]) VALUES (N'${hadithCollection}',8,N'${randomUUID()}',N'${hadithRecord}',N'mapped',1);`,
    ],
    [
      'HadithCitation UPDATE denied',
      "UPDATE [dbo].[HadithCitation] SET [state]=N'withdrawn';",
    ],
    ['HadithCitation DELETE denied', 'DELETE FROM [dbo].[HadithCitation];'],
    [
      'HadithCitationRevision INSERT denied',
      `INSERT INTO [dbo].[HadithCitationRevision] ([collectionId],[number],[version],[hadithId],[state],[evidence],[reason],[actorId],[stepUpGrantId]) VALUES (N'${hadithCollection}',7,2,N'${hadithRecord}',N'withdrawn',N'forged',N'forged',N'${hadithHolder}',N'${hadithGrant}');`,
    ],
    [
      'HadithCitationRevision DELETE denied',
      'DELETE FROM [dbo].[HadithCitationRevision];',
    ],
    [
      'HadithConflict INSERT denied',
      `INSERT INTO [dbo].[HadithConflict] ([id],[collectionId],[citationNumber],[hadithId],[hadithVersion],[otherHadithId],[otherVersion],[facets]) VALUES (N'${randomUUID()}',N'${hadithCollection}',7,N'${hadithRecord}',1,N'${hadithRecord}',1,N'text');`,
    ],
    ['HadithConflict DELETE denied', 'DELETE FROM [dbo].[HadithConflict];'],
  ] as const)
    await expectDenied(app, label, statement);
  await expectAllowed(
    app,
    'Hadith display-name versions UPDATE',
    `UPDATE [dbo].[HadithCollection] SET [namesVersion]=[namesVersion]+1,[updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${hadithCollection}';
     UPDATE [dbo].[HadithBook] SET [namesVersion]=[namesVersion]+1,[updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${hadithBook}';
     UPDATE [dbo].[HadithChapter] SET [namesVersion]=[namesVersion]+1,[updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${hadithChapter}';`,
    'the one canonical column the application may advance',
  );

  // The canonical store is exactly what the procedures wrote, after every
  // refused direct write.
  const [hadithState] = await admin.query<Record<string, number>>(`
    SELECT
      (SELECT COUNT(*) FROM [dbo].[HadithCollection] WHERE [id]=N'${hadithCollection}' AND [namesVersion]=2) AS [collections],
      (SELECT COUNT(*) FROM [dbo].[HadithBook] WHERE [editionId]=N'${hadithEdition}' AND [namesVersion]=2) AS [books],
      (SELECT COUNT(*) FROM [dbo].[HadithChapter] WHERE [bookId]=N'${hadithBook}' AND [namesVersion]=2) AS [chapters],
      (SELECT COUNT(*) FROM [dbo].[Hadith] WHERE [text]=N'NON_HADITH_FIXTURE_TEXT_1' AND [version]=1) AS [records],
      (SELECT COUNT(*) FROM [dbo].[HadithRevision]) AS [revisions],
      (SELECT COUNT(*) FROM [dbo].[HadithGrading]) AS [gradings],
      (SELECT COUNT(*) FROM [dbo].[HadithVerification]) AS [verifications],
      (SELECT COUNT(*) FROM [dbo].[HadithCitation] WHERE [id]=N'${hadithCitation}' AND [state]=N'mapped' AND [version]=1) AS [citations],
      (SELECT COUNT(*) FROM [dbo].[HadithCitationRevision]) AS [citationRevisions],
      (SELECT COUNT(*) FROM [dbo].[HadithConflict]) AS [conflicts],
      (SELECT COUNT(*) FROM [dbo].[HadithSourceSystem] WHERE [authority]=N'fixture' AND [reference] IS NULL) AS [sources],
      (SELECT COUNT(*) FROM [dbo].[HadithActivation]) AS [activations];
  `);
  if (
    JSON.stringify(hadithState) ===
    '{"collections":1,"books":1,"chapters":1,"records":1,"revisions":1,"gradings":1,"verifications":1,"citations":1,"citationRevisions":1,"conflicts":0,"sources":1,"activations":0}'
  ) {
    pass(
      'Hadith canonical state intact',
      'only the procedures wrote it; every direct write was refused',
    );
  } else {
    fail('Hadith canonical state intact', JSON.stringify(hadithState));
  }

  // ---- the layered works, through the runtime login --------------------------
  const hadithTranslation = randomUUID();
  const hadithCommentary = randomUUID();
  const hadithScience = randomUUID();
  const hadithPerson = editorialPeople.linkedPersonId;
  await expectAllowed(
    app,
    'Hadith layered works INSERT',
    `INSERT INTO [dbo].[HadithTranslation] ([id],[hadithId],[languageCode],[text],[state],[version],[updatedAt]) VALUES (N'${hadithTranslation}',N'${hadithRecord}',N'en',N'NON_HADITH_FIXTURE_TRANSLATION_1',N'draft',1,SYSUTCDATETIME());
     INSERT INTO [dbo].[HadithCommentary] ([id],[slug],[languageCode],[name],[state],[version],[updatedAt]) VALUES (N'${hadithCommentary}',N'lp-commentary-${hadithRun}',N'ur',N'NON_HADITH_FIXTURE commentary',N'draft',1,SYSUTCDATETIME());
     INSERT INTO [dbo].[HadithScience] ([id],[slug],[position],[state],[version],[updatedAt]) VALUES (N'${hadithScience}',N'lp-science-${hadithRun}',0,N'draft',1,SYSUTCDATETIME());`,
    'three draft works with a registered language',
  );
  await expectAllowed(
    app,
    'Hadith child rows INSERT',
    `INSERT INTO [dbo].[HadithTranslationContributor] ([translationId],[personId],[role],[position]) VALUES (N'${hadithTranslation}',N'${hadithPerson}',N'translator',0);
     INSERT INTO [dbo].[HadithCommentaryContributor] ([commentaryId],[personId],[role],[position]) VALUES (N'${hadithCommentary}',N'${hadithPerson}',N'author',0);
     INSERT INTO [dbo].[HadithCommentaryEntry] ([commentaryId],[hadithId],[text]) VALUES (N'${hadithCommentary}',N'${hadithRecord}',N'NON_HADITH_FIXTURE_COMMENTARY_1');
     INSERT INTO [dbo].[HadithScienceText] ([scienceId],[languageCode],[title],[body]) VALUES (N'${hadithScience}',N'en',N'NON_HADITH_FIXTURE science',N'NON_HADITH_FIXTURE_SCIENCE_1'),(N'${hadithScience}',N'ur',N'NON_HADITH_FIXTURE science ur',N'NON_HADITH_FIXTURE_SCIENCE_2');
     INSERT INTO [dbo].[HadithCollectionName] ([collectionId],[locale],[name]) VALUES (N'${hadithCollection}',N'en',N'NON_HADITH_FIXTURE collection'),(N'${hadithCollection}',N'ur',N'NON_HADITH_FIXTURE collection ur');
     INSERT INTO [dbo].[HadithBookName] ([bookId],[locale],[name]) VALUES (N'${hadithBook}',N'en',N'NON_HADITH_FIXTURE book');
     INSERT INTO [dbo].[HadithChapterName] ([chapterId],[locale],[name]) VALUES (N'${hadithChapter}',N'en',N'NON_HADITH_FIXTURE chapter');
     INSERT INTO [dbo].[HadithTopic] ([hadithId],[topicId]) VALUES (N'${hadithRecord}',N'${editorialTopic.id}');
     INSERT INTO [dbo].[SearchIndexRequest] ([scopeKind],[scopeId]) VALUES (N'hadith',N'${hadithCitation}');`,
    'contributors, an entry, texts, display names, a topic and citation search intent',
  );
  await expectAllowed(
    app,
    'Hadith layered works UPDATE',
    `UPDATE [dbo].[HadithTranslation] SET [text]=N'NON_HADITH_FIXTURE_TRANSLATION_2',[state]=N'published',[sourceSystemId]=N'${hadithSource}',[publishedAt]=SYSUTCDATETIME(),[version]=[version]+1,[updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${hadithTranslation}';
     UPDATE [dbo].[HadithCommentaryEntry] SET [text]=N'NON_HADITH_FIXTURE_COMMENTARY_2' WHERE [commentaryId]=N'${hadithCommentary}';
     UPDATE [dbo].[HadithCommentary] SET [state]=N'published',[sourceSystemId]=N'${hadithSource}',[publishedAt]=SYSUTCDATETIME(),[version]=[version]+1,[updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${hadithCommentary}';
     UPDATE [dbo].[HadithScienceText] SET [body]=N'NON_HADITH_FIXTURE_SCIENCE_3' WHERE [scienceId]=N'${hadithScience}' AND [languageCode]=N'en';
     UPDATE [dbo].[HadithScience] SET [position]=1,[version]=[version]+1,[updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${hadithScience}';
     UPDATE [dbo].[HadithCollectionName] SET [name]=N'NON_HADITH_FIXTURE collection renamed' WHERE [collectionId]=N'${hadithCollection}' AND [locale]=N'en';
     UPDATE [dbo].[HadithBookName] SET [name]=N'NON_HADITH_FIXTURE book renamed' WHERE [bookId]=N'${hadithBook}';`,
    'texts, names and publication against a registered source system',
  );
  await expectAllowed(
    app,
    'Hadith child rows DELETE',
    `DELETE FROM [dbo].[HadithTranslationContributor] WHERE [translationId]=N'${hadithTranslation}';
     DELETE FROM [dbo].[HadithCommentaryContributor] WHERE [commentaryId]=N'${hadithCommentary}';
     DELETE FROM [dbo].[HadithScienceText] WHERE [scienceId]=N'${hadithScience}' AND [languageCode]=N'ur';
     DELETE FROM [dbo].[HadithCollectionName] WHERE [collectionId]=N'${hadithCollection}' AND [locale]=N'ur';
     DELETE FROM [dbo].[HadithChapterName] WHERE [chapterId]=N'${hadithChapter}';
     DELETE FROM [dbo].[HadithTopic] WHERE [hadithId]=N'${hadithRecord}';`,
    'child rows are replaced',
  );
  for (const [label, statement] of [
    [
      'HadithCommentary slug UPDATE denied',
      'UPDATE [dbo].[HadithCommentary] SET [slug]=[slug];',
    ],
    [
      'HadithScience slug UPDATE denied',
      'UPDATE [dbo].[HadithScience] SET [slug]=[slug];',
    ],
    // A translation never moves to another record, and a work is archived,
    // never erased.
    [
      'HadithTranslation re-parent UPDATE denied',
      'UPDATE [dbo].[HadithTranslation] SET [hadithId]=[hadithId];',
    ],
    ['HadithTranslation DELETE denied', 'DELETE FROM [dbo].[HadithTranslation];'],
    ['HadithCommentary DELETE denied', 'DELETE FROM [dbo].[HadithCommentary];'],
    ['HadithScience DELETE denied', 'DELETE FROM [dbo].[HadithScience];'],
    [
      'HadithTranslationContributor UPDATE denied',
      'UPDATE [dbo].[HadithTranslationContributor] SET [position]=[position];',
    ],
    [
      'HadithCommentaryContributor UPDATE denied',
      'UPDATE [dbo].[HadithCommentaryContributor] SET [position]=[position];',
    ],
    ['HadithTopic UPDATE denied', 'UPDATE [dbo].[HadithTopic] SET [topicId]=[topicId];'],
    // An entry or text is never re-parented: moving a published work's last
    // entry to another work would empty it as surely as deleting it.
    [
      'HadithCommentaryEntry work UPDATE denied',
      'UPDATE [dbo].[HadithCommentaryEntry] SET [commentaryId]=[commentaryId];',
    ],
    [
      'HadithCommentaryEntry record UPDATE denied',
      'UPDATE [dbo].[HadithCommentaryEntry] SET [hadithId]=[hadithId];',
    ],
    [
      'HadithScienceText science UPDATE denied',
      'UPDATE [dbo].[HadithScienceText] SET [scienceId]=[scienceId];',
    ],
    [
      'HadithScienceText language UPDATE denied',
      'UPDATE [dbo].[HadithScienceText] SET [languageCode]=[languageCode];',
    ],
    [
      'HadithCollectionName key UPDATE denied',
      'UPDATE [dbo].[HadithCollectionName] SET [locale]=[locale];',
    ],
    [
      'HadithBookName key UPDATE denied',
      'UPDATE [dbo].[HadithBookName] SET [bookId]=[bookId];',
    ],
    [
      'HadithChapterName key UPDATE denied',
      'UPDATE [dbo].[HadithChapterName] SET [chapterId]=[chapterId];',
    ],
  ] as const)
    await expectDenied(app, label, statement);

  // No Hadith table is alterable, each proved visible first so a DDL denial can
  // only mean permission.
  const HADITH_LAYERED = [
    'HadithCollectionName',
    'HadithBookName',
    'HadithChapterName',
    'HadithTranslation',
    'HadithTranslationContributor',
    'HadithCommentary',
    'HadithCommentaryContributor',
    'HadithCommentaryEntry',
    'HadithScience',
    'HadithScienceText',
    'HadithTopic',
  ] as const;
  for (const table of [...HADITH_READ_ONLY, ...HADITH_STRUCTURE, ...HADITH_LAYERED]) {
    await assertObjectVisible(app, table);
    await expectDenied(
      app,
      `${table} ALTER denied`,
      `ALTER TABLE [dbo].[${table}] ADD [probe] INT NULL;`,
    );
  }
  await expectDenied(
    app,
    'Hadith trigger DISABLE denied',
    'DISABLE TRIGGER [dbo].[HadithCanonicalChange] ON [dbo].[Hadith];',
  );
  await expectDenied(
    app,
    'Hadith citation trigger DISABLE denied',
    'DISABLE TRIGGER [dbo].[HadithCitationIntegrity] ON [dbo].[HadithCitation];',
  );

  // THE EXACT EFFECTIVE POSTURE, table by table and column by column. A string
  // names the UPDATE columns exactly; a list names the columns EXCLUDED from an
  // otherwise updatable table.
  const HADITH_POSTURE: Readonly<
    Record<string, readonly [string, string | readonly string[]]>
  > = {
    ...Object.fromEntries(
      HADITH_READ_ONLY.map((table) => [table, ['SELECT', ''] as const]),
    ),
    ...Object.fromEntries(
      HADITH_STRUCTURE.map((table) => [
        table,
        ['SELECT', 'namesVersion,updatedAt'] as const,
      ]),
    ),
    HadithCollectionName: ['DELETE,INSERT,SELECT', 'name,description'],
    HadithBookName: ['DELETE,INSERT,SELECT', 'name'],
    HadithChapterName: ['DELETE,INSERT,SELECT', 'name'],
    HadithTranslation: ['INSERT,SELECT', ['hadithId']],
    HadithCommentary: ['INSERT,SELECT', ['slug']],
    HadithScience: ['INSERT,SELECT', ['slug']],
    HadithTranslationContributor: ['DELETE,INSERT,SELECT', ''],
    HadithCommentaryContributor: ['DELETE,INSERT,SELECT', ''],
    HadithCommentaryEntry: ['DELETE,INSERT,SELECT', 'text'],
    HadithScienceText: ['DELETE,INSERT,SELECT', 'title,body'],
    HadithTopic: ['DELETE,INSERT,SELECT', ''],
  };
  const hadithPosture = await app.query<{
    name: string;
    held: string | null;
    updatable: string | null;
    columns: string | null;
  }>(`
    SELECT t.[name],
      (SELECT STRING_AGG(p.[permission], N',') WITHIN GROUP (ORDER BY p.[permission])
         FROM (VALUES (N'ALTER'),(N'CONTROL'),(N'DELETE'),(N'INSERT'),(N'REFERENCES'),
                      (N'SELECT'),(N'TAKE OWNERSHIP')) AS p([permission])
        WHERE HAS_PERMS_BY_NAME(N'dbo.' + t.[name], N'OBJECT', p.[permission]) = 1) AS [held],
      (SELECT STRING_AGG(c.[name], N',') WITHIN GROUP (ORDER BY c.[column_id])
         FROM sys.columns c WHERE c.[object_id] = OBJECT_ID(N'dbo.' + t.[name])
          AND HAS_PERMS_BY_NAME(N'dbo.' + t.[name], N'OBJECT', N'UPDATE', c.[name], N'COLUMN') = 1) AS [updatable],
      (SELECT STRING_AGG(c.[name], N',') WITHIN GROUP (ORDER BY c.[column_id])
         FROM sys.columns c WHERE c.[object_id] = OBJECT_ID(N'dbo.' + t.[name])) AS [columns]
    FROM (VALUES ${Object.keys(HADITH_POSTURE)
      .map((table) => `(N'${table}')`)
      .join(',')}) AS t([name]);
  `);
  const hadithPostureFindings = hadithPosture.flatMap((row) => {
    const [verbs, scope] = HADITH_POSTURE[row.name] ?? ['?', '?'];
    const expectedColumns =
      typeof scope === 'string'
        ? scope
        : (row.columns ?? '')
            .split(',')
            .filter((column) => !scope.includes(column))
            .join(',');
    return (row.held ?? '') === verbs && (row.updatable ?? '') === expectedColumns
      ? []
      : [`${row.name}: ${row.held ?? '(none)'} / UPDATE ${row.updatable ?? '(none)'}`];
  });
  if (
    hadithPosture.length === Object.keys(HADITH_POSTURE).length &&
    Object.keys(HADITH_POSTURE).length === 24 &&
    hadithPostureFindings.length === 0
  ) {
    pass(
      'Hadith effective posture exact',
      `${String(hadithPosture.length)} tables, object verbs and UPDATE columns as granted`,
    );
  } else {
    fail(
      'Hadith effective posture exact',
      hadithPostureFindings.join('; ') || 'tables missing',
    );
  }
  const [hadithExecute] = await app.query<{ granted: number; denied: number }>(`
    SELECT
      HAS_PERMS_BY_NAME(N'dbo.HadithCreateCollection', N'OBJECT', N'EXECUTE')
        + HAS_PERMS_BY_NAME(N'dbo.HadithCreateBook', N'OBJECT', N'EXECUTE')
        + HAS_PERMS_BY_NAME(N'dbo.HadithCreateChapter', N'OBJECT', N'EXECUTE')
        + HAS_PERMS_BY_NAME(N'dbo.HadithWriteRecord', N'OBJECT', N'EXECUTE')
        + HAS_PERMS_BY_NAME(N'dbo.HadithVerifyRecord', N'OBJECT', N'EXECUTE')
        + HAS_PERMS_BY_NAME(N'dbo.HadithSetCitation', N'OBJECT', N'EXECUTE') AS [granted],
      HAS_PERMS_BY_NAME(N'dbo.HadithAssertCanonicalAuthority', N'OBJECT', N'EXECUTE')
        + HAS_PERMS_BY_NAME(N'dbo.HadithDetectConflicts', N'OBJECT', N'EXECUTE') AS [denied];
  `);
  if (Number(hadithExecute?.granted) === 6 && Number(hadithExecute?.denied) === 0) {
    pass(
      'Hadith procedures EXECUTE exact',
      'six canonical procedures executable; the authority check and conflict detection are not',
    );
  } else {
    fail('Hadith procedures EXECUTE exact', JSON.stringify(hadithExecute ?? null));
  }

  // ---- Phase 20: Fatwa, in four postures ------------------------------------
  //
  // ACTIVATION is the owner's. The runtime reads it and writes nothing, so no
  // permission it carries can open the service.
  //
  // THE WORKFLOW TABLES are read-only to it as well. It reaches them ONLY by
  // executing the eleven procedures, which re-check the actor's live Fatwa
  // permission — and, to publish or withdraw, a live `fatwa-publication`
  // step-up grant of the same session — in SQL: proved here by the runtime
  // naming an account that holds nothing, a forged grant, a wrong-purpose grant
  // and a borrowed one, and being refused (51233, 51235). The two authority
  // checks themselves are denied to it outright, so it cannot probe who holds
  // a key.
  //
  // CATEGORIES are inserted and updated, never deleted or re-slugged; their
  // display names are child rows. The read tally is written only by
  // `FatwaRecordRead`.
  //
  // Every statement below is REAL SQL as the runtime principal over sentinel
  // NON_FATWA_FIXTURE text; the activation and the three keys' holders are the
  // owner's rows, because the migration grants the keys to nobody.
  const fatwaRun = randomUUID().replaceAll('-', '').slice(0, 16);
  const fatwaAt = '2026-10-04T00:00:00';
  const fatwaAsker = randomUUID();
  const fatwaTriager = randomUUID();
  const fatwaAnswerer = randomUUID();
  const fatwaPublisher = randomUUID();
  const fatwaRoles = {
    receive: randomUUID(),
    answer: randomUUID(),
    publish: randomUUID(),
  };
  const fatwaSession = randomUUID();
  const fatwaGrant = randomUUID();
  const fatwaWrongPurpose = randomUUID();
  const fatwaCategory = randomUUID();
  const fatwaQuestion = randomUUID();
  const fatwaDeclined = randomUUID();
  const fatwaId = randomUUID();
  const fatwaFirst = randomUUID();
  const fatwaSecond = randomUUID();
  const fatwaUser = (id: string, name: string): string =>
    `INSERT INTO [dbo].[User] ([id],[name],[email],[emailVerified],[createdAt],[updatedAt],[locale],[status],[twoFactorEnabled])
       VALUES (N'${id}',N'Synthetic Fatwa ${name}',N'${id}@proof.invalid',0,SYSUTCDATETIME(),SYSUTCDATETIME(),N'en',N'active',0);`;
  const fatwaRole = (id: string, key: string, permission: string): string =>
    `INSERT INTO [dbo].[Role] ([id],[key],[name],[description],[system])
       VALUES (N'${id}',N'lp-fatwa-${key}-${fatwaRun}',N'Synthetic Fatwa ${key} role',N'Least-privilege proof only.',0);
     INSERT INTO [dbo].[RolePermission] ([roleId],[permissionKey]) VALUES (N'${id}',N'${permission}');`;
  await admin.query(`
    ${fatwaUser(fatwaAsker, 'asker')}
    ${fatwaUser(fatwaTriager, 'triage officer')}
    ${fatwaUser(fatwaAnswerer, 'answerer')}
    ${fatwaUser(fatwaPublisher, 'publisher')}
    ${fatwaRole(fatwaRoles.receive, 'receive', 'question.receive')}
    ${fatwaRole(fatwaRoles.answer, 'answer', 'fatwa.answer')}
    ${fatwaRole(fatwaRoles.publish, 'publish', 'fatwa.publish')}
    INSERT INTO [dbo].[RoleAssignment] ([userId],[roleId]) VALUES
      (N'${fatwaTriager}',N'${fatwaRoles.receive}'),
      (N'${fatwaAnswerer}',N'${fatwaRoles.answer}'),
      (N'${fatwaPublisher}',N'${fatwaRoles.publish}');
    INSERT INTO [dbo].[Session] ([id],[token],[userId],[expiresAt],[createdAt],[updatedAt])
      VALUES (N'${fatwaSession}',N'lp-fatwa-${fatwaSession}',N'${fatwaPublisher}',DATEADD(hour,1,SYSUTCDATETIME()),SYSUTCDATETIME(),SYSUTCDATETIME());
    INSERT INTO [dbo].[StepUpGrant] ([id],[userId],[sessionId],[purpose],[expiresAt]) VALUES
      (N'${fatwaGrant}',N'${fatwaPublisher}',N'${fatwaSession}',N'fatwa-publication',DATEADD(minute,30,SYSUTCDATETIME())),
      (N'${fatwaWrongPurpose}',N'${fatwaPublisher}',N'${fatwaSession}',N'hadith-canonical-edit',DATEADD(minute,30,SYSUTCDATETIME()));
  `);

  // The runtime cannot open the service.
  for (const [label, statement] of [
    [
      'FatwaActivation INSERT denied',
      `INSERT INTO [dbo].[FatwaActivation] ([id],[authority],[authorisedBy],[reference]) VALUES (1,N'approved',N'runtime',N'urn:example:forged');`,
    ],
    [
      'FatwaActivation UPDATE denied',
      "UPDATE [dbo].[FatwaActivation] SET [authority]=N'approved';",
    ],
    ['FatwaActivation DELETE denied', 'DELETE FROM [dbo].[FatwaActivation];'],
  ] as const)
    await expectDenied(app, label, statement);
  await admin.query(
    `INSERT INTO [dbo].[FatwaActivation] ([id],[authority],[authorisedBy]) VALUES (1,N'fixture',N'NON_FATWA_FIXTURE least-privilege operator');`,
  );

  // Categories, through the runtime login: created and renamed, never re-slugged
  // or deleted.
  await expectAllowed(
    app,
    'FatwaCategory and names INSERT',
    `INSERT INTO [dbo].[FatwaCategory] ([id],[slug],[topicId],[position],[status]) VALUES (N'${fatwaCategory}',N'lp-category-${fatwaRun}',N'${editorialTopic.id}',0,N'active');
     INSERT INTO [dbo].[FatwaCategoryName] ([categoryId],[locale],[name]) VALUES (N'${fatwaCategory}',N'en',N'NON_FATWA_FIXTURE category'),(N'${fatwaCategory}',N'ur',N'NON_FATWA_FIXTURE category ur');`,
    'a category mapped onto a Topic, with display names',
  );
  await expectAllowed(
    app,
    'FatwaCategory and names UPDATE/DELETE',
    `UPDATE [dbo].[FatwaCategory] SET [position]=1,[version]=[version]+1,[updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${fatwaCategory}';
     UPDATE [dbo].[FatwaCategoryName] SET [name]=N'NON_FATWA_FIXTURE category renamed' WHERE [categoryId]=N'${fatwaCategory}' AND [locale]=N'en';
     DELETE FROM [dbo].[FatwaCategoryName] WHERE [categoryId]=N'${fatwaCategory}' AND [locale]=N'ur';`,
    'ordered, renamed and a display name replaced',
  );
  for (const [label, statement] of [
    [
      'FatwaCategory slug UPDATE denied',
      'UPDATE [dbo].[FatwaCategory] SET [slug]=[slug];',
    ],
    ['FatwaCategory id UPDATE denied', 'UPDATE [dbo].[FatwaCategory] SET [id]=[id];'],
    ['FatwaCategory DELETE denied', 'DELETE FROM [dbo].[FatwaCategory];'],
    [
      'FatwaCategoryName key UPDATE denied',
      'UPDATE [dbo].[FatwaCategoryName] SET [categoryId]=[categoryId];',
    ],
  ] as const)
    await expectDenied(app, label, statement);

  // The workflow, by the procedures alone, under each stage's own key.
  const fatwaDraft = (revision: string, expected: number): string =>
    `EXEC [dbo].[FatwaSaveDraft] @fatwaId=N'${fatwaId}', @questionId=N'${fatwaQuestion}', @expectedVersion=${String(expected)}, @revisionId=N'${revision}', @slug=N'lp-ruling-${fatwaRun}', @title=N'NON_FATWA_FIXTURE title', @publicQuestion=N'NON_FATWA_FIXTURE_PUBLIC_QUESTION anonymised statement', @ruling=N'NON_FATWA_FIXTURE_RULING synthetic ruling text', @language=N'en', @categoryId=N'${fatwaCategory}', @topicIds=N'["${editorialTopic.id}"]', @correctionReason=NULL, @actorId=N'${fatwaAnswerer}', @at='${fatwaAt}';`;
  const fatwaPublish = (actor: string, grantId: string): string =>
    `EXEC [dbo].[FatwaPublishRevision] @fatwaId=N'${fatwaId}', @expectedVersion=6, @revisionId=N'${fatwaSecond}', @publicationId=N'${randomUUID()}', @actorId=N'${actor}', @sessionId=N'${fatwaSession}', @stepUpGrantId=N'${grantId}', @at='${fatwaAt}';`;
  for (const [label, statement, detail] of [
    [
      'FatwaSubmitQuestion EXECUTE',
      `EXEC [dbo].[FatwaSubmitQuestion] @id=N'${fatwaQuestion}', @askerId=N'${fatwaAsker}', @body=N'NON_FATWA_FIXTURE_QUESTION_1 synthetic private question', @at='${fatwaAt}';
       EXEC [dbo].[FatwaSubmitQuestion] @id=N'${fatwaDeclined}', @askerId=N'${fatwaAsker}', @body=N'NON_FATWA_FIXTURE_QUESTION_2 synthetic private question', @at='${fatwaAt}';`,
      'an active account asks, while the service is activated',
    ],
  ] as const)
    await expectAllowed(app, label, statement, detail);
  await expectRefusedByInvariant(
    app,
    'Fatwa triage naming an account without the key',
    `EXEC [dbo].[FatwaTriageQuestion] @id=N'${fatwaQuestion}', @expectedVersion=1, @categoryId=N'${fatwaCategory}', @actorId=N'${editorialReviewer}', @at='${fatwaAt}';`,
    51233,
  );
  await expectRefusedByInvariant(
    app,
    "Fatwa triage borrowing another stage's key",
    `EXEC [dbo].[FatwaTriageQuestion] @id=N'${fatwaQuestion}', @expectedVersion=1, @categoryId=N'${fatwaCategory}', @actorId=N'${fatwaAnswerer}', @at='${fatwaAt}';`,
    51233,
  );
  for (const [label, statement, detail] of [
    [
      'FatwaTriageQuestion EXECUTE',
      `EXEC [dbo].[FatwaTriageQuestion] @id=N'${fatwaQuestion}', @expectedVersion=1, @categoryId=N'${fatwaCategory}', @actorId=N'${fatwaTriager}', @at='${fatwaAt}';`,
      'categorised under question.receive',
    ],
    [
      'FatwaAssignQuestion EXECUTE',
      `EXEC [dbo].[FatwaAssignQuestion] @id=N'${fatwaQuestion}', @expectedVersion=2, @assigneeId=N'${fatwaAnswerer}', @actorId=N'${fatwaTriager}', @at='${fatwaAt}';`,
      'assigned to a current fatwa.answer holder',
    ],
    [
      'FatwaDeclineQuestion EXECUTE',
      `EXEC [dbo].[FatwaDeclineQuestion] @id=N'${fatwaDeclined}', @expectedVersion=1, @actorId=N'${fatwaTriager}', @at='${fatwaAt}';`,
      'a second question declined',
    ],
    [
      'FatwaSaveDraft EXECUTE',
      fatwaDraft(fatwaFirst, 0),
      'a first immutable revision by the assignee',
    ],
    [
      'FatwaSubmitForReview EXECUTE',
      `EXEC [dbo].[FatwaSubmitForReview] @fatwaId=N'${fatwaId}', @expectedVersion=2, @revisionId=N'${fatwaFirst}', @actorId=N'${fatwaAnswerer}', @at='${fatwaAt}';`,
      'the exact pending revision submitted',
    ],
    [
      'FatwaReturnForRevision EXECUTE',
      `EXEC [dbo].[FatwaReturnForRevision] @fatwaId=N'${fatwaId}', @expectedVersion=3, @revisionId=N'${fatwaFirst}', @decisionId=N'${randomUUID()}', @note=N'NON_FATWA_FIXTURE_NOTE private', @actorId=N'${fatwaPublisher}', @at='${fatwaAt}';`,
      'returned under fatwa.publish with a private note',
    ],
    [
      'FatwaSaveDraft and FatwaSubmitForReview again',
      `${fatwaDraft(fatwaSecond, 4)}
       EXEC [dbo].[FatwaSubmitForReview] @fatwaId=N'${fatwaId}', @expectedVersion=5, @revisionId=N'${fatwaSecond}', @actorId=N'${fatwaAnswerer}', @at='${fatwaAt}';`,
      'a second revision drafted and submitted',
    ],
  ] as const)
    await expectAllowed(app, label, statement, detail);

  // Publication authority cannot be forged, borrowed or carried over from
  // another purpose.
  for (const [label, actor, grantId] of [
    ['a forged step-up grant', fatwaPublisher, randomUUID()],
    ['a wrong-purpose step-up grant', fatwaPublisher, fatwaWrongPurpose],
    ["another account's step-up grant", fatwaAnswerer, fatwaGrant],
  ] as const)
    await expectRefusedByInvariant(
      app,
      `Fatwa publication with ${label}`,
      fatwaPublish(actor, grantId),
      51235,
    );
  for (const [label, statement, detail] of [
    [
      'FatwaPublishRevision EXECUTE',
      fatwaPublish(fatwaPublisher, fatwaGrant),
      'published under fatwa.publish and a live fatwa-publication grant',
    ],
    [
      'FatwaRecordRead EXECUTE',
      `EXEC [dbo].[FatwaRecordRead] @fatwaId=N'${fatwaId}', @day='2026-10-04';`,
      'one anonymous read counted',
    ],
    [
      'FatwaWithdraw EXECUTE',
      `EXEC [dbo].[FatwaWithdraw] @fatwaId=N'${fatwaId}', @expectedVersion=7, @decisionId=N'${randomUUID()}', @reason=N'NON_FATWA_FIXTURE withdrawal', @actorId=N'${fatwaPublisher}', @sessionId=N'${fatwaSession}', @stepUpGrantId=N'${fatwaGrant}', @at='${fatwaAt}';`,
      'withdrawn under the same authority',
    ],
    [
      'FatwaDisposeQuestions EXECUTE',
      `EXEC [dbo].[FatwaDisposeQuestions] @askerId=NULL, @limit=10, @at='${fatwaAt}';`,
      'a disposal pass over closed accounts (none here)',
    ],
  ] as const)
    await expectAllowed(app, label, statement, detail);
  await expectDenied(
    app,
    'FatwaAssertPermission EXECUTE denied',
    `EXEC [dbo].[FatwaAssertPermission] @actorId=N'${fatwaPublisher}', @permission=N'fatwa.publish';`,
  );
  await expectDenied(
    app,
    'FatwaAssertPublicationAuthority EXECUTE denied',
    `EXEC [dbo].[FatwaAssertPublicationAuthority] @actorId=N'${fatwaPublisher}', @sessionId=N'${fatwaSession}', @stepUpGrantId=N'${fatwaGrant}';`,
  );

  // Every direct write to a workflow table is refused by the grant.
  const FATWA_WORKFLOW = [
    'FatwaQuestion',
    'Fatwa',
    'FatwaRevision',
    'FatwaRevisionTopic',
    'FatwaPublication',
    'FatwaReviewDecision',
    'FatwaReadTally',
  ] as const;
  for (const table of [
    ...FATWA_WORKFLOW,
    'FatwaActivation',
    'FatwaCategory',
    'FatwaCategoryName',
  ])
    await expectAllowed(
      app,
      `${table} SELECT`,
      `SELECT COUNT_BIG(*) AS [total] FROM [dbo].[${table}];`,
      'the runtime reads it',
    );
  for (const [label, statement] of [
    [
      'FatwaQuestion INSERT denied',
      `INSERT INTO [dbo].[FatwaQuestion] ([id],[askerId],[body],[status],[version],[submittedAt],[updatedAt]) VALUES (N'${randomUUID()}',N'${fatwaAsker}',N'NON_FATWA_FIXTURE_QUESTION_DIRECT direct write',N'submitted',1,SYSUTCDATETIME(),SYSUTCDATETIME());`,
    ],
    [
      'FatwaQuestion UPDATE denied',
      `UPDATE [dbo].[FatwaQuestion] SET [assigneeId]=N'${fatwaPublisher}' WHERE [id]=N'${fatwaQuestion}';`,
    ],
    ['FatwaQuestion DELETE denied', 'DELETE FROM [dbo].[FatwaQuestion];'],
    [
      'Fatwa INSERT denied',
      `INSERT INTO [dbo].[Fatwa] ([id],[questionId],[slug],[version],[createdAt],[updatedAt]) VALUES (N'${randomUUID()}',N'${fatwaDeclined}',N'lp-forged-${fatwaRun}',1,SYSUTCDATETIME(),SYSUTCDATETIME());`,
    ],
    [
      'Fatwa UPDATE denied',
      `UPDATE [dbo].[Fatwa] SET [withdrawnAt]=NULL,[version]=[version]+1 WHERE [id]=N'${fatwaId}';`,
    ],
    ['Fatwa DELETE denied', 'DELETE FROM [dbo].[Fatwa];'],
    [
      'FatwaRevision INSERT denied',
      `INSERT INTO [dbo].[FatwaRevision] ([id],[fatwaId],[number],[title],[publicQuestion],[ruling],[language],[categoryId],[authorId],[createdAt]) VALUES (N'${randomUUID()}',N'${fatwaId}',9,N'NON_FATWA_FIXTURE forged',N'NON_FATWA_FIXTURE_PUBLIC_QUESTION forged statement',N'NON_FATWA_FIXTURE_RULING forged ruling text',N'en',N'${fatwaCategory}',N'${fatwaAnswerer}',SYSUTCDATETIME());`,
    ],
    [
      'FatwaRevision UPDATE denied',
      'UPDATE [dbo].[FatwaRevision] SET [ruling]=[ruling];',
    ],
    ['FatwaRevision DELETE denied', 'DELETE FROM [dbo].[FatwaRevision];'],
    [
      'FatwaRevisionTopic INSERT denied',
      `INSERT INTO [dbo].[FatwaRevisionTopic] ([revisionId],[topicId]) SELECT N'${fatwaSecond}', [id] FROM [dbo].[Topic] WHERE [id]<>N'${editorialTopic.id}' AND [status]=N'active';`,
    ],
    [
      'FatwaRevisionTopic UPDATE denied',
      'UPDATE [dbo].[FatwaRevisionTopic] SET [topicId]=[topicId];',
    ],
    ['FatwaRevisionTopic DELETE denied', 'DELETE FROM [dbo].[FatwaRevisionTopic];'],
    [
      'FatwaPublication INSERT denied',
      `INSERT INTO [dbo].[FatwaPublication] ([id],[fatwaId],[revisionId],[sequence],[publisherId],[stepUpGrantId],[publishedAt]) VALUES (N'${randomUUID()}',N'${fatwaId}',N'${fatwaFirst}',2,N'${fatwaPublisher}',N'${fatwaGrant}',SYSUTCDATETIME());`,
    ],
    [
      'FatwaPublication UPDATE denied',
      'UPDATE [dbo].[FatwaPublication] SET [publisherId]=[publisherId];',
    ],
    ['FatwaPublication DELETE denied', 'DELETE FROM [dbo].[FatwaPublication];'],
    [
      'FatwaReviewDecision INSERT denied',
      `INSERT INTO [dbo].[FatwaReviewDecision] ([id],[fatwaId],[revisionId],[decision],[note],[actorId],[decidedAt]) VALUES (N'${randomUUID()}',N'${fatwaId}',N'${fatwaSecond}',N'returned',N'NON_FATWA_FIXTURE forged',N'${fatwaPublisher}',SYSUTCDATETIME());`,
    ],
    [
      'FatwaReviewDecision UPDATE denied',
      'UPDATE [dbo].[FatwaReviewDecision] SET [note]=[note];',
    ],
    ['FatwaReviewDecision DELETE denied', 'DELETE FROM [dbo].[FatwaReviewDecision];'],
    [
      'FatwaReadTally INSERT denied',
      `INSERT INTO [dbo].[FatwaReadTally] ([fatwaId],[day],[reads]) VALUES (N'${fatwaId}','2026-10-05',1000000);`,
    ],
    [
      'FatwaReadTally UPDATE denied',
      'UPDATE [dbo].[FatwaReadTally] SET [reads]=[reads]+1000000;',
    ],
    ['FatwaReadTally DELETE denied', 'DELETE FROM [dbo].[FatwaReadTally];'],
  ] as const)
    await expectDenied(app, label, statement);

  // The workflow store is exactly what the procedures wrote, after every
  // refused direct write.
  const [fatwaState] = await admin.query<Record<string, number>>(`
    SELECT
      (SELECT COUNT(*) FROM [dbo].[FatwaActivation] WHERE [authority]=N'fixture') AS [activations],
      (SELECT COUNT(*) FROM [dbo].[FatwaCategory] WHERE [id]=N'${fatwaCategory}' AND [version]=2) AS [categories],
      (SELECT COUNT(*) FROM [dbo].[FatwaCategoryName] WHERE [categoryId]=N'${fatwaCategory}') AS [names],
      (SELECT COUNT(*) FROM [dbo].[FatwaQuestion] WHERE [askerId]=N'${fatwaAsker}') AS [questions],
      (SELECT COUNT(*) FROM [dbo].[FatwaQuestion] WHERE [id]=N'${fatwaQuestion}' AND [status]=N'answered' AND [assigneeId]=N'${fatwaAnswerer}') AS [answered],
      (SELECT COUNT(*) FROM [dbo].[FatwaQuestion] WHERE [id]=N'${fatwaDeclined}' AND [status]=N'declined') AS [declined],
      (SELECT COUNT(*) FROM [dbo].[Fatwa] WHERE [id]=N'${fatwaId}' AND [publishedRevisionId]=N'${fatwaSecond}' AND [withdrawnAt] IS NOT NULL AND [version]=8) AS [rulings],
      (SELECT COUNT(*) FROM [dbo].[FatwaRevision]) AS [revisions],
      (SELECT COUNT(*) FROM [dbo].[FatwaRevisionTopic]) AS [revisionTopics],
      (SELECT COUNT(*) FROM [dbo].[FatwaPublication]) AS [publications],
      (SELECT COUNT(*) FROM [dbo].[FatwaReviewDecision]) AS [decisions],
      (SELECT COUNT(*) FROM [dbo].[FatwaReadTally] WHERE [reads]=1) AS [tallies],
      (SELECT COUNT(*) FROM [dbo].[SearchIndexRequest] WHERE [scopeKind]=N'fatwa' AND [scopeId]=N'${fatwaId}') AS [intents];
  `);
  if (
    JSON.stringify(fatwaState) ===
    '{"activations":1,"categories":1,"names":1,"questions":2,"answered":1,"declined":1,"rulings":1,"revisions":2,"revisionTopics":2,"publications":1,"decisions":2,"tallies":1,"intents":2}'
  ) {
    pass(
      'Fatwa workflow state intact',
      'only the procedures wrote it; every direct write was refused',
    );
  } else {
    fail('Fatwa workflow state intact', JSON.stringify(fatwaState));
  }

  // No Fatwa table is alterable, each proved visible first so a DDL denial can
  // only mean permission.
  for (const table of [
    ...FATWA_WORKFLOW,
    'FatwaActivation',
    'FatwaCategory',
    'FatwaCategoryName',
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
    'Fatwa integrity trigger DISABLE denied',
    'DISABLE TRIGGER [dbo].[FatwaIntegrity] ON [dbo].[Fatwa];',
  );
  await expectDenied(
    app,
    'Fatwa history trigger DISABLE denied',
    'DISABLE TRIGGER [dbo].[FatwaRevisionImmutable] ON [dbo].[FatwaRevision];',
  );

  // THE EXACT EFFECTIVE POSTURE, table by table and column by column. A string
  // names the UPDATE columns exactly; a list names the columns EXCLUDED from an
  // otherwise updatable table.
  const FATWA_POSTURE: Readonly<
    Record<string, readonly [string, string | readonly string[]]>
  > = {
    ...Object.fromEntries(
      [...FATWA_WORKFLOW, 'FatwaActivation'].map((table) => [
        table,
        ['SELECT', ''] as const,
      ]),
    ),
    FatwaCategory: ['INSERT,SELECT', ['id', 'slug', 'createdAt']],
    FatwaCategoryName: ['DELETE,INSERT,SELECT', 'name'],
  };
  const fatwaPosture = await app.query<{
    name: string;
    held: string | null;
    updatable: string | null;
    columns: string | null;
  }>(`
    SELECT t.[name],
      (SELECT STRING_AGG(p.[permission], N',') WITHIN GROUP (ORDER BY p.[permission])
         FROM (VALUES (N'ALTER'),(N'CONTROL'),(N'DELETE'),(N'INSERT'),(N'REFERENCES'),
                      (N'SELECT'),(N'TAKE OWNERSHIP')) AS p([permission])
        WHERE HAS_PERMS_BY_NAME(N'dbo.' + t.[name], N'OBJECT', p.[permission]) = 1) AS [held],
      (SELECT STRING_AGG(c.[name], N',') WITHIN GROUP (ORDER BY c.[column_id])
         FROM sys.columns c WHERE c.[object_id] = OBJECT_ID(N'dbo.' + t.[name])
          AND HAS_PERMS_BY_NAME(N'dbo.' + t.[name], N'OBJECT', N'UPDATE', c.[name], N'COLUMN') = 1) AS [updatable],
      (SELECT STRING_AGG(c.[name], N',') WITHIN GROUP (ORDER BY c.[column_id])
         FROM sys.columns c WHERE c.[object_id] = OBJECT_ID(N'dbo.' + t.[name])) AS [columns]
    FROM (VALUES ${Object.keys(FATWA_POSTURE)
      .map((table) => `(N'${table}')`)
      .join(',')}) AS t([name]);
  `);
  const fatwaPostureFindings = fatwaPosture.flatMap((row) => {
    const [verbs, scope] = FATWA_POSTURE[row.name] ?? ['?', '?'];
    const expectedColumns =
      typeof scope === 'string'
        ? scope
        : (row.columns ?? '')
            .split(',')
            .filter((column) => !scope.includes(column))
            .join(',');
    return (row.held ?? '') === verbs && (row.updatable ?? '') === expectedColumns
      ? []
      : [`${row.name}: ${row.held ?? '(none)'} / UPDATE ${row.updatable ?? '(none)'}`];
  });
  if (
    fatwaPosture.length === Object.keys(FATWA_POSTURE).length &&
    Object.keys(FATWA_POSTURE).length === 10 &&
    fatwaPostureFindings.length === 0
  ) {
    pass(
      'Fatwa effective posture exact',
      `${String(fatwaPosture.length)} tables, object verbs and UPDATE columns as granted`,
    );
  } else {
    fail(
      'Fatwa effective posture exact',
      fatwaPostureFindings.join('; ') || 'tables missing',
    );
  }
  const FATWA_EXECUTABLE = [
    'FatwaSubmitQuestion',
    'FatwaTriageQuestion',
    'FatwaAssignQuestion',
    'FatwaDeclineQuestion',
    'FatwaSaveDraft',
    'FatwaSubmitForReview',
    'FatwaReturnForRevision',
    'FatwaPublishRevision',
    'FatwaWithdraw',
    'FatwaDisposeQuestions',
    'FatwaRecordRead',
  ];
  const [fatwaExecute] = await app.query<{ granted: number; denied: number }>(`
    SELECT
      ${FATWA_EXECUTABLE.map((name) => `HAS_PERMS_BY_NAME(N'dbo.${name}', N'OBJECT', N'EXECUTE')`).join(' + ')} AS [granted],
      HAS_PERMS_BY_NAME(N'dbo.FatwaAssertPermission', N'OBJECT', N'EXECUTE')
        + HAS_PERMS_BY_NAME(N'dbo.FatwaAssertPublicationAuthority', N'OBJECT', N'EXECUTE') AS [denied];
  `);
  if (
    Number(fatwaExecute?.granted) === FATWA_EXECUTABLE.length &&
    Number(fatwaExecute?.denied) === 0
  ) {
    pass(
      'Fatwa procedures EXECUTE exact',
      'eleven workflow procedures executable; the two authority checks are not',
    );
  } else {
    fail('Fatwa procedures EXECUTE exact', JSON.stringify(fatwaExecute ?? null));
  }

  // ---- Phase 21: Personalisation & Notifications, in three postures ----------
  //
  // OWNER DATA — a profile and its answers, saved items with their bookmarks and
  // notes, private collections, history, the Quran position, notification
  // preferences and notifications — is read, written and DELETED by the
  // runtime, because the owner may remove every one of them and closure
  // disposition must. What identifies a row — its owner, its typed target, its
  // creation instant — is never UPDATEd: a saved item cannot be repointed at
  // another target or another account, and a notification can only be marked
  // read.
  //
  // THE NEWSLETTER SUBSCRIPTION changes state but is never deleted by the
  // runtime, and its digest is never rewritten. CONSENT EVIDENCE is SELECT and
  // INSERT only (and a trigger refuses the rest even to a privileged session,
  // which `db:migrate:test` proves).
  //
  // Naming a target grants nothing on its owner's table: the runtime gains no
  // DELETE on an Article, Work or Video and no write on an Ayah or citation,
  // and no Identity table's posture moves.
  //
  // Every statement below is REAL SQL as the runtime principal over synthetic
  // NON_PERSONALISATION_FIXTURE rows; the two accounts are the owner's rows.
  const personalRun = randomUUID().replaceAll('-', '').slice(0, 16);
  const personalAt = '2026-10-05T00:00:00';
  const personalLater = '2026-10-05T01:00:00';
  const personalOwner = randomUUID();
  const personalOther = randomUUID();
  await admin.query(
    [personalOwner, personalOther]
      .map(
        (id) =>
          `INSERT INTO [dbo].[User] ([id],[name],[email],[emailVerified],[createdAt],[updatedAt],[locale],[status],[twoFactorEnabled])
             VALUES (N'${id}',N'NON_PERSONALISATION_FIXTURE account',N'${id}@personalisation-proof.invalid',0,SYSUTCDATETIME(),SYSUTCDATETIME(),N'en',N'active',0);`,
      )
      .join('\n'),
  );
  const [personalAyah] = await admin.query<{ surahNumber: number; ayahNumber: number }>(
    'SELECT TOP 1 [surahNumber], [ayahNumber] FROM [dbo].[Ayah] ORDER BY [surahNumber], [ayahNumber];',
  );
  if (personalAyah === undefined)
    throw new Error(
      'The Phase-18 proof above wrote no Ayah for Personalisation to name.',
    );
  const personalSaved = {
    article: randomUUID(),
    work: randomUUID(),
    video: randomUUID(),
    ayah: randomUUID(),
    hadith: randomUUID(),
  };
  const personalCollection = randomUUID();
  const personalReading = randomUUID();
  const personalNotification = randomUUID();
  const personalSubscriber = randomUUID();
  const personalHash = (label: string): string =>
    createHash('sha256')
      .update(`NON_PERSONALISATION_FIXTURE ${personalRun} ${label}`)
      .digest('hex');
  const savedColumns =
    '[id],[userId],[articleId],[workId],[videoId],[surahNumber],[ayahNumber],[hadithCitationId],[createdAt]';

  for (const [label, statement, detail] of [
    [
      'Personalisation profile and answers INSERT',
      `INSERT INTO [dbo].[PersonalisationProfile] ([userId],[onboarding],[historyEnabled],[version],[createdAt],[updatedAt]) VALUES (N'${personalOwner}',NULL,1,1,'${personalAt}','${personalAt}');
       INSERT INTO [dbo].[PersonalisationInterest] ([userId],[interest]) VALUES (N'${personalOwner}',N'quran'),(N'${personalOwner}',N'watch');
       INSERT INTO [dbo].[PersonalisationGoal] ([userId],[goal]) VALUES (N'${personalOwner}',N'follow-lectures');`,
      'an explicit profile with interests and a goal',
    ],
    [
      'SavedItem INSERT, one per typed target',
      `INSERT INTO [dbo].[SavedItem] (${savedColumns}) VALUES
         (N'${personalSaved.article}',N'${personalOwner}',N'${editorialFixture.articleId}',NULL,NULL,NULL,NULL,NULL,'${personalAt}'),
         (N'${personalSaved.work}',N'${personalOwner}',NULL,N'${libraryWorkId}',NULL,NULL,NULL,NULL,'${personalAt}'),
         (N'${personalSaved.video}',N'${personalOwner}',NULL,NULL,N'${firstVideoId}',NULL,NULL,NULL,'${personalAt}'),
         (N'${personalSaved.ayah}',N'${personalOwner}',NULL,NULL,NULL,${String(personalAyah.surahNumber)},${String(personalAyah.ayahNumber)},NULL,'${personalAt}'),
         (N'${personalSaved.hadith}',N'${personalOwner}',NULL,NULL,NULL,NULL,NULL,N'${hadithCitation}','${personalAt}'),
         (N'${randomUUID()}',N'${personalOther}',N'${editorialFixture.articleId}',NULL,NULL,NULL,NULL,NULL,'${personalAt}');`,
      'an Article, a Work, a Video, an Ayah and a Hadith citation, each a typed key',
    ],
    [
      'Bookmark, Note and PrivateCollection INSERT',
      `INSERT INTO [dbo].[Bookmark] ([savedItemId],[createdAt]) VALUES (N'${personalSaved.ayah}','${personalAt}');
       INSERT INTO [dbo].[Note] ([savedItemId],[body],[version],[createdAt],[updatedAt]) VALUES (N'${personalSaved.hadith}',N'NON_PERSONALISATION_FIXTURE_NOTE synthetic note',1,'${personalAt}','${personalAt}');
       INSERT INTO [dbo].[PrivateCollection] ([id],[userId],[title],[description],[version],[createdAt],[updatedAt]) VALUES (N'${personalCollection}',N'${personalOwner}',N'NON_PERSONALISATION_FIXTURE_COLLECTION',NULL,1,'${personalAt}','${personalAt}');
       INSERT INTO [dbo].[PrivateCollectionItem] ([collectionId],[savedItemId],[userId],[position],[addedAt]) VALUES
         (N'${personalCollection}',N'${personalSaved.article}',N'${personalOwner}',0,'${personalAt}'),
         (N'${personalCollection}',N'${personalSaved.video}',N'${personalOwner}',1,'${personalAt}');`,
      'a bookmark, a private note and an ordered private collection',
    ],
    [
      'History, Quran position and notification INSERT',
      `INSERT INTO [dbo].[ReadingHistory] ([id],[userId],[articleId],[firstReadAt],[lastReadAt]) VALUES (N'${personalReading}',N'${personalOwner}',N'${editorialFixture.articleId}','${personalAt}','${personalAt}');
       INSERT INTO [dbo].[WatchHistory] ([userId],[videoId],[firstWatchedAt],[lastWatchedAt]) VALUES (N'${personalOwner}',N'${firstVideoId}','${personalAt}','${personalAt}');
       INSERT INTO [dbo].[QuranReadingProgress] ([userId],[surahNumber],[ayahNumber],[version],[updatedAt]) VALUES (N'${personalOwner}',${String(personalAyah.surahNumber)},${String(personalAyah.ayahNumber)},1,'${personalAt}');
       INSERT INTO [dbo].[NotificationPreference] ([userId],[category],[channel],[enabled],[updatedAt]) VALUES (N'${personalOwner}',N'questions',N'in-app',1,'${personalAt}');
       INSERT INTO [dbo].[Notification] ([id],[userId],[kind],[category],[destination],[idempotencyKey],[createdAt]) VALUES (N'${personalNotification}',N'${personalOwner}',N'question-answered',N'questions',N'/en/my/questions/${randomUUID()}',N'lp-${personalRun}','${personalAt}');`,
      'reading and watch history, one Quran position, a preference and a notification',
    ],
    [
      'Owner data UPDATE as granted',
      `UPDATE [dbo].[PersonalisationProfile] SET [onboarding]=N'completed',[historyEnabled]=0,[version]=[version]+1,[updatedAt]='${personalLater}' WHERE [userId]=N'${personalOwner}';
       UPDATE [dbo].[Note] SET [body]=N'NON_PERSONALISATION_FIXTURE_NOTE revised',[version]=[version]+1,[updatedAt]='${personalLater}' WHERE [savedItemId]=N'${personalSaved.hadith}';
       UPDATE [dbo].[PrivateCollection] SET [title]=N'NON_PERSONALISATION_FIXTURE_COLLECTION renamed',[description]=N'NON_PERSONALISATION_FIXTURE description',[version]=[version]+1,[updatedAt]='${personalLater}' WHERE [id]=N'${personalCollection}';
       UPDATE [dbo].[PrivateCollectionItem] SET [position]=[position]+10 WHERE [collectionId]=N'${personalCollection}';
       UPDATE [dbo].[ReadingHistory] SET [lastReadAt]='${personalLater}' WHERE [id]=N'${personalReading}';
       UPDATE [dbo].[WatchHistory] SET [lastWatchedAt]='${personalLater}' WHERE [userId]=N'${personalOwner}';
       UPDATE [dbo].[QuranReadingProgress] SET [version]=[version]+1,[updatedAt]='${personalLater}' WHERE [userId]=N'${personalOwner}';
       UPDATE [dbo].[NotificationPreference] SET [enabled]=0,[updatedAt]='${personalLater}' WHERE [userId]=N'${personalOwner}';
       UPDATE [dbo].[Notification] SET [readAt]='${personalLater}' WHERE [id]=N'${personalNotification}';`,
      'answers, a note, a collection and its order, history instants, a position, a preference, read',
    ],
    [
      'NewsletterSubscriber and consent INSERT',
      `INSERT INTO [dbo].[NewsletterSubscriber] ([id],[emailDigest],[digestKeyVersion],[email],[state],[locale],[generation],[confirmTokenHash],[confirmSalt],[confirmExpiresAt],[unsubscribeTokenHash],[unsubscribeSalt],[tokenKeyVersion],[submittedAt],[version],[updatedAt]) VALUES
         (N'${personalSubscriber}',N'${personalHash('digest')}',1,N'subscriber-${personalRun}@personalisation-proof.invalid',N'pending',N'ur',1,N'${personalHash('confirm')}',N'${personalHash('confirm-salt')}','${personalLater}',N'${personalHash('unsubscribe')}',N'${personalHash('unsubscribe-salt')}',1,'${personalAt}',1,'${personalAt}');
       INSERT INTO [dbo].[NewsletterConsentEvent] ([id],[subscriberId],[event],[purpose],[noticeVersion],[source],[locale],[occurredAt]) VALUES
         (N'${randomUUID()}',N'${personalSubscriber}',N'submitted',N'newsletter',N'NON_PERSONALISATION_FIXTURE_NOTICE',N'newsletter-page',N'ur','${personalAt}');`,
      'a pending subscription holding only link hashes, and its submission evidence',
    ],
    [
      'NewsletterSubscriber state UPDATE',
      `UPDATE [dbo].[NewsletterSubscriber] SET [state]=N'confirmed',[confirmTokenHash]=NULL,[confirmSalt]=NULL,[confirmExpiresAt]=NULL,[confirmedAt]='${personalLater}',[version]=[version]+1,[updatedAt]='${personalLater}' WHERE [id]=N'${personalSubscriber}';
       INSERT INTO [dbo].[NewsletterConsentEvent] ([id],[subscriberId],[event],[purpose],[noticeVersion],[source],[locale],[occurredAt]) VALUES
         (N'${randomUUID()}',N'${personalSubscriber}',N'confirmed',N'newsletter',N'NON_PERSONALISATION_FIXTURE_NOTICE',N'email-link',N'ur','${personalLater}');`,
      'confirmed, with its confirmation evidence appended',
    ],
  ] as const)
    await expectAllowed(app, label, statement, detail);

  // The schema's own rules hold for the runtime as for the owner.
  await expectRefusedByConstraint(
    app,
    'SavedItem target saved twice by one account',
    `INSERT INTO [dbo].[SavedItem] (${savedColumns}) VALUES (N'${randomUUID()}',N'${personalOwner}',N'${editorialFixture.articleId}',NULL,NULL,NULL,NULL,NULL,'${personalAt}');`,
    DUPLICATE_KEY,
    'SavedItem_article_key',
  );
  await expectRefusedByConstraint(
    app,
    'Notification destination off this site',
    `INSERT INTO [dbo].[Notification] ([id],[userId],[kind],[category],[destination],[idempotencyKey],[createdAt]) VALUES (N'${randomUUID()}',N'${personalOwner}',N'question-answered',N'questions',N'https://example.invalid/x',N'lp-${personalRun}-off-site','${personalAt}');`,
    CONSTRAINT_VIOLATION,
    'Notification_ck',
  );

  // Nothing that identifies a row is rewritten, a subscription is never deleted,
  // consent evidence is never changed, and naming a target grants nothing over it.
  for (const [label, statement] of [
    [
      'SavedItem target UPDATE denied',
      'UPDATE [dbo].[SavedItem] SET [articleId]=[articleId];',
    ],
    ['SavedItem owner UPDATE denied', 'UPDATE [dbo].[SavedItem] SET [userId]=[userId];'],
    ['Bookmark UPDATE denied', 'UPDATE [dbo].[Bookmark] SET [createdAt]=[createdAt];'],
    [
      'PersonalisationInterest UPDATE denied',
      'UPDATE [dbo].[PersonalisationInterest] SET [interest]=[interest];',
    ],
    [
      'PersonalisationGoal UPDATE denied',
      'UPDATE [dbo].[PersonalisationGoal] SET [goal]=[goal];',
    ],
    [
      'PersonalisationProfile owner UPDATE denied',
      'UPDATE [dbo].[PersonalisationProfile] SET [userId]=[userId];',
    ],
    [
      'PersonalisationProfile createdAt UPDATE denied',
      'UPDATE [dbo].[PersonalisationProfile] SET [createdAt]=[createdAt];',
    ],
    ['Note anchor UPDATE denied', 'UPDATE [dbo].[Note] SET [savedItemId]=[savedItemId];'],
    [
      'PrivateCollection owner UPDATE denied',
      'UPDATE [dbo].[PrivateCollection] SET [userId]=[userId];',
    ],
    [
      'PrivateCollectionItem member UPDATE denied',
      'UPDATE [dbo].[PrivateCollectionItem] SET [savedItemId]=[savedItemId];',
    ],
    [
      'PrivateCollectionItem owner UPDATE denied',
      'UPDATE [dbo].[PrivateCollectionItem] SET [userId]=[userId];',
    ],
    [
      'ReadingHistory target UPDATE denied',
      'UPDATE [dbo].[ReadingHistory] SET [articleId]=[articleId];',
    ],
    [
      'ReadingHistory owner UPDATE denied',
      'UPDATE [dbo].[ReadingHistory] SET [userId]=[userId];',
    ],
    [
      'ReadingHistory firstReadAt UPDATE denied',
      'UPDATE [dbo].[ReadingHistory] SET [firstReadAt]=[firstReadAt];',
    ],
    [
      'WatchHistory target UPDATE denied',
      'UPDATE [dbo].[WatchHistory] SET [videoId]=[videoId];',
    ],
    [
      'QuranReadingProgress owner UPDATE denied',
      'UPDATE [dbo].[QuranReadingProgress] SET [userId]=[userId];',
    ],
    [
      'NotificationPreference key UPDATE denied',
      'UPDATE [dbo].[NotificationPreference] SET [channel]=[channel];',
    ],
    [
      'Notification destination UPDATE denied',
      'UPDATE [dbo].[Notification] SET [destination]=[destination];',
    ],
    ['Notification kind UPDATE denied', 'UPDATE [dbo].[Notification] SET [kind]=[kind];'],
    [
      'Notification owner UPDATE denied',
      'UPDATE [dbo].[Notification] SET [userId]=[userId];',
    ],
    [
      'NewsletterSubscriber digest UPDATE denied',
      'UPDATE [dbo].[NewsletterSubscriber] SET [emailDigest]=[emailDigest];',
    ],
    [
      'NewsletterSubscriber id UPDATE denied',
      'UPDATE [dbo].[NewsletterSubscriber] SET [id]=[id];',
    ],
    ['NewsletterSubscriber DELETE denied', 'DELETE FROM [dbo].[NewsletterSubscriber];'],
    [
      'NewsletterConsentEvent UPDATE denied',
      "UPDATE [dbo].[NewsletterConsentEvent] SET [event]=N'confirmed';",
    ],
    [
      'NewsletterConsentEvent DELETE denied',
      'DELETE FROM [dbo].[NewsletterConsentEvent];',
    ],
    [
      'Saved Article DELETE still denied',
      `DELETE FROM [dbo].[Article] WHERE [id]=N'${editorialFixture.articleId}';`,
    ],
    [
      'Saved Work DELETE still denied',
      `DELETE FROM [dbo].[Work] WHERE [id]=N'${libraryWorkId}';`,
    ],
    [
      'Saved Video DELETE still denied',
      `DELETE FROM [dbo].[Video] WHERE [id]=N'${firstVideoId}';`,
    ],
    ['Saved Ayah UPDATE still denied', 'UPDATE [dbo].[Ayah] SET [version]=[version];'],
    ['Saved Ayah DELETE still denied', 'DELETE FROM [dbo].[Ayah];'],
    [
      'Saved HadithCitation UPDATE still denied',
      'UPDATE [dbo].[HadithCitation] SET [state]=[state];',
    ],
    ['Saved HadithCitation DELETE still denied', 'DELETE FROM [dbo].[HadithCitation];'],
    [
      'Newsletter Permission INSERT denied',
      "INSERT INTO [dbo].[Permission] ([key],[description]) VALUES (N'newsletter.send',N'forged');",
    ],
    [
      'Newsletter RolePermission UPDATE denied',
      'UPDATE [dbo].[RolePermission] SET [permissionKey]=[permissionKey];',
    ],
    ['Role DELETE still denied', 'DELETE FROM [dbo].[Role];'],
    ['RoleAssignment DELETE still denied', 'DELETE FROM [dbo].[RoleAssignment];'],
  ] as const)
    await expectDenied(app, label, statement);

  // Closure disposition and an owner's own removals: every owner row deletable,
  // the internal cascades taking only their own children.
  await expectAllowed(
    app,
    'Owner data DELETE (disposition)',
    `DELETE FROM [dbo].[PrivateCollection] WHERE [userId]=N'${personalOwner}';
     DELETE FROM [dbo].[Bookmark] WHERE [savedItemId]=N'${personalSaved.ayah}';
     DELETE FROM [dbo].[SavedItem] WHERE [userId]=N'${personalOwner}';
     DELETE FROM [dbo].[ReadingHistory] WHERE [userId]=N'${personalOwner}';
     DELETE FROM [dbo].[WatchHistory] WHERE [userId]=N'${personalOwner}';
     DELETE FROM [dbo].[QuranReadingProgress] WHERE [userId]=N'${personalOwner}';
     DELETE FROM [dbo].[NotificationPreference] WHERE [userId]=N'${personalOwner}';
     DELETE FROM [dbo].[Notification] WHERE [userId]=N'${personalOwner}';
     DELETE FROM [dbo].[PersonalisationInterest] WHERE [userId]=N'${personalOwner}' AND [interest]=N'watch';
     DELETE FROM [dbo].[PersonalisationGoal] WHERE [userId]=N'${personalOwner}';
     DELETE FROM [dbo].[PersonalisationProfile] WHERE [userId]=N'${personalOwner}';`,
    'every row of one account removed, as closure disposition must',
  );

  const [personalState] = await admin.query<Record<string, number | string | null>>(`
    SELECT
      (SELECT COUNT(*) FROM [dbo].[PersonalisationProfile] WHERE [userId]=N'${personalOwner}')
        + (SELECT COUNT(*) FROM [dbo].[PersonalisationInterest] WHERE [userId]=N'${personalOwner}')
        + (SELECT COUNT(*) FROM [dbo].[PersonalisationGoal] WHERE [userId]=N'${personalOwner}')
        + (SELECT COUNT(*) FROM [dbo].[SavedItem] WHERE [userId]=N'${personalOwner}')
        + (SELECT COUNT(*) FROM [dbo].[Bookmark] WHERE [savedItemId] IN (N'${personalSaved.ayah}'))
        + (SELECT COUNT(*) FROM [dbo].[Note] WHERE [savedItemId]=N'${personalSaved.hadith}')
        + (SELECT COUNT(*) FROM [dbo].[PrivateCollection] WHERE [userId]=N'${personalOwner}')
        + (SELECT COUNT(*) FROM [dbo].[PrivateCollectionItem] WHERE [userId]=N'${personalOwner}')
        + (SELECT COUNT(*) FROM [dbo].[ReadingHistory] WHERE [userId]=N'${personalOwner}')
        + (SELECT COUNT(*) FROM [dbo].[WatchHistory] WHERE [userId]=N'${personalOwner}')
        + (SELECT COUNT(*) FROM [dbo].[QuranReadingProgress] WHERE [userId]=N'${personalOwner}')
        + (SELECT COUNT(*) FROM [dbo].[NotificationPreference] WHERE [userId]=N'${personalOwner}')
        + (SELECT COUNT(*) FROM [dbo].[Notification] WHERE [userId]=N'${personalOwner}') AS [ownerRows],
      (SELECT COUNT(*) FROM [dbo].[SavedItem] WHERE [userId]=N'${personalOther}') AS [otherRows],
      (SELECT [state] FROM [dbo].[NewsletterSubscriber] WHERE [id]=N'${personalSubscriber}') AS [subscriber],
      (SELECT COUNT(*) FROM [dbo].[NewsletterConsentEvent] WHERE [subscriberId]=N'${personalSubscriber}') AS [consent],
      (SELECT COUNT(*) FROM [dbo].[Article] WHERE [id]=N'${editorialFixture.articleId}')
        + (SELECT COUNT(*) FROM [dbo].[Work] WHERE [id]=N'${libraryWorkId}')
        + (SELECT COUNT(*) FROM [dbo].[Video] WHERE [id]=N'${firstVideoId}')
        + (SELECT COUNT(*) FROM [dbo].[HadithCitation] WHERE [id]=N'${hadithCitation}')
        + (SELECT COUNT(*) FROM [dbo].[Ayah] WHERE [surahNumber]=${String(personalAyah.surahNumber)} AND [ayahNumber]=${String(personalAyah.ayahNumber)}) AS [targets];
  `);
  if (
    JSON.stringify(personalState) ===
    '{"ownerRows":0,"otherRows":1,"subscriber":"confirmed","consent":2,"targets":5}'
  ) {
    pass(
      'Personalisation state as written',
      "one account disposed of completely, another's untouched, consent appended, targets intact",
    );
  } else {
    fail('Personalisation state as written', JSON.stringify(personalState));
  }

  const PERSONAL_TABLES = [
    'PersonalisationProfile',
    'PersonalisationInterest',
    'PersonalisationGoal',
    'SavedItem',
    'Bookmark',
    'Note',
    'PrivateCollection',
    'PrivateCollectionItem',
    'ReadingHistory',
    'WatchHistory',
    'QuranReadingProgress',
    'NotificationPreference',
    'Notification',
    'NewsletterSubscriber',
    'NewsletterConsentEvent',
  ] as const;
  for (const table of PERSONAL_TABLES) {
    await assertObjectVisible(app, table);
    await expectDenied(
      app,
      `${table} ALTER denied`,
      `ALTER TABLE [dbo].[${table}] ADD [probe] INT NULL;`,
    );
  }
  await expectDenied(
    app,
    'Consent evidence trigger DISABLE denied',
    'DISABLE TRIGGER [dbo].[NewsletterConsentEventImmutable] ON [dbo].[NewsletterConsentEvent];',
  );

  // THE EXACT EFFECTIVE POSTURE, table by table and column by column, for the
  // fifteen Phase-21 tables AND for every owner table a Personalisation key
  // names or a newsletter key lives in, which Phase 21 must leave as it found
  // them. A string names the UPDATE columns exactly; a list names the columns
  // EXCLUDED from an otherwise updatable table; `null` checks the verbs only.
  const OWNER_DATA = 'DELETE,INSERT,SELECT';
  const PERSONAL_POSTURE: Readonly<
    Record<string, readonly [string, string | readonly string[] | null]>
  > = {
    PersonalisationProfile: [OWNER_DATA, ['userId', 'createdAt']],
    PersonalisationInterest: [OWNER_DATA, ''],
    PersonalisationGoal: [OWNER_DATA, ''],
    SavedItem: [OWNER_DATA, ''],
    Bookmark: [OWNER_DATA, ''],
    Note: [OWNER_DATA, 'body,version,updatedAt'],
    PrivateCollection: [OWNER_DATA, 'title,description,version,updatedAt'],
    PrivateCollectionItem: [OWNER_DATA, 'position'],
    ReadingHistory: [OWNER_DATA, 'lastReadAt'],
    WatchHistory: [OWNER_DATA, 'lastWatchedAt'],
    QuranReadingProgress: [OWNER_DATA, 'surahNumber,ayahNumber,version,updatedAt'],
    NotificationPreference: [OWNER_DATA, 'enabled,updatedAt'],
    Notification: [OWNER_DATA, 'readAt'],
    NewsletterSubscriber: ['INSERT,SELECT', ['id', 'emailDigest', 'digestKeyVersion']],
    NewsletterConsentEvent: ['INSERT,SELECT', ''],
    Article: ['INSERT,SELECT', null],
    Work: ['INSERT,SELECT', null],
    Video: ['INSERT,SELECT', null],
    Ayah: ['SELECT', ''],
    HadithCitation: ['SELECT', ''],
    Permission: ['SELECT', ''],
    Role: ['INSERT,SELECT', null],
    RolePermission: [OWNER_DATA, ''],
    RoleAssignment: ['INSERT,SELECT', null],
  };
  const personalPosture = await app.query<{
    name: string;
    held: string | null;
    updatable: string | null;
    columns: string | null;
  }>(`
    SELECT t.[name],
      (SELECT STRING_AGG(p.[permission], N',') WITHIN GROUP (ORDER BY p.[permission])
         FROM (VALUES (N'ALTER'),(N'CONTROL'),(N'DELETE'),(N'INSERT'),(N'REFERENCES'),
                      (N'SELECT'),(N'TAKE OWNERSHIP')) AS p([permission])
        WHERE HAS_PERMS_BY_NAME(N'dbo.' + t.[name], N'OBJECT', p.[permission]) = 1) AS [held],
      (SELECT STRING_AGG(c.[name], N',') WITHIN GROUP (ORDER BY c.[column_id])
         FROM sys.columns c WHERE c.[object_id] = OBJECT_ID(N'dbo.' + t.[name])
          AND HAS_PERMS_BY_NAME(N'dbo.' + t.[name], N'OBJECT', N'UPDATE', c.[name], N'COLUMN') = 1) AS [updatable],
      (SELECT STRING_AGG(c.[name], N',') WITHIN GROUP (ORDER BY c.[column_id])
         FROM sys.columns c WHERE c.[object_id] = OBJECT_ID(N'dbo.' + t.[name])) AS [columns]
    FROM (VALUES ${Object.keys(PERSONAL_POSTURE)
      .map((table) => `(N'${table}')`)
      .join(',')}) AS t([name]);
  `);
  const personalPostureFindings = personalPosture.flatMap((row) => {
    const [verbs, scope] = PERSONAL_POSTURE[row.name] ?? ['?', '?'];
    const expectedColumns =
      scope === null
        ? (row.updatable ?? '')
        : typeof scope === 'string'
          ? scope
          : (row.columns ?? '')
              .split(',')
              .filter((column) => !scope.includes(column))
              .join(',');
    return (row.held ?? '') === verbs && (row.updatable ?? '') === expectedColumns
      ? []
      : [`${row.name}: ${row.held ?? '(none)'} / UPDATE ${row.updatable ?? '(none)'}`];
  });
  if (
    personalPosture.length === Object.keys(PERSONAL_POSTURE).length &&
    Object.keys(PERSONAL_POSTURE).length === PERSONAL_TABLES.length + 9 &&
    personalPostureFindings.length === 0
  ) {
    pass(
      'Personalisation effective posture exact',
      `${String(personalPosture.length)} tables, object verbs and UPDATE columns as granted`,
    );
  } else {
    fail(
      'Personalisation effective posture exact',
      personalPostureFindings.join('; ') || 'tables missing',
    );
  }

  // ---- Phase 22: Learning, in three postures --------------------------------
  //
  // THE CATALOGUE — a Course and a LearningPath — is SELECT, INSERT and UPDATE
  // and never DELETE: a record is withdrawn by archiving it, so the row its
  // slug reservations, path places, Enrolments and Progress point at always
  // exists, and its identifier is never rewritten. Its relation sets (labels,
  // topics, teachers) are replaced wholesale — INSERT and DELETE, never UPDATE;
  // a path's places move (their position is UPDATEd) but never change path or
  // Course — and its slug histories are APPEND ONLY.
  //
  // THE SYLLABUS — modules and lessons — moves and is removed while its Course
  // is a draft, so it holds all four verbs; what places it (its Course, its
  // module) is never rewritten, and its words are replaced wholesale.
  //
  // A LEARNER'S OWN STATE — Enrolment, LessonProgress, TrialClassRequest — is
  // INSERTed and DELETEd (leaving, withdrawing, disposition) and never UPDATEd.
  //
  // Naming a topic, a language, a teacher or an account grants nothing on its
  // owner's table, and no Identity table's posture moves.
  //
  // Every statement below is REAL SQL as the runtime principal over synthetic
  // NON_LEARNING_FIXTURE rows; the two accounts are the owner's rows.
  const learningRun = randomUUID().replaceAll('-', '').slice(0, 16);
  const learningAt = '2026-10-06T00:00:00';
  const learningLater = '2026-10-06T01:00:00';
  const learner = randomUUID();
  const learningOther = randomUUID();
  await admin.query(
    [learner, learningOther]
      .map(
        (id) =>
          `INSERT INTO [dbo].[User] ([id],[name],[email],[emailVerified],[createdAt],[updatedAt],[locale],[status],[twoFactorEnabled])
             VALUES (N'${id}',N'NON_LEARNING_FIXTURE account',N'${id}@learning-proof.invalid',0,SYSUTCDATETIME(),SYSUTCDATETIME(),N'en',N'active',0);`,
      )
      .join('\n'),
  );
  const [learningTopic] = await admin.query<{ id: string }>(
    'SELECT TOP 1 [id] FROM [dbo].[Topic] ORDER BY [slug];',
  );
  if (learningTopic === undefined)
    throw new Error('The migration seeded no canonical Topic for a Course to name.');
  const learningSlug = (label: string): string =>
    `non-learning-fixture-${label}-${learningRun}`;
  const liveCourse = randomUUID();
  const pacedCourse = randomUUID();
  const liveModule = randomUUID();
  const pacedModule = randomUUID();
  const liveLesson = randomUUID();
  const pacedLesson = randomUUID();
  const learningPath = randomUUID();
  const courseColumns =
    '[id],[slug],[primaryLocale],[state],[level],[format],[languageCode],[publishedAt],[version],[updatedAt]';
  const syllabus = (
    courseId: string,
    moduleId: string,
    lessonId: string,
  ): string => `INSERT INTO [dbo].[CourseLabel] ([courseId],[locale],[title],[summary],[description]) VALUES (N'${courseId}',N'en',N'NON_LEARNING_FIXTURE course',N'NON_LEARNING_FIXTURE summary',N'NON_LEARNING_FIXTURE description');
       INSERT INTO [dbo].[CourseModule] ([id],[courseId],[position]) VALUES (N'${moduleId}',N'${courseId}',0);
       INSERT INTO [dbo].[CourseModuleLabel] ([moduleId],[locale],[title],[summary]) VALUES (N'${moduleId}',N'en',N'NON_LEARNING_FIXTURE module',N'NON_LEARNING_FIXTURE summary');
       INSERT INTO [dbo].[Lesson] ([id],[courseId],[moduleId],[position]) VALUES (N'${lessonId}',N'${courseId}',N'${moduleId}',0);
       INSERT INTO [dbo].[LessonLabel] ([lessonId],[locale],[title],[summary],[body]) VALUES (N'${lessonId}',N'en',N'NON_LEARNING_FIXTURE lesson',N'NON_LEARNING_FIXTURE summary',N'NON_LEARNING_FIXTURE body');`;

  for (const [label, statement, detail] of [
    [
      'Course drafts INSERT, with their syllabus',
      `INSERT INTO [dbo].[Course] (${courseColumns}) VALUES
         (N'${liveCourse}',N'${learningSlug('live')}',N'en',N'draft',N'beginner',N'live',N'en',NULL,1,'${learningAt}'),
         (N'${pacedCourse}',N'${learningSlug('paced')}',N'en',N'draft',NULL,N'self-paced',N'en',NULL,1,'${learningAt}');
       ${syllabus(liveCourse, liveModule, liveLesson)}
       ${syllabus(pacedCourse, pacedModule, pacedLesson)}
       INSERT INTO [dbo].[CourseTopic] ([courseId],[topicId]) VALUES (N'${liveCourse}',N'${learningTopic.id}');
       INSERT INTO [dbo].[CourseTeacher] ([courseId],[personId],[position]) VALUES (N'${liveCourse}',N'${editorialPeople.linkedPersonId}',0);`,
      'two draft Courses with labels, modules, lessons, a typed topic and a named teacher',
    ],
    [
      'Draft syllabus reordered and its words replaced',
      `UPDATE [dbo].[CourseModule] SET [position]=1 WHERE [id]=N'${liveModule}';
       UPDATE [dbo].[Lesson] SET [position]=1 WHERE [id]=N'${liveLesson}';
       DELETE FROM [dbo].[LessonLabel] WHERE [lessonId]=N'${liveLesson}';
       INSERT INTO [dbo].[LessonLabel] ([lessonId],[locale],[title],[summary],[body]) VALUES (N'${liveLesson}',N'en',N'NON_LEARNING_FIXTURE lesson revised',N'NON_LEARNING_FIXTURE summary',N'NON_LEARNING_FIXTURE body');
       DELETE FROM [dbo].[CourseModuleLabel] WHERE [moduleId]=N'${liveModule}';
       INSERT INTO [dbo].[CourseModuleLabel] ([moduleId],[locale],[title],[summary]) VALUES (N'${liveModule}',N'en',N'NON_LEARNING_FIXTURE module revised',N'NON_LEARNING_FIXTURE summary');
       DELETE FROM [dbo].[CourseLabel] WHERE [courseId]=N'${liveCourse}';
       INSERT INTO [dbo].[CourseLabel] ([courseId],[locale],[title],[summary],[description]) VALUES (N'${liveCourse}',N'en',N'NON_LEARNING_FIXTURE course revised',N'NON_LEARNING_FIXTURE summary',N'NON_LEARNING_FIXTURE description');`,
      'a module and a lesson moved, module, lesson and Course words replaced',
    ],
    [
      'Course slug renamed and both Courses published',
      `UPDATE [dbo].[Course] SET [slug]=N'${learningSlug('live-renamed')}',[version]=[version]+1,[updatedAt]='${learningLater}' WHERE [id]=N'${liveCourse}';
       UPDATE [dbo].[Course] SET [state]=N'published',[publishedAt]='${learningLater}',[version]=[version]+1,[updatedAt]='${learningLater}' WHERE [id] IN (N'${liveCourse}',N'${pacedCourse}');
       INSERT INTO [dbo].[SearchIndexRequest] ([scopeKind],[scopeId]) VALUES (N'course',N'${liveCourse}'),(N'course',N'${pacedCourse}');`,
      'the former slug reserved by the database, a search pass owed for each',
    ],
    [
      'LearningPath INSERT, its places and publication',
      `INSERT INTO [dbo].[LearningPath] ([id],[slug],[primaryLocale],[state],[publishedAt],[version],[updatedAt]) VALUES (N'${learningPath}',N'${learningSlug('path')}',N'en',N'draft',NULL,1,'${learningAt}');
       INSERT INTO [dbo].[LearningPathLabel] ([pathId],[locale],[title],[summary],[description]) VALUES (N'${learningPath}',N'en',N'NON_LEARNING_FIXTURE path',N'NON_LEARNING_FIXTURE summary',N'NON_LEARNING_FIXTURE description');
       INSERT INTO [dbo].[LearningPathCourse] ([pathId],[courseId],[position]) VALUES (N'${learningPath}',N'${pacedCourse}',0),(N'${learningPath}',N'${liveCourse}',1);
       UPDATE [dbo].[LearningPathCourse] SET [position]=CASE WHEN [courseId]=N'${liveCourse}' THEN 0 ELSE 1 END WHERE [pathId]=N'${learningPath}';
       UPDATE [dbo].[LearningPath] SET [slug]=N'${learningSlug('path-renamed')}',[state]=N'published',[publishedAt]='${learningLater}',[version]=[version]+1,[updatedAt]='${learningLater}' WHERE [id]=N'${learningPath}';
       INSERT INTO [dbo].[SearchIndexRequest] ([scopeKind],[scopeId]) VALUES (N'learning-path',N'${learningPath}');`,
      'a path of two published Courses, reordered in place, renamed and published',
    ],
    [
      'Enrolment, progress and trial request INSERT',
      `INSERT INTO [dbo].[Enrolment] ([userId],[courseId],[enrolledAt]) VALUES (N'${learner}',N'${liveCourse}','${learningAt}'),(N'${learner}',N'${pacedCourse}','${learningAt}'),(N'${learningOther}',N'${liveCourse}','${learningAt}');
       INSERT INTO [dbo].[LessonProgress] ([userId],[courseId],[lessonId],[completedAt]) VALUES (N'${learner}',N'${liveCourse}',N'${liveLesson}','${learningLater}'),(N'${learner}',N'${pacedCourse}',N'${pacedLesson}','${learningLater}');
       INSERT INTO [dbo].[TrialClassRequest] ([id],[userId],[courseId],[requestedAt]) VALUES (N'${randomUUID()}',N'${learner}',N'${liveCourse}','${learningAt}');`,
      "a person's own enrolments, lesson completions and one trial request",
    ],
  ] as const)
    await expectAllowed(app, label, statement, detail);

  // The schema's own rules hold for the runtime as for the owner.
  await expectRefusedByInvariant(
    app,
    "A published Course's syllabus changed",
    `UPDATE [dbo].[Lesson] SET [position]=2 WHERE [id]=N'${liveLesson}';`,
    51271,
  );
  await expectRefusedByInvariant(
    app,
    'Trial request on a self-paced Course',
    `INSERT INTO [dbo].[TrialClassRequest] ([id],[userId],[courseId],[requestedAt]) VALUES (N'${randomUUID()}',N'${learningOther}',N'${pacedCourse}','${learningAt}');`,
    51276,
  );
  await expectRefusedByInvariant(
    app,
    'Course in a published path archived',
    `UPDATE [dbo].[Course] SET [state]=N'archived' WHERE [id]=N'${liveCourse}';`,
    51273,
  );
  await expectRefusedByConstraint(
    app,
    "Progress on another Course's lesson",
    `INSERT INTO [dbo].[LessonProgress] ([userId],[courseId],[lessonId],[completedAt]) VALUES (N'${learningOther}',N'${liveCourse}',N'${pacedLesson}','${learningLater}');`,
    CONSTRAINT_VIOLATION,
    'LessonProgress_lesson_fkey',
  );
  await expectRefusedByConstraint(
    app,
    "Another Course taking a Course's former slug",
    `UPDATE [dbo].[Course] SET [slug]=N'${learningSlug('live')}' WHERE [id]=N'${pacedCourse}';`,
    DUPLICATE_KEY,
    'CourseSlugHistory_pkey',
  );

  // A record is archived, never deleted; nothing that places a row is
  // rewritten; a learner's rows are never edited; slug reservations are never
  // freed; and naming an owner's row grants nothing over it.
  for (const [label, statement] of [
    ['Course DELETE denied', 'DELETE FROM [dbo].[Course];'],
    ['Course id UPDATE denied', 'UPDATE [dbo].[Course] SET [id]=[id];'],
    ['LearningPath DELETE denied', 'DELETE FROM [dbo].[LearningPath];'],
    ['LearningPath id UPDATE denied', 'UPDATE [dbo].[LearningPath] SET [id]=[id];'],
    ['CourseLabel UPDATE denied', 'UPDATE [dbo].[CourseLabel] SET [title]=[title];'],
    ['CourseTopic UPDATE denied', 'UPDATE [dbo].[CourseTopic] SET [topicId]=[topicId];'],
    [
      'CourseTeacher UPDATE denied',
      'UPDATE [dbo].[CourseTeacher] SET [position]=[position];',
    ],
    [
      'LearningPathLabel UPDATE denied',
      'UPDATE [dbo].[LearningPathLabel] SET [title]=[title];',
    ],
    [
      'LearningPathCourse Course UPDATE denied',
      'UPDATE [dbo].[LearningPathCourse] SET [courseId]=[courseId];',
    ],
    [
      'LearningPathCourse path UPDATE denied',
      'UPDATE [dbo].[LearningPathCourse] SET [pathId]=[pathId];',
    ],
    [
      'CourseModule Course UPDATE denied',
      'UPDATE [dbo].[CourseModule] SET [courseId]=[courseId];',
    ],
    ['CourseModule id UPDATE denied', 'UPDATE [dbo].[CourseModule] SET [id]=[id];'],
    ['Lesson module UPDATE denied', 'UPDATE [dbo].[Lesson] SET [moduleId]=[moduleId];'],
    ['Lesson Course UPDATE denied', 'UPDATE [dbo].[Lesson] SET [courseId]=[courseId];'],
    [
      'CourseModuleLabel UPDATE denied',
      'UPDATE [dbo].[CourseModuleLabel] SET [title]=[title];',
    ],
    ['LessonLabel UPDATE denied', 'UPDATE [dbo].[LessonLabel] SET [body]=[body];'],
    [
      'CourseSlugHistory UPDATE denied',
      'UPDATE [dbo].[CourseSlugHistory] SET [courseId]=[courseId];',
    ],
    ['CourseSlugHistory DELETE denied', 'DELETE FROM [dbo].[CourseSlugHistory];'],
    [
      'LearningPathSlugHistory UPDATE denied',
      'UPDATE [dbo].[LearningPathSlugHistory] SET [pathId]=[pathId];',
    ],
    [
      'LearningPathSlugHistory DELETE denied',
      'DELETE FROM [dbo].[LearningPathSlugHistory];',
    ],
    [
      'Enrolment UPDATE denied',
      'UPDATE [dbo].[Enrolment] SET [enrolledAt]=[enrolledAt];',
    ],
    [
      'Enrolment Course UPDATE denied',
      'UPDATE [dbo].[Enrolment] SET [courseId]=[courseId];',
    ],
    [
      'LessonProgress UPDATE denied',
      'UPDATE [dbo].[LessonProgress] SET [completedAt]=[completedAt];',
    ],
    [
      'TrialClassRequest UPDATE denied',
      'UPDATE [dbo].[TrialClassRequest] SET [courseId]=[courseId];',
    ],
    [
      'Named Topic DELETE still denied',
      `DELETE FROM [dbo].[Topic] WHERE [id]=N'${learningTopic.id}';`,
    ],
    [
      'Named teacher Person DELETE still denied',
      `DELETE FROM [dbo].[Person] WHERE [id]=N'${editorialPeople.linkedPersonId}';`,
    ],
    [
      'Named Language DELETE still denied',
      "DELETE FROM [dbo].[Language] WHERE [code]=N'en';",
    ],
    [
      'Learner account DELETE still denied',
      `DELETE FROM [dbo].[User] WHERE [id]=N'${learner}';`,
    ],
    [
      'Learning Permission INSERT denied',
      "INSERT INTO [dbo].[Permission] ([key],[description]) VALUES (N'teaching.perform',N'forged');",
    ],
    [
      'Learning RolePermission UPDATE denied',
      'UPDATE [dbo].[RolePermission] SET [permissionKey]=[permissionKey];',
    ],
  ] as const)
    await expectDenied(app, label, statement);

  // Leaving, withdrawing and closure disposition: every learner row deletable,
  // in its own order, and the other person's untouched.
  await expectAllowed(
    app,
    'Learner rows DELETE (leave, withdraw, dispose)',
    `DELETE FROM [dbo].[LessonProgress] WHERE [userId]=N'${learner}';
     DELETE FROM [dbo].[Enrolment] WHERE [userId]=N'${learner}';
     DELETE FROM [dbo].[TrialClassRequest] WHERE [userId]=N'${learner}';`,
    'every learning row of one account removed, as leaving and disposition must',
  );

  const [learningState] = await admin.query<Record<string, number | string | null>>(`
    SELECT
      (SELECT COUNT(*) FROM [dbo].[Enrolment] WHERE [userId]=N'${learner}')
        + (SELECT COUNT(*) FROM [dbo].[LessonProgress] WHERE [userId]=N'${learner}')
        + (SELECT COUNT(*) FROM [dbo].[TrialClassRequest] WHERE [userId]=N'${learner}') AS [learnerRows],
      (SELECT COUNT(*) FROM [dbo].[Enrolment] WHERE [userId]=N'${learningOther}') AS [otherRows],
      (SELECT STRING_AGG([slug], N',') WITHIN GROUP (ORDER BY [slug]) FROM [dbo].[CourseSlugHistory] WHERE [courseId]=N'${liveCourse}') AS [reserved],
      (SELECT STRING_AGG(c.[slug], N',') WITHIN GROUP (ORDER BY pc.[position])
         FROM [dbo].[LearningPathCourse] pc JOIN [dbo].[Course] c ON c.[id] = pc.[courseId]
        WHERE pc.[pathId]=N'${learningPath}') AS [path],
      (SELECT COUNT(*) FROM [dbo].[Course] WHERE [id] IN (N'${liveCourse}',N'${pacedCourse}') AND [state]=N'published') AS [published],
      (SELECT COUNT(*) FROM [dbo].[SearchIndexRequest] WHERE [scopeKind] IN (N'course',N'learning-path')
         AND [scopeId] IN (N'${liveCourse}',N'${pacedCourse}',N'${learningPath}')) AS [search],
      (SELECT COUNT(*) FROM [dbo].[Topic] WHERE [id]=N'${learningTopic.id}')
        + (SELECT COUNT(*) FROM [dbo].[Person] WHERE [id]=N'${editorialPeople.linkedPersonId}')
        + (SELECT COUNT(*) FROM [dbo].[User] WHERE [id] IN (N'${learner}',N'${learningOther}')) AS [owners];
  `);
  const expectedLearningState = {
    learnerRows: 0,
    otherRows: 1,
    reserved: [learningSlug('live'), learningSlug('live-renamed')].sort().join(','),
    path: [learningSlug('live-renamed'), learningSlug('paced')].join(','),
    published: 2,
    search: 3,
    owners: 4,
  };
  if (JSON.stringify(learningState) === JSON.stringify(expectedLearningState)) {
    pass(
      'Learning state as written',
      "one learner's rows removed, another's untouched, slugs reserved, path in order",
    );
  } else {
    fail('Learning state as written', JSON.stringify(learningState));
  }

  const LEARNING_TABLES = [
    'Course',
    'CourseLabel',
    'CourseSlugHistory',
    'CourseTopic',
    'CourseTeacher',
    'CourseModule',
    'CourseModuleLabel',
    'Lesson',
    'LessonLabel',
    'LearningPath',
    'LearningPathLabel',
    'LearningPathSlugHistory',
    'LearningPathCourse',
    'Enrolment',
    'LessonProgress',
    'TrialClassRequest',
  ] as const;
  for (const table of LEARNING_TABLES) {
    await assertObjectVisible(app, table);
    await expectDenied(
      app,
      `${table} ALTER denied`,
      `ALTER TABLE [dbo].[${table}] ADD [probe] INT NULL;`,
    );
  }
  for (const [trigger, table] of [
    ['LearningReserveCourseSlug', 'Course'],
    ['LearningReservePathSlug', 'LearningPath'],
    ['LearningCourseIntegrity', 'Course'],
    ['LearningModuleFrozen', 'CourseModule'],
    ['LearningModuleLabelFrozen', 'CourseModuleLabel'],
    ['LearningLessonFrozen', 'Lesson'],
    ['LearningLessonLabelFrozen', 'LessonLabel'],
    ['LearningPathIntegrity', 'LearningPath'],
    ['LearningPathPlaces', 'LearningPathCourse'],
    ['LearningEnrolmentOpen', 'Enrolment'],
    ['LearningProgressOpen', 'LessonProgress'],
    ['LearningTrialOpen', 'TrialClassRequest'],
  ] as const)
    await expectDenied(
      app,
      `${trigger} DISABLE denied`,
      `DISABLE TRIGGER [dbo].[${trigger}] ON [dbo].[${table}];`,
    );

  // THE EXACT EFFECTIVE POSTURE, table by table and column by column, for the
  // sixteen Phase-22 tables AND for every owner table a Learning key names or a
  // Learning key lives in, which Phase 22 must leave as it found them. A string
  // names the UPDATE columns exactly; a list names the columns EXCLUDED from an
  // otherwise updatable table; `null` checks the verbs only.
  const LEARNER_DATA = 'DELETE,INSERT,SELECT';
  const LEARNING_POSTURE: Readonly<
    Record<string, readonly [string, string | readonly string[] | null]>
  > = {
    Course: ['INSERT,SELECT', ['id']],
    CourseLabel: [LEARNER_DATA, ''],
    CourseSlugHistory: ['INSERT,SELECT', ''],
    CourseTopic: [LEARNER_DATA, ''],
    CourseTeacher: [LEARNER_DATA, ''],
    CourseModule: [LEARNER_DATA, 'position'],
    CourseModuleLabel: [LEARNER_DATA, ''],
    Lesson: [LEARNER_DATA, 'position'],
    LessonLabel: [LEARNER_DATA, ''],
    LearningPath: ['INSERT,SELECT', ['id']],
    LearningPathLabel: [LEARNER_DATA, ''],
    LearningPathSlugHistory: ['INSERT,SELECT', ''],
    LearningPathCourse: [LEARNER_DATA, 'position'],
    Enrolment: [LEARNER_DATA, ''],
    LessonProgress: [LEARNER_DATA, ''],
    TrialClassRequest: [LEARNER_DATA, ''],
    Topic: ['INSERT,SELECT', null],
    Language: ['INSERT,SELECT', null],
    Person: ['SELECT', null],
    User: ['INSERT,SELECT', null],
    Permission: ['SELECT', ''],
    RolePermission: [LEARNER_DATA, ''],
  };
  const learningPosture = await app.query<{
    name: string;
    held: string | null;
    updatable: string | null;
    columns: string | null;
  }>(`
    SELECT t.[name],
      (SELECT STRING_AGG(p.[permission], N',') WITHIN GROUP (ORDER BY p.[permission])
         FROM (VALUES (N'ALTER'),(N'CONTROL'),(N'DELETE'),(N'INSERT'),(N'REFERENCES'),
                      (N'SELECT'),(N'TAKE OWNERSHIP')) AS p([permission])
        WHERE HAS_PERMS_BY_NAME(N'dbo.' + t.[name], N'OBJECT', p.[permission]) = 1) AS [held],
      (SELECT STRING_AGG(c.[name], N',') WITHIN GROUP (ORDER BY c.[column_id])
         FROM sys.columns c WHERE c.[object_id] = OBJECT_ID(N'dbo.' + t.[name])
          AND HAS_PERMS_BY_NAME(N'dbo.' + t.[name], N'OBJECT', N'UPDATE', c.[name], N'COLUMN') = 1) AS [updatable],
      (SELECT STRING_AGG(c.[name], N',') WITHIN GROUP (ORDER BY c.[column_id])
         FROM sys.columns c WHERE c.[object_id] = OBJECT_ID(N'dbo.' + t.[name])) AS [columns]
    FROM (VALUES ${Object.keys(LEARNING_POSTURE)
      .map((table) => `(N'${table}')`)
      .join(',')}) AS t([name]);
  `);
  const learningPostureFindings = learningPosture.flatMap((row) => {
    const [verbs, scope] = LEARNING_POSTURE[row.name] ?? ['?', '?'];
    const expectedColumns =
      scope === null
        ? (row.updatable ?? '')
        : typeof scope === 'string'
          ? scope
          : (row.columns ?? '')
              .split(',')
              .filter((column) => !scope.includes(column))
              .join(',');
    return (row.held ?? '') === verbs && (row.updatable ?? '') === expectedColumns
      ? []
      : [`${row.name}: ${row.held ?? '(none)'} / UPDATE ${row.updatable ?? '(none)'}`];
  });
  if (
    learningPosture.length === Object.keys(LEARNING_POSTURE).length &&
    Object.keys(LEARNING_POSTURE).length === LEARNING_TABLES.length + 6 &&
    learningPostureFindings.length === 0
  ) {
    pass(
      'Learning effective posture exact',
      `${String(learningPosture.length)} tables, object verbs and UPDATE columns as granted`,
    );
  } else {
    fail(
      'Learning effective posture exact',
      learningPostureFindings.join('; ') || 'tables missing',
    );
  }

  // ---- Phase 23: live classes, in four postures ------------------------------
  //
  // THE ACTIVATION is the owner's: SELECT and nothing else. No runtime
  // permission can turn live learning on or re-label a fixture as approved.
  //
  // A TEACHING SCOPE and a SESSION are history: INSERT, UPDATE of what moves
  // (a scope's ending and version; a session's times, address, state, reminder
  // and closure) and never DELETE; what identifies each — the Course, the
  // account, the RoleAssignment, the grant; the Course, the kind, the creation
  // instant — is never UPDATEd.
  //
  // A WINDOW, a BOOKING, an ATTENDANCE MARK and an INTENT are an account's own
  // and are removed by its disposition, so they hold all four verbs; what
  // identifies each carries a column DENY.
  //
  // Naming an account, an assignment, a Course or a request grants nothing on
  // its owner's table, and no Identity table's posture moves: the runtime
  // still cannot catalogue a key, rewrite a bundle entry or erase an
  // assignment, an account or a Person.
  //
  // Every statement below is REAL SQL as the runtime principal over synthetic
  // NON_LEARNING_FIXTURE rows; the activation, the teaching role and its
  // assignment are the owner's rows, written with administrative authority.
  const classDay = '2026-10-07';
  const classesAt = `${classDay}T00:00:00`;
  const classInstant = (hour: string): string => `'${classDay}T${hour}:00'`;
  const classLocal = (hour: string): string => `N'${classDay}T${hour}'`;
  const MEET = 'https://meet.google.com/abc-defg-hij';
  const classTeacher = randomUUID();
  const classRole = randomUUID();
  const classAssignment = randomUUID();
  await admin.query(`
    INSERT INTO [dbo].[LiveLearningActivation] ([id],[authority],[authorisedBy],[reference])
      VALUES (1,N'fixture',N'NON_LEARNING_FIXTURE operator',NULL);
    INSERT INTO [dbo].[User] ([id],[name],[email],[emailVerified],[createdAt],[updatedAt],[locale],[status],[twoFactorEnabled])
      VALUES (N'${classTeacher}',N'NON_LEARNING_FIXTURE teacher',N'${classTeacher}@learning-proof.invalid',0,SYSUTCDATETIME(),SYSUTCDATETIME(),N'en',N'active',0);
    INSERT INTO [dbo].[Role] ([id],[key],[name],[description],[system])
      VALUES (N'${classRole}',N'lp-teaching-${learningRun}',N'NON_LEARNING_FIXTURE teaching role',N'Least-privilege proof only.',0);
    INSERT INTO [dbo].[RolePermission] ([roleId],[permissionKey]) VALUES (N'${classRole}',N'teaching.perform');
    INSERT INTO [dbo].[RoleAssignment] ([id],[userId],[roleId]) VALUES (N'${classAssignment}',N'${classTeacher}',N'${classRole}');
  `);
  const classScope = randomUUID();
  const windowA = randomUUID();
  const windowB = randomUUID();
  const trialSession = randomUUID();
  const trialCancelled = randomUUID();
  const courseSession = randomUUID();
  const doneSession = randomUUID();
  const classRequest = randomUUID();
  const otherRequest = randomUUID();
  const classBooking = randomUUID();
  const classIntent = randomUUID();
  const classWindow = (id: string, from: string, to: string): string =>
    `INSERT INTO [dbo].[Availability] ([id],[userId],[startsAt],[endsAt],[timeZone],[startsLocal],[endsLocal],[state]) VALUES (N'${id}',N'${classTeacher}',${classInstant(from)},${classInstant(to)},N'Europe/London',${classLocal(from)},${classLocal(to)},N'open');`;
  const classSessionRow = (
    id: string,
    kind: 'course' | 'trial',
    from: string,
    to: string,
    extra: { meeting?: boolean; reminder?: string; cancelled?: boolean } = {},
  ): string =>
    `INSERT INTO [dbo].[ClassSession] ([id],[courseId],[kind],[scopeId],[startsAt],[endsAt],[timeZone],[startsLocal],[endsLocal],[state],[meetingProvider],[meetingUrl],[reminderAt],[closedAt]) VALUES (N'${id}',N'${liveCourse}',N'${kind}',N'${classScope}',${classInstant(from)},${classInstant(to)},N'Europe/London',${classLocal(from)},${classLocal(to)},N'${extra.cancelled ? 'cancelled' : 'scheduled'}',${extra.meeting ? "N'google-meet'" : 'NULL'},${extra.meeting ? `N'${MEET}'` : 'NULL'},${extra.reminder ? classInstant(extra.reminder) : 'NULL'},${extra.cancelled ? classInstant(to) : 'NULL'});`;
  const classBookingRow = (
    id: string,
    requestId: string,
    userId: string,
    sessionId: string,
    windowId: string,
  ): string =>
    `INSERT INTO [dbo].[Booking] ([id],[requestId],[userId],[courseId],[sessionId],[availabilityId],[state],[confirmedAt],[confirmedById]) VALUES (N'${id}',N'${requestId}',N'${userId}',N'${liveCourse}',N'${sessionId}',N'${windowId}',N'confirmed','${classesAt}',NULL);`;

  for (const [label, statement, detail] of [
    [
      'Teaching scope INSERT',
      `INSERT INTO [dbo].[CourseTeachingAssignment] ([id],[courseId],[userId],[roleAssignmentId],[grantedAt],[grantedById]) VALUES (N'${classScope}',N'${liveCourse}',N'${classTeacher}',N'${classAssignment}','${classesAt}',NULL);`,
      'a typed scope naming the Course, the account and its live teaching.perform assignment',
    ],
    [
      'Availability INSERT',
      `${classWindow(windowA, '09:00', '10:00')}
       ${classWindow(windowB, '10:00', '11:00')}`,
      'two adjacent open windows',
    ],
    [
      'ClassSession INSERT (trial and course)',
      `${classSessionRow(trialSession, 'trial', '09:00', '10:00', { meeting: true })}
       ${classSessionRow(courseSession, 'course', '11:00', '12:00', { reminder: '10:30' })}
       ${classSessionRow(doneSession, 'course', '12:00', '13:00')}`,
      'a trial session with its meeting address and two Course sessions, one with a reminder',
    ],
    [
      'Trial request and Booking INSERT',
      `INSERT INTO [dbo].[TrialClassRequest] ([id],[userId],[courseId],[requestedAt]) VALUES
         (N'${classRequest}',N'${learner}',N'${liveCourse}','${classesAt}'),
         (N'${otherRequest}',N'${learningOther}',N'${liveCourse}','${classesAt}');
       ${classBookingRow(classBooking, classRequest, learner, trialSession, windowA)}`,
      "the learner's request confirmed into a Booking of the trial session and its window",
    ],
    [
      'Attendance INSERT and UPDATE',
      `INSERT INTO [dbo].[Attendance] ([sessionId],[userId],[status],[markedAt],[markedById]) VALUES
         (N'${trialSession}',N'${learner}',N'present','${classesAt}',N'${classTeacher}'),
         (N'${courseSession}',N'${learningOther}',N'present','${classesAt}',N'${classTeacher}');
       UPDATE [dbo].[Attendance] SET [status]=N'absent',[markedAt]='${classesAt}' WHERE [sessionId]=N'${courseSession}' AND [userId]=N'${learningOther}';`,
      'the trial learner and an enrolled learner marked, one mark corrected',
    ],
    [
      'ClassCommunicationIntent INSERT and state UPDATE',
      `INSERT INTO [dbo].[ClassCommunicationIntent] ([id],[purpose],[sessionId],[userId],[dueAt],[state],[idempotencyKey]) VALUES
         (N'${classIntent}',N'learning.booking-confirmed',N'${trialSession}',N'${learner}','${classesAt}',N'pending',N'lp-${learningRun}-confirmed');
       UPDATE [dbo].[ClassCommunicationIntent] SET [state]=N'relayed',[relayedAt]='${classesAt}' WHERE [id]=N'${classIntent}';`,
      'a pending intent committed and relayed',
    ],
    [
      'Session reschedule, meeting address and completion UPDATE',
      `UPDATE [dbo].[ClassSession] SET [startsAt]=${classInstant('11:30')},[startsLocal]=${classLocal('11:30')},[reminderAt]=${classInstant('11:00')},[version]=2 WHERE [id]=N'${courseSession}';
       UPDATE [dbo].[ClassSession] SET [meetingProvider]=N'google-meet',[meetingUrl]=N'${MEET}',[version]=3 WHERE [id]=N'${courseSession}';
       UPDATE [dbo].[ClassSession] SET [state]=N'completed',[closedAt]=${classInstant('13:00')},[version]=2 WHERE [id]=N'${doneSession}';`,
      'a Course session moved and re-addressed, another completed',
    ],
    [
      'Availability state UPDATE',
      `UPDATE [dbo].[Availability] SET [state]=N'withdrawn',[version]=2 WHERE [id]=N'${windowB}';`,
      'an unbooked window withdrawn',
    ],
    [
      'sys.sp_getapplock EXECUTE',
      `DECLARE @held INT;
       EXEC @held = sys.sp_getapplock @Resource=N'minhaj:learning:proof-${learningRun}', @LockMode=N'Exclusive', @LockOwner=N'Session', @LockTimeout=0;
       IF @held < 0 THROW 50000, N'sp_getapplock refused the runtime principal.', 1;
       EXEC sys.sp_releaseapplock @Resource=N'minhaj:learning:proof-${learningRun}', @LockOwner=N'Session';`,
      'the teacher serialisation lock is reachable through the public role',
    ],
  ] as const)
    await expectAllowed(app, label, statement, detail);

  // The schema's own rules hold for the runtime as for the owner.
  await expectRefusedByInvariant(
    app,
    "Session overlapping the teacher's scheduled one",
    classSessionRow(randomUUID(), 'trial', '09:30', '10:30'),
    51287,
  );
  await expectRefusedByInvariant(
    app,
    'Attendance for a learner not enrolled on the Course',
    `INSERT INTO [dbo].[Attendance] ([sessionId],[userId],[status],[markedAt],[markedById]) VALUES (N'${courseSession}',N'${learner}',N'present','${classesAt}',NULL);`,
    51289,
  );
  await expectRefusedByInvariant(
    app,
    'Completed session moved',
    `UPDATE [dbo].[ClassSession] SET [startsAt]=${classInstant('12:30')},[startsLocal]=${classLocal('12:30')} WHERE [id]=N'${doneSession}';`,
    51286,
  );
  await expectAllowed(
    app,
    'Second trial session at the booked hour, inserted cancelled',
    classSessionRow(trialCancelled, 'trial', '09:00', '10:00', { cancelled: true }),
    'a cancelled session blocks nothing and claims nothing',
  );
  await expectRefusedByConstraint(
    app,
    'Second live claim on one window',
    classBookingRow(randomUUID(), otherRequest, learningOther, trialCancelled, windowA),
    DUPLICATE_KEY,
    'Booking_slot_key',
  );
  await expectRefusedByConstraint(
    app,
    'Trial request DELETE while booked',
    `DELETE FROM [dbo].[TrialClassRequest] WHERE [id]=N'${classRequest}';`,
    CONSTRAINT_VIOLATION,
    'Booking_requestId_fkey',
  );

  // The activation is never the runtime's; a scope and a session are never
  // deleted and never re-identified; an owner's rows are never re-keyed; and
  // naming Identity's rows grants nothing over them.
  for (const [label, statement] of [
    [
      'LiveLearningActivation INSERT denied',
      "INSERT INTO [dbo].[LiveLearningActivation] ([id],[authority],[authorisedBy],[reference]) VALUES (2,N'approved',N'forged',N'urn:example:forged');",
    ],
    [
      'LiveLearningActivation UPDATE denied',
      "UPDATE [dbo].[LiveLearningActivation] SET [authority]=N'approved';",
    ],
    [
      'LiveLearningActivation DELETE denied',
      'DELETE FROM [dbo].[LiveLearningActivation];',
    ],
    [
      'CourseTeachingAssignment DELETE denied',
      'DELETE FROM [dbo].[CourseTeachingAssignment];',
    ],
    [
      'CourseTeachingAssignment Course UPDATE denied',
      'UPDATE [dbo].[CourseTeachingAssignment] SET [courseId]=[courseId];',
    ],
    [
      'CourseTeachingAssignment account UPDATE denied',
      'UPDATE [dbo].[CourseTeachingAssignment] SET [userId]=[userId];',
    ],
    [
      'CourseTeachingAssignment assignment UPDATE denied',
      'UPDATE [dbo].[CourseTeachingAssignment] SET [roleAssignmentId]=[roleAssignmentId];',
    ],
    [
      'CourseTeachingAssignment grant UPDATE denied',
      'UPDATE [dbo].[CourseTeachingAssignment] SET [grantedAt]=[grantedAt];',
    ],
    ['ClassSession DELETE denied', 'DELETE FROM [dbo].[ClassSession];'],
    [
      'ClassSession Course UPDATE denied',
      'UPDATE [dbo].[ClassSession] SET [courseId]=[courseId];',
    ],
    ['ClassSession kind UPDATE denied', 'UPDATE [dbo].[ClassSession] SET [kind]=[kind];'],
    [
      'ClassSession creation UPDATE denied',
      'UPDATE [dbo].[ClassSession] SET [createdAt]=[createdAt];',
    ],
    [
      'Availability owner UPDATE denied',
      'UPDATE [dbo].[Availability] SET [userId]=[userId];',
    ],
    [
      'Availability times UPDATE denied',
      'UPDATE [dbo].[Availability] SET [startsAt]=[startsAt];',
    ],
    [
      'Booking request UPDATE denied',
      'UPDATE [dbo].[Booking] SET [requestId]=[requestId];',
    ],
    ['Booking learner UPDATE denied', 'UPDATE [dbo].[Booking] SET [userId]=[userId];'],
    [
      'Booking session UPDATE denied',
      'UPDATE [dbo].[Booking] SET [sessionId]=[sessionId];',
    ],
    [
      'Booking window UPDATE denied',
      'UPDATE [dbo].[Booking] SET [availabilityId]=[availabilityId];',
    ],
    [
      'Attendance session UPDATE denied',
      'UPDATE [dbo].[Attendance] SET [sessionId]=[sessionId];',
    ],
    [
      'Attendance account UPDATE denied',
      'UPDATE [dbo].[Attendance] SET [userId]=[userId];',
    ],
    [
      'ClassCommunicationIntent purpose UPDATE denied',
      'UPDATE [dbo].[ClassCommunicationIntent] SET [purpose]=[purpose];',
    ],
    [
      'ClassCommunicationIntent key UPDATE denied',
      'UPDATE [dbo].[ClassCommunicationIntent] SET [idempotencyKey]=[idempotencyKey];',
    ],
    [
      'ClassCommunicationIntent recipient UPDATE denied',
      'UPDATE [dbo].[ClassCommunicationIntent] SET [userId]=[userId];',
    ],
    [
      'teaching.perform Permission INSERT still denied',
      "INSERT INTO [dbo].[Permission] ([key],[description]) VALUES (N'teaching.perform',N'forged');",
    ],
    [
      'Permission description UPDATE denied',
      "UPDATE [dbo].[Permission] SET [description]=N'forged' WHERE [key]=N'teaching.perform';",
    ],
    [
      'RolePermission UPDATE denied',
      'UPDATE [dbo].[RolePermission] SET [permissionKey]=[permissionKey];',
    ],
    [
      'Teaching RoleAssignment DELETE denied',
      `DELETE FROM [dbo].[RoleAssignment] WHERE [id]=N'${classAssignment}';`,
    ],
    [
      'Teacher account DELETE denied',
      `DELETE FROM [dbo].[User] WHERE [id]=N'${classTeacher}';`,
    ],
    [
      'Named Person DELETE still denied',
      `DELETE FROM [dbo].[Person] WHERE [id]=N'${editorialPeople.linkedPersonId}';`,
    ],
    [
      'Named Person slug UPDATE still denied',
      `UPDATE [dbo].[Person] SET [slug]=[slug] WHERE [id]=N'${editorialPeople.linkedPersonId}';`,
    ],
  ] as const)
    await expectDenied(app, label, statement);

  // Closure disposition and the end of a teaching scope: the owner's rows go,
  // children first; the scope and every session stay as history.
  await expectAllowed(
    app,
    'Booking cancelled, then owner rows DELETE (dispose) and scope ended',
    `UPDATE [dbo].[Booking] SET [state]=N'cancelled',[cancelledAt]='${classesAt}',[version]=2 WHERE [id]=N'${classBooking}';
     DELETE FROM [dbo].[ClassCommunicationIntent] WHERE [userId]=N'${learner}';
     DELETE FROM [dbo].[Attendance] WHERE [userId] IN (N'${learner}',N'${learningOther}');
     DELETE FROM [dbo].[Booking] WHERE [userId]=N'${learner}';
     DELETE FROM [dbo].[TrialClassRequest] WHERE [userId] IN (N'${learner}',N'${learningOther}');
     DELETE FROM [dbo].[Availability] WHERE [userId]=N'${classTeacher}';
     UPDATE [dbo].[CourseTeachingAssignment] SET [endedAt]='${classesAt}',[endedById]=NULL,[version]=2 WHERE [id]=N'${classScope}';`,
    'intents, marks, the Booking, requests and windows removed; the scope ended, sessions kept',
  );

  const [classesState] = await admin.query<Record<string, number | string | null>>(`
    SELECT
      (SELECT [authority] FROM [dbo].[LiveLearningActivation] WHERE [id]=1) AS [activation],
      (SELECT COUNT(*) FROM [dbo].[CourseTeachingAssignment] WHERE [id]=N'${classScope}' AND [endedAt] IS NOT NULL) AS [scopeEnded],
      (SELECT STRING_AGG([state], N',') WITHIN GROUP (ORDER BY [startsAt], [state])
         FROM [dbo].[ClassSession] WHERE [scopeId]=N'${classScope}') AS [sessions],
      (SELECT COUNT(*) FROM [dbo].[ClassSession] WHERE [id]=N'${doneSession}' AND [meetingUrl] IS NULL AND [closedAt] IS NOT NULL) AS [closedClean],
      (SELECT [meetingUrl] FROM [dbo].[ClassSession] WHERE [id]=N'${trialSession}') AS [meeting],
      (SELECT COUNT(*) FROM [dbo].[Booking]) + (SELECT COUNT(*) FROM [dbo].[Attendance])
        + (SELECT COUNT(*) FROM [dbo].[ClassCommunicationIntent]) + (SELECT COUNT(*) FROM [dbo].[Availability]) AS [ownerRows],
      (SELECT COUNT(*) FROM [dbo].[RoleAssignment] ra JOIN [dbo].[RolePermission] rp ON rp.[roleId]=ra.[roleId]
        WHERE rp.[permissionKey]=N'teaching.perform' AND ra.[revokedAt] IS NULL) AS [teachers],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] rp JOIN [dbo].[Role] r ON r.[id]=rp.[roleId]
        WHERE r.[key]=N'platform-administrator' AND rp.[permissionKey] IN (N'learning.classes.read',N'learning.classes.administer')) AS [bundled];
  `);
  const expectedClassesState = {
    activation: 'fixture',
    scopeEnded: 1,
    sessions: 'cancelled,scheduled,scheduled,completed',
    closedClean: 1,
    meeting: MEET,
    ownerRows: 0,
    teachers: 1,
    bundled: 2,
  };
  if (JSON.stringify(classesState) === JSON.stringify(expectedClassesState)) {
    pass(
      'Live-class state as written',
      'activation untouched, scope ended, four sessions kept, owner rows gone, one teacher',
    );
  } else {
    fail('Live-class state as written', JSON.stringify(classesState));
  }

  const CLASSES_TABLES = [
    'LiveLearningActivation',
    'CourseTeachingAssignment',
    'Availability',
    'ClassSession',
    'Booking',
    'Attendance',
    'ClassCommunicationIntent',
  ] as const;
  for (const table of CLASSES_TABLES) {
    await assertObjectVisible(app, table);
    await expectDenied(
      app,
      `${table} ALTER denied`,
      `ALTER TABLE [dbo].[${table}] ADD [probe] INT NULL;`,
    );
  }
  for (const [trigger, table] of [
    ['LearningLiveActivationImmutable', 'LiveLearningActivation'],
    ['LearningScopeIntegrity', 'CourseTeachingAssignment'],
    ['LearningAvailabilityIntegrity', 'Availability'],
    ['LearningSessionIntegrity', 'ClassSession'],
    ['LearningBookingIntegrity', 'Booking'],
    ['LearningAttendanceIntegrity', 'Attendance'],
    ['LearningIntentIntegrity', 'ClassCommunicationIntent'],
  ] as const)
    await expectDenied(
      app,
      `${trigger} DISABLE denied`,
      `DISABLE TRIGGER [dbo].[${trigger}] ON [dbo].[${table}];`,
    );

  // THE EXACT EFFECTIVE POSTURE, table by table and column by column, for the
  // seven Phase-23 tables AND for every owner table a live-class key names,
  // which Phase 23 must leave as it found them.
  const CLASSES_POSTURE: Readonly<
    Record<string, readonly [string, string | readonly string[] | null]>
  > = {
    LiveLearningActivation: ['SELECT', ''],
    CourseTeachingAssignment: [
      'INSERT,SELECT',
      ['id', 'courseId', 'userId', 'roleAssignmentId', 'grantedAt', 'grantedById'],
    ],
    Availability: [
      LEARNER_DATA,
      [
        'id',
        'userId',
        'startsAt',
        'endsAt',
        'timeZone',
        'startsLocal',
        'endsLocal',
        'createdAt',
      ],
    ],
    ClassSession: ['INSERT,SELECT', ['id', 'courseId', 'kind', 'createdAt']],
    Booking: [
      LEARNER_DATA,
      [
        'id',
        'requestId',
        'userId',
        'courseId',
        'sessionId',
        'availabilityId',
        'confirmedAt',
        'confirmedById',
      ],
    ],
    Attendance: [LEARNER_DATA, ['sessionId', 'userId']],
    ClassCommunicationIntent: [
      LEARNER_DATA,
      ['id', 'purpose', 'sessionId', 'userId', 'dueAt', 'idempotencyKey', 'createdAt'],
    ],
    Course: ['INSERT,SELECT', ['id']],
    TrialClassRequest: [LEARNER_DATA, ''],
    User: ['INSERT,SELECT', null],
    RoleAssignment: ['INSERT,SELECT', null],
    Permission: ['SELECT', ''],
    RolePermission: [LEARNER_DATA, ''],
  };
  const classesPosture = await app.query<{
    name: string;
    held: string | null;
    updatable: string | null;
    columns: string | null;
  }>(`
    SELECT t.[name],
      (SELECT STRING_AGG(p.[permission], N',') WITHIN GROUP (ORDER BY p.[permission])
         FROM (VALUES (N'ALTER'),(N'CONTROL'),(N'DELETE'),(N'INSERT'),(N'REFERENCES'),
                      (N'SELECT'),(N'TAKE OWNERSHIP')) AS p([permission])
        WHERE HAS_PERMS_BY_NAME(N'dbo.' + t.[name], N'OBJECT', p.[permission]) = 1) AS [held],
      (SELECT STRING_AGG(c.[name], N',') WITHIN GROUP (ORDER BY c.[column_id])
         FROM sys.columns c WHERE c.[object_id] = OBJECT_ID(N'dbo.' + t.[name])
          AND HAS_PERMS_BY_NAME(N'dbo.' + t.[name], N'OBJECT', N'UPDATE', c.[name], N'COLUMN') = 1) AS [updatable],
      (SELECT STRING_AGG(c.[name], N',') WITHIN GROUP (ORDER BY c.[column_id])
         FROM sys.columns c WHERE c.[object_id] = OBJECT_ID(N'dbo.' + t.[name])) AS [columns]
    FROM (VALUES ${Object.keys(CLASSES_POSTURE)
      .map((table) => `(N'${table}')`)
      .join(',')}) AS t([name]);
  `);
  const classesPostureFindings = classesPosture.flatMap((row) => {
    const [verbs, scope] = CLASSES_POSTURE[row.name] ?? ['?', '?'];
    const expectedColumns =
      scope === null
        ? (row.updatable ?? '')
        : typeof scope === 'string'
          ? scope
          : (row.columns ?? '')
              .split(',')
              .filter((column) => !scope.includes(column))
              .join(',');
    return (row.held ?? '') === verbs && (row.updatable ?? '') === expectedColumns
      ? []
      : [`${row.name}: ${row.held ?? '(none)'} / UPDATE ${row.updatable ?? '(none)'}`];
  });
  if (
    classesPosture.length === Object.keys(CLASSES_POSTURE).length &&
    Object.keys(CLASSES_POSTURE).length === CLASSES_TABLES.length + 6 &&
    classesPostureFindings.length === 0
  ) {
    pass(
      'Live-class effective posture exact',
      `${String(classesPosture.length)} tables, object verbs and UPDATE columns as granted`,
    );
  } else {
    fail(
      'Live-class effective posture exact',
      classesPostureFindings.join('; ') || 'tables missing',
    );
  }

  // ---- Phase 24: messaging, in five postures ---------------------------------
  //
  // THE ACTIVATION is the owner's: SELECT and nothing else. No runtime
  // permission can switch a kind of messaging on or re-label a fixture as
  // approved.
  //
  // A CONVERSATION, a PARTICIPANT, a MESSAGE, an ATTACHMENT and a READ POSITION
  // are written, moved through their lifecycles and removed by their owner's
  // disposition, so they hold all four verbs; what identifies each — and a
  // message's body, order, sender, operation, digest and instant — carries a
  // column DENY.
  //
  // A BLOCK is made and lifted, never edited. A REPORT is evidence: filed and
  // resolved, never deleted and never re-targeted. A MODERATION DECISION is
  // permanent: SELECT and INSERT alone.
  //
  // Naming an account, a Course or a Storage asset grants nothing on its
  // owner's table, and no Identity table's posture moves: the runtime still
  // cannot catalogue a Messaging key or rewrite its description.
  //
  // Every statement below is REAL SQL as the runtime principal over synthetic
  // NON_MESSAGING_FIXTURE rows; the activations and the staff account are the
  // owner's rows, written with administrative authority.
  const messagingAt = '2026-10-08T00:00:00';
  const messagingLater = '2026-10-08T01:00:00';
  const messagingDigest = (label: string): string =>
    createHash('sha256')
      .update(`NON_MESSAGING_FIXTURE ${label} ${learningRun}`)
      .digest('hex');
  const messagingStaff = randomUUID();
  const messagingModerator = randomUUID();
  await admin.query(`
    INSERT INTO [dbo].[MessagingActivation] ([capability],[authority],[authorisedBy],[reference]) VALUES
      (N'support',N'fixture',N'NON_MESSAGING_FIXTURE operator',NULL),
      (N'teacher-student',N'fixture',N'NON_MESSAGING_FIXTURE operator',NULL),
      (N'student-student',N'fixture',N'NON_MESSAGING_FIXTURE operator',NULL);
    ${[messagingStaff, messagingModerator]
      .map(
        (id) =>
          `INSERT INTO [dbo].[User] ([id],[name],[email],[emailVerified],[createdAt],[updatedAt],[locale],[status],[twoFactorEnabled])
             VALUES (N'${id}',N'NON_MESSAGING_FIXTURE account',N'${id}@messaging-proof.invalid',0,SYSUTCDATETIME(),SYSUTCDATETIME(),N'en',N'active',0);`,
      )
      .join('\n')}
  `);
  const [taughtLow, taughtHigh] =
    classTeacher < learner ? [classTeacher, learner] : [learner, classTeacher];
  const taughtConversation = randomUUID();
  const supportConversation = randomUUID();
  const taughtMessage = randomUUID();
  const learnerMessage = randomUUID();
  const supportMessage = randomUUID();
  const messagingAsset = randomUUID();
  const sentAttachment = randomUUID();
  const unsentAttachment = randomUUID();
  const sentToken = messagingDigest('sent-token');
  const messagingReport = randomUUID();
  const messagingDecision = randomUUID();
  const messagingSend = (
    id: string,
    conversationId: string,
    sender: string,
    label: string,
  ): string =>
    `UPDATE [dbo].[Conversation] SET [lastSequence]=[lastSequence]+1,[activityAt]=SYSUTCDATETIME(),[version]=[version]+1 WHERE [id]=N'${conversationId}';
     INSERT INTO [dbo].[Message] ([id],[conversationId],[sequence],[senderUserId],[operationId],[body],[payloadDigest])
       SELECT N'${id}',N'${conversationId}',c.[lastSequence],N'${sender}',N'${randomUUID()}',N'NON_MESSAGING_FIXTURE ${label}',N'${messagingDigest(label)}'
       FROM [dbo].[Conversation] c WHERE c.[id]=N'${conversationId}';`;

  for (const [label, statement, detail] of [
    [
      'Conversation and participant INSERT',
      `INSERT INTO [dbo].[Conversation] ([id],[kind],[courseId],[lowUserId],[highUserId],[requesterUserId]) VALUES
         (N'${taughtConversation}',N'teacher-student',N'${liveCourse}',N'${taughtLow}',N'${taughtHigh}',NULL),
         (N'${supportConversation}',N'support',NULL,NULL,NULL,N'${learningOther}');
       INSERT INTO [dbo].[ConversationParticipant] ([id],[conversationId],[userId],[role]) VALUES
         (N'${randomUUID()}',N'${taughtConversation}',N'${classTeacher}',N'teacher'),
         (N'${randomUUID()}',N'${taughtConversation}',N'${learner}',N'learner'),
         (N'${randomUUID()}',N'${supportConversation}',N'${learningOther}',N'requester'),
         (N'${randomUUID()}',N'${supportConversation}',N'${messagingStaff}',N'support');`,
      'a teacher-student conversation on a Course and a support conversation, with their people',
    ],
    [
      'Message send (sequence allocation and INSERT)',
      `${messagingSend(taughtMessage, taughtConversation, classTeacher, 'teacher message')}
       ${messagingSend(learnerMessage, taughtConversation, learner, 'learner message')}
       ${messagingSend(supportMessage, supportConversation, messagingStaff, 'staff message')}`,
      'three messages, each at the place its conversation just allocated',
    ],
    [
      'Asset and attachment lifecycle',
      `INSERT INTO [dbo].[MessageAttachment] ([id],[conversationId],[uploaderUserId],[releaseToken],[state]) VALUES
         (N'${sentAttachment}',N'${taughtConversation}',N'${classTeacher}',N'${sentToken}',N'pending'),
         (N'${unsentAttachment}',N'${taughtConversation}',N'${learner}',N'${messagingDigest('unsent-token')}',N'pending');
       INSERT INTO [dbo].[Asset] ([id],[storageKey],[state],[updatedAt],[releaseDigest]) VALUES
         (N'${messagingAsset}',N'proof/messaging/${learningRun}',N'uploading',SYSUTCDATETIME(),N'${createHash('sha256').update(sentToken).digest('hex')}');
       UPDATE [dbo].[MessageAttachment] SET [state]=N'ready',[assetId]=N'${messagingAsset}',[mediaType]=N'application/pdf',[byteSize]=2048,[displayName]=N'NON_MESSAGING_FIXTURE file' WHERE [id]=N'${sentAttachment}';
       UPDATE [dbo].[MessageAttachment] SET [state]=N'attached',[messageId]=N'${taughtMessage}',[position]=0,[attachedAt]='${messagingAt}' WHERE [id]=N'${sentAttachment}';`,
      "an upload recorded pending, its asset stored with the token's digest, made ready and attached",
    ],
    [
      'Unsent attachment released and DELETE',
      `UPDATE [dbo].[MessageAttachment] SET [state]=N'releasing' WHERE [id]=N'${unsentAttachment}';
       DELETE FROM [dbo].[MessageAttachment] WHERE [id]=N'${unsentAttachment}';`,
      'an unsent upload released and removed',
    ],
    [
      'Read position INSERT and UPDATE',
      `INSERT INTO [dbo].[MessageReadState] ([conversationId],[userId],[lastReadSequence]) VALUES (N'${taughtConversation}',N'${learner}',1);
       UPDATE [dbo].[MessageReadState] SET [lastReadSequence]=2,[updatedAt]=SYSUTCDATETIME() WHERE [conversationId]=N'${taughtConversation}' AND [userId]=N'${learner}';`,
      'a read position recorded and moved forward',
    ],
    [
      'Block INSERT and DELETE',
      `INSERT INTO [dbo].[MessagingBlock] ([blockerUserId],[blockedUserId]) VALUES (N'${learner}',N'${classTeacher}');
       DELETE FROM [dbo].[MessagingBlock] WHERE [blockerUserId]=N'${learner}' AND [blockedUserId]=N'${classTeacher}';`,
      'a block made and lifted',
    ],
    [
      'Support claim released and taken again',
      `UPDATE [dbo].[ConversationParticipant] SET [leftAt]=SYSUTCDATETIME() WHERE [conversationId]=N'${supportConversation}' AND [userId]=N'${messagingStaff}';
       UPDATE [dbo].[ConversationParticipant] SET [leftAt]=NULL WHERE [conversationId]=N'${supportConversation}' AND [userId]=N'${messagingStaff}';`,
      'a support claim returns',
    ],
    [
      'Report, moderation decision and withholding',
      `INSERT INTO [dbo].[MessagingReport] ([id],[conversationId],[messageId],[reporterUserId],[reason],[atSequence]) VALUES
         (N'${messagingReport}',N'${supportConversation}',N'${supportMessage}',N'${learningOther}',N'harassment',1);
       INSERT INTO [dbo].[MessagingModerationDecision] ([id],[reportId],[moderatorUserId],[action]) VALUES
         (N'${messagingDecision}',N'${messagingReport}',N'${messagingModerator}',N'withhold-message');
       UPDATE [dbo].[Message] SET [moderation]=N'withheld',[withheldAt]='${messagingAt}' WHERE [id]=N'${supportMessage}';
       UPDATE [dbo].[MessagingReport] SET [state]=N'resolved',[resolvedAt]='${messagingAt}',[version]=2 WHERE [id]=N'${messagingReport}';`,
      'a message reported, withheld by a decision and its report resolved',
    ],
  ] as const)
    await expectAllowed(app, label, statement, detail);

  // The schema's own rules hold for the runtime as for the owner.
  await expectRefusedByInvariant(
    app,
    'Message at a place that was not allocated',
    `INSERT INTO [dbo].[Message] ([id],[conversationId],[sequence],[senderUserId],[operationId],[body],[payloadDigest]) VALUES (N'${randomUUID()}',N'${taughtConversation}',9,N'${learner}',N'${randomUUID()}',N'NON_MESSAGING_FIXTURE gap',N'${messagingDigest('gap')}');`,
    51303,
  );
  await expectRefusedByInvariant(
    app,
    'Withheld message returned to view',
    `UPDATE [dbo].[Message] SET [moderation]=N'visible',[withheldAt]=NULL WHERE [id]=N'${supportMessage}';`,
    51304,
  );
  await expectRefusedByInvariant(
    app,
    'Message DELETE outside disposal',
    `DELETE FROM [dbo].[Message] WHERE [id]=N'${learnerMessage}';`,
    51305,
  );
  await expectRefusedByInvariant(
    app,
    'Read position moved backwards',
    `UPDATE [dbo].[MessageReadState] SET [lastReadSequence]=1 WHERE [conversationId]=N'${taughtConversation}' AND [userId]=N'${learner}';`,
    51307,
  );
  await expectRefusedByInvariant(
    app,
    'Report filed already resolved',
    `INSERT INTO [dbo].[MessagingReport] ([id],[conversationId],[messageId],[reporterUserId],[reason],[atSequence],[state],[resolvedAt]) VALUES (N'${randomUUID()}',N'${supportConversation}',NULL,N'${learningOther}',N'spam',1,N'resolved','${messagingAt}');`,
    51308,
  );
  await expectRefusedByConstraint(
    app,
    'Second open support conversation for one person',
    `INSERT INTO [dbo].[Conversation] ([id],[kind],[requesterUserId]) VALUES (N'${randomUUID()}',N'support',N'${learningOther}');`,
    DUPLICATE_KEY,
    'Conversation_support_key',
  );
  await expectRefusedByConstraint(
    app,
    'Asset DELETE under its attachment',
    `DELETE FROM [dbo].[Asset] WHERE [id]=N'${messagingAsset}';`,
    CONSTRAINT_VIOLATION,
    'MessageAttachment_assetId_fkey',
  );

  // The activation is never the runtime's; nothing identifying is ever
  // rewritten; a report is never deleted and a decision never changes; and the
  // Messaging keys stay the owner's to catalogue.
  for (const [label, statement] of [
    [
      'MessagingActivation INSERT denied',
      "INSERT INTO [dbo].[MessagingActivation] ([capability],[authority],[authorisedBy],[reference]) VALUES (N'group',N'approved',N'forged',N'urn:example:forged');",
    ],
    [
      'MessagingActivation UPDATE denied',
      "UPDATE [dbo].[MessagingActivation] SET [authority]=N'approved';",
    ],
    ['MessagingActivation DELETE denied', 'DELETE FROM [dbo].[MessagingActivation];'],
    ['Conversation id UPDATE denied', 'UPDATE [dbo].[Conversation] SET [id]=[id];'],
    ['Conversation kind UPDATE denied', 'UPDATE [dbo].[Conversation] SET [kind]=[kind];'],
    [
      'Conversation Course UPDATE denied',
      'UPDATE [dbo].[Conversation] SET [courseId]=[courseId];',
    ],
    [
      'Conversation lower account UPDATE denied',
      'UPDATE [dbo].[Conversation] SET [lowUserId]=[lowUserId];',
    ],
    [
      'Conversation higher account UPDATE denied',
      'UPDATE [dbo].[Conversation] SET [highUserId]=[highUserId];',
    ],
    [
      'Conversation requester UPDATE denied',
      'UPDATE [dbo].[Conversation] SET [requesterUserId]=[requesterUserId];',
    ],
    [
      'Conversation creation UPDATE denied',
      'UPDATE [dbo].[Conversation] SET [createdAt]=[createdAt];',
    ],
    [
      'Participant conversation UPDATE denied',
      'UPDATE [dbo].[ConversationParticipant] SET [conversationId]=[conversationId];',
    ],
    [
      'Participant account UPDATE denied',
      'UPDATE [dbo].[ConversationParticipant] SET [userId]=[userId];',
    ],
    [
      'Participant role UPDATE denied',
      'UPDATE [dbo].[ConversationParticipant] SET [role]=[role];',
    ],
    ['Message body UPDATE denied', 'UPDATE [dbo].[Message] SET [body]=[body];'],
    [
      'Message sender UPDATE denied',
      'UPDATE [dbo].[Message] SET [senderUserId]=[senderUserId];',
    ],
    ['Message order UPDATE denied', 'UPDATE [dbo].[Message] SET [sequence]=[sequence];'],
    [
      'Message operation UPDATE denied',
      'UPDATE [dbo].[Message] SET [operationId]=[operationId];',
    ],
    [
      'Message digest UPDATE denied',
      'UPDATE [dbo].[Message] SET [payloadDigest]=[payloadDigest];',
    ],
    ['Message instant UPDATE denied', 'UPDATE [dbo].[Message] SET [sentAt]=[sentAt];'],
    [
      'Message conversation UPDATE denied',
      'UPDATE [dbo].[Message] SET [conversationId]=[conversationId];',
    ],
    [
      'Attachment token UPDATE denied',
      'UPDATE [dbo].[MessageAttachment] SET [releaseToken]=[releaseToken];',
    ],
    [
      'Attachment uploader UPDATE denied',
      'UPDATE [dbo].[MessageAttachment] SET [uploaderUserId]=[uploaderUserId];',
    ],
    [
      'Attachment conversation UPDATE denied',
      'UPDATE [dbo].[MessageAttachment] SET [conversationId]=[conversationId];',
    ],
    [
      'Read position key UPDATE denied',
      'UPDATE [dbo].[MessageReadState] SET [userId]=[userId];',
    ],
    [
      'MessagingBlock UPDATE denied',
      'UPDATE [dbo].[MessagingBlock] SET [createdAt]=[createdAt];',
    ],
    ['MessagingReport DELETE denied', 'DELETE FROM [dbo].[MessagingReport];'],
    [
      'MessagingReport reason UPDATE denied',
      'UPDATE [dbo].[MessagingReport] SET [reason]=[reason];',
    ],
    [
      'MessagingReport target UPDATE denied',
      'UPDATE [dbo].[MessagingReport] SET [messageId]=[messageId];',
    ],
    [
      'MessagingReport reporter UPDATE denied',
      'UPDATE [dbo].[MessagingReport] SET [reporterUserId]=[reporterUserId];',
    ],
    [
      'MessagingReport position UPDATE denied',
      'UPDATE [dbo].[MessagingReport] SET [atSequence]=[atSequence];',
    ],
    [
      'MessagingModerationDecision UPDATE denied',
      'UPDATE [dbo].[MessagingModerationDecision] SET [action]=[action];',
    ],
    [
      'MessagingModerationDecision DELETE denied',
      'DELETE FROM [dbo].[MessagingModerationDecision];',
    ],
    [
      'messaging.support Permission INSERT denied',
      "INSERT INTO [dbo].[Permission] ([key],[description]) VALUES (N'messaging.support',N'forged');",
    ],
    [
      'messaging.moderate description UPDATE denied',
      "UPDATE [dbo].[Permission] SET [description]=N'forged' WHERE [key]=N'messaging.moderate';",
    ],
    [
      'Messaging Permission DELETE denied',
      "DELETE FROM [dbo].[Permission] WHERE [key]=N'messaging.support';",
    ],
    [
      'Asset release digest UPDATE denied',
      'UPDATE [dbo].[Asset] SET [releaseDigest]=[releaseDigest];',
    ],
    [
      'Staff account DELETE denied',
      `DELETE FROM [dbo].[User] WHERE [id]=N'${messagingStaff}';`,
    ],
  ] as const)
    await expectDenied(app, label, statement);

  // Closure disposition: the conversation no report names is closed, marked and
  // removed, children first; the reported support conversation, its report and
  // its decision stay as evidence.
  await expectAllowed(
    app,
    'Conversation closed, marked and disposed of, children first',
    `UPDATE [dbo].[Conversation] SET [state]=N'closed',[closedReason]=N'account-closed',[closedAt]='${messagingLater}',[disposingAt]='${messagingLater}',[version]=[version]+1 WHERE [id]=N'${taughtConversation}';
     UPDATE [dbo].[MessageAttachment] SET [state]=N'releasing',[assetId]=NULL,[messageId]=NULL,[position]=NULL WHERE [conversationId]=N'${taughtConversation}';
     DELETE FROM [dbo].[MessageAttachment] WHERE [conversationId]=N'${taughtConversation}';
     DELETE FROM [dbo].[Asset] WHERE [id]=N'${messagingAsset}';
     DELETE FROM [dbo].[MessageReadState] WHERE [conversationId]=N'${taughtConversation}';
     DELETE FROM [dbo].[Message] WHERE [conversationId]=N'${taughtConversation}';
     DELETE FROM [dbo].[ConversationParticipant] WHERE [conversationId]=N'${taughtConversation}';
     DELETE FROM [dbo].[Conversation] WHERE [id]=N'${taughtConversation}';`,
    'the attachment released with its asset, then read positions, messages, participants and the conversation',
  );

  const [messagingState] = await admin.query<Record<string, number | string | null>>(`
    SELECT
      (SELECT STRING_AGG([capability] + N':' + [authority], N',') WITHIN GROUP (ORDER BY [capability])
         FROM [dbo].[MessagingActivation]) AS [activations],
      (SELECT COUNT(*) FROM [dbo].[Conversation]) AS [conversations],
      (SELECT [state] FROM [dbo].[Conversation] WHERE [id]=N'${supportConversation}') AS [support],
      (SELECT COUNT(*) FROM [dbo].[ConversationParticipant] WHERE [leftAt] IS NULL) AS [participants],
      (SELECT STRING_AGG([moderation], N',') FROM [dbo].[Message]) AS [messages],
      (SELECT COUNT(*) FROM [dbo].[MessageAttachment]) + (SELECT COUNT(*) FROM [dbo].[MessageReadState])
        + (SELECT COUNT(*) FROM [dbo].[MessagingBlock]) AS [ownerRows],
      (SELECT [state] FROM [dbo].[MessagingReport] WHERE [id]=N'${messagingReport}') AS [report],
      (SELECT [action] FROM [dbo].[MessagingModerationDecision] WHERE [id]=N'${messagingDecision}') AS [decision],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] WHERE [permissionKey] IN (N'messaging.support',N'messaging.moderate')) AS [held];
  `);
  const expectedMessagingState = {
    activations: 'student-student:fixture,support:fixture,teacher-student:fixture',
    conversations: 1,
    support: 'open',
    participants: 2,
    messages: 'withheld',
    ownerRows: 0,
    report: 'resolved',
    decision: 'withhold-message',
    held: 0,
  };
  if (JSON.stringify(messagingState) === JSON.stringify(expectedMessagingState)) {
    pass(
      'Messaging state as written',
      'activations untouched, one conversation disposed, the reported one kept with its decision',
    );
  } else {
    fail('Messaging state as written', JSON.stringify(messagingState));
  }

  const MESSAGING_TABLES = [
    'MessagingActivation',
    'Conversation',
    'ConversationParticipant',
    'Message',
    'MessageAttachment',
    'MessageReadState',
    'MessagingBlock',
    'MessagingReport',
    'MessagingModerationDecision',
  ] as const;
  for (const table of MESSAGING_TABLES) {
    await assertObjectVisible(app, table);
    await expectDenied(
      app,
      `${table} ALTER denied`,
      `ALTER TABLE [dbo].[${table}] ADD [probe] INT NULL;`,
    );
  }
  for (const [trigger, table] of [
    ['MessagingActivationImmutable', 'MessagingActivation'],
    ['MessagingConversationIntegrity', 'Conversation'],
    ['MessagingParticipantIntegrity', 'ConversationParticipant'],
    ['MessagingMessageIntegrity', 'Message'],
    ['MessagingAttachmentIntegrity', 'MessageAttachment'],
    ['MessagingReadStateIntegrity', 'MessageReadState'],
    ['MessagingReportIntegrity', 'MessagingReport'],
    ['MessagingDecisionIntegrity', 'MessagingModerationDecision'],
  ] as const)
    await expectDenied(
      app,
      `${trigger} DISABLE denied`,
      `DISABLE TRIGGER [dbo].[${trigger}] ON [dbo].[${table}];`,
    );

  // THE EXACT EFFECTIVE POSTURE, table by table and column by column, for the
  // nine Phase-24 tables AND for every owner table a Messaging key names, which
  // Phase 24 must leave as it found them (Storage's Asset gains the release
  // digest, which the runtime may write once and never UPDATE, and every other
  // Asset column keeps its posture).
  const MESSAGING_POSTURE: Readonly<
    Record<string, readonly [string, string | readonly string[] | null]>
  > = {
    MessagingActivation: ['SELECT', ''],
    Conversation: [
      LEARNER_DATA,
      [
        'id',
        'kind',
        'courseId',
        'lowUserId',
        'highUserId',
        'requesterUserId',
        'createdAt',
      ],
    ],
    ConversationParticipant: [LEARNER_DATA, ['id', 'conversationId', 'userId', 'role']],
    Message: [
      LEARNER_DATA,
      [
        'id',
        'conversationId',
        'sequence',
        'senderUserId',
        'operationId',
        'body',
        'payloadDigest',
        'sentAt',
      ],
    ],
    MessageAttachment: [
      LEARNER_DATA,
      ['id', 'conversationId', 'uploaderUserId', 'releaseToken', 'createdAt'],
    ],
    MessageReadState: [LEARNER_DATA, ['conversationId', 'userId']],
    MessagingBlock: [LEARNER_DATA, ''],
    MessagingReport: [
      'INSERT,SELECT',
      [
        'id',
        'conversationId',
        'messageId',
        'reporterUserId',
        'reason',
        'atSequence',
        'createdAt',
      ],
    ],
    MessagingModerationDecision: ['INSERT,SELECT', ''],
    Course: ['INSERT,SELECT', ['id']],
    Asset: [LEARNER_DATA, ['releaseDigest']],
    User: ['INSERT,SELECT', null],
    Permission: ['SELECT', ''],
  };
  const messagingPosture = await app.query<{
    name: string;
    held: string | null;
    updatable: string | null;
    columns: string | null;
  }>(`
    SELECT t.[name],
      (SELECT STRING_AGG(p.[permission], N',') WITHIN GROUP (ORDER BY p.[permission])
         FROM (VALUES (N'ALTER'),(N'CONTROL'),(N'DELETE'),(N'INSERT'),(N'REFERENCES'),
                      (N'SELECT'),(N'TAKE OWNERSHIP')) AS p([permission])
        WHERE HAS_PERMS_BY_NAME(N'dbo.' + t.[name], N'OBJECT', p.[permission]) = 1) AS [held],
      (SELECT STRING_AGG(c.[name], N',') WITHIN GROUP (ORDER BY c.[column_id])
         FROM sys.columns c WHERE c.[object_id] = OBJECT_ID(N'dbo.' + t.[name])
          AND HAS_PERMS_BY_NAME(N'dbo.' + t.[name], N'OBJECT', N'UPDATE', c.[name], N'COLUMN') = 1) AS [updatable],
      (SELECT STRING_AGG(c.[name], N',') WITHIN GROUP (ORDER BY c.[column_id])
         FROM sys.columns c WHERE c.[object_id] = OBJECT_ID(N'dbo.' + t.[name])) AS [columns]
    FROM (VALUES ${Object.keys(MESSAGING_POSTURE)
      .map((table) => `(N'${table}')`)
      .join(',')}) AS t([name]);
  `);
  const messagingPostureFindings = messagingPosture.flatMap((row) => {
    const [verbs, scope] = MESSAGING_POSTURE[row.name] ?? ['?', '?'];
    const expectedColumns =
      scope === null
        ? (row.updatable ?? '')
        : typeof scope === 'string'
          ? scope
          : (row.columns ?? '')
              .split(',')
              .filter((column) => !scope.includes(column))
              .join(',');
    return (row.held ?? '') === verbs && (row.updatable ?? '') === expectedColumns
      ? []
      : [`${row.name}: ${row.held ?? '(none)'} / UPDATE ${row.updatable ?? '(none)'}`];
  });
  if (
    messagingPosture.length === Object.keys(MESSAGING_POSTURE).length &&
    Object.keys(MESSAGING_POSTURE).length === MESSAGING_TABLES.length + 4 &&
    messagingPostureFindings.length === 0
  ) {
    pass(
      'Messaging effective posture exact',
      `${String(messagingPosture.length)} tables, object verbs and UPDATE columns as granted`,
    );
  } else {
    fail(
      'Messaging effective posture exact',
      messagingPostureFindings.join('; ') || 'tables missing',
    );
  }

  // ---- Phase 26: Membership, in three postures ---------------------------------
  //
  // A TYPE, its WORDS, an APPLICATION and a MEMBERSHIP are history: INSERT and
  // UPDATE of what moves (a type's state, position, instants and version; a
  // translation's words; an application's status, instants and version; a
  // Membership's closure and version) and never DELETE; what identifies each —
  // a type's id, primary locale and creation instant; a translation's type and
  // locale; an application's applicant, type and submission instant; a
  // Membership's member, type, source application and activation instant — is
  // never UPDATEd.
  //
  // An INTENT is the owed mail and is removed by a closed account's
  // disposition, so it holds all four verbs; what it names, its due instant
  // and its key carry a column DENY.
  //
  // Naming an account grants nothing on Identity's table, and no Identity
  // table's posture moves: the runtime still cannot catalogue a Membership key
  // or rewrite its description.
  //
  // Every statement below is REAL SQL as the runtime principal over synthetic
  // NON_MEMBERSHIP_FIXTURE rows; the two accounts are Identity's rows, written
  // with administrative authority.
  const membershipRun = randomUUID().replaceAll('-', '').slice(0, 16);
  const membershipAt = '2026-10-09T00:00:00';
  const membershipLater = '2026-10-09T01:00:00';
  const membershipDecided = '2026-10-09T02:00:00';
  const membershipClosed = '2026-10-09T03:00:00';
  const membershipApplicant = randomUUID();
  const membershipOther = randomUUID();
  await admin.query(`
    ${[membershipApplicant, membershipOther]
      .map(
        (id) =>
          `INSERT INTO [dbo].[User] ([id],[name],[email],[emailVerified],[createdAt],[updatedAt],[locale],[status],[twoFactorEnabled])
             VALUES (N'${id}',N'NON_MEMBERSHIP_FIXTURE account',N'${id}@membership-proof.invalid',0,SYSUTCDATETIME(),SYSUTCDATETIME(),N'en',N'active',0);`,
      )
      .join('\n')}
  `);
  const typeOpen = randomUUID();
  const typeUrdu = randomUUID();
  const typeDraft = randomUUID();
  const appApproved = randomUUID();
  const appSecond = randomUUID();
  const appWithdrawn = randomUUID();
  const appOpen = randomUUID();
  const appRejected = randomUUID();
  const membershipFirst = randomUUID();
  const intentApproved = randomUUID();
  const intentClosed = randomUUID();
  const membershipType = (id: string, locale: string, order: number): string =>
    `INSERT INTO [dbo].[MembershipType] ([id],[primaryLocale],[displayOrder]) VALUES (N'${id}',N'${locale}',${String(order)});`;
  const membershipWords = (typeId: string, locale: string): string =>
    `INSERT INTO [dbo].[MembershipTypeTranslation] ([membershipTypeId],[locale],[title],[summary],[description],[guidance]) VALUES (N'${typeId}',N'${locale}',N'NON_MEMBERSHIP_FIXTURE title',N'NON_MEMBERSHIP_FIXTURE summary',N'NON_MEMBERSHIP_FIXTURE description',N'NON_MEMBERSHIP_FIXTURE guidance');`;
  const membershipPublish = (id: string): string =>
    `UPDATE [dbo].[MembershipType] SET [state]=N'published',[publishedAt]='${membershipAt}',[version]=[version]+1,[updatedAt]='${membershipAt}' WHERE [id]=N'${id}';`;
  const membershipApply = (id: string, user: string, typeId: string): string =>
    `INSERT INTO [dbo].[MembershipApplication] ([id],[applicantUserId],[membershipTypeId],[submittedAt]) VALUES (N'${id}',N'${user}',N'${typeId}','${membershipAt}');`;
  const membershipReview = (id: string): string =>
    `UPDATE [dbo].[MembershipApplication] SET [status]=N'under_review',[reviewStartedAt]='${membershipLater}',[version]=[version]+1,[updatedAt]='${membershipLater}' WHERE [id]=N'${id}';`;
  const membershipDecide = (id: string, outcome: 'approved' | 'rejected'): string =>
    `UPDATE [dbo].[MembershipApplication] SET [status]=N'${outcome}',[decidedAt]='${membershipDecided}',[version]=[version]+1,[updatedAt]='${membershipDecided}' WHERE [id]=N'${id}';`;
  const membershipRow = (
    id: string,
    user: string,
    typeId: string,
    applicationId: string,
  ): string =>
    `INSERT INTO [dbo].[Membership] ([id],[memberUserId],[membershipTypeId],[sourceApplicationId],[activatedAt]) VALUES (N'${id}',N'${user}',N'${typeId}',N'${applicationId}','${membershipDecided}');`;
  const membershipIntent = (
    id: string,
    purpose: string,
    recipient: string,
    record: { readonly application?: string; readonly membership?: string },
    key: string,
  ): string =>
    `INSERT INTO [dbo].[MembershipCommunicationIntent] ([id],[purpose],[recipientUserId],[applicationId],[membershipId],[dueAt],[idempotencyKey]) VALUES (N'${id}',N'${purpose}',N'${recipient}',${record.application === undefined ? 'NULL' : `N'${record.application}'`},${record.membership === undefined ? 'NULL' : `N'${record.membership}'`},'${membershipAt}',N'mp-${membershipRun}-${key}');`;

  for (const [label, statement, detail] of [
    [
      'MembershipType and words INSERT',
      `${membershipType(typeOpen, 'en', 0)}
       ${membershipType(typeUrdu, 'ur', 1)}
       ${membershipType(typeDraft, 'ar', 2)}
       ${membershipWords(typeOpen, 'en')}
       ${membershipWords(typeOpen, 'ur')}
       ${membershipWords(typeUrdu, 'ur')}
       ${membershipWords(typeDraft, 'en')}`,
      'three draft types and their words, one Urdu-primary',
    ],
    [
      'MembershipType publish, reorder and words UPDATE',
      `${membershipPublish(typeOpen)}
       ${membershipPublish(typeUrdu)}
       UPDATE [dbo].[MembershipType] SET [displayOrder]=5,[version]=[version]+1,[updatedAt]='${membershipLater}' WHERE [id]=N'${typeOpen}';
       UPDATE [dbo].[MembershipTypeTranslation] SET [title]=N'NON_MEMBERSHIP_FIXTURE retitled',[guidance]=NULL,[updatedAt]='${membershipLater}' WHERE [membershipTypeId]=N'${typeOpen}' AND [locale]=N'en';`,
      'two types published with their primary words, one reordered and retitled',
    ],
    [
      'MembershipApplication submit, review and decide',
      `${membershipApply(appApproved, membershipApplicant, typeOpen)}
       ${membershipReview(appApproved)}
       ${membershipDecide(appApproved, 'approved')}
       ${membershipApply(appSecond, membershipApplicant, typeOpen)}
       ${membershipReview(appSecond)}
       ${membershipDecide(appSecond, 'approved')}
       ${membershipApply(appRejected, membershipOther, typeUrdu)}
       ${membershipReview(appRejected)}
       ${membershipDecide(appRejected, 'rejected')}`,
      'two approvals and a rejection, each reviewed first',
    ],
    [
      'MembershipApplication withdraw and re-apply',
      `${membershipApply(appWithdrawn, membershipOther, typeOpen)}
       UPDATE [dbo].[MembershipApplication] SET [status]=N'withdrawn',[withdrawalSource]=N'applicant',[withdrawnAt]='${membershipLater}',[version]=[version]+1 WHERE [id]=N'${appWithdrawn}';
       ${membershipApply(appOpen, membershipOther, typeOpen)}`,
      'an application withdrawn by its applicant, then a new one open',
    ],
    [
      'Membership INSERT from its approval',
      membershipRow(membershipFirst, membershipApplicant, typeOpen, appApproved),
      "an active Membership naming the applicant's own approved application",
    ],
    [
      'MembershipCommunicationIntent INSERT, claim and relay',
      `${membershipIntent(intentApproved, 'membership.application.approved', membershipApplicant, { application: appApproved }, 'approved')}
       UPDATE [dbo].[MembershipCommunicationIntent] SET [claimedUntil]='${membershipLater}' WHERE [id]=N'${intentApproved}';
       UPDATE [dbo].[MembershipCommunicationIntent] SET [state]=N'relayed',[relayedAt]='${membershipLater}',[claimedUntil]=NULL WHERE [id]=N'${intentApproved}';`,
      'a pending intent owed to the applicant, claimed and relayed',
    ],
    [
      'sys.sp_getapplock EXECUTE (transaction owner)',
      `BEGIN TRAN;
       DECLARE @held INT;
       EXEC @held = sys.sp_getapplock @Resource=N'membership:${membershipApplicant}:${typeOpen}', @LockMode=N'Exclusive', @LockOwner=N'Transaction', @LockTimeout=5000;
       IF @held < 0 BEGIN ROLLBACK TRAN; THROW 50000, N'sp_getapplock refused the runtime principal.', 1; END;
       SELECT [id] FROM [dbo].[MembershipType] WITH (HOLDLOCK) WHERE [id]=N'${typeOpen}';
       SELECT [id] FROM [dbo].[Membership] WITH (UPDLOCK, HOLDLOCK) WHERE [memberUserId]=N'${membershipApplicant}' AND [membershipTypeId]=N'${typeOpen}';
       COMMIT TRAN;`,
      'the account-and-type serialisation lock and its locking reads are reachable',
    ],
  ] as const)
    await expectAllowed(app, label, statement, detail);

  // The schema's own rules hold for the runtime as for the owner.
  await expectRefusedByInvariant(
    app,
    'MembershipType inserted published',
    `INSERT INTO [dbo].[MembershipType] ([id],[state],[primaryLocale],[displayOrder],[publishedAt]) VALUES (N'${randomUUID()}',N'published',N'en',0,'${membershipAt}');`,
    51320,
  );
  await expectRefusedByInvariant(
    app,
    'MembershipType returned to draft',
    `UPDATE [dbo].[MembershipType] SET [state]=N'draft',[publishedAt]=NULL,[version]=[version]+1 WHERE [id]=N'${typeOpen}';`,
    51320,
  );
  await expectRefusedByInvariant(
    app,
    'MembershipType change skipping a version',
    `UPDATE [dbo].[MembershipType] SET [displayOrder]=6,[version]=[version]+2 WHERE [id]=N'${typeOpen}';`,
    51320,
  );
  await expectRefusedByInvariant(
    app,
    'MembershipType published without its primary words',
    membershipPublish(typeDraft),
    51321,
  );
  await expectRefusedByInvariant(
    app,
    'MembershipApplication decided without review',
    `UPDATE [dbo].[MembershipApplication] SET [status]=N'approved',[reviewStartedAt]='${membershipLater}',[decidedAt]='${membershipDecided}',[version]=[version]+1 WHERE [id]=N'${appOpen}';`,
    51322,
  );
  await expectRefusedByInvariant(
    app,
    'MembershipApplication decided twice',
    `UPDATE [dbo].[MembershipApplication] SET [status]=N'rejected',[version]=[version]+1 WHERE [id]=N'${appApproved}';`,
    51322,
  );
  await expectRefusedByInvariant(
    app,
    'MembershipApplication inserted under review',
    `INSERT INTO [dbo].[MembershipApplication] ([id],[applicantUserId],[membershipTypeId],[status],[submittedAt],[reviewStartedAt]) VALUES (N'${randomUUID()}',N'${membershipApplicant}',N'${typeUrdu}',N'under_review','${membershipAt}','${membershipLater}');`,
    51322,
  );
  await expectRefusedByInvariant(
    app,
    'MembershipApplication on a draft type',
    membershipApply(randomUUID(), membershipApplicant, typeDraft),
    51323,
  );
  await expectRefusedByInvariant(
    app,
    'MembershipApplication while an active Membership exists',
    membershipApply(randomUUID(), membershipApplicant, typeOpen),
    51323,
  );
  await expectRefusedByInvariant(
    app,
    'Membership from an open application',
    membershipRow(randomUUID(), membershipOther, typeOpen, appOpen),
    51324,
  );
  await expectRefusedByConstraint(
    app,
    'Second active Membership of one account and type',
    membershipRow(randomUUID(), membershipApplicant, typeOpen, appSecond),
    DUPLICATE_KEY,
    'Membership_active_key',
  );
  await expectAllowed(
    app,
    'Membership closed by its member and its closure intent INSERT',
    `UPDATE [dbo].[Membership] SET [status]=N'closed',[closureSource]=N'member',[closedAt]='${membershipClosed}',[version]=[version]+1,[updatedAt]='${membershipClosed}' WHERE [id]=N'${membershipFirst}';
     ${membershipIntent(intentClosed, 'membership.closed', membershipApplicant, { membership: membershipFirst }, 'closed')}`,
    'the Membership closed, never deleted, and the closure owed to its member',
  );
  await expectRefusedByInvariant(
    app,
    'Closed Membership reopened',
    `UPDATE [dbo].[Membership] SET [status]=N'active',[closureSource]=NULL,[closedAt]=NULL,[version]=[version]+1 WHERE [id]=N'${membershipFirst}';`,
    51324,
  );
  await expectRefusedByInvariant(
    app,
    'Relayed MembershipCommunicationIntent reopened',
    `UPDATE [dbo].[MembershipCommunicationIntent] SET [state]=N'pending',[relayedAt]=NULL WHERE [id]=N'${intentApproved}';`,
    51325,
  );
  await expectRefusedByConstraint(
    app,
    'Second open application of one account and type',
    membershipApply(randomUUID(), membershipOther, typeOpen),
    DUPLICATE_KEY,
    'MembershipApplication_open_key',
  );
  await expectRefusedByConstraint(
    app,
    "Membership naming another account's application",
    membershipRow(randomUUID(), membershipOther, typeOpen, appSecond),
    CONSTRAINT_VIOLATION,
    'Membership_sourceApplication_fkey',
  );
  await expectAllowed(
    app,
    'Second Membership after the first closed',
    membershipRow(randomUUID(), membershipApplicant, typeOpen, appSecond),
    'a re-admission from its own later approval',
  );
  await expectRefusedByConstraint(
    app,
    'MembershipCommunicationIntent owed to another account',
    membershipIntent(
      randomUUID(),
      'membership.application.approved',
      membershipOther,
      { application: appApproved },
      'foreign',
    ),
    CONSTRAINT_VIOLATION,
    'MembershipCommunicationIntent_application_fkey',
  );
  await expectRefusedByConstraint(
    app,
    'MembershipCommunicationIntent naming the wrong record',
    membershipIntent(
      randomUUID(),
      'membership.closed',
      membershipApplicant,
      { application: appApproved },
      'shape',
    ),
    CONSTRAINT_VIOLATION,
    'MembershipCommunicationIntent_ck',
  );
  await expectRefusedByConstraint(
    app,
    'MembershipApplication in a payment status',
    `INSERT INTO [dbo].[MembershipApplication] ([id],[applicantUserId],[membershipTypeId],[status],[submittedAt]) VALUES (N'${randomUUID()}',N'${membershipApplicant}',N'${typeUrdu}',N'paid','${membershipAt}');`,
    CONSTRAINT_VIOLATION,
    'MembershipApplication_ck',
  );
  await expectRefusedByConstraint(
    app,
    'MembershipType beyond the display bound',
    `INSERT INTO [dbo].[MembershipType] ([id],[primaryLocale],[displayOrder]) VALUES (N'${randomUUID()}',N'en',10000);`,
    CONSTRAINT_VIOLATION,
    'MembershipType_ck',
  );

  // A type, its words, an application and a Membership are never deleted;
  // what identifies each is never rewritten; and the runtime can neither
  // catalogue a Membership key nor rewrite how one is described.
  for (const [label, statement] of [
    ['MembershipType DELETE denied', 'DELETE FROM [dbo].[MembershipType];'],
    [
      'MembershipTypeTranslation DELETE denied',
      'DELETE FROM [dbo].[MembershipTypeTranslation];',
    ],
    ['MembershipApplication DELETE denied', 'DELETE FROM [dbo].[MembershipApplication];'],
    ['Membership DELETE denied', 'DELETE FROM [dbo].[Membership];'],
    ['MembershipType id UPDATE denied', 'UPDATE [dbo].[MembershipType] SET [id]=[id];'],
    [
      'MembershipType primary locale UPDATE denied',
      'UPDATE [dbo].[MembershipType] SET [primaryLocale]=[primaryLocale];',
    ],
    [
      'MembershipType creation UPDATE denied',
      'UPDATE [dbo].[MembershipType] SET [createdAt]=[createdAt];',
    ],
    [
      'MembershipTypeTranslation type UPDATE denied',
      'UPDATE [dbo].[MembershipTypeTranslation] SET [membershipTypeId]=[membershipTypeId];',
    ],
    [
      'MembershipTypeTranslation locale UPDATE denied',
      'UPDATE [dbo].[MembershipTypeTranslation] SET [locale]=[locale];',
    ],
    [
      'MembershipApplication id UPDATE denied',
      'UPDATE [dbo].[MembershipApplication] SET [id]=[id];',
    ],
    [
      'MembershipApplication applicant UPDATE denied',
      'UPDATE [dbo].[MembershipApplication] SET [applicantUserId]=[applicantUserId];',
    ],
    [
      'MembershipApplication type UPDATE denied',
      'UPDATE [dbo].[MembershipApplication] SET [membershipTypeId]=[membershipTypeId];',
    ],
    [
      'MembershipApplication submission UPDATE denied',
      'UPDATE [dbo].[MembershipApplication] SET [submittedAt]=[submittedAt];',
    ],
    ['Membership id UPDATE denied', 'UPDATE [dbo].[Membership] SET [id]=[id];'],
    [
      'Membership member UPDATE denied',
      'UPDATE [dbo].[Membership] SET [memberUserId]=[memberUserId];',
    ],
    [
      'Membership type UPDATE denied',
      'UPDATE [dbo].[Membership] SET [membershipTypeId]=[membershipTypeId];',
    ],
    [
      'Membership source application UPDATE denied',
      'UPDATE [dbo].[Membership] SET [sourceApplicationId]=[sourceApplicationId];',
    ],
    [
      'Membership activation UPDATE denied',
      'UPDATE [dbo].[Membership] SET [activatedAt]=[activatedAt];',
    ],
    [
      'MembershipCommunicationIntent purpose UPDATE denied',
      'UPDATE [dbo].[MembershipCommunicationIntent] SET [purpose]=[purpose];',
    ],
    [
      'MembershipCommunicationIntent recipient UPDATE denied',
      'UPDATE [dbo].[MembershipCommunicationIntent] SET [recipientUserId]=[recipientUserId];',
    ],
    [
      'MembershipCommunicationIntent application UPDATE denied',
      'UPDATE [dbo].[MembershipCommunicationIntent] SET [applicationId]=[applicationId];',
    ],
    [
      'MembershipCommunicationIntent Membership UPDATE denied',
      'UPDATE [dbo].[MembershipCommunicationIntent] SET [membershipId]=[membershipId];',
    ],
    [
      'MembershipCommunicationIntent due UPDATE denied',
      'UPDATE [dbo].[MembershipCommunicationIntent] SET [dueAt]=[dueAt];',
    ],
    [
      'MembershipCommunicationIntent key UPDATE denied',
      'UPDATE [dbo].[MembershipCommunicationIntent] SET [idempotencyKey]=[idempotencyKey];',
    ],
    [
      'membership.* Permission INSERT denied',
      "INSERT INTO [dbo].[Permission] ([key],[description]) VALUES (N'membership.finance',N'forged');",
    ],
    [
      'membership.read key UPDATE denied',
      "UPDATE [dbo].[Permission] SET [key]=[key] WHERE [key]=N'membership.read';",
    ],
    [
      'membership.administer description UPDATE denied',
      "UPDATE [dbo].[Permission] SET [description]=N'forged' WHERE [key]=N'membership.administer';",
    ],
    [
      'membership.read Permission DELETE denied',
      "DELETE FROM [dbo].[Permission] WHERE [key]=N'membership.read';",
    ],
    [
      'Member account DELETE denied',
      `DELETE FROM [dbo].[User] WHERE [id]=N'${membershipApplicant}';`,
    ],
  ] as const)
    await expectDenied(app, label, statement);

  // A closed account's disposition: the owed mail is removed; every type,
  // application and Membership stays as history.
  await expectAllowed(
    app,
    'MembershipApplication withdrawn by closure, then intents DELETE (dispose)',
    `UPDATE [dbo].[MembershipApplication] SET [status]=N'withdrawn',[withdrawalSource]=N'account-closure',[withdrawnAt]='${membershipLater}',[version]=[version]+1 WHERE [id]=N'${appOpen}';
     DELETE TOP (100) FROM [dbo].[MembershipCommunicationIntent] WHERE [recipientUserId]=N'${membershipApplicant}';`,
    "the open application withdrawn and the account's owed mail removed",
  );

  const [membershipState] = await admin.query<Record<string, number | string | null>>(`
    SELECT
      (SELECT STRING_AGG([state], N',') WITHIN GROUP (ORDER BY [displayOrder])
         FROM [dbo].[MembershipType] WHERE [id] IN (N'${typeOpen}',N'${typeUrdu}',N'${typeDraft}')) AS [types],
      (SELECT COUNT(*) FROM [dbo].[MembershipTypeTranslation]
         WHERE [membershipTypeId] IN (N'${typeOpen}',N'${typeUrdu}',N'${typeDraft}')) AS [words],
      (SELECT STRING_AGG([status], N',') WITHIN GROUP (ORDER BY [status])
         FROM [dbo].[MembershipApplication] WHERE [applicantUserId] IN (N'${membershipApplicant}',N'${membershipOther}')) AS [applications],
      (SELECT STRING_AGG([status], N',') WITHIN GROUP (ORDER BY [status])
         FROM [dbo].[Membership] WHERE [memberUserId]=N'${membershipApplicant}') AS [memberships],
      (SELECT COUNT(*) FROM [dbo].[MembershipCommunicationIntent]) AS [intents],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] rp JOIN [dbo].[Role] r ON r.[id]=rp.[roleId]
        WHERE r.[key]=N'platform-administrator' AND rp.[permissionKey] IN (N'membership.read',N'membership.administer')) AS [bundled],
      (SELECT COUNT(*) FROM [dbo].[Permission] WHERE [key] LIKE N'membership.%') AS [catalogued];
  `);
  const expectedMembershipState = {
    types: 'published,draft,published',
    words: 4,
    applications: 'approved,approved,rejected,withdrawn,withdrawn',
    memberships: 'active,closed',
    intents: 0,
    bundled: 2,
    catalogued: 2,
  };
  if (JSON.stringify(membershipState) === JSON.stringify(expectedMembershipState)) {
    pass(
      'Membership state as written',
      'types, words, applications and Memberships kept as history, owed mail disposed',
    );
  } else {
    fail('Membership state as written', JSON.stringify(membershipState));
  }

  const MEMBERSHIP_TABLES = [
    'MembershipType',
    'MembershipTypeTranslation',
    'MembershipApplication',
    'Membership',
    'MembershipCommunicationIntent',
  ] as const;
  for (const table of MEMBERSHIP_TABLES) {
    await assertObjectVisible(app, table);
    await expectDenied(
      app,
      `${table} ALTER denied`,
      `ALTER TABLE [dbo].[${table}] ADD [probe] INT NULL;`,
    );
  }
  for (const [trigger, table] of [
    ['MembershipTypeIntegrity', 'MembershipType'],
    ['MembershipTypeTranslationIntegrity', 'MembershipTypeTranslation'],
    ['MembershipApplicationIntegrity', 'MembershipApplication'],
    ['MembershipIntegrity', 'Membership'],
    ['MembershipIntentIntegrity', 'MembershipCommunicationIntent'],
  ] as const) {
    await expectDenied(
      app,
      `${trigger} DISABLE denied`,
      `DISABLE TRIGGER [dbo].[${trigger}] ON [dbo].[${table}];`,
    );
    await expectDenied(
      app,
      `${trigger} ALTER denied`,
      `ALTER TABLE [dbo].[${table}] DISABLE TRIGGER [${trigger}];`,
    );
  }

  // THE EXACT EFFECTIVE POSTURE, table by table and column by column, for the
  // five Phase-26 tables AND for every Identity table a Membership key names,
  // which Phase 26 must leave as it found them.
  const MEMBERSHIP_POSTURE: Readonly<
    Record<string, readonly [string, string | readonly string[] | null]>
  > = {
    MembershipType: ['INSERT,SELECT', ['id', 'primaryLocale', 'createdAt']],
    MembershipTypeTranslation: ['INSERT,SELECT', ['membershipTypeId', 'locale']],
    MembershipApplication: [
      'INSERT,SELECT',
      ['id', 'applicantUserId', 'membershipTypeId', 'submittedAt'],
    ],
    Membership: [
      'INSERT,SELECT',
      ['id', 'memberUserId', 'membershipTypeId', 'sourceApplicationId', 'activatedAt'],
    ],
    MembershipCommunicationIntent: [
      LEARNER_DATA,
      [
        'id',
        'purpose',
        'recipientUserId',
        'applicationId',
        'membershipId',
        'dueAt',
        'idempotencyKey',
        'createdAt',
      ],
    ],
    User: ['INSERT,SELECT', null],
    Permission: ['SELECT', ''],
    RolePermission: [LEARNER_DATA, ''],
  };
  const membershipPosture = await app.query<{
    name: string;
    held: string | null;
    updatable: string | null;
    columns: string | null;
  }>(`
    SELECT t.[name],
      (SELECT STRING_AGG(p.[permission], N',') WITHIN GROUP (ORDER BY p.[permission])
         FROM (VALUES (N'ALTER'),(N'CONTROL'),(N'DELETE'),(N'INSERT'),(N'REFERENCES'),
                      (N'SELECT'),(N'TAKE OWNERSHIP')) AS p([permission])
        WHERE HAS_PERMS_BY_NAME(N'dbo.' + t.[name], N'OBJECT', p.[permission]) = 1) AS [held],
      (SELECT STRING_AGG(c.[name], N',') WITHIN GROUP (ORDER BY c.[column_id])
         FROM sys.columns c WHERE c.[object_id] = OBJECT_ID(N'dbo.' + t.[name])
          AND HAS_PERMS_BY_NAME(N'dbo.' + t.[name], N'OBJECT', N'UPDATE', c.[name], N'COLUMN') = 1) AS [updatable],
      (SELECT STRING_AGG(c.[name], N',') WITHIN GROUP (ORDER BY c.[column_id])
         FROM sys.columns c WHERE c.[object_id] = OBJECT_ID(N'dbo.' + t.[name])) AS [columns]
    FROM (VALUES ${Object.keys(MEMBERSHIP_POSTURE)
      .map((table) => `(N'${table}')`)
      .join(',')}) AS t([name]);
  `);
  const membershipPostureFindings = membershipPosture.flatMap((row) => {
    const [verbs, scope] = MEMBERSHIP_POSTURE[row.name] ?? ['?', '?'];
    const expectedColumns =
      scope === null
        ? (row.updatable ?? '')
        : typeof scope === 'string'
          ? scope
          : (row.columns ?? '')
              .split(',')
              .filter((column) => !scope.includes(column))
              .join(',');
    return (row.held ?? '') === verbs && (row.updatable ?? '') === expectedColumns
      ? []
      : [`${row.name}: ${row.held ?? '(none)'} / UPDATE ${row.updatable ?? '(none)'}`];
  });
  if (
    membershipPosture.length === Object.keys(MEMBERSHIP_POSTURE).length &&
    Object.keys(MEMBERSHIP_POSTURE).length === MEMBERSHIP_TABLES.length + 3 &&
    membershipPostureFindings.length === 0
  ) {
    pass(
      'Membership effective posture exact',
      `${String(membershipPosture.length)} tables, object verbs and UPDATE columns as granted`,
    );
  } else {
    fail(
      'Membership effective posture exact',
      membershipPostureFindings.join('; ') || 'tables missing',
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
