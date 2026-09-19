import { contributorAlias } from '../../../people-alias';

/**
 * `/{locale}/library/authors/{slug}` — a LEGACY ALIAS, and a 301
 * (ROUTE_MAP.md §5, §9.1 rule 3).
 *
 * THE SECOND OF THE TWO THE ROUTE MAP NAMES. The prior revision let Library own
 * Author, which is why a book author had an address under `/library`; Author is
 * now delivered once, by People, before its consumers (DELIVERY_PLAN.md,
 * Phase 5).
 *
 * IT DOES NOT MAKE `/library` EXIST. There is no Library landing page, no
 * `/library/authors` listing and no book anywhere in this phase: ROUTE_MAP.md
 * §5 gives all of that to the Library phase. This is one leaf route that
 * redirects, and nothing links to it — an alias is for links that already exist
 * in the world, not a navigation entry (§5.2: a deferred capability is never
 * linked as dead navigation). *
 * A ROUTE HANDLER, not a page: an alias renders nothing, and a handler can emit
 * exactly the 301 the accepted route map names rather than the 308 a page-level
 * `permanentRedirect()` would produce. The behaviour, the locale preservation
 * and the unknown-slug case are in `../../../people-alias.ts`, shared with the other alias.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string; slug: string }> },
): Promise<Response> {
  return contributorAlias(params);
}
