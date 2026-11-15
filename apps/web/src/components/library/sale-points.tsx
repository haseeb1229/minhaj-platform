import 'server-only';

import { getTranslations } from 'next-intl/server';

import { localizedPath, type Locale } from '@minhaj/contracts';
import { LIBRARY_SALE_POINT_PAGE } from '@minhaj/contracts/library';

import { libraryReadRuntime } from '@/composition/library-read';
import { directionOf } from '@/config/locale';
import { pageCount, pageRange } from '@/components/topic-hub/address';
import { ActiveFilters, ExploreFilters, ExploreHero } from '@/components/topic-hub/parts';
import {
  EmptyState,
  Field,
  Icon,
  Pager,
  SectionHeader,
  TextInput,
} from '@/components/ui';
import { BrowseFrame, ClosingNote, RangeSummary } from './browse-parts';
import {
  DEFAULT_SALE_POINTS_VIEW,
  SALE_POINTS_PATH,
  salePointsHref,
  type SalePointsView,
} from './browse-view';
import { labelFor, workPath } from './presentation';

/**
 * `/library/sale-points` — WHERE PRINTED BOOKS CAN BE OBTAINED (Library Part
 * 2; ROUTE_MAP.md §3.6, DOMAIN_MODEL.md §10.2): a directory of the published
 * sale points, A–Z, each with the public business facts an operator entered —
 * name, address, contact and website — and the books it is recorded as
 * selling (how many, and the first six by title, each linked to its page).
 * One Library read (`salePointDirectory`).
 *
 * INFORMATION, NOT COMMERCE: no price, cart, order, stock or payment exists,
 * and none is implied. A sale point carries no structured city or country, so
 * the directory is not grouped by place; a search (`?q`) finds a name or any
 * part of an address — a city, a street — matched literally. No map is
 * embedded (no accepted document admits one, and an embed would send every
 * visitor to a third party). The view is the address (`./browse-view`), 24 a
 * page; free-text values render with `dir="auto"`, being in no declared
 * language. Signed out, always.
 */
