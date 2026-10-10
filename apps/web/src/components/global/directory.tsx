import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import type { Locale } from '@minhaj/contracts';
import {
  GLOBAL_PAGE,
  globalPaths,
  type PublicCentrePage,
  type PublicCentreSummary,
  type PublicCity,
  type PublicCountry,
  type PublicPlace,
  type PublicRegion,
} from '@minhaj/contracts/global';

import { globalReadRuntime } from '@/composition/global-read';
import { BreadcrumbData, Pagination } from '@/components/media/parts';
import {
  Alert,
  Breadcrumbs,
  Button,
  Container,
  EmptyState,
  Field,
  PageHeading,
  Panel,
  Prose,
  Select,
  TextLink,
} from '@/components/ui';
import { directionOf } from '@/config/locale';
import {
  centreWords,
  finderPath,
  placeLocales,
  placeName,
  readFinderQuery,
  readOffsetOf,
  withQuery,
} from './presentation';

/**
 * The public Global Network directory (ROUTE_MAP.md §3.9) — Phase 16.
 *
 *   `/global`                                   the World Network landing
 *   `/global/find-a-centre`                     Find a Centre, by geography
 *   `/global/countries`                         public Countries
 *   `/global/countries/{c}`                     a Country: Regions, direct Cities, Centres
 *   `/global/countries/{c}/regions/{r}`         a Region: its Cities and Centres
 *   `/global/countries/{c}/cities/{city}`       a City: Centres in it OR serving it
 *   `/global/centres`                           every public Centre
 *   `/global/pakistan`                          the Pakistan structure entry point
 *
 * SERVER COMPONENTS, SESSION-FREE BY CONSTRUCTION. Every read goes through
 * `@/composition/global-read`, which reaches no Identity, session, cookie or
 * personal location. The same knowledge renders signed in or out.
 *
 * NOTHING IS INVENTED. Until OPEN_DECISIONS.md §6.2 is closed the directory may
 * be empty, and it says so plainly: no map, no flag wall, no count, no stock
 * photograph and no placeholder Centre stands in for data the organisation has
 * not confirmed. A missing translation stays missing and is marked by language.
 */

type GlobalTranslator = Awaited<ReturnType<typeof getTranslations<'global'>>>;
type Query = Record<string, string | string[] | undefined>;

/** Home / Global Network / … — the trail every directory page starts with. */
async function globalTrail(locale: Locale) {
  const shell = await getTranslations({ locale, namespace: 'shell' });
  const t = await getTranslations({ locale, namespace: 'global' });
  return {
    label: shell('nav.breadcrumbs'),
    home: { href: `/${locale}`, text: shell('nav.home') },
    global: { href: globalPaths.home(locale), text: t('title') },
    shellHome: shell('nav.home'),
  };
}

function pages(t: GlobalTranslator) {
  return { previousLabel: t('previous'), nextLabel: t('next') };
}

/** A name in the language it is genuinely in. */
function Name({
  record,
  locale,
}: {
  readonly record: PublicPlace;
  readonly locale: Locale;
}) {
  const name = placeName(record, locale);
  return (
    <span lang={name.locale} dir={directionOf(name.locale)}>
      {name.text}
    </span>
  );
}

