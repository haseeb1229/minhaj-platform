import 'server-only';

import { localeSchema, type Locale } from '@minhaj/contracts';
import { NEWS_KINDS, newsPathOf } from '@minhaj/contracts/editorial';

import { editorialReadRuntime } from '@/composition/editorial-read';
import { publicIndexingEnabled } from '@/config/indexing';
import { absoluteUrl } from '@/config/origin';
import type { SitemapEntry, SitemapPartition } from './sitemap';

/**
 * The `news` sitemap segment — Phase 13's canonical detail URLs (ROUTE_MAP.md
 * §9.4 names the segment).
 *
 * ONLY CURRENT CANONICAL URLS OF PUBLISHED RECORDS, of all four families: each
 * NewsArticle at `/news/{slug}` and each press release, statement and record of
 * media coverage beneath its own listing. Never a draft, a record in review, a
 * scheduled or archived record, a former slug, a `?sort=` or archive query, or a
 * listing. One URL per locale the record genuinely has a translation in — a
 * language it falls back from is not a version of it — and `lastmod` from the
 * record's own modification instant. The 5,000-URL split is the shared merge's.
 *
 * READ ONLY BY THE SITEMAP ROUTE HANDLERS, which are dynamic, so a build needs no
 * database; nothing is read at all while public indexing is disabled.
 */

const SEGMENT = 'news';

/** A database page, below SQL Server's parameter limit for the translation relation. */
const READ_BATCH = 500;

export async function newsSitemapPartitions(): Promise<readonly SitemapPartition[]> {
  if (!publicIndexingEnabled()) return [];
  const buckets = new Map<Locale, SitemapEntry[]>(
    localeSchema.options.map((locale) => [locale, []]),
  );
  for (const kind of NEWS_KINDS) {
    for (let offset = 0; ; offset += READ_BATCH) {
      const batch = await editorialReadRuntime().newsSitemap(kind, offset, READ_BATCH);
      for (const row of batch)
        for (const locale of row.languages)
          buckets.get(locale)?.push({
            loc: absoluteUrl(`/${locale}${newsPathOf(kind, row.slug)}`),
            lastmod: row.updatedAt.toISOString(),
          });
      if (batch.length < READ_BATCH) break;
    }
  }
  const partitions: SitemapPartition[] = [];
  for (const [locale, urls] of buckets)
    if (urls.length > 0) partitions.push({ segment: SEGMENT, locale, urls });
  return partitions;
}
