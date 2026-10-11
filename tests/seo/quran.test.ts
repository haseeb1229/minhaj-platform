import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  QuranAvailability,
  QuranSitemapRow,
} from '../../packages/contracts/src/quran/index.ts';

/**
 * PHASE 18 — what the Quran surfaces claim to a search engine, in each corpus
 * state (Phase 18 §6; ROUTE_MAP.md §9).
 *
 *   - INACTIVE: nothing is claimed and nothing is enumerated.
 *   - FIXTURE: engineering proof text — `noindex`, no canonical, and no sitemap
 *     entry, WHATEVER the deployment's indexing posture says.
 *   - APPROVED: canonical citations without reading preferences, all three
 *     interface locales as alternates, and an Ayah sitemap with each Ayah's own
 *     modification time — and still nothing while the deployment is not
 *     indexable.
 *
 * The reader is a synthetic stand-in: no database, and no Quran content — the
 * rows are citations and dates only.
 */

const ORIGIN = 'https://quran.proof.invalid';

const reader = {
  availability: vi.fn<() => Promise<QuranAvailability>>(),
  ayahSitemap: vi.fn<(offset: number, limit: number) => Promise<QuranSitemapRow[]>>(),
};

vi.mock('../../apps/web/src/composition/quran-read.ts', () => ({
  quranReadRuntime: () => ({ reader }),
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
  const [read, sitemap] = await Promise.all([
    import('../../apps/web/src/components/quran/read.ts'),
    import('../../apps/web/src/seo/quran-sitemap.ts'),
  ]);
  return { ...read, ...sitemap };
}

const INACTIVE: QuranAvailability = { active: false };
const FIXTURE: QuranAvailability = { active: true, mode: 'fixture' };
const APPROVED: QuranAvailability = { active: true, mode: 'approved' };

const originalEnv = { ...process.env };

beforeEach(() => {
  reader.availability.mockReset();
  reader.ayahSitemap.mockReset();
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe('Quran page metadata', () => {
  it('claims nothing while no corpus is active', async () => {
    const { quranMetadata } = await withIndexing(true);
    const meta = quranMetadata({
      locale: 'en',
      availability: INACTIVE,
      canonicalPath: '/quran',
      title: 'Quran',
    });
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.alternates).toBeUndefined();
  });

  it('never indexes fixture text, even on an indexable deployment', async () => {
    const { quranMetadata, quranIndexable } = await withIndexing(true);
    expect(quranIndexable(FIXTURE)).toBe(false);
    const meta = quranMetadata({
      locale: 'ur',
      availability: FIXTURE,
      canonicalPath: '/quran/surah/2/3',
      title: 'Surah 2, Ayah 3',
    });
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.alternates).toBeUndefined();
  });

  it('claims nothing for an approved corpus while the deployment is not indexable', async () => {
    const { quranMetadata } = await withIndexing(false);
    const meta = quranMetadata({
      locale: 'en',
      availability: APPROVED,
      canonicalPath: '/quran/surah/2/3',
      title: 'Surah 2, Ayah 3',
    });
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.alternates).toBeUndefined();
  });

  it('canonicalises an approved citation to its bare address in every locale', async () => {
    const { quranMetadata } = await withIndexing(true);
    const meta = quranMetadata({
      locale: 'ar',
      availability: APPROVED,
      canonicalPath: '/quran/surah/2/3',
      title: 'Surah 2, Ayah 3',
    });
    expect(meta.robots).toEqual({ index: true, follow: true });
    expect(meta.alternates?.canonical).toBe(`${ORIGIN}/ar/quran/surah/2/3`);
    expect(meta.alternates?.languages).toEqual({
      en: `${ORIGIN}/en/quran/surah/2/3`,
      ur: `${ORIGIN}/ur/quran/surah/2/3`,
      ar: `${ORIGIN}/ar/quran/surah/2/3`,
      'x-default': `${ORIGIN}/en/quran/surah/2/3`,
    });
  });

  it('points a mirroring view at the resource it mirrors', async () => {
    const { quranMetadata } = await withIndexing(true);
    const meta = quranMetadata({
      locale: 'en',
      availability: APPROVED,
      canonicalPath: '/quran/recitations',
      title: 'Recitations',
    });
    expect(meta.alternates?.canonical).toBe(`${ORIGIN}/en/quran/recitations`);
  });

  it('keeps Quran search noindex always, following only an approved, indexable corpus', async () => {
    const indexable = await withIndexing(true);
    expect(indexable.quranSearchRobots(APPROVED)).toEqual({ index: false, follow: true });
    expect(indexable.quranSearchRobots(FIXTURE)).toEqual({ index: false, follow: false });
    expect(indexable.quranSearchRobots(INACTIVE)).toEqual({
      index: false,
      follow: false,
    });
    const closed = await withIndexing(false);
    expect(closed.quranSearchRobots(APPROVED)).toEqual({ index: false, follow: false });
  });
});

describe('the quran sitemap segment', () => {
  it('reads nothing at all while the deployment is not indexable', async () => {
    const { quranSitemapPartitions } = await withIndexing(false);
    expect(await quranSitemapPartitions()).toEqual([]);
    expect(reader.availability).not.toHaveBeenCalled();
    expect(reader.ayahSitemap).not.toHaveBeenCalled();
  });

  it.each([
    ['inactive', INACTIVE],
    ['fixture', FIXTURE],
  ])('advertises and enumerates nothing for an %s corpus', async (_label, state) => {
    reader.availability.mockResolvedValue(state);
    const { quranSitemapPartitions } = await withIndexing(true);
    expect(await quranSitemapPartitions()).toEqual([]);
    expect(reader.ayahSitemap).not.toHaveBeenCalled();
  });

  it('lists approved canonical citations per locale with each Ayah’s own lastmod', async () => {
    reader.availability.mockResolvedValue(APPROVED);
    const stamp = new Date('2026-05-01T10:00:00.000Z');
    reader.ayahSitemap.mockResolvedValueOnce([
      { surah: 1, ayah: 1, lastModified: stamp },
      { surah: 2, ayah: 3, lastModified: stamp },
    ]);
    const { quranSitemapPartitions } = await withIndexing(true);

    const partitions = await quranSitemapPartitions();

    expect(partitions.map((p) => `${p.segment}-${p.locale}`)).toEqual([
      'quran-en',
      'quran-ur',
      'quran-ar',
    ]);
    expect(partitions[1]?.urls).toEqual([
      { loc: `${ORIGIN}/ur/quran/surah/1/1`, lastmod: stamp.toISOString() },
      { loc: `${ORIGIN}/ur/quran/surah/2/3`, lastmod: stamp.toISOString() },
    ]);
    for (const partition of partitions)
      for (const url of partition.urls) expect(url.loc).not.toContain('?');
  });

  it('enumerates to exhaustion in bounded reads', async () => {
    reader.availability.mockResolvedValue(APPROVED);
    const stamp = new Date('2026-05-01T10:00:00.000Z');
    const full = Array.from({ length: 1_000 }, (_, index) => ({
      surah: 1 + Math.floor(index / 100),
      ayah: 1 + (index % 100),
      lastModified: stamp,
    }));
    reader.ayahSitemap
      .mockResolvedValueOnce(full)
      .mockResolvedValueOnce([{ surah: 20, ayah: 1, lastModified: stamp }]);
    const { quranSitemapPartitions } = await withIndexing(true);

    const partitions = await quranSitemapPartitions();

    expect(reader.ayahSitemap.mock.calls).toEqual([
      [0, 1_000],
      [1_000, 1_000],
    ]);
    expect(partitions.find((p) => p.locale === 'en')?.urls).toHaveLength(1_001);
  });
});
