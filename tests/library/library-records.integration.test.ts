import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';
import {
  newPhase5Fixture,
  writePhase5Fixture,
  type Phase5Fixture,
} from '../../packages/database/src/lifecycle/phase5-fixture.ts';
import { createLibraryReadService } from '../../apps/web/src/contexts/library/index.ts';

/**
 * Library Part 3 against real SQL Server — the whole Library's written works
 * and periodicals:
 *
 *   - the research read with `scope: 'library'`: every PUBLISHED Research and
 *     ResearchPaper record (on any Topic or none), the Topic a filter with a
 *     facet of its own, a listing's figures those of its one kind, and the
 *     hubs' `scope: 'topic'` untouched beside it;
 *   - the published-records read: one aggregate's public Publications or
 *     Encyclopedias, every filter, the three orders, pages with their total,
 *     the section count of the readable text (never the text), and facets
 *     each without its own filter;
 *   - a Magazine's issues: one view (all, a year, the undated ones) with its
 *     total, its year index, and never an issue of a draft Magazine or a
 *     draft issue;
 *   - the periodicals directory: issue counts, year spans and the newest
 *     issue of each Magazine, the figures and the Topic facet.
 *
 * Synthetic records only, written as rows.
 */

const live = databaseConfigured ? describe : describe.skip;

const n = (value: string | null) =>
  value === null ? 'NULL' : `N'${value.replaceAll("'", "''")}'`;

