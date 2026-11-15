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
import { createPeopleReadService } from '../../apps/web/src/contexts/people-contributors/index.ts';

/**
 * Library Part 2 against real SQL Server — the browse and access reads:
 *
 *   - `holdings`: every kind's public count and the distinct Topics,
 *     languages and contributors — never a draft, a Work without a published
 *     Edition, an issue of a withdrawn Magazine or an unpublished sale point;
 *   - `topicHoldings` and `languageHoldings`: per Topic and per content
 *     language, the public records by kind, each count what the listing it
 *     leads to shows (a Work once per language one of its Editions is in);
 *   - `contributorDirectory`: Persons credited on a public Work, their
 *     distinct Works and Works per role;
 *   - `downloads` / `downloadFacets`: published Editions of public Works whose
 *     availability allows a download with a file recorded — exactly the asset
 *     route's business decision — filtered, ordered, paged and counted;
 *   - `salePointDirectory`: published sale points A–Z, a literal search, and
 *     the public Works each sells;
 *   - People's `publicPersonCards`: published Persons only.
 *
 * Synthetic records only, written as rows into a disposable database.
 */

const live = databaseConfigured ? describe : describe.skip;

const n = (value: string) => `N'${value.replaceAll("'", "''")}'`;

live('Library Part 2 — the browse and access reads against real SQL Server', () => {
  let db: DisposableDatabase;
  let people: Phase5Fixture;
  let reads: ReturnType<typeof createLibraryReadService>;
  let cards: ReturnType<typeof createPeopleReadService>;
  let quran: string;
  let hadith: string;
  const run = randomUUID().slice(0, 8);
  const work = {
    alpha: randomUUID(),
    beta: randomUUID(),
    gamma: randomUUID(),
    draft: randomUUID(),
    hidden: randomUUID(),
  };
  const edition = {
    alphaEn: randomUUID(),
    alphaUr: randomUUID(),
    beta: randomUUID(),
    gamma: randomUUID(),
    draft: randomUUID(),
    hidden: randomUUID(),
  };
  const asset = {
    alphaUr: randomUUID(),
    beta: randomUUID(),
    gamma: randomUUID(),
    draft: randomUUID(),
    hidden: randomUUID(),
  };
  const point = {
    lahore: randomUUID(),
    karachi: randomUUID(),
    draft: randomUUID(),
    wild: randomUUID(),
  };
  const title = {
    alpha: `Browse Alpha ${run}`,
    beta: `Browse Beta ${run}`,
    gamma: `Browse Gamma ${run}`,
  };

  beforeAll(async () => {
    db = await createProofDatabase();
    const { createLibraryPublicReader, createPeopleReader } =
      await import('../../packages/database/src/index.ts');
    people = newPhase5Fixture();
    await writePhase5Fixture(db.admin, people);
    reads = createLibraryReadService(createLibraryPublicReader());
    cards = createPeopleReadService({ reader: createPeopleReader() });

    const [q] = await db.admin.query<{ id: string }>(
      `SELECT [id] FROM [dbo].[Topic] WHERE [slug] = N'quran';`,
    );
    const [h] = await db.admin.query<{ id: string }>(
      `SELECT [id] FROM [dbo].[Topic] WHERE [slug] = N'hadith';`,
    );
    if (q === undefined || h === undefined)
      throw new Error('The seeded Topics are missing.');
    quran = q.id;
    hadith = h.id;

    const file = (id: string, bytes: number) =>
      `INSERT INTO [dbo].[Asset] ([id],[storageKey],[mediaType],[byteSize],[checksum],[state],[updatedAt]) VALUES (N'${id}', N'proof/${id}', N'application/pdf', ${String(bytes)}, N'${'c'.repeat(64)}', N'clean', SYSUTCDATETIME());`;
    const aWork = (key: keyof typeof work, state: string, label: string) => `
      INSERT INTO [dbo].[Work] ([id],[slug],[primaryLocale],[state],[isFeatured]) VALUES
        (N'${work[key]}', N'browse-${key}-${run}', N'en', N'${state}', 0);
      INSERT INTO [dbo].[WorkLabel] ([workId],[locale],[title],[description]) VALUES
        (N'${work[key]}', N'en', ${n(label)}, N'');`;
    const anEdition = (
      key: keyof typeof edition,
      owner: keyof typeof work,
      language: string,
      state: string,
      year: number | null,
      download: string | null,
    ) => `
      INSERT INTO [dbo].[Edition] ([id],[workId],[languageCode],[label],[state],[publicationYear],[publisher],[pageCount],[reading],[download],[downloadAssetId],[version],[updatedAt]) VALUES
        (N'${edition[key]}', N'${work[owner]}', N'${language}', ${n(`Edition ${key}`)}, N'${state}',
         ${year === null ? 'NULL' : String(year)}, N'Proof Press', 120, N'unavailable',
         N'${download === null ? 'denied' : 'allowed'}', ${download === null ? 'NULL' : `N'${download}'`}, 1, SYSUTCDATETIME());`;
    const topic = (key: keyof typeof work, topicId: string) =>
      `INSERT INTO [dbo].[WorkTopic] ([workId],[topicId]) VALUES (N'${work[key]}', N'${topicId}');`;
    const credit = (key: keyof typeof work, person: string, role: string, position = 0) =>
      `INSERT INTO [dbo].[WorkContributor] ([workId],[personId],[role],[position]) VALUES (N'${work[key]}', N'${person}', N'${role}', ${String(position)});`;
    const sale = (
      key: keyof typeof point,
      name: string,
      address: string,
      state: string,
    ) =>
      `INSERT INTO [dbo].[SalePoint] ([id],[name],[address],[contact],[url],[state],[version]) VALUES (N'${point[key]}', ${n(name)}, ${n(address)}, N'', NULL, N'${state}', 1);`;
    const sells = (key: keyof typeof point, owner: keyof typeof work) =>
      `INSERT INTO [dbo].[WorkSalePoint] ([workId],[salePointId]) VALUES (N'${work[owner]}', N'${point[key]}');`;
    const scholarly = (
      table: string,
      state: string,
      language: string,
      topicTable: string,
      key: string,
      topicId: string,
    ) => {
      const id = randomUUID();
      return `
        INSERT INTO [dbo].[${table}] ([id],[slug],[primaryLocale],[languageCode],[state]) VALUES
          (N'${id}', N'browse-${table.toLowerCase()}-${id.slice(0, 8)}', N'en', N'${language}', N'${state}');
        INSERT INTO [dbo].[${topicTable}] ([${key}],[topicId]) VALUES (N'${id}', N'${topicId}');`;
    };
    const magazine = randomUUID();
    const withdrawn = randomUUID();

    await db.admin.query(`
      ${file(asset.alphaUr, 2_400_000)}
      ${file(asset.beta, 830_000)}
      ${file(asset.gamma, 1_000)}
      ${file(asset.draft, 1_000)}
      ${file(asset.hidden, 1_000)}

      ${aWork('alpha', 'published', title.alpha)}
      ${anEdition('alphaEn', 'alpha', 'en', 'published', 1990, null)}
      ${anEdition('alphaUr', 'alpha', 'ur', 'published', 2005, asset.alphaUr)}
      ${topic('alpha', quran)}
      ${credit('alpha', people.linkedPersonId, 'author')}
      ${credit('alpha', people.historicalPersonId, 'translator', 1)}

      ${aWork('beta', 'published', title.beta)}
      ${anEdition('beta', 'beta', 'ar', 'published', null, asset.beta)}
      ${topic('beta', hadith)}
      ${credit('beta', people.linkedPersonId, 'author')}
      ${credit('beta', people.linkedPersonId, 'editor', 1)}

      ${aWork('gamma', 'published', title.gamma)}
      ${anEdition('gamma', 'gamma', 'ur', 'published', 2010, null)}
      ${topic('gamma', quran)}

      ${aWork('draft', 'draft', `Browse Draft ${run}`)}
      ${anEdition('draft', 'draft', 'en', 'published', 2000, asset.draft)}
      ${topic('draft', quran)}
      ${credit('draft', people.historicalPersonId, 'author')}

      ${aWork('hidden', 'published', `Browse Hidden ${run}`)}
      ${anEdition('hidden', 'hidden', 'en', 'draft', 2000, asset.hidden)}
      ${topic('hidden', hadith)}
      ${credit('hidden', people.historicalPersonId, 'author')}

      ${sale('lahore', 'Proof Books Lahore', 'Model Town, Lahore', 'published')}
      ${sale('karachi', 'Proof Books Karachi', 'Saddar, Karachi', 'published')}
      ${sale('draft', 'Proof Books Draft', 'Lahore', 'draft')}
      ${sale('wild', 'Proof 100% Books_', 'Nowhere', 'published')}
      ${sells('lahore', 'alpha')}
      ${sells('lahore', 'beta')}
      ${sells('lahore', 'draft')}
      ${sells('karachi', 'beta')}
      ${sells('draft', 'gamma')}

      ${scholarly('Research', 'published', 'ur', 'ResearchTopic', 'researchId', quran)}
      ${scholarly('Research', 'draft', 'ur', 'ResearchTopic', 'researchId', quran)}
      ${scholarly('ResearchPaper', 'published', 'en', 'ResearchPaperTopic', 'researchPaperId', hadith)}
      ${scholarly('Publication', 'published', 'ar', 'PublicationTopic', 'publicationId', quran)}
      ${scholarly('Encyclopedia', 'published', 'en', 'EncyclopediaTopic', 'encyclopediaId', hadith)}

      INSERT INTO [dbo].[Magazine] ([id],[slug],[primaryLocale],[state]) VALUES
        (N'${magazine}', N'browse-magazine-${run}', N'en', N'published'),
        (N'${withdrawn}', N'browse-withdrawn-${run}', N'en', N'draft');
      INSERT INTO [dbo].[MagazineTopic] ([magazineId],[topicId]) VALUES
        (N'${magazine}', N'${quran}'), (N'${withdrawn}', N'${quran}');
      INSERT INTO [dbo].[MagazineIssue] ([id],[magazineId],[slug],[primaryLocale],[languageCode],[state],[version],[updatedAt]) VALUES
        (NEWID(), N'${magazine}', N'issue-one', N'en', N'en', N'published', 1, SYSUTCDATETIME()),
        (NEWID(), N'${withdrawn}', N'issue-one', N'en', N'en', N'published', 1, SYSUTCDATETIME());
    `);
  }, 600_000);

  afterAll(async () => {
    await db?.close();
  });

  it('states the whole Library by kind, never counting what is not public', async () => {
    expect(await reads.holdings()).toEqual({
      works: 3,
      readableWorks: 0,
      downloadableWorks: 2,
      editions: 4,
      downloadableEditions: 2,
      research: 1,
      researchPapers: 1,
      publications: 1,
      encyclopedias: 1,
      magazines: 1,
      magazineIssues: 1,
      salePoints: 3,
      topics: 2,
      languages: 3,
      contributors: 2,
    });
  });

  it('counts each asked Topic’s public records by kind, in the kinds’ order', async () => {
    const byTopic = new Map(
      (await reads.topicHoldings([quran, hadith])).map((entry) => [
        entry.topic,
        entry.kinds,
      ]),
    );
    expect(byTopic.get(quran)).toEqual([
      { kind: 'work', count: 2 },
      { kind: 'research', count: 1 },
      { kind: 'publication', count: 1 },
      { kind: 'magazine', count: 1 },
    ]);
    expect(byTopic.get(hadith)).toEqual([
      { kind: 'work', count: 1 },
      { kind: 'research-paper', count: 1 },
      { kind: 'encyclopedia', count: 1 },
    ]);
    // Only the asked Topics; one with nothing is absent.
    expect(await reads.topicHoldings([hadith])).toHaveLength(1);
  });

  it('matches each Topic and language count to the listing it leads to', async () => {
    const [quranBooks, urduBooks] = await Promise.all([
      reads.topicWorks({ scope: 'library', topic: quran }),
      reads.topicWorks({ scope: 'library', language: 'ur' }),
    ]);
    expect(quranBooks.total).toBe(2);
    expect(urduBooks.total).toBe(2);
    const research = await reads.scholarlyList('research', { topic: quran });
    expect(research.items).toHaveLength(1);
  });

  it('counts each content language’s public records — a Work once per language', async () => {
    const byLanguage = new Map(
      (await reads.languageHoldings()).map((entry) => [entry.language, entry.kinds]),
    );
    expect([...byLanguage.keys()].sort()).toEqual(['ar', 'en', 'ur']);
    expect(byLanguage.get('ur')).toEqual([
      { kind: 'work', count: 2 },
      { kind: 'research', count: 1 },
    ]);
    expect(byLanguage.get('en')).toEqual([
      { kind: 'work', count: 1 },
      { kind: 'research-paper', count: 1 },
      { kind: 'encyclopedia', count: 1 },
    ]);
    expect(byLanguage.get('ar')).toEqual([
      { kind: 'work', count: 1 },
      { kind: 'publication', count: 1 },
    ]);
  });

  it('lists the Persons credited on public Works, with their Works per role', async () => {
    expect(await reads.contributorDirectory()).toEqual({
      items: [
        {
          personId: people.linkedPersonId,
          works: 2,
          roles: [
            { role: 'author', works: 2 },
            { role: 'editor', works: 1 },
          ],
        },
        {
          personId: people.historicalPersonId,
          works: 1,
          roles: [{ role: 'translator', works: 1 }],
        },
      ],
      hasMore: false,
    });
  });

  it('lists exactly the downloadable Editions of public Works, in either order', async () => {
    const page = await reads.downloads({});
    expect(page.total).toBe(2);
    expect(page.hasMore).toBe(false);
    expect(page.items.map((item) => item.editionId)).toEqual([
      edition.alphaUr,
      edition.beta,
    ]);
    expect(page.items[0]).toEqual({
      editionId: edition.alphaUr,
      assetId: asset.alphaUr,
      label: 'Edition alphaUr',
      languageCode: 'ur',
      publisher: 'Proof Press',
      publicationYear: 2005,
      pageCount: 120,
      cover: null,
      work: {
        id: work.alpha,
        slug: `browse-alpha-${run}`,
        primaryLocale: 'en',
        labels: [{ locale: 'en', title: title.alpha }],
      },
    });
    // Newest first, an undated Edition last.
    expect(
      (await reads.downloads({ sort: 'newest' })).items.map((item) => item.editionId),
    ).toEqual([edition.alphaUr, edition.beta]);
    expect(
      (await reads.downloads({ language: 'ar' })).items.map((i) => i.editionId),
    ).toEqual([edition.beta]);
    expect(
      (await reads.downloads({ topic: quran })).items.map((i) => i.editionId),
    ).toEqual([edition.alphaUr]);
    expect(await reads.downloads({ topic: quran, language: 'ar' })).toEqual({
      items: [],
      total: 0,
      hasMore: false,
    });
    // Paged, with the total the query admits even past its end.
    const second = await reads.downloads({ limit: 1, offset: 1 });
    expect(second.items.map((item) => item.editionId)).toEqual([edition.beta]);
    expect(second.total).toBe(2);
    expect((await reads.downloads({ offset: 24 })).total).toBe(2);
  });

  it('counts downloads by language and Topic, each without its own filter', async () => {
    const all = await reads.downloadFacets({});
    expect(all).toMatchObject({ editions: 2, works: 2, languageCount: 2 });
    expect(all.languages.items).toEqual([
      { id: 'ar', editions: 1 },
      { id: 'ur', editions: 1 },
    ]);
    const narrowed = await reads.downloadFacets({ language: 'ur', topic: hadith });
    // The language facet keeps the Topic; the Topic facet keeps the language.
    expect(narrowed.languages.items).toEqual([{ id: 'ar', editions: 1 }]);
    expect(narrowed.topics.items).toEqual([{ id: quran, editions: 1 }]);
    // The figures are the unfiltered set's.
    expect(narrowed.editions).toBe(2);
  });

  it('lists published sale points A–Z with the public Works each sells', async () => {
    const page = await reads.salePointDirectory({});
    expect(page.all).toEqual({ salePoints: 3, works: 2 });
    expect(page.total).toBe(3);
    expect(page.items.map((entry) => entry.id)).toEqual([
      point.wild,
      point.karachi,
      point.lahore,
    ]);
    const lahore = page.items.find((entry) => entry.id === point.lahore);
    expect(lahore?.works.total).toBe(2);
    expect(lahore?.works.items.map((entry) => entry.id)).toEqual([work.alpha, work.beta]);
    expect(page.items.find((entry) => entry.id === point.wild)?.works).toEqual({
      total: 0,
      items: [],
    });
  });

  it('searches names and addresses literally — a wildcard is a character', async () => {
    const ids = async (text: string) =>
      (await reads.salePointDirectory({ text })).items.map((entry) => entry.id);
    expect(await ids('lahore')).toEqual([point.lahore]);
    expect(await ids('Saddar')).toEqual([point.karachi]);
    expect(await ids('100%')).toEqual([point.wild]);
    expect(await ids('%')).toEqual([point.wild]);
    expect(await ids('Books_')).toEqual([point.wild]);
    expect(await ids('[a-z]')).toEqual([]);
    const none = await reads.salePointDirectory({ text: 'Quetta' });
    expect(none).toMatchObject({ items: [], total: 0, all: { salePoints: 3 } });
  });

  it('answers People’s cards for published Persons only', async () => {
    const answer = await cards.publicPersonCards(
      [people.linkedPersonId, people.historicalPersonId, randomUUID()],
      'ar',
    );
    expect(answer.map((card) => card.id).sort()).toEqual(
      [people.linkedPersonId, people.historicalPersonId].sort(),
    );
    const linked = answer.find((card) => card.id === people.linkedPersonId);
    expect(linked).toMatchObject({ name: 'مساهم إثبات الاستعادة', resolvedLocale: 'ar' });
    const historical = answer.find((card) => card.id === people.historicalPersonId);
    expect(historical?.resolvedLocale).toBe('ur');

    await db.admin.query(
      `UPDATE [dbo].[Person] SET [status] = N'archived' WHERE [id] = N'${people.historicalPersonId}';`,
    );
    expect(
      (await cards.publicPersonCards([people.historicalPersonId], 'en')).map((c) => c.id),
    ).toEqual([]);
  });
});
