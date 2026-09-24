import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import { topicSlugSchema, type TopicView } from '@minhaj/contracts/taxonomy';

import { taxonomyRuntime } from '@/composition/taxonomy';
import { WatchTopicPage } from '@/components/media/watch';
import { requireLocale } from '@/config/route-locale';
import { contentMetadata } from '@/seo/metadata';

/**
 * `/{locale}/watch/topics/{slug}` — the Videos on one topic.
 *
 * A FILTERED VIEW, NOT A RESOURCE (ROUTE_MAP.md §2.2). Its canonical link and
 * its alternates point at the topic hub, `/topics/{slug}`, which lists these
 * Videos too; it is never a sitemap entry. Taxonomy owns the topic: an archived
 * one is a 404 here, and the slug is immutable, so there is nothing to redirect.
 */
export const dynamic = 'force-dynamic';

interface TopicParams {
  readonly params: Promise<{ readonly locale: string; readonly slug: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function loadTopic(locale: Locale, slug: string): Promise<TopicView | null> {
  if (!topicSlugSchema.safeParse(slug).success) return null;
  const topic = await taxonomyRuntime().taxonomy.findTopicBySlug({ slug, locale });
  return topic !== null && topic.status === 'active' ? topic : null;
}

export async function generateMetadata({ params }: TopicParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const topic = await loadTopic(locale, slug);
  if (topic === null) return { robots: { index: false, follow: false } };
  const t = await getTranslations({ locale, namespace: 'watch' });
  return contentMetadata({
    locale,
    contentLocales: topic.translatedLocales,
    primaryLocale: 'en',
    // Canonical and alternates are the TOPIC HUB's, not this view's.
    pathFor: (target) => `/${target}/topics/${encodeURIComponent(topic.slug)}`,
    title: `${t('topicTitle')}: ${topic.label.name}`,
  });
}

export default async function WatchTopicRoute({ params, searchParams }: TopicParams) {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const topic = await loadTopic(locale, slug);
  if (topic === null) notFound();
  return <WatchTopicPage locale={locale} topic={topic} query={await searchParams} />;
}
