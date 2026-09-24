import { z } from 'zod';

import { localeSchema, type Locale } from '../env/shared.ts';
import {
  isProviderThumbnail,
  parseProviderReference,
  VIDEO_PROVIDERS,
  type VideoProvider,
} from './provider.ts';

/**
 * Media — Video, Series and Playlist (DOMAIN_MODEL.md §11, DELIVERY_PLAN.md
 * Phase 10).
 *
 * THREE AGGREGATES AND NO MORE. One Video entity, whatever it is about or
 * wherever it is surfaced; a Series it may belong to (at most one); Playlists it
 * may appear in (any number). There is no Program, Lecture, Interview or
 * provider-specific video type: a "programme" is a Series whose `kind` says so,
 * and the five curated Watch views are a Video's `format`. Audio and galleries
 * belong to later phases and have no shape here.
 *
 * NO FILE, NO FRAME, NO MARKUP. A Video is provider metadata: the provider, its
 * identifier, and descriptive facts an operator records. No byte of video is
 * stored, no iframe or embed address is accepted, and every text field is plain
 * text rendered as a text node.
 */

export const mediaIdSchema = z.uuid();

/** One slug grammar for every Media aggregate with a public address. */
export const mediaSlugSchema = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

/**
 * The smallest lifecycle Media needs (Phase 10 §25). Stated as a literal type so
 * the persistence boundary's contract is explicit; `satisfies` keeps the two in
 * step. No editorial workflow is imported: Media has no review step.
 */
export type MediaState = 'draft' | 'published' | 'archived';
export const mediaStateSchema = z.enum([
  'draft',
  'published',
  'archived',
]) satisfies z.ZodType<MediaState>;

export const mediaVersionSchema = z.number().int().positive().max(2_147_483_646);

/** A content-language reference, in the shape Taxonomy's `Language.code` takes. */
export const mediaLanguageCodeSchema = z
  .string()
  .min(2)
  .max(16)
  .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/);

/**
 * The curated Watch views (ROUTE_MAP.md §3.7) as a Video's own classification.
 * `null` is an honest "none of these" — a Video is never forced into a view.
 * `event` means event coverage; it is not a reference to an Event, which does
 * not exist until Phase 14.
 */
export const VIDEO_FORMATS = Object.freeze([
  'lecture',
  'event',
  'highlight',
  'interview',
  'documentary',
] as const);
export type VideoFormat = (typeof VIDEO_FORMATS)[number];
export const videoFormatSchema = z.enum(VIDEO_FORMATS);

/**
 * A Series is either a series or a programme. The kind decides its ONE
 * canonical route family — `/watch/series/{slug}` or `/watch/programs/{slug}` —
 * and changing it moves the address, with the former one answering a single
 * 301 (ROUTE_MAP.md §9.7).
 */
export const SERIES_KINDS = Object.freeze(['series', 'program'] as const);
export type SeriesKind = (typeof SERIES_KINDS)[number];
export const seriesKindSchema = z.enum(SERIES_KINDS);

/**
 * Whether the provider is known to serve the video.
 *
 * ORTHOGONAL TO PUBLICATION. A published Video whose provider has removed or
 * restricted it stays a real record with a real page; what changes is that the
 * page offers no player — only an honest statement and the provider link — so
 * a known-unavailable item never renders a broken frame. Nothing detects this
 * automatically: a cross-origin frame's failure is not observable, and this
 * platform does not poll providers. An operator records it.
 */
export const VIDEO_AVAILABILITY = Object.freeze(['available', 'unavailable'] as const);
export type VideoAvailability = (typeof VIDEO_AVAILABILITY)[number];
export const videoAvailabilitySchema = z.enum(VIDEO_AVAILABILITY);

export const videoProviderSchema = z.enum(VIDEO_PROVIDERS);

/** Every bound in one place, each enforced again by a SQL CHECK or column size. */
export const MEDIA_LIMITS = Object.freeze({
  title: 240,
  description: 4000,
  speakers: 12,
  topics: 24,
  transcript: 100_000,
  /** One hundred hours: longer than any recording this corpus holds. */
  durationSeconds: 360_000,
  seriesPosition: 100_000,
  /** How many Videos one Playlist may hold. */
  playlistVideos: 200,
  thumbnailUrl: 2000,
  providerReference: 300,
});

/** One public listing page — a grid of four, three or two columns divides it. */
export const MEDIA_PAGE = 24;

/** One page of the speaker browse, as the Library's facet browses. */
export const MEDIA_FACET_PAGE = 50;

