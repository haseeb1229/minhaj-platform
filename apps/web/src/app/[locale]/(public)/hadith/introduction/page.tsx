import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { HadithIntroductionPage } from '@/components/hadith/landing';
import { HadithUnavailable } from '@/components/hadith/parts';
import { hadithAvailability, hadithMetadata } from '@/components/hadith/read';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/hadith/introduction` — how the Hadith section is organised and
 * what each part of a citation page shows. Product guidance only; it claims
 * nothing about any narration.
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
    canonicalPath: '/hadith/introduction',
    title: t('sections.introduction'),
    description: t('sectionBody.introduction'),
  });
}

export default async function IntroductionRoute({ params }: SectionParams) {
  const locale = await requireLocale(params);
  const availability = await hadithAvailability();
  if (!availability.active) {
    const t = await getTranslations({ locale, namespace: 'hadith' });
    return <HadithUnavailable locale={locale} section={t('sections.introduction')} />;
  }
  return <HadithIntroductionPage locale={locale} availability={availability} />;
}
