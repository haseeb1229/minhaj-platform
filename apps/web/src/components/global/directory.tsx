import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import type { Locale } from '@minhaj/contracts';
import {
  GLOBAL_PAGE,
  globalPaths,
  tallyCentrePlaces,
  type CentrePlaceTally,
  type PublicCountryEntry,
  type PublicPlace,
} from '@minhaj/contracts/global';

import { globalReadRuntime } from '@/composition/global-read';
import { ClosingNote, RangeSummary } from '@/components/library/browse-parts';
import { pageCount, pageRange } from '@/components/topic-hub/address';
import {
  ActiveFilters,
  ExploreFilters,
  ExploreHero,
  LetterIndex,
} from '@/components/topic-hub/parts';
import {
  Alert,
  Breadcrumbs,
  Container,
  EmptyState,
  Field,
  Icon,
  LinkTabs,
  Pager,
  SectionHeader,
  Select,
} from '@/components/ui';
import {
  CentreResults,
  CountriesByRegion,
  globalTrail,
  GlobalTabs,
  numberIn,
  Section,
  type Figure,
  type GlobalTranslator,
} from './frame';
import {
  centresHref,
  countriesHref,
  finderHref,
  finderPlaceHref,
  finderReadQuery,
  offsetOfPage,
  type CentresView,
  type CountriesView,
  type FinderView,
} from './global-view';
import { placeName } from './presentation';
import { groupByWorldRegion, WORLD_REGIONS, worldRegionOf } from './world-region';

/**
 * The public Global Network directory (ROUTE_MAP.md §3.9) — Phase 16, rebuilt
 * in R2 to the listing standard of News & Events.
 *
 *   `/global`                    the World Network front door
 *   `/global/countries`          every public Country, by world region
 *   `/global/centres`            every public Centre, grouped by Country
 *   `/global/find-a-centre`      Find a Centre, by Country, then Region or City
 *
 * A Country, a Region, a City and the Pakistan structure are `./places`; a
 * Centre and its own pages are `./centre`; what they share is `./frame`; every
 * address is `./global-view`.
 *
 * SERVER COMPONENTS, SESSION-FREE BY CONSTRUCTION. Every read goes through
 * `@/composition/global-read`, which reaches no Identity, session, cookie or
 * personal location. The same knowledge renders signed in or out.
 *
 * NOTHING IS INVENTED. Until OPEN_DECISIONS.md §6.2 is closed the directory may
 * hold Countries of presence and no Centre; every page says so plainly. A
 * figure is the published records' own count (`countryDirectory` counts every
 * Country there can be, so its sums are exact); no map, flag wall, photograph,
 * geolocation or distance stands in for data the organisation has not
 * confirmed.
 */

type HubTranslator = Awaited<ReturnType<typeof getTranslations<'topicHub'>>>;

/** What the whole directory holds — every figure exact (the directory is complete). */
export function directoryTotals(directory: readonly PublicCountryEntry[]) {
  return {
    countries: directory.length,
    centres: directory.reduce((sum, entry) => sum + entry.centres, 0),
    cities: directory.reduce((sum, entry) => sum + entry.cities, 0),
    withCentres: directory.filter((entry) => entry.centres > 0).length,
    worldRegions: groupByWorldRegion(directory).filter(
      (group) => group.region !== 'other',
    ).length,
  };
}

/** A list page's frame: breadcrumbs, then the column the hero and body sit in. */
function ListFrame({
  crumbs,
  children,
}: {
  readonly crumbs: {
    readonly label: string;
    readonly trail: readonly { readonly href?: string; readonly text: string }[];
  };
  readonly children: ReactNode;
}) {
  return (
    <Container>
      <div className="flex min-w-0 flex-col gap-8 pt-6 pb-[var(--space-section)]">
        <Breadcrumbs label={crumbs.label} trail={crumbs.trail} />
        {children}
      </div>
    </Container>
  );
}

/* ===========================================================================
 * /global
 * ========================================================================= */

/**
 * The World Network front door: the organisation's presence told from the
 * published records — how many Countries across which regions of the world,
 * and, once they are published, how many Centres in how many Cities — then
 * the ways into the directory and every Country by region, each with its
 * Centres counted.
 *
 * EVERY WAY IN, ALWAYS. Find a Centre leads the page; the finder, the
 * Countries, the Centres and Pakistan are always offered. Until a Centre is
 * published the hero says plainly that no centre address is published yet.
 * Local News and Events are each Centre's own and are not linked here.
 */
