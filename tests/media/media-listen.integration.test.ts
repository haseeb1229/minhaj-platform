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
 * Watch Part 3 against real SQL Server — Listen's public reads
 * (`audioListing`, `audioListingFacets`, `audioSeriesDirectory`,
 * `audioSeriesSummary`, `audioSeriesNeighbours`):
 *
 *   - the listing holds every PUBLISHED track and never a draft, the most
 *     recently recorded first with an undated one last, or by title in the
 *     reader's language; each filter narrows it (a Topic, a language, a
 *     speaker, a PUBLISHED series, a length band), bounded pages state the
 *     total, and a track names its series only while that is published;
 *   - the facets: the whole of Listen's figures whatever the filter, and each
 *     filter's values counted under every OTHER filter;
 *   - the directory: every published AudioSeries (a draft never; one with no
 *     published track, with nothing stated of it), each with what its
 *     PUBLISHED tracks say;
 *   - a summary's first (in series order) and latest (newest dated) published
 *     track, nothing for a draft or unknown series;
 *   - a track's neighbours, a draft between them skipped, and the count.
 *
 * Synthetic records only, written as rows.
 */

const live = databaseConfigured ? describe : describe.skip;

const n = (value: string) => `N'${value.replaceAll("'", "''")}'`;

live('Watch Part 3 — Listen against real SQL Server', () => {
  let db: DisposableDatabase;
  let people: Phase5Fixture;
  let reads: ReturnType<typeof createMediaReadService>;
  let quranTopic: string;
  let hadithTopic: string;
  const run = randomUUID().slice(0, 8);
  const track = {
    t1: randomUUID(),
    t2: randomUUID(),
    t3: randomUUID(),
    t4: randomUUID(),
    t5: randomUUID(),
    t6: randomUUID(),
    t7: randomUUID(),
  };
  const series = {
    alpha: randomUUID(),
    bravo: randomUUID(),
    draft: randomUUID(),
  };

  const ids = (items: readonly { id: string }[]) =>
    items.map((item) => item.id.toLowerCase());
  const as = (...keys: (keyof typeof track)[]) =>
    keys.map((key) => track[key].toLowerCase());

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

    // A published track must have its asset (a CHECK), one asset per track.
    const row = (
      key: keyof typeof track,
      fields: {
        readonly state?: 'published' | 'draft';
        readonly language: string;
        readonly date: string | null;
        readonly seconds: number | null;
        readonly series: { readonly id: string; readonly position: number } | null;
        readonly title: string;
        readonly urdu?: string;
      },
    ) => {
      const asset = randomUUID();
      return `
      INSERT INTO [dbo].[Asset] ([id],[storageKey],[mediaType],[byteSize],[checksum],[state],[updatedAt]) VALUES
        (N'${asset}', N'media-listen-${key}-${run}', N'audio/mpeg', 1024, N'${'a'.repeat(64)}', N'clean', SYSUTCDATETIME());
      INSERT INTO [dbo].[AudioTrack] ([id],[slug],[primaryLocale],[state],[languageCode],[durationSeconds],[recordedOn],[transcript],[assetId],[seriesId],[seriesPosition],[version],[updatedAt]) VALUES
        (N'${track[key]}', N'media-listen-${key}-${run}', N'en', N'${fields.state ?? 'published'}', N'${fields.language}',
         ${fields.seconds === null ? 'NULL' : String(fields.seconds)}, ${fields.date === null ? 'NULL' : `'${fields.date}'`}, NULL,
         N'${asset}',
         ${fields.series === null ? 'NULL, NULL' : `N'${fields.series.id}', ${String(fields.series.position)}`},
         1, SYSUTCDATETIME());
      INSERT INTO [dbo].[AudioTrackLabel] ([trackId],[locale],[title],[description]) VALUES
        (N'${track[key]}', N'en', ${n(fields.title)}, N'')
        ${fields.urdu === undefined ? '' : `, (N'${track[key]}', N'ur', ${n(fields.urdu)}, N'')`};`;
    };
    const speaks = (key: keyof typeof track, person: string, position: number) =>
      `INSERT INTO [dbo].[AudioTrackSpeaker] ([trackId],[personId],[position]) VALUES (N'${track[key]}', N'${person}', ${String(position)});`;
    const about = (key: keyof typeof track, topic: string) =>
      `INSERT INTO [dbo].[AudioTrackTopic] ([trackId],[topicId]) VALUES (N'${track[key]}', N'${topic}');`;

    await db.admin.query(`
      INSERT INTO [dbo].[AudioSeries] ([id],[slug],[primaryLocale],[state],[version],[updatedAt]) VALUES
        (N'${series.alpha}', N'media-listen-alpha-${run}', N'en', N'published', 1, SYSUTCDATETIME()),
        (N'${series.bravo}', N'media-listen-bravo-${run}', N'en', N'published', 1, SYSUTCDATETIME()),
        (N'${series.draft}', N'media-listen-draft-${run}', N'en', N'draft', 1, SYSUTCDATETIME());
      INSERT INTO [dbo].[AudioSeriesLabel] ([seriesId],[locale],[title],[description]) VALUES
        (N'${series.alpha}', N'en', ${n(`Alpha ${run}`)}, N''),
        (N'${series.bravo}', N'en', ${n(`Bravo ${run}`)}, N''),
        (N'${series.draft}', N'en', ${n(`Draft ${run}`)}, N'');

      ${row('t1', { language: 'en', date: '2021-03-01', seconds: 600, series: { id: series.alpha, position: 1 }, title: `Charlie ${run}`, urdu: `ا ${run}` })}
      ${speaks('t1', people.linkedPersonId, 0)}
      ${about('t1', quran.id)}

      ${row('t2', { state: 'draft', language: 'ar', date: '2025-01-01', seconds: 900, series: { id: series.alpha, position: 2 }, title: `Draft track ${run}` })}
      ${speaks('t2', people.linkedPersonId, 0)}

      ${row('t3', { language: 'ur', date: '2023-06-01', seconds: 3000, series: { id: series.alpha, position: 3 }, title: `Alpha track ${run}` })}
      ${speaks('t3', people.linkedPersonId, 0)}
      ${speaks('t3', people.historicalPersonId, 1)}
      ${about('t3', hadith.id)}

      ${row('t4', { language: 'en', date: null, seconds: null, series: { id: series.alpha, position: 4 }, title: `Bravo track ${run}` })}

      ${row('t5', { language: 'ar', date: '2022-01-01', seconds: 4000, series: null, title: `Delta ${run}` })}
      ${speaks('t5', people.historicalPersonId, 0)}
      ${about('t5', quran.id)}

      ${row('t6', { language: 'en', date: '2020-01-01', seconds: 100, series: { id: series.draft, position: 1 }, title: `Echo ${run}` })}

      ${row('t7', { state: 'draft', language: 'en', date: '2026-01-01', seconds: 60, series: null, title: `Hidden ${run}` })}
    `);
  }, 600_000);

  afterAll(async () => {
    await db?.close();
  });

  it('lists every published track, newest recorded first, an undated one last', async () => {
    const page = await reads.audioListing();
    expect(ids(page.items)).toEqual(as('t3', 't5', 't1', 't6', 't4'));
    expect(page).toMatchObject({ total: 5, hasMore: false });

    const first = page.items.find((item) => item.id.toLowerCase() === as('t1')[0]);
    expect(first).toMatchObject({
      slug: `media-listen-t1-${run}`,
      languageCode: 'en',
      durationSeconds: 600,
      recordedOn: '2021-03-01',
      seriesPosition: 1,
      hasAudio: true,
      series: { slug: `media-listen-alpha-${run}`, position: 1 },
    });
    expect(first?.speakerIds.map((id) => id.toLowerCase())).toEqual([
      people.linkedPersonId.toLowerCase(),
    ]);
    // A published track in a DRAFT series is listed, but names no series.
    const echo = page.items.find((item) => item.id.toLowerCase() === as('t6')[0]);
    expect(echo?.series).toBeNull();
  });

  it('orders by title in the reader’s language, then the track’s own', async () => {
    const english = await reads.audioListing({ sort: 'title', titleLocale: 'en' });
    expect(ids(english.items)).toEqual(as('t3', 't4', 't1', 't5', 't6'));
    // In Urdu, t1's own Urdu title (alif) sorts after every Latin one.
    const urdu = await reads.audioListing({ sort: 'title', titleLocale: 'ur' });
    expect(ids(urdu.items)).toEqual(as('t3', 't4', 't5', 't6', 't1'));
  });

  it('narrows by each filter, a draft series admitting nothing', async () => {
    const view = async (query: Record<string, unknown>) =>
      ids((await reads.audioListing(query)).items);
    expect(await view({ language: 'en' })).toEqual(as('t1', 't6', 't4'));
    expect(await view({ speaker: people.linkedPersonId })).toEqual(as('t3', 't1'));
    expect(await view({ topic: quranTopic })).toEqual(as('t5', 't1'));
    expect(await view({ topic: hadithTopic })).toEqual(as('t3'));
    expect(await view({ series: series.alpha })).toEqual(as('t3', 't1', 't4'));
    expect(await view({ series: series.draft })).toEqual([]);
    expect(await view({ length: 'short' })).toEqual(as('t1', 't6'));
    expect(await view({ length: 'medium' })).toEqual(as('t3'));
    expect(await view({ length: 'long' })).toEqual(as('t5'));
    expect(await view({ language: 'en', speaker: people.linkedPersonId })).toEqual(
      as('t1'),
    );
  });

  it('pages within its bound, stating the total, and past the end', async () => {
    const second = await reads.audioListing({ offset: 2, limit: 2 });
    expect(ids(second.items)).toEqual(as('t1', 't6'));
    expect(second).toMatchObject({ total: 5, hasMore: true });
    const past = await reads.audioListing({ offset: 48, limit: 24 });
    expect(past).toEqual({ items: [], total: 5, hasMore: false });
    const none = await reads.audioListing({ language: 'fa' });
    expect(none).toEqual({ items: [], total: 0, hasMore: false });
  });

  it('states the whole of Listen, and counts each filter under the others', async () => {
    const whole = await reads.audioListingFacets();
    expect(whole.all).toEqual({ tracks: 5, seconds: 7700, languages: 3 });
    expect(whole.languages.items).toEqual([
      { id: 'en', tracks: 3 },
      { id: 'ar', tracks: 1 },
      { id: 'ur', tracks: 1 },
    ]);
    expect(whole.series.items).toEqual([
      expect.objectContaining({ slug: `media-listen-alpha-${run}`, tracks: 3 }),
    ]);
    expect(whole.lengths).toEqual([
      { length: 'short', tracks: 2 },
      { length: 'medium', tracks: 1 },
      { length: 'long', tracks: 1 },
    ]);
    expect(
      new Map(whole.speakers.items.map((item) => [item.id.toLowerCase(), item.tracks])),
    ).toEqual(
      new Map([
        [people.linkedPersonId.toLowerCase(), 2],
        [people.historicalPersonId.toLowerCase(), 2],
      ]),
    );

    const english = await reads.audioListingFacets({ language: 'en' });
    // The figures never narrow; the language facet ignores its own filter.
    expect(english.all).toEqual(whole.all);
    expect(english.languages.items).toEqual(whole.languages.items);
    expect(
      english.speakers.items.map((item) => [item.id.toLowerCase(), item.tracks]),
    ).toEqual([[people.linkedPersonId.toLowerCase(), 1]]);
    expect(english.series.items.map((item) => item.tracks)).toEqual([2]);
    expect(english.lengths).toEqual([{ length: 'short', tracks: 2 }]);
    expect(
      english.topics.items.map((item) => [item.id.toLowerCase(), item.tracks]),
    ).toEqual([[quranTopic.toLowerCase(), 1]]);
  });

  it('lists every published audio series with what its published tracks say', async () => {
    const directory = await reads.audioSeriesDirectory();
    expect(directory.hasMore).toBe(false);
    // The busiest first; a draft series never.
    expect(ids(directory.items)).toEqual([
      series.alpha.toLowerCase(),
      series.bravo.toLowerCase(),
    ]);
    const [alpha, bravo] = directory.items;
    expect(alpha).toMatchObject({
      slug: `media-listen-alpha-${run}`,
      labels: [{ locale: 'en', title: `Alpha ${run}`, description: '' }],
      // t1, t3 and the undated t4 — never the draft t2.
      tracks: 3,
      seconds: 3600,
      firstOn: '2021-03-01',
      lastOn: '2023-06-01',
      languages: [
        { id: 'en', tracks: 2 },
        { id: 'ur', tracks: 1 },
      ],
    });
    expect(
      alpha?.speakers.map((value) => [value.id.toLowerCase(), value.tracks]),
    ).toEqual([
      [people.linkedPersonId.toLowerCase(), 2],
      [people.historicalPersonId.toLowerCase(), 1],
    ]);
    expect(new Set(alpha?.topics.map((value) => value.id.toLowerCase()))).toEqual(
      new Set([quranTopic.toLowerCase(), hadithTopic.toLowerCase()]),
    );
    // A published series with no published track states nothing.
    expect(bravo).toMatchObject({
      tracks: 0,
      seconds: 0,
      firstOn: null,
      lastOn: null,
      languages: [],
      speakers: [],
      topics: [],
    });
  });

  it('summarises a series by its first and latest published track', async () => {
    const alpha = await reads.audioSeriesSummary(series.alpha);
    expect(alpha?.entry.tracks).toBe(3);
    expect(alpha?.first?.id.toLowerCase()).toBe(as('t1')[0]);
    // The newest dated — never the undated t4, never the draft t2.
    expect(alpha?.latest?.id.toLowerCase()).toBe(as('t3')[0]);

    const bravo = await reads.audioSeriesSummary(series.bravo);
    expect(bravo).toMatchObject({ first: null, latest: null });
    expect(await reads.audioSeriesSummary(series.draft)).toBeNull();
    expect(await reads.audioSeriesSummary(randomUUID())).toBeNull();
  });

  it('names a track’s published neighbours, a draft between them skipped', async () => {
    const middle = await reads.audioSeriesNeighbours({
      series: series.alpha,
      position: 3,
    });
    expect(middle.previous?.id.toLowerCase()).toBe(as('t1')[0]);
    expect(middle.next?.id.toLowerCase()).toBe(as('t4')[0]);
    expect(middle.tracks).toBe(3);

    const first = await reads.audioSeriesNeighbours({
      series: series.alpha,
      position: 1,
    });
    expect(first.previous).toBeNull();
    expect(first.next?.id.toLowerCase()).toBe(as('t3')[0]);

    expect(
      await reads.audioSeriesNeighbours({ series: series.draft, position: 1 }),
    ).toEqual({ previous: null, next: null, tracks: 0 });
  });
});
