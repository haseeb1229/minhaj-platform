import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import {
  EVENT_GEOGRAPHY_CENTRES,
  type CentreNewsPage,
  type EventListingPage,
} from '@minhaj/contracts/editorial';
import {
  GLOBAL_PAGE,
  globalPaths,
  tallyCentrePlaces,
  type CentrePlace,
  type PublicCity,
  type PublicCountry,
  type PublicPlace,
  type PublicPlacePage,
  type PublicRegion,
} from '@minhaj/contracts/global';

import { editorialReadRuntime } from '@/composition/editorial-read';
import { globalReadRuntime } from '@/composition/global-read';
import { eventsListingHref } from '@/components/editorial/event-view';
import { EventGrid } from '@/components/editorial/events';
import { NewsGrid } from '@/components/editorial/news';
import { RangeSummary } from '@/components/library/browse-parts';
import { BreadcrumbData } from '@/components/media/parts';
import { pageCount, pageRange } from '@/components/topic-hub/address';
import { ExploreHero } from '@/components/topic-hub/parts';
import {
  ActionLink,
  Breadcrumbs,
  Container,
  EmptyState,
  Pager,
  TextLink,
} from '@/components/ui';
import { directionOf } from '@/config/locale';
import { directoryTotals } from './directory';
import {
  CentreResults,
  DirectoryBody,
  DirectoryCrumbs,
  globalTrail,
  GlobalTabs,
  numberIn,
  PlaceTiles,
  RecordHeader,
  Section,
  ShareRecord,
  type Figure,
  type GlobalTranslator,
  type HubTranslator,
} from './frame';
import {
  countriesHref,
  finderPlaceHref,
  offsetOfPage,
  placeHref,
  type PlaceView,
} from './global-view';
import { centresAt, placeLocales, placeName } from './presentation';
import { worldRegionOf } from './world-region';

/**
 * The places of the Global Network (ROUTE_MAP.md §3.9) — Phase 16, rebuilt in
 * R2 to the listing standard:
 *
 *   `/global/countries/{c}`                a Country: its Regions, its Cities
 *                                          not in a Region, and its Centres
 *   `/global/countries/{c}/regions/{r}`    a Region: its Cities and Centres
 *   `/global/countries/{c}/cities/{city}`  a City: the Centres in it OR serving it
 *   `/global/pakistan`                     the Pakistan structure
 *
 * Each place page opens with its name in its own language, its figures (the
 * published records' own counts), the way to find a Centre there, and Share;
 * its Cities and Centres are "Showing n–m of N" with numbered pages; and it
 * goes on to what its Centres publish — their latest News and, where a
 * Centre is physically there, their upcoming Events — and to the places
 * beside it. A Country with no Region is ordinary, and nothing implies it
 * should have one.
 *
 * LAYER-4 COMPOSITION, NEVER A JOIN. Global says which public Centres a place
 * holds; Editorial answers News and Events by their identifiers. A failure on
 * Editorial's side leaves the section out — the place is still true without
 * it — and a place with more Centres than one bounded read may carry shows
 * its places uncounted and no local News, rather than counting a subset.
 */

/** How many of a place's latest News and upcoming Events it previews. */
const PLACE_PREVIEW = 3;

/** The newest News naming any of these Centres, or `null` — never a crash. */
async function localNews(
  centreIds: readonly string[] | null,
): Promise<CentreNewsPage | null> {
  if (centreIds === null || centreIds.length === 0) return null;
  try {
    return await editorialReadRuntime().centreNews(centreIds, 0, PLACE_PREVIEW);
  } catch {
    // A public content route reaches no logger; Editorial's own read path is
    // where such a failure is observed.
    return null;
  }
}

/**
 * The soonest upcoming Events held at the Centres PHYSICALLY in a Country or a
 * City — the `/events` place filter's own rule, so "All upcoming events" there
 * lists the same Events — or `null`.
 */
