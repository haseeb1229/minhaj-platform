import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  getApplicationPrincipalCredentials,
  getDatabaseMigrationUrl,
} from '../../packages/database/src/config.ts';
import { provisionApplicationPrincipal } from '../../packages/database/src/lifecycle/application-principal.ts';
import {
  createDisposableDatabase,
  dropDisposableDatabase,
  newDisposableDatabaseName,
  openMasterSession,
} from '../../packages/database/src/lifecycle/disposable-database.ts';
import {
  appliedMigrationNames,
  deployMigrations,
  loadMigrations,
  migrationStatus,
  rollbackMigration,
  runPrismaCli,
  type Migration,
} from '../../packages/database/src/lifecycle/migrations.ts';
import {
  assertApprovedLocalTarget,
  localTargetPolicy,
} from '../../packages/database/src/lifecycle/local-target.ts';
import { resolveLocalDatabaseEnvironment } from '../../packages/database/src/lifecycle/local-environment.ts';
import { runSeed } from '../../packages/database/src/lifecycle/seed.ts';
import {
  openSession,
  withDatabase,
  type SqlSession,
} from '../../packages/database/src/lifecycle/sql-connection.ts';

/**
 * Live Phase 1 lifecycle proof, against real SQL Server.
 *
 * Each stage inspects `sys.tables`, `sys.columns` and `sys.database_permissions`
 * rather than trusting a command's exit code, and every prohibition asserts the
 * SQL Server error number so a statement cannot "pass" by being malformed.
 *
 * Runs against a disposable `MinhajPhase1Test_<uuid>` database created and
 * dropped here. It never touches `MinhajPlatform`, the system databases, or the
 * unrelated host SQLEXPRESS instance.
 *
 * Skipped when no database is configured, so the suite still runs on a machine
 * without the container. It is executed for real by `npm run db:migrate:test`
 * and `npm run db:test:permissions`.
 */

const configured = (() => {
  try {
    if (!resolveLocalDatabaseEnvironment({ requireLocalFile: false }).localFilePresent) {
      return false;
    }
    getDatabaseMigrationUrl();
    getApplicationPrincipalCredentials();
    return true;
  } catch {
    return false;
  }
})();

const PERMISSION_DENIED = new Set([229, 230, 262, 1088, 3701]);

interface SqlError extends Error {
  number?: number;
}

async function denialErrorNumber(
  session: SqlSession,
  statement: string,
): Promise<number | undefined> {
  try {
    await session.query(statement);
    return undefined;
  } catch (error) {
    return (error as SqlError).number;
  }
}

