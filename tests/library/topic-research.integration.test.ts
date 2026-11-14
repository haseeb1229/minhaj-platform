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
 * Quran Part 12 (named for the Topic in Hadith Part 1) against real SQL
 * Server — Library's public Topic Research read, which serves the Quran and
 * the Hadith Research hubs alike:
 *
 *   - the set: every PUBLISHED Research and ResearchPaper record on the named
 *     Topic, the two aggregates side by side; a draft or archived record and
 *     a record on another Topic are absent; with no Topic, nothing;
 *   - the kind, a content language, a contributor, a decade and full text;
 *   - the three orders, each total; bounded pages with the total the query
 *     admits, past the end included;
 *   - each card: labels, credits in order, the date facts, the institutional
 *     context and abstract, a paper's venue and DOI, the citation count and
 *     whether its text is on the platform — never the text itself;
 *   - the facets, each leaving its own filter out of its own counts.
 *
 * Synthetic records only, written as rows; no Quran text is involved.
 */

const live = databaseConfigured ? describe : describe.skip;

const n = (value: string | null) =>
  value === null ? 'NULL' : `N'${value.replaceAll("'", "''")}'`;

live(
  'Quran Part 12 / Hadith Part 1 — the Topic Research read against real SQL Server',
  () => {
    let db: DisposableDatabase;
    let people: Phase5Fixture;
    let reads: ReturnType<typeof createLibraryReadService>;
    let quranTopic: string;
    let hadithTopic: string;
    const run = randomUUID().slice(0, 8);
    const id = {
      asbab: randomUUID(),
      balagha: randomUUID(),
      codex: randomUUID(),
      draft: randomUUID(),
      elsewhere: randomUUID(),
      fawasil: randomUUID(),
      gharib: randomUUID(),
      archived: randomUUID(),
    };
    const title = {
      asbab: `Asbab al-nuzul study ${run}`,
      balagha: `Balagha in the Quran ${run}`,
      codex: `Codex history ${run}`,
      draft: `Draft study ${run}`,
      elsewhere: `Elsewhere study ${run}`,
      fawasil: `Fawasil paper ${run}`,
      gharib: `Gharib paper ${run}`,
      archived: `Archived paper ${run}`,
    };
    const document = JSON.stringify({
      sections: [{ key: 'one', title: 'Synthetic section', paragraphs: ['Synthetic.'] }],
    });

    const ids = (page: { items: readonly { id: string }[] }) =>
      page.items.map((item) => item.id);

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

      const research = (
        key: keyof typeof id,
        fields: {
          readonly state?: string;
          readonly language: string;
          readonly year: number | null;
          readonly date?: string;
          readonly context?: string;
          readonly abstract?: string;
          readonly text?: boolean;
        },
      ) => `
      INSERT INTO [dbo].[Research] ([id],[slug],[primaryLocale],[languageCode],[state],[publicationYear],[publishedOn],[institutionalContext],[abstract],[document]) VALUES
        (N'${id[key]}', N'quran-research-${key}-${run}', N'en', N'${fields.language}', N'${fields.state ?? 'published'}',
         ${fields.year === null ? 'NULL' : String(fields.year)}, ${fields.date === undefined ? 'NULL' : `'${fields.date}'`},
         ${n(fields.context ?? null)}, ${n(fields.abstract ?? null)}, ${fields.text === true ? n(document) : 'NULL'});
      INSERT INTO [dbo].[ResearchLabel] ([researchId],[locale],[title],[summary]) VALUES
        (N'${id[key]}', N'en', ${n(title[key])}, N'A synthetic summary.');`;
      const paper = (
        key: keyof typeof id,
        fields: {
          readonly state?: string;
          readonly language: string;
          readonly year: number | null;
          readonly venue?: string;
          readonly doi?: string;
          readonly text?: boolean;
        },
      ) => `
      INSERT INTO [dbo].[ResearchPaper] ([id],[slug],[primaryLocale],[languageCode],[state],[publicationYear],[venue],[doi],[document]) VALUES
        (N'${id[key]}', N'quran-research-${key}-${run}', N'en', N'${fields.language}', N'${fields.state ?? 'published'}',
         ${fields.year === null ? 'NULL' : String(fields.year)}, ${n(fields.venue ?? null)}, ${n(fields.doi ?? null)},
         ${fields.text === true ? n(document) : 'NULL'});
      INSERT INTO [dbo].[ResearchPaperLabel] ([researchPaperId],[locale],[title],[summary]) VALUES
        (N'${id[key]}', N'en', ${n(title[key])}, N''),
        (N'${id[key]}', N'ur', ${n(`ے ${title[key]}`)}, N'');`;
      const topicOf = (
        table: 'Research' | 'ResearchPaper',
        key: keyof typeof id,
        topic: string,
      ) =>
        `INSERT INTO [dbo].[${table}Topic] ([${table === 'Research' ? 'researchId' : 'researchPaperId'}],[topicId]) VALUES (N'${id[key]}', N'${topic}');`;
      const credit = (
        table: 'Research' | 'ResearchPaper',
        key: keyof typeof id,
        person: string,
        role: string,
        position: number,
      ) =>
        `INSERT INTO [dbo].[${table}Contributor] ([${table === 'Research' ? 'researchId' : 'researchPaperId'}],[personId],[role],[position]) VALUES (N'${id[key]}', N'${person}', N'${role}', ${String(position)});`;
      const cite = (
        table: 'Research' | 'ResearchPaper',
        key: keyof typeof id,
        count: number,
      ) =>
        Array.from(
          { length: count },
          (_, index) =>
            `INSERT INTO [dbo].[${table}Citation] ([${table === 'Research' ? 'researchId' : 'researchPaperId'}],[position],[text],[url],[doi]) VALUES (N'${id[key]}', ${String(index)}, N'Synthetic citation ${String(index)}', NULL, NULL);`,
        ).join('\n');

      await db.admin.query(`
      ${research('asbab', {
        language: 'ur',
        year: 2021,
        date: '2021-03-04',
        context: 'A synthetic institute',
        abstract: 'A synthetic abstract.',
        text: true,
      })}
      ${topicOf('Research', 'asbab', quran.id)}
      ${credit('Research', 'asbab', people.linkedPersonId, 'author', 0)}
      ${credit('Research', 'asbab', people.historicalPersonId, 'editor', 1)}
      ${cite('Research', 'asbab', 3)}

      ${research('balagha', { language: 'en', year: 1995 })}
      ${topicOf('Research', 'balagha', quran.id)}
      ${topicOf('Research', 'balagha', hadith.id)}
      ${credit('Research', 'balagha', people.linkedPersonId, 'author', 0)}
      ${credit('Research', 'balagha', people.linkedPersonId, 'compiler', 1)}

      ${research('codex', { language: 'en', year: null })}
      ${topicOf('Research', 'codex', quran.id)}

      ${research('draft', { state: 'draft', language: 'en', year: 2022 })}
      ${topicOf('Research', 'draft', quran.id)}

      ${research('elsewhere', { language: 'en', year: 2020 })}
      ${topicOf('Research', 'elsewhere', hadith.id)}

      ${paper('fawasil', {
        language: 'ar',
        year: 2024,
        venue: 'A synthetic journal',
        doi: '10.1234/synthetic.fawasil',
      })}
      ${topicOf('ResearchPaper', 'fawasil', quran.id)}
      ${credit('ResearchPaper', 'fawasil', people.historicalPersonId, 'author', 0)}
      ${cite('ResearchPaper', 'fawasil', 1)}

      ${paper('gharib', { language: 'en', year: 1999, text: true })}
      ${topicOf('ResearchPaper', 'gharib', quran.id)}

      ${paper('archived', { state: 'archived', language: 'en', year: 2023 })}
      ${topicOf('ResearchPaper', 'archived', quran.id)}
    `);
    }, 600_000);

    afterAll(async () => {
      await db?.close();
    });

    it('is the published research and papers on the Topic — never a draft, an archived record or another Topic', async () => {
      const page = await reads.topicResearch({ topic: quranTopic });
      expect(ids(page)).toEqual([id.fawasil, id.asbab, id.gharib, id.balagha, id.codex]);
      expect(page.total).toBe(5);
      expect(page.hasMore).toBe(false);
      // With no Topic nothing is research on the Quran.
      expect(await reads.topicResearch({ topic: null })).toEqual({
        items: [],
        total: 0,
        hasMore: false,
      });
    });

    it('serves any subject by its Topic alone — the Hadith Research hub’s set', async () => {
      // Balagha is on both Topics, Elsewhere on the hadith Topic only.
      const hadith = await reads.topicResearch({ topic: hadithTopic });
      expect(ids(hadith)).toEqual([id.elsewhere, id.balagha]);
      expect(hadith.total).toBe(2);
      expect((await reads.topicResearchFacets({ topic: hadithTopic })).hub).toEqual({
        records: 2,
        research: 2,
        papers: 0,
        readable: 0,
        languages: 1,
        contributors: 1,
        earliest: 1995,
        latest: 2020,
      });
    });

    it('describes each record as a card — and never carries its text', async () => {
      const page = await reads.topicResearch({ topic: quranTopic });
      const asbab = page.items.find((item) => item.id === id.asbab);
      expect(asbab).toEqual({
        kind: 'research',
        id: id.asbab,
        slug: `quran-research-asbab-${run}`,
        primaryLocale: 'en',
        labels: [{ locale: 'en', title: title.asbab, summary: 'A synthetic summary.' }],
        contributors: [
          { personId: people.linkedPersonId, role: 'author' },
          { personId: people.historicalPersonId, role: 'editor' },
        ],
        languageCode: 'ur',
        publicationYear: 2021,
        publishedOn: '2021-03-04',
        institutionalContext: 'A synthetic institute',
        abstract: 'A synthetic abstract.',
        venue: null,
        doi: null,
        citations: 3,
        readable: true,
      });
      expect(asbab).not.toHaveProperty('document');
      const fawasil = page.items.find((item) => item.id === id.fawasil);
      expect(fawasil).toMatchObject({
        kind: 'research-paper',
        venue: 'A synthetic journal',
        doi: '10.1234/synthetic.fawasil',
        citations: 1,
        readable: false,
        publishedOn: null,
      });
      expect(fawasil?.labels.map((label) => label.locale)).toEqual(['en', 'ur']);
      expect(page.items.find((item) => item.id === id.gharib)?.readable).toBe(true);
      expect(page.items.find((item) => item.id === id.codex)?.contributors).toEqual([]);
    });

    it('narrows by kind, content language, contributor, decade and full text', async () => {
      const narrowed = async (raw: Record<string, unknown>) =>
        ids(await reads.topicResearch({ topic: quranTopic, ...raw }));
      expect(await narrowed({ kind: 'research' })).toEqual([
        id.asbab,
        id.balagha,
        id.codex,
      ]);
      expect(await narrowed({ kind: 'research-paper' })).toEqual([id.fawasil, id.gharib]);
      expect(await narrowed({ language: 'en' })).toEqual([
        id.gharib,
        id.balagha,
        id.codex,
      ]);
      expect(await narrowed({ language: 'ar', kind: 'research' })).toEqual([]);
      expect(await narrowed({ contributor: people.linkedPersonId })).toEqual([
        id.asbab,
        id.balagha,
      ]);
      expect(await narrowed({ contributor: people.historicalPersonId })).toEqual([
        id.fawasil,
        id.asbab,
      ]);
      expect(await narrowed({ decade: 1990 })).toEqual([id.gharib, id.balagha]);
      expect(await narrowed({ decade: 2020 })).toEqual([id.fawasil, id.asbab]);
      expect(await narrowed({ decade: 1980 })).toEqual([]);
      expect(await narrowed({ fullText: true })).toEqual([id.asbab, id.gharib]);
      expect(await narrowed({ fullText: true, kind: 'research-paper' })).toEqual([
        id.gharib,
      ]);
    });

    it('orders newest first, oldest first or by title — undated last in both chronologies', async () => {
      const ordered = async (sort: string, raw: Record<string, unknown> = {}) =>
        ids(await reads.topicResearch({ topic: quranTopic, sort, ...raw }));
      expect(await ordered('newest')).toEqual([
        id.fawasil,
        id.asbab,
        id.gharib,
        id.balagha,
        id.codex,
      ]);
      expect(await ordered('oldest')).toEqual([
        id.balagha,
        id.gharib,
        id.asbab,
        id.fawasil,
        id.codex,
      ]);
      expect(await ordered('title')).toEqual([
        id.asbab,
        id.balagha,
        id.codex,
        id.fawasil,
        id.gharib,
      ]);
      // Titles as an Urdu reader is shown them: a paper's Urdu label, else the
      // primary one ("ے …" sorts after the Latin titles).
      expect(await ordered('title', { titleLocale: 'ur' })).toEqual([
        id.asbab,
        id.balagha,
        id.codex,
        id.fawasil,
        id.gharib,
      ]);
    });

    it('pages within the bound and states the total, past the end too', async () => {
      const first = await reads.topicResearch({ topic: quranTopic, limit: 2 });
      expect(ids(first)).toEqual([id.fawasil, id.asbab]);
      expect(first).toMatchObject({ total: 5, hasMore: true });
      const last = await reads.topicResearch({ topic: quranTopic, limit: 2, offset: 4 });
      expect(ids(last)).toEqual([id.codex]);
      expect(last).toMatchObject({ total: 5, hasMore: false });
      const past = await reads.topicResearch({ topic: quranTopic, offset: 40 });
      expect(past).toEqual({ items: [], total: 5, hasMore: false });
      const none = await reads.topicResearch({ topic: quranTopic, decade: 1980 });
      expect(none).toEqual({ items: [], total: 0, hasMore: false });
    });

    it('counts the hub and every facet, each without its own filter', async () => {
      expect(await reads.topicResearchFacets({ topic: quranTopic })).toEqual({
        hub: {
          records: 5,
          research: 3,
          papers: 2,
          readable: 2,
          languages: 3,
          contributors: 2,
          earliest: 1995,
          latest: 2024,
        },
        kinds: { all: 5, research: 3, papers: 2 },
        languages: {
          items: [
            { id: 'en', records: 3 },
            { id: 'ar', records: 1 },
            { id: 'ur', records: 1 },
          ],
          hasMore: false,
        },
        contributors: {
          items: [
            { id: people.historicalPersonId, records: 2 },
            { id: people.linkedPersonId, records: 2 },
          ].sort((a, b) => (a.id < b.id ? -1 : 1)),
          hasMore: false,
        },
        decades: [
          { decade: 2020, records: 2 },
          { decade: 1990, records: 2 },
        ],
        readable: 2,
      });

      // Under a language: the hub is unchanged, the language facet leaves its
      // own filter out, and every other facet narrows.
      const english = await reads.topicResearchFacets({
        topic: quranTopic,
        language: 'en',
      });
      expect(english.hub.records).toBe(5);
      expect(english.kinds).toEqual({ all: 3, research: 2, papers: 1 });
      expect(english.languages.items).toHaveLength(3);
      expect(english.decades).toEqual([{ decade: 1990, records: 2 }]);
      expect(english.contributors.items).toEqual([
        { id: people.linkedPersonId, records: 1 },
      ]);
      expect(english.readable).toBe(1);

      // Under a kind: the kinds leave it out; the rest narrow.
      const papers = await reads.topicResearchFacets({
        topic: quranTopic,
        kind: 'research-paper',
      });
      expect(papers.kinds).toEqual({ all: 5, research: 3, papers: 2 });
      expect(papers.languages.items.map((facet) => facet.id).sort()).toEqual([
        'ar',
        'en',
      ]);

      // Under a decade and full text: each leaves only its own filter out.
      const nineties = await reads.topicResearchFacets({
        topic: quranTopic,
        decade: 1990,
        fullText: true,
      });
      expect(nineties.decades).toEqual([
        { decade: 2020, records: 1 },
        { decade: 1990, records: 1 },
      ]);
      expect(nineties.readable).toBe(1);
      expect(nineties.kinds).toEqual({ all: 1, research: 0, papers: 1 });

      // With no Topic, nothing at all.
      expect((await reads.topicResearchFacets({ topic: null })).hub.records).toBe(0);
    });
  },
);
