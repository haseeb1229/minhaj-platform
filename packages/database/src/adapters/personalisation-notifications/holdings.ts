import 'server-only';

import type { PersonalHoldingPort } from '@minhaj/contracts/personalisation';

import { getDatabaseClient } from '../../client.ts';
import { refuse } from './shared.ts';

/**
 * Whether anybody holds one target — this context's own tables only.
 *
 * ONE BOUNDED STATEMENT PER QUESTION: `EXISTS` probes, each stopping at the
 * first row an index finds — every typed target column here leads an index
 * (`SavedItem_*_key`, `ReadingHistory_*_key`, `WatchHistory_videoId_idx`) — so
 * the cost does not grow with how many people saved, read or watched the
 * target. The answer is a single bit; no account, count or instant leaves.
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

    async workHeld(workId) {
      try {
        const [row] = await db.$queryRaw<{ held: number }[]>`
          SELECT CASE
            WHEN EXISTS (SELECT 1 FROM [dbo].[SavedItem] s WHERE s.[workId] = ${workId})
              OR EXISTS (SELECT 1 FROM [dbo].[ReadingHistory] r WHERE r.[workId] = ${workId})
            THEN 1 ELSE 0 END AS [held]`;
        return Number(row?.held ?? 0) === 1;
      } catch (error) {
        refuse(error);
      }
    },

    async articleHeld(articleId) {
      try {
        const [row] = await db.$queryRaw<{ held: number }[]>`
          SELECT CASE
            WHEN EXISTS (SELECT 1 FROM [dbo].[SavedItem] s WHERE s.[articleId] = ${articleId})
              OR EXISTS (SELECT 1 FROM [dbo].[ReadingHistory] r WHERE r.[articleId] = ${articleId})
            THEN 1 ELSE 0 END AS [held]`;
        return Number(row?.held ?? 0) === 1;
      } catch (error) {
        refuse(error);
      }
    },
  };
}
