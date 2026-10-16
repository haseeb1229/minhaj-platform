import { contributorAlias } from '../../../people-alias';

/**
 * `/{locale}/learn/teachers/{slug}` — an ALIAS of the one contributor profile,
 * and a 301 (ROUTE_MAP.md §2.1, §9.1 rule 3; DELIVERY_PLAN.md Phase 23).
 *
 * A teacher listed by Find a Teacher is a published Person; their profile is
 * `/people/{slug}` and nothing else, so an address under `/learn/teachers`
 * never becomes a second page competing with it. One hop to the canonical
 * page when the slug names a published contributor, 404 when it does not,
 * `noindex` and `no-store` on both answers — exactly the behaviour the
 * `/authors/{slug}` alias proved, through the same function.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string; slug: string }> },
): Promise<Response> {
  return contributorAlias(params);
}
