import { createNavigation } from 'next-intl/navigation';

import { routing } from './routing';

/**
 * Locale-aware navigation, built from THE routing configuration.
 *
 * These are the only supported way to link between locales: they apply the
 * locale prefix from `routing`, so no call site constructs a `/{locale}/…`
 * string by hand and none can disagree with the proxy about what a localised
 * URL looks like.
 *
 * SAME-ORIGIN BY CONSTRUCTION. Both helpers take a PATHNAME, never a URL: the
 * origin is supplied by the browser, so no value reaching them — a query
 * parameter, an `Accept-Language` header, a forwarded host — can move a
 * navigation off this site (SECURITY_BASELINE.md §9, no open redirects).
 *
 * Only what Phase 3A consumes is exported. `redirect`, `permanentRedirect`,
 * `useRouter` and `getPathname` are available from `createNavigation` and are
 * deliberately not re-exported until something uses them.
 *
 * NOT AN SEO HELPER. These describe navigation between locales for a visitor
 * who chose one. They must not be repurposed to declare which language
 * versions of a resource EXIST — that is a content question, answered per
 * resource by the Phase 4 canonical/`hreflang` system (ROUTE_MAP.md §9.2).
 */
export const { Link, usePathname } = createNavigation(routing);
