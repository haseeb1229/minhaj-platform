import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';
import { buildSearchHarness, type SearchHarness } from './harness.ts';

/**
 * Phase 9 — Research, ResearchPaper, Publication, Magazine, MagazineIssue and
 * Encyclopedia in the Search foundation, over REAL SQL Server Full-Text Search.
 *
 * WHAT IS PROVED, and only against the live engine: every Phase-9 kind is
 * projected by its owner's own mutation and found at its CURRENT canonical
 * address; the record's text is matched in its content language; the filters
 * combine; a withdrawn research paper, a withdrawn issue and a withdrawn
 * Magazine's issues are WITHHELD while the stale rows are still in the index and
 * then leave it; a rebuild restores the Phase-9 inventory from the owner alone;
 * reconciliation repairs what the index lost or kept.
 *
 * EVERYTHING IS SYNTHETIC. Titles say they are fixtures, the words are invented,
 * and no real research, periodical or religious text is used.
 *
 * Runs in the `Database foundation` CI job (`npm run test:search`), where a
 * skipped suite fails the job (`scripts/assert-search-proofs.mjs`).
 */

const live = databaseConfigured ? describe : describe.skip;

const slug = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;

const label = (title: string, summary = '') => ({
  locale: 'en' as const,
  title,
  summary,
});

function described(title: string, overrides: Record<string, unknown> = {}) {
  return {
    slug: slug('scholarly-proof'),
    primaryLocale: 'en',
    state: 'published',
    labels: [label(title)],
    contributors: [],
    topicIds: [],
    ...overrides,
  };
}

function dated(title: string, overrides: Record<string, unknown> = {}) {
  return described(title, {
    languageCode: 'en',
    publicationYear: null,
    publishedOn: null,
    document: null,
    ...overrides,
  });
}

const cited = { institutionalContext: null, abstract: null, citations: [] };

/** A record read back as the input that would save it unchanged. */
const READ_ONLY = new Set(['id', 'kind', 'version', 'updatedAt', 'magazine']);
function editable(record: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => !READ_ONLY.has(key)),
  );
}

