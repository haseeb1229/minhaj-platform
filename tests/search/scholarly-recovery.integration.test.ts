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
  newPhase9Fixture,
  PHASE9_RECOVERY_WORDS,
  writePhase9Fixture,
  type Phase9Fixture,
} from '../../packages/database/src/lifecycle/phase9-fixture.ts';
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
 * Phase 9 — after a REAL backup and restore, Search rebuilds the scholarly and
 * periodical inventory from the RESTORED Library and returns only what is public.
 *
 * WHY THIS IS ITS OWN PROOF. The search projection is derived and is never
 * restored as truth (ARCHITECTURE.md §8.5): a restore brings back the owner's
 * authoritative rows and whatever durable intent was still owed, and the index
 * is rebuilt from them. So the claim worth proving is not "the rows came back" —
 * the populated recovery rehearsal proves that — but "the rows that came back are
 * enough for Search to answer correctly": the public research and the renamed
 * issue at its CURRENT address, and never the archived paper or the draft issue.
 *
 * THE ONLY DATABASE THE APPLICATION CLIENT EVER OPENS HERE IS THE RESTORE. The
 * source is written and backed up through administrative SQL sessions; the
 * application adapters are imported only after `DATABASE_URL` points at the
 * restored copy, which is positively proved to be a disposable restore target.
 *
 * Runs in the `Database foundation` CI job (`npm run test:search`), where a
 * skipped suite fails the job; every resource it creates is removed and its
 * absence verified.
 */

const live = databaseConfigured ? describe : describe.skip;

live('Phase 9 Search after a real restore', () => {
  let source: DisposableDatabase;
  let master: SqlSession;
  let sourceSession: SqlSession | undefined;
  let restored: SqlSession | undefined;
  let restoreDatabase: string;
  let target: BackupTarget;
  let fixture: Phase9Fixture;
  let h: SearchHarness;

  async function titles(q: string) {
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

    fixture = newPhase9Fixture();
    await writePhase9Fixture(source.admin, fixture, {
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

    // POSITIVELY a disposable restore target before anything binds to it.
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

  it('restores the search intent still owed, and the owner it is owed for', async () => {
    const [row] = await (restored as SqlSession).query<{ requests: number }>(
      `SELECT COUNT(*) AS requests FROM [dbo].[SearchIndexRequest] WHERE [scopeKind] = N'magazine-issue' AND [scopeId] = N'${fixture.issueId}';`,
    );
    expect(Number(row?.requests)).toBe(1);
  });

  it('rebuilds from the restored Library and answers with only what is public', async () => {
    await h.search.rebuild();
    await h.indexNow();

    const research = await titles(PHASE9_RECOVERY_WORDS.research);
    expect(research.map((hit) => [hit.kind, hit.href])).toEqual([
      ['research', `/library/research/${fixture.researchSlug}`],
    ]);

    // The renamed issue, at the CURRENT address in both of its namespaces.
    const issue = await titles(PHASE9_RECOVERY_WORDS.issue);
    expect(issue.map((hit) => hit.href)).toEqual([
      `/library/magazines/${fixture.magazineSlug}/issues/${fixture.issueSlug}`,
    ]);

    // Archived and draft records came back as rows — and stay out of the index.
    expect(await titles(PHASE9_RECOVERY_WORDS.paper)).toEqual([]);
    expect(await titles(PHASE9_RECOVERY_WORDS.draftIssue)).toEqual([]);

    const [documents] = await (restored as SqlSession).query<{
      paper: number;
      draft: number;
    }>(
      `SELECT (SELECT COUNT(*) FROM [dbo].[SearchDocument] WHERE [scopeId] = N'${fixture.paperId}') AS paper,
              (SELECT COUNT(*) FROM [dbo].[SearchDocument] WHERE [scopeId] = N'${fixture.draftIssueId}') AS draft;`,
    );
    expect(Number(documents?.paper)).toBe(0);
    expect(Number(documents?.draft)).toBe(0);
  });

  it('answers the restored Library’s old addresses with its current ones', async () => {
    const { createLibraryReadService } =
      await import('../../apps/web/src/contexts/library/index.ts');
    const reads = createLibraryReadService(h.readers.library);

    expect(
      await reads.scholarlyCanonicalSlug('research', fixture.researchOriginalSlug),
    ).toBe(fixture.researchSlug);
    expect(
      await reads.magazineIssueCanonical(
        fixture.magazineOriginalSlug,
        fixture.issueOriginalSlug,
      ),
    ).toEqual({ magazineSlug: fixture.magazineSlug, issueSlug: fixture.issueSlug });
  });
});
