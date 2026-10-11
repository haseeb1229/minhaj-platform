import 'server-only';

import { randomUUID } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import type { Locale } from '@minhaj/contracts';
import {
  MEDIA_FACET_PAGE,
  MEDIA_PAGE,
  type MediaPersistencePort,
  type MediaPublicReaderPort,
  type MediaState,
  type PlaylistDetail,
  type PlaylistPage,
  type PlaylistRecord,
  type SeriesKind,
  type SeriesPage,
  type SeriesRecord,
  type VideoAvailability,
  type VideoFormat,
  type VideoListing,
  type VideoPage,
  type VideoProvider,
  type VideoRecord,
  type VideoValue,
} from '@minhaj/contracts/media';

import { auditRow } from '../../audit-row.ts';
import { getDatabaseClient } from '../../client.ts';
import { requestSearchIndexing } from '../../search-intent.ts';
import { audioPersistence, audioPublicReader } from './audio.ts';
import { photoPersistence, photoPublicReader } from './photo.ts';
import {
  bounded,
  boundedOffset,
  isoDate,
  LABELS,
  labelsOf,
  MediaDataError,
  PUBLISHED,
  RECENTLY_CHANGED,
  refuse,
  TARGET_BATCH,
  textMatch,
  UNMATCHABLE_VERSION,
  utcDate,
  type Client,
  type LabelRow,
} from './shared.ts';

/**
 * The Media persistence adapter — Video, Series and Playlist
 * (DOMAIN_MODEL.md §11, DELIVERY_PLAN.md Phase 10).
 *
 * OWNED BY THE MEDIA CONTEXT, hosted here (ARCHITECTURE.md §4.1). Two factories
 * leave this module, each typed by Media's own port, so no client, delegate or
 * transaction handle crosses the boundary. The Phase-11 audio half
 * (`./audio.ts`) and the Phase-12 photograph half (`./photo.ts`) are spread
 * into both, so Media keeps one persistence port and one public reader.
 *
 * ONE PUBLIC PREDICATE PER AGGREGATE, applied IN THE QUERY: a Video, Series or
 * Playlist is public when it is `published`. A Video's Series is shown with it
 * only while that Series is itself published, and a Playlist lists only its
 * published Videos. Every public read — listing, detail, redirect, sitemap,
 * search — composes the same predicate, so no two can disagree about what
 * exists.
 *
 * EVERY WRITE IS ONE TRANSACTION under an expected version: the row, its
 * replaced relation sets, its slug reservation (by trigger), its audit entry
 * and — for a Video — its durable search intent commit together or not at all.
 */

/* ===========================================================================
 * Query fragments
 * ========================================================================= */

const SPEAKERS = {
  select: { personId: true },
  orderBy: [{ position: 'asc' }, { personId: 'asc' }],
} satisfies Prisma.Video$speakersArgs;

/** What a card needs: never the transcript. */
const LISTING_SELECT = {
  id: true,
  slug: true,
  primaryLocale: true,
  state: true,
  isFeatured: true,
  provider: true,
  availability: true,
  format: true,
  languageCode: true,
  durationSeconds: true,
  publishedOn: true,
  seriesPosition: true,
  version: true,
  updatedAt: true,
  labels: LABELS,
  speakers: SPEAKERS,
} satisfies Prisma.VideoSelect;

const DETAIL_INCLUDE = {
  labels: LABELS,
  speakers: SPEAKERS,
  topics: { select: { topicId: true }, orderBy: { topicId: 'asc' } },
  series: {
    select: {
      id: true,
      slug: true,
      kind: true,
      primaryLocale: true,
      state: true,
      labels: LABELS,
    },
  },
} satisfies Prisma.VideoInclude;

const SERIES_SELECT = {
  id: true,
  slug: true,
  kind: true,
  primaryLocale: true,
  state: true,
  version: true,
  updatedAt: true,
  labels: LABELS,
} satisfies Prisma.SeriesSelect;

