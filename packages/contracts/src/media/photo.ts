import { z } from 'zod';

import { localeSchema, type Locale } from '../env/shared.ts';
import {
  mediaIdSchema,
  mediaLabelRules,
  mediaLabelsSchema,
  mediaSlugSchema,
  mediaStateSchema,
  mediaText,
  type MediaLabel,
  type MediaState,
} from './values.ts';

/**
 * Media — Photo, Gallery and GalleryItem (DOMAIN_MODEL.md §11; DELIVERY_PLAN.md
 * Phase 12).
 *
 * THREE SHAPES AND NO MORE. A Photo is one logical photograph: its meaning,
 * its words and its publication are Media's, and its bytes are a Storage
 * `Asset`. A Gallery is a curated, ordered grouping of Photos with its own
 * public address. A GalleryItem is one Photo's place in one Gallery — a typed,
 * ordered, duplicate-free membership with no page, slug or lifecycle of its
 * own. There is no Album, no generic media item, no image aggregate and no
 * polymorphic target: a Gallery holds Photos and nothing else.
 *
 * NO EVENT. A Gallery exists independently. The typed Event↔Gallery association
 * belongs to Phase 14, which owns it once both ends exist (DELIVERY_PLAN.md
 * Phases 13–15); nothing here names an Event, reserves a field for one or
 * classifies a Gallery as an event gallery.
 *
 * NOTHING IS GENERATED OR INFERRED. Alternative text, a caption and a credit
 * are what an operator writes; a date is when the photograph was taken as far
 * as the organisation knows it, to the precision it knows it. None is derived
 * from a filename, from the image's hidden metadata or from the pixels, and an
 * absent one stays absent (SECURITY_BASELINE.md §16.3).
 */

/* ===========================================================================
 * The technical upload contract
 * ========================================================================= */

/**
 * The still-image formats a Photo may be — as SNIFFED and STRUCTURALLY
 * validated by Storage, never as declared.
 *
 * JPEG AND PNG. Every browser the platform supports displays both, Storage
 * validates both without decoding a pixel, and between them they cover
 * photographs and scans. No SVG — an active XML document, not a picture — and
 * no GIF, WebP, AVIF, HEIC, TIFF or RAW until a need arrives with evidence.
 */
export const PHOTO_MEDIA_TYPES = Object.freeze(['image/jpeg', 'image/png'] as const);

/**
 * The ceiling on one photograph uploaded through the administration.
 *
 * A TECHNICAL SAFETY BOUND, NOT A CONTENT POLICY. Sixteen MiB holds a
 * high-quality JPEG from a 24- to 40-megapixel camera and an ordinary PNG scan,
 * and it bounds what a visitor's browser downloads for one image — the file an
 * operator uploads is the file a visitor receives, because no smaller rendition
 * is generated. Storage applies the smaller of this and its own ceiling.
 */
export const PHOTO_UPLOAD_MAX_BYTES = 16 * 1024 * 1024;

/**
 * Bounds on what a photograph's header may DECLARE, refused before its image
 * data is read — the decompression-bomb guard. Forty megapixels is more than
 * any camera the organisation is likely to use at full resolution; sixteen
 * thousand pixels on a side admits a wide panorama. Each is enforced again by a
 * SQL CHECK on the dimensions a Photo records.
 */
export const PHOTO_IMAGE_LIMITS = Object.freeze({
  maxPixels: 40_000_000,
  maxEdge: 16_384,
});

/* ===========================================================================
 * Bounds
 * ========================================================================= */

export const PHOTO_LIMITS = Object.freeze({
  /** Alternative text is a short equivalent, not an essay. */
  altText: 500,
  caption: 1000,
  credit: 200,
  /** How many Photos one Gallery may hold: ten public pages of twenty-four. */
  galleryPhotos: 240,
  /** How many Photos one "add" may name — one administrative page. */
  galleryAdd: 24,
  /** The earliest year a surviving photograph was taken. */
  earliestYear: 1826,
});

