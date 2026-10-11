import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { QuranUnavailable } from '@/components/quran/parts';
import { quranAvailability, quranMetadata } from '@/components/quran/read';
import { WorkListingPage } from '@/components/quran/works';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/quran/tafsir` — every public Tafsir work.
 *
 * Signed out and `force-dynamic`: the corpus and its works are mutable data.
 * The honest unavailable state while no corpus is active; the fixture banner
 * and `noindex` while it is fixture text (Phase 18 §6).
 */
export const dynamic = 'force-dynamic';

interface SectionParams {
  readonly params: Promise<{ readonly locale: string }>;
}

export async function generateMetadata({ params }: SectionParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'quran' });
  return quranMetadata({
    locale,
    availability: await quranAvailability(),
    canonicalPath: '/quran/tafsir',
    title: t('sections.tafsir'),
    description: t('sectionBody.tafsir'),
  });
}

export default async function TafsirListingRoute({ params }: SectionParams) {
  const locale = await requireLocale(params);
  const availability = await quranAvailability();
  if (!availability.active) {
    const t = await getTranslations({ locale, namespace: 'quran' });
    return <QuranUnavailable locale={locale} section={t('sections.tafsir')} />;
  }
  return <WorkListingPage locale={locale} availability={availability} kind="tafsir" />;
}
