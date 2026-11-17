import { localizedPath } from '@minhaj/contracts';
import { eventPathOf } from '@minhaj/contracts/editorial';
import type { PublicCentreSummary } from '@minhaj/contracts/global';

import { editorialReadRuntime } from '@/composition/editorial-read';
import { globalReadRuntime } from '@/composition/global-read';
import { eventCalendar } from '@/components/editorial/event-calendar';
import { calendarLocation } from '@/components/editorial/event-presentation';
import { translationFor } from '@/components/editorial/presentation';
import { absoluteUrl } from '@/config/origin';
import { isSupportedLocale } from '@/config/locale';

/**
 * `/{locale}/events/{slug}/calendar` — one published Event as an iCalendar
 * file, so a reader can add it to their own calendar (News & Events Part 2;
 * ROUTE_MAP.md §3.9).
 *
 * A READ, NOTHING ELSE. A GET that renders a published record in another
 * format — exactly what the Event's page is — so no mutation class applies:
 * no session is read, no cookie set, nothing written, counted or remembered,
 * and the answer is the same for every visitor (ARCHITECTURE.md §8.1). Its
 * reads are the public composition roots the page uses.
 *
 * PUBLISHED ONLY. An unknown, malformed, unpublished or archived slug — or an
 * unsupported locale segment, since `[locale]` is effectively a catch-all — is
 * the same empty `404`. A former slug never reaches here: the request proxy
 * answers it with one 301 to the current address, as it does the page.
 *
 * NEVER AN INDEXABLE DOCUMENT AND NEVER CACHED: `X-Robots-Tag: noindex` and
 * `no-store`, because an Event is retimed, moved and withdrawn and a stale
 * copy would carry a time that no longer holds. The file is an attachment
 * named by the slug, percent-encoded, so nothing can split the header.
 */
export const dynamic = 'force-dynamic';

function absent(): Response {
  return new Response(null, {
    status: 404,
    headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
  });
}

/** The Event's public Centre, or `null` when it has none, is withdrawn or Global cannot say. */
async function centreOf(id: string | null): Promise<PublicCentreSummary | null> {
  if (id === null) return null;
  try {
    const [centre] = await globalReadRuntime().centreSummaries([id]);
    return centre ?? null;
  } catch {
    // The file is still true without a place; the page says the same.
    return null;
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string; slug: string }> },
): Promise<Response> {
  const { locale, slug } = await params;
  if (!isSupportedLocale(locale)) return absent();
  const record = await editorialReadRuntime().event(slug);
  if (record === null) return absent();
  const centre = await centreOf(record.centreId);
  const translation = translationFor(record, locale);
  const url = absoluteUrl(localizedPath(locale, eventPathOf(record.slug)));
  const body = eventCalendar(record, {
    title: translation.title,
    summary: translation.excerpt,
    location: calendarLocation(record, locale, centre),
    url,
    host: new URL(url).host,
  });
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      // A slug may be written in any script, which a header cannot carry raw:
      // an ASCII name, and the slug itself percent-encoded (RFC 6266).
      'content-disposition': `attachment; filename="event.ics"; filename*=UTF-8''${encodeURIComponent(record.slug)}.ics`,
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
      'x-content-type-options': 'nosniff',
    },
  });
}
