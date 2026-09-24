import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { formatOfView, WATCH_VIEWS } from '@/components/media/presentation';
import { VideoListingPage } from '@/components/media/watch';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/watch/{lectures|events|highlights|interviews|documentaries}` — the
 * five curated views (ROUTE_MAP.md §3.7, §2.3: "intentional navigational
 * views"). Each is the Video listing narrowed to one `format`, and each is its
 * own canonical, indexable browse destination.
 *
 * AN ALLOWLIST, NOT A CATCH-ALL. Only the five segments `generateStaticParams`
 * names exist; `dynamicParams` is off, so anything else is a 404 at the routing
 * layer, and the page re-validates the segment regardless. The static siblings
 * — `videos`, `series`, `programs`, `playlists`, `speakers` — are routed first.
 */
export const dynamic = 'force-dynamic';
export const dynamicParams = false;

export function generateStaticParams(): { view: string }[] {
  return WATCH_VIEWS.map((view) => ({ view }));
}

interface ViewParams {
  readonly params: Promise<{ readonly locale: string; readonly view: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: ViewParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const { view } = await params;
  if (formatOfView(view) === null) notFound();
  const t = await getTranslations({ locale, namespace: 'watch' });
  return shellMetadata({
    locale,
    route: requireRoute(`watch.${view}`),
    title: t(`sections.${view}` as 'sections.lectures'),
    description: t(`sectionBody.${view}` as 'sectionBody.lectures'),
  });
}

export default async function WatchViewPage({ params, searchParams }: ViewParams) {
  const locale = await requireLocale(params);
  const { view } = await params;
  const format = formatOfView(view);
  if (format === null) notFound();
  return <VideoListingPage locale={locale} format={format} query={await searchParams} />;
}
