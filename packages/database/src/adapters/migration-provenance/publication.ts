import 'server-only';

import { randomUUID } from 'node:crypto';

import {
  MIGRATION_LIMITS,
  isPublishableKind,
  type MigrationContentKind,
  type MigrationTargetRef,
  type MigrationPublicationPort,
  type ReviewState,
  type ValidationState,
} from '@minhaj/contracts/migration';

import { getDatabaseClient } from '../../client.ts';
import {
  ADMINISTER,
  ENTRY_SELECT,
  LOCKED_TRANSACTION,
  MANIFEST_SELECT,
  MigrationDataError,
  PUBLISH,
  TARGET_SELECT,
  audit,
  bounded,
  entryRow,
  lockRow,
  manifestRow,
  missedBecause,
  refuse,
  targetColumns,
  targetOf,
  toEntryRecord,
  toManifestRecord,
} from './shared.ts';

/**
 * Publication — manifests and their reversal.
 *
 * THE DATABASE RE-CHECKS AUTHORITY. Beginning a publication or a rollback
 * names the actor, and the manifest trigger (51378) refuses unless that
 * account holds `migration.publish` NOW with a live `migration-publication`
 * step-up on a live session — the service's own check is not the last word.
 * Entries name only approved, valid revisions of the manifest's source, join
 * only a draft, and move only in their manifest's phase (51379); a revision is
 * live in at most one manifest (a filtered unique index).
 *
 * WHAT A PUBLICATION MADE IS RECORDED ONCE: the entry's target, and one ACTIVE
 * legacy mapping per legacy URL (one active mapping per address, a filtered
 * unique index). A rollback disables those mappings — it never deletes them.
 */

/** Live manifest-entry states: a revision in one of these is in a manifest now. */
const LIVE_ENTRY_STATES = ['pending', 'publishing', 'published', 'rollback-refused'];
/** Manifest states whose entries are still in play. */
const LIVE_MANIFEST_STATES = ['draft', 'publishing', 'published', 'rolling-back'];
/** Records merged into one entry's record whose URLs it carries. */
const MAX_MERGED_URLS = 50;
/** `MigrationManifestEntry.refusal`. */
const MAX_REFUSAL = 32;

const SHA256_HEX = /^[0-9a-f]{64}$/;

