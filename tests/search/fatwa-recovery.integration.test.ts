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
  newPhase20Fixture,
  writePhase20Fixture,
  type Phase20Fixture,
} from '../../packages/database/src/lifecycle/phase20-fixture.ts';
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
import { grantFor, n, sessionFor } from '../fatwa/fixture-sql.ts';
import { buildSearchHarness, type SearchHarness } from './harness.ts';

/**
 * Phase 20 — after a REAL backup and restore, Search rebuilds the Fatwa
 * inventory from the RESTORED Fatwa owner and returns only what is public.
 *
 * The search projection is derived and is never restored as truth
 * (ARCHITECTURE.md §8.5): a restore brings back the activation, the private
 * questions, the rulings' immutable revisions and publications, the review
 * decisions, the withdrawals and the durable intent still owed, and the index
 * is rebuilt from them. So the claim proved here is that the rows that came
 * back are ENOUGH for Search to answer correctly:
 *
 *   - the recovery fixture's ruling (`packages/database/src/lifecycle/
 *     phase20-fixture.ts`) — first published, a correction returned with a
 *     private note, the revised correction published — answers ONCE, at
 *     `/fatwa/{slug}`, with its CURRENT revision only, and its intent still
 *     owed drives that projection;
 *   - a ruling published and then WITHDRAWN, and one still UNDER REVIEW, both
 *     written before the backup through the REAL workflow procedures, are
 *     never results — and no private question, return note or draft is ever
 *     searchable;
 *   - a second public ruling, published through the same procedures, answers
 *     once by its own words;
 *   - reconciliation over the restored owner converges — nothing missing,
 *     stale or orphaned — and repairs a projection the index lost.
 *
 * NOTHING HERE IS A RULING OR A REAL QUESTION: every text is a
 * `NON_FATWA_FIXTURE_…` sentinel followed by invented Latin words.
 *
 * THE ONLY DATABASE THE APPLICATION CLIENT EVER OPENS HERE IS THE RESTORE,
 * positively proved to be a disposable restore target before anything binds to
 * it. Every resource created is removed and its absence verified.
 */

const live = databaseConfigured ? describe : describe.skip;

const WORD = {
  published: 'harbourwickfixture',
  withdrawn: 'quaymarshfixture',
  pending: 'tidecombefixture',
  privateQuestion: 'saltlintonfixture',
} as const;

/** The private questions' sentinel prefixes: the fixture's and this file's. */
const PRIVATE_SENTINELS = [
  'NON_FATWA_FIXTURE_QUESTION_',
  'NON_FATWA_FIXTURE_PRIVATE_QUESTION',
] as const;

const privateQuestion = (index: number) =>
  `NON_FATWA_FIXTURE_PRIVATE_QUESTION_${String(index)} ${WORD.privateQuestion} anonymised`;

const revisionTexts = (index: number, word: string) => ({
  title: `NON_FATWA_FIXTURE_TITLE_${String(index)} ${word}`,
  publicQuestion: `NON_FATWA_FIXTURE_PUBLIC_QUESTION_${String(index)} ${word}`,
  ruling: `NON_FATWA_FIXTURE_RULING_${String(index)} ${word}`,
});

/** One workflow procedure, executed by the owner with every value a literal of this file's. */
async function exec(
  admin: SqlSession,
  procedure: string,
  parameters: Readonly<Record<string, string | number | null>>,
): Promise<void> {
  const values = Object.entries(parameters).map(
    ([name, value]) =>
      `@${name} = ${value === null ? 'NULL' : typeof value === 'number' ? String(value) : n(value)}`,
  );
  await admin.query(`
    DECLARE @at DATETIME2 = SYSUTCDATETIME();
    EXEC [dbo].[${procedure}] ${values.join(', ')}, @at = @at;
  `);
}

