import {
  GALLERY_DIRECTORY_PAGE,
  GALLERY_DIRECTORY_SORTS,
  PHOTO_LIMITS,
  PHOTO_LISTING_PAGE,
  PHOTO_LISTING_SORTS,
  PHOTO_MAX_OFFSET,
  type GalleryDirectorySort,
  type PhotoListingSort,
} from '@minhaj/contracts/media';

import {
  hubHref,
  identifier,
  single,
  unlessCanonical,
  whole,
  type Query,
} from '@/components/topic-hub/address';

/**
 * NEWS & EVENTS PART 2 — THE PHOTOGRAPH SURFACES' ADDRESS RULES, pure, so the
 * address a filter form submits, the address a chip, a tab, a page or a link
 * from another page builds, and the query Media is asked are ONE definition,
 * proved by unit test (`tests/media/photos-view.test.ts`). The tolerant
 * readers and the one-address rule are the topic hubs' shared ones
 * (`@/components/topic-hub/address`).
 *
 *   `/media/photos`            `?year`, `?month` (of the date taken, a month
 *                              only with its year), `?gallery` (a Gallery's
 *                              identifier), `?language`, `?sort=newest|oldest`
 *                              (by the date taken; recently added is the
 *                              default) and `?page`;
 *   `/media/galleries`         `?sort=oldest|title` and `?page`;
 *   `/media/galleries/{slug}`  `?page`;
 *   `/media/archive`           `?year` — an index; its records are the
 *                              listing's.
 *
 * Neutral values are omitted, so every unfiltered view has exactly one
 * address. THE FORMER SPELLINGS ARE ONE REDIRECT EACH: Phase 12's `?offset=`
 * (24 a page, as now) is the page holding the photograph it began with, and
 * the archive's former `?month` and `?offset` lead to the listing for the
 * period they described, by the date taken as the archive was.
 *
 * TOLERANT, NEVER TRUSTING. A malformed or repeated parameter is dropped
 * rather than answered with an error page; what this produces is parsed again
 * by Media's read service, the authoritative boundary, and no parameter can
 * widen what is public.
 */

export const PHOTOS_PATH = '/media/photos';
export const GALLERIES_PATH = '/media/galleries';
export const MEDIA_ARCHIVE_PATH = '/media/archive';

/** The deepest page an address may name: Media's offset bound, in pages. */
export const PHOTOS_MAX_PAGE = Math.floor(PHOTO_MAX_OFFSET / PHOTO_LISTING_PAGE) + 1;

const LANGUAGES = ['en', 'ur', 'ar'] as const;
type PhotoLanguage = (typeof LANGUAGES)[number];

export interface PhotosView {
  /** Of the date taken. */
  readonly year: number | null;
  /** Only with a year. */
  readonly month: number | null;
  /** A Gallery identifier, in lower case. */
  readonly gallery: string | null;
  /** A locale the photograph is described in. */
  readonly language: PhotoLanguage | null;
  readonly sort: PhotoListingSort;
  /** 1-based. */
  readonly page: number;
}

export const DEFAULT_PHOTOS_VIEW: PhotosView = Object.freeze({
  year: null,
  month: null,
  gallery: null,
  language: null,
  sort: 'added',
  page: 1,
});

function yearOf(query: Query): number | null {
  const text = single(query, 'year', 4);
  return text !== null && /^\d{4}$/u.test(text)
    ? whole(text, PHOTO_LIMITS.earliestYear, 9999)
    : null;
}

function monthOf(query: Query): number | null {
  const text = single(query, 'month', 2);
  return text !== null && /^\d{1,2}$/u.test(text) ? whole(text, 1, 12) : null;
}

/**
 * The page a former `?offset=` named — the page holding the first item it
 * showed — or null when there is none or it is not a plain bounded number.
 */
function legacyPage(query: Query, size: number): number | null {
  const text = single(query, 'offset', 6);
  if (text === null || !/^\d{1,6}$/u.test(text)) return null;
  const offset = Number(text);
  return offset <= PHOTO_MAX_OFFSET
    ? Math.min(Math.floor(offset / size) + 1, PHOTOS_MAX_PAGE)
    : null;
}

