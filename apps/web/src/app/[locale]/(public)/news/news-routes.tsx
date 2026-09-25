import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import type { NewsKind } from '@minhaj/contracts/editorial';

import { NewsDetailPage, NewsFamilyPage, readNews } from '@/components/editorial/news';
import { newsMetadata } from '@/components/editorial/presentation';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * The shared behaviour of the News families' listings and detail pages — ONE
 * route implementation per page kind, parameterised by the family.
 *
 * EACH FAMILY HAS ITS OWN CANONICAL ADDRESSES. A NewsArticle is
 * `/news/{slug}`; a press release, a statement and a record of media coverage
 * live beneath their own listing. The read service returns `null` for a slug
 * no published record of THIS family holds, so the page 404s — and the request
 * proxy has already answered a former slug with a single 301 to the current
 * address (ROUTE_MAP.md §9.7). Signed out, and `force-dynamic` because records
 * are published and withdrawn.
 */

export interface ListingParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export interface DetailParams {
  readonly params: Promise<{ readonly locale: string; readonly slug: string }>;
}

const SURFACE = {
  'press-release': 'press-releases',
  statement: 'statements',
  'media-coverage': 'media-coverage',
} as const;

export function newsListingRoute(kind: Exclude<NewsKind, 'news-article'>) {
  return {
    async generateMetadata({ params }: ListingParams): Promise<Metadata> {
      const locale = await requireLocale(params);
      const t = await getTranslations({ locale, namespace: 'news' });
      return shellMetadata({
        locale,
        route: requireRoute(`news.${SURFACE[kind]}`),
        title: t(`families.${kind}`),
        description: t(`familyBody.${kind}`),
      });
    },
    async Page({ params, searchParams }: ListingParams) {
      const locale = await requireLocale(params);
      return <NewsFamilyPage locale={locale} kind={kind} query={await searchParams} />;
    },
  };
}

export function newsDetailRoute(kind: NewsKind) {
  return {
    async generateMetadata({ params }: DetailParams): Promise<Metadata> {
      const locale = await requireLocale(params);
      const { slug } = await params;
      const record = await readNews(kind, slug);
      return record === null
        ? { robots: { index: false, follow: false } }
        : newsMetadata(record, locale);
    },
    async Page({ params }: DetailParams) {
      const locale = await requireLocale(params);
      const { slug } = await params;
      const record = await readNews(kind, slug);
      if (record === null) notFound();
      return <NewsDetailPage locale={locale} record={record} />;
    },
  };
}
