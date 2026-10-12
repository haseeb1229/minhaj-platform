import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import { topicSlugSchema } from '@minhaj/contracts/taxonomy';

import { taxonomyRuntime } from '@/composition/taxonomy';
import { readHadithOffset } from '@/components/hadith/presentation';
import { hadithAvailability, hadithContentMetadata } from '@/components/hadith/read';
import { HadithTopicPage } from '@/components/hadith/topics';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/hadith/topics/{slug}` — the public citations on one Topic.
 *
 * A FILTERED VIEW, NOT A RESOURCE (ROUTE_MAP.md §2.2). Its canonical link and
 * alternates are the TOPIC HUB's, `/topics/{slug}`, and it is never a sitemap
 * entry. Taxonomy owns the Topic: an archived or unknown one is a 404, as is
 * any Topic while no collection is activated.
 */
export const dynamic = 'force-dynamic';

interface TopicParams {
  readonly params: Promise<{ readonly locale: string; readonly slug: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const loadTopic = cache(async (locale: Locale, slug: string) => {
  if (!topicSlugSchema.safeParse(slug).success) return null;
  const topic = await taxonomyRuntime().taxonomy.findTopicBySlug({ slug, locale });
  return topic !== null && topic.status === 'active' ? topic : null;
});

export async function generateMetadata({ params }: TopicParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const topic = await loadTopic(locale, slug);
  if (topic === null) return { robots: { index: false, follow: false } };
  const t = await getTranslations({ locale, namespace: 'hadith' });
  return hadithContentMetadata(await hadithAvailability(), {
    locale,
    contentLocales: topic.translatedLocales,
    primaryLocale: 'en',
    // Canonical and alternates are the TOPIC HUB's, not this view's.
    pathFor: (target) => `/${target}/topics/${encodeURIComponent(topic.slug)}`,
    title: `${t('topicTitle')}: ${topic.label.name}`,
  });
}

export default async function HadithTopicRoute({ params, searchParams }: TopicParams) {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const [availability, topic] = await Promise.all([
    hadithAvailability(),
    loadTopic(locale, slug),
  ]);
  if (!availability.active || topic === null) notFound();
  return (
    <HadithTopicPage
      locale={locale}
      availability={availability}
      topic={topic}
      offset={readHadithOffset(await searchParams)}
    />
  );
}
