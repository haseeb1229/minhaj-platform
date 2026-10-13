'use server';

import { fatwaReadCounter } from '@/composition/fatwa-read-count';
import { appLogger } from '@/composition/logging';
import { publicClientAddress } from '@/composition/request-address';

/**
 * The read counter's ONLY entry point — a Class-A browser mutation through a
 * Server Action, so it is a POST under the framework's Origin checks and never
 * reachable by GET (SECURITY_BASELINE.md §7.1).
 *
 * WHAT IT TRUSTS. Only the slug, and only after Fatwa has resolved it to a
 * ruling that is public now; the network address is used solely as the
 * subject of the platform's keyed, expiring rate limiter and is never stored
 * with the count (`createFatwaReadCounter`).
 *
 * IT NEVER THROWS TO THE PAGE AND RETURNS NOTHING. A failure is logged by
 * operation name only — no slug, no address, no error text — and swallowed.
 */
export async function recordFatwaRead(slug: unknown): Promise<void> {
  if (typeof slug !== 'string') return;
  try {
    await fatwaReadCounter().record(slug, await publicClientAddress());
  } catch {
    appLogger().warn({ operation: 'fatwa-read-count' }, 'Fatwa read count failed.');
  }
}