function pageOf(query: Query, size: number): number {
  return (
    whole(single(query, 'page', 5), 1, PHOTOS_MAX_PAGE) ?? legacyPage(query, size) ?? 1
  );
}

/* ===========================================================================
 * /media/photos
 * ========================================================================= */

/** The listing's view from its address — every unknown or malformed value neutral. */
export function readPhotosView(query: Query): PhotosView {
  const year = yearOf(query);
  const language = single(query, 'language', 4);
  const sort = single(query, 'sort', 16);
  return {
    year,
    month: year === null ? null : monthOf(query),
    gallery: identifier(query, 'gallery'),
    language: LANGUAGES.find((code) => code === language) ?? null,
    sort: PHOTO_LISTING_SORTS.find((entry) => entry === sort) ?? 'added',
    page: pageOf(query, PHOTO_LISTING_PAGE),
  };
}

/** Whether anything narrows the listing. An order is not a narrowing. */
export function photosFiltered(view: PhotosView): boolean {
  return view.year !== null || view.gallery !== null || view.language !== null;
}

/**
 * The address of a view. Changing anything but the page returns to the first
 * page, and a month goes with its year. Identifiers are written in lower
 * case, as an address reads them, so a link never costs a redirect.
 */
export function photosHref(
  locale: string,
  view: PhotosView,
  change: Partial<PhotosView> = {},
): string {
  const next = { ...view, ...change };
  const page = change.page ?? (Object.keys(change).length === 0 ? view.page : 1);
  const search = new URLSearchParams();
  if (next.year !== null) search.set('year', String(next.year));
  if (next.year !== null && next.month !== null) search.set('month', String(next.month));
  if (next.gallery !== null) search.set('gallery', next.gallery.toLowerCase());
  if (next.language !== null) search.set('language', next.language);
  if (next.sort !== 'added') search.set('sort', next.sort);
  if (page > 1) search.set('page', String(page));
  return hubHref(locale, PHOTOS_PATH, search);
}

/** A view of the listing from its unfiltered first page — what every other page links. */
export function photosListingHref(
  locale: string,
  change: Partial<Omit<PhotosView, 'page'>> = {},
): string {
  return photosHref(locale, { ...DEFAULT_PHOTOS_VIEW, ...change, page: 1 });
}

const PHOTOS_KEYS: ReadonlySet<string> = new Set([
  'year',
  'month',
  'gallery',
  'language',
  'sort',
  'page',
  'offset',
]);

/**
 * ONE ADDRESS PER VIEW. A filter form submits every control, so choosing a
 * year arrives as `?year=1995&month=&gallery=&language=&sort=added`; a typed or
 * old link may carry a malformed value, `?offset=` or another order of the
 * same parameters. Each is answered with ONE redirect to the view's canonical
 * address, built from the parsed view — never from the typed text — or `null`
 * when the request already is that address.
 */
export function photosCanonicalRedirect(locale: string, query: Query): string | null {
  return unlessCanonical(
    locale,
    PHOTOS_PATH,
    query,
    PHOTOS_KEYS,
    photosHref(locale, readPhotosView(query)),
  );
}

/** What Media is asked for one view. */
export function photosReadQuery(view: PhotosView): Record<string, unknown> {
  return {
    year: view.year,
    month: view.month,
    gallery: view.gallery,
    language: view.language,
    sort: view.sort,
    offset: (view.page - 1) * PHOTO_LISTING_PAGE,
    limit: PHOTO_LISTING_PAGE,
  };
}

/* ===========================================================================
 * /media/galleries
 * ========================================================================= */

export interface GalleriesView {
  readonly sort: GalleryDirectorySort;
  /** 1-based. */
  readonly page: number;
}

export function readGalleriesView(query: Query): GalleriesView {
  const sort = single(query, 'sort', 16);
  return {
    sort: GALLERY_DIRECTORY_SORTS.find((entry) => entry === sort) ?? 'newest',
    page: pageOf(query, GALLERY_DIRECTORY_PAGE),
  };
}

