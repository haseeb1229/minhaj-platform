import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import { QuranUnavailable } from '@/components/quran/parts';
import {
  ayahPath,
  readAyahSegment,
  readSurahSegment,
  surahPath,
} from '@/components/quran/presentation';
import { parseQuickJump, quickJumpPathOf } from '@/components/quran/quick-jump';
import {
  quranAvailability,
  quranMetadata,
  readSurah,
  readSurahs,
} from '@/components/quran/read';
import { ReaderEntryPage, jumpIndex } from '@/components/quran/reader';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/quran/read` — the reader entry (ROUTE_MAP.md §3.3).
 *
 * ANONYMOUS AND STATELESS. Resuming a signed-in reader's progress is an
 * uncached, authenticated island a later phase owns; this route reads no
 * session, no progress and no cookie, and writes none.
 *
 * `?surah=&ayah=` IS NAVIGATION, NOT A REDIRECT PARAMETER. Both are canonical
 * decimal numbers checked against the reader — the Surah must exist and the
 * Ayah must be within it — and the only address ever produced is the canonical
 * citation built from those numbers, so no value a URL carries can choose where
 * the visitor is sent. A choice that cannot be honoured is said so in words.
 *
 * `?q=` IS THE QUICK JUMP (R2): "18", "18:10", a Surah name or "juz 15", parsed
 * against the reader's own Surahs, counts and recorded names
 * (`@/components/quran/quick-jump`). The address it opens is built from the
 * numbers that parse confirmed — never from the text typed — so it is no
 * redirect parameter either.
 */
export const dynamic = 'force-dynamic';

interface ReadParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: ReadParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'quran' });
  return quranMetadata({
    locale,
    availability: await quranAvailability(),
    canonicalPath: '/quran/read',
    title: t('sections.read'),
    description: t('sectionBody.read'),
  });
}

export default async function ReadRoute({ params, searchParams }: ReadParams) {
  const locale = await requireLocale(params);
  const availability = await quranAvailability();
  if (!availability.active) {
    const t = await getTranslations({ locale, namespace: 'quran' });
    return <QuranUnavailable locale={locale} section={t('sections.read')} />;
  }

  const query = await searchParams;
  const surahText = query['surah'];
  const ayahText = query['ayah'];
  const jumpText = typeof query['q'] === 'string' ? query['q'] : null;
  let problem: 'surah' | 'ayah' | 'query' | null = null;

  if (jumpText !== null && jumpText.trim() !== '') {
    const target = quickJumpPathOf(
      parseQuickJump(jumpText, jumpIndex(await readSurahs())),
    );
    if (target === null) problem = 'query';
    else redirect(localizedPath(locale, target));
  } else if (surahText !== undefined) {
    const number = typeof surahText === 'string' ? readSurahSegment(surahText) : null;
    const surah = number === null ? null : await readSurah(number);
    if (surah === null) problem = 'surah';
    else if (ayahText === undefined || ayahText === '') {
      redirect(surahPath(locale, surah.number));
    } else {
      const ayah = typeof ayahText === 'string' ? readAyahSegment(ayahText) : null;
      if (ayah === null || ayah > surah.ayahCount) problem = 'ayah';
      else redirect(ayahPath(locale, { surah: surah.number, ayah }));
    }
  }

  return (
    <ReaderEntryPage
      locale={locale}
      availability={availability}
      problem={problem}
      query={problem === 'query' ? (jumpText ?? '') : ''}
    />
  );
}
