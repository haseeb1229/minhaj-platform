import {
  CENTRE_KINDS,
  GLOBAL_MAX_OFFSET,
  GLOBAL_PAGE,
  globalSlugSchema,
  type CentreKind,
} from '@minhaj/contracts/global';
import {
  EVENT_MAX_OFFSET,
  EVENT_PAGE,
  NEWS_MAX_OFFSET,
  NEWS_PAGE,
  type EventWhen,
} from '@minhaj/contracts/editorial';

import { single, whole, type Query } from '@/components/topic-hub/address';
import { WORLD_REGIONS, type WorldRegion } from './world-region';

/**
 * GLOBAL NETWORK (R2) — THE DIRECTORY'S ADDRESS RULES, pure, so the address a
 * form submits, the address a tab, chip, page or another page's link builds,
 * and what Global is asked are ONE definition, proved by unit test
 * (`tests/global/global-view.test.ts`).
 *
 *   `/global/countries`            `?region` (a world region) · `?page`
 *   `/global/centres`              `?kind=physical|virtual` · `?page`
 *   `/global/find-a-centre`        `?country` · `?region` or `?city` · `?page`
 *   a Country or a Region          `?page` (its Centres) · `?cityPage` (its Cities)
 *   a City · a Centre's News       `?page`
 *   a Centre's Events              `?when=past` · `?page`
 *
 * A directory page is 24 (`GLOBAL_PAGE`); a Centre's News and Events page by
 * Editorial's 20. Neutral values are omitted, so each view has ONE address.
 *
 * TWO POSTURES, KEPT APART ON PURPOSE (the Events listing's, News & Events
 * Part 2).
 *
 *   - A view or a PLACE that cannot mean anything — an unknown world region,
 *     kind or `when`, a malformed place slug, a Region or City without its
 *     Country, a Region AND a City, a repeated value — is REFUSED where it was
 *     asked: the page says so and lists nothing, never quietly everything
 *     (`invalid`). A filter that narrows by place, broadened, would answer a
 *     different question as if it were the one asked.
 *   - Everything else is read tolerantly and, when it is not already the
 *     view's one spelling, answered with ONE redirect: a form's empty
 *     controls, another order of the parameters, a malformed page (dropped),
 *     and Phase 16's `?offset=` (and a place page's `?cities=` offset) — the
 *     page holding the record it began with.
 *
 * TOLERANT, NEVER TRUSTING. A place slug is parsed again by Global's read
 * service, the authoritative boundary, which also decides whether it is public.
 */

/** The deepest page an address may name: Global's offset bound, in pages. */
export const GLOBAL_MAX_PAGE = Math.floor(GLOBAL_MAX_OFFSET / GLOBAL_PAGE) + 1;

/** `base?search`, with no `?` when nothing is set. */
function withSearch(base: string, search: URLSearchParams): string {
  const text = search.toString();
  return text === '' ? base : `${base}?${text}`;
}

/**
 * The canonical address, or `null` when the request already spells it: the
 * page's own parameters as the request carried them, in their own order, so
 * another order is caught.
 */
function unlessAt(
  base: string,
  query: Query,
  keys: ReadonlySet<string>,
  canonical: string,
): string | null {
  const requested = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (!keys.has(key)) continue;
    if (typeof value === 'string') requested.append(key, value);
    else if (Array.isArray(value))
      for (const entry of value) requested.append(key, entry);
  }
  return withSearch(base, requested) === canonical ? null : canonical;
}

/**
 * How a list is paged: its page size and the deepest offset its owner reads.
 * The directory's lists are Global's (24); a Centre's News and Events are
 * Editorial's (20), so a former offset names THEIR page.
 */
export interface Paging {
  readonly size: number;
  readonly maxOffset: number;
}

export const GLOBAL_PAGING: Paging = { size: GLOBAL_PAGE, maxOffset: GLOBAL_MAX_OFFSET };
export const NEWS_PAGING: Paging = { size: NEWS_PAGE, maxOffset: NEWS_MAX_OFFSET };
export const EVENT_PAGING: Paging = { size: EVENT_PAGE, maxOffset: EVENT_MAX_OFFSET };

/** The deepest page a list may name. */
function maxPage(paging: Paging): number {
  return Math.floor(paging.maxOffset / paging.size) + 1;
}

/** A 1-based page parameter, or null. */
function pageOf(
  query: Query,
  key: string,
  paging: Paging = GLOBAL_PAGING,
): number | null {
  return whole(single(query, key, 5), 1, maxPage(paging));
}

/** The page a former offset parameter named — the page holding its first record. */
function legacyPage(
  query: Query,
  key: string,
  paging: Paging = GLOBAL_PAGING,
): number | null {
  const text = single(query, key, 8);
  if (text === null || !/^\d{1,8}$/u.test(text)) return null;
  const offset = Number(text);
  return offset <= paging.maxOffset
    ? Math.min(Math.floor(offset / paging.size) + 1, maxPage(paging))
    : null;
}

