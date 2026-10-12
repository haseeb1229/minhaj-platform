import 'server-only';

import { localeSchema, type Locale } from '@minhaj/contracts';

import { hadithReadRuntime } from '@/composition/hadith-read';
import { hadithCitationPath } from '@/components/hadith/presentation';
import { publicIndexingEnabled } from '@/config/indexing';
import { absoluteUrl } from '@/config/origin';
import type { SitemapEntry, SitemapPartition } from './sitemap';

/**
 * The `hadith` sitemap segment — Phase 19's canonical citations (ROUTE_MAP.md
 * §9.4 names the segment).
 *
 * ONLY WHILE AN APPROVED ACTIVATION STANDS. An inactive section has nothing to
 * advertise, and a FIXTURE activation is engineering proof text that must
 * never be offered to a search engine — so the segment is empty in both,
 * decided here before anything is enumerated.
 *
 * ONLY CANONICAL CITATIONS: `/hadith/{collectionSlug}/{hadithNumber}`, once per
 * interface locale — the citation page is the sourced text in fully translated
 * chrome, so every locale's address is a genuine version of it. Never a
 * structural page, a topic view, the search page or a paged listing.
 * `lastmod` is the citation's own modification instant, never the build's. The
 * 5,000-URL split is the shared merge's.
 *
 * READ ONLY BY THE SITEMAP ROUTE HANDLERS, which are dynamic, so a build needs
 * no database; nothing is read at all while public indexing is disabled.
 */

const SEGMENT = 'hadith';

/** A bounded database page; the reader enumerates to exhaustion in these. */
const READ_BATCH = 1_000;

export async function hadithSitemapPartitions(): Promise<readonly SitemapPartition[]> {
  // FAIL CLOSED FIRST, and before any query.
  if (!publicIndexingEnabled()) return [];

  const reader = hadithReadRuntime().reader;
  const availability = await reader.availability();
  if (!availability.active || availability.mode !== 'approved') return [];

  const buckets = new Map<Locale, SitemapEntry[]>(
    localeSchema.options.map((locale) => [locale, []]),
  );
  for (let offset = 0; ; offset += READ_BATCH) {
    const batch = await reader.citationSitemap(offset, READ_BATCH);
    for (const row of batch) {
      const path = hadithCitationPath(row.collectionSlug, row.number);
      for (const [locale, urls] of buckets)
        urls.push({
          loc: absoluteUrl(`/${locale}${path}`),
          lastmod: row.lastModified.toISOString(),
        });
    }
    if (batch.length < READ_BATCH) break;
  }

  const partitions: SitemapPartition[] = [];
  for (const [locale, urls] of buckets)
    if (urls.length > 0) partitions.push({ segment: SEGMENT, locale, urls });
  return partitions;
}
