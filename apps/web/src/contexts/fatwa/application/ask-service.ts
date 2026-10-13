import 'server-only';

import { randomUUID } from 'node:crypto';

import {
  fatwaIdSchema,
  questionSubmissionSchema,
  type FatwaActor,
  type FatwaOwnerPort,
  type FatwaPublicReaderPort,
  type OwnQuestion,
  type OwnQuestionPage,
} from '@minhaj/contracts/fatwa';
import type { RateLimitRule, RateLimiterPort } from '@minhaj/contracts/platform';

import { FatwaRefusal, asRefusal } from '../domain/refusal.ts';

/**
 * Asking, and the asker's own questions — the Fatwa-owned capability behind
 * `/my/questions` (ROUTE_MAP.md §5.1; DOMAIN_MODEL.md §12).
 *
 * THE ASKER IS THE SESSION, NEVER THE FORM. The actor comes from Identity's
 * resolved session at Layer 4; nothing a browser submits names whose question
 * this is, and nothing copies the asker's name, address or contact details —
 * the question row references the account and holds the words, nothing more.
 *
 * EVERY READ IS KEYED BY THE ASKER. The owner port's queries filter by the
 * asker's account id themselves, so a question id belonging to somebody else
 * resolves to nothing — the same answer an id that does not exist gets.
 *
 * NOTHING IS CAPTURED WHILE THE SERVICE IS INACTIVE. Availability is checked
 * before the text is even parsed, and the database refuses the insert again
 * if it is checked around: a deployment nobody is authorised to answer from
 * must not collect sensitive questions (OPEN_DECISIONS.md §1.4).
 *
 * THE QUESTION TEXT IS NEVER A LIMITER KEY, A LOG FIELD OR AN ERROR. The rate
 * limit is keyed by the account id (digested by the limiter), and a refusal
 * names a category only.
 */

/** Five questions a day per account: generous for a person, a wall for a script. */
export const QUESTION_RATE_RULE: RateLimitRule = Object.freeze({
  window: 86_400,
  max: 5,
});

const OFFSET_MAX = 10_000;

export function createFatwaAskService(deps: {
  readonly owner: FatwaOwnerPort;
  readonly reader: Pick<FatwaPublicReaderPort, 'availability'>;
  readonly limiter: RateLimiterPort;
  /** The limiter key for an account, built at Layer 4 (purpose-scoped and digested). */
  readonly key: (accountId: string) => string;
  readonly ids?: () => string;
}) {
  const ids = deps.ids ?? randomUUID;

  return {
    availability: () => deps.reader.availability(),

    async submit(actor: FatwaActor, input: unknown): Promise<{ readonly id: string }> {
      if (!(await deps.reader.availability()).active) throw new FatwaRefusal('inactive');
      const parsed = questionSubmissionSchema.safeParse(input);
      if (!parsed.success) throw new FatwaRefusal('invalid');
      const decision = await deps.limiter.consume(
        deps.key(actor.accountId),
        QUESTION_RATE_RULE,
      );
      if (!decision.allowed) throw new FatwaRefusal('rate-limited');
      const id = ids();
      await deps.owner
        .submit({ id, askerId: actor.accountId, value: parsed.data })
        .catch(asRefusal);
      return { id };
    },

    async questions(actor: FatwaActor, offset: number): Promise<OwnQuestionPage> {
      const safe =
        Number.isInteger(offset) && offset >= 0 && offset <= OFFSET_MAX ? offset : 0;
      return deps.owner.questions(actor.accountId, safe);
    },

    async question(actor: FatwaActor, id: string): Promise<OwnQuestion | null> {
      if (!fatwaIdSchema.safeParse(id).success) return null;
      return deps.owner.question(actor.accountId, id);
    },
  };
}

export type FatwaAskService = ReturnType<typeof createFatwaAskService>;
