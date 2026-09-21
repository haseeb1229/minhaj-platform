import { z } from 'zod';
import {
  contactInputSchema,
  feedbackInputSchema,
  correspondenceKindSchema,
  correspondenceStateSchema,
  triageSchema,
  type CorrespondencePersistencePort,
  type EditorialAuthorityPort,
  type EditorialActor,
  type CorrespondenceKind,
} from '@minhaj/contracts/editorial';
import type { RateLimiterPort } from '@minhaj/contracts/platform';
import { EditorialRefusal } from '../domain/workflow.ts';

interface CorrespondenceDependencies {
  persistence: CorrespondencePersistencePort;
  authority: EditorialAuthorityPort;
  limiter: RateLimiterPort;
  retentionDays: number | null;
  key: (kind: CorrespondenceKind, subject: string) => string;
  now?: () => Date;
}

export function createCorrespondenceService(dependencies: CorrespondenceDependencies) {
  const { persistence: store, authority } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  async function permit(actor: EditorialActor, permission: string) {
    if (!actor?.accountId || !(await authority.permits(actor.accountId, permission)))
      throw new EditorialRefusal('denied');
  }
  return {
    ...createCorrespondenceIntake(dependencies),
    async directory(
      actor: EditorialActor,
      kind: CorrespondenceKind,
      offset: number,
      state: unknown = null,
    ) {
      await permit(actor, 'correspondence.read');
      correspondenceKindSchema.parse(kind);
      z.number().int().min(0).max(10_000_000).parse(offset);
      const filter = correspondenceStateSchema.nullable().parse(state);
      return kind === 'contact'
        ? store.contacts(offset, filter)
        : store.feedback(offset, filter);
    },
    async triage(actor: EditorialActor, kind: CorrespondenceKind, value: unknown) {
      await permit(actor, 'correspondence.administer');
      correspondenceKindSchema.parse(kind);
      const input = { ...triageSchema.parse(value), actorId: actor.accountId };
      return kind === 'contact'
        ? store.triageContact(input)
        : store.triageFeedback(input);
    },
    purgeExpired() {
      return store.purgeExpired(now(), 25);
    },
  };
}

export function createCorrespondenceIntake(
  dependencies: Omit<CorrespondenceDependencies, 'authority'>,
) {
  const { persistence: store, limiter, retentionDays } = dependencies;
  if (retentionDays !== null) z.number().int().positive().max(3650).parse(retentionDays);
  const now = dependencies.now ?? (() => new Date());
  return {
    async submit(kind: CorrespondenceKind, value: unknown, subject: string) {
      correspondenceKindSchema.parse(kind);
      if (retentionDays === null) throw new EditorialRefusal('unavailable');
      const input =
        kind === 'contact'
          ? contactInputSchema.parse(value)
          : feedbackInputSchema.parse(value);
      const limit = await limiter.consume(dependencies.key(kind, subject), {
        window: 900,
        max: 5,
      });
      if (!limit.allowed) throw new EditorialRefusal('denied');
      const retainUntil = new Date(now().getTime() + retentionDays * 86_400_000);
      if ('email' in input) await store.submitContact({ ...input, retainUntil });
      else await store.submitFeedback({ ...input, retainUntil });
    },
  };
}
