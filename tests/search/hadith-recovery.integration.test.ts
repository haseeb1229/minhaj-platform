import { randomUUID } from 'node:crypto';

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
  newPhase19Fixture,
  writePhase19Fixture,
  type Phase19Fixture,
} from '../../packages/database/src/lifecycle/phase19-fixture.ts';
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
import {
  activate,
  canonicalEditor,
  n,
  NEUTRAL,
  person,
  registerEdition,
  sentinel,
  topic,
  type FixtureAuthority,
} from '../hadith/fixture-sql.ts';
import { buildSearchHarness, type SearchHarness } from './harness.ts';

/**
 * Phase 19 — after a REAL backup and restore, Search rebuilds the Hadith
 * inventory from the RESTORED Hadith owner and returns only what is public.
 *
 * The search projection is derived and is never restored as truth
 * (ARCHITECTURE.md §8.5): a restore brings back the records, their history and
 * verification, the citation mapping, the conflict evidence, the activation,
 * the layered works and the durable intent still owed, and the index is
 * rebuilt from them. So the claim proved here is that the rows that came back
 * are ENOUGH for Search to answer correctly:
 *
 *   - the recovery fixture's citation (`packages/database/src/lifecycle/
 *     phase19-fixture.ts`) still has its conflict evidence, so it is NOT
 *     indexed, whatever its record, translation and verification say;
 *   - a second collection, written before the backup through the REAL
 *     canonical procedures, answers its one public citation ONCE, at its
 *     permanent address, by its original and by its published translation;
 *   - reconciliation over the restored owner converges — nothing missing,
 *     stale or orphaned — and repairs a deactivation and a re-activation.
 *
 * NOTHING HERE IS A HADITH: every text is a `NON_HADITH_FIXTURE_…` sentinel,
 * the neutral Arabic phrase "test text" and invented Latin words.
 *
 * THE ONLY DATABASE THE APPLICATION CLIENT EVER OPENS HERE IS THE RESTORE,
 * positively proved to be a disposable restore target before anything binds to
 * it. Every resource created is removed and its absence verified.
 */

const live = databaseConfigured ? describe : describe.skip;

const WORD = {
  original: 'harbourlightfixture',
  translation: 'quayfernfixture',
} as const;

const ORIGINAL = `${sentinel('TEXT', 40)} ${NEUTRAL} ${WORD.original}`;
const TRANSLATION = `${sentinel('TRANSLATION', 40)} ${WORD.translation}`;

/** One canonical procedure, executed by the owner with a real step-up grant. */
async function exec(
  admin: SqlSession,
  procedure: string,
  authority: FixtureAuthority,
  parameters: Readonly<Record<string, string | number | null>>,
): Promise<void> {
  const values = Object.entries(parameters).map(
    ([name, value]) =>
      `@${name} = ${value === null ? 'NULL' : typeof value === 'number' ? String(value) : n(value)}`,
  );
  await admin.query(`
    DECLARE @at DATETIME2 = SYSUTCDATETIME();
    EXEC [dbo].[${procedure}] ${values.join(', ')},
      @actorId = ${n(authority.actorId)}, @sessionId = ${n(authority.sessionId)},
      @stepUpGrantId = ${n(authority.stepUpGrantId)}, @at = @at;
  `);
}

