import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { quranAvailability, quranMetadata } from '@/components/quran/read';
import { StudyListingPage, studyWorks } from '@/components/quran/study-works';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/quran/transliteration` — every public Transliteration work, each
 * counted and sampled, and read through the reader's `?transliteration=`
 * preference or its settings (Quran Part 7). No scheme is derived here:
 * transliteration is only ever a work a source supplied.
 *
 * HIDDEN UNTIL PUBLISHED (OPEN_DECISIONS.md §1.2 item 3): while no corpus is
 * active, or no Transliteration is public, the page does not exist — a 404,
 * never an empty "coming soon".
 *
 * Signed out and `force-dynamic`: the corpus and its works are mutable data.
 */
export const dynamic = 'force-dynamic';

interface SectionParams {
  readonly params: Promise<{ readonly locale: string }>;
}

async function published() {
  const availability = await quranAvailability();
  if (!availability.active) return null;
  return (await studyWorks('transliteration')).length > 0 ? availability : null;
}

export async function generateMetadata({ params }: SectionParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const availability = await published();
  if (availability === null) return { robots: { index: false, follow: false } };
  const t = await getTranslations({ locale, namespace: 'quran' });
  return quranMetadata({
    locale,
    availability,
    canonicalPath: '/quran/transliteration',
    title: t('sections.transliteration'),
    description: t('sectionBody.transliteration'),
  });
}

export default async function TransliterationRoute({ params }: SectionParams) {
  const locale = await requireLocale(params);
  const availability = await published();
  if (availability === null) notFound();
  return (
    <StudyListingPage
      locale={locale}
      availability={availability}
      kind="transliteration"
    />
  );
}
