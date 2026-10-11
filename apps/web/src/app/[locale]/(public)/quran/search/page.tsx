import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { QuranUnavailable } from '@/components/quran/parts';
import { quranAvailability, quranSearchRobots } from '@/components/quran/read';
import { QuranSearchPage } from '@/components/quran/search';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/quran/search` — Quran search (ROUTE_MAP.md §3.3), `noindex`
 * always (§9.5). The unified Search service restricted to `quran-ayah`, and
 * throttled by the request proxy exactly as `/search` is, before this page
 * renders. Signed out, dynamic, never cached.
 */
export const dynamic = 'force-dynamic';

interface SearchParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: SearchParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'quran' });
  return {
    title: t('sections.search'),
    description: t('sectionBody.search'),
    robots: quranSearchRobots(await quranAvailability()),
  };
}

export default async function QuranSearchRoute({ params, searchParams }: SearchParams) {
  const locale = await requireLocale(params);
  const availability = await quranAvailability();
  if (!availability.active) {
    const t = await getTranslations({ locale, namespace: 'quran' });
    return <QuranUnavailable locale={locale} section={t('sections.search')} />;
  }
  return (
    <QuranSearchPage
      locale={locale}
      availability={availability}
      query={await searchParams}
    />
  );
}
