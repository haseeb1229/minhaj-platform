import 'server-only';

import { localeSchema, type Locale } from '@minhaj/contracts';
import { collectionPathOf } from '@minhaj/contracts/editorial';

import { editorialReadRuntime } from '@/composition/editorial-read';
import { publicIndexingEnabled } from '@/config/indexing';
import { absoluteUrl } from '@/config/origin';
import type { SitemapEntry, SitemapPartition } from './sitemap';

/**
 * The `collections` sitemap segment — Phase 15's canonical Collection URLs
 * (ROUTE_MAP.md §9.4 names the segment).
 *
 * ONLY CURRENT CANONICAL URLS OF PUBLISHED COLLECTIONS, at
 * `/collections/{slug}`, once per locale the Collection genuinely has a
 * translation in, `lastmod` from its own modification instant. Never a draft,
 * a Collection in review, a scheduled or archived Collection, a former slug or
 * an `?offset=` page of the listing. The members are their owners' URLs, listed
 * in their owners' segments, never here. The 5,000-URL split is the shared
 * merge's.
 *
 * READ ONLY BY THE SITEMAP ROUTE HANDLERS, which are dynamic, so a build needs no
 * database; nothing is read at all while public indexing is disabled.
 */

const SEGMENT = 'collections';

/** A database page, below SQL Server's parameter limit for the translation relation. */
const READ_BATCH = 500;

export async function collectionSitemapPartitions(): Promise<
  readonly SitemapPartition[]
> {
  if (!publicIndexingEnabled()) return [];
  const buckets = new Map<Locale, SitemapEntry[]>(
    localeSchema.options.map((locale) => [locale, []]),
  );
  for (let offset = 0; ; offset += READ_BATCH) {
    const batch = await editorialReadRuntime().collectionSitemap(offset, READ_BATCH);
    for (const row of batch)
      for (const locale of row.languages)
        buckets.get(locale)?.push({
          loc: absoluteUrl(`/${locale}${collectionPathOf(row.slug)}`),
          lastmod: row.updatedAt.toISOString(),
        });
    if (batch.length < READ_BATCH) break;
  }
  const partitions: SitemapPartition[] = [];
  for (const [locale, urls] of buckets)
    if (urls.length > 0) partitions.push({ segment: SEGMENT, locale, urls });
  return partitions;
}