const text = (max: number) => z.string().trim().max(max);

const ids = (max: number) =>
  z
    .array(mediaIdSchema)
    .max(max)
    .refine((values) => new Set(values).size === values.length);

/**
 * LOCALIZED DESCRIPTIVE METADATA, not a translation or a dub. An Urdu title on
 * an English lecture describes it for an Urdu reader; the lecture is still in
 * English, which is `languageCode`.
 */
const mediaLabelSchema = z
  .object({
    locale: localeSchema,
    title: text(MEDIA_LIMITS.title).min(1),
    description: text(MEDIA_LIMITS.description),
  })
  .strict();

export type MediaLabel = z.infer<typeof mediaLabelSchema>;

const labelsSchema = z.array(mediaLabelSchema).min(1).max(3);

function labelRules(
  value: { readonly primaryLocale: Locale; readonly labels: readonly MediaLabel[] },
  ctx: z.RefinementCtx,
): void {
  if (
    !value.labels.some((label) => label.locale === value.primaryLocale) ||
    new Set(value.labels.map((label) => label.locale)).size !== value.labels.length
  ) {
    ctx.addIssue({
      code: 'custom',
      message: 'A unique primary locale label is required.',
    });
  }
}

/* ===========================================================================
 * Video
 * ========================================================================= */

/**
 * One Video as an operator saves it.
 *
 * `providerReference` IS WHAT WAS TYPED — an identifier or one of the provider's
 * ordinary watch addresses — and the schema's output carries only the parsed
 * `providerVideoId`. A reference that does not parse for the chosen provider is
 * refused; there is no fallback that stores the text as given.
 *
 * A SERIES POSITION EXISTS EXACTLY WHEN A SERIES DOES, so an episode always has
 * its place and a standalone Video never carries a stray number.
 */
export const videoInputSchema = z
  .object({
    slug: mediaSlugSchema,
    primaryLocale: localeSchema,
    state: mediaStateSchema,
    isFeatured: z.boolean(),
    provider: videoProviderSchema,
    providerReference: z.string().max(MEDIA_LIMITS.providerReference),
    availability: videoAvailabilitySchema,
    format: videoFormatSchema.nullable(),
    languageCode: mediaLanguageCodeSchema,
    labels: labelsSchema,
    durationSeconds: z.number().int().min(1).max(MEDIA_LIMITS.durationSeconds).nullable(),
    /** The provider's own publication date, as a date — never an instant. */
    publishedOn: z.iso.date().nullable(),
    thumbnailUrl: z.string().trim().max(MEDIA_LIMITS.thumbnailUrl).nullable(),
    /** The provider's player offers captions for this video, as the operator attests. */
    captions: z.boolean(),
    /** A transcript the organisation holds, as plain text — never generated. */
    transcript: text(MEDIA_LIMITS.transcript).min(1).nullable(),
    seriesId: mediaIdSchema.nullable(),
    seriesPosition: z.number().int().min(1).max(MEDIA_LIMITS.seriesPosition).nullable(),
    speakerIds: ids(MEDIA_LIMITS.speakers),
    topicIds: ids(MEDIA_LIMITS.topics),
  })
  .strict()
  .superRefine((value, ctx) => {
    labelRules(value, ctx);
    const id = parseProviderReference(value.provider, value.providerReference);
    if (id === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['providerReference'],
        message: 'Not a video identifier or address of this provider.',
      });
      return;
    }
    if (
      value.thumbnailUrl !== null &&
      !isProviderThumbnail(value.provider, id, value.thumbnailUrl)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['thumbnailUrl'],
        message: "Not this video's thumbnail on the provider's own image host.",
      });
    }
    if ((value.seriesId === null) !== (value.seriesPosition === null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['seriesPosition'],
        message: 'An episode needs both its Series and its position.',
      });
    }
  })
  .transform(({ providerReference, ...value }) => ({
    ...value,
    providerVideoId: parseProviderReference(value.provider, providerReference) ?? '',
  }));

export type VideoValue = z.output<typeof videoInputSchema>;

/* ===========================================================================
 * Series and Playlist
 * ========================================================================= */

export const seriesInputSchema = z
  .object({
    slug: mediaSlugSchema,
    kind: seriesKindSchema,
    primaryLocale: localeSchema,
    state: mediaStateSchema,
    labels: labelsSchema,
  })
  .strict()
  .superRefine(labelRules);

export type SeriesValue = z.output<typeof seriesInputSchema>;

