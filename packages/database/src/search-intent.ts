import 'server-only';

import type { Prisma } from '@prisma/client';

import type { SearchScopeKind } from '@minhaj/contracts/search';

/**
 * Durable search-indexing intent, committed INSIDE an owner's own transaction.
 *
 * PACKAGE-INTERNAL, like `audit-row.ts`, and for the same reason: several owner
 * adapters must write the SAME row the same way, alongside the change it
 * describes. It is not exported from this package, holds no capability of its
 * own, and takes the transaction it is already inside.
 *
 * WHY IN THE OWNER'S TRANSACTION (ARCHITECTURE.md §8.5): "where correctness
 * depends on that work actually happening, the authoritative transaction
 * commits durable derived-work intent alongside the domain change". If the
 * change commits, so does the request; if the change rolls back, so does the
 * request. There is no window in which a publish is committed and its indexing
 * is not owed.
 *
 * WHAT IT DOES NOT DO: index anything. Search is derived work and never part of
 * the authoritative transaction. The row is an append-only request the indexer
 * folds into its own state afterwards, so the owner's transaction takes no lock
 * on Search's working state and cannot deadlock with the indexer.
 *
 * DELIBERATELY UNCONDITIONAL. An owner calls this on every mutation that could
 * change what it publishes — including ones that turn out not to — because the
 * indexer re-projects from the owner's CURRENT public state and a redundant
 * request costs one idempotent re-projection. A skipped one costs a stale index.
 */
export async function requestSearchIndexing(
  tx: Prisma.TransactionClient,
  kind: SearchScopeKind,
  id: string,
): Promise<void> {
  await tx.searchIndexRequest.create({ data: { scopeKind: kind, scopeId: id } });
}
