import 'server-only';

import { randomUUID } from 'node:crypto';

import {
  MIGRATION_LIMITS,
  type MigrationPipelinePort,
  type RunCounts,
} from '@minhaj/contracts/migration';

import { getDatabaseClient } from '../../client.ts';
import {
  ACQUISITION_KEY,
  ADMINISTER,
  LOCKED_TRANSACTION,
  MigrationDataError,
  OPEN_RUN_KEY,
  audit,
  bounded,
  heldRun,
  isUniqueViolationOn,
  lockRow,
  missedBecause,
  numberOf,
  refuse,
  runRow,
  toRunRecord,
  type Client,
} from './shared.ts';

/**
 * The pipeline's persistence — what a run reads and writes, checkpoint by
 * checkpoint, so a crash at any point resumes without duplicating evidence,
 * revisions or run items.
 *
 * ONE OPEN RUN PER SOURCE (a filtered unique index), held by a LEASE: every
 * checkpoint locks the run row and proves the caller still holds its lease,
 * so a runner another one resumed past can never write over its successor.
 *
 * EXTERNAL KEYS ARE COMPARED BY THE DATABASE. Discovery and topic mapping
 * match keys with SQL's own comparison (OPENJSON joined to the table), never a
 * JavaScript equality that could disagree with the unique key's collation.
 */

/** Duplicate candidates one staging checkpoint may write. */
const MAX_DUPLICATES = 25;
/** Legacy URLs one lookup may name. */
const MAX_DIGESTS = MIGRATION_LIMITS.links;
/** Matches one duplicate question returns. */
const MAX_MATCHES = 25;

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** The item a checkpoint writes for, proved to be this run's and this record's. */
async function pendingItem(
  tx: Client,
  input: { readonly itemId: string; readonly runId: string; readonly recordId: string },
): Promise<{ readonly sourceId: string }> {
  const item = await tx.migrationRunItem.findFirst({
    where: { id: input.itemId },
    select: {
      runId: true,
      recordId: true,
      outcome: true,
      run: { select: { state: true, sourceId: true } },
    },
  });
  if (item === null) throw new MigrationDataError('not-found');
  if (item.runId !== input.runId || item.recordId !== input.recordId)
    throw new MigrationDataError('invalid');
  if (item.run.state !== 'open' || item.outcome !== 'pending')
    throw new MigrationDataError('invalid-state');
  return { sourceId: item.run.sourceId };
}

