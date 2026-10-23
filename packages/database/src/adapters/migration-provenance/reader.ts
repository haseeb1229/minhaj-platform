import 'server-only';

import { Prisma } from '@prisma/client';

import type {
  AssetLicence,
  AssetVisibility,
  DisappearanceClass,
  DuplicateSignal,
  DuplicateState,
  ErrorClassification,
  ErrorResolution,
  ErrorStage,
  ItemOutcome,
  LegacyMappingState,
  LinkDisposition,
  MigrationContentKind,
  MigrationReadPort,
  PersonalDataState,
  RecordObservation,
  RecordStatus,
  ReviewState,
  RunState,
  StagedRow,
  ReconciliationState,
  TopicMappingState,
  ValidationIssue,
  ValidationState,
} from '@minhaj/contracts/migration';

import { getDatabaseClient } from '../../client.ts';
import {
  MANIFEST_SELECT,
  MAX_PAGE,
  RUN_SELECT,
  SOURCE_SELECT,
  bounded,
  boundedOffset,
  promotionRows,
  toManifestRecord,
  toPromotionRecord,
  toRunRecord,
  toSourceRecord,
} from './shared.ts';

/**
 * Operator reads — bounded, deterministic, raw bodies never included.
 *
 * Every list takes at most `MAX_PAGE` rows from an offset no deeper than
 * `MIGRATION_LIMITS.maxOffset`, ordered with the id as the final tie-breaker
 * so a page is the same page every time, and is ONE query for its rows (the
 * nested selects are batched by the client, never one query per row) plus one
 * COUNT for its total. No read selects a snapshot body.
 */

function paging(query: { readonly offset: number; readonly limit: number }): {
  readonly skip: number;
  readonly take: number;
} {
  return { skip: boundedOffset(query.offset), take: bounded(query.limit, MAX_PAGE) };
}

function issuesOf(value: string | null): readonly ValidationIssue[] {
  if (value === null) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is ValidationIssue => typeof entry === 'string')
      : [];
  } catch {
    return [];
  }
}

const STAGED_ROW_SELECT = {
  id: true,
  recordId: true,
  runId: true,
  revision: true,
  contentKind: true,
  title: true,
  languageCode: true,
  validation: true,
  personalData: true,
  review: true,
  producedAt: true,
  version: true,
} as const satisfies Prisma.MigrationStagedRecordSelect;

function toStagedRow(row: {
  readonly id: string;
  readonly recordId: string;
  readonly runId: string;
  readonly revision: number;
  readonly contentKind: string;
  readonly title: string;
  readonly languageCode: string | null;
  readonly validation: string;
  readonly personalData: string;
  readonly review: string;
  readonly producedAt: Date;
  readonly version: number;
}): StagedRow {
  return {
    ...row,
    contentKind: row.contentKind as MigrationContentKind,
    validation: row.validation as ValidationState,
    personalData: row.personalData as PersonalDataState,
    review: row.review as ReviewState,
  };
}

