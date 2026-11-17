import 'server-only';

import { getTranslations } from 'next-intl/server';

import { localizedPath, type Locale } from '@minhaj/contracts';
import {
  NEWS_KINDS,
  NEWS_LISTING_PAGE,
  newsListPathOf,
  type NewsKind,
  type NewsListingFacets,
  type NewsSummary,
} from '@minhaj/contracts/editorial';

import { editorialReadRuntime } from '@/composition/editorial-read';
import { referenceNames } from '@/composition/public-references';
import { ClosingNote, RangeSummary } from '@/components/library/browse-parts';
import { caseless, pageCount, pageRange } from '@/components/topic-hub/address';
import {
  ActiveFilters,
  CountedSelect,
  ExploreFilters,
  ExploreHero,
} from '@/components/topic-hub/parts';
import {
  Breadcrumbs,
  Container,
  EmptyState,
  Field,
  Icon,
  LinkTabs,
  ListRow,
  Pager,
  SectionHeader,
  Select,
} from '@/components/ui';
import { pathFor, requireRoute } from '@/shell/registry';
import {
  monthName,
  NewsChronicle,
  NewsGrid,
  newsTrail,
  yearText,
  type NewsTranslator,
} from './news';
import {
  newsArchiveHref,
  newsFiltered,
  newsHref,
  newsKindHref,
  newsListingHref,
  newsOpening,
  newsReadQuery,
  type NewsView,
} from './news-view';

/**
 * NEWS & EVENTS PART 1 — THE NEWS LISTINGS (ROUTE_MAP.md §3.9): `/news`, and
 * `/news/press-releases`, `/news/statements` and `/news/media-coverage` — ONE
 * listing, parameterised by the family, never four copies.
 *
 * THE TOPIC HUBS' LISTING PATTERN OVER ONE NEWS FAMILY: the family's figures,
 * the families as tabs (each counted under the view's Topic, period and
 * language, and keeping them), a GET form of counted filters (Topic, year,
 * month, language and — for media coverage — outlet, each option counted
 * under every other filter), two orders, chips that each remove one filter, a
 * range, the newest story leading the first page, numbered pages, and one
 * address per view (`./news-view`). The parts are the hubs' shared ones
 * (`ExploreHero`, `ExploreFilters`, `CountedSelect`, `ActiveFilters`,
 * `Pager`), not another copy.
 *
 * `/news` IS ALSO THE SECTION'S FRONT DOOR. Its own first page — unfiltered,
 * newest first — goes on, after the latest NewsArticles, to each other
 * family's newest records, News by year into the archive, and the rest of
 * News and Events: Collections, the photograph surfaces and the newsletter.
 * Every later or narrowed view is the listing alone.
 *
 * HONEST STATES: a family with nothing published says so; a view no record
 * matches offers to clear its filters; a page past the end leads to the first.
 */

/** How many of each other family the front door shows. */
const FRONT_SHELF = 3;
/** How many recent years the front door offers as ways into the archive. */
const FRONT_YEARS = 12;

/** The other families' newest records and News by year, for `/news`'s first page. */
async function frontDoor(locale: Locale) {
  const reads = editorialReadRuntime();
  const others = NEWS_KINDS.filter((kind) => kind !== 'news-article');
  const [periods, ...shelves] = await Promise.all([
    reads.newsArchivePeriods(),
    ...others.map((kind) =>
      reads.newsListing({ kind, prefer: locale, limit: FRONT_SHELF }),
    ),
  ]);
  const years = new Map<number, number>();
  for (const period of periods)
    years.set(period.year, (years.get(period.year) ?? 0) + period.count);
  return {
    shelves: others.flatMap((kind, index) => {
      const page = shelves[index];
      return page === undefined || page.items.length === 0
        ? []
        : [{ kind, items: page.items, total: page.total }];
    }),
    years: [...years]
      .sort(([a], [b]) => b - a)
      .slice(0, FRONT_YEARS)
      .map(([year, records]) => ({ year, records })),
  };
}

/** The family's figures: how many, the years they span, languages and outlets. */
function heroStats(
  locale: Locale,
  kind: NewsKind,
  all: NewsListingFacets['all'],
  listId: string,
  t: NewsTranslator,
) {
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const span =
    all.firstYear === null || all.lastYear === null
      ? null
      : all.firstYear === all.lastYear
        ? yearText(all.firstYear, locale)
        : `${yearText(all.firstYear, locale)}–${yearText(all.lastYear, locale)}`;
  return [
    ...(all.records === 0
      ? []
      : [
          {
            value: number(all.records),
            label: t(`listing.stats.${kind}`, { count: all.records }),
            href: `#${listId}`,
          },
        ]),
    ...(span === null || all.firstYear === null || all.lastYear === null
      ? []
      : [
          {
            value: span,
            label: t('listing.stats.span', {
              count: all.lastYear - all.firstYear + 1,
            }),
          },
        ]),
    ...(all.languages < 2
      ? []
      : [
          {
            value: number(all.languages),
            label: t('listing.stats.languages', { count: all.languages }),
          },
        ]),
    ...(all.outlets === 0
      ? []
      : [
          {
            value: number(all.outlets),
            label: t('listing.stats.outlets', { count: all.outlets }),
          },
        ]),
  ];
}

