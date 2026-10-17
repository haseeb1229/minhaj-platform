import 'server-only';

import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';

import {
  MESSAGING_LIMITS,
  type AppendOutcome,
  type AttachmentFact,
  type MessagingPersistencePort,
} from '@minhaj/contracts/messaging';

import { getDatabaseClient } from '../../client.ts';
import {
  bounded,
  isUniqueViolation,
  LIST_MAX,
  LOCKED_TRANSACTION,
  MessagingDataError,
  NOW_MS,
  numberOf,
  readsOf,
  refusalNumber,
  refuse,
} from './shared.ts';

/**
 * Messages: bounded history, catch-up, evidence spans, the one append and the
 * reader's high-water mark.
 *
 * ORDER IS ALLOCATED UNDER THE CONVERSATION'S LOCK. `append` takes the
 * Conversation row with `UPDLOCK, HOLDLOCK` before anything else, so two sends
 * to one conversation are strictly serialised: each reads `lastSequence`,
 * moves it on by one and inserts at exactly that position — the trigger
 * (51303) refuses any other — and a retried send meets the first attempt's
 * message under the same lock. Every refusal is re-proved under that lock,
 * after the service's own checks, so a block, a closure or a departure that
 * races a send either commits first and wins or waits for the send to commit.
 */

type MessagePart = Pick<
  MessagingPersistencePort,
  'history' | 'after' | 'span' | 'append' | 'markRead'
>;

