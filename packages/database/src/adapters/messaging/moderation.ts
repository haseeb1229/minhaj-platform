import 'server-only';

import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';

import type {
  ActivityCursor,
  ClaimOutcome,
  ConversationKind,
  DecisionOutcome,
  MessagingPersistencePort,
  ModerationAction,
  ReportOutcome,
  ReportReason,
  ReportRecord,
  ReportState,
  ResolveOutcome,
} from '@minhaj/contracts/messaging';

import { auditRow } from '../../audit-row.ts';
import { getDatabaseClient } from '../../client.ts';
import {
  bounded,
  dateOf,
  isUniqueViolation,
  LEFT_NOW,
  LOCKED_TRANSACTION,
  NOW_MS,
  numberOf,
  refusalNumber,
  refuse,
  type Client,
} from './shared.ts';

/**
 * The support queue's claims and resolutions, and reports with their
 * moderation decisions.
 *
 * EVERY CHANGE CLAIMS A VERSION AND WRITES ITS AUDIT ROW IN THE SAME
 * TRANSACTION. A claim and a resolution move the conversation's version; a
 * decision moves the report's. Of two staff acting on what they both saw,
 * exactly one proceeds and the other is told `conflict`. The audit event is
 * the service's — ids and states only — and commits with the change or not at
 * all.
 *
 * A REPORT IS TYPED. Its target is the conversation, or — with `messageId` —
 * that message, by a composite key that carries the conversation; no
 * `targetType` exists. A report and its decision are never deleted.
 */

/** Rolls a transaction back when its version claim did not hold. Never leaves this module. */
class ConflictSignal extends Error {
  constructor() {
    super('conflict');
    this.name = 'ConflictSignal';
  }
}

type ModerationPart = Pick<
  MessagingPersistencePort,
  'claimSupport' | 'resolveSupport' | 'fileReport' | 'reports' | 'report' | 'decide'
>;

interface ReportRow {
  readonly id: string;
  readonly conversationId: string;
  readonly conversationKind: string;
  readonly messageId: string | null;
  readonly reporterUserId: string;
  readonly reason: string;
  readonly atSequence: number;
  readonly messageSequence: number | null;
  readonly state: string;
  readonly createdAt: Date | string;
  readonly version: number;
  readonly action: string | null;
  readonly decidedAt: Date | string | null;
  readonly moderatorUserId: string | null;
}

/** The report columns, its conversation's kind, its message's sequence and its decision. */
function reportQuery(where: Prisma.Sql, limit: number): Prisma.Sql {
  return Prisma.sql`
    SELECT TOP (${limit})
           r.[id], r.[conversationId], c.[kind] AS [conversationKind], r.[messageId],
           r.[reporterUserId], r.[reason], r.[atSequence], m.[sequence] AS [messageSequence],
           r.[state], r.[createdAt], r.[version],
           d.[action], d.[decidedAt], d.[moderatorUserId]
    FROM [dbo].[MessagingReport] r
    JOIN [dbo].[Conversation] c ON c.[id] = r.[conversationId]
    LEFT JOIN [dbo].[Message] m ON m.[id] = r.[messageId] AND m.[conversationId] = r.[conversationId]
    LEFT JOIN [dbo].[MessagingModerationDecision] d ON d.[reportId] = r.[id]
    WHERE ${where}
    ORDER BY r.[createdAt] DESC, r.[id] DESC`;
}

function toReportRecord(row: ReportRow): ReportRecord {
  return {
    id: row.id,
    conversationId: row.conversationId,
    conversationKind: row.conversationKind as ConversationKind,
    messageId: row.messageId,
    reporterAccountId: row.reporterUserId,
    reason: row.reason as ReportReason,
    atSequence: numberOf(row.atSequence),
    messageSequence: row.messageSequence === null ? null : numberOf(row.messageSequence),
    state: row.state as ReportState,
    createdAt: dateOf(row.createdAt),
    version: numberOf(row.version),
    decision:
      row.action === null || row.decidedAt === null || row.moderatorUserId === null
        ? null
        : {
            action: row.action as ModerationAction,
            decidedAt: dateOf(row.decidedAt),
            moderatorAccountId: row.moderatorUserId,
          },
  };
}

