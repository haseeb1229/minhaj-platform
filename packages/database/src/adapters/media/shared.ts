import 'server-only';

import type { Prisma } from '@prisma/client';

import type { Locale } from '@minhaj/contracts';
import type { MediaLabel, VideoPoster } from '@minhaj/contracts/media';
import type { TimedQuranPassage } from '@minhaj/contracts/passage';

/**
 * What the Media adapter's Video, Audio and Photo halves share — refusal mapping,
 * label mapping, date handling and bounds — so the two cannot disagree about
 * what a duplicate slug, a stale version or a SQL `date` means.
 *
 * PACKAGE-INTERNAL. Nothing here is exported from `@minhaj/database`, and none
 * of it is a capability: `Client` is a type the adapter's own transactions use.
 */

export type Client = Prisma.TransactionClient;

export class MediaDataError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

/** Unique keys whose violation means something other than "slug taken". */
const KEY_REASONS: readonly (readonly [string, string])[] = [
  ['Video_provider_providerVideoId_key', 'duplicate-video'],
  ['Video_seriesId_seriesPosition_key', 'duplicate-position'],
  ['PlaylistVideo_playlistId_position_key', 'conflict'],
  ['PlaylistVideo_pkey', 'duplicate-member'],
  ['AudioTrack_seriesId_seriesPosition_key', 'duplicate-position'],
  // A fresh asset is attached to exactly the track it was uploaded for, so
  // meeting this key means two writers raced; neither silently wins.
  ['AudioTrack_assetId_key', 'conflict'],
  // Phase 12, by the same reasoning: a fresh image attaches to exactly the
  // Photo it was uploaded for, and a Gallery's places are rewritten under its
  // claimed version — meeting either key means two writers raced.
  ['Photo_assetId_key', 'conflict'],
  ['GalleryItem_galleryId_position_key', 'conflict'],
  ['GalleryItem_pkey', 'duplicate-member'],
];

/**
 * Structured database refusals, and ONLY those, become domain answers. A
 * duplicate provider identifier is its own answer — telling an operator their
 * slug is taken when it is the video that is already catalogued would send
 * them to fix the wrong field. Everything unrecognised is rethrown and reported
 * as unavailable, never as a rule that was not evaluated.
 */
export function refuse(error: unknown): never {
  if (error instanceof MediaDataError) throw error;
  const known = error as { code?: string; meta?: unknown; message?: string } | null;
  const code = known?.code;
  if (code === 'P2002') {
    const detail = `${JSON.stringify(known?.meta ?? {})} ${known?.message ?? ''}`;
    const reason = KEY_REASONS.find(([key]) => detail.includes(key))?.[1];
    throw new MediaDataError(reason ?? 'duplicate-slug');
  }
  if (code === 'P2025') throw new MediaDataError('conflict');
  if (code === 'P2003' || code === 'P2004') throw new MediaDataError('invalid');
  throw error;
}

export const LABELS = { orderBy: { locale: 'asc' } } as const;

export const PUBLISHED = { state: 'published' } as const;

export const RECENTLY_CHANGED = [{ updatedAt: 'desc' }, { id: 'asc' }] as const;

export const boundedOffset = (value: number) =>
  Math.max(0, Math.min(10_000_000, Math.trunc(value) || 0));

export const bounded = (value: number, max: number) =>
  Math.min(max, Math.max(1, Math.trunc(value) || 1));

/** A batch of identifiers a caller may ask about at once. */
export const TARGET_BATCH = 500;

/**
 * A version no row can hold (`CHECK ([version] > 0)`). An edit that somehow
 * arrived without an expected version conflicts rather than overwriting.
 */
export const UNMATCHABLE_VERSION = 0;

export interface LabelRow {
  readonly locale: string;
  readonly title: string;
  readonly description: string;
}

/** A SQL `date` read back as the `YYYY-MM-DD` it is — never shifted by a zone. */
export function isoDate(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10);
}

export function utcDate(value: string | null): Date | null {
  return value === null ? null : new Date(`${value}T00:00:00.000Z`);
}

export function labelsOf(rows: readonly LabelRow[]): MediaLabel[] {
  return rows.map((row) => ({
    locale: row.locale as Locale,
    title: row.title,
    description: row.description,
  }));
}

/** An administrative text match: the slug or any title. Bounded by the schema. */
export function textMatch(text: string | null): object {
  return text === null
    ? {}
    : {
        OR: [
          { slug: { contains: text } },
          { labels: { some: { title: { contains: text } } } },
        ],
      };
}

/** A Video's speakers, in speaking order. */
export const SPEAKERS = {
  select: { personId: true },
  orderBy: [{ position: 'asc' }, { personId: 'asc' }],
} satisfies Prisma.Video$speakersArgs;

/** Quran Part 8: a Video's passages, in its editor's order. */
export const PASSAGES = {
  select: { surahNumber: true, ayahFrom: true, ayahTo: true, startSeconds: true },
  orderBy: { position: 'asc' },
} satisfies Prisma.Video$quranPassagesArgs;

export interface PassageRow {
  readonly surahNumber: number;
  readonly ayahFrom: number;
  readonly ayahTo: number;
  readonly startSeconds: number | null;
}

/** A stored passage as the citation value it is (Quran Part 8). */
export function passageOf(row: PassageRow): TimedQuranPassage {
  return {
    surah: row.surahNumber,
    ayahFrom: row.ayahFrom,
    ayahTo: row.ayahTo,
    startSeconds: row.startSeconds,
  };
}

/** A Video's poster as a value, or null — the CHECK keeps the three columns together. */
export function posterOf(row: {
  readonly posterAssetId: string | null;
  readonly posterWidth: number | null;
  readonly posterHeight: number | null;
}): VideoPoster | null {
  if (row.posterAssetId === null || row.posterWidth === null || row.posterHeight === null)
    return null;
  return { assetId: row.posterAssetId, width: row.posterWidth, height: row.posterHeight };
}
