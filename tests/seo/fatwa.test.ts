import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  FatwaAvailability,
  FatwaSitemapEntry,
  PublicFatwa,
} from '../../packages/contracts/src/fatwa/index.ts';

/**
 * PHASE 20 — what the Fatwa surfaces claim to a search engine, in each
 * activation state (ROUTE_MAP.md §3.8, §9).
 *
 *   - INACTIVE and FIXTURE: nothing is claimed and nothing is enumerated,
 *     WHATEVER the deployment's indexing posture says.
 *   - APPROVED: a ruling's canonical is its own content language's address, it
 *     lists no alternate it does not have, and the sitemap lists exactly the
 *     rulings the reader says are public now — never a withdrawn or unpublished
 *     one, never a query view — in their own language, with their latest
 *     publication as `lastmod`; still nothing while the deployment is not
 *     indexable.
 *   - A ruling page's metadata is the PUBLISHED ruling's: its title and the
 *     opening of the separately written public question. A private question
 *     cannot reach it — the reader has no such field — and the test plants a
 *     sentinel everywhere a careless implementation could take one from.
 *
 * The reader is a synthetic stand-in: no database, and no ruling text.
 */

const ORIGIN = 'https://fatwa.proof.invalid';

const reader = {
  availability: vi.fn<() => Promise<FatwaAvailability>>(),
  sitemap: vi.fn<(offset: number, limit: number) => Promise<FatwaSitemapEntry[]>>(),
};

vi.mock('../../apps/web/src/composition/fatwa-read.ts', () => ({
  fatwaReadRuntime: () => ({ reader }),
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
    import('../../apps/web/src/components/fatwa/read.ts'),
    import('../../apps/web/src/seo/fatwa-sitemap.ts'),
  ]);
  return { ...read, ...sitemap };
}

const INACTIVE: FatwaAvailability = { active: false };
const FIXTURE: FatwaAvailability = { active: true, mode: 'fixture' };
const APPROVED: FatwaAvailability = { active: true, mode: 'approved' };

const PRIVATE = 'NON_FATWA_FIXTURE_PRIVATE_QUESTION';
const stamp = new Date('2026-09-01T10:00:00.000Z');

function ruling(language: string): PublicFatwa {
  const entry = {
    sequence: 1,
    revisionId: '00000000-0000-4000-8000-000000000002',
    publishedAt: stamp,
    title: 'NON_FATWA_FIXTURE_TITLE',
    publicQuestion: `NON_FATWA_FIXTURE_PUBLIC_QUESTION ${'x'.repeat(300)}`,
    ruling: 'NON_FATWA_FIXTURE_RULING',
    language,
    correctionReason: null,
  };
  return {
    id: '00000000-0000-4000-8000-000000000001',
    slug: 'non-fatwa-fixture-ruling',
    categoryId: '00000000-0000-4000-8000-000000000003',
    topicIds: [],
    current: entry,
    previous: [],
    firstPublishedAt: stamp,
    answeredByPersonId: null,
    publishedByPersonId: null,
    // A careless implementation that spread an unexpected field into metadata
    // would carry this sentinel; nothing may.
    ...({ question: PRIVATE, body: PRIVATE } as object),
  } as PublicFatwa;
}

const originalEnv = { ...process.env };

beforeEach(() => {
  reader.availability.mockReset();
  reader.sitemap.mockReset();
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe('Fatwa page metadata', () => {
  it.each([
    ['inactive', INACTIVE],
    ['fixture', FIXTURE],
  ])(
    'claims nothing for an %s service, even on an indexable deployment',
    async (_label, state) => {
      const fatwa = ruling('ur');
      const { rulingMetadata, fatwaIndexable, fatwaMetadata } = await withIndexing(true);
      expect(fatwaIndexable(state)).toBe(false);
      const meta = rulingMetadata('ur', state, fatwa);
      expect(meta.robots).toEqual({ index: false, follow: false });
      expect(meta.alternates).toBeUndefined();
      const landing = fatwaMetadata({
        locale: 'en',
        availability: state,
        canonicalPath: '/fatwa',
        title: 'Fatwa',
      });
      expect(landing.alternates).toBeUndefined();
    },
  );

  it('claims nothing for an approved service while the deployment is not indexable', async () => {
    const fatwa = ruling('ur');
    const { rulingMetadata } = await withIndexing(false);
    const meta = rulingMetadata('ur', APPROVED, fatwa);
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.alternates).toBeUndefined();
  });

  it('canonicalises an approved ruling to its own language, listing no other', async () => {
    const fatwa = ruling('ur');
    const { rulingMetadata } = await withIndexing(true);
    const meta = rulingMetadata('en', APPROVED, fatwa);
    expect(meta.robots).toEqual({ index: true, follow: true });
    expect(meta.alternates?.canonical).toBe(
      `${ORIGIN}/ur/fatwa/non-fatwa-fixture-ruling`,
    );
    expect(meta.alternates?.languages).toEqual({
      ur: `${ORIGIN}/ur/fatwa/non-fatwa-fixture-ruling`,
      'x-default': `${ORIGIN}/ur/fatwa/non-fatwa-fixture-ruling`,
    });
  });

  it('claims no canonical for a ruling in a language that is not an interface locale', async () => {
    const fatwa = ruling('fr');
    const { rulingMetadata } = await withIndexing(true);
    const meta = rulingMetadata('en', APPROVED, fatwa);
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.alternates).toBeUndefined();
  });

  it('describes a ruling by its title and public question only — never a private question', async () => {
    const fatwa = ruling('en');
    const { rulingMetadata } = await withIndexing(true);
    const meta = rulingMetadata('en', APPROVED, fatwa);
    expect(meta.title).toBe('NON_FATWA_FIXTURE_TITLE');
    expect(String(meta.description).startsWith('NON_FATWA_FIXTURE_PUBLIC_QUESTION')).toBe(
      true,
    );
    expect([...String(meta.description)].length).toBeLessThanOrEqual(151);
    expect(JSON.stringify(meta)).not.toContain(PRIVATE);
  });

  it('keeps Fatwa search noindex always, following only an approved, indexable service', async () => {
    const indexable = await withIndexing(true);
    expect(indexable.fatwaSearchRobots(APPROVED)).toEqual({ index: false, follow: true });
    expect(indexable.fatwaSearchRobots(FIXTURE)).toEqual({ index: false, follow: false });
    expect(indexable.fatwaSearchRobots(INACTIVE)).toEqual({
      index: false,
      follow: false,
    });
  });
});