/** Newest first; the id breaks ties. Report instants are written at millisecond precision. */
function afterReport(after: ActivityCursor | null): Prisma.Sql {
  return after === null
    ? Prisma.sql`1 = 1`
    : Prisma.sql`(r.[createdAt] < ${after.at} OR (r.[createdAt] = ${after.at} AND r.[id] < ${after.id}))`;
}

interface LockedConversation {
  readonly kind: string;
  readonly state: string;
  readonly version: number;
  readonly requesterUserId: string | null;
  readonly disposing: number;
}

async function lockConversation(
  tx: Client,
  conversationId: string,
): Promise<LockedConversation | null> {
  const [row] = await tx.$queryRaw<LockedConversation[]>`
    SELECT [kind], [state], [version], [requesterUserId],
           CASE WHEN [disposingAt] IS NULL THEN 0 ELSE 1 END AS [disposing]
    FROM [dbo].[Conversation] WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
    WHERE [id] = ${conversationId}`;
  return row ?? null;
}

export function moderationPart(): ModerationPart {
  const db = getDatabaseClient();
  /** The open report this reporter already holds on this target, if any. */
  async function openReport(
    tx: Client,
    input: {
      readonly conversationId: string;
      readonly messageId: string | null;
      readonly reporterAccountId: string;
    },
  ): Promise<string | null> {
    const row = await tx.messagingReport.findFirst({
      where: {
        reporterUserId: input.reporterAccountId,
        conversationId: input.conversationId,
        messageId: input.messageId,
        state: 'open',
      },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  return {
    /**
     * One active claim at a time (a filtered unique key): the previous
     * claimant's participation ends, and the new one's row returns or is
     * created — a support participant is the one role that may rejoin.
     */
    async claimSupport({ conversationId, staffAccountId, expectedVersion, audit }) {
      try {
        return await db.$transaction(async (tx): Promise<ClaimOutcome> => {
          const conversation = await lockConversation(tx, conversationId);
          if (
            conversation === null ||
            conversation.kind !== 'support' ||
            numberOf(conversation.disposing) !== 0 ||
            // The person asking can never staff their own conversation (51301).
            conversation.requesterUserId === staffAccountId
          )
            return 'missing';
          if (conversation.state !== 'open') return 'closed';
          if (conversation.version !== expectedVersion) return 'conflict';

          await tx.$executeRaw`
            UPDATE [dbo].[ConversationParticipant] SET [leftAt] = ${LEFT_NOW}
            WHERE [conversationId] = ${conversationId} AND [role] = N'support'
              AND [leftAt] IS NULL AND [userId] <> ${staffAccountId}`;
          const returned = await tx.$executeRaw`
            UPDATE [dbo].[ConversationParticipant]
            SET [joinedAt] = SYSUTCDATETIME(), [leftAt] = NULL
            WHERE [conversationId] = ${conversationId} AND [userId] = ${staffAccountId}
              AND [role] = N'support'`;
          if (returned === 0)
            await tx.conversationParticipant.create({
              data: {
                id: randomUUID(),
                conversationId,
                userId: staffAccountId,
                role: 'support',
              },
              select: { id: true },
            });
          await tx.$executeRaw`
            INSERT INTO [dbo].[MessageReadState] ([conversationId], [userId], [lastReadSequence])
            SELECT ${conversationId}, ${staffAccountId}, 0
            WHERE NOT EXISTS (
              SELECT 1 FROM [dbo].[MessageReadState] WITH (UPDLOCK, HOLDLOCK)
              WHERE [conversationId] = ${conversationId} AND [userId] = ${staffAccountId})`;
          const claimed = await tx.$executeRaw`
            UPDATE [dbo].[Conversation] SET [version] = [version] + 1
            WHERE [id] = ${conversationId} AND [version] = ${expectedVersion} AND [state] = N'open'`;
          // Under the lock the version cannot have moved; if it somehow did,
          // everything above rolls back rather than committing a half-claim.
          if (claimed !== 1) throw new ConflictSignal();
          await tx.auditLog.create({ data: auditRow(audit) });
          return 'claimed';
        }, LOCKED_TRANSACTION);
      } catch (error) {
        // A concurrent claim met the one-active-claim key first.
        if (error instanceof ConflictSignal || isUniqueViolation(error))
          return 'conflict';
        refuse(error);
      }
    },

    async resolveSupport({ conversationId, expectedVersion, audit }) {
      try {
        return await db.$transaction(async (tx): Promise<ResolveOutcome> => {
          const conversation = await lockConversation(tx, conversationId);
          if (
            conversation === null ||
            conversation.kind !== 'support' ||
            numberOf(conversation.disposing) !== 0
          )
            return 'missing';
          if (conversation.state !== 'open') return 'closed';
          if (conversation.version !== expectedVersion) return 'conflict';
          const resolved = await tx.$executeRaw`
            UPDATE [dbo].[Conversation]
            SET [state] = N'closed', [closedReason] = N'resolved', [closedAt] = SYSUTCDATETIME(),
                [version] = [version] + 1
            WHERE [id] = ${conversationId} AND [version] = ${expectedVersion} AND [state] = N'open'`;
          if (resolved !== 1) return 'conflict';
          await tx.auditLog.create({ data: auditRow(audit) });
          return 'resolved';
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * Filed at the conversation's CURRENT last sequence, which bounds the
     * evidence a moderator may later read. A second open report by the same
     * person on the same target is the first one (`duplicate`); a reporter who
     * is not a current participant, or a message of another conversation, is
     * `invalid` — the adapter asks, and the trigger (51308) and the composite
     * key are the floor.
     *
     * The conversation is taken with the UPDATE lock disposal's mark also
     * takes, so a report and the start of a disposal are strictly ordered: a
     * report either lands first — and the conversation is evidence, never
     * disposed — or meets the mark and is `invalid`.
     */
    async fileReport(input) {
      try {
        return await db.$transaction(async (tx): Promise<ReportOutcome> => {
          const [conversation] = await tx.$queryRaw<{ lastSequence: number }[]>`
            SELECT [lastSequence] FROM [dbo].[Conversation] WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
            WHERE [id] = ${input.conversationId} AND [disposingAt] IS NULL`;
          if (conversation === undefined) return { state: 'invalid' };
          if (input.messageId !== null) {
            const message = await tx.message.count({
              where: { id: input.messageId, conversationId: input.conversationId },
            });
            if (message === 0) return { state: 'invalid' };
          }
          const member = await tx.conversationParticipant.count({
            where: {
              conversationId: input.conversationId,
              userId: input.reporterAccountId,
              leftAt: null,
            },
          });
          if (member === 0) return { state: 'invalid' };
          const [existing] = await tx.$queryRaw<{ id: string }[]>`
            SELECT [id] FROM [dbo].[MessagingReport] WITH (UPDLOCK, HOLDLOCK)
            WHERE [reporterUserId] = ${input.reporterAccountId}
              AND [conversationId] = ${input.conversationId}
              AND ((${input.messageId} IS NULL AND [messageId] IS NULL) OR [messageId] = ${input.messageId})
              AND [state] = N'open'`;
          if (existing !== undefined)
            return { state: 'duplicate', reportId: existing.id };
          const reportId = randomUUID();
          await tx.$executeRaw`
            INSERT INTO [dbo].[MessagingReport]
              ([id], [conversationId], [messageId], [reporterUserId], [reason], [atSequence], [createdAt])
            VALUES (${reportId}, ${input.conversationId}, ${input.messageId}, ${input.reporterAccountId},
                    ${input.reason}, ${conversation.lastSequence}, ${NOW_MS})`;
          return { state: 'filed', reportId };
        }, LOCKED_TRANSACTION);
      } catch (error) {
        if (isUniqueViolation(error)) {
          const twin = await openReport(db, input);
          if (twin !== null) return { state: 'duplicate', reportId: twin };
        }
        if (refusalNumber(error) === 51308) return { state: 'invalid' };
        refuse(error);
      }
    },

    async reports({ state, after, limit }) {
      try {
        const rows = await db.$queryRaw<ReportRow[]>(
          reportQuery(
            Prisma.sql`r.[state] = ${state} AND ${afterReport(after)}`,
            bounded(limit),
          ),
        );
        return rows.map(toReportRecord);
      } catch (error) {
        refuse(error);
      }
    },

    async report(reportId) {
      try {
        const [row] = await db.$queryRaw<ReportRow[]>(
          reportQuery(Prisma.sql`r.[id] = ${reportId}`, 1),
        );
        return row === undefined ? null : toReportRecord(row);
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * One immutable decision on an OPEN report at its expected version, its
     * effect, the report's resolution and the audit row — one transaction.
     * Withholding needs a reported MESSAGE (51309 is the floor). Closing for
     * moderation closes an open conversation and leaves a closed one as it is.
     */
    async decide({ reportId, expectedVersion, moderatorAccountId, action, audit }) {
      try {
        return await db.$transaction(async (tx): Promise<DecisionOutcome> => {
          const [report] = await tx.$queryRaw<
            {
              state: string;
              version: number;
              conversationId: string;
              messageId: string | null;
            }[]
          >`
            SELECT [state], [version], [conversationId], [messageId]
            FROM [dbo].[MessagingReport] WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
            WHERE [id] = ${reportId}`;
          if (report === undefined) return 'missing';
          if (report.state !== 'open' || report.version !== expectedVersion)
            return 'conflict';
          if (action === 'withhold-message' && report.messageId === null)
            return 'invalid';

          await tx.messagingModerationDecision.create({
            data: {
              id: randomUUID(),
              reportId,
              moderatorUserId: moderatorAccountId,
              action,
            },
            select: { id: true },
          });
          if (action === 'withhold-message' && report.messageId !== null)
            await tx.$executeRaw`
              UPDATE [dbo].[Message]
              SET [moderation] = N'withheld', [withheldAt] = SYSUTCDATETIME()
              WHERE [id] = ${report.messageId} AND [conversationId] = ${report.conversationId}
                AND [moderation] = N'visible'`;
          if (action === 'close-conversation')
            await tx.$executeRaw`
              UPDATE [dbo].[Conversation]
              SET [state] = N'closed', [closedReason] = N'moderation', [closedAt] = SYSUTCDATETIME(),
                  [version] = [version] + 1
              WHERE [id] = ${report.conversationId} AND [state] = N'open'`;
          const resolved = await tx.$executeRaw`
            UPDATE [dbo].[MessagingReport]
            SET [state] = N'resolved', [resolvedAt] = SYSUTCDATETIME(), [version] = [version] + 1
            WHERE [id] = ${reportId} AND [state] = N'open' AND [version] = ${expectedVersion}`;
          if (resolved !== 1) throw new ConflictSignal();
          await tx.auditLog.create({ data: auditRow(audit) });
          return 'decided';
        }, LOCKED_TRANSACTION);
      } catch (error) {
        if (error instanceof ConflictSignal) return 'conflict';
        // A second decision on the same report (its unique key), or one on a
        // report that is no longer open (51309): the other moderator won.
        if (isUniqueViolation(error) || refusalNumber(error) === 51309) return 'conflict';
        refuse(error);
      }
    },
  };
}
