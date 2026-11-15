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
 * Library Part 1 against real SQL Server — the WHOLE LIBRARY through the
 * Topic Works read (`scope: 'library'`), which `/library/books` and the
 * Library landing are built on:
 *
 *   - the set: every public Work (published, with a published Edition); a
 *     draft Work and a Work whose only Edition is a draft are absent, and the
 *     Topic is a filter, never the set's definition;
 *   - the Edition filters — content language, a publication-year range,
 *     readable online, downloadable — each a condition on ONE published
 *     Edition, so two siblings never combine into a match;
 *   - both orders, and each card's readable and downloadable flags;
 *   - the figures (readable, downloadable, the span of years) and the facets
 *     (Topic, language, contributor, availability), each leaving its own
 *     filter out of its own counts.
 *
 * Synthetic records only, written as rows into a disposable database.
 */

const live = databaseConfigured ? describe : describe.skip;

const n = (value: string) => `N'${value.replaceAll("'", "''")}'`;

live('Library Part 1 — the whole Library against real SQL Server', () => {
  let db: DisposableDatabase;
  let people: Phase5Fixture;
  let reads: ReturnType<typeof createLibraryReadService>;
  let quranTopic: string;
  let hadithTopic: string;
  const run = randomUUID().slice(0, 8);
  const id = {
    alpha: randomUUID(),
    beta: randomUUID(),
    gamma: randomUUID(),
    draft: randomUUID(),
    hidden: randomUUID(),
    foxtrot: randomUUID(),
  };
  const title = {
    alpha: `Lib Alpha ${run}`,
    beta: `Lib Beta ${run}`,
    gamma: `Lib Gamma ${run}`,
    draft: `Lib Delta draft ${run}`,
    hidden: `Lib Epsilon hidden ${run}`,
    foxtrot: `Lib Foxtrot ${run}`,
  };
  const asset = { alphaUrdu: randomUUID(), gamma: randomUUID() };

  /** The whole Library's read, as `/library/books` asks it. */
  const LIBRARY = { scope: 'library' } as const;

  const ids = (page: { items: readonly { id: string }[] }) =>
    page.items.map((work) => work.id);
  const only = async (raw: Record<string, unknown>) =>
    ids(await reads.topicWorks({ ...LIBRARY, ...raw }));

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
        (N'${id[key]}', N'library-books-${key}-${run}', N'en', N'${state}', ${featured ? 1 : 0});
      INSERT INTO [dbo].[WorkLabel] ([workId],[locale],[title],[description]) VALUES
        (N'${id[key]}', N'en', ${n(title[key])}, N'');`;
    const edition = (
      key: keyof typeof id,
      language: string,
      state: 'published' | 'draft',
      year: number | null,
      access: { readable?: boolean; download?: string } = {},
    ) => `
      INSERT INTO [dbo].[Edition] ([id],[workId],[languageCode],[label],[state],[publicationYear],[reading],[download],[downloadAssetId],[document],[contentVersion],[version],[updatedAt]) VALUES
        (N'${randomUUID()}', N'${id[key]}', N'${language}', N'Synthetic edition', N'${state}', ${year === null ? 'NULL' : String(year)},
         N'${access.readable === true ? 'allowed' : 'unavailable'}',
         N'${access.download === undefined ? 'denied' : 'allowed'}',
         ${access.download === undefined ? 'NULL' : `N'${access.download}'`},
         ${access.readable === true ? `N'{}'` : 'NULL'}, ${access.readable === true ? `N'${'b'.repeat(64)}'` : 'NULL'}, 1, SYSUTCDATETIME());`;
    const topic = (key: keyof typeof id, topicId: string) =>
      `INSERT INTO [dbo].[WorkTopic] ([workId],[topicId]) VALUES (N'${id[key]}', N'${topicId}');`;
    const credit = (key: keyof typeof id, person: string, role: string) =>
      `INSERT INTO [dbo].[WorkContributor] ([workId],[personId],[role],[position]) VALUES (N'${id[key]}', N'${person}', N'${role}', 0);`;
    const file = (assetId: string) =>
      `INSERT INTO [dbo].[Asset] ([id],[storageKey],[mediaType],[byteSize],[checksum],[state],[updatedAt]) VALUES (N'${assetId}', N'proof/${assetId}', N'application/pdf', 8, N'${'c'.repeat(64)}', N'clean', SYSUTCDATETIME());`;

    await db.admin.query(`
      ${file(asset.alphaUrdu)}
      ${file(asset.gamma)}

      ${work('alpha', 'published', true)}
      ${edition('alpha', 'en', 'published', 1990, { readable: true })}
      ${edition('alpha', 'ur', 'published', 2005, { download: asset.alphaUrdu })}
      ${topic('alpha', quran.id)}
      ${credit('alpha', people.linkedPersonId, 'author')}

      ${work('beta', 'published', false)}
      ${edition('beta', 'ar', 'published', 2010)}
      ${topic('beta', hadith.id)}
      ${credit('beta', people.historicalPersonId, 'translator')}

      ${work('gamma', 'published', false)}
      ${edition('gamma', 'ur', 'published', null, { download: asset.gamma })}

      ${work('draft', 'draft', true)}
      ${edition('draft', 'en', 'published', 2000, { readable: true })}
      ${topic('draft', quran.id)}

      ${work('hidden', 'published', false)}
      ${edition('hidden', 'en', 'draft', 1995, { readable: true })}
      ${topic('hidden', quran.id)}

      ${work('foxtrot', 'published', false)}
      ${edition('foxtrot', 'en', 'published', 1985, { readable: true })}
      ${topic('foxtrot', quran.id)}
    `);
  }, 600_000);

  afterAll(async () => {
    await db?.close();
  });

  it('is every public Work — never a draft Work or a Work with no published Edition', async () => {
    const page = await reads.topicWorks(LIBRARY);
    expect(ids(page)).toEqual([id.alpha, id.beta, id.foxtrot, id.gamma]);
    expect(page.total).toBe(4);
    expect(page.hasMore).toBe(false);
    // The hubs' rule is untouched: a Topic read with no Topic reads nothing.
    expect(await reads.topicWorks({ topic: null })).toEqual({
      items: [],
      total: 0,
      hasMore: false,
    });
  });

  it('narrows by Topic as a filter, by language, by contributor and by the featured flag', async () => {
    expect(await only({ topic: quranTopic })).toEqual([id.alpha, id.foxtrot]);
    expect(await only({ topic: hadithTopic })).toEqual([id.beta]);
    expect(await only({ language: 'ur' })).toEqual([id.alpha, id.gamma]);
    expect(await only({ contributor: people.historicalPersonId })).toEqual([id.beta]);
    expect(await only({ featured: true })).toEqual([id.alpha]);
  });

  it('narrows by a year range, readable online and downloadable', async () => {
    expect(await only({ from: 2000, to: 2010 })).toEqual([id.alpha, id.beta]);
    expect(await only({ from: 1980, to: 1995 })).toEqual([id.alpha, id.foxtrot]);
    expect(await only({ from: 2006 })).toEqual([id.beta]);
    expect(await only({ to: 1985 })).toEqual([id.foxtrot]);
    // An undated Edition is in no year range.
    expect(await only({ from: 1, to: 9999 })).toEqual([id.alpha, id.beta, id.foxtrot]);
    expect(await only({ readable: true })).toEqual([id.alpha, id.foxtrot]);
    expect(await only({ downloadable: true })).toEqual([id.alpha, id.gamma]);
  });

  it('asks every Edition filter of ONE Edition — two siblings never combine into a match', async () => {
    // Alpha's English Edition is readable and its Urdu one downloadable.
    expect(await only({ language: 'en', downloadable: true })).toEqual([]);
    expect(await only({ language: 'ur', readable: true })).toEqual([]);
    expect(await only({ readable: true, downloadable: true })).toEqual([]);
    expect(await only({ from: 2000, readable: true })).toEqual([]);
    expect(await only({ language: 'ur', from: 2000, downloadable: true })).toEqual([
      id.alpha,
    ]);
  });

  it('orders by title or newest first (undated last), and describes each card', async () => {
    expect(await only({ sort: 'newest' })).toEqual([
      id.beta,
      id.alpha,
      id.foxtrot,
      id.gamma,
    ]);
    const page = await reads.topicWorks(LIBRARY);
    const byId = new Map(page.items.map((work) => [work.id, work]));
    expect(byId.get(id.alpha)).toMatchObject({
      languages: ['en', 'ur'],
      year: 2005,
      readable: true,
      downloadable: true,
      isFeatured: true,
      passages: [],
    });
    expect(byId.get(id.gamma)).toMatchObject({
      languages: ['ur'],
      year: null,
      readable: false,
      downloadable: true,
    });
    expect(byId.get(id.beta)).toMatchObject({ readable: false, downloadable: false });
  });

  it('pages in 24s with the total the view admits', async () => {
    const first = await reads.topicWorks({ ...LIBRARY, limit: 3 });
    expect(ids(first)).toEqual([id.alpha, id.beta, id.foxtrot]);
    expect(first).toMatchObject({ total: 4, hasMore: true });
    const second = await reads.topicWorks({ ...LIBRARY, limit: 3, offset: 3 });
    expect(ids(second)).toEqual([id.gamma]);
    expect(await reads.topicWorks({ ...LIBRARY, offset: 24 })).toEqual({
      items: [],
      total: 4,
      hasMore: false,
    });
  });

  it('counts the whole Library: figures, Topics, languages, contributors and availability', async () => {
    const sorted = <T extends { id: string }>(items: T[]) =>
      items.sort((x, y) => x.id.localeCompare(y.id));
    expect(await reads.topicWorkFacets(LIBRARY)).toEqual({
      hub: {
        works: 4,
        explaining: 0,
        featured: 1,
        languages: 3,
        readable: 2,
        downloadable: 2,
        earliest: 1985,
        latest: 2010,
      },
      shelves: { all: 4, explaining: 0 },
      access: { readable: 2, downloadable: 2 },
      languages: {
        items: [
          { id: 'en', works: 2 },
          { id: 'ur', works: 2 },
          { id: 'ar', works: 1 },
        ],
        hasMore: false,
      },
      contributors: {
        items: sorted([
          { id: people.linkedPersonId, works: 1 },
          { id: people.historicalPersonId, works: 1 },
        ]),
        hasMore: false,
      },
      topics: {
        items: [
          { id: quranTopic, works: 2 },
          { id: hadithTopic, works: 1 },
        ],
        hasMore: false,
      },
      surahs: [],
    });
  });

  it('leaves each facet’s own filter out of its own counts, and the figures unfiltered', async () => {
    const quran = await reads.topicWorkFacets({ ...LIBRARY, topic: quranTopic });
    // The Topic facet ignores the Topic chosen; every other facet honours it.
    expect(quran.topics.items).toEqual([
      { id: quranTopic, works: 2 },
      { id: hadithTopic, works: 1 },
    ]);
    expect(quran.languages.items).toEqual([
      { id: 'en', works: 2 },
      { id: 'ur', works: 1 },
    ]);
    expect(quran.access).toEqual({ readable: 2, downloadable: 1 });
    expect(quran.hub.works).toBe(4);

    // "Readable online" chosen: its own count is what it shows, and every
    // other count is of Editions that are readable too.
    const readable = await reads.topicWorkFacets({ ...LIBRARY, readable: true });
    expect(readable.access).toEqual({ readable: 2, downloadable: 0 });
    expect(readable.languages.items).toEqual([{ id: 'en', works: 2 }]);
    expect(readable.topics.items).toEqual([{ id: quranTopic, works: 2 }]);

    // A language chosen: the language facet ignores it; availability honours it.
    const urdu = await reads.topicWorkFacets({ ...LIBRARY, language: 'ur' });
    expect(urdu.languages.items).toEqual([
      { id: 'en', works: 2 },
      { id: 'ur', works: 2 },
      { id: 'ar', works: 1 },
    ]);
    expect(urdu.access).toEqual({ readable: 0, downloadable: 2 });
    expect(urdu.shelves).toEqual({ all: 2, explaining: 0 });

    // A year range narrows the language counts to Editions inside it.
    const nineties = await reads.topicWorkFacets({ ...LIBRARY, from: 1980, to: 1999 });
    expect(nineties.languages.items).toEqual([{ id: 'en', works: 2 }]);
    expect(nineties.hub).toMatchObject({ works: 4, earliest: 1985, latest: 2010 });
  });

  it('refuses the Quran passage parts in the whole Library before any read', () => {
    expect(() => reads.topicWorks({ ...LIBRARY, quranPassages: true })).toThrow();
    expect(() => reads.topicWorkFacets({ ...LIBRARY, shelf: 'explains' })).toThrow();
    expect(() => reads.topicWorks({ ...LIBRARY, from: 2001, to: 2000 })).toThrow();
  });
});