const PLAYLIST_SELECT = {
  id: true,
  slug: true,
  primaryLocale: true,
  state: true,
  version: true,
  updatedAt: true,
  labels: LABELS,
} satisfies Prisma.PlaylistSelect;

/**
 * Newest provider date first. SQL Server sorts NULL lowest, so a descending
 * order puts an undated Video last, and the slug — unique — makes it total.
 */
const LATEST = [{ publishedOn: 'desc' }, { slug: 'asc' }, { id: 'asc' }] as const;
const EPISODES = [{ seriesPosition: 'asc' }, { id: 'asc' }] as const;

/** How many Playlists a Video's page names. */
const APPEARANCES = 10;

/** How many Series the Video form offers. */
const SERIES_CHOICES = 200;

/* ===========================================================================
 * Mapping
 * ========================================================================= */

interface ListingRow {
  readonly id: string;
  readonly slug: string;
  readonly primaryLocale: string;
  readonly state: string;
  readonly isFeatured: boolean;
  readonly provider: string;
  readonly availability: string;
  readonly format: string | null;
  readonly languageCode: string;
  readonly durationSeconds: number | null;
  readonly publishedOn: Date | null;
  readonly seriesPosition: number | null;
  readonly version: number;
  readonly updatedAt: Date;
  readonly labels: readonly LabelRow[];
  readonly speakers: readonly { readonly personId: string }[];
}

interface DetailRow extends ListingRow {
  readonly providerVideoId: string;
  readonly thumbnailUrl: string | null;
  readonly captions: boolean;
  readonly transcript: string | null;
  readonly topics: readonly { readonly topicId: string }[];
  readonly series: {
    readonly id: string;
    readonly slug: string;
    readonly kind: string;
    readonly primaryLocale: string;
    readonly state: string;
    readonly labels: readonly LabelRow[];
  } | null;
}

interface GroupRow {
  readonly id: string;
  readonly slug: string;
  readonly primaryLocale: string;
  readonly state: string;
  readonly version: number;
  readonly updatedAt: Date;
  readonly labels: readonly LabelRow[];
}

