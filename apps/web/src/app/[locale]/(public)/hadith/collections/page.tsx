import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { CollectionsPage } from '@/components/hadith/structure';
import { HadithUnavailable } from '@/components/hadith/parts';
import { hadithAvailability, hadithMetadata } from '@/components/hadith/read';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/hadith/collections` — every activated collection holding at least
 * one public citation, in its recorded order.
 *
 * Signed out and `force-dynamic`: activation and what is public are mutable
 * data. The honest unavailable state while no collection is activated; the
 * fixture banner and `noindex` while the activation is fixture text.
 */
export const dynamic = 'force-dynamic';

interface SectionParams {
  readonly params: Promise<{ readonly locale: string }>;
}

export async function generateMetadata({ params }: SectionParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'hadith' });
  return hadithMetadata({
    locale,
    availability: await hadithAvailability(),
    canonicalPath: '/hadith/collections',
    title: t('sections.collections'),
    description: t('sectionBody.collections'),
  });
}

export default async function CollectionsRoute({ params }: SectionParams) {
  const locale = await requireLocale(params);
  const availability = await hadithAvailability();
  if (!availability.active) {
    const t = await getTranslations({ locale, namespace: 'hadith' });
    return <HadithUnavailable locale={locale} section={t('sections.collections')} />;
  }
  return <CollectionsPage locale={locale} availability={availability} />;
}