export function createMigrationReader(): MigrationReadPort {
  const db = getDatabaseClient();

  return {
    async sources(offset, limit) {
      const page = paging({ offset, limit });
      const [total, rows] = await Promise.all([
        db.migrationSource.count(),
        db.migrationSource.findMany({
          orderBy: [{ key: 'asc' }, { id: 'asc' }],
          ...page,
          select: SOURCE_SELECT,
        }),
      ]);
      return { rows: rows.map(toSourceRecord), total, offset: page.skip };
    },

    async runs(query) {
      const page = paging(query);
      const where = query.sourceId === null ? {} : { sourceId: query.sourceId };
      const [total, rows] = await Promise.all([
        db.migrationRun.count({ where }),
        db.migrationRun.findMany({
          where,
          orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
          ...page,
          select: {
            id: true,
            state: true,
            reconciliation: true,
            startedAt: true,
            endedAt: true,
            source: { select: { key: true } },
            _count: { select: { items: true } },
          },
        }),
      ]);
      return {
        rows: rows.map((row) => ({
          id: row.id,
          sourceKey: row.source.key,
          state: row.state as RunState,
          reconciliation: row.reconciliation as ReconciliationState,
          startedAt: row.startedAt,
          endedAt: row.endedAt,
          items: row._count.items,
        })),
        total,
        offset: page.skip,
      };
    },

    async run(id) {
      const row = await db.migrationRun.findFirst({ where: { id }, select: RUN_SELECT });
      return row === null ? null : toRunRecord(row);
    },

    async runItems(query) {
      const page = paging(query);
      const where = {
        runId: query.runId,
        ...(query.outcome === null ? {} : { outcome: query.outcome }),
      };
      const [total, rows] = await Promise.all([
        db.migrationRunItem.count({ where }),
        db.migrationRunItem.findMany({
          where,
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
          ...page,
          select: {
            id: true,
            recordId: true,
            position: true,
            outcome: true,
            attempts: true,
            snapshotId: true,
            stagedRecordId: true,
            errorId: true,
            record: { select: { externalKey: true } },
          },
        }),
      ]);
      return {
        rows: rows.map((row) => ({
          itemId: row.id,
          recordId: row.recordId,
          position: row.position,
          externalKey: row.record.externalKey,
          outcome: row.outcome as ItemOutcome,
          attempts: row.attempts,
          snapshotId: row.snapshotId,
          stagedRecordId: row.stagedRecordId,
          errorId: row.errorId,
        })),
        total,
        offset: page.skip,
      };
    },

    async staged(query) {
      const page = paging(query);
      const where = {
        ...(query.review === null ? {} : { review: query.review }),
        ...(query.runId === null ? {} : { runId: query.runId }),
      };
      const [total, rows] = await Promise.all([
        db.migrationStagedRecord.count({ where }),
        db.migrationStagedRecord.findMany({
          where,
          orderBy: [{ producedAt: 'desc' }, { id: 'desc' }],
          ...page,
          select: STAGED_ROW_SELECT,
        }),
      ]);
      return { rows: rows.map(toStagedRow), total, offset: page.skip };
    },

    async stagedDetail(id) {
      const row = await db.migrationStagedRecord.findFirst({
        where: { id },
        select: {
          ...STAGED_ROW_SELECT,
          snapshotId: true,
          payload: true,
          payloadChecksum: true,
          adapterKey: true,
          adapterVersion: true,
          parserKey: true,
          parserVersion: true,
          normalizerVersion: true,
          codeRevision: true,
          inputChecksum: true,
          issues: true,
          reviewNote: true,
          reviewedAt: true,
          record: {
            select: {
              sourceId: true,
              externalKey: true,
              originalUrl: true,
              status: true,
            },
          },
          categories: {
            orderBy: [{ topicMappingId: 'asc' }],
            select: {
              mapping: {
                select: {
                  id: true,
                  categoryKey: true,
                  label: true,
                  state: true,
                  topicId: true,
                },
              },
            },
          },
          links: {
            orderBy: [{ position: 'asc' }],
            select: {
              position: true,
              href: true,
              disposition: true,
              rewrittenTo: true,
              legacyMappingId: true,
            },
          },
        },
      });
      if (row === null) return null;
      return {
        ...toStagedRow(row),
        sourceId: row.record.sourceId,
        externalKey: row.record.externalKey,
        originalUrl: row.record.originalUrl,
        recordStatus: row.record.status as RecordStatus,
        payload: row.payload,
        payloadChecksum: row.payloadChecksum,
        provenance: {
          adapterKey: row.adapterKey,
          adapterVersion: row.adapterVersion,
          parserKey: row.parserKey,
          parserVersion: row.parserVersion,
          normalizerVersion: row.normalizerVersion,
          codeRevision: row.codeRevision,
        },
        inputChecksum: row.inputChecksum,
        snapshotId: row.snapshotId,
        issues: issuesOf(row.issues),
        reviewNote: row.reviewNote,
        reviewedAt: row.reviewedAt,
        categories: row.categories.map(({ mapping }) => ({
          mappingId: mapping.id,
          categoryKey: mapping.categoryKey,
          label: mapping.label,
          state: mapping.state as TopicMappingState,
          topicId: mapping.topicId,
        })),
        links: row.links.map((link) => ({
          ...link,
          disposition: link.disposition as LinkDisposition,
        })),
      };
    },

    async snapshot(id) {
      const row = await db.migrationRawSnapshot.findFirst({
        where: { id },
        select: {
          id: true,
          recordId: true,
          runId: true,
          requestedUrl: true,
          finalUrl: true,
          httpStatus: true,
          contentType: true,
          byteSize: true,
          checksum: true,
          fetchedAt: true,
          personalData: true,
          disposedAt: true,
        },
      });
      return row === null
        ? null
        : { ...row, personalData: row.personalData as PersonalDataState };
    },

    async duplicates(query) {
      const page = paging(query);
      const where = query.state === null ? {} : { state: query.state };
      const [total, rows] = await Promise.all([
        db.migrationDuplicateCandidate.count({ where }),
        db.migrationDuplicateCandidate.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...page,
          select: {
            id: true,
            recordId: true,
            otherRecordId: true,
            signal: true,
            score: true,
            crossLanguage: true,
            state: true,
            createdAt: true,
            version: true,
            record: { select: { currentStaged: { select: { title: true } } } },
            other: { select: { currentStaged: { select: { title: true } } } },
          },
        }),
      ]);
      return {
        rows: rows.map(({ record, other, ...row }) => ({
          ...row,
          recordTitle: record.currentStaged?.title ?? null,
          otherTitle: other.currentStaged?.title ?? null,
          signal: row.signal as DuplicateSignal,
          state: row.state as DuplicateState,
        })),
        total,
        offset: page.skip,
      };
    },

    async topicMappings(query) {
      const page = paging(query);
      const where = query.state === null ? {} : { state: query.state };
      const [total, rows] = await Promise.all([
        db.migrationTopicMapping.count({ where }),
        db.migrationTopicMapping.findMany({
          where,
          orderBy: [{ source: { key: 'asc' } }, { categoryKey: 'asc' }, { id: 'asc' }],
          ...page,
          select: {
            id: true,
            categoryKey: true,
            label: true,
            state: true,
            topicId: true,
            suggestedTopicId: true,
            version: true,
            source: { select: { key: true } },
            _count: { select: { staged: true } },
          },
        }),
      ]);
      return {
        rows: rows.map(({ source, _count, ...row }) => ({
          ...row,
          sourceKey: source.key,
          state: row.state as TopicMappingState,
          stagedCount: _count.staged,
        })),
        total,
        offset: page.skip,
      };
    },

    async legacyMappings(query) {
      const page = paging(query);
      const where = query.state === null ? {} : { state: query.state };
      const [total, rows] = await Promise.all([
        db.migrationLegacyMapping.count({ where }),
        db.migrationLegacyMapping.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...page,
          select: {
            id: true,
            legacyUrl: true,
            canonicalPath: true,
            state: true,
            createdAt: true,
            version: true,
            source: { select: { key: true } },
            entry: { select: { manifestId: true } },
          },
        }),
      ]);
      return {
        rows: rows.map(({ source, entry, ...row }) => ({
          ...row,
          sourceKey: source.key,
          state: row.state as LegacyMappingState,
          manifestId: entry?.manifestId ?? null,
        })),
        total,
        offset: page.skip,
      };
    },

    async unresolvedLinks(query) {
      const page = paging(query);
      // Only the revisions now current: a superseded revision's links are history.
      const where = {
        disposition: 'unresolved',
        staged: { currentOf: { some: {} } },
      } satisfies Prisma.MigrationStagedLinkWhereInput;
      const [total, rows] = await Promise.all([
        db.migrationStagedLink.count({ where }),
        db.migrationStagedLink.findMany({
          where,
          orderBy: [{ stagedRecordId: 'asc' }, { position: 'asc' }],
          ...page,
          select: {
            stagedRecordId: true,
            href: true,
            staged: { select: { title: true } },
          },
        }),
      ]);
      return {
        rows: rows.map((row) => ({
          stagedRecordId: row.stagedRecordId,
          title: row.staged.title,
          href: row.href,
        })),
        total,
        offset: page.skip,
      };
    },

    async errors(query) {
      const page = paging(query);
      const where = {
        ...(query.resolution === null ? {} : { resolution: query.resolution }),
        ...(query.runId === null ? {} : { runId: query.runId }),
      };
      const [total, rows] = await Promise.all([
        db.migrationError.count({ where }),
        db.migrationError.findMany({
          where,
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          ...page,
          select: {
            id: true,
            runId: true,
            recordId: true,
            stage: true,
            classification: true,
            retryEligible: true,
            httpStatus: true,
            attempt: true,
            detail: true,
            occurredAt: true,
            resolution: true,
            version: true,
          },
        }),
      ]);
      return {
        rows: rows.map((row) => ({
          ...row,
          stage: row.stage as ErrorStage,
          classification: row.classification as ErrorClassification,
          resolution: row.resolution as ErrorResolution,
        })),
        total,
        offset: page.skip,
      };
    },

    async missingRecords(query) {
      const page = paging(query);
      const where = { observed: 'missing' };
      const [total, rows] = await Promise.all([
        db.migrationRecord.count({ where }),
        db.migrationRecord.findMany({
          where,
          orderBy: [{ sourceId: 'asc' }, { id: 'asc' }],
          ...page,
          select: {
            id: true,
            externalKey: true,
            status: true,
            observed: true,
            disappearance: true,
            lastObservedRunId: true,
            version: true,
            source: { select: { key: true } },
          },
        }),
      ]);
      return {
        rows: rows.map(({ source, ...row }) => ({
          ...row,
          sourceKey: source.key,
          status: row.status as RecordStatus,
          observed: row.observed as RecordObservation,
          disappearance: row.disappearance as DisappearanceClass | null,
        })),
        total,
        offset: page.skip,
      };
    },

    async manifests(query) {
      const page = paging(query);
      const where = query.state === null ? {} : { state: query.state };
      const [total, rows] = await Promise.all([
        db.migrationPublishManifest.count({ where }),
        db.migrationPublishManifest.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...page,
          select: MANIFEST_SELECT,
        }),
      ]);
      return { rows: rows.map(toManifestRecord), total, offset: page.skip };
    },

    async promotions(query) {
      const page = paging(query);
      const [total, rows] = await Promise.all([
        db.migrationPromotion.count(),
        promotionRows(
          db,
          Prisma.sql`1 = 1`,
          Prisma.sql`OFFSET ${page.skip} ROWS FETCH NEXT ${page.take} ROWS ONLY`,
        ),
      ]);
      return { rows: rows.map(toPromotionRecord), total, offset: page.skip };
    },

    async promotionEntries(query) {
      const page = paging(query);
      const where = { promotionId: query.promotionId };
      const [total, rows] = await Promise.all([
        db.migrationPromotionEntry.count({ where }),
        db.migrationPromotionEntry.findMany({
          where,
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
          ...page,
          select: { id: true, manifestEntryId: true, position: true, state: true },
        }),
      ]);
      return {
        rows: rows.map((row) => ({ ...row, state: row.state as 'pending' | 'promoted' })),
        total,
        offset: page.skip,
      };
    },

    async assets(query) {
      const page = paging(query);
      const where = query.recordId === null ? {} : { recordId: query.recordId };
      const [total, rows] = await Promise.all([
        db.migrationAssetProvenance.count({ where }),
        db.migrationAssetProvenance.findMany({
          where,
          orderBy: [{ acquiredAt: 'desc' }, { id: 'desc' }],
          ...page,
          select: {
            id: true,
            recordId: true,
            originalUrl: true,
            assetId: true,
            checksum: true,
            byteSize: true,
            mediaType: true,
            licence: true,
            visibility: true,
            rightsHolder: true,
            version: true,
          },
        }),
      ]);
      return {
        rows: rows.map((row) => ({
          ...row,
          byteSize: Number(row.byteSize),
          licence: row.licence as AssetLicence,
          visibility: row.visibility as AssetVisibility,
        })),
        total,
        offset: page.skip,
      };
    },

    async reconciliations(query) {
      const page = paging(query);
      const where = { state: 'completed' };
      const [total, rows] = await Promise.all([
        db.migrationRun.count({ where }),
        db.migrationRun.findMany({
          where,
          orderBy: [{ endedAt: 'desc' }, { id: 'desc' }],
          ...page,
          select: RUN_SELECT,
        }),
      ]);
      return {
        rows: rows.map((row) => ({
          ...toRunRecord(row),
          detail: row.reconciliationDetail,
        })),
        total,
        offset: page.skip,
      };
    },
  };
}