async function localEvents(scope: {
  readonly countryId: string;
  readonly cityId: string | null;
}): Promise<EventListingPage | null> {
  try {
    const ids = await globalReadRuntime().physicalCentreIds(
      scope,
      EVENT_GEOGRAPHY_CENTRES,
    );
    if (ids === null || ids.length === 0) return null;
    return await editorialReadRuntime().eventListing({
      when: 'upcoming',
      centreIds: ids,
      limit: PLACE_PREVIEW,
    });
  } catch {
    return null;
  }
}

/** What the place's Centres publish: their latest News and upcoming Events. */
async function LocalActivity({
  locale,
  placeName: name,
  news,
  events,
  eventsHref,
  t,
}: {
  readonly locale: Locale;
  readonly placeName: string;
  readonly news: CentreNewsPage | null;
  readonly events: EventListingPage | null;
  readonly eventsHref: string | null;
  readonly t: GlobalTranslator;
}) {
  return (
    <>
      {events === null || events.items.length === 0 ? null : (
        <Section
          id="place-events"
          heading={t('place.events', { place: name })}
          intro={t('place.eventsIntro')}
          {...(eventsHref === null
            ? {}
            : {
                action: {
                  href: eventsHref,
                  text: t('place.allEvents', { count: events.total }),
                },
              })}
        >
          <EventGrid
            locale={locale}
            items={events.items}
            when="upcoming"
            label={t('place.events', { place: name })}
            headingLevel="h3"
          />
        </Section>
      )}
      {news === null || news.items.length === 0 ? null : (
        <Section
          id="place-news"
          heading={t('countryNews', { country: name })}
          intro={t('place.newsIntro', { count: news.total })}
        >
          <NewsGrid
            locale={locale}
            items={news.items}
            label={t('countryNews', { country: name })}
            showType
            headingLevel="h3"
            columns={3}
          />
        </Section>
      )}
    </>
  );
}

/**
 * A page of a place's Cities: the range, the tiles (each counting its
 * Centres where the page could count exactly), numbered pages of `?cityPage`.
 */
function CityPages({
  locale,
  cities,
  view,
  base,
  countrySlug,
  counts,
  label,
  empty,
  t,
  hub,
}: {
  readonly locale: Locale;
  readonly cities: PublicPlacePage;
  readonly view: PlaceView;
  readonly base: string;
  readonly countrySlug: string;
  readonly counts: ReadonlyMap<string, number> | null;
  readonly label: string;
  readonly empty: string;
  readonly t: GlobalTranslator;
  readonly hub: HubTranslator;
}) {
  const number = numberIn(locale);
  const range = pageRange(view.cityPage, cities.items.length, GLOBAL_PAGE);
  const href = (cityPage: number) => placeHref(base, view, { cityPage });
  if (cities.items.length === 0 && view.cityPage > 1 && cities.total > 0)
    return (
      <EmptyState
        title={hub('common.pastEndTitle')}
        action={{ href: href(1), text: hub('common.firstPage') }}
      >
        {t('pageEmpty')}
      </EmptyState>
    );
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {range === null || cities.total <= GLOBAL_PAGE ? null : (
        <RangeSummary>
          {t('results.cities', {
            from: number(range.from),
            to: number(range.to),
            total: cities.total,
          })}
        </RangeSummary>
      )}
      <PlaceTiles
        places={cities.items}
        href={(city) => globalPaths.city(locale, countrySlug, city.slug)}
        label={label}
        empty={empty}
        locale={locale}
        counts={counts}
        countText={(count) => t('count.centres', { count })}
      />
      <Pager
        label={t('results.pages', { list: label })}
        previous={view.cityPage > 1 ? href(view.cityPage - 1) : null}
        next={cities.hasMore ? href(view.cityPage + 1) : null}
        previousLabel={t('previous')}
        nextLabel={t('next')}
        pages={{
          current: view.cityPage,
          total: pageCount(cities.total, GLOBAL_PAGE),
          href,
          label: (target) => hub('common.pageLabel', { page: target }),
          format: number,
        }}
      />
    </div>
  );
}

