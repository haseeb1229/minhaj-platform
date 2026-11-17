import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';
import { createMediaReadService } from '../../apps/web/src/contexts/media/index.ts';

/**
 * News & Events Part 2 against real SQL Server — the photographs' public reads
 * (`photoListing`, `photoListingFacets`, `photoArchivePeriods`,
 * `galleryDirectory`, and the span every PublicGallery now carries):
 *
 *   - the listing holds every PUBLISHED photograph and never a draft: recently
 *     added first, or by the date taken either way — a photograph known only
 *     to its year after that year's dated months, an undated one after every
 *     dated one; each filter narrows it (a year, a month, a PUBLISHED Gallery,
 *     a language described in); bounded pages state the total, and a page
 *     past the end is empty with the total still stated;
 *   - the facets: the whole of the photographs' figures whatever the filter,
 *     and each filter's values counted under every OTHER filter — a draft
 *     Gallery never named;
 *   - the archive's periods: each year and month taken, and a year's photos
 *     known only to it, never an undated one;
 *   - the directory: the LISTED Galleries only (published, holding a public
 *     photograph), in three orders, with their counts, covers and spans of
 *     known dates — derived from the photographs alone.
 *
 * A fresh proof database, so every count is exact. Synthetic rows only.
 */

const live = databaseConfigured ? describe : describe.skip;

const n = (value: string) => `N'${value.replaceAll("'", "''")}'`;

