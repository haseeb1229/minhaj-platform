import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';

import {
  readReadingRequest,
  readSurahSegment,
  surahName,
  surahPathOf,
} from '@/components/quran/presentation';
import { quranAvailability, quranMetadata, readSurah } from '@/components/quran/read';
import { SurahPage } from '@/components/quran/reader';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/quran/surah/{surahNumber}` — one Surah (ROUTE_MAP.md §3.3).
 *
 * ONE READ FOR ITS AYAT, ONE PER CHOSEN LAYER. `?translation`, `?tafsir`,
 * `?reciter` and `?transliteration` are validated against the PUBLIC works; an
 * unknown one is a visible notice and no layer, never another work. The
 * canonical address is the bare Surah address — preferences are never part of
 * it (ROUTE_MAP.md §2.1).
 *
 * A Surah that does not exist — or any Surah while no corpus is active — is a
 * 404: the resource is absent, not unavailable.
 */
export const dynamic = 'force-dynamic';

interface SurahParams {
  readonly params: Promise<{ readonly locale: string; readonly surahNumber: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function load(params: SurahParams['params']) {
  const { surahNumber } = await params;
  const number = readSurahSegment(surahNumber);
  return number === null ? null : readSurah(number);
}

export async function generateMetadata({ params }: SurahParams): Promise<Metadata> {
  const locale: Locale = await requireLocale(params);
  const surah = await load(params);
  if (surah === null) return { robots: { index: false, follow: false } };
  const t = await getTranslations({ locale, namespace: 'quran' });
  const name = surahName(surah, locale);
  const heading = t('surahName', { number: surah.number });
  return quranMetadata({
    locale,
    availability: await quranAvailability(),
    canonicalPath: surahPathOf(surah.number),
    title: name === null ? heading : `${heading} · ${name.text}`,
    description: t('ayahCount', { count: surah.ayahCount }),
  });
}

export default async function SurahRoute({ params, searchParams }: SurahParams) {
  const locale = await requireLocale(params);
  const [availability, surah] = await Promise.all([quranAvailability(), load(params)]);
  if (!availability.active || surah === null) notFound();
  return (
    <SurahPage
      locale={locale}
      availability={availability}
      surah={surah}
      request={readReadingRequest(await searchParams)}
    />
  );
}