live('Phase 20 Search after a real restore', () => {
  let source: DisposableDatabase;
  let master: SqlSession;
  let sourceSession: SqlSession | undefined;
  let restored: SqlSession | undefined;
  let restoreDatabase: string;
  let target: BackupTarget;
  let fixture: Phase20Fixture;
  let fixtureSlug: string;
  let h: SearchHarness;

  /** Rulings written through the real procedures before the backup. */
  const extra = {
    published: { fatwaId: randomUUID(), slug: 'fixture-recovery-ruling-published' },
    withdrawn: { fatwaId: randomUUID(), slug: 'fixture-recovery-ruling-withdrawn' },
    pending: { fatwaId: randomUUID(), slug: 'fixture-recovery-ruling-pending' },
  };

  async function find(q: string) {
    const outcome = await h.search.search({ q, type: 'fatwa' }, { locale: 'en' });
    if (outcome.state !== 'results') throw new Error(`Search answered ${outcome.state}.`);
    return outcome.results;
  }

  async function documentsOf(fatwaId: string): Promise<string[]> {
    const rows = await (restored as SqlSession).query<{
      textLanguage: string;
      contentLanguage: string;
    }>(
      `SELECT [textLanguage],[contentLanguage] FROM [dbo].[SearchDocument]
        WHERE [scopeKind] = N'fatwa' AND [scopeId] = ${n(fatwaId)} ORDER BY [textLanguage];`,
    );
    return rows.map((row) => `${row.textLanguage}/${row.contentLanguage}`);
  }

  async function fatwaDocuments(): Promise<number> {
    const [row] = await (restored as SqlSession).query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM [dbo].[SearchDocument] WHERE [kind] = N'fatwa';`,
    );
    return Number(row?.total ?? -1);
  }

  async function owed(): Promise<number> {
    const [row] = await (restored as SqlSession).query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM [dbo].[SearchIndexRequest] WHERE [scopeKind] = N'fatwa';`,
    );
    return Number(row?.total ?? -1);
  }

  /** How many indexed documents hold `text` anywhere in their stored or matching text. */
  async function indexedWith(text: string): Promise<number> {
    const [row] = await (restored as SqlSession).query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM [dbo].[SearchDocument]
        WHERE CHARINDEX(${n(text.toLowerCase())}, LOWER(CONCAT([title], [summary], [matchEnglish], [matchArabic], [matchUrdu], [matchOther]))) > 0;`,
    );
    return Number(row?.total ?? -1);
  }

  /**
   * Reconciles, and answers how many Fatwa scopes it found wrong — by what it
   * REQUESTED for the `fatwa` kind, so another kind's drift is not counted as
   * Fatwa's.
   */
  async function reconcileFatwa() {
    const before = await owed();
    const summary = await h.search.reconcile();
    return { summary, requested: (await owed()) - before };
  }

  /** What only the restored owner can answer, read the way every public read is. */
  async function answersOnly(): Promise<void> {
    expect(await documentsOf(fixture.fatwaId)).toEqual(['en/en']);
    expect(await documentsOf(extra.published.fatwaId)).toEqual(['en/en']);
    expect(await documentsOf(extra.withdrawn.fatwaId)).toEqual([]);
    expect(await documentsOf(extra.pending.fatwaId)).toEqual([]);
    expect(await fatwaDocuments()).toBe(2);

    // The fixture ruling's CURRENT revision — the third, published as the
    // correction — and none of the earlier two.
    const [document] = await (restored as SqlSession).query<{
      title: string;
      summary: string;
    }>(
      `SELECT [title],[summary] FROM [dbo].[SearchDocument]
        WHERE [scopeKind] = N'fatwa' AND [scopeId] = ${n(fixture.fatwaId)};`,
    );
    expect(document).toEqual({
      title: 'NON_FATWA_FIXTURE title 3',
      summary: 'NON_FATWA_FIXTURE_PUBLIC_QUESTION anonymised statement',
    });
    expect(await indexedWith('NON_FATWA_FIXTURE_RULING_3 ')).toBe(1);
    expect(await indexedWith('NON_FATWA_FIXTURE_RULING_1 ')).toBe(0);
    expect(await indexedWith('NON_FATWA_FIXTURE_RULING_2 ')).toBe(0);
    for (const text of [
      ...PRIVATE_SENTINELS,
      'NON_FATWA_FIXTURE_NOTE',
      WORD.privateQuestion,
      WORD.withdrawn,
      WORD.pending,
    ])
      expect(await indexedWith(text), text).toBe(0);

    // "anonymised" is in the fixture's public question — and in this file's
    // private questions, which add nothing.
    const once = await find('anonymised');
    expect(once.withheld).toBe(0);
    expect(once.hits).toHaveLength(1);
    expect(once.hits[0]).toMatchObject({
      kind: 'fatwa',
      resourceId: fixture.fatwaId,
      href: `/fatwa/${fixtureSlug}`,
      title: 'NON_FATWA_FIXTURE title 3',
      textLanguage: 'en',
    });

    const published = await find(WORD.published);
    expect(published.withheld).toBe(0);
    expect(published.hits.map((hit) => [hit.resourceId, hit.href])).toEqual([
      [extra.published.fatwaId, `/fatwa/${extra.published.slug}`],
    ]);

    // "private" is only in the questions and the return note.
    for (const word of ['private', WORD.privateQuestion, WORD.withdrawn, WORD.pending]) {
      const results = await find(word);
      expect(results.hits, word).toEqual([]);
      expect(results.withheld, word).toBe(0);
    }
  }

  beforeAll(async () => {
    source = await createProofDatabase();

    const [education] = await source.admin.query<{ id: string }>(
      "SELECT [id] FROM [dbo].[Topic] WHERE [slug] = N'education';",
    );
    if (education === undefined)
      throw new Error('The canonical education topic is missing.');
    fixture = newPhase20Fixture();
    fixtureSlug = `fixture-ruling-${fixture.runId.slice(0, 16)}`;
    await writePhase20Fixture(source.admin, fixture, { topicId: education.id });

    // Three more rulings through the workflow procedures themselves, by the
    // fixture's own triager, answerer and publisher — the publisher with a
    // fresh session and `fatwa-publication` grant.
    const sessionId = await sessionFor(source.admin, fixture.publisherId);
    const authority = {
      actorId: fixture.publisherId,
      sessionId,
      stepUpGrantId: await grantFor(
        source.admin,
        fixture.publisherId,
        sessionId,
        'fatwa-publication',
        60,
      ),
    };
    const asker = await createProofAccount(source.admin);
    const draft = async (
      ruling: { fatwaId: string; slug: string },
      index: number,
      word: string,
    ): Promise<string> => {
      const questionId = randomUUID();
      await exec(source.admin, 'FatwaSubmitQuestion', {
        id: questionId,
        askerId: asker,
        body: privateQuestion(index),
      });
      await exec(source.admin, 'FatwaTriageQuestion', {
        id: questionId,
        expectedVersion: 1,
        categoryId: fixture.categoryId,
        actorId: fixture.triagerId,
      });
      await exec(source.admin, 'FatwaAssignQuestion', {
        id: questionId,
        expectedVersion: 2,
        assigneeId: fixture.answererId,
        actorId: fixture.triagerId,
      });
      const revisionId = randomUUID();
      await exec(source.admin, 'FatwaSaveDraft', {
        fatwaId: ruling.fatwaId,
        questionId,
        expectedVersion: 0,
        revisionId,
        slug: ruling.slug,
        ...revisionTexts(index, word),
        language: 'en',
        categoryId: fixture.categoryId,
        topicIds: '[]',
        correctionReason: null,
        actorId: fixture.answererId,
      });
      await exec(source.admin, 'FatwaSubmitForReview', {
        fatwaId: ruling.fatwaId,
        expectedVersion: 2,
        revisionId,
        actorId: fixture.answererId,
      });
      return revisionId;
    };
    const publish = async (fatwaId: string, revisionId: string) =>
      exec(source.admin, 'FatwaPublishRevision', {
        fatwaId,
        expectedVersion: 3,
        revisionId,
        publicationId: randomUUID(),
        ...authority,
      });

    await publish(
      extra.published.fatwaId,
      await draft(extra.published, 41, WORD.published),
    );
    await publish(
      extra.withdrawn.fatwaId,
      await draft(extra.withdrawn, 42, WORD.withdrawn),
    );
    await exec(source.admin, 'FatwaWithdraw', {
      fatwaId: extra.withdrawn.fatwaId,
      expectedVersion: 4,
      decisionId: randomUUID(),
      reason: 'NON_FATWA_FIXTURE_REASON withdrawal proof',
      ...authority,
    });
    await draft(extra.pending, 43, WORD.pending);

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

  it('restores the activation, the withdrawal and the search intents still owed', async () => {
    const [row] = await (restored as SqlSession).query<{
      activations: number;
      owedFixture: number;
      owedPublished: number;
      owedWithdrawn: number;
      owedPending: number;
      withdrawn: number;
      inReview: number;
    }>(
      `SELECT (SELECT COUNT(*) FROM [dbo].[FatwaActivation] WHERE [authority] = N'fixture') AS activations,
              (SELECT COUNT(*) FROM [dbo].[SearchIndexRequest] WHERE [scopeKind] = N'fatwa' AND [scopeId] = ${n(fixture.fatwaId)}) AS owedFixture,
              (SELECT COUNT(*) FROM [dbo].[SearchIndexRequest] WHERE [scopeKind] = N'fatwa' AND [scopeId] = ${n(extra.published.fatwaId)}) AS owedPublished,
              (SELECT COUNT(*) FROM [dbo].[SearchIndexRequest] WHERE [scopeKind] = N'fatwa' AND [scopeId] = ${n(extra.withdrawn.fatwaId)}) AS owedWithdrawn,
              (SELECT COUNT(*) FROM [dbo].[SearchIndexRequest] WHERE [scopeKind] = N'fatwa' AND [scopeId] = ${n(extra.pending.fatwaId)}) AS owedPending,
              (SELECT COUNT(*) FROM [dbo].[Fatwa] WHERE [id] = ${n(extra.withdrawn.fatwaId)} AND [withdrawnAt] IS NOT NULL) AS withdrawn,
              (SELECT COUNT(*) FROM [dbo].[Fatwa] WHERE [id] = ${n(extra.pending.fatwaId)} AND [reviewState] = N'in_review' AND [publishedRevisionId] IS NULL) AS inReview;`,
    );
    expect(row).toEqual({
      activations: 1,
      owedFixture: 1,
      owedPublished: 1,
      // Its publication and its withdrawal each owed a pass.
      owedWithdrawn: 2,
      // Drafting and review owe Search nothing.
      owedPending: 0,
      withdrawn: 1,
      inReview: 1,
    });
    expect(await h.readers.fatwa.availability()).toEqual({
      active: true,
      mode: 'fixture',
    });
    expect(await fatwaDocuments()).toBe(0);
  });

  it('projects the current published revisions from the restored owed intents, and nothing else', async () => {
    await h.indexNow();
    expect(await owed()).toBe(0);
    await answersOnly();
  });

  it('rebuilds the same answer from the restored owner alone, starting from empty', async () => {
    await (restored as SqlSession).query(
      `DELETE FROM [dbo].[SearchDocumentTopic]; DELETE FROM [dbo].[SearchDocument];
       DELETE FROM [dbo].[SearchIndexScope]; DELETE FROM [dbo].[SearchIndexRequest];`,
    );
    await h.engineSettled();
    expect(await fatwaDocuments()).toBe(0);
    expect((await find('anonymised')).hits).toEqual([]);

    await h.search.rebuild();
    await h.indexNow();
    await answersOnly();
  });

  it('reconciles over the restored owner to convergence, and repairs a lost projection', async () => {
    const converged = await reconcileFatwa();
    expect(converged.requested).toBe(0);
    expect(converged.summary).toMatchObject({ missing: 0, stale: 0, orphaned: 0 });

    await (restored as SqlSession).query(
      `DELETE FROM [dbo].[SearchDocument] WHERE [scopeKind] = N'fatwa' AND [scopeId] = ${n(fixture.fatwaId)};`,
    );
    await h.engineSettled();
    expect((await find('anonymised')).hits).toEqual([]);

    const missing = await reconcileFatwa();
    expect(missing.summary.missing).toBe(1);
    expect(missing.requested).toBe(1);
    await h.indexNow();
    await answersOnly();

    const settled = await reconcileFatwa();
    expect(settled.requested).toBe(0);
    expect(settled.summary).toMatchObject({ missing: 0, stale: 0, orphaned: 0 });
    expect(h.reported).toEqual([]);
  });
});
