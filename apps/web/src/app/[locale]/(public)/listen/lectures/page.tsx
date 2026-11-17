import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { LecturesPage } from '@/components/media/listen-lectures';
import {
  lecturesCanonicalRedirect,
  readLecturesView,
} from '@/components/media/listen-view';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/listen/lectures` — every published non-Quran recording,
 * `?topic, language, speaker, series, length, sort, page` (ROUTE_MAP.md §3.7;
 * rebuilt in Watch Part 3).
 *
 * ONE ADDRESS PER VIEW: a form's empty controls, another order of the same
 * parameters, a malformed or repeated value and a former `?offset=` are each
 * ONE redirect to the view's canonical spelling (`lecturesCanonicalRedirect`).
 * A filtered view is canonical to this base listing and never a sitemap entry
 * (ROUTE_MAP.md §2.3); `force-dynamic` because a cached copy would keep
 * offering a withdrawn recording.
 */
export const dynamic = 'force-dynamic';

interface ListingParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: ListingParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'listen' });
  return shellMetadata({
    locale,
    route: requireRoute('listen.lectures'),
    title: t('sections.lectures'),
    description: t('sectionBody.lectures'),
  });
}

export default async function LecturesRoute({ params, searchParams }: ListingParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const canonical = lecturesCanonicalRedirect(locale, query);
  if (canonical !== null) redirect(canonical);
  return <LecturesPage locale={locale} view={readLecturesView(query)} />;
}
