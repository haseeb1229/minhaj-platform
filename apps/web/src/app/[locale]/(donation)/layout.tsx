/**
 * THE GIVING RETURN SHELL — the provider's return page and the anonymous
 * status page (DELIVERY_PLAN.md Phase 27).
 *
 * A ROUTE GROUP OF ITS OWN, OUTSIDE `(public)`, because these two pages are
 * NOT public content: the return page reads this browser's donation status
 * cookie, and the status page reads a bearer token and the limiter's client
 * address. The `(public)` tree reads no cookie and no request header
 * (ARCHITECTURE.md §8.1), and the architecture suite proves it; putting these
 * pages there would either break that proof or weaken it. Here they are
 * per-request, `private, no-store`, `noindex` and `no-referrer`.
 *
 * THE SAME CHROME AS THE PUBLIC SITE. A donor arriving back from the
 * provider's checkout lands on the site they left, with its header, skip
 * link, single `main` landmark and footer — the public shell itself, which
 * reads no session, re-used rather than copied so the two cannot drift.
 */
export { default } from '../(public)/layout';
