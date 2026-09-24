import { z } from 'zod';

import { localeSchema, type Locale } from '../env/shared.ts';
import {
  MEDIA_LIMITS,
  mediaIdSchema,
  mediaIds,
  mediaLabelRules,
  mediaLabelsSchema,
  mediaLanguageCodeSchema,
  mediaSlugSchema,
  mediaStateSchema,
  mediaText,
  type MediaLabel,
  type MediaState,
} from './values.ts';

/**
 * Media — AudioTrack and AudioSeries (DOMAIN_MODEL.md §8.1, §11; DELIVERY_PLAN.md
 * Phase 11).
 *
 * NON-QURAN AUDIO ONLY. A lecture, a talk, a speech: spoken audio the
 * organisation holds as a file. Quran owns the logical Recitation — reciter,
 * style and its Surah/Ayah mapping — and Media may later PRESENT recitations, but
 * it never authors one (§8.1). So nothing here can describe a recitation: there
 * is no reciter, no Surah, Ayah, Juz or range, no recitation kind or format, no
 * `isQuran` flag. Every schema is strict, so a field of that shape is not
 * ignored but refused, and there is no path by which an AudioTrack becomes a
 * second, competing authoring path for scripture.
 *
 * TWO AGGREGATES AND NO MORE. An AudioTrack, and an AudioSeries it may belong to
 * (at most one, at a unique position). No AudioPlaylist, Podcast, Album, Season
 * or Episode aggregate exists: an ordered run of talks is an AudioSeries, and an
 * AudioSeries is not the Phase-10 Video `Series` — different players, different
 * members, different tables (§18: "Video and Audio").
 *
 * THE FILE IS STORAGE'S; ITS MEANING IS MEDIA'S. A track's bytes are an `Asset`
 * held by the Layer-0 storage foundation, reached through a typed relation and
 * only ever through `StorageServicePort`. What the file IS — its sniffed type,
 * size, checksum and scan state — is Storage's to know; whether the public may
 * hear it is Media's. Both must say yes (§14 of the phase contract).
 *
 * NOTHING IS GENERATED. A duration is what an operator states, a date is when
 * the talk was recorded as far as the organisation knows it, and a transcript is
 * text the organisation holds. None is derived from the audio, fetched, or
 * produced by speech recognition.
 */

/* ===========================================================================
 * The technical upload contract
 * ========================================================================= */

/**
 * The playable formats Media accepts for an audio file — as SNIFFED by Storage,
 * never as declared.
 *
 * ONE FORMAT. MPEG audio (MP3) plays natively in every browser the platform
 * supports, so no transcoder, no second rendition and no codec dependency is
 * needed to serve it. A later need for another format arrives with evidence.
 */
export const AUDIO_MEDIA_TYPES = Object.freeze(['audio/mpeg'] as const);

/**
 * The ceiling on one audio file uploaded through the administration.
 *
 * A TECHNICAL SAFETY BOUND, NOT A CONTENT POLICY. It equals the storage
 * foundation's default per-object ceiling (`STORAGE_MAX_BYTES`, 64 MiB) — about
 * seventy minutes at 128 kbit/s, or well over two hours of speech at 64 kbit/s —
 * and Storage applies the smaller of the two, so an environment that narrows its
 * disk ceiling narrows this with it. It is enforced before a byte is read (from
 * the declared length) and again while streaming.
 */
export const AUDIO_UPLOAD_MAX_BYTES = 64 * 1024 * 1024;

/* ===========================================================================
 * AudioTrack and AudioSeries
 * ========================================================================= */

/**
 * One AudioTrack as an operator saves it.
 *
 * THE FILE IS NOT HERE. An audio file is attached by uploading it to the track
 * (`/api/admin/media/audio/{id}/asset`), which streams it through Storage and
 * records the typed relation only once Storage has cleared the bytes. An asset
 * identifier is never accepted from a form, so no operator can point a track at
 * a file somebody else uploaded.
 *
 * A SERIES POSITION EXISTS EXACTLY WHEN A SERIES DOES, as for a Video's episode.
 */
export const audioTrackInputSchema = z
  .object({
    slug: mediaSlugSchema,
    primaryLocale: localeSchema,
    state: mediaStateSchema,
    languageCode: mediaLanguageCodeSchema,
    labels: mediaLabelsSchema,
    durationSeconds: z.number().int().min(1).max(MEDIA_LIMITS.durationSeconds).nullable(),
    /** When the talk was given or recorded, as a date — never an instant. */
    recordedOn: z.iso.date().nullable(),
    /** A transcript the organisation holds, as plain text — never generated. */
    transcript: mediaText(MEDIA_LIMITS.transcript).min(1).nullable(),
    seriesId: mediaIdSchema.nullable(),
    seriesPosition: z.number().int().min(1).max(MEDIA_LIMITS.seriesPosition).nullable(),
    speakerIds: mediaIds(MEDIA_LIMITS.speakers),
    topicIds: mediaIds(MEDIA_LIMITS.topics),
  })
  .strict()
  .superRefine((value, ctx) => {
    mediaLabelRules(value, ctx);
    if ((value.seriesId === null) !== (value.seriesPosition === null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['seriesPosition'],
        message: 'A track in a series needs both the series and its position.',
      });
    }
  });

