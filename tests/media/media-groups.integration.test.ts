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
 * Watch Part 2 against real SQL Server — the groupings' and the speakers'
 * public reads (`groupDirectory`, `groupSummary`, `groupEpisodes`,
 * `speakerDirectory`):
 *
 *   - a directory holds every PUBLISHED grouping of its kind (a draft Series
 *     never; a programme only in the programmes'; a published grouping with no
 *     published Video yet, with nothing stated of it), each with what its
 *     PUBLISHED Videos say — count, running time, first and last dates,
 *     languages, speakers and Topics commonest first, and the cover of the
 *     first Video in its order that has a poster;
 *   - a summary: the first Video in order and a Series' latest (the newest
 *     date, never an undated one while one is dated); a Playlist has none;
 *     nothing at all for a draft grouping or an unknown one;
 *   - a page of Videos in the grouping's order — a Series' editor's numbers,
 *     a Playlist's places among its PUBLISHED Videos with a draft leaving no
 *     gap — bounded, with the total, past the end empty with the total;
 *   - the speakers' directory: published Videos only, with their languages
 *     and the PUBLISHED Series they speak in.
 *
 * Synthetic records only, written as rows.
 */

const live = databaseConfigured ? describe : describe.skip;

const n = (value: string) => `N'${value.replaceAll("'", "''")}'`;

