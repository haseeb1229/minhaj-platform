import 'server-only';

import type { DonationDispositionPort } from '@minhaj/contracts/donations';

import { getDatabaseClient } from '../../client.ts';
import { LOCKED_TRANSACTION, bounded, refuse } from './shared.ts';

/**
 * Donations' part of a closed account's disposition, coordinated at Layer 4.
 *
 * FINANCIAL HISTORY IS RETAINED; THE LINK IS RELEASED. For a CLOSED account,
 * the mail still owed to it is abandoned (so a dispatcher holding a claim
 * relays nothing) and removed, and then each of its donations stops naming it:
 * `donorUserId` becomes NULL with `donorReleasedAt` set and the version moved
 * — the donation becomes anonymous. Its amounts, states, provider references,
 * events and refunds are left exactly as they are, and nothing is deleted but
 * owed mail.
 *
 * Whether the account is closed is Identity's answer, asked by the caller;
 * the migration's trigger (51350) refuses the release for any account that is
 * not closed. A donation is released only once no intent still names it with
 * its donor (the composite key would refuse it), so the two steps are ordered.
 *
 * BOUNDED, IDEMPOTENT AND RESUMABLE. Each call changes at most `limit` rows per
 * step and reports how many; the rows themselves are the pending work.
 */

const DISPOSAL_MAX = 1_000;

export function createDonationDisposition(): DonationDispositionPort {
  const db = getDatabaseClient();

  return {
    async disposeAccount(accountId, limit) {
      try {
        const size = bounded(limit, DISPOSAL_MAX);
        return await db.$transaction(async (tx) => {
          const now = new Date();
          await tx.$executeRaw`
            UPDATE [dbo].[DonationCommunicationIntent]
            SET [state] = N'abandoned', [abandonedAt] = ${now}, [claimedUntil] = NULL
            WHERE [recipientUserId] = ${accountId} AND [state] = N'pending'`;
          let changed = await tx.$executeRaw`
            DELETE TOP (${size}) FROM [dbo].[DonationCommunicationIntent]
            WHERE [recipientUserId] = ${accountId}`;
          changed += await tx.$executeRaw`
            UPDATE TOP (${size}) d
            SET d.[donorUserId] = NULL, d.[donorReleasedAt] = ${now},
                d.[version] = d.[version] + 1, d.[updatedAt] = ${now}
            FROM [dbo].[Donation] AS d WITH (UPDLOCK, ROWLOCK)
            WHERE d.[donorUserId] = ${accountId}
              AND NOT EXISTS (
                SELECT 1 FROM [dbo].[DonationCommunicationIntent] i WHERE i.[donationId] = d.[id])`;
          return changed;
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    async accountsWithData(after, limit) {
      try {
        const size = bounded(limit, DISPOSAL_MAX);
        const rows = await db.$queryRaw<{ userId: string }[]>`
          SELECT TOP (${size}) [userId] FROM (
            SELECT [donorUserId] AS [userId] FROM [dbo].[Donation] WHERE [donorUserId] IS NOT NULL
            UNION SELECT [recipientUserId] FROM [dbo].[DonationCommunicationIntent]
          ) AS [owners]
          WHERE ${after} IS NULL OR [userId] > ${after}
          ORDER BY [userId]`;
        return rows.map((row) => row.userId);
      } catch (error) {
        refuse(error);
      }
    },
  };
}
