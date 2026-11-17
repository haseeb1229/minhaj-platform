import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import { NEWS_KINDS, type NewsKind } from '@minhaj/contracts/editorial';

import { editorialReadRuntime } from '@/composition/editorial-read';
import { ExploreHero } from '@/components/topic-hub/parts';
import {
  Breadcrumbs,
  Container,
  EmptyState,
  FilterLink,
  Icon,
  SectionHeader,
} from '@/components/ui';
import { monthName, newsTrail, yearText, type NewsTranslator } from './news';
import { newsArchiveHref, newsListingHref, type NewsArchiveView } from './news-view';

/**
 * NEWS & EVENTS PART 1 — THE NEWS ARCHIVE (`/news/archive`, ROUTE_MAP.md §3.9):
 * every published record of the four News families, browsed by the UTC year
 * and month of its CHRONOLOGY — its source's own publication date where a
 * migrated record states one, else its publication here — never a record's
 * creation, migration or approval time.
 *
 * AN INDEX, NOT A FIFTH LISTING. Every year is counted, and each family's
 * share of it; a year opens on its months, each counted the same way; and
 * every count leads into that family's own listing for the period
 * (`newsListingHref`), where its records are read with every other filter.
 * Only `?year=` is the archive's own; its former listing parameters are one
 * redirect each (`newsArchiveCanonicalRedirect`).
 *
 * Five bounded reads of Editorial's counted periods (all families, then each),
 * never a record.
 */

interface Counted {
  readonly total: number;
  readonly kinds: ReadonlyMap<NewsKind, number>;
}

/** Adds one family's count to a period's tally. */
function tally(
  map: Map<number, Map<NewsKind, number>>,
  key: number,
  kind: NewsKind,
  count: number,
) {
  const kinds = map.get(key) ?? new Map<NewsKind, number>();
  kinds.set(kind, (kinds.get(kind) ?? 0) + count);
  map.set(key, kinds);
}

function counted(map: ReadonlyMap<number, ReadonlyMap<NewsKind, number>>) {
  return new Map<number, Counted>(
    [...map].map(([key, kinds]) => [
      key,
      { total: [...kinds.values()].reduce((sum, value) => sum + value, 0), kinds },
    ]),
  );
}

/** One period's families, each a link into its listing for that period. */
function KindCounts({
  locale,
  label,
  counts,
  period,
  t,
}: {
  readonly locale: Locale;
  readonly label: string;
  readonly counts: Counted;
  readonly period: { readonly year: number; readonly month: number | null };
  readonly t: NewsTranslator;
}) {
  return (
    <ul aria-label={label} className="flex list-none flex-wrap gap-2 p-0">
      {NEWS_KINDS.flatMap((kind) => {
        const count = counts.kinds.get(kind) ?? 0;
        return count === 0
          ? []
          : [
              <li key={kind} className="min-w-0">
                <a
                  href={newsListingHref(locale, kind, period)}
                  className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border border-border bg-surface px-4 text-sm font-medium text-action no-underline hover:border-action hover:bg-surface-sunken"
                >
                  <span className="min-w-0 wrap-anywhere tabular-nums">
                    {t(`archivePage.counts.${kind}`, { count })}
                  </span>
                  <Icon name="arrow-end" size={16} className="shrink-0" />
                </a>
              </li>,
            ];
      })}
    </ul>
  );
}

/** A month's bar, by its share of the year's busiest month: five steps, no `style` (CSP). */
const BAR_HEIGHTS = ['h-2', 'h-3', 'h-5', 'h-6', 'h-8'] as const;

/**
 * Twelve months as a quiet bar each — a picture of the year, hidden from
 * assistive technology because the numbers beside it say the same in words.
 */
function MonthStrip({ months }: { readonly months: ReadonlyMap<number, Counted> }) {
  const peak = Math.max(1, ...[...months.values()].map((entry) => entry.total));
  return (
    <span aria-hidden="true" className="flex h-8 items-end gap-0.5">
      {Array.from({ length: 12 }, (_, index) => {
        const total = months.get(index + 1)?.total ?? 0;
        const step = Math.min(
          BAR_HEIGHTS.length - 1,
          Math.max(0, Math.ceil((total / peak) * BAR_HEIGHTS.length) - 1),
        );
        return (
          <span
            key={index}
            className={`w-1.5 rounded-t-sm ${
              total === 0 ? 'h-1 bg-border' : `${BAR_HEIGHTS[step]} bg-accent`
            }`}
          />
        );
      })}
    </span>
  );
}

