import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import {
  readSpeakersView,
  speakersCanonicalRedirect,
} from '@/components/media/groups-view';
import { SpeakerDirectoryPage } from '@/components/media/speakers';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/watch/speakers` — People who speak in at least one published Video
 * (ROUTE_MAP.md §3.7): a directory over People, never a second speaker record,
 * `?letter, q, language, sort, page` (Watch Part 2), one address per view.
 * Details live at `/people/{slug}`, and `/watch/speakers/{slug}` 301s there.
 */
export const dynamic = 'force-dynamic';

interface BrowseParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: BrowseParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'watch' });
  return shellMetadata({
    locale,
    route: requireRoute('watch.speakers'),
    title: t('sections.speakers'),
    description: t('sectionBody.speakers'),
  });
}

export default async function SpeakersPage({ params, searchParams }: BrowseParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const canonical = speakersCanonicalRedirect(locale, query);
  if (canonical !== null) redirect(canonical);
  return <SpeakerDirectoryPage locale={locale} view={readSpeakersView(query, locale)} />;
}
