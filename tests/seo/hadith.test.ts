import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  HadithAvailability,
  HadithSitemapEntry,
} from '../../packages/contracts/src/hadith/index.ts';

/**
 * PHASE 19 — what the Hadith surfaces claim to a search engine, in each
 * activation state (ROUTE_MAP.md §3.4, §9).
 *
 *   - INACTIVE: nothing is claimed and nothing is enumerated.
 *   - FIXTURE: engineering proof text — `noindex`, no canonical, no
 *     structured data and no sitemap entry, WHATEVER the deployment's indexing
 *     posture says.
 *   - APPROVED: the short citation as canonical, all three interface locales as
 *     alternates, a `BreadcrumbList` and nothing more, and a citation sitemap
 *     with each citation's own modification time — and still nothing while the
 *     deployment is not indexable.
 *
 * The reader is a synthetic stand-in: no database, and no Hadith content — the
 * rows are slugs, numbers and dates only.
 */

const ORIGIN = 'https://hadith.proof.invalid';

const reader = {
  availability: vi.fn<() => Promise<HadithAvailability>>(),
  citationSitemap:
    vi.fn<(offset: number, limit: number) => Promise<HadithSitemapEntry[]>>(),
};

vi.mock('../../apps/web/src/composition/hadith-read.ts', () => ({
  hadithReadRuntime: () => ({ reader }),
}));

vi.mock('../../apps/web/src/composition/taxonomy.ts', () => ({
  taxonomyRuntime: () => {
    throw new Error('No Taxonomy read is expected here.');
  },
}));

async function withIndexing(enabled: boolean) {
  vi.resetModules();
  process.env['AUTH_BASE_URL'] = ORIGIN;
  process.env['PUBLIC_INDEXING_ENABLED'] = enabled ? 'true' : 'false';
  process.env['MINHAJ_BUILD_PUBLIC_INDEXING_ENABLED'] = enabled ? 'true' : 'false';
  const [read, sitemap, presentation, metadata] = await Promise.all([
    import('../../apps/web/src/components/hadith/read.ts'),
    import('../../apps/web/src/seo/hadith-sitemap.ts'),
    import('../../apps/web/src/components/hadith/presentation.ts'),
    import('../../apps/web/src/seo/metadata.ts'),
  ]);
  return { ...read, ...sitemap, ...presentation, ...metadata };
}

const INACTIVE: HadithAvailability = { active: false };
const FIXTURE: HadithAvailability = { active: true, mode: 'fixture' };
const APPROVED: HadithAvailability = { active: true, mode: 'approved' };

const CITATION = '/hadith/fixture-collection-a/7';

const originalEnv = { ...process.env };