/** The figures of a place: only what it genuinely holds. */
function placeFigures(
  locale: Locale,
  t: GlobalTranslator,
  counts: {
    readonly regions?: number;
    readonly cities?: number;
    readonly centres: number;
  },
  anchors: {
    readonly regions?: string;
    readonly cities?: string;
    readonly centres: string;
  },
): Figure[] {
  const number = numberIn(locale);
  const figure = (key: 'regions' | 'cities' | 'centres'): Figure[] => {
    const value = counts[key];
    const anchor = anchors[key];
    return value === undefined || value === 0
      ? []
      : [
          {
            value: number(value),
            label: t(`figures.${key}`, { count: value }),
            ...(anchor === undefined ? {} : { href: `#${anchor}` }),
          },
        ];
  };
  return [...figure('regions'), ...figure('cities'), ...figure('centres')];
}

/** The Country's Centres' place rows, when Global could answer them all. */
async function placesOf(countryId: string): Promise<readonly CentrePlace[] | null> {
  try {
    return await globalReadRuntime().centrePlaces(countryId);
  } catch {
    return null;
  }
}

/* ===========================================================================
 * /global/countries/{c}
 * ========================================================================= */

export async function CountryPage({
  locale,
  country,
  view,
}: {
  readonly locale: Locale;
  readonly country: PublicCountry;
  readonly view: PlaceView;
}) {
  const [t, hub, trail] = await Promise.all([
    getTranslations({ locale, namespace: 'global' }),
    getTranslations({ locale, namespace: 'topicHub' }),
    globalTrail(locale),
  ]);
  const read = globalReadRuntime();
  const [directory, regions, cities, centres, places] = await Promise.all([
    read.countryDirectory(),
    read.countryRegions(country.id),
    read.countryCities(country.id, 'none', offsetOfPage(view.cityPage)),
    read.centresIn({
      scope: { countryId: country.id, regionId: null, cityId: null },
      kind: null,
      offset: offsetOfPage(view.page),
      limit: GLOBAL_PAGE,
    }),
    placesOf(country.id),
  ]);
  const entry = directory.find((candidate) => candidate.id === country.id);
  const tally = places === null ? null : tallyCentrePlaces(places);
  const name = placeName(country, locale);
  const region = worldRegionOf(country.code);
  const neighbours = directory.filter(
    (candidate) =>
      candidate.id !== country.id && worldRegionOf(candidate.code) === region,
  );
  const counts = {
    regions: entry?.regions ?? regions.length,
    cities: entry?.cities ?? cities.total,
    centres: entry?.centres ?? centres.total,
  };
  const [news, events] = await Promise.all([
    localNews(places === null ? null : places.map((row) => row.id)),
    counts.centres === 0
      ? Promise.resolve(null)
      : localEvents({ countryId: country.id, cityId: null }),
  ]);
  const base = globalPaths.country(locale, country.slug);
  // Phase 30-R: a Country of PRESENCE — published, with nothing yet listed
  // beneath it — says so once, plainly, instead of three empty lists, and does
  // not offer a search that can only come back empty.
  const bare = counts.regions === 0 && counts.cities === 0 && counts.centres === 0;
  const totals = directoryTotals(directory);

  return (
    <article>
      <DirectoryCrumbs
        label={trail.label}
        trail={[trail.home, trail.global, trail.countries, { text: name.text }]}
      />
      <RecordHeader
        kind={t('centre.country')}
        {...(region === 'other' ? {} : { where: t(`regions.${region}`) })}
        name={name.text}
        nameLocale={name.locale}
        figures={placeFigures(locale, t, counts, {
          regions: 'country-regions',
          cities: 'country-cities',
          centres: 'country-centres',
        })}
        actions={
          <>
            {counts.centres === 0 ? (
              <ActionLink href={globalPaths.countries(locale)} tone="secondary">
                {t('allCountries')}
              </ActionLink>
            ) : (
              <ActionLink
                href={finderPlaceHref(globalPaths.finder(locale), {
                  country: country.slug,
                })}
              >
                {t('country.findIn', { country: name.text })}
              </ActionLink>
            )}
            <ShareRecord locale={locale} path={base} title={name.text} />
          </>
        }
      >
        {bare ? (
          <p className="text-lede max-w-[var(--measure-prose)] text-foreground-muted">
            {t('country.presenceOnly')}
          </p>
        ) : null}
      </RecordHeader>

      <DirectoryBody>
        {regions.length === 0 ? null : (
          <Section id="country-regions" heading={t('country.regions')}>
            <PlaceTiles
              places={regions}
              href={(entry) => globalPaths.region(locale, country.slug, entry.slug)}
              label={t('country.regions')}
              empty={t('country.regionsEmpty')}
              locale={locale}
              counts={tally?.regions ?? null}
              countText={(count) => t('count.centres', { count })}
            />
          </Section>
        )}

        {/* A Country whose every City is in a Region lists them there, not here. */}
        {bare || (regions.length > 0 && cities.total === 0) ? null : (
          <Section
            id="country-cities"
            heading={
              regions.length === 0 ? t('country.cities') : t('country.directCities')
            }
          >
            <CityPages
              locale={locale}
              cities={cities}
              view={view}
              base={base}
              countrySlug={country.slug}
              counts={tally?.cities ?? null}
              label={t('country.cities')}
              empty={t('country.citiesEmpty')}
              t={t}
              hub={hub}
            />
          </Section>
        )}

        {bare ? null : (
          <Section id="country-centres" heading={t('sections.centres')}>
            <CentreResults
              locale={locale}
              page={centres}
              current={view.page}
              href={(page) => placeHref(base, view, { page })}
              label={t('sections.centres')}
              empty={t('country.centresEmpty')}
              t={t}
              hub={hub}
            />
          </Section>
        )}

        <LocalActivity
          locale={locale}
          placeName={name.text}
          news={news}
          events={events}
          eventsHref={eventsListingHref(locale, { country: country.slug })}
          t={t}
        />

        {neighbours.length === 0 || region === 'other' ? (
          <Section id="country-neighbours" heading={t('country.more')}>
            <p className="text-sm text-foreground-muted">
              <TextLink href={globalPaths.countries(locale)}>
                {t('allCountriesCount', { count: totals.countries })}
              </TextLink>
            </p>
          </Section>
        ) : (
          <Section
            id="country-neighbours"
            heading={t('countryNeighbours', { region: t(`regions.${region}`) })}
            action={{
              href: countriesHref(globalPaths.countries(locale), { region, page: 1 }),
              text: t('country.allInRegion', { count: neighbours.length + 1 }),
            }}
          >
            <PlaceTiles
              places={neighbours}
              href={(entry) => globalPaths.country(locale, entry.slug)}
              label={t('countryNeighbours', { region: t(`regions.${region}`) })}
              empty={t('countriesEmpty')}
              locale={locale}
              counts={new Map(neighbours.map((entry) => [entry.id, entry.centres]))}
              countText={(count) => t('count.centres', { count })}
            />
          </Section>
        )}
      </DirectoryBody>

      <BreadcrumbData
        contentLocales={placeLocales(country)}
        trail={[
          { name: trail.shellHome, path: localizedPath(name.locale, '') },
          { name: t('title'), path: globalPaths.home(name.locale) },
          { name: t('sections.countries'), path: globalPaths.countries(name.locale) },
          { name: name.text, path: globalPaths.country(name.locale, country.slug) },
        ]}
      />
    </article>
  );
}

