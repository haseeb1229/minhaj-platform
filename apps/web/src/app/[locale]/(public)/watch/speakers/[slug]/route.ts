import { contributorAlias } from '../../../people-alias';

/**
 * `/{locale}/watch/speakers/{slug}` — an ALIAS, and a 301 to the ONE contributor
 * profile, `/people/{slug}` (ROUTE_MAP.md §3.7: "details 301 → `/people/{slug}`").
 *
 * The same shared behaviour as the two author aliases: the locale is preserved,
 * an unknown or unpublished person is a 404 rather than a redirect into one, and
 * the answer carries `noindex` and `no-store`. There is no Media speaker record
 * to show here — a speaker IS a Person.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string; slug: string }> },
): Promise<Response> {
  return contributorAlias(params);
}
