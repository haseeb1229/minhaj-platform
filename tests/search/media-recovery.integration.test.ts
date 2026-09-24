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
  newPhase10Fixture,
  PHASE10_RECOVERY_WORDS,
  writePhase10Fixture,
  type Phase10Fixture,
} from '../../packages/database/src/lifecycle/phase10-fixture.ts';
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
 * Phase 10 — after a REAL backup and restore, Search rebuilds the Video
 * inventory from the RESTORED Media owner and returns only what is public.
 *
 * The search projection is derived and is never restored as truth
 * (ARCHITECTURE.md §8.5): a restore brings back Media's authoritative rows and
 * the durable intent still owed, and the index is rebuilt from them. So the
 * claim proved here is that the rows that came back are ENOUGH for Search to
 * answer correctly — the renamed Video at its CURRENT address, never the
 * archived one — and that the restored Media still answers old addresses with
 * current ones, including a series that has since become a programme.
 *
 * THE ONLY DATABASE THE APPLICATION CLIENT EVER OPENS HERE IS THE RESTORE,
 * positively proved to be a disposable restore target before anything binds to
 * it. Every resource created is removed and its absence verified.
 */

const live = databaseConfigured ? describe : describe.skip;

live('Phase 10 Search after a real restore', () => {
  let source: DisposableDatabase;
  let master: SqlSession;
  let sourceSession: SqlSession | undefined;
  let restored: SqlSession | undefined;
  let restoreDatabase: string;
  let target: BackupTarget;
  let fixture: Phase10Fixture;
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

    fixture = newPhase10Fixture();
    await writePhase10Fixture(source.admin, fixture, {
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

  it('restores the search intent still owed, and the Video it is owed for', async () => {
    const [row] = await (restored as SqlSession).query<{ requests: number }>(
      `SELECT COUNT(*) AS requests FROM [dbo].[SearchIndexRequest] WHERE [scopeKind] = N'video' AND [scopeId] = N'${fixture.videoId}';`,
    );
    expect(Number(row?.requests)).toBe(1);
  });

  it('rebuilds from the restored Media and answers with only what is public', async () => {
    await h.search.rebuild();
    await h.indexNow();

    expect(
      (await hits(PHASE10_RECOVERY_WORDS.video)).map((hit) => [hit.kind, hit.href]),
    ).toEqual([['video', `/watch/videos/${fixture.videoSlug}`]]);
    expect(await hits(PHASE10_RECOVERY_WORDS.archived)).toEqual([]);

    const [documents] = await (restored as SqlSession).query<{ archived: number }>(
      `SELECT COUNT(*) AS archived FROM [dbo].[SearchDocument] WHERE [scopeId] = N'${fixture.archivedVideoId}';`,
    );
    expect(Number(documents?.archived)).toBe(0);
  });

  it('answers the restored Media’s old addresses with its current ones', async () => {
    const { createMediaReadService } =
      await import('../../apps/web/src/contexts/media/index.ts');
    const reads = createMediaReadService(h.readers.media);

    expect(await reads.videoCanonicalSlug(fixture.videoOriginalSlug)).toBe(
      fixture.videoSlug,
    );
    expect(await reads.seriesCanonical(fixture.seriesOriginalSlug)).toEqual({
      kind: 'program',
      slug: fixture.seriesSlug,
    });
    // The Playlist's curated order came back: the archived Video is not shown.
    const playlist = await reads.playlist(fixture.playlistSlug);
    if (playlist === null) throw new Error('restored playlist missing');
    expect((await reads.playlistVideos(playlist.id)).items.map((v) => v.id)).toEqual([
      fixture.videoId,
    ]);
  });
});
