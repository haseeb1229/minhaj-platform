import 'server-only';

import {
  FATWA_READ_WINDOW_SECONDS,
  fatwaSlugSchema,
  type FatwaPublicReaderPort,
  type FatwaReadTallyPort,
} from '@minhaj/contracts/fatwa';
import type { RateLimitRule, RateLimiterPort } from '@minhaj/contracts/platform';

/**
 * Counting a read — the only input to `/fatwa?sort=popular`.
 *
 * WHAT IS COUNTED. One read per network address per ruling per
 * `FATWA_READ_WINDOW_SECONDS`, of a ruling that is public now, added to that
 * ruling's count for the current UTC day. That is the whole signal.
 *
 * WHAT IS NOT STORED. No account, address, cookie, fingerprint, user agent or
 * referrer reaches the tally. The address is used only as the subject of the
 * platform's existing rate limiter, which digests it with a keyed HMAC and
 * keeps the digest only until its window expires — the same treatment every
 * public search already gets.
 *
 * NEVER A GET. The page sends this as a POST after it renders; viewing a page
 * changes nothing, and a crawler that follows links increments nothing. A
 * failure here is swallowed by the caller: a count is never worth a broken
 * page.
 *
 * NEVER RELIGIOUS DATA. The count touches no ruling, revision or question and
 * writes no audit row; it is engagement arithmetic, not a record of anyone.
 */

export const FATWA_READ_RULE: RateLimitRule = Object.freeze({
  window: FATWA_READ_WINDOW_SECONDS,
  max: 1,
});

export function createFatwaReadCounter(deps: {
  readonly reader: Pick<FatwaPublicReaderPort, 'publicId'>;
  readonly tally: FatwaReadTallyPort;
  readonly limiter: RateLimiterPort;
  /** The limiter key for one address and one ruling, built at Layer 4. */
  readonly key: (clientAddress: string, fatwaId: string) => string;
}) {
  return {
    /** Counts one read of the ruling at `slug`, if it is public and not yet counted. */
    async record(slug: string, clientAddress: string): Promise<void> {
      if (!fatwaSlugSchema.safeParse(slug).success) return;
      const fatwaId = await deps.reader.publicId(slug);
      if (fatwaId === null) return;
      const decision = await deps.limiter.consume(
        deps.key(clientAddress, fatwaId),
        FATWA_READ_RULE,
      );
      if (!decision.allowed) return;
      await deps.tally.record(fatwaId);
    },
  };
}
