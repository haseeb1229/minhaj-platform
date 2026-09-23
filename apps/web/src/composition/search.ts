import 'server-only';

import { after } from 'next/server';

import { createAuditWriter } from '@minhaj/database';
import type { SearchService } from '@minhaj/search';

import { failureLabel, isTransientDatabaseFailure } from './failure-label';
import { appLogger } from './logging';
import { buildSearchService } from './search-read';

/**
 * The Search runtime for OPERATORS AND BACKGROUND WORK — Layer 4.
 *
 * The same service the public page uses (`search-read.ts`), built with the
 * structured application logger, because these paths — the after-response
 * indexing tick, the sweep and the operator actions — are not part of the
 * anonymous public tree and may compose from the server configuration.
 *
 * NO QUERY TEXT IS EVER LOGGED. A failure is reported as the operation that
 * failed and the database's own error class (SECURITY_BASELINE.md §19.2).
 */

function report(operation: string, error: unknown): void {
  const detail = {
    operation,
    error: failureLabel(error),
    transient: isTransientDatabaseFailure(error),
  };
  if (detail.transient) appLogger().warn(detail, 'Search operation failed; will retry.');
  else appLogger().error(detail, 'Search operation failed.');
}

let runtime: SearchService | null = null;

export function searchRuntime(): SearchService {
  return (runtime ??= buildSearchService(report));
}

/**
 * Indexes what an owner mutation just committed, AFTER the response.
 *
 * Called by the owners' administrative actions, so a publication is searchable
 * within moments rather than at the next sweep — without putting derived work on
 * the critical path of the operator's form (ARCHITECTURE.md §8.5). A failure
 * here is reported, not thrown: the request is durable and the sweep retries it.
 */
export function indexAfterResponse(): void {
  after(async () => {
    try {
      await searchRuntime().processDue({ budgetMs: 5_000 });
    } catch (error) {
      report('search.index.after-response', error);
    }
  });
}

/**
 * The bounded background sweep: every thirty seconds, up to twenty seconds of
 * work. It catches up after downtime, retries failures on their schedule, and
 * indexes what a scheduled publication committed without an operator present.
 *
 * SAFE WITH SEVERAL PROCESSES. Every scope is leased; a second process takes
 * different scopes rather than the same ones (ARCHITECTURE.md §3.5.1).
 */
const SWEEP_MS = 30_000;
let sweep: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startSearchSweep(): void {
  if (sweep !== null) return;
  sweep = setInterval(() => {
    if (running) return;
    running = true;
    void searchRuntime()
      .processDue({ budgetMs: 20_000 })
      .catch((error: unknown) => report('search.index.sweep', error))
      .finally(() => {
        running = false;
      });
  }, SWEEP_MS);
  sweep.unref();
  process.once('SIGTERM', stopSearchSweep);
  process.once('SIGINT', stopSearchSweep);
}

function stopSearchSweep(): void {
  if (sweep !== null) clearInterval(sweep);
  sweep = null;
  process.removeListener('SIGTERM', stopSearchSweep);
  process.removeListener('SIGINT', stopSearchSweep);
}

/**
 * Audits an operator's search operation. Who asked, and which operation —
 * search operations change no content, so there is no before and after to
 * record (SECURITY_BASELINE.md §13.4).
 */
export async function recordSearchOperation(
  operation: 'retry' | 'reconcile' | 'rebuild',
  accountId: string,
): Promise<void> {
  await createAuditWriter().record({
    action: `search.index.${operation}`,
    actorType: 'user',
    actorId: accountId,
    targetType: 'search-index',
    targetId: null,
    authorisingSource: 'search.operate',
  });
}
