import { EXPLORE_SECTIONS, exploreSlugsOf, type ExploreSection } from '@/shell/explore';

/**
 * THE shell route registry — Layer 4, and the minimum of it (ROUTE_MAP.md §5.2).
 *
 * ONE SOURCE, SIX CONSUMERS. The header, the Explore mega menu, the mobile
 * navigation, the footer, the human-readable sitemap and the read-only
 * administrative navigation status all describe the same set of routes. Written
 * six times they would disagree — a link removed from the header and left in
 * the footer is exactly the dead navigation ROUTE_MAP.md §5.2 prohibits — so
 * they are derived from this one list instead.
 *
 * WHAT THIS IS NOT. Not a CMS, not a database aggregate, not a feature-flag
 * platform, not a content registry, and not a place where a later domain
 * declares its own routes. It carries a stable key, a message key, a path, a
 * placement, an availability and an indexing eligibility — and no body content
 * of any kind (DELIVERY_PLAN.md, Phase 4).
 *
 * HOW DEAD NAVIGATION IS MADE IMPOSSIBLE. A deferred capability has NO `path`
 * FIELD AT ALL, so there is no string a link could be built from: rendering one
 * as an anchor is a type error rather than a review finding. That is the
 * structural form of "a deferred item is absent" (ROUTE_MAP.md §5.2).
 */

/* ===========================================================================
 * Vocabulary
 * ========================================================================= */

/**
 * How far along a route is.
 *
 *   `delivered` — the route works and carries its own genuine content.
 *   `reserved`  — the route works and carries a clearly non-authoritative
 *                 publication-status state. Its genuine content is a Phase-6
 *                 `Page` record, and this placeholder is REPLACED by it, never
 *                 promoted or migrated (DELIVERY_PLAN.md, Phase 4).
 *   `deferred`  — the capability is committed but has not been built. It has no
 *                 route, and it appears nowhere a visitor can click.
 */
export type Availability = 'delivered' | 'reserved' | 'deferred';

/**
 * Whether a route may appear in a machine sitemap and be indexed, WHEN public
 * indexing is switched on at all.
 *
 * Independent of the pre-adoption posture, which suppresses indexing site-wide
 * regardless (ROUTE_MAP.md §9.5). This field says what a route would be
 * eligible for; `@/config/indexing` decides whether anything is.
 */
export type Indexing = 'eligible' | 'excluded';

/**
 * Whether a route is part of the public site or an authenticated area.
 *
 * `/my` is `delivered` and appears in the primary navigation — it is the
 * account entry point — but everything at and beneath it is private, `no-store`
 * and `noindex` (ROUTE_MAP.md §9.5). Saying so here is what keeps it out of
 * both sitemaps without either of them having to know about `/my` specifically.
 */
export type Visibility = 'public' | 'private';

/** Where a route appears in the shell. */
export type Placement =
  'primary' | 'utility' | 'footer-explore' | 'footer-legal' | 'footer-utility';

interface ShellRouteBase {
  /** Stable key. The vocabulary code, never a display string. */
  readonly key: string;
  /** Message key within the `shell` namespace. */
  readonly label: string;
  /** Where the shell renders it. A route reachable only by URL has none. */
  readonly placements: readonly Placement[];
}

/** A route that exists and can be linked to. */
export interface AvailableRoute extends ShellRouteBase {
  readonly availability: Exclude<Availability, 'deferred'>;
  /**
   * The locale-relative path, ALWAYS starting with `/` and never carrying a
   * locale segment — the locale is applied at the call site, once
   * (ROUTE_MAP.md §1.1). The empty string is the locale root itself.
   */
  readonly path: string;
  readonly visibility: Visibility;
  readonly indexing: Indexing;
}

/** A committed capability with no route yet. Deliberately has no `path`. */
export interface DeferredRoute extends ShellRouteBase {
  readonly availability: Extract<Availability, 'deferred'>;
}

export type ShellRoute = AvailableRoute | DeferredRoute;

/** Can a visitor go there? The one question a link has to ask. */
export function isAvailable(route: ShellRoute): route is AvailableRoute {
  return route.availability !== 'deferred';
}

/**
 * The locale-prefixed path for a route.
 *
 * The ONE place a shell URL is assembled. Nothing else concatenates a locale
 * onto a path, so a route cannot acquire a second spelling.
 */
export function pathFor(locale: string, route: AvailableRoute): string {
  return `/${locale}${route.path}`;
}

/* ===========================================================================
 * The registry
 * ========================================================================= */

