import { z } from 'zod';

import type { Locale } from '../env/shared.ts';
import type { TimedQuranPassage } from '../passage/index.ts';
import {
  MEDIA_PAGE,
  mediaIdSchema,
  type MediaLabel,
  type TopicVideoSeries,
  type VideoAvailability,
  type VideoFormat,
  type VideoPoster,
} from './values.ts';

/**
 * WATCH PART 2 — THE GROUPINGS AND THE SPEAKERS, as their public pages read
 * them (DOMAIN_MODEL.md §11).
 *
 * THREE KINDS OF GROUPING, TWO AGGREGATES. A Series and a programme are one
 * aggregate (`Series`, its `kind` deciding its one route family): a Video is an
 * episode of at most one, at the place its editor numbered. A Playlist is the
 * other: a curated, ordered list a Video may appear in any number of. A
 * grouping's figures, languages, speakers, Topics and cover are what its
 * PUBLISHED Videos say — nothing is stored twice and nothing is inferred.
 *
 * THE ORDINARY PUBLIC PREDICATE THROUGHOUT. Only a published grouping is
 * named, and only its published Videos are counted, listed or pictured; a draft
 * episode or member is simply absent, and so is a Series a speaker speaks in
 * while it is not itself published.
 *
 * PEOPLE AND TAXONOMY ARE NAMED AT LAYER 4. Media answers identifiers — a
 * speaker is a People identifier, a Topic a Taxonomy one, a language a code —
 * and every name is resolved by its owner, a whole page at once.
 */

/** What a grouping is: a series or a programme (a `Series`), or a Playlist. */
export const MEDIA_GROUP_KINDS = Object.freeze([
  'series',
  'program',
  'playlist',
] as const);
export type MediaGroupKind = (typeof MEDIA_GROUP_KINDS)[number];
export const mediaGroupKindSchema = z.enum(MEDIA_GROUP_KINDS);

/**
 * The most groupings one directory read names: the busiest first (most
 * published Videos, then by slug). A page orders, filters and pages them; more
 * than this is stated, never hidden.
 */
export const MEDIA_GROUP_DIRECTORY_MAX = 1000;

/** The most languages, speakers or Topics one grouping names: its commonest. */
export const MEDIA_GROUP_FACETS_MAX = 50;

/** One page of a grouping's Videos. */
export const MEDIA_GROUP_EPISODES_PAGE = MEDIA_PAGE;

/** The most speakers one directory read names: the busiest first. */
export const MEDIA_SPEAKER_DIRECTORY_MAX = 1000;

/** The most Series one speaker's entry names (their commonest); `seriesTotal` counts all. */
export const MEDIA_SPEAKER_SERIES_MAX = 10;

/** One grouping, by the aggregate it is. */
export const mediaGroupRefSchema = z.discriminatedUnion('of', [
  z.object({ of: z.literal('series'), id: mediaIdSchema }).strict(),
  z.object({ of: z.literal('playlist'), id: mediaIdSchema }).strict(),
]);
export type MediaGroupRef = z.infer<typeof mediaGroupRefSchema>;

/**
 * One page of a grouping's PUBLISHED Videos in ITS order: episode order for a
 * Series, the curated order for a Playlist. Bounded; every order ends on the
 * Video's identifier.
 */
export const groupEpisodesQuerySchema = z
  .object({
    group: mediaGroupRefSchema,
    offset: z.number().int().min(0).max(25_000).default(0),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MEDIA_GROUP_EPISODES_PAGE)
      .default(MEDIA_GROUP_EPISODES_PAGE),
  })
  .strict();
export type GroupEpisodesQuery = z.infer<typeof groupEpisodesQuerySchema>;

/** An identifier and how many published Videos it holds or names. */
export interface MediaCount {
  readonly id: string;
  readonly videos: number;
}

