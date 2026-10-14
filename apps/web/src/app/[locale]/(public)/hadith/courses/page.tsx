import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { HadithUnavailable } from '@/components/hadith/parts';
import { readHadithOffset } from '@/components/hadith/presentation';
import {
  hadithAvailability,
  hadithMetadata,
  readHadithTopic,
} from '@/components/hadith/read';
import { HadithRelatedPage, RELATED_CANONICAL } from '@/components/hadith/related';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/hadith/courses` — Learning's published Courses on Taxonomy's
 * `hadith` Topic, a related-material view canonical to the owner's own
 * catalogue (ROUTE_MAP.md §3.4; Phase 22). It reads Learning's public listing
 * and nothing of Hadith's; without the Topic there is nothing to filter by, and
 * the view does not exist.
 */
export const dynamic = 'force-dynamic';

interface RelatedParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: RelatedParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'hadith' });
  return hadithMetadata({
    locale,
    availability: await hadithAvailability(),
    canonicalPath: RELATED_CANONICAL.courses,
    title: t('sections.courses'),
    description: t('sectionBody.courses'),
  });
}

export default async function HadithCoursesRoute({
  params,
  searchParams,
}: RelatedParams) {
  const locale = await requireLocale(params);
  const availability = await hadithAvailability();
  if (!availability.active) {
    const t = await getTranslations({ locale, namespace: 'hadith' });
    return <HadithUnavailable locale={locale} section={t('sections.courses')} />;
  }
  const topic = await readHadithTopic(locale);
  if (topic === null) notFound();
  return (
    <HadithRelatedPage
      locale={locale}
      availability={availability}
      kind="courses"
      topic={topic}
      offset={readHadithOffset(await searchParams)}
    />
  );
}