export async function NewsListingPage({
  locale,
  kind,
  view,
}: {
  readonly locale: Locale;
  readonly kind: NewsKind;
  readonly view: NewsView;
}) {
  const [t, hub, tw, photos, trail] = await Promise.all([
    getTranslations({ locale, namespace: 'news' }),
    getTranslations({ locale, namespace: 'topicHub' }),
    getTranslations({ locale, namespace: 'watch' }),
    getTranslations({ locale, namespace: 'photos' }),
    newsTrail(locale),
  ]);
  const reads = editorialReadRuntime();
  const read = newsReadQuery(kind, view, locale);
  const front = kind === 'news-article' && newsOpening(view);
  const [page, facets, door] = await Promise.all([
    reads.newsListing(read),
    reads.newsListingFacets(read),
    front ? frontDoor(locale) : Promise.resolve(null),
  ]);
  const names = await referenceNames(
    {
      personIds: [],
      topicIds: [
        ...facets.topics.items.map((facet) => facet.id),
        ...(view.topic === null ? [] : [view.topic]),
      ],
    },
    locale,
  );
  // An address carries an identifier in lower case, while an owner returns it
  // as stored: options and chips compare without case.
  const topics = caseless(names.topics);

  const landing = kind === 'news-article';
  const title = landing ? t('title') : t(`families.${kind}`);
  const listId = `news-${kind}-list`;
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const href = (change: Partial<NewsView>) => newsHref(locale, kind, view, change);
  const filtered = newsFiltered(view);
  // Clearing the filters keeps the order: it is not a narrowing.
  const base = newsListingHref(locale, kind, { sort: view.sort });
  const pages = pageCount(page.total, NEWS_LISTING_PAGE);
  const range = pageRange(view.page, page.items.length, NEWS_LISTING_PAGE);
  const option = (name: string, count: number) => hub('common.option', { name, count });

  const topicOptions = facets.topics.items.flatMap((facet) => {
    const topic = topics.get(facet.id.toLowerCase());
    return topic === undefined
      ? []
      : [{ value: facet.id.toLowerCase(), name: topic.name, count: facet.records }];
  });
  const chosenTopic =
    view.topic === null ? null : (topics.get(view.topic.toLowerCase()) ?? null);

  const chip = (key: string, text: string, removeHref: string, auto = false) => ({
    key,
    text: auto ? <span dir="auto">{text}</span> : text,
    removeHref,
    removeLabel: hub('common.remove', { name: text }),
  });
  const active = [
    ...(view.topic === null
      ? []
      : [chip('topic', chosenTopic?.name ?? tw('unknownTopic'), href({ topic: null }))]),
    ...(view.year === null
      ? []
      : [chip('year', yearText(view.year, locale), href({ year: null, month: null }))]),
    ...(view.year === null || view.month === null
      ? []
      : [chip('month', monthName(view.month, locale), href({ month: null }))]),
    ...(view.language === null
      ? []
      : [chip('language', t(`languages.${view.language}`), href({ language: null }))]),
    ...(view.outlet === null
      ? []
      : [chip('outlet', view.outlet, href({ outlet: null }), true)]),
  ];

  return (
    <Container>
      <div className="flex min-w-0 flex-col gap-8 pt-6 pb-[var(--space-section)]">
        <Breadcrumbs
          label={trail.label}
          trail={
            landing
              ? [trail.home, { text: title }]
              : [trail.home, trail.news, { text: title }]
          }
        />
        <ExploreHero
          eyebrow={landing ? t('listing.eyebrow') : trail.news.text}
          title={title}
          lede={landing ? t('description') : t(`familyBody.${kind}`)}
          stats={heroStats(locale, kind, facets.all, listId, t)}
          actions={[
            ...(landing
              ? [{ href: pathFor(locale, requireRoute('events')), text: t('events') }]
              : []),
            { href: newsArchiveHref(locale), text: t('archive') },
          ]}
        />

        <LinkTabs
          label={t('sectionsLabel')}
          tabs={facets.kinds.map((entry) => ({
            href: newsKindHref(locale, entry.kind, view),
            text: t(`families.${entry.kind}`),
            current: entry.kind === kind,
            count: number(entry.records),
          }))}
        />

        {facets.all.records === 0 ? (
          <EmptyState
            icon="news"
            title={t('listing.emptyTitle')}
            {...(landing
              ? {}
              : { action: { href: trail.news.href, text: t('listing.backToNews') } })}
          >
            {t(`empty.${kind}`)}
          </EmptyState>
        ) : (
          <section aria-labelledby={listId} className="flex min-w-0 flex-col gap-5">
            <SectionHeader
              id={listId}
              heading={t(`listing.heading.${kind}`)}
              intro={t(
                kind === 'media-coverage' ? 'listing.introCoverage' : 'listing.intro',
              )}
            />

            <ExploreFilters
              action={localizedPath(locale, newsListPathOf(kind))}
              label={t('listing.filters')}
              hidden={[]}
              submit={t('listing.apply')}
              reset={filtered ? { href: base, text: hub('common.reset') } : null}
            >
              {topicOptions.length > 0 || view.topic !== null ? (
                <CountedSelect
                  id={`${listId}-topic`}
                  label={tw('filterTopic')}
                  name="topic"
                  value={view.topic ?? ''}
                  any={tw('anyTopic')}
                  options={topicOptions}
                  optionText={option}
                />
              ) : null}
              {facets.years.length > 1 || view.year !== null ? (
                <CountedSelect
                  id={`${listId}-year`}
                  label={t('listing.filterYear')}
                  name="year"
                  value={view.year === null ? '' : String(view.year)}
                  any={t('listing.anyYear')}
                  options={facets.years.map((entry) => ({
                    value: String(entry.year),
                    name: yearText(entry.year, locale),
                    count: entry.records,
                  }))}
                  optionText={option}
                />
              ) : null}
              {view.year === null ||
              (facets.months.length < 2 && view.month === null) ? null : (
                <CountedSelect
                  id={`${listId}-month`}
                  label={t('listing.filterMonth')}
                  name="month"
                  value={view.month === null ? '' : String(view.month)}
                  any={t('listing.anyMonth')}
                  options={facets.months.map((entry) => ({
                    value: String(entry.month),
                    name: monthName(entry.month, locale),
                    count: entry.records,
                  }))}
                  optionText={option}
                />
              )}
              {facets.languages.length > 1 || view.language !== null ? (
                <CountedSelect
                  id={`${listId}-language`}
                  label={hub('common.filterLanguage')}
                  name="language"
                  value={view.language ?? ''}
                  any={hub('common.anyLanguage')}
                  options={facets.languages.map((entry) => ({
                    value: entry.code,
                    name: t(`languages.${entry.code}`),
                    count: entry.records,
                  }))}
                  optionText={option}
                />
              ) : null}
              {kind === 'media-coverage' &&
              (facets.outlets.items.length > 1 || view.outlet !== null) ? (
                <CountedSelect
                  id={`${listId}-outlet`}
                  label={t('outlet')}
                  name="outlet"
                  value={view.outlet ?? ''}
                  any={t('listing.anyOutlet')}
                  options={facets.outlets.items.map((entry) => ({
                    value: entry.name,
                    name: entry.name,
                    count: entry.records,
                  }))}
                  optionText={option}
                />
              ) : null}
              <Field id={`${listId}-sort`} label={hub('common.filterSort')}>
                {(props) => (
                  <Select {...props} name="sort" defaultValue={view.sort}>
                    <option value="newest">{hub('common.sort.newest')}</option>
                    <option value="oldest">{t('listing.oldest')}</option>
                  </Select>
                )}
              </Field>
            </ExploreFilters>

            <ActiveFilters label={hub('common.active')} filters={active} />

            {chosenTopic === null ? null : (
              <p className="text-sm">
                <a
                  href={localizedPath(
                    locale,
                    `/topics/${encodeURIComponent(chosenTopic.slug)}`,
                  )}
                  className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-action underline-offset-4 hover:underline"
                >
                  {tw('topicHub')}
                  <Icon name="arrow-end" size={16} />
                </a>
              </p>
            )}

            {range === null ? null : (
              <RangeSummary>
                {t('listing.summary', {
                  from: number(range.from),
                  to: number(range.to),
                  total: page.total,
                })}
              </RangeSummary>
            )}

            {page.items.length === 0 ? (
              view.page > 1 && page.total > 0 ? (
                <EmptyState
                  title={hub('common.pastEndTitle')}
                  action={{ href: href({ page: 1 }), text: hub('common.firstPage') }}
                >
                  {t('listing.pastEnd', { page: view.page })}
                </EmptyState>
              ) : (
                <EmptyState
                  title={t('listing.noResultsTitle')}
                  action={{ href: base, text: hub('common.reset') }}
                >
                  {t('listing.noResults')}
                </EmptyState>
              )
            ) : (
              <NewsChronicle
                locale={locale}
                items={page.items}
                label={t(`listing.heading.${kind}`)}
                showType={false}
                opening={view.page === 1 && view.sort === 'newest'}
                headingLevel="h3"
              />
            )}

            {page.items.length === 0 ? null : (
              <Pager
                label={t(`listing.pages.${kind}`)}
                previous={view.page > 1 ? href({ page: view.page - 1 }) : null}
                next={page.hasMore ? href({ page: view.page + 1 }) : null}
                previousLabel={t('previous')}
                nextLabel={t('next')}
                pages={{
                  current: view.page,
                  total: pages,
                  href: (target) => href({ page: target }),
                  label: (target) => hub('common.pageLabel', { page: target }),
                  format: number,
                }}
              />
            )}
          </section>
        )}

        {door === null ? null : (
          <FrontDoor
            locale={locale}
            shelves={door.shelves}
            years={door.years}
            t={t}
            photos={photos}
          />
        )}

        <ClosingNote
          text={t('listing.about')}
          links={[{ href: localizedPath(locale, '/topics'), text: t('listing.topics') }]}
        />
      </div>
    </Container>
  );
}