/**
 * One published grouping with what its published Videos say:
 *
 *   `videos`     how many there are (a published grouping may have none yet);
 *   `seconds`    their recorded running time (an unrecorded one adds nothing);
 *   `firstOn`    the earliest and latest provider dates among them (`YYYY-MM-DD`),
 *   `lastOn`     each null when none is dated;
 *   `languages`  content language → Videos, commonest first;
 *   `speakers`   Person → Videos, commonest first;
 *   `topics`     Topic → Videos, commonest first — each of the three at most
 *                `MEDIA_GROUP_FACETS_MAX`, ties by identifier;
 *   `cover`      the first of them in its order that has a first-party poster.
 */
export interface MediaGroupEntry {
  readonly id: string;
  readonly slug: string;
  readonly kind: MediaGroupKind;
  readonly primaryLocale: Locale;
  readonly labels: readonly MediaLabel[];
  readonly updatedAt: Date;
  readonly videos: number;
  readonly seconds: number;
  readonly firstOn: string | null;
  readonly lastOn: string | null;
  readonly languages: readonly MediaCount[];
  readonly speakers: readonly MediaCount[];
  readonly topics: readonly MediaCount[];
  readonly cover: { readonly videoId: string; readonly poster: VideoPoster } | null;
}

export interface MediaGroupDirectory {
  readonly items: readonly MediaGroupEntry[];
  /** More published groupings of the kind exist than the read's bound returned. */
  readonly hasMore: boolean;
}

/**
 * One published Video as a grouping's page lists it: a card's worth, its
 * NUMBER — the episode's place as its editor numbered it in a Series, its
 * place among the published Videos of a Playlist (from 1) — and the Quran
 * passages it explains with where it takes each up. No provider identifier,
 * thumbnail, transcript or embed address.
 */
export interface GroupEpisode {
  readonly id: string;
  readonly slug: string;
  readonly primaryLocale: Locale;
  readonly availability: VideoAvailability;
  readonly format: VideoFormat | null;
  readonly languageCode: string;
  readonly labels: readonly MediaLabel[];
  readonly durationSeconds: number | null;
  /** `YYYY-MM-DD`, a date and not an instant. */
  readonly publishedOn: string | null;
  readonly poster: VideoPoster | null;
  readonly speakerIds: readonly string[];
  readonly number: number;
  readonly passages: readonly TimedQuranPassage[];
}

export interface GroupEpisodePage {
  readonly items: readonly GroupEpisode[];
  /** How many published Videos the grouping holds in all. */
  readonly total: number;
  readonly hasMore: boolean;
}

/**
 * A grouping's page header: its entry, its first published Video in its
 * order, and — for a Series — its latest (the newest provider date, undated
 * ones only when none is dated, then the highest number). A Playlist's order
 * is its meaning, so it has no "latest": `null`.
 */
export interface MediaGroupSummary {
  readonly entry: MediaGroupEntry;
  readonly first: GroupEpisode | null;
  readonly latest: GroupEpisode | null;
}

/**
 * One Person named as a speaker on a published Video: how many, their
 * recorded running time, the latest provider date among them, the content
 * languages they speak in (commonest first, at most `MEDIA_GROUP_FACETS_MAX`)
 * and the PUBLISHED Series they speak in (commonest first, at most
 * `MEDIA_SPEAKER_SERIES_MAX`; `seriesTotal` counts every one).
 */
export interface SpeakerDirectoryEntry {
  readonly personId: string;
  readonly videos: number;
  readonly seconds: number;
  readonly lastOn: string | null;
  readonly languages: readonly MediaCount[];
  readonly series: readonly MediaCount[];
  readonly seriesTotal: number;
}

export interface SpeakerDirectory {
  readonly items: readonly SpeakerDirectoryEntry[];
  /** More speakers are named than the read's bound returned. */
  readonly hasMore: boolean;
  /** Every published Series an entry names, with its address and titles. */
  readonly series: readonly TopicVideoSeries[];
}
