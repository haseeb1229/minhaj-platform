import 'server-only';

import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';

import {
  MIGRATION_LIMITS,
  type MigrationContentKind,
  type MigrationPromotionPort,
  type PromotionRecord,
} from '@minhaj/contracts/migration';

import { getDatabaseClient } from '../../client.ts';
import {
  ADMINISTER,
  LOCKED_TRANSACTION,
  MigrationDataError,
  PUBLISH,
  audit,
  bounded,
  lockRow,
  missedBecause,
  promotionRows,
  refuse,
  toPromotionRecord,
  type Client,
} from './shared.ts';

/**
 * Promotion — the reviewed corpus set, never environment state.
 *
 * A promotion carries only PUBLISHED manifest entries (51381 on insert), is
 * approved only by an account holding `migration.publish` now with a live
 * `migration-publication` step-up (51381 on approval), and is promoted entry
 * by entry, each a checkpoint a resumed promotion continues from.
 *
 * WHAT LEAVES IS CONTENT. A promotion item is a staged payload, its
 * provenance, checksums, its source key and external key, its canonical path
 * and its legacy URLs — by construction no account id, reviewer, session,
 * credential or configuration value is selected.
 */

/** Rows one statement writes, inside SQL Server's parameter limit. */
const INSERT_CHUNK = 100;

async function promotionRecord(tx: Client, id: string): Promise<PromotionRecord> {
  const rows = await promotionRows(tx, Prisma.sql`p.[id] = ${id}`, Prisma.empty);
  const row = rows[0];
  if (row === undefined) throw new MigrationDataError('not-found');
  return toPromotionRecord(row);
}

