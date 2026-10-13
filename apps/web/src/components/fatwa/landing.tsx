import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import {
  FATWA_PAGE_SIZE,
  FATWA_SORTS,
  fatwaCategoryName,
  type FatwaAvailability,
  type PublicFatwaPage,
} from '@minhaj/contracts/fatwa';
import { SEARCH_QUERY_MAX_LENGTH } from '@minhaj/contracts/search';

import { fatwaReadRuntime } from '@/composition/fatwa-read';
import { pageLinks } from '@/components/hadith/presentation';
import { Pagination } from '@/components/media/parts';
import {
  Alert,
  Button,
  EmptyState,
  FilterLink,
  PageHeading,
  Panel,
  Prose,
  SectionHeading,
  TextInput,
  TextLink,
} from '@/components/ui';
import { categoryLabels, FatwaList } from './list';
import { FatwaFrame, fatwaTrail } from './parts';
import {
  fatwaBrowseHref,
  fatwaSectionPath,
  isInvalidBrowse,
  readFatwaBrowse,
} from './presentation';
import { readActiveTopic, readFatwaCategory } from './read';

/**
 * `/fatwa` — the Fatwa landing and browse (ROUTE_MAP.md §3.8;
 * INFORMATION_ARCHITECTURE.md §3.7).
 *
 * ONE PAGE, MANY QUERY VIEWS. `?sort=latest|popular`, `?category=`, `?topic=`
 * and `?offset=` are derived views of the one collection — all canonical to
 * `/fatwa`, none a path (ROUTE_MAP.md §2.3). A category or topic slug is
 * resolved through its owner (Fatwa's reader for a category, Taxonomy for a
 * Topic) BEFORE anything is listed; a slug that does not resolve, and any
 * malformed parameter, lists NOTHING and says why — it never broadens the view
 * to everything.
 *
 * POPULAR IS EXPLAINED, NOT IMPLIED. It is the count of anonymous reads over
 * the last 30 days, and the page says exactly that.
 *
 * ASKING IS PRIVATE AND SIGNED IN. The ask and "my questions" entries are
 * shown to everybody with a clear sign-in indicator; they lead through
 * sign-in with a validated return path, never to a dead end.
 */

type Query = Record<string, string | string[] | undefined>;

const EMPTY: PublicFatwaPage = { items: [], total: 0, offset: 0 };

async function resolveBrowse(locale: Locale, query: Query) {
  const browse = readFatwaBrowse(query);
  const [category, topic] = await Promise.all([
    browse.category.state === 'slug' ? readFatwaCategory(browse.category.slug) : null,
    browse.topic.state === 'slug' ? readActiveTopic(locale, browse.topic.slug) : null,
  ]);
  const unresolved =
    (browse.category.state === 'slug' && category === null) ||
    (browse.topic.state === 'slug' && topic === null);
  return { browse, category, topic, invalid: isInvalidBrowse(browse) || unresolved };
}

