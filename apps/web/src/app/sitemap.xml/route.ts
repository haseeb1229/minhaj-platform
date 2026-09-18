import { renderSitemapIndex, sitemapPartitions } from '@/seo/sitemap';

/**
 * `/sitemap.xml` — the sitemap index (ROUTE_MAP.md §9.4).
 *
 * UNPREFIXED, which is why it is here rather than under `[locale]`: the machine
 * sitemaps are one of the five non-locale routes ROUTE_MAP.md §10 rule 6 names,
 * and the proxy's matcher already excludes it from locale routing.
 *
 * A 404 WHILE INDEXING IS DISABLED, and that is the honest answer rather than
 * an evasion. The pre-adoption posture is "no submitted sitemaps"
 * (ROUTE_MAP.md §9.5); serving an empty `<sitemapindex>` would still be serving
 * a sitemap, and an index with no children is not valid against the schema
 * either. Nothing advertises this path in that state — `robots.txt` emits no
 * `Sitemap` directive — so nothing is broken by its absence.
 *
 * A ROUTE HANDLER rather than Next's `sitemap.ts` convention, because that
 * convention generates a flat URL set at `/sitemap.xml` and, with
 * `generateSitemaps`, children at `/sitemap/{id}.xml`. The accepted contract is
 * an index at `/sitemap.xml` whose children live at
 * `/sitemaps/{segment}-{locale}.xml`, and the URLs in an accepted contract are
 * not negotiable against a framework's default naming.
 */
export function GET(): Response {
  const partitions = sitemapPartitions();

  if (partitions.length === 0) {
    return new Response(null, { status: 404 });
  }

  return new Response(renderSitemapIndex(partitions), {
    status: 200,
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  });
}
