import 'server-only';

import {
  historySettingSchema,
  onboardingWriteSchema,
  personalVersionSchema,
  personalTargetSchema,
  type PersonalHistoryPort,
  type PersonalSavedPort,
  type PersonalSettings,
  type PersonalSettingsPort,
  type TargetState,
} from '@minhaj/contracts/personalisation';
import type { RateLimiterPort } from '@minhaj/contracts/platform';

import { PersonalRefusal, asRefusal } from '../domain/refusal.ts';
import {
  WRITE_RULE,
  requireActor,
  spend,
  type LimitKey,
  type PersonalActor,
} from './shared.ts';

/**
 * Onboarding answers, the history switch, and what one public page's private
 * island is told about its target.
 *
 * ONBOARDING IS NEVER A GATE. It is optional, skippable and editable later;
 * nothing anywhere waits on it. Its answers are explicit choices from a small
 * vocabulary of public areas — nothing is inferred from what anybody reads or
 * watches, and the answers personalise the person's own pages and nothing
 * else (SECURITY_BASELINE.md §19.1).
 *
 * Account locale, timezone and account setup are Identity's and are not here.
 */
export function createSettingsService(deps: {
  readonly settings: PersonalSettingsPort;
  readonly saved: PersonalSavedPort;
  readonly history: PersonalHistoryPort;
  readonly limiter: RateLimiterPort;
  readonly key: LimitKey;
  readonly clock?: () => Date;
}) {
  const now = deps.clock ?? (() => new Date());
  const run = <T>(work: Promise<T>): Promise<T> => work.catch(asRefusal);

  async function writing(actor: PersonalActor): Promise<void> {
    requireActor(actor);
    await spend(deps.limiter, deps.key('personal-write', actor.accountId), WRITE_RULE);
  }

  return {
    async settings(actor: PersonalActor): Promise<PersonalSettings> {
      requireActor(actor);
      return run(deps.settings.settings(actor.accountId));
    },

    async completeOnboarding(actor: PersonalActor, input: unknown) {
      const value = onboardingWriteSchema.safeParse(input);
      if (!value.success) throw new PersonalRefusal('invalid');
      await writing(actor);
      return run(
        deps.settings.saveOnboarding(actor.accountId, value.data, 'completed', now()),
      );
    },

    async skipOnboarding(actor: PersonalActor, expectedVersion: unknown) {
      const version = personalVersionSchema.safeParse(expectedVersion);
      if (!version.success) throw new PersonalRefusal('invalid');
      await writing(actor);
      return run(
        deps.settings.saveOnboarding(
          actor.accountId,
          { interests: [], goals: [], expectedVersion: version.data },
          'skipped',
          now(),
        ),
      );
    },

    async setHistory(actor: PersonalActor, input: unknown) {
      const value = historySettingSchema.safeParse(input);
      if (!value.success) throw new PersonalRefusal('invalid');
      await writing(actor);
      return run(deps.settings.setHistory(actor.accountId, value.data, now()));
    },

    /**
     * ONE target's private state for the island a public page hydrates —
     * read in this private request, never in the page's shared render.
     */
    async targetState(actor: PersonalActor, input: unknown): Promise<TargetState> {
      const target = personalTargetSchema.safeParse(input);
      if (!target.success) throw new PersonalRefusal('invalid');
      requireActor(actor);
      const [state, settings, progress] = await Promise.all([
        run(deps.saved.targetState(actor.accountId, target.data)),
        run(deps.settings.settings(actor.accountId)),
        run(deps.history.quranProgress(actor.accountId)),
      ]);
      const here =
        target.data.kind === 'ayah' &&
        progress !== null &&
        progress.surah === target.data.surah &&
        progress.ayah === target.data.ayah;
      return {
        ...state,
        quranPosition: here,
        quranProgressVersion: progress?.version ?? 0,
        historyEnabled: settings.historyEnabled,
      };
    },
  };
}

export type SettingsService = ReturnType<typeof createSettingsService>;
