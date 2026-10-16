import 'server-only';

import { Prisma } from '@prisma/client';

import {
  CLASS_COMMUNICATION_PURPOSES,
  type ClassCommunicationIntentRecord,
  type ClassCommunicationPort,
  type ClassCommunicationPurpose,
  type IntentState,
} from '@minhaj/contracts/learning';

import { getDatabaseClient } from '../../client.ts';
import { toSessionView } from './class-records.ts';
import { sessionView } from './sessions.ts';
import { activated, bounded, refuse } from './shared.ts';

/**
 * Learning's durable service-mail intent (ARCHITECTURE.md §4.6.1, §8.5): a
 * purpose, a session, a recipient and an instant, committed WITH the change
 * that owes it and relayed afterwards by the Layer-4 dispatcher through the
 * shared email concern. Never a body, an address or a meeting link.
 *
 * WHAT IS OWED IS DECIDED AT DISPATCH, NOT AT COMMIT. A reminder committed
 * for a class that was since cancelled, a confirmation for a Booking since
 * withdrawn, a reminder to a teacher since revoked — each is answered
 * `owed: false` by `deliverySource`, which re-reads the session, the scope,
 * the Booking, the Enrolment and Identity's live assignment AS THEY STAND.
 * Abandonment at change time is the first line; this is the floor.
 */

/** Intents one dispatcher tick claims at most. */
const CLAIM_MAX = 100;

interface IntentRow {
  readonly id: string;
  readonly purpose: string;
  readonly sessionId: string;
  readonly userId: string;
  readonly dueAt: Date;
  readonly state: string;
  readonly idempotencyKey: string;
}

function toRecord(row: IntentRow): ClassCommunicationIntentRecord {
  return {
    id: row.id,
    purpose: row.purpose as ClassCommunicationPurpose,
    sessionId: row.sessionId,
    accountId: row.userId,
    dueAt: row.dueAt,
    state: row.state as IntentState,
    idempotencyKey: row.idempotencyKey,
  };
}

