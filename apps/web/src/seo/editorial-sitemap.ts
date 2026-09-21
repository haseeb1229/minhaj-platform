import 'server-only';
import { localeSchema } from '@minhaj/contracts';
import { pagePath } from '@minhaj/contracts/editorial';
import { editorialReadRuntime } from '@/composition/editorial-read';
import { publicIndexingEnabled } from '@/config/indexing';
import { absoluteUrl } from '@/config/origin';
import type { SitemapPartition, SitemapEntry } from './sitemap';

/** Read to exhaustion in SQL-safe pages; partition limits are never corpus limits. */
export async function editorialSitemapPartitions(): Promise<readonly SitemapPartition[]> {
  if (!publicIndexingEnabled()) return [];
  const result: SitemapPartition[] = [];
  for (const kind of ['article', 'page'] as const) {
    const buckets = new Map(
      localeSchema.options.map((locale) => [locale, [] as SitemapEntry[]]),
    );
    let offset = 0;
    while (true) {
      const batch =
        kind === 'article'
          ? await editorialReadRuntime().articleSitemap(offset, 500)
          : await editorialReadRuntime().pageSitemap(offset, 500);
      for (const row of batch) {
        if (kind === 'page' && row.routeBinding === null)
          throw new Error('Published Page route binding is missing.');
        const path =
          kind === 'article'
            ? '/library/articles/' + encodeURIComponent(row.slug)
            : pagePath(row.routeBinding ?? '', row.slug);
        for (const locale of row.languages)
          buckets.get(locale)?.push({
            loc: absoluteUrl('/' + locale + path),
            lastmod: row.updatedAt.toISOString(),
          });
      }
      if (batch.length < 500) break;
      offset += batch.length;
    }
    for (const [locale, urls] of buckets)
      if (urls.length)
        result.push({ segment: kind === 'article' ? 'articles' : 'pages', locale, urls });
  }
  return mergePagePartitions(result);
}

/** Shell and published Pages share the canonical pages segment and filename. */
export function mergePagePartitions(
  partitions: readonly SitemapPartition[],
): readonly SitemapPartition[] {
  const buckets = new Map<
    string,
    {
      segment: string;
      locale: SitemapPartition['locale'];
      urls: Map<string, SitemapEntry>;
    }
  >();
  for (const partition of partitions) {
    const key = partition.segment + ':' + partition.locale;
    const bucket = buckets.get(key) ?? {
      segment: partition.segment,
      locale: partition.locale,
      urls: new Map<string, SitemapEntry>(),
    };
    for (const url of partition.urls) bucket.urls.set(url.loc, url);
    buckets.set(key, bucket);
  }
  return [...buckets.values()].flatMap((bucket) => {
    const urls = [...bucket.urls.values()];
    const result: SitemapPartition[] = [];
    for (let offset = 0; offset < urls.length; offset += 5000) {
      const part = offset / 5000 + 1;
      result.push({
        segment: bucket.segment,
        locale: bucket.locale,
        ...(part > 1 ? { part } : {}),
        urls: urls.slice(offset, offset + 5000),
      });
    }
    return result;
  });
}