export function createMigrationPromotion(): MigrationPromotionPort {
  const db = getDatabaseClient();

  /**
   * A guarded promotion transition at an expected version, audited, with the
   * record returned as it now stands.
   */
  async function transition(input: {
    readonly promotionId: string;
    readonly expectedVersion: number;
    readonly from: readonly string[];
    readonly data: Prisma.MigrationPromotionUncheckedUpdateManyInput;
    readonly action: string;
    readonly actorId: string;
    readonly authorisingSource: string;
  }): Promise<PromotionRecord> {
    try {
      return await db.$transaction(async (tx) => {
        if (!(await lockRow(tx, 'MigrationPromotion', input.promotionId)))
          throw new MigrationDataError('not-found');
        const before = await promotionRecord(tx, input.promotionId);
        const moved = await tx.migrationPromotion.updateMany({
          where: {
            id: input.promotionId,
            version: input.expectedVersion,
            state: { in: [...input.from] },
          },
          data: { ...input.data, version: { increment: 1 } },
        });
        if (moved.count !== 1) missedBecause(before, input.expectedVersion, input.from);
        const after = await promotionRecord(tx, input.promotionId);
        await audit(tx, {
          action: input.action,
          actorId: input.actorId,
          targetType: 'migration-promotion',
          targetId: input.promotionId,
          before: { state: before.state, version: String(before.version) },
          after: { state: after.state, version: String(after.version) },
          authorisingSource: input.authorisingSource,
        });
        return after;
      }, LOCKED_TRANSACTION);
    } catch (error) {
      refuse(error);
    }
  }

  return {
    async createPromotion(input) {
      const ids = input.manifestEntryIds;
      if (
        ids.length < 1 ||
        ids.length > MIGRATION_LIMITS.promotionEntries ||
        new Set(ids).size !== ids.length
      )
        throw new MigrationDataError('invalid');
      try {
        return await db.$transaction(async (tx) => {
          const entries = await tx.migrationManifestEntry.findMany({
            where: { id: { in: [...ids] } },
            select: { state: true },
          });
          if (entries.length !== ids.length) throw new MigrationDataError('not-found');
          if (entries.some((entry) => entry.state !== 'published'))
            throw new MigrationDataError('invalid-state');
          await tx.migrationPromotion.create({
            data: {
              id: input.id,
              state: 'draft',
              destination: 'bundle',
              createdByUserId: input.actorId,
              createdAt: input.now,
              version: 1,
            },
            select: { id: true },
          });
          for (let start = 0; start < ids.length; start += INSERT_CHUNK)
            await tx.migrationPromotionEntry.createMany({
              data: ids
                .slice(start, start + INSERT_CHUNK)
                .map((manifestEntryId, offset) => ({
                  id: randomUUID(),
                  promotionId: input.id,
                  position: start + offset,
                  manifestEntryId,
                  state: 'pending',
                })),
            });
          await audit(tx, {
            action: 'migration.promotion.created',
            actorId: input.actorId,
            targetType: 'migration-promotion',
            targetId: input.id,
            after: { state: 'draft', entries: String(ids.length), version: '1' },
            authorisingSource: ADMINISTER,
          });
          return promotionRecord(tx, input.id);
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    async promotion(id) {
      const rows = await promotionRows(db, Prisma.sql`p.[id] = ${id}`, Prisma.empty);
      const row = rows[0];
      return row === undefined ? null : toPromotionRecord(row);
    },

    approve(input) {
      return transition({
        promotionId: input.promotionId,
        expectedVersion: input.expectedVersion,
        from: ['draft'],
        data: {
          state: 'approved',
          approvedByUserId: input.actorId,
          approvedAt: input.now,
        },
        action: 'migration.promotion.approved',
        actorId: input.actorId,
        authorisingSource: PUBLISH,
      });
    },

    withdraw(input) {
      return transition({
        promotionId: input.promotionId,
        expectedVersion: input.expectedVersion,
        from: ['draft', 'approved', 'promoting'],
        data: {
          state: 'withdrawn',
          withdrawnByUserId: input.actorId,
          withdrawnAt: input.now,
        },
        action: 'migration.promotion.withdrawn',
        actorId: input.actorId,
        authorisingSource: ADMINISTER,
      });
    },

    async beginPromoting(input) {
      try {
        return await db.$transaction(async (tx) => {
          if (!(await lockRow(tx, 'MigrationPromotion', input.promotionId)))
            throw new MigrationDataError('not-found');
          const before = await promotionRecord(tx, input.promotionId);
          if (before.state === 'promoting') return before;
          if (before.state !== 'approved') throw new MigrationDataError('invalid-state');
          const begun = await tx.migrationPromotion.updateMany({
            where: { id: input.promotionId, version: before.version, state: 'approved' },
            data: { state: 'promoting', version: { increment: 1 } },
          });
          if (begun.count !== 1) throw new MigrationDataError('conflict');
          return promotionRecord(tx, input.promotionId);
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    async pendingItems(promotionId, limit) {
      const rows = await db.migrationPromotionEntry.findMany({
        where: { promotionId, state: 'pending' },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        take: bounded(limit, MIGRATION_LIMITS.batch),
        select: {
          id: true,
          manifestEntryId: true,
          entry: {
            select: {
              canonicalPath: true,
              publishedAt: true,
              staged: {
                select: {
                  contentKind: true,
                  payload: true,
                  payloadChecksum: true,
                  inputChecksum: true,
                  adapterKey: true,
                  adapterVersion: true,
                  parserKey: true,
                  parserVersion: true,
                  normalizerVersion: true,
                  codeRevision: true,
                  reviewedAt: true,
                },
              },
              record: {
                select: { externalKey: true, source: { select: { key: true } } },
              },
              legacyMappings: {
                where: { state: 'active' },
                orderBy: [{ legacyUrl: 'asc' }, { id: 'asc' }],
                select: { legacyUrl: true },
              },
            },
          },
        },
      });
      return rows.map((row) => {
        const { entry } = row;
        const { staged } = entry;
        if (
          entry.canonicalPath === null ||
          entry.publishedAt === null ||
          staged.reviewedAt === null
        )
          throw new MigrationDataError('invalid-state');
        return {
          promotionEntryId: row.id,
          manifestEntryId: row.manifestEntryId,
          contentKind: staged.contentKind as MigrationContentKind,
          payload: staged.payload,
          payloadChecksum: staged.payloadChecksum,
          inputChecksum: staged.inputChecksum,
          provenance: {
            adapterKey: staged.adapterKey,
            adapterVersion: staged.adapterVersion,
            parserKey: staged.parserKey,
            parserVersion: staged.parserVersion,
            normalizerVersion: staged.normalizerVersion,
            codeRevision: staged.codeRevision,
          },
          sourceKey: entry.record.source.key,
          externalKey: entry.record.externalKey,
          canonicalPath: entry.canonicalPath,
          legacyUrls: entry.legacyMappings.map((mapping) => mapping.legacyUrl),
          reviewedAt: staged.reviewedAt.toISOString(),
          publishedAt: entry.publishedAt.toISOString(),
        };
      });
    },

    async recordPromoted(input) {
      const destinationRef = input.destinationRef.trim();
      if (destinationRef.length === 0 || destinationRef.length > 200)
        throw new MigrationDataError('invalid');
      try {
        await db.$transaction(async (tx) => {
          const entry = await tx.migrationPromotionEntry.findFirst({
            where: { id: input.promotionEntryId },
            select: {
              promotionId: true,
              state: true,
              destinationRef: true,
              promotion: { select: { state: true } },
            },
          });
          if (entry === null) throw new MigrationDataError('not-found');
          // Idempotent: the destination's own answer for this entry, again.
          if (entry.state === 'promoted') {
            if (entry.destinationRef === destinationRef) return;
            throw new MigrationDataError('conflict');
          }
          if (entry.promotion.state !== 'promoting')
            throw new MigrationDataError('invalid-state');
          const promoted = await tx.migrationPromotionEntry.updateMany({
            where: { id: input.promotionEntryId, state: 'pending' },
            data: { state: 'promoted', promotedAt: input.now, destinationRef },
          });
          if (promoted.count !== 1) throw new MigrationDataError('conflict');
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    async complete(input) {
      try {
        return await db.$transaction(async (tx) => {
          if (!(await lockRow(tx, 'MigrationPromotion', input.promotionId)))
            throw new MigrationDataError('not-found');
          const before = await promotionRecord(tx, input.promotionId);
          if (before.state !== 'promoting' || before.promotedCount !== before.entryCount)
            throw new MigrationDataError('invalid-state');
          const completed = await tx.migrationPromotion.updateMany({
            where: { id: input.promotionId, version: before.version, state: 'promoting' },
            data: {
              state: 'promoted',
              completedAt: input.now,
              version: { increment: 1 },
            },
          });
          if (completed.count !== 1) throw new MigrationDataError('conflict');
          await audit(tx, {
            action: 'migration.promotion.completed',
            actorId: input.actorId,
            targetType: 'migration-promotion',
            targetId: input.promotionId,
            before: { state: 'promoting', version: String(before.version) },
            after: {
              state: 'promoted',
              entries: String(before.entryCount),
              version: String(before.version + 1),
            },
            authorisingSource: ADMINISTER,
          });
          return promotionRecord(tx, input.promotionId);
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },
  };
}