/**
 * The primary navigation, in the canonical order of
 * INFORMATION_ARCHITECTURE.md §2.2.
 *
 * ALL TWELVE ARE RECORDED, and nine of them are `deferred`. Recording them is
 * not a promise to show them: it states the accepted final order in one place,
 * gives the administrative status surface something true to report, and makes
 * "a deferred domain renders no anchor" a property a test asserts over the
 * whole set rather than something a reviewer checks by eye.
 */
const PRIMARY: readonly ShellRoute[] = Object.freeze([
  Object.freeze({
    key: 'explore',
    label: 'nav.explore',
    path: '/explore',
    placements: Object.freeze(['primary'] as const),
    visibility: 'public' as const,
    availability: 'delivered' as const,
    indexing: 'eligible' as const,
  }),
  Object.freeze({
    key: 'quran',
    label: 'nav.quran',
    placements: Object.freeze(['primary'] as const),
    availability: 'deferred' as const,
  }),
  Object.freeze({
    key: 'hadith',
    label: 'nav.hadith',
    placements: Object.freeze(['primary'] as const),
    availability: 'deferred' as const,
  }),
  Object.freeze({
    key: 'learn',
    label: 'nav.learn',
    placements: Object.freeze(['primary'] as const),
    availability: 'deferred' as const,
  }),
  Object.freeze({
    key: 'library',
    label: 'nav.library',
    placements: Object.freeze(['primary'] as const),
    availability: 'deferred' as const,
  }),
  Object.freeze({
    key: 'watch',
    label: 'nav.watch',
    placements: Object.freeze(['primary'] as const),
    availability: 'deferred' as const,
  }),
  Object.freeze({
    key: 'fatwa',
    label: 'nav.fatwa',
    placements: Object.freeze(['primary'] as const),
    availability: 'deferred' as const,
  }),
  Object.freeze({
    key: 'news-events',
    label: 'nav.newsEvents',
    placements: Object.freeze(['primary'] as const),
    availability: 'deferred' as const,
  }),
  Object.freeze({
    key: 'global',
    label: 'nav.global',
    placements: Object.freeze(['primary'] as const),
    availability: 'deferred' as const,
  }),
  Object.freeze({
    key: 'search',
    label: 'nav.search',
    placements: Object.freeze(['primary'] as const),
    availability: 'deferred' as const,
  }),
  /**
   * The ACCOUNT ENTRY POINT, delivered by Phase 2 and linked as a plain route.
   *
   * `excluded` from indexing because everything beneath `/my` is private and
   * `noindex` (ROUTE_MAP.md §9.5), and it is a STATIC link rather than a
   * personalised control: the public header must not know whether anybody is
   * signed in (ARCHITECTURE.md §8.1).
   */
  Object.freeze({
    key: 'my-minhaj',
    label: 'nav.myMinhaj',
    path: '/my',
    placements: Object.freeze(['primary'] as const),
    visibility: 'private' as const,
    availability: 'delivered' as const,
    indexing: 'excluded' as const,
  }),
  Object.freeze({
    key: 'donate',
    label: 'nav.donate',
    placements: Object.freeze(['primary'] as const),
    availability: 'deferred' as const,
  }),
]);

/**
 * Utility navigation (INFORMATION_ARCHITECTURE.md §2.1).
 *
 * The LANGUAGE SWITCHER is not here, because it is not a route: it is a control
 * that rewrites the current one, and the header renders it directly. The other
 * three are deferred to the phases that own them — Global Network, Membership
 * and Editorial respectively.
 */
const UTILITY: readonly ShellRoute[] = Object.freeze([
  Object.freeze({
    key: 'find-a-centre',
    label: 'nav.findACentre',
    placements: Object.freeze(['utility'] as const),
    availability: 'deferred' as const,
  }),
  Object.freeze({
    key: 'membership',
    label: 'nav.membership',
    placements: Object.freeze(['utility'] as const),
    availability: 'deferred' as const,
  }),
  Object.freeze({
    key: 'contact-help',
    label: 'nav.contactHelp',
    placements: Object.freeze(['utility'] as const),
    availability: 'deferred' as const,
  }),
]);

/**
 * The Explore shells, DERIVED from the allowlists rather than restated.
 *
 * Restating them would be a second list that can disagree with the one the
 * routes validate against — and the disagreement shows up as either a menu
 * entry that 404s or a reachable page nothing links to.
 *
 * Every one of them is `reserved` and `excluded`. A reserved shell carries a
 * publication-status notice and no body, so listing it in a sitemap would
 * advertise a page with nothing on it (ROUTE_MAP.md §9.4: only canonical,
 * indexable URLs appear).
 */
