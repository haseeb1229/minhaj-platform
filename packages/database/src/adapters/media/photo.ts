import 'server-only';

import { randomUUID } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import type { Locale } from '@minhaj/contracts';
import {
  MEDIA_PAGE,
  type GalleryDetail,
  type GalleryPage,
  type GalleryRecord,
  type MediaPersistencePort,
  type MediaPublicReaderPort,
  type MediaState,
  type PhotoLabel,
  type PhotoPage,
  type PhotoRecord,
  type PhotoValue,
  type PublicGallery,
} from '@minhaj/contracts/media';

import { auditRow } from '../../audit-row.ts';
import { getDatabaseClient } from '../../client.ts';
import {
  bounded,
  boundedOffset,
  LABELS,
  labelsOf,
  MediaDataError,
  PUBLISHED,
  RECENTLY_CHANGED,
  refuse,
  textMatch,
  UNMATCHABLE_VERSION,
  type Client,
  type LabelRow,
} from './shared.ts';

/**
 * The Media persistence adapter's PHOTOGRAPH half — Photo, Gallery and
 * GalleryItem (DOMAIN_MODEL.md §11; DELIVERY_PLAN.md Phase 12).
 *
 * OWNED BY THE MEDIA CONTEXT, hosted here, and spread into the same two
 * factories as the Video and audio halves (`./persistence.ts`), so Media keeps
 * one persistence port and one public reader.
 *
 * ONE PUBLIC PREDICATE PER AGGREGATE, IN THE QUERY. A Photo is public when it is
 * `published` (which the database guarantees means it has an image). A Gallery
 * is public when it is `published`; it is LISTED — and appears in the sitemap —
 * only while it holds at least one public Photo, so no visitor meets an empty
 * card. Inside a public Gallery only public Photos are ever read.
 *
 * NO N+1. A page of Galleries is read with its public counts and covers in two
 * further bounded queries for the whole page, never one per card.
 *
 * THE ASSET IS AN IDENTIFIER HERE, NEVER A ROW: nothing of Storage's table is
 * read. Whether bytes may leave the disk is decided per request by
 * `StorageServicePort`.
 *
 * EVERY WRITE IS ONE TRANSACTION under an expected version: the row, its
 * replaced labels or membership, its slug reservation (by trigger) and its
 * audit entry commit together or not at all.
 */

/* ===========================================================================
 * Query fragments
 * ========================================================================= */

const PHOTO_LABELS = {
  select: { locale: true, altText: true, caption: true },
  orderBy: { locale: 'asc' },
} satisfies Prisma.Photo$labelsArgs;

const PHOTO_SELECT = {
  id: true,
  primaryLocale: true,
  state: true,
  credit: true,
  takenYear: true,
  takenMonth: true,
  takenDay: true,
  assetId: true,
  width: true,
  height: true,
  version: true,
  updatedAt: true,
  labels: PHOTO_LABELS,
} satisfies Prisma.PhotoSelect;

const GALLERY_SELECT = {
  id: true,
  slug: true,
  primaryLocale: true,
  state: true,
  version: true,
  updatedAt: true,
  labels: LABELS,
} satisfies Prisma.GallerySelect;

/** Recently ADDED first — creation order, never presented as a historical date. */
const RECENTLY_ADDED = [{ createdAt: 'desc' }, { id: 'asc' }] as const;

/**
 * The archive's order: latest known date first. SQL Server sorts NULL lowest,
 * so within a year a Photo known only to the year follows the dated months,
 * and the identifier makes the order total.
 */
const HISTORICAL = [
  { takenYear: 'desc' },
  { takenMonth: 'desc' },
  { takenDay: 'desc' },
  { id: 'asc' },
] as const;

/** A public Photo inside a public Gallery. */
const PUBLIC_MEMBER = { photo: PUBLISHED } as const;

/** How many years the archive index may list — far beyond photography's span. */
const ARCHIVE_YEARS = 500;

/** How many Galleries the Photo editor lists a Photo in. */
const PHOTO_GALLERIES = 50;

/* ===========================================================================
 * Mapping
 * ========================================================================= */

interface PhotoRow {
  readonly id: string;
  readonly primaryLocale: string;
  readonly state: string;
  readonly credit: string | null;
  readonly takenYear: number | null;
  readonly takenMonth: number | null;
  readonly takenDay: number | null;
  readonly assetId: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly version: number;
  readonly updatedAt: Date;
  readonly labels: readonly {
    readonly locale: string;
    readonly altText: string | null;
    readonly caption: string | null;
  }[];
}