/* ===========================================================================
 * /global/countries/{c}/regions/{r}
 * ========================================================================= */

/** A Region: its Cities and its Centres — in it, in its Cities, or serving them. */
export async function RegionPage({
  locale,
  region,
  view,
}: {
  readonly locale: Locale;
  readonly region: PublicRegion;
  readonly view: PlaceView;
}) {
  const [t, hub, trail] = await Promise.all([
    getTranslations({ locale, namespace: 'global' }),
    getTranslations({ locale, namespace: 'topicHub' }),
    globalTrail(locale),
  ]);
  const read = globalReadRuntime();
  const [cities, centres, places, siblings] = await Promise.all([
    read.countryCities(region.country.id, region.id, offsetOfPage(view.cityPage)),
    read.centresIn({
      scope: { countryId: region.country.id, regionId: region.id, cityId: null },
      kind: null,
      offset: offsetOfPage(view.page),
      limit: GLOBAL_PAGE,
    }),
    placesOf(region.country.id),
    read.countryRegions(region.country.id),
  ]);
  const tally = places === null ? null : tallyCentrePlaces(places);
  const news = await localNews(
    places === null ? null : centresAt(places, { regionId: region.id }),
  );
  const name = placeName(region, locale);
  const countryName = placeName(region.country, locale);
  const base = globalPaths.region(locale, region.country.slug, region.slug);
  const others = siblings.filter((entry) => entry.id !== region.id);

  return (
    <article>
      <DirectoryCrumbs
        label={trail.label}
        trail={[
          trail.home,
          trail.global,
          trail.countries,
          {
            href: globalPaths.country(locale, region.country.slug),
            text: countryName.text,
          },
          { text: name.text },
        ]}
      />
      <RecordHeader
        kind={t('centre.region')}
        where={
          <span lang={countryName.locale} dir={directionOf(countryName.locale)}>
            {countryName.text}
          </span>
        }
        name={name.text}
        nameLocale={name.locale}
        figures={placeFigures(
          locale,
          t,
          { cities: cities.total, centres: centres.total },
          { cities: 'region-cities', centres: 'region-centres' },
        )}
        actions={
          <>
            {centres.total === 0 ? null : (
              <ActionLink
                href={finderPlaceHref(globalPaths.finder(locale), {
                  country: region.country.slug,
                  region: region.slug,
                })}
              >
                {t('region.findIn', { region: name.text })}
              </ActionLink>
            )}
            <ShareRecord locale={locale} path={base} title={name.text} />
          </>
        }
      />

      <DirectoryBody>
        <Section id="region-cities" heading={t('region.cities')}>
          <CityPages
            locale={locale}
            cities={cities}
            view={view}
            base={base}
            countrySlug={region.country.slug}
            counts={tally?.cities ?? null}
            label={t('region.cities')}
            empty={t('region.citiesEmpty')}
            t={t}
            hub={hub}
          />
        </Section>

        <Section
          id="region-centres"
          heading={t('sections.centres')}
          intro={t('region.servedNote')}
        >
          <CentreResults
            locale={locale}
            page={centres}
            current={view.page}
            href={(page) => placeHref(base, view, { page })}
            label={t('sections.centres')}
            empty={t('region.centresEmpty')}
            emptyAction={{
              href: globalPaths.country(locale, region.country.slug),
              text: t('region.backToCountry', { country: countryName.text }),
            }}
            t={t}
            hub={hub}
          />
        </Section>

        <LocalActivity
          locale={locale}
          placeName={name.text}
          news={news}
          events={null}
          eventsHref={null}
          t={t}
        />

        {others.length === 0 ? null : (
          <Section
            id="region-siblings"
            heading={t('region.others', { country: countryName.text })}
          >
            <PlaceTiles
              places={others}
              href={(entry) =>
                globalPaths.region(locale, region.country.slug, entry.slug)
              }
              label={t('region.others', { country: countryName.text })}
              empty={t('country.regionsEmpty')}
              locale={locale}
              counts={tally?.regions ?? null}
              countText={(count) => t('count.centres', { count })}
            />
          </Section>
        )}
      </DirectoryBody>

      <BreadcrumbData
        contentLocales={placeLocales(region)}
        trail={[
          { name: trail.shellHome, path: localizedPath(name.locale, '') },
          { name: t('title'), path: globalPaths.home(name.locale) },
          { name: t('sections.countries'), path: globalPaths.countries(name.locale) },
          {
            name: countryName.text,
            path: globalPaths.country(name.locale, region.country.slug),
          },
          {
            name: name.text,
            path: globalPaths.region(name.locale, region.country.slug, region.slug),
          },
        ]}
      />
    </article>
  );
}

