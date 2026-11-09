import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { readJuzIndexQuery } from '@/components/quran/juz-layout';
import { QuranUnavailable } from '@/components/quran/parts';
import { quranAvailability, quranMetadata } from '@/components/quran/read';
import { JuzIndexPage } from '@/components/quran/reader';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/quran/juz` — every Juz by the opening words of its first Ayah,
 * with its range, Surahs, pages and hizb (Quran Part 3).
 *
 * `?q=` filters by number ("15", "Juz 15") or by a hizb the Juz holds
 * ("hizb 30") — on the server, so a reader without JavaScript gets the list
 * the client island gives on each keystroke. It is read tolerantly (an
 * over-long filter is cut), and the canonical address is the bare index.
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
    canonicalPath: '/quran/juz',
    title: t('sections.juz'),
    description: t('sectionBody.juz'),
  });
}

export default async function JuzIndexRoute({ params, searchParams }: SectionParams) {
  const locale = await requireLocale(params);
  const availability = await quranAvailability();
  if (!availability.active) {
    const t = await getTranslations({ locale, namespace: 'quran' });
    return <QuranUnavailable locale={locale} section={t('sections.juz')} />;
  }
  return (
    <JuzIndexPage
      locale={locale}
      availability={availability}
      query={readJuzIndexQuery(await searchParams)}
    />
  );
}
