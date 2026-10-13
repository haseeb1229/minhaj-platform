import 'server-only';

import type { FatwaDispositionPort } from '@minhaj/contracts/fatwa';

import { getDatabaseClient } from '../../client.ts';
import { bounded, refuse } from './shared.ts';

/**
 * Fatwa's own part of account closure (SECURITY_BASELINE.md §19.1).
 *
 * `FatwaDisposeQuestions` does the work in one transaction per batch: it
 * refuses a named account that is not closed, erases the private text of that
 * account's questions, closes those still open, and records an audit entry per
 * question naming only the question. Published rulings are untouched — they
 * never held the question. Idempotent and resumable: a disposed question is
 * never selected again.
 */

/** The procedure's own ceiling on one batch. */
const DISPOSAL_BATCH = 1_000;

export function createFatwaDisposition(): FatwaDispositionPort {
  const db = getDatabaseClient();

  /** One batch: the number of questions it changed. */
  async function dispose(askerId: string | null, limit: number): Promise<number> {
    try {
      const [row] = await db.$queryRaw<{ disposed: number }[]>`
        EXEC [dbo].[FatwaDisposeQuestions]
          @askerId = ${askerId},
          @limit = ${limit},
          @at = ${new Date()}`;
      return Number(row?.disposed ?? 0);
    } catch (error) {
      refuse(error);
    }
  }

  return {
    /** Every question of one closed account, batch after batch until none is left. */
    async disposeAccount(accountId) {
      let total = 0;
      for (;;) {
        const disposed = await dispose(accountId, DISPOSAL_BATCH);
        total += disposed;
        if (disposed < DISPOSAL_BATCH) return total;
      }
    },

    disposeClosedAccounts: (limit) => dispose(null, bounded(limit, DISPOSAL_BATCH)),
  };
}
