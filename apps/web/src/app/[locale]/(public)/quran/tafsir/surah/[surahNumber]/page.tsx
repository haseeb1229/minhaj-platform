import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';

import { readSurahSegment, surahName } from '@/components/quran/presentation';
import { quranAvailability, quranMetadata, readSurah } from '@/components/quran/read';
import { SurahTafsirPage, inSurah } from '@/components/quran/tafsir';
import {
  groupHolding,
  surahTafsirLayout,
  tafsirAyahId,
  tafsirSurahPath,
  tafsirSurahPathOf,
} from '@/components/quran/tafsir-layout';
import { readTafsirResources } from '@/components/quran/tafsir-read';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/quran/tafsir/surah/{surahNumber}` — ONE SURAH'S TAFSIR (Quran
 * Part 8; ROUTE_MAP.md §3.3): what explains the whole Surah, then each group of
 * overlapping passages with its ayat, its tafsir text, its books and its
 * lectures. `surah` is reserved from Tafsir slugs (`TAFSIR_RESERVED_SLUGS`).
 *
 * `?ayah=` jumps to an Ayah: ONE redirect to its place on this page when
 * something explains it, otherwise the page says nothing does yet and links
 * the Ayah. `?translation=` chooses the translation under the Arabic (`none`
 * for the Arabic alone). Neither is part of the canonical address.
 *
 * A Surah that does not exist — or any while no corpus is active — is a 404.
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
  const name = surahName(surah, locale)?.text ?? t('surahName', { number: surah.number });
  return quranMetadata({
    locale,
    availability: await quranAvailability(),
    canonicalPath: tafsirSurahPathOf(surah.number),
    title: t('tafsirSurah.title', { name }),
    description: t('tafsirSurah.intro', { count: surah.ayahCount }),
  });
}

export default async function SurahTafsirRoute({ params, searchParams }: SurahParams) {
  const locale = await requireLocale(params);
  const [availability, surah] = await Promise.all([quranAvailability(), load(params)]);
  if (!availability.active || surah === null) notFound();
  const query = await searchParams;

  const rawAyah = query['ayah'];
  const ayah =
    typeof rawAyah === 'string' && /^[1-9]\d{0,2}$/u.test(rawAyah)
      ? Number(rawAyah)
      : null;
  let missingAyah: number | null = null;
  if (ayah !== null && inSurah(surah.number, ayah)) {
    const layout = surahTafsirLayout(
      await readTafsirResources(surah.number, 1, surah.ayahCount),
      surah.number,
    );
    const path = tafsirSurahPath(locale, surah.number);
    if (groupHolding(layout, ayah) !== null)
      redirect(`${path}#${tafsirAyahId(surah.number, ayah)}`);
    const whole = layout.whole;
    // Only whole-Surah tafsir explains it: that is where the Ayah's tafsir is.
    if (whole.texts.length + whole.books.length + whole.lectures.length > 0)
      redirect(`${path}#tafsir-whole`);
    missingAyah = ayah;
  }

  const translation = query['translation'];
  return (
    <SurahTafsirPage
      locale={locale}
      availability={availability}
      surah={surah}
      translationSlug={typeof translation === 'string' ? translation : null}
      missingAyah={missingAyah}
    />
  );
}