type PhotosTranslator = Awaited<ReturnType<typeof getTranslations<'photos'>>>;

/**
 * The rest of `/news`'s first page: each other family's newest records (only a
 * family that has any), News by year into the archive, and the rest of News
 * and Events. The page's opening already offers Events and the archive, and
 * the tabs every family, so neither is offered again under the same name.
 */
async function FrontDoor({
  locale,
  shelves,
  years,
  t,
  photos,
}: {
  readonly locale: Locale;
  readonly shelves: readonly {
    readonly kind: NewsKind;
    readonly items: readonly NewsSummary[];
    readonly total: number;
  }[];
  readonly years: readonly { readonly year: number; readonly records: number }[];
  readonly t: NewsTranslator;
  readonly photos: PhotosTranslator;
}) {
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  return (
    <>
      {shelves.map(({ kind, items, total }) => (
        <section
          key={kind}
          className="flex flex-col gap-6 border-t border-border pt-[var(--space-page)]"
          aria-labelledby={`news-${kind}`}
        >
          <SectionHeader
            id={`news-${kind}`}
            heading={t(`families.${kind}`)}
            intro={t(`familyBody.${kind}`)}
            action={{
              href: localizedPath(locale, newsListPathOf(kind)),
              text: t(`all.${kind}`, { count: total }),
            }}
          />
          <NewsGrid
            locale={locale}
            items={items}
            label={t(`families.${kind}`)}
            showType={false}
            headingLevel="h3"
          />
        </section>
      ))}

      <section
        className="grid gap-10 border-t border-border pt-[var(--space-page)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16"
        aria-labelledby="news-browse"
      >
        <div className="flex min-w-0 flex-col gap-4">
          <h2 id="news-browse" className="text-heading font-semibold">
            {t('browse')}
          </h2>
          <ul className="flex list-none flex-col p-0">
            {[
              {
                href: pathFor(locale, requireRoute('collections')),
                title: t('collections'),
                body: t('collectionsBody'),
              },
              ...(['photos', 'galleries', 'archive'] as const).map((surface) => ({
                href: pathFor(locale, requireRoute(`media.${surface}`)),
                title: photos(`sections.${surface}`),
                body: t(`mediaSurface.${surface}`),
              })),
              {
                href: pathFor(locale, requireRoute('newsletter')),
                title: t('front.newsletter'),
                body: t('front.newsletterBody'),
              },
            ].map((entry) => (
              <ListRow
                key={entry.href}
                href={entry.href}
                title={entry.title}
                description={entry.body}
              />
            ))}
          </ul>
        </div>
        {years.length === 0 ? null : (
          <nav aria-labelledby="news-years" className="flex min-w-0 flex-col gap-4">
            <h2 id="news-years" className="text-heading font-semibold">
              {t('byYear')}
            </h2>
            <p className="text-sm text-foreground-muted">{t('front.yearsIntro')}</p>
            <ul className="flex list-none flex-wrap gap-2 p-0">
              {years.map((entry) => (
                <li key={entry.year}>
                  <a
                    href={newsArchiveHref(locale, entry.year)}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-surface px-4 text-sm font-medium text-action no-underline hover:border-action hover:bg-surface-sunken"
                  >
                    <span className="tabular-nums">{yearText(entry.year, locale)}</span>
                    <span className="text-foreground-muted tabular-nums">
                      {number(entry.records)}
                      <span className="sr-only">
                        {' '}
                        {t('listing.stats.records', { count: entry.records })}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </section>
    </>
  );
}
