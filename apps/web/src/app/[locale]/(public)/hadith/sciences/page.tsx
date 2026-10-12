import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { SciencesPage } from '@/components/hadith/sciences';
import { HadithUnavailable } from '@/components/hadith/parts';
import { hadithAvailability, hadithMetadata } from '@/components/hadith/read';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/hadith/sciences` — the public study material, in its recorded
 * order.
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
    canonicalPath: '/hadith/sciences',
    title: t('sections.sciences'),
    description: t('sectionBody.sciences'),
  });
}

export default async function SciencesRoute({ params }: SectionParams) {
  const locale = await requireLocale(params);
  const availability = await hadithAvailability();
  if (!availability.active) {
    const t = await getTranslations({ locale, namespace: 'hadith' });
    return <HadithUnavailable locale={locale} section={t('sections.sciences')} />;
  }
  return <SciencesPage locale={locale} availability={availability} />;
}
