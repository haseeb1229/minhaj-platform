import 'server-only';

import { peopleReadRuntime } from '@/composition/people-read';
import { isSupportedLocale } from '@/config/locale';

/**
 * The shared behaviour of the two contributor ALIASES.
 *
 * ROUTE_MAP.md §9.1 rule 3: "Aliases 301, never canonical-only:
 * `/authors/{slug}` and `/library/authors/{slug}` → `/people/{slug}`." Both
 * aliases do exactly the same thing, so they do it through one function — two
 * copies of a redirect rule would be two places for one of them to stop being a
 * 301, and the one that stopped would be the one nobody tested.
 *
 * A ROUTE HANDLER RATHER THAN A PAGE, AND THE STATUS CODE IS WHY.
 *
 * An alias renders nothing: it redirects or it does not exist. Written as a
 * page, the redirect would have to come from `permanentRedirect()`, which emits
 * **308**. A 308 is a permanent redirect and every major crawler treats it as
 * one — but the accepted route map says **301**, and a contract that names a
 * status code is not satisfied by a different status code that behaves
 * similarly. A route handler can set the status exactly, so it does.
 *
 * THE LOCALE IS PRESERVED. An Urdu reader following an old Urdu link arrives at
 * the Urdu canonical page, not at the English one.
 *
 * AN UNKNOWN OR UNPUBLISHED SLUG 404s HERE RATHER THAN REDIRECTING. This is the
 * case worth being careful about: redirecting blindly would produce a 301 into
 * a page that then 404s — a redirect chain ending in nothing, which wastes a
 * crawl and tells a visitor two different things in two steps. The resolver can
 * determine absence safely and cheaply, so it does.
 *
 * NO REDIRECT CHAIN ON THE SUCCESS PATH EITHER. The target is the canonical URL
 * itself, not another alias and not a locale-negotiating entry point, so a
 * crawler follows exactly one hop.
 *
 * `X-Robots-Tag: noindex` ON BOTH ANSWERS. ROUTE_MAP.md §2.3 classifies a
 * legacy alias as not indexable, and a redirect carries no document for a
 * `<meta>` to live in — the header is the only place an alias can say so. It is
 * unconditional rather than derived from the indexing posture: an alias is
 * never the canonical URL, whatever the deployment is doing.
 *
 * WHAT DOES NOT EXIST. There is no `/authors` and no `/library/authors`
 * COLLECTION route. ROUTE_MAP.md §5 gives `/library/authors` to the Library
 * phase as a contributor listing whose details 301 here; inventing it now would
 * be a public collection route no accepted document places at Phase 5, and §5.2
 * forbids linking navigation to a capability that is not delivered.
 */
export async function contributorAlias(
  params: Promise<{ readonly locale: string; readonly slug: string }>,
): Promise<Response> {
  const { locale, slug } = await params;

  // `[locale]` is effectively a catch-all, so the segment is validated here
  // rather than trusted from the proxy — which is a convenience, not a trust
  // boundary (SECURITY_BASELINE.md §9.1).
  if (!isSupportedLocale(locale)) return absent();

  // PUBLISHED ONLY, which is the same question the canonical route asks. A
  // draft contributor is not a resource, so there is nothing to redirect to.
  if (!(await peopleReadRuntime().people.publicPersonExists(slug))) return absent();

  return new Response(null, {
    status: 301,
    headers: {
      // Built from the validated locale and the slug the resolver has just
      // confirmed names a published contributor — not from anything the
      // request supplied unchecked, so there is no open redirect to be had.
      location: `/${locale}/people/${encodeURIComponent(slug)}`,
      'x-robots-tag': 'noindex',
      // The answer depends on whether a contributor is published, which an
      // administrator changes. A cached 301 for a record that has since been
      // withdrawn would be a permanent redirect to a 404.
      'cache-control': 'no-store',
    },
  });
}

/** The answer for an alias that names no published contributor. */
function absent(): Response {
  return new Response(null, {
    status: 404,
    headers: { 'x-robots-tag': 'noindex', 'cache-control': 'no-store' },
  });
}
