import 'server-only';

import {
  PERSONAL_GOALS,
  PERSONAL_INTERESTS,
  type OnboardingState,
  type PersonalGoal,
  type PersonalInterest,
  type PersonalSettingsPort,
} from '@minhaj/contracts/personalisation';

import { getDatabaseClient } from '../../client.ts';
import { PersonalDataError, refuse, type Client } from './shared.ts';

/**
 * The account's own settings: explicit onboarding answers and the history
 * switch. One row, absent until the person first sets something; its version
 * is what a stale form is refused against.
 */

const INTERESTS: ReadonlySet<string> = new Set(PERSONAL_INTERESTS);
const GOALS: ReadonlySet<string> = new Set(PERSONAL_GOALS);

/** Locks the account's settings row and checks the version that was read. */
async function lockProfile(
  tx: Client,
  accountId: string,
  expectedVersion: number,
): Promise<number | null> {
  const [row] = await tx.$queryRaw<{ version: number }[]>`
    SELECT [version] FROM [dbo].[PersonalisationProfile] WITH (UPDLOCK, HOLDLOCK)
    WHERE [userId] = ${accountId}`;
  const version = row === undefined ? null : Number(row.version);
  if ((version ?? 0) !== expectedVersion) throw new PersonalDataError('conflict');
  return version;
}

export function createPersonalSettings(): PersonalSettingsPort {
  const db = getDatabaseClient();

  return {
    async settings(accountId) {
      try {
        const [profile] = await db.$queryRaw<
          { onboarding: string | null; historyEnabled: boolean; version: number }[]
        >`
          SELECT [onboarding], [historyEnabled], [version]
          FROM [dbo].[PersonalisationProfile] WHERE [userId] = ${accountId}`;
        if (profile === undefined)
          return {
            onboarding: null,
            interests: [],
            goals: [],
            historyEnabled: false,
            version: 0,
          };
        const [interests, goals] = await Promise.all([
          db.$queryRaw<{ interest: string }[]>`
            SELECT [interest] FROM [dbo].[PersonalisationInterest] WHERE [userId] = ${accountId}`,
          db.$queryRaw<{ goal: string }[]>`
            SELECT [goal] FROM [dbo].[PersonalisationGoal] WHERE [userId] = ${accountId}`,
        ]);
        const held = new Set(interests.map((row) => row.interest));
        const aimed = new Set(goals.map((row) => row.goal));
        return {
          onboarding: (profile.onboarding as OnboardingState | null) ?? null,
          // In the vocabulary's own order, so every reader sees one order.
          interests: PERSONAL_INTERESTS.filter((value) =>
            held.has(value),
          ) as PersonalInterest[],
          goals: PERSONAL_GOALS.filter((value) => aimed.has(value)) as PersonalGoal[],
          historyEnabled: Boolean(profile.historyEnabled),
          version: Number(profile.version),
        };
      } catch (error) {
        refuse(error);
      }
    },

    async saveOnboarding(accountId, value, state, at) {
      try {
        if (
          value.interests.some((v) => !INTERESTS.has(v)) ||
          value.goals.some((v) => !GOALS.has(v))
        )
          throw new PersonalDataError('invalid');
        return await db.$transaction(async (tx) => {
          const version = await lockProfile(tx, accountId, value.expectedVersion);
          if (version === null) {
            await tx.$executeRaw`
              INSERT INTO [dbo].[PersonalisationProfile]
                ([userId], [onboarding], [historyEnabled], [version], [createdAt], [updatedAt])
              VALUES (${accountId}, ${state}, 0, 1, ${at}, ${at})`;
          } else {
            await tx.$executeRaw`
              UPDATE [dbo].[PersonalisationProfile]
              SET [onboarding] = ${state}, [version] = ${version + 1}, [updatedAt] = ${at}
              WHERE [userId] = ${accountId}`;
          }
          // Skipping leaves earlier answers exactly as they were; answering
          // replaces them with what was chosen now.
          if (state === 'completed') {
            await tx.$executeRaw`DELETE FROM [dbo].[PersonalisationInterest] WHERE [userId] = ${accountId}`;
            await tx.$executeRaw`DELETE FROM [dbo].[PersonalisationGoal] WHERE [userId] = ${accountId}`;
            for (const interest of value.interests)
              await tx.$executeRaw`
                INSERT INTO [dbo].[PersonalisationInterest] ([userId], [interest]) VALUES (${accountId}, ${interest})`;
            for (const goal of value.goals)
              await tx.$executeRaw`
                INSERT INTO [dbo].[PersonalisationGoal] ([userId], [goal]) VALUES (${accountId}, ${goal})`;
          }
          return { version: (version ?? 0) + 1 };
        });
      } catch (error) {
        refuse(error);
      }
    },

    async setHistory(accountId, value, at) {
      try {
        return await db.$transaction(async (tx) => {
          const version = await lockProfile(tx, accountId, value.expectedVersion);
          if (version === null) {
            await tx.$executeRaw`
              INSERT INTO [dbo].[PersonalisationProfile]
                ([userId], [onboarding], [historyEnabled], [version], [createdAt], [updatedAt])
              VALUES (${accountId}, NULL, ${value.enabled}, 1, ${at}, ${at})`;
            return { version: 1 };
          }
          await tx.$executeRaw`
            UPDATE [dbo].[PersonalisationProfile]
            SET [historyEnabled] = ${value.enabled}, [version] = ${version + 1}, [updatedAt] = ${at}
            WHERE [userId] = ${accountId}`;
          return { version: version + 1 };
        });
      } catch (error) {
        refuse(error);
      }
    },
  };
}
