import 'server-only';

import { Prisma } from '@prisma/client';

import {
  PURPOSE_STATUS,
  type MembershipCommunicationIntentRecord,
  type MembershipCommunicationPort,
  type MembershipCommunicationPurpose,
  type MembershipIntentState,
} from '@minhaj/contracts/membership';

import { getDatabaseClient } from '../../client.ts';
import {
  TYPE_REFERENCE_SELECT,
  bounded,
  dateOf,
  refuse,
  toTypeReference,
} from './shared.ts';

/**
 * Membership's durable applicant service-mail intent (ARCHITECTURE.md
 * §4.6.1): a purpose, the recipient account, the ONE application or
 * Membership it describes, an instant and a key — committed WITH the change
 * that owes it and relayed afterwards by the Layer-4 dispatcher through the
 * shared email concern. Never a body, an address or a name.
 *
 * WHAT IS OWED IS DECIDED AT DISPATCH, NOT AT COMMIT. An application message
 * is owed only while the application still stands at the status its purpose
 * describes — a withdrawal only when the applicant withdrew — and a closure
 * message only while the Membership is closed. `deliverySource` answers from
 * Membership's own rows as they stand; whether the recipient's account is
 * still ACTIVE is Identity's answer, asked by the service, never read here.
 *
 * `owed` IS THE RECORD'S ANSWER ALONE, never the intent's state. The service
 * asks twice — at relay, while the intent is pending, and again at send time,
 * when it is already relayed — and refuses an abandoned intent itself from
 * `intent.state`. An answer that also required `pending` would make every send
 * resolve as nothing owed.
 */

/** Intents one dispatcher tick claims at most. */
const CLAIM_MAX = 100;

interface IntentRow {
  readonly id: string;
  readonly purpose: string;
  readonly recipientUserId: string;
  readonly applicationId: string | null;
  readonly membershipId: string | null;
  readonly dueAt: Date | string;
  readonly state: string;
  readonly idempotencyKey: string;
}

function toRecord(row: IntentRow): MembershipCommunicationIntentRecord {
  return {
    id: row.id,
    purpose: row.purpose as MembershipCommunicationPurpose,
    recipientAccountId: row.recipientUserId,
    applicationId: row.applicationId,
    membershipId: row.membershipId,
    dueAt: dateOf(row.dueAt),
    state: row.state as MembershipIntentState,
    idempotencyKey: row.idempotencyKey,
  };
}

export function createMembershipCommunication(): MembershipCommunicationPort {
  const db = getDatabaseClient();

  return {
    /**
     * THE LEASE, in one statement at an isolation level it STATES: the oldest
     * due pending intents not under a live claim, claimed and returned in a
     * single atomic step. `READPAST` skips rows another dispatcher holds
     * rather than blocking on them; a crashed dispatcher's claim expires and
     * the row is due again.
     *
     * `OUTPUT … INTO` a table variable, because the intent table carries its
     * integrity trigger (51325) and SQL Server refuses a bare OUTPUT clause on
     * a table with an enabled trigger; the claim is still the one UPDATE.
     */
    async claimDue(now, limit, leaseSeconds) {
      const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000);
      try {
        const rows = await db.$transaction(
          async (tx) =>
            tx.$queryRaw<IntentRow[]>`
              DECLARE @claimed TABLE (
                [id] NVARCHAR(36), [purpose] NVARCHAR(64), [recipientUserId] NVARCHAR(36),
                [applicationId] NVARCHAR(36), [membershipId] NVARCHAR(36), [dueAt] DATETIME2,
                [state] NVARCHAR(16), [idempotencyKey] NVARCHAR(200));
              UPDATE i SET i.[claimedUntil] = ${leaseUntil}
              OUTPUT inserted.[id], inserted.[purpose], inserted.[recipientUserId],
                     inserted.[applicationId], inserted.[membershipId], inserted.[dueAt],
                     inserted.[state], inserted.[idempotencyKey]
              INTO @claimed
              FROM [dbo].[MembershipCommunicationIntent] AS i WITH (READPAST, UPDLOCK, ROWLOCK)
              WHERE i.[state] = N'pending'
                AND i.[dueAt] <= ${now}
                AND (i.[claimedUntil] IS NULL OR i.[claimedUntil] < ${now})
                AND i.[id] IN (
                  SELECT TOP (${bounded(limit, CLAIM_MAX)}) d.[id]
                  FROM [dbo].[MembershipCommunicationIntent] AS d WITH (READPAST, UPDLOCK, ROWLOCK)
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

    /** Relayed once: only a PENDING intent moves, and the trigger (51325) keeps it there. */
    async markRelayed(intentId) {
      try {
        await db.membershipCommunicationIntent.updateMany({
          where: { id: intentId, state: 'pending' },
          data: { state: 'relayed', relayedAt: new Date(), claimedUntil: null },
        });
      } catch (error) {
        refuse(error);
      }
    },

    async markAbandoned(intentId) {
      try {
        await db.membershipCommunicationIntent.updateMany({
          where: { id: intentId, state: 'pending' },
          data: { state: 'abandoned', claimedUntil: null },
        });
      } catch (error) {
        refuse(error);
      }
    },

    async deliverySource(intentId) {
      try {
        const intent = await db.membershipCommunicationIntent.findFirst({
          where: { id: intentId },
          select: {
            id: true,
            purpose: true,
            recipientUserId: true,
            applicationId: true,
            membershipId: true,
            dueAt: true,
            state: true,
            idempotencyKey: true,
            application: {
              select: { status: true, withdrawalSource: true, membershipTypeId: true },
            },
            membership: { select: { status: true, membershipTypeId: true } },
          },
        });
        if (intent === null) return null;
        const record = toRecord(intent);
        let standing: boolean;
        let membershipTypeId: string | undefined;
        if (record.purpose === 'membership.closed') {
          standing = intent.membership?.status === 'closed';
          membershipTypeId = intent.membership?.membershipTypeId;
        } else {
          const application = intent.application;
          standing =
            application !== null &&
            application.status === PURPOSE_STATUS[record.purpose] &&
            (record.purpose !== 'membership.application.withdrawn' ||
              application.withdrawalSource === 'applicant');
          membershipTypeId = application?.membershipTypeId;
        }
        if (membershipTypeId === undefined) return null;
        const type = await db.membershipType.findFirst({
          where: { id: membershipTypeId },
          select: TYPE_REFERENCE_SELECT,
        });
        if (type === null) return null;
        return {
          intent: record,
          owed: standing,
          type: toTypeReference(type),
        };
      } catch (error) {
        refuse(error);
      }
    },
  };
}
