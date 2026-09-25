import { afterAll, describe, expect, it, vi } from 'vitest';

import type { PublicNews } from '../../packages/contracts/src/editorial/index.ts';

/**
 * Phase 13 — what a News page claims to search engines, and how its queries
 * are read.
 *
 * THE INDEXING POSTURE IS SET PER TEST. The deployed posture is pre-adoption —
 * nothing is indexable and no structured data is emitted (ROUTE_MAP.md §9.5) —
 * which would satisfy every assertion below vacuously. The switch
 * `next.config.ts` substitutes is flipped in-process, as the Phase-5 SEO proof
 * does, so the canonical URL, the alternates and the `NewsArticle` claim are
 * checked for what they SAY; the fail-closed posture is asserted separately.
 */

const ORIGIN = 'https://news-seo.proof.invalid';

async function withIndexing(enabled: boolean) {
  vi.resetModules();
  process.env['MINHAJ_BUILD_PUBLIC_INDEXING_ENABLED'] = enabled ? 'true' : 'false';
  process.env['AUTH_BASE_URL'] = ORIGIN;
  return import('../../apps/web/src/components/editorial/presentation.ts');
}

afterAll(() => {
  delete process.env['MINHAJ_BUILD_PUBLIC_INDEXING_ENABLED'];
});

const translation = (languageCode: 'en' | 'ur' | 'ar', title: string) => ({
  languageCode,
  title,
  excerpt: 'Synthetic summary',
  seoTitle: '',
  seoDescription: '',
  html: '<p>Synthetic</p>',
});

function record(overrides: Partial<PublicNews> = {}): PublicNews {
  return {
    kind: 'news-article',
    slug: 'synthetic-news',
    primaryLanguage: 'ur',
    translations: [translation('ur', 'آزمائشی خبر'), translation('en', 'Synthetic news')],
    topicIds: [],
    contributors: [],
    coverage: null,
    publishedAt: new Date('2034-02-03T04:05:06.000Z'),
    updatedAt: new Date('2034-02-04T00:00:00.000Z'),
    ...overrides,
  };
}

const AUTHORS = [{ slug: 'synthetic-author', name: 'Synthetic Author' }];

describe('NewsArticle structured data', () => {
  it('claims only the headline, language, address, dates and credited People', async () => {
    const { newsStructuredData } = await withIndexing(true);
    const data = newsStructuredData(record(), 'en', AUTHORS);
    expect(data).toEqual({
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      headline: 'Synthetic news',
      inLanguage: 'en',
      url: `${ORIGIN}/en/news/synthetic-news`,
      mainEntityOfPage: `${ORIGIN}/en/news/synthetic-news`,
      datePublished: '2034-02-03T04:05:06.000Z',
      dateModified: '2034-02-04T00:00:00.000Z',
      author: [
        {
          '@type': 'Person',
          name: 'Synthetic Author',
          url: `${ORIGIN}/en/people/synthetic-author`,
        },
      ],
    });
    // Never an image, a publisher, a logo or an organisation.
    for (const claim of ['image', 'publisher', 'logo', 'Organization'])
      expect(JSON.stringify(data)).not.toContain(claim);
  });

  it('describes the language actually shown, at that language’s address', async () => {
    const { newsStructuredData } = await withIndexing(true);
    // No Arabic exists: the reader sees the Urdu original, and the claim says so.
    const data = newsStructuredData(record(), 'ar', []);
    expect(data).toMatchObject({
      inLanguage: 'ur',
      url: `${ORIGIN}/ur/news/synthetic-news`,
    });
    expect(data).not.toHaveProperty('author');
  });

  it('claims a press release at its own address, and no author for a statement', async () => {
    const { newsStructuredData } = await withIndexing(true);
    expect(
      newsStructuredData(record({ kind: 'press-release' }), 'en', AUTHORS),
    ).toMatchObject({
      '@type': 'NewsArticle',
      url: `${ORIGIN}/en/news/press-releases/synthetic-news`,
      author: [{ name: 'Synthetic Author' }],
    });
    const statement = newsStructuredData(record({ kind: 'statement' }), 'en', AUTHORS);
    expect(statement).toMatchObject({
      url: `${ORIGIN}/en/news/statements/synthetic-news`,
    });
    expect(statement).not.toHaveProperty('author');
  });

  it('claims no article at all for a summary of another outlet’s coverage', async () => {
    const { newsStructuredData } = await withIndexing(true);
    expect(
      newsStructuredData(
        record({
          kind: 'media-coverage',
          coverage: { outlet: 'Synthetic Outlet', sourceUrl: null, sourceDate: null },
        }),
        'en',
        AUTHORS,
      ),
    ).toBeNull();
  });
});

describe('canonical and hreflang', () => {
  it('lists only the languages the record genuinely exists in, and canonicalises to the one shown', async () => {
    const { newsMetadata } = await withIndexing(true);
    const metadata = newsMetadata(record(), 'ar');
    expect(metadata.robots).toEqual({ index: true, follow: true });
    expect(metadata.alternates?.canonical).toBe(`${ORIGIN}/ur/news/synthetic-news`);
    expect(metadata.alternates?.languages).toEqual({
      en: `${ORIGIN}/en/news/synthetic-news`,
      ur: `${ORIGIN}/ur/news/synthetic-news`,
      'x-default': `${ORIGIN}/en/news/synthetic-news`,
    });
  });

  it('points x-default at the original language when no English version exists', async () => {
    const { newsMetadata } = await withIndexing(true);
    const metadata = newsMetadata(
      record({ kind: 'statement', translations: [translation('ur', 'آزمائشی بیان')] }),
      'en',
    );
    expect(metadata.alternates?.languages).toEqual({
      ur: `${ORIGIN}/ur/news/statements/synthetic-news`,
      'x-default': `${ORIGIN}/ur/news/statements/synthetic-news`,
    });
  });

  it('claims nothing on the pre-adoption origin', async () => {
    const { newsMetadata } = await withIndexing(false);
    const metadata = newsMetadata(record(), 'en');
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.alternates).toBeUndefined();
  });
});

describe('query semantics', () => {
  it('reads the archive query tolerantly and bounds the offset', async () => {
    const { readNewsArchiveQuery, readNewsOffset, newsArchivePath } =
      await withIndexing(false);
    expect(readNewsArchiveQuery({ year: '2034', month: '2' })).toEqual({
      year: 2034,
      month: 2,
      offset: 0,
    });
    expect(readNewsArchiveQuery({ month: '2' })).toEqual({
      year: null,
      month: null,
      offset: 0,
    });
    expect(readNewsArchiveQuery({ year: '1899', month: '13' })).toEqual({
      year: null,
      month: null,
      offset: 0,
    });
    expect(readNewsArchiveQuery({ year: ['2034', '2035'] }).year).toBeNull();
    expect(readNewsOffset({ offset: '40' })).toBe(40);
    expect(readNewsOffset({ offset: '-1' })).toBe(0);
    expect(readNewsOffset({ offset: '999999999' })).toBe(0);
    expect(newsArchivePath('ur', { year: 2034, month: 2 }, 20)).toBe(
      '/ur/news/archive?year=2034&month=2&offset=20',
    );
    expect(newsArchivePath('en', { year: null, month: 2 })).toBe('/en/news/archive');
  });
});
