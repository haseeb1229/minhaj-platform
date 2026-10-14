import 'server-only';

import {
  LEARNING_EXPORT_SCHEMA,
  LEARNING_EXPORT_VERSION,
  learningAccountIdSchema,
  type LearningActor,
  type LearningClosedAccountPort,
  type LearningDispositionPort,
  type LearningDispositionProgress,
  type LearningExport,
  type LearningExportPort,
} from '@minhaj/contracts/learning';
import type { RateLimitRule, RateLimiterPort } from '@minhaj/contracts/platform';

import type { LearningLimitKey } from './learner-service.ts';
import { asLearningRefusal, LearningRefusal } from './refusal.ts';

/** A person's own export — enough for real use, too few to be a scraping tool. */
export const LEARNING_EXPORT_RULE: RateLimitRule = Object.freeze({
  window: 3_600,
  max: 10,
});

/** Rows removed per statement in one disposal batch. */
const DISPOSAL_BATCH = 500;
/** Batches one call may run before it stops and reports the rest pending. */
const DISPOSAL_ROUNDS = 40;
/** Accounts the reconciliation sweep inspects per page, and pages per run. */
const SWEEP_PAGE = 100;
const SWEEP_PAGES = 10;

/**
 * Learning's account-level operations: the person's own export and this
 * context's part of account closure (SECURITY_BASELINE.md §19.1).
 *
 * IDENTITY OWNS CLOSURE. Learning asks Identity, through Layer 4, only which
 * accounts are closed, and then disposes of its OWN private rows — Enrolments,
 * Progress and trial requests — in bounded, idempotent, resumable batches. It
 * refuses an account Identity does not report closed, so this can never be
 * turned on a living person's study. The catalogue is the organisation's, so
 * an editor's closure never deletes a Course or a path.
 */
export function createLearningAccountService(deps: {
  readonly exports: LearningExportPort;
  readonly disposition: LearningDispositionPort;
  readonly accounts: LearningClosedAccountPort;
  readonly limiter: RateLimiterPort;
  readonly key: LearningLimitKey;
  readonly clock?: () => Date;
}) {
  const now = deps.clock ?? (() => new Date());
  const run = <T>(work: Promise<T>): Promise<T> => work.catch(asLearningRefusal);

  async function dispose(accountId: string): Promise<LearningDispositionProgress> {
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
     * Everything Learning holds about the signed-in account, as one
     * deterministic document of typed identifiers — never a Course's words or a
     * lesson's body.
     */
    async export(actor: LearningActor): Promise<LearningExport> {
      const parsed = learningAccountIdSchema.safeParse(actor?.accountId);
      if (!parsed.success) throw new LearningRefusal('denied');
      const decision = await deps.limiter.consume(
        deps.key('learning-export', parsed.data),
        LEARNING_EXPORT_RULE,
      );
      if (!decision.allowed) throw new LearningRefusal('rate-limited');
      const collected = await run(deps.exports.collect(parsed.data));
      return {
        schema: LEARNING_EXPORT_SCHEMA,
        version: LEARNING_EXPORT_VERSION,
        generatedAt: now().toISOString(),
        ...collected,
      };
    },

    /** Removes every Learning row of a CLOSED account; refused for any other. Idempotent. */
    async disposeAccount(accountId: string): Promise<LearningDispositionProgress> {
      if (!learningAccountIdSchema.safeParse(accountId).success)
        throw new LearningRefusal('invalid');
      const closed = await deps.accounts.closedAccounts([accountId]);
      if (!closed.includes(accountId)) throw new LearningRefusal('denied');
      return dispose(accountId);
    },

    /**
     * Finishes any closure an interruption left part-done: every account that
     * still owns Learning rows and that Identity says is closed. Bounded per
     * run; `complete` is false while any such account may remain.
     */
    async reconcileClosedAccounts(): Promise<LearningDispositionProgress> {
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
  };
}

export type LearningAccountService = ReturnType<typeof createLearningAccountService>;