/** The Global sections, as a small navigation of their own. */
export function GlobalSections({
  locale,
  current,
  t,
}: {
  readonly locale: Locale;
  readonly current: 'home' | 'finder' | 'countries' | 'centres' | 'pakistan' | null;
  readonly t: GlobalTranslator;
}) {
  const entries = [
    { key: 'home', href: globalPaths.home(locale) },
    { key: 'finder', href: globalPaths.finder(locale) },
    { key: 'countries', href: globalPaths.countries(locale) },
    { key: 'centres', href: globalPaths.centres(locale) },
    { key: 'pakistan', href: globalPaths.pakistan(locale) },
  ] as const;
  return (
    <nav aria-label={t('sectionsLabel')}>
      <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {entries.map((entry) => (
          <li key={entry.key}>
            {entry.key === current ? (
              <span aria-current="page" className="font-semibold">
                {t(`sections.${entry.key}`)}
              </span>
            ) : (
              <TextLink href={entry.href}>{t(`sections.${entry.key}`)}</TextLink>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Where a Centre is, in words: its City, its Region and its Country — or virtual. */
function Locality({
  centre,
  locale,
  t,
}: {
  readonly centre: PublicCentreSummary;
  readonly locale: Locale;
  readonly t: GlobalTranslator;
}) {
  const parts = [centre.city, centre.region, centre.country].filter(
    (part): part is PublicPlace => part !== null,
  );
  return (
    <p className="text-sm text-[color:var(--color-foreground-muted)]">
      {centre.isVirtual ? (
        <span className="font-medium">{t('card.virtual')} · </span>
      ) : null}
      {parts.map((part, index) => (
        <span key={part.id}>
          {index > 0 ? ', ' : null}
          <Name record={part} locale={locale} />
        </span>
      ))}
    </p>
  );
}

/** One Centre card: its name, where it is, and nothing it does not have. */
function CentreCard({
  centre,
  locale,
  t,
}: {
  readonly centre: PublicCentreSummary;
  readonly locale: Locale;
  readonly t: GlobalTranslator;
}) {
  const words = centreWords(centre, locale);
  return (
    <Panel as="li">
      <article className="flex min-w-0 flex-col gap-2">
        <h3 className="text-lg font-semibold wrap-anywhere">
          <TextLink href={globalPaths.centre(locale, centre.slug)}>
            <span
              lang={words?.locale ?? centre.primaryLocale}
              dir={directionOf(words?.locale ?? centre.primaryLocale)}
            >
              {words?.name ?? centre.slug}
            </span>
          </TextLink>
        </h3>
        <Locality centre={centre} locale={locale} t={t} />
      </article>
    </Panel>
  );
}

/** A page of Centre cards with its own pagination, or an honest empty state. */
function CentreList({
  page,
  offset,
  path,
  empty,
  label,
  locale,
  t,
}: {
  readonly page: PublicCentrePage;
  readonly offset: number;
  readonly path: (offset: number) => string;
  readonly empty: string;
  readonly label: string;
  readonly locale: Locale;
  readonly t: GlobalTranslator;
}) {
  return (
    <>
      {page.items.length === 0 ? (
        <EmptyState>{offset > 0 ? t('pageEmpty') : empty}</EmptyState>
      ) : (
        <ul
          aria-label={label}
          className="grid gap-4 *:min-w-0 sm:grid-cols-2 lg:grid-cols-3"
        >
          {page.items.map((centre) => (
            <CentreCard key={centre.id} centre={centre} locale={locale} t={t} />
          ))}
        </ul>
      )}
      <Pagination
        label={label}
        previous={offset > 0 ? path(Math.max(0, offset - GLOBAL_PAGE)) : null}
        next={page.hasMore ? path(offset + GLOBAL_PAGE) : null}
        {...pages(t)}
      />
    </>
  );
}

/** A list of place links, or an honest empty state. */
function PlaceList({
  places,
  href,
  label,
  empty,
  locale,
}: {
  readonly places: readonly PublicPlace[];
  readonly href: (place: PublicPlace) => string;
  readonly label: string;
  readonly empty: string;
  readonly locale: Locale;
}) {
  return places.length === 0 ? (
    <EmptyState>{empty}</EmptyState>
  ) : (
    <ul aria-label={label} className="grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
      {places.map((place) => (
        <li key={place.id} className="min-w-0 wrap-anywhere">
          <TextLink href={href(place)}>
            <Name record={place} locale={locale} />
          </TextLink>
        </li>
      ))}
    </ul>
  );
}

function Section({
  id,
  heading,
  children,
}: {
  readonly id: string;
  readonly heading: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4" aria-labelledby={id}>
      <h2 id={id} className="text-xl font-semibold">
        {heading}
      </h2>
      {children}
    </section>
  );
}

/* ===========================================================================
 * /global
 * ========================================================================= */

/**
 * The World Network landing: the genuine entry points and, where the directory
 * is still empty, a plain statement that it is — never a map, a count or a
 * picture standing in for data. Local Events are Phase 14's and are not linked.
 */
export async function GlobalLandingPage({ locale }: { readonly locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'global' });
  const trail = await globalTrail(locale);
  const [hasCentres, countries] = await Promise.all([
    globalReadRuntime().hasPublicCentres(),
    globalReadRuntime().countries(0),
  ]);
  const entries = [
    { key: 'finder', href: globalPaths.finder(locale) },
    { key: 'countries', href: globalPaths.countries(locale) },
    { key: 'centres', href: globalPaths.centres(locale) },
    { key: 'pakistan', href: globalPaths.pakistan(locale) },
  ] as const;

  return (
    <Container>
      <div className="flex flex-col gap-10 py-12">
        <Breadcrumbs label={trail.label} trail={[trail.home, { text: t('title') }]} />
        <Prose>
          <PageHeading>{t('title')}</PageHeading>
          <p>{t('intro')}</p>
        </Prose>
        <GlobalSections locale={locale} current="home" t={t} />
        {hasCentres ? null : <Alert tone="info">{t('emptyDirectory')}</Alert>}

        <ul aria-label={t('entryPoints')} className="grid gap-4 *:min-w-0 sm:grid-cols-2">
          {entries.map((entry) => (
            <Panel key={entry.key} as="li">
              <div className="flex flex-col gap-2">
                <h2 className="text-lg font-semibold">
                  <TextLink href={entry.href}>{t(`sections.${entry.key}`)}</TextLink>
                </h2>
                <p className="text-sm text-[color:var(--color-foreground-muted)]">
                  {t(`landing.${entry.key}`)}
                </p>
              </div>
            </Panel>
          ))}
          <Panel as="li">
            <div className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold">{t('landing.localTitle')}</h2>
              <p className="text-sm text-[color:var(--color-foreground-muted)]">
                {t('landing.localBody')}
              </p>
            </div>
          </Panel>
        </ul>

        <Section id="global-countries" heading={t('sections.countries')}>
          <PlaceList
            places={countries.items}
            href={(country) => globalPaths.country(locale, country.slug)}
            label={t('sections.countries')}
            empty={t('countriesEmpty')}
            locale={locale}
          />
          {countries.hasMore ? (
            <p>
              <TextLink href={globalPaths.countries(locale)}>
                {t('allCountries')}
              </TextLink>
            </p>
          ) : null}
        </Section>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('dataNotice')}
        </p>
      </div>
    </Container>
  );
}

/* ===========================================================================
 * /global/find-a-centre
 * ========================================================================= */

/**
 * Find a Centre — a GET form over the public geography, server-rendered and
 * bounded. Choosing a Country reloads its Regions and Cities; a Region or a
 * City narrows within it. Three outcomes are told apart: the directory is
 * empty, nothing matches, or the filter names nothing public. No location is
 * read from the browser or the network address, and nothing is sorted by
 * distance.
 */
export async function FinderPage({
  locale,
  query,
}: {
  readonly locale: Locale;
  readonly query: Query;
}) {
  const t = await getTranslations({ locale, namespace: 'global' });
  const trail = await globalTrail(locale);
  const filters = readFinderQuery(query);
  const read = globalReadRuntime();
  const [result, countries] = await Promise.all([
    read.find(filters),
    read.countryChoices(),
  ]);
  const country =
    filters.country === null
      ? null
      : (countries.find((entry) => entry.slug === filters.country) ?? null);
  const [regions, cities] =
    country === null
      ? [[], []]
      : await Promise.all([
          read.countryRegions(country.id),
          read.cityChoices(country.id),
        ]);
  const base = globalPaths.finder(locale);
  const title = t('sections.finder');

  return (
    <Container>
      <div className="flex flex-col gap-8 py-12">
        <Breadcrumbs
          label={trail.label}
          trail={[trail.home, trail.global, { text: title }]}
        />
        <Prose>
          <PageHeading>{title}</PageHeading>
          <p>{t('finder.intro')}</p>
        </Prose>
        <GlobalSections locale={locale} current="finder" t={t} />

        <Panel>
          <form
            method="get"
            action={base}
            className="flex flex-col gap-4"
            aria-label={t('finder.form')}
          >
            <div className="grid gap-4 md:grid-cols-3">
              <Field id="finder-country" label={t('finder.country')}>
                {(props) => (
                  <Select {...props} name="country" defaultValue={filters.country ?? ''}>
                    <option value="">{t('finder.anyCountry')}</option>
                    {countries.map((entry) => {
                      const name = placeName(entry, locale);
                      return (
                        <option key={entry.id} value={entry.slug} lang={name.locale}>
                          {name.text}
                        </option>
                      );
                    })}
                  </Select>
                )}
              </Field>
              <Field
                id="finder-region"
                label={t('finder.region')}
                {...(country === null ? { help: t('finder.chooseCountry') } : {})}
              >
                {(props) => (
                  <Select
                    {...props}
                    name="region"
                    defaultValue={filters.region ?? ''}
                    disabled={country === null || regions.length === 0}
                  >
                    <option value="">{t('finder.anyRegion')}</option>
                    {regions.map((entry) => {
                      const name = placeName(entry, locale);
                      return (
                        <option key={entry.id} value={entry.slug} lang={name.locale}>
                          {name.text}
                        </option>
                      );
                    })}
                  </Select>
                )}
              </Field>
              <Field
                id="finder-city"
                label={t('finder.city')}
                help={t('finder.regionOrCity')}
              >
                {(props) => (
                  <Select
                    {...props}
                    name="city"
                    defaultValue={filters.city ?? ''}
                    disabled={country === null || cities.length === 0}
                  >
                    <option value="">{t('finder.anyCity')}</option>
                    {cities.map((entry) => {
                      const name = placeName(entry, locale);
                      return (
                        <option key={entry.id} value={entry.slug} lang={name.locale}>
                          {name.text}
                        </option>
                      );
                    })}
                  </Select>
                )}
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <Button type="submit">{t('finder.submit')}</Button>
              <TextLink href={base}>{t('finder.reset')}</TextLink>
            </div>
          </form>
        </Panel>

        <section className="flex flex-col gap-4" aria-labelledby="finder-results">
          <h2 id="finder-results" className="text-xl font-semibold">
            {t('finder.results')}
          </h2>
          {result.status === 'invalid' ? (
            <Alert tone="warning">{t('finder.invalid')}</Alert>
          ) : result.inventoryEmpty ? (
            <EmptyState>{t('emptyDirectory')}</EmptyState>
          ) : (
            <CentreList
              page={result.page}
              offset={filters.offset}
              path={(offset) =>
                withQuery(base, {
                  country: filters.country,
                  region: filters.region,
                  city: filters.city,
                  offset,
                })
              }
              empty={t('finder.noMatch')}
              label={t('finder.results')}
              locale={locale}
              t={t}
            />
          )}
        </section>
      </div>
    </Container>
  );
}

/* ===========================================================================
 * /global/countries and /global/centres
 * ========================================================================= */

export async function CountriesPage({
  locale,
  query,
}: {
  readonly locale: Locale;
  readonly query: Query;
}) {
  const t = await getTranslations({ locale, namespace: 'global' });
  const trail = await globalTrail(locale);
  const offset = readOffsetOf(query, 'offset');
  const page = await globalReadRuntime().countries(offset);
  const base = globalPaths.countries(locale);
  const title = t('sections.countries');

  return (
    <Container>
      <div className="flex flex-col gap-8 py-12">
        <Breadcrumbs
          label={trail.label}
          trail={[trail.home, trail.global, { text: title }]}
        />
        <Prose>
          <PageHeading>{title}</PageHeading>
          <p>{t('countriesIntro')}</p>
        </Prose>
        <GlobalSections locale={locale} current="countries" t={t} />
        <PlaceList
          places={page.items}
          href={(country) => globalPaths.country(locale, country.slug)}
          label={title}
          empty={offset > 0 ? t('pageEmpty') : t('countriesEmpty')}
          locale={locale}
        />
        <Pagination
          label={title}
          previous={
            offset > 0
              ? withQuery(base, { offset: Math.max(0, offset - GLOBAL_PAGE) })
              : null
          }
          next={page.hasMore ? withQuery(base, { offset: offset + GLOBAL_PAGE }) : null}
          {...pages(t)}
        />
      </div>
    </Container>
  );
}

export async function CentresPage({
  locale,
  query,
}: {
  readonly locale: Locale;
  readonly query: Query;
}) {
  const t = await getTranslations({ locale, namespace: 'global' });
  const trail = await globalTrail(locale);
  const offset = readOffsetOf(query, 'offset');
  const page = await globalReadRuntime().centresIn(
    { countryId: null, regionId: null, cityId: null },
    offset,
  );
  const base = globalPaths.centres(locale);
  const title = t('sections.centres');

  return (
    <Container>
      <div className="flex flex-col gap-8 py-12">
        <Breadcrumbs
          label={trail.label}
          trail={[trail.home, trail.global, { text: title }]}
        />
        <Prose>
          <PageHeading>{title}</PageHeading>
          <p>{t('centresIntro')}</p>
        </Prose>
        <GlobalSections locale={locale} current="centres" t={t} />
        <CentreList
          page={page}
          offset={offset}
          path={(next) => withQuery(base, { offset: next })}
          empty={t('emptyDirectory')}
          label={title}
          locale={locale}
          t={t}
        />
      </div>
    </Container>
  );
}

/* ===========================================================================
 * /global/countries/{c} · /regions/{r} · /cities/{city}
 * ========================================================================= */

/**
 * A Country: its Regions where it has any, the Cities directly under it (those
 * in a Region are on the Region's page), and its Centres. A Country with no
 * Region is ordinary, and nothing here implies it should have one.
 */
export async function CountryPage({
  locale,
  country,
  query,
}: {
  readonly locale: Locale;
  readonly country: PublicCountry;
  readonly query: Query;
}) {
  const t = await getTranslations({ locale, namespace: 'global' });
  const trail = await globalTrail(locale);
  const offset = readOffsetOf(query, 'offset');
  const cityOffset = readOffsetOf(query, 'cities');
  const read = globalReadRuntime();
  const [regions, cities, centres] = await Promise.all([
    read.countryRegions(country.id),
    read.countryCities(country.id, 'none', cityOffset),
    read.centresIn({ countryId: country.id, regionId: null, cityId: null }, offset),
  ]);
  const name = placeName(country, locale);
  const path = globalPaths.country(locale, country.slug);

  return (
    <Container>
      <article className="flex flex-col gap-10 py-12">
        <Breadcrumbs
          label={trail.label}
          trail={[
            trail.home,
            trail.global,
            { href: globalPaths.countries(locale), text: t('sections.countries') },
            { text: name.text },
          ]}
        />
        <Prose>
          <h1
            className="text-3xl font-semibold tracking-tight wrap-anywhere"
            lang={name.locale}
            dir={directionOf(name.locale)}
          >
            {name.text}
          </h1>
          <p>
            <TextLink href={finderPath(locale, { country })}>
              {t('country.findIn', { country: name.text })}
            </TextLink>
          </p>
        </Prose>

        {regions.length === 0 ? null : (
          <Section id="country-regions" heading={t('country.regions')}>
            <PlaceList
              places={regions}
              href={(region) => globalPaths.region(locale, country.slug, region.slug)}
              label={t('country.regions')}
              empty={t('country.regionsEmpty')}
              locale={locale}
            />
          </Section>
        )}

        <Section
          id="country-cities"
          heading={regions.length === 0 ? t('country.cities') : t('country.directCities')}
        >
          <PlaceList
            places={cities.items}
            href={(city) => globalPaths.city(locale, country.slug, city.slug)}
            label={t('country.cities')}
            empty={cityOffset > 0 ? t('pageEmpty') : t('country.citiesEmpty')}
            locale={locale}
          />
          <Pagination
            label={t('country.cities')}
            previous={
              cityOffset > 0
                ? withQuery(path, {
                    offset,
                    cities: Math.max(0, cityOffset - GLOBAL_PAGE),
                  })
                : null
            }
            next={
              cities.hasMore
                ? withQuery(path, { offset, cities: cityOffset + GLOBAL_PAGE })
                : null
            }
            {...pages(t)}
          />
        </Section>

        <Section id="country-centres" heading={t('sections.centres')}>
          <CentreList
            page={centres}
            offset={offset}
            path={(next) => withQuery(path, { offset: next, cities: cityOffset })}
            empty={t('country.centresEmpty')}
            label={t('sections.centres')}
            locale={locale}
            t={t}
          />
        </Section>

        <BreadcrumbData
          contentLocales={placeLocales(country)}
          trail={[
            { name: trail.shellHome, path: `/${name.locale}` },
            { name: t('title'), path: globalPaths.home(name.locale) },
            { name: t('sections.countries'), path: globalPaths.countries(name.locale) },
            { name: name.text, path: globalPaths.country(name.locale, country.slug) },
          ]}
        />
      </article>
    </Container>
  );
}

/** A Region: its Cities and its Centres — in it, in its Cities, or serving them. */
export async function RegionPage({
  locale,
  region,
  query,
}: {
  readonly locale: Locale;
  readonly region: PublicRegion;
  readonly query: Query;
}) {
  const t = await getTranslations({ locale, namespace: 'global' });
  const trail = await globalTrail(locale);
  const offset = readOffsetOf(query, 'offset');
  const cityOffset = readOffsetOf(query, 'cities');
  const read = globalReadRuntime();
  const [cities, centres] = await Promise.all([
    read.countryCities(region.country.id, region.id, cityOffset),
    read.centresIn(
      { countryId: region.country.id, regionId: region.id, cityId: null },
      offset,
    ),
  ]);
  const name = placeName(region, locale);
  const countryName = placeName(region.country, locale);
  const path = globalPaths.region(locale, region.country.slug, region.slug);

  return (
    <Container>
      <article className="flex flex-col gap-10 py-12">
        <Breadcrumbs
          label={trail.label}
          trail={[
            trail.home,
            trail.global,
            {
              href: globalPaths.country(locale, region.country.slug),
              text: countryName.text,
            },
            { text: name.text },
          ]}
        />
        <Prose>
          <h1
            className="text-3xl font-semibold tracking-tight wrap-anywhere"
            lang={name.locale}
            dir={directionOf(name.locale)}
          >
            {name.text}
          </h1>
          <p>
            <TextLink href={finderPath(locale, { country: region.country, region })}>
              {t('region.findIn', { region: name.text })}
            </TextLink>
          </p>
        </Prose>

        <Section id="region-cities" heading={t('region.cities')}>
          <PlaceList
            places={cities.items}
            href={(city) => globalPaths.city(locale, region.country.slug, city.slug)}
            label={t('region.cities')}
            empty={cityOffset > 0 ? t('pageEmpty') : t('region.citiesEmpty')}
            locale={locale}
          />
          <Pagination
            label={t('region.cities')}
            previous={
              cityOffset > 0
                ? withQuery(path, {
                    offset,
                    cities: Math.max(0, cityOffset - GLOBAL_PAGE),
                  })
                : null
            }
            next={
              cities.hasMore
                ? withQuery(path, { offset, cities: cityOffset + GLOBAL_PAGE })
                : null
            }
            {...pages(t)}
          />
        </Section>

        <Section id="region-centres" heading={t('sections.centres')}>
          <CentreList
            page={centres}
            offset={offset}
            path={(next) => withQuery(path, { offset: next, cities: cityOffset })}
            empty={t('region.centresEmpty')}
            label={t('sections.centres')}
            locale={locale}
            t={t}
          />
        </Section>

        <BreadcrumbData
          contentLocales={placeLocales(region)}
          trail={[
            { name: trail.shellHome, path: `/${name.locale}` },
            { name: t('title'), path: globalPaths.home(name.locale) },
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
    </Container>
  );
}

/** A City: the Centres in it OR serving it, each once. */
export async function CityPage({
  locale,
  city,
  query,
}: {
  readonly locale: Locale;
  readonly city: PublicCity;
  readonly query: Query;
}) {
  const t = await getTranslations({ locale, namespace: 'global' });
  const trail = await globalTrail(locale);
  const offset = readOffsetOf(query, 'offset');
  const centres = await globalReadRuntime().centresIn(
    { countryId: city.country.id, regionId: null, cityId: city.id },
    offset,
  );
  const name = placeName(city, locale);
  const countryName = placeName(city.country, locale);
  const regionName = city.region === null ? null : placeName(city.region, locale);
  const path = globalPaths.city(locale, city.country.slug, city.slug);

  return (
    <Container>
      <article className="flex flex-col gap-10 py-12">
        <Breadcrumbs
          label={trail.label}
          trail={[
            trail.home,
            trail.global,
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
        <Prose>
          <h1
            className="text-3xl font-semibold tracking-tight wrap-anywhere"
            lang={name.locale}
            dir={directionOf(name.locale)}
          >
            {name.text}
          </h1>
          <p>
            <TextLink href={finderPath(locale, { country: city.country, city })}>
              {t('city.findIn', { city: name.text })}
            </TextLink>
          </p>
        </Prose>

        <Section id="city-centres" heading={t('sections.centres')}>
          <p className="text-sm text-[color:var(--color-foreground-muted)]">
            {t('city.servedNote')}
          </p>
          <CentreList
            page={centres}
            offset={offset}
            path={(next) => withQuery(path, { offset: next })}
            empty={t('city.centresEmpty')}
            label={t('sections.centres')}
            locale={locale}
            t={t}
          />
        </Section>

        <BreadcrumbData
          contentLocales={placeLocales(city)}
          trail={[
            { name: trail.shellHome, path: `/${name.locale}` },
            { name: t('title'), path: globalPaths.home(name.locale) },
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
    </Container>
  );
}

/* ===========================================================================
 * /global/pakistan
 * ========================================================================= */

/**
 * The Pakistan structure — an ENTRY POINT into the ordinary Pakistan Country,
 * never a second Pakistan model. It shows the same public Regions and Cities
 * grouped as a structure, and its canonical address is the Country page (set
 * by the route), so the two never compete. With no published Pakistan record
 * it says so, claiming nothing.
 */
export async function PakistanPage({
  locale,
  country,
}: {
  readonly locale: Locale;
  readonly country: PublicCountry | null;
}) {
  const t = await getTranslations({ locale, namespace: 'global' });
  const trail = await globalTrail(locale);
  const title = t('sections.pakistan');
  const read = globalReadRuntime();
  const [regions, cities] =
    country === null
      ? [[], []]
      : await Promise.all([
          read.countryRegions(country.id),
          read.cityChoices(country.id),
        ]);
  const direct = cities.filter((city) => city.regionId === null);

  return (
    <Container>
      <div className="flex flex-col gap-8 py-12">
        <Breadcrumbs
          label={trail.label}
          trail={[trail.home, trail.global, { text: title }]}
        />
        <Prose>
          <PageHeading>{title}</PageHeading>
          <p>{t('pakistan.intro')}</p>
        </Prose>
        <GlobalSections locale={locale} current="pakistan" t={t} />
        {country === null ? (
          <EmptyState>{t('pakistan.unavailable')}</EmptyState>
        ) : (
          <>
            <p>
              <TextLink href={globalPaths.country(locale, country.slug)}>
                {t('pakistan.viewCountry')}
              </TextLink>
            </p>
            {regions.length === 0 && cities.length === 0 ? (
              <EmptyState>{t('pakistan.empty')}</EmptyState>
            ) : null}
            {regions.map((region) => {
              const inRegion = cities.filter((city) => city.regionId === region.id);
              const heading = placeName(region, locale);
              return (
                <section
                  key={region.id}
                  className="flex flex-col gap-3"
                  aria-labelledby={`pakistan-${region.id}`}
                >
                  <h2 id={`pakistan-${region.id}`} className="text-xl font-semibold">
                    <TextLink
                      href={globalPaths.region(locale, country.slug, region.slug)}
                    >
                      <span lang={heading.locale} dir={directionOf(heading.locale)}>
                        {heading.text}
                      </span>
                    </TextLink>
                  </h2>
                  <PlaceList
                    places={inRegion}
                    href={(city) => globalPaths.city(locale, country.slug, city.slug)}
                    label={heading.text}
                    empty={t('region.citiesEmpty')}
                    locale={locale}
                  />
                </section>
              );
            })}
            {direct.length === 0 ? null : (
              <Section id="pakistan-direct" heading={t('country.directCities')}>
                <PlaceList
                  places={direct}
                  href={(city) => globalPaths.city(locale, country.slug, city.slug)}
                  label={t('country.directCities')}
                  empty={t('country.citiesEmpty')}
                  locale={locale}
                />
              </Section>
            )}
          </>
        )}
      </div>
    </Container>
  );
}