/* ===========================================================================
 * Dates — as precise as they are known, and no more
 * ========================================================================= */

/**
 * When a photograph was taken: a YEAR, optionally a month, optionally a day.
 *
 * A PARTIAL DATE, NOT AN INSTANT. An archive photograph is often known only to
 * a year, and recording it as `1989-01-01T00:00:00Z` would state a precision
 * nobody has — and move it across a timezone (DOMAIN_MODEL.md §19.5). It is
 * never derived from when the record was created.
 */
export interface PartialDate {
  readonly year: number;
  readonly month: number | null;
  readonly day: number | null;
}

/** Days in a month of the proleptic Gregorian calendar. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Is this partial date real, and not later than `today`? */
export function validPartialDate(value: PartialDate, today: Date): boolean {
  const { year, month, day } = value;
  if (month === null && day !== null) return false;
  if (month !== null && day !== null && day > daysInMonth(year, month)) return false;
  const thisYear = today.getUTCFullYear();
  const thisMonth = today.getUTCMonth() + 1;
  if (year > thisYear) return false;
  if (year === thisYear && month !== null && month > thisMonth) return false;
  if (
    year === thisYear &&
    month === thisMonth &&
    day !== null &&
    day > today.getUTCDate()
  )
    return false;
  return true;
}

export const partialDateSchema = z
  .object({
    year: z.number().int().min(PHOTO_LIMITS.earliestYear).max(9999),
    month: z.number().int().min(1).max(12).nullable(),
    day: z.number().int().min(1).max(31).nullable(),
  })
  .strict()
  .refine((value) => validPartialDate(value, new Date()), {
    message: 'Not a real date, or later than today.',
  });

/* ===========================================================================
 * Photo
 * ========================================================================= */

/**
 * A Photo's words in one interface locale: its alternative text and its
 * caption, each optional, at least one present.
 *
 * ALTERNATIVE TEXT is what the picture shows, for someone who cannot see it. A
 * CAPTION is what a sighted reader is told beside it. They are different, and
 * neither is generated.
 */
export const photoLabelSchema = z
  .object({
    locale: localeSchema,
    altText: mediaText(PHOTO_LIMITS.altText).min(1).nullable(),
    caption: mediaText(PHOTO_LIMITS.caption).min(1).nullable(),
  })
  .strict()
  .refine((value) => value.altText !== null || value.caption !== null, {
    message: 'A label carries alternative text, a caption, or both.',
  });

export type PhotoLabel = z.infer<typeof photoLabelSchema>;

/**
 * One Photo's metadata and lifecycle, as an operator saves it.
 *
 * THE IMAGE IS NOT HERE. A photograph's file is attached only by uploading it
 * to that Photo (`/api/admin/media/photos/{id}/asset`), which streams it
 * through Storage and records the typed relation once Storage has cleared the
 * exact bytes. No form accepts an asset identifier.
 *
 * NO SLUG. A Photo has no public page of its own (ROUTE_MAP.md §3.9 names none):
 * it is seen in the photograph browse, the archive and its Galleries.
 */
export const photoInputSchema = z
  .object({
    primaryLocale: localeSchema,
    state: mediaStateSchema,
    labels: z
      .array(photoLabelSchema)
      .max(3)
      .refine(
        (labels) => new Set(labels.map((label) => label.locale)).size === labels.length,
        { message: 'One label per locale.' },
      ),
    /** Who took the photograph or holds it, as it should be credited. Descriptive, not a licence. */
    credit: mediaText(PHOTO_LIMITS.credit).min(1).nullable(),
    taken: partialDateSchema.nullable(),
  })
  .strict();

export type PhotoValue = z.output<typeof photoInputSchema>;

/**
 * An administrative directory's filters for Photos: the shared state and text
 * filters, and a GAP — Photos with no image yet, or with no alternative text in
 * any language — so the missing alternatives are found and recorded, not
 * hidden (SECURITY_BASELINE.md §16.3).
 */
