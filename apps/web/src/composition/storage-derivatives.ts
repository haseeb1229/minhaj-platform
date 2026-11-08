import 'server-only';

import type { AssetAuthorizationPort } from '@minhaj/contracts/platform';

import { storageRuntime } from './storage';

/**
 * Deriving a newly public picture's WebP widths, in the background
 * (Rebaseline R2).
 *
 * THE EXACT MOMENT A PICTURE BECOMES PUBLIC-ELIGIBLE is not one event: it is a
 * publication, a revision, a replaced cover, a person's rights decision followed
 * by a migration publish — across five contexts. What they all share is the
 * owning context's PUBLIC serving policy, which says yes from that moment on.
 * So derivation is asked for exactly there: when a derivative route has just
 * had that policy allow the source and found a width not rendered yet. Nothing
 * a policy refuses — a draft, a restricted acquisition no record shows, a
 * withdrawn record — is ever decoded, and Storage asks the same policy again
 * before it derives. Existing pictures are derived ahead of any visitor by the
 * operator's backfill (`storage:derivatives:backfill`).
 *
 * BOUNDED, BECAUSE A VISITOR TRIGGERS IT. One derivation at a time per process,
 * at most `QUEUE_LIMIT` waiting (a request beyond that is simply not queued —
 * its visitor already has the picture itself), each asset at most once at a
 * time, and an asset that failed is not tried again by this process. It is
 * DERIVED WORK (ARCHITECTURE.md §8.5): idempotent, reconstructable by the
 * backfill, and its failure costs bandwidth, never correctness — the source is
 * served instead. It is not logged: the public byte route's module graph
 * reaches no logger (§8.1); the backfill reports what remains.
 */

const QUEUE_LIMIT = 32;
const FAILED_MEMORY = 1_000;

const queued = new Map<string, AssetAuthorizationPort>();
const failed = new Set<string>();
let running = false;

export function requestDerivation(assetId: string, policy: AssetAuthorizationPort): void {
  if (queued.has(assetId) || failed.has(assetId) || queued.size >= QUEUE_LIMIT) return;
  queued.set(assetId, policy);
  if (!running) void drain();
}

async function drain(): Promise<void> {
  running = true;
  try {
    for (const [assetId, policy] of queued) {
      let outcome: 'derived' | 'refused' | 'failed';
      try {
        outcome = (await (await storageRuntime()).derive(assetId, policy)).status;
      } catch {
        outcome = 'failed';
      }
      queued.delete(assetId);
      if (outcome === 'failed') {
        if (failed.size >= FAILED_MEMORY) failed.clear();
        failed.add(assetId);
      }
    }
  } finally {
    running = false;
  }
}