export function messagePart(): MessagePart {
  const db = getDatabaseClient();
  /** A replayed operation is the existing message; a different payload never touches it. */
  async function replay(input: {
    readonly conversationId: string;
    readonly senderAccountId: string;
    readonly operationId: string;
    readonly payloadDigest: string;
  }): Promise<AppendOutcome | null> {
    const prior = await readsOf(db).byOperation(input);
    if (prior === null) return null;
    return prior.payloadDigest === input.payloadDigest
      ? { state: 'replayed', message: prior.message }
      : { state: 'conflict' };
  }

  return {
    async history({ conversationId, before, limit }) {
      try {
        return await readsOf(db).messages(
          { conversationId, ...(before === null ? {} : { sequence: { lt: before } }) },
          'desc',
          bounded(limit),
        );
      } catch (error) {
        refuse(error);
      }
    },

    async after({ conversationId, after, limit }) {
      try {
        return await readsOf(db).messages(
          { conversationId, sequence: { gt: after } },
          'asc',
          bounded(limit),
        );
      } catch (error) {
        refuse(error);
      }
    },

    /** The caller bounds the span; the adapter caps it again. */
    async span({ conversationId, from, to }) {
      if (to < from) return [];
      try {
        return await readsOf(db).messages(
          { conversationId, sequence: { gte: from, lte: to } },
          'asc',
          LIST_MAX,
        );
      } catch (error) {
        refuse(error);
      }
    },

    async append(input) {
      const { conversationId, senderAccountId: sender } = input;
      const ids = [...input.attachmentIds];
      try {
        return await db.$transaction(async (tx): Promise<AppendOutcome> => {
          const [conversation] = await tx.$queryRaw<
            { state: string; disposing: number; lastSequence: number }[]
          >`
            SELECT [state], CASE WHEN [disposingAt] IS NULL THEN 0 ELSE 1 END AS [disposing],
                   [lastSequence]
            FROM [dbo].[Conversation] WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
            WHERE [id] = ${conversationId}`;
          // No such conversation: nobody is its participant.
          if (conversation === undefined) return { state: 'not-participant' };

          // Replay FIRST: a retry of a send that committed answers with that
          // message even if the conversation has closed since.
          const prior = await readsOf(tx).byOperation(input);
          if (prior !== null)
            return prior.payloadDigest === input.payloadDigest
              ? { state: 'replayed', message: prior.message }
              : { state: 'conflict' };

          if (conversation.state !== 'open' || numberOf(conversation.disposing) !== 0)
            return { state: 'closed' };

          // The sender's participation, locked so a concurrent departure
          // (withdrawal, an ended claim) waits for this send or wins first.
          const [participation] = await tx.$queryRaw<{ total: number }[]>`
            SELECT COUNT(*) AS [total]
            FROM [dbo].[ConversationParticipant] WITH (UPDLOCK, HOLDLOCK)
            WHERE [conversationId] = ${conversationId} AND [userId] = ${sender}
              AND [leftAt] IS NULL`;
          if (numberOf(participation?.total ?? 0) === 0)
            return { state: 'not-participant' };

          if (input.blockPair !== null) {
            const [first, second] = input.blockPair;
            // Key-range locks on BOTH directions: a block inserted concurrently
            // waits for this send to commit, or this send waits and sees it.
            const [blocks] = await tx.$queryRaw<{ total: number }[]>`
              SELECT COUNT(*) AS [total]
              FROM [dbo].[MessagingBlock] WITH (UPDLOCK, HOLDLOCK)
              WHERE ([blockerUserId] = ${first} AND [blockedUserId] = ${second})
                 OR ([blockerUserId] = ${second} AND [blockedUserId] = ${first})`;
            if (numberOf(blocks?.total ?? 0) > 0) return { state: 'blocked' };
          }

          const facts: AttachmentFact[] = [];
          if (ids.length > 0) {
            if (
              new Set(ids).size !== ids.length ||
              ids.length > MESSAGING_LIMITS.attachmentsPerMessage
            )
              return { state: 'attachment-unavailable' };
            // Each must be the SENDER's own `ready` upload in THIS conversation.
            const ready = await tx.$queryRaw<
              {
                id: string;
                mediaType: string;
                byteSize: number | bigint | string;
                displayName: string | null;
              }[]
            >`
              SELECT [id], [mediaType], [byteSize], [displayName]
              FROM [dbo].[MessageAttachment] WITH (UPDLOCK, HOLDLOCK)
              WHERE [id] IN (${Prisma.join(ids)})
                AND [conversationId] = ${conversationId}
                AND [uploaderUserId] = ${sender}
                AND [state] = N'ready'`;
            if (ready.length !== ids.length) return { state: 'attachment-unavailable' };
            const byId = new Map(ready.map((row) => [row.id, row]));
            for (const [position, id] of ids.entries()) {
              const row = byId.get(id);
              if (row === undefined) return { state: 'attachment-unavailable' };
              facts.push({
                id,
                mediaType: row.mediaType,
                byteSize: numberOf(row.byteSize),
                displayName: row.displayName,
                position,
              });
            }
          }

          // Allocate, then write at exactly the allocated position. The
          // version is NOT moved: it guards claims and resolutions, and a
          // message must not make a staff member's claim stale.
          const sequence = conversation.lastSequence + 1;
          await tx.$executeRaw`
            UPDATE [dbo].[Conversation]
            SET [lastSequence] = ${sequence}, [activityAt] = ${NOW_MS}
            WHERE [id] = ${conversationId} AND [lastSequence] = ${conversation.lastSequence}`;
          const message = await tx.message.create({
            data: {
              id: randomUUID(),
              conversationId,
              sequence,
              senderUserId: sender,
              operationId: input.operationId,
              body: input.body,
              payloadDigest: input.payloadDigest,
            },
            select: { id: true, sentAt: true },
          });

          for (const fact of facts) {
            const moved = await tx.$executeRaw`
              UPDATE [dbo].[MessageAttachment]
              SET [state] = N'attached', [messageId] = ${message.id},
                  [position] = ${fact.position}, [attachedAt] = SYSUTCDATETIME()
              WHERE [id] = ${fact.id} AND [state] = N'ready'`;
            if (moved !== 1) throw new MessagingDataError('attachment-unavailable');
          }

          // The sender has read their own message.
          await tx.$executeRaw`
            UPDATE [dbo].[MessageReadState]
            SET [lastReadSequence] = ${sequence}, [updatedAt] = SYSUTCDATETIME()
            WHERE [conversationId] = ${conversationId} AND [userId] = ${sender}
              AND [lastReadSequence] < ${sequence};
            IF NOT EXISTS (
              SELECT 1 FROM [dbo].[MessageReadState]
              WHERE [conversationId] = ${conversationId} AND [userId] = ${sender})
              INSERT INTO [dbo].[MessageReadState] ([conversationId], [userId], [lastReadSequence])
              VALUES (${conversationId}, ${sender}, ${sequence});`;

          return {
            state: 'created',
            message: {
              id: message.id,
              conversationId,
              sequence,
              senderAccountId: sender,
              body: input.body,
              moderation: 'visible',
              sentAt: message.sentAt,
              attachments: facts,
            },
          };
        }, LOCKED_TRANSACTION);
      } catch (error) {
        if (
          error instanceof MessagingDataError &&
          error.reason === 'attachment-unavailable'
        )
          return { state: 'attachment-unavailable' };
        // A racing retry of the same operation committed first: the operation
        // key answers, by re-reading, never by an error.
        if (isUniqueViolation(error)) {
          const twin = await replay(input);
          if (twin !== null) return twin;
        }
        switch (refusalNumber(error)) {
          case 51303:
            return { state: 'closed' };
          case 51306:
            return { state: 'attachment-unavailable' };
          case 51301:
            return { state: 'not-participant' };
          default:
            refuse(error);
        }
      }
    },

    /**
     * Raises the high-water mark, clamped to the conversation's last message
     * and never lowered (the trigger, 51307, is the floor). The existence
     * check holds its key-range lock to commit, so two concurrent first reads
     * cannot both insert. A reader with no participant row gets no row.
     */
    async markRead({ conversationId, accountId, sequence }) {
      try {
        return await db.$transaction(async (tx) => {
          const conversation = await tx.conversation.findUnique({
            where: { id: conversationId },
            select: { lastSequence: true },
          });
          if (conversation === null) return 0;
          const target = Math.max(
            0,
            Math.min(Math.trunc(sequence) || 0, conversation.lastSequence),
          );
          const [current] = await tx.$queryRaw<{ lastReadSequence: number }[]>`
            SELECT [lastReadSequence] FROM [dbo].[MessageReadState] WITH (UPDLOCK, HOLDLOCK)
            WHERE [conversationId] = ${conversationId} AND [userId] = ${accountId}`;
          if (current !== undefined) {
            if (target <= current.lastReadSequence) return current.lastReadSequence;
            await tx.$executeRaw`
              UPDATE [dbo].[MessageReadState]
              SET [lastReadSequence] = ${target}, [updatedAt] = SYSUTCDATETIME()
              WHERE [conversationId] = ${conversationId} AND [userId] = ${accountId}
                AND [lastReadSequence] < ${target}`;
            return target;
          }
          const member = await tx.conversationParticipant.count({
            where: { conversationId, userId: accountId },
          });
          if (member === 0) return 0;
          await tx.messageReadState.create({
            data: { conversationId, userId: accountId, lastReadSequence: target },
            select: { lastReadSequence: true },
          });
          return target;
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },
  };
}