export function createMigrationPublication(): MigrationPublicationPort {
  const db = getDatabaseClient();

  return {
    async createManifest(input) {
      const ids = input.stagedRecordIds;
      if (
        ids.length < 1 ||
        ids.length > MIGRATION_LIMITS.manifestEntries ||
        new Set(ids).size !== ids.length
      )
        throw new MigrationDataError('invalid');
      try {
        return await db.$transaction(async (tx) => {
          const run = await tx.migrationRun.findFirst({
            where: { id: input.runId },
            select: { sourceId: true, state: true, reconciliation: true },
          });
          if (run === null) throw new MigrationDataError('not-found');
          if (run.state !== 'completed' || run.reconciliation !== 'balanced')
            throw new MigrationDataError('run-unreconciled');

          const staged = await tx.migrationStagedRecord.findMany({
            where: { id: { in: [...ids] } },
            select: {
              id: true,
              recordId: true,
              review: true,
              validation: true,
              contentKind: true,
              record: { select: { sourceId: true } },
            },
          });
          if (staged.length !== ids.length) throw new MigrationDataError('not-found');
          for (const revision of staged) {
            if (revision.record.sourceId !== run.sourceId)
              throw new MigrationDataError('invalid');
            // Religious material is evidence only: never a manifest entry
            // (refused again by trigger 51379).
            if (!isPublishableKind(revision.contentKind))
              throw new MigrationDataError('review-only-kind');
            if (revision.review !== 'approved' || revision.validation !== 'valid')
              throw new MigrationDataError('invalid-state');
          }
          const live = await tx.migrationManifestEntry.count({
            where: {
              stagedRecordId: { in: [...ids] },
              state: { in: LIVE_ENTRY_STATES },
              manifest: { state: { in: LIVE_MANIFEST_STATES } },
            },
          });
          if (live > 0) throw new MigrationDataError('conflict');

          await tx.migrationPublishManifest.create({
            data: {
              id: input.id,
              sourceId: run.sourceId,
              runId: input.runId,
              state: 'draft',
              createdByUserId: input.actorId,
              createdAt: input.now,
              version: 1,
            },
            select: { id: true },
          });
          const recordOf = new Map(
            staged.map((revision) => [revision.id, revision.recordId]),
          );
          // A record an earlier manifest already published (an ACTIVE mapping
          // names it) is REFRESHED in place; every other record is created.
          const mapped = new Set(
            (
              await tx.migrationLegacyMapping.findMany({
                where: {
                  recordId: { in: staged.map((revision) => revision.recordId) },
                  state: 'active',
                },
                select: { recordId: true },
              })
            ).map((mapping) => mapping.recordId),
          );
          await tx.migrationManifestEntry.createMany({
            data: ids.map((stagedRecordId, position) => {
              const recordId = recordOf.get(stagedRecordId) ?? '';
              return {
                id: randomUUID(),
                manifestId: input.id,
                position,
                stagedRecordId,
                recordId,
                state: 'pending',
                mode: mapped.has(recordId) ? 'refresh' : 'create',
                version: 1,
              };
            }),
          });
          await audit(tx, {
            action: 'migration.manifest.created',
            actorId: input.actorId,
            targetType: 'migration-manifest',
            targetId: input.id,
            after: {
              runId: input.runId,
              entries: String(ids.length),
              state: 'draft',
              version: '1',
            },
            authorisingSource: ADMINISTER,
          });
          return toManifestRecord(await manifestRow(tx, input.id));
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    async manifest(id) {
      const row = await db.migrationPublishManifest.findFirst({
        where: { id },
        select: {
          ...MANIFEST_SELECT,
          entries: {
            select: ENTRY_SELECT,
            orderBy: [{ position: 'asc' }, { id: 'asc' }],
            take: MIGRATION_LIMITS.manifestEntries,
          },
        },
      });
      if (row === null) return null;
      const { entries, ...manifest } = row;
      return {
        manifest: toManifestRecord(manifest),
        entries: entries.map(toEntryRecord),
      };
    },

    async discardManifest(input) {
      try {
        await db.$transaction(async (tx) => {
          if (!(await lockRow(tx, 'MigrationPublishManifest', input.manifestId)))
            throw new MigrationDataError('not-found');
          const before = await manifestRow(tx, input.manifestId);
          const discarded = await tx.migrationPublishManifest.updateMany({
            where: {
              id: input.manifestId,
              version: input.expectedVersion,
              state: 'draft',
            },
            data: { state: 'discarded', version: { increment: 1 } },
          });
          if (discarded.count !== 1)
            missedBecause(before, input.expectedVersion, ['draft']);
          await audit(tx, {
            action: 'migration.manifest.discarded',
            actorId: input.actorId,
            targetType: 'migration-manifest',
            targetId: input.manifestId,
            before: { state: 'draft', version: String(input.expectedVersion) },
            after: { state: 'discarded', version: String(input.expectedVersion + 1) },
            authorisingSource: ADMINISTER,
          });
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    async beginPublication(input) {
      try {
        return await db.$transaction(async (tx) => {
          if (!(await lockRow(tx, 'MigrationPublishManifest', input.manifestId)))
            throw new MigrationDataError('not-found');
          const before = await manifestRow(tx, input.manifestId);
          const begun = await tx.migrationPublishManifest.updateMany({
            where: {
              id: input.manifestId,
              version: input.expectedVersion,
              state: 'draft',
            },
            data: {
              state: 'publishing',
              publishedByUserId: input.actorId,
              publishStartedAt: input.now,
              version: { increment: 1 },
            },
          });
          if (begun.count !== 1) missedBecause(before, input.expectedVersion, ['draft']);
          await audit(tx, {
            action: 'migration.manifest.publication-started',
            actorId: input.actorId,
            targetType: 'migration-manifest',
            targetId: input.manifestId,
            before: { state: 'draft', version: String(input.expectedVersion) },
            after: { state: 'publishing', version: String(input.expectedVersion + 1) },
            authorisingSource: PUBLISH,
          });
          return toManifestRecord(await manifestRow(tx, input.manifestId));
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    async publishable(manifestId, limit) {
      const rows = await db.migrationManifestEntry.findMany({
        where: { manifestId, state: { in: ['pending', 'publishing'] } },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        take: bounded(limit, MIGRATION_LIMITS.batch),
        select: {
          ...ENTRY_SELECT,
          staged: {
            select: {
              contentKind: true,
              review: true,
              validation: true,
              payload: true,
              categories: {
                select: { mapping: { select: { state: true, topicId: true } } },
              },
            },
          },
          record: {
            select: {
              id: true,
              originalUrl: true,
              // Only acquisitions a PERSON decided public-eligible are offered
              // to a target; every other acquisition stays evidence.
              assets: {
                where: { visibility: 'public-eligible' },
                orderBy: [{ acquiredAt: 'asc' }, { id: 'asc' }],
                take: MIGRATION_LIMITS.assets,
                select: {
                  originalUrl: true,
                  assetId: true,
                  mediaType: true,
                  checksum: true,
                  publicAssetId: true,
                  publicChecksum: true,
                  width: true,
                  height: true,
                },
              },
              merged: {
                orderBy: [{ id: 'asc' }],
                take: MAX_MERGED_URLS,
                select: {
                  id: true,
                  originalUrl: true,
                  duplicates: {
                    where: { state: { in: ['collapsed', 'merged'] } },
                    select: { otherRecordId: true },
                  },
                },
              },
            },
          },
        },
      });
      return rows.map(({ staged, record, ...entry }) => {
        const topicIds = [
          ...new Set(
            staged.categories.flatMap(({ mapping }) =>
              mapping.state === 'confirmed' && mapping.topicId !== null
                ? [mapping.topicId]
                : [],
            ),
          ),
        ].sort();
        const legacyUrls: { recordId: string; url: string }[] = [];
        if (record.originalUrl !== null)
          legacyUrls.push({ recordId: record.id, url: record.originalUrl });
        for (const merged of record.merged)
          if (
            merged.originalUrl !== null &&
            merged.duplicates.some((candidate) => candidate.otherRecordId === record.id)
          )
            legacyUrls.push({ recordId: merged.id, url: merged.originalUrl });
        return {
          entry: toEntryRecord(entry),
          contentKind: staged.contentKind as MigrationContentKind,
          review: staged.review as ReviewState,
          validation: staged.validation as ValidationState,
          payload: staged.payload,
          topicIds,
          legacyUrls,
          assets: record.assets.map((asset) => ({
            originalUrl: asset.originalUrl,
            assetId: asset.assetId,
            mediaType: asset.mediaType,
            checksum: asset.checksum,
            publicCopy:
              asset.publicAssetId === null ||
              asset.publicChecksum === null ||
              asset.width === null ||
              asset.height === null
                ? null
                : {
                    assetId: asset.publicAssetId,
                    checksum: asset.publicChecksum,
                    width: asset.width,
                    height: asset.height,
                  },
          })),
        };
      });
    },

    async claimEntry(entryId, expectedVersion) {
      try {
        return await db.$transaction(async (tx) => {
          if (!(await lockRow(tx, 'MigrationManifestEntry', entryId)))
            throw new MigrationDataError('not-found');
          const before = await entryRow(tx, entryId);
          // A `publishing` entry is claimed again on resume: the target adopts
          // what the interrupted attempt made rather than making it twice.
          const claimed = await tx.migrationManifestEntry.updateMany({
            where: {
              id: entryId,
              version: expectedVersion,
              state: { in: ['pending', 'publishing'] },
            },
            data: { state: 'publishing', version: { increment: 1 } },
          });
          if (claimed.count !== 1)
            missedBecause(before, expectedVersion, ['pending', 'publishing']);
          return toEntryRecord(await entryRow(tx, entryId));
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    async recordPublished(input) {
      if (input.legacyUrls.length > MAX_MERGED_URLS + 1)
        throw new MigrationDataError('invalid');
      for (const url of input.legacyUrls)
        if (!SHA256_HEX.test(url.digest) || url.url.length > MIGRATION_LIMITS.url)
          throw new MigrationDataError('invalid');
      try {
        await db.$transaction(async (tx) => {
          if (!(await lockRow(tx, 'MigrationManifestEntry', input.entryId)))
            throw new MigrationDataError('not-found');
          const entry = await tx.migrationManifestEntry.findFirst({
            where: { id: input.entryId },
            select: {
              ...ENTRY_SELECT,
              manifest: { select: { state: true } },
            },
          });
          if (entry === null) throw new MigrationDataError('not-found');
          if (entry.version !== input.expectedVersion)
            throw new MigrationDataError('conflict');
          if (
            !['pending', 'publishing'].includes(entry.state) ||
            entry.manifest.state !== 'publishing'
          )
            throw new MigrationDataError('invalid-state');

          // A REFRESH changed the record an earlier entry made: it names
          // exactly the target the record's active mapping names, and makes
          // no mapping of its own (51380 refuses one too).
          if (entry.mode === 'refresh') {
            if (input.legacyUrls.length > 0) throw new MigrationDataError('invalid');
            const mapped = await tx.migrationLegacyMapping.findFirst({
              where: { recordId: entry.recordId, state: 'active' },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              select: TARGET_SELECT,
            });
            const made = mapped === null ? null : targetOf(mapped);
            if (
              made === null ||
              made.kind !== input.target.kind ||
              made.id !== input.target.id
            )
              throw new MigrationDataError('conflict');
          }

          // Every URL is the entry's record's own, or a record merged into it.
          const urlRecords = [...new Set(input.legacyUrls.map((url) => url.recordId))];
          const owners = await tx.migrationRecord.findMany({
            where: { id: { in: urlRecords } },
            select: { id: true, sourceId: true, mergedIntoRecordId: true },
          });
          const ownerOf = new Map(owners.map((owner) => [owner.id, owner]));
          for (const recordId of urlRecords) {
            const owner = ownerOf.get(recordId);
            if (
              owner === undefined ||
              (owner.id !== entry.recordId && owner.mergedIntoRecordId !== entry.recordId)
            )
              throw new MigrationDataError('invalid');
          }

          const published = await tx.migrationManifestEntry.updateMany({
            where: { id: input.entryId, version: input.expectedVersion },
            data: {
              state: 'published',
              ...targetColumns(input.target),
              targetStage: input.targetStage,
              targetVersion: input.targetVersion,
              canonicalPath: input.canonicalPath,
              publishedAt: input.now,
              version: { increment: 1 },
            },
          });
          if (published.count !== 1) throw new MigrationDataError('conflict');

          // One ACTIVE mapping per legacy address. An address already mapped to
          // this same video is adopted (moved, when its path changed); one
          // mapped to a different record's video is a conflict a person
          // resolves — never silently redirected elsewhere.
          let created = 0;
          for (const url of input.legacyUrls) {
            const owner = ownerOf.get(url.recordId);
            if (owner === undefined) throw new MigrationDataError('invalid');
            const active = await tx.migrationLegacyMapping.findFirst({
              where: {
                sourceId: owner.sourceId,
                legacyUrlDigest: url.digest,
                state: 'active',
              },
              select: { id: true, ...TARGET_SELECT, canonicalPath: true },
            });
            if (active !== null) {
              const mapped = targetOf(active);
              if (
                mapped === null ||
                mapped.kind !== input.target.kind ||
                mapped.id !== input.target.id
              )
                throw new MigrationDataError('conflict');
              if (active.canonicalPath === input.canonicalPath) continue;
              await tx.migrationLegacyMapping.updateMany({
                where: { id: active.id },
                data: {
                  state: 'disabled',
                  changedAt: input.now,
                  changedByUserId: input.actorId,
                  version: { increment: 1 },
                },
              });
            }
            await tx.migrationLegacyMapping.create({
              data: {
                id: randomUUID(),
                sourceId: owner.sourceId,
                recordId: url.recordId,
                legacyUrl: url.url,
                legacyUrlDigest: url.digest,
                ...targetColumns(input.target),
                canonicalPath: input.canonicalPath,
                state: 'active',
                manifestEntryId: input.entryId,
                createdAt: input.now,
                createdByUserId: input.actorId,
                version: 1,
              },
              select: { id: true },
            });
            created += 1;
          }

          // The entry's record is published. A record merged into it keeps
          // `merged` (merged ⇔ it names its target, a CHECK); its URL now
          // redirects through the mapping above.
          await tx.migrationRecord.updateMany({
            where: { id: entry.recordId, status: { not: 'merged' } },
            data: {
              status: 'published',
              updatedAt: input.now,
              version: { increment: 1 },
            },
          });
          await audit(tx, {
            action:
              entry.mode === 'refresh'
                ? 'migration.manifest.entry-refreshed'
                : 'migration.manifest.entry-published',
            actorId: input.actorId,
            targetType: 'migration-manifest-entry',
            targetId: input.entryId,
            before: { state: entry.state, version: String(entry.version) },
            after: {
              state: 'published',
              manifestId: entry.manifestId,
              targetKind: input.target.kind,
              targetId: input.target.id,
              targetStage: input.targetStage,
              mappings: String(created),
              version: String(entry.version + 1),
            },
            authorisingSource: PUBLISH,
          });
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    async resolveLegacyTarget(legacyUrlDigest) {
      if (!SHA256_HEX.test(legacyUrlDigest)) return null;
      // Any source's ACTIVE mapping; two that disagree are no answer at all.
      const rows = await db.migrationLegacyMapping.findMany({
        where: { legacyUrlDigest, state: 'active' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 2,
        select: TARGET_SELECT,
      });
      const targets = rows
        .map(targetOf)
        .filter((target): target is MigrationTargetRef => target !== null);
      const [first, second] = targets;
      if (first === undefined) return null;
      if (second !== undefined && (second.kind !== first.kind || second.id !== first.id))
        return null;
      return first;
    },

    async recordRefused(input) {
      const refusal = input.refusal.trim();
      if (refusal.length === 0 || refusal.length > MAX_REFUSAL)
        throw new MigrationDataError('invalid');
      try {
        await db.$transaction(async (tx) => {
          if (!(await lockRow(tx, 'MigrationManifestEntry', input.entryId)))
            throw new MigrationDataError('not-found');
          const before = await entryRow(tx, input.entryId);
          const refused = await tx.migrationManifestEntry.updateMany({
            where: {
              id: input.entryId,
              version: input.expectedVersion,
              state: { in: ['pending', 'publishing'] },
            },
            data: { state: 'refused', refusal, version: { increment: 1 } },
          });
          if (refused.count !== 1)
            missedBecause(before, input.expectedVersion, ['pending', 'publishing']);
          await audit(tx, {
            action: 'migration.manifest.entry-refused',
            actorId: null,
            targetType: 'migration-manifest-entry',
            targetId: input.entryId,
            before: { state: before.state, version: String(before.version) },
            after: {
              state: 'refused',
              manifestId: before.manifestId,
              refusal,
              version: String(before.version + 1),
            },
            authorisingSource: PUBLISH,
          });
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    async completePublication(input) {
      try {
        return await db.$transaction(async (tx) => {
          if (!(await lockRow(tx, 'MigrationPublishManifest', input.manifestId)))
            throw new MigrationDataError('not-found');
          const before = await manifestRow(tx, input.manifestId);
          if (before.state !== 'publishing')
            throw new MigrationDataError('invalid-state');
          const open = await tx.migrationManifestEntry.count({
            where: {
              manifestId: input.manifestId,
              state: { in: ['pending', 'publishing'] },
            },
          });
          if (open > 0) throw new MigrationDataError('invalid-state');
          const completed = await tx.migrationPublishManifest.updateMany({
            where: { id: input.manifestId, version: before.version, state: 'publishing' },
            data: {
              state: 'published',
              publishedAt: input.now,
              version: { increment: 1 },
            },
          });
          if (completed.count !== 1) throw new MigrationDataError('conflict');
          const outcome = await tx.migrationManifestEntry.groupBy({
            by: ['state'],
            where: { manifestId: input.manifestId },
            _count: { _all: true },
          });
          const counted = (state: string) =>
            String(outcome.find((row) => row.state === state)?._count._all ?? 0);
          await audit(tx, {
            action: 'migration.manifest.published',
            actorId: before.publishedByUserId,
            targetType: 'migration-manifest',
            targetId: input.manifestId,
            before: { state: 'publishing', version: String(before.version) },
            after: {
              state: 'published',
              published: counted('published'),
              refused: counted('refused'),
              version: String(before.version + 1),
            },
            authorisingSource: PUBLISH,
          });
          return toManifestRecord(await manifestRow(tx, input.manifestId));
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    async beginRollback(input) {
      const reason = input.reason.trim();
      if (reason.length === 0 || reason.length > MIGRATION_LIMITS.note)
        throw new MigrationDataError('invalid');
      try {
        return await db.$transaction(async (tx) => {
          if (!(await lockRow(tx, 'MigrationPublishManifest', input.manifestId)))
            throw new MigrationDataError('not-found');
          const before = await manifestRow(tx, input.manifestId);
          const begun = await tx.migrationPublishManifest.updateMany({
            where: {
              id: input.manifestId,
              version: input.expectedVersion,
              state: 'published',
            },
            data: {
              state: 'rolling-back',
              rollbackByUserId: input.actorId,
              rollbackReason: reason,
              rollbackStartedAt: input.now,
              version: { increment: 1 },
            },
          });
          if (begun.count !== 1)
            missedBecause(before, input.expectedVersion, ['published']);
          await audit(tx, {
            action: 'migration.manifest.rollback-started',
            actorId: input.actorId,
            targetType: 'migration-manifest',
            targetId: input.manifestId,
            before: { state: 'published', version: String(input.expectedVersion) },
            after: { state: 'rolling-back', version: String(input.expectedVersion + 1) },
            authorisingSource: PUBLISH,
          });
          return toManifestRecord(await manifestRow(tx, input.manifestId));
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    async reversible(manifestId, limit) {
      const rows = await db.migrationManifestEntry.findMany({
        where: { manifestId, state: { in: ['published', 'rollback-refused'] } },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        take: bounded(limit, MIGRATION_LIMITS.batch),
        select: ENTRY_SELECT,
      });
      return rows.map(toEntryRecord);
    },

    async recordRolledBack(input) {
      try {
        await db.$transaction(async (tx) => {
          if (!(await lockRow(tx, 'MigrationManifestEntry', input.entryId)))
            throw new MigrationDataError('not-found');
          const before = await entryRow(tx, input.entryId);
          const rolled = await tx.migrationManifestEntry.updateMany({
            where: {
              id: input.entryId,
              version: input.expectedVersion,
              state: { in: ['published', 'rollback-refused'] },
            },
            data: {
              state: 'rolled-back',
              rolledBackAt: input.now,
              version: { increment: 1 },
            },
          });
          if (rolled.count !== 1)
            missedBecause(before, input.expectedVersion, [
              'published',
              'rollback-refused',
            ]);
          // Disabled, never deleted: the history of what redirected where stays.
          const disabled = await tx.migrationLegacyMapping.updateMany({
            where: { manifestEntryId: input.entryId, state: 'active' },
            data: {
              state: 'disabled',
              changedAt: input.now,
              changedByUserId: input.actorId,
              version: { increment: 1 },
            },
          });
          await tx.migrationRecord.updateMany({
            where: { id: before.recordId, status: 'published' },
            data: { status: 'approved', updatedAt: input.now, version: { increment: 1 } },
          });
          await audit(tx, {
            action: 'migration.manifest.entry-rolled-back',
            actorId: input.actorId,
            targetType: 'migration-manifest-entry',
            targetId: input.entryId,
            before: { state: before.state, version: String(before.version) },
            after: {
              state: 'rolled-back',
              manifestId: before.manifestId,
              mappingsDisabled: String(disabled.count),
              version: String(before.version + 1),
            },
            authorisingSource: PUBLISH,
          });
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    async recordRollbackRefused(input) {
      try {
        await db.$transaction(async (tx) => {
          if (!(await lockRow(tx, 'MigrationManifestEntry', input.entryId)))
            throw new MigrationDataError('not-found');
          const before = await entryRow(tx, input.entryId);
          const refused = await tx.migrationManifestEntry.updateMany({
            where: {
              id: input.entryId,
              version: input.expectedVersion,
              state: 'published',
            },
            data: { state: 'rollback-refused', version: { increment: 1 } },
          });
          if (refused.count !== 1)
            missedBecause(before, input.expectedVersion, ['published']);
          await audit(tx, {
            action: 'migration.manifest.entry-rollback-refused',
            actorId: null,
            targetType: 'migration-manifest-entry',
            targetId: input.entryId,
            before: { state: 'published', version: String(before.version) },
            after: {
              state: 'rollback-refused',
              manifestId: before.manifestId,
              version: String(before.version + 1),
            },
            authorisingSource: PUBLISH,
          });
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    async completeRollback(input) {
      try {
        return await db.$transaction(async (tx) => {
          if (!(await lockRow(tx, 'MigrationPublishManifest', input.manifestId)))
            throw new MigrationDataError('not-found');
          const before = await manifestRow(tx, input.manifestId);
          if (before.state !== 'rolling-back')
            throw new MigrationDataError('invalid-state');
          const remaining = await tx.migrationManifestEntry.count({
            where: { manifestId: input.manifestId, state: 'published' },
          });
          if (remaining > 0) throw new MigrationDataError('invalid-state');
          const completed = await tx.migrationPublishManifest.updateMany({
            where: {
              id: input.manifestId,
              version: before.version,
              state: 'rolling-back',
            },
            data: {
              state: 'rolled-back',
              rolledBackAt: input.now,
              version: { increment: 1 },
            },
          });
          if (completed.count !== 1) throw new MigrationDataError('conflict');
          const refused = await tx.migrationManifestEntry.count({
            where: { manifestId: input.manifestId, state: 'rollback-refused' },
          });
          await audit(tx, {
            action: 'migration.manifest.rolled-back',
            actorId: before.rollbackByUserId,
            targetType: 'migration-manifest',
            targetId: input.manifestId,
            before: { state: 'rolling-back', version: String(before.version) },
            after: {
              state: 'rolled-back',
              rollbackRefused: String(refused),
              version: String(before.version + 1),
            },
            authorisingSource: PUBLISH,
          });
          return toManifestRecord(await manifestRow(tx, input.manifestId));
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },
  };
}
