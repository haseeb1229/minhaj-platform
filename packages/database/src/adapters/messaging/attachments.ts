import 'server-only';

import { randomUUID } from 'node:crypto';

import {
  MESSAGING_ATTACHMENT_TYPES,
  MESSAGING_LIMITS,
  type AttachmentState,
  type MessageModerationState,
  type MessagingPersistencePort,
  type PendingRelease,
} from '@minhaj/contracts/messaging';

import { getDatabaseClient } from '../../client.ts';
import {
  bounded,
  dateOf,
  LOCKED_TRANSACTION,
  MessagingDataError,
  numberOf,
  refuse,
} from './shared.ts';

/**
 * Attachments: recorded BEFORE their bytes are stored, ready once Storage
 * cleared them, attached by `append`, and otherwise only released.
 *
 * THE RELEASE TOKEN IS THE CUSTODY. Each row carries the secret its asset was
 * stored under (`StorageServicePort.release`); it is written once, never
 * changes (51306) and leaves this adapter only as a `PendingRelease` the
 * service hands straight to Storage. A row moves to `releasing` — its asset,
 * message and position cleared — in Messaging's own transaction BEFORE Storage
 * is asked, so the asset's foreign key never stands in the way of its release,
 * and the row itself is the durable record that a release is still owed.
 */

const UNSENT = ['pending', 'ready'] as const;

type AttachmentPart = Pick<
  MessagingPersistencePort,
  | 'prepareAttachment'
  | 'recordAttachment'
  | 'abandonAttachment'
  | 'attachment'
  | 'releaseQueue'
  | 'forgetAttachment'
>;