export function galleriesHref(
  locale: string,
  view: GalleriesView,
  change: Partial<GalleriesView> = {},
): string {
  const next = { ...view, ...change };
  const page = change.page ?? (change.sort === undefined ? view.page : 1);
  const search = new URLSearchParams();
  if (next.sort !== 'newest') search.set('sort', next.sort);
  if (page > 1) search.set('page', String(page));
  return hubHref(locale, GALLERIES_PATH, search);
}

const GALLERIES_KEYS: ReadonlySet<string> = new Set(['sort', 'page', 'offset']);

export function galleriesCanonicalRedirect(locale: string, query: Query): string | null {
  return unlessCanonical(
    locale,
    GALLERIES_PATH,
    query,
    GALLERIES_KEYS,
    galleriesHref(locale, readGalleriesView(query)),
  );
}

/** What Media is asked for one page of the directory, titles sorted in the reader's language. */
export function galleriesReadQuery(
  view: GalleriesView,
  locale: string,
): Record<string, unknown> {
  return {
    sort: view.sort,
    titleLocale: locale,
    offset: (view.page - 1) * GALLERY_DIRECTORY_PAGE,
    limit: GALLERY_DIRECTORY_PAGE,
  };
}

/* ===========================================================================
 * /media/galleries/{slug}
 * ========================================================================= */

/** A Gallery's photographs come 24 to a page, in its own order. */
export function readGalleryPage(query: Query): number {
  return pageOf(query, PHOTO_LISTING_PAGE);
}

export function galleryPageHref(locale: string, slug: string, page: number): string {
  const search = new URLSearchParams();
  if (page > 1) search.set('page', String(page));
  return hubHref(locale, `${GALLERIES_PATH}/${encodeURIComponent(slug)}`, search);
}

const GALLERY_KEYS: ReadonlySet<string> = new Set(['page', 'offset']);

export function galleryCanonicalRedirect(
  locale: string,
  slug: string,
  query: Query,
): string | null {
  return unlessCanonical(
    locale,
    `${GALLERIES_PATH}/${encodeURIComponent(slug)}`,
    query,
    GALLERY_KEYS,
    galleryPageHref(locale, slug, readGalleryPage(query)),
  );
}

/* ===========================================================================
 * /media/archive
 * ========================================================================= */

/** The archive's one view: every year, or the months of one. */
export interface MediaArchiveView {
  readonly year: number | null;
}

export function readMediaArchiveView(query: Query): MediaArchiveView {
  return { year: yearOf(query) };
}

export function mediaArchiveHref(locale: string, year: number | null = null): string {
  const search = new URLSearchParams();
  if (year !== null) search.set('year', String(year));
  return hubHref(locale, MEDIA_ARCHIVE_PATH, search);
}

/**
 * The listing for one archive period, by the date taken, latest first — as the
 * archive itself listed it until this part.
 */
export function periodHref(locale: string, year: number, month: number | null): string {
  return photosListingHref(locale, { year, month, sort: 'newest' });
}

const ARCHIVE_KEYS: ReadonlySet<string> = new Set(['year', 'month', 'offset']);

/**
 * ONE ADDRESS PER ARCHIVE VIEW. Until this part the archive listed the
 * photographs itself, by `?year`, `?month` and `?offset`; it is now the index
 * of years and months, and each period's photographs live in the listing. So a
 * former month, or a former page of a year, is ONE redirect to the listing for
 * that period; any other spelling is one redirect to the archive's year (or
 * every year).
 */
export function mediaArchiveCanonicalRedirect(
  locale: string,
  query: Query,
): string | null {
  const year = yearOf(query);
  const month = year === null ? null : monthOf(query);
  const offset = single(query, 'offset', 6);
  if (year !== null && (month !== null || offset !== null)) {
    const page = legacyPage(query, PHOTO_LISTING_PAGE) ?? 1;
    return photosHref(locale, {
      ...DEFAULT_PHOTOS_VIEW,
      year,
      month,
      sort: 'newest',
      page,
    });
  }
  return unlessCanonical(
    locale,
    MEDIA_ARCHIVE_PATH,
    query,
    ARCHIVE_KEYS,
    mediaArchiveHref(locale, year),
  );
}
