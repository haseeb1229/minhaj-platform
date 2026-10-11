import 'server-only';

import { randomUUID } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import {
  QURAN_LIMITS,
  QURAN_PAGE,
  type QuranPersistencePort,
  type RecitationDetail,
  type RecitationRecord,
  type RecitationValue,
} from '@minhaj/contracts/quran';

import { getDatabaseClient } from '../../client.ts';
import {
  audit,
  authorityOf,
  BY_SLUG,
  boundedOffset,
  changedFields,
  claim,
  guardEdit,
  refuse,
  publication,
  QuranDataError,
  stateOf,
  type Client,
} from './shared.ts';

/**
 * The Quran adapter's RECITATIONS — a reciter's recitation work and its audio
 * segments (DOMAIN_MODEL.md §8.2; DELIVERY_PLAN.md Phase 18).
 *
 * THE RECITER IS A PEOPLE PERSON, which grants nothing; the AUDIO IS A STORAGE
 * ASSET, named here by identifier only. No storage key, size or scan state is
 * read from Storage's table — whether bytes may leave the disk is decided by
 * Storage per request — and a segment's asset key never cascades: removing a
 * segment or replacing its file leaves the asset exactly as it was.
 *
 * EVERY WRITE IS ONE TRANSACTION under the Recitation's expected version: a
 * segment added, removed or given audio moves the Recitation's version, so two
 * operators editing one Recitation cannot both win. A segment's range is fixed
 * once created — the column refuses UPDATE — and no two segments of one
 * Recitation cover the same Ayah (51187).
 */

const SEGMENTS = {
  select: { id: true, surahNumber: true, startAyah: true, endAyah: true, assetId: true },
  orderBy: [{ surahNumber: 'asc' }, { startAyah: 'asc' }, { id: 'asc' }],
  take: QURAN_LIMITS.segmentsPerRecitation,
} satisfies Prisma.QuranRecitation$segmentsArgs;

const RECITATION_SELECT = {
  id: true,
  slug: true,
  name: true,
  personId: true,
  style: true,
  attribution: true,
  sourceId: true,
  state: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  publishedAt: true,
  source: { select: { authority: true } },
  _count: { select: { segments: true } },
} satisfies Prisma.QuranRecitationSelect;

const DETAIL_SELECT = {
  ...RECITATION_SELECT,
  segments: SEGMENTS,
} satisfies Prisma.QuranRecitationSelect;

interface RecitationRow {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly personId: string;
  readonly style: string | null;
  readonly attribution: string | null;
  readonly sourceId: string | null;
  readonly state: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly publishedAt: Date | null;
  readonly source: { readonly authority: string } | null;
  readonly _count: { readonly segments: number };
}

interface SegmentRow {
  readonly id: string;
  readonly surahNumber: number;
  readonly startAyah: number;
  readonly endAyah: number;
  readonly assetId: string | null;
}

function toRecitation(row: RecitationRow): RecitationRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    reciterId: row.personId,
    style: row.style,
    attribution: row.attribution,
    sourceId: row.sourceId,
    sourceAuthority: authorityOf(row.source),
    state: stateOf(row.state),
    version: row.version,
    segmentCount: row._count.segments,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt,
  };
}

function toDetail(
  row: RecitationRow & { readonly segments: readonly SegmentRow[] },
): RecitationDetail {
  return {
    ...toRecitation(row),
    segments: row.segments.map((segment) => ({
      id: segment.id,
      surah: segment.surahNumber,
      startAyah: segment.startAyah,
      endAyah: segment.endAyah,
      assetId: segment.assetId,
    })),
  };
}

function recitationColumns(value: RecitationValue) {
  return {
    name: value.name,
    personId: value.reciterId,
    style: value.style,
    attribution: value.attribution,
    sourceId: value.sourceId,
  };
}

async function detailOf(tx: Client, id: string): Promise<RecitationDetail> {
  const row = await tx.quranRecitation.findUnique({
    where: { id },
    select: DETAIL_SELECT,
  });
  if (row === null) throw new QuranDataError('conflict');
  return toDetail(row);
}

type RecitationPersistence = Pick<
  QuranPersistencePort,
  | 'recitations'
  | 'recitation'
  | 'createRecitation'
  | 'updateRecitation'
  | 'setRecitationState'
  | 'addRecitationSegment'
  | 'removeRecitationSegment'
  | 'attachSegmentAsset'
  | 'segmentAssetForPreview'
>;

