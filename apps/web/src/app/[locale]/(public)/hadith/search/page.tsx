import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { HadithAwaiting } from '@/components/hadith/guide';
import { hadithAvailability, hadithSearchRobots } from '@/components/hadith/read';
import { HadithSearchPage } from '@/components/hadith/search';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/hadith/search` — Hadith search (ROUTE_MAP.md §3.4), `noindex`
 * always (§9.5). The unified Search service restricted to `hadith`, and
 * throttled by the request proxy exactly as `/search` is, before this page
 * renders. Signed out, dynamic, never cached.
 *
 * While no collection is activated it awaits an authorised source
 * (`HadithAwaiting`, Hadith Part 2) and searches nothing of Hadith's: it
 * offers SITE search on the `hadith` Topic instead — a GET form to `/search`
 * carrying the visitor's words — and says it does not search hadith text.
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
  if (!availability.active)
    return <HadithAwaiting locale={locale} section="search" query={await searchParams} />;
  return (
    <HadithSearchPage
      locale={locale}
      availability={availability}
      query={await searchParams}
    />
  );
}
