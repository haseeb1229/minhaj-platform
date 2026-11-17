import 'server-only';

import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';

import type { Locale } from '@minhaj/contracts';
import {
  MEDIA_PAGE,
  PHOTO_ARCHIVE_PERIODS,
  PHOTO_FACET_PAGE,
  type GalleryDetail,
  type GallerySpan,
  type GalleryPage,
  type GalleryRecord,
  type MediaPersistencePort,
  type MediaPublicReaderPort,
  type MediaReferencePort,
  type MediaState,
  type PhotoLabel,
  type PhotoListingQuery,
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

/** A public Photo inside a public Gallery. */
const PUBLIC_MEMBER = { photo: PUBLISHED } as const;

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

/** Stored identifiers keep their case while SQL Server compares without it. */
const key = (id: string) => id.toLowerCase();

/**
 * A span end from its sortable form `year * 100 + month`, where the month is
 * 0 (the earliest end) or 13 (the latest) when some public Photo of that year
 * states none — so the end says only the year.
 */
function spanEnd(value: number): {
  readonly year: number;
  readonly month: number | null;
} {
  const year = Math.floor(value / 100);
  const month = value % 100;
  return { year, month: month >= 1 && month <= 12 ? month : null };
}

/**
 * Each Gallery's span of KNOWN dates over its public Photos — one grouped
 * statement for the whole set. The earliest end takes an unknown month as 0
 * and the latest as 13, so an end's month is stated only when every public
 * Photo of that end's year states one.
 */
async function spansOf(
  ids: readonly string[],
): Promise<ReadonlyMap<string, GallerySpan>> {
  const rows = await getDatabaseClient().$queryRaw<
    { galleryId: string; first: number | null; last: number | null }[]
  >`
    SELECT gi.[galleryId],
           MIN(p.[takenYear] * 100 + COALESCE(p.[takenMonth], 0)) AS [first],
           MAX(p.[takenYear] * 100 + COALESCE(p.[takenMonth], 13)) AS [last]
    FROM [dbo].[GalleryItem] gi
    JOIN [dbo].[Photo] p ON p.[id] = gi.[photoId] AND p.[state] = N'published'
    WHERE gi.[galleryId] IN (${Prisma.join([...ids])}) AND p.[takenYear] IS NOT NULL
    GROUP BY gi.[galleryId];`;
  return new Map(
    rows.flatMap((row) =>
      row.first === null || row.last === null
        ? []
        : [
            [
              key(row.galleryId),
              { first: spanEnd(Number(row.first)), last: spanEnd(Number(row.last)) },
            ],
          ],
    ),
  );
}

/**
 * Public counts, covers and spans for a set of published Galleries — THREE
 * queries for the whole set: the per-Gallery count and first public place, the
 * Photos at exactly those places, and the spans of their known dates.
 */
async function withCovers(rows: readonly GalleryRow[]): Promise<PublicGallery[]> {
  if (rows.length === 0) return [];
  const db = getDatabaseClient();
  const [summary, spans] = await Promise.all([
    db.galleryItem.groupBy({
      by: ['galleryId'],
      where: { galleryId: { in: rows.map((row) => row.id) }, ...PUBLIC_MEMBER },
      _count: { _all: true },
      _min: { position: true },
    }),
    spansOf(rows.map((row) => row.id)),
  ]);
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
    span: spans.get(key(row.id)) ?? null,
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
  | 'photoListing'
  | 'photoListingFacets'
  | 'photoArchivePeriods'
  | 'galleryDirectory'
  | 'gallery'
  | 'galleryCanonicalSlug'
  | 'galleryPhotos'
  | 'gallerySitemap'
  | 'publicGalleries'
>;

/** At most this many Galleries are composed for one Event at a time. */
const EVENT_GALLERY_BATCH = 50;

/** A published Gallery with at least one public Photo — what is LISTED. */
const LISTED_GALLERY = {
  ...PUBLISHED,
  items: { some: PUBLIC_MEMBER },
} as const;

/** The same predicate as SQL over `[dbo].[Gallery] g`. */
const LISTED_GALLERY_SQL = Prisma.sql`g.[state] = N'published' AND EXISTS (
  SELECT 1 FROM [dbo].[GalleryItem] li
  JOIN [dbo].[Photo] lp ON lp.[id] = li.[photoId] AND lp.[state] = N'published'
  WHERE li.[galleryId] = g.[id])`;

/** Which of a view's filters a statement applies. */
interface Use {
  readonly year: boolean;
  readonly month: boolean;
  readonly gallery: boolean;
  readonly language: boolean;
}

const EVERY_FILTER: Use = { year: true, month: true, gallery: true, language: true };

/**
 * THE LISTING'S SET, as SQL over `[dbo].[Photo] p`: the ONE public predicate
 * (published, which the database guarantees means it has an image) and
 * whichever of the view's filters `use` names — a Gallery only while it is
 * itself published. Every value is a bound parameter.
 */
function listingWhere(q: PhotoListingQuery, use: Use): Prisma.Sql {
  const conditions = [Prisma.sql`p.[state] = N'published'`];
  if (use.year && q.year !== null) conditions.push(Prisma.sql`p.[takenYear] = ${q.year}`);
  if (use.month && q.month !== null)
    conditions.push(Prisma.sql`p.[takenMonth] = ${q.month}`);
  if (use.gallery && q.gallery !== null)
    conditions.push(
      Prisma.sql`EXISTS (SELECT 1 FROM [dbo].[GalleryItem] gi JOIN [dbo].[Gallery] g ON g.[id] = gi.[galleryId] AND g.[state] = N'published' WHERE gi.[photoId] = p.[id] AND gi.[galleryId] = ${q.gallery})`,
    );
  if (use.language && q.language !== null)
    conditions.push(
      Prisma.sql`EXISTS (SELECT 1 FROM [dbo].[PhotoLabel] l WHERE l.[photoId] = p.[id] AND l.[locale] = ${q.language})`,
    );
  return Prisma.join(conditions, ' AND ');
}

/**
 * The listing's orders. Recently added is creation order, never a date. By the
 * date taken, an undated Photo follows every dated one, and within a year a
 * Photo known only to it — then within a month one known only to it — follows
 * the more precise ones, in either direction. Ties end on the identifier.
 */
function listingOrder(sort: PhotoListingQuery['sort']): Prisma.Sql {
  if (sort === 'added') return Prisma.sql`p.[createdAt] DESC, p.[id] ASC`;
  const direction = sort === 'newest' ? Prisma.sql`DESC` : Prisma.sql`ASC`;
  return Prisma.sql`CASE WHEN p.[takenYear] IS NULL THEN 1 ELSE 0 END,
    p.[takenYear] ${direction},
    CASE WHEN p.[takenMonth] IS NULL THEN 1 ELSE 0 END, p.[takenMonth] ${direction},
    CASE WHEN p.[takenDay] IS NULL THEN 1 ELSE 0 END, p.[takenDay] ${direction},
    p.[createdAt] ${direction}, p.[id] ASC`;
}

/** A published Gallery's address and titles, as a facet names it. */
const GALLERY_REF_SELECT = {
  id: true,
  slug: true,
  primaryLocale: true,
  labels: LABELS,
} satisfies Prisma.GallerySelect;

/**
 * NEWS & EVENTS PART 2 — the public photograph reads (DOMAIN_MODEL.md §11):
 * the listing and its aggregates, the archive's periods and the Galleries'
 * directory beside Phase 12's Gallery, membership, sitemap and Phase 14's
 * Event composition. TWO READS, THE SECOND AUTHORITATIVE: an ordering or
 * aggregate statement returns identifiers, and the rows a page shows are
 * loaded again under the public predicate, so an error in the first could only
 * drop a record, never admit one.
 */
export function photoPublicReader(): PhotoPublicReader {
  const db = getDatabaseClient();

  /** How many published Photos a set holds. */
  async function count(where: Prisma.Sql): Promise<number> {
    const [row] = await db.$queryRaw<{ photos: number }[]>`
      SELECT COUNT(*) AS [photos] FROM [dbo].[Photo] p WHERE ${where};`;
    return Number(row?.photos ?? 0);
  }

  return {
    async photoListing(q) {
      const where = listingWhere(q, EVERY_FILTER);
      const page = await db.$queryRaw<{ id: string; total: number }[]>`
        SELECT p.[id], COUNT(*) OVER () AS [total]
        FROM [dbo].[Photo] p
        WHERE ${where}
        ORDER BY ${listingOrder(q.sort)}
        OFFSET ${boundedOffset(q.offset)} ROWS FETCH NEXT ${q.limit + 1} ROWS ONLY;`;

      // Past the end there is no row to carry the total; it is counted alone.
      const total =
        page[0] === undefined
          ? q.offset === 0
            ? 0
            : await count(where)
          : Number(page[0].total);
      const ids = page.slice(0, q.limit).map((row) => row.id);
      if (ids.length === 0) return { items: [], total, hasMore: false };

      const rows = await db.photo.findMany({
        where: { ...PUBLISHED, id: { in: ids } },
        select: PHOTO_SELECT,
      });
      const byId = new Map(rows.map((row) => [key(row.id), row]));
      // A Photo withdrawn between the two reads is simply absent.
      const items = ids.flatMap((id) => {
        const row = byId.get(key(id));
        return row === undefined ? [] : [toPhoto(row)];
      });
      return { items, total, hasMore: page.length > q.limit };
    },

    /**
     * GROUPED READS, each bounded: a facet's own filter is left out of its own
     * counts (a year's leaves out the month too), so every option says how many
     * Photos choosing it would show.
     */
    async photoListingFacets(q) {
      const except = (omit: readonly (keyof Use)[]) =>
        listingWhere(q, {
          year: !omit.includes('year'),
          month: !omit.includes('month'),
          gallery: !omit.includes('gallery'),
          language: !omit.includes('language'),
        });
      const whole = Prisma.sql`p.[state] = N'published'`;
      const [all, listed, years, months, galleries, languages] = await Promise.all([
        db.$queryRaw<
          {
            photos: number;
            dated: number;
            firstYear: number | null;
            lastYear: number | null;
          }[]
        >`
          SELECT COUNT(*) AS [photos], COUNT(p.[takenYear]) AS [dated],
                 MIN(p.[takenYear]) AS [firstYear], MAX(p.[takenYear]) AS [lastYear]
          FROM [dbo].[Photo] p
          WHERE ${whole};`,
        db.$queryRaw<{ languages: number; galleries: number; photos: number }[]>`
          SELECT (SELECT COUNT(DISTINCT l.[locale]) FROM [dbo].[PhotoLabel] l
                  JOIN [dbo].[Photo] lp ON lp.[id] = l.[photoId] AND lp.[state] = N'published') AS [languages],
                 (SELECT COUNT(*) FROM [dbo].[Gallery] g WHERE ${LISTED_GALLERY_SQL}) AS [galleries],
                 (SELECT COUNT(DISTINCT gi.[photoId]) FROM [dbo].[GalleryItem] gi
                  JOIN [dbo].[Gallery] g ON g.[id] = gi.[galleryId] AND g.[state] = N'published'
                  JOIN [dbo].[Photo] p ON p.[id] = gi.[photoId] AND p.[state] = N'published') AS [photos];`,
        db.$queryRaw<{ year: number; count: number }[]>`
          SELECT p.[takenYear] AS [year], COUNT(*) AS [count]
          FROM [dbo].[Photo] p
          WHERE ${except(['year', 'month'])} AND p.[takenYear] IS NOT NULL
          GROUP BY p.[takenYear]
          ORDER BY p.[takenYear] DESC;`,
        q.year === null
          ? Promise.resolve([] as { month: number; count: number }[])
          : db.$queryRaw<{ month: number; count: number }[]>`
              SELECT p.[takenMonth] AS [month], COUNT(*) AS [count]
              FROM [dbo].[Photo] p
              WHERE ${except(['month'])} AND p.[takenMonth] IS NOT NULL
              GROUP BY p.[takenMonth]
              ORDER BY p.[takenMonth] ASC;`,
        db.$queryRaw<{ id: string; count: number }[]>`
          SELECT TOP (${PHOTO_FACET_PAGE + 1}) gi.[galleryId] AS [id], COUNT(DISTINCT gi.[photoId]) AS [count]
          FROM [dbo].[GalleryItem] gi
          JOIN [dbo].[Gallery] g ON g.[id] = gi.[galleryId] AND g.[state] = N'published'
          WHERE gi.[photoId] IN (SELECT p.[id] FROM [dbo].[Photo] p WHERE ${except(['gallery'])})
          GROUP BY gi.[galleryId]
          ORDER BY [count] DESC, [id] ASC;`,
        db.$queryRaw<{ code: string; count: number }[]>`
          SELECT l.[locale] AS [code], COUNT(DISTINCT l.[photoId]) AS [count]
          FROM [dbo].[PhotoLabel] l
          WHERE l.[photoId] IN (SELECT p.[id] FROM [dbo].[Photo] p WHERE ${except(['language'])})
          GROUP BY l.[locale]
          ORDER BY [count] DESC, [code] ASC;`,
      ]);

      const named = galleries.slice(0, PHOTO_FACET_PAGE);
      // The Galleries' addresses and titles, under the public predicate again.
      const refs =
        named.length === 0
          ? []
          : await db.gallery.findMany({
              where: { ...PUBLISHED, id: { in: named.map((row) => row.id) } },
              select: GALLERY_REF_SELECT,
            });
      const refOf = new Map(refs.map((row) => [key(row.id), row]));

      return {
        all: {
          photos: Number(all[0]?.photos ?? 0),
          dated: Number(all[0]?.dated ?? 0),
          firstYear: all[0]?.firstYear ?? null,
          lastYear: all[0]?.lastYear ?? null,
          languages: Number(listed[0]?.languages ?? 0),
          galleries: Number(listed[0]?.galleries ?? 0),
          inGalleries: Number(listed[0]?.photos ?? 0),
        },
        years: years.map((row) => ({ year: row.year, photos: Number(row.count) })),
        months: months.map((row) => ({ month: row.month, photos: Number(row.count) })),
        galleries: {
          items: named.flatMap((row) => {
            const found = refOf.get(key(row.id));
            return found === undefined
              ? []
              : [
                  {
                    id: found.id,
                    slug: found.slug,
                    primaryLocale: found.primaryLocale as Locale,
                    labels: labelsOf(found.labels),
                    photos: Number(row.count),
                  },
                ];
          }),
          hasMore: galleries.length > PHOTO_FACET_PAGE,
        },
        languages: languages.flatMap((row) =>
          row.code === 'en' || row.code === 'ur' || row.code === 'ar'
            ? [{ code: row.code as Locale, photos: Number(row.count) }]
            : [],
        ),
      };
    },

    async photoArchivePeriods() {
      const rows = await db.$queryRaw<
        { year: number; month: number | null; count: number }[]
      >`
        SELECT TOP (${PHOTO_ARCHIVE_PERIODS}) p.[takenYear] AS [year], p.[takenMonth] AS [month], COUNT(*) AS [count]
        FROM [dbo].[Photo] p
        WHERE p.[state] = N'published' AND p.[takenYear] IS NOT NULL
        GROUP BY p.[takenYear], p.[takenMonth]
        ORDER BY p.[takenYear] DESC, p.[takenMonth] ASC;`;
      return rows.map((row) => ({
        year: row.year,
        month: row.month,
        photos: Number(row.count),
      }));
    },

    async galleryDirectory(q) {
      const order =
        q.sort === 'title'
          ? Prisma.sql`t.[title] ASC, g.[id] ASC`
          : q.sort === 'oldest'
            ? Prisma.sql`g.[createdAt] ASC, g.[id] ASC`
            : Prisma.sql`g.[createdAt] DESC, g.[id] ASC`;
      const page = await db.$queryRaw<{ id: string; total: number }[]>`
        SELECT g.[id], COUNT(*) OVER () AS [total]
        FROM [dbo].[Gallery] g
        OUTER APPLY (
          SELECT TOP (1) l.[title] FROM [dbo].[GalleryLabel] l
          WHERE l.[galleryId] = g.[id]
          ORDER BY CASE WHEN l.[locale] = ${q.titleLocale} THEN 0
                        WHEN l.[locale] = g.[primaryLocale] THEN 1 ELSE 2 END, l.[locale]
        ) t
        WHERE ${LISTED_GALLERY_SQL}
        ORDER BY ${order}
        OFFSET ${boundedOffset(q.offset)} ROWS FETCH NEXT ${q.limit + 1} ROWS ONLY;`;
      const total =
        page[0] === undefined
          ? q.offset === 0
            ? 0
            : Number(
                (
                  await db.$queryRaw<{ galleries: number }[]>`
                    SELECT COUNT(*) AS [galleries] FROM [dbo].[Gallery] g WHERE ${LISTED_GALLERY_SQL};`
                )[0]?.galleries ?? 0,
              )
          : Number(page[0].total);
      const ids = page.slice(0, q.limit).map((row) => row.id);
      if (ids.length === 0) return { items: [], total, hasMore: false };
      const rows = await db.gallery.findMany({
        where: { id: { in: ids }, ...LISTED_GALLERY },
        select: GALLERY_SELECT,
      });
      const byId = new Map(rows.map((row) => [key(row.id), row]));
      return {
        items: await withCovers(ids.flatMap((id) => byId.get(key(id)) ?? [])),
        total,
        hasMore: page.length > q.limit,
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

    async publicGalleries(ids) {
      if (ids.length === 0) return [];
      const wanted = [...new Set(ids)].slice(0, EVENT_GALLERY_BATCH);
      const rows = await db.gallery.findMany({
        where: { id: { in: wanted }, ...LISTED_GALLERY },
        select: GALLERY_SELECT,
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      // The caller's order, which is the Event's; an unlisted Gallery is absent.
      return withCovers(wanted.flatMap((id) => byId.get(id) ?? []));
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

/* ===========================================================================
 * The reference surface — Phase 14, Editorial → Media
 * ========================================================================= */

/** How many Galleries an Event editor's selector offers at once. */
const GALLERY_CHOICES = 50;

/**
 * Which Galleries an editor may associate with an Event: identity, words and
 * lifecycle state, nothing more. No Photo, asset or membership leaves here, and
 * nothing is written.
 */
export function createMediaReferences(): MediaReferencePort {
  const db = getDatabaseClient();
  return {
    async galleryChoices(text) {
      const rows = await db.gallery.findMany({
        where: { state: { not: 'archived' }, ...textMatch(text) },
        select: GALLERY_SELECT,
        orderBy: [{ slug: 'asc' }, { id: 'asc' }],
        take: GALLERY_CHOICES,
      });
      return rows.map(toGallery);
    },

    async galleriesByIds(ids) {
      if (ids.length === 0) return [];
      const rows = await db.gallery.findMany({
        where: { id: { in: [...new Set(ids)].slice(0, GALLERY_CHOICES) } },
        select: GALLERY_SELECT,
      });
      return rows.map(toGallery);
    },

    async gallerySelectable(id) {
      return (
        (await db.gallery.findFirst({
          where: { id, state: { not: 'archived' } },
          select: { id: true },
        })) !== null
      );
    },
  };
}
