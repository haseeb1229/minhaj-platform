import 'server-only';

import type {
  ConversationClosedReason,
  ConversationKind,
  ConversationState,
  MessagingPersistencePort,
  ParticipantRole,
  ReportReason,
  ReportState,
} from '@minhaj/contracts/messaging';

import { getDatabaseClient } from '../../client.ts';
import {
  bounded,
  LEFT_NOW,
  LOCKED_TRANSACTION,
  MessagingDataError,
  numberOf,
  refuse,
  type Client,
} from './shared.ts';

/**
 * A person's export, and the owner's disposition of a CLOSED account's
 * Messaging state (DOMAIN_MODEL.md §15.6; design G).
 *
 * NOTHING HERE DECIDES THAT AN ACCOUNT IS CLOSED. Identity answers that, and
 * the service asks it before every call here; this adapter reads or changes
 * exactly the rows the account holds.
 *
 * THE EXPORT IS THE PERSON'S OWN. Their participation, the messages THEY sent
 * with their text, their uploads' metadata (never bytes), their read state,
 * the blocks they made and the reports they filed — in fixed orders, so two
 * exports of unchanged data are identical. No other person's message is read,
 * even in a conversation they shared.
 *
 * DISPOSITION IS BOUNDED, IDEMPOTENT AND RESUMABLE, in two movements:
 *
 *   1. WITHDRAWAL — the account's open conversations close as
 *      `account-closed`, its participation ends, its read state and blocks go
 *      and its unsent uploads are owed a release. The history stays: the other
 *      person keeps reading it under the terminal rule.
 *   2. REMOVAL — a conversation every other party has also left (the service
 *      decides from Identity) is MARKED, its attachments owed releases, and
 *      then removed in batches: read state and messages first, the
 *      participants and the conversation last, once no attachment row is left.
 *
 * A REPORTED CONVERSATION IS EVIDENCE and is never marked or removed here; the
 * report holds it until its legal retention is decided (OPEN_DECISIONS.md
 * §2.2). Every statement is bounded, and the rows themselves are the pending
 * work an interrupted call leaves for the next.
 */

/** The most rows one disposition statement touches. */
const DISPOSAL_MAX = 1_000;

/** Every attachment of a conversation being disposed is owed its release. */
async function releaseAll(
  tx: Client,
  conversationId: string,
  limit: number | null,
): Promise<number> {
  return limit === null
    ? tx.$executeRaw`
        UPDATE [dbo].[MessageAttachment]
        SET [state] = N'releasing', [assetId] = NULL, [messageId] = NULL, [position] = NULL
        WHERE [conversationId] = ${conversationId} AND [state] <> N'releasing'`
    : tx.$executeRaw`
        UPDATE TOP (${limit}) [dbo].[MessageAttachment]
        SET [state] = N'releasing', [assetId] = NULL, [messageId] = NULL, [position] = NULL
        WHERE [conversationId] = ${conversationId} AND [state] <> N'releasing'`;
}

/**
 * The conversation under the update lock, with whether it is marked and
 * whether any report names it — the report read takes key-range locks, so a
 * report and a mark are strictly ordered (`fileReport` takes the same row).
 */
async function lockForDisposal(
  tx: Client,
  conversationId: string,
): Promise<{
  readonly state: string;
  readonly disposing: boolean;
  readonly evidence: boolean;
} | null> {
  const [row] = await tx.$queryRaw<
    { state: string; disposing: number; evidence: number }[]
  >`
    SELECT c.[state],
           CASE WHEN c.[disposingAt] IS NULL THEN 0 ELSE 1 END AS [disposing],
           CASE WHEN EXISTS (
             SELECT 1 FROM [dbo].[MessagingReport] r WITH (UPDLOCK, HOLDLOCK)
             WHERE r.[conversationId] = c.[id]) THEN 1 ELSE 0 END AS [evidence]
    FROM [dbo].[Conversation] c WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
    WHERE c.[id] = ${conversationId}`;
  return row === undefined
    ? null
    : {
        state: row.state,
        disposing: numberOf(row.disposing) === 1,
        evidence: numberOf(row.evidence) === 1,
      };
}

