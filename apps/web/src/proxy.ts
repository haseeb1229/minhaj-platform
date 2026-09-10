import createMiddleware from 'next-intl/middleware';

import { routing } from '@/i18n/routing';

/**
 * Locale routing (ROUTE_MAP.md §1.1).
 *
 * `proxy.ts` is the Next 16 convention; `middleware.ts` is its predecessor and
 * Next fails the build when both exist. There is exactly one of these files in
 * the repository, and it does exactly one thing.
 *
 * WHAT IT DECIDES
 *
 *   GET /            → 307 to the resolved locale root
 *   GET /some/path   → 307 to /{locale}/some/path, query preserved
 *   GET /{locale}/…  → served
 *
 * Resolution order, which is ROUTE_MAP.md §1.1 exactly:
 *
 *   1. an explicit, supported locale already in the path
 *   2. the stored preference cookie
 *   3. `Accept-Language` negotiation against the supported locales
 *   4. `en`
 *
 * 307 and not 301: the target varies by visitor, so an intermediary caching it
 * as permanent would pin one visitor's language onto everyone behind it.
 *
 * THIS IS NOT A TRUST BOUNDARY. It is a convenience that gets visitors to a
 * sensible URL. The authority on whether a locale is real lives in the render
 * tree (`app/[locale]/layout.tsx`), so a request that never passes through
 * here — a matcher change, a direct hit on a prefixed path — still cannot
 * render an unsupported locale.
 */
export default createMiddleware(routing);

/**
 * Which requests are locale-routed.
 *
 * ROUTE_MAP.md §10 rule 6 names the complete set of NON-locale routes:
 * `robots.txt`, the sitemaps, `/api/*`, `/rss/*` and the health probes. Each is
 * excluded below, along with Next's own internals. Nothing here IMPLEMENTS any
 * of them — they belong to later phases — but a locale prefix bolted onto
 * `/robots.txt` or `/api/webhooks/{provider}` would break them on the day they
 * arrive, and a redirect on a webhook path is a silent integration failure.
 *
 * Written as one negative lookahead over the first path segment, which is what
 * Next can analyse statically. It is DELIBERATELY a list of the accepted
 * non-locale routes rather than a "contains a dot" rule: `/en/quran/2:255`,
 * `/en/library/books/al-minhaj-1.2` and any other legitimate route carrying a
 * dot would be silently excluded from locale routing by that shortcut, and the
 * failure would look like a 404 nobody can explain.
 *
 *   api        — `/api/*`, which includes `/api/health` and `/api/ready`
 *   _next      — the framework's own asset and data routes
 *   rss        — `/rss` and `/rss/{feed}`
 *   robots.txt — unprefixed by contract
 *   sitemap.xml, sitemaps — the sitemap index and its partitions. Note that
 *                `/sitemap` — the HUMAN-readable sitemap of §3.1 — is a normal
 *                public page and IS locale-routed; only the machine-readable
 *                forms are excluded, which is why this names `sitemap.xml`
 *                exactly rather than the `sitemap` prefix.
 *   favicon.ico — requested by browsers at a fixed unprefixed path.
 */
export const config = {
  matcher: [
    '/((?!api(?:$|/)|_next(?:$|/)|rss(?:$|/)|robots\\.txt$|sitemap\\.xml$|sitemaps(?:$|/)|favicon\\.ico$).*)',
  ],
};