export async function GlobalLandingPage({ locale }: { readonly locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'global' });
  const trail = await globalTrail(locale);
  const directory = await globalReadRuntime().countryDirectory();
  const totals = directoryTotals(directory);
  const number = numberIn(locale);
  const entries = [
    { key: 'finder', icon: 'search', href: globalPaths.finder(locale) },
    { key: 'countries', icon: 'globe', href: globalPaths.countries(locale) },
    { key: 'centres', icon: 'map-pin', href: globalPaths.centres(locale) },
    { key: 'pakistan', icon: 'grid', href: globalPaths.pakistan(locale) },
  ] as const;
  const figures: Figure[] = [
    ...(totals.countries === 0
      ? []
      : [
          {
            value: number(totals.countries),
            label: t('figures.countries', { count: totals.countries }),
          },
        ]),
    ...(totals.worldRegions === 0
      ? []
      : [
          {
            value: number(totals.worldRegions),
            label: t('figures.worldRegions', { count: totals.worldRegions }),
          },
        ]),
    ...(totals.centres === 0
      ? []
      : [
          {
            value: number(totals.centres),
            label: t('figures.centres', { count: totals.centres }),
          },
        ]),
    ...(totals.cities === 0
      ? []
      : [
          {
            value: number(totals.cities),
            label: t('figures.cities', { count: totals.cities }),
          },
        ]),
  ];

  return (
    <ListFrame crumbs={{ label: trail.label, trail: [trail.home, { text: t('title') }] }}>
      <ExploreHero
        eyebrow={t('landing.eyebrow')}
        title={t('title')}
        lede={
          totals.countries === 0
            ? t('intro')
            : totals.worldRegions === 0
              ? t('presenceCountries', { countries: totals.countries })
              : t('presence', {
                  countries: totals.countries,
                  regions: totals.worldRegions,
                })
        }
        {...(totals.countries > 0 && totals.centres === 0
          ? { notice: t('presenceNotice') }
          : {})}
        stats={figures}
        actions={[
          { href: globalPaths.finder(locale), text: t('sections.finder') },
          ...(totals.countries === 0
            ? []
            : [{ href: globalPaths.countries(locale), text: t('allCountries') }]),
        ]}
      />

      {totals.countries === 0 && totals.centres === 0 ? (
        <EmptyState icon="globe" title={t('landing.emptyTitle')}>
          {t('emptyDirectory')}
        </EmptyState>
      ) : null}

      <section aria-labelledby="global-entry" className="flex flex-col gap-2">
        <h2 id="global-entry" className="sr-only">
          {t('entryPoints')}
        </h2>
        <ul
          aria-label={t('entryPoints')}
          className="grid list-none grid-cols-1 gap-x-8 p-0 *:min-w-0 sm:grid-cols-2"
        >
          {entries.map((entry) => (
            <li
              key={entry.key}
              className="group card-surface relative flex items-start gap-3 border-b border-border py-4"
            >
              <Icon name={entry.icon} size={24} className="mt-0.5 shrink-0 text-accent" />
              <div className="flex min-w-0 flex-col gap-1">
                <h3 className="text-base font-semibold">
                  <a
                    href={entry.href}
                    className="card-link text-foreground no-underline decoration-accent-rule underline-offset-4 group-hover:underline"
                  >
                    {t(`sections.${entry.key}`)}
                  </a>
                </h3>
                <p className="text-sm text-foreground-muted">
                  {t(`landing.${entry.key}`)}
                </p>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex max-w-[var(--measure-prose)] flex-col gap-1 pt-2">
          <h3 className="text-sm font-semibold">{t('landing.localTitle')}</h3>
          <p className="text-sm text-foreground-muted">{t('landing.localBody')}</p>
        </div>
      </section>

      <section aria-labelledby="global-countries" className="flex flex-col gap-6">
        <SectionHeader
          id="global-countries"
          heading={t('byRegion')}
          intro={totals.centres > 0 ? t('countriesIntro') : t('presenceIntro')}
          {...(totals.countries === 0
            ? {}
            : {
                action: {
                  href: globalPaths.countries(locale),
                  text: t('allCountriesCount', { count: totals.countries }),
                },
              })}
        />
        {totals.countries === 0 ? (
          <EmptyState>{t('countriesEmpty')}</EmptyState>
        ) : (
          <CountriesByRegion countries={directory} locale={locale} t={t} />
        )}
      </section>

      <ClosingNote
        text={t('dataNotice')}
        links={[{ href: globalPaths.finder(locale), text: t('sections.finder') }]}
      />
    </ListFrame>
  );
}

/* ===========================================================================
 * /global/countries
 * ========================================================================= */

/**
 * Every public Country, a page of 24 at a time, ordered by world region and
 * then by name as the reader's language orders names; the world regions as a
 * counted index (`?region`), its chip, the range, numbered pages, and honest
 * empty, refused and past-the-end states. Each Country tile counts its
 * Centres.
 */
export async function CountriesPage({
  locale,
  view,
}: {
  readonly locale: Locale;
  readonly view: CountriesView;
}) {
  const [t, hub, trail] = await Promise.all([
    getTranslations({ locale, namespace: 'global' }),
    getTranslations({ locale, namespace: 'topicHub' }),
    globalTrail(locale),
  ]);
  const directory = await globalReadRuntime().countryDirectory();
  const totals = directoryTotals(directory);
  const number = numberIn(locale);
  const base = globalPaths.countries(locale);
  const href = (change: Partial<Omit<CountriesView, 'invalid'>>) =>
    countriesHref(base, view, change);
  const title = t('sections.countries');

  const collator = new Intl.Collator(locale);
  const order = (region: string) => (WORLD_REGIONS as readonly string[]).indexOf(region);
  const sorted = [...directory].sort(
    (a, b) =>
      order(worldRegionOf(a.code)) - order(worldRegionOf(b.code)) ||
      collator.compare(placeName(a, locale).text, placeName(b, locale).text),
  );
  const regionCounts = new Map<string, number>();
  for (const entry of sorted) {
    const region = worldRegionOf(entry.code);
    regionCounts.set(region, (regionCounts.get(region) ?? 0) + 1);
  }
  const shown =
    view.region === null
      ? sorted
      : sorted.filter((entry) => worldRegionOf(entry.code) === view.region);
  const items = shown.slice(
    offsetOfPage(view.page),
    offsetOfPage(view.page) + GLOBAL_PAGE,
  );
  const range = pageRange(view.page, items.length, GLOBAL_PAGE);

  return (
    <ListFrame
      crumbs={{ label: trail.label, trail: [trail.home, trail.global, { text: title }] }}
    >
      <ExploreHero
        eyebrow={t('title')}
        title={title}
        lede={t('countriesIntro')}
        {...(totals.countries > 0 && totals.centres === 0
          ? { notice: t('presenceNotice') }
          : {})}
        stats={[
          ...(totals.countries === 0
            ? []
            : [
                {
                  value: number(totals.countries),
                  label: t('figures.countries', { count: totals.countries }),
                },
              ]),
          ...(totals.worldRegions === 0
            ? []
            : [
                {
                  value: number(totals.worldRegions),
                  label: t('figures.worldRegions', { count: totals.worldRegions }),
                },
              ]),
          ...(totals.withCentres === 0
            ? []
            : [
                {
                  value: number(totals.withCentres),
                  label: t('figures.withCentres', { count: totals.withCentres }),
                },
              ]),
        ]}
        actions={[{ href: globalPaths.finder(locale), text: t('sections.finder') }]}
      />
      <GlobalTabs
        locale={locale}
        current="countries"
        countries={totals.countries}
        centres={totals.centres}
        t={t}
      />

      {totals.countries === 0 ? (
        <EmptyState icon="globe" title={t('countries.emptyTitle')}>
          {t('countriesEmpty')}
        </EmptyState>
      ) : (
        <section aria-labelledby="countries-list" className="flex min-w-0 flex-col gap-5">
          <SectionHeader
            id="countries-list"
            heading={t('countries.heading')}
            intro={t('countries.intro')}
          />
          <LetterIndex
            label={t('countries.regionsLabel')}
            all={{
              text: t('countries.allRegions', { count: number(totals.countries) }),
              href: href({ region: null }),
              current: view.region === null && !view.invalid,
            }}
            letters={WORLD_REGIONS.flatMap((region) => {
              const count = regionCounts.get(region) ?? 0;
              if (count === 0) return [];
              const text = t('countries.regionOption', {
                region: t(`regions.${region}`),
                count: number(count),
              });
              return [
                {
                  key: region,
                  text,
                  label: text,
                  href: href({ region }),
                  current: view.region === region,
                },
              ];
            })}
          />
          <ActiveFilters
            label={hub('common.active')}
            filters={
              view.region === null
                ? []
                : [
                    {
                      key: 'region',
                      text: t(`regions.${view.region}`),
                      removeHref: href({ region: null }),
                      removeLabel: hub('common.remove', {
                        name: t(`regions.${view.region}`),
                      }),
                    },
                  ]
            }
          />

          {view.invalid ? (
            <EmptyState
              title={t('countries.invalidTitle')}
              action={{ href: base, text: t('allCountries') }}
            >
              {t('countries.invalid')}
            </EmptyState>
          ) : items.length === 0 ? (
            <EmptyState
              title={hub('common.pastEndTitle')}
              action={{ href: href({ page: 1 }), text: hub('common.firstPage') }}
            >
              {t('pageEmpty')}
            </EmptyState>
          ) : (
            <>
              {range === null ? null : (
                <RangeSummary>
                  {t('results.countries', {
                    from: number(range.from),
                    to: number(range.to),
                    total: shown.length,
                  })}
                </RangeSummary>
              )}
              <CountriesByRegion
                countries={items}
                locale={locale}
                t={t}
                headingLevel="h3"
              />
              <Pager
                label={t('results.pages', { list: title })}
                previous={view.page > 1 ? href({ page: view.page - 1 }) : null}
                next={
                  offsetOfPage(view.page) + GLOBAL_PAGE < shown.length
                    ? href({ page: view.page + 1 })
                    : null
                }
                previousLabel={t('previous')}
                nextLabel={t('next')}
                pages={{
                  current: view.page,
                  total: pageCount(shown.length, GLOBAL_PAGE),
                  href: (target) => href({ page: target }),
                  label: (target) => hub('common.pageLabel', { page: target }),
                  format: number,
                }}
              />
            </>
          )}
        </section>
      )}

      <ClosingNote
        text={t('dataNotice')}
        links={[{ href: globalPaths.centres(locale), text: t('allCentres') }]}
      />
    </ListFrame>
  );
}

/* ===========================================================================
 * /global/centres
 * ========================================================================= */

/**
 * Every public Centre, a page of 24 at a time, grouped under its Country (the
 * Countries' slug order, then the Centres'): what it holds as counted tabs —
 * every Centre, those with premises, virtual ones — the range, numbered pages,
 * and honest empty, refused and past-the-end states. Narrowing by place is the
 * finder's, which each Country group and the hero lead to.
 */
export async function CentresPage({
  locale,
  view,
}: {
  readonly locale: Locale;
  readonly view: CentresView;
}) {
  const [t, hub, trail] = await Promise.all([
    getTranslations({ locale, namespace: 'global' }),
    getTranslations({ locale, namespace: 'topicHub' }),
    globalTrail(locale),
  ]);
  const read = globalReadRuntime();
  const all = { countryId: null, regionId: null, cityId: null };
  const [directory, virtual, page] = await Promise.all([
    read.countryDirectory(),
    read.centresIn({ scope: all, kind: 'virtual', offset: 0, limit: 1 }),
    view.invalid
      ? Promise.resolve(null)
      : read.centresIn({
          scope: all,
          kind: view.kind,
          offset: offsetOfPage(view.page),
          limit: GLOBAL_PAGE,
        }),
  ]);
  const totals = directoryTotals(directory);
  const kinds = {
    all: totals.centres,
    physical: totals.centres - virtual.total,
    virtual: virtual.total,
  };
  const number = numberIn(locale);
  const base = globalPaths.centres(locale);
  const href = (change: Partial<Omit<CentresView, 'invalid'>>) =>
    centresHref(base, view, change);
  const title = t('sections.centres');

  return (
    <ListFrame
      crumbs={{ label: trail.label, trail: [trail.home, trail.global, { text: title }] }}
    >
      <ExploreHero
        eyebrow={t('title')}
        title={title}
        lede={t('centresIntro')}
        stats={[
          ...(kinds.all === 0
            ? []
            : [
                {
                  value: number(kinds.all),
                  label: t('figures.centres', { count: kinds.all }),
                },
                {
                  value: number(totals.withCentres),
                  label: t('figures.withCentres', { count: totals.withCentres }),
                  href: globalPaths.countries(locale),
                },
              ]),
          ...(kinds.virtual === 0
            ? []
            : [
                {
                  value: number(kinds.virtual),
                  label: t('figures.virtual', { count: kinds.virtual }),
                },
              ]),
        ]}
        actions={[{ href: globalPaths.finder(locale), text: t('sections.finder') }]}
      />
      <GlobalTabs
        locale={locale}
        current="centres"
        countries={totals.countries}
        centres={totals.centres}
        t={t}
      />

      {kinds.all === 0 ? (
        <EmptyState
          icon="map-pin"
          title={t('centres.emptyTitle')}
          {...(totals.countries === 0
            ? {}
            : {
                action: { href: globalPaths.countries(locale), text: t('allCountries') },
              })}
        >
          {t('emptyDirectory')}
        </EmptyState>
      ) : (
        <section aria-labelledby="centres-list" className="flex min-w-0 flex-col gap-5">
          <SectionHeader
            id="centres-list"
            heading={t('centres.heading')}
            intro={t('centres.intro')}
          />
          <LinkTabs
            label={t('centres.kindsLabel')}
            tabs={(['all', 'physical', 'virtual'] as const).map((kind) => ({
              href: href({ kind: kind === 'all' ? null : kind }),
              text: t(`centres.kinds.${kind}`),
              current: !view.invalid && (view.kind ?? 'all') === kind,
              count: number(kinds[kind]),
            }))}
          />
          {page === null ? (
            <EmptyState
              title={t('centres.invalidTitle')}
              action={{ href: base, text: t('allCentres') }}
            >
              {t('centres.invalid')}
            </EmptyState>
          ) : (
            <CentreResults
              locale={locale}
              page={page}
              current={view.page}
              href={(target) => href({ page: target })}
              label={title}
              empty={t(`centres.none.${view.kind ?? 'physical'}`)}
              emptyAction={{ href: base, text: t('allCentres') }}
              grouped
              t={t}
              hub={hub}
            />
          )}
        </section>
      )}

      <ClosingNote
        text={t('dataNotice')}
        links={[{ href: globalPaths.countries(locale), text: t('allCountries') }]}
      />
    </ListFrame>
  );
}

/* ===========================================================================
 * /global/find-a-centre
 * ========================================================================= */

/** One counted option of a place select; uncounted when the page could not count. */
interface PlaceOption {
  readonly place: PublicPlace;
  readonly count: number | null;
}

function placeOptions(
  places: readonly PublicPlace[],
  counts: ReadonlyMap<string, number> | null,
  current: string | null,
): PlaceOption[] {
  return places.flatMap((place): PlaceOption[] => {
    if (counts === null) return [{ place, count: null }];
    const count = counts.get(place.id) ?? 0;
    return count > 0 || place.slug === current ? [{ place, count }] : [];
  });
}

function PlaceSelect({
  id,
  label,
  name,
  value,
  any,
  options,
  disabled,
  help,
  locale,
  hub,
}: {
  readonly id: string;
  readonly label: string;
  readonly name: string;
  readonly value: string;
  readonly any: string;
  readonly options: readonly PlaceOption[];
  readonly disabled: boolean;
  readonly help?: string;
  readonly locale: Locale;
  readonly hub: HubTranslator;
}) {
  const number = numberIn(locale);
  return (
    <Field id={id} label={label} {...(help === undefined ? {} : { help })}>
      {(props) => (
        <Select {...props} name={name} defaultValue={value} disabled={disabled}>
          <option value="">{any}</option>
          {options.map(({ place, count }) => {
            const words = placeName(place, locale);
            return (
              <option key={place.id} value={place.slug} lang={words.locale}>
                {count === null
                  ? words.text
                  : hub('common.option', { name: words.text, count: number(count) })}
              </option>
            );
          })}
        </Select>
      )}
    </Field>
  );
}

/**
 * Find a Centre — a GET form over the public geography, server-rendered and
 * bounded: a Country (each counted by its public Centres), then a Region OR a
 * City of it (each counted by the Centres in it or serving it, or offered
 * uncounted where there are too many to count exactly). Chips remove one
 * place each; the results are "Showing n–m of N" with numbered pages.
 *
 * FOUR OUTCOMES ARE TOLD APART: nothing is chosen yet (the Countries that have
 * Centres, counted, are offered as the way in, and every Centre is
 * `/global/centres`); the directory has no Centre at all; a chosen place
 * holds none; and the place cannot mean anything or is not public — refused
 * in words where it was asked, never widened. No location is read from the
 * browser or the network address, and nothing is sorted by distance.
 */
export async function FinderPage({
  locale,
  view,
}: {
  readonly locale: Locale;
  readonly view: FinderView;
}) {
  const [t, hub, trail] = await Promise.all([
    getTranslations({ locale, namespace: 'global' }),
    getTranslations({ locale, namespace: 'topicHub' }),
    globalTrail(locale),
  ]);
  const read = globalReadRuntime();
  const directory = await read.countryDirectory();
  const totals = directoryTotals(directory);
  const country =
    view.country === null
      ? null
      : (directory.find((entry) => entry.slug === view.country) ?? null);
  const [regions, cities, places, result] = await Promise.all([
    country === null ? Promise.resolve([]) : read.countryRegions(country.id),
    country === null ? Promise.resolve([]) : read.cityChoices(country.id),
    country === null ? Promise.resolve(null) : read.centrePlaces(country.id),
    view.invalid || view.country === null
      ? Promise.resolve(null)
      : read.find(finderReadQuery(view)),
  ]);
  const tally: CentrePlaceTally | null =
    places === null ? null : tallyCentrePlaces(places);
  const base = globalPaths.finder(locale);
  const href = (change: Partial<Omit<FinderView, 'invalid'>>) =>
    finderHref(base, view, change);
  const title = t('sections.finder');
  const number = numberIn(locale);
  const refused = view.invalid || result?.status === 'invalid';

  const countryOptions = placeOptions(
    directory,
    new Map(directory.map((entry) => [entry.id, entry.centres])),
    view.country,
  );
  const regionOptions = placeOptions(regions, tally?.regions ?? null, view.region);
  const cityOptions = placeOptions(cities, tally?.cities ?? null, view.city);
  const chosenRegion = regions.find((entry) => entry.slug === view.region) ?? null;
  const chosenCity = cities.find((entry) => entry.slug === view.city) ?? null;

  const chip = (
    key: string,
    place: PublicPlace | null,
    slug: string,
    removeHref: string,
  ) => {
    const words = place === null ? null : placeName(place, locale);
    const text = words?.text ?? slug;
    return {
      key,
      text:
        words === null ? (
          <span dir="auto">{text}</span>
        ) : (
          <span lang={words.locale}>{text}</span>
        ),
      removeHref,
      removeLabel: hub('common.remove', { name: text }),
    };
  };
  const active = refused
    ? []
    : [
        ...(view.country === null ? [] : [chip('country', country, view.country, base)]),
        ...(view.region === null
          ? []
          : [chip('region', chosenRegion, view.region, href({ region: null }))]),
        ...(view.city === null
          ? []
          : [chip('city', chosenCity, view.city, href({ city: null }))]),
      ];
  const scopeName =
    chosenCity === null
      ? chosenRegion === null
        ? country === null
          ? null
          : placeName(country, locale).text
        : placeName(chosenRegion, locale).text
      : placeName(chosenCity, locale).text;

  return (
    <ListFrame
      crumbs={{ label: trail.label, trail: [trail.home, trail.global, { text: title }] }}
    >
      <ExploreHero
        eyebrow={t('title')}
        title={title}
        lede={t('finder.intro')}
        notice={t('finder.privacy')}
        stats={
          totals.centres === 0
            ? []
            : [
                {
                  value: number(totals.centres),
                  label: t('figures.centres', { count: totals.centres }),
                },
                {
                  value: number(totals.withCentres),
                  label: t('figures.withCentres', { count: totals.withCentres }),
                },
              ]
        }
        actions={[{ href: globalPaths.centres(locale), text: t('allCentres') }]}
      />
      <GlobalTabs
        locale={locale}
        current="finder"
        countries={totals.countries}
        centres={totals.centres}
        t={t}
      />

      <ExploreFilters
        action={base}
        label={t('finder.form')}
        hidden={[]}
        submit={t('finder.submit')}
        reset={
          view.country === null && !view.invalid
            ? null
            : { href: base, text: t('finder.reset') }
        }
      >
        <PlaceSelect
          id="finder-country"
          label={t('finder.country')}
          name="country"
          value={view.country ?? ''}
          any={t('finder.anyCountry')}
          options={countryOptions}
          disabled={false}
          locale={locale}
          hub={hub}
        />
        <PlaceSelect
          id="finder-region"
          label={t('finder.region')}
          name="region"
          value={view.region ?? ''}
          any={t('finder.anyRegion')}
          options={regionOptions}
          disabled={country === null || regionOptions.length === 0}
          {...(country === null ? { help: t('finder.chooseCountry') } : {})}
          locale={locale}
          hub={hub}
        />
        <PlaceSelect
          id="finder-city"
          label={t('finder.city')}
          name="city"
          value={view.city ?? ''}
          any={t('finder.anyCity')}
          options={cityOptions}
          disabled={country === null || cityOptions.length === 0}
          help={t('finder.regionOrCity')}
          locale={locale}
          hub={hub}
        />
      </ExploreFilters>

      <ActiveFilters label={hub('common.active')} filters={active} />

      <Section
        id="finder-results"
        heading={
          scopeName === null || refused
            ? t('finder.results')
            : t('finder.resultsIn', { place: scopeName })
        }
      >
        {refused ? (
          <Alert tone="warning">{t('finder.invalid')}</Alert>
        ) : totals.centres === 0 || (result?.status === 'ok' && result.inventoryEmpty) ? (
          <EmptyState
            icon="map-pin"
            title={t('centres.emptyTitle')}
            {...(totals.countries === 0
              ? {}
              : {
                  action: {
                    href: globalPaths.countries(locale),
                    text: t('allCountries'),
                  },
                })}
          >
            {t('emptyDirectory')}
          </EmptyState>
        ) : result === null || result.status !== 'ok' ? (
          <FinderStart locale={locale} directory={directory} t={t} />
        ) : (
          <CentreResults
            locale={locale}
            page={result.page}
            current={view.page}
            href={(target) => href({ page: target })}
            label={t('finder.results')}
            empty={t('finder.noMatch')}
            {...(view.region === null && view.city === null
              ? {}
              : {
                  emptyAction: {
                    href: href({ region: null, city: null }),
                    text: t('finder.widen', {
                      place:
                        country === null
                          ? (view.country ?? '')
                          : placeName(country, locale).text,
                    }),
                  },
                })}
            t={t}
            hub={hub}
          />
        )}
      </Section>

      <ClosingNote
        text={t('dataNotice')}
        links={[{ href: globalPaths.countries(locale), text: t('allCountries') }]}
      />
    </ListFrame>
  );
}

/**
 * The finder before a Country is chosen: the Countries that have public
 * Centres, each counted and each a link into the finder for it — the way in,
 * rather than every Centre at once (that is `/global/centres`).
 */
function FinderStart({
  locale,
  directory,
  t,
}: {
  readonly locale: Locale;
  readonly directory: readonly PublicCountryEntry[];
  readonly t: GlobalTranslator;
}) {
  const number = numberIn(locale);
  const collator = new Intl.Collator(locale);
  const withCentres = directory
    .filter((entry) => entry.centres > 0)
    .map((entry) => ({ entry, name: placeName(entry, locale) }))
    .sort((a, b) => collator.compare(a.name.text, b.name.text));
  const base = globalPaths.finder(locale);
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[var(--measure-prose)] text-sm text-foreground-muted">
        {t('finder.start')}
      </p>
      <ul
        aria-label={t('finder.startLabel')}
        className="flex list-none flex-wrap gap-2 p-0"
      >
        {withCentres.map(({ entry, name }) => (
          <li key={entry.id} className="min-w-0">
            <a
              href={finderPlaceHref(base, { country: entry.slug })}
              className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm font-medium text-action no-underline hover:border-action hover:bg-surface-sunken"
            >
              <span lang={name.locale} className="min-w-0 wrap-anywhere">
                {name.text}
              </span>
              <span className="text-foreground-muted tabular-nums">
                {number(entry.centres)}
                <span className="sr-only">
                  {' '}
                  {t('count.centresNoun', { count: entry.centres })}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
