import 'server-only';

import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';

import {
  MESSAGING_CAPABILITIES,
  type ActivityCursor,
  type ConversationRecord,
  type MessagingAuthority,
  type MessagingCapability,
  type MessagingPersistencePort,
  type ReadingState,
} from '@minhaj/contracts/messaging';

import { getDatabaseClient } from '../../client.ts';
import {
  bounded,
  CONVERSATION_SELECT,
  isUniqueViolation,
  LIST_MAX,
  MessagingDataError,
  NOT_DISPOSING,
  numberOf,
  readsOf,
  refusalNumber,
  refuse,
  toConversationRecord,
} from './shared.ts';

/**
 * Conversations, their reading state, blocks and the support queue.
 *
 * MEMBERSHIP IS ONLY THE CANDIDATE SET. Every read here returns facts — who
 * holds which participant row, what the conversation's state is — and the
 * Messaging service re-decides each one from Learning's current relationship,
 * Identity's live keys and the activation on every request. Nothing here
 * answers "may this person read it".
 *
 * A CONVERSATION BEING DISPOSED IS GONE. Once its owner's disposition marked
 * it (`disposingAt`), no read here returns it: its messages are leaving in
 * batches, and a half-removed history is not something anyone reads.
 */

/** A conversation keyset: newest activity first, the id breaking ties. */
function afterActivity(after: ActivityCursor | null): Prisma.ConversationWhereInput {
  return after === null
    ? {}
    : {
        OR: [
          { activityAt: { lt: after.at } },
          { activityAt: after.at, id: { lt: after.id } },
        ],
      };
}

const NEWEST_ACTIVITY = [{ activityAt: 'desc' }, { id: 'desc' }] as const;

type ConversationPart = Pick<
  MessagingPersistencePort,
  | 'activations'
  | 'conversation'
  | 'conversationsOf'
  | 'openDirect'
  | 'openSupport'
  | 'readingStates'
  | 'blockState'
  | 'block'
  | 'unblock'
  | 'blocksBy'
  | 'supportQueue'
>;