live('Library Part 3 — written works and periodicals against real SQL Server', () => {
  let db: DisposableDatabase;
  let people: Phase5Fixture;
  let reads: ReturnType<typeof createLibraryReadService>;
  let quranTopic: string;
  let hadithTopic: string;
  const run = randomUUID().slice(0, 8);
  const id = {
    study: randomUUID(),
    loose: randomUUID(),
    draftStudy: randomUUID(),
    paper: randomUUID(),
    booklet: randomUUID(),
    report: randomUUID(),
    pamphlet: randomUUID(),
    draftBooklet: randomUUID(),
    encyclopedia: randomUUID(),
    monthly: randomUUID(),
    quarterly: randomUUID(),
    hidden: randomUUID(),
    m2021a: randomUUID(),
    m2021b: randomUUID(),
    m2019: randomUUID(),
    mUndated: randomUUID(),
    mDraft: randomUUID(),
    qUndated: randomUUID(),
    hiddenIssue: randomUUID(),
  };
  const sections = (count: number) =>
    JSON.stringify({
      sections: Array.from({ length: count }, (_, index) => ({
        key: `s${String(index)}`,
        title: `Synthetic section ${String(index)}`,
        paragraphs: ['Synthetic.'],
      })),
    });

  const ids = (page: { items: readonly { id: string }[] }) =>
    page.items.map((item) => item.id.toLowerCase());

  beforeAll(async () => {
    db = await createProofDatabase();
    const { createLibraryPublicReader } =
      await import('../../packages/database/src/index.ts');
    people = newPhase5Fixture();
    await writePhase5Fixture(db.admin, people);
    reads = createLibraryReadService(createLibraryPublicReader());

    const [quran] = await db.admin.query<{ id: string }>(
      `SELECT [id] FROM [dbo].[Topic] WHERE [slug] = N'quran';`,
    );
    const [hadith] = await db.admin.query<{ id: string }>(
      `SELECT [id] FROM [dbo].[Topic] WHERE [slug] = N'hadith';`,
    );
    if (quran === undefined || hadith === undefined)
      throw new Error('The seeded Topics are missing.');
    quranTopic = quran.id;
    hadithTopic = hadith.id;

    const published = (
      table: 'Publication' | 'Encyclopedia',
      key: keyof typeof id,
      fields: {
        readonly state?: string;
        readonly language: string;
        readonly year: number | null;
        readonly publisher?: string;
        readonly sections?: number;
      },
    ) => {
      const fk = table === 'Publication' ? 'publicationId' : 'encyclopediaId';
      return `
      INSERT INTO [dbo].[${table}] ([id],[slug],[primaryLocale],[languageCode],[state],[publicationYear],[publisher],[document]) VALUES
        (N'${id[key]}', N'p3-${key}-${run}', N'en', N'${fields.language}', N'${fields.state ?? 'published'}',
         ${fields.year === null ? 'NULL' : String(fields.year)}, ${n(fields.publisher ?? null)},
         ${fields.sections === undefined ? 'NULL' : n(sections(fields.sections))});
      INSERT INTO [dbo].[${table}Label] ([${fk}],[locale],[title],[summary]) VALUES
        (N'${id[key]}', N'en', N'P3 ${key} ${run}', N'');`;
    };
    const issue = (
      key: keyof typeof id,
      magazine: keyof typeof id,
      fields: {
        readonly year: number | null;
        readonly state?: string;
        readonly text?: boolean;
      },
    ) => `
      INSERT INTO [dbo].[MagazineIssue] ([id],[magazineId],[slug],[primaryLocale],[languageCode],[state],[publicationYear],[document]) VALUES
        (N'${id[key]}', N'${id[magazine]}', N'p3-${key}-${run}', N'en', N'ur', N'${fields.state ?? 'published'}',
         ${fields.year === null ? 'NULL' : String(fields.year)}, ${fields.text === true ? n(sections(1)) : 'NULL'});
      INSERT INTO [dbo].[MagazineIssueLabel] ([magazineIssueId],[locale],[title],[summary]) VALUES
        (N'${id[key]}', N'en', N'P3 ${key} ${run}', N'');`;

    await db.admin.query(`
      INSERT INTO [dbo].[Research] ([id],[slug],[primaryLocale],[languageCode],[state],[publicationYear],[document]) VALUES
        (N'${id.study}', N'p3-study-${run}', N'en', N'en', N'published', 2010, ${n(sections(2))}),
        (N'${id.loose}', N'p3-loose-${run}', N'en', N'ur', N'published', NULL, NULL),
        (N'${id.draftStudy}', N'p3-draft-study-${run}', N'en', N'en', N'draft', 2011, NULL);
      INSERT INTO [dbo].[ResearchLabel] ([researchId],[locale],[title],[summary]) VALUES
        (N'${id.study}', N'en', N'P3 study ${run}', N''),
        (N'${id.loose}', N'en', N'P3 loose ${run}', N''),
        (N'${id.draftStudy}', N'en', N'P3 draft study ${run}', N'');
      INSERT INTO [dbo].[ResearchTopic] ([researchId],[topicId]) VALUES (N'${id.study}', N'${quran.id}');
      INSERT INTO [dbo].[ResearchContributor] ([researchId],[personId],[role],[position]) VALUES
        (N'${id.study}', N'${people.linkedPersonId}', N'author', 0);
      INSERT INTO [dbo].[ResearchPaper] ([id],[slug],[primaryLocale],[languageCode],[state],[publicationYear]) VALUES
        (N'${id.paper}', N'p3-paper-${run}', N'en', N'ar', N'published', 2022);
      INSERT INTO [dbo].[ResearchPaperLabel] ([researchPaperId],[locale],[title],[summary]) VALUES
        (N'${id.paper}', N'en', N'P3 paper ${run}', N'');
      INSERT INTO [dbo].[ResearchPaperTopic] ([researchPaperId],[topicId]) VALUES (N'${id.paper}', N'${hadith.id}');

      ${published('Publication', 'booklet', { language: 'en', year: 2015, publisher: 'Synthetic Press', sections: 3 })}
      ${published('Publication', 'report', { language: 'ur', year: 2019 })}
      ${published('Publication', 'pamphlet', { language: 'en', year: null })}
      ${published('Publication', 'draftBooklet', { state: 'draft', language: 'en', year: 2020 })}
      INSERT INTO [dbo].[PublicationTopic] ([publicationId],[topicId]) VALUES
        (N'${id.booklet}', N'${quran.id}'), (N'${id.report}', N'${quran.id}'), (N'${id.report}', N'${hadith.id}');
      INSERT INTO [dbo].[PublicationContributor] ([publicationId],[personId],[role],[position]) VALUES
        (N'${id.report}', N'${people.historicalPersonId}', N'author', 0);
      ${published('Encyclopedia', 'encyclopedia', { language: 'ar', year: 2001, sections: 5 })}

      INSERT INTO [dbo].[Magazine] ([id],[slug],[primaryLocale],[state]) VALUES
        (N'${id.monthly}', N'p3-monthly-${run}', N'en', N'published'),
        (N'${id.quarterly}', N'p3-quarterly-${run}', N'en', N'published'),
        (N'${id.hidden}', N'p3-hidden-${run}', N'en', N'draft');
      INSERT INTO [dbo].[MagazineLabel] ([magazineId],[locale],[title],[summary]) VALUES
        (N'${id.monthly}', N'en', N'P3 monthly ${run}', N''),
        (N'${id.quarterly}', N'en', N'P3 quarterly ${run}', N''),
        (N'${id.hidden}', N'en', N'P3 hidden ${run}', N'');
      INSERT INTO [dbo].[MagazineTopic] ([magazineId],[topicId]) VALUES (N'${id.monthly}', N'${quran.id}');
      ${issue('m2021a', 'monthly', { year: 2021, text: true })}
      ${issue('m2021b', 'monthly', { year: 2021 })}
      ${issue('m2019', 'monthly', { year: 2019 })}
      ${issue('mUndated', 'monthly', { year: null })}
      ${issue('mDraft', 'monthly', { year: 2022, state: 'draft' })}
      ${issue('qUndated', 'quarterly', { year: null })}
      ${issue('hiddenIssue', 'hidden', { year: 2024 })}
    `);
  }, 600_000);

  afterAll(async () => {
    await db?.close();
  });

  describe('the research read over the whole Library', () => {
    it('is every published record of the kind, on any Topic or none — the hubs untouched', async () => {
      const research = await reads.topicResearch({ scope: 'library', kind: 'research' });
      expect(ids(research)).toEqual([id.study, id.loose]);
      expect(research.total).toBe(2);
      const all = await reads.topicResearch({ scope: 'library' });
      expect(ids(all)).toEqual([id.paper, id.study, id.loose]);
      // The hub's scope still needs its Topic, and reads only it.
      expect((await reads.topicResearch({ topic: null })).total).toBe(0);
      expect(ids(await reads.topicResearch({ topic: quranTopic }))).toEqual([id.study]);
    });

    it('takes the Topic as a filter, and counts each Topic without it', async () => {
      const onQuran = await reads.topicResearch({ scope: 'library', topic: quranTopic });
      expect(ids(onQuran)).toEqual([id.study]);
      const facets = await reads.topicResearchFacets({
        scope: 'library',
        kind: 'research',
        topic: quranTopic,
      });
      // The figures are the listing's own kind, unfiltered.
      expect(facets.hub).toMatchObject({
        records: 2,
        research: 2,
        papers: 0,
        readable: 1,
        languages: 2,
        contributors: 1,
        earliest: 2010,
        latest: 2010,
      });
      // The kinds still count both, under the other filters (the Topic).
      expect(facets.kinds).toEqual({ all: 1, research: 1, papers: 0 });
      // The Topic facet leaves the Topic out: the kind's records per Topic.
      expect(
        facets.topics.items.map((row) => [row.id.toLowerCase(), row.records]),
      ).toEqual([[quranTopic.toLowerCase(), 1]]);
      // A hub is never browsed by Topic.
      expect((await reads.topicResearchFacets({ topic: quranTopic })).topics).toEqual({
        items: [],
        hasMore: false,
      });
    });
  });

  describe('the published-records read', () => {
    it('is one aggregate’s published records — never a draft — newest first, undated last', async () => {
      const page = await reads.publishedRecords({ kind: 'publication' });
      expect(ids(page)).toEqual([id.report, id.booklet, id.pamphlet]);
      expect(page.total).toBe(3);
      expect(page.hasMore).toBe(false);
      expect(
        ids(await reads.publishedRecords({ kind: 'publication', sort: 'oldest' })),
      ).toEqual([id.booklet, id.report, id.pamphlet]);
      expect(
        ids(await reads.publishedRecords({ kind: 'publication', sort: 'title' })),
      ).toEqual([id.booklet, id.pamphlet, id.report]);
      expect(ids(await reads.publishedRecords({ kind: 'encyclopedia' }))).toEqual([
        id.encyclopedia,
      ]);
    });

    it('answers a card’s worth: publisher, credits and the sections of its text — never the text', async () => {
      const [booklet] = (
        await reads.publishedRecords({
          kind: 'publication',
          topic: quranTopic,
          sort: 'oldest',
        })
      ).items;
      expect(booklet).toMatchObject({
        kind: 'publication',
        slug: `p3-booklet-${run}`,
        languageCode: 'en',
        publicationYear: 2015,
        publisher: 'Synthetic Press',
        readable: true,
        sections: 3,
      });
      expect(booklet).not.toHaveProperty('document');
      const [encyclopedia] = (await reads.publishedRecords({ kind: 'encyclopedia' }))
        .items;
      expect(encyclopedia).toMatchObject({ readable: true, sections: 5 });
      const report = (await reads.publishedRecords({ kind: 'publication' })).items[0];
      expect(report).toMatchObject({ readable: false, sections: 0, publisher: null });
      expect(report?.contributors.map((entry) => entry.personId.toLowerCase())).toEqual([
        people.historicalPersonId.toLowerCase(),
      ]);
    });

    it('narrows by Topic, language, contributor, decade and full text, with pages and totals', async () => {
      const ask = (filter: Record<string, unknown>) =>
        reads.publishedRecords({ kind: 'publication', ...filter });
      expect(ids(await ask({ topic: hadithTopic }))).toEqual([id.report]);
      expect(ids(await ask({ language: 'en' }))).toEqual([id.booklet, id.pamphlet]);
      expect(ids(await ask({ contributor: people.historicalPersonId }))).toEqual([
        id.report,
      ]);
      expect(ids(await ask({ decade: 2010 }))).toEqual([id.report, id.booklet]);
      expect(ids(await ask({ fullText: true }))).toEqual([id.booklet]);
      const first = await ask({ limit: 2 });
      expect(first).toMatchObject({ total: 3, hasMore: true });
      const second = await ask({ limit: 2, offset: 2 });
      expect(ids(second)).toEqual([id.pamphlet]);
      expect(second).toMatchObject({ total: 3, hasMore: false });
      expect(await ask({ offset: 30 })).toEqual({ items: [], total: 3, hasMore: false });
    });

    it('counts the listing and every facet, each without its own filter', async () => {
      const facets = await reads.publishedRecordFacets({
        kind: 'publication',
        language: 'en',
      });
      expect(facets.all).toEqual({
        records: 3,
        readable: 1,
        languages: 2,
        contributors: 1,
        earliest: 2015,
        latest: 2019,
      });
      expect(facets.languages.items).toEqual([
        { id: 'en', records: 2 },
        { id: 'ur', records: 1 },
      ]);
      expect(
        facets.topics.items.map((row) => [row.id.toLowerCase(), row.records]),
      ).toEqual([[quranTopic.toLowerCase(), 1]]);
      expect(facets.decades).toEqual([{ decade: 2010, records: 1 }]);
      expect(facets.readable).toBe(1);
      expect(facets.contributors.items).toEqual([]);
    });
  });

  describe('a Magazine’s issues', () => {
    it('lists every public issue in the periodical’s order with its total — never a draft', async () => {
      const page = await reads.magazineIssuePage({ magazineId: id.monthly });
      // Newest year first; within 2021 the slug decides; the undated issue last.
      expect(ids(page)).toEqual([id.m2021a, id.m2021b, id.m2019, id.mUndated]);
      expect(page.total).toBe(4);
      expect(page.items.at(-1)?.publicationYear).toBeNull();
    });

    it('narrows to one year, or to the undated issues, each with its own total', async () => {
      const year = await reads.magazineIssuePage({ magazineId: id.monthly, year: 2021 });
      expect(year.total).toBe(2);
      expect(year.items.every((row) => row.publicationYear === 2021)).toBe(true);
      const undated = await reads.magazineIssuePage({
        magazineId: id.monthly,
        undated: true,
      });
      expect(ids(undated)).toEqual([id.mUndated.toLowerCase()]);
      const none = await reads.magazineIssuePage({ magazineId: id.monthly, year: 1990 });
      expect(none).toEqual({ items: [], total: 0, hasMore: false });
      const paged = await reads.magazineIssuePage({ magazineId: id.monthly, limit: 3 });
      expect(paged).toMatchObject({ total: 4, hasMore: true });
      // An issue of a draft Magazine is never public.
      expect((await reads.magazineIssuePage({ magazineId: id.hidden })).total).toBe(0);
    });

    it('states the year index — newest first, the undated last — and the readable count', async () => {
      expect(await reads.magazineIssueFacets(id.monthly)).toEqual({
        issues: 4,
        readable: 1,
        years: [
          { year: 2021, issues: 2 },
          { year: 2019, issues: 1 },
          { year: null, issues: 1 },
        ],
      });
      expect(await reads.magazineIssueFacets(id.hidden)).toEqual({
        issues: 0,
        readable: 0,
        years: [],
      });
    });
  });

  describe('the periodicals directory', () => {
    it('lists the public Magazines with their issues, years and newest issue, the figures and the Topics', async () => {
      const directory = await reads.magazineDirectory();
      expect(directory.items.map((item) => item.magazine.id.toLowerCase())).toEqual([
        id.monthly.toLowerCase(),
        id.quarterly.toLowerCase(),
      ]);
      const [monthly, quarterly] = directory.items;
      expect(monthly).toMatchObject({ issues: 4, earliest: 2019, latest: 2021 });
      expect(monthly?.latestIssue?.publicationYear).toBe(2021);
      expect(quarterly).toMatchObject({ issues: 1, earliest: null, latest: null });
      expect(quarterly?.latestIssue?.id.toLowerCase()).toBe(id.qUndated.toLowerCase());
      expect(directory.figures).toEqual({ magazines: 2, issues: 5, readable: 1 });
      expect(
        directory.topics.items.map((row) => [row.id.toLowerCase(), row.records]),
      ).toEqual([[quranTopic.toLowerCase(), 1]]);
      expect(directory.hasMore).toBe(false);

      const onQuran = await reads.magazineDirectory({ topic: quranTopic });
      expect(onQuran.items.map((item) => item.magazine.id.toLowerCase())).toEqual([
        id.monthly.toLowerCase(),
      ]);
      // The figures are the whole set's, whatever the Topic.
      expect(onQuran.figures).toEqual(directory.figures);
      expect((await reads.magazineDirectory({ topic: hadithTopic })).items).toEqual([]);
    });
  });
});