export async function FatwaLandingPage({
  locale,
  availability,
  query,
}: {
  readonly locale: Locale;
  readonly availability: FatwaAvailability;
  readonly query: Query;
}) {
  const t = await getTranslations({ locale, namespace: 'fatwa' });
  const searchT = await getTranslations({ locale, namespace: 'search' });
  const parts = await fatwaTrail(locale);
  const { browse, category, topic, invalid } = await resolveBrowse(locale, query);
  const sort = browse.sort ?? 'latest';
  const [page, categories] = await Promise.all([
    invalid
      ? EMPTY
      : fatwaReadRuntime().reader.browse({
          sort,
          categoryId: category?.id ?? null,
          topicId: topic?.id ?? null,
          offset: browse.offset,
        }),
    categoryLabels(locale),
  ]);
  const filtered = category !== null || topic !== null;
  const links = pageLinks(page.offset, FATWA_PAGE_SIZE, page.total);
  const view = (offset: number) =>
    fatwaBrowseHref(locale, {
      sort,
      category: category?.slug ?? null,
      topic: topic?.slug ?? null,
      offset,
    });

  return (
    <FatwaFrame
      locale={locale}
      availability={availability}
      trail={[parts.home, { text: t('title') }]}
    >
      <Prose>
        <PageHeading>{t('title')}</PageHeading>
        <p>{t('intro')}</p>
      </Prose>

      <Panel>
        <form
          method="get"
          action={fatwaSectionPath(locale, 'search')}
          role="search"
          aria-label={t('sections.search')}
          className="flex flex-col gap-3"
        >
          <SectionHeading>{t('sections.search')}</SectionHeading>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <label htmlFor="fatwa-landing-search" className="text-sm font-medium">
                {searchT('queryLabel')}
              </label>
              <TextInput
                id="fatwa-landing-search"
                type="search"
                name="q"
                maxLength={SEARCH_QUERY_MAX_LENGTH}
                autoComplete="off"
              />
            </div>
            <Button>{searchT('submit')}</Button>
          </div>
        </form>
      </Panel>

      <section className="flex flex-col gap-4" aria-labelledby="fatwa-explore">
        <SectionHeading>
          <span id="fatwa-explore">{t('landing.explore')}</span>
        </SectionHeading>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              {
                key: 'categories',
                href: fatwaSectionPath(locale, 'categories'),
                gated: false,
              },
              {
                key: 'howItWorks',
                href: fatwaSectionPath(locale, 'how-it-works'),
                gated: false,
              },
              { key: 'ask', href: fatwaSectionPath(locale, 'ask'), gated: true },
              { key: 'myQuestions', href: `/${locale}/my/questions`, gated: true },
            ] as const
          ).map((entry) => (
            <Panel key={entry.key} as="li">
              <div className="flex flex-col gap-2">
                <h3 className="text-lg font-semibold">
                  <TextLink href={entry.href}>{t(`sections.${entry.key}`)}</TextLink>
                </h3>
                {entry.gated ? (
                  <p className="text-xs font-semibold">{t('signInRequired')}</p>
                ) : null}
                <p className="text-sm text-[color:var(--color-foreground-muted)]">
                  {t(`sectionBody.${entry.key}`)}
                </p>
              </div>
            </Panel>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="fatwa-rulings">
        <SectionHeading>
          <span id="fatwa-rulings">{t('landing.rulings')}</span>
        </SectionHeading>
        <div className="flex flex-col gap-2">
          <nav aria-label={t('sort.label')} className="flex flex-wrap gap-3">
            {FATWA_SORTS.map((option) => (
              <FilterLink
                key={option}
                href={fatwaBrowseHref(locale, {
                  sort: option,
                  category: category?.slug ?? null,
                  topic: topic?.slug ?? null,
                })}
                current={!invalid && sort === option}
              >
                {t(`sort.${option}`)}
              </FilterLink>
            ))}
          </nav>
          <p className="text-sm text-[color:var(--color-foreground-muted)]">
            {sort === 'popular' ? t('sort.popularNote') : t('sort.latestNote')}
          </p>
        </div>

        {filtered && !invalid ? (
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm wrap-anywhere">
            {category === null ? null : (
              <span>
                {t('filter.category')}:{' '}
                {fatwaCategoryName(category.names, locale) ?? category.slug}
              </span>
            )}
            {topic === null ? null : (
              <span>
                {t('filter.topic')}:{' '}
                <span lang={topic.label.resolvedLocale}>{topic.label.name}</span>
              </span>
            )}
            <TextLink href={fatwaBrowseHref(locale, { sort })}>
              {t('filter.clear')}
            </TextLink>
          </p>
        ) : null}

        {invalid ? (
          <div className="flex flex-col gap-2">
            <Alert tone="info">{t('filter.invalid')}</Alert>
            <p>
              <TextLink href={fatwaSectionPath(locale)}>{t('filter.clear')}</TextLink>
            </p>
          </div>
        ) : page.items.length === 0 ? (
          <EmptyState>{filtered ? t('filteredEmpty') : t('empty')}</EmptyState>
        ) : (
          <FatwaList
            locale={locale}
            items={page.items}
            categories={categories}
            label={t('landing.rulings')}
            headingLevel="h3"
            t={t}
          />
        )}

        <Pagination
          label={t('landing.rulings')}
          previous={links.previous === null ? null : view(links.previous)}
          next={links.next === null ? null : view(links.next)}
          previousLabel={t('previous')}
          nextLabel={t('next')}
        />
      </section>
    </FatwaFrame>
  );
}