live('Phase 19 Search after a real restore', () => {
  let source: DisposableDatabase;
  let master: SqlSession;
  let sourceSession: SqlSession | undefined;
  let restored: SqlSession | undefined;
  let restoreDatabase: string;
  let target: BackupTarget;
  let fixture: Phase19Fixture;
  let h: SearchHarness;

  const second = {
    collectionId: randomUUID(),
    slug: `fixture-collection-y-${randomUUID().slice(0, 8)}`,
    bookId: randomUUID(),
    recordId: randomUUID(),
    citationId: randomUUID(),
  };

  async function find(q: string, locale: 'en' | 'ar') {
    const outcome = await h.search.search({ q, type: 'hadith' }, { locale });
    if (outcome.state !== 'results') throw new Error(`Search answered ${outcome.state}.`);
    return outcome.results;
  }

  async function documentsOf(citationId: string): Promise<string[]> {
    const rows = await (restored as SqlSession).query<{
      textLanguage: string;
      contentLanguage: string;
    }>(
      `SELECT [textLanguage],[contentLanguage] FROM [dbo].[SearchDocument]
        WHERE [scopeKind] = N'hadith' AND [scopeId] = ${n(citationId)} ORDER BY [textLanguage];`,
    );
    return rows.map((row) => `${row.textLanguage}/${row.contentLanguage}`);
  }

  /**
   * Reconciles, and answers how many Hadith scopes it found wrong — by what it
   * REQUESTED for the `hadith` kind. The summary's own counts span every kind,
   * and this proof's raw Person and Topic rows (which project nothing) are
   * reported missing on every pass; they are not Hadith's to converge.
   */
  async function reconcileHadith() {
    const owed = async () => {
      const [row] = await (restored as SqlSession).query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM [dbo].[SearchIndexRequest] WHERE [scopeKind] = N'hadith';`,
      );
      return Number(row?.total ?? -1);
    };
    const before = await owed();
    const summary = await h.search.reconcile();
    return { summary, requested: (await owed()) - before };
  }

  async function hadithDocuments(): Promise<number> {
    const [row] = await (restored as SqlSession).query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM [dbo].[SearchDocument] WHERE [kind] = N'hadith';`,
    );
    return Number(row?.total ?? -1);
  }

  beforeAll(async () => {
    source = await createProofDatabase();

    fixture = newPhase19Fixture();
    const translator = await person(
      source.admin,
      `fixture-translator-${fixture.runId.slice(0, 8)}`,
    );
    await writePhase19Fixture(source.admin, fixture, {
      actorId: await createProofAccount(source.admin),
      personId: translator,
      topicId: await topic(
        source.admin,
        `non-hadith-fixture-topic-${fixture.runId.slice(0, 8)}`,
      ),
    });

    // A second collection, through the canonical procedures themselves: one
    // record, verified, mapped to a public citation, with a published
    // translation, in the same fixture-mode section.
    const editor = await canonicalEditor(source.admin);
    await exec(source.admin, 'HadithCreateCollection', editor, {
      id: second.collectionId,
      slug: second.slug,
      position: 1,
    });
    const editionId = await registerEdition(source.admin, {
      collectionId: second.collectionId,
      sourceSystemId: fixture.sourceAId,
      code: 'NON_HADITH_FIXTURE_EDITION_Y',
    });
    await exec(source.admin, 'HadithCreateBook', editor, {
      id: second.bookId,
      editionId,
      slug: 'fixture-book-y',
      reference: sentinel('REFERENCE', 40),
      position: 1,
      title: null,
      titleLanguage: null,
    });
    await exec(source.admin, 'HadithWriteRecord', editor, {
      hadithId: second.recordId,
      editionId,
      expectedVersion: 0,
      sourceReference: sentinel('REFERENCE', 41),
      citationNumber: 1,
      bookId: second.bookId,
      chapterId: null,
      text: ORIGINAL,
      textLanguage: 'ar',
      chain: `${sentinel('CHAIN', 40)} ${NEUTRAL}`,
      chainLanguage: 'ar',
      gradings: '[]',
      evidence: sentinel('EVIDENCE', 40),
      reason: null,
    });
    await exec(source.admin, 'HadithVerifyRecord', editor, {
      id: randomUUID(),
      hadithId: second.recordId,
      expectedVersion: 1,
      evidence: sentinel('EVIDENCE', 41),
    });
    await exec(source.admin, 'HadithSetCitation', editor, {
      id: second.citationId,
      collectionId: second.collectionId,
      number: 1,
      hadithId: second.recordId,
      state: 'mapped',
      expectedVersion: 0,
      evidence: sentinel('EVIDENCE', 42),
      reason: null,
    });
    await source.admin.query(`
      INSERT INTO [dbo].[HadithTranslation] ([id],[hadithId],[languageCode],[text],[attribution],[sourceSystemId],[state],[version],[updatedAt],[publishedAt])
      VALUES (${n(randomUUID())}, ${n(second.recordId)}, N'en', ${n(TRANSLATION)}, NULL, ${n(fixture.sourceAId)},
              N'published', 1, SYSUTCDATETIME(), SYSUTCDATETIME());
    `);
    await activate(source.admin, second.collectionId, 'fixture');

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

  it('restores the activations, the conflict evidence and the search intent still owed', async () => {
    const [row] = await (restored as SqlSession).query<{
      activations: number;
      conflicts: number;
      owedFixture: number;
      owedSecond: number;
    }>(
      `SELECT (SELECT COUNT(*) FROM [dbo].[HadithActivation]) AS activations,
              (SELECT COUNT(*) FROM [dbo].[HadithConflict] WHERE [collectionId] = ${n(fixture.collectionId)}) AS conflicts,
              (SELECT COUNT(*) FROM [dbo].[SearchIndexRequest] WHERE [scopeKind] = N'hadith' AND [scopeId] = ${n(fixture.citationId)}) AS owedFixture,
              (SELECT COUNT(*) FROM [dbo].[SearchIndexRequest] WHERE [scopeKind] = N'hadith' AND [scopeId] = ${n(second.citationId)}) AS owedSecond;`,
    );
    expect(Number(row?.activations)).toBe(2);
    expect(Number(row?.conflicts)).toBe(1);
    expect(Number(row?.owedFixture)).toBe(1);
    // The mapping owed the new citation its projection (the verification came
    // first, when no citation named the record yet).
    expect(Number(row?.owedSecond)).toBe(1);
    expect(await h.readers.hadith.availability()).toEqual({
      active: true,
      mode: 'fixture',
    });
  });

  it('rebuilds from the restored owner: the public citation once, the conflicted one not at all', async () => {
    await h.search.rebuild();
    await h.indexNow();

    expect(await documentsOf(second.citationId)).toEqual(['ar/ar', 'en/en']);
    expect(await documentsOf(fixture.citationId)).toEqual([]);
    expect(await hadithDocuments()).toBe(2);

    for (const [word, locale, textLanguage] of [
      [WORD.original, 'ar', 'ar'],
      [WORD.translation, 'en', 'en'],
    ] as const) {
      const found = await find(word, locale);
      expect(found.withheld).toBe(0);
      expect(found.hits).toHaveLength(1);
      expect(found.hits[0]).toMatchObject({
        kind: 'hadith',
        resourceId: second.citationId,
        href: `/hadith/${second.slug}/1`,
        title: `${second.slug} 1`,
        textLanguage,
      });
    }
    expect((await find(WORD.original, 'ar')).hits[0]?.summary).toBe(ORIGINAL);

    // The neutral phrase is in BOTH collections' originals; only the public
    // citation answers, and nothing was indexed to withhold.
    const phrase = await find(NEUTRAL.split(' ')[1]!, 'ar');
    expect(phrase.withheld).toBe(0);
    expect(phrase.hits.map((hit) => hit.resourceId)).toEqual([second.citationId]);
  });

  it('reconciles over the restored owner to convergence, and repairs a deactivation and a re-activation', async () => {
    const converged = await reconcileHadith();
    expect(converged.requested).toBe(0);
    expect(converged.summary).toMatchObject({ stale: 0, orphaned: 0 });

    await (restored as SqlSession).query(
      `DELETE FROM [dbo].[HadithActivation] WHERE [collectionId] = ${n(second.collectionId)};`,
    );
    const stale = await find(WORD.original, 'ar');
    expect(stale.hits).toEqual([]);
    expect(stale.withheld).toBe(1);
    const orphaned = await reconcileHadith();
    expect(orphaned.summary.orphaned).toBe(1);
    expect(orphaned.requested).toBe(1);
    await h.indexNow();
    expect(await hadithDocuments()).toBe(0);

    await activate(restored as SqlSession, second.collectionId, 'fixture');
    const missing = await reconcileHadith();
    expect(missing.requested).toBe(1);
    await h.indexNow();
    expect(await documentsOf(second.citationId)).toEqual(['ar/ar', 'en/en']);
    expect(
      (await find(WORD.translation, 'en')).hits.map((hit) => hit.resourceId),
    ).toEqual([second.citationId]);
    const settled = await reconcileHadith();
    expect(settled.requested).toBe(0);
    expect(settled.summary).toMatchObject({ stale: 0, orphaned: 0 });
    expect(h.reported).toEqual([]);
  });
});