/* ===========================================================================
 * /global/countries/{c}/cities/{city}
 * ========================================================================= */

/** How many neighbouring Cities a City page offers. */
const CITY_NEIGHBOURS = 12;

/** A City: the Centres in it OR serving it, each once. */
export async function CityPage({
  locale,
  city,
  view,
}: {
  readonly locale: Locale;
  readonly city: PublicCity;
  readonly view: PlaceView;
}) {
  const [t, hub, trail] = await Promise.all([
    getTranslations({ locale, namespace: 'global' }),
    getTranslations({ locale, namespace: 'topicHub' }),
    globalTrail(locale),
  ]);
  const read = globalReadRuntime();
  const [centres, places, choices] = await Promise.all([
    read.centresIn({
      scope: { countryId: city.country.id, regionId: null, cityId: city.id },
      kind: null,
      offset: offsetOfPage(view.page),
      limit: GLOBAL_PAGE,
    }),
    placesOf(city.country.id),
    read.cityChoices(city.country.id),
  ]);
  const tally = places === null ? null : tallyCentrePlaces(places);
  const [news, events] = await Promise.all([
    localNews(places === null ? null : centresAt(places, { cityId: city.id })),
    centres.total === 0
      ? Promise.resolve(null)
      : localEvents({ countryId: city.country.id, cityId: city.id }),
  ]);
  const name = placeName(city, locale);
  const countryName = placeName(city.country, locale);
  const regionName = city.region === null ? null : placeName(city.region, locale);
  const base = globalPaths.city(locale, city.country.slug, city.slug);
  // The Cities beside it: those of its Region, or with no Region those
  // directly under its Country.
  const nearby = choices
    .filter(
      (entry) => entry.id !== city.id && entry.regionId === (city.region?.id ?? null),
    )
    .slice(0, CITY_NEIGHBOURS);
  const nearbyHome =
    city.region === null
      ? { href: globalPaths.country(locale, city.country.slug), name: countryName }
      : {
          href: globalPaths.region(locale, city.country.slug, city.region.slug),
          name: regionName ?? countryName,
        };

  return (
    <article>
      <DirectoryCrumbs
        label={trail.label}
        trail={[
          trail.home,
          trail.global,
          trail.countries,
          {
            href: globalPaths.country(locale, city.country.slug),
            text: countryName.text,
          },
          ...(city.region === null || regionName === null
            ? []
            : [
                {
                  href: globalPaths.region(locale, city.country.slug, city.region.slug),
                  text: regionName.text,
                },
              ]),
          { text: name.text },
        ]}
      />
      <RecordHeader
        kind={t('centre.city')}
        where={
          <span
            lang={(regionName ?? countryName).locale}
            dir={directionOf((regionName ?? countryName).locale)}
          >
            {regionName === null
              ? countryName.text
              : t('city.where', { region: regionName.text, country: countryName.text })}
          </span>
        }
        name={name.text}
        nameLocale={name.locale}
        figures={placeFigures(
          locale,
          t,
          { centres: centres.total },
          { centres: 'city-centres' },
        )}
        actions={
          <>
            {centres.total === 0 ? null : (
              <ActionLink
                href={finderPlaceHref(globalPaths.finder(locale), {
                  country: city.country.slug,
                  city: city.slug,
                })}
              >
                {t('city.findIn', { city: name.text })}
              </ActionLink>
            )}
            <ShareRecord locale={locale} path={base} title={name.text} />
          </>
        }
      />

      <DirectoryBody>
        <Section
          id="city-centres"
          heading={t('sections.centres')}
          intro={t('city.servedNote')}
        >
          <CentreResults
            locale={locale}
            page={centres}
            current={view.page}
            href={(page) => placeHref(base, view, { page })}
            label={t('sections.centres')}
            empty={t('city.centresEmpty')}
            emptyAction={{
              href: nearbyHome.href,
              text: t('city.backTo', { place: nearbyHome.name.text }),
            }}
            t={t}
            hub={hub}
          />
        </Section>

        <LocalActivity
          locale={locale}
          placeName={name.text}
          news={news}
          events={events}
          eventsHref={eventsListingHref(locale, {
            country: city.country.slug,
            city: city.slug,
          })}
          t={t}
        />

        {nearby.length === 0 ? null : (
          <Section
            id="city-nearby"
            heading={t('city.nearby', { place: nearbyHome.name.text })}
            action={{ href: nearbyHome.href, text: t('city.allNearby') }}
          >
            <PlaceTiles
              places={nearby}
              href={(entry) => globalPaths.city(locale, city.country.slug, entry.slug)}
              label={t('city.nearby', { place: nearbyHome.name.text })}
              empty={t('region.citiesEmpty')}
              locale={locale}
              counts={tally?.cities ?? null}
              countText={(count) => t('count.centres', { count })}
            />
          </Section>
        )}
      </DirectoryBody>

      <BreadcrumbData
        contentLocales={placeLocales(city)}
        trail={[
          { name: trail.shellHome, path: localizedPath(name.locale, '') },
          { name: t('title'), path: globalPaths.home(name.locale) },
          { name: t('sections.countries'), path: globalPaths.countries(name.locale) },
          {
            name: countryName.text,
            path: globalPaths.country(name.locale, city.country.slug),
          },
          {
            name: name.text,
            path: globalPaths.city(name.locale, city.country.slug, city.slug),
          },
        ]}
      />
    </article>
  );
}