export function attachmentPart(): AttachmentPart {
  const db = getDatabaseClient();
  return {
    /**
     * Under the conversation's update lock — the one `append` takes — so two
     * uploads by the same person cannot both pass the count, and a disposal
     * cannot mark the conversation between the check and the insert.
     */
    async prepareAttachment({ conversationId, uploaderAccountId, releaseToken, limit }) {
      try {
        return await db.$transaction(async (tx) => {
          const [conversation] = await tx.$queryRaw<{ open: number }[]>`
            SELECT CASE WHEN [state] = N'open' AND [disposingAt] IS NULL THEN 1 ELSE 0 END AS [open]
            FROM [dbo].[Conversation] WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
            WHERE [id] = ${conversationId}`;
          if (conversation === undefined || numberOf(conversation.open) !== 1)
            throw new MessagingDataError('closed');
          const unsent = await tx.messageAttachment.count({
            where: {
              conversationId,
              uploaderUserId: uploaderAccountId,
              state: { in: [...UNSENT] },
            },
          });
          if (unsent >= Math.max(0, Math.trunc(limit)))
            return { state: 'too-many' as const };
          const attachmentId = randomUUID();
          await tx.messageAttachment.create({
            data: {
              id: attachmentId,
              conversationId,
              uploaderUserId: uploaderAccountId,
              releaseToken,
              state: 'pending',
            },
            select: { id: true },
          });
          return { state: 'prepared' as const, attachmentId };
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * `pending` → `ready` with what STORAGE measured. Only a format Messaging
     * admits and a size within its bound is recorded; anything else answers
     * `false` (the caller then releases it), rather than meeting the CHECK.
     */
    async recordAttachment(input) {
      if (
        !(MESSAGING_ATTACHMENT_TYPES as readonly string[]).includes(input.mediaType) ||
        !Number.isInteger(input.byteSize) ||
        input.byteSize < 1 ||
        input.byteSize > MESSAGING_LIMITS.attachmentMaxBytes
      )
        return false;
      try {
        const { count } = await db.messageAttachment.updateMany({
          where: {
            id: input.attachmentId,
            uploaderUserId: input.uploaderAccountId,
            state: 'pending',
          },
          data: {
            state: 'ready',
            assetId: input.assetId,
            mediaType: input.mediaType,
            byteSize: BigInt(input.byteSize),
            displayName: input.displayName,
          },
        });
        return count === 1;
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * An unsent upload → `releasing`. A row ALREADY releasing answers with its
     * release again, so a discard interrupted after this step completes on
     * retry; an attached one — or none — answers `null`.
     */
    async abandonAttachment(attachmentId) {
      try {
        return await db.$transaction(async (tx): Promise<PendingRelease | null> => {
          const [row] = await tx.$queryRaw<{ state: string; releaseToken: string }[]>`
            SELECT [state], [releaseToken] FROM [dbo].[MessageAttachment] WITH (UPDLOCK, HOLDLOCK)
            WHERE [id] = ${attachmentId}`;
          if (row === undefined) return null;
          if (row.state === 'releasing')
            return { attachmentId, releaseToken: row.releaseToken };
          if (row.state !== 'pending' && row.state !== 'ready') return null;
          await tx.$executeRaw`
            UPDATE [dbo].[MessageAttachment]
            SET [state] = N'releasing', [assetId] = NULL, [messageId] = NULL, [position] = NULL
            WHERE [id] = ${attachmentId} AND [state] IN (N'pending', N'ready')`;
          return { attachmentId, releaseToken: row.releaseToken };
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    async attachment(attachmentId) {
      try {
        const [row] = await db.$queryRaw<
          {
            id: string;
            conversationId: string;
            uploaderUserId: string;
            state: string;
            messageId: string | null;
            assetId: string | null;
            mediaType: string | null;
            byteSize: number | bigint | string | null;
            displayName: string | null;
            createdAt: Date | string;
            messageModeration: string | null;
          }[]
        >`
          SELECT a.[id], a.[conversationId], a.[uploaderUserId], a.[state], a.[messageId],
                 a.[assetId], a.[mediaType], a.[byteSize], a.[displayName], a.[createdAt],
                 CASE WHEN a.[state] = N'attached' THEN m.[moderation] END AS [messageModeration]
          FROM [dbo].[MessageAttachment] a
          LEFT JOIN [dbo].[Message] m
            ON m.[id] = a.[messageId] AND m.[conversationId] = a.[conversationId]
          WHERE a.[id] = ${attachmentId}`;
        if (row === undefined) return null;
        return {
          id: row.id,
          conversationId: row.conversationId,
          uploaderAccountId: row.uploaderUserId,
          state: row.state as AttachmentState,
          messageId: row.messageId,
          assetId: row.assetId,
          mediaType: row.mediaType,
          byteSize: row.byteSize === null ? null : numberOf(row.byteSize),
          displayName: row.displayName,
          createdAt: dateOf(row.createdAt),
          messageModeration: row.messageModeration as MessageModerationState | null,
        };
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * Two bounded statements: stale unsent uploads (created before
     * `staleBefore`, optionally of one conversation) become `releasing`, then
     * up to `limit` releasing rows are returned, oldest first. Repeatable: a
     * row stays in the queue until `forgetAttachment` removes it.
     */
    async releaseQueue({ staleBefore, conversationId, limit }) {
      const size = bounded(limit);
      try {
        await db.$executeRaw`
          UPDATE TOP (${size}) [dbo].[MessageAttachment]
          SET [state] = N'releasing', [assetId] = NULL, [messageId] = NULL, [position] = NULL
          WHERE [state] IN (N'pending', N'ready') AND [createdAt] < ${staleBefore}
            AND (${conversationId} IS NULL OR [conversationId] = ${conversationId})`;
        const rows = await db.messageAttachment.findMany({
          where: {
            state: 'releasing',
            ...(conversationId === null ? {} : { conversationId }),
          },
          select: { id: true, releaseToken: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: size,
        });
        return rows.map((row) => ({
          attachmentId: row.id,
          releaseToken: row.releaseToken,
        }));
      } catch (error) {
        refuse(error);
      }
    },

    /** Only a `releasing` row, whose asset Storage has released, is deleted. */
    async forgetAttachment(attachmentId) {
      try {
        await db.messageAttachment.deleteMany({
          where: { id: attachmentId, state: 'releasing' },
        });
      } catch (error) {
        refuse(error);
      }
    },
  };
}
