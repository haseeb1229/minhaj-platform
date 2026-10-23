import 'server-only';

import type { PersonalHoldingPort } from '@minhaj/contracts/personalisation';

import { getDatabaseClient } from '../../client.ts';
import { refuse } from './shared.ts';

/**
 * Whether anybody holds one target — this context's own tables only.
 *
 * ONE BOUNDED STATEMENT: two `EXISTS` probes, each stopping at the first row an
 * index finds, so the cost does not grow with how many people saved or watched
 * the Video. The answer is a single bit; no account, count or instant leaves.
 */
export function createPersonalHoldings(): PersonalHoldingPort {
  const db = getDatabaseClient();

  return {
    async videoHeld(videoId) {
      try {
        const [row] = await db.$queryRaw<{ held: number }[]>`
          SELECT CASE
            WHEN EXISTS (SELECT 1 FROM [dbo].[SavedItem] s WHERE s.[videoId] = ${videoId})
              OR EXISTS (SELECT 1 FROM [dbo].[WatchHistory] w WHERE w.[videoId] = ${videoId})
            THEN 1 ELSE 0 END AS [held]`;
        return Number(row?.held ?? 0) === 1;
      } catch (error) {
        refuse(error);
      }
    },
  };
}
