import { localizedPath } from '@minhaj/contracts';

import { quranReadRuntime } from '@/composition/quran-read';
import { isSupportedLocale } from '@/config/locale';

/**
 * `/{locale}/listen/recitations` — Listen's way to the Quran's recitations, as
 * ONE 301 to their catalogue, `/quran/recitations` (Watch Part 3; ROUTE_MAP.md
 * §3.7; DOMAIN_MODEL.md §8.1).
 *
 * WHY A REDIRECT (decision). From Phase 18 this was a page of its own: the same
 * Quran-owned catalogue under Listen's trail, canonical to the Quran section's
 * (historical). Quran Part 5 made the catalogue a filtered page whose Play
 * controls answer the Quran layout's player — under its own media policy,
 * which this address does not have — so rendering it here again would be one
 * view at two addresses, the weaker without its player. Listen's landing
 * composes a preview of the same cards at Layer 4 and links the catalogue
 * itself; this address stays a working way in for old links.
 *
 * QURAN DECIDES WHETHER IT EXISTS. While no Quran corpus is active there is no
 * catalogue to lead to, and the address is a 404 as before — never a redirect
 * into the Quran section's unavailable state. A ROUTE HANDLER, so the status is
 * exactly 301 (a page's `permanentRedirect` is a 308), `noindex` and
 * `no-store` like every alias, since whether a corpus is active is mutable. It
 * reads Quran's public reader alone — never Media — and the target is built
 * from the validated locale, never from anything the request supplied.
 */
export const dynamic = 'force-dynamic';

const HEADERS = { 'x-robots-tag': 'noindex', 'cache-control': 'no-store' } as const;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string }> },
): Promise<Response> {
  const { locale } = await params;
  if (!isSupportedLocale(locale))
    return new Response(null, { status: 404, headers: HEADERS });
  const availability = await quranReadRuntime().reader.availability();
  if (!availability.active) return new Response(null, { status: 404, headers: HEADERS });
  return new Response(null, {
    status: 301,
    headers: { ...HEADERS, location: localizedPath(locale, '/quran/recitations') },
  });
}
