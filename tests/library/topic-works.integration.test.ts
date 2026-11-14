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
 * Quran Part 10 and Hadith Part 1 against real SQL Server — Library's public
 * Topic Works read. With the Quran passage parts (`quranPassages`, the Quran
 * Books hub):
 *
 *   - the set: every public Work on the named Topic TOGETHER WITH every public
 *     Work carrying a Quran passage; a draft Work, a Work with no published
 *     Edition and a Work on another Topic are absent; with no Topic, only the
 *     passage-carrying Works;
 *   - the shelves (explains, general), a Surah, a content language (a
 *     PUBLISHED Edition in it), a contributor and the featured flag;
 *   - the three orders, each total; bounded pages with the total the query
 *     admits, past the end included;
 *   - each card's languages, latest year, reading flag and passages;
 *   - the facets, each leaving its own filter out of its own counts.
 *
 * Without them (the Hadith Books hub): the public Works on the Topic ALONE —
 * no passage-carrying Work joins, no Work carries a passage, nothing explains
 * a Surah — and with no Topic, nothing at all.
 *
 * Synthetic records only, written as rows; no Quran text is involved.
 */

const live = databaseConfigured ? describe : describe.skip;

const n = (value: string) => `N'${value.replaceAll("'", "''")}'`;

live(
  'Quran Part 10 / Hadith Part 1 — the Topic Works read against real SQL Server',
  () => {
    let db: DisposableDatabase;
    let people: Phase5Fixture;
    let reads: ReturnType<typeof createLibraryReadService>;
    let quranTopic: string;
    let hadithTopic: string;
    const id = {
      alif: randomUUID(),
      bayan: randomUUID(),
      commentary: randomUUID(),
      durood: randomUUID(),
      exegesis: randomUUID(),
      fatiha: randomUUID(),
      ghazali: randomUUID(),
    };
    const run = randomUUID().slice(0, 8);
    const title = {
      alif: `Alif tafsir ${run}`,
      bayan: `Bayan ${run}`,
      commentary: `Commentary on Al-Kahf ${run}`,
      durood: `Durood ${run}`,
      exegesis: `Exegesis draft ${run}`,
      fatiha: `Fatiha notes ${run}`,
      ghazali: `Ghazali on the Quran ${run}`,
    };

    /** The Quran Books hub's query: the Quran passage parts on. */
    const QURAN = { quranPassages: true } as const;

    const ids = (page: { items: readonly { id: string }[] }) =>
      page.items.map((work) => work.id);

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

      const work = (
        key: keyof typeof id,
        state: 'published' | 'draft',
        featured: boolean,
      ) => `
      INSERT INTO [dbo].[Work] ([id],[slug],[primaryLocale],[state],[isFeatured]) VALUES
        (N'${id[key]}', N'quran-books-${key}-${run}', N'en', N'${state}', ${featured ? 1 : 0});
      INSERT INTO [dbo].[WorkLabel] ([workId],[locale],[title],[description]) VALUES
        (N'${id[key]}', N'en', ${n(title[key])}, N'');`;
      const edition = (
        key: keyof typeof id,
        language: string,
        state: 'published' | 'draft',
        year: number | null,
        readable = false,
      ) => `
      INSERT INTO [dbo].[Edition] ([id],[workId],[languageCode],[label],[state],[publicationYear],[reading],[download],[document],[contentVersion],[version],[updatedAt]) VALUES
        (N'${randomUUID()}', N'${id[key]}', N'${language}', N'Synthetic edition', N'${state}', ${year === null ? 'NULL' : String(year)},
         N'${readable ? 'allowed' : 'unavailable'}', N'denied', ${readable ? `N'{}'` : 'NULL'}, ${readable ? `N'${'a'.repeat(64)}'` : 'NULL'}, 1, SYSUTCDATETIME());`;
      const topic = (key: keyof typeof id, topicId: string) =>
        `INSERT INTO [dbo].[WorkTopic] ([workId],[topicId]) VALUES (N'${id[key]}', N'${topicId}');`;
      const credit = (
        key: keyof typeof id,
        person: string,
        role: string,
        position: number,
      ) =>
        `INSERT INTO [dbo].[WorkContributor] ([workId],[personId],[role],[position]) VALUES (N'${id[key]}', N'${person}', N'${role}', ${String(position)});`;
      const passage = (
        key: keyof typeof id,
        position: number,
        surah: number,
        from: number,
        to: number,
      ) =>
        `INSERT INTO [dbo].[WorkQuranPassage] ([workId],[position],[surahNumber],[ayahFrom],[ayahTo]) VALUES (N'${id[key]}', ${String(position)}, ${String(surah)}, ${String(from)}, ${String(to)});`;

      await db.admin.query(`
      ${work('alif', 'published', true)}
      ${edition('alif', 'ur', 'published', 2001)}
      ${credit('alif', people.linkedPersonId, 'author', 0)}
      ${passage('alif', 0, 18, 1, 10)}
      ${passage('alif', 1, 2, 255, 255)}

      ${work('bayan', 'published', false)}
      ${edition('bayan', 'en', 'published', 2015, true)}
      ${edition('bayan', 'ur', 'published', 1999)}
      ${edition('bayan', 'ar', 'draft', 2024)}
      ${topic('bayan', quran.id)}
      ${credit('bayan', people.historicalPersonId, 'translator', 0)}

      ${work('commentary', 'published', false)}
      ${edition('commentary', 'ar', 'published', null)}
      ${topic('commentary', quran.id)}
      ${credit('commentary', people.linkedPersonId, 'author', 0)}
      ${passage('commentary', 0, 18, 60, 82)}

      ${work('durood', 'published', true)}
      ${edition('durood', 'ur', 'published', 2010)}
      ${topic('durood', hadith.id)}

      ${work('exegesis', 'draft', false)}
      ${edition('exegesis', 'en', 'published', 2005)}
      ${topic('exegesis', quran.id)}
      ${passage('exegesis', 0, 1, 1, 7)}

      ${work('fatiha', 'published', false)}
      ${edition('fatiha', 'en', 'draft', 2006)}
      ${topic('fatiha', quran.id)}
      ${passage('fatiha', 0, 1, 1, 7)}

      ${work('ghazali', 'published', false)}
      ${edition('ghazali', 'en', 'published', 2020)}
      ${topic('ghazali', quran.id)}
      ${topic('ghazali', hadith.id)}
    `);
    }, 600_000);

    afterAll(async () => {
      await db?.close();
    });

    it('is the public Works on the Topic together with every public Work explaining a passage', async () => {
      const page = await reads.topicWorks({ ...QURAN, topic: quranTopic });
      // A–Z by title; the draft, the Work without a published Edition and the
      // Work on another Topic are nowhere.
      expect(ids(page)).toEqual([id.alif, id.bayan, id.commentary, id.ghazali]);
      expect(page.total).toBe(4);
      expect(page.hasMore).toBe(false);
      // With no Topic, the passage-carrying Works alone.
      const passagesOnly = await reads.topicWorks({ ...QURAN, topic: null });
      expect(ids(passagesOnly)).toEqual([id.alif, id.commentary]);
    });

    it('describes each card: languages of published Editions, latest year, reading, passages in the editor’s order', async () => {
      const page = await reads.topicWorks({ ...QURAN, topic: quranTopic });
      const byId = new Map(page.items.map((work) => [work.id, work]));
      expect(byId.get(id.alif)).toMatchObject({
        slug: `quran-books-alif-${run}`,
        isFeatured: true,
        labels: [{ locale: 'en', title: title.alif, description: '' }],
        contributors: [{ personId: people.linkedPersonId, role: 'author' }],
        languages: ['ur'],
        year: 2001,
        readable: false,
        cover: null,
        passages: [
          { surah: 18, ayahFrom: 1, ayahTo: 10 },
          { surah: 2, ayahFrom: 255, ayahTo: 255 },
        ],
      });
      // The draft Arabic Edition of Bayan is neither a language nor a year.
      expect(byId.get(id.bayan)).toMatchObject({
        languages: ['en', 'ur'],
        year: 2015,
        readable: true,
        passages: [],
        contributors: [{ personId: people.historicalPersonId, role: 'translator' }],
      });
      expect(byId.get(id.commentary)).toMatchObject({ languages: ['ar'], year: null });
    });

    it('narrows by shelf and by Surah', async () => {
      const shelf = async (raw: Record<string, unknown>) =>
        ids(await reads.topicWorks({ ...QURAN, topic: quranTopic, ...raw }));
      expect(await shelf({ shelf: 'explains' })).toEqual([id.alif, id.commentary]);
      expect(await shelf({ shelf: 'general' })).toEqual([id.bayan, id.ghazali]);
      expect(await shelf({ surah: 18 })).toEqual([id.alif, id.commentary]);
      expect(await shelf({ shelf: 'explains', surah: 2 })).toEqual([id.alif]);
      const none = await reads.topicWorks({ ...QURAN, topic: quranTopic, surah: 3 });
      expect(none).toEqual({ items: [], total: 0, hasMore: false });
      expect(() =>
        reads.topicWorks({ ...QURAN, topic: quranTopic, shelf: 'general', surah: 2 }),
      ).toThrow();
    });

    it('narrows by a published Edition’s language, a contributor and the featured flag', async () => {
      const only = async (raw: Record<string, unknown>) =>
        ids(await reads.topicWorks({ ...QURAN, topic: quranTopic, ...raw }));
      expect(await only({ language: 'ur' })).toEqual([id.alif, id.bayan]);
      expect(await only({ language: 'ar' })).toEqual([id.commentary]);
      // Bayan's Arabic Edition is a draft: it makes Bayan no Arabic book.
      expect(await only({ language: 'fr' })).toEqual([]);
      expect(await only({ contributor: people.linkedPersonId })).toEqual([
        id.alif,
        id.commentary,
      ]);
      expect(await only({ contributor: people.historicalPersonId })).toEqual([id.bayan]);
      expect(await only({ featured: true })).toEqual([id.alif]);
      expect(
        await only({
          language: 'ur',
          contributor: people.linkedPersonId,
          shelf: 'explains',
        }),
      ).toEqual([id.alif]);
    });

    it('orders by title, by newest publication (undated last) and in Quran order (none last)', async () => {
      const order = async (sort: string, raw: Record<string, unknown> = {}) =>
        ids(await reads.topicWorks({ ...QURAN, topic: quranTopic, sort, ...raw }));
      expect(await order('newest')).toEqual([
        id.ghazali,
        id.bayan,
        id.alif,
        id.commentary,
      ]);
      // Alif's earliest passage is 2:255 (it was given second); Commentary's 18:60.
      expect(await order('quran')).toEqual([
        id.alif,
        id.commentary,
        id.bayan,
        id.ghazali,
      ]);
      // Within a Surah, by the passage in THAT Surah: 18:1 before 18:60.
      expect(await order('quran', { surah: 18 })).toEqual([id.alif, id.commentary]);
    });

    it('pages within its bound, stating the total — past the end too', async () => {
      const first = await reads.topicWorks({ ...QURAN, topic: quranTopic, limit: 3 });
      expect(ids(first)).toEqual([id.alif, id.bayan, id.commentary]);
      expect(first.total).toBe(4);
      expect(first.hasMore).toBe(true);
      const second = await reads.topicWorks({
        ...QURAN,
        topic: quranTopic,
        limit: 3,
        offset: 3,
      });
      expect(ids(second)).toEqual([id.ghazali]);
      expect(second.hasMore).toBe(false);
      const past = await reads.topicWorks({ ...QURAN, topic: quranTopic, offset: 48 });
      expect(past).toEqual({ items: [], total: 4, hasMore: false });
    });

    it('counts the hub, its shelves, languages, contributors and Surahs', async () => {
      expect(await reads.topicWorkFacets({ ...QURAN, topic: quranTopic })).toEqual({
        hub: { works: 4, explaining: 2, featured: 1, languages: 3 },
        shelves: { all: 4, explaining: 2 },
        // Works per language, most first, then by code.
        languages: {
          items: [
            { id: 'en', works: 2 },
            { id: 'ur', works: 2 },
            { id: 'ar', works: 1 },
          ],
          hasMore: false,
        },
        contributors: {
          items: [
            { id: people.linkedPersonId, works: 2 },
            { id: people.historicalPersonId, works: 1 },
          ],
          hasMore: false,
        },
        surahs: [
          { surah: 2, owners: 1 },
          { surah: 18, owners: 2 },
        ],
      });
    });

    it('leaves each facet’s own filter out of its own counts, and the hub figures unfiltered', async () => {
      const urdu = await reads.topicWorkFacets({
        ...QURAN,
        topic: quranTopic,
        language: 'ur',
      });
      expect(urdu.hub).toEqual({ works: 4, explaining: 2, featured: 1, languages: 3 });
      expect(urdu.shelves).toEqual({ all: 2, explaining: 1 });
      // Every language is still offered, with what choosing it would show.
      expect(urdu.languages.items.map((facet) => facet.id)).toEqual(['en', 'ur', 'ar']);
      expect(urdu.contributors.items).toEqual(
        [
          { id: people.historicalPersonId, works: 1 },
          { id: people.linkedPersonId, works: 1 },
        ].sort((a, b) => a.id.localeCompare(b.id)),
      );
      expect(urdu.surahs).toEqual([
        { surah: 2, owners: 1 },
        { surah: 18, owners: 1 },
      ]);

      const explaining = await reads.topicWorkFacets({
        ...QURAN,
        topic: quranTopic,
        shelf: 'explains',
      });
      expect(explaining.languages.items).toEqual([
        { id: 'ar', works: 1 },
        { id: 'ur', works: 1 },
      ]);
      expect(explaining.contributors.items).toEqual([
        { id: people.linkedPersonId, works: 2 },
      ]);
      // The shelves themselves are never narrowed by the shelf.
      expect(explaining.shelves).toEqual({ all: 4, explaining: 2 });

      const author = await reads.topicWorkFacets({
        ...QURAN,
        topic: quranTopic,
        contributor: people.historicalPersonId,
      });
      expect(author.shelves).toEqual({ all: 1, explaining: 0 });
      expect(author.surahs).toEqual([]);
      expect(author.languages.items).toEqual([
        { id: 'en', works: 1 },
        { id: 'ur', works: 1 },
      ]);
    });

    it('without the passage parts is the public Works on the Topic alone — no passage, no Surah, no shelf', async () => {
      // The hadith Topic: Durood, and Ghazali (on both Topics); nothing else.
      const hadith = await reads.topicWorks({ topic: hadithTopic });
      expect(ids(hadith)).toEqual([id.durood, id.ghazali]);
      expect(hadith.total).toBe(2);
      expect(ids(await reads.topicWorks({ topic: hadithTopic, sort: 'newest' }))).toEqual(
        [id.ghazali, id.durood],
      );
      expect(ids(await reads.topicWorks({ topic: hadithTopic, language: 'ur' }))).toEqual(
        [id.durood],
      );
      expect(ids(await reads.topicWorks({ topic: hadithTopic, featured: true }))).toEqual(
        [id.durood],
      );
      // On the quran Topic: Alif explains a passage but is not on the Topic, so
      // it is no member; Commentary is, and carries no passage here.
      const topicOnly = await reads.topicWorks({ topic: quranTopic });
      expect(ids(topicOnly)).toEqual([id.bayan, id.commentary, id.ghazali]);
      expect(topicOnly.items.map((work) => work.passages)).toEqual([[], [], []]);
      // With no Topic, nothing at all — never every Work.
      expect(await reads.topicWorks({ topic: null })).toEqual({
        items: [],
        total: 0,
        hasMore: false,
      });

      expect(await reads.topicWorkFacets({ topic: hadithTopic })).toEqual({
        hub: { works: 2, explaining: 0, featured: 1, languages: 2 },
        shelves: { all: 2, explaining: 0 },
        languages: {
          items: [
            { id: 'en', works: 1 },
            { id: 'ur', works: 1 },
          ],
          hasMore: false,
        },
        contributors: { items: [], hasMore: false },
        surahs: [],
      });
      const quranTopicOnly = await reads.topicWorkFacets({ topic: quranTopic });
      expect(quranTopicOnly.hub).toEqual({
        works: 3,
        explaining: 0,
        featured: 0,
        languages: 3,
      });
      expect(quranTopicOnly.shelves).toEqual({ all: 3, explaining: 0 });
      expect(quranTopicOnly.surahs).toEqual([]);
      expect(await reads.topicWorkFacets({ topic: null })).toEqual({
        hub: { works: 0, explaining: 0, featured: 0, languages: 0 },
        shelves: { all: 0, explaining: 0 },
        languages: { items: [], hasMore: false },
        contributors: { items: [], hasMore: false },
        surahs: [],
      });
    });
  },
);