export async function NewsArchivePage({
  locale,
  view,
}: {
  readonly locale: Locale;
  readonly view: NewsArchiveView;
}) {
  const [t, trail] = await Promise.all([
    getTranslations({ locale, namespace: 'news' }),
    newsTrail(locale),
  ]);
  const reads = editorialReadRuntime();
  const families = await Promise.all(
    NEWS_KINDS.map(async (kind) => ({
      kind,
      periods: await reads.newsArchivePeriods({ kind }),
    })),
  );
  const byYear = new Map<number, Map<NewsKind, number>>();
  const byMonth = new Map<number, Map<number, Map<NewsKind, number>>>();
  for (const { kind, periods } of families)
    for (const period of periods) {
      tally(byYear, period.year, kind, period.count);
      const months = byMonth.get(period.year) ?? new Map<number, Map<NewsKind, number>>();
      tally(months, period.month, kind, period.count);
      byMonth.set(period.year, months);
    }
  const years = counted(byYear);
  const order = [...years.keys()].sort((a, b) => b - a);
  const total = [...years.values()].reduce((sum, entry) => sum + entry.total, 0);
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const first = order.at(-1);
  const last = order[0];
  const chosen = view.year === null ? undefined : years.get(view.year);
  // The year opened, its tally and its months — absent for every year or one with nothing.
  const opened =
    view.year === null || chosen === undefined
      ? null
      : {
          year: view.year,
          counts: chosen,
          months: counted(byMonth.get(view.year) ?? new Map()),
        };
  const position = view.year === null ? -1 : order.indexOf(view.year);
  const later = position > 0 ? order[position - 1] : undefined;
  const earlier = position >= 0 ? order[position + 1] : undefined;
  const title = t('archive');

  return (
    <Container>
      <div className="flex min-w-0 flex-col gap-8 pt-6 pb-[var(--space-section)]">
        <Breadcrumbs
          label={trail.label}
          trail={[
            trail.home,
            trail.news,
            ...(view.year === null
              ? [{ text: title }]
              : [
                  { href: newsArchiveHref(locale), text: title },
                  { text: yearText(view.year, locale) },
                ]),
          ]}
        />
        <ExploreHero
          eyebrow={trail.news.text}
          title={
            view.year === null
              ? title
              : t('archiveYear', { year: yearText(view.year, locale) })
          }
          lede={t('archiveBody')}
          stats={[
            ...(total === 0
              ? []
              : [
                  {
                    value: number(total),
                    label: t('listing.stats.records', { count: total }),
                  },
                ]),
            ...(first === undefined || last === undefined
              ? []
              : [
                  {
                    value:
                      first === last
                        ? yearText(first, locale)
                        : `${yearText(first, locale)}–${yearText(last, locale)}`,
                    label: t('listing.stats.span', { count: last - first + 1 }),
                  },
                ]),
          ]}
          actions={[]}
        />

        {order.length === 0 ? (
          <EmptyState
            icon="news"
            title={t('listing.emptyTitle')}
            action={{ href: trail.news.href, text: t('listing.backToNews') }}
          >
            {t('archiveEmpty')}
          </EmptyState>
        ) : (
          <div className="grid min-w-0 gap-10 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-12">
            <nav
              aria-labelledby="news-archive-years"
              className="flex min-w-0 flex-col gap-3"
            >
              <h2
                id="news-archive-years"
                className="text-sm font-semibold text-foreground-muted"
              >
                {t('archiveYears')}
              </h2>
              <ul className="flex list-none flex-wrap gap-2 p-0 lg:flex-col">
                <li>
                  <FilterLink href={newsArchiveHref(locale)} current={view.year === null}>
                    {t('archiveEveryYear')}
                  </FilterLink>
                </li>
                {order.map((year) => (
                  <li key={year}>
                    <FilterLink
                      href={newsArchiveHref(locale, year)}
                      current={view.year === year}
                    >
                      <span className="tabular-nums">{yearText(year, locale)}</span>
                      <span className="ms-1.5 text-foreground-muted tabular-nums">
                        {number(years.get(year)?.total ?? 0)}
                        <span className="sr-only">
                          {' '}
                          {t('listing.stats.records', {
                            count: years.get(year)?.total ?? 0,
                          })}
                        </span>
                      </span>
                    </FilterLink>
                  </li>
                ))}
              </ul>
            </nav>

            {view.year === null ? (
              <section
                aria-labelledby="news-archive-all"
                className="flex min-w-0 flex-col gap-5"
              >
                <SectionHeader
                  id="news-archive-all"
                  heading={t('archiveAll')}
                  intro={t('archivePage.intro')}
                />
                <ol className="flex list-none flex-col p-0">
                  {order.map((year) => {
                    const entry = years.get(year);
                    if (entry === undefined) return null;
                    const yearMonths = counted(byMonth.get(year) ?? new Map());
                    return (
                      <li
                        key={year}
                        className="flex min-w-0 flex-col gap-3 border-b border-border py-5 sm:flex-row sm:items-start sm:gap-6"
                      >
                        <div className="flex shrink-0 items-end gap-4 sm:w-44">
                          <h3 className="text-subheading font-semibold">
                            <a
                              href={newsArchiveHref(locale, year)}
                              className="inline-flex min-h-11 items-center text-action underline-offset-4 hover:underline"
                            >
                              <span className="tabular-nums">
                                {yearText(year, locale)}
                              </span>
                            </a>
                          </h3>
                          <MonthStrip months={yearMonths} />
                        </div>
                        <div className="flex min-w-0 flex-col gap-2">
                          <p className="text-sm text-foreground-muted">
                            {number(entry.total)}{' '}
                            {t('listing.stats.records', { count: entry.total })}
                            {' · '}
                            {t('archivePage.months', { count: yearMonths.size })}
                          </p>
                          <KindCounts
                            locale={locale}
                            label={t('archivePage.yearKinds', {
                              year: yearText(year, locale),
                            })}
                            counts={entry}
                            period={{ year, month: null }}
                            t={t}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ) : opened === null ? (
              <EmptyState
                title={t('archivePage.yearEmptyTitle')}
                action={{ href: newsArchiveHref(locale), text: t('archiveEveryYear') }}
              >
                {t('archivePage.yearEmpty', { year: yearText(view.year, locale) })}
              </EmptyState>
            ) : (
              <section
                aria-labelledby="news-archive-months"
                className="flex min-w-0 flex-col gap-6"
              >
                <div className="flex flex-col gap-3 rounded-panel border border-border bg-surface-raised p-4 sm:p-5">
                  <p className="font-medium">
                    {t('archivePage.yearTotal', {
                      year: yearText(opened.year, locale),
                      count: opened.counts.total,
                    })}
                  </p>
                  <KindCounts
                    locale={locale}
                    label={t('archivePage.yearKinds', {
                      year: yearText(opened.year, locale),
                    })}
                    counts={opened.counts}
                    period={{ year: opened.year, month: null }}
                    t={t}
                  />
                </div>
                <SectionHeader
                  id="news-archive-months"
                  heading={t('archivePage.monthsHeading', {
                    year: yearText(opened.year, locale),
                  })}
                />
                <ol className="flex list-none flex-col p-0">
                  {[...opened.months.keys()]
                    .sort((a, b) => a - b)
                    .map((month) => {
                      const entry = opened.months.get(month);
                      if (entry === undefined) return null;
                      const name = monthName(month, locale);
                      return (
                        <li
                          key={month}
                          className="flex min-w-0 flex-col gap-2 border-b border-border py-4 sm:flex-row sm:items-center sm:gap-6"
                        >
                          <h3 className="flex shrink-0 items-baseline gap-2 font-semibold sm:w-44">
                            {name}
                            <span className="text-sm font-normal text-foreground-muted tabular-nums">
                              {number(entry.total)}
                              <span className="sr-only">
                                {' '}
                                {t('listing.stats.records', { count: entry.total })}
                              </span>
                            </span>
                          </h3>
                          <KindCounts
                            locale={locale}
                            label={t('archivePage.monthKinds', {
                              month: name,
                              year: yearText(opened.year, locale),
                            })}
                            counts={entry}
                            period={{ year: opened.year, month }}
                            t={t}
                          />
                        </li>
                      );
                    })}
                </ol>
                {later === undefined && earlier === undefined ? null : (
                  <nav
                    aria-label={t('archivePage.yearNav')}
                    className="flex flex-wrap justify-between gap-3 border-t border-border pt-4"
                  >
                    {later === undefined ? (
                      <span />
                    ) : (
                      <a
                        href={newsArchiveHref(locale, later)}
                        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-action underline-offset-4 hover:underline"
                      >
                        <Icon name="arrow-start" size={16} />
                        <span className="tabular-nums">{yearText(later, locale)}</span>
                      </a>
                    )}
                    {earlier === undefined ? null : (
                      <a
                        href={newsArchiveHref(locale, earlier)}
                        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-action underline-offset-4 hover:underline"
                      >
                        <span className="tabular-nums">{yearText(earlier, locale)}</span>
                        <Icon name="arrow-end" size={16} />
                      </a>
                    )}
                  </nav>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </Container>
  );
}