describe('the fatwa sitemap segment', () => {
  it('reads nothing at all while the deployment is not indexable', async () => {
    const { fatwaSitemapPartitions } = await withIndexing(false);
    expect(await fatwaSitemapPartitions()).toEqual([]);
    expect(reader.availability).not.toHaveBeenCalled();
    expect(reader.sitemap).not.toHaveBeenCalled();
  });

  it.each([
    ['inactive', INACTIVE],
    ['fixture', FIXTURE],
  ])('advertises and enumerates nothing for an %s service', async (_label, state) => {
    reader.availability.mockResolvedValue(state);
    const { fatwaSitemapPartitions } = await withIndexing(true);
    expect(await fatwaSitemapPartitions()).toEqual([]);
    expect(reader.sitemap).not.toHaveBeenCalled();
  });

  it('lists exactly the public rulings, each in its own language, with its latest publication', async () => {
    reader.availability.mockResolvedValue(APPROVED);
    const corrected = new Date('2026-09-20T08:00:00.000Z');
    // The reader returns only rulings public now; a withdrawn or unpublished
    // ruling is simply not in its answer, so it cannot be listed.
    reader.sitemap.mockResolvedValueOnce([
      { slug: 'non-fatwa-fixture-a', language: 'ur', lastModified: corrected },
      { slug: 'non-fatwa-fixture-b', language: 'en', lastModified: stamp },
      { slug: 'non-fatwa-fixture-c', language: 'fr', lastModified: stamp },
    ]);
    const { fatwaSitemapPartitions } = await withIndexing(true);

    const partitions = await fatwaSitemapPartitions();

    expect(partitions).toEqual([
      {
        segment: 'fatwa',
        locale: 'en',
        urls: [
          { loc: `${ORIGIN}/en/fatwa/non-fatwa-fixture-b`, lastmod: stamp.toISOString() },
        ],
      },
      {
        segment: 'fatwa',
        locale: 'ur',
        urls: [
          {
            loc: `${ORIGIN}/ur/fatwa/non-fatwa-fixture-a`,
            lastmod: corrected.toISOString(),
          },
        ],
      },
    ]);
    for (const partition of partitions)
      for (const url of partition.urls) {
        expect(url.loc).not.toContain('?');
        expect(url.loc).not.toMatch(
          /\/fatwa\/(?:latest|popular|categories|topics|search)/u,
        );
      }
  });

  it('enumerates to exhaustion in bounded reads', async () => {
    reader.availability.mockResolvedValue(APPROVED);
    const full = Array.from({ length: 1_000 }, (_, index) => ({
      slug: `non-fatwa-fixture-${String(index)}`,
      language: 'ar',
      lastModified: stamp,
    }));
    reader.sitemap
      .mockResolvedValueOnce(full)
      .mockResolvedValueOnce([
        { slug: 'non-fatwa-fixture-last', language: 'ar', lastModified: stamp },
      ]);
    const { fatwaSitemapPartitions } = await withIndexing(true);

    const partitions = await fatwaSitemapPartitions();

    expect(reader.sitemap.mock.calls).toEqual([
      [0, 1_000],
      [1_000, 1_000],
    ]);
    expect(partitions.map((p) => p.locale)).toEqual(['ar']);
    expect(partitions[0]?.urls).toHaveLength(1_001);
  });
});
