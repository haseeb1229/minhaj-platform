import { z } from 'zod';

/**
 * Editorial's optional LEAD IMAGE and SOURCE CHRONOLOGY (Phase 30-R, an owner
 * decision superseding the Phase-13 "no image" rule).
 *
 * A module of its own so the families' shapes (`values.ts`) and News's read
 * models (`news.ts`) can both name it without depending on each other.
 */

/**
 * The families that may carry ONE lead image: an Article, a Page, a
 * NewsArticle and a PressRelease. A Statement, MediaCoverage, Event and
 * Collection never do — their schemas refuse the field.
 */
export const EDITORIAL_LEAD_FAMILIES = Object.freeze([
  'article',
  'page',
  'news-article',
  'press-release',
] as const);
export type EditorialLeadFamily = (typeof EDITORIAL_LEAD_FAMILIES)[number];

/**
 * The families that record the ORIGINAL publication date their source states:
 * an Article, a NewsArticle and a PressRelease. That date — when present — is
 * the record's reader-facing chronology; the platform's own `publishedAt`
 * stays the workflow fact it always was.
 */
export const EDITORIAL_DATED_FAMILIES = Object.freeze([
  'article',
  'news-article',
  'press-release',
] as const);

export function isEditorialLeadFamily(value: string): value is EditorialLeadFamily {
  return (EDITORIAL_LEAD_FAMILIES as readonly string[]).includes(value);
}
export function hasLeadImage(kind: string): boolean {
  return isEditorialLeadFamily(kind);
}
export function hasSourceDate(kind: string): boolean {
  return (EDITORIAL_DATED_FAMILIES as readonly string[]).includes(kind);
}

/** The pixel bound of a stored still image (Storage's image limits). */
export const LEAD_IMAGE_MAX_EDGE = 16_384;

/**
 * A lead image: an APPLICATION-OWNED stored Asset — never a remote address —
 * with its measured box, so a page reserves its space and never shifts, and a
 * credit only where one is genuinely known. Whether the asset is a servable
 * still image is Storage's answer, asked by the service; the bytes are served
 * only through Editorial's own route, and only for a published record.
 */
export const editorialLeadImageSchema = z.strictObject({
  assetId: z.uuid(),
  width: z.number().int().min(1).max(LEAD_IMAGE_MAX_EDGE),
  height: z.number().int().min(1).max(LEAD_IMAGE_MAX_EDGE),
  credit: z.string().trim().min(1).max(200).nullable(),
});
export type EditorialLeadImage = z.infer<typeof editorialLeadImageSchema>;

/**
 * The latest calendar date that is already TODAY somewhere: UTC plus fourteen
 * hours, the furthest-ahead zone. A source dated "today" in Lahore or Auckland
 * is never refused as future-dated; anything later is.
 */
export function latestPlausibleDate(now: Date = new Date()): string {
  return new Date(now.getTime() + 14 * 3_600_000).toISOString().slice(0, 10);
}

/** A source's own publication date: a calendar date, never in the future. */
export const sourcePublishedOnSchema = z.iso
  .date()
  .refine((value) => value <= latestPlausibleDate(), {
    message: 'A source date cannot be in the future.',
  });

/**
 * A published lead image, as a page needs it: WHICH record's (so the address
 * names its owner), which stored asset, its measured box and its credit. The
 * alternative text is per translation (`leadAlt`).
 */
export interface PublicLeadImage {
  readonly family: EditorialLeadFamily;
  readonly recordId: string;
  readonly assetId: string;
  readonly width: number;
  readonly height: number;
  readonly credit: string | null;
}

/** The public address of a published lead image, served by Editorial's own route. */
export function leadImagePath(image: {
  readonly family: EditorialLeadFamily;
  readonly recordId: string;
  readonly assetId: string;
}): string {
  return `/assets/editorial/${image.family}/${encodeURIComponent(image.recordId)}/${encodeURIComponent(image.assetId)}`;
}

/** The ADMINISTRATIVE preview address of a lead image on a record's current revision. */
export function leadImagePreviewPath(image: {
  readonly family: EditorialLeadFamily;
  readonly recordId: string;
  readonly assetId: string;
}): string {
  return `/assets/editorial/previews/${image.family}/${encodeURIComponent(image.recordId)}/${encodeURIComponent(image.assetId)}`;
}