/* ===========================================================================
 * /global/pakistan
 * ========================================================================= */

/**
 * The Pakistan structure — an ENTRY POINT into the ordinary Pakistan Country,
 * never a second Pakistan model. It shows the same public Regions and Cities
 * grouped as a structure — one card per Region, its Cities beneath, each
 * counted by its Centres where the page could count exactly — and its
 * canonical address is the Country page (set by the route), so the two never
 * compete. With no published Pakistan record it says so, claiming nothing.
 */
export async function PakistanPage({
  locale,
  country,
}: {
  readonly locale: Locale;
  readonly country: PublicCountry | null;
}) {
  const [t, trail] = await Promise.all([
    getTranslations({ locale, namespace: 'global' }),
    globalTrail(locale),
  ]);
  const read = globalReadRuntime();
  const title = t('sections.pakistan');
  const [directory, regions, cities, places] = await Promise.all([
    read.countryDirectory(),
    country === null ? Promise.resolve([]) : read.countryRegions(country.id),
    country === null ? Promise.resolve([]) : read.cityChoices(country.id),
    country === null ? Promise.resolve(null) : placesOf(country.id),
  ]);
  const totals = directoryTotals(directory);
  const entry =
    country === null
      ? undefined
      : directory.find((candidate) => candidate.id === country.id);
  const tally = places === null ? null : tallyCentrePlaces(places);
  const direct = cities.filter((city) => city.regionId === null);
  const number = numberIn(locale);
  const countText = (count: number) => t('count.centres', { count });
  const counts = {
    regions: entry?.regions ?? regions.length,
    cities: entry?.cities ?? cities.length,
    centres: entry?.centres ?? 0,
  };

  return (
    <Container>
      <div className="flex min-w-0 flex-col gap-8 pt-6 pb-[var(--space-section)]">
        <Breadcrumbs
          label={trail.label}
          trail={[trail.home, trail.global, { text: title }]}
        />
        <ExploreHero
          eyebrow={t('title')}
          title={title}
          lede={t('pakistan.intro')}
          stats={
            country === null
              ? []
              : (['regions', 'cities', 'centres'] as const).flatMap((key) =>
                  counts[key] === 0
                    ? []
                    : [
                        {
                          value: number(counts[key]),
                          label: t(`figures.${key}`, { count: counts[key] }),
                        },
                      ],
                )
          }
          actions={
            country === null
              ? []
              : [
                  ...(counts.centres === 0
                    ? []
                    : [
                        {
                          href: finderPlaceHref(globalPaths.finder(locale), {
                            country: country.slug,
                          }),
                          text: t('pakistan.find'),
                        },
                      ]),
                  {
                    href: globalPaths.country(locale, country.slug),
                    text: t('pakistan.viewCountry'),
                  },
                ]
          }
        />
        <GlobalTabs
          locale={locale}
          current="pakistan"
          countries={totals.countries}
          centres={totals.centres}
          t={t}
        />

        {country === null ? (
          <EmptyState
            icon="map-pin"
            title={t('pakistan.unavailableTitle')}
            action={{ href: globalPaths.countries(locale), text: t('allCountries') }}
          >
            {t('pakistan.unavailable')}
          </EmptyState>
        ) : regions.length === 0 && cities.length === 0 ? (
          <EmptyState
            icon="map-pin"
            title={t('pakistan.emptyTitle')}
            action={{
              href: globalPaths.country(locale, country.slug),
              text: t('pakistan.viewCountry'),
            }}
          >
            {t('pakistan.empty')}
          </EmptyState>
        ) : (
          <>
            {regions.length === 0 ? null : (
              <section aria-labelledby="pakistan-regions" className="flex flex-col gap-5">
                <h2 id="pakistan-regions" className="sr-only">
                  {t('country.regions')}
                </h2>
                <div className="grid grid-cols-1 gap-4 *:min-w-0 sm:grid-cols-2 lg:grid-cols-3">
                  {regions.map((region) => (
                    <PakistanRegion
                      key={region.id}
                      locale={locale}
                      region={region}
                      countrySlug={country.slug}
                      cities={cities.filter((city) => city.regionId === region.id)}
                      centres={tally?.regions.get(region.id) ?? null}
                      counts={tally?.cities ?? null}
                      countText={countText}
                      t={t}
                    />
                  ))}
                </div>
              </section>
            )}
            {direct.length === 0 ? null : (
              <Section id="pakistan-direct" heading={t('country.directCities')}>
                <PlaceTiles
                  places={direct}
                  href={(city) => globalPaths.city(locale, country.slug, city.slug)}
                  label={t('country.directCities')}
                  empty={t('country.citiesEmpty')}
                  locale={locale}
                  counts={tally?.cities ?? null}
                  countText={countText}
                />
              </Section>
            )}
          </>
        )}
      </div>
    </Container>
  );
}

