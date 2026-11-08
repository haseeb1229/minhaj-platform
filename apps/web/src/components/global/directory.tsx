import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import type { Locale } from '@minhaj/contracts';
import {
  GLOBAL_CHOICES,
  GLOBAL_PAGE,
  globalPaths,
  type PublicCentrePage,
  type PublicCentreSummary,
  type PublicCity,
  type PublicCountry,
  type PublicCountryChoice,
  type PublicPlace,
  type PublicRegion,
} from '@minhaj/contracts/global';

import type { NewsSummary } from '@minhaj/contracts/editorial';

import { editorialReadRuntime } from '@/composition/editorial-read';
import { globalReadRuntime } from '@/composition/global-read';
import { NewsGrid } from '@/components/editorial/news';
import { BreadcrumbData } from '@/components/media/parts';
import {
  ActionLink,
  Alert,
  Breadcrumbs,
  Button,
  CardGrid,
  Container,
  EmptyState,
  Field,
  FilterLink,
  Icon,
  LinkCard,
  PageHero,
  Pager as Pagination,
  Panel,
  SectionHeader,
  Select,
  TextLink,
} from '@/components/ui';
import { directionOf } from '@/config/locale';
import {
  centreWords,
  finderPath,
  latestAcross,
  placeLocales,
  placeName,
  readFinderQuery,
  readOffsetOf,
  withQuery,
} from './presentation';
import { groupByWorldRegion, worldRegionOf } from './world-region';

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
 *
 * ONE FRAME FOR EVERY PAGE. A quiet breadcrumb row, then an opening band — the
 * section pages' `PageHero`, or `RecordHeader` for a place or a Centre, whose
 * name carries its own language — then the body in section rhythm. Places are
 * tiles, Centres are whole-card links, and the way to find a Centre is the
 * first action wherever a place is shown.
 */

type GlobalTranslator = Awaited<ReturnType<typeof getTranslations<'global'>>>;
type Query = Record<string, string | string[] | undefined>;

/** Home / Global Network / … — the trail every directory page starts with. */
async function globalTrail(locale: Locale) {
  const shell = await getTranslations({ locale, namespace: 'shell' });
  const t = await getTranslations({ locale, namespace: 'global' });
  return {
    label: shell('nav.breadcrumbs'),
    home: { href: localizedPath(locale, ''), text: shell('nav.home') },
    global: { href: globalPaths.home(locale), text: t('title') },
    shellHome: shell('nav.home'),
  };
}

function pages(t: GlobalTranslator) {
  return { previousLabel: t('previous'), nextLabel: t('next') };
}

/** The slim breadcrumb row above a directory page's opening band. */
export function DirectoryCrumbs({
  label,
  trail,
}: {
  readonly label: string;
  readonly trail: readonly { readonly href?: string; readonly text: string }[];
}) {
  return (
    <Container>
      <div className="pt-6">
        <Breadcrumbs label={label} trail={trail} />
      </div>
    </Container>
  );
}

/**
 * The opening band of ONE record — a Country, a Region, a City or a Centre.
 *
 * Unlike `PageHero`, the `h1` carries the language and direction the record's
 * name is genuinely in, so an English place name on an Arabic page is marked
 * English (WCAG 3.1.2) without flipping the page around it.
 */
export function RecordHeader({
  kind,
  where,
  name,
  nameLocale,
  children,
}: {
  /** What the record is ("Country", "Centre"), said after its name. */
  readonly kind: string;
  /** Where it sits in the world, when the page knows ("Europe & Central Asia"). */
  readonly where?: string;
  readonly name: string;
  readonly nameLocale: Locale;
  readonly children?: ReactNode;
}) {
  return (
    <div className="border-b border-border">
      <Container>
        <div className="flex max-w-3xl flex-col gap-3 py-[var(--space-section)]">
          <h1
            className="text-title font-semibold tracking-[var(--tracking-display)] text-balance wrap-anywhere"
            lang={nameLocale}
            dir={directionOf(nameLocale)}
          >
            {name}
          </h1>
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-foreground-muted">
            <Icon name="map-pin" size={16} className="text-accent" />
            <span>{kind}</span>
            {where === undefined ? null : (
              <>
                <span aria-hidden="true" className="text-border-strong">
                  ·
                </span>
                <span>{where}</span>
              </>
            )}
          </p>
          {children}
        </div>
      </Container>
    </div>
  );
}

