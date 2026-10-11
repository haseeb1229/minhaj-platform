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
  newPhase18Fixture,
  writePhase18Fixture,
  type Phase18Fixture,
} from '../../packages/database/src/lifecycle/phase18-fixture.ts';
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
import { createProofAccount } from '../people/harness.ts';
import { NEUTRAL, person, topic } from '../quran/fixture-sql.ts';
import { buildSearchHarness, type SearchHarness } from './harness.ts';

/**
 * Phase 18 — after a REAL backup and restore, Search rebuilds the Quran
 * inventory from the RESTORED Quran owner and returns only what is public.
 *
 * The search projection is derived and is never restored as truth
 * (ARCHITECTURE.md §8.5): a restore brings back the canonical corpus, its
 * activation, the layered works and the durable intent still owed, and the
 * index is rebuilt from them. So the claim proved here is that the rows that
 * came back are ENOUGH for Search to answer correctly — every Ayah of the
 * restored fixture-mode corpus once, at its citation address, carrying its
 * CORRECTED canonical text where one was corrected, a published translation as
 * a layer document in its own language, and a draft transliteration not at all.
 *
 * NOTHING HERE IS THE QURAN: the populated state is the recovery fixture of
 * `packages/database/src/lifecycle/phase18-fixture.ts` — sentinel texts, a
 * fictional structure and a fictional reciter.
 *
 * THE ONLY DATABASE THE APPLICATION CLIENT EVER OPENS HERE IS THE RESTORE,
 * positively proved to be a disposable restore target before anything binds to
 * it. Every resource created is removed and its absence verified.
 */

const live = databaseConfigured ? describe : describe.skip;

/** The fixture's fictional structure, in canonical order. */
const CITATIONS = ['1:1', '1:2', '1:3', '2:1', '2:2'];

live('Phase 18 Search after a real restore', () => {
  let source: DisposableDatabase;
  let master: SqlSession;
  let sourceSession: SqlSession | undefined;
  let restored: SqlSession | undefined;
  let restoreDatabase: string;
  let target: BackupTarget;
  let fixture: Phase18Fixture;
  let h: SearchHarness;

  async function find(q: string, locale: 'en' | 'ar') {
    const outcome = await h.search.search({ q, type: 'quran-ayah' }, { locale });
    if (outcome.state !== 'results') throw new Error(`Search answered ${outcome.state}.`);
    return outcome.results;
  }

  async function documentsOf(scope: string): Promise<string[]> {
    const rows = await (restored as SqlSession).query<{
      textLanguage: string;
      contentLanguage: string;
    }>(
      `SELECT [textLanguage],[contentLanguage] FROM [dbo].[SearchDocument]
        WHERE [scopeKind] = N'quran-ayah' AND [scopeId] = N'${scope}' ORDER BY [textLanguage];`,
    );
    return rows.map((row) => `${row.textLanguage}/${row.contentLanguage}`);
  }

  beforeAll(async () => {
    source = await createProofDatabase();

    fixture = newPhase18Fixture();
    await writePhase18Fixture(source.admin, fixture, {
      actorId: await createProofAccount(source.admin),
      personId: await person(
        source.admin,
        `fixture-translator-${fixture.runId.slice(0, 8)}`,
      ),
      topicId: await topic(
        source.admin,
        `non-quran-fixture-topic-${fixture.runId.slice(0, 8)}`,
      ),
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
    process.env['DATABASE_URL'] = restoredUrl;

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

  it('restores the activation and the search intent still owed', async () => {
    const [row] = await (restored as SqlSession).query<{
      activations: number;
      requests: number;
    }>(
      `SELECT (SELECT COUNT(*) FROM [dbo].[QuranActivation]) AS activations,
              (SELECT COUNT(*) FROM [dbo].[SearchIndexRequest] WHERE [scopeKind] = N'quran-ayah' AND [scopeId] = N'1:2') AS requests;`,
    );
    expect(Number(row?.activations)).toBe(1);
    expect(Number(row?.requests)).toBe(1);
    expect(await h.readers.quran.availability()).toEqual({
      active: true,
      mode: 'fixture',
    });
  });

  it('rebuilds from the restored Quran owner and answers each Ayah once, at its citation', async () => {
    await h.search.rebuild();
    await h.indexNow();

    // The neutral phrase is in every canonical text: one result per Ayah.
    const found = await find(NEUTRAL.split(' ')[1]!, 'ar');
    expect(found.withheld).toBe(0);
    expect(found.hits.map((hit) => [hit.resourceId, hit.href, hit.textLanguage])).toEqual(
      expect.arrayContaining(
        CITATIONS.map((citation) => [
          citation,
          `/quran/surah/${citation.replace(':', '/')}`,
          'ar',
        ]),
      ),
    );
    expect(found.hits).toHaveLength(CITATIONS.length);

    // The CORRECTED text is the one the restored corpus answers with.
    const corrected = found.hits.find((hit) => hit.resourceId === '1:2');
    expect(corrected?.summary).toBe(`NON_QURAN_FIXTURE_CORRECTED_1_2 ${NEUTRAL}`);
    expect(found.hits.find((hit) => hit.resourceId === '1:1')?.summary).toBe(
      `NON_QURAN_FIXTURE_CANONICAL_1_1 ${NEUTRAL}`,
    );
  });

  it('projects the published translation in its own language, and the draft transliteration not at all', async () => {
    expect(await documentsOf('1:1')).toEqual(['ar/ar', 'en/en']);
    expect(await documentsOf('1:2')).toEqual(['ar/ar', 'en/en']);
    expect(await documentsOf('2:1')).toEqual(['ar/ar']);
    const english = await find(NEUTRAL.split(' ')[1]!, 'en');
    expect(
      english.hits
        .filter((hit) => hit.textLanguage === 'en')
        .map((hit) => hit.resourceId)
        .sort(),
    ).toEqual(['1:1', '1:2']);
    expect(h.reported).toEqual([]);
  });
});
