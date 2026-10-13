import 'server-only';

import type { FatwaReadTallyPort } from '@minhaj/contracts/fatwa';

import { getDatabaseClient } from '../../client.ts';

/**
 * The anonymous read tally `sort=popular` reads (DOMAIN_MODEL.md §12).
 *
 * A COUNT AND NOTHING ELSE. One call adds one read to today's (UTC) per-ruling
 * count through `FatwaRecordRead`, which counts nothing unless the service is
 * activated and the ruling is public now. No account, address, cookie,
 * fingerprint or user agent reaches this module, so none can be stored; the
 * caller's rate limit decides whether a read is counted at all.
 */
export function createFatwaReadTally(): FatwaReadTallyPort {
  const db = getDatabaseClient();

  return {
    async record(fatwaId) {
      // `YYYY-MM-DD`: the one string form SQL Server reads as a DATE
      // independently of the session's language and date format.
      const day = new Date().toISOString().slice(0, 10);
      await db.$executeRaw`EXEC [dbo].[FatwaRecordRead] @fatwaId = ${fatwaId}, @day = ${day}`;
    },
  };
}
