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
  CardGrid,
  Container,
  EmptyState,
  FilterLink,
  LinkCard,
  MetaRow,
  PageHero,
  SectionHeader,
  TextInput,
  TextLink,
  TopicChips,
} from '@/components/ui';
import { categoryLabels, FatwaList } from './list';
import { FatwaLandingTop, FatwaPrinciples } from './parts';
import {
  categoryHref,
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
 *
 * THE ORDER OF THE PAGE IS THE ORDER OF TRUST. The hero holds the search; then
 * what the service guarantees about everything it lists; then the rulings
 * themselves; then the categories (read once for the whole page anyway) and
 * the ways into the rest of the section.
 */

type Query = Record<string, string | string[] | undefined>;

const EMPTY: PublicFatwaPage = { items: [], total: 0, offset: 0 };

/** How many categories the landing's shelf shows before linking to them all. */
const CATEGORY_SHELF = 12;

/** The ways into the rest of the section, in the order the landing lists them. */
function exploreEntries(locale: Locale) {
  return [
    { key: 'categories', href: fatwaSectionPath(locale, 'categories'), gated: false },
    { key: 'howItWorks', href: fatwaSectionPath(locale, 'how-it-works'), gated: false },
    { key: 'ask', href: fatwaSectionPath(locale, 'ask'), gated: true },
    { key: 'myQuestions', href: `/${locale}/my/questions`, gated: true },
  ] as const;
}

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

  const shelf = [...categories.values()].slice(0, CATEGORY_SHELF);

  return (
    <>
      <FatwaLandingTop locale={locale} availability={availability} />

      <PageHero title={t('title')} lede={t('intro')}>
        <form
          method="get"
          action={fatwaSectionPath(locale, 'search')}
          role="search"
          aria-label={t('sections.search')}
          className="flex w-full max-w-2xl flex-col gap-2"
        >
          <label htmlFor="fatwa-landing-search" className="text-sm font-medium">
            {searchT('queryLabel')}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="min-w-0 flex-1">
              <TextInput
                id="fatwa-landing-search"
                type="search"
                name="q"
                maxLength={SEARCH_QUERY_MAX_LENGTH}
                autoComplete="off"
                enterKeyHint="search"
                aria-describedby="fatwa-landing-search-help"
              />
            </div>
            <Button>{searchT('submit')}</Button>
          </div>
          <p
            id="fatwa-landing-search-help"
            className="text-sm text-[color:var(--color-foreground-muted)]"
          >
            {t('sectionBody.search')}
          </p>
        </form>
      </PageHero>

      <Container>
        <div className="flex flex-col gap-[var(--space-section)] py-[var(--space-section)]">
          <FatwaPrinciples locale={locale} />

          <section className="flex flex-col gap-5" aria-labelledby="fatwa-rulings">
            <SectionHeader id="fatwa-rulings" heading={t('landing.rulings')} />
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
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[var(--radius-control)] bg-[color:var(--color-surface-sunken)] px-4 py-2 text-sm wrap-anywhere">
                <MetaRow
                  items={[
                    category === null ? null : (
                      <>
                        {t('filter.category')}:{' '}
                        {fatwaCategoryName(category.names, locale) ?? category.slug}
                      </>
                    ),
                    topic === null ? null : (
                      <>
                        {t('filter.topic')}:{' '}
                        <span lang={topic.label.resolvedLocale}>{topic.label.name}</span>
                      </>
                    ),
                  ]}
                />
                <a
                  href={fatwaBrowseHref(locale, { sort })}
                  className="inline-flex min-h-11 items-center font-medium text-[color:var(--color-action)] underline underline-offset-2"
                >
                  {t('filter.clear')}
                </a>
              </div>
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

          {shelf.length === 0 ? null : (
            <section className="flex flex-col gap-5" aria-labelledby="fatwa-categories">
              <SectionHeader
                id="fatwa-categories"
                heading={t('sections.categories')}
                intro={t('sectionBody.categories')}
                action={{
                  href: fatwaSectionPath(locale, 'categories'),
                  text: t('landing.allCategories'),
                }}
              />
              <TopicChips
                label={t('sections.categories')}
                topics={shelf.map((entry) => ({
                  href: categoryHref(locale, entry.slug),
                  text: entry.name,
                }))}
              />
            </section>
          )}

          <section className="flex flex-col gap-5" aria-labelledby="fatwa-explore">
            <SectionHeader id="fatwa-explore" heading={t('landing.explore')} />
            <CardGrid columns={4}>
              {exploreEntries(locale).map((entry) => (
                <LinkCard
                  key={entry.key}
                  href={entry.href}
                  title={t(`sections.${entry.key}`)}
                  description={t(`sectionBody.${entry.key}`)}
                  {...(entry.gated
                    ? { meta: <MetaRow items={[t('signInRequired')]} /> }
                    : {})}
                />
              ))}
            </CardGrid>
          </section>
        </div>
      </Container>
    </>
  );
}