export const playlistInputSchema = z
  .object({
    slug: mediaSlugSchema,
    primaryLocale: localeSchema,
    state: mediaStateSchema,
    labels: labelsSchema,
  })
  .strict()
  .superRefine(labelRules);

export type PlaylistValue = z.output<typeof playlistInputSchema>;

/**
 * One change to a Playlist's ordered membership.
 *
 * NAMED CHANGES, NOT A LIST THE BROWSER SUPPLIES. Each is applied to the
 * membership the operator was looking at — proven by the expected version —
 * so a stale page can neither reorder nor drop what somebody else just added.
 */
export const playlistChangeSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), videoId: mediaIdSchema }).strict(),
  z.object({ op: z.literal('remove'), videoId: mediaIdSchema }).strict(),
  z
    .object({
      op: z.literal('move'),
      videoId: mediaIdSchema,
      direction: z.enum(['earlier', 'later']),
    })
    .strict(),
]);

export type PlaylistChange = z.infer<typeof playlistChangeSchema>;

/* ===========================================================================
 * Queries
 * ========================================================================= */

/**
 * A public Video listing's filters (ROUTE_MAP.md §3.7: topic, speaker, series,
 * language). Each NARROWS the public predicate and none can widen it. `featured`
 * is the curated flag behind `/watch?sort=featured`.
 */
export const videoQuerySchema = z
  .object({
    offset: z.number().int().min(0).max(25_000).default(0),
    format: videoFormatSchema.nullable().default(null),
    topic: mediaIdSchema.nullable().default(null),
    speaker: mediaIdSchema.nullable().default(null),
    series: mediaIdSchema.nullable().default(null),
    language: z.string().max(16).nullable().default(null),
    featured: z.boolean().default(false),
  })
  .strict();

export type VideoQuery = z.infer<typeof videoQuerySchema>;

/** An administrative directory's filters: a state and a bounded text match. */
export const mediaAdminQuerySchema = z
  .object({
    offset: z.number().int().min(0).max(25_000).default(0),
    state: mediaStateSchema.nullable().default(null),
    text: z.string().trim().max(200).nullable().default(null),
  })
  .strict();

export type MediaAdminQuery = z.infer<typeof mediaAdminQuerySchema>;

/* ===========================================================================
 * Records
 * ========================================================================= */

/** The Series a Video belongs to, as a Video's page needs it. */
export interface VideoSeriesRef {
  readonly id: string;
  readonly slug: string;
  readonly kind: SeriesKind;
  readonly primaryLocale: Locale;
  readonly labels: readonly MediaLabel[];
  readonly state: MediaState;
  readonly position: number;
}

export interface VideoRecord {
  readonly id: string;
  readonly slug: string;
  readonly primaryLocale: Locale;
  readonly state: MediaState;
  readonly isFeatured: boolean;
  readonly provider: VideoProvider;
  readonly providerVideoId: string;
  readonly availability: VideoAvailability;
  readonly format: VideoFormat | null;
  /** The CONTENT language, a Taxonomy reference. Never the interface locale. */
  readonly languageCode: string;
  readonly labels: readonly MediaLabel[];
  readonly durationSeconds: number | null;
  /** `YYYY-MM-DD`, a date and not an instant. */
  readonly publishedOn: string | null;
  readonly thumbnailUrl: string | null;
  readonly captions: boolean;
  readonly transcript: string | null;
  /** On a PUBLIC read, present only while the Series itself is published. */
  readonly series: VideoSeriesRef | null;
  readonly speakerIds: readonly string[];
  readonly topicIds: readonly string[];
  readonly version: number;
  readonly updatedAt: Date;
}

/**
 * One card: what a listing shows and nothing heavy — no transcript. Speakers
 * are identifiers, resolved to names by People for a whole page at once.
 */
export interface VideoListing {
  readonly id: string;
  readonly slug: string;
  readonly primaryLocale: Locale;
  readonly state: MediaState;
  readonly isFeatured: boolean;
  readonly provider: VideoProvider;
  readonly availability: VideoAvailability;
  readonly format: VideoFormat | null;
  readonly languageCode: string;
  readonly labels: readonly MediaLabel[];
  readonly durationSeconds: number | null;
  readonly publishedOn: string | null;
  /** The episode position, where the Video is read within its Series. */
  readonly seriesPosition: number | null;
  readonly speakerIds: readonly string[];
  readonly version: number;
  readonly updatedAt: Date;
}

