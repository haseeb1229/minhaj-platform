import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { SpeakerBrowsePage } from '@/components/media/watch';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/watch/speakers` — People who speak in at least one published Video
 * (ROUTE_MAP.md §3.7). A browse over People, never a second speaker record:
 * details live at `/people/{slug}`, and `/watch/speakers/{slug}` 301s there.
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
  return <SpeakerBrowsePage locale={locale} query={await searchParams} />;
}
