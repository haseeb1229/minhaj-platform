import 'server-only';

import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import {
  MIGRATION_LIMITS,
  migrationIdSchema,
  promotionCommandSchema,
  promotionCreateSchema,
  type MigrationActor,
  type MigrationAuthorityPort,
  type MigrationPromotionDestinationPort,
  type MigrationPromotionPort,
  type PromotionRecord,
  type PromotionState,
} from '@minhaj/contracts/migration';

import { MigrationRefusal } from '../domain/refusal.ts';
import { ADMINISTER, createGate, guarded } from './shared.ts';

export interface PromotionExecuteInput {
  readonly promotionId: string;
  /** Where the reviewed corpus set is carried (Phase 29: a local checksummed bundle). */
  readonly destination: MigrationPromotionDestinationPort;
  /** Items per checkpoint batch, at most `MIGRATION_LIMITS.batch` (default). */
  readonly batchSize?: number;
  /** Stop after this many items, leaving the promotion `promoting` to be resumed. */
  readonly maxItems?: number | null;
}

export interface PromotionSummary {
  readonly promotionId: string;
  readonly state: PromotionState;
  /** Items this invocation carried to the destination. */
  readonly promoted: number;
  /** Why it stopped short, when it did. */
  readonly stopped: 'approval-withdrawn' | 'max-items' | null;
}

const executeSchema = z.object({
  promotionId: migrationIdSchema,
  batchSize: z.number().int().min(1).max(MIGRATION_LIMITS.batch).optional(),
  maxItems: z.number().int().min(1).max(1_000_000).nullable().optional(),
});

/**
 * PROMOTION FROM STAGING TO PRODUCTION (MIGRATION_STRATEGY.md §10.1.1): a
 * reviewed, explicitly APPROVED corpus set — content, provenance, checksums
 * and legacy mappings, and by construction no account, credential, session or
 * configuration.
 *
 * Bounded, checkpointed, idempotent and resumable: the promotion is re-read
 * before EVERY batch and the run stops the moment its approval is withdrawn,
 * so a resumed promotion never carries content whose approval was taken back.
 * Each entry is put to the destination (idempotent per entry) and only then
 * recorded, so a crash between the two re-puts the same entry, never a second.
 *
 * Dependencies (ports only):
 *  - `promotions` — `MigrationPromotionPort`;
 *  - `authority`  — `MigrationAuthorityPort`;
 *  - `ids`, `clock` — injectable for tests.
 * The destination is handed to each `execute`.
 */
export function createMigrationPromotionService(deps: {
  readonly promotions: MigrationPromotionPort;
  readonly authority: MigrationAuthorityPort;
  readonly ids?: () => string;
  readonly clock?: () => Date;
}) {
  const ids = deps.ids ?? randomUUID;
  const now = deps.clock ?? (() => new Date());
  const gate = createGate(deps.authority);
  const { promotions } = deps;

  return {
    async create(actor: MigrationActor, input: unknown): Promise<PromotionRecord> {
      const { actorId, value } = await gate.authorised(
        actor,
        ADMINISTER,
        promotionCreateSchema,
        input,
      );
      return guarded(
        promotions.createPromotion({
          id: ids(),
          manifestEntryIds: value.manifestEntryIds,
          actorId,
          now: now(),
        }),
      );
    },

    /** draft → approved, as a verified publisher (the database re-checks). */
    async approve(privilegedActor: unknown, command: unknown): Promise<PromotionRecord> {
      const publisherId = await gate.publisher(privilegedActor);
      const parsed = promotionCommandSchema.safeParse(command);
      if (!parsed.success) throw new MigrationRefusal('invalid');
      return guarded(
        promotions.approve({ ...parsed.data, actorId: publisherId, now: now() }),
      );
    },

    /** Withdraws the approval until the promotion completes. */
    async withdraw(actor: MigrationActor, command: unknown): Promise<PromotionRecord> {
      const { actorId, value } = await gate.authorised(
        actor,
        ADMINISTER,
        promotionCommandSchema,
        command,
      );
      return guarded(promotions.withdraw({ ...value, actorId, now: now() }));
    },

    /** Carries — or resumes carrying — an approved promotion to its destination. */
    async execute(
      actor: MigrationActor,
      input: PromotionExecuteInput,
    ): Promise<PromotionSummary> {
      const actorId = await gate.holds(actor, ADMINISTER);
      const parsed = executeSchema.safeParse({
        promotionId: input?.promotionId,
        batchSize: input?.batchSize,
        maxItems: input?.maxItems,
      });
      if (!parsed.success || typeof input.destination?.put !== 'function')
        throw new MigrationRefusal('invalid');
      const { promotionId } = parsed.data;
      const batchSize = parsed.data.batchSize ?? MIGRATION_LIMITS.batch;
      const maxItems = parsed.data.maxItems ?? null;

      const current = await guarded(promotions.promotion(promotionId));
      if (current === null) throw new MigrationRefusal('not-found');
      if (current.destination !== input.destination.destination)
        throw new MigrationRefusal('invalid');
      if (current.state === 'withdrawn') throw new MigrationRefusal('approval-withdrawn');
      if (current.state === 'promoted')
        return { promotionId, state: 'promoted', promoted: 0, stopped: null };
      if (current.state !== 'approved' && current.state !== 'promoting')
        throw new MigrationRefusal('invalid-state');
      await guarded(promotions.beginPromoting({ promotionId, now: now() }));

      let promoted = 0;
      const seen = new Set<string>();
      for (;;) {
        // The approval is asked again before every batch.
        const latest = await guarded(promotions.promotion(promotionId));
        if (latest === null) throw new MigrationRefusal('not-found');
        if (latest.state === 'withdrawn')
          return {
            promotionId,
            state: 'withdrawn',
            promoted,
            stopped: 'approval-withdrawn',
          };
        const budget = maxItems === null ? batchSize : maxItems - promoted;
        const items = await guarded(
          promotions.pendingItems(promotionId, Math.max(1, Math.min(batchSize, budget))),
        );
        const fresh = items.filter((item) => !seen.has(item.promotionEntryId));
        if (fresh.length === 0) break;
        if (budget <= 0)
          return { promotionId, state: latest.state, promoted, stopped: 'max-items' };
        for (const item of fresh) {
          seen.add(item.promotionEntryId);
          const put = await input.destination.put(item);
          await guarded(
            promotions.recordPromoted({
              promotionEntryId: item.promotionEntryId,
              destinationRef: put.destinationRef,
              now: now(),
            }),
          );
          promoted += 1;
        }
      }
      const completed = await guarded(
        promotions.complete({ promotionId, actorId, now: now() }),
      );
      return { promotionId, state: completed.state, promoted, stopped: null };
    },
  };
}

export type MigrationPromotionService = ReturnType<
  typeof createMigrationPromotionService
>;
