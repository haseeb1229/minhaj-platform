import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { QuranUnavailable } from '@/components/quran/parts';
import { quranAvailability, quranMetadata } from '@/components/quran/read';
import { SurahIndexPage } from '@/components/quran/reader';
import { readSurahIndexQuery } from '@/components/quran/surah-index';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/quran/surah` — every Surah, from the reader (Quran Part 2).
 *
 * `?q=` filters by name in any script, meaning or number and `?sort=` orders
 * (`number`, the default; `revelation`, grouped Meccan then Medinan;
 * `longest`; `shortest`) — on the server, so a reader without JavaScript gets
 * the same list the client island gives on each keystroke. Both are read
 * tolerantly: an unknown order is the default, an over-long filter is cut.
 * The canonical address is the bare index whatever either says.
 *
 * Signed out and `force-dynamic`: the corpus and its works are mutable data.
 * The honest unavailable state while no corpus is active; the fixture banner
 * and `noindex` while it is fixture text (Phase 18 §6).
 */
export const dynamic = 'force-dynamic';

interface SectionParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: SectionParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'quran' });
  return quranMetadata({
    locale,
    availability: await quranAvailability(),
    canonicalPath: '/quran/surah',
    title: t('sections.surah'),
    description: t('sectionBody.surah'),
  });
}

export default async function SurahIndexRoute({ params, searchParams }: SectionParams) {
  const locale = await requireLocale(params);
  const availability = await quranAvailability();
  if (!availability.active) {
    const t = await getTranslations({ locale, namespace: 'quran' });
    return <QuranUnavailable locale={locale} section={t('sections.surah')} />;
  }
  return (
    <SurahIndexPage
      locale={locale}
      availability={availability}
      query={readSurahIndexQuery(await searchParams)}
    />
  );
}