export type AudioTrackValue = z.output<typeof audioTrackInputSchema>;

export const audioSeriesInputSchema = z
  .object({
    slug: mediaSlugSchema,
    primaryLocale: localeSchema,
    state: mediaStateSchema,
    labels: mediaLabelsSchema,
  })
  .strict()
  .superRefine(mediaLabelRules);

export type AudioSeriesValue = z.output<typeof audioSeriesInputSchema>;

/**
 * A public listing's filters (ROUTE_MAP.md §3.7), mirroring the Watch listing:
 * each NARROWS the public predicate and none can widen it.
 */
export const audioTrackQuerySchema = z
  .object({
    offset: z.number().int().min(0).max(25_000).default(0),
    topic: mediaIdSchema.nullable().default(null),
    speaker: mediaIdSchema.nullable().default(null),
    series: mediaIdSchema.nullable().default(null),
    language: z.string().max(16).nullable().default(null),
  })
  .strict();

export type AudioTrackQuery = z.infer<typeof audioTrackQuerySchema>;

/* ===========================================================================
 * Records
 * ========================================================================= */

/** The AudioSeries a track belongs to, as a track's page needs it. */
export interface AudioSeriesRef {
  readonly id: string;
  readonly slug: string;
  readonly primaryLocale: Locale;
  readonly labels: readonly MediaLabel[];
  readonly state: MediaState;
  readonly position: number;
}

export interface AudioTrackRecord {
  readonly id: string;
  readonly slug: string;
  readonly primaryLocale: Locale;
  readonly state: MediaState;
  /** The CONTENT language, a Taxonomy reference. Never the interface locale. */
  readonly languageCode: string;
  readonly labels: readonly MediaLabel[];
  readonly durationSeconds: number | null;
  /** `YYYY-MM-DD`, a date and not an instant. */
  readonly recordedOn: string | null;
  readonly transcript: string | null;
  /**
   * The Storage asset holding this track's audio, or `null` while none is
   * attached. An identifier only: whether its bytes may be served is decided
   * per request by Media's policy AND Storage's technical state.
   */
  readonly assetId: string | null;
  /** On a PUBLIC read, present only while the AudioSeries itself is published. */
  readonly series: AudioSeriesRef | null;
  readonly speakerIds: readonly string[];
  readonly topicIds: readonly string[];
  readonly version: number;
  readonly updatedAt: Date;
}

/** One card or row: what a listing shows, and never the transcript. */
export interface AudioTrackListing {
  readonly id: string;
  readonly slug: string;
  readonly primaryLocale: Locale;
  readonly state: MediaState;
  readonly languageCode: string;
  readonly labels: readonly MediaLabel[];
  readonly durationSeconds: number | null;
  readonly recordedOn: string | null;
  /** The track's position, where it is read within its AudioSeries. */
  readonly seriesPosition: number | null;
  /** Whether a file is attached. NOT whether it is servable right now. */
  readonly hasAudio: boolean;
  readonly speakerIds: readonly string[];
  readonly version: number;
  readonly updatedAt: Date;
}

export interface AudioTrackPage {
  readonly items: readonly AudioTrackListing[];
  readonly hasMore: boolean;
}

export interface AudioSeriesRecord {
  readonly id: string;
  readonly slug: string;
  readonly primaryLocale: Locale;
  readonly state: MediaState;
  readonly labels: readonly MediaLabel[];
  readonly version: number;
  readonly updatedAt: Date;
}

export interface AudioSeriesPage {
  readonly items: readonly AudioSeriesRecord[];
  readonly hasMore: boolean;
}

/**
 * What Search may know about one public AudioTrack: its labels, content
 * language, recording year, topics and — where the organisation holds one — its
 * transcript. Never an asset identifier, a storage key or any fact about the
 * file, and never a speaker's name (a person is found as a Person result).
 */
export interface AudioSearchRecord {
  readonly id: string;
  /** Opaque; moves whenever anything this projection reads moves. */
  readonly stamp: string;
  readonly primaryLocale: Locale;
  readonly labels: readonly MediaLabel[];
  readonly languageCode: string;
  readonly year: number | null;
  readonly topicIds: readonly string[];
  readonly transcript: string | null;
}

/**
 * The relation Media's serving policy decides on: a track's lifecycle state and
 * the ONE asset recorded against it. Read for any track, draft included — which
 * is exactly why it lives on its own narrow port rather than on the public
 * reader (`MediaAssetRelationPort`).
 */
export interface AudioAssetRelation {
  readonly state: MediaState;
  readonly assetId: string | null;
}

/** One request for a track's bytes. Both parts come from the URL; neither grants. */
export interface AudioAssetRequest {
  readonly trackId: string;
  readonly assetId: string;
}
