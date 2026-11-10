import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { quranAvailability, quranMetadata } from '@/components/quran/read';
import { StudyListingPage, studyWorks } from '@/components/quran/study-works';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/quran/word-by-word` — every public word-by-word work, each
 * counted and sampled, and read through the reader's `?words=`
 * preference or its settings (Quran Part 7). No gloss is derived here: a
 * gloss is only ever what a source supplied, beside the stored Arabic word.
 *
 * HIDDEN UNTIL PUBLISHED (OPEN_DECISIONS.md §1.2 item 3): while no corpus is
 * active, or no word-by-word work is public, the page does not exist — a 404,
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
  return (await studyWorks('words')).length > 0 ? availability : null;
}

export async function generateMetadata({ params }: SectionParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const availability = await published();
  if (availability === null) return { robots: { index: false, follow: false } };
  const t = await getTranslations({ locale, namespace: 'quran' });
  return quranMetadata({
    locale,
    availability,
    canonicalPath: '/quran/word-by-word',
    title: t('sections.wordByWord'),
    description: t('sectionBody.wordByWord'),
  });
}

export default async function WordByWordRoute({ params }: SectionParams) {
  const locale = await requireLocale(params);
  const availability = await published();
  if (availability === null) notFound();
  return <StudyListingPage locale={locale} availability={availability} kind="words" />;
}