export function createClassCommunication(): ClassCommunicationPort {
  const db = getDatabaseClient();

  return {
    /**
     * THE LEASE, in one statement at an isolation level it STATES: the oldest
     * due pending intents not under a live claim, claimed and returned in a
     * single atomic step. `READPAST` skips rows another dispatcher holds
     * rather than blocking on them; a crashed dispatcher's claim expires and
     * the row is due again (the shape `email/delivery.ts` proved).
     *
     * `OUTPUT … INTO` a table variable, because the intent table carries its
     * integrity trigger (51292) and SQL Server refuses a bare OUTPUT clause on
     * a table with an enabled trigger; the claim is still the one UPDATE.
     */
    async claimDue(now, limit, leaseSeconds) {
      const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000);
      try {
        const rows = await db.$transaction(
          async (tx) =>
            tx.$queryRaw<IntentRow[]>`
              DECLARE @claimed TABLE (
                [id] NVARCHAR(36), [purpose] NVARCHAR(64), [sessionId] NVARCHAR(36),
                [userId] NVARCHAR(36), [dueAt] DATETIME2, [state] NVARCHAR(16),
                [idempotencyKey] NVARCHAR(200));
              UPDATE i SET i.[claimedUntil] = ${leaseUntil}
              OUTPUT inserted.[id], inserted.[purpose], inserted.[sessionId], inserted.[userId],
                     inserted.[dueAt], inserted.[state], inserted.[idempotencyKey]
              INTO @claimed
              FROM [dbo].[ClassCommunicationIntent] AS i WITH (READPAST, UPDLOCK, ROWLOCK)
              WHERE i.[state] = N'pending'
                AND i.[dueAt] <= ${now}
                AND (i.[claimedUntil] IS NULL OR i.[claimedUntil] < ${now})
                AND i.[id] IN (
                  SELECT TOP (${bounded(limit, CLAIM_MAX)}) d.[id]
                  FROM [dbo].[ClassCommunicationIntent] AS d WITH (READPAST, UPDLOCK, ROWLOCK)
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

    /** Relayed once: only a PENDING intent moves, and the trigger (51292) keeps it there. */
    async markRelayed(intentId) {
      try {
        await db.classCommunicationIntent.updateMany({
          where: { id: intentId, state: 'pending' },
          data: { state: 'relayed', relayedAt: new Date(), claimedUntil: null },
        });
      } catch (error) {
        refuse(error);
      }
    },

    async markAbandoned(intentId) {
      try {
        await db.classCommunicationIntent.updateMany({
          where: { id: intentId, state: 'pending' },
          data: { state: 'abandoned', claimedUntil: null },
        });
      } catch (error) {
        refuse(error);
      }
    },

    async deliverySource(intentId) {
      const intent = await db.classCommunicationIntent.findFirst({
        where: { id: intentId },
        select: {
          id: true,
          purpose: true,
          sessionId: true,
          userId: true,
          dueAt: true,
          state: true,
          idempotencyKey: true,
        },
      });
      if (intent === null) return null;
      const row = await sessionView(db, intent.sessionId);
      if (row === null) return null;
      const session = toSessionView(row);
      const recipientRole = intent.userId === row.scope.userId ? 'teacher' : 'learner';

      // A cancellation is owed once whatever has happened since — the person
      // was a participant when the class was cancelled, and that is the news.
      // Everything else needs the class still scheduled AND the recipient
      // still its teacher (scope current, assignment live in Identity) or
      // still a participant (own confirmed Booking, or current Enrolment).
      let owed = (await activated(db)) && intent.state === 'pending';
      if (owed && intent.purpose !== 'learning.session-cancelled') {
        const [current] = await db.$queryRaw<{ current: number }[]>`
          SELECT CASE WHEN cs.[state] = N'scheduled' AND (
            (${recipientRole} = N'teacher' AND s.[endedAt] IS NULL AND s.[userId] = ${intent.userId}
              AND EXISTS (
                SELECT 1 FROM [dbo].[RoleAssignment] ra
                JOIN [dbo].[Role] r ON r.[id] = ra.[roleId] AND r.[deactivatedAt] IS NULL
                JOIN [dbo].[RolePermission] rp ON rp.[roleId] = r.[id] AND rp.[permissionKey] = N'teaching.perform'
                JOIN [dbo].[User] u ON u.[id] = ra.[userId] AND u.[status] = N'active'
                WHERE ra.[id] = s.[roleAssignmentId] AND ra.[userId] = s.[userId] AND ra.[revokedAt] IS NULL))
            OR (${recipientRole} = N'learner' AND (
              (cs.[kind] = N'trial' AND EXISTS (SELECT 1 FROM [dbo].[Booking] b
                 WHERE b.[sessionId] = cs.[id] AND b.[userId] = ${intent.userId} AND b.[state] = N'confirmed'))
              OR (cs.[kind] = N'course' AND EXISTS (SELECT 1 FROM [dbo].[Enrolment] e
                 JOIN [dbo].[Course] c ON c.[id] = e.[courseId] AND c.[state] = N'published'
                 WHERE e.[courseId] = cs.[courseId] AND e.[userId] = ${intent.userId}))))
          ) THEN 1 ELSE 0 END AS [current]
          FROM [dbo].[ClassSession] cs
          JOIN [dbo].[CourseTeachingAssignment] s ON s.[id] = cs.[scopeId]
          WHERE cs.[id] = ${intent.sessionId}`;
        owed = Number(current?.current ?? 0) === 1;
      }
      return { intent: toRecord(intent), session, recipientRole, owed };
    },

    /** Operator view: pending and abandoned by purpose; every purpose named, zeros included. */
    async summarise() {
      const rows = await db.classCommunicationIntent.groupBy({
        by: ['purpose', 'state'],
        where: { state: { in: ['pending', 'abandoned'] } },
        _count: { _all: true },
      });
      return CLASS_COMMUNICATION_PURPOSES.map((purpose) => ({
        purpose,
        pending:
          rows.find((row) => row.purpose === purpose && row.state === 'pending')?._count
            ._all ?? 0,
        abandoned:
          rows.find((row) => row.purpose === purpose && row.state === 'abandoned')?._count
            ._all ?? 0,
      }));
    },
  };
}