export function conversationPart(): ConversationPart {
  const db = getDatabaseClient();
  /**
   * Creates a conversation with its participants and their read state at 0,
   * in ONE transaction — or, when its unique key says another call made it
   * first, answers with that one. `activityAt` and `createdAt` are the SAME
   * millisecond instant, so an empty conversation's keyset position is its
   * creation (`./shared.ts`, NOW_MS).
   */
  async function create(
    data: {
      readonly kind: string;
      readonly courseId: string | null;
      readonly lowUserId: string | null;
      readonly highUserId: string | null;
      readonly requesterUserId: string | null;
    },
    participants: readonly { readonly accountId: string; readonly role: string }[],
    existing: () => Promise<ConversationRecord | null>,
  ): Promise<{ readonly conversation: ConversationRecord; readonly created: boolean }> {
    const found = await existing();
    if (found !== null) return { conversation: found, created: false };
    const id = randomUUID();
    try {
      await db.$transaction(async (tx) => {
        const now = new Date();
        await tx.conversation.create({
          data: { id, ...data, createdAt: now, activityAt: now },
          select: { id: true },
        });
        for (const participant of participants)
          await tx.conversationParticipant.create({
            data: {
              id: randomUUID(),
              conversationId: id,
              userId: participant.accountId,
              role: participant.role,
            },
            select: { id: true },
          });
        await tx.messageReadState.createMany({
          data: participants.map((participant) => ({
            conversationId: id,
            userId: participant.accountId,
            lastReadSequence: 0,
          })),
        });
      });
    } catch (error) {
      // Two openings raced: the unique key let exactly one commit.
      if (isUniqueViolation(error)) {
        const twin = await existing();
        if (twin !== null) return { conversation: twin, created: false };
      }
      // The kind is not activated (51302): the service asks first; this is
      // the floor answering a race with the owner's own row.
      if (refusalNumber(error) === 51302) throw new MessagingDataError('not-activated');
      refuse(error);
    }
    const made = await readsOf(db).conversation(id);
    if (made === null) throw new MessagingDataError('conflict');
    return { conversation: made, created: true };
  }

  return {
    async activations() {
      try {
        const rows = await db.messagingActivation.findMany({
          select: { capability: true, authority: true },
        });
        const known = new Set<string>(MESSAGING_CAPABILITIES);
        const map = new Map<MessagingCapability, MessagingAuthority>();
        for (const row of rows) {
          if (!known.has(row.capability)) continue;
          // The CHECK admits two values; anything else fails closed to the
          // stricter reading.
          map.set(
            row.capability as MessagingCapability,
            row.authority === 'approved' ? 'approved' : 'fixture',
          );
        }
        return map;
      } catch (error) {
        refuse(error);
      }
    },

    async conversation(conversationId) {
      try {
        return await readsOf(db).conversation(conversationId);
      } catch (error) {
        refuse(error);
      }
    },

    async conversationsOf({ accountId, roles, after, limit }) {
      if (roles.length === 0) return [];
      try {
        const rows = await db.conversation.findMany({
          where: {
            ...NOT_DISPOSING,
            participants: {
              some: { userId: accountId, leftAt: null, role: { in: [...roles] } },
            },
            ...afterActivity(after),
          },
          select: CONVERSATION_SELECT,
          orderBy: [...NEWEST_ACTIVITY],
          take: bounded(limit),
        });
        return rows.map(toConversationRecord);
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * The pair is stored in BINARY order — the CHECK compares under
     * `Latin1_General_BIN2`, and an ordinal JavaScript comparison of two
     * identifiers is the same order — so either person opening it names the
     * same row.
     */
    async openDirect({ kind, courseId, first, second }) {
      if (first.accountId === second.accountId) throw new MessagingDataError('invalid');
      const [low, high] =
        first.accountId < second.accountId ? [first, second] : [second, first];
      const key = {
        kind,
        courseId,
        lowUserId: low.accountId,
        highUserId: high.accountId,
      };
      try {
        return await create(
          { ...key, requesterUserId: null },
          [first, second],
          async () => {
            const row = await db.conversation.findFirst({
              where: key,
              select: CONVERSATION_SELECT,
            });
            return row === null ? null : toConversationRecord(row);
          },
        );
      } catch (error) {
        refuse(error);
      }
    },

    async openSupport(requesterAccountId) {
      try {
        return await create(
          {
            kind: 'support',
            courseId: null,
            lowUserId: null,
            highUserId: null,
            requesterUserId: requesterAccountId,
          },
          [{ accountId: requesterAccountId, role: 'requester' }],
          async () => {
            const row = await db.conversation.findFirst({
              where: {
                kind: 'support',
                requesterUserId: requesterAccountId,
                state: 'open',
                ...NOT_DISPOSING,
              },
              select: CONVERSATION_SELECT,
            });
            return row === null ? null : toConversationRecord(row);
          },
        );
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * ONE statement for the whole page: each conversation's high-water mark
     * (0 without a row) and the count of OTHER people's messages after it,
     * counted on the conversation's own order key.
     */
    async readingStates(accountId, conversationIds) {
      const ids = [...new Set(conversationIds)].slice(0, LIST_MAX);
      const states = new Map<string, ReadingState>();
      if (ids.length === 0) return states;
      try {
        const rows = await db.$queryRaw<
          { conversationId: string; readSequence: number; unread: number | bigint }[]
        >`
          SELECT c.[id] AS [conversationId],
                 ISNULL(rs.[lastReadSequence], 0) AS [readSequence],
                 (SELECT COUNT(*) FROM [dbo].[Message] m
                   WHERE m.[conversationId] = c.[id]
                     AND m.[sequence] > ISNULL(rs.[lastReadSequence], 0)
                     AND m.[senderUserId] <> ${accountId}) AS [unread]
          FROM [dbo].[Conversation] c
          LEFT JOIN [dbo].[MessageReadState] rs
            ON rs.[conversationId] = c.[id] AND rs.[userId] = ${accountId}
          WHERE c.[id] IN (${Prisma.join(ids)})`;
        for (const row of rows)
          states.set(row.conversationId, {
            readSequence: numberOf(row.readSequence),
            unread: numberOf(row.unread),
          });
        return states;
      } catch (error) {
        refuse(error);
      }
    },

    async blockState(first, second) {
      try {
        const rows = await db.messagingBlock.findMany({
          where: {
            OR: [
              { blockerUserId: first, blockedUserId: second },
              { blockerUserId: second, blockedUserId: first },
            ],
          },
          select: { blockerUserId: true },
        });
        return {
          firstBlockedSecond: rows.some((row) => row.blockerUserId === first),
          secondBlockedFirst: rows.some((row) => row.blockerUserId === second),
        };
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * Idempotent. The existence check holds a key-range lock to commit, so a
     * concurrent send's own locked block read (`append`) is ordered against it
     * — the send either commits before the block or sees it.
     */
    async block(blockerAccountId, blockedAccountId) {
      if (blockerAccountId === blockedAccountId) throw new MessagingDataError('invalid');
      try {
        await db.$executeRaw`
          INSERT INTO [dbo].[MessagingBlock] ([blockerUserId], [blockedUserId])
          SELECT ${blockerAccountId}, ${blockedAccountId}
          WHERE NOT EXISTS (
            SELECT 1 FROM [dbo].[MessagingBlock] WITH (UPDLOCK, HOLDLOCK)
            WHERE [blockerUserId] = ${blockerAccountId} AND [blockedUserId] = ${blockedAccountId})`;
      } catch (error) {
        if (isUniqueViolation(error)) return;
        refuse(error);
      }
    },

    async unblock(blockerAccountId, blockedAccountId) {
      try {
        await db.messagingBlock.deleteMany({
          where: { blockerUserId: blockerAccountId, blockedUserId: blockedAccountId },
        });
      } catch (error) {
        refuse(error);
      }
    },

    async blocksBy(blockerAccountId, limit) {
      try {
        const rows = await db.messagingBlock.findMany({
          where: { blockerUserId: blockerAccountId },
          select: { blockedUserId: true, createdAt: true },
          orderBy: [{ createdAt: 'desc' }, { blockedUserId: 'asc' }],
          take: bounded(limit),
        });
        return rows.map((row) => ({
          blockedAccountId: row.blockedUserId,
          createdAt: row.createdAt,
        }));
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * The queue is METADATA: the conversations and whether their last message
     * came from the person asking. Two queries for a page — the conversations
     * with their participants, then each one's last message's sender — never
     * one per row, and never a body.
     */
    async supportQueue({ state, after, limit }) {
      try {
        const rows = await db.conversation.findMany({
          where: { kind: 'support', state, ...NOT_DISPOSING, ...afterActivity(after) },
          select: { ...CONVERSATION_SELECT, requesterUserId: true },
          orderBy: [...NEWEST_ACTIVITY],
          take: bounded(limit),
        });
        const withMessages = rows.filter((row) => row.lastSequence > 0);
        const last =
          withMessages.length === 0
            ? []
            : await db.message.findMany({
                where: {
                  OR: withMessages.map((row) => ({
                    conversationId: row.id,
                    sequence: row.lastSequence,
                  })),
                },
                select: { conversationId: true, senderUserId: true },
              });
        const lastSender = new Map(
          last.map((row) => [row.conversationId, row.senderUserId]),
        );
        return rows.map((row) => ({
          conversation: toConversationRecord(row),
          awaitingReply:
            row.requesterUserId !== null &&
            lastSender.get(row.id) === row.requesterUserId,
        }));
      } catch (error) {
        refuse(error);
      }
    },
  };
}