export const photoAdminQuerySchema = z
  .object({
    offset: z.number().int().min(0).max(25_000).default(0),
    state: mediaStateSchema.nullable().default(null),
    text: z.string().trim().max(200).nullable().default(null),
    gap: z.enum(['image', 'alt']).nullable().default(null),
  })
  .strict();

export type PhotoAdminQuery = z.infer<typeof photoAdminQuerySchema>;

/**
 * The public archive's filters: a year, and within it a month. A month without
 * a year means nothing and is refused; each only NARROWS the public predicate.
 */
export const photoArchiveQuerySchema = z
  .object({
    offset: z.number().int().min(0).max(25_000).default(0),
    year: z
      .number()
      .int()
      .min(PHOTO_LIMITS.earliestYear)
      .max(9999)
      .nullable()
      .default(null),
    month: z.number().int().min(1).max(12).nullable().default(null),
  })
  .strict()
  .refine((value) => value.month === null || value.year !== null, {
    message: 'A month needs its year.',
  });

export type PhotoArchiveQuery = z.infer<typeof photoArchiveQuerySchema>;

export interface PhotoRecord {
  readonly id: string;
  readonly primaryLocale: Locale;
  readonly state: MediaState;
  readonly labels: readonly PhotoLabel[];
  readonly credit: string | null;
  readonly taken: PartialDate | null;
  /**
   * The Storage asset holding the image, or `null` while none is attached. An
   * identifier only: whether its bytes may be served is decided per request by
   * Media's policy AND Storage's custody.
   */
  readonly assetId: string | null;
  /** The image's DISPLAYED size, recorded with the asset; `null` without one. */
  readonly width: number | null;
  readonly height: number | null;
  readonly version: number;
  readonly updatedAt: Date;
}

export interface PhotoPage {
  readonly items: readonly PhotoRecord[];
  readonly hasMore: boolean;
}

/** One year of the public archive and how many public Photos it holds. */
export interface ArchiveYear {
  readonly year: number;
  readonly photos: number;
}

/** One month of an archive year, where the month is known. */
export interface ArchiveMonth {
  readonly month: number;
  readonly photos: number;
}

/* ===========================================================================
 * Gallery and GalleryItem
 * ========================================================================= */

/**
 * A Gallery as an operator saves it: its address, its words and its
 * lifecycle. Its membership is changed separately, one named change at a time.
 */
export const galleryInputSchema = z
  .object({
    slug: mediaSlugSchema,
    primaryLocale: localeSchema,
    state: mediaStateSchema,
    labels: mediaLabelsSchema,
  })
  .strict()
  .superRefine(mediaLabelRules);

export type GalleryValue = z.output<typeof galleryInputSchema>;

/**
 * One change to a Gallery's ordered membership.
 *
 * NAMED CHANGES, NOT A LIST THE BROWSER SUPPLIES — as for a Playlist. Each is
 * applied to the membership at the version the operator was shown, so a stale
 * page can neither reorder nor drop what somebody else just added. An `add`
 * names at most one administrative page of Photos, appended in the order given.
 */
export const galleryChangeSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal('add'),
      photoIds: z
        .array(mediaIdSchema)
        .min(1)
        .max(PHOTO_LIMITS.galleryAdd)
        .refine((values) => new Set(values).size === values.length),
    })
    .strict(),
  z.object({ op: z.literal('remove'), photoId: mediaIdSchema }).strict(),
  z
    .object({
      op: z.literal('move'),
      photoId: mediaIdSchema,
      direction: z.enum(['first', 'earlier', 'later', 'last']),
    })
    .strict(),
]);

export type GalleryChange = z.infer<typeof galleryChangeSchema>;

export interface GalleryRecord {
  readonly id: string;
  readonly slug: string;
  readonly primaryLocale: Locale;
  readonly state: MediaState;
  readonly labels: readonly MediaLabel[];
  readonly version: number;
  readonly updatedAt: Date;
}

