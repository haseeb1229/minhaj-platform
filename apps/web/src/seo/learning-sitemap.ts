import 'server-only';

import { localeSchema, type Locale } from '@minhaj/contracts';
import type { LearningSitemapRow } from '@minhaj/contracts/learning';

import { learningReadRuntime } from '@/composition/learning-read';
import { coursePathOf, learningPathPathOf } from '@/components/learning/presentation';
import { publicIndexingEnabled } from '@/config/indexing';
import { absoluteUrl } from '@/config/origin';
import type { SitemapEntry, SitemapPartition } from './sitemap';

/**
 * The `courses` and `learning-paths` sitemap segments — Phase 22's canonical
 * Learn URLs (ROUTE_MAP.md §9.4 names `courses`; a LearningPath is its own
 * resource, so it has its own segment rather than hiding among Courses).
 *
 * ONLY CURRENT CANONICAL URLS OF PUBLISHED RECORDS: each Course at
 * `/learn/courses/{slug}` and each LearningPath at `/learn/paths/{slug}`. Never
 * a draft, an archived record, a former slug, a filtered or paged catalogue
 * view, the trial page's listing or anything under `/my`. One URL per locale
 * the record GENUINELY has words in — a Course described only in Urdu is not
 * listed under `/en` (§9.2) — and `lastmod` from the record's own modification
 * instant, never the build's. The 5,000-URL split is the shared merge's.
 *
 * READ ONLY BY THE SITEMAP ROUTE HANDLERS, which are dynamic, so a build needs no
 * database; nothing is read at all while public indexing is disabled.
 */

/** A bounded database page; the reader enumerates to exhaustion in these. */
const READ_BATCH = 1_000;

const SEGMENTS = Object.freeze({
  course: { segment: 'courses', path: coursePathOf },
  path: { segment: 'learning-paths', path: learningPathPathOf },
} as const);

async function partitionsOf(
  kind: keyof typeof SEGMENTS,
): Promise<readonly SitemapPartition[]> {
  const { segment, path } = SEGMENTS[kind];
  const buckets = new Map<Locale, SitemapEntry[]>(
    localeSchema.options.map((locale) => [locale, []]),
  );
  for (let offset = 0; ; offset += READ_BATCH) {
    const batch: readonly LearningSitemapRow[] = await learningReadRuntime().sitemap(
      kind,
      offset,
      READ_BATCH,
    );
    for (const row of batch)
      for (const locale of row.locales)
        buckets.get(locale as Locale)?.push({
          loc: absoluteUrl(`/${locale}${path(row.slug)}`),
          lastmod: row.updatedAt.toISOString(),
        });
    if (batch.length < READ_BATCH) break;
  }

  // Empty partitions are dropped: an empty segment would advertise nothing.
  const partitions: SitemapPartition[] = [];
  for (const [locale, urls] of buckets)
    if (urls.length > 0) partitions.push({ segment, locale, urls });
  return partitions;
}

export async function learningSitemapPartitions(): Promise<readonly SitemapPartition[]> {
  // FAIL CLOSED FIRST, and before any query.
  if (!publicIndexingEnabled()) return [];
  return [...(await partitionsOf('course')), ...(await partitionsOf('path'))];
}