describe.skipIf(!configured)('Phase 1 database lifecycle (live SQL Server)', () => {
  const databaseName = newDisposableDatabaseName();
  let master: SqlSession;
  let admin: SqlSession;
  let app: SqlSession;
  let migration: Migration;
  let allMigrations: Migration[];
  /**
   * Something the NEWEST migration creates, used to observe its rollback.
   *
   * DERIVED from that migration's own SQL rather than named here. A hard-coded
   * table belongs to whichever migration was newest when somebody wrote it
   * down, so the next migration silently turns this proof into an assertion
   * that an unrelated table was not dropped — which passes for the wrong
   * reason until it fails for a confusing one.
   *
   * NOT EVERY MIGRATION CREATES A TABLE. Phase 4 adds no schema at all: the
   * public shell has no business model, and its migration seeds a single
   * permission key. The observation is therefore of an EFFECT rather than of a
   * table — the effect the migration actually has — and the assertions are
   * unchanged: present after deploy, gone after rollback, back after re-deploy.
   * A migration with no observable effect of either kind still fails the run,
   * because a rollback nobody can observe is a rollback nobody has proved.
   */
  let observation:
    | { readonly kind: 'table'; readonly name: string }
    | { readonly kind: 'permission'; readonly key: string };

  /** How many rows the newest migration's observable effect currently has. */
  async function observationCount(): Promise<number> {
    const rows =
      observation.kind === 'table'
        ? await admin.query(
            `SELECT name FROM sys.tables WHERE name = N'${observation.name}';`,
          )
        : await admin.query(
            `SELECT [key] FROM [dbo].[Permission] WHERE [key] = N'${observation.key}';`,
          );

    return rows.length;
  }
  /** The normal encrypted migration URL, retargeted at the disposable database. */
  let disposableUrl: string;

  beforeAll(async () => {
    const migrationUrl = getDatabaseMigrationUrl();
    const connection = assertApprovedLocalTarget(
      migrationUrl,
      localTargetPolicy(process.env, 'source', 'migration'),
    );
    const principal = getApplicationPrincipalCredentials();

    disposableUrl = migrationUrl.replace(
      `database=${connection.database}`,
      `database=${databaseName}`,
    );
    assertApprovedLocalTarget(
      disposableUrl,
      localTargetPolicy(process.env, 'disposable', 'migration'),
    );

    allMigrations = await loadMigrations();
    const newest = allMigrations.at(-1);
    if (newest === undefined) throw new Error('No migrations to test.');

    // The NEWEST migration is the one this suite rolls back and re-deploys.
    // Rolling back the OLDEST while a later one is still applied leaves the
    // history out of order, and `migrate status` rightly reports the set as
    // incomplete — a state the rollback artifacts are not written to produce.
    migration = newest;

    const created = /CREATE TABLE \[dbo\]\.\[(\w+)\]/.exec(newest.forwardSql)?.[1];
    const seeded = /\(N'([a-z]+\.[a-zA-Z]+)',\s*N'/.exec(newest.forwardSql)?.[1];

    if (created !== undefined) observation = { kind: 'table', name: created };
    else if (seeded !== undefined) observation = { kind: 'permission', key: seeded };
    else {
      throw new Error(
        `The newest migration '${newest.id}' creates neither a table nor a ` +
          `permission, so its rollback cannot be observed at all. A rollback ` +
          `nobody can observe is a rollback nobody has proved.`,
      );
    }

    master = await openMasterSession(connection);
    await createDisposableDatabase(master, databaseName);
    admin = await openSession(withDatabase(connection, databaseName));

    // The REAL Prisma CLI over the normal encrypted configuration.
    await deployMigrations(disposableUrl);
    await provisionApplicationPrincipal(
      admin,
      principal.DATABASE_APP_LOGIN,
      principal.DATABASE_APP_PASSWORD,
    );

    app = await openSession({
      ...withDatabase(connection, databaseName),
      user: principal.DATABASE_APP_LOGIN,
      password: principal.DATABASE_APP_PASSWORD,
    });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await admin?.close();
    if (master !== undefined) {
      await dropDisposableDatabase(master, databaseName);
      await master.close();
    }
  }, 120_000);

  it('creates the audit table with the expected shape', async () => {
    const columns = await admin.query<{ name: string }>(`
      SELECT c.name FROM sys.columns c
      WHERE c.object_id = OBJECT_ID(N'[dbo].[AuditLog]') ORDER BY c.name;
    `);

    expect(columns.map((column) => column.name)).toEqual([
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
    ]);
  });

  it('creates exactly the delivered owner tables', async () => {
    const tables = await admin.query<{ name: string }>(`
      SELECT t.name FROM sys.tables t
      JOIN sys.schemas s ON s.schema_id = t.schema_id
      WHERE s.name = 'dbo' ORDER BY t.name;
    `);

    // Every table the delivered phases own, and nothing else. Naming them
    // exhaustively is the point: a table appearing here that no delivered
    // phase created is premature schema, and a table missing is a migration
    // that did not do what it claims.
    expect(tables.map((table) => table.name).sort()).toEqual(
      [
        'Account',
        'AuditLog',
        'AuthorProfile',
        'EmailDelivery',
        'EmailSuppression',
        'IdentityBootstrap',
        'IdentityCommunicationIntent',
        'IdentitySecurityOperation',
        'Language',
        'Permission',
        'Person',
        'PersonNameVariant',
        'PersonTranslation',
        'PrivilegedSecurityPosture',
        'ProviderEvent',
        'RateLimitCounter',
        'Role',
        'RoleAssignment',
        'RolePermission',
        'ScholarProfile',
        'ScholarProfileLanguage',
        'ScholarProfileTranslation',
        'Session',
        'SpeakerProfile',
        'StepUpGrant',
        'Tag',
        'TeacherProfile',
        'TeacherProfileLanguage',
        'TeacherProfileTranslation',
        'Topic',
        'TopicTranslation',
        'TwoFactor',
        'User',
        'Verification',
        '_prisma_migrations',
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
        'Asset',
        // Phase 8 — Library.
        'Work',
        'WorkLabel',
        'WorkSlugHistory',
        'WorkContributor',
        'WorkTopic',
        'Edition',
        'BookTranslation',
        'BookTranslator',
        'SalePoint',
        'WorkSalePoint',
        // Phase 17 — the DERIVED search projection and its indexing intent.
        'SearchIndexRequest',
        'SearchIndexScope',
        'SearchDocument',
        'SearchDocumentTopic',
        // Phase 9 — the six scholarly and periodical Library aggregates.
        'Research',
        'ResearchLabel',
        'ResearchSlugHistory',
        'ResearchContributor',
        'ResearchTopic',
        'ResearchCitation',
        'ResearchPaper',
        'ResearchPaperLabel',
        'ResearchPaperSlugHistory',
        'ResearchPaperContributor',
        'ResearchPaperTopic',
        'ResearchPaperCitation',
        'Publication',
        'PublicationLabel',
        'PublicationSlugHistory',
        'PublicationContributor',
        'PublicationTopic',
        'Magazine',
        'MagazineLabel',
        'MagazineSlugHistory',
        'MagazineContributor',
        'MagazineTopic',
        'MagazineIssue',
        'MagazineIssueLabel',
        'MagazineIssueSlugHistory',
        'MagazineIssueContributor',
        'MagazineIssueTopic',
        'Encyclopedia',
        'EncyclopediaLabel',
        'EncyclopediaSlugHistory',
        'EncyclopediaContributor',
        'EncyclopediaTopic',
        // Phase 10 — Media: Video, Series, Playlist and their typed relations.
        'Video',
        'VideoLabel',
        'VideoSlugHistory',
        'VideoSpeaker',
        'VideoTopic',
        'Series',
        'SeriesLabel',
        'SeriesSlugHistory',
        'Playlist',
        'PlaylistLabel',
        'PlaylistSlugHistory',
        'PlaylistVideo',
        // Phase 11 — Media: AudioTrack, AudioSeries and their typed relations.
        'AudioTrack',
        'AudioTrackLabel',
        'AudioTrackSlugHistory',
        'AudioTrackSpeaker',
        'AudioTrackTopic',
        'AudioSeries',
        'AudioSeriesLabel',
        'AudioSeriesSlugHistory',
        // Phase 12 — Media: Photo, Gallery, GalleryItem and their labels and
        // the Gallery's slug history.
        'Photo',
        'PhotoLabel',
        'Gallery',
        'GalleryLabel',
        'GallerySlugHistory',
        'GalleryItem',
        // Phase 13 — Editorial's four News families and their typed relations.
        'NewsArticle',
        'NewsArticleRevision',
        'NewsArticleRevisionTranslation',
        'NewsArticleTopic',
        'NewsArticleContributor',
        'NewsArticleSlugHistory',
        'PressRelease',
        'PressReleaseRevision',
        'PressReleaseRevisionTranslation',
        'PressReleaseTopic',
        'PressReleaseContributor',
        'PressReleaseSlugHistory',
        'Statement',
        'StatementRevision',
        'StatementRevisionTranslation',
        'StatementTopic',
        'StatementContributor',
        'StatementSlugHistory',
        'MediaCoverage',
        'MediaCoverageRevision',
        'MediaCoverageRevisionTranslation',
        'MediaCoverageTopic',
        'MediaCoverageContributor',
        'MediaCoverageSlugHistory',
        // Phase 16 — Global Network: the four directory levels, their labels and
        // slug histories, the Cities a Centre serves and its contacts.
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
        // Phase 14 — Editorial's Event: record, immutable revisions, their
        // translations, typed Topic and Person references, occurrences and
        // ordered Gallery associations, and the permanent slug reservation.
        'Event',
        'EventRevision',
        'EventRevisionTranslation',
        'EventTopic',
        'EventContributor',
        'EventSchedule',
        'EventGallery',
        'EventSlugHistory',
      ].sort(),
    );
  });

  it('runs the application as a principal that is neither sa nor an owner', async () => {
    const [identity] = await app.query<{
      login: string;
      isSysadmin: number;
      isDbOwner: number;
      ownsDatabase: number;
    }>(`
      SELECT
        SUSER_SNAME()                AS login,
        IS_SRVROLEMEMBER('sysadmin') AS isSysadmin,
        IS_ROLEMEMBER('db_owner')    AS isDbOwner,
        CASE WHEN EXISTS (
          SELECT 1 FROM sys.databases d
          WHERE d.name = DB_NAME() AND d.owner_sid = SUSER_SID()
        ) THEN 1 ELSE 0 END          AS ownsDatabase;
    `);

    expect(identity?.login).not.toBe('sa');
    expect(Number(identity?.isSysadmin)).toBe(0);
    expect(Number(identity?.isDbOwner)).toBe(0);
    expect(Number(identity?.ownsDatabase)).toBe(0);
  });

  it('permits the application to insert and read audit rows', async () => {
    await app.query(`
      INSERT INTO [dbo].[AuditLog]
        ([id], [actorType], [action], [targetType], [targetId], [authorisingSource], [ipAddress])
      VALUES
        (NEWID(), N'system', N'phase1.lifecycle.probe', N'Database', N'test',
         N'vitest', N'127.0.0.1');
    `);

    // THE PROBE ROW, not the whole table. A freshly migrated database is no
    // longer empty of audit rows: the Phase-3B migration records the privilege
    // change it makes when it extends the protected administrator bundle, which
    // is precisely the kind of event the audit log exists for. Counting every
    // row would make this assertion about how many migrations have shipped
    // rather than about whether the runtime may write one.
    const [row] = await app.query<{ total: number }>(
      `SELECT COUNT_BIG(*) AS total FROM [dbo].[AuditLog]
       WHERE [action] = N'phase1.lifecycle.probe';`,
    );
    expect(Number(row?.total)).toBe(1);
  });

  it('denies the application UPDATE and DELETE on audit rows', async () => {
    // Captured BEFORE the attempts, so "nothing was removed" is measured
    // against what was actually there rather than against a fixed number.
    const [before] = await admin.query<{ total: number }>(
      'SELECT COUNT_BIG(*) AS total FROM [dbo].[AuditLog];',
    );

    const updateError = await denialErrorNumber(
      app,
      `UPDATE [dbo].[AuditLog] SET [action] = N'tampered';`,
    );
    const deleteError = await denialErrorNumber(app, 'DELETE FROM [dbo].[AuditLog];');

    expect(updateError, 'UPDATE must be denied').toBeDefined();
    expect(deleteError, 'DELETE must be denied').toBeDefined();
    expect(PERMISSION_DENIED.has(updateError ?? 0)).toBe(true);
    expect(PERMISSION_DENIED.has(deleteError ?? 0)).toBe(true);

    // The data is intact — the denial protected it, it did not merely error.
    // Both halves matter: nothing was deleted, and the probe row's own value is
    // unchanged rather than merely present.
    const [after] = await admin.query<{ total: number }>(
      'SELECT COUNT_BIG(*) AS total FROM [dbo].[AuditLog];',
    );
    expect(Number(after?.total)).toBe(Number(before?.total));

    const [probe] = await admin.query<{ total: number }>(
      `SELECT COUNT_BIG(*) AS total FROM [dbo].[AuditLog]
       WHERE [action] = N'phase1.lifecycle.probe';`,
    );
    expect(Number(probe?.total)).toBe(1);

    const [tampered] = await admin.query<{ total: number }>(
      `SELECT COUNT_BIG(*) AS total FROM [dbo].[AuditLog] WHERE [action] = N'tampered';`,
    );
    expect(Number(tampered?.total)).toBe(0);
  });

  it('denies the application every form of schema-changing DDL', async () => {
    // The DDL refusals name the object as possibly missing, so visibility is
    // established first: denial plus visibility is a permission boundary.
    const [visible] = await app.query<{ objectId: number | null }>(
      `SELECT OBJECT_ID(N'[dbo].[AuditLog]') AS objectId;`,
    );
    expect(visible?.objectId).not.toBeNull();

    for (const statement of [
      'CREATE TABLE [dbo].[RuntimeShouldNotCreateThis] ([id] INT NOT NULL);',
      'ALTER TABLE [dbo].[AuditLog] ADD [injectedColumn] NVARCHAR(16) NULL;',
      'DROP TABLE [dbo].[AuditLog];',
      'TRUNCATE TABLE [dbo].[AuditLog];',
    ]) {
      const number = await denialErrorNumber(app, statement);
      expect(number, `${statement} must be denied`).toBeDefined();
      expect(
        PERMISSION_DENIED.has(number ?? 0),
        `${statement} was rejected with error ${number}, not a permission denial`,
      ).toBe(true);
    }

    // Nothing was created despite the attempt.
    const created = await admin.query<{ name: string }>(`
      SELECT name FROM sys.tables WHERE name = N'RuntimeShouldNotCreateThis';
    `);
    expect(created).toHaveLength(0);
  });

  it('holds no UPDATE or DELETE grant on the audit table', async () => {
    const grants = await admin.query<{ permission: string; state: string }>(`
      SELECT p.permission_name AS permission, p.state_desc AS state
      FROM sys.database_permissions p
      JOIN sys.database_principals u ON u.principal_id = p.grantee_principal_id
      WHERE p.major_id = OBJECT_ID(N'[dbo].[AuditLog]')
        AND u.name = N'${getApplicationPrincipalCredentials().DATABASE_APP_LOGIN}';
    `);

    const granted = grants
      .filter((grant) => grant.state === 'GRANT')
      .map((grant) => grant.permission.trim())
      .sort();

    expect(granted).toEqual(['INSERT', 'SELECT']);
    expect(granted).not.toContain('UPDATE');
    expect(granted).not.toContain('DELETE');
  });

  it('seeds idempotently', async () => {
    const first = await runSeed(admin);
    const second = await runSeed(admin);

    expect(second).toEqual(first);
    expect(first.seededRecords).toBe(0);
  });

  it('uses the encrypted migration URL, with no plaintext fallback', () => {
    expect(disposableUrl).toMatch(/encrypt=true/i);
    expect(disposableUrl).not.toMatch(/encrypt=false/i);
    expect(disposableUrl).toContain(databaseName);
  });

  it('reports a healthy prisma migrate status after deploy', async () => {
    const status = await migrationStatus(disposableUrl);

    expect(status.exitCode).toBe(0);
    expect(status.output).toContain('Database schema is up to date!');
    expect(status.output).not.toMatch(/not yet been applied|failed/i);
  }, 120_000);

  it('fails loudly when the Prisma CLI cannot connect, rather than falling back', async () => {
    // P1011 or any other CLI failure must surface as a thrown error. If this
    // resolved, the gate could go green without the real workflow running.
    const unreachable = disposableUrl.replace(':14330;', ':14399;');

    await expect(migrationStatus(unreachable)).rejects.toThrow(
      /failed with exit code|no fallback path/i,
    );
  }, 120_000);

  it('rolls back and re-deploys through the real CLI, ending in the same schema', async () => {
    // A second, unrelated history row proves the rollback removes ONLY its own.
    const decoyId = 'MinhajPhase1TestDecoy_do_not_remove';
    await admin.query(`
      INSERT INTO [dbo].[_prisma_migrations]
        ([id], [checksum], [finished_at], [migration_name], [started_at], [applied_steps_count])
      VALUES
        (NEWID(), 'decoy', SYSUTCDATETIME(), N'${decoyId}', SYSUTCDATETIME(), 1);
    `);

    // Present before the rollback, so its absence afterwards means something.
    expect(await observationCount()).toBe(1);

    await rollbackMigration(admin, migration);

    expect(await observationCount()).toBe(0);

    const historyAfterRollback = await appliedMigrationNames(admin);
    expect(historyAfterRollback).not.toContain(migration.id);
    // Only the exact matching row was removed.
    expect(historyAfterRollback).toContain(decoyId);

    // REAL `prisma migrate deploy` again — it must genuinely re-apply, which it
    // can only do because the rollback removed the history row.
    const redeploy = await deployMigrations(disposableUrl);
    expect(redeploy.exitCode).toBe(0);
    expect(redeploy.output).toContain(migration.id);

    expect(await observationCount()).toBe(1);
    expect(await appliedMigrationNames(admin)).toContain(migration.id);
    expect(await appliedMigrationNames(admin)).toContain(decoyId);

    const status = await migrationStatus(disposableUrl);
    expect(status.output).toContain('Database schema is up to date!');

    await admin.query(
      `DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name] = N'${decoyId}';`,
    );
  }, 180_000);

  it('runs the CLI without exposing the connection URL on the command line', async () => {
    // The URL travels in the child environment, not argv, so it never reaches
    // the process table where any local user could read it.
    //
    // The second argument is an OPTIONS OBJECT. This call previously passed
    // the URL as a bare string, so `options.databaseUrl` was `undefined` and
    // the child fell back to the configured default database — the assertion
    // held, but against the wrong target. It only looked correct while the
    // default and the disposable database happened to share a schema state;
    // Phase 2 made them differ and the mistake surfaced.
    const result = await runPrismaCli(['migrate', 'status'], {
      databaseUrl: disposableUrl,
    });

    expect(result.exitCode).toBe(0);
    expect(result.command).not.toContain(disposableUrl);
    expect(result.command).not.toMatch(/password/i);
  }, 120_000);
});
