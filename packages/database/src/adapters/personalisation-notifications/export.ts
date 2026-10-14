import 'server-only';

import type {
  NotificationCategory,
  NotificationChannel,
  NotificationKind,
  OnboardingState,
  PersonalExportPort,
  PersonalGoal,
  PersonalInterest,
} from '@minhaj/contracts/personalisation';
import { PERSONAL_GOALS, PERSONAL_INTERESTS } from '@minhaj/contracts/personalisation';

import { getDatabaseClient } from '../../client.ts';
import {
  iso,
  maybeIso,
  readableOf,
  readableSelect,
  refuse,
  targetOf,
  targetSelect,
  type TargetRow,
} from './shared.ts';

/**
 * Everything one account owns here, for its own export — and nothing it does
 * not. Targets are typed identities; no title or body of any content is
 * copied, and every list is in a fixed, documented order so two exports of
 * unchanged data are byte-identical apart from `generatedAt`.
 *
 * Every statement is keyed by the account. The newsletter is absent: a
 * subscription belongs to an address, not to this account (DOMAIN_MODEL.md
 * §14.5).
 */
export function createPersonalExport(): PersonalExportPort {
  const db = getDatabaseClient();

  return {
    async collect(accountId) {
      try {
        const [
          profile,
          interests,
          goals,
          bookmarks,
          notes,
          collections,
          members,
          reading,
          watching,
          progress,
          preferences,
          notifications,
        ] = await Promise.all([
          db.$queryRaw<{ onboarding: string | null; historyEnabled: boolean }[]>`
            SELECT [onboarding], [historyEnabled] FROM [dbo].[PersonalisationProfile] WHERE [userId] = ${accountId}`,
          db.$queryRaw<{ interest: string }[]>`
            SELECT [interest] FROM [dbo].[PersonalisationInterest] WHERE [userId] = ${accountId}`,
          db.$queryRaw<{ goal: string }[]>`
            SELECT [goal] FROM [dbo].[PersonalisationGoal] WHERE [userId] = ${accountId}`,
          db.$queryRaw<(TargetRow & { createdAt: Date })[]>`
            SELECT b.[createdAt], ${targetSelect('s')}
            FROM [dbo].[Bookmark] b JOIN [dbo].[SavedItem] s ON s.[id] = b.[savedItemId]
            WHERE s.[userId] = ${accountId}
            ORDER BY b.[createdAt], s.[id]`,
          db.$queryRaw<
            (TargetRow & { body: string; createdAt: Date; updatedAt: Date })[]
          >`
            SELECT n.[body], n.[createdAt], n.[updatedAt], ${targetSelect('s')}
            FROM [dbo].[Note] n JOIN [dbo].[SavedItem] s ON s.[id] = n.[savedItemId]
            WHERE s.[userId] = ${accountId}
            ORDER BY n.[createdAt], s.[id]`,
          db.$queryRaw<
            {
              id: string;
              title: string;
              description: string | null;
              createdAt: Date;
              updatedAt: Date;
            }[]
          >`
            SELECT [id], [title], [description], [createdAt], [updatedAt]
            FROM [dbo].[PrivateCollection] WHERE [userId] = ${accountId}
            ORDER BY [createdAt], [id]`,
          db.$queryRaw<(TargetRow & { collectionId: string; addedAt: Date })[]>`
            SELECT i.[collectionId], i.[addedAt], ${targetSelect('s')}
            FROM [dbo].[PrivateCollectionItem] i
            JOIN [dbo].[SavedItem] s ON s.[id] = i.[savedItemId] AND s.[userId] = i.[userId]
            WHERE i.[userId] = ${accountId}
            ORDER BY i.[collectionId], i.[position]`,
          db.$queryRaw<
            (Omit<TargetRow, 'videoId'> & { firstReadAt: Date; lastReadAt: Date })[]
          >`
            SELECT h.[firstReadAt], h.[lastReadAt], ${readableSelect('h')}
            FROM [dbo].[ReadingHistory] h WHERE h.[userId] = ${accountId}
            ORDER BY h.[firstReadAt], h.[id]`,
          db.$queryRaw<{ videoId: string; firstWatchedAt: Date; lastWatchedAt: Date }[]>`
            SELECT [videoId], [firstWatchedAt], [lastWatchedAt]
            FROM [dbo].[WatchHistory] WHERE [userId] = ${accountId}
            ORDER BY [firstWatchedAt], [videoId]`,
          db.$queryRaw<{ surahNumber: number; ayahNumber: number; updatedAt: Date }[]>`
            SELECT [surahNumber], [ayahNumber], [updatedAt]
            FROM [dbo].[QuranReadingProgress] WHERE [userId] = ${accountId}`,
          db.$queryRaw<{ category: string; channel: string; enabled: boolean }[]>`
            SELECT [category], [channel], [enabled] FROM [dbo].[NotificationPreference]
            WHERE [userId] = ${accountId} ORDER BY [category], [channel]`,
          db.$queryRaw<
            {
              kind: string;
              destination: string | null;
              createdAt: Date;
              readAt: Date | null;
            }[]
          >`
            SELECT [kind], [destination], [createdAt], [readAt] FROM [dbo].[Notification]
            WHERE [userId] = ${accountId} ORDER BY [createdAt], [id]`,
        ]);

        const held = new Set(interests.map((row) => row.interest));
        const aimed = new Set(goals.map((row) => row.goal));
        const byCollection = new Map<
          string,
          { target: ReturnType<typeof targetOf>; addedAt: string }[]
        >();
        for (const member of members) {
          const list = byCollection.get(member.collectionId) ?? [];
          list.push({ target: targetOf(member), addedAt: iso(member.addedAt) });
          byCollection.set(member.collectionId, list);
        }
        const row = profile[0];

        return {
          settings: {
            onboarding: (row?.onboarding as OnboardingState | null | undefined) ?? null,
            interests: PERSONAL_INTERESTS.filter((v) =>
              held.has(v),
            ) as PersonalInterest[],
            goals: PERSONAL_GOALS.filter((v) => aimed.has(v)) as PersonalGoal[],
            historyEnabled: Boolean(row?.historyEnabled ?? false),
          },
          bookmarks: bookmarks.map((b) => ({
            target: targetOf(b),
            createdAt: iso(b.createdAt),
          })),
          notes: notes.map((n) => ({
            target: targetOf(n),
            body: n.body,
            createdAt: iso(n.createdAt),
            updatedAt: iso(n.updatedAt),
          })),
          collections: collections.map((c) => ({
            title: c.title,
            description: c.description,
            createdAt: iso(c.createdAt),
            updatedAt: iso(c.updatedAt),
            members: byCollection.get(c.id) ?? [],
          })),
          readingHistory: reading.map((h) => ({
            target: readableOf(h),
            firstReadAt: iso(h.firstReadAt),
            lastReadAt: iso(h.lastReadAt),
          })),
          watchHistory: watching.map((w) => ({
            target: { kind: 'video' as const, id: w.videoId },
            firstWatchedAt: iso(w.firstWatchedAt),
            lastWatchedAt: iso(w.lastWatchedAt),
          })),
          quranProgress:
            progress[0] === undefined
              ? null
              : {
                  surah: Number(progress[0].surahNumber),
                  ayah: Number(progress[0].ayahNumber),
                  updatedAt: iso(progress[0].updatedAt),
                },
          notificationPreferences: preferences.map((p) => ({
            category: p.category as NotificationCategory,
            channel: p.channel as NotificationChannel,
            enabled: Boolean(p.enabled),
          })),
          notifications: notifications.map((n) => ({
            kind: n.kind as NotificationKind,
            destination: n.destination,
            createdAt: iso(n.createdAt),
            readAt: maybeIso(n.readAt),
          })),
        };
      } catch (error) {
        refuse(error);
      }
    },
  };
}