/** The read offset of a 1-based page. */
export function offsetOfPage(page: number): number {
  return (page - 1) * GLOBAL_PAGE;
}

/**
 * One strict value: empty is absent; a repeated value is refused (`bad`).
 */
function strictOf(query: Query, key: string): { value: string | null; bad: boolean } {
  const raw = query[key];
  if (raw === undefined || raw === '') return { value: null, bad: false };
  if (typeof raw !== 'string') return { value: null, bad: true };
  return { value: raw, bad: false };
}

/* ===========================================================================
 * /global/countries
 * ========================================================================= */

export interface CountriesView {
  readonly region: WorldRegion | null;
  readonly page: number;
  readonly invalid: boolean;
}

const COUNTRIES_KEYS: ReadonlySet<string> = new Set(['region', 'page', 'offset']);

export function readCountriesView(query: Query): CountriesView {
  const region = strictOf(query, 'region');
  const known =
    region.value === null
      ? null
      : (WORLD_REGIONS as readonly string[]).includes(region.value)
        ? (region.value as WorldRegion)
        : null;
  return {
    region: known,
    page: pageOf(query, 'page') ?? legacyPage(query, 'offset') ?? 1,
    invalid: region.bad || (region.value !== null && known === null),
  };
}

export function countriesHref(
  base: string,
  view: Omit<CountriesView, 'invalid'>,
  change: Partial<Omit<CountriesView, 'invalid'>> = {},
): string {
  const next = { ...view, ...change };
  const page = change.page ?? (Object.keys(change).length === 0 ? view.page : 1);
  const search = new URLSearchParams();
  if (next.region !== null) search.set('region', next.region);
  if (page > 1) search.set('page', String(page));
  return withSearch(base, search);
}

export function countriesCanonicalRedirect(base: string, query: Query): string | null {
  const view = readCountriesView(query);
  if (view.invalid) return null;
  return unlessAt(base, query, COUNTRIES_KEYS, countriesHref(base, view));
}

/* ===========================================================================
 * /global/centres
 * ========================================================================= */

export interface CentresView {
  readonly kind: CentreKind | null;
  readonly page: number;
  readonly invalid: boolean;
}

const CENTRES_KEYS: ReadonlySet<string> = new Set(['kind', 'page', 'offset']);

export function readCentresView(query: Query): CentresView {
  const kind = strictOf(query, 'kind');
  const known =
    kind.value === null
      ? null
      : (CENTRE_KINDS as readonly string[]).includes(kind.value)
        ? (kind.value as CentreKind)
        : null;
  return {
    kind: known,
    page: pageOf(query, 'page') ?? legacyPage(query, 'offset') ?? 1,
    invalid: kind.bad || (kind.value !== null && known === null),
  };
}

export function centresHref(
  base: string,
  view: Omit<CentresView, 'invalid'>,
  change: Partial<Omit<CentresView, 'invalid'>> = {},
): string {
  const next = { ...view, ...change };
  const page = change.page ?? (Object.keys(change).length === 0 ? view.page : 1);
  const search = new URLSearchParams();
  if (next.kind !== null) search.set('kind', next.kind);
  if (page > 1) search.set('page', String(page));
  return withSearch(base, search);
}

export function centresCanonicalRedirect(base: string, query: Query): string | null {
  const view = readCentresView(query);
  if (view.invalid) return null;
  return unlessAt(base, query, CENTRES_KEYS, centresHref(base, view));
}

/* ===========================================================================
 * /global/find-a-centre
 * ========================================================================= */

export interface FinderView {
  readonly country: string | null;
  /** Only with a Country, and never with a City. */
  readonly region: string | null;
  /** Only with a Country, and never with a Region. */
  readonly city: string | null;
  readonly page: number;
  /** A place that cannot mean anything: refused, never broadened. */
  readonly invalid: boolean;
}

const FINDER_KEYS: ReadonlySet<string> = new Set([
  'country',
  'region',
  'city',
  'page',
  'offset',
]);

export function readFinderView(query: Query): FinderView {
  let invalid = false;
  const place = (key: string): string | null => {
    const { value, bad } = strictOf(query, key);
    if (bad) invalid = true;
    if (value === null) return null;
    if (!globalSlugSchema.safeParse(value).success || value !== value.trim()) {
      invalid = true;
      return null;
    }
    return value;
  };
  const country = place('country');
  const region = place('region');
  const city = place('city');
  if ((region !== null || city !== null) && country === null) invalid = true;
  if (region !== null && city !== null) invalid = true;
  return {
    country,
    region: country === null ? null : region,
    city: country === null ? null : city,
    page: pageOf(query, 'page') ?? legacyPage(query, 'offset') ?? 1,
    invalid,
  };
}

