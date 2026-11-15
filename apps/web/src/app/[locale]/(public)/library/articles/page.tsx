import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { localizedPath } from '@minhaj/contracts';

import { editorialReadRuntime } from '@/composition/editorial-read';
import { ArticleCard } from '@/components/editorial/article-card';
import {
  articlesCanonicalRedirect,
  articlesHref,
  articlesOffset,
  articlesPageCount,
  articlesRange,
  readArticlesPage,
} from '@/components/editorial/articles-view';
import { ExploreHero } from '@/components/topic-hub/parts';
import { ListingFooter } from '@/components/topic-hub/research';
import {
  Breadcrumbs,
  CardGrid,
  Container,
  EmptyState,
  Pager,
  SectionHeader,
} from '@/components/ui';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/library/articles` — EDITORIAL'S ARTICLES, AT THE LIBRARY'S ADDRESS
 * (ROUTE_MAP.md §3.6; Library Part 3), `?page`.
 *
 * ONE LISTING, NOT TWO. Articles are Editorial's (DOMAIN_MODEL.md §7.2): the
 * header's `articles` link, the Library's menu and its resources directory
 * all lead here, and no other articles listing exists — so this page is
 * Editorial's public listing, composed at Layer 4 inside the Library's frame,
 * and Library holds no copy of an Article. Newest by chronology (a migrated
 * article at its own source date), 25 a page with the total and numbered
 * pages; the former `?offset=` and any other spelling of a page is ONE
 * redirect to the canonical address. Each Article keeps its own page at
 * `/library/articles/{slug}`.
 *
 * Unindexed as before (the shell registers it `excluded`); signed out and
 * `force-dynamic` because Articles are published and withdrawn.
 */
export const dynamic = 'force-dynamic';

interface ListingParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: ListingParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'editorial' });
  // R1: the tab says what this is; the listing stays unindexed as before.
  return { title: t('articles'), robots: { index: false, follow: false } };
}

export default async function Articles({ params, searchParams }: ListingParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const canonical = articlesCanonicalRedirect(locale, query);
  if (canonical !== null) redirect(canonical);
  const page = readArticlesPage(query);

  const [t, library, shell] = await Promise.all([
    getTranslations({ locale, namespace: 'editorial' }),
    getTranslations({ locale, namespace: 'library' }),
    getTranslations({ locale, namespace: 'shell' }),
  ]);
  const editorial = editorialReadRuntime();
  const [records, total] = await Promise.all([
    editorial.articles(articlesOffset(page)),
    editorial.articleCount(),
  ]);
  const title = t('articles');
  const pages = articlesPageCount(total);
  const range = articlesRange(page, records.length);
  const LIST_ID = 'library-articles-list';
  const link = (path: string, text: string) => ({
    href: localizedPath(locale, path),
    text,
  });

  return (
    <Container>
      <div className="flex min-w-0 flex-col gap-8 pt-6 pb-[var(--space-section)]">
        <Breadcrumbs
          label={shell('nav.breadcrumbs')}
          trail={[
            { href: localizedPath(locale, ''), text: shell('nav.home') },
            { href: localizedPath(locale, '/library'), text: library('title') },
            { text: title },
          ]}
        />
        <ExploreHero
          eyebrow={library('title')}
          title={title}
          lede={library('sectionBody.articles')}
          stats={
            total === 0
              ? []
              : [
                  {
                    value: total,
                    label: library('articlesPage.stat', { count: total }),
                    href: `#${LIST_ID}`,
                  },
                ]
          }
          actions={[link('/news', library('articlesPage.news'))]}
        />

        {total === 0 ? (
          <EmptyState
            icon="book"
            title={library('articlesPage.emptyTitle')}
            action={link('/library/resources', library('records.toResources'))}
          >
            {t('empty')}
          </EmptyState>
        ) : (
          <section aria-labelledby={LIST_ID} className="flex flex-col gap-5">
            <SectionHeader
              id={LIST_ID}
              heading={library('articlesPage.listHeading')}
              intro={library('articlesPage.listIntro')}
            />
            {range === null ? (
              <EmptyState
                title={library('articlesPage.pastEndTitle')}
                action={{
                  href: articlesHref(locale, 1),
                  text: library('articlesPage.firstPage'),
                }}
              >
                {library('articlesPage.pastEnd', { page })}
              </EmptyState>
            ) : (
              <>
                <p className="text-sm text-foreground-muted">
                  {library('articlesPage.summary', {
                    from: range.from,
                    to: range.to,
                    total,
                  })}
                </p>
                <CardGrid label={title}>
                  {records.map((record) => (
                    // Newest by chronology; the card shows the lead image where there is one.
                    <ArticleCard key={record.slug} locale={locale} record={record} />
                  ))}
                </CardGrid>
                <Pager
                  label={library('articlesPage.pages')}
                  previous={page > 1 ? articlesHref(locale, page - 1) : null}
                  next={page < pages ? articlesHref(locale, page + 1) : null}
                  previousLabel={t('previous')}
                  nextLabel={t('next')}
                  pages={{
                    current: page,
                    total: pages,
                    href: (number) => articlesHref(locale, number),
                    label: (number) =>
                      library('articlesPage.pageLabel', { page: number }),
                    format: (number) => new Intl.NumberFormat(locale).format(number),
                  }}
                />
              </>
            )}
          </section>
        )}

        <ListingFooter
          about={library('articlesPage.about')}
          links={[
            link('/library/research', library('records.research.all')),
            link('/library/books', library('records.toBooks')),
            link('/library', library('booksPage.libraryHome')),
          ]}
        />
      </div>
    </Container>
  );
}
