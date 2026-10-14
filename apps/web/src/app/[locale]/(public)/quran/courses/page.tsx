import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { QuranUnavailable } from '@/components/quran/parts';
import { readQuranOffset } from '@/components/quran/presentation';
import {
  quranAvailability,
  quranMetadata,
  readQuranTopic,
} from '@/components/quran/read';
import { QuranRelatedPage, RELATED_CANONICAL } from '@/components/quran/related';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/quran/courses` — Learning's published Courses on Taxonomy's
 * `quran` Topic, a related-material view canonical to the owner's own
 * catalogue (ROUTE_MAP.md §3.3; Phase 22). It reads Learning's public listing
 * and nothing of Quran's; without the Topic there is nothing to filter by, and
 * the view does not exist.
 */
export const dynamic = 'force-dynamic';

interface RelatedParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: RelatedParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'quran' });
  return quranMetadata({
    locale,
    availability: await quranAvailability(),
    canonicalPath: RELATED_CANONICAL.courses,
    title: t('sections.courses'),
    description: t('sectionBody.courses'),
  });
}

export default async function QuranCoursesRoute({ params, searchParams }: RelatedParams) {
  const locale = await requireLocale(params);
  const availability = await quranAvailability();
  if (!availability.active) {
    const t = await getTranslations({ locale, namespace: 'quran' });
    return <QuranUnavailable locale={locale} section={t('sections.courses')} />;
  }
  const topic = await readQuranTopic(locale);
  if (topic === null) notFound();
  return (
    <QuranRelatedPage
      locale={locale}
      availability={availability}
      kind="courses"
      topic={topic}
      offset={readQuranOffset(await searchParams)}
    />
  );
}
