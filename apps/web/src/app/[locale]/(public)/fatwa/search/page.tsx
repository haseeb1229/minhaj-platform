import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { FatwaUnavailable } from '@/components/fatwa/parts';
import { fatwaAvailability, fatwaSearchRobots } from '@/components/fatwa/read';
import { FatwaSearchPage } from '@/components/fatwa/search';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/fatwa/search` — Fatwa search (ROUTE_MAP.md §3.8), `noindex`
 * always (§9.5). The unified Search service restricted to `fatwa`, and
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
  const t = await getTranslations({ locale, namespace: 'fatwa' });
  return {
    title: t('sections.search'),
    description: t('sectionBody.search'),
    robots: fatwaSearchRobots(await fatwaAvailability()),
  };
}

export default async function FatwaSearchRoute({ params, searchParams }: SearchParams) {
  const locale = await requireLocale(params);
  const availability = await fatwaAvailability();
  if (!availability.active) {
    const t = await getTranslations({ locale, namespace: 'fatwa' });
    return <FatwaUnavailable locale={locale} section={t('sections.search')} />;
  }
  return (
    <FatwaSearchPage
      locale={locale}
      availability={availability}
      query={await searchParams}
    />
  );
}
