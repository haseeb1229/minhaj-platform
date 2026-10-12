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
 * `/{locale}/hadith/books` — Library's public Works on Taxonomy's `hadith`
 * Topic, a related-material view canonical to the owner's own collection
 * (ROUTE_MAP.md §3.4). It reads the owner's public listing and nothing of
 * Hadith's; without the Topic there is nothing to filter by, and the view does
 * not exist.
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
    canonicalPath: RELATED_CANONICAL.books,
    title: t('sections.books'),
    description: t('sectionBody.books'),
  });
}

export default async function HadithBooksRoute({ params, searchParams }: RelatedParams) {
  const locale = await requireLocale(params);
  const availability = await hadithAvailability();
  if (!availability.active) {
    const t = await getTranslations({ locale, namespace: 'hadith' });
    return <HadithUnavailable locale={locale} section={t('sections.books')} />;
  }
  const topic = await readHadithTopic(locale);
  if (topic === null) notFound();
  return (
    <HadithRelatedPage
      locale={locale}
      availability={availability}
      kind="books"
      topic={topic}
      offset={readHadithOffset(await searchParams)}
    />
  );
}
