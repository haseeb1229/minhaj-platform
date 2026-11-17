import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { PhotoArchivePeriod } from '@minhaj/contracts/media';

import { mediaReadRuntime } from '@/composition/media-read';
import { ExploreHero } from '@/components/topic-hub/parts';
import {
  Breadcrumbs,
  Container,
  EmptyState,
  FilterLink,
  Icon,
  SectionHeader,
} from '@/components/ui';
import {
  MediaTabs,
  monthName,
  photosTrail,
  RightsNote,
  yearText,
  type PhotosTranslator,
} from './photos';
import { mediaArchiveHref, periodHref, type MediaArchiveView } from './photos-view';

/**
 * NEWS & EVENTS PART 2 — THE PHOTO ARCHIVE (`/media/archive`, ROUTE_MAP.md
 * §3.9): every published photograph whose date is KNOWN, browsed by the year
 * and month it was TAKEN — never by when its record was made, uploaded or
 * published. A photograph with no known date is never placed here.
 *
 * AN INDEX, NOT A SECOND LISTING. Every year is counted, with a picture of its
 * months; a year opens on its months, each counted, and on how many of its
 * photographs are known only to the year; every count leads into the
 * photographs listing for that period, by the date taken (`periodHref`), where
 * they are read with every other filter. Only `?year=` is the archive's own;
 * its former listing parameters are one redirect each
 * (`mediaArchiveCanonicalRedirect`).
 *
 * Two bounded reads — the periods and the surfaces' figures — never a
 * photograph.
 */

interface YearTally {
  readonly year: number;
  readonly total: number;
  /** Month → count; the Photos known only to the year are `undated`. */
  readonly months: ReadonlyMap<number, number>;
  readonly yearOnly: number;
}

function tallies(periods: readonly PhotoArchivePeriod[]): Map<number, YearTally> {
  const out = new Map<
    number,
    { year: number; total: number; months: Map<number, number>; yearOnly: number }
  >();
  for (const period of periods) {
    const entry = out.get(period.year) ?? {
      year: period.year,
      total: 0,
      months: new Map<number, number>(),
      yearOnly: 0,
    };
    entry.total += period.photos;
    if (period.month === null) entry.yearOnly += period.photos;
    else
      entry.months.set(
        period.month,
        (entry.months.get(period.month) ?? 0) + period.photos,
      );
    out.set(period.year, entry);
  }
  return out;
}

/** A month's bar, by its share of the year's busiest month: five steps, no `style` (CSP). */
const BAR_HEIGHTS = ['h-2', 'h-3', 'h-5', 'h-6', 'h-8'] as const;

/**
 * Twelve months as a quiet bar each — a picture of the year, hidden from
 * assistive technology because the numbers beside it say the same in words.
 */
