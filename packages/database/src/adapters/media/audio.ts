import 'server-only';

import { randomUUID } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import type { Locale } from '@minhaj/contracts';
import {
  MEDIA_PAGE,
  type AudioSeriesPage,
  type AudioSeriesRecord,
  type AudioTrackListing,
  type AudioTrackPage,
  type AudioTrackRecord,
  type AudioTrackValue,
  type MediaAssetRelationPort,
  type MediaPersistencePort,
  type MediaPublicReaderPort,
  type MediaState,
} from '@minhaj/contracts/media';

import { auditRow } from '../../audit-row.ts';
import { getDatabaseClient } from '../../client.ts';
import { requestSearchIndexing } from '../../search-intent.ts';
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
 * The Media persistence adapter's AUDIO half — AudioTrack and AudioSeries
 * (DOMAIN_MODEL.md §8.1, §11; DELIVERY_PLAN.md Phase 11).
 *
 * OWNED BY THE MEDIA CONTEXT, hosted here. Its administrative and public reads
 * are spread into the same two factories as the Video half
 * (`./persistence.ts`), so Media still has one persistence port and one public
 * reader, and a third, narrow factory answers the serving policy's one
 * question (`createMediaAssetRelations`).
 *
 * ONE PUBLIC PREDICATE PER AGGREGATE, applied IN THE QUERY: an AudioTrack or an
 * AudioSeries is public when it is `published`. A track's AudioSeries is shown
 * with it only while that series is itself published, and a series lists only
 * its published tracks.
 *
 * THE ASSET IS AN IDENTIFIER HERE, NEVER A ROW. Media records WHICH asset a
 * track serves and nothing about it: no storage key, no size, no scan state is
 * read from Storage's table. What the file is and whether its bytes may leave
 * the disk is decided by `StorageServicePort`, per request.
 *
 * EVERY WRITE IS ONE TRANSACTION under an expected version: the row, its
 * replaced relation sets, its slug reservation (by trigger), its audit entry and
 * — for a track — its durable search intent commit together or not at all.
 */

/* ===========================================================================
 * Query fragments
 * ========================================================================= */

const SPEAKERS = {
  select: { personId: true },
  orderBy: [{ position: 'asc' }, { personId: 'asc' }],
} satisfies Prisma.AudioTrack$speakersArgs;

/** What a row needs: never the transcript. */
const LISTING_SELECT = {
  id: true,
  slug: true,
  primaryLocale: true,
  state: true,
  languageCode: true,
  durationSeconds: true,
  recordedOn: true,
  seriesPosition: true,
  assetId: true,
  version: true,
  updatedAt: true,
  labels: LABELS,
  speakers: SPEAKERS,
} satisfies Prisma.AudioTrackSelect;

const DETAIL_INCLUDE = {
  labels: LABELS,
  speakers: SPEAKERS,
  topics: { select: { topicId: true }, orderBy: { topicId: 'asc' } },
  series: {
    select: { id: true, slug: true, primaryLocale: true, state: true, labels: LABELS },
  },
} satisfies Prisma.AudioTrackInclude;

const SERIES_SELECT = {
  id: true,
  slug: true,
  primaryLocale: true,
  state: true,
  version: true,
  updatedAt: true,
  labels: LABELS,
} satisfies Prisma.AudioSeriesSelect;

/**
 * Most recently recorded first. SQL Server sorts NULL lowest, so a descending
 * order puts an undated track last, and the slug — unique — makes it total.
 */
const LATEST = [{ recordedOn: 'desc' }, { slug: 'asc' }, { id: 'asc' }] as const;
const IN_SERIES = [{ seriesPosition: 'asc' }, { id: 'asc' }] as const;

/** How many AudioSeries the track form offers. */
const SERIES_CHOICES = 200;

/* ===========================================================================
 * Mapping
 * ========================================================================= */

interface ListingRow {
  readonly id: string;
  readonly slug: string;
  readonly primaryLocale: string;
  readonly state: string;
  readonly languageCode: string;
  readonly durationSeconds: number | null;
  readonly recordedOn: Date | null;
  readonly seriesPosition: number | null;
  readonly assetId: string | null;
  readonly version: number;
  readonly updatedAt: Date;
  readonly labels: readonly LabelRow[];
  readonly speakers: readonly { readonly personId: string }[];
}