export interface GalleryPage {
  readonly items: readonly GalleryRecord[];
  readonly hasMore: boolean;
}

/**
 * A published Gallery as the public sees it: how many of its Photos are public,
 * and its COVER — the first public Photo in its order. Reordering the Gallery
 * changes the cover; there is no second, separately chosen cover to drift.
 */
export interface PublicGallery extends GalleryRecord {
  readonly photoCount: number;
  readonly cover: PhotoRecord | null;
}

export interface PublicGalleryPage {
  readonly items: readonly PublicGallery[];
  readonly hasMore: boolean;
}

/** A Gallery with its whole ordered membership, any state, for the editor. */
export interface GalleryDetail extends GalleryRecord {
  readonly photos: readonly PhotoRecord[];
}

/**
 * The relation Media's image policy decides on: a Photo's lifecycle state and
 * the ONE asset recorded against it. Read for any Photo, draft included — which
 * is why it lives on the narrow relation port, never on the public reader.
 */
export interface PhotoAssetRelation {
  readonly state: MediaState;
  readonly assetId: string | null;
}

/** One request for a Photo's bytes. Both parts come from the URL; neither grants. */
export interface PhotoAssetRequest {
  readonly photoId: string;
  readonly assetId: string;
}

/* ===========================================================================
 * Pure helpers
 * ========================================================================= */

/**
 * The new ordered membership after one change, or the reason it cannot apply.
 *
 * PURE, so the rule is proved without a database. Adding a Photo already
 * present is a duplicate, never a silent no-op; a change that would pass the
 * bound is `limit`; removing or moving one that is absent is invalid; a move
 * that changes nothing is refused, so a double-click records no change.
 */
export function applyGalleryChange(
  current: readonly string[],
  change: GalleryChange,
): { readonly photoIds: readonly string[] } | { readonly refusal: string } {
  if (change.op === 'add') {
    if (change.photoIds.some((id) => current.includes(id)))
      return { refusal: 'duplicate-member' };
    if (current.length + change.photoIds.length > PHOTO_LIMITS.galleryPhotos)
      return { refusal: 'limit' };
    return { photoIds: [...current, ...change.photoIds] };
  }

  const index = current.indexOf(change.photoId);
  if (index === -1) return { refusal: 'invalid' };
  if (change.op === 'remove')
    return { photoIds: current.filter((id) => id !== change.photoId) };

  const target = {
    first: 0,
    earlier: index - 1,
    later: index + 1,
    last: current.length - 1,
  }[change.direction];
  if (target < 0 || target >= current.length || target === index)
    return { refusal: 'invalid' };
  const rest = current.filter((id) => id !== change.photoId);
  return { photoIds: [...rest.slice(0, target), change.photoId, ...rest.slice(target)] };
}

/**
 * The words a page renders for a Photo: the reader's interface locale, then the
 * Photo's primary locale, then any. The locale travels with each so the markup
 * says which language the text is actually in (WCAG 3.1.2) — and alternative
 * text and caption are resolved INDEPENDENTLY, because a Photo may have an Urdu
 * caption and only English alternative text.
 */
export function photoWords(
  photo: Pick<PhotoRecord, 'labels' | 'primaryLocale'>,
  locale: Locale,
): {
  readonly altText: { readonly text: string; readonly locale: Locale } | null;
  readonly caption: { readonly text: string; readonly locale: Locale } | null;
} {
  const order = [
    ...photo.labels.filter((label) => label.locale === locale),
    ...photo.labels.filter(
      (label) => label.locale === photo.primaryLocale && label.locale !== locale,
    ),
    ...photo.labels.filter(
      (label) => label.locale !== locale && label.locale !== photo.primaryLocale,
    ),
  ];
  const alt = order.find((label) => label.altText !== null);
  const caption = order.find((label) => label.caption !== null);
  return {
    altText: alt?.altText == null ? null : { text: alt.altText, locale: alt.locale },
    caption:
      caption?.caption == null ? null : { text: caption.caption, locale: caption.locale },
  };
}
