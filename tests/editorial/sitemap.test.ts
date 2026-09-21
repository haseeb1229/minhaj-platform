import { afterEach, describe, expect, it, vi } from 'vitest';
const readers = vi.hoisted(() => ({ articleSitemap: vi.fn(), pageSitemap: vi.fn() }));
vi.mock('@/composition/editorial-read', () => ({ editorialReadRuntime: () => readers }));
vi.mock('@/config/origin', () => ({
  absoluteUrl: (path: string) => 'https://proof.invalid' + path,
}));
import {
  editorialSitemapPartitions,
  mergePagePartitions,
} from '../../apps/web/src/seo/editorial-sitemap';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe('Editorial sitemap completeness', () => {
  it('fails closed before activation without querying content', async () => {
    vi.stubEnv('MINHAJ_BUILD_PUBLIC_INDEXING_ENABLED', 'false');
    expect(await editorialSitemapPartitions()).toEqual([]);
    expect(readers.articleSitemap).not.toHaveBeenCalled();
  });
  it('reads beyond the SQL batch and advertises only actual translations', async () => {
    vi.stubEnv('MINHAJ_BUILD_PUBLIC_INDEXING_ENABLED', 'true');
    const rows = Array.from({ length: 1001 }, (_, i) => ({
      slug: 'proof-' + i,
      languages: ['ur'],
      updatedAt: new Date('2026-09-20T00:00:00Z'),
      routeBinding: null,
    }));
    readers.articleSitemap.mockImplementation(async (offset: number, limit: number) =>
      rows.slice(offset, offset + limit),
    );
    readers.pageSitemap.mockResolvedValue([
      {
        slug: 'page',
        routeBinding: '/help',
        languages: ['en'],
        updatedAt: rows[0]!.updatedAt,
      },
    ]);
    const partitions = await editorialSitemapPartitions();
    expect(readers.articleSitemap.mock.calls).toEqual([
      [0, 500],
      [500, 500],
      [1000, 500],
    ]);
    const articles = partitions.filter((p) => p.segment === 'articles');
    expect(articles).toHaveLength(1);
    expect(articles[0]!.locale).toBe('ur');
    expect(articles[0]!.urls).toHaveLength(1001);
    expect(articles[0]!.urls[1000]!.loc).toBe(
      'https://proof.invalid/ur/library/articles/proof-1000',
    );
    expect(partitions.find((p) => p.segment === 'pages')!.urls[0]!.loc).toBe(
      'https://proof.invalid/en/help',
    );
  });
  it('partitions every URL and deduplicates replaced shell destinations', () => {
    const urls = Array.from({ length: 5001 }, (_, i) => ({
      loc: 'https://proof.invalid/en/help/' + i,
    }));
    const partitions = mergePagePartitions([
      { segment: 'pages', locale: 'en', urls },
      { segment: 'pages', locale: 'en', urls: [urls[0]!] },
    ]);
    expect(partitions.map((p) => p.urls.length)).toEqual([5000, 1]);
    expect(partitions[1]!.part).toBe(2);
  });
});
