import 'server-only';

import { localeSchema, type Locale } from '@minhaj/contracts';

import { quranReadRuntime } from '@/composition/quran-read';
import { ayahPathOf } from '@/components/quran/presentation';
import { publicIndexingEnabled } from '@/config/indexing';
import { absoluteUrl } from '@/config/origin';
import type { SitemapEntry, SitemapPartition } from './sitemap';

/**
 * The `quran` sitemap segment — Phase 18's canonical Ayah citations
 * (ROUTE_MAP.md §9.4 names the segment).
 *
 * ONLY WHILE AN APPROVED CORPUS IS ACTIVE. An inactive corpus has nothing to
 * advertise, and a FIXTURE corpus is engineering proof text that must never be
 * offered to a search engine — so the segment is empty in both, decided here
 * before anything is enumerated as well as by the reader, which returns rows
 * for an approved corpus only.
 *
 * ONLY CANONICAL CITATIONS: `/quran/surah/{surah}/{ayah}`, once per interface
 * locale — the Ayah page is the canonical Arabic in fully translated chrome,
 * so every locale's address is a genuine version of it. Never a reading
 * preference, a Surah or Juz page with a query, a topic view, the search page
 * or a byte route. `lastmod` is the Ayah's own modification instant, never the
 * build's. The 5,000-URL split is the shared merge's.
 *
 * READ ONLY BY THE SITEMAP ROUTE HANDLERS, which are dynamic, so a build needs
 * no database; nothing is read at all while public indexing is disabled.
 */

const SEGMENT = 'quran';

/** A bounded database page; the reader enumerates to exhaustion in these. */
const READ_BATCH = 1_000;

export async function quranSitemapPartitions(): Promise<readonly SitemapPartition[]> {
  // FAIL CLOSED FIRST, and before any query.
  if (!publicIndexingEnabled()) return [];

  const reader = quranReadRuntime().reader;
  const availability = await reader.availability();
  if (!availability.active || availability.mode !== 'approved') return [];

  const buckets = new Map<Locale, SitemapEntry[]>(
    localeSchema.options.map((locale) => [locale, []]),
  );
  for (let offset = 0; ; offset += READ_BATCH) {
    const batch = await reader.ayahSitemap(offset, READ_BATCH);
    for (const row of batch) {
      const path = ayahPathOf({ surah: row.surah, ayah: row.ayah });
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