type DispositionPart = Pick<
  MessagingPersistencePort,
  | 'exportFor'
  | 'accountsWithData'
  | 'withdrawAccount'
  | 'disposalCandidates'
  | 'beginDisposal'
  | 'disposing'
  | 'disposeStep'
>;

export function dispositionPart(): DispositionPart {
  const db = getDatabaseClient();
  return {
    async exportFor(accountId) {
      try {
        const [participation, messages, attachments, blocks, reports] = await Promise.all(
          [
            db.conversationParticipant.findMany({
              where: { userId: accountId },
              select: {
                role: true,
                joinedAt: true,
                leftAt: true,
                conversation: {
                  select: {
                    id: true,
                    kind: true,
                    courseId: true,
                    state: true,
                    closedReason: true,
                  },
                },
                readState: { select: { lastReadSequence: true } },
              },
              orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
            }),
            // ONLY the account's own messages: the sender is the predicate.
            db.message.findMany({
              where: { senderUserId: accountId },
              select: {
                id: true,
                conversationId: true,
                sequence: true,
                body: true,
                moderation: true,
                sentAt: true,
              },
              orderBy: [{ conversationId: 'asc' }, { sequence: 'asc' }],
            }),
            db.messageAttachment.findMany({
              where: { uploaderUserId: accountId },
              select: {
                id: true,
                conversationId: true,
                messageId: true,
                mediaType: true,
                byteSize: true,
                displayName: true,
                createdAt: true,
              },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            }),
            db.messagingBlock.findMany({
              where: { blockerUserId: accountId },
              select: { blockedUserId: true, createdAt: true },
              orderBy: [{ createdAt: 'asc' }, { blockedUserId: 'asc' }],
            }),
            db.messagingReport.findMany({
              where: { reporterUserId: accountId },
              select: {
                id: true,
                conversationId: true,
                messageId: true,
                reason: true,
                state: true,
                createdAt: true,
              },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            }),
          ],
        );
        return {
          conversations: participation.map((row) => ({
            id: row.conversation.id,
            kind: row.conversation.kind as ConversationKind,
            courseId: row.conversation.courseId,
            role: row.role as ParticipantRole,
            state: row.conversation.state as ConversationState,
            closedReason: row.conversation
              .closedReason as ConversationClosedReason | null,
            joinedAt: row.joinedAt.toISOString(),
            leftAt: row.leftAt === null ? null : row.leftAt.toISOString(),
            lastReadSequence: row.readState?.lastReadSequence ?? 0,
          })),
          messages: messages.map((row) => ({
            id: row.id,
            conversationId: row.conversationId,
            sequence: row.sequence,
            body: row.body,
            withheld: row.moderation === 'withheld',
            sentAt: row.sentAt.toISOString(),
          })),
          attachments: attachments.map((row) => ({
            id: row.id,
            conversationId: row.conversationId,
            messageId: row.messageId,
            mediaType: row.mediaType,
            byteSize: row.byteSize === null ? null : Number(row.byteSize),
            displayName: row.displayName,
            createdAt: row.createdAt.toISOString(),
          })),
          blocks: blocks.map((row) => ({
            blockedAccountId: row.blockedUserId,
            createdAt: row.createdAt.toISOString(),
          })),
          reports: reports.map((row) => ({
            id: row.id,
            conversationId: row.conversationId,
            messageId: row.messageId,
            reason: row.reason as ReportReason,
            state: row.state as ReportState,
            createdAt: row.createdAt.toISOString(),
          })),
        };
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * Accounts holding LIVE Messaging state: a current participation, a read
     * state, a block either way, or an unsent upload. A left participation in
     * a conversation that remains is history, not live state: it is reached
     * through the other party's own disposition.
     */
    async accountsWithData(after, limit) {
      try {
        const rows = await db.$queryRaw<{ userId: string }[]>`
          SELECT TOP (${bounded(limit, DISPOSAL_MAX)}) [userId] FROM (
            SELECT [userId] FROM [dbo].[ConversationParticipant] WHERE [leftAt] IS NULL
            UNION SELECT [userId] FROM [dbo].[MessageReadState]
            UNION SELECT [blockerUserId] FROM [dbo].[MessagingBlock]
            UNION SELECT [blockedUserId] FROM [dbo].[MessagingBlock]
            UNION SELECT [uploaderUserId] FROM [dbo].[MessageAttachment]
              WHERE [state] IN (N'pending', N'ready')
          ) AS [owners]
          WHERE ${after} IS NULL OR [userId] > ${after}
          ORDER BY [userId]`;
        return rows.map((row) => row.userId);
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * One bounded transaction, in the lock order `append` uses (conversation,
     * then participation), so a send racing a closure either commits first or
     * meets the closed conversation.
     */
    async withdrawAccount(accountId, limit) {
      try {
        return await db.$transaction(async (tx) => {
          let remaining = bounded(limit, DISPOSAL_MAX);
          let changed = 0;
          const step = async (
            act: (budget: number) => Promise<number>,
          ): Promise<void> => {
            if (remaining <= 0) return;
            const count = await act(remaining);
            changed += count;
            remaining -= count;
          };

          // Its open DIRECT conversations, and the support conversations it
          // asked in, close as `account-closed` — the one reason that creates
          // the other person's terminal-history rule.
          await step(
            (budget) => tx.$executeRaw`
              UPDATE TOP (${budget}) [dbo].[Conversation]
              SET [state] = N'closed', [closedReason] = N'account-closed',
                  [closedAt] = SYSUTCDATETIME(), [version] = [version] + 1
              WHERE [state] = N'open' AND [kind] <> N'support'
                AND ([lowUserId] = ${accountId} OR [highUserId] = ${accountId})`,
          );
          await step(
            (budget) => tx.$executeRaw`
              UPDATE TOP (${budget}) [dbo].[Conversation]
              SET [state] = N'closed', [closedReason] = N'account-closed',
                  [closedAt] = SYSUTCDATETIME(), [version] = [version] + 1
              WHERE [state] = N'open' AND [kind] = N'support'
                AND [requesterUserId] = ${accountId}`,
          );
          // Every current participation ends — a support claim included, which
          // unclaims the conversation without closing it.
          await step(
            (budget) => tx.$executeRaw`
              UPDATE TOP (${budget}) [dbo].[ConversationParticipant]
              SET [leftAt] = ${LEFT_NOW}
              WHERE [userId] = ${accountId} AND [leftAt] IS NULL`,
          );
          await step(
            (budget) => tx.$executeRaw`
              DELETE TOP (${budget}) FROM [dbo].[MessageReadState] WHERE [userId] = ${accountId}`,
          );
          await step(
            (budget) => tx.$executeRaw`
              DELETE TOP (${budget}) FROM [dbo].[MessagingBlock]
              WHERE [blockerUserId] = ${accountId} OR [blockedUserId] = ${accountId}`,
          );
          await step(
            (budget) => tx.$executeRaw`
              UPDATE TOP (${budget}) [dbo].[MessageAttachment]
              SET [state] = N'releasing', [assetId] = NULL, [messageId] = NULL, [position] = NULL
              WHERE [uploaderUserId] = ${accountId} AND [state] IN (N'pending', N'ready')`,
          );
          return changed;
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * Closed conversations the account took part in that are not yet marked
     * and that NO teacher, learner, peer or requester still holds (every one
     * has left — a living counterpart retains it), in id order strictly after `after` — a keyset, so an account with many
     * retained (reported, or still shared) conversations is walked to its end
     * rather than re-read. `otherAccountIds` is the other person of a direct
     * conversation, or the person asking in a support one — whose closure is
     * what lets it go.
     */
    async disposalCandidates(accountId, after, limit) {
      try {
        const rows = await db.$queryRaw<
          {
            id: string;
            kind: string;
            lowUserId: string | null;
            highUserId: string | null;
            requesterUserId: string | null;
            evidence: number;
          }[]
        >`
          SELECT TOP (${bounded(limit)}) c.[id], c.[kind], c.[lowUserId], c.[highUserId],
                 c.[requesterUserId],
                 CASE WHEN EXISTS (
                   SELECT 1 FROM [dbo].[MessagingReport] r WHERE r.[conversationId] = c.[id])
                   THEN 1 ELSE 0 END AS [evidence]
          FROM [dbo].[Conversation] c
          WHERE c.[disposingAt] IS NULL AND c.[state] = N'closed'
            AND EXISTS (
              SELECT 1 FROM [dbo].[ConversationParticipant] p
              WHERE p.[conversationId] = c.[id] AND p.[userId] = ${accountId})
            -- Retained while anyone it is between still holds it: no
            -- non-support participant may be current.
            AND NOT EXISTS (
              SELECT 1 FROM [dbo].[ConversationParticipant] q
              WHERE q.[conversationId] = c.[id] AND q.[role] <> N'support'
                AND q.[leftAt] IS NULL)
            AND (${after} IS NULL OR c.[id] > ${after})
          ORDER BY c.[id] ASC`;
        return rows.map((row) => ({
          conversationId: row.id,
          kind: row.kind as ConversationKind,
          otherAccountIds:
            row.kind === 'support'
              ? row.requesterUserId === null
                ? []
                : [row.requesterUserId]
              : [row.lowUserId, row.highUserId].filter(
                  (id): id is string => id !== null && id !== accountId,
                ),
          evidence: numberOf(row.evidence) === 1,
        }));
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * Marks a CLOSED, unreported conversation and owes every attachment of it
     * a release. Idempotent: a marked one only has any attachment still not
     * releasing moved again. A reported one is left exactly as it is — it is
     * evidence. That is an ANSWER, not a failure: a participant who has not
     * left (a support claimant) may file a report between the candidate read
     * and this lock, and the report winning the lock is precisely what keeps
     * the conversation. `fileReport` refuses a marked conversation, so a
     * report can never arrive after the mark.
     */
    async beginDisposal(conversationId) {
      try {
        await db.$transaction(async (tx) => {
          const conversation = await lockForDisposal(tx, conversationId);
          if (conversation === null || conversation.evidence) return;
          if (conversation.state !== 'closed') throw new MessagingDataError('open');
          if (!conversation.disposing)
            await tx.$executeRaw`
              UPDATE [dbo].[Conversation] SET [disposingAt] = SYSUTCDATETIME()
              WHERE [id] = ${conversationId} AND [disposingAt] IS NULL`;
          await releaseAll(tx, conversationId, null);
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    async disposing(limit) {
      try {
        const rows = await db.conversation.findMany({
          where: { disposingAt: { not: null } },
          select: { id: true },
          orderBy: [{ disposingAt: 'asc' }, { id: 'asc' }],
          take: bounded(limit),
        });
        return rows.map((row) => row.id);
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * One bounded step. Read state and messages go in batches (a message no
     * attachment row names — every one was moved to `releasing`, which names
     * none); once both are gone the step waits while any attachment row is
     * still owed a release, then removes the participants and the
     * conversation. A missing conversation is already `removed`.
     */
    async disposeStep(conversationId, limit) {
      const size = bounded(limit, DISPOSAL_MAX);
      try {
        return await db.$transaction(async (tx) => {
          const conversation = await lockForDisposal(tx, conversationId);
          if (conversation === null) return 'removed' as const;
          if (conversation.evidence) throw new MessagingDataError('evidence');
          if (!conversation.disposing) throw new MessagingDataError('not-disposing');

          let removed = await releaseAll(tx, conversationId, size);
          removed += await tx.$executeRaw`
            DELETE TOP (${size}) FROM [dbo].[MessageReadState]
            WHERE [conversationId] = ${conversationId}`;
          removed += await tx.$executeRaw`
            DELETE TOP (${size}) FROM [dbo].[Message]
            WHERE [conversationId] = ${conversationId}
              AND NOT EXISTS (
                SELECT 1 FROM [dbo].[MessageAttachment] a WHERE a.[messageId] = [Message].[id])`;
          if (removed > 0) return 'progress' as const;

          const attachmentsLeft = await tx.messageAttachment.count({
            where: { conversationId },
          });
          const messagesLeft = await tx.message.count({ where: { conversationId } });
          if (attachmentsLeft > 0 || messagesLeft > 0) return 'awaiting-release' as const;

          await tx.conversationParticipant.deleteMany({ where: { conversationId } });
          await tx.conversation.deleteMany({ where: { id: conversationId } });
          return 'removed' as const;
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },
  };
}