/** Whether a place narrows the finder. */
export function finderPlaced(view: FinderView): boolean {
  return view.country !== null;
}

export function finderHref(
  base: string,
  view: Omit<FinderView, 'invalid'>,
  change: Partial<Omit<FinderView, 'invalid'>> = {},
): string {
  const next = { ...view, ...change };
  const page = change.page ?? (Object.keys(change).length === 0 ? view.page : 1);
  const search = new URLSearchParams();
  if (next.country !== null) {
    search.set('country', next.country);
    if (next.region !== null) search.set('region', next.region);
    else if (next.city !== null) search.set('city', next.city);
  }
  if (page > 1) search.set('page', String(page));
  return withSearch(base, search);
}

/** The finder for a place, from its first page — what other pages link with. */
export function finderPlaceHref(
  base: string,
  place: {
    readonly country: string;
    readonly region?: string | null;
    readonly city?: string | null;
  },
): string {
  return finderHref(base, {
    country: place.country,
    region: place.region ?? null,
    city: place.region == null ? (place.city ?? null) : null,
    page: 1,
  });
}

export function finderCanonicalRedirect(base: string, query: Query): string | null {
  const view = readFinderView(query);
  if (view.invalid) return null;
  return unlessAt(base, query, FINDER_KEYS, finderHref(base, view));
}

/** What Global's finder is asked for one view. */
export function finderReadQuery(view: FinderView): Record<string, unknown> {
  return {
    country: view.country,
    region: view.region,
    city: view.city,
    offset: offsetOfPage(view.page),
  };
}

/* ===========================================================================
 * A Country, a Region, a City, a Centre's News
 * ========================================================================= */

export interface PlaceView {
  /** The page of the place's Centres (a Centre's News: of its News). */
  readonly page: number;
  /** The page of a Country's or a Region's Cities. */
  readonly cityPage: number;
}

/**
 * A place page's view. `withCities` is whether the page lists Cities of its
 * own (a Country, a Region); elsewhere `?cityPage` is not one of its
 * parameters and is dropped.
 */
export function readPlaceView(
  query: Query,
  withCities: boolean,
  paging: Paging = GLOBAL_PAGING,
): PlaceView {
  return {
    page: pageOf(query, 'page', paging) ?? legacyPage(query, 'offset', paging) ?? 1,
    cityPage: withCities
      ? (pageOf(query, 'cityPage') ?? legacyPage(query, 'cities') ?? 1)
      : 1,
  };
}

export function placeHref(
  base: string,
  view: PlaceView,
  change: Partial<PlaceView> = {},
): string {
  const next = { ...view, ...change };
  const search = new URLSearchParams();
  if (next.page > 1) search.set('page', String(next.page));
  if (next.cityPage > 1) search.set('cityPage', String(next.cityPage));
  return withSearch(base, search);
}

export function placeCanonicalRedirect(
  base: string,
  query: Query,
  withCities: boolean,
  paging: Paging = GLOBAL_PAGING,
): string | null {
  const keys = new Set(
    withCities ? ['page', 'offset', 'cityPage', 'cities'] : ['page', 'offset'],
  );
  return unlessAt(
    base,
    query,
    keys,
    placeHref(base, readPlaceView(query, withCities, paging)),
  );
}

/* ===========================================================================
 * A Centre's Events
 * ========================================================================= */

export interface CentreEventsView {
  readonly when: EventWhen;
  readonly page: number;
  readonly invalid: boolean;
}

const CENTRE_EVENTS_KEYS: ReadonlySet<string> = new Set(['when', 'page', 'offset']);

export function readCentreEventsView(query: Query): CentreEventsView {
  const when = strictOf(query, 'when');
  return {
    when: when.value === 'past' ? 'past' : 'upcoming',
    page:
      pageOf(query, 'page', EVENT_PAGING) ??
      legacyPage(query, 'offset', EVENT_PAGING) ??
      1,
    invalid:
      when.bad ||
      (when.value !== null && when.value !== 'past' && when.value !== 'upcoming'),
  };
}

export function centreEventsHref(
  base: string,
  view: Omit<CentreEventsView, 'invalid'>,
  change: Partial<Omit<CentreEventsView, 'invalid'>> = {},
): string {
  const next = { ...view, ...change };
  const page = change.page ?? (Object.keys(change).length === 0 ? view.page : 1);
  const search = new URLSearchParams();
  if (next.when === 'past') search.set('when', 'past');
  if (page > 1) search.set('page', String(page));
  return withSearch(base, search);
}

export function centreEventsCanonicalRedirect(base: string, query: Query): string | null {
  const view = readCentreEventsView(query);
  if (view.invalid) return null;
  return unlessAt(base, query, CENTRE_EVENTS_KEYS, centreEventsHref(base, view));
}