interface GalleryRow {
  readonly id: string;
  readonly slug: string;
  readonly primaryLocale: string;
  readonly state: string;
  readonly version: number;
  readonly updatedAt: Date;
  readonly labels: readonly LabelRow[];
}

function toPhoto(row: PhotoRow): PhotoRecord {
  return {
    id: row.id,
    primaryLocale: row.primaryLocale as Locale,
    state: row.state as MediaState,
    labels: row.labels.map((label) => ({
      locale: label.locale as Locale,
      altText: label.altText,
      caption: label.caption,
    })),
    credit: row.credit,
    taken:
      row.takenYear === null
        ? null
        : { year: row.takenYear, month: row.takenMonth, day: row.takenDay },
    assetId: row.assetId,
    width: row.width,
    height: row.height,
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

function toGallery(row: GalleryRow): GalleryRecord {
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

function photoPage(rows: readonly PhotoRow[]): PhotoPage {
  return {
    items: rows.slice(0, MEDIA_PAGE).map(toPhoto),
    hasMore: rows.length > MEDIA_PAGE,
  };
}

/**
 * Public counts and covers for a set of published Galleries — TWO queries for
 * the whole set: the per-Gallery count and first public place, then the Photos
 * at exactly those places.
 */
async function withCovers(rows: readonly GalleryRow[]): Promise<PublicGallery[]> {
  if (rows.length === 0) return [];
  const db = getDatabaseClient();
  const summary = await db.galleryItem.groupBy({
    by: ['galleryId'],
    where: { galleryId: { in: rows.map((row) => row.id) }, ...PUBLIC_MEMBER },
    _count: { _all: true },
    _min: { position: true },
  });
  const firsts = summary.flatMap((entry) =>
    entry._min.position === null
      ? []
      : [{ galleryId: entry.galleryId, position: entry._min.position }],
  );
  const covers =
    firsts.length === 0
      ? []
      : await db.galleryItem.findMany({
          where: { OR: firsts },
          select: { galleryId: true, photo: { select: PHOTO_SELECT } },
        });

  return rows.map((row) => ({
    ...toGallery(row),
    photoCount: summary.find((entry) => entry.galleryId === row.id)?._count._all ?? 0,
    cover: (() => {
      const found = covers.find((cover) => cover.galleryId === row.id);
      return found === undefined ? null : toPhoto(found.photo);
    })(),
  }));
}

/** A Gallery's row and its whole ordered membership, read with the caller's client. */
async function loadGallery(
  db: Client,
  id: string,
): Promise<{ readonly row: GalleryRow; readonly members: readonly PhotoRow[] } | null> {
  const row = await db.gallery.findFirst({ where: { id }, select: GALLERY_SELECT });
  if (row === null) return null;
  const members = await db.galleryItem.findMany({
    where: { galleryId: id },
    orderBy: { position: 'asc' },
    select: { photo: { select: PHOTO_SELECT } },
  });
  return { row, members: members.map((member) => member.photo) };
}

function galleryDetail(loaded: {
  readonly row: GalleryRow;
  readonly members: readonly PhotoRow[];
}): GalleryDetail {
  return { ...toGallery(loaded.row), photos: loaded.members.map(toPhoto) };
}

/** Counts, not content: an audit entry never carries a caption or alt text. */
function labelFacts(labels: readonly PhotoLabel[]) {
  return {
    labels: String(labels.length),
    altTexts: String(labels.filter((label) => label.altText !== null).length),
    captions: String(labels.filter((label) => label.caption !== null).length),
  };
}

function photoColumns(value: PhotoValue) {
  return {
    primaryLocale: value.primaryLocale,
    state: value.state,
    credit: value.credit,
    takenYear: value.taken?.year ?? null,
    takenMonth: value.taken?.month ?? null,
    takenDay: value.taken?.day ?? null,
    updatedAt: new Date(),
  };
}

/* ===========================================================================
 * Administration
 * ========================================================================= */

type PhotoPersistence = Pick<
  MediaPersistencePort,
  | 'photos'
  | 'photo'
  | 'photoGalleries'
  | 'savePhoto'
  | 'attachPhotoAsset'
  | 'galleries'
  | 'gallery'
  | 'saveGallery'
  | 'setGalleryPhotos'
>;

export function photoPersistence(): PhotoPersistence {
  const db = getDatabaseClient();
  return {
    async photos(query) {
      const text = query.text;
      const rows = await db.photo.findMany({
        where: {
          ...(query.state === null ? {} : { state: query.state }),
          ...(text === null
            ? {}
            : {
                OR: [
                  { credit: { contains: text } },
                  { labels: { some: { altText: { contains: text } } } },
                  { labels: { some: { caption: { contains: text } } } },
                ],
              }),
          ...(query.gap === 'image' ? { assetId: null } : {}),
          ...(query.gap === 'alt'
            ? { labels: { none: { altText: { not: null } } } }
            : {}),
        },
        select: PHOTO_SELECT,
        orderBy: [...RECENTLY_CHANGED],
        skip: boundedOffset(query.offset),
        take: MEDIA_PAGE + 1,
      });
      return photoPage(rows);
    },

    async photo(id) {
      const row = await db.photo.findFirst({ where: { id }, select: PHOTO_SELECT });
      return row === null ? null : toPhoto(row);
    },

    async photoGalleries(photoId) {
      const rows = await db.galleryItem.findMany({
        where: { photoId },
        select: { gallery: { select: GALLERY_SELECT } },
        orderBy: [{ gallery: { slug: 'asc' } }],
        take: PHOTO_GALLERIES,
      });
      return rows.map((row) => toGallery(row.gallery));
    },

    async savePhoto({ actorId, id, expectedVersion, value }) {
      try {
        return await db.$transaction(async (tx) => {
          const photoId = id ?? randomUUID();
          const previous =
            id === null
              ? null
              : await tx.photo.findFirst({
                  where: { id },
                  select: {
                    state: true,
                    version: true,
                    assetId: true,
                    credit: true,
                    takenYear: true,
                    takenMonth: true,
                    takenDay: true,
                  },
                });
          if (id !== null && (previous === null || previous.version !== expectedVersion))
            throw new MediaDataError('conflict');

          // A published Photo always has an image. Read under the same expected
          // version the update below claims, so an attachment made in between is
          // a conflict, not a race this check lost — and the SQL CHECK refuses it
          // whatever writes.
          if (value.state === 'published' && (previous?.assetId ?? null) === null)
            throw new MediaDataError('no-image');

          const data = photoColumns(value);
          if (id !== null) {
            const changed = await tx.photo.updateMany({
              where: { id, version: expectedVersion ?? UNMATCHABLE_VERSION },
              data: { ...data, version: { increment: 1 } },
            });
            if (changed.count !== 1) throw new MediaDataError('conflict');
          } else {
            await tx.photo.create({ data: { ...data, id: photoId } });
          }

          await tx.photoLabel.deleteMany({ where: { photoId } });
          if (value.labels.length > 0)
            await tx.photoLabel.createMany({
              data: value.labels.map((label) => ({ photoId, ...label })),
            });

          const row = await tx.photo.findFirst({
            where: { id: photoId },
            select: PHOTO_SELECT,
          });
          if (row === null) throw new MediaDataError('conflict');

          // Identifiers, states and counts — never alternative text, a caption,
          // a credit or a date (SECURITY_BASELINE.md §13.4).
          await tx.auditLog.create({
            data: auditRow({
              actorType: 'user',
              actorId,
              action: `media.photo.${previous === null ? 'created' : 'updated'}`,
              targetType: 'photo',
              targetId: photoId,
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
                ...labelFacts(value.labels),
                creditChanged: String(
                  previous !== null && previous.credit !== value.credit,
                ),
                dateChanged: String(
                  previous !== null &&
                    (previous.takenYear !== (value.taken?.year ?? null) ||
                      previous.takenMonth !== (value.taken?.month ?? null) ||
                      previous.takenDay !== (value.taken?.day ?? null)),
                ),
              },
              authorisingSource: 'media.administer',
            }),
          });

          return toPhoto(row);
        });
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * THE VERSION IS THE LOCK, as for an audio file: of two operators replacing
     * one Photo's image at once exactly one succeeds. The previous asset is not
     * touched — it stays in Storage and simply stops being the one this Photo
     * serves, so a failed replacement never costs the last good image.
     */
    async attachPhotoAsset({
      actorId,
      photoId,
      expectedVersion,
      assetId,
      width,
      height,
    }) {
      try {
        return await db.$transaction(async (tx) => {
          const previous = await tx.photo.findFirst({
            where: { id: photoId },
            select: { version: true, assetId: true, state: true },
          });
          if (previous === null) throw new MediaDataError('not-found');
          if (previous.version !== expectedVersion) throw new MediaDataError('conflict');

          const changed = await tx.photo.updateMany({
            where: { id: photoId, version: expectedVersion },
            data: {
              assetId,
              width,
              height,
              version: { increment: 1 },
              updatedAt: new Date(),
            },
          });
          if (changed.count !== 1) throw new MediaDataError('conflict');

          const row = await tx.photo.findFirst({
            where: { id: photoId },
            select: PHOTO_SELECT,
          });
          if (row === null) throw new MediaDataError('conflict');

          await tx.auditLog.create({
            data: auditRow({
              actorType: 'user',
              actorId,
              action: `media.photo.asset.${previous.assetId === null ? 'attached' : 'replaced'}`,
              targetType: 'photo',
              targetId: photoId,
              before: {
                version: String(previous.version),
                state: previous.state,
                assetId: previous.assetId ?? 'none',
              },
              after: {
                version: String(row.version),
                assetId,
                width: String(width),
                height: String(height),
              },
              authorisingSource: 'media.administer',
            }),
          });

          return toPhoto(row);
        });
      } catch (error) {
        refuse(error);
      }
    },

    async galleries(query) {
      const rows = await db.gallery.findMany({
        where: {
          ...(query.state === null ? {} : { state: query.state }),
          ...textMatch(query.text),
        },
        select: GALLERY_SELECT,
        orderBy: [...RECENTLY_CHANGED],
        skip: boundedOffset(query.offset),
        take: MEDIA_PAGE + 1,
      });
      return {
        items: rows.slice(0, MEDIA_PAGE).map(toGallery),
        hasMore: rows.length > MEDIA_PAGE,
      } satisfies GalleryPage;
    },

    async gallery(id) {
      const loaded = await loadGallery(db, id);
      return loaded === null ? null : galleryDetail(loaded);
    },

    async saveGallery({ actorId, id, expectedVersion, value }) {
      try {
        return await db.$transaction(async (tx) => {
          const galleryId = id ?? randomUUID();
          const previous =
            id === null
              ? null
              : await tx.gallery.findFirst({
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
            const changed = await tx.gallery.updateMany({
              where: { id, version: expectedVersion ?? UNMATCHABLE_VERSION },
              data: { ...data, version: { increment: 1 } },
            });
            if (changed.count !== 1) throw new MediaDataError('conflict');
          } else {
            // The slug trigger reserves the new slug in this same transaction.
            await tx.gallery.create({ data: { ...data, id: galleryId } });
          }

          await tx.galleryLabel.deleteMany({ where: { galleryId } });
          await tx.galleryLabel.createMany({
            data: value.labels.map((label) => ({ galleryId, ...label })),
          });

          const row = await tx.gallery.findFirst({
            where: { id: galleryId },
            select: GALLERY_SELECT,
          });
          if (row === null) throw new MediaDataError('conflict');

          await tx.auditLog.create({
            data: auditRow({
              actorType: 'user',
              actorId,
              action: `media.gallery.${previous === null ? 'created' : 'updated'}`,
              targetType: 'gallery',
              targetId: galleryId,
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

          return toGallery(row);
        });
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * THE VERSION IS THE LOCK, as for a Playlist: the membership the operator
     * was shown is the membership at `expectedVersion`, and the conditional
     * update claims that version first — before any membership row is touched
     * — so of two operators changing one Gallery at once exactly one succeeds.
     * Positions are rewritten densely from zero, which the unique key and the
     * position CHECK hold to 240 places. A Photo that does not exist is refused
     * by its foreign key.
     */
    async setGalleryPhotos({ actorId, galleryId, expectedVersion, photoIds, change }) {
      try {
        return await db.$transaction(async (tx) => {
          const claimed = await tx.gallery.updateMany({
            where: { id: galleryId, version: expectedVersion },
            data: { version: { increment: 1 }, updatedAt: new Date() },
          });
          if (claimed.count !== 1) throw new MediaDataError('conflict');

          await tx.galleryItem.deleteMany({ where: { galleryId } });
          if (photoIds.length > 0)
            await tx.galleryItem.createMany({
              data: photoIds.map((photoId, position) => ({
                galleryId,
                photoId,
                position,
              })),
            });

          const loaded = await loadGallery(tx, galleryId);
          if (loaded === null) throw new MediaDataError('conflict');
          const detail = galleryDetail(loaded);

          await tx.auditLog.create({
            data: auditRow({
              actorType: 'user',
              actorId,
              action: 'media.gallery.membership.changed',
              targetType: 'gallery',
              targetId: galleryId,
              before: { version: String(expectedVersion) },
              after: {
                version: String(detail.version),
                change,
                photos: String(photoIds.length),
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

type PhotoPublicReader = Pick<
  MediaPublicReaderPort,
  | 'photos'
  | 'archivePhotos'
  | 'archiveYears'
  | 'archiveMonths'
  | 'galleries'
  | 'gallery'
  | 'galleryCanonicalSlug'
  | 'galleryPhotos'
  | 'gallerySitemap'
>;

/** A published Gallery with at least one public Photo — what is LISTED. */
const LISTED_GALLERY = {
  ...PUBLISHED,
  items: { some: PUBLIC_MEMBER },
} as const;

export function photoPublicReader(): PhotoPublicReader {
  const db = getDatabaseClient();
  return {
    async photos(offset) {
      const rows = await db.photo.findMany({
        where: PUBLISHED,
        select: PHOTO_SELECT,
        orderBy: [...RECENTLY_ADDED],
        skip: boundedOffset(offset),
        take: MEDIA_PAGE + 1,
      });
      return photoPage(rows);
    },

    async archivePhotos(query) {
      const rows = await db.photo.findMany({
        where: {
          // The filters NARROW the public predicate; none can widen it, and an
          // undated Photo is never in the archive.
          ...PUBLISHED,
          takenYear: query.year === null ? { not: null } : query.year,
          ...(query.month === null ? {} : { takenMonth: query.month }),
        },
        select: PHOTO_SELECT,
        orderBy: [...HISTORICAL],
        skip: boundedOffset(query.offset),
        take: MEDIA_PAGE + 1,
      });
      return photoPage(rows);
    },

    async archiveYears() {
      const rows = await db.photo.groupBy({
        by: ['takenYear'],
        where: { ...PUBLISHED, takenYear: { not: null } },
        _count: { _all: true },
        orderBy: { takenYear: 'desc' },
        take: ARCHIVE_YEARS,
      });
      return rows.flatMap((row) =>
        row.takenYear === null ? [] : [{ year: row.takenYear, photos: row._count._all }],
      );
    },

    async archiveMonths(year) {
      const rows = await db.photo.groupBy({
        by: ['takenMonth'],
        where: { ...PUBLISHED, takenYear: year, takenMonth: { not: null } },
        _count: { _all: true },
        orderBy: { takenMonth: 'asc' },
      });
      return rows.flatMap((row) =>
        row.takenMonth === null
          ? []
          : [{ month: row.takenMonth, photos: row._count._all }],
      );
    },

    async galleries(offset) {
      const rows = await db.gallery.findMany({
        where: LISTED_GALLERY,
        select: GALLERY_SELECT,
        orderBy: [...RECENTLY_ADDED],
        skip: boundedOffset(offset),
        take: MEDIA_PAGE + 1,
      });
      return {
        items: await withCovers(rows.slice(0, MEDIA_PAGE)),
        hasMore: rows.length > MEDIA_PAGE,
      };
    },

    async gallery(slug) {
      const row = await db.gallery.findFirst({
        where: { slug, ...PUBLISHED },
        select: GALLERY_SELECT,
      });
      if (row === null) return null;
      const [gallery] = await withCovers([row]);
      return gallery ?? null;
    },

    async galleryCanonicalSlug(slug) {
      const row = await db.gallerySlugHistory.findFirst({
        where: { slug, gallery: PUBLISHED },
        select: { gallery: { select: { slug: true } } },
      });
      return row?.gallery.slug ?? null;
    },

    async galleryPhotos(galleryId, offset) {
      const rows = await db.galleryItem.findMany({
        where: { galleryId, gallery: PUBLISHED, ...PUBLIC_MEMBER },
        select: { photo: { select: PHOTO_SELECT } },
        orderBy: [{ position: 'asc' }],
        skip: boundedOffset(offset),
        take: MEDIA_PAGE + 1,
      });
      return photoPage(rows.map((row) => row.photo));
    },

    async gallerySitemap(offset, limit) {
      const rows = await db.gallery.findMany({
        where: LISTED_GALLERY,
        select: {
          slug: true,
          updatedAt: true,
          labels: { select: { locale: true }, orderBy: { locale: 'asc' } },
        },
        orderBy: [{ slug: 'asc' }, { id: 'asc' }],
        skip: boundedOffset(offset),
        take: bounded(limit, 5000),
      });
      return rows.map((row) => ({
        slug: row.slug,
        seriesKind: null,
        locales: row.labels.map((label) => label.locale),
        updatedAt: row.updatedAt,
      }));
    },
  };
}
