import {
  localeSchema,
  localizedPath,
  splitLocalePath,
  UNPREFIXED_LOCALE,
} from '@minhaj/contracts';
import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';

import { standaloneKindOfSegment } from '@/components/library/scholarly-presentation';
import { routing } from '@/i18n/routing';

/**
 * Locale routing (ROUTE_MAP.md §1.1, Rebaseline R1).
 *
 * `proxy.ts` is the Next 16 convention; `middleware.ts` is its predecessor and
 * Next fails the build when both exist. There is exactly one of these files in
 * the repository.
 *
 * WHAT IT DECIDES
 *
 *   GET /some/path        → served in English (unprefixed is English)
 *   GET /ur/… , /ar/…     → served in Urdu / Arabic
 *   GET /en , /en/…       → ONE 301 to the unprefixed English address, query
 *                           preserved — merged with any slug-history hop below,
 *                           so a former slug under `/en` is still one hop
 *
 * The address alone decides the interface language. No cookie and no
 * `Accept-Language` header redirects an unprefixed URL anywhere: a shared link
 * shows everyone the same language, and a crawler sees what a visitor sees.
 *
 * THIS IS NOT A TRUST BOUNDARY. The authority on whether a locale is real
 * lives in the render tree (`app/[locale]/layout.tsx`), so a request that
 * never passes through here still cannot render an unsupported locale.
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

/**
 * THE ENGLISH REWRITE, AND ITS RE-ENTRY.
 *
 * An unprefixed address is served by rewriting it to `/en/…` internally. Next
 * only performs a rewrite in-process when the rewrite URL's origin matches the
 * server's own initial URL; when the server is bound to an explicit address
 * (`--hostname 127.0.0.1`, as behind a front door) Next hands this proxy a
 * `localhost` origin, the two differ, and Next PROXIES the rewrite as a fresh
 * HTTP request to `…/en/…` — which arrives back here looking exactly like a
 * legacy `/en/…` address and would be answered with the 301, forever.
 *
 * So every rewrite this proxy makes carries a mark that only this process can
 * produce: a random value minted once per process, in a private request
 * header. A request carrying it is this proxy's own rewrite re-entering, and is
 * served as-is; a client cannot guess the value, so a genuine `/en/…` still
 * gets its one 301. The header never reaches a response.
 */
const REWRITE_MARK_HEADER = 'x-minhaj-locale-rewrite';
const REWRITE_MARK = globalThis.crypto.randomUUID();

/** next-intl's own request header naming the locale of a rewritten request. */
const NEXT_INTL_LOCALE_HEADER = 'X-NEXT-INTL-LOCALE';

