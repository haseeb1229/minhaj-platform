import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import { topicSlugSchema } from '@minhaj/contracts/taxonomy';

import { readFatwaOffset } from '@/components/fatwa/presentation';
import {
  fatwaAvailability,
  fatwaContentMetadata,
  readActiveTopic,
} from '@/components/fatwa/read';
import { FatwaTopicPage } from '@/components/fatwa/topics';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/fatwa/topics/{slug}` — the published rulings on one Topic.
 *
 * A FILTERED VIEW, NOT A RESOURCE (ROUTE_MAP.md §2.2, §3.8). Its canonical link
 * and alternates are the TOPIC HUB's, `/topics/{slug}`, and it is never a
 * sitemap entry. Taxonomy owns the Topic: an archived or unknown one is a 404.
 */
export const dynamic = 'force-dynamic';

interface TopicParams {
  readonly params: Promise<{ readonly locale: string; readonly slug: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function loadTopic(locale: Locale, slug: string) {
  return topicSlugSchema.safeParse(slug).success ? readActiveTopic(locale, slug) : null;
}

export async function generateMetadata({ params }: TopicParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const topic = await loadTopic(locale, slug);
  if (topic === null) return { robots: { index: false, follow: false } };
  const t = await getTranslations({ locale, namespace: 'fatwa' });
  return fatwaContentMetadata(await fatwaAvailability(), {
    locale,
    contentLocales: topic.translatedLocales,
    primaryLocale: 'en',
    // Canonical and alternates are the TOPIC HUB's, not this view's.
    pathFor: (target) => `/${target}/topics/${encodeURIComponent(topic.slug)}`,
    title: `${t('topicTitle')}: ${topic.label.name}`,
  });
}

export default async function FatwaTopicRoute({ params, searchParams }: TopicParams) {
  const locale = await requireLocale(params);
  const availability = await fatwaAvailability();
  // A named view while the service is inactive is absent (ROUTE_MAP.md §3.8).
  if (!availability.active) notFound();
  const { slug } = await params;
  const topic = await loadTopic(locale, slug);
  if (topic === null) notFound();
  return (
    <FatwaTopicPage
      locale={locale}
      availability={availability}
      topic={topic}
      offset={readFatwaOffset(await searchParams)}
    />
  );
}