function MonthStrip({ months }: { readonly months: ReadonlyMap<number, number> }) {
  const peak = Math.max(1, ...months.values());
  return (
    <span aria-hidden="true" className="flex h-8 items-end gap-0.5">
      {Array.from({ length: 12 }, (_, index) => {
        const total = months.get(index + 1) ?? 0;
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

/** A count that leads into the listing for its period. */
function PeriodLink({ href, text }: { readonly href: string; readonly text: string }) {
  return (
    <a
      href={href}
      className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border border-border bg-surface px-4 text-sm font-medium text-action no-underline hover:border-action hover:bg-surface-sunken"
    >
      <span className="min-w-0 wrap-anywhere tabular-nums">{text}</span>
      <Icon name="arrow-end" size={16} className="shrink-0" />
    </a>
  );
}

export async function MediaArchivePage({
  locale,
  view,
}: {
  readonly locale: Locale;
  readonly view: MediaArchiveView;
}) {
  const [t, trail] = await Promise.all([
    getTranslations({ locale, namespace: 'photos' }),
    photosTrail(locale),
  ]);
  const reads = mediaReadRuntime();
  const [periods, facets] = await Promise.all([
    reads.photoArchivePeriods(),
    reads.photoListingFacets({}),
  ]);
  const years = tallies(periods);
  const order = [...years.keys()].sort((a, b) => b - a);
  const total = [...years.values()].reduce((sum, entry) => sum + entry.total, 0);
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const first = order.at(-1);
  const last = order[0];
  const opened = view.year === null ? undefined : years.get(view.year);
  const position = view.year === null ? -1 : order.indexOf(view.year);
  const later = position > 0 ? order[position - 1] : undefined;
  const earlier = position >= 0 ? order[position + 1] : undefined;
  const title = t('sections.archive');

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
                  { href: mediaArchiveHref(locale), text: title },
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
          lede={t('sectionBody.archive')}
          stats={[
            ...(total === 0
              ? []
              : [{ value: number(total), label: t('stats.dated', { count: total }) }]),
            ...(first === undefined || last === undefined
              ? []
              : [
                  {
                    value:
                      first === last
                        ? yearText(first, locale)
                        : `${yearText(first, locale)}–${yearText(last, locale)}`,
                    label: t('stats.span', { count: last - first + 1 }),
                  },
                ]),
          ]}
          actions={[]}
        />
        <MediaTabs locale={locale} current="archive" all={facets.all} t={t} />

        {order.length === 0 ? (
          <EmptyState
            icon="calendar"
            title={t('archivePage.emptyTitle')}
            action={{ href: trail.news.href, text: t('listing.backToNews') }}
          >
            {t('archiveEmpty')}
          </EmptyState>
        ) : (
          <div className="grid min-w-0 gap-10 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-12">
            <nav aria-label={t('archiveYears')} className="flex min-w-0 flex-col gap-3">
              <h2 className="text-sm font-semibold text-foreground-muted">
                {t('archiveYears')}
              </h2>
              <ul className="flex list-none flex-wrap gap-2 p-0 lg:flex-col">
                <li>
                  <FilterLink
                    href={mediaArchiveHref(locale)}
                    current={view.year === null}
                  >
                    {t('archiveEveryYear')}
                  </FilterLink>
                </li>
                {order.map((year) => (
                  <li key={year}>
                    <FilterLink
                      href={mediaArchiveHref(locale, year)}
                      current={view.year === year}
                    >
                      <span className="tabular-nums">{yearText(year, locale)}</span>
                      <span className="ms-1.5 text-foreground-muted tabular-nums">
                        {number(years.get(year)?.total ?? 0)}
                        <span className="sr-only">
                          {' '}
                          {t('stats.photos', { count: years.get(year)?.total ?? 0 })}
                        </span>
                      </span>
                    </FilterLink>
                  </li>
                ))}
              </ul>
            </nav>

            {view.year === null ? (
              <EveryYear locale={locale} order={order} years={years} t={t} />
            ) : opened === undefined ? (
              <EmptyState
                title={t('archivePage.yearEmptyTitle')}
                action={{ href: mediaArchiveHref(locale), text: t('archiveEveryYear') }}
              >
                {t('archivePage.yearEmpty', { year: yearText(view.year, locale) })}
              </EmptyState>
            ) : (
              <section
                aria-label={t('archiveYear', { year: yearText(opened.year, locale) })}
                className="flex min-w-0 flex-col gap-6"
              >
                <div className="flex flex-col gap-3 rounded-panel border border-border bg-surface-raised p-4 sm:p-5">
                  <p className="font-medium">
                    {t('archivePage.yearTotal', {
                      year: yearText(opened.year, locale),
                      count: opened.total,
                    })}
                  </p>
                  {opened.yearOnly === 0 ? null : (
                    <p className="text-sm text-foreground-muted">
                      {t('archivePage.yearOnly', { count: opened.yearOnly })}
                    </p>
                  )}
                  <p>
                    <PeriodLink
                      href={periodHref(locale, opened.year, null)}
                      text={t('archivePage.seeYear', {
                        year: yearText(opened.year, locale),
                        count: opened.total,
                      })}
                    />
                  </p>
                </div>
                {opened.months.size === 0 ? null : (
                  <>
                    <SectionHeader
                      id="media-archive-months"
                      heading={t('archivePage.monthsHeading', {
                        year: yearText(opened.year, locale),
                      })}
                    />
                    <nav aria-label={t('archiveMonths')}>
                      <ul className="flex list-none flex-wrap gap-2 p-0">
                        {[...opened.months.keys()]
                          .sort((x, y) => x - y)
                          .map((month) => (
                            <li key={month} className="min-w-0">
                              <PeriodLink
                                href={periodHref(locale, opened.year, month)}
                                text={t('archivePage.month', {
                                  month: monthName(month, locale),
                                  count: opened.months.get(month) ?? 0,
                                })}
                              />
                            </li>
                          ))}
                      </ul>
                    </nav>
                  </>
                )}
                {later === undefined && earlier === undefined ? null : (
                  <nav
                    aria-label={t('archivePage.yearNav')}
                    className="flex flex-wrap justify-between gap-3 border-t border-border pt-4"
                  >
                    {later === undefined ? (
                      <span />
                    ) : (
                      <a
                        href={mediaArchiveHref(locale, later)}
                        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-action underline-offset-4 hover:underline"
                      >
                        <Icon name="arrow-start" size={16} />
                        <span className="tabular-nums">{yearText(later, locale)}</span>
                      </a>
                    )}
                    {earlier === undefined ? null : (
                      <a
                        href={mediaArchiveHref(locale, earlier)}
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

        <RightsNote t={t} />
      </div>
    </Container>
  );
}

/** Every year, each with its picture of months and a count into its listing. */
function EveryYear({
  locale,
  order,
  years,
  t,
}: {
  readonly locale: Locale;
  readonly order: readonly number[];
  readonly years: ReadonlyMap<number, YearTally>;
  readonly t: PhotosTranslator;
}) {
  return (
    <section aria-labelledby="media-archive-all" className="flex min-w-0 flex-col gap-5">
      <SectionHeader
        id="media-archive-all"
        heading={t('archiveAll')}
        intro={t('archivePage.intro')}
      />
      <ol className="flex list-none flex-col p-0">
        {order.map((year) => {
          const entry = years.get(year);
          if (entry === undefined) return null;
          return (
            <li
              key={year}
              className="flex min-w-0 flex-col gap-3 border-b border-border py-5 sm:flex-row sm:items-center sm:gap-6"
            >
              <div className="flex shrink-0 items-end gap-4 sm:w-44">
                <h3 className="text-subheading font-semibold tabular-nums">
                  {yearText(year, locale)}
                </h3>
                <MonthStrip months={entry.months} />
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <PeriodLink
                  href={periodHref(locale, year, null)}
                  text={t('count', { count: entry.total })}
                />
                <span className="text-sm text-foreground-muted">
                  {t('archivePage.months', { count: entry.months.size })}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
