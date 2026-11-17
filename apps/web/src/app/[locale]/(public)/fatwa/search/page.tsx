import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { FatwaAwaiting } from '@/components/fatwa/guide';
import { fatwaAvailability, fatwaSearchRobots } from '@/components/fatwa/read';
import { FatwaSearchPage } from '@/components/fatwa/search';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/fatwa/search` — Fatwa search (ROUTE_MAP.md §3.8), `noindex`
 * always (§9.5). The unified Search service restricted to `fatwa`, and
 * throttled by the request proxy exactly as `/search` is, before this page
 * renders. Signed out, dynamic, never cached. While the service is inactive
 * it awaits the service (`FatwaAwaiting`, Fatwa Part 1): it offers no form and
 * searches nothing, since nothing of Fatwa's is published.
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
  if (!availability.active) return <FatwaAwaiting locale={locale} section="search" />;
  return (
    <FatwaSearchPage
      locale={locale}
      availability={availability}
      query={await searchParams}
    />
  );
}
