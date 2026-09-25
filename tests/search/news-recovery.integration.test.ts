import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getDatabaseMigrationUrl } from '../../packages/database/src/config.ts';
import {
  backupDatabase,
  newBackupTarget,
  newRestoreDatabaseName,
  restoreDatabaseFromBackup,
  type BackupTarget,
} from '../../packages/database/src/lifecycle/backup.ts';
import { openMasterSession } from '../../packages/database/src/lifecycle/disposable-database.ts';
import {
  assertApprovedLocalTarget,
  localTargetPolicy,
} from '../../packages/database/src/lifecycle/local-target.ts';
import {
  newPhase5Fixture,
  writePhase5Fixture,
} from '../../packages/database/src/lifecycle/phase5-fixture.ts';
import {
  newPhase13Fixture,
  PHASE13_FAMILIES,
  PHASE13_KIND,
  PHASE13_RECOVERY_WORDS,
  phase13Slugs,
  writePhase13Fixture,
  type Phase13Fixture,
} from '../../packages/database/src/lifecycle/phase13-fixture.ts';
import { createProofAccount } from '../people/harness.ts';
import {
  cleanUpRecoveryResources,
  type CleanupOutcome,
} from '../../packages/database/src/lifecycle/recovery-cleanup.ts';
import {
  openSession,
  withDatabase,
  type SqlSession,
} from '../../packages/database/src/lifecycle/sql-connection.ts';
import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';
import { buildSearchHarness, type SearchHarness } from './harness.ts';

/**
 * Phase 13 — after a REAL backup and restore, Search rebuilds the News
 * inventory from the RESTORED Editorial owner and returns only what is public.
 *
 * The search projection is derived and is never restored as truth
 * (ARCHITECTURE.md §8.5): a restore brings back Editorial's authoritative rows
 * and the durable intent still owed, and the index is rebuilt from them. So the
 * claim proved here is that the rows that came back are ENOUGH for Search to
 * answer correctly — each family's renamed record at its CURRENT address under
 * its own kind, never the archived one — and that the restored Editorial still
 * answers each family's former slug with its current one.
 *
 * THE ONLY DATABASE THE APPLICATION CLIENT EVER OPENS HERE IS THE RESTORE,
 * positively proved to be a disposable restore target before anything binds to
 * it. Every resource created is removed and its absence verified.
 */

const live = databaseConfigured ? describe : describe.skip;

const SEGMENT: Readonly<Record<string, string>> = {
  'news-article': '/news',
  'press-release': '/news/press-releases',
  statement: '/news/statements',
  'media-coverage': '/news/media-coverage',
};

live('Phase 13 Search after a real restore', () => {
  let source: DisposableDatabase;
  let master: SqlSession;
  let sourceSession: SqlSession | undefined;
  let restored: SqlSession | undefined;
  let restoreDatabase: string;
  let target: BackupTarget;
  let fixture: Phase13Fixture;
  let h: SearchHarness;

  async function hits(q: string) {
    const outcome = await h.search.search({ q }, { locale: 'en' });
    if (outcome.state !== 'results') throw new Error(`Search answered ${outcome.state}.`);
    return outcome.results.hits;
  }

  beforeAll(async () => {
    source = await createProofDatabase();

    const people = newPhase5Fixture();
    await writePhase5Fixture(source.admin, people);
    const [topic] = await source.admin.query<{ id: string }>(
      "SELECT [id] FROM [Topic] WHERE [slug] = N'education';",
    );
    if (topic === undefined) throw new Error('The canonical education topic is missing.');

    fixture = newPhase13Fixture();
    await writePhase13Fixture(source.admin, fixture, {
      authorId: await createProofAccount(source.admin),
      reviewerId: await createProofAccount(source.admin),
      personId: people.linkedPersonId,
      topicId: topic.id,
    });

    const migrationUrl = getDatabaseMigrationUrl();
    const connection = assertApprovedLocalTarget(
      migrationUrl,
      localTargetPolicy(process.env, 'source', 'migration'),
    );
    master = await openMasterSession(connection);
    sourceSession = await openSession(withDatabase(connection, source.name));

    target = newBackupTarget();
    await backupDatabase(sourceSession, source.name, target);
    restoreDatabase = newRestoreDatabaseName();
    await restoreDatabaseFromBackup(master, target.path, restoreDatabase);
    restored = await openSession(withDatabase(connection, restoreDatabase));

    const restoredUrl = migrationUrl.replace(
      `database=${connection.database}`,
      `database=${restoreDatabase}`,
    );
    assertApprovedLocalTarget(
      restoredUrl,
      localTargetPolicy(process.env, 'restore', 'migration'),
    );
    process.env.DATABASE_URL = restoredUrl;

    h = await buildSearchHarness(restored);
  }, 600_000);

  afterAll(async () => {
    let outcome: CleanupOutcome | undefined;
    if (master !== undefined && target !== undefined && restoreDatabase !== undefined) {
      outcome = await cleanUpRecoveryResources({
        master,
        source: sourceSession,
        restored,
        restoreDatabase,
        backupPath: target.path,
      });
    }
    await source?.close();
    expect(outcome?.failures ?? []).toEqual([]);
  }, 120_000);

  it('restores the search intent still owed for every family', async () => {
    for (const family of PHASE13_FAMILIES) {
      const [row] = await (restored as SqlSession).query<{ requests: number }>(
        `SELECT COUNT(*) AS requests FROM [dbo].[SearchIndexRequest] WHERE [scopeKind] = N'${PHASE13_KIND[family]}' AND [scopeId] = N'${fixture.ids[family]}';`,
      );
      expect(Number(row?.requests), family).toBe(1);
    }
  });

  it('rebuilds from the restored Editorial and answers with only what is public', async () => {
    await h.search.rebuild();
    await h.indexNow();

    const found = (await hits(PHASE13_RECOVERY_WORDS.published))
      .map((hit) => [hit.kind, hit.href])
      .sort();
    expect(found).toEqual(
      PHASE13_FAMILIES.map((family) => {
        const kind = PHASE13_KIND[family];
        return [kind, `${SEGMENT[kind]}/${phase13Slugs(fixture, family).current}`];
      }).sort(),
    );
    expect(await hits(PHASE13_RECOVERY_WORDS.archived)).toEqual([]);
    const [documents] = await (restored as SqlSession).query<{ archived: number }>(
      `SELECT COUNT(*) AS archived FROM [dbo].[SearchDocument] WHERE [scopeId] IN (N'${fixture.archivedId}',N'${fixture.scheduledId}');`,
    );
    expect(Number(documents?.archived)).toBe(0);
  });

  it('answers every family’s former slug with its current one', async () => {
    const { createEditorialReadService } =
      await import('../../apps/web/src/contexts/editorial/application/public-service.ts');
    const reads = createEditorialReadService(h.readers.editorial);
    for (const family of PHASE13_FAMILIES) {
      const kind = PHASE13_KIND[family] as Parameters<typeof reads.news>[0];
      const slugs = phase13Slugs(fixture, family);
      expect(await reads.newsCanonicalSlug(kind, slugs.original), family).toBe(
        slugs.current,
      );
      expect((await reads.news(kind, slugs.original))?.slug).toBe(slugs.current);
    }
  });
});
