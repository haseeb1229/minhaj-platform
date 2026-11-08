import 'server-only';

import { Prisma } from '@prisma/client';

import {
  MIGRATION_LIMITS,
  MIGRATION_PUBLISHABLE_KINDS,
} from '@minhaj/contracts/migration';
import type {
  AssetLicence,
  AssetProvenanceRow,
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
  PersonalDataClassification,
  PersonalDataFindingType,
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
  LIVE_ENTRY_STATES,
  LIVE_MANIFEST_STATES,
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

const ASSET_ROW_SELECT = {
  id: true,
  recordId: true,
  runId: true,
  originalUrl: true,
  assetId: true,
  checksum: true,
  byteSize: true,
  mediaType: true,
  licence: true,
  licenceEvidence: true,
  visibility: true,
  rightsHolder: true,
  publicAssetId: true,
  width: true,
  height: true,
  version: true,
} as const satisfies Prisma.MigrationAssetProvenanceSelect;

function toAssetRow({
  publicAssetId,
  width,
  height,
  ...row
}: {
  readonly id: string;
  readonly recordId: string | null;
  readonly runId: string;
  readonly originalUrl: string;
  readonly assetId: string;
  readonly checksum: string;
  readonly byteSize: bigint | number;
  readonly mediaType: string;
  readonly licence: string;
  readonly licenceEvidence: string | null;
  readonly visibility: string;
  readonly rightsHolder: string | null;
  readonly publicAssetId: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly version: number;
}): AssetProvenanceRow {
  return {
    ...row,
    byteSize: Number(row.byteSize),
    licence: row.licence as AssetLicence,
    visibility: row.visibility as AssetVisibility,
    publicCopy:
      publicAssetId === null || width === null || height === null
        ? null
        : { assetId: publicAssetId, width, height },
  };
}

/** R2. Every run-wide candidate list: oldest first, the id last, so a set has one order. */
function candidateOrder(): { producedAt?: 'asc'; id?: 'asc' }[] {
  return [{ producedAt: 'asc' }, { id: 'asc' }];
}

/**
 * R2. A pending, valid revision free of personal data, of a kind migration may
 * publish — before the duplicate rule.
 */
function approvableWhere(runId: string): {
  runId: string;
  review: string;
  validation: string;
  personalData: string;
  contentKind: { in: string[] };
} {
  return {
    runId,
    review: 'pending',
    validation: 'valid',
    personalData: 'none',
    contentKind: { in: [...MIGRATION_PUBLISHABLE_KINDS] },
  };
}

/** No OPEN duplicate candidate names the record, on either side of the pair. */
const NO_OPEN_DUPLICATE = {
  duplicates: { none: { state: 'open' } },
  duplicateOf: { none: { state: 'open' } },
} as const;

/**
 * R2. What a run-wide approval may take: pending, valid, free of personal data
 * (a flagged revision cannot be approved; a cleared one stays a single
 * decision), of a kind migration may publish, and of a record no undecided
 * duplicate candidate names — a person decides the pair first.
 */
function approvalCandidateWhere(runId: string): ReturnType<typeof approvableWhere> & {
  record: typeof NO_OPEN_DUPLICATE;
} {
  return { ...approvableWhere(runId), record: NO_OPEN_DUPLICATE };
}

/**
 * R2. What a run-wide rights decision may take on one host: restricted, the
 * source's own `organisation-owned` claim WITH its evidence, a public copy, and
 * an original address on exactly that host (the `/` closes the host, so a
 * longer name that begins the same never matches).
 */
function rightsCandidateWhere(
  runId: string,
  host: string,
): {
  runId: string;
  visibility: string;
  licence: string;
  publicAssetId: { not: null };
  originalUrl: { startsWith: string };
  AND: ({ licenceEvidence: { not: null } } | { NOT: { licenceEvidence: string } })[];
} {
  return {
    runId,
    visibility: 'restricted',
    licence: 'organisation-owned',
    publicAssetId: { not: null },
    originalUrl: { startsWith: `https://${host}/` },
    AND: [{ licenceEvidence: { not: null } }, { NOT: { licenceEvidence: '' } }],
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
        // Phase 30-R: only revisions no live manifest entry holds — the same
        // rule a new manifest is refused under.
        ...(query.unmanifested
          ? {
              entries: {
                none: {
                  state: { in: LIVE_ENTRY_STATES },
                  manifest: { state: { in: LIVE_MANIFEST_STATES } },
                },
              },
            }
          : {}),
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

    async personalDataFindings(stagedRecordId) {
      const rows = await db.migrationPersonalDataFinding.findMany({
        where: { stagedRecordId },
        orderBy: [{ position: 'asc' }],
        take: MIGRATION_LIMITS.findings,
        select: {
          id: true,
          stagedRecordId: true,
          position: true,
          findingCount: true,
          findingType: true,
          context: true,
          classification: true,
          note: true,
          decidedByUserId: true,
          decidedAt: true,
          version: true,
        },
      });
      return rows.map((row) => ({
        id: row.id,
        stagedRecordId: row.stagedRecordId,
        position: row.position,
        findingCount: row.findingCount,
        type: row.findingType as PersonalDataFindingType,
        context: row.context,
        classification: row.classification as PersonalDataClassification,
        note: row.note,
        decidedByUserId: row.decidedByUserId,
        decidedAt: row.decidedAt,
        version: row.version,
      }));
    },

    async stagedDetail(id) {
      const row = await db.migrationStagedRecord.findFirst({
        where: { id },
        select: {
          ...STAGED_ROW_SELECT,
          snapshotId: true,
          clearanceOfStagedRecordId: true,
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
        clearanceOfStagedRecordId: row.clearanceOfStagedRecordId,
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
      const runId = query.runId ?? null;
      const visibility = query.visibility ?? null;
      const where = {
        ...(query.recordId === null ? {} : { recordId: query.recordId }),
        ...(runId === null ? {} : { runId }),
        ...(visibility === null ? {} : { visibility }),
      };
      const [total, rows] = await Promise.all([
        db.migrationAssetProvenance.count({ where }),
        db.migrationAssetProvenance.findMany({
          where,
          // One run is reviewed in the order it acquired; elsewhere, newest first.
          orderBy:
            runId === null
              ? [{ acquiredAt: 'desc' }, { id: 'desc' }]
              : [{ acquiredAt: 'asc' }, { id: 'asc' }],
          ...page,
          select: ASSET_ROW_SELECT,
        }),
      ]);
      return { rows: rows.map(toAssetRow), total, offset: page.skip };
    },

    async asset(provenanceId) {
      const row = await db.migrationAssetProvenance.findFirst({
        where: { id: provenanceId },
        select: ASSET_ROW_SELECT,
      });
      return row === null ? null : toAssetRow(row);
    },

    async runApprovalCounts(runId) {
      const pending = { runId, review: 'pending' };
      const valid = { ...pending, validation: 'valid' };
      const [all, invalid, flagged, cleared, clean, approvable, candidates] =
        await Promise.all([
          db.migrationStagedRecord.count({ where: pending }),
          db.migrationStagedRecord.count({
            where: { ...pending, NOT: { validation: 'valid' } },
          }),
          db.migrationStagedRecord.count({
            where: { ...valid, personalData: 'flagged' },
          }),
          db.migrationStagedRecord.count({
            where: { ...valid, personalData: 'cleared' },
          }),
          db.migrationStagedRecord.count({ where: { ...valid, personalData: 'none' } }),
          db.migrationStagedRecord.count({ where: approvableWhere(runId) }),
          db.migrationStagedRecord.count({ where: approvalCandidateWhere(runId) }),
        ]);
      return {
        pending: all,
        candidates,
        invalid,
        flagged,
        cleared,
        reviewOnly: clean - approvable,
        awaitingDuplicate: approvable - candidates,
      };
    },

    async hasOpenDuplicate(recordId) {
      const open = await db.migrationDuplicateCandidate.count({
        where: {
          state: 'open',
          OR: [{ recordId }, { otherRecordId: recordId }],
        },
      });
      return open > 0;
    },

    async approvalCandidates(query) {
      const page = paging(query);
      const where = approvalCandidateWhere(query.runId);
      const [total, rows] = await Promise.all([
        db.migrationStagedRecord.count({ where }),
        db.migrationStagedRecord.findMany({
          where,
          orderBy: candidateOrder(),
          ...page,
          select: STAGED_ROW_SELECT,
        }),
      ]);
      return { rows: rows.map(toStagedRow), total, offset: page.skip };
    },

    async approvalCandidateKeys(runId, ceiling) {
      return db.migrationStagedRecord.findMany({
        where: approvalCandidateWhere(runId),
        orderBy: candidateOrder(),
        take: bounded(ceiling, MIGRATION_LIMITS.runCandidates),
        select: { id: true, version: true },
      });
    },

    async rightsCandidates(query) {
      const page = paging(query);
      const where = rightsCandidateWhere(query.runId, query.host);
      const [total, rows] = await Promise.all([
        db.migrationAssetProvenance.count({ where }),
        db.migrationAssetProvenance.findMany({
          where,
          orderBy: [{ acquiredAt: 'asc' }, { id: 'asc' }],
          ...page,
          select: ASSET_ROW_SELECT,
        }),
      ]);
      return { rows: rows.map(toAssetRow), total, offset: page.skip };
    },

    async rightsCandidateKeys(runId, host, ceiling) {
      return db.migrationAssetProvenance.findMany({
        where: rightsCandidateWhere(runId, host),
        orderBy: [{ acquiredAt: 'asc' }, { id: 'asc' }],
        take: bounded(ceiling, MIGRATION_LIMITS.runCandidates),
        select: { id: true, version: true },
      });
    },

    async manifestCandidateKeys(runId, ceiling) {
      return db.migrationStagedRecord.findMany({
        where: {
          runId,
          review: 'approved',
          validation: 'valid',
          contentKind: { in: [...MIGRATION_PUBLISHABLE_KINDS] },
          entries: {
            none: {
              state: { in: LIVE_ENTRY_STATES },
              manifest: { state: { in: LIVE_MANIFEST_STATES } },
            },
          },
        },
        orderBy: candidateOrder(),
        take: bounded(ceiling, MIGRATION_LIMITS.runCandidates),
        select: { id: true, version: true },
      });
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