/** One Region of the Pakistan structure: its name, its counts, its Cities. */
function PakistanRegion({
  locale,
  region,
  countrySlug,
  cities,
  centres,
  counts,
  countText,
  t,
}: {
  readonly locale: Locale;
  readonly region: PublicPlace;
  readonly countrySlug: string;
  readonly cities: readonly PublicPlace[];
  readonly centres: number | null;
  readonly counts: ReadonlyMap<string, number> | null;
  readonly countText: (count: number) => string;
  readonly t: GlobalTranslator;
}) {
  const heading = placeName(region, locale);
  const id = `pakistan-${region.id}`;
  return (
    <section
      className="flex flex-col gap-3 rounded-panel border border-border bg-surface-raised p-5"
      aria-labelledby={id}
    >
      <div className="flex flex-col gap-1">
        <h3
          id={id}
          lang={heading.locale}
          dir={directionOf(heading.locale)}
          className="text-subheading font-semibold wrap-anywhere"
        >
          <TextLink href={globalPaths.region(locale, countrySlug, region.slug)}>
            {heading.text}
          </TextLink>
        </h3>
        <p className="text-caption text-foreground-muted tabular-nums">
          {[
            t('count.cities', { count: cities.length }),
            ...(centres === null || centres === 0 ? [] : [countText(centres)]),
          ].join(' · ')}
        </p>
      </div>
      <PlaceTiles
        places={cities}
        href={(city) => globalPaths.city(locale, countrySlug, city.slug)}
        label={heading.text}
        empty={t('region.citiesEmpty')}
        locale={locale}
        counts={counts}
        countText={countText}
        variant="list"
      />
    </section>
  );
}
