import 'server-only';

import { localeSchema, type Locale } from '@minhaj/contracts';

import { absoluteUrl } from '@/config/origin';
import { publicIndexingEnabled } from '@/config/indexing';
import { indexableRoutes, pathFor } from '@/shell/registry';

/**
 * The machine sitemap, as a partitioned index (ROUTE_MAP.md §9.4).
 *
 * THE SHAPE IS THE DELIVERABLE, NOT THE CONTENTS. `/sitemap.xml` is an INDEX
 * referencing `/sitemaps/{segment}-{locale}.xml`, because a corpus with tens of
 * thousands of Quran ayah URLs must not share one file with a handful of news
 * items — mixing them defeats diagnosis, and each child has specification
 * limits to stay inside. Phase 4 has one segment to partition, and the shape it
 * arrives in is the shape every later segment slots into.
 *
 * ONLY GENUINELY ELIGIBLE URLS CONTRIBUTE, and an empty partition is not
 * emitted at all. The seventeen eventual segments ROUTE_MAP.md §9.4 names —
 * topics, people, quran, hadith, books and the rest — belong to contexts that
 * have not shipped, so they are not listed here as empty promises. A sitemap
 * advertising a URL that does not exist is worse than no sitemap.
 *
 * NO `lastmod`. It must reflect genuine content modification and never build or
 * deploy time, because a `lastmod` that changes on every deploy trains crawlers
 * to ignore it (§9.4). The shell routes have no content-modification timestamp
 * to report, so the field is omitted rather than fabricated.
 */

/** One child sitemap: a segment, a locale, and the URLs it covers. */
export interface SitemapPartition {
  readonly segment: string;
  readonly locale: Locale;
  /** Absolute canonical URLs. Never empty — an empty partition is dropped. */
  readonly urls: readonly string[];
}

/**
 * The segment Phase 4 owns.
 *
 * `pages` is ROUTE_MAP.md §9.4's own name for the ordinary page segment. A
 * later domain adds its segment here when it has canonical URLs to contribute,
 * and not before.
 */
const PAGES_SEGMENT = 'pages';

/**
 * Every partition with at least one eligible URL.
 *
 * Returns nothing at all while public indexing is disabled. That is the
 * pre-adoption posture, and it is enforced here as well as in `robots.txt` and
 * in each page's metadata — three surfaces, one decision, so they cannot
 * disagree (ROUTE_MAP.md §9.5).
 */
export function sitemapPartitions(): readonly SitemapPartition[] {
  if (!publicIndexingEnabled()) return [];

  const routes = indexableRoutes();
  if (routes.length === 0) return [];

  return localeSchema.options.map((locale) => ({
    segment: PAGES_SEGMENT,
    locale,
    urls: routes.map((route) => absoluteUrl(pathFor(locale, route))),
  }));
}

/** The child-sitemap path for a partition, exactly as the index advertises it. */
export function partitionPath(partition: SitemapPartition): string {
  return `/sitemaps/${partition.segment}-${partition.locale}.xml`;
}

/**
 * Finds the partition a request names, or `null`.
 *
 * The filename is matched against the partitions that actually EXIST rather
 * than parsed into a segment and a locale, so no request can name a partition
 * into being — `/sitemaps/quran-en.xml` is a 404 today because no Quran
 * partition is produced, not because a parser rejected the string.
 */
export function partitionNamed(filename: string): SitemapPartition | null {
  return (
    sitemapPartitions().find(
      (partition) => partitionPath(partition) === `/sitemaps/${filename}`,
    ) ?? null
  );
}

/** Escapes the five XML entities. */
function xml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** The sitemap index document. */
export function renderSitemapIndex(partitions: readonly SitemapPartition[]): string {
  const entries = partitions
    .map(
      (partition) =>
        `  <sitemap><loc>${xml(absoluteUrl(partitionPath(partition)))}</loc></sitemap>`,
    )
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    entries,
    '</sitemapindex>',
    '',
  ].join('\n');
}

/** One child sitemap document. */
export function renderSitemapPartition(partition: SitemapPartition): string {
  const entries = partition.urls
    .map((url) => `  <url><loc>${xml(url)}</loc></url>`)
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    entries,
    '</urlset>',
    '',
  ].join('\n');
}