export function createMigrationPipeline(): MigrationPipelinePort {
  const db = getDatabaseClient();

  return {
    async openRun(input) {
      if (input.leaseUntil.getTime() <= input.now.getTime())
        throw new MigrationDataError('invalid');
      try {
        return await db.$transaction(async (tx) => {
          const source = await tx.migrationSource.findFirst({
            where: { id: input.sourceId },
            select: {
              authorityKind: true,
              authorisationReference: true,
              authorisedOn: true,
              state: true,
            },
          });
          if (source === null) throw new MigrationDataError('not-found');
          // A fixture, or an authorised source carrying its written
          // authorisation — checked here beneath the service (a CHECK binds the
          // evidence to the kind as well).
          if (
            source.authorityKind !== 'fixture' &&
            (source.authorityKind !== 'authorised' ||
              source.authorisationReference === null ||
              source.authorisedOn === null)
          )
            throw new MigrationDataError('real-source-not-authorised');
          if (source.state !== 'active') throw new MigrationDataError('invalid-state');

          // The source's one open run, under a range lock: a concurrent opener
          // waits here, then resumes or is refused — it never forks a second.
          const open = await tx.$queryRaw<{ id: string }[]>`
            SELECT [id] FROM [dbo].[MigrationRun] WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
            WHERE [sourceId] = ${input.sourceId} AND [state] = N'open'`;
          const current = open[0];
          if (current !== undefined) {
            const run = await runRow(tx, current.id);
            const lapsed =
              run.leaseExpiresAt === null ||
              run.leaseExpiresAt.getTime() <= input.now.getTime();
            if (!lapsed && run.leaseToken !== input.leaseToken)
              throw new MigrationDataError('run-busy');
            const taken = await tx.migrationRun.updateMany({
              where: { id: run.id, version: run.version, state: 'open' },
              data: {
                leaseToken: input.leaseToken,
                leaseExpiresAt: input.leaseUntil,
                version: { increment: 1 },
              },
            });
            if (taken.count !== 1) throw new MigrationDataError('conflict');
            await audit(tx, {
              action: 'migration.run.resumed',
              actorId: input.operatorUserId,
              targetType: 'migration-run',
              targetId: run.id,
              before: { version: String(run.version) },
              after: {
                sourceId: run.sourceId,
                state: 'open',
                version: String(run.version + 1),
              },
              authorisingSource: ADMINISTER,
            });
            return { run: toRunRecord(await runRow(tx, run.id)), resumed: true };
          }

          await tx.migrationRun.create({
            data: {
              id: input.runId,
              sourceId: input.sourceId,
              operatorUserId: input.operatorUserId,
              state: 'open',
              ...input.provenance,
              discoveryComplete: false,
              leaseToken: input.leaseToken,
              leaseExpiresAt: input.leaseUntil,
              startedAt: input.now,
              reconciliation: 'pending',
              version: 1,
            },
            select: { id: true },
          });
          await audit(tx, {
            action: 'migration.run.started',
            actorId: input.operatorUserId,
            targetType: 'migration-run',
            targetId: input.runId,
            after: {
              sourceId: input.sourceId,
              state: 'open',
              adapterKey: input.provenance.adapterKey,
              adapterVersion: input.provenance.adapterVersion,
              codeRevision: input.provenance.codeRevision,
              version: '1',
            },
            authorisingSource: ADMINISTER,
          });
          return { run: toRunRecord(await runRow(tx, input.runId)), resumed: false };
        }, LOCKED_TRANSACTION);
      } catch (error) {
        if (isUniqueViolationOn(error, OPEN_RUN_KEY))
          throw new MigrationDataError('run-busy');
        refuse(error);
      }
    },

    async renewLease(runId, leaseToken, leaseUntil) {
      try {
        const renewed = await db.migrationRun.updateMany({
          where: { id: runId, state: 'open', leaseToken },
          data: { leaseExpiresAt: leaseUntil },
        });
        return renewed.count === 1;
      } catch (error) {
        refuse(error);
      }
    },

    async recordDiscovery(input) {
      if (input.items.length > MIGRATION_LIMITS.batch)
        throw new MigrationDataError('invalid');
      for (const item of input.items)
        if (
          item.externalKey.length < 1 ||
          item.externalKey.length > MIGRATION_LIMITS.externalKey ||
          (item.originalUrl !== null && item.originalUrl.length > MIGRATION_LIMITS.url) ||
          (item.legacyIdentifier !== null && item.legacyIdentifier.length > 200)
        )
          throw new MigrationDataError('invalid');
      try {
        await db.$transaction(async (tx) => {
          const run = await heldRun(tx, input.runId, input.leaseToken);
          if (input.items.length > 0) {
            const source = await tx.migrationSource.findFirst({
              where: { id: run.sourceId },
              select: { contentKind: true },
            });
            if (source === null) throw new MigrationDataError('not-found');
            const json = JSON.stringify(
              input.items.map((item) => ({
                k: item.externalKey,
                u: item.originalUrl,
                l: item.legacyIdentifier,
              })),
            );
            // One statement set, compared by SQL: new records are created
            // `discovered`; known ones are seen again (present, disappearance
            // cleared); and the run gains an item, at the next free position in
            // batch order, only for a record it does not already have. Run
            // twice, it changes nothing.
            await tx.$executeRaw`
              DECLARE @items TABLE (
                [ordinal] INT NOT NULL,
                [externalKey] NVARCHAR(400) NOT NULL,
                [originalUrl] NVARCHAR(2000) NULL,
                [legacyIdentifier] NVARCHAR(200) NULL);
              INSERT INTO @items ([ordinal], [externalKey], [originalUrl], [legacyIdentifier])
              SELECT CAST(j.[key] AS INT), j2.[k], j2.[u], j2.[l]
              FROM OPENJSON(${json}) j
              CROSS APPLY OPENJSON(j.[value]) WITH (
                [k] NVARCHAR(400) '$.k', [u] NVARCHAR(2000) '$.u', [l] NVARCHAR(200) '$.l') j2;

              INSERT INTO [dbo].[MigrationRecord]
                ([id], [sourceId], [externalKey], [originalUrl], [legacyIdentifier], [contentKind],
                 [status], [observed], [firstObservedRunId], [lastObservedRunId], [version], [createdAt], [updatedAt])
              SELECT LOWER(CONVERT(NVARCHAR(36), NEWID())), ${run.sourceId}, i.[externalKey],
                     i.[originalUrl], i.[legacyIdentifier], ${source.contentKind},
                     N'discovered', N'present', ${run.id}, ${run.id}, 1, ${input.now}, ${input.now}
              FROM (
                SELECT *, ROW_NUMBER() OVER (PARTITION BY [externalKey] ORDER BY [ordinal]) AS [rn]
                FROM @items) i
              WHERE i.[rn] = 1
                AND NOT EXISTS (
                  SELECT 1 FROM [dbo].[MigrationRecord] r
                  WHERE r.[sourceId] = ${run.sourceId} AND r.[externalKey] = i.[externalKey]);

              UPDATE r SET
                r.[lastObservedRunId] = ${run.id}, r.[observed] = N'present',
                r.[disappearance] = NULL, r.[disappearanceNote] = NULL,
                r.[classifiedByUserId] = NULL, r.[classifiedAt] = NULL,
                r.[updatedAt] = ${input.now}, r.[version] = r.[version] + 1
              FROM [dbo].[MigrationRecord] r
              WHERE r.[sourceId] = ${run.sourceId}
                AND r.[externalKey] IN (SELECT [externalKey] FROM @items)
                AND (r.[lastObservedRunId] <> ${run.id} OR r.[observed] <> N'present');

              DECLARE @base INT = (
                SELECT ISNULL(MAX([position]), -1) FROM [dbo].[MigrationRunItem] WITH (UPDLOCK, HOLDLOCK)
                WHERE [runId] = ${run.id});
              INSERT INTO [dbo].[MigrationRunItem]
                ([id], [runId], [recordId], [position], [outcome], [fetched], [parsed], [attempts], [updatedAt])
              SELECT LOWER(CONVERT(NVARCHAR(36), NEWID())), ${run.id}, r.[id],
                     @base + ROW_NUMBER() OVER (ORDER BY f.[firstOrdinal]),
                     N'pending', 0, 0, 0, ${input.now}
              FROM (
                SELECT [externalKey], MIN([ordinal]) AS [firstOrdinal] FROM @items GROUP BY [externalKey]) f
              JOIN [dbo].[MigrationRecord] r
                ON r.[sourceId] = ${run.sourceId} AND r.[externalKey] = f.[externalKey]
              WHERE NOT EXISTS (
                SELECT 1 FROM [dbo].[MigrationRunItem] x
                WHERE x.[runId] = ${run.id} AND x.[recordId] = r.[id]);`;
          }
          const advanced = await tx.migrationRun.updateMany({
            where: { id: run.id, leaseToken: input.leaseToken, state: 'open' },
            data: {
              discoveryCursor: input.nextCursor,
              // Completeness never regresses (51375 refuses it too).
              discoveryComplete: run.discoveryComplete || input.complete,
            },
          });
          if (advanced.count !== 1) throw new MigrationDataError('lease-lost');
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    async pendingItems(runId, limit, now) {
      const rows = await db.migrationRunItem.findMany({
        where: {
          runId,
          outcome: 'pending',
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        take: bounded(limit, MIGRATION_LIMITS.batch),
        select: {
          id: true,
          recordId: true,
          attempts: true,
          record: {
            select: {
              externalKey: true,
              originalUrl: true,
              legacyIdentifier: true,
              latestSnapshot: { select: { id: true, checksum: true } },
              currentStaged: {
                select: { id: true, revision: true, inputChecksum: true },
              },
            },
          },
        },
      });
      return rows.map((row) => ({
        itemId: row.id,
        recordId: row.recordId,
        externalKey: row.record.externalKey,
        originalUrl: row.record.originalUrl,
        legacyIdentifier: row.record.legacyIdentifier,
        attempts: row.attempts,
        latestSnapshot: row.record.latestSnapshot,
        currentStaged: row.record.currentStaged,
      }));
    },

    async scheduleRetry(itemId, attempts, nextAttemptAt) {
      try {
        const scheduled = await db.migrationRunItem.updateMany({
          where: { id: itemId, outcome: 'pending', run: { state: 'open' } },
          data: { attempts, nextAttemptAt, updatedAt: new Date() },
        });
        if (scheduled.count !== 1) {
          const exists = await db.migrationRunItem.findFirst({
            where: { id: itemId },
            select: { id: true },
          });
          throw new MigrationDataError(exists === null ? 'not-found' : 'invalid-state');
        }
      } catch (error) {
        refuse(error);
      }
    },

    async storeSnapshot(input) {
      if (!SHA256_HEX.test(input.checksum)) throw new MigrationDataError('invalid');
      if (input.body.byteLength > MIGRATION_LIMITS.maxBodyBytes)
        throw new MigrationDataError('invalid');
      try {
        return await db.$transaction(async (tx) => {
          if (!(await lockRow(tx, 'MigrationRecord', input.recordId)))
            throw new MigrationDataError('not-found');
          const { sourceId } = await pendingItem(tx, input);
          if (sourceId !== input.sourceId) throw new MigrationDataError('invalid');
          const record = await tx.migrationRecord.findFirst({
            where: { id: input.recordId },
            select: {
              latestSnapshot: { select: { id: true, checksum: true, disposedAt: true } },
            },
          });
          const latest = record?.latestSnapshot ?? null;
          // Evidence is never written twice: the same bytes again (a crash
          // between storing and staging, or an unchanged source) re-use the
          // newest snapshot — unless its body was disposed of, when the bytes
          // are evidence again and are kept anew.
          const reused =
            latest !== null &&
            latest.checksum === input.checksum &&
            latest.disposedAt === null;
          const snapshotId = reused ? latest.id : randomUUID();
          if (!reused) {
            await tx.migrationRawSnapshot.create({
              data: {
                id: snapshotId,
                sourceId: input.sourceId,
                recordId: input.recordId,
                runId: input.runId,
                requestedUrl: input.requestedUrl,
                finalUrl: input.finalUrl,
                httpStatus: input.httpStatus,
                contentType: input.contentType,
                headers: input.headers,
                body: input.body.slice(),
                byteSize: input.body.byteLength,
                checksum: input.checksum,
                fetchedAt: input.fetchedAt,
                fetcherKey: input.fetcherKey,
                fetcherVersion: input.fetcherVersion,
                personalData: input.personalData,
              },
              select: { id: true },
            });
          }
          await tx.$executeRaw`
            UPDATE [dbo].[MigrationRecord] SET
              [latestSnapshotId] = ${snapshotId},
              [status] = CASE WHEN [status] IN (N'discovered', N'errored') THEN N'fetched' ELSE [status] END,
              [updatedAt] = ${input.fetchedAt},
              [version] = [version] + 1
            WHERE [id] = ${input.recordId}`;
          const marked = await tx.migrationRunItem.updateMany({
            where: { id: input.itemId, outcome: 'pending' },
            data: { fetched: true, snapshotId, updatedAt: input.fetchedAt },
          });
          if (marked.count !== 1) throw new MigrationDataError('conflict');
          return { snapshotId, reused };
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    async markUnchanged(itemId, now) {
      try {
        const marked = await db.migrationRunItem.updateMany({
          where: { id: itemId, outcome: 'pending', run: { state: 'open' } },
          data: {
            outcome: 'unchanged',
            fetched: true,
            nextAttemptAt: null,
            updatedAt: now,
          },
        });
        if (marked.count !== 1) {
          const exists = await db.migrationRunItem.findFirst({
            where: { id: itemId },
            select: { id: true },
          });
          throw new MigrationDataError(exists === null ? 'not-found' : 'invalid-state');
        }
      } catch (error) {
        refuse(error);
      }
    },

    async markExcluded(itemId, now) {
      try {
        await db.$transaction(async (tx) => {
          const item = await tx.migrationRunItem.findFirst({
            where: { id: itemId },
            select: { recordId: true },
          });
          if (item === null) throw new MigrationDataError('not-found');
          const marked = await tx.migrationRunItem.updateMany({
            where: { id: itemId, outcome: 'pending', run: { state: 'open' } },
            data: { outcome: 'excluded', nextAttemptAt: null, updatedAt: now },
          });
          if (marked.count !== 1) throw new MigrationDataError('invalid-state');
          // Only a record not yet staged follows; a reviewed or published
          // record keeps the state a person or a publication gave it.
          await tx.$executeRaw`
            UPDATE [dbo].[MigrationRecord] SET
              [status] = N'excluded', [updatedAt] = ${now}, [version] = [version] + 1
            WHERE [id] = ${item.recordId} AND [status] IN (N'discovered', N'fetched', N'errored')`;
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    async stage(input) {
      if (
        input.categories.length > MIGRATION_LIMITS.categories ||
        input.links.length > MIGRATION_LIMITS.links ||
        input.duplicates.length > MAX_DUPLICATES ||
        (input.outcome === 'rejected') !== (input.error !== null)
      )
        throw new MigrationDataError('invalid');
      try {
        return await db.$transaction(async (tx) => {
          if (!(await lockRow(tx, 'MigrationRecord', input.recordId)))
            throw new MigrationDataError('not-found');
          const { sourceId } = await pendingItem(tx, input);
          const record = await tx.migrationRecord.findFirst({
            where: { id: input.recordId },
            select: { sourceId: true, status: true, mergedIntoRecordId: true },
          });
          if (record === null) throw new MigrationDataError('not-found');
          if (record.sourceId !== input.sourceId || sourceId !== input.sourceId)
            throw new MigrationDataError('invalid');

          // The earlier pending or approved revision is superseded; its
          // reviewer columns stay as they were.
          await tx.migrationStagedRecord.updateMany({
            where: { recordId: input.recordId, review: { in: ['pending', 'approved'] } },
            data: { review: 'superseded', version: { increment: 1 } },
          });
          const latest = await tx.migrationStagedRecord.aggregate({
            where: { recordId: input.recordId },
            _max: { revision: true },
          });
          const revision = (latest._max.revision ?? 0) + 1;
          const stagedRecordId = randomUUID();
          await tx.migrationStagedRecord.create({
            data: {
              id: stagedRecordId,
              recordId: input.recordId,
              snapshotId: input.snapshotId,
              runId: input.runId,
              revision,
              contentKind: input.contentKind,
              title: input.title,
              titleKey: input.titleKey,
              dedupeKey: input.dedupeKey,
              languageCode: input.languageCode,
              payload: input.payload,
              payloadChecksum: input.payloadChecksum,
              ...input.provenance,
              inputChecksum: input.inputChecksum,
              producedAt: input.producedAt,
              validation: input.validation,
              issues: input.issues.length === 0 ? null : JSON.stringify(input.issues),
              personalData: input.personalData,
              review: 'pending',
              version: 1,
            },
            select: { id: true },
          });

          if (input.categories.length > 0) {
            const json = JSON.stringify(
              input.categories.map((category) => ({
                k: category.key,
                l: category.label,
              })),
            );
            // A category the source never used before becomes an `unmapped`
            // mapping for a person to decide; the range lock orders two
            // stagings that meet the same new category.
            await tx.$executeRaw`
              INSERT INTO [dbo].[MigrationTopicMapping]
                ([id], [sourceId], [categoryKey], [label], [state], [version])
              SELECT LOWER(CONVERT(NVARCHAR(36), NEWID())), ${input.sourceId}, c.[k], c.[l], N'unmapped', 1
              FROM (
                SELECT j.[k], j.[l], ROW_NUMBER() OVER (PARTITION BY j.[k] ORDER BY j.[k]) AS [rn]
                FROM OPENJSON(${json}) WITH ([k] NVARCHAR(200) '$.k', [l] NVARCHAR(200) '$.l') j) c
              WHERE c.[rn] = 1
                AND NOT EXISTS (
                  SELECT 1 FROM [dbo].[MigrationTopicMapping] m WITH (UPDLOCK, HOLDLOCK)
                  WHERE m.[sourceId] = ${input.sourceId} AND m.[categoryKey] = c.[k]);

              INSERT INTO [dbo].[MigrationStagedCategory] ([stagedRecordId], [topicMappingId])
              SELECT DISTINCT ${stagedRecordId}, m.[id]
              FROM [dbo].[MigrationTopicMapping] m
              WHERE m.[sourceId] = ${input.sourceId}
                AND m.[categoryKey] IN (
                  SELECT j.[k] FROM OPENJSON(${json}) WITH ([k] NVARCHAR(200) '$.k') j);`;
          }

          if (input.links.length > 0)
            await tx.migrationStagedLink.createMany({
              data: input.links.map((link) => ({
                stagedRecordId,
                position: link.position,
                href: link.href,
                disposition: link.disposition,
                rewrittenTo: link.rewrittenTo,
                legacyMappingId: link.legacyMappingId,
              })),
            });

          // Duplicate candidates: a pair already recorded keeps its state (a
          // person's `distinct` is never overridden); a new one is `open`, or
          // `collapsed` for a hard identity, which collapses this record.
          let collapseInto: string | null = null;
          if (input.duplicates.length > 0) {
            const existing = await tx.migrationDuplicateCandidate.findMany({
              where: {
                recordId: input.recordId,
                otherRecordId: {
                  in: input.duplicates.map((entry) => entry.otherRecordId),
                },
              },
              select: { otherRecordId: true, signal: true, state: true },
            });
            const known = new Map(
              existing.map((entry) => [
                `${entry.otherRecordId}|${entry.signal}`,
                entry.state,
              ]),
            );
            const fresh = input.duplicates.filter(
              (entry) => !known.has(`${entry.otherRecordId}|${entry.signal}`),
            );
            if (fresh.length > 0)
              await tx.migrationDuplicateCandidate.createMany({
                data: fresh.map((entry) => ({
                  id: randomUUID(),
                  recordId: input.recordId,
                  otherRecordId: entry.otherRecordId,
                  signal: entry.signal,
                  score: entry.score,
                  crossLanguage: entry.crossLanguage,
                  state: entry.collapse ? 'collapsed' : 'open',
                  createdAt: input.producedAt,
                  version: 1,
                })),
              });
            const hard = input.duplicates.find((entry) => {
              if (!entry.collapse) return false;
              const state = known.get(`${entry.otherRecordId}|${entry.signal}`);
              return state === undefined || state === 'collapsed';
            });
            collapseInto = hard?.otherRecordId ?? null;
          }

          let errorId: string | null = null;
          if (input.error !== null) {
            errorId = randomUUID();
            await tx.migrationError.create({
              data: {
                id: errorId,
                sourceId: input.error.sourceId,
                runId: input.error.runId,
                recordId: input.error.recordId,
                stage: input.error.stage,
                classification: input.error.classification,
                retryEligible: input.error.retryEligible,
                httpStatus: input.error.httpStatus,
                attempt: input.error.attempt,
                detail: input.error.detail,
                occurredAt: input.error.occurredAt,
                resolution: 'open',
                version: 1,
              },
              select: { id: true },
            });
          }

          const marked = await tx.migrationRunItem.updateMany({
            where: { id: input.itemId, outcome: 'pending' },
            data: {
              outcome: input.outcome,
              fetched: true,
              parsed: true,
              snapshotId: input.snapshotId,
              stagedRecordId,
              errorId,
              nextAttemptAt: null,
              updatedAt: input.producedAt,
            },
          });
          if (marked.count !== 1) throw new MigrationDataError('conflict');

          // A collapse, or a merge a person already made, wins over the
          // revision's own state.
          const mergedInto = collapseInto ?? record.mergedIntoRecordId;
          const moved = await tx.migrationRecord.updateMany({
            where: { id: input.recordId },
            data: {
              currentStagedRecordId: stagedRecordId,
              status: mergedInto !== null ? 'merged' : input.outcome,
              mergedIntoRecordId: mergedInto,
              updatedAt: input.producedAt,
              version: { increment: 1 },
            },
          });
          if (moved.count !== 1) throw new MigrationDataError('conflict');
          return { stagedRecordId, revision };
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    async recordError(input) {
      try {
        return await db.$transaction(async (tx) => {
          const errorId = randomUUID();
          await tx.migrationError.create({
            data: {
              id: errorId,
              sourceId: input.sourceId,
              runId: input.runId,
              recordId: input.recordId,
              stage: input.stage,
              classification: input.classification,
              retryEligible: input.retryEligible,
              httpStatus: input.httpStatus,
              attempt: input.attempt,
              detail: input.detail,
              occurredAt: input.occurredAt,
              resolution: 'open',
              version: 1,
            },
            select: { id: true },
          });
          if (input.itemId !== null) {
            if (input.recordId === null) throw new MigrationDataError('invalid');
            await pendingItem(tx, {
              itemId: input.itemId,
              runId: input.runId,
              recordId: input.recordId,
            });
            const marked = await tx.migrationRunItem.updateMany({
              where: { id: input.itemId, outcome: 'pending' },
              data: {
                outcome: 'errored',
                errorId,
                attempts: Math.min(100, Math.max(0, input.attempt)),
                nextAttemptAt: null,
                updatedAt: input.occurredAt,
              },
            });
            if (marked.count !== 1) throw new MigrationDataError('conflict');
            // A record that never reached staging is `errored`; one already
            // staged, reviewed or published keeps that state.
            await tx.$executeRaw`
              UPDATE [dbo].[MigrationRecord] SET
                [status] = N'errored', [updatedAt] = ${input.occurredAt}, [version] = [version] + 1
              WHERE [id] = ${input.recordId} AND [status] IN (N'discovered', N'fetched')`;
          }
          return { errorId };
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    async activeMappings(sourceId, legacyUrlDigests) {
      const digests = [...new Set(legacyUrlDigests)];
      if (digests.length > MAX_DIGESTS) throw new MigrationDataError('invalid');
      if (digests.length === 0) return new Map();
      const rows = await db.migrationLegacyMapping.findMany({
        where: { sourceId, state: 'active', legacyUrlDigest: { in: digests } },
        select: { id: true, canonicalPath: true, legacyUrlDigest: true },
      });
      return new Map(
        rows.map((row) => [
          row.legacyUrlDigest,
          { id: row.id, canonicalPath: row.canonicalPath },
        ]),
      );
    },

    async dedupeMatches(dedupeKey, excludingRecordId) {
      // Earliest first: a later record collapses into the earliest, and a
      // record already merged into another is never a collapse target.
      const rows = await db.migrationRecord.findMany({
        where: {
          id: { not: excludingRecordId },
          status: { not: 'merged' },
          currentStaged: { is: { dedupeKey } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: MAX_MATCHES,
        select: { id: true, currentStaged: { select: { languageCode: true } } },
      });
      return rows.map((row) => ({
        recordId: row.id,
        languageCode: row.currentStaged?.languageCode ?? null,
      }));
    },

    async titleMatches(contentKind, titleKey, excludingRecordId, limit) {
      const rows = await db.migrationRecord.findMany({
        where: {
          id: { not: excludingRecordId },
          status: { not: 'merged' },
          currentStaged: { is: { contentKind, titleKey } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: bounded(limit, MAX_MATCHES),
        select: { id: true, currentStaged: { select: { languageCode: true } } },
      });
      return rows.map((row) => ({
        recordId: row.id,
        languageCode: row.currentStaged?.languageCode ?? null,
      }));
    },

    async assetByChecksum(checksum) {
      const row = await db.migrationAssetProvenance.findFirst({
        where: { checksum },
        orderBy: [{ acquiredAt: 'asc' }, { id: 'asc' }],
        select: { assetId: true },
      });
      return row === null ? null : { assetId: row.assetId };
    },

    async recordAcquisition(input) {
      const key = {
        sourceId: input.sourceId,
        originalUrlDigest: input.originalUrlDigest,
        checksum: input.checksum,
      };
      try {
        return await db.$transaction(async (tx) => {
          const existing = await tx.migrationAssetProvenance.findFirst({
            where: key,
            select: { id: true },
          });
          if (existing !== null) return { provenanceId: existing.id, created: false };
          const provenanceId = randomUUID();
          await tx.migrationAssetProvenance.create({
            data: {
              id: provenanceId,
              ...key,
              recordId: input.recordId,
              runId: input.runId,
              originalUrl: input.originalUrl,
              assetId: input.assetId,
              byteSize: BigInt(input.byteSize),
              mediaType: input.mediaType,
              licence: input.licence,
              licenceEvidence: input.licenceEvidence,
              rightsHolder: input.rightsHolder,
              visibility: 'restricted',
              acquiredAt: input.acquiredAt,
              version: 1,
            },
            select: { id: true },
          });
          return { provenanceId, created: true };
        });
      } catch (error) {
        if (isUniqueViolationOn(error, ACQUISITION_KEY)) {
          const winner = await db.migrationAssetProvenance.findFirst({
            where: key,
            select: { id: true },
          });
          if (winner !== null) return { provenanceId: winner.id, created: false };
        }
        refuse(error);
      }
    },

    async reconciliationCounts(runId) {
      const rows = await db.$queryRaw<Record<keyof RunCounts | 'runs', number | null>[]>`
        SELECT
          (SELECT CAST(COUNT(*) AS INT) FROM [dbo].[MigrationRun] WHERE [id] = ${runId}) AS [runs],
          i.[discovered], i.[pending], i.[fetched], i.[parsed], i.[staged], i.[unchanged],
          i.[rejected], i.[errored], i.[excluded], i.[inconsistent], i.[merged],
          s.[reviewPending], s.[approved], s.[reviewRejected], s.[superseded],
          e.[published], e.[mapped]
        FROM (
          SELECT
            CAST(COUNT(*) AS INT) AS [discovered],
            CAST(ISNULL(SUM(CASE WHEN it.[outcome] = N'pending' THEN 1 ELSE 0 END), 0) AS INT) AS [pending],
            CAST(ISNULL(SUM(CASE WHEN it.[fetched] = 1 THEN 1 ELSE 0 END), 0) AS INT) AS [fetched],
            CAST(ISNULL(SUM(CASE WHEN it.[parsed] = 1 THEN 1 ELSE 0 END), 0) AS INT) AS [parsed],
            CAST(ISNULL(SUM(CASE WHEN it.[outcome] = N'staged' THEN 1 ELSE 0 END), 0) AS INT) AS [staged],
            CAST(ISNULL(SUM(CASE WHEN it.[outcome] = N'unchanged' THEN 1 ELSE 0 END), 0) AS INT) AS [unchanged],
            CAST(ISNULL(SUM(CASE WHEN it.[outcome] = N'rejected' THEN 1 ELSE 0 END), 0) AS INT) AS [rejected],
            CAST(ISNULL(SUM(CASE WHEN it.[outcome] = N'errored' THEN 1 ELSE 0 END), 0) AS INT) AS [errored],
            CAST(ISNULL(SUM(CASE WHEN it.[outcome] = N'excluded' THEN 1 ELSE 0 END), 0) AS INT) AS [excluded],
            CAST(ISNULL(SUM(CASE
              WHEN it.[outcome] IN (N'staged', N'rejected') AND (it.[stagedRecordId] IS NULL OR it.[parsed] = 0) THEN 1
              WHEN it.[outcome] = N'unchanged' AND (it.[fetched] = 0 OR it.[stagedRecordId] IS NOT NULL) THEN 1
              WHEN it.[outcome] = N'errored' AND it.[errorId] IS NULL THEN 1
              WHEN it.[parsed] = 1 AND it.[fetched] = 0 THEN 1
              WHEN it.[fetched] = 1 AND it.[snapshotId] IS NULL AND it.[outcome] <> N'unchanged' THEN 1
              ELSE 0 END), 0) AS INT) AS [inconsistent],
            CAST(ISNULL(SUM(CASE WHEN c.[mergedIntoRecordId] IS NOT NULL THEN 1 ELSE 0 END), 0) AS INT) AS [merged]
          FROM [dbo].[MigrationRunItem] it
          JOIN [dbo].[MigrationRecord] c ON c.[id] = it.[recordId]
          WHERE it.[runId] = ${runId}) i
        CROSS JOIN (
          SELECT
            CAST(ISNULL(SUM(CASE WHEN [review] = N'pending' THEN 1 ELSE 0 END), 0) AS INT) AS [reviewPending],
            CAST(ISNULL(SUM(CASE WHEN [review] = N'approved' THEN 1 ELSE 0 END), 0) AS INT) AS [approved],
            CAST(ISNULL(SUM(CASE WHEN [review] = N'rejected' THEN 1 ELSE 0 END), 0) AS INT) AS [reviewRejected],
            CAST(ISNULL(SUM(CASE WHEN [review] = N'superseded' THEN 1 ELSE 0 END), 0) AS INT) AS [superseded]
          FROM [dbo].[MigrationStagedRecord] WHERE [runId] = ${runId}) s
        CROSS JOIN (
          SELECT
            CAST(COUNT(*) AS INT) AS [published],
            CAST(ISNULL(SUM(CASE WHEN m.[hit] IS NULL THEN 0 ELSE 1 END), 0) AS INT) AS [mapped]
          FROM [dbo].[MigrationManifestEntry] me
          JOIN [dbo].[MigrationStagedRecord] sr ON sr.[id] = me.[stagedRecordId]
          OUTER APPLY (
            SELECT TOP (1) 1 AS [hit] FROM [dbo].[MigrationLegacyMapping] lm
            WHERE lm.[manifestEntryId] = me.[id]) m
          WHERE sr.[runId] = ${runId} AND me.[state] = N'published') e`;
      const row = rows[0];
      if (row === undefined || numberOf(row.runs) === 0)
        throw new MigrationDataError('not-found');
      return {
        discovered: numberOf(row.discovered),
        pending: numberOf(row.pending),
        fetched: numberOf(row.fetched),
        parsed: numberOf(row.parsed),
        staged: numberOf(row.staged),
        unchanged: numberOf(row.unchanged),
        rejected: numberOf(row.rejected),
        errored: numberOf(row.errored),
        excluded: numberOf(row.excluded),
        inconsistent: numberOf(row.inconsistent),
        reviewPending: numberOf(row.reviewPending),
        approved: numberOf(row.approved),
        reviewRejected: numberOf(row.reviewRejected),
        superseded: numberOf(row.superseded),
        published: numberOf(row.published),
        mapped: numberOf(row.mapped),
        merged: numberOf(row.merged),
      };
    },

    async completeRun(input) {
      if (input.detail.length > 2000) throw new MigrationDataError('invalid');
      try {
        return await db.$transaction(async (tx) => {
          const run = await heldRun(tx, input.runId, input.leaseToken);
          // Absence is only meaningful after a COMPLETE discovery.
          if (!run.discoveryComplete) throw new MigrationDataError('invalid-state');
          // An observation, never a deletion: unseen records become `missing`
          // and keep every other column, publication included.
          const missing = await tx.$executeRaw`
            UPDATE [dbo].[MigrationRecord] SET
              [observed] = N'missing', [updatedAt] = ${input.now}, [version] = [version] + 1
            WHERE [sourceId] = ${run.sourceId}
              AND [lastObservedRunId] <> ${run.id}
              AND [observed] = N'present'`;
          const completed = await tx.migrationRun.updateMany({
            where: { id: run.id, version: run.version, state: 'open' },
            data: {
              state: 'completed',
              reconciliation: input.reconciliation,
              reconciledAt: input.now,
              reconciliationDetail: input.detail,
              endedAt: input.now,
              leaseToken: null,
              leaseExpiresAt: null,
              version: { increment: 1 },
            },
          });
          if (completed.count !== 1) throw new MigrationDataError('conflict');
          await audit(tx, {
            action: 'migration.run.completed',
            actorId: run.operatorUserId,
            targetType: 'migration-run',
            targetId: run.id,
            before: { state: 'open', version: String(run.version) },
            after: {
              state: 'completed',
              reconciliation: input.reconciliation,
              missing: String(missing),
              version: String(run.version + 1),
            },
            authorisingSource: ADMINISTER,
          });
          return { missing };
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    async cancelRun(input) {
      try {
        await db.$transaction(async (tx) => {
          if (!(await lockRow(tx, 'MigrationRun', input.runId)))
            throw new MigrationDataError('not-found');
          const run = await runRow(tx, input.runId);
          const cancelled = await tx.migrationRun.updateMany({
            where: { id: input.runId, version: input.expectedVersion, state: 'open' },
            data: {
              state: 'cancelled',
              endedAt: input.now,
              leaseToken: null,
              leaseExpiresAt: null,
              version: { increment: 1 },
            },
          });
          if (cancelled.count !== 1) missedBecause(run, input.expectedVersion, ['open']);
          await audit(tx, {
            action: 'migration.run.cancelled',
            actorId: input.actorId,
            targetType: 'migration-run',
            targetId: input.runId,
            before: { state: 'open', version: String(input.expectedVersion) },
            after: { state: 'cancelled', version: String(input.expectedVersion + 1) },
            authorisingSource: ADMINISTER,
          });
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },
  };
}
