import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { QuranUnavailable } from '@/components/quran/parts';
import { quranAvailability, quranMetadata } from '@/components/quran/read';
import { QuranVideosPage } from '@/components/quran/videos';
import { QURAN_VIDEOS } from '@/components/quran/hubs';
import {
  readVideosQuery,
  videosCanonicalRedirect,
} from '@/components/topic-hub/videos-view';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/quran/videos` — THE QURAN VIDEOS HUB (Quran Part 11; ROUTE_MAP.md
 * §3.3): Media's published Videos on Taxonomy's `quran` Topic and every
 * published Video that explains a Quran passage, composed at Layer 4 from
 * Media's own public reads — shelves, a Surah, a content language, a speaker,
 * a Series, a length, an order and a page, each a GET parameter, every view at
 * ONE address (any other spelling of it is one redirect there).
 *
 * CANONICAL TO ITSELF, the bare path, since Part 11: the hub is a curated
 * navigational view of its own (ROUTE_MAP.md §2.3), no longer a mirror of
 * Watch's topic-filtered listing; every filtered or paged view canonicalises
 * to it. While the corpus is not approved the page claims no canonical at all
 * (`quranMetadata`).
 *
 * Signed out and `force-dynamic`: every part is mutable public data. The
 * honest unavailable state while no corpus is active, as on every Quran page.
 */
export const dynamic = 'force-dynamic';

interface VideosParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: VideosParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'quran' });
  return quranMetadata({
    locale,
    availability: await quranAvailability(),
    canonicalPath: QURAN_VIDEOS.path,
    title: t('sections.videos'),
    description: t('sectionBody.videos'),
  });
}

export default async function QuranVideosRoute({ params, searchParams }: VideosParams) {
  const locale = await requireLocale(params);
  const availability = await quranAvailability();
  if (!availability.active) {
    const t = await getTranslations({ locale, namespace: 'quran' });
    return <QuranUnavailable locale={locale} section={t('sections.videos')} />;
  }
  const query = await searchParams;
  // One address per view: a form's empty controls, a malformed value or
  // another order is ONE redirect to the canonical spelling.
  const canonical = videosCanonicalRedirect(QURAN_VIDEOS, locale, query);
  if (canonical !== null) redirect(canonical);
  return (
    <QuranVideosPage
      locale={locale}
      availability={availability}
      query={readVideosQuery(QURAN_VIDEOS, query)}
    />
  );
}
