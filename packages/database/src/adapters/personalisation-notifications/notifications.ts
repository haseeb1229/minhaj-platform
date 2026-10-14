import 'server-only';

import {
  NOTIFICATION_KIND_CATEGORY,
  PERSONAL_LIMITS,
  isInternalDestination,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationEntry,
  type NotificationKind,
  type PersonalNotificationPort,
} from '@minhaj/contracts/personalisation';

import { getDatabaseClient } from '../../client.ts';
import {
  PAGE,
  PersonalDataError,
  boundedOffset,
  iso,
  isUniqueViolation,
  maybeIso,
  refuse,
} from './shared.ts';

/**
 * In-app notifications: system-generated, one-directional, one account's
 * alone. Not a message — there is no reply, no participant and no thread.
 *
 * A notification stores a KIND the interface translates and at most a path on
 * this site; never prose, never a URL somebody typed. Producing one is
 * idempotent on its key, and the account's own preference is consulted in the
 * same transaction that would insert it.
 */
export function createPersonalNotifications(): PersonalNotificationPort {
  const db = getDatabaseClient();

  return {
    async produce(value, notificationId, at) {
      try {
        const category = NOTIFICATION_KIND_CATEGORY[value.kind];
        if (category === undefined) throw new PersonalDataError('invalid');
        if (value.destination !== null && !isInternalDestination(value.destination))
          throw new PersonalDataError('invalid');
        return await db.$transaction(async (tx) => {
          const [preference] = await tx.$queryRaw<{ enabled: boolean }[]>`
            SELECT [enabled] FROM [dbo].[NotificationPreference]
            WHERE [userId] = ${value.accountId} AND [category] = ${category} AND [channel] = N'in-app'`;
          if (preference !== undefined && !preference.enabled) return 'muted' as const;
          const [existing] = await tx.$queryRaw<{ one: number }[]>`
            SELECT 1 AS [one] FROM [dbo].[Notification] WITH (UPDLOCK, HOLDLOCK)
            WHERE [userId] = ${value.accountId} AND [idempotencyKey] = ${value.idempotencyKey}`;
          if (existing !== undefined) return 'duplicate' as const;
          await tx.$executeRaw`
            INSERT INTO [dbo].[Notification]
              ([id], [userId], [kind], [category], [destination], [idempotencyKey], [createdAt], [readAt])
            VALUES
              (${notificationId}, ${value.accountId}, ${value.kind}, ${category},
               ${value.destination}, ${value.idempotencyKey}, ${at}, NULL)`;
          await tx.$executeRaw`
            DELETE FROM [dbo].[Notification]
            WHERE [userId] = ${value.accountId} AND [id] IN (
              SELECT [id] FROM [dbo].[Notification] WHERE [userId] = ${value.accountId}
              ORDER BY [createdAt] DESC, [id]
              OFFSET ${PERSONAL_LIMITS.notifications} ROWS)`;
          return 'created' as const;
        });
      } catch (error) {
        // Two producers racing on one key: the other one created it.
        if (isUniqueViolation(error)) return 'duplicate';
        refuse(error);
      }
    },

    async notifications(accountId, offset) {
      try {
        const skip = boundedOffset(offset);
        const [counted, rows] = await Promise.all([
          db.$queryRaw<{ total: number }[]>`
            SELECT COUNT(*) AS [total] FROM [dbo].[Notification] WHERE [userId] = ${accountId}`,
          db.$queryRaw<
            {
              id: string;
              kind: string;
              category: string;
              destination: string | null;
              createdAt: Date;
              readAt: Date | null;
            }[]
          >`
            SELECT [id], [kind], [category], [destination], [createdAt], [readAt]
            FROM [dbo].[Notification]
            WHERE [userId] = ${accountId}
            ORDER BY [createdAt] DESC, [id]
            OFFSET ${skip} ROWS FETCH NEXT ${PAGE} ROWS ONLY`,
        ]);
        return {
          items: rows.map((row): NotificationEntry => ({
            id: row.id,
            kind: row.kind as NotificationKind,
            category: row.category as NotificationCategory,
            destination: row.destination,
            createdAt: iso(row.createdAt),
            readAt: maybeIso(row.readAt),
          })),
          total: Number(counted[0]?.total ?? 0),
          offset: skip,
        };
      } catch (error) {
        refuse(error);
      }
    },

    async unread(accountId) {
      try {
        const [row] = await db.$queryRaw<{ total: number }[]>`
          SELECT COUNT(*) AS [total] FROM [dbo].[Notification]
          WHERE [userId] = ${accountId} AND [readAt] IS NULL`;
        return Number(row?.total ?? 0);
      } catch (error) {
        refuse(error);
      }
    },

    async markRead(accountId, notificationId, at) {
      try {
        await db.$executeRaw`
          UPDATE [dbo].[Notification] SET [readAt] = ${at}
          WHERE [id] = ${notificationId} AND [userId] = ${accountId} AND [readAt] IS NULL`;
      } catch (error) {
        refuse(error);
      }
    },

    async markAllRead(accountId, at) {
      try {
        return await db.$executeRaw`
          UPDATE [dbo].[Notification] SET [readAt] = ${at}
          WHERE [userId] = ${accountId} AND [readAt] IS NULL`;
      } catch (error) {
        refuse(error);
      }
    },

    async remove(accountId, notificationId) {
      try {
        await db.$executeRaw`
          DELETE FROM [dbo].[Notification] WHERE [id] = ${notificationId} AND [userId] = ${accountId}`;
      } catch (error) {
        refuse(error);
      }
    },

    async clearRead(accountId) {
      try {
        return await db.$executeRaw`
          DELETE FROM [dbo].[Notification] WHERE [userId] = ${accountId} AND [readAt] IS NOT NULL`;
      } catch (error) {
        refuse(error);
      }
    },

    async preferences(accountId) {
      try {
        const rows = await db.$queryRaw<
          { category: string; channel: string; enabled: boolean }[]
        >`
          SELECT [category], [channel], [enabled] FROM [dbo].[NotificationPreference]
          WHERE [userId] = ${accountId}
          ORDER BY [category], [channel]`;
        return rows.map((row) => ({
          category: row.category as NotificationCategory,
          channel: row.channel as NotificationChannel,
          enabled: Boolean(row.enabled),
        }));
      } catch (error) {
        refuse(error);
      }
    },

    async setPreference(accountId, value, at) {
      try {
        // A low-consequence preference: the latest choice wins
        // (DOMAIN_MODEL.md §19.8 permits exactly this).
        await db.$executeRaw`
          MERGE [dbo].[NotificationPreference] WITH (HOLDLOCK) AS p
          USING (SELECT ${accountId} AS [userId], ${value.category} AS [category], ${value.channel} AS [channel]) AS v
          ON p.[userId] = v.[userId] AND p.[category] = v.[category] AND p.[channel] = v.[channel]
          WHEN MATCHED THEN UPDATE SET [enabled] = ${value.enabled}, [updatedAt] = ${at}
          WHEN NOT MATCHED THEN INSERT ([userId], [category], [channel], [enabled], [updatedAt])
            VALUES (v.[userId], v.[category], v.[channel], ${value.enabled}, ${at});`;
      } catch (error) {
        refuse(error);
      }
    },
  };
}
