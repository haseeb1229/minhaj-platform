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
 * Watch Part 1 against real SQL Server — the whole of Media through the Topic
 * Videos read (`scope: 'media'`), and an episode's neighbours:
 *
 *   - the set: EVERY published Video, newest first with the undated last; a
 *     draft is absent, whatever its Topic or format;
 *   - a Topic as a filter, a curated format as a filter, each with the other
 *     filters; the cards it answers; bounded pages with the total;
 *   - the facets: the figures of the view (its format, never a filter), the
 *     formats' facet (every format under the other filters, and `all`) and
 *     the Topics' facet, each leaving its own filter out of its own counts;
 *     a hub's read keeps no Topic facet;
 *   - `seriesNeighbours`: the nearest PUBLISHED episodes either side, a draft
 *     between them skipped, the published episode count, and nothing at all
 *     for a Series that is itself a draft.
 *
 * Synthetic records only, written as rows.
 */

const live = databaseConfigured ? describe : describe.skip;

const n = (value: string) => `N'${value.replaceAll("'", "''")}'`;

live('Watch Part 1 — the whole of Media against real SQL Server', () => {
  let db: DisposableDatabase;
  let people: Phase5Fixture;
  let reads: ReturnType<typeof createMediaReadService>;
  let quranTopic: string;
  let hadithTopic: string;
  const id = {
    adab: randomUUID(),
    bayan: randomUUID(),
    commentary: randomUUID(),
    draft: randomUUID(),
    exegesis: randomUUID(),
    fiqh: randomUUID(),
    gathering: randomUUID(),
  };
  const series = { published: randomUUID(), draft: randomUUID() };
  const run = randomUUID().slice(0, 8);

  const ids = (page: { items: readonly { id: string }[] }) =>
    page.items.map((video) => video.id);
  /** The whole of Media's query. */
  const MEDIA = { scope: 'media' } as const;

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
    hadithTopic = hadith.id;

    const video = (
      key: keyof typeof id,
      fields: {
        readonly state?: 'published' | 'draft';
        readonly featured?: boolean;
        readonly language: string;
        readonly date: string | null;
        readonly seconds: number | null;
        readonly format: string | null;
        readonly series?: { readonly id: string; readonly position: number };
      },
    ) => `
      INSERT INTO [dbo].[Video] ([id],[slug],[primaryLocale],[state],[isFeatured],[provider],[providerVideoId],[availability],[format],[languageCode],[durationSeconds],[publishedOn],[seriesId],[seriesPosition]) VALUES
        (N'${id[key]}', N'media-videos-${key}-${run}', N'en', N'${fields.state ?? 'published'}', ${fields.featured === true ? 1 : 0},
         N'youtube', '${`Mv${randomUUID().replaceAll('-', '').slice(0, 9)}`}', N'available',
         ${fields.format === null ? 'NULL' : `N'${fields.format}'`}, N'${fields.language}',
         ${fields.seconds === null ? 'NULL' : String(fields.seconds)}, ${fields.date === null ? 'NULL' : `'${fields.date}'`},
         ${fields.series === undefined ? 'NULL, NULL' : `N'${fields.series.id}', ${String(fields.series.position)}`});
      INSERT INTO [dbo].[VideoLabel] ([videoId],[locale],[title],[description]) VALUES
        (N'${id[key]}', N'en', ${n(`${key} ${run}`)}, N'');`;
    const topic = (key: keyof typeof id, topicId: string) =>
      `INSERT INTO [dbo].[VideoTopic] ([videoId],[topicId]) VALUES (N'${id[key]}', N'${topicId}');`;

    await db.admin.query(`
      INSERT INTO [dbo].[Series] ([id],[slug],[kind],[primaryLocale],[state]) VALUES
        (N'${series.published}', N'media-circle-${run}', N'program', N'en', N'published'),
        (N'${series.draft}', N'media-draft-circle-${run}', N'series', N'en', N'draft');
      INSERT INTO [dbo].[SeriesLabel] ([seriesId],[locale],[title],[description]) VALUES
        (N'${series.published}', N'en', ${n(`Circle ${run}`)}, N''),
        (N'${series.draft}', N'en', N'Draft circle', N'');

      ${video('adab', { featured: true, language: 'en', date: '2024-01-01', seconds: 600, format: 'lecture' })}
      ${topic('adab', quran.id)}
      INSERT INTO [dbo].[VideoSpeaker] ([videoId],[personId],[position]) VALUES (N'${id.adab}', N'${people.linkedPersonId}', 0);

      ${video('bayan', { language: 'ur', date: '2023-01-01', seconds: 4_000, format: 'interview', series: { id: series.published, position: 1 } })}
      ${topic('bayan', hadith.id)}

      ${video('exegesis', { language: 'ar', date: '2022-06-06', seconds: 1_500, format: 'lecture', series: { id: series.published, position: 2 } })}
      ${topic('exegesis', quran.id)}
      ${topic('exegesis', hadith.id)}

      ${video('draft', { state: 'draft', language: 'en', date: '2025-01-01', seconds: 900, format: 'lecture', series: { id: series.published, position: 4 } })}
      ${topic('draft', quran.id)}

      ${video('commentary', { language: 'ur', date: null, seconds: null, format: null, series: { id: series.published, position: 5 } })}

      ${video('gathering', { language: 'en', date: '2021-01-01', seconds: null, format: 'event', series: { id: series.draft, position: 1 } })}

      ${video('fiqh', { state: 'draft', language: 'ar', date: '2020-01-01', seconds: 300, format: 'documentary' })}
    `);
  }, 600_000);

  afterAll(async () => {
    await db?.close();
  });

  it('is every published Video, newest first with the undated last — never a draft', async () => {
    const page = await reads.topicVideos(MEDIA);
    expect(ids(page)).toEqual([
      id.adab,
      id.bayan,
      id.exegesis,
      id.gathering,
      id.commentary,
    ]);
    expect(page.total).toBe(5);
    expect(page.hasMore).toBe(false);
    // Each card is the hub's card: format, Series (only while published) and
    // speakers, and never a passage.
    const byId = new Map(page.items.map((video) => [video.id, video]));
    expect(byId.get(id.exegesis)).toMatchObject({
      format: 'lecture',
      languageCode: 'ar',
      durationSeconds: 1_500,
      series: { id: series.published, kind: 'program', position: 2 },
      passages: [],
    });
    expect(byId.get(id.gathering)?.series).toBeNull();
    expect(byId.get(id.adab)?.speakerIds).toEqual([people.linkedPersonId]);
  });

  it('narrows by a Topic and by a curated format, with every other filter', async () => {
    const only = async (filter: Record<string, unknown>) =>
      ids(await reads.topicVideos({ ...MEDIA, ...filter }));
    expect(await only({ topic: quranTopic })).toEqual([id.adab, id.exegesis]);
    expect(await only({ topic: hadithTopic })).toEqual([id.bayan, id.exegesis]);
    expect(await only({ format: 'lecture' })).toEqual([id.adab, id.exegesis]);
    expect(await only({ format: 'interview' })).toEqual([id.bayan]);
    // The only documentary is a draft.
    expect(await only({ format: 'documentary' })).toEqual([]);
    expect(await only({ topic: quranTopic, language: 'ar' })).toEqual([id.exegesis]);
    expect(await only({ topic: hadithTopic, format: 'interview' })).toEqual([id.bayan]);
    expect(await only({ format: 'lecture', length: 'short' })).toEqual([id.adab]);
    expect(await only({ series: series.published })).toEqual([
      id.bayan,
      id.exegesis,
      id.commentary,
    ]);
    // A draft Series admits nothing, as on a hub.
    expect(await only({ series: series.draft })).toEqual([]);
    expect(await only({ speaker: people.linkedPersonId })).toEqual([id.adab]);
    expect(await only({ featured: true })).toEqual([id.adab]);
    expect(await only({ sort: 'title' })).toEqual([
      id.adab,
      id.bayan,
      id.commentary,
      id.exegesis,
      id.gathering,
    ]);
    // A hub's read is unchanged: the Topic is membership, never a filter.
    expect(ids(await reads.topicVideos({ topic: quranTopic }))).toEqual([
      id.adab,
      id.exegesis,
    ]);
    expect(ids(await reads.topicVideos({ topic: null }))).toEqual([]);
  });

  it('pages within its bound, stating the total', async () => {
    const first = await reads.topicVideos({ ...MEDIA, limit: 2 });
    expect(ids(first)).toEqual([id.adab, id.bayan]);
    expect(first).toMatchObject({ total: 5, hasMore: true });
    const last = await reads.topicVideos({ ...MEDIA, limit: 2, offset: 4 });
    expect(ids(last)).toEqual([id.commentary]);
    expect(last).toMatchObject({ total: 5, hasMore: false });
    expect(await reads.topicVideos({ ...MEDIA, limit: 2, offset: 10 })).toEqual({
      items: [],
      total: 5,
      hasMore: false,
    });
  });

  it('counts the view, its formats and its Topics, each facet without its own filter', async () => {
    const topics = (rows: readonly { id: string; videos: number }[]) =>
      [...rows].sort((a, b) => a.id.localeCompare(b.id));
    const both = topics([
      { id: quranTopic, videos: 2 },
      { id: hadithTopic, videos: 2 },
    ]);

    const whole = await reads.topicVideoFacets(MEDIA);
    expect(whole.hub).toEqual({
      videos: 5,
      explaining: 0,
      featured: 1,
      languages: 3,
      surahs: 0,
      // 600 + 4,000 + 1,500; the unknown lengths add nothing, the drafts nothing.
      seconds: 6_100,
    });
    expect(whole.formats).toEqual({
      all: 5,
      items: [
        { format: 'lecture', videos: 2 },
        { format: 'event', videos: 1 },
        { format: 'interview', videos: 1 },
      ],
    });
    expect(topics(whole.topics.items)).toEqual(both);
    expect(whole.topics.hasMore).toBe(false);
    expect(whole.series.items.map((entry) => entry.id)).toEqual([series.published]);
    expect(whole.languages.items).toEqual([
      { id: 'en', videos: 2 },
      { id: 'ur', videos: 2 },
      { id: 'ar', videos: 1 },
    ]);

    // A curated view: its figures are its format's; the formats' facet still
    // offers every format; every other facet counts within it.
    const lectures = await reads.topicVideoFacets({ ...MEDIA, format: 'lecture' });
    expect(lectures.hub).toMatchObject({
      videos: 2,
      featured: 1,
      languages: 2,
      seconds: 2_100,
    });
    expect(lectures.formats).toEqual(whole.formats);
    expect(topics(lectures.topics.items)).toEqual(
      topics([
        { id: quranTopic, videos: 2 },
        { id: hadithTopic, videos: 1 },
      ]),
    );
    expect(lectures.languages.items).toEqual([
      { id: 'ar', videos: 1 },
      { id: 'en', videos: 1 },
    ]);

    // A Topic is a filter: the figures stay the view's, the Topics' facet
    // still offers every Topic, and the formats count within it.
    const onQuran = await reads.topicVideoFacets({ ...MEDIA, topic: quranTopic });
    expect(onQuran.hub).toEqual(whole.hub);
    expect(topics(onQuran.topics.items)).toEqual(both);
    expect(onQuran.formats).toEqual({
      all: 2,
      items: [{ format: 'lecture', videos: 2 }],
    });
    expect(onQuran.shelves).toEqual({ all: 2, explaining: 0 });

    // A hub has one Topic: no Topic facet.
    expect((await reads.topicVideoFacets({ topic: quranTopic })).topics).toEqual({
      items: [],
      hasMore: false,
    });
  });

  it('answers an episode’s nearest published neighbours and the published count', async () => {
    const titles = (found: Awaited<ReturnType<typeof reads.seriesNeighbours>>) => ({
      previous: found.previous?.id ?? null,
      next: found.next?.id ?? null,
      episodes: found.episodes,
    });
    expect(
      titles(await reads.seriesNeighbours({ series: series.published, position: 1 })),
    ).toEqual({ previous: null, next: id.exegesis, episodes: 3 });
    // The draft at position 4 is skipped: the next published episode is 5.
    expect(
      titles(await reads.seriesNeighbours({ series: series.published, position: 2 })),
    ).toEqual({ previous: id.bayan, next: id.commentary, episodes: 3 });
    expect(
      titles(await reads.seriesNeighbours({ series: series.published, position: 5 })),
    ).toEqual({ previous: id.exegesis, next: null, episodes: 3 });
    const neighbour = await reads.seriesNeighbours({
      series: series.published,
      position: 1,
    });
    expect(neighbour.next).toMatchObject({
      slug: `media-videos-exegesis-${run}`,
      seriesPosition: 2,
    });
    // A Series that is itself a draft has no published episode.
    expect(
      titles(await reads.seriesNeighbours({ series: series.draft, position: 1 })),
    ).toEqual({ previous: null, next: null, episodes: 0 });
    expect(
      titles(await reads.seriesNeighbours({ series: randomUUID(), position: 1 })),
    ).toEqual({ previous: null, next: null, episodes: 0 });
  });
});
