import 'server-only';

import { prerenderEnv } from '@/config/prerender-env';

/**
 * THE application origin.
 *
 * ONE ORIGIN, ONE VARIABLE. `AUTH_BASE_URL` is already documented as "canonical
 * application origin, used to build emailed links and to bound what the
 * authentication library will redirect to" — which is the same origin a
 * canonical URL is built from, because there is only one deployment and one
 * public address for it. A second `SITE_URL` beside it would be two variables
 * describing one fact, and the day they disagreed the emailed links and the
 * canonical links would point at different sites.
 *
 * A second origin variable arrives if and when a deployment genuinely has two
 * semantically different origins. This one does not.
 *
 * NOT HARD-CODED, IN EITHER DIRECTION. Neither the official `minhaj.org` origin
 * nor the developer pre-adoption origin appears in this file or anywhere else
 * in reusable code: the first would be an adoption claim the platform has not
 * been granted, and the second would pin a developer's host into the product
 * (PRODUCT_SCOPE.md, *Product status and acceptance*).
 */

/**
 * The origin with no trailing slash, so joining a path never doubles the
 * separator.
 *
 * `new URL` rather than string trimming: it rejects a malformed value at the
 * boundary, and `origin` discards any path, query or fragment somebody may have
 * configured by mistake — a canonical URL built on `https://example.test/app`
 * would be wrong in a way nobody would notice until a crawler found it.
 */
export function applicationOrigin(): string {
  return new URL(prerenderEnv().AUTH_BASE_URL).origin;
}

/**
 * An absolute canonical URL for a locale-prefixed path.
 *
 * ABSOLUTE, LOCALE-PREFIXED AND LOWERCASE, which is ROUTE_MAP.md §9.1 rule 5
 * exactly. The path is lowercased here rather than trusted from a call site,
 * because a canonical URL that differs from another only in case is a second
 * URL for one resource.
 */
export function absoluteUrl(path: string): string {
  return `${applicationOrigin()}${path.toLowerCase()}`;
}