beforeEach(() => {
  reader.availability.mockReset();
  reader.citationSitemap.mockReset();
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe('Hadith page metadata', () => {
  it('claims nothing while no collection is activated', async () => {
    const { hadithMetadata } = await withIndexing(true);
    const meta = hadithMetadata({
      locale: 'en',
      availability: INACTIVE,
      canonicalPath: '/hadith',
      title: 'Hadith',
    });
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.alternates).toBeUndefined();
  });

  it('never indexes fixture text, even on an indexable deployment', async () => {
    const { hadithMetadata, hadithIndexable } = await withIndexing(true);
    expect(hadithIndexable(FIXTURE)).toBe(false);
    const meta = hadithMetadata({
      locale: 'ur',
      availability: FIXTURE,
      canonicalPath: CITATION,
      title: 'fixture-collection-a, number 7',
    });
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.alternates).toBeUndefined();
  });

  it('claims nothing for an approved activation while the deployment is not indexable', async () => {
    const { hadithMetadata, hadithIndexable } = await withIndexing(false);
    expect(hadithIndexable(APPROVED)).toBe(false);
    const meta = hadithMetadata({
      locale: 'en',
      availability: APPROVED,
      canonicalPath: CITATION,
      title: 'fixture-collection-a, number 7',
    });
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.alternates).toBeUndefined();
  });

  it('canonicalises an approved citation to its short address in every locale', async () => {
    const { hadithMetadata, hadithCitationPath } = await withIndexing(true);
    const path = hadithCitationPath('fixture-collection-a', 7);
    expect(path).toBe(CITATION);
    const meta = hadithMetadata({
      locale: 'ar',
      availability: APPROVED,
      canonicalPath: path,
      title: 'fixture-collection-a, number 7',
    });
    expect(meta.robots).toEqual({ index: true, follow: true });
    expect(meta.alternates?.canonical).toBe(`${ORIGIN}/ar${CITATION}`);
    expect(meta.alternates?.languages).toEqual({
      en: `${ORIGIN}/en${CITATION}`,
      ur: `${ORIGIN}/ur${CITATION}`,
      ar: `${ORIGIN}/ar${CITATION}`,
      'x-default': `${ORIGIN}/en${CITATION}`,
    });
  });

  it('canonicalises a topic view to the topic hub, and only when approved', async () => {
    const view = {
      locale: 'en' as const,
      contentLocales: ['en' as const, 'ur' as const],
      primaryLocale: 'en' as const,
      pathFor: (target: string) => `/${target}/topics/fixture-topic`,
      title: 'Hadith: fixture topic',
    };
    const indexable = await withIndexing(true);
    const meta = indexable.hadithContentMetadata(APPROVED, view);
    expect(meta.robots).toEqual({ index: true, follow: true });
    expect(meta.alternates?.canonical).toBe(`${ORIGIN}/en/topics/fixture-topic`);
    expect(Object.values(meta.alternates?.languages ?? {})).not.toContainEqual(
      expect.stringContaining('/hadith/topics/'),
    );

    for (const state of [FIXTURE, INACTIVE]) {
      const withheld = indexable.hadithContentMetadata(state, view);
      expect(withheld.robots).toEqual({ index: false, follow: false });
      expect(withheld.alternates).toBeUndefined();
    }
  });

  it('keeps Hadith search noindex always, following only an approved, indexable activation', async () => {
    const indexable = await withIndexing(true);
    expect(indexable.hadithSearchRobots(APPROVED)).toEqual({
      index: false,
      follow: true,
    });
    expect(indexable.hadithSearchRobots(FIXTURE)).toEqual({
      index: false,
      follow: false,
    });
    expect(indexable.hadithSearchRobots(INACTIVE)).toEqual({
      index: false,
      follow: false,
    });
    const closed = await withIndexing(false);
    expect(closed.hadithSearchRobots(APPROVED)).toEqual({ index: false, follow: false });
  });
});

describe('Hadith structured data', () => {
  // The pages emit the shared `BreadcrumbData` (components/media/parts.tsx),
  // which renders only when `isContentIndexable({ contentLocales })` holds, from
  // the locales `hadithStructuredLocales` grants and the trail
  // `citationTrail` builds. Those three decide everything it claims.
  const trailOf = (presentation: Awaited<ReturnType<typeof withIndexing>>) =>
    presentation.citationTrail({
      locale: 'en',
      home: 'Home',
      hadith: 'Hadith',
      collection: { slug: 'fixture-collection-a', name: 'fixture-collection-a' },
      book: { slug: 'fixture-book-a', name: 'Book NON_HADITH_FIXTURE_REFERENCE_1' },
      chapter: {
        slug: 'fixture-chapter-a',
        name: 'Chapter NON_HADITH_FIXTURE_REFERENCE_2',
      },
      citation: { number: 7, name: 'fixture-collection-a, number 7' },
    });

  it.each([
    ['inactive', INACTIVE],
    ['fixture', FIXTURE],
  ])('emits nothing for an %s section', async (_label, state) => {
    const { hadithStructuredLocales, isContentIndexable } = await withIndexing(true);
    expect(hadithStructuredLocales(state)).toEqual([]);
    expect(isContentIndexable({ contentLocales: hadithStructuredLocales(state) })).toBe(
      false,
    );
  });

  it('emits nothing for an approved activation on a non-indexable deployment', async () => {
    const { hadithStructuredLocales, isContentIndexable } = await withIndexing(false);
    expect(
      isContentIndexable({ contentLocales: hadithStructuredLocales(APPROVED) }),
    ).toBe(false);
  });

  it('claims the real breadcrumb, ending at the short citation, when approved', async () => {
    const loaded = await withIndexing(true);
    expect(loaded.hadithStructuredLocales(APPROVED)).toEqual(['en', 'ur', 'ar']);
    expect(
      loaded.isContentIndexable({
        contentLocales: loaded.hadithStructuredLocales(APPROVED),
      }),
    ).toBe(true);
    expect(trailOf(loaded)).toEqual([
      { name: 'Home', path: '/en' },
      { name: 'Hadith', path: '/en/hadith' },
      {
        name: 'fixture-collection-a',
        path: '/en/hadith/collections/fixture-collection-a',
      },
      {
        name: 'Book NON_HADITH_FIXTURE_REFERENCE_1',
        path: '/en/hadith/collections/fixture-collection-a/books/fixture-book-a',
      },
      {
        name: 'Chapter NON_HADITH_FIXTURE_REFERENCE_2',
        path: '/en/hadith/collections/fixture-collection-a/books/fixture-book-a/chapters/fixture-chapter-a',
      },
      { name: 'fixture-collection-a, number 7', path: `/en${CITATION}` },
    ]);
  });

  it('omits the chapter step for a citation placed in a book only', async () => {
    const { citationTrail } = await withIndexing(true);
    const trail = citationTrail({
      locale: 'ur',
      home: 'H',
      hadith: 'D',
      collection: { slug: 'fixture-collection-a', name: 'C' },
      book: { slug: 'fixture-book-a', name: 'B' },
      chapter: null,
      citation: { number: 7, name: 'N' },
    });
    expect(trail.map((step) => step.name)).toEqual(['H', 'D', 'C', 'B', 'N']);
    expect(trail.at(-1)?.path).toBe(`/ur${CITATION}`);
  });
});

