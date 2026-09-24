import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';

import { standaloneKindOfSegment } from '@/components/library/scholarly-presentation';
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
const localeMiddleware = createMiddleware(routing);

/** One path segment, decoded, or `null` when it is not valid encoding. */
function decodedSegment(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    // Invalid encoded input continues to the route's 404.
    return null;
  }
}

/** A single permanent hop to a current canonical address. */
function permanent(request: NextRequest, pathname: string): NextResponse {
  const target = request.nextUrl.clone();
  target.pathname = pathname;
  const redirect = NextResponse.redirect(target, 301);
  redirect.headers.set('Cache-Control', 'no-store');
  redirect.headers.set('X-Robots-Tag', 'noindex');
  return redirect;
}

export default async function proxy(request: NextRequest) {
  if (request.method === 'GET' || request.method === 'HEAD') {
    /**
     * PHASE 9 — A MAGAZINE ISSUE HAS A TWO-PART ADDRESS, and either part may be
     * a former slug. Library resolves BOTH to their current values before
     * anything redirects, so an old Magazine slug with an old issue slug is ONE
     * 301 to the current full address, never a Magazine hop followed by an issue
     * hop (ROUTE_MAP.md §9.7).
     */
    const issue = /^\/(en|ur|ar)\/library\/magazines\/([^/]+)\/issues\/([^/]+)$/.exec(
      request.nextUrl.pathname,
    );
    if (issue?.[1] && issue[2] && issue[3]) {
      const magazineSlug = decodedSegment(issue[2]);
      const issueSlug = decodedSegment(issue[3]);
      if (magazineSlug !== null && issueSlug !== null) {
        const { libraryReadRuntime } = await import('@/composition/library-read');
        const current = await libraryReadRuntime().magazineIssueCanonical(
          magazineSlug,
          issueSlug,
        );
        if (
          current !== null &&
          (current.magazineSlug !== magazineSlug || current.issueSlug !== issueSlug)
        ) {
          return permanent(
            request,
            `/${issue[1]}/library/magazines/${encodeURIComponent(current.magazineSlug)}/issues/${encodeURIComponent(current.issueSlug)}`,
          );
        }
      }
    }
  }
  if (request.method === 'GET' || request.method === 'HEAD') {
    const match =
      /^\/(en|ur|ar)\/(library\/articles|library\/books|library\/research|library\/research-papers|library\/publications|library\/magazines|library\/encyclopedias|help)\/([^/]+)$/.exec(
        request.nextUrl.pathname,
      );
    if (match?.[3]) {
      const slug = decodedSegment(match[3]);
      if (slug !== null) {
        /**
         * PHASE 8 JOINS THE SAME MECHANISM, and does not build a second one.
         *
         * A Work's canonical slug is editable, so Library owns its slug history
         * natively and in the phase that made it editable (DOMAIN_MODEL.md
         * §19.7). What that history needs is a **301** from every former slug to
         * the current one (ROUTE_MAP.md §1.4, §9.7) — and a page cannot emit one:
         * `permanentRedirect()` produces 308. Editorial solved that here, so
         * Library resolves through the same branch rather than adding a parallel
         * redirect path that could stop being a 301 on its own.
         *
         * THE RESOLVER IS LIBRARY'S OWN, not Migration's. `LegacyMapping` maps
         * LEGACY SOURCE URLs and is Migration-owned; using it for an ordinary
         * rename would invert the dependency rules and leave every pre-migration
         * rename with no redirect at all (§19.7, and this phase's §19).
         *
         * IMPORTED LAZILY, per branch, so a request for any other path pays for
         * neither resolver.
         */
        const area = match[2] ?? '';
        const scholarly = area.startsWith('library/')
          ? standaloneKindOfSegment(area.slice('library/'.length))
          : null;
        const record =
          area === 'library/books'
            ? await (async () => {
                const { libraryReadRuntime } = await import('@/composition/library-read');
                return libraryReadRuntime().canonicalSlug(slug);
              })()
            : scholarly !== null
              ? await (async () => {
                  // PHASE 9 joins the same branch: Library's own slug history for
                  // each of its five standalone aggregates, never LegacyMapping.
                  const { libraryReadRuntime } =
                    await import('@/composition/library-read');
                  return libraryReadRuntime().scholarlyCanonicalSlug(scholarly, slug);
                })()
              : await (async () => {
                  const { editorialReadRuntime } =
                    await import('@/composition/editorial-read');
                  return area === 'help'
                    ? editorialReadRuntime().pageCanonicalSlug('help-article', slug)
                    : editorialReadRuntime().articleCanonicalSlug(slug);
                })();
        if (record && record !== slug) {
          return permanent(request, `/${match[1]}/${area}/${encodeURIComponent(record)}`);
        }
      }
    }
  }
  if (request.method === 'GET' || request.method === 'HEAD') {
    /**
     * PHASE 10 — MEDIA'S OWN SLUG HISTORY, through the same single-301 mechanism.
     *
     * A Video, a Series and a Playlist each have an editable canonical slug, so
     * each resolves a former one natively (DOMAIN_MODEL.md §19.7). A Series has
     * ONE address whichever family it is requested under: its kind decides
     * between `/watch/series` and `/watch/programs`, and Media resolves the kind
     * and the slug TOGETHER, so a renamed series that has also become a
     * programme is one hop to its current address, never two (ROUTE_MAP.md §9.7).
     * The target is built from Media's answer, never from the request.
     */
    const watch =
      /^\/(en|ur|ar)\/watch\/(videos|series|programs|playlists)\/([^/]+)$/.exec(
        request.nextUrl.pathname,
      );
    if (watch?.[1] && watch[2] && watch[3]) {
      const slug = decodedSegment(watch[3]);
      if (slug !== null) {
        const { mediaReadRuntime } = await import('@/composition/media-read');
        const { seriesSegment } = await import('@/components/media/presentation');
        const media = mediaReadRuntime();
        const family = watch[2];
        const current =
          family === 'videos'
            ? await media
                .videoCanonicalSlug(slug)
                .then((found) => (found === null ? null : { family, slug: found }))
            : family === 'playlists'
              ? await media
                  .playlistCanonicalSlug(slug)
                  .then((found) => (found === null ? null : { family, slug: found }))
              : await media
                  .seriesCanonical(slug)
                  .then((found) =>
                    found === null
                      ? null
                      : { family: seriesSegment(found.kind), slug: found.slug },
                  );
        if (current !== null && (current.family !== family || current.slug !== slug)) {
          return permanent(
            request,
            `/${watch[1]}/watch/${current.family}/${encodeURIComponent(current.slug)}`,
          );
        }
      }
    }
  }
  if (request.method === 'GET' || request.method === 'HEAD') {
    /**
     * PHASE 11 — AUDIO'S OWN SLUG HISTORY, through the same single-301 mechanism.
     *
     * An AudioTrack and an AudioSeries each have an editable canonical slug, so
     * each resolves a former one natively (DOMAIN_MODEL.md §19.7): one hop to the
     * current address, locale preserved, the target built from Media's answer and
     * never from the request.
     */
    const listen = /^\/(en|ur|ar)\/listen\/(lectures|series)\/([^/]+)$/.exec(
      request.nextUrl.pathname,
    );
    if (listen?.[1] && listen[2] && listen[3]) {
      const slug = decodedSegment(listen[3]);
      if (slug !== null) {
        const { mediaReadRuntime } = await import('@/composition/media-read');
        const media = mediaReadRuntime();
        const current =
          listen[2] === 'lectures'
            ? await media.audioTrackCanonicalSlug(slug)
            : await media.audioSeriesCanonicalSlug(slug);
        if (current !== null && current !== slug) {
          return permanent(
            request,
            `/${listen[1]}/listen/${listen[2]}/${encodeURIComponent(current)}`,
          );
        }
      }
    }
  }
  if (request.method === 'GET' || request.method === 'HEAD') {
    /**
     * PHASE 17 — PUBLIC SEARCH ADMISSION.
     *
     * Only a request that will actually run a query spends budget: the search
     * page with a non-empty `q`. HEAD is admitted exactly like GET, because a
     * page answers HEAD by rendering — and so by querying. A throttled visitor
     * is sent to a static page that says so and runs nothing; the results page
     * itself never reads a header or a secret, which a public content route
     * must not (ARCHITECTURE.md §8.1). Imported lazily, so no other path pays
     * for it.
     */
    const search = /^\/(en|ur|ar)\/search$/.exec(request.nextUrl.pathname);
    const query = request.nextUrl.searchParams.get('q');
    if (search?.[1] && query !== null && query.trim() !== '') {
      const { admitPublicSearch } = await import('@/composition/search-admission');
      if (!(await admitPublicSearch(request.headers))) {
        const target = request.nextUrl.clone();
        target.pathname = `/${search[1]}/search/limited`;
        target.search = '';
        const throttled = NextResponse.redirect(target, 303);
        throttled.headers.set('Cache-Control', 'no-store');
        throttled.headers.set('X-Robots-Tag', 'noindex');
        return throttled;
      }
    }
  }

  const response = localeMiddleware(request);
  const pathname = request.nextUrl.pathname;
  const explicitlyPrefixed = routing.locales.some(
    (locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`),
  );

  if (explicitlyPrefixed) {
    // next-intl normally remembers any explicit prefix. That makes an ordinary
    // public GET emit Set-Cookie even though its render is session-independent,
    // which defeats the shared response boundary Phase 4 establishes. The
    // switcher stores the same preference on explicit user action instead.
    response.headers.delete('set-cookie');
  }

  return response;
}

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
 *   assets     — `/assets/*`, the platform's BYTES.
 *
 * `assets` WAS MISSING, AND PHASE 8 IS WHERE THAT STOPPED BEING THEORETICAL.
 *
 * Phase 7 established `/assets/{id}` as the unprefixed serving route, on the
 * reasoning ROUTE_MAP.md applies to every non-locale route: "an asset is bytes; it
 * has no interface locale, and giving it three URLs would give one object three
 * cache entries and three canonical addresses." But this matcher did not exclude
 * the prefix, so the locale middleware redirected `/assets/{id}` to
 * `/{locale}/assets/{id}` — an address no route answers. Phase 7's own proof is an
 * architecture test over the route MODULE, so nothing exercised the path over HTTP
 * and nothing reported it.
 *
 * It is corrected here, as the SMALLEST DIRECT FIX — one alternative added to the
 * existing negative lookahead — because Phase 8 is the first phase that actually
 * serves bytes and could not do so otherwise. No Phase-7 behaviour changes:
 * `/assets/{id}` still ships a policy that never allows, and Library's own byte
 * routes live beneath the same prefix so one exclusion covers the namespace.
 */
export const config = {
  matcher: [
    '/((?!api(?:$|/)|_next(?:$|/)|assets(?:$|/)|rss(?:$|/)|robots\\.txt$|sitemap\\.xml$|sitemaps(?:$|/)|favicon\\.ico$).*)',
  ],
};
