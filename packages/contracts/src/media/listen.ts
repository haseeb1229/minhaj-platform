import { z } from 'zod';

import { localeSchema, type Locale } from '../env/shared.ts';
import type { AudioTrackListing } from './audio.ts';
import {
  MEDIA_LIMITS,
  MEDIA_PAGE,
  mediaIdSchema,
  mediaLanguageCodeSchema,
  topicVideoLengthSchema,
  type MediaLabel,
  type TopicVideoLength,
} from './values.ts';

/**
 * WATCH PART 3 — LISTEN, AS ITS PUBLIC PAGES READ IT (DOMAIN_MODEL.md §8.1,
 * §11): the audio lectures listing with its counted filters, the audio series'
 * directory and summaries, and a track's place in its series.
 *
 * NON-QURAN AUDIO ONLY, as every AudioTrack is. Quran recitations are Quran's
 * and never appear in any answer here.
 *
 * THE ORDINARY PUBLIC PREDICATE THROUGHOUT. Only a published AudioTrack is
 * listed, counted or summed; an AudioSeries is named, filtered by or counted
 * only while it is itself published, and a series' figures are those of its
 * PUBLISHED tracks — nothing is stored twice and nothing is inferred.
 *
 * PEOPLE AND TAXONOMY ARE NAMED AT LAYER 4. Media answers identifiers — a
 * speaker is a People identifier, a Topic a Taxonomy one, a language a code —
 * and every name is resolved by its owner, a whole page at once.
 */

/** One page of the audio lectures listing. */
export const AUDIO_LISTING_PAGE = MEDIA_PAGE;

/** The listing's orders: the most recently recorded first, or by title. */
export const AUDIO_LISTING_SORTS = Object.freeze(['newest', 'title'] as const);
export const audioListingSortSchema = z.enum(AUDIO_LISTING_SORTS);
export type AudioListingSort = z.infer<typeof audioListingSortSchema>;

/**
 * One view of every published AudioTrack: each filter NARROWS the public
 * predicate and none can widen it. A length is a recorded running time's band
 * (`TOPIC_VIDEO_LENGTHS` — one definition for video and audio); a title is
 * sorted in `titleLocale` where the track has one, else in its own language.
 */
export const audioListingQuerySchema = z
  .object({
    topic: mediaIdSchema.nullable().default(null),
    language: mediaLanguageCodeSchema.nullable().default(null),
    speaker: mediaIdSchema.nullable().default(null),
    series: mediaIdSchema.nullable().default(null),
    length: topicVideoLengthSchema.nullable().default(null),
    sort: audioListingSortSchema.default('newest'),
    titleLocale: localeSchema.nullable().default(null),
    offset: z.number().int().min(0).max(25_000).default(0),
    limit: z.number().int().min(1).max(AUDIO_LISTING_PAGE).default(AUDIO_LISTING_PAGE),
  })
  .strict();
export type AudioListingQuery = z.infer<typeof audioListingQuerySchema>;

/** An identifier and how many published AudioTracks it holds or names. */
export interface AudioCount {
  readonly id: string;
  readonly tracks: number;
}

/** The PUBLISHED AudioSeries a listed track sits in, and its place there. */
export interface AudioTrackSeries {
  readonly id: string;
  readonly slug: string;
  readonly primaryLocale: Locale;
  readonly labels: readonly MediaLabel[];
  readonly position: number;
}

/** One listed track: a row's worth, and its series while that is published. */
export interface AudioListingTrack extends AudioTrackListing {
  readonly series: AudioTrackSeries | null;
}

export interface AudioListingPage {
  readonly items: readonly AudioListingTrack[];
  /** How many published tracks the view admits in all. */
  readonly total: number;
  readonly hasMore: boolean;
}

/** A facet's values, commonest first (at most `MEDIA_FACET_PAGE`), and whether more exist. */
export interface AudioFacet {
  readonly items: readonly AudioCount[];
  readonly hasMore: boolean;
}

/** A published AudioSeries as a facet names it: its address, titles and count. */
export interface AudioSeriesCount extends AudioCount {
  readonly slug: string;
  readonly primaryLocale: Locale;
  readonly labels: readonly MediaLabel[];
}

/** The audio series facet: published series only, commonest first. */
export interface AudioSeriesFacet {
  readonly items: readonly AudioSeriesCount[];
  readonly hasMore: boolean;
}

/**
 * The listing's aggregates. `all` is the whole of Listen — every published
 * track, never narrowed by a filter: how many, their recorded running time and
 * how many content languages. Each facet counts the tracks choosing its value
 * would show UNDER EVERY OTHER FILTER, its own left out.
 */
export interface AudioListingFacets {
  readonly all: {
    readonly tracks: number;
    readonly seconds: number;
    readonly languages: number;
  };
  readonly topics: AudioFacet;
  readonly languages: AudioFacet;
  readonly speakers: AudioFacet;
  readonly series: AudioSeriesFacet;
  /** Only the bands some track falls in, in the bands' own order. */
  readonly lengths: readonly {
    readonly length: TopicVideoLength;
    readonly tracks: number;
  }[];
}

/** The most AudioSeries one directory read names: the busiest first. */
export const AUDIO_SERIES_DIRECTORY_MAX = 1000;

/** The most languages, speakers or Topics one AudioSeries' entry names: its commonest. */
export const AUDIO_SERIES_FACETS_MAX = 50;

/**
 * One published AudioSeries with what its PUBLISHED tracks say:
 *
 *   `tracks`     how many there are (a published series may have none yet);
 *   `seconds`    their recorded running time (an unrecorded one adds nothing);
 *   `firstOn`    the earliest and latest recording dates among them
 *   `lastOn`     (`YYYY-MM-DD`), each null when none is dated;
 *   `languages`, `speakers`, `topics`  — commonest first, each at most
 *                `AUDIO_SERIES_FACETS_MAX`, ties by identifier.
 */
export interface AudioSeriesEntry {
  readonly id: string;
  readonly slug: string;
  readonly primaryLocale: Locale;
  readonly labels: readonly MediaLabel[];
  readonly updatedAt: Date;
  readonly tracks: number;
  readonly seconds: number;
  readonly firstOn: string | null;
  readonly lastOn: string | null;
  readonly languages: readonly AudioCount[];
  readonly speakers: readonly AudioCount[];
  readonly topics: readonly AudioCount[];
}

export interface AudioSeriesDirectory {
  readonly items: readonly AudioSeriesEntry[];
  /** More published AudioSeries exist than the read's bound returned. */
  readonly hasMore: boolean;
}

/**
 * An AudioSeries' page header: its entry, its first published track in series
 * order, and its latest — the most recently recorded, an undated one only when
 * none is dated, then the highest place.
 */
export interface AudioSeriesSummary {
  readonly entry: AudioSeriesEntry;
  readonly first: AudioTrackListing | null;
  readonly latest: AudioTrackListing | null;
}

/**
 * WHERE ONE TRACK STANDS IN ITS SERIES: the published track just before it and
 * just after it (by place, a draft between them simply absent) and how many
 * published tracks the series has — only while the series is itself published.
 */
export const audioSeriesNeighboursQuerySchema = z
  .object({
    series: mediaIdSchema,
    position: z.number().int().min(1).max(MEDIA_LIMITS.seriesPosition),
  })
  .strict();
export type AudioSeriesNeighboursQuery = z.infer<typeof audioSeriesNeighboursQuerySchema>;

export interface AudioSeriesNeighbours {
  readonly previous: AudioTrackListing | null;
  readonly next: AudioTrackListing | null;
  /** The series' published tracks, this one included when it is published. */
  readonly tracks: number;
}
