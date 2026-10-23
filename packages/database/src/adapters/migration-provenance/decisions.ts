import 'server-only';

import type { MigrationDecisionPort, RecordStatus } from '@minhaj/contracts/migration';

import { getDatabaseClient } from '../../client.ts';
import {
  ADMINISTER,
  LOCKED_TRANSACTION,
  MigrationDataError,
  audit,
  lockRow,
  missedBecause,
  refuse,
  type Client,
} from './shared.ts';

/**
 * A person's decisions — review, duplicates, topic mappings, errors,
 * disappearances, rights and legacy mappings. EVERY ONE at an expected
 * version (`WHERE id = ? AND version = ?`; nothing changed → `conflict`),
 * every one moving its version by exactly one (the triggers insist too), and
 * every one audited in the same transaction with identifiers and states only —
 * never a note, a holder's name or a payload.
 */

/**
 * The status a record returns to when it stops being merged: what its current
 * revision says, or how far the pipeline got with it.
 */
async function unmergedStatus(tx: Client, recordId: string): Promise<RecordStatus> {
  const record = await tx.migrationRecord.findFirst({
    where: { id: recordId },
    select: {
      latestSnapshotId: true,
      currentStaged: { select: { review: true, validation: true } },
    },
  });
  const staged = record?.currentStaged ?? null;
  if (staged === null) return record?.latestSnapshotId == null ? 'discovered' : 'fetched';
  if (staged.review === 'approved') return 'approved';
  if (staged.review === 'rejected' || staged.validation === 'invalid') return 'rejected';
  return 'staged';
}