export async function LibrarySalePointsPage({
  locale,
  view,
}: {
  readonly locale: Locale;
  readonly view: SalePointsView;
}) {
  const [t, hub, shell] = await Promise.all([
    getTranslations({ locale, namespace: 'library' }),
    getTranslations({ locale, namespace: 'topicHub' }),
    getTranslations({ locale, namespace: 'shell' }),
  ]);
  const page = await libraryReadRuntime().salePointDirectory({
    text: view.q,
    titleLocale: locale,
    offset: (view.page - 1) * LIBRARY_SALE_POINT_PAGE,
  });

  const href = (change: Partial<SalePointsView>) =>
    salePointsHref(locale, view, { page: 1, ...change });
  const base = salePointsHref(locale, DEFAULT_SALE_POINTS_VIEW);
  const pages = pageCount(page.total, LIBRARY_SALE_POINT_PAGE);
  const range = pageRange(view.page, page.items.length, LIBRARY_SALE_POINT_PAGE);
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const title = t('section.sale-points');
  const listId = 'library-sale-points-list';

  return (
    <BrowseFrame
      locale={locale}
      breadcrumbLabel={shell('nav.breadcrumbs')}
      home={shell('nav.home')}
      library={t('title')}
      title={title}
    >
      <ExploreHero
        eyebrow={t('title')}
        title={title}
        lede={t('browse.salePoints.lede')}
        notice={t('salePointsNotice')}
        stats={
          page.all.salePoints === 0
            ? []
            : [
                {
                  value: page.all.salePoints,
                  label: t('browse.salePoints.stat', { count: page.all.salePoints }),
                },
                ...(page.all.works === 0
                  ? []
                  : [
                      {
                        value: page.all.works,
                        label: t('browse.salePoints.statBooks', {
                          count: page.all.works,
                        }),
                      },
                    ]),
              ]
        }
        actions={[
          {
            href: localizedPath(locale, '/library/books'),
            text: t('landing.browseBooks'),
          },
          {
            href: localizedPath(locale, '/library/downloads'),
            text: t('section.downloads'),
          },
        ]}
      />

      {page.all.salePoints === 0 ? (
        <EmptyState
          icon="map-pin"
          title={t('browse.salePoints.emptyTitle')}
          action={{
            href: localizedPath(locale, '/library/books'),
            text: t('landing.browseBooks'),
          }}
        >
          {t('browse.salePoints.empty')}
        </EmptyState>
      ) : (
        <section aria-labelledby={listId} className="flex flex-col gap-5">
          <SectionHeader id={listId} heading={t('browse.salePoints.listHeading')} />

          <ExploreFilters
            action={localizedPath(locale, SALE_POINTS_PATH)}
            label={t('browse.salePoints.filters')}
            hidden={[]}
            submit={t('browse.salePoints.submit')}
            reset={view.q === null ? null : { href: base, text: hub('common.reset') }}
          >
            <Field
              id="sale-points-q"
              label={t('browse.salePoints.search')}
              help={t('browse.salePoints.searchHelp')}
            >
              {(props) => (
                <TextInput
                  {...props}
                  type="search"
                  name="q"
                  maxLength={80}
                  defaultValue={view.q ?? ''}
                  autoComplete="off"
                />
              )}
            </Field>
          </ExploreFilters>

          <ActiveFilters
            label={hub('common.active')}
            filters={
              view.q === null
                ? []
                : [
                    {
                      key: 'q',
                      text: t('browse.salePoints.chip', { q: view.q }),
                      removeHref: base,
                      removeLabel: hub('common.remove', {
                        name: t('browse.salePoints.chip', { q: view.q }),
                      }),
                    },
                  ]
            }
          />

          {range === null ? null : (
            <RangeSummary>
              {t('browse.salePoints.summary', {
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
                action={{ href: href({}), text: hub('common.firstPage') }}
              >
                {t('browse.salePoints.pastEnd', { page: view.page })}
              </EmptyState>
            ) : (
              <EmptyState
                title={t('browse.salePoints.noResultsTitle')}
                action={{ href: base, text: hub('common.reset') }}
              >
                {t('browse.salePoints.noResults', { q: view.q ?? '' })}
              </EmptyState>
            )
          ) : (
            <ul
              aria-label={title}
              className="grid list-none grid-cols-1 gap-4 p-0 *:min-w-0 md:grid-cols-2"
            >
              {page.items.map((point) => {
                const more = point.works.total - point.works.items.length;
                const booksId = `sale-point-${point.id}-books`;
                return (
                  <li
                    key={point.id}
                    className="flex min-w-0 flex-col gap-4 rounded-panel border border-border bg-surface-raised p-5"
                  >
                    <h3
                      className="text-subheading font-semibold wrap-anywhere"
                      dir="auto"
                    >
                      {point.name}
                    </h3>
                    <dl className="flex flex-col gap-3 text-sm">
                      {point.address === '' ? null : (
                        <div className="flex items-start gap-2">
                          <dt className="mt-[0.2em] shrink-0 text-accent">
                            <Icon name="map-pin" size={16} />
                            <span className="sr-only">{t('salePointAddress')}</span>
                          </dt>
                          <dd
                            className="m-0 min-w-0 wrap-anywhere whitespace-pre-line"
                            dir="auto"
                          >
                            {point.address}
                          </dd>
                        </div>
                      )}
                      {point.contact === '' ? null : (
                        <div className="flex items-start gap-2">
                          <dt className="mt-[0.2em] shrink-0 text-accent">
                            <Icon name="phone" size={16} />
                            <span className="sr-only">{t('salePointContact')}</span>
                          </dt>
                          <dd className="m-0 min-w-0 wrap-anywhere" dir="auto">
                            {point.contact}
                          </dd>
                        </div>
                      )}
                      {point.url === null ? null : (
                        <div className="flex items-start gap-2">
                          <dt className="mt-[0.2em] shrink-0 text-accent">
                            <Icon name="globe" size={16} />
                            <span className="sr-only">{t('salePointWebsite')}</span>
                          </dt>
                          <dd className="m-0 min-w-0">
                            <a
                              href={point.url}
                              rel="noopener noreferrer"
                              className="inline-flex min-h-11 max-w-full items-center gap-1.5 font-medium text-action underline underline-offset-2"
                            >
                              <span className="wrap-anywhere" dir="ltr">
                                {hostOf(point.url)}
                              </span>
                              <Icon name="external" size={16} className="shrink-0" />
                              <span className="sr-only">
                                {t('browse.salePoints.external')}
                              </span>
                            </a>
                          </dd>
                        </div>
                      )}
                    </dl>
                    <div className="mt-auto flex flex-col gap-2 border-t border-border pt-3">
                      <h4 id={booksId} className="text-sm font-semibold">
                        {point.works.total === 0
                          ? t('browse.salePoints.booksNone')
                          : t('browse.salePoints.books', { count: point.works.total })}
                      </h4>
                      {point.works.items.length === 0 ? null : (
                        <ul
                          aria-labelledby={booksId}
                          className="flex list-none flex-col gap-0.5 p-0 text-sm"
                        >
                          {point.works.items.map((work) => {
                            const label = labelFor(
                              {
                                labels: work.labels.map((entry) => ({
                                  ...entry,
                                  description: '',
                                })),
                                primaryLocale: work.primaryLocale,
                              },
                              locale,
                            );
                            return (
                              <li key={work.id} className="min-w-0">
                                <a
                                  href={workPath(locale, work.slug)}
                                  lang={label.locale}
                                  dir={directionOf(label.locale)}
                                  className="inline-flex min-h-11 max-w-full items-center font-medium wrap-anywhere text-action underline-offset-4 hover:underline"
                                >
                                  {label.title}
                                </a>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {more <= 0 ? null : (
                        <p className="text-sm text-foreground-muted">
                          {t('browse.salePoints.more', { count: more })}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {page.items.length === 0 ? null : (
            <Pager
              label={t('browse.salePoints.pager')}
              previous={view.page > 1 ? href({ page: view.page - 1 }) : null}
              next={page.hasMore ? href({ page: view.page + 1 }) : null}
              previousLabel={t('previous')}
              nextLabel={t('next')}
              pages={{
                current: view.page,
                total: pages,
                href: (value) => href({ page: value }),
                label: (value) => hub('common.pageLabel', { page: value }),
                format: (value) => number(value),
              }}
            />
          )}
        </section>
      )}

      <ClosingNote
        text={t('browse.salePoints.about')}
        links={[
          {
            href: localizedPath(locale, '/library/books'),
            text: t('landing.browseBooks'),
          },
          {
            href: localizedPath(locale, '/library/downloads'),
            text: t('section.downloads'),
          },
        ]}
      />
    </BrowseFrame>
  );
}

/**
 * The host a sale point's website is shown by ("example.org"). The address
 * was validated as HTTPS when it was saved; one that no longer parses is
 * shown whole rather than failing the page.
 */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
