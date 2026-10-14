import 'server-only';

import {
  personalIdSchema,
  quranProgressClearSchema,
  quranProgressWriteSchema,
  readableTargetSchema,
  type PersonalHistoryPort,
  type ReadingPage,
  type WatchPage,
  type QuranProgress,
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
  type PublicTargetPort,
} from './shared.ts';

/** Reads and watches a person may record — generous, and still bounded. */
export const HISTORY_RULE: RateLimitRule = Object.freeze({ window: 3_600, max: 300 });

/**
 * Reading and watch history and the one Quran position.
 *
 * HISTORY IS PRIVATE CONTINUITY, NOT ANALYTICS. Nothing is recorded unless the
 * person turned history on (the adapter decides that in the write itself);
 * the instant is the SERVER's, never one a request supplies; and a late or
 * repeated request never moves a newer instant backwards.
 *
 * THE QURAN POSITION MOVES ONLY WHEN THE READER SAYS SO, under the version
 * they read. It is never advanced by a page view, so a delayed or replayed
 * request cannot rewind it.
 */
export function createHistoryService(deps: {
  readonly history: PersonalHistoryPort;
  readonly targets: PublicTargetPort;
  readonly limiter: RateLimiterPort;
  readonly key: LimitKey;
  readonly clock?: () => Date;
}) {
  const now = deps.clock ?? (() => new Date());
  const run = <T>(work: Promise<T>): Promise<T> => work.catch(asRefusal);

  async function recording(actor: PersonalActor): Promise<void> {
    requireActor(actor);
    await spend(
      deps.limiter,
      deps.key('personal-history', actor.accountId),
      HISTORY_RULE,
    );
  }

  return {
    async recordRead(actor: PersonalActor, input: unknown): Promise<void> {
      const target = readableTargetSchema.safeParse(input);
      if (!target.success) throw new PersonalRefusal('invalid');
      await recording(actor);
      if (!(await deps.targets.available(target.data))) return;
      await run(deps.history.recordRead(actor.accountId, target.data, now()));
    },

    async recordWatch(actor: PersonalActor, videoId: unknown): Promise<void> {
      const id = personalIdSchema.safeParse(videoId);
      if (!id.success) throw new PersonalRefusal('invalid');
      await recording(actor);
      if (!(await deps.targets.available({ kind: 'video', id: id.data }))) return;
      await run(deps.history.recordWatch(actor.accountId, id.data, now()));
    },

    async reading(actor: PersonalActor, offset: number): Promise<ReadingPage> {
      requireActor(actor);
      return run(deps.history.reading(actor.accountId, safeOffset(offset)));
    },

    async watching(actor: PersonalActor, offset: number): Promise<WatchPage> {
      requireActor(actor);
      return run(deps.history.watching(actor.accountId, safeOffset(offset)));
    },

    async removeRead(actor: PersonalActor, input: unknown): Promise<void> {
      const target = readableTargetSchema.safeParse(input);
      if (!target.success) throw new PersonalRefusal('invalid');
      requireActor(actor);
      await spend(deps.limiter, deps.key('personal-write', actor.accountId), WRITE_RULE);
      await run(deps.history.removeRead(actor.accountId, target.data));
    },

    async removeWatch(actor: PersonalActor, videoId: unknown): Promise<void> {
      const id = personalIdSchema.safeParse(videoId);
      if (!id.success) throw new PersonalRefusal('invalid');
      requireActor(actor);
      await spend(deps.limiter, deps.key('personal-write', actor.accountId), WRITE_RULE);
      await run(deps.history.removeWatch(actor.accountId, id.data));
    },

    async clear(actor: PersonalActor): Promise<void> {
      requireActor(actor);
      await spend(deps.limiter, deps.key('personal-write', actor.accountId), WRITE_RULE);
      await run(deps.history.clear(actor.accountId));
    },

    async quranProgress(actor: PersonalActor): Promise<QuranProgress | null> {
      requireActor(actor);
      return run(deps.history.quranProgress(actor.accountId));
    },

    async setQuranProgress(actor: PersonalActor, input: unknown) {
      const value = quranProgressWriteSchema.safeParse(input);
      if (!value.success) throw new PersonalRefusal('invalid');
      requireActor(actor);
      await spend(deps.limiter, deps.key('personal-write', actor.accountId), WRITE_RULE);
      const target = {
        kind: 'ayah' as const,
        surah: value.data.surah,
        ayah: value.data.ayah,
      };
      if (!(await deps.targets.available(target))) throw new PersonalRefusal('not-found');
      return run(deps.history.setQuranProgress(actor.accountId, value.data, now()));
    },

    async clearQuranProgress(actor: PersonalActor, input: unknown): Promise<void> {
      const value = quranProgressClearSchema.safeParse(input);
      if (!value.success) throw new PersonalRefusal('invalid');
      requireActor(actor);
      await spend(deps.limiter, deps.key('personal-write', actor.accountId), WRITE_RULE);
      await run(
        deps.history.clearQuranProgress(actor.accountId, value.data.expectedVersion),
      );
    },
  };
}

export type HistoryService = ReturnType<typeof createHistoryService>;
