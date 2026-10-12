import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { HadithUnavailable } from '@/components/hadith/parts';
import { hadithAvailability, hadithSearchRobots } from '@/components/hadith/read';
import { HadithSearchPage } from '@/components/hadith/search';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/hadith/search` — Hadith search (ROUTE_MAP.md §3.4), `noindex`
 * always (§9.5). The unified Search service restricted to `hadith`, and
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
  const t = await getTranslations({ locale, namespace: 'hadith' });
  return {
    title: t('sections.search'),
    description: t('sectionBody.search'),
    robots: hadithSearchRobots(await hadithAvailability()),
  };
}

export default async function HadithSearchRoute({ params, searchParams }: SearchParams) {
  const locale = await requireLocale(params);
  const availability = await hadithAvailability();
  if (!availability.active) {
    const t = await getTranslations({ locale, namespace: 'hadith' });
    return <HadithUnavailable locale={locale} section={t('sections.search')} />;
  }
  return (
    <HadithSearchPage
      locale={locale}
      availability={availability}
      query={await searchParams}
    />
  );
}
