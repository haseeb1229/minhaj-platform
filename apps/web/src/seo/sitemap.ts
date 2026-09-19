import 'server-only';

import { localeSchema, type Locale } from '@minhaj/contracts';

import { absoluteUrl } from '@/config/origin';
import { publicIndexingEnabled } from '@/config/indexing';
import { indexableRoutes, pathFor } from '@/shell/registry';

/**
 * The machine sitemap, as a partitioned index (ROUTE_MAP.md §9.4).
 *
 * THE SHAPE IS THE DELIVERABLE. `/sitemap.xml` is an INDEX referencing
 * `/sitemaps/{segment}-{locale}.xml`, because a corpus with tens of thousands of
 * Quran ayah URLs must not share one file with a handful of news items — mixing
 * them defeats diagnosis, and each child has specification limits to stay
 * inside.
 *
 * TWO KINDS OF SEGMENT NOW EXIST, and THIS MODULE OWNS ONLY THE FIRST.
 *
 *   BUILD-BOUND segments are derived from CODE. Phase 4's `pages` segment comes
 *   from the shell route registry, which is reviewed as source, so it is known
 *   when the artifact is built and is computed synchronously. Nothing here
 *   reaches a database, which is what keeps this file safe for `robots.txt` —
 *   generated with the artifact — to import.
 *
 *   CONTENT segments are derived from DATA, and live in `./people-sitemap.ts`.
 *   Phase 5's `people` segment is the published contributor records, which an
 *   administrator changes at runtime: §9.4 says a sitemap is "regenerated on
 *   publication, not on a fixed schedule", and a set of URLs fixed at build time
 *   could not honour that.
 *
 * THE SPLIT IS A BUILD BOUNDARY, NOT A STYLE CHOICE. ARCHITECTURE.md §8.3.1
 * says a prerendered page reads "only non-secret, build-time configuration",
 * because "the build runs in CI and on developer machines that hold no
 * production credential". Keeping the database-backed half in a separate module
 * is what lets the prerendered surfaces keep importing this one.
 *
 * THE INDEXING DECISION IS BUILD-BOUND IN BOTH HALVES, and that is the Phase-4
 * contract that matters. `MINHAJ_BUILD_PUBLIC_INDEXING_ENABLED` is substituted
 * into every server chunk by `next.config.ts`, so a runtime environment edit
 * cannot make the sitemaps disagree with the pages' own metadata. Reading
 * contributor rows per request changes WHICH URLS a partition holds; it does not
 * change WHETHER anything is advertised.
 *
 * ONLY GENUINELY ELIGIBLE URLS CONTRIBUTE, and an empty partition is not emitted
 * at all. The remaining segments ROUTE_MAP.md §9.4 names — quran, hadith, books
 * and the rest — belong to contexts that have not shipped, so they are not
 * listed as empty promises. A sitemap advertising a URL that does not exist is
 * worse than no sitemap.
 */

/**
 * One URL in a sitemap.
 *
 * `lastmod` IS OPTIONAL AND IS OMITTED RATHER THAN FABRICATED. It "must reflect
 * genuine content modification, never build or deploy time, because a `lastmod`
 * that changes on every deploy trains crawlers to ignore it" (§9.4). The shell
 * routes have no content-modification timestamp — their content is code — so
 * they carry none. A contributor record has one, so it does.
 */
export interface SitemapEntry {
  readonly loc: string;
  /** ISO-8601, and only where a genuine modification timestamp exists. */
  readonly lastmod?: string;
}

/** One child sitemap: a segment, a locale, and the URLs it covers. */
export interface SitemapPartition {
  readonly segment: string;
  readonly locale: Locale;
  /** Present only for the second and later numeric split of a large segment. */
  readonly part?: number;
  /** Absolute canonical URLs. Never empty — an empty partition is dropped. */
  readonly urls: readonly SitemapEntry[];
}

/**
 * The segment Phase 4 owns.
 *
 * `pages` is ROUTE_MAP.md §9.4's own name for the ordinary page segment.
 */
const PAGES_SEGMENT = 'pages';

/**
 * Every BUILD-BOUND partition with at least one eligible URL.
 *
 * Synchronous, and reaches no database. Returns nothing at all while public
 * indexing is disabled — the pre-adoption posture, enforced here as well as in
 * `robots.txt` and in each page's metadata, so three surfaces cannot disagree
 * (ROUTE_MAP.md §9.5).
 */
export function sitemapPartitions(): readonly SitemapPartition[] {
  if (!publicIndexingEnabled()) return [];

  const routes = indexableRoutes();
  if (routes.length === 0) return [];

  return localeSchema.options.map((locale) => ({
    segment: PAGES_SEGMENT,
    locale,
    urls: routes.map((route) => ({ loc: absoluteUrl(pathFor(locale, route)) })),
  }));
}

/** The child-sitemap path for a partition, exactly as the index advertises it. */
export function partitionPath(partition: SitemapPartition): string {
  const suffix =
    partition.part === undefined || partition.part === 1 ? '' : `-${partition.part}`;
  return `/sitemaps/${partition.segment}-${partition.locale}${suffix}.xml`;
}

/**
 * Finds the BUILD-BOUND partition a request names, or `null`.
 *
 * The filename is matched against the partitions that actually EXIST rather
 * than parsed into a segment and a locale, so no request can name a partition
 * into being — `/sitemaps/pages-de.xml` is a 404 because no such partition is
 * produced, not because a parser rejected the string, and
 * `/sitemaps/../../etc.xml` is a 404 because it matches nothing.
 *
 * Kept synchronous and in this module because it reaches no database, which is
 * what lets the shell's own behaviour be proven without one and keeps this file
 * safe for `robots.txt` to import at build time.
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
    .map((entry) =>
      entry.lastmod === undefined
        ? `  <url><loc>${xml(entry.loc)}</loc></url>`
        : `  <url><loc>${xml(entry.loc)}</loc><lastmod>${xml(entry.lastmod)}</lastmod></url>`,
    )
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    entries,
    '</urlset>',
    '',
  ].join('\n');
}
