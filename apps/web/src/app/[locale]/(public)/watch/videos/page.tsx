import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { WatchVideosPage } from '@/components/media/videos';
import {
  WATCH_VIDEOS,
  readVideosQuery,
  videosCanonicalRedirect,
} from '@/components/topic-hub/videos-view';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/watch/videos` — every published Video (ROUTE_MAP.md §3.7; the
 * shared Videos listing since Watch Part 1),
 * `?topic, language, speaker, series, length, sort, page`.
 *
 * BOUNDED, DETERMINISTIC AND FILTERED IN SQL. Media's `topicVideos` returns one
 * page of 24 in a total order with the total the view admits; every filter is
 * part of the query, never applied to a loaded catalogue.
 *
 * ONE ADDRESS PER VIEW. The filters are a GET form of plain controls, so they
 * work without JavaScript and every view is shareable; a form's empty
 * controls, another order of the same parameters, a malformed value, a
 * `?format=` (each curated format is a path of its own: `/watch/lectures` …)
 * or a former `?offset=` is ONE redirect to the canonical spelling, built from
 * the parsed view — never from the typed text. A filtered, ordered or paged
 * view is canonical to the bare listing and never a sitemap entry
 * (ROUTE_MAP.md §2.3); `force-dynamic` because a cached copy would keep
 * offering a withdrawn video.
 */
export const dynamic = 'force-dynamic';

interface ListingParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: ListingParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'watch' });
  return shellMetadata({
    locale,
    route: requireRoute('watch.videos'),
    title: t('sections.videos'),
    description: t('sectionBody.videos'),
  });
}

export default async function VideosPage({ params, searchParams }: ListingParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const canonical = videosCanonicalRedirect(WATCH_VIDEOS, locale, query);
  if (canonical !== null) redirect(canonical);
  return (
    <WatchVideosPage
      locale={locale}
      scope={WATCH_VIDEOS}
      query={readVideosQuery(WATCH_VIDEOS, query)}
    />
  );
}