export default async function proxy(request: NextRequest) {
  if (request.headers.get(REWRITE_MARK_HEADER) === REWRITE_MARK) {
    const headers = new Headers(request.headers);
    headers.delete(REWRITE_MARK_HEADER);
    return NextResponse.next({ request: { headers } });
  }

  /**
   * The locale and the locale-free path, split once by the locale-path
   * contract. The slug-history branches below match `routed` — the same
   * address in its internal `/{locale}/…` form — so each keeps one pattern for
   * all three locales; every redirect target is built by `localizedPath`.
   */
  const parts = splitLocalePath(request.nextUrl.pathname);
  const routed = `/${parts.locale}${parts.rest}`;
  const legacyEnglish = parts.prefixed && parts.locale === UNPREFIXED_LOCALE;
  if (request.method === 'GET' || request.method === 'HEAD') {
    /**
     * PHASE 9 — A MAGAZINE ISSUE HAS A TWO-PART ADDRESS, and either part may be
     * a former slug. Library resolves BOTH to their current values before
     * anything redirects, so an old Magazine slug with an old issue slug is ONE
     * 301 to the current full address, never a Magazine hop followed by an issue
     * hop (ROUTE_MAP.md §9.7).
     */
    const issue = /^\/(en|ur|ar)\/library\/magazines\/([^/]+)\/issues\/([^/]+)$/.exec(
      routed,
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
            localizedPath(
              parts.locale,
              `/library/magazines/${encodeURIComponent(current.magazineSlug)}/issues/${encodeURIComponent(current.issueSlug)}`,
            ),
          );
        }
      }
    }
  }
  if (request.method === 'GET' || request.method === 'HEAD') {
    const match =
      /^\/(en|ur|ar)\/(library\/articles|library\/books|library\/research|library\/research-papers|library\/publications|library\/magazines|library\/encyclopedias|help)\/([^/]+)$/.exec(
        routed,
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
          return permanent(
            request,
            localizedPath(parts.locale, `/${area}/${encodeURIComponent(record)}`),
          );
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
      /^\/(en|ur|ar)\/watch\/(videos|series|programs|playlists)\/([^/]+)$/.exec(routed);
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
            localizedPath(
              parts.locale,
              `/watch/${current.family}/${encodeURIComponent(current.slug)}`,
            ),
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
    const listen = /^\/(en|ur|ar)\/listen\/(lectures|series)\/([^/]+)$/.exec(routed);
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
            localizedPath(
              parts.locale,
              `/listen/${listen[2]}/${encodeURIComponent(current)}`,
            ),
          );
        }
      }
    }
  }
  if (request.method === 'GET' || request.method === 'HEAD') {
    /**
     * PHASE 12 — A GALLERY'S OWN SLUG HISTORY, through the same single-301
     * mechanism: one hop to the current address, locale preserved, the target
     * built from Media's answer and never from the request. A Photo has no
     * slug, so nothing else under `/media` redirects.
     */
    const gallery = /^\/(en|ur|ar)\/media\/galleries\/([^/]+)$/.exec(routed);
    if (gallery?.[1] && gallery[2]) {
      const slug = decodedSegment(gallery[2]);
      if (slug !== null) {
        const { mediaReadRuntime } = await import('@/composition/media-read');
        const current = await mediaReadRuntime().galleryCanonicalSlug(slug);
        if (current !== null && current !== slug) {
          return permanent(
            request,
            localizedPath(
              parts.locale,
              `/media/galleries/${encodeURIComponent(current)}`,
            ),
          );
        }
      }
    }
  }
  if (request.method === 'GET' || request.method === 'HEAD') {
    /**
     * PHASE 13 — EACH NEWS FAMILY'S OWN SLUG HISTORY, through the same single-301
     * mechanism: one hop to the current address, locale preserved, the target
     * built from Editorial's answer and never from the request.
     *
     * THE STATIC SIBLINGS ARE NEVER SHADOWED. `/news/archive` and the three
     * family listings are reserved words no NewsArticle slug can hold — the
     * contract and the database both refuse one — and they are passed over here
     * before any lookup, so a slug history can never redirect a current route.
     */
    const news =
      /^\/(en|ur|ar)\/news\/(?:(press-releases|statements|media-coverage)\/)?([^/]+)$/.exec(
        routed,
      );
    if (news?.[1] && news[3]) {
      const slug = decodedSegment(news[3]);
      const { isReservedNewsSlug, newsKindOfSegment, newsPathOf } =
        await import('@minhaj/contracts/editorial');
      const kind = news[2] === undefined ? 'news-article' : newsKindOfSegment(news[2]);
      if (
        slug !== null &&
        kind !== null &&
        !(kind === 'news-article' && isReservedNewsSlug(slug))
      ) {
        const { editorialReadRuntime } = await import('@/composition/editorial-read');
        const current = await editorialReadRuntime().newsCanonicalSlug(kind, slug);
        if (current !== null && current !== slug) {
          return permanent(
            request,
            localizedPath(parts.locale, newsPathOf(kind, current)),
          );
        }
      }
    }
  }
  if (request.method === 'GET' || request.method === 'HEAD') {
    /**
     * PHASE 14 — AN EVENT'S OWN SLUG HISTORY, through the same single-301
     * mechanism: one hop to the current address, locale preserved, the target
     * built from Editorial's answer and never from the request. A former slug
     * with the gallery view's suffix resolves straight to the current gallery
     * view — ONE hop, never a chain through the Event page.
     */
    const event = /^\/(en|ur|ar)\/events\/([^/]+)(\/gallery)?$/.exec(routed);
    if (event?.[1] && event[2]) {
      const slug = decodedSegment(event[2]);
      if (slug !== null) {
        const { editorialReadRuntime } = await import('@/composition/editorial-read');
        const current = await editorialReadRuntime().eventCanonicalSlug(slug);
        if (current !== null && current !== slug) {
          const { eventPathOf } = await import('@minhaj/contracts/editorial');
          return permanent(
            request,
            localizedPath(parts.locale, `${eventPathOf(current)}${event[3] ?? ''}`),
          );
        }
      }
    }
  }
  if (request.method === 'GET' || request.method === 'HEAD') {
    /**
     * PHASE 15 — A COLLECTION'S OWN SLUG HISTORY, through the same single-301
     * mechanism: one hop to the current address, locale preserved, the target
     * built from Editorial's answer and never from the request. Only a published
     * Collection resolves; a withheld one's former slug falls through to the 404.
     */
    const collection = /^\/(en|ur|ar)\/collections\/([^/]+)$/.exec(routed);
    if (collection?.[1] && collection[2]) {
      const slug = decodedSegment(collection[2]);
      if (slug !== null) {
        const { editorialReadRuntime } = await import('@/composition/editorial-read');
        const current = await editorialReadRuntime().collectionCanonicalSlug(slug);
        if (current !== null && current !== slug) {
          const { collectionPathOf } = await import('@minhaj/contracts/editorial');
          return permanent(
            request,
            localizedPath(parts.locale, collectionPathOf(current)),
          );
        }
      }
    }
  }
  if (request.method === 'GET' || request.method === 'HEAD') {
    /**
     * PHASE 16 — THE GLOBAL NETWORK'S OWN SLUG HISTORIES, through the same
     * single-301 mechanism: one hop to the current address, locale preserved,
     * the target built from Global's answer and never from the request.
     *
     * NESTED ADDRESSES RESOLVE WHOLE. A Region or City is addressed under its
     * Country, so a former Country slug, a former Region or City slug, or both,
     * are resolved TOGETHER and answered with ONE redirect to the current full
     * address — never a chain through an intermediate one. A Centre's `news`,
     * `events` and `contact` pages keep their suffix. Only public records resolve: a
     * withheld record's former slug falls through to the route's 404.
     */
    const place =
      /^\/(en|ur|ar)\/global\/countries\/([^/]+)(?:\/(regions|cities)\/([^/]+))?$/.exec(
        routed,
      );
    if (place?.[1] && place[2]) {
      const country = decodedSegment(place[2]);
      const child = place[4] === undefined ? undefined : decodedSegment(place[4]);
      if (country !== null && child !== null) {
        const { globalReadRuntime } = await import('@/composition/global-read');
        const { globalPaths } = await import('@minhaj/contracts/global');
        const locale = place[1] as 'en' | 'ur' | 'ar';
        if (child === undefined) {
          const current = await globalReadRuntime().countryCanonicalSlug(country);
          if (current !== null && current !== country)
            return permanent(request, globalPaths.country(locale, current));
        } else if (place[3] === 'regions') {
          const current = await globalReadRuntime().regionCanonical(country, child);
          if (
            current !== null &&
            (current.country !== country || current.region !== child)
          )
            return permanent(
              request,
              globalPaths.region(locale, current.country, current.region),
            );
        } else {
          const current = await globalReadRuntime().cityCanonical(country, child);
          if (current !== null && (current.country !== country || current.city !== child))
            return permanent(
              request,
              globalPaths.city(locale, current.country, current.city),
            );
        }
      }
    }
    const centre =
      /^\/(en|ur|ar)\/global\/centres\/([^/]+)(\/news|\/events|\/contact)?$/.exec(routed);
    if (centre?.[1] && centre[2]) {
      const slug = decodedSegment(centre[2]);
      if (slug !== null) {
        const { globalReadRuntime } = await import('@/composition/global-read');
        const current = await globalReadRuntime().centreCanonicalSlug(slug);
        if (current !== null && current !== slug)
          return permanent(
            request,
            localizedPath(
              parts.locale,
              `/global/centres/${encodeURIComponent(current)}${centre[3] ?? ''}`,
            ),
          );
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
     *
     * PHASE 18 — `/quran/search` runs the SAME Search query restricted to one
     * kind, so it spends the SAME budget under the same rule, fails closed the
     * same way, and a throttled Quran search lands on the same static page.
     *
     * PHASE 19 — `/hadith/search` is the same Search query restricted to the
     * `hadith` kind, admitted under the same rule.
     *
     * PHASE 20 — `/fatwa/search` likewise, restricted to the `fatwa` kind.
     */
    const search = /^\/(en|ur|ar)\/(?:quran\/|hadith\/|fatwa\/)?search$/.exec(routed);
    const query = request.nextUrl.searchParams.get('q');
    if (!legacyEnglish && search?.[1] && query !== null && query.trim() !== '') {
      const { admitPublicSearch } = await import('@/composition/search-admission');
      if (!(await admitPublicSearch(request.headers))) {
        const target = request.nextUrl.clone();
        target.pathname = localizedPath(parts.locale, '/search/limited');
        target.search = '';
        const throttled = NextResponse.redirect(target, 303);
        throttled.headers.set('Cache-Control', 'no-store');
        throttled.headers.set('X-Robots-Tag', 'noindex');
        return throttled;
      }
    }
  }
  if (request.method === 'GET' || request.method === 'HEAD') {
    /**
     * PHASE 22 — LEARNING'S OWN SLUG HISTORY, through the same single-301
     * mechanism. A Course and a LearningPath each have an editable slug, so each
     * resolves a former one natively (DOMAIN_MODEL.md §19.7): one hop to the
     * current address, locale preserved, the target built from Learning's
     * answer and never from the request. Only a PUBLISHED record resolves — a
     * draft or archived one's former slug falls through to the page's 404 — and
     * Learn's own path words can never be a slug, so no section is shadowed.
     */
    const learn = /^\/(en|ur|ar)\/learn\/(courses|paths)\/([^/]+)$/.exec(routed);
    if (learn?.[1] && learn[2] && learn[3]) {
      const slug = decodedSegment(learn[3]);
      if (slug !== null) {
        const { learningReadRuntime } = await import('@/composition/learning-read');
        const { coursePath, learningPathPath } = await import('@/contexts/learning');
        const reads = learningReadRuntime();
        const current =
          learn[2] === 'courses'
            ? await reads.courseCanonicalSlug(slug)
            : await reads.pathCanonicalSlug(slug);
        if (current !== null && current !== slug) {
          return permanent(
            request,
            localizedPath(
              parts.locale,
              learn[2] === 'courses' ? coursePath(current) : learningPathPath(current),
            ),
          );
        }
      }
    }
  }

  /**
   * R1 — A LEGACY `/en/…` ADDRESS. English is unprefixed, so `/en` and
   * `/en/…` never render: they answer ONE permanent redirect to the same
   * resource's unprefixed address, query preserved. Every slug-history branch
   * above has already run, so a former slug under `/en` was answered in one
   * hop straight to its current unprefixed address; search admission skips a
   * legacy address, so a legacy search URL never spends budget twice.
   */
  if (legacyEnglish)
    return permanent(request, localizedPath(UNPREFIXED_LOCALE, parts.rest));

  /**
   * A CASE VARIANT OF A SUPPORTED LOCALE — `/UR/…`, `/Ar`, `/EN/…`. Language
   * tags are case-insensitive (RFC 5646 §2.1.1), so it names a real locale, not
   * English content: ONE permanent redirect to the canonical address, never a
   * second URL for the same page.
   */
  const segment = request.nextUrl.pathname.split('/', 2)[1] ?? '';
  const folded = localeSchema.safeParse(segment.toLowerCase());
  if (!parts.prefixed && folded.success) {
    return permanent(
      request,
      localizedPath(folded.data, request.nextUrl.pathname.slice(segment.length + 1)),
    );
  }

  if (!parts.prefixed) {
    // English: served from `/en/…` internally, marked (see REWRITE_MARK).
    const target = request.nextUrl.clone();
    target.pathname = `/${UNPREFIXED_LOCALE}${parts.rest}`;
    const headers = new Headers(request.headers);
    headers.set(NEXT_INTL_LOCALE_HEADER, UNPREFIXED_LOCALE);
    headers.set(REWRITE_MARK_HEADER, REWRITE_MARK);
    return NextResponse.rewrite(target, { request: { headers } });
  }

  return localeMiddleware(request);
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
 *   icon.png   — the app icon (`app/icon.png`), served by Next at `/icon.png`.
 *                R1: an unprefixed path is otherwise routed as English, which
 *                would rewrite the icon to a page that does not exist.
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
    '/((?!api(?:$|/)|_next(?:$|/)|assets(?:$|/)|rss(?:$|/)|robots\\.txt$|sitemap\\.xml$|sitemaps(?:$|/)|favicon\\.ico$|icon\\.png$).*)',
  ],
};