function exploreRoutes(): readonly ShellRoute[] {
  return Object.freeze(
    EXPLORE_SECTIONS.flatMap((section: ExploreSection): ShellRoute[] => [
      Object.freeze({
        key: `explore.${section}`,
        label: `explore.${section}.title`,
        path: `/explore/${section}`,
        placements: Object.freeze(['footer-explore'] as const),
        visibility: 'public' as const,
        availability: 'reserved' as const,
        indexing: 'excluded' as const,
      }),
      ...exploreSlugsOf(section).map((slug) =>
        Object.freeze({
          key: `explore.${section}.${slug}`,
          label: `explore.${section}.pages.${slug}`,
          path: `/explore/${section}/${slug}`,
          placements: Object.freeze([] as const),
          visibility: 'public' as const,
          availability: 'reserved' as const,
          indexing: 'excluded' as const,
        }),
      ),
    ]),
  );
}

/** The legal and compliance surfaces (ROUTE_MAP.md §3.10). */
export const LEGAL_DOCUMENTS = Object.freeze([
  'privacy',
  'terms',
  'cookies',
  'accessibility',
] as const);

export type LegalDocument = (typeof LEGAL_DOCUMENTS)[number];

/** Narrows an unvalidated segment to a reserved legal document. */
export function isLegalDocument(value: string): value is LegalDocument {
  return (LEGAL_DOCUMENTS as readonly string[]).includes(value);
}

const LEGAL: readonly ShellRoute[] = Object.freeze(
  LEGAL_DOCUMENTS.map((document) =>
    Object.freeze({
      key: `legal.${document}`,
      label: `legal.${document}`,
      path: `/legal/${document}`,
      placements: Object.freeze(['footer-legal'] as const),
      visibility: 'public' as const,
      availability: 'reserved' as const,
      indexing: 'excluded' as const,
    }),
  ),
);

/** The routes the shell itself delivers. */
const SHELL: readonly ShellRoute[] = Object.freeze([
  Object.freeze({
    key: 'home',
    label: 'nav.home',
    path: '',
    placements: Object.freeze([] as const),
    visibility: 'public' as const,
    availability: 'delivered' as const,
    indexing: 'eligible' as const,
  }),
  Object.freeze({
    key: 'sitemap',
    label: 'nav.sitemap',
    path: '/sitemap',
    placements: Object.freeze(['footer-utility'] as const),
    visibility: 'public' as const,
    availability: 'delivered' as const,
    indexing: 'eligible' as const,
  }),
]);

/** THE registry. */
export const SHELL_ROUTES: readonly ShellRoute[] = Object.freeze([
  ...SHELL,
  ...PRIMARY,
  ...UTILITY,
  ...exploreRoutes(),
  ...LEGAL,
]);

/* ===========================================================================
 * Views
 * ========================================================================= */

/** Every route in a placement, in registry order. */
export function routesIn(placement: Placement): readonly ShellRoute[] {
  return SHELL_ROUTES.filter((route) => route.placements.includes(placement));
}

/** Every LINKABLE route in a placement. What a navigation renders. */
export function linksIn(placement: Placement): readonly AvailableRoute[] {
  return routesIn(placement).filter(isAvailable);
}

/** One route by key, or `null`. */
export function routeByKey(key: string): ShellRoute | null {
  return SHELL_ROUTES.find((route) => route.key === key) ?? null;
}

/**
 * The AVAILABLE route a page is rendering, by key.
 *
 * Throws rather than returning `null`, because every caller is a route that
 * knows its own registry key: a miss is a typo or a deleted entry, not a
 * runtime condition. Failing here surfaces it as a build error on the page that
 * lost its entry, instead of as a page that quietly stopped emitting a
 * canonical URL.
 */
export function requireRoute(key: string): AvailableRoute {
  const route = routeByKey(key);

  if (route === null) throw new Error(`No shell route is registered for "${key}".`);
  if (!isAvailable(route)) {
    throw new Error(`Shell route "${key}" is deferred and has no path to render.`);
  }

  return route;
}

/**
 * Every route eligible to appear in a machine sitemap.
 *
 * Eligibility alone publishes nothing: the sitemap routes additionally require
 * public indexing to be switched on, which the pre-adoption posture leaves off
 * (ROUTE_MAP.md §9.5).
 */
export function indexableRoutes(): readonly AvailableRoute[] {
  return SHELL_ROUTES.filter(
    (route): route is AvailableRoute =>
      isAvailable(route) && route.indexing === 'eligible',
  );
}
