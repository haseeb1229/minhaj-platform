import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { QuranUnavailable } from '@/components/quran/parts';
import { readSurahSegment } from '@/components/quran/presentation';
import { quranAvailability, quranMetadata } from '@/components/quran/read';
import { TafsirHubPage } from '@/components/quran/tafsir';
import { tafsirSurahPath } from '@/components/quran/tafsir-layout';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/quran/tafsir` — THE TAFSIR HUB (Quran Part 8; ROUTE_MAP.md §3.3):
 * the public Tafsir texts, the Surah grid, and the tafsir books (Library) and
 * lectures (Media) linked to the ayat they explain, composed at Layer 4.
 *
 * `?surah=` (and an optional `?ayah=`) is the hub's no-script "find" form: it
 * answers with ONE redirect to that Surah's tafsir page, which places the Ayah.
 * Anything malformed is ignored and the hub is shown.
 *
 * Signed out and `force-dynamic`: every part is mutable public data. The
 * honest unavailable state while no corpus is active.
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
    canonicalPath: '/quran/tafsir',
    title: t('sections.tafsir'),
    description: t('sectionBody.tafsir'),
  });
}

export default async function TafsirHubRoute({ params, searchParams }: SectionParams) {
  const locale = await requireLocale(params);
  const availability = await quranAvailability();
  if (!availability.active) {
    const t = await getTranslations({ locale, namespace: 'quran' });
    return <QuranUnavailable locale={locale} section={t('sections.tafsir')} />;
  }
  const query = await searchParams;
  const surah =
    typeof query['surah'] === 'string' ? readSurahSegment(query['surah']) : null;
  if (surah !== null) {
    const ayah = typeof query['ayah'] === 'string' ? query['ayah'] : '';
    redirect(
      /^[1-9]\d{0,2}$/u.test(ayah)
        ? `${tafsirSurahPath(locale, surah)}?ayah=${ayah}`
        : tafsirSurahPath(locale, surah),
    );
  }
  return <TafsirHubPage locale={locale} availability={availability} />;
}
