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
import { createMediaReadService } from '../../apps/web/src/contexts/media/index.ts';

/**
 * Quran Part 11 against real SQL Server — Media's public Quran Videos read:
 *
 *   - the set: every published Video on the named Topic TOGETHER WITH every
 *     published Video carrying a Quran passage; a draft Video and a Video on
 *     another Topic are absent; with no Topic, only the passage-carrying ones;
 *   - the shelves (explains, general), a Surah, a content language, a speaker,
 *     a PUBLISHED Series (a draft Series admits nothing and is never named),
 *     a length band and the featured flag;
 *   - the three orders, each total; bounded pages with the total the query
 *     admits, past the end included;
 *   - each card's passages (editor's order, with starts), speakers, Series,
 *     availability and format;
 *   - the facets, each leaving its own filter out of its own counts, and the
 *     hub's figures — Surahs explained and recorded running time — unfiltered.
 *
 * Synthetic records only, written as rows; no Quran text is involved.
 */

const live = databaseConfigured ? describe : describe.skip;

const n = (value: string) => `N'${value.replaceAll("'", "''")}'`;

live('Quran Part 11 — the Quran Videos read against real SQL Server', () => {
  let db: DisposableDatabase;
  let people: Phase5Fixture;
  let reads: ReturnType<typeof createMediaReadService>;
  let quranTopic: string;
  const id = {
    alif: randomUUID(),
    bayan: randomUUID(),
    commentary: randomUUID(),
    durood: randomUUID(),
    exegesis: randomUUID(),
    fatiha: randomUUID(),
    ghazali: randomUUID(),
  };
  const series = { published: randomUUID(), draft: randomUUID() };
  const run = randomUUID().slice(0, 8);
  const title = {
    alif: `Alif lecture ${run}`,
    bayan: `Bayan ${run}`,
    commentary: `Commentary on Al-Kahf ${run}`,
    durood: `Durood ${run}`,
    exegesis: `Exegesis draft ${run}`,
    fatiha: `Fatiha talk ${run}`,
    ghazali: `Ghazali on the Quran ${run}`,
  };
  const seriesTitle = `Quran circle ${run}`;

  const ids = (page: { items: readonly { id: string }[] }) =>
    page.items.map((video) => video.id);

  beforeAll(async () => {
    db = await createProofDatabase();
    const { createMediaPublicReader } =
      await import('../../packages/database/src/index.ts');
    people = newPhase5Fixture();
    await writePhase5Fixture(db.admin, people);
    reads = createMediaReadService(createMediaPublicReader());

    const [quran] = await db.admin.query<{ id: string }>(
      `SELECT [id] FROM [dbo].[Topic] WHERE [slug] = N'quran';`,
    );
    const [hadith] = await db.admin.query<{ id: string }>(
      `SELECT [id] FROM [dbo].[Topic] WHERE [slug] = N'hadith';`,
    );
    if (quran === undefined || hadith === undefined)
      throw new Error('The seeded Topics are missing.');
    quranTopic = quran.id;

    const video = (
      key: keyof typeof id,
      fields: {
        readonly state?: 'published' | 'draft';
        readonly featured?: boolean;
        readonly language: string;
        readonly date: string | null;
        readonly seconds: number | null;
        readonly availability?: 'available' | 'unavailable';
        readonly format?: string | null;
        readonly series?: { readonly id: string; readonly position: number };
      },
    ) => `
      INSERT INTO [dbo].[Video] ([id],[slug],[primaryLocale],[state],[isFeatured],[provider],[providerVideoId],[availability],[format],[languageCode],[durationSeconds],[publishedOn],[seriesId],[seriesPosition]) VALUES
        (N'${id[key]}', N'quran-videos-${key}-${run}', N'en', N'${fields.state ?? 'published'}', ${fields.featured === true ? 1 : 0},
         N'youtube', '${`Qv${randomUUID().replaceAll('-', '').slice(0, 9)}`}', N'${fields.availability ?? 'available'}',
         ${fields.format === undefined || fields.format === null ? 'NULL' : `N'${fields.format}'`}, N'${fields.language}',
         ${fields.seconds === null ? 'NULL' : String(fields.seconds)}, ${fields.date === null ? 'NULL' : `'${fields.date}'`},
         ${fields.series === undefined ? 'NULL, NULL' : `N'${fields.series.id}', ${String(fields.series.position)}`});
      INSERT INTO [dbo].[VideoLabel] ([videoId],[locale],[title],[description]) VALUES
        (N'${id[key]}', N'en', ${n(title[key])}, N'');`;
    const topic = (key: keyof typeof id, topicId: string) =>
      `INSERT INTO [dbo].[VideoTopic] ([videoId],[topicId]) VALUES (N'${id[key]}', N'${topicId}');`;
    const speaker = (key: keyof typeof id, person: string) =>
      `INSERT INTO [dbo].[VideoSpeaker] ([videoId],[personId],[position]) VALUES (N'${id[key]}', N'${person}', 0);`;
    const passage = (
      key: keyof typeof id,
      position: number,
      surah: number,
      from: number,
      to: number,
      start: number | null,
    ) =>
      `INSERT INTO [dbo].[VideoQuranPassage] ([videoId],[position],[surahNumber],[ayahFrom],[ayahTo],[startSeconds]) VALUES (N'${id[key]}', ${String(position)}, ${String(surah)}, ${String(from)}, ${String(to)}, ${start === null ? 'NULL' : String(start)});`;

    await db.admin.query(`
      INSERT INTO [dbo].[Series] ([id],[slug],[kind],[primaryLocale],[state]) VALUES
        (N'${series.published}', N'quran-circle-${run}', N'series', N'en', N'published'),
        (N'${series.draft}', N'quran-draft-circle-${run}', N'program', N'en', N'draft');
      INSERT INTO [dbo].[SeriesLabel] ([seriesId],[locale],[title],[description]) VALUES
        (N'${series.published}', N'en', ${n(seriesTitle)}, N''),
        (N'${series.draft}', N'en', N'Draft circle', N'');

      ${video('alif', { featured: true, language: 'en', date: '2020-01-10', seconds: 1_500 })}
      ${speaker('alif', people.linkedPersonId)}
      ${passage('alif', 0, 18, 1, 10, 754)}
      ${passage('alif', 1, 2, 255, 255, null)}

      ${video('bayan', { language: 'ur', date: '2022-05-01', seconds: 4_000, series: { id: series.published, position: 1 } })}
      ${topic('bayan', quran.id)}
      ${speaker('bayan', people.historicalPersonId)}

      ${video('commentary', { language: 'ur', date: null, seconds: 600 })}
      ${topic('commentary', quran.id)}
      ${speaker('commentary', people.linkedPersonId)}
      ${passage('commentary', 0, 18, 60, 82, 0)}

      ${video('durood', { featured: true, language: 'en', date: '2023-02-02', seconds: 900 })}
      ${topic('durood', hadith.id)}

      ${video('exegesis', { state: 'draft', language: 'en', date: '2024-01-01', seconds: 900 })}
      ${topic('exegesis', quran.id)}
      ${passage('exegesis', 0, 1, 1, 7, null)}

      ${video('fatiha', { language: 'en', date: '2021-03-03', seconds: null, series: { id: series.draft, position: 1 } })}
      ${topic('fatiha', quran.id)}
      ${topic('fatiha', hadith.id)}

      ${video('ghazali', { language: 'ar', date: '2019-07-07', seconds: 3_700, availability: 'unavailable', format: 'lecture' })}
      ${passage('ghazali', 0, 1, 1, 7, 30)}
    `);
  }, 600_000);

  afterAll(async () => {
    await db?.close();
  });

  it('is the published Videos on the Topic together with every published Video explaining a passage', async () => {
    const page = await reads.quranVideos({ topic: quranTopic });
    // Newest first, the undated last; the draft and the Video on another
    // Topic are nowhere.
    expect(ids(page)).toEqual([id.bayan, id.fatiha, id.alif, id.ghazali, id.commentary]);
    expect(page.total).toBe(5);
    expect(page.hasMore).toBe(false);
    // With no Topic, the passage-carrying Videos alone.
    expect(ids(await reads.quranVideos({ topic: null }))).toEqual([
      id.alif,
      id.ghazali,
      id.commentary,
    ]);
  });

  it('describes each card: passages in the editor’s order with starts, speakers, a published Series only, availability and format', async () => {
    const page = await reads.quranVideos({ topic: quranTopic });
    const byId = new Map(page.items.map((video) => [video.id, video]));
    expect(byId.get(id.alif)).toEqual({
      id: id.alif,
      slug: `quran-videos-alif-${run}`,
      primaryLocale: 'en',
      isFeatured: true,
      availability: 'available',
      format: null,
      languageCode: 'en',
      labels: [{ locale: 'en', title: title.alif, description: '' }],
      durationSeconds: 1_500,
      publishedOn: '2020-01-10',
      poster: null,
      speakerIds: [people.linkedPersonId],
      series: null,
      passages: [
        { surah: 18, ayahFrom: 1, ayahTo: 10, startSeconds: 754 },
        { surah: 2, ayahFrom: 255, ayahTo: 255, startSeconds: null },
      ],
    });
    expect(byId.get(id.bayan)?.series).toEqual({
      id: series.published,
      slug: `quran-circle-${run}`,
      kind: 'series',
      primaryLocale: 'en',
      labels: [{ locale: 'en', title: seriesTitle, description: '' }],
      position: 1,
    });
    // An episode of a draft programme is shown without it.
    expect(byId.get(id.fatiha)).toMatchObject({ series: null, durationSeconds: null });
    expect(byId.get(id.ghazali)).toMatchObject({
      availability: 'unavailable',
      format: 'lecture',
      passages: [{ surah: 1, ayahFrom: 1, ayahTo: 7, startSeconds: 30 }],
    });
    expect(byId.get(id.commentary)?.publishedOn).toBeNull();
  });

  it('narrows by shelf and by Surah', async () => {
    const shelf = async (raw: Record<string, unknown>) =>
      ids(await reads.quranVideos({ topic: quranTopic, ...raw }));
    expect(await shelf({ shelf: 'explains' })).toEqual([
      id.alif,
      id.ghazali,
      id.commentary,
    ]);
    expect(await shelf({ shelf: 'general' })).toEqual([id.bayan, id.fatiha]);
    expect(await shelf({ surah: 18 })).toEqual([id.alif, id.commentary]);
    expect(await shelf({ shelf: 'explains', surah: 2 })).toEqual([id.alif]);
    expect(await reads.quranVideos({ topic: quranTopic, surah: 3 })).toEqual({
      items: [],
      total: 0,
      hasMore: false,
    });
    expect(() =>
      reads.quranVideos({ topic: quranTopic, shelf: 'general', surah: 2 }),
    ).toThrow();
  });

  it('narrows by language, speaker, a published Series, a length band and the featured flag', async () => {
    const only = async (raw: Record<string, unknown>) =>
      ids(await reads.quranVideos({ topic: quranTopic, ...raw }));
    expect(await only({ language: 'ur' })).toEqual([id.bayan, id.commentary]);
    expect(await only({ language: 'ar' })).toEqual([id.ghazali]);
    expect(await only({ language: 'fr' })).toEqual([]);
    expect(await only({ speaker: people.linkedPersonId })).toEqual([
      id.alif,
      id.commentary,
    ]);
    expect(await only({ series: series.published })).toEqual([id.bayan]);
    // A draft Series is no filter at all: nothing is in it, publicly.
    expect(await only({ series: series.draft })).toEqual([]);
    expect(await only({ length: 'short' })).toEqual([id.commentary]);
    expect(await only({ length: 'medium' })).toEqual([id.alif]);
    // An unknown length is in no band.
    expect(await only({ length: 'long' })).toEqual([id.bayan, id.ghazali]);
    // The featured Video on another Topic stays out.
    expect(await only({ featured: true })).toEqual([id.alif]);
    expect(
      await only({ language: 'ur', speaker: people.linkedPersonId, shelf: 'explains' }),
    ).toEqual([id.commentary]);
  });

  it('orders newest first (undated last), by title, and in Quran order (none last, newest within)', async () => {
    const order = async (sort: string, raw: Record<string, unknown> = {}) =>
      ids(await reads.quranVideos({ topic: quranTopic, sort, ...raw }));
    expect(await order('title')).toEqual([
      id.alif,
      id.bayan,
      id.commentary,
      id.fatiha,
      id.ghazali,
    ]);
    // Ghazali's 1:1–7, Alif's 2:255 (given second), Commentary's 18:60; then
    // the two with none, newest first.
    expect(await order('quran')).toEqual([
      id.ghazali,
      id.alif,
      id.commentary,
      id.bayan,
      id.fatiha,
    ]);
    // Within a Surah, by the passage in THAT Surah: 18:1 before 18:60.
    expect(await order('quran', { surah: 18 })).toEqual([id.alif, id.commentary]);
  });

  it('pages within its bound, stating the total — past the end too', async () => {
    const first = await reads.quranVideos({ topic: quranTopic, limit: 2 });
    expect(ids(first)).toEqual([id.bayan, id.fatiha]);
    expect(first).toMatchObject({ total: 5, hasMore: true });
    const last = await reads.quranVideos({ topic: quranTopic, limit: 2, offset: 4 });
    expect(ids(last)).toEqual([id.commentary]);
    expect(last.hasMore).toBe(false);
    expect(await reads.quranVideos({ topic: quranTopic, offset: 48 })).toEqual({
      items: [],
      total: 5,
      hasMore: false,
    });
  });

  it('counts the hub, its shelves, languages, speakers, Series, lengths and Surahs', async () => {
    expect(await reads.quranVideoFacets({ topic: quranTopic })).toEqual({
      hub: {
        videos: 5,
        explaining: 3,
        featured: 1,
        languages: 3,
        surahs: 3,
        // 1,500 + 4,000 + 600 + 3,700; the unknown length adds nothing.
        seconds: 9_800,
      },
      shelves: { all: 5, explaining: 3 },
      languages: {
        items: [
          { id: 'en', videos: 2 },
          { id: 'ur', videos: 2 },
          { id: 'ar', videos: 1 },
        ],
        hasMore: false,
      },
      speakers: {
        items: [
          { id: people.linkedPersonId, videos: 2 },
          { id: people.historicalPersonId, videos: 1 },
        ],
        hasMore: false,
      },
      series: {
        items: [
          {
            id: series.published,
            slug: `quran-circle-${run}`,
            kind: 'series',
            primaryLocale: 'en',
            labels: [{ locale: 'en', title: seriesTitle, description: '' }],
            videos: 1,
          },
        ],
        hasMore: false,
      },
      lengths: [
        { length: 'short', videos: 1 },
        { length: 'medium', videos: 1 },
        { length: 'long', videos: 2 },
      ],
      surahs: [
        { surah: 1, owners: 1 },
        { surah: 2, owners: 1 },
        { surah: 18, owners: 2 },
      ],
    });
  });

  it('leaves each facet’s own filter out of its own counts, and the hub figures unfiltered', async () => {
    const urdu = await reads.quranVideoFacets({ topic: quranTopic, language: 'ur' });
    expect(urdu.hub).toEqual({
      videos: 5,
      explaining: 3,
      featured: 1,
      languages: 3,
      surahs: 3,
      seconds: 9_800,
    });
    expect(urdu.shelves).toEqual({ all: 2, explaining: 1 });
    // Every language is still offered, with what choosing it would show.
    expect(urdu.languages.items.map((facet) => facet.id)).toEqual(['en', 'ur', 'ar']);
    expect(urdu.speakers.items).toEqual(
      [
        { id: people.historicalPersonId, videos: 1 },
        { id: people.linkedPersonId, videos: 1 },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    );
    expect(urdu.lengths).toEqual([
      { length: 'short', videos: 1 },
      { length: 'long', videos: 1 },
    ]);
    expect(urdu.surahs).toEqual([{ surah: 18, owners: 1 }]);

    const explaining = await reads.quranVideoFacets({
      topic: quranTopic,
      shelf: 'explains',
    });
    expect(explaining.languages.items).toEqual([
      { id: 'ar', videos: 1 },
      { id: 'en', videos: 1 },
      { id: 'ur', videos: 1 },
    ]);
    expect(explaining.speakers.items).toEqual([{ id: people.linkedPersonId, videos: 2 }]);
    expect(explaining.series.items).toEqual([]);
    // The shelves themselves are never narrowed by the shelf.
    expect(explaining.shelves).toEqual({ all: 5, explaining: 3 });

    const long = await reads.quranVideoFacets({ topic: quranTopic, length: 'long' });
    expect(long.shelves).toEqual({ all: 2, explaining: 1 });
    expect(long.lengths).toEqual([
      { length: 'short', videos: 1 },
      { length: 'medium', videos: 1 },
      { length: 'long', videos: 2 },
    ]);
    expect(long.surahs).toEqual([{ surah: 1, owners: 1 }]);
  });
});
