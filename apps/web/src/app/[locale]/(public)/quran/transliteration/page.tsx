import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { QuranUnavailable } from '@/components/quran/parts';
import { quranAvailability, quranMetadata } from '@/components/quran/read';
import { WorkListingPage } from '@/components/quran/works';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/quran/transliteration` — every public Transliteration work, each
 * read through the reader's `?transliteration=` preference. No scheme is derived
 * here: transliteration is only ever a work a source supplied.
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
    canonicalPath: '/quran/transliteration',
    title: t('sections.transliteration'),
    description: t('sectionBody.transliteration'),
  });
}

export default async function TransliterationRoute({ params }: SectionParams) {
  const locale = await requireLocale(params);
  const availability = await quranAvailability();
  if (!availability.active) {
    const t = await getTranslations({ locale, namespace: 'quran' });
    return <QuranUnavailable locale={locale} section={t('sections.transliteration')} />;
  }
  return (
    <WorkListingPage locale={locale} availability={availability} kind="transliteration" />
  );
}