/** A directory page's body, in the system's section rhythm. */
export function DirectoryBody({ children }: { readonly children: ReactNode }) {
  return (
    <Container>
      <div className="flex flex-col gap-[var(--space-section)] py-[var(--space-section)]">
        {children}
      </div>
    </Container>
  );
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
      <ul className="flex list-none flex-wrap gap-2 p-0">
        {entries.map((entry) => (
          <li key={entry.key}>
            <FilterLink href={entry.href} current={entry.key === current}>
              {t(`sections.${entry.key}`)}
            </FilterLink>
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
    <p className="text-caption text-foreground-muted">
      {centre.isVirtual ? (
        <span className="font-semibold text-accent">{t('card.virtual')} · </span>
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

/**
 * One Centre as a whole-card link: its name, its own description where it has
 * one, and where it is — nothing it does not have.
 */
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
  const wordsLocale = words?.locale ?? centre.primaryLocale;
  return (
    <LinkCard
      href={globalPaths.centre(locale, centre.slug)}
      title={words?.name ?? centre.slug}
      {...(words?.description == null ? {} : { description: words.description })}
      lang={wordsLocale}
      dir={directionOf(wordsLocale)}
      meta={<Locality centre={centre} locale={locale} t={t} />}
    />
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
        <CardGrid label={label}>
          {page.items.map((centre) => (
            <CentreCard key={centre.id} centre={centre} locale={locale} t={t} />
          ))}
        </CardGrid>
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

/**
 * A list of place links, or an honest empty state. `tiles` is the directory's
 * browsing shape — each place a bordered tile with a 44-pixel target; `list`
 * is the compact column a Pakistan region card holds.
 */
function PlaceList({
  places,
  href,
  label,
  empty,
  locale,
  variant = 'tiles',
}: {
  readonly places: readonly PublicPlace[];
  readonly href: (place: PublicPlace) => string;
  readonly label: string;
  readonly empty: string;
  readonly locale: Locale;
  readonly variant?: 'tiles' | 'list';
}) {
  if (places.length === 0) return <EmptyState>{empty}</EmptyState>;

  return variant === 'list' ? (
    <ul aria-label={label} className="flex list-none flex-col p-0">
      {places.map((place) => (
        <li key={place.id} className="min-w-0">
          <a
            href={href(place)}
            className="inline-flex min-h-11 items-center text-sm font-medium wrap-anywhere text-action underline-offset-4 hover:underline active:text-action-hover"
          >
            <Name record={place} locale={locale} />
          </a>
        </li>
      ))}
    </ul>
  ) : (
    <ul
      aria-label={label}
      className="grid list-none grid-cols-1 gap-2 p-0 *:min-w-0 min-[30rem]:grid-cols-2 lg:grid-cols-4"
    >
      {places.map((place) => (
        <li key={place.id}>
          <a
            href={href(place)}
            className="flex min-h-11 items-center justify-between gap-3 rounded-control border border-border bg-surface-raised px-4 py-2 text-sm font-medium wrap-anywhere text-foreground no-underline transition-colors duration-[var(--duration-fast)] hover:border-accent hover:bg-accent-surface active:bg-accent-rule"
          >
            <Name record={place} locale={locale} />
            <Icon name="chevron-end" size={16} className="text-accent" />
          </a>
        </li>
      ))}
    </ul>
  );
}

/** A directory section: its header (the `h2` it is labelled by) and its body. */
function Section({
  id,
  heading,
  intro,
  children,
}: {
  readonly id: string;
  readonly heading: string;
  readonly intro?: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-5" aria-labelledby={id}>
      <SectionHeader
        id={id}
        heading={heading}
        {...(intro === undefined ? {} : { intro })}
      />
      {children}
    </section>
  );
}

/** How many Centres a Country page asks for News, and how many items it shows. */
const COUNTRY_NEWS_CENTRES = 6;
const COUNTRY_NEWS = 3;

/**
 * R2 — the newest News from a Country's Centres, composed at Layer 4 from
 * Editorial's own bounded per-Centre read: each Centre's newest few, merged.
 * News names a Centre, never a Country, so this is the only true sense of "a
 * Country's news". `null` — and no section — when the Country has no Centre,
 * more Centres than one page holds (the merge would not be the newest), or
 * Editorial's read failed; the Country page is still true without it.
 */
async function countryNews(
  centres: PublicCentrePage,
): Promise<readonly NewsSummary[] | null> {
  if (
    centres.items.length === 0 ||
    centres.hasMore ||
    centres.items.length > COUNTRY_NEWS_CENTRES
  )
    return null;
  try {
    const pages = await Promise.all(
      centres.items.map((centre) =>
        editorialReadRuntime().centreNews(centre.id, 0, COUNTRY_NEWS),
      ),
    );
    return latestAcross(
      pages.map((page) => page.items),
      COUNTRY_NEWS,
    );
  } catch {
    return null;
  }
}

/* ===========================================================================
 * /global
 * ========================================================================= */

/**
 * Every public Country, grouped by world region (R2): one block per region —
 * its name and how many Countries it holds — then the Countries as tiles. The
 * regions and the counts are the published Countries themselves, nothing more.
 */
function CountriesByRegion({
  countries,
  locale,
  t,
  headingLevel = 'h3',
}: {
  readonly countries: readonly PublicCountryChoice[];
  readonly locale: Locale;
  readonly t: GlobalTranslator;
  readonly headingLevel?: 'h2' | 'h3';
}) {
  const Heading = headingLevel;
  return (
    <div className="flex flex-col gap-8">
      {groupByWorldRegion(countries).map(({ region, countries: members }) => {
        const id = `world-region-${region}`;
        return (
          <section key={region} aria-labelledby={id} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <Heading id={id} className="text-subheading font-semibold text-balance">
                {t(`regions.${region}`)}
              </Heading>
              <span className="text-sm text-foreground-muted tabular-nums">
                {t('regionCount', { count: members.length })}
              </span>
            </div>
            <PlaceList
              places={members}
              href={(country) => globalPaths.country(locale, country.slug)}
              label={t(`regions.${region}`)}
              empty={t('countriesEmpty')}
              locale={locale}
            />
          </section>
        );
      })}
    </div>
  );
}

/**
 * The presence sentence — "present in 39 countries across 6 regions" — or
 * `null` when it could not be stated exactly: no Countries yet, or a list cut
 * at the selector's bound, whose length is not the whole count.
 */
function presenceLine(
  countries: readonly PublicCountryChoice[],
  t: GlobalTranslator,
): string | null {
  if (countries.length === 0 || countries.length >= GLOBAL_CHOICES) return null;
  return t('presence', {
    countries: countries.length,
    regions: groupByWorldRegion(countries).filter((group) => group.region !== 'other')
      .length,
  });
}

/**
 * The World Network landing (R2): the organisation's presence told from the
 * published Countries — how many, across which regions of the world — then the
 * ways into the directory and every Country by region.
 *
 * EVERY WAY IN, ALWAYS. Find a Centre leads the page and the finder, the
 * Countries, the Centres and Pakistan are always offered, as the directory's
 * own entry points. Until a Centre is published, the line above the Countries
 * says plainly that no centre address is published yet, and the finder and the
 * Centre list say so themselves — an honest state, never a hidden door.
 *
 * NOTHING IS INVENTED. The count is the published Countries; no map, flag wall
 * or photograph stands in for data, and the data notice closes the page. Local
 * Events are each Centre's own and are not linked here.
 */
export async function GlobalLandingPage({ locale }: { readonly locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'global' });
  const trail = await globalTrail(locale);
  const [hasCentres, countries] = await Promise.all([
    globalReadRuntime().hasPublicCentres(),
    globalReadRuntime().countryChoices(),
  ]);
  const entries = [
    { key: 'finder', icon: 'search', href: globalPaths.finder(locale) },
    { key: 'countries', icon: 'globe', href: globalPaths.countries(locale) },
    { key: 'centres', icon: 'map-pin', href: globalPaths.centres(locale) },
    { key: 'pakistan', icon: 'grid', href: globalPaths.pakistan(locale) },
  ] as const;
  const presence = presenceLine(countries, t);

  return (
    <>
      <DirectoryCrumbs label={trail.label} trail={[trail.home, { text: t('title') }]} />
      <PageHero
        title={t('title')}
        lede={presence ?? t('intro')}
        actions={
          <>
            <ActionLink href={globalPaths.finder(locale)}>
              {t('sections.finder')}
            </ActionLink>
            {countries.length === 0 ? null : (
              <ActionLink href={globalPaths.countries(locale)} tone="secondary">
                {t('allCountries')}
              </ActionLink>
            )}
          </>
        }
      >
        {hasCentres || countries.length > 0 ? null : (
          <p className="max-w-[var(--measure-prose)] text-sm text-foreground-muted">
            {t('emptyDirectory')}
          </p>
        )}
      </PageHero>

      <DirectoryBody>
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
                <Icon name={entry.icon} size={24} className="mt-0.5 text-accent" />
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
            intro={hasCentres ? t('countriesIntro') : t('presenceNotice')}
            {...(countries.length === 0
              ? {}
              : {
                  action: {
                    href: globalPaths.countries(locale),
                    text: t('allCountries'),
                  },
                })}
          />
          {countries.length === 0 ? (
            <EmptyState>{t('countriesEmpty')}</EmptyState>
          ) : (
            <CountriesByRegion countries={countries} locale={locale} t={t} />
          )}
        </section>

        <p className="max-w-[var(--measure-prose)] text-sm text-foreground-muted">
          {t('dataNotice')}
        </p>
      </DirectoryBody>
    </>
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
    <>
      <DirectoryCrumbs
        label={trail.label}
        trail={[trail.home, trail.global, { text: title }]}
      />
      <PageHero title={title} lede={t('finder.intro')}>
        <GlobalSections locale={locale} current="finder" t={t} />
      </PageHero>

      <DirectoryBody>
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
              <a
                href={base}
                className="inline-flex min-h-11 items-center text-sm font-medium text-action underline underline-offset-2"
              >
                {t('finder.reset')}
              </a>
            </div>
          </form>
        </Panel>

        <Section id="finder-results" heading={t('finder.results')}>
          {result.status === 'invalid' ? (
            <Alert tone="warning">{t('finder.invalid')}</Alert>
          ) : result.inventoryEmpty ? (
            <EmptyState>
              {t('emptyDirectory')}{' '}
              {/* Phase 30-R: the countries of presence remain a way on. */}
              <a
                href={globalPaths.countries(locale)}
                className="inline-flex min-h-11 items-center font-medium text-action underline underline-offset-2"
              >
                {t('allCountries')}
              </a>
            </EmptyState>
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
        </Section>
      </DirectoryBody>
    </>
  );
}

/* ===========================================================================
 * /global/countries and /global/centres
 * ========================================================================= */

/**
 * The public Countries in bounded pages of `GLOBAL_PAGE`, `?offset=` (Phase
 * 16), each page grouped by world region (R2) — so the directory lists EVERY
 * published Country however many there are, never a list cut at a bound.
 */
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
    <>
      <DirectoryCrumbs
        label={trail.label}
        trail={[trail.home, trail.global, { text: title }]}
      />
      <PageHero title={title} lede={t('countriesIntro')}>
        <GlobalSections locale={locale} current="countries" t={t} />
      </PageHero>
      <DirectoryBody>
        <div className="flex flex-col gap-8">
          {page.items.length === 0 ? (
            <EmptyState>{offset > 0 ? t('pageEmpty') : t('countriesEmpty')}</EmptyState>
          ) : (
            <CountriesByRegion
              countries={page.items}
              locale={locale}
              t={t}
              headingLevel="h2"
            />
          )}
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
      </DirectoryBody>
    </>
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
    <>
      <DirectoryCrumbs
        label={trail.label}
        trail={[trail.home, trail.global, { text: title }]}
      />
      <PageHero title={title} lede={t('centresIntro')}>
        <GlobalSections locale={locale} current="centres" t={t} />
      </PageHero>
      <DirectoryBody>
        <div className="flex flex-col gap-6">
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
      </DirectoryBody>
    </>
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
  const [regions, cities, centres, everyCountry] = await Promise.all([
    read.countryRegions(country.id),
    read.countryCities(country.id, 'none', cityOffset),
    read.centresIn({ countryId: country.id, regionId: null, cityId: null }, offset),
    read.countryChoices(),
  ]);
  const name = placeName(country, locale);
  const region = worldRegionOf(country.code);
  const neighbours = everyCountry.filter(
    (entry) => entry.id !== country.id && worldRegionOf(entry.code) === region,
  );
  const news = offset === 0 ? await countryNews(centres) : null;
  const path = globalPaths.country(locale, country.slug);
  // Phase 30-R: a Country of PRESENCE — published, with nothing yet listed
  // beneath it — says so once, plainly, instead of three empty lists, and does
  // not offer a search that can only come back empty.
  const bare =
    offset === 0 &&
    cityOffset === 0 &&
    regions.length === 0 &&
    cities.items.length === 0 &&
    centres.items.length === 0;

  return (
    <article>
      <DirectoryCrumbs
        label={trail.label}
        trail={[
          trail.home,
          trail.global,
          { href: globalPaths.countries(locale), text: t('sections.countries') },
          { text: name.text },
        ]}
      />
      <RecordHeader
        kind={t('centre.country')}
        {...(region === 'other' ? {} : { where: t(`regions.${region}`) })}
        name={name.text}
        nameLocale={name.locale}
      >
        {bare ? (
          <p className="text-lede max-w-[var(--measure-prose)] text-foreground-muted">
            {t('country.presenceOnly')}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          {bare ? (
            <ActionLink href={globalPaths.countries(locale)} tone="secondary">
              {t('allCountries')}
            </ActionLink>
          ) : (
            <ActionLink href={finderPath(locale, { country })}>
              {t('country.findIn', { country: name.text })}
            </ActionLink>
          )}
        </div>
      </RecordHeader>

      {bare ? null : (
        <DirectoryBody>
          {news === null || news.length === 0 ? null : (
            <Section id="country-news" heading={t('countryNews', { country: name.text })}>
              <NewsGrid
                locale={locale}
                items={news}
                label={t('countryNews', { country: name.text })}
                showType
                headingLevel="h3"
                columns={3}
              />
            </Section>
          )}

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
            heading={
              regions.length === 0 ? t('country.cities') : t('country.directCities')
            }
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
        </DirectoryBody>
      )}

      {neighbours.length === 0 || region === 'other' ? null : (
        <DirectoryBody>
          <Section
            id="country-neighbours"
            heading={t('countryNeighbours', { region: t(`regions.${region}`) })}
          >
            <PlaceList
              places={neighbours}
              href={(entry) => globalPaths.country(locale, entry.slug)}
              label={t('countryNeighbours', { region: t(`regions.${region}`) })}
              empty={t('countriesEmpty')}
              locale={locale}
            />
          </Section>
        </DirectoryBody>
      )}

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
    <article>
      <DirectoryCrumbs
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
      <RecordHeader kind={t('centre.region')} name={name.text} nameLocale={name.locale}>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <ActionLink href={finderPath(locale, { country: region.country, region })}>
            {t('region.findIn', { region: name.text })}
          </ActionLink>
        </div>
      </RecordHeader>

      <DirectoryBody>
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
      </DirectoryBody>

      <BreadcrumbData
        contentLocales={placeLocales(region)}
        trail={[
          { name: trail.shellHome, path: localizedPath(name.locale, '') },
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
    <article>
      <DirectoryCrumbs
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
      <RecordHeader kind={t('centre.city')} name={name.text} nameLocale={name.locale}>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <ActionLink href={finderPath(locale, { country: city.country, city })}>
            {t('city.findIn', { city: name.text })}
          </ActionLink>
        </div>
      </RecordHeader>

      <DirectoryBody>
        <Section
          id="city-centres"
          heading={t('sections.centres')}
          intro={t('city.servedNote')}
        >
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
      </DirectoryBody>

      <BreadcrumbData
        contentLocales={placeLocales(city)}
        trail={[
          { name: trail.shellHome, path: localizedPath(name.locale, '') },
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
  );
}

/* ===========================================================================
 * /global/pakistan
 * ========================================================================= */

/**
 * The Pakistan structure — an ENTRY POINT into the ordinary Pakistan Country,
 * never a second Pakistan model. It shows the same public Regions and Cities
 * grouped as a structure — one card per Region, its Cities beneath — and its
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
    <>
      <DirectoryCrumbs
        label={trail.label}
        trail={[trail.home, trail.global, { text: title }]}
      />
      <PageHero
        title={title}
        lede={t('pakistan.intro')}
        {...(country === null
          ? {}
          : {
              actions: (
                <ActionLink
                  href={globalPaths.country(locale, country.slug)}
                  tone="secondary"
                >
                  {t('pakistan.viewCountry')}
                </ActionLink>
              ),
            })}
      >
        <GlobalSections locale={locale} current="pakistan" t={t} />
      </PageHero>

      <DirectoryBody>
        {country === null ? (
          <EmptyState>{t('pakistan.unavailable')}</EmptyState>
        ) : (
          <>
            {regions.length === 0 && cities.length === 0 ? (
              <EmptyState>{t('pakistan.empty')}</EmptyState>
            ) : null}
            {regions.length === 0 ? null : (
              <div className="grid grid-cols-1 gap-4 *:min-w-0 sm:grid-cols-2 lg:grid-cols-3">
                {regions.map((region) => {
                  const inRegion = cities.filter((city) => city.regionId === region.id);
                  const heading = placeName(region, locale);
                  return (
                    <section
                      key={region.id}
                      className="flex flex-col gap-3 rounded-panel border border-border bg-surface-raised p-5"
                      aria-labelledby={`pakistan-${region.id}`}
                    >
                      <h2
                        id={`pakistan-${region.id}`}
                        className="text-subheading font-semibold wrap-anywhere"
                      >
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
                        variant="list"
                      />
                    </section>
                  );
                })}
              </div>
            )}
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
      </DirectoryBody>
    </>
  );
}