function toListing(row: ListingRow): VideoListing {
  return {
    id: row.id,
    slug: row.slug,
    primaryLocale: row.primaryLocale as Locale,
    state: row.state as MediaState,
    isFeatured: row.isFeatured,
    provider: row.provider as VideoProvider,
    availability: row.availability as VideoAvailability,
    format: row.format as VideoFormat | null,
    languageCode: row.languageCode,
    labels: labelsOf(row.labels),
    durationSeconds: row.durationSeconds,
    publishedOn: isoDate(row.publishedOn),
    seriesPosition: row.seriesPosition,
    speakerIds: row.speakers.map((entry) => entry.personId),
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

/**
 * A Video with its Series context. `publicOnly` withholds an unpublished Series
 * from a public read: the Video is public, the grouping it sits in may not be.
 */
function toRecord(row: DetailRow, publicOnly: boolean): VideoRecord {
  const series =
    row.series === null ||
    row.seriesPosition === null ||
    (publicOnly && row.series.state !== 'published')
      ? null
      : {
          id: row.series.id,
          slug: row.series.slug,
          kind: row.series.kind as SeriesKind,
          primaryLocale: row.series.primaryLocale as Locale,
          labels: labelsOf(row.series.labels),
          state: row.series.state as MediaState,
          position: row.seriesPosition,
        };
  const listing = toListing(row);
  return {
    id: listing.id,
    slug: listing.slug,
    primaryLocale: listing.primaryLocale,
    state: listing.state,
    isFeatured: listing.isFeatured,
    provider: listing.provider,
    providerVideoId: row.providerVideoId,
    availability: listing.availability,
    format: listing.format,
    languageCode: listing.languageCode,
    labels: listing.labels,
    durationSeconds: listing.durationSeconds,
    publishedOn: listing.publishedOn,
    thumbnailUrl: row.thumbnailUrl,
    captions: row.captions,
    transcript: row.transcript,
    series,
    speakerIds: listing.speakerIds,
    topicIds: row.topics.map((entry) => entry.topicId),
    version: listing.version,
    updatedAt: listing.updatedAt,
  };
}

function toSeries(row: GroupRow & { readonly kind: string }): SeriesRecord {
  return {
    id: row.id,
    slug: row.slug,
    kind: row.kind as SeriesKind,
    primaryLocale: row.primaryLocale as Locale,
    state: row.state as MediaState,
    labels: labelsOf(row.labels),
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

function toPlaylist(row: GroupRow): PlaylistRecord {
  return {
    id: row.id,
    slug: row.slug,
    primaryLocale: row.primaryLocale as Locale,
    state: row.state as MediaState,
    labels: labelsOf(row.labels),
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

function videoPage(rows: readonly ListingRow[]): VideoPage {
  return {
    items: rows.slice(0, MEDIA_PAGE).map(toListing),
    hasMore: rows.length > MEDIA_PAGE,
  };
}

function seriesPage(rows: readonly (GroupRow & { readonly kind: string })[]): SeriesPage {
  return {
    items: rows.slice(0, MEDIA_PAGE).map(toSeries),
    hasMore: rows.length > MEDIA_PAGE,
  };
}

function playlistPage(rows: readonly GroupRow[]): PlaylistPage {
  return {
    items: rows.slice(0, MEDIA_PAGE).map(toPlaylist),
    hasMore: rows.length > MEDIA_PAGE,
  };
}

/* ===========================================================================
 * Writing
 * ========================================================================= */

function videoColumns(value: VideoValue): Omit<Prisma.VideoUncheckedCreateInput, 'id'> {
  return {
    slug: value.slug,
    primaryLocale: value.primaryLocale,
    state: value.state,
    isFeatured: value.isFeatured,
    provider: value.provider,
    providerVideoId: value.providerVideoId,
    availability: value.availability,
    format: value.format,
    languageCode: value.languageCode,
    durationSeconds: value.durationSeconds,
    publishedOn: utcDate(value.publishedOn),
    thumbnailUrl: value.thumbnailUrl,
    captions: value.captions,
    transcript: value.transcript,
    seriesId: value.seriesId,
    seriesPosition: value.seriesPosition,
    updatedAt: new Date(),
  };
}

async function replaceVideoSets(tx: Client, videoId: string, value: VideoValue) {
  await tx.videoLabel.deleteMany({ where: { videoId } });
  await tx.videoLabel.createMany({
    data: value.labels.map((label) => ({ videoId, ...label })),
  });

  await tx.videoSpeaker.deleteMany({ where: { videoId } });
  if (value.speakerIds.length > 0)
    await tx.videoSpeaker.createMany({
      data: value.speakerIds.map((personId, position) => ({
        videoId,
        personId,
        position,
      })),
    });

  await tx.videoTopic.deleteMany({ where: { videoId } });
  if (value.topicIds.length > 0)
    await tx.videoTopic.createMany({
      data: value.topicIds.map((topicId) => ({ videoId, topicId })),
    });
}

/** A Playlist's row and its ordered membership, read with the caller's client. */
async function loadPlaylist(
  db: Client,
  id: string,
): Promise<{ readonly row: GroupRow; readonly members: readonly ListingRow[] } | null> {
  const row = await db.playlist.findFirst({ where: { id }, select: PLAYLIST_SELECT });
  if (row === null) return null;
  const members = await db.playlistVideo.findMany({
    where: { playlistId: id },
    orderBy: { position: 'asc' },
    select: { video: { select: LISTING_SELECT } },
  });
  return { row, members: members.map((member) => member.video) };
}

function playlistDetail(loaded: {
  readonly row: GroupRow;
  readonly members: readonly ListingRow[];
}): PlaylistDetail {
  return { ...toPlaylist(loaded.row), videos: loaded.members.map(toListing) };
}

/* ===========================================================================
 * Administration
 * ========================================================================= */

export function createMediaPersistence(): MediaPersistencePort {
  const db = getDatabaseClient();

  return {
    ...audioPersistence(),
    ...photoPersistence(),

    async videos(query) {
      const rows = await db.video.findMany({
        where: {
          ...(query.state === null ? {} : { state: query.state }),
          ...textMatch(query.text),
        },
        select: LISTING_SELECT,
        orderBy: [...RECENTLY_CHANGED],
        skip: boundedOffset(query.offset),
        take: MEDIA_PAGE + 1,
      });
      return videoPage(rows);
    },

    async video(id) {
      const row = await db.video.findFirst({ where: { id }, include: DETAIL_INCLUDE });
      return row === null ? null : toRecord(row, false);
    },

    async saveVideo({ actorId, id, expectedVersion, value }) {
      try {
        return await db.$transaction(async (tx) => {
          const videoId = id ?? randomUUID();
          const previous =
            id === null
              ? null
              : await tx.video.findFirst({
                  where: { id },
                  select: {
                    slug: true,
                    state: true,
                    version: true,
                    provider: true,
                    providerVideoId: true,
                    availability: true,
                    seriesId: true,
                  },
                });
          if (id !== null && (previous === null || previous.version !== expectedVersion))
            throw new MediaDataError('conflict');

          const data = videoColumns(value);
          if (id !== null) {
            const changed = await tx.video.updateMany({
              where: { id, version: expectedVersion ?? UNMATCHABLE_VERSION },
              data: { ...data, version: { increment: 1 } },
            });
            if (changed.count !== 1) throw new MediaDataError('conflict');
          } else {
            // The slug trigger reserves the new slug in this same transaction.
            await tx.video.create({ data: { ...data, id: videoId } });
          }

          await replaceVideoSets(tx, videoId, value);

          const row = await tx.video.findFirst({
            where: { id: videoId },
            include: DETAIL_INCLUDE,
          });
          if (row === null) throw new MediaDataError('conflict');

          // DURABLE SEARCH INTENT, committed with the change (ARCHITECTURE.md
          // §8.5). Unconditional: the indexer re-projects from current public
          // state, so a redundant request costs one idempotent projection.
          await requestSearchIndexing(tx, 'video', videoId);

          // Identifiers, states and counts — never a title, a description or a
          // transcript (SECURITY_BASELINE.md §13.4).
          await tx.auditLog.create({
            data: auditRow({
              actorType: 'user',
              actorId,
              action: `media.video.${previous === null ? 'created' : 'updated'}`,
              targetType: 'video',
              targetId: videoId,
              ...(previous === null
                ? {}
                : {
                    before: {
                      version: String(previous.version),
                      state: previous.state,
                      availability: previous.availability,
                    },
                  }),
              after: {
                version: String(row.version),
                state: row.state,
                availability: row.availability,
                provider: row.provider,
                slugChanged: String(previous !== null && previous.slug !== value.slug),
                providerChanged: String(
                  previous !== null &&
                    (previous.provider !== value.provider ||
                      previous.providerVideoId !== value.providerVideoId),
                ),
                seriesChanged: String(
                  previous !== null && previous.seriesId !== value.seriesId,
                ),
                speakers: String(value.speakerIds.length),
                topics: String(value.topicIds.length),
              },
              authorisingSource: 'media.administer',
            }),
          });

          return toRecord(row, false);
        });
      } catch (error) {
        refuse(error);
      }
    },

    async seriesDirectory(query) {
      const rows = await db.series.findMany({
        where: {
          ...(query.state === null ? {} : { state: query.state }),
          ...textMatch(query.text),
        },
        select: SERIES_SELECT,
        orderBy: [...RECENTLY_CHANGED],
        skip: boundedOffset(query.offset),
        take: MEDIA_PAGE + 1,
      });
      return seriesPage(rows);
    },

    async series(id) {
      const row = await db.series.findFirst({ where: { id }, select: SERIES_SELECT });
      return row === null ? null : toSeries(row);
    },

    async seriesEpisodes(seriesId, offset) {
      const rows = await db.video.findMany({
        where: { seriesId },
        select: LISTING_SELECT,
        orderBy: [...EPISODES],
        skip: boundedOffset(offset),
        take: MEDIA_PAGE + 1,
      });
      return videoPage(rows);
    },

    async seriesChoices() {
      const rows = await db.series.findMany({
        select: SERIES_SELECT,
        orderBy: [{ slug: 'asc' }],
        take: SERIES_CHOICES,
      });
      return rows.map(toSeries);
    },

    async saveSeries({ actorId, id, expectedVersion, value }) {
      try {
        return await db.$transaction(async (tx) => {
          const seriesId = id ?? randomUUID();
          const previous =
            id === null
              ? null
              : await tx.series.findFirst({
                  where: { id },
                  select: { slug: true, kind: true, state: true, version: true },
                });
          if (id !== null && (previous === null || previous.version !== expectedVersion))
            throw new MediaDataError('conflict');

          const data = {
            slug: value.slug,
            kind: value.kind,
            primaryLocale: value.primaryLocale,
            state: value.state,
            updatedAt: new Date(),
          };
          if (id !== null) {
            const changed = await tx.series.updateMany({
              where: { id, version: expectedVersion ?? UNMATCHABLE_VERSION },
              data: { ...data, version: { increment: 1 } },
            });
            if (changed.count !== 1) throw new MediaDataError('conflict');
          } else {
            await tx.series.create({ data: { ...data, id: seriesId } });
          }

          await tx.seriesLabel.deleteMany({ where: { seriesId } });
          await tx.seriesLabel.createMany({
            data: value.labels.map((label) => ({ seriesId, ...label })),
          });

          const row = await tx.series.findFirst({
            where: { id: seriesId },
            select: SERIES_SELECT,
          });
          if (row === null) throw new MediaDataError('conflict');

          await tx.auditLog.create({
            data: auditRow({
              actorType: 'user',
              actorId,
              action: `media.series.${previous === null ? 'created' : 'updated'}`,
              targetType: 'series',
              targetId: seriesId,
              ...(previous === null
                ? {}
                : {
                    before: {
                      version: String(previous.version),
                      state: previous.state,
                      kind: previous.kind,
                    },
                  }),
              after: {
                version: String(row.version),
                state: row.state,
                kind: row.kind,
                slugChanged: String(previous !== null && previous.slug !== value.slug),
              },
              authorisingSource: 'media.administer',
            }),
          });

          return toSeries(row);
        });
      } catch (error) {
        refuse(error);
      }
    },

    async playlists(query) {
      const rows = await db.playlist.findMany({
        where: {
          ...(query.state === null ? {} : { state: query.state }),
          ...textMatch(query.text),
        },
        select: PLAYLIST_SELECT,
        orderBy: [...RECENTLY_CHANGED],
        skip: boundedOffset(query.offset),
        take: MEDIA_PAGE + 1,
      });
      return playlistPage(rows);
    },

    async playlist(id) {
      const loaded = await loadPlaylist(db, id);
      return loaded === null ? null : playlistDetail(loaded);
    },

    async savePlaylist({ actorId, id, expectedVersion, value }) {
      try {
        return await db.$transaction(async (tx) => {
          const playlistId = id ?? randomUUID();
          const previous =
            id === null
              ? null
              : await tx.playlist.findFirst({
                  where: { id },
                  select: { slug: true, state: true, version: true },
                });
          if (id !== null && (previous === null || previous.version !== expectedVersion))
            throw new MediaDataError('conflict');

          const data = {
            slug: value.slug,
            primaryLocale: value.primaryLocale,
            state: value.state,
            updatedAt: new Date(),
          };
          if (id !== null) {
            const changed = await tx.playlist.updateMany({
              where: { id, version: expectedVersion ?? UNMATCHABLE_VERSION },
              data: { ...data, version: { increment: 1 } },
            });
            if (changed.count !== 1) throw new MediaDataError('conflict');
          } else {
            await tx.playlist.create({ data: { ...data, id: playlistId } });
          }

          await tx.playlistLabel.deleteMany({ where: { playlistId } });
          await tx.playlistLabel.createMany({
            data: value.labels.map((label) => ({ playlistId, ...label })),
          });

          const row = await tx.playlist.findFirst({
            where: { id: playlistId },
            select: PLAYLIST_SELECT,
          });
          if (row === null) throw new MediaDataError('conflict');

          await tx.auditLog.create({
            data: auditRow({
              actorType: 'user',
              actorId,
              action: `media.playlist.${previous === null ? 'created' : 'updated'}`,
              targetType: 'playlist',
              targetId: playlistId,
              ...(previous === null
                ? {}
                : {
                    before: { version: String(previous.version), state: previous.state },
                  }),
              after: {
                version: String(row.version),
                state: row.state,
                slugChanged: String(previous !== null && previous.slug !== value.slug),
              },
              authorisingSource: 'media.administer',
            }),
          });

          return toPlaylist(row);
        });
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * THE VERSION IS THE LOCK. The membership the operator was shown is the
     * membership at `expectedVersion`; the conditional update below claims that
     * version and moves it on, so of two operators changing one Playlist at once
     * exactly one succeeds and the other is told it changed. Positions are
     * rewritten densely from zero, which the unique key and the CHECK bound hold.
     */
    async setPlaylistVideos({ actorId, playlistId, expectedVersion, videoIds, change }) {
      try {
        return await db.$transaction(async (tx) => {
          const claimed = await tx.playlist.updateMany({
            where: { id: playlistId, version: expectedVersion },
            data: { version: { increment: 1 }, updatedAt: new Date() },
          });
          if (claimed.count !== 1) throw new MediaDataError('conflict');

          await tx.playlistVideo.deleteMany({ where: { playlistId } });
          if (videoIds.length > 0)
            await tx.playlistVideo.createMany({
              data: videoIds.map((videoId, position) => ({
                playlistId,
                videoId,
                position,
              })),
            });

          const loaded = await loadPlaylist(tx, playlistId);
          if (loaded === null) throw new MediaDataError('conflict');
          const detail = playlistDetail(loaded);

          await tx.auditLog.create({
            data: auditRow({
              actorType: 'user',
              actorId,
              action: 'media.playlist.membership.changed',
              targetType: 'playlist',
              targetId: playlistId,
              before: { version: String(expectedVersion) },
              after: {
                version: String(detail.version),
                change,
                videos: String(videoIds.length),
              },
              authorisingSource: 'media.administer',
            }),
          });

          return detail;
        });
      } catch (error) {
        refuse(error);
      }
    },
  };
}

/* ===========================================================================
 * Public reads
 * ========================================================================= */

/** At most one Collection's worth of Videos is described in one read. */
const REFERENCE_BATCH = 100;
/** How many Videos an editor's selector offers at once. */
const REFERENCE_CHOICES = 25;
const REFERENCE_SELECT = {
  id: true,
  slug: true,
  labels: { select: { locale: true, title: true }, orderBy: { locale: 'asc' as const } },
} satisfies Prisma.VideoSelect;

export function createMediaPublicReader(): MediaPublicReaderPort {
  const db = getDatabaseClient();

  return {
    ...audioPublicReader(),
    ...photoPublicReader(),

    async videos(query) {
      const rows = await db.video.findMany({
        where: {
          // The filters NARROW the public predicate; none of them can widen it.
          ...PUBLISHED,
          ...(query.featured ? { isFeatured: true } : {}),
          ...(query.format === null ? {} : { format: query.format }),
          ...(query.language === null ? {} : { languageCode: query.language }),
          ...(query.series === null
            ? {}
            : { seriesId: query.series, series: { state: 'published' } }),
          ...(query.topic === null ? {} : { topics: { some: { topicId: query.topic } } }),
          ...(query.speaker === null
            ? {}
            : { speakers: { some: { personId: query.speaker } } }),
        },
        select: LISTING_SELECT,
        orderBy: [...LATEST],
        skip: boundedOffset(query.offset),
        take: MEDIA_PAGE + 1,
      });
      return videoPage(rows);
    },

    async video(slug) {
      const row = await db.video.findFirst({
        where: { slug, ...PUBLISHED },
        include: DETAIL_INCLUDE,
      });
      return row === null ? null : toRecord(row, true);
    },

    async videoCanonicalSlug(slug) {
      const row = await db.videoSlugHistory.findFirst({
        where: { slug, video: PUBLISHED },
        select: { video: { select: { slug: true } } },
      });
      return row?.video.slug ?? null;
    },

    async videoPlaylists(videoId) {
      const rows = await db.playlistVideo.findMany({
        where: { videoId, video: PUBLISHED, playlist: PUBLISHED },
        select: { playlist: { select: PLAYLIST_SELECT } },
        orderBy: [{ playlist: { slug: 'asc' } }],
        take: APPEARANCES,
      });
      return rows.map((row) => toPlaylist(row.playlist));
    },

    async seriesList(kind, offset) {
      const rows = await db.series.findMany({
        where: { kind, ...PUBLISHED },
        select: SERIES_SELECT,
        orderBy: [{ slug: 'asc' }, { id: 'asc' }],
        skip: boundedOffset(offset),
        take: MEDIA_PAGE + 1,
      });
      return seriesPage(rows);
    },

    async series(slug) {
      const row = await db.series.findFirst({
        where: { slug, ...PUBLISHED },
        select: SERIES_SELECT,
      });
      return row === null ? null : toSeries(row);
    },

    /**
     * THE KIND AND THE SLUG TOGETHER, so a former series slug of what is now a
     * programme redirects in ONE hop to `/watch/programs/{current}` rather than
     * through `/watch/series/{current}` first (ROUTE_MAP.md §9.7).
     */
    async seriesCanonical(slug) {
      const row = await db.seriesSlugHistory.findFirst({
        where: { slug, series: PUBLISHED },
        select: { series: { select: { slug: true, kind: true } } },
      });
      return row === null
        ? null
        : { kind: row.series.kind as SeriesKind, slug: row.series.slug };
    },

    async seriesVideos(seriesId, offset) {
      const rows = await db.video.findMany({
        where: { seriesId, ...PUBLISHED, series: PUBLISHED },
        select: LISTING_SELECT,
        orderBy: [...EPISODES],
        skip: boundedOffset(offset),
        take: MEDIA_PAGE + 1,
      });
      return videoPage(rows);
    },

    async playlists(offset) {
      const rows = await db.playlist.findMany({
        where: PUBLISHED,
        select: PLAYLIST_SELECT,
        orderBy: [{ slug: 'asc' }, { id: 'asc' }],
        skip: boundedOffset(offset),
        take: MEDIA_PAGE + 1,
      });
      return playlistPage(rows);
    },

    async playlist(slug) {
      const row = await db.playlist.findFirst({
        where: { slug, ...PUBLISHED },
        select: PLAYLIST_SELECT,
      });
      return row === null ? null : toPlaylist(row);
    },

    async playlistCanonicalSlug(slug) {
      const row = await db.playlistSlugHistory.findFirst({
        where: { slug, playlist: PUBLISHED },
        select: { playlist: { select: { slug: true } } },
      });
      return row?.playlist.slug ?? null;
    },

    async playlistVideos(playlistId, offset) {
      const rows = await db.playlistVideo.findMany({
        where: { playlistId, playlist: PUBLISHED, video: PUBLISHED },
        select: { video: { select: LISTING_SELECT } },
        orderBy: [{ position: 'asc' }],
        skip: boundedOffset(offset),
        take: MEDIA_PAGE + 1,
      });
      return videoPage(rows.map((row) => row.video));
    },

    async speakerFacets(offset) {
      const rows = await db.videoSpeaker.groupBy({
        by: ['personId'],
        where: { video: PUBLISHED },
        _count: { videoId: true },
        orderBy: [{ _count: { videoId: 'desc' } }, { personId: 'asc' }],
        skip: boundedOffset(offset),
        take: MEDIA_FACET_PAGE + 1,
      });
      return {
        items: rows
          .slice(0, MEDIA_FACET_PAGE)
          .map((row) => ({ id: row.personId, videos: row._count.videoId })),
        hasMore: rows.length > MEDIA_FACET_PAGE,
      };
    },

    async sitemap(kind, offset, limit) {
      const window = {
        orderBy: [{ slug: 'asc' as const }, { id: 'asc' as const }],
        skip: boundedOffset(offset),
        take: bounded(limit, 5000),
      };
      const locales = { select: { locale: true }, orderBy: { locale: 'asc' as const } };
      if (kind === 'series') {
        const rows = await db.series.findMany({
          where: PUBLISHED,
          select: { slug: true, kind: true, updatedAt: true, labels: locales },
          ...window,
        });
        return rows.map((row) => ({
          slug: row.slug,
          seriesKind: row.kind as SeriesKind,
          locales: row.labels.map((label) => label.locale),
          updatedAt: row.updatedAt,
        }));
      }
      const rows =
        kind === 'video'
          ? await db.video.findMany({
              where: PUBLISHED,
              select: { slug: true, updatedAt: true, labels: locales },
              ...window,
            })
          : await db.playlist.findMany({
              where: PUBLISHED,
              select: { slug: true, updatedAt: true, labels: locales },
              ...window,
            });
      return rows.map((row) => ({
        slug: row.slug,
        seriesKind: null,
        locales: row.labels.map((label) => label.locale),
        updatedAt: row.updatedAt,
      }));
    },

    async searchVideo(id) {
      const row = await db.video.findFirst({
        where: { id, ...PUBLISHED },
        select: {
          id: true,
          version: true,
          primaryLocale: true,
          languageCode: true,
          publishedOn: true,
          transcript: true,
          labels: LABELS,
          topics: { select: { topicId: true }, orderBy: { topicId: 'asc' } },
        },
      });
      if (row === null) return null;
      return {
        id: row.id,
        stamp: String(row.version),
        primaryLocale: row.primaryLocale as Locale,
        labels: labelsOf(row.labels),
        languageCode: row.languageCode,
        year: row.publishedOn === null ? null : row.publishedOn.getUTCFullYear(),
        topicIds: row.topics.map((entry) => entry.topicId),
        transcript: row.transcript,
      };
    },

    async searchVideos({ after, limit }) {
      const rows = await db.video.findMany({
        where: { ...PUBLISHED, ...(after === null ? {} : { id: { gt: after } }) },
        select: { id: true, version: true },
        orderBy: { id: 'asc' },
        take: bounded(limit, 500),
      });
      return rows.map((row) => ({ id: row.id, stamp: String(row.version) }));
    },

    // Phase 15 — the Video reference surface an Editorial Collection is
    // composed from. PUBLISHED VIDEOS ONLY, so no caller learns a draft's
    // title; identity, current slug and titles, nothing about the provider.
    async videoReferences(ids) {
      if (ids.length === 0) return [];
      if (ids.length > REFERENCE_BATCH)
        throw new Error('Media reference batch exceeds its bound.');
      return db.video.findMany({
        where: { id: { in: [...new Set(ids)] }, ...PUBLISHED },
        select: REFERENCE_SELECT,
        orderBy: { id: 'asc' },
      });
    },

    async videoChoices(text, limit) {
      return db.video.findMany({
        where: { ...PUBLISHED, ...textMatch(text) },
        select: REFERENCE_SELECT,
        orderBy: [{ publishedOn: 'desc' }, { id: 'asc' }],
        take: bounded(limit, REFERENCE_CHOICES),
      });
    },

    async publicVideoTargets(ids) {
      if (ids.length === 0) return [];
      if (ids.length > TARGET_BATCH)
        throw new Error('Media search batch exceeds its bound.');
      return db.video.findMany({
        where: { id: { in: [...ids] }, ...PUBLISHED },
        select: { id: true, slug: true },
        orderBy: { id: 'asc' },
      });
    },
  };
}