describe('the hadith sitemap segment', () => {
  it('reads nothing at all while the deployment is not indexable', async () => {
    const { hadithSitemapPartitions } = await withIndexing(false);
    expect(await hadithSitemapPartitions()).toEqual([]);
    expect(reader.availability).not.toHaveBeenCalled();
    expect(reader.citationSitemap).not.toHaveBeenCalled();
  });

  it.each([
    ['inactive', INACTIVE],
    ['fixture', FIXTURE],
  ])('advertises and enumerates nothing for an %s section', async (_label, state) => {
    reader.availability.mockResolvedValue(state);
    const { hadithSitemapPartitions } = await withIndexing(true);
    expect(await hadithSitemapPartitions()).toEqual([]);
    expect(reader.citationSitemap).not.toHaveBeenCalled();
  });

  it('lists approved short citations per locale with each citation’s own lastmod', async () => {
    reader.availability.mockResolvedValue(APPROVED);
    const stamp = new Date('2026-05-01T10:00:00.000Z');
    reader.citationSitemap.mockResolvedValueOnce([
      { collectionSlug: 'fixture-collection-a', number: 1, lastModified: stamp },
      { collectionSlug: 'fixture-collection-b', number: 7, lastModified: stamp },
    ]);
    const { hadithSitemapPartitions } = await withIndexing(true);

    const partitions = await hadithSitemapPartitions();

    expect(partitions.map((p) => `${p.segment}-${p.locale}`)).toEqual([
      'hadith-en',
      'hadith-ur',
      'hadith-ar',
    ]);
    expect(partitions[1]?.urls).toEqual([
      { loc: `${ORIGIN}/ur/hadith/fixture-collection-a/1`, lastmod: stamp.toISOString() },
      { loc: `${ORIGIN}/ur/hadith/fixture-collection-b/7`, lastmod: stamp.toISOString() },
    ]);
    for (const partition of partitions)
      for (const url of partition.urls) {
        expect(url.loc).not.toContain('?');
        expect(url.loc).not.toContain('/collections/');
      }
  });

  it('enumerates to exhaustion in bounded reads', async () => {
    reader.availability.mockResolvedValue(APPROVED);
    const stamp = new Date('2026-05-01T10:00:00.000Z');
    const full = Array.from({ length: 1_000 }, (_, index) => ({
      collectionSlug: 'fixture-collection-a',
      number: index + 1,
      lastModified: stamp,
    }));
    reader.citationSitemap
      .mockResolvedValueOnce(full)
      .mockResolvedValueOnce([
        { collectionSlug: 'fixture-collection-b', number: 1, lastModified: stamp },
      ]);
    const { hadithSitemapPartitions } = await withIndexing(true);

    const partitions = await hadithSitemapPartitions();

    expect(reader.citationSitemap.mock.calls).toEqual([
      [0, 1_000],
      [1_000, 1_000],
    ]);
    expect(partitions.find((p) => p.locale === 'en')?.urls).toHaveLength(1_001);
  });
});
