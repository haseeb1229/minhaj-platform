import { contributorAlias } from '../../people-alias';

/**
 * `/{locale}/authors/{slug}` — a LEGACY ALIAS, and a 301
 * (ROUTE_MAP.md §2.1, §9.1 rule 3).
 *
 * "One contributor profile route replaces the prior two. A Person may hold
 * author, speaker, scholar and teacher profiles; presenting them at separate
 * indexable URLs would fragment one human being's search authority across
 * several pages." This address exists so an inbound link to the old shape still
 * lands somewhere correct — not so that a second page can compete with the
 * canonical one. *
 * A ROUTE HANDLER, not a page: an alias renders nothing, and a handler can emit
 * exactly the 301 the accepted route map names rather than the 308 a page-level
 * `permanentRedirect()` would produce. The behaviour, the locale preservation
 * and the unknown-slug case are in `../../people-alias.ts`, shared with the other alias.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string; slug: string }> },
): Promise<Response> {
  return contributorAlias(params);
}