export function createMigrationDecisions(): MigrationDecisionPort {
  const db = getDatabaseClient();

  return {
    async review(input) {
      try {
        await db.$transaction(async (tx) => {
          const staged = await tx.migrationStagedRecord.findFirst({
            where: { id: input.stagedRecordId },
            select: {
              recordId: true,
              review: true,
              validation: true,
              personalData: true,
              version: true,
            },
          });
          if (staged === null) throw new MigrationDataError('not-found');
          if (!(await lockRow(tx, 'MigrationRecord', staged.recordId)))
            throw new MigrationDataError('not-found');
          if (staged.version !== input.expectedVersion)
            throw new MigrationDataError('conflict');
          // approve | reject a pending revision; withdraw an approval.
          const from = input.review === 'pending' ? ['approved'] : ['pending'];
          if (!from.includes(staged.review))
            throw new MigrationDataError('invalid-state');
          if (
            input.review === 'approved' &&
            (staged.validation !== 'valid' || staged.personalData !== 'none')
          )
            throw new MigrationDataError('invalid-state');

          const reviewed = await tx.migrationStagedRecord.updateMany({
            where: {
              id: input.stagedRecordId,
              version: input.expectedVersion,
              review: { in: from },
            },
            data: {
              review: input.review,
              reviewedByUserId: input.actorId,
              reviewedAt: input.now,
              reviewNote: input.note,
              version: { increment: 1 },
            },
          });
          if (reviewed.count !== 1) throw new MigrationDataError('conflict');

          // The record follows its CURRENT revision only, and never leaves a
          // publication or a merge because of a review.
          const status: RecordStatus =
            input.review === 'approved'
              ? 'approved'
              : input.review === 'rejected'
                ? 'rejected'
                : 'staged';
          await tx.migrationRecord.updateMany({
            where: {
              id: staged.recordId,
              currentStagedRecordId: input.stagedRecordId,
              status: { in: ['staged', 'approved', 'rejected'] },
            },
            data: { status, updatedAt: input.now, version: { increment: 1 } },
          });
          await audit(tx, {
            action: 'migration.staged.reviewed',
            actorId: input.actorId,
            targetType: 'migration-staged-record',
            targetId: input.stagedRecordId,
            before: { review: staged.review, version: String(staged.version) },
            after: {
              review: input.review,
              recordId: staged.recordId,
              version: String(staged.version + 1),
            },
            authorisingSource: ADMINISTER,
          });
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    async decideDuplicate(input) {
      try {
        await db.$transaction(async (tx) => {
          const candidate = await tx.migrationDuplicateCandidate.findFirst({
            where: { id: input.candidateId },
            select: {
              recordId: true,
              otherRecordId: true,
              state: true,
              crossLanguage: true,
              version: true,
            },
          });
          if (candidate === null) throw new MigrationDataError('not-found');
          if (!(await lockRow(tx, 'MigrationRecord', candidate.recordId)))
            throw new MigrationDataError('not-found');
          if (candidate.version !== input.expectedVersion)
            throw new MigrationDataError('conflict');
          if (candidate.state === input.state)
            throw new MigrationDataError('invalid-state');
          // A cross-language pair is never merged (CHECK too).
          if (input.state === 'merged' && candidate.crossLanguage)
            throw new MigrationDataError('cross-language');

          const records = await tx.migrationRecord.findMany({
            where: { id: { in: [candidate.recordId, candidate.otherRecordId] } },
            select: { id: true, status: true, mergedIntoRecordId: true },
          });
          const record = records.find((row) => row.id === candidate.recordId);
          const other = records.find((row) => row.id === candidate.otherRecordId);
          if (record === undefined || other === undefined)
            throw new MigrationDataError('not-found');

          const merging = input.state === 'merged';
          const wasMerged =
            candidate.state === 'merged' || candidate.state === 'collapsed';
          if (merging) {
            // One merge target per record, no cycle, and nothing published is
            // folded into another record by a decision.
            if (
              (record.mergedIntoRecordId !== null &&
                record.mergedIntoRecordId !== candidate.otherRecordId) ||
              other.mergedIntoRecordId === candidate.recordId ||
              record.status === 'published'
            )
              throw new MigrationDataError('invalid-state');
          }

          const decided = await tx.migrationDuplicateCandidate.updateMany({
            where: { id: input.candidateId, version: input.expectedVersion },
            data: {
              state: input.state,
              decidedByUserId: input.actorId,
              decidedAt: input.now,
              note: input.note,
              version: { increment: 1 },
            },
          });
          if (decided.count !== 1) throw new MigrationDataError('conflict');

          if (merging && record.mergedIntoRecordId === null) {
            await tx.migrationRecord.updateMany({
              where: { id: candidate.recordId },
              data: {
                status: 'merged',
                mergedIntoRecordId: candidate.otherRecordId,
                updatedAt: input.now,
                version: { increment: 1 },
              },
            });
          } else if (
            !merging &&
            wasMerged &&
            record.mergedIntoRecordId === candidate.otherRecordId
          ) {
            // A merge is reversible: the record returns to what its own
            // revision says; every URL it carried was kept throughout.
            await tx.migrationRecord.updateMany({
              where: { id: candidate.recordId },
              data: {
                status: await unmergedStatus(tx, candidate.recordId),
                mergedIntoRecordId: null,
                updatedAt: input.now,
                version: { increment: 1 },
              },
            });
          }
          await audit(tx, {
            action: 'migration.duplicate.decided',
            actorId: input.actorId,
            targetType: 'migration-duplicate-candidate',
            targetId: input.candidateId,
            before: { state: candidate.state, version: String(candidate.version) },
            after: {
              state: input.state,
              recordId: candidate.recordId,
              otherRecordId: candidate.otherRecordId,
              version: String(candidate.version + 1),
            },
            authorisingSource: ADMINISTER,
          });
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    async decideTopicMapping(input) {
      // Confirmed exactly when it names a Topic (CHECK too).
      if ((input.state === 'confirmed') !== (input.topicId !== null))
        throw new MigrationDataError('invalid');
      try {
        await db.$transaction(async (tx) => {
          const before = await tx.migrationTopicMapping.findFirst({
            where: { id: input.mappingId },
            select: { state: true, version: true },
          });
          const decided = await tx.migrationTopicMapping.updateMany({
            where: { id: input.mappingId, version: input.expectedVersion },
            data: {
              state: input.state,
              topicId: input.topicId,
              decidedByUserId: input.actorId,
              decidedAt: input.now,
              version: { increment: 1 },
            },
          });
          if (decided.count !== 1)
            missedBecause(before, input.expectedVersion, [before?.state ?? '']);
          await audit(tx, {
            action: 'migration.topic-mapping.decided',
            actorId: input.actorId,
            targetType: 'migration-topic-mapping',
            targetId: input.mappingId,
            before: {
              state: before?.state ?? '',
              version: String(input.expectedVersion),
            },
            after: {
              state: input.state,
              topicId: input.topicId ?? 'none',
              version: String(input.expectedVersion + 1),
            },
            authorisingSource: ADMINISTER,
          });
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    async decideError(input) {
      try {
        await db.$transaction(async (tx) => {
          const error = await tx.migrationError.findFirst({
            where: { id: input.errorId },
            select: {
              runId: true,
              resolution: true,
              retryEligible: true,
              version: true,
              run: { select: { state: true } },
            },
          });
          if (error === null) throw new MigrationDataError('not-found');
          if (error.version !== input.expectedVersion)
            throw new MigrationDataError('conflict');
          if (error.resolution !== 'open') throw new MigrationDataError('invalid-state');
          // Access failures and other ineligible errors are never retried (CHECK too).
          if (input.resolution === 'retry-requested' && !error.retryEligible)
            throw new MigrationDataError('not-retryable');
          const decided = await tx.migrationError.updateMany({
            where: {
              id: input.errorId,
              version: input.expectedVersion,
              resolution: 'open',
            },
            data: {
              resolution: input.resolution,
              resolvedByUserId: input.actorId,
              resolvedAt: input.now,
              version: { increment: 1 },
            },
          });
          if (decided.count !== 1) throw new MigrationDataError('conflict');
          // A retry while the run is open returns its item to the queue; a
          // closed run's record is fetched again by the next run.
          let requeued = 0;
          if (input.resolution === 'retry-requested' && error.run.state === 'open') {
            const items = await tx.migrationRunItem.updateMany({
              where: { errorId: input.errorId, outcome: 'errored', runId: error.runId },
              data: { outcome: 'pending', nextAttemptAt: null, updatedAt: input.now },
            });
            requeued = items.count;
          }
          await audit(tx, {
            action: 'migration.error.decided',
            actorId: input.actorId,
            targetType: 'migration-error',
            targetId: input.errorId,
            before: { resolution: 'open', version: String(error.version) },
            after: {
              resolution: input.resolution,
              requeued: String(requeued),
              version: String(error.version + 1),
            },
            authorisingSource: ADMINISTER,
          });
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    async classifyDisappearance(input) {
      try {
        await db.$transaction(async (tx) => {
          if (!(await lockRow(tx, 'MigrationRecord', input.recordId)))
            throw new MigrationDataError('not-found');
          const before = await tx.migrationRecord.findFirst({
            where: { id: input.recordId },
            select: { observed: true, disappearance: true, version: true },
          });
          const classified = await tx.migrationRecord.updateMany({
            where: {
              id: input.recordId,
              version: input.expectedVersion,
              observed: 'missing',
            },
            data: {
              disappearance: input.classification,
              disappearanceNote: input.note,
              classifiedByUserId: input.actorId,
              classifiedAt: input.now,
              updatedAt: input.now,
              version: { increment: 1 },
            },
          });
          if (classified.count !== 1)
            missedBecause(
              before === null
                ? null
                : { version: before.version, state: before.observed },
              input.expectedVersion,
              ['missing'],
            );
          await audit(tx, {
            action: 'migration.record.classified',
            actorId: input.actorId,
            targetType: 'migration-record',
            targetId: input.recordId,
            before: {
              disappearance: before?.disappearance ?? 'none',
              version: String(input.expectedVersion),
            },
            after: {
              disappearance: input.classification,
              version: String(input.expectedVersion + 1),
            },
            authorisingSource: ADMINISTER,
          });
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    async decideRights(input) {
      // Only owned or licensed material may be eligible for release (CHECK too).
      if (
        input.visibility === 'public-eligible' &&
        input.licence !== 'organisation-owned' &&
        input.licence !== 'licensed'
      )
        throw new MigrationDataError('invalid');
      try {
        await db.$transaction(async (tx) => {
          const before = await tx.migrationAssetProvenance.findFirst({
            where: { id: input.provenanceId },
            select: { licence: true, visibility: true, version: true },
          });
          const decided = await tx.migrationAssetProvenance.updateMany({
            where: { id: input.provenanceId, version: input.expectedVersion },
            data: {
              licence: input.licence,
              visibility: input.visibility,
              licenceEvidence: input.licenceEvidence,
              rightsHolder: input.rightsHolder,
              decidedByUserId: input.actorId,
              decidedAt: input.now,
              version: { increment: 1 },
            },
          });
          if (decided.count !== 1)
            missedBecause(
              before === null
                ? null
                : { version: before.version, state: before.visibility },
              input.expectedVersion,
              [before?.visibility ?? ''],
            );
          await audit(tx, {
            action: 'migration.rights.decided',
            actorId: input.actorId,
            targetType: 'migration-asset-provenance',
            targetId: input.provenanceId,
            before: {
              licence: before?.licence ?? '',
              visibility: before?.visibility ?? '',
              version: String(input.expectedVersion),
            },
            after: {
              licence: input.licence,
              visibility: input.visibility,
              version: String(input.expectedVersion + 1),
            },
            authorisingSource: ADMINISTER,
          });
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    async decideLegacyMapping(input) {
      try {
        await db.$transaction(async (tx) => {
          const mapping = await tx.migrationLegacyMapping.findFirst({
            where: { id: input.mappingId },
            select: { state: true, version: true, entry: { select: { state: true } } },
          });
          if (mapping === null) throw new MigrationDataError('not-found');
          if (mapping.version !== input.expectedVersion)
            throw new MigrationDataError('conflict');
          if (mapping.state === input.state)
            throw new MigrationDataError('invalid-state');
          // A mapping whose publication was rolled back points at a withdrawn
          // record; it is not re-enabled by a mapping decision.
          if (input.state === 'active' && mapping.entry?.state === 'rolled-back')
            throw new MigrationDataError('invalid-state');
          const decided = await tx.migrationLegacyMapping.updateMany({
            where: { id: input.mappingId, version: input.expectedVersion },
            data: {
              state: input.state,
              changedAt: input.now,
              changedByUserId: input.actorId,
              version: { increment: 1 },
            },
          });
          if (decided.count !== 1) throw new MigrationDataError('conflict');
          await audit(tx, {
            action: 'migration.legacy-mapping.decided',
            actorId: input.actorId,
            targetType: 'migration-legacy-mapping',
            targetId: input.mappingId,
            before: { state: mapping.state, version: String(mapping.version) },
            after: { state: input.state, version: String(mapping.version + 1) },
            authorisingSource: ADMINISTER,
          });
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },
  };
}
