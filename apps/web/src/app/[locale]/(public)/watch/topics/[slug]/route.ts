import { topicSlugSchema } from '@minhaj/contracts/taxonomy';

import { taxonomyRuntime } from '@/composition/taxonomy';
import { watchVideosHref } from '@/components/topic-hub/videos-view';
import { isSupportedLocale } from '@/config/locale';

/**
 * `/{locale}/watch/topics/{slug}` — the Videos on one Topic, as ONE 301 to the
 * whole of Media's listing filtered by it, `/watch/videos?topic={id}` (Watch
 * Part 1; ROUTE_MAP.md §2.2, §3.7).
 *
 * WHY A REDIRECT (decision). Until Watch Part 1 this was a page of its own — a
 * bare grid canonical to the Topic hub (historical). The listing now filters
 * by Topic with counts, chips, every other filter, orders and pages, and names
 * the way to everything on the Topic; rendering it here too would give one view
 * two addresses. So this address stays a working way in — the Topic hub and old
 * links lead here — and answers with the listing's ONE spelling of the view.
 *
 * A ROUTE HANDLER, so the status is exactly 301 (a page's `permanentRedirect`
 * is a 308), with `noindex` and `no-store` like every alias (`../../../people-alias`):
 * an archived or unknown Topic is a 404 rather than a redirect into nothing,
 * and whether a Topic is active is mutable. The locale is preserved; the
 * target is built from the validated locale and the Topic Taxonomy just
 * answered — never from anything the request supplied unchecked.
 */
export const dynamic = 'force-dynamic';

const HEADERS = { 'x-robots-tag': 'noindex', 'cache-control': 'no-store' } as const;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string; slug: string }> },
): Promise<Response> {
  const { locale, slug } = await params;
  if (!isSupportedLocale(locale) || !topicSlugSchema.safeParse(slug).success)
    return new Response(null, { status: 404, headers: HEADERS });
  const topic = await taxonomyRuntime().taxonomy.findTopicBySlug({ slug, locale });
  if (topic === null || topic.status !== 'active')
    return new Response(null, { status: 404, headers: HEADERS });
  return new Response(null, {
    status: 301,
    headers: { ...HEADERS, location: watchVideosHref(locale, { topic: topic.id }) },
  });
}
