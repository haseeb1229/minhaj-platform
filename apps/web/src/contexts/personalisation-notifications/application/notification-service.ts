import 'server-only';

import { randomUUID } from 'node:crypto';

import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_DEFAULTS,
  notificationPreferenceSchema,
  notificationProductionSchema,
  personalIdSchema,
  type NotificationPreferenceState,
  type PersonalNotificationPort,
  type NotificationPage,
} from '@minhaj/contracts/personalisation';
import type { RateLimitRule, RateLimiterPort } from '@minhaj/contracts/platform';

import { PersonalRefusal, asRefusal } from '../domain/refusal.ts';
import {
  WRITE_RULE,
  requireActor,
  safeOffset,
  spend,
  type LimitKey,
  type PersonalActor,
} from './shared.ts';

/** Bulk actions — mark all read, clear read — are cheap but still bounded. */
export const NOTIFICATION_BULK_RULE: RateLimitRule = Object.freeze({
  window: 3_600,
  max: 60,
});

/**
 * Every category on every channel, with the account's own choice or the
 * default. A notification preference can never reach Identity's security and
 * account-service mail: no such category exists here, and no notification is
 * emailed at all.
 */
export function withDefaults(
  stored: readonly NotificationPreferenceState[],
): readonly NotificationPreferenceState[] {
  return NOTIFICATION_CATEGORIES.flatMap((category) =>
    NOTIFICATION_CHANNELS.map((channel) => ({
      category,
      channel,
      enabled:
        stored.find((row) => row.category === category && row.channel === channel)
          ?.enabled ?? NOTIFICATION_DEFAULTS[category][channel],
    })),
  );
}

/**
 * In-app notifications — system-generated, one-directional, one account's.
 *
 * TWO DOORS, NEVER CONFUSED. `produce` is for Layer-4 producers acting on
 * their own owner's decision — never reachable from anything a visitor sends.
 * Everything else acts for the signed-in account on its own notifications.
 */
export function createNotificationService(deps: {
  readonly notifications: PersonalNotificationPort;
  readonly limiter: RateLimiterPort;
  readonly key: LimitKey;
  readonly ids?: () => string;
  readonly clock?: () => Date;
}) {
  const ids = deps.ids ?? randomUUID;
  const now = deps.clock ?? (() => new Date());
  const run = <T>(work: Promise<T>): Promise<T> => work.catch(asRefusal);

  async function bulk(actor: PersonalActor): Promise<void> {
    requireActor(actor);
    await spend(
      deps.limiter,
      deps.key('personal-notification-bulk', actor.accountId),
      NOTIFICATION_BULK_RULE,
    );
  }

  return {
    /**
     * Stores one notification for the account a producer's owner named —
     * unless that account turned the category off, or the same key already
     * produced one. Producing is idempotent; a retry is safe.
     */
    async produce(input: unknown): Promise<'created' | 'duplicate' | 'muted'> {
      const value = notificationProductionSchema.safeParse(input);
      if (!value.success) throw new PersonalRefusal('invalid');
      return run(deps.notifications.produce(value.data, ids(), now()));
    },

    async notifications(actor: PersonalActor, offset: number): Promise<NotificationPage> {
      requireActor(actor);
      return run(deps.notifications.notifications(actor.accountId, safeOffset(offset)));
    },

    async unread(actor: PersonalActor): Promise<number> {
      requireActor(actor);
      return run(deps.notifications.unread(actor.accountId));
    },

    async markRead(actor: PersonalActor, id: unknown): Promise<void> {
      const parsed = personalIdSchema.safeParse(id);
      if (!parsed.success) throw new PersonalRefusal('invalid');
      requireActor(actor);
      await spend(deps.limiter, deps.key('personal-write', actor.accountId), WRITE_RULE);
      await run(deps.notifications.markRead(actor.accountId, parsed.data, now()));
    },

    async markAllRead(actor: PersonalActor): Promise<number> {
      await bulk(actor);
      return run(deps.notifications.markAllRead(actor.accountId, now()));
    },

    async remove(actor: PersonalActor, id: unknown): Promise<void> {
      const parsed = personalIdSchema.safeParse(id);
      if (!parsed.success) throw new PersonalRefusal('invalid');
      requireActor(actor);
      await spend(deps.limiter, deps.key('personal-write', actor.accountId), WRITE_RULE);
      await run(deps.notifications.remove(actor.accountId, parsed.data));
    },

    async clearRead(actor: PersonalActor): Promise<number> {
      await bulk(actor);
      return run(deps.notifications.clearRead(actor.accountId));
    },

    async preferences(
      actor: PersonalActor,
    ): Promise<readonly NotificationPreferenceState[]> {
      requireActor(actor);
      return withDefaults(await run(deps.notifications.preferences(actor.accountId)));
    },

    async setPreference(actor: PersonalActor, input: unknown): Promise<void> {
      const value = notificationPreferenceSchema.safeParse(input);
      if (!value.success) throw new PersonalRefusal('invalid');
      requireActor(actor);
      await spend(deps.limiter, deps.key('personal-write', actor.accountId), WRITE_RULE);
      await run(deps.notifications.setPreference(actor.accountId, value.data, now()));
    },
  };
}

export type NotificationService = ReturnType<typeof createNotificationService>;
