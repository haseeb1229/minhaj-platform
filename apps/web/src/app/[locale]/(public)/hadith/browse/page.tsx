import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { BrowsePage } from '@/components/hadith/structure';
import { HadithUnavailable } from '@/components/hadith/parts';
import { offsetPathOf, readHadithOffset } from '@/components/hadith/presentation';
import { hadithAvailability, hadithMetadata } from '@/components/hadith/read';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/hadith/browse` — every public citation, collection by collection
 * and number by number, in bounded pages that each canonicalise to themselves
 * (ROUTE_MAP.md §9.1 rule 4).
 *
 * Signed out and `force-dynamic`: activation and what is public are mutable
 * data. The honest unavailable state while no collection is activated; the
 * fixture banner and `noindex` while the activation is fixture text.
 */
export const dynamic = 'force-dynamic';

interface SectionParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({
  params,
  searchParams,
}: SectionParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'hadith' });
  const offset = readHadithOffset(await searchParams);
  return hadithMetadata({
    locale,
    availability: await hadithAvailability(),
    canonicalPath: offsetPathOf('/hadith/browse', offset),
    title: t('sections.browse'),
    description: t('sectionBody.browse'),
  });
}

export default async function BrowseRoute({ params, searchParams }: SectionParams) {
  const locale = await requireLocale(params);
  const availability = await hadithAvailability();
  if (!availability.active) {
    const t = await getTranslations({ locale, namespace: 'hadith' });
    return <HadithUnavailable locale={locale} section={t('sections.browse')} />;
  }
  return (
    <BrowsePage
      locale={locale}
      availability={availability}
      offset={readHadithOffset(await searchParams)}
    />
  );
}
