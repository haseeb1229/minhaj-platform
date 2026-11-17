import { z } from 'zod';

import { localeSchema, type Locale } from '../env/shared.ts';
import { PHOTO_LIMITS, type PhotoRecord, type PublicGallery } from './photo.ts';
import { MEDIA_PAGE, mediaIdSchema, type MediaLabel } from './values.ts';

/**
 * NEWS & EVENTS PART 2 — THE PHOTOGRAPHS, AS THEIR PUBLIC PAGES READ THEM
 * (DOMAIN_MODEL.md §11; ROUTE_MAP.md §3.9): `/media/photos` with counted
 * filters, a total for numbered pages and three orders; the Galleries'
 * directory with a total and each Gallery's span of dates; and the archive's
 * counted years and months.
 *
 * THE ORDINARY PUBLIC PREDICATE THROUGHOUT. A Photo is listed or counted only
 * while it is published; a Gallery is named, filtered by or counted only while
 * it is published and holds a public Photo. A filter only ever NARROWS that
 * predicate; none can widen it.
 *
 * DATES ARE THE DATES TAKEN, AS KNOWN. A year and a month are the Photo's own
 * recorded `taken` values — never when a record was made, uploaded or
 * published. A Photo with no known date is listed in every view no date
 * narrows, and in the date orders it follows every dated one.
 *
 * GALLERIES ARE NAMED HERE, A WHOLE FACET AT ONCE, because Media owns them; a
 * language is a code the interface names.
 */

/** One page of the photographs listing and of a Gallery's photographs. */
export const PHOTO_LISTING_PAGE = MEDIA_PAGE;

/** One page of the Galleries' directory. */
export const GALLERY_DIRECTORY_PAGE = MEDIA_PAGE;

/** A facet names at most this many Galleries, the fullest first. */
export const PHOTO_FACET_PAGE = 50;

/** The deepest offset a public listing accepts. */
export const PHOTO_MAX_OFFSET = 25_000;

/** How many archive periods one read may answer: every month of five centuries. */
export const PHOTO_ARCHIVE_PERIODS = 500 * 13;

/**
 * The listing's orders: the most recently ADDED first (the default — creation
 * order, never presented as a date), or by the date TAKEN, the latest or the
 * earliest first. In both date orders a Photo known only to its year follows
 * that year's dated months, and an undated Photo follows every dated one.
 */
export const PHOTO_LISTING_SORTS = Object.freeze(['added', 'newest', 'oldest'] as const);
export const photoListingSortSchema = z.enum(PHOTO_LISTING_SORTS);
export type PhotoListingSort = z.infer<typeof photoListingSortSchema>;

const takenYearSchema = z.number().int().min(PHOTO_LIMITS.earliestYear).max(9999);

/**
 * One view of every published Photo. `year` and `month` are of the date taken,
 * a month only with its year; `gallery` names a PUBLISHED Gallery the Photo is
 * in; `language` a locale the Photo is described in (alternative text or a
 * caption written in it).
 */
export const photoListingQuerySchema = z
  .strictObject({
    year: takenYearSchema.nullable().default(null),
    month: z.number().int().min(1).max(12).nullable().default(null),
    gallery: mediaIdSchema.nullable().default(null),
    language: localeSchema.nullable().default(null),
    sort: photoListingSortSchema.default('added'),
    offset: z.number().int().min(0).max(PHOTO_MAX_OFFSET).default(0),
    limit: z.number().int().min(1).max(PHOTO_LISTING_PAGE).default(PHOTO_LISTING_PAGE),
  })
  .refine((query) => query.month === null || query.year !== null, {
    message: 'A month needs its year.',
    path: ['month'],
  });
export type PhotoListingQuery = z.infer<typeof photoListingQuerySchema>;

export interface PhotoListingPage {
  readonly items: readonly PhotoRecord[];
  /** How many published Photos the view admits in all. */
  readonly total: number;
  readonly hasMore: boolean;
}

/** A published Gallery as a facet names it: its address, titles and count. */
export interface PhotoGalleryCount {
  readonly id: string;
  readonly slug: string;
  readonly primaryLocale: Locale;
  readonly labels: readonly MediaLabel[];
  readonly photos: number;
}

/**
 * The listing's aggregates.
 *
 *   `all`        every published Photo, never narrowed: how many, how many are
 *                dated, the first and last year taken, how many languages
 *                describe them, how many Galleries are listed and how many
 *                Photos those hold;
 *   the rest     each value with how many Photos choosing it would show UNDER
 *                EVERY OTHER FILTER, its own left out (a year's facet leaves
 *                out the month as well). `months` only once a year is chosen.
 */
export interface PhotoListingFacets {
  readonly all: {
    readonly photos: number;
    readonly dated: number;
    readonly firstYear: number | null;
    readonly lastYear: number | null;
    readonly languages: number;
    readonly galleries: number;
    readonly inGalleries: number;
  };
  readonly years: readonly { readonly year: number; readonly photos: number }[];
  readonly months: readonly { readonly month: number; readonly photos: number }[];
  readonly galleries: {
    readonly items: readonly PhotoGalleryCount[];
    readonly hasMore: boolean;
  };
  readonly languages: readonly { readonly code: Locale; readonly photos: number }[];
}

/**
 * One period of the archive: a year and a month taken, or the year alone
 * (`month` null) for the Photos known only to their year.
 */
export interface PhotoArchivePeriod {
  readonly year: number;
  readonly month: number | null;
  readonly photos: number;
}

/**
 * The Galleries' orders: the most recently ADDED first (the default), the
 * earliest added first, or by title in `titleLocale` where a Gallery has one,
 * else in its own language.
 */
export const GALLERY_DIRECTORY_SORTS = Object.freeze([
  'newest',
  'oldest',
  'title',
] as const);
export const galleryDirectorySortSchema = z.enum(GALLERY_DIRECTORY_SORTS);
export type GalleryDirectorySort = z.infer<typeof galleryDirectorySortSchema>;

/** One page of the LISTED Galleries — published, holding a public Photo. */
export const galleryDirectoryQuerySchema = z.strictObject({
  sort: galleryDirectorySortSchema.default('newest'),
  titleLocale: localeSchema.nullable().default(null),
  offset: z.number().int().min(0).max(PHOTO_MAX_OFFSET).default(0),
  limit: z
    .number()
    .int()
    .min(1)
    .max(GALLERY_DIRECTORY_PAGE)
    .default(GALLERY_DIRECTORY_PAGE),
});
export type GalleryDirectoryQuery = z.infer<typeof galleryDirectoryQuerySchema>;

export interface GalleryDirectoryPage {
  readonly items: readonly PublicGallery[];
  /** How many Galleries are listed in all. */
  readonly total: number;
  readonly hasMore: boolean;
}
