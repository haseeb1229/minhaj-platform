import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import type { NewsKind } from '@minhaj/contracts/editorial';

import { NewsDetailPage, readNews } from '@/components/editorial/news';
import { NewsListingPage } from '@/components/editorial/news-listing';
import { newsCanonicalRedirect, readNewsView } from '@/components/editorial/news-view';
import { newsMetadata } from '@/components/editorial/presentation';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * The shared behaviour of the News families' listings and detail pages — ONE
 * route implementation per page kind, parameterised by the family.
 *
 * ONE LISTING, FOUR ADDRESSES (News & Events Part 1). `/news` and the three
 * family listings render the same listing for their own family; each view has
 * ONE address — a form's empty controls, another order of the parameters, a
 * malformed or repeated value, R2's `?lang=`, Phase 13's `?offset=` and
 * `?sort=latest` are each ONE redirect to the canonical spelling
 * (`newsCanonicalRedirect`). Every view is canonical to its base listing and
 * never a sitemap entry (ROUTE_MAP.md §2.3).
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

const ROUTE = {
  'news-article': 'news-events',
  'press-release': 'news.press-releases',
  statement: 'news.statements',
  'media-coverage': 'news.media-coverage',
} as const;

export function newsListingRoute(kind: NewsKind) {
  return {
    async generateMetadata({ params }: ListingParams): Promise<Metadata> {
      const locale = await requireLocale(params);
      const t = await getTranslations({ locale, namespace: 'news' });
      return shellMetadata({
        locale,
        route: requireRoute(ROUTE[kind]),
        title: kind === 'news-article' ? t('title') : t(`families.${kind}`),
        description: kind === 'news-article' ? t('description') : t(`familyBody.${kind}`),
      });
    },
    async Page({ params, searchParams }: ListingParams) {
      const locale = await requireLocale(params);
      const query = await searchParams;
      const canonical = newsCanonicalRedirect(locale, kind, query);
      if (canonical !== null) redirect(canonical);
      return (
        <NewsListingPage locale={locale} kind={kind} view={readNewsView(kind, query)} />
      );
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