export interface VideoPage {
  readonly items: readonly VideoListing[];
  readonly hasMore: boolean;
}

export interface SeriesRecord {
  readonly id: string;
  readonly slug: string;
  readonly kind: SeriesKind;
  readonly primaryLocale: Locale;
  readonly state: MediaState;
  readonly labels: readonly MediaLabel[];
  readonly version: number;
  readonly updatedAt: Date;
}

export interface SeriesPage {
  readonly items: readonly SeriesRecord[];
  readonly hasMore: boolean;
}

export interface PlaylistRecord {
  readonly id: string;
  readonly slug: string;
  readonly primaryLocale: Locale;
  readonly state: MediaState;
  readonly labels: readonly MediaLabel[];
  readonly version: number;
  readonly updatedAt: Date;
}

export interface PlaylistPage {
  readonly items: readonly PlaylistRecord[];
  readonly hasMore: boolean;
}

/** A Playlist with its whole ordered membership, for the administrative editor. */
export interface PlaylistDetail extends PlaylistRecord {
  readonly videos: readonly VideoListing[];
}

/** One speaker facet: a Person identifier and how many public Videos name them. */
export interface SpeakerFacet {
  readonly id: string;
  readonly videos: number;
}

export interface SpeakerFacetPage {
  readonly items: readonly SpeakerFacet[];
  readonly hasMore: boolean;
}

export interface MediaSitemapRow {
  readonly slug: string;
  /** For a Series, its kind — which decides its route family. */
  readonly seriesKind: SeriesKind | null;
  readonly locales: readonly string[];
  readonly updatedAt: Date;
}

/**
 * What Search may know about one public Video: its labels, content language,
 * provider date, topics and — where the organisation holds one — its
 * transcript. Never the provider identifier, never an embed address, never a
 * speaker's name (a person is found as a Person result).
 */
export interface VideoSearchRecord {
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

/* ===========================================================================
 * Pure helpers
 * ========================================================================= */

/**
 * Reads an operator's `h:mm:ss`, `m:ss` or plain seconds into seconds, or
 * `null` when empty. Anything else is `NaN`, which the schema refuses rather
 * than coercing a mistyped duration into a wrong one.
 */
export function parseDuration(input: string): number | null {
  const value = input.trim();
  if (value === '') return null;
  if (/^\d{1,6}$/.test(value)) return Number(value);
  const match = /^(?:(\d{1,3}):)?([0-5]?\d):([0-5]\d)$/.exec(value);
  if (match === null) return Number.NaN;
  const [, hours, minutes, seconds] = match;
  return Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds);
}

/** The inverse, for the administrative form: `1:02:03` or `4:05`. */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return hours > 0
    ? `${String(hours)}:${String(minutes).padStart(2, '0')}:${rest}`
    : `${String(minutes)}:${rest}`;
}

/** ISO 8601 duration for structured data: `PT1H2M3S`. */
export function isoDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return (
    'PT' +
    (hours > 0 ? `${String(hours)}H` : '') +
    (minutes > 0 ? `${String(minutes)}M` : '') +
    (rest > 0 || (hours === 0 && minutes === 0) ? `${String(rest)}S` : '')
  );
}

/**
 * The new ordered membership after one change, or the reason it cannot apply.
 *
 * PURE, so the rule is proved without a database. Adding a Video already
 * present is a duplicate, not a silent no-op; removing or moving one that is
 * absent is invalid; moving past either end is a no-op the caller refuses, so a
 * double-click never records a change that changed nothing.
 */
export function applyPlaylistChange(
  current: readonly string[],
  change: PlaylistChange,
): { readonly videoIds: readonly string[] } | { readonly refusal: string } {
  const index = current.indexOf(change.videoId);
  switch (change.op) {
    case 'add':
      if (index !== -1) return { refusal: 'duplicate-member' };
      if (current.length >= MEDIA_LIMITS.playlistVideos) return { refusal: 'limit' };
      return { videoIds: [...current, change.videoId] };
    case 'remove':
      if (index === -1) return { refusal: 'invalid' };
      return { videoIds: current.filter((id) => id !== change.videoId) };
    case 'move': {
      if (index === -1) return { refusal: 'invalid' };
      const target = change.direction === 'earlier' ? index - 1 : index + 1;
      if (target < 0 || target >= current.length) return { refusal: 'invalid' };
      const next = [...current];
      next[index] = current[target] ?? change.videoId;
      next[target] = change.videoId;
      return { videoIds: next };
    }
  }
}