export function recitationPersistence(): RecitationPersistence {
  const db = getDatabaseClient();

  /** A segment change's audit: which segment, under which versions. */
  const segmentAudit = (
    tx: Client,
    input: { readonly actorId: string; readonly id: string },
    version: number,
    action: string,
    after: Readonly<Record<string, string>>,
  ) =>
    audit(tx, {
      actorId: input.actorId,
      action: `quran.recitation.${action}`,
      targetType: 'quran-recitation',
      targetId: input.id,
      before: { version: String(version) },
      after: { version: String(version + 1), ...after },
    });

  return {
    async recitations(offset) {
      const [total, rows] = await Promise.all([
        db.quranRecitation.count(),
        db.quranRecitation.findMany({
          select: RECITATION_SELECT,
          orderBy: [...BY_SLUG],
          skip: boundedOffset(offset),
          take: QURAN_PAGE,
        }),
      ]);
      return { items: rows.map(toRecitation), total, offset: boundedOffset(offset) };
    },

    async recitation(id) {
      const row = await db.quranRecitation.findUnique({
        where: { id },
        select: DETAIL_SELECT,
      });
      return row === null ? null : toDetail(row);
    },

    async createRecitation({ actorId, value }) {
      try {
        return await db.$transaction(async (tx) => {
          const id = randomUUID();
          await tx.quranRecitation.create({
            data: {
              id,
              slug: value.slug,
              ...recitationColumns(value),
              state: 'draft',
              version: 1,
              updatedAt: new Date(),
            },
          });
          await audit(tx, {
            actorId,
            action: 'quran.recitation.created',
            targetType: 'quran-recitation',
            targetId: id,
            after: {
              version: '1',
              state: 'draft',
              reciter: value.reciterId,
              source: value.sourceId ?? 'none',
            },
          });
          return detailOf(tx, id);
        });
      } catch (error) {
        refuse(error);
      }
    },

    async updateRecitation({ actorId, id, expectedVersion, value }) {
      try {
        return await db.$transaction(async (tx) => {
          const previous = await tx.quranRecitation.findUnique({
            where: { id },
            select: {
              slug: true,
              state: true,
              version: true,
              sourceId: true,
              publishedAt: true,
              name: true,
              personId: true,
              style: true,
              attribution: true,
            },
          });
          guardEdit(previous, expectedVersion, value);
          const columns = recitationColumns(value);
          const changed = await tx.quranRecitation.updateMany({
            where: { id, version: expectedVersion },
            data: { ...columns, version: { increment: 1 }, updatedAt: new Date() },
          });
          if (changed.count !== 1) throw new QuranDataError('conflict');
          await audit(tx, {
            actorId,
            action: 'quran.recitation.updated',
            targetType: 'quran-recitation',
            targetId: id,
            before: { version: String(previous.version), state: previous.state },
            after: {
              version: String(previous.version + 1),
              changed: changedFields(previous, columns),
            },
          });
          return detailOf(tx, id);
        });
      } catch (error) {
        refuse(error);
      }
    },

    /** A published Recitation always has something to hear (51188). */
    async setRecitationState({ actorId, id, expectedVersion, state }) {
      try {
        return await db.$transaction(async (tx) => {
          const previous = await claim(tx, 'recitation', id, expectedVersion, (head) =>
            publication(
              head,
              state,
              () =>
                tx.quranRecitationSegment.count({
                  where: { recitationId: id, assetId: { not: null } },
                }),
              'audio-required',
            ),
          );
          await audit(tx, {
            actorId,
            action: 'quran.recitation.state-changed',
            targetType: 'quran-recitation',
            targetId: id,
            before: { version: String(previous.version), state: previous.state },
            after: { version: String(previous.version + 1), state },
          });
          return detailOf(tx, id);
        });
      } catch (error) {
        refuse(error);
      }
    },

    async addRecitationSegment({ actorId, id, expectedVersion, value }) {
      try {
        return await db.$transaction(async (tx) => {
          const previous = await claim(tx, 'recitation', id, expectedVersion);
          const held = await tx.quranRecitationSegment.count({
            where: { recitationId: id },
          });
          if (held >= QURAN_LIMITS.segmentsPerRecitation)
            throw new QuranDataError('invalid');
          const segmentId = randomUUID();
          await tx.quranRecitationSegment.create({
            data: {
              id: segmentId,
              recitationId: id,
              surahNumber: value.surah,
              startAyah: value.startAyah,
              endAyah: value.endAyah,
            },
          });
          await segmentAudit(tx, { actorId, id }, previous.version, 'segment-added', {
            segment: segmentId,
            surah: String(value.surah),
            startAyah: String(value.startAyah),
            endAyah: String(value.endAyah),
          });
          return detailOf(tx, id);
        });
      } catch (error) {
        refuse(error);
      }
    },

    /** The segment's asset, if any, is left untouched in Storage. */
    async removeRecitationSegment({ actorId, id, expectedVersion, segmentId }) {
      try {
        return await db.$transaction(async (tx) => {
          const previous = await claim(tx, 'recitation', id, expectedVersion);
          const removed = await tx.quranRecitationSegment.deleteMany({
            where: { id: segmentId, recitationId: id },
          });
          if (removed.count !== 1) throw new QuranDataError('not-found');
          await segmentAudit(tx, { actorId, id }, previous.version, 'segment-removed', {
            segment: segmentId,
          });
          return detailOf(tx, id);
        });
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * THE RECITATION'S VERSION IS THE LOCK. The operator uploaded against the
     * Recitation at `expectedVersion`; the claim moves it on, so of two
     * replacements exactly one lands. Only the segment's `assetId` column is
     * written, and the previous asset is not touched — it simply stops being
     * the one this segment serves, so a failed replacement never costs the last
     * good file.
     */
    async attachSegmentAsset({ actorId, id, expectedVersion, segmentId, assetId }) {
      try {
        return await db.$transaction(async (tx) => {
          const previous = await claim(tx, 'recitation', id, expectedVersion);
          const segment = await tx.quranRecitationSegment.findFirst({
            where: { id: segmentId, recitationId: id },
            select: { assetId: true },
          });
          if (segment === null) throw new QuranDataError('not-found');
          const changed = await tx.quranRecitationSegment.updateMany({
            where: { id: segmentId, recitationId: id },
            data: { assetId },
          });
          if (changed.count !== 1) throw new QuranDataError('conflict');
          await segmentAudit(
            tx,
            { actorId, id },
            previous.version,
            `asset-${segment.assetId === null ? 'attached' : 'replaced'}`,
            { segment: segmentId, assetId, previousAssetId: segment.assetId ?? 'none' },
          );
          return detailOf(tx, id);
        });
      } catch (error) {
        refuse(error);
      }
    },

    async segmentAssetForPreview(recitationId, segmentId) {
      const row = await db.quranRecitationSegment.findFirst({
        where: { id: segmentId, recitationId },
        select: { assetId: true },
      });
      return row?.assetId ?? null;
    },
  };
}
