import 'server-only';

import { Prisma } from '@prisma/client';

import type {
  DonationCommunicationIntentRecord,
  DonationCommunicationPort,
  DonationCommunicationPurpose,
  DonationCurrency,
  DonationIntentState,
} from '@minhaj/contracts/donations';

import { getDatabaseClient } from '../../client.ts';
import {
  CAMPAIGN_LABEL_SELECT,
  bounded,
  dateOf,
  refuse,
  toCampaignLabel,
} from './shared.ts';

/**
 * Donations' durable payment-acknowledgement intent (ARCHITECTURE.md §4.6.1):
 * a purpose, the LINKED donor's account, the donation (and refund) it
 * describes, an instant and a key — committed WITH the change that owes it
 * and relayed afterwards by the Layer-4 dispatcher through the shared email
 * concern. Never a body, an address, a name, an amount list or a reference.
 * An anonymous donation owes no mail: no address is ever collected for one.
 *
 * WHAT IS OWED IS DECIDED AT DISPATCH, NOT AT COMMIT. An acknowledgement is
 * owed only while its fact still holds for the same linked donor: the
 * donation captured, or the refund succeeded. Whether the recipient's account
 * is still ACTIVE is Identity's answer, asked by the service, never read here.
 *
 * `owed` IS THE RECORD'S ANSWER ALONE, never the intent's state: the service
 * asks at relay and again at send time, and refuses an abandoned intent
 * itself from `intent.state`.
 */

/** Intents one dispatcher tick claims at most. */
const CLAIM_MAX = 100;

interface IntentRow {
  readonly id: string;
  readonly purpose: string;
  readonly donationId: string;
  readonly refundId: string | null;
  readonly recipientUserId: string;
  readonly dueAt: Date | string;
  readonly state: string;
  readonly idempotencyKey: string;
}

function toRecord(row: IntentRow): DonationCommunicationIntentRecord {
  return {
    id: row.id,
    donationId: row.donationId,
    refundId: row.refundId,
    recipientAccountId: row.recipientUserId,
    purpose: row.purpose as DonationCommunicationPurpose,
    dueAt: dateOf(row.dueAt),
    state: row.state as DonationIntentState,
    idempotencyKey: row.idempotencyKey,
  };
}

export function createDonationCommunication(): DonationCommunicationPort {
  const db = getDatabaseClient();

  return {
    /**
     * THE LEASE, in one statement at a stated isolation level: the oldest due
     * pending intents not under a live claim, claimed and returned atomically.
     * `READPAST` skips rows another dispatcher holds; a crashed dispatcher's
     * claim expires. `OUTPUT … INTO`, because the table carries a trigger.
     */
    async claimDue(now, limit, leaseSeconds) {
      const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000);
      try {
        const rows = await db.$transaction(
          async (tx) =>
            tx.$queryRaw<IntentRow[]>`
              DECLARE @claimed TABLE (
                [id] NVARCHAR(36), [purpose] NVARCHAR(64), [donationId] NVARCHAR(36),
                [refundId] NVARCHAR(36), [recipientUserId] NVARCHAR(36), [dueAt] DATETIME2,
                [state] NVARCHAR(16), [idempotencyKey] NVARCHAR(200));
              UPDATE i SET i.[claimedUntil] = ${leaseUntil}
              OUTPUT inserted.[id], inserted.[purpose], inserted.[donationId], inserted.[refundId],
                     inserted.[recipientUserId], inserted.[dueAt], inserted.[state],
                     inserted.[idempotencyKey]
              INTO @claimed
              FROM [dbo].[DonationCommunicationIntent] AS i WITH (READPAST, UPDLOCK, ROWLOCK)
              WHERE i.[state] = N'pending'
                AND i.[dueAt] <= ${now}
                AND (i.[claimedUntil] IS NULL OR i.[claimedUntil] < ${now})
                AND i.[id] IN (
                  SELECT TOP (${bounded(limit, CLAIM_MAX)}) d.[id]
                  FROM [dbo].[DonationCommunicationIntent] AS d WITH (READPAST, UPDLOCK, ROWLOCK)
                  WHERE d.[state] = N'pending'
                    AND d.[dueAt] <= ${now}
                    AND (d.[claimedUntil] IS NULL OR d.[claimedUntil] < ${now})
                  ORDER BY d.[dueAt] ASC, d.[id] ASC);
              SELECT * FROM @claimed ORDER BY [dueAt] ASC, [id] ASC;`,
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
        );
        return rows.map(toRecord);
      } catch (error) {
        refuse(error);
      }
    },

    /** Relayed once: only a PENDING intent moves, and the trigger (51357) keeps it there. */
    async markRelayed(intentId, now) {
      try {
        await db.donationCommunicationIntent.updateMany({
          where: { id: intentId, state: 'pending' },
          data: { state: 'relayed', relayedAt: now, claimedUntil: null },
        });
      } catch (error) {
        refuse(error);
      }
    },

    async markAbandoned(intentId, now) {
      try {
        await db.donationCommunicationIntent.updateMany({
          where: { id: intentId, state: 'pending' },
          data: { state: 'abandoned', abandonedAt: now, claimedUntil: null },
        });
      } catch (error) {
        refuse(error);
      }
    },

    async deliverySource(intentId) {
      try {
        const intent = await db.donationCommunicationIntent.findFirst({
          where: { id: intentId },
          select: {
            id: true,
            purpose: true,
            donationId: true,
            refundId: true,
            recipientUserId: true,
            dueAt: true,
            state: true,
            idempotencyKey: true,
            donation: {
              select: {
                donorUserId: true,
                capturedMinor: true,
                currency: true,
                expectedMinor: true,
                campaign: { select: CAMPAIGN_LABEL_SELECT },
              },
            },
            refund: { select: { state: true, currency: true, amountMinor: true } },
          },
        });
        if (intent === null) return null;
        const record = toRecord(intent);
        const { donation, refund } = intent;
        const sameDonor = donation.donorUserId === intent.recipientUserId;
        const holds =
          record.purpose === 'donation.succeeded'
            ? donation.capturedMinor !== null
            : refund !== null && refund.state === 'succeeded';
        return {
          intent: record,
          owed: sameDonor && holds,
          expected: {
            currency: donation.currency as DonationCurrency,
            minor: donation.expectedMinor,
          },
          refundAmount:
            refund === null
              ? null
              : {
                  currency: refund.currency as DonationCurrency,
                  minor: refund.amountMinor,
                },
          campaign: toCampaignLabel(donation.campaign),
        };
      } catch (error) {
        refuse(error);
      }
    },
  };
}