live('Watch Part 2 — the groupings and the speakers against real SQL Server', () => {
  let db: DisposableDatabase;
  let people: Phase5Fixture;
  let reads: ReturnType<typeof createMediaReadService>;
  let quranTopic: string;
  let hadithTopic: string;
  const run = randomUUID().slice(0, 8);
  const video = {
    a1: randomUUID(),
    a2: randomUUID(),
    a3: randomUUID(),
    a4: randomUUID(),
    b1: randomUUID(),
    d1: randomUUID(),
  };
  const group = {
    alpha: randomUUID(),
    bravo: randomUUID(),
    draft: randomUUID(),
    program: randomUUID(),
    list: randomUUID(),
    hidden: randomUUID(),
  };
  const poster = randomUUID();

  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const ids = (items: readonly { id: string }[]) =>
    items.map((item) => item.id.toLowerCase());

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

    const row = (
      key: keyof typeof video,
      fields: {
        readonly state?: 'published' | 'draft';
        readonly language: string;
        readonly date: string | null;
        readonly seconds: number | null;
        readonly series: { readonly id: string; readonly position: number } | null;
        readonly poster?: boolean;
      },
    ) => `
      INSERT INTO [dbo].[Video] ([id],[slug],[primaryLocale],[state],[isFeatured],[provider],[providerVideoId],[availability],[format],[languageCode],[durationSeconds],[publishedOn],[seriesId],[seriesPosition],[posterAssetId],[posterWidth],[posterHeight]) VALUES
        (N'${video[key]}', N'media-groups-${key}-${run}', N'en', N'${fields.state ?? 'published'}', 0,
         N'youtube', '${`Mg${randomUUID().replaceAll('-', '').slice(0, 9)}`}', N'available', N'lecture', N'${fields.language}',
         ${fields.seconds === null ? 'NULL' : String(fields.seconds)}, ${fields.date === null ? 'NULL' : `'${fields.date}'`},
         ${fields.series === null ? 'NULL, NULL' : `N'${fields.series.id}', ${String(fields.series.position)}`},
         ${fields.poster === true ? `N'${poster}', 1280, 720` : 'NULL, NULL, NULL'});
      INSERT INTO [dbo].[VideoLabel] ([videoId],[locale],[title],[description]) VALUES
        (N'${video[key]}', N'en', ${n(`${key} ${run}`)}, N'');`;
    const speaks = (key: keyof typeof video, person: string, position: number) =>
      `INSERT INTO [dbo].[VideoSpeaker] ([videoId],[personId],[position]) VALUES (N'${video[key]}', N'${person}', ${String(position)});`;
    const about = (key: keyof typeof video, topic: string) =>
      `INSERT INTO [dbo].[VideoTopic] ([videoId],[topicId]) VALUES (N'${video[key]}', N'${topic}');`;

    await db.admin.query(`
      INSERT INTO [dbo].[Asset] ([id],[storageKey],[mediaType],[byteSize],[checksum],[state],[updatedAt]) VALUES
        (N'${poster}', N'media-groups-poster-${run}', N'image/jpeg', 1024, N'${'a'.repeat(64)}', N'clean', SYSUTCDATETIME());

      INSERT INTO [dbo].[Series] ([id],[slug],[kind],[primaryLocale],[state]) VALUES
        (N'${group.alpha}', N'media-groups-alpha-${run}', N'series', N'en', N'published'),
        (N'${group.bravo}', N'media-groups-bravo-${run}', N'series', N'en', N'published'),
        (N'${group.draft}', N'media-groups-draft-${run}', N'series', N'en', N'draft'),
        (N'${group.program}', N'media-groups-program-${run}', N'program', N'en', N'published');
      INSERT INTO [dbo].[SeriesLabel] ([seriesId],[locale],[title],[description]) VALUES
        (N'${group.alpha}', N'en', ${n(`Alpha ${run}`)}, N''),
        (N'${group.bravo}', N'en', ${n(`Bravo ${run}`)}, N''),
        (N'${group.draft}', N'en', ${n(`Draft ${run}`)}, N''),
        (N'${group.program}', N'en', ${n(`Programme ${run}`)}, N'');

      ${row('a1', { language: 'en', date: '2021-03-01', seconds: 600, series: { id: group.alpha, position: 1 } })}
      ${speaks('a1', people.linkedPersonId, 0)}
      ${about('a1', quran.id)}
      INSERT INTO [dbo].[VideoQuranPassage] ([videoId],[position],[surahNumber],[ayahFrom],[ayahTo],[startSeconds]) VALUES
        (N'${video.a1}', 0, 2, 255, 257, 120);

      ${row('a2', { language: 'ur', date: '2023-06-01', seconds: 3000, series: { id: group.alpha, position: 2 }, poster: true })}
      ${speaks('a2', people.linkedPersonId, 0)}
      ${speaks('a2', people.historicalPersonId, 1)}
      ${about('a2', hadith.id)}

      ${row('a3', { state: 'draft', language: 'ar', date: '2025-01-01', seconds: 900, series: { id: group.alpha, position: 3 } })}
      ${speaks('a3', people.linkedPersonId, 0)}

      ${row('a4', { language: 'en', date: null, seconds: null, series: { id: group.alpha, position: 4 } })}

      ${row('b1', { language: 'ur', date: '2022-01-01', seconds: 1200, series: { id: group.bravo, position: 1 } })}
      ${speaks('b1', people.historicalPersonId, 0)}

      ${row('d1', { language: 'ar', date: '2020-01-01', seconds: 300, series: { id: group.draft, position: 1 } })}
      ${speaks('d1', people.historicalPersonId, 0)}

      INSERT INTO [dbo].[Playlist] ([id],[slug],[primaryLocale],[state]) VALUES
        (N'${group.list}', N'media-groups-list-${run}', N'en', N'published'),
        (N'${group.hidden}', N'media-groups-hidden-${run}', N'en', N'draft');
      INSERT INTO [dbo].[PlaylistLabel] ([playlistId],[locale],[title],[description]) VALUES
        (N'${group.list}', N'en', ${n(`List ${run}`)}, N''),
        (N'${group.hidden}', N'en', ${n(`Hidden ${run}`)}, N'');
      INSERT INTO [dbo].[PlaylistVideo] ([playlistId],[videoId],[position]) VALUES
        (N'${group.list}', N'${video.b1}', 0),
        (N'${group.list}', N'${video.a3}', 1),
        (N'${group.list}', N'${video.a1}', 2),
        (N'${group.list}', N'${video.a2}', 3),
        (N'${group.hidden}', N'${video.a1}', 0);
    `);
  }, 600_000);

  afterAll(async () => {
    await db?.close();
  });

  it('lists every published Series of the kind with what its published episodes say', async () => {
    const directory = await reads.groupDirectory('series');
    expect(directory.hasMore).toBe(false);
    const found = ids(directory.items);
    expect(found).toContain(group.alpha);
    expect(found).toContain(group.bravo);
    // A draft Series and a programme are never in the series' directory.
    expect(found).not.toContain(group.draft);
    expect(found).not.toContain(group.program);

    const alpha = directory.items.find((item) => same(item.id, group.alpha));
    expect(alpha).toMatchObject({
      kind: 'series',
      slug: `media-groups-alpha-${run}`,
      labels: [{ locale: 'en', title: `Alpha ${run}`, description: '' }],
      // a1, a2 and the undated a4 — never the draft a3.
      videos: 3,
      seconds: 3600,
      firstOn: '2021-03-01',
      lastOn: '2023-06-01',
      languages: [
        { id: 'en', videos: 2 },
        { id: 'ur', videos: 1 },
      ],
    });
    expect(
      alpha?.speakers.map((value) => [value.id.toLowerCase(), value.videos]),
    ).toEqual([
      [people.linkedPersonId.toLowerCase(), 2],
      [people.historicalPersonId.toLowerCase(), 1],
    ]);
    expect(alpha?.topics.map((value) => value.id.toLowerCase()).sort()).toEqual(
      [quranTopic.toLowerCase(), hadithTopic.toLowerCase()].sort(),
    );
    // The first episode in order with a poster: a2 (a1 has none).
    expect(alpha?.cover?.videoId.toLowerCase()).toBe(video.a2);
    expect(alpha?.cover?.poster).toEqual({ assetId: poster, width: 1280, height: 720 });
  });

  it('keeps a programme to its own directory, stating nothing of it while it has no episode', async () => {
    const programs = await reads.groupDirectory('program');
    const program = programs.items.find((item) => same(item.id, group.program));
    expect(program).toMatchObject({
      kind: 'program',
      videos: 0,
      seconds: 0,
      firstOn: null,
      lastOn: null,
      languages: [],
      speakers: [],
      topics: [],
      cover: null,
    });
    expect(ids(programs.items)).not.toContain(group.alpha);
  });

  it('lists a published Playlist by its published Videos, never a draft list', async () => {
    const playlists = await reads.groupDirectory('playlist');
    expect(ids(playlists.items)).not.toContain(group.hidden);
    const list = playlists.items.find((item) => same(item.id, group.list));
    expect(list).toMatchObject({
      kind: 'playlist',
      videos: 3,
      seconds: 4800,
      firstOn: '2021-03-01',
      lastOn: '2023-06-01',
      languages: [
        { id: 'ur', videos: 2 },
        { id: 'en', videos: 1 },
      ],
    });
    // The first Video in the curated order that has a poster.
    expect(list?.cover?.videoId.toLowerCase()).toBe(video.a2);
  });

  it('opens a Series on its first episode and its latest dated one', async () => {
    const summary = await reads.groupSummary({ of: 'series', id: group.alpha });
    expect(summary?.entry.videos).toBe(3);
    expect(summary?.first?.id.toLowerCase()).toBe(video.a1);
    expect(summary?.first).toMatchObject({
      number: 1,
      languageCode: 'en',
      durationSeconds: 600,
      publishedOn: '2021-03-01',
      poster: null,
      passages: [{ surah: 2, ayahFrom: 255, ayahTo: 257, startSeconds: 120 }],
    });
    expect(summary?.first?.speakerIds.map((id) => id.toLowerCase())).toEqual([
      people.linkedPersonId.toLowerCase(),
    ]);
    // The newest DATED episode — the undated a4 is not "latest".
    expect(summary?.latest?.id.toLowerCase()).toBe(video.a2);
    expect(summary?.latest?.number).toBe(2);

    const bravo = await reads.groupSummary({ of: 'series', id: group.bravo });
    expect(bravo?.first?.id.toLowerCase()).toBe(video.b1);
    expect(bravo?.latest?.id.toLowerCase()).toBe(video.b1);
  });

  it('has no latest for a Playlist, and nothing at all for a draft or unknown grouping', async () => {
    const list = await reads.groupSummary({ of: 'playlist', id: group.list });
    expect(list?.first?.id.toLowerCase()).toBe(video.b1);
    expect(list?.first?.number).toBe(1);
    expect(list?.latest).toBeNull();

    expect(await reads.groupSummary({ of: 'series', id: group.draft })).toBeNull();
    expect(await reads.groupSummary({ of: 'playlist', id: group.hidden })).toBeNull();
    expect(await reads.groupSummary({ of: 'series', id: randomUUID() })).toBeNull();
    // A Series identifier named as a Playlist is not one.
    expect(await reads.groupSummary({ of: 'playlist', id: group.alpha })).toBeNull();
  });

  it('pages a Series’ published episodes in order, with its numbers and the total', async () => {
    const all = await reads.groupEpisodes({ group: { of: 'series', id: group.alpha } });
    expect(ids(all.items)).toEqual([video.a1, video.a2, video.a4]);
    expect(all.items.map((item) => item.number)).toEqual([1, 2, 4]);
    expect(all).toMatchObject({ total: 3, hasMore: false });

    const first = await reads.groupEpisodes({
      group: { of: 'series', id: group.alpha },
      limit: 2,
    });
    expect(ids(first.items)).toEqual([video.a1, video.a2]);
    expect(first).toMatchObject({ total: 3, hasMore: true });
    const second = await reads.groupEpisodes({
      group: { of: 'series', id: group.alpha },
      offset: 2,
      limit: 2,
    });
    expect(ids(second.items)).toEqual([video.a4]);
    expect(second).toMatchObject({ total: 3, hasMore: false });
    // Past the end: nothing, and still the total.
    expect(
      await reads.groupEpisodes({ group: { of: 'series', id: group.alpha }, offset: 48 }),
    ).toEqual({ items: [], total: 3, hasMore: false });
    // A draft Series lists nothing, though its episode is published.
    expect(
      await reads.groupEpisodes({ group: { of: 'series', id: group.draft } }),
    ).toEqual({ items: [], total: 0, hasMore: false });
  });

  it('numbers a Playlist’s Videos by their place among its published ones', async () => {
    const page = await reads.groupEpisodes({ group: { of: 'playlist', id: group.list } });
    // The draft a3 between b1 and a1 leaves no gap.
    expect(ids(page.items)).toEqual([video.b1, video.a1, video.a2]);
    expect(page.items.map((item) => item.number)).toEqual([1, 2, 3]);
    expect(page.total).toBe(3);
    expect(
      await reads.groupEpisodes({ group: { of: 'playlist', id: group.hidden } }),
    ).toEqual({ items: [], total: 0, hasMore: false });
  });

  it('names each speaker’s published Videos, languages and published Series only', async () => {
    const directory = await reads.speakerDirectory();
    const of = (person: string) =>
      directory.items.find((item) => same(item.personId, person));

    // a1 and a2 — never the draft a3.
    const linked = of(people.linkedPersonId);
    expect(linked).toMatchObject({
      videos: 2,
      seconds: 3600,
      lastOn: '2023-06-01',
      languages: [
        { id: 'en', videos: 1 },
        { id: 'ur', videos: 1 },
      ],
      seriesTotal: 1,
    });
    expect(linked?.series.map((value) => [value.id.toLowerCase(), value.videos])).toEqual(
      [[group.alpha, 2]],
    );

    // a2, b1 and d1 — d1 counts as a published Video, but its draft Series is
    // never named.
    const historical = of(people.historicalPersonId);
    expect(historical).toMatchObject({ videos: 3, seriesTotal: 2 });
    expect(historical?.languages).toEqual([
      { id: 'ur', videos: 2 },
      { id: 'ar', videos: 1 },
    ]);
    expect(historical?.series.map((value) => value.id.toLowerCase()).sort()).toEqual(
      [group.alpha, group.bravo].sort(),
    );
    const named = ids(directory.series);
    expect(named).toContain(group.alpha);
    expect(named).toContain(group.bravo);
    expect(named).not.toContain(group.draft);
    expect(directory.series.find((value) => same(value.id, group.alpha))).toMatchObject({
      slug: `media-groups-alpha-${run}`,
      kind: 'series',
    });
  });
});
