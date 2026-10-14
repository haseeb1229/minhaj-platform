import 'server-only';

import {
  PERSONAL_EXPORT_SCHEMA,
  PERSONAL_EXPORT_VERSION,
  personalAccountIdSchema,
  personalIdSchema,
  quranProgressWriteSchema,
  type DispositionProgress,
  type PersonalDispositionPort,
  type PersonalExport,
  type PersonalExportPort,
  type PersonalPurgePort,
} from '@minhaj/contracts/personalisation';
import type { RateLimitRule, RateLimiterPort } from '@minhaj/contracts/platform';

import { PersonalRefusal, asRefusal } from '../domain/refusal.ts';
import { withDefaults } from './notification-service.ts';
import { requireActor, spend, type LimitKey, type PersonalActor } from './shared.ts';

/** A person's own export — enough for real use, too few to be a scraping tool. */
export const EXPORT_RULE: RateLimitRule = Object.freeze({ window: 3_600, max: 10 });

/** Rows removed per statement in one disposal batch. */
const DISPOSAL_BATCH = 500;
/** Batches one call may run before it stops and reports the rest pending. */
const DISPOSAL_ROUNDS = 40;
/** Accounts the reconciliation sweep inspects per page, and pages per run. */
const SWEEP_PAGE = 100;
const SWEEP_PAGES = 10;

/**
 * Identity's answer about its own lifecycle — which of these accounts are
 * closed — asked through Layer 4. Personalisation does not know what statuses
 * exist and cannot ask for accounts by any other property.
 */
export interface ClosedAccountPort {
  closedAccounts(accountIds: readonly string[]): Promise<readonly string[]>;
}

/**
 * The account-level operations: the person's own export, this context's part
 * of account closure, and its part of a content hard purge.
 */
export function createAccountService(deps: {
  readonly exports: PersonalExportPort;
  readonly disposition: PersonalDispositionPort;
  readonly purge: PersonalPurgePort;
  readonly accounts: ClosedAccountPort;
  readonly limiter: RateLimiterPort;
  readonly key: LimitKey;
  readonly clock?: () => Date;
}) {
  const now = deps.clock ?? (() => new Date());
  const run = <T>(work: Promise<T>): Promise<T> => work.catch(asRefusal);

  /** Removes an account's rows until none remain or the round budget is spent. */
  async function dispose(accountId: string): Promise<DispositionProgress> {
    let removed = 0;
    for (let round = 0; round < DISPOSAL_ROUNDS; round += 1) {
      const batch = await run(deps.disposition.disposeAccount(accountId, DISPOSAL_BATCH));
      removed += batch;
      if (batch === 0) return { removed, complete: true };
    }
    return { removed, complete: false };
  }

  return {
    /**
     * Everything this context holds about the signed-in account, as one
     * deterministic document. Typed target identities only — no title or body
     * of any content — and no newsletter, which is not the account's.
     */
    async export(actor: PersonalActor): Promise<PersonalExport> {
      requireActor(actor);
      await spend(
        deps.limiter,
        deps.key('personal-export', actor.accountId),
        EXPORT_RULE,
      );
      const collected = await run(deps.exports.collect(actor.accountId));
      return {
        schema: PERSONAL_EXPORT_SCHEMA,
        version: PERSONAL_EXPORT_VERSION,
        generatedAt: now().toISOString(),
        ...collected,
        notificationPreferences: withDefaults(collected.notificationPreferences),
      };
    },

    /**
     * Removes every Personalisation row of a CLOSED account — refused for any
     * other, so this can never be turned on a live person's data. Idempotent:
     * a second call finds nothing and reports complete.
     */
    async disposeAccount(accountId: string): Promise<DispositionProgress> {
      if (!personalAccountIdSchema.safeParse(accountId).success)
        throw new PersonalRefusal('invalid');
      const closed = await deps.accounts.closedAccounts([accountId]);
      if (!closed.includes(accountId)) throw new PersonalRefusal('denied');
      return dispose(accountId);
    },

    /**
     * Finishes any closure an interruption left part-done: every account that
     * still owns rows here and that Identity says is closed. Bounded per run;
     * `complete` is false while any such account may remain.
     */
    async reconcileClosedAccounts(): Promise<DispositionProgress> {
      let after: string | null = null;
      let removed = 0;
      let complete = true;
      for (let page = 0; page < SWEEP_PAGES; page += 1) {
        const owners: readonly string[] = await run(
          deps.disposition.accountsWithData(after, SWEEP_PAGE),
        );
        if (owners.length === 0) return { removed, complete };
        const closed = await deps.accounts.closedAccounts(owners);
        for (const accountId of closed) {
          const progress = await dispose(accountId);
          removed += progress.removed;
          if (!progress.complete) complete = false;
        }
        after = owners[owners.length - 1] ?? null;
        if (owners.length < SWEEP_PAGE) return { removed, complete };
      }
      return { removed, complete: false };
    },

    /**
     * TYPED purge participation (DOMAIN_MODEL.md §14.3): this context's
     * references to ONE target, removed in a bounded batch. Returns how many
     * remain — zero is the owner's signal that its physical delete will not
     * meet a reference from here. Safe to repeat after any interruption.
     */
    purge: {
      article: async (id: string) =>
        run(deps.purge.releaseArticle(personalIdSchema.parse(id), DISPOSAL_BATCH)),
      work: async (id: string) =>
        run(deps.purge.releaseWork(personalIdSchema.parse(id), DISPOSAL_BATCH)),
      video: async (id: string) =>
        run(deps.purge.releaseVideo(personalIdSchema.parse(id), DISPOSAL_BATCH)),
      hadith: async (id: string) =>
        run(deps.purge.releaseHadith(personalIdSchema.parse(id), DISPOSAL_BATCH)),
      ayah: async (surah: number, ayah: number) => {
        const value = quranProgressWriteSchema.parse({ surah, ayah, expectedVersion: 0 });
        return run(
          deps.purge.releaseAyah(
            { kind: 'ayah', surah: value.surah, ayah: value.ayah },
            DISPOSAL_BATCH,
          ),
        );
      },
    },
  };
}

export type AccountService = ReturnType<typeof createAccountService>;
