import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { COMPARE_PATH, compareRequest } from '@/components/quran/compare';
import { QuranUnavailable } from '@/components/quran/parts';
import { quranAvailability, quranMetadata, readSurahs } from '@/components/quran/read';
import { ComparePage } from '@/components/quran/translations';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/quran/translations/compare?surah=&ayah=` — one Ayah's Arabic, once,
 * and every public translation of it with its translator's notes (Quran Part
 * 6). The Ayah is chosen by a GET form and its neighbours by plain links, so
 * the page is complete without script; an Ayah the corpus does not hold is
 * said to be missing, never replaced by another. Its canonical address is the
 * bare view: the citation's own page is the Ayah's address.
 *
 * Signed out and `force-dynamic`: the corpus and its works are mutable data.
 * The honest unavailable state while no corpus is active.
 */
export const dynamic = 'force-dynamic';

interface CompareParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: CompareParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'quran' });
  return quranMetadata({
    locale,
    availability: await quranAvailability(),
    canonicalPath: COMPARE_PATH,
    title: t('translations.compareTitle'),
    description: t('translations.compareIntro'),
  });
}

export default async function CompareRoute({ params, searchParams }: CompareParams) {
  const locale = await requireLocale(params);
  const availability = await quranAvailability();
  const request = availability.active
    ? compareRequest(await searchParams, await readSurahs())
    : null;
  if (!availability.active || request === null) {
    const t = await getTranslations({ locale, namespace: 'quran' });
    return <QuranUnavailable locale={locale} section={t('translations.compareTitle')} />;
  }
  return <ComparePage locale={locale} availability={availability} request={request} />;
}