live('Phase 9 scholarly and periodical records in Search (real SQL Server FTS)', () => {
  let db: DisposableDatabase;
  let h: SearchHarness;
  let librarian: { accountId: string };
  let educationTopic: string;

  let research: { id: string; slug: string; version: number };
  let paper: { id: string; version: number };
  let publication: { id: string };
  let encyclopedia: { id: string; version: number };
  let magazine: { id: string; slug: string; version: number };
  let issue: { id: string; slug: string; version: number };
  let draftIssue: { id: string };

  async function find(q: string, extra: Record<string, string> = {}) {
    const outcome = await h.search.search({ q, ...extra }, { locale: 'en' });
    if (outcome.state !== 'results') {
      throw new Error(`Expected results for a proof query, got ${outcome.state}.`);
    }
    return outcome.results;
  }

  async function kinds(q: string, extra: Record<string, string> = {}) {
    return (await find(q, extra)).hits.map((hit) => hit.kind).sort();
  }

  async function documentsOf(kind: string, id: string): Promise<number> {
    const [row] = await db.admin.query<{ documents: number }>(
      `SELECT COUNT(*) AS documents FROM [dbo].[SearchDocument] WHERE [scopeKind] = N'${kind}' AND [scopeId] = N'${id}';`,
    );
    return Number(row?.documents ?? 0);
  }

  beforeAll(async () => {
    db = await createProofDatabase();
    h = await buildSearchHarness(db.admin);
    librarian = await h.account(['library.administer', 'library.read']);

    const [topic] = await db.admin.query<{ id: string }>(
      "SELECT [id] FROM [Topic] WHERE [slug] = N'education';",
    );
    if (topic === undefined) throw new Error('The canonical education topic is missing.');
    educationTopic = topic.id;

    const save = (
      kind: Parameters<SearchHarness['library']['saveScholarly']>[1],
      value: unknown,
    ) => h.library.saveScholarly(librarian, kind, null, null, value);

    const savedResearch = await save(
      'research',
      dated('Synthetic research on reading rooms zircalumfixture', {
        ...cited,
        abstract: 'The quillmarkfixture study describes a catalogue of reading rooms.',
        publicationYear: 2020,
        topicIds: [educationTopic],
      }),
    );
    research = savedResearch;

    // Labelled only in English, written in ARABIC: its own words are matched in
    // an Arabic document of their own.
    paper = await save(
      'research-paper',
      dated('Synthetic paper on catalogue indexing velmarfixture', {
        ...cited,
        languageCode: 'ar',
        abstract: 'دراسة تجريبية عن فهارس المكتبات العامة',
        venue: 'Synthetic Journal of Fixtures',
        doi: '10.1234/velmar.fixture',
        publishedOn: '2022-03-04',
        topicIds: [educationTopic],
      }),
    );

    publication = await save(
      'publication',
      dated('Synthetic booklet thornwickfixture', {
        publisher: null,
        publicationYear: 2018,
      }),
    );
    encyclopedia = await save(
      'encyclopedia',
      dated('Synthetic encyclopedia brambleisfixture', {
        publisher: null,
        document: {
          sections: [
            {
              key: 'opening',
              title: 'Opening',
              paragraphs: ['The larkspurfixture entry is synthetic.'],
            },
          ],
        },
      }),
    );

    const savedMagazine = await save(
      'magazine',
      described('Synthetic monthly ossianfixture', { topicIds: [educationTopic] }),
    );
    magazine = savedMagazine;
    const savedIssue = await save(
      'magazine-issue',
      dated('Synthetic spring issue', {
        magazineId: magazine.id,
        volume: 1,
        issueNumber: 2,
        publicationYear: 2021,
      }),
    );
    if (savedIssue.kind !== 'magazine-issue') throw new Error('unexpected kind');
    issue = savedIssue;
    draftIssue = await save(
      'magazine-issue',
      dated('Synthetic draft issue gorsefixture', {
        state: 'draft',
        magazineId: magazine.id,
        volume: 1,
        issueNumber: 3,
      }),
    );

    await h.indexNow();
  }, 600_000);

  afterAll(async () => {
    await db?.close();
  });

  it('commits each owner mutation’s search intent in the same transaction', async () => {
    const before = await db.admin.query<{ id: number }>(
      'SELECT [id] FROM [dbo].[SearchIndexRequest];',
    );
    expect(before).toEqual([]);

    const saved = await h.library.saveScholarly(
      librarian,
      'research',
      null,
      null,
      dated('Synthetic intent probe', { ...cited, state: 'draft' }),
    );
    const [row] = await db.admin.query<{ requests: number }>(
      `SELECT COUNT(*) AS requests FROM [dbo].[SearchIndexRequest] WHERE [scopeKind] = N'research' AND [scopeId] = N'${saved.id}';`,
    );
    expect(Number(row?.requests)).toBe(1);
    await h.indexNow();
    // A draft owes a projection request and projects nothing.
    expect(await documentsOf('research', saved.id)).toBe(0);
  });

  it('finds every Phase-9 kind, each at its current canonical address', async () => {
    const one = async (q: string) => {
      const hits = (await find(q)).hits;
      expect(hits).toHaveLength(1);
      return hits[0];
    };

    expect(await one('zircalumfixture')).toMatchObject({
      kind: 'research',
      href: `/library/research/${research.slug}`,
      year: 2020,
    });
    expect((await one('velmarfixture'))?.kind).toBe('research-paper');
    expect((await one('thornwickfixture'))?.href).toMatch(/^\/library\/publications\//u);
    expect((await one('brambleisfixture'))?.href).toMatch(/^\/library\/encyclopedias\//u);
    expect(await kinds('ossianfixture')).toEqual(['magazine', 'magazine-issue']);

    const hits = (await find('ossianfixture', { type: 'magazine-issue' })).hits;
    expect(hits.map((hit) => hit.href)).toEqual([
      `/library/magazines/${magazine.slug}/issues/${issue.slug}`,
    ]);
  });

  it('matches a record’s own words in its CONTENT language, whatever its labels', async () => {
    // The Arabic abstract is found by an Arabic query even though the paper has
    // only an English label; the English research's abstract by an English one.
    expect(await kinds('فهارس')).toEqual(['research-paper']);
    expect(await kinds('quillmarkfixture')).toEqual(['research']);
    // The encyclopedia's readable document is matched too.
    expect(await kinds('larkspurfixture')).toEqual(['encyclopedia']);
    // Every document of the paper carries its genuine content language.
    expect(await kinds('velmarfixture', { language: 'ar' })).toEqual(['research-paper']);
    expect(await kinds('velmarfixture', { language: 'en' })).toEqual([]);
  });

  it('combines the type, topic and year filters over Phase-9 kinds', async () => {
    const education = { topic: 'education' };
    expect(await kinds('synthetic', { ...education, type: 'research' })).toEqual([
      'research',
    ]);
    expect(
      await kinds('synthetic', {
        ...education,
        type: 'research-paper',
        from: '2022',
        to: '2022',
      }),
    ).toEqual(['research-paper']);
    expect(await kinds('synthetic', { type: 'research-paper', to: '2021' })).toEqual([]);
    expect(await kinds('ossianfixture', { ...education, type: 'magazine' })).toEqual([
      'magazine',
    ]);
  });

  it('never indexes a draft, whatever its Magazine is', async () => {
    expect(await kinds('gorsefixture')).toEqual([]);
    expect(await documentsOf('magazine-issue', draftIssue.id)).toBe(0);
  });

  it('addresses a renamed record at its CURRENT slug before any re-indexing', async () => {
    const current = await h.library.scholarlyRecord(librarian, 'research', research.id);
    if (current === null) throw new Error('fixture research missing');
    const renamed = slug('scholarly-renamed');
    const saved = await h.library.saveScholarly(
      librarian,
      'research',
      research.id,
      current.version,
      { ...editable(current), slug: renamed },
    );
    research = saved;

    // The index still holds the old projection; the address is resolved now.
    expect((await find('zircalumfixture')).hits[0]?.href).toBe(
      `/library/research/${renamed}`,
    );
    await h.indexNow();
  });

  describe('a stale index never discloses', () => {
    it('ResearchPaper: a withdrawn paper is withheld, then leaves the index', async () => {
      const current = await h.library.scholarlyRecord(
        librarian,
        'research-paper',
        paper.id,
      );
      if (current === null) throw new Error('fixture paper missing');
      paper = await h.library.saveScholarly(
        librarian,
        'research-paper',
        paper.id,
        current.version,
        { ...editable(current), state: 'archived' },
      );

      // The stale rows are still there — and nothing of them is returned.
      expect(await documentsOf('research-paper', paper.id)).toBeGreaterThan(0);
      const stale = await find('velmarfixture');
      expect(stale.hits).toEqual([]);
      expect(stale.withheld).toBeGreaterThanOrEqual(1);

      await h.indexNow();
      expect(await documentsOf('research-paper', paper.id)).toBe(0);
      expect((await find('velmarfixture')).withheld).toBe(0);
    });

    it('MagazineIssue: a withdrawn issue is withheld, then leaves the index', async () => {
      await db.admin.query(
        `UPDATE [dbo].[MagazineIssue] SET [state] = N'archived' WHERE [id] = N'${issue.id}';`,
      );
      // No owner mutation, so nothing asked to re-index: the ONLY protection
      // left is the query-time visibility recheck.
      expect(await documentsOf('magazine-issue', issue.id)).toBeGreaterThan(0);
      const stale = await find('ossianfixture', { type: 'magazine-issue' });
      expect(stale.hits).toEqual([]);
      expect(stale.withheld).toBe(1);

      const summary = await h.search.reconcile();
      expect(summary.orphaned).toBeGreaterThanOrEqual(1);
      await h.indexNow();
      expect(await documentsOf('magazine-issue', issue.id)).toBe(0);

      await db.admin.query(
        `UPDATE [dbo].[MagazineIssue] SET [state] = N'published', [version] = [version] + 1 WHERE [id] = N'${issue.id}';`,
      );
      await h.search.reconcile();
      await h.indexNow();
      expect(await kinds('ossianfixture')).toEqual(['magazine', 'magazine-issue']);
    });

    it('Magazine: withdrawing a periodical withholds and removes its issues too', async () => {
      const current = await h.library.scholarlyRecord(librarian, 'magazine', magazine.id);
      if (current === null) throw new Error('fixture magazine missing');
      await h.library.saveScholarly(librarian, 'magazine', magazine.id, current.version, {
        ...editable(current),
        state: 'archived',
      });

      // The Magazine's save requested every issue in the same transaction.
      const [requested] = await db.admin.query<{ requests: number }>(
        `SELECT COUNT(*) AS requests FROM [dbo].[SearchIndexRequest] WHERE [scopeKind] = N'magazine-issue' AND [scopeId] IN (N'${issue.id}', N'${draftIssue.id}');`,
      );
      expect(Number(requested?.requests)).toBe(2);

      const stale = await find('ossianfixture');
      expect(stale.hits).toEqual([]);
      expect(stale.withheld).toBe(2);

      await h.indexNow();
      expect(await documentsOf('magazine', magazine.id)).toBe(0);
      expect(await documentsOf('magazine-issue', issue.id)).toBe(0);

      const archived = await h.library.scholarlyRecord(
        librarian,
        'magazine',
        magazine.id,
      );
      if (archived === null) throw new Error('fixture magazine missing');
      await h.library.saveScholarly(
        librarian,
        'magazine',
        magazine.id,
        archived.version,
        {
          ...editable(archived),
          state: 'published',
        },
      );
      await h.indexNow();
      expect(await kinds('ossianfixture')).toEqual(['magazine', 'magazine-issue']);
    });
  });

  describe('rebuild and reconciliation', () => {
    it('rebuilds the Phase-9 inventory from the owner alone, starting from empty', async () => {
      await db.admin.query(
        `DELETE FROM [dbo].[SearchDocumentTopic]; DELETE FROM [dbo].[SearchDocument];
         DELETE FROM [dbo].[SearchIndexScope]; DELETE FROM [dbo].[SearchIndexRequest];`,
      );
      await h.engineSettled();
      expect(await kinds('ossianfixture')).toEqual([]);

      await h.search.rebuild();
      await h.indexNow();

      const [inventory] = await db.admin.query<{ kinds: string }>(
        `SELECT STRING_AGG([kind], N',') WITHIN GROUP (ORDER BY [kind]) AS kinds
           FROM (SELECT DISTINCT [kind] FROM [dbo].[SearchDocument]) k;`,
      );
      // The withdrawn paper stays out; the draft issue never enters.
      expect(inventory?.kinds).toBe(
        'encyclopedia,magazine,magazine-issue,publication,research,topic',
      );
      expect(await kinds('velmarfixture')).toEqual([]);
      expect(await kinds('gorsefixture')).toEqual([]);
      expect(await kinds('zircalumfixture')).toEqual(['research']);
    });

    it('reconciles missing, stale and orphaned Phase-9 projections', async () => {
      // MISSING: the index lost a publication without being told.
      await db.admin.query(
        `DELETE FROM [dbo].[SearchDocument] WHERE [scopeKind] = N'publication' AND [scopeId] = N'${publication.id}';`,
      );
      // STALE: an encyclopedia's label changed with no request (as a restore might).
      await db.admin.query(
        `UPDATE [dbo].[EncyclopediaLabel] SET [title] = N'Synthetic encyclopedia quartzfernfixture' WHERE [encyclopediaId] = N'${encyclopedia.id}';
         UPDATE [dbo].[Encyclopedia] SET [version] = [version] + 1 WHERE [id] = N'${encyclopedia.id}';`,
      );
      // ORPHAN: the owner withdrew the research with no request.
      await db.admin.query(
        `UPDATE [dbo].[Research] SET [state] = N'archived' WHERE [id] = N'${research.id}';`,
      );

      const summary = await h.search.reconcile();
      expect(summary.missing).toBeGreaterThanOrEqual(1);
      expect(summary.stale).toBeGreaterThanOrEqual(1);
      expect(summary.orphaned).toBeGreaterThanOrEqual(1);

      await h.indexNow();
      expect(await kinds('thornwickfixture')).toEqual(['publication']);
      expect(await kinds('quartzfernfixture')).toEqual(['encyclopedia']);
      expect(await documentsOf('research', research.id)).toBe(0);
    });
  });
});