interface DetailRow extends ListingRow {
  readonly transcript: string | null;
  readonly topics: readonly { readonly topicId: string }[];
  readonly series: {
    readonly id: string;
    readonly slug: string;
    readonly primaryLocale: string;
    readonly state: string;
    readonly labels: readonly LabelRow[];
  } | null;
}

interface SeriesRow {
  readonly id: string;
  readonly slug: string;
  readonly primaryLocale: string;
  readonly state: string;
  readonly version: number;
  readonly updatedAt: Date;
  readonly labels: readonly LabelRow[];
}

function toListing(row: ListingRow): AudioTrackListing {
  return {
    id: row.id,
    slug: row.slug,
    primaryLocale: row.primaryLocale as Locale,
    state: row.state as MediaState,
    languageCode: row.languageCode,
    labels: labelsOf(row.labels),
    durationSeconds: row.durationSeconds,
    recordedOn: isoDate(row.recordedOn),
    seriesPosition: row.seriesPosition,
    hasAudio: row.assetId !== null,
    speakerIds: row.speakers.map((entry) => entry.personId),
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

/**
 * A track with its series context. `publicOnly` withholds an unpublished
 * AudioSeries from a public read: the track is public, the run it sits in may
 * not be.
 */
function toRecord(row: DetailRow, publicOnly: boolean): AudioTrackRecord {
  const series =
    row.series === null ||
    row.seriesPosition === null ||
    (publicOnly && row.series.state !== 'published')
      ? null
      : {
          id: row.series.id,
          slug: row.series.slug,
          primaryLocale: row.series.primaryLocale as Locale,
          labels: labelsOf(row.series.labels),
          state: row.series.state as MediaState,
          position: row.seriesPosition,
        };
  return {
    id: row.id,
    slug: row.slug,
    primaryLocale: row.primaryLocale as Locale,
    state: row.state as MediaState,
    languageCode: row.languageCode,
    labels: labelsOf(row.labels),
    durationSeconds: row.durationSeconds,
    recordedOn: isoDate(row.recordedOn),
    transcript: row.transcript,
    assetId: row.assetId,
    series,
    speakerIds: row.speakers.map((entry) => entry.personId),
    topicIds: row.topics.map((entry) => entry.topicId),
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

function toSeries(row: SeriesRow): AudioSeriesRecord {
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

function trackPage(rows: readonly ListingRow[]): AudioTrackPage {
  return {
    items: rows.slice(0, MEDIA_PAGE).map(toListing),
    hasMore: rows.length > MEDIA_PAGE,
  };
}

function seriesPage(rows: readonly SeriesRow[]): AudioSeriesPage {
  return {
    items: rows.slice(0, MEDIA_PAGE).map(toSeries),
    hasMore: rows.length > MEDIA_PAGE,
  };
}

/* ===========================================================================
 * Writing
 * ========================================================================= */

function trackColumns(
  value: AudioTrackValue,
): Omit<Prisma.AudioTrackUncheckedCreateInput, 'id'> {
  return {
    slug: value.slug,
    primaryLocale: value.primaryLocale,
    state: value.state,
    languageCode: value.languageCode,
    durationSeconds: value.durationSeconds,
    recordedOn: utcDate(value.recordedOn),
    transcript: value.transcript,
    seriesId: value.seriesId,
    seriesPosition: value.seriesPosition,
    updatedAt: new Date(),
  };
}

async function replaceTrackSets(tx: Client, trackId: string, value: AudioTrackValue) {
  await tx.audioTrackLabel.deleteMany({ where: { trackId } });
  await tx.audioTrackLabel.createMany({
    data: value.labels.map((label) => ({ trackId, ...label })),
  });

  await tx.audioTrackSpeaker.deleteMany({ where: { trackId } });
  if (value.speakerIds.length > 0)
    await tx.audioTrackSpeaker.createMany({
      data: value.speakerIds.map((personId, position) => ({
        trackId,
        personId,
        position,
      })),
    });

  await tx.audioTrackTopic.deleteMany({ where: { trackId } });
  if (value.topicIds.length > 0)
    await tx.audioTrackTopic.createMany({
      data: value.topicIds.map((topicId) => ({ trackId, topicId })),
    });
}

/* ===========================================================================
 * Administration
 * ========================================================================= */

type AudioPersistence = Pick<
  MediaPersistencePort,
  | 'audioTracks'
  | 'audioTrack'
  | 'saveAudioTrack'
  | 'attachAudioAsset'
  | 'audioSeriesDirectory'
  | 'audioSeries'
  | 'audioSeriesTracks'
  | 'audioSeriesChoices'
  | 'saveAudioSeries'
>;

export function audioPersistence(): AudioPersistence {
  const db = getDatabaseClient();
  return {
    async audioTracks(query) {
      const rows = await db.audioTrack.findMany({
        where: {
          ...(query.state === null ? {} : { state: query.state }),
          ...textMatch(query.text),
        },
        select: LISTING_SELECT,
        orderBy: [...RECENTLY_CHANGED],
        skip: boundedOffset(query.offset),
        take: MEDIA_PAGE + 1,
      });
      return trackPage(rows);
    },

    async audioTrack(id) {
      const row = await db.audioTrack.findFirst({
        where: { id },
        include: DETAIL_INCLUDE,
      });
      return row === null ? null : toRecord(row, false);
    },

    async saveAudioTrack({ actorId, id, expectedVersion, value }) {
      try {
        return await db.$transaction(async (tx) => {
          const trackId = id ?? randomUUID();
          const previous =
            id === null
              ? null
              : await tx.audioTrack.findFirst({
                  where: { id },
                  select: {
                    slug: true,
                    state: true,
                    version: true,
                    assetId: true,
                    seriesId: true,
                    languageCode: true,
                  },
                });
          if (id !== null && (previous === null || previous.version !== expectedVersion))
            throw new MediaDataError('conflict');

          // A published track always has something to hear. Read under the
          // same expected version the update below claims, so an attachment
          // made in between is a conflict, not a race this check lost.
          if (value.state === 'published' && (previous?.assetId ?? null) === null)
            throw new MediaDataError('no-audio');

          const data = trackColumns(value);
          if (id !== null) {
            const changed = await tx.audioTrack.updateMany({
              where: { id, version: expectedVersion ?? UNMATCHABLE_VERSION },
              data: { ...data, version: { increment: 1 } },
            });
            if (changed.count !== 1) throw new MediaDataError('conflict');
          } else {
            // The slug trigger reserves the new slug in this same transaction.
            await tx.audioTrack.create({ data: { ...data, id: trackId } });
          }

          await replaceTrackSets(tx, trackId, value);

          const row = await tx.audioTrack.findFirst({
            where: { id: trackId },
            include: DETAIL_INCLUDE,
          });
          if (row === null) throw new MediaDataError('conflict');

          // DURABLE SEARCH INTENT, committed with the change (ARCHITECTURE.md
          // §8.5). Unconditional: the indexer re-projects from current public
          // state, so a redundant request costs one idempotent projection.
          await requestSearchIndexing(tx, 'audio', trackId);

          // Identifiers, states and counts — never a title, a description or a
          // transcript (SECURITY_BASELINE.md §13.4).
          await tx.auditLog.create({
            data: auditRow({
              actorType: 'user',
              actorId,
              action: `media.audio.track.${previous === null ? 'created' : 'updated'}`,
              targetType: 'audio-track',
              targetId: trackId,
              ...(previous === null
                ? {}
                : {
                    before: {
                      version: String(previous.version),
                      state: previous.state,
                    },
                  }),
              after: {
                version: String(row.version),
                state: row.state,
                slugChanged: String(previous !== null && previous.slug !== value.slug),
                seriesChanged: String(
                  previous !== null && previous.seriesId !== value.seriesId,
                ),
                languageChanged: String(
                  previous !== null && previous.languageCode !== value.languageCode,
                ),
                transcript: String(value.transcript !== null),
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

    /**
     * THE VERSION IS THE LOCK. The track the operator uploaded against is the
     * track at `expectedVersion`; the conditional update claims that version and
     * moves it on, so of two operators replacing one track's file at once exactly
     * one succeeds and the other is told it changed.
     *
     * THE PREVIOUS ASSET IS NOT TOUCHED. It stays in Storage exactly as it was —
     * nothing here deletes, rewrites or moves it — and simply stops being the one
     * this track serves, so a failed replacement can never cost the last good
     * file (§32 of the phase contract).
     */
    async attachAudioAsset({ actorId, trackId, expectedVersion, assetId }) {
      try {
        return await db.$transaction(async (tx) => {
          const previous = await tx.audioTrack.findFirst({
            where: { id: trackId },
            select: { version: true, assetId: true, state: true },
          });
          if (previous === null) throw new MediaDataError('not-found');
          if (previous.version !== expectedVersion) throw new MediaDataError('conflict');

          const changed = await tx.audioTrack.updateMany({
            where: { id: trackId, version: expectedVersion },
            data: { assetId, version: { increment: 1 }, updatedAt: new Date() },
          });
          if (changed.count !== 1) throw new MediaDataError('conflict');

          const row = await tx.audioTrack.findFirst({
            where: { id: trackId },
            include: DETAIL_INCLUDE,
          });
          if (row === null) throw new MediaDataError('conflict');

          // The projection carries nothing about the file, but it is stamped by
          // the version this change moved, so the re-projection is owed — and
          // requested unconditionally, as every Media mutation does.
          await requestSearchIndexing(tx, 'audio', trackId);

          await tx.auditLog.create({
            data: auditRow({
              actorType: 'user',
              actorId,
              action: `media.audio.asset.${previous.assetId === null ? 'attached' : 'replaced'}`,
              targetType: 'audio-track',
              targetId: trackId,
              before: {
                version: String(previous.version),
                state: previous.state,
                assetId: previous.assetId ?? 'none',
              },
              after: { version: String(row.version), assetId },
              authorisingSource: 'media.administer',
            }),
          });

          return toRecord(row, false);
        });
      } catch (error) {
        refuse(error);
      }
    },

    async audioSeriesDirectory(query) {
      const rows = await db.audioSeries.findMany({
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

    async audioSeries(id) {
      const row = await db.audioSeries.findFirst({
        where: { id },
        select: SERIES_SELECT,
      });
      return row === null ? null : toSeries(row);
    },

    async audioSeriesTracks(seriesId, offset) {
      const rows = await db.audioTrack.findMany({
        where: { seriesId },
        select: LISTING_SELECT,
        orderBy: [...IN_SERIES],
        skip: boundedOffset(offset),
        take: MEDIA_PAGE + 1,
      });
      return trackPage(rows);
    },

    async audioSeriesChoices() {
      const rows = await db.audioSeries.findMany({
        select: SERIES_SELECT,
        orderBy: [{ slug: 'asc' }],
        take: SERIES_CHOICES,
      });
      return rows.map(toSeries);
    },

    async saveAudioSeries({ actorId, id, expectedVersion, value }) {
      try {
        return await db.$transaction(async (tx) => {
          const seriesId = id ?? randomUUID();
          const previous =
            id === null
              ? null
              : await tx.audioSeries.findFirst({
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
            const changed = await tx.audioSeries.updateMany({
              where: { id, version: expectedVersion ?? UNMATCHABLE_VERSION },
              data: { ...data, version: { increment: 1 } },
            });
            if (changed.count !== 1) throw new MediaDataError('conflict');
          } else {
            await tx.audioSeries.create({ data: { ...data, id: seriesId } });
          }

          await tx.audioSeriesLabel.deleteMany({ where: { seriesId } });
          await tx.audioSeriesLabel.createMany({
            data: value.labels.map((label) => ({ seriesId, ...label })),
          });

          const row = await tx.audioSeries.findFirst({
            where: { id: seriesId },
            select: SERIES_SELECT,
          });
          if (row === null) throw new MediaDataError('conflict');

          await tx.auditLog.create({
            data: auditRow({
              actorType: 'user',
              actorId,
              action: `media.audio.series.${previous === null ? 'created' : 'updated'}`,
              targetType: 'audio-series',
              targetId: seriesId,
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

          return toSeries(row);
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

type AudioPublicReader = Pick<
  MediaPublicReaderPort,
  | 'audioTracks'
  | 'audioTrack'
  | 'audioTrackCanonicalSlug'
  | 'audioSeriesList'
  | 'audioSeries'
  | 'audioSeriesCanonicalSlug'
  | 'audioSeriesTracks'
  | 'audioSitemap'
  | 'searchAudio'
  | 'searchAudioTracks'
  | 'publicAudioTargets'
>;

export function audioPublicReader(): AudioPublicReader {
  const db = getDatabaseClient();
  return {
    async audioTracks(query) {
      const rows = await db.audioTrack.findMany({
        where: {
          // The filters NARROW the public predicate; none of them can widen it.
          ...PUBLISHED,
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
      return trackPage(rows);
    },

    async audioTrack(slug) {
      const row = await db.audioTrack.findFirst({
        where: { slug, ...PUBLISHED },
        include: DETAIL_INCLUDE,
      });
      return row === null ? null : toRecord(row, true);
    },

    async audioTrackCanonicalSlug(slug) {
      const row = await db.audioTrackSlugHistory.findFirst({
        where: { slug, track: PUBLISHED },
        select: { track: { select: { slug: true } } },
      });
      return row?.track.slug ?? null;
    },

    async audioSeriesList(offset) {
      const rows = await db.audioSeries.findMany({
        where: PUBLISHED,
        select: SERIES_SELECT,
        orderBy: [{ slug: 'asc' }, { id: 'asc' }],
        skip: boundedOffset(offset),
        take: MEDIA_PAGE + 1,
      });
      return seriesPage(rows);
    },

    async audioSeries(slug) {
      const row = await db.audioSeries.findFirst({
        where: { slug, ...PUBLISHED },
        select: SERIES_SELECT,
      });
      return row === null ? null : toSeries(row);
    },

    async audioSeriesCanonicalSlug(slug) {
      const row = await db.audioSeriesSlugHistory.findFirst({
        where: { slug, series: PUBLISHED },
        select: { series: { select: { slug: true } } },
      });
      return row?.series.slug ?? null;
    },

    async audioSeriesTracks(seriesId, offset) {
      const rows = await db.audioTrack.findMany({
        where: { seriesId, ...PUBLISHED, series: PUBLISHED },
        select: LISTING_SELECT,
        orderBy: [...IN_SERIES],
        skip: boundedOffset(offset),
        take: MEDIA_PAGE + 1,
      });
      return trackPage(rows);
    },

    async audioSitemap(kind, offset, limit) {
      const window = {
        orderBy: [{ slug: 'asc' as const }, { id: 'asc' as const }],
        skip: boundedOffset(offset),
        take: bounded(limit, 5000),
      };
      const locales = { select: { locale: true }, orderBy: { locale: 'asc' as const } };
      const rows =
        kind === 'track'
          ? await db.audioTrack.findMany({
              where: PUBLISHED,
              select: { slug: true, updatedAt: true, labels: locales },
              ...window,
            })
          : await db.audioSeries.findMany({
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

    async searchAudio(id) {
      const row = await db.audioTrack.findFirst({
        where: { id, ...PUBLISHED },
        select: {
          id: true,
          version: true,
          primaryLocale: true,
          languageCode: true,
          recordedOn: true,
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
        year: row.recordedOn === null ? null : row.recordedOn.getUTCFullYear(),
        topicIds: row.topics.map((entry) => entry.topicId),
        transcript: row.transcript,
      };
    },

    async searchAudioTracks({ after, limit }) {
      const rows = await db.audioTrack.findMany({
        where: { ...PUBLISHED, ...(after === null ? {} : { id: { gt: after } }) },
        select: { id: true, version: true },
        orderBy: { id: 'asc' },
        take: bounded(limit, 500),
      });
      return rows.map((row) => ({ id: row.id, stamp: String(row.version) }));
    },

    async publicAudioTargets(ids) {
      if (ids.length === 0) return [];
      if (ids.length > TARGET_BATCH)
        throw new Error('Media search batch exceeds its bound.');
      return db.audioTrack.findMany({
        where: { id: { in: [...ids] }, ...PUBLISHED },
        select: { id: true, slug: true },
        orderBy: { id: 'asc' },
      });
    },
  };
}

/* ===========================================================================
 * The serving policy's relation read
 * ========================================================================= */

/**
 * Which asset a track records, and the track's state — for ANY track.
 *
 * Its own factory, typed by its own port, so no public page's module graph
 * holds a read that answers for drafts (`MediaAssetRelationPort`).
 */
export function createMediaAssetRelations(): MediaAssetRelationPort {
  const db = getDatabaseClient();
  return {
    async audioAsset(trackId) {
      const row = await db.audioTrack.findUnique({
        where: { id: trackId },
        select: { state: true, assetId: true },
      });
      return row === null
        ? null
        : { state: row.state as MediaState, assetId: row.assetId };
    },
  };
}
