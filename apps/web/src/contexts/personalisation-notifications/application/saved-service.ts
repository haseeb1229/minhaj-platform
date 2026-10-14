import 'server-only';

import { randomUUID } from 'node:crypto';

import {
  collectionDetailsSchema,
  collectionMembershipSchema,
  collectionOrderSchema,
  collectionRemovalSchema,
  collectionUpdateSchema,
  noteRemovalSchema,
  noteWriteSchema,
  personalIdSchema,
  personalTargetSchema,
  type CollectionDetail,
  type CollectionSummary,
  type BookmarkPage,
  type NotePage,
  type PersonalSavedPort,
  type SavedEntry,
} from '@minhaj/contracts/personalisation';
import type { RateLimiterPort } from '@minhaj/contracts/platform';

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

/**
 * Bookmarks, notes and private collections.
 *
 * THE ACTOR IS THE OWNER, ALWAYS. Every method takes the session's account and
 * passes it to the adapter, which puts it in the SQL predicate; no input names
 * whose data this is.
 *
 * SAVING ASKS THE OWNER FIRST. A new bookmark, note or collection member is
 * accepted only for a target that is public now (`PublicTargetPort`); removing
 * one never asks, so content that was archived after it was saved can still be
 * cleared away by the person who saved it.
 */
export function createSavedService(deps: {
  readonly saved: PersonalSavedPort;
  readonly targets: PublicTargetPort;
  readonly limiter: RateLimiterPort;
  readonly key: LimitKey;
  readonly ids?: () => string;
}) {
  const ids = deps.ids ?? randomUUID;

  async function writing(actor: PersonalActor): Promise<void> {
    requireActor(actor);
    await spend(deps.limiter, deps.key('personal-write', actor.accountId), WRITE_RULE);
  }

  async function publicTarget(input: unknown) {
    const target = personalTargetSchema.parse(input);
    if (!(await deps.targets.available(target))) throw new PersonalRefusal('not-found');
    return target;
  }

  const run = <T>(work: Promise<T>): Promise<T> => work.catch(asRefusal);

  return {
    async bookmark(actor: PersonalActor, input: unknown): Promise<void> {
      const target = personalTargetSchema.safeParse(input);
      if (!target.success) throw new PersonalRefusal('invalid');
      await writing(actor);
      await run(
        deps.saved.bookmark(actor.accountId, await publicTarget(target.data), ids()),
      );
    },

    async unbookmark(actor: PersonalActor, input: unknown): Promise<void> {
      const target = personalTargetSchema.safeParse(input);
      if (!target.success) throw new PersonalRefusal('invalid');
      await writing(actor);
      await run(deps.saved.unbookmark(actor.accountId, target.data));
    },

    async bookmarks(actor: PersonalActor, offset: number): Promise<BookmarkPage> {
      requireActor(actor);
      return run(deps.saved.bookmarks(actor.accountId, safeOffset(offset)));
    },

    async writeNote(
      actor: PersonalActor,
      input: unknown,
    ): Promise<{ readonly version: number }> {
      const value = noteWriteSchema.safeParse(input);
      if (!value.success) throw new PersonalRefusal('invalid');
      await writing(actor);
      // A note on a target already saved is an edit of the person's own words,
      // and stays possible after the content was archived; a FIRST note is a
      // new save and asks the owner.
      if (value.data.expectedVersion === 0) await publicTarget(value.data.target);
      return run(deps.saved.writeNote(actor.accountId, value.data, ids()));
    },

    async removeNote(actor: PersonalActor, input: unknown): Promise<void> {
      const value = noteRemovalSchema.safeParse(input);
      if (!value.success) throw new PersonalRefusal('invalid');
      await writing(actor);
      await run(deps.saved.removeNote(actor.accountId, value.data));
    },

    async notes(actor: PersonalActor, offset: number): Promise<NotePage> {
      requireActor(actor);
      return run(deps.saved.notes(actor.accountId, safeOffset(offset)));
    },

    async collections(actor: PersonalActor): Promise<readonly CollectionSummary[]> {
      requireActor(actor);
      return run(deps.saved.collections(actor.accountId));
    },

    async collection(actor: PersonalActor, id: string): Promise<CollectionDetail | null> {
      requireActor(actor);
      if (!personalIdSchema.safeParse(id).success) return null;
      return run(deps.saved.collection(actor.accountId, id));
    },

    async createCollection(
      actor: PersonalActor,
      input: unknown,
    ): Promise<{ readonly id: string }> {
      const value = collectionDetailsSchema.safeParse(input);
      if (!value.success) throw new PersonalRefusal('invalid');
      await writing(actor);
      const id = ids();
      await run(deps.saved.createCollection(actor.accountId, id, value.data));
      return { id };
    },

    async updateCollection(actor: PersonalActor, input: unknown) {
      const value = collectionUpdateSchema.safeParse(input);
      if (!value.success) throw new PersonalRefusal('invalid');
      await writing(actor);
      return run(deps.saved.updateCollection(actor.accountId, value.data));
    },

    async removeCollection(actor: PersonalActor, input: unknown): Promise<void> {
      const value = collectionRemovalSchema.safeParse(input);
      if (!value.success) throw new PersonalRefusal('invalid');
      await writing(actor);
      await run(deps.saved.removeCollection(actor.accountId, value.data));
    },

    async addToCollection(actor: PersonalActor, input: unknown) {
      const value = collectionMembershipSchema.safeParse(input);
      if (!value.success) throw new PersonalRefusal('invalid');
      await writing(actor);
      await publicTarget(value.data.target);
      return run(deps.saved.addToCollection(actor.accountId, value.data, ids()));
    },

    async removeFromCollection(actor: PersonalActor, input: unknown) {
      const value = collectionMembershipSchema.safeParse(input);
      if (!value.success) throw new PersonalRefusal('invalid');
      await writing(actor);
      return run(deps.saved.removeFromCollection(actor.accountId, value.data));
    },

    async reorderCollection(actor: PersonalActor, input: unknown) {
      const value = collectionOrderSchema.safeParse(input);
      if (!value.success) throw new PersonalRefusal('invalid');
      await writing(actor);
      return run(deps.saved.reorderCollection(actor.accountId, value.data));
    },

    async recent(actor: PersonalActor, limit: number): Promise<readonly SavedEntry[]> {
      requireActor(actor);
      return run(deps.saved.recent(actor.accountId, limit));
    },

    async counts(actor: PersonalActor) {
      requireActor(actor);
      return run(deps.saved.counts(actor.accountId));
    },
  };
}

export type SavedService = ReturnType<typeof createSavedService>;