live('News & Events Part 2 — photographs against real SQL Server', () => {
  let db: DisposableDatabase;
  let reads: ReturnType<typeof createMediaReadService>;
  const run = randomUUID().slice(0, 8);
  const photo = {
    p1: randomUUID(),
    p2: randomUUID(),
    p3: randomUUID(),
    p4: randomUUID(),
    p5: randomUUID(),
    p6: randomUUID(),
    p7: randomUUID(),
  };
  const gallery = {
    a: randomUUID(),
    b: randomUUID(),
    c: randomUUID(),
    d: randomUUID(),
    e: randomUUID(),
  };

  const ids = (items: readonly { id: string }[]) =>
    items.map((item) => item.id.toLowerCase());
  const as = (...keys: (keyof typeof photo)[]) =>
    keys.map((key) => photo[key].toLowerCase());
  const galleriesAs = (...keys: (keyof typeof gallery)[]) =>
    keys.map((key) => gallery[key].toLowerCase());

  beforeAll(async () => {
    db = await createProofDatabase();
    const { createMediaPublicReader } =
      await import('../../packages/database/src/index.ts');
    reads = createMediaReadService(createMediaPublicReader());

    // A published Photo must have its own asset (a CHECK, a filtered unique index).
    const row = (
      key: keyof typeof photo,
      fields: {
        readonly state?: 'published' | 'draft';
        readonly taken: readonly [number, number | null, number | null] | null;
        readonly secondsAgo: number;
        readonly labels: readonly (readonly [string, string])[];
      },
    ) => {
      const asset = randomUUID();
      const [year, month, day] = fields.taken ?? [null, null, null];
      const value = (part: number | null) => (part === null ? 'NULL' : String(part));
      return `
      INSERT INTO [dbo].[Asset] ([id],[storageKey],[mediaType],[byteSize],[checksum],[state],[updatedAt]) VALUES
        (N'${asset}', N'media-photos-${key}-${run}', N'image/png', 1024, N'${'b'.repeat(64)}', N'clean', SYSUTCDATETIME());
      INSERT INTO [dbo].[Photo] ([id],[primaryLocale],[state],[credit],[takenYear],[takenMonth],[takenDay],[assetId],[width],[height],[createdAt],[updatedAt]) VALUES
        (N'${photo[key]}', N'en', N'${fields.state ?? 'published'}', NULL, ${value(year)}, ${value(month)}, ${value(day)},
         N'${asset}', 40, 30, DATEADD(SECOND, -${String(fields.secondsAgo)}, SYSUTCDATETIME()), SYSUTCDATETIME());
      ${fields.labels
        .map(
          ([locale, caption]) =>
            `INSERT INTO [dbo].[PhotoLabel] ([photoId],[locale],[altText],[caption]) VALUES (N'${photo[key]}', N'${locale}', NULL, ${n(caption)});`,
        )
        .join('\n')}`;
    };
    const galleryRow = (
      key: keyof typeof gallery,
      state: 'published' | 'draft',
      secondsAgo: number,
      title: string,
      members: readonly (keyof typeof photo)[],
    ) => `
      INSERT INTO [dbo].[Gallery] ([id],[slug],[primaryLocale],[state],[version],[createdAt],[updatedAt]) VALUES
        (N'${gallery[key]}', N'media-photos-${key}-${run}', N'en', N'${state}', 1, DATEADD(SECOND, -${String(secondsAgo)}, SYSUTCDATETIME()), SYSUTCDATETIME());
      INSERT INTO [dbo].[GalleryLabel] ([galleryId],[locale],[title],[description]) VALUES
        (N'${gallery[key]}', N'en', ${n(title)}, N'');
      ${members
        .map(
          (member, position) =>
            `INSERT INTO [dbo].[GalleryItem] ([galleryId],[photoId],[position]) VALUES (N'${gallery[key]}', N'${photo[member]}', ${String(position)});`,
        )
        .join('\n')}`;

    await db.admin.query(`
      ${row('p1', { taken: [1995, 3, 12], secondsAgo: 60, labels: [['en', `One ${run}`]] })}
      ${row('p2', { taken: [1995, 3, null], secondsAgo: 50, labels: [['ur', `دو ${run}`]] })}
      ${row('p3', { taken: [1995, null, null], secondsAgo: 45, labels: [['en', `Three ${run}`]] })}
      ${row('p4', { taken: [1989, null, null], secondsAgo: 40, labels: [['en', `Four ${run}`]] })}
      ${row('p5', { taken: null, secondsAgo: 30, labels: [['ar', `خمسة ${run}`]] })}
      ${row('p6', { state: 'draft', taken: [1995, 3, 1], secondsAgo: 20, labels: [['en', `Draft ${run}`]] })}
      ${row('p7', {
        taken: [2001, 7, 4],
        secondsAgo: 10,
        labels: [
          ['en', `Seven ${run}`],
          ['ur', `سات ${run}`],
        ],
      })}

      ${galleryRow('a', 'published', 30, `Bravo ${run}`, ['p6', 'p2', 'p1'])}
      ${galleryRow('b', 'published', 20, `Alpha ${run}`, ['p3', 'p4', 'p7'])}
      ${galleryRow('c', 'published', 15, `Only a draft ${run}`, ['p6'])}
      ${galleryRow('d', 'draft', 12, `Draft gallery ${run}`, ['p1'])}
      ${galleryRow('e', 'published', 10, `Charlie ${run}`, ['p5'])}
    `);
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  describe('the listing', () => {
    it('lists every published photograph, recently added first, and never a draft', async () => {
      const page = await reads.photoListing();
      expect(ids(page.items)).toEqual(as('p7', 'p5', 'p4', 'p3', 'p2', 'p1'));
      expect(page).toMatchObject({ total: 6, hasMore: false });
    });

    it('orders by the date taken either way, the less precise and the undated last', async () => {
      expect(ids((await reads.photoListing({ sort: 'newest' })).items)).toEqual(
        as('p7', 'p1', 'p2', 'p3', 'p4', 'p5'),
      );
      expect(ids((await reads.photoListing({ sort: 'oldest' })).items)).toEqual(
        as('p4', 'p1', 'p2', 'p3', 'p7', 'p5'),
      );
    });

    it('narrows by a year, a month, a published Gallery and a language — never widening', async () => {
      expect(
        ids((await reads.photoListing({ year: 1995, sort: 'newest' })).items),
      ).toEqual(as('p1', 'p2', 'p3'));
      const march = await reads.photoListing({ year: 1995, month: 3 });
      expect(ids(march.items)).toEqual(as('p2', 'p1'));
      expect(march.total).toBe(2);
      // The draft photograph in the Gallery is not shown; a draft Gallery and
      // one holding only a draft narrow to nothing.
      expect(ids((await reads.photoListing({ gallery: gallery.a })).items)).toEqual(
        as('p2', 'p1'),
      );
      expect(
        ids((await reads.photoListing({ gallery: gallery.a.toUpperCase() })).items),
      ).toEqual(as('p2', 'p1'));
      expect(await reads.photoListing({ gallery: gallery.c })).toMatchObject({
        items: [],
        total: 0,
      });
      expect(await reads.photoListing({ gallery: gallery.d })).toMatchObject({
        items: [],
        total: 0,
      });
      expect(ids((await reads.photoListing({ language: 'ur' })).items)).toEqual(
        as('p7', 'p2'),
      );
      expect(
        ids(
          (await reads.photoListing({ year: 1995, language: 'ur', gallery: gallery.a }))
            .items,
        ),
      ).toEqual(as('p2'));
    });

    it('pages with the view’s total, and says so past the end', async () => {
      const first = await reads.photoListing({ limit: 2 });
      expect(ids(first.items)).toEqual(as('p7', 'p5'));
      expect(first).toMatchObject({ total: 6, hasMore: true });
      const last = await reads.photoListing({ limit: 2, offset: 4 });
      expect(ids(last.items)).toEqual(as('p2', 'p1'));
      expect(last).toMatchObject({ total: 6, hasMore: false });
      expect(await reads.photoListing({ offset: 24 })).toEqual({
        items: [],
        total: 6,
        hasMore: false,
      });
    });
  });

  describe('the facets', () => {
    it('states the whole of the photographs, and counts each filter under every other', async () => {
      const facets = await reads.photoListingFacets({ year: 1995 });
      expect(facets.all).toEqual({
        photos: 6,
        dated: 5,
        firstYear: 1989,
        lastYear: 2001,
        languages: 3,
        galleries: 3,
        inGalleries: 6,
      });
      // The years leave out the year chosen (and its month).
      expect(facets.years).toEqual([
        { year: 2001, photos: 1 },
        { year: 1995, photos: 3 },
        { year: 1989, photos: 1 },
      ]);
      // A month known only to its year is no month.
      expect(facets.months).toEqual([{ month: 3, photos: 2 }]);
      expect(
        facets.galleries.items.map((entry) => [entry.id.toLowerCase(), entry.photos]),
      ).toEqual([
        [gallery.a.toLowerCase(), 2],
        [gallery.b.toLowerCase(), 1],
      ]);
      expect(facets.galleries.items[0]).toMatchObject({
        slug: `media-photos-a-${run}`,
        labels: [{ locale: 'en', title: `Bravo ${run}` }],
      });
      expect(facets.galleries.hasMore).toBe(false);
      expect(facets.languages).toEqual([
        { code: 'en', photos: 2 },
        { code: 'ur', photos: 1 },
      ]);
    });

    it('leaves a Gallery out of its own counts, names no draft Gallery, and has no months without a year', async () => {
      const facets = await reads.photoListingFacets({ gallery: gallery.b });
      expect(facets.years).toEqual([
        { year: 2001, photos: 1 },
        { year: 1995, photos: 1 },
        { year: 1989, photos: 1 },
      ]);
      expect(facets.months).toEqual([]);
      expect(
        facets.galleries.items.map((entry) => [entry.id.toLowerCase(), entry.photos]),
      ).toEqual([
        [gallery.b.toLowerCase(), 3],
        [gallery.a.toLowerCase(), 2],
        [gallery.e.toLowerCase(), 1],
      ]);
      expect(facets.languages).toEqual([
        { code: 'en', photos: 3 },
        { code: 'ur', photos: 1 },
      ]);
    });
  });

  it('builds the archive’s periods from the date taken, and never from an undated photograph', async () => {
    expect(await reads.photoArchivePeriods()).toEqual([
      { year: 2001, month: 7, photos: 1 },
      { year: 1995, month: null, photos: 1 },
      { year: 1995, month: 3, photos: 2 },
      { year: 1989, month: null, photos: 1 },
    ]);
  });

  describe('the galleries directory', () => {
    it('lists only the listed Galleries, in three orders, with the total', async () => {
      const newest = await reads.galleryDirectory();
      expect(ids(newest.items)).toEqual(galleriesAs('e', 'b', 'a'));
      expect(newest).toMatchObject({ total: 3, hasMore: false });
      expect(ids((await reads.galleryDirectory({ sort: 'oldest' })).items)).toEqual(
        galleriesAs('a', 'b', 'e'),
      );
      expect(
        ids((await reads.galleryDirectory({ sort: 'title', titleLocale: 'en' })).items),
      ).toEqual(galleriesAs('b', 'a', 'e'));
      const second = await reads.galleryDirectory({ limit: 2, offset: 2 });
      expect(ids(second.items)).toEqual(galleriesAs('a'));
      expect(second).toMatchObject({ total: 3, hasMore: false });
      expect(await reads.galleryDirectory({ offset: 24 })).toEqual({
        items: [],
        total: 3,
        hasMore: false,
      });
    });

    it('gives each Gallery its public count, cover and span of KNOWN dates', async () => {
      const byId = new Map(
        (await reads.galleryDirectory()).items.map((item) => [
          item.id.toLowerCase(),
          item,
        ]),
      );
      expect(byId.get(gallery.a.toLowerCase())).toMatchObject({
        photoCount: 2,
        cover: { id: photo.p2 },
        span: { first: { year: 1995, month: 3 }, last: { year: 1995, month: 3 } },
      });
      // A year-only end says only its year; the latest end its month.
      expect(byId.get(gallery.b.toLowerCase())).toMatchObject({
        photoCount: 3,
        span: { first: { year: 1989, month: null }, last: { year: 2001, month: 7 } },
      });
      // Nothing dated: no span at all, never an invented one.
      expect(byId.get(gallery.e.toLowerCase())).toMatchObject({
        photoCount: 1,
        span: null,
      });
      expect((await reads.gallery(`media-photos-b-${run}`))?.span).toEqual({
        first: { year: 1989, month: null },
        last: { year: 2001, month: 7 },
      });
      expect(
        (await reads.publicGalleries([gallery.a, gallery.d])).map((item) => item.span),
      ).toEqual([{ first: { year: 1995, month: 3 }, last: { year: 1995, month: 3 } }]);
    });

    it('states an end’s month only when every photograph of that year states one', async () => {
      // p3 (1995, no month) joins the Gallery that held only March 1995.
      await db.admin.query(
        `INSERT INTO [dbo].[GalleryItem] ([galleryId],[photoId],[position]) VALUES (N'${gallery.a}', N'${photo.p3}', 3);`,
      );
      expect((await reads.gallery(`media-photos-a-${run}`))?.span).toEqual({
        first: { year: 1995, month: null },
        last: { year: 1995, month: null },
      });
      await db.admin.query(
        `DELETE FROM [dbo].[GalleryItem] WHERE [galleryId] = N'${gallery.a}' AND [photoId] = N'${photo.p3}';`,
      );
    });
  });
});
