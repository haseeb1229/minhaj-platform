import 'server-only';

import {
  classIdSchema,
  classVersionSchema,
  learningAccountIdSchema,
  type ClassLearnerPort,
  type LearningActivationPort,
  type LearningActor,
} from '@minhaj/contracts/learning';
import type { RateLimiterPort } from '@minhaj/contracts/platform';

import { LEARNER_WRITE_RULE, type LearningLimitKey } from './learner-service.ts';
import { asLearningRefusal, LearningRefusal } from './refusal.ts';

/**
 * My Classes and My Teachers — a person's OWN classes (ROUTE_MAP.md §5.1;
 * DELIVERY_PLAN.md Phase 23).
 *
 * THE ACCOUNT IS THE SESSION'S, NEVER THE REQUEST'S, and the adapter carries
 * it in every predicate: a class the person may attend is one on a Course
 * they are enrolled on NOW, or the single-participant trial their own
 * confirmed Booking holds. Another learner's class answers exactly like one
 * that does not exist, and no identifier a form supplies can widen that.
 *
 * ONE DOOR FOR THE MEETING ADDRESS. `meetingUrl` is the only read that
 * returns it, and only while live learning is activated, the session is
 * scheduled, its teacher's scope is current and the person is a current
 * participant. A cancelled Booking, a withdrawn Enrolment or a replaced
 * teacher closes that door on the next request.
 *
 * A LEARNER CANCELS ONLY THEIR OWN TRIAL. There is deliberately no operation
 * here that touches a regular Course session: that is the teacher's or an
 * operator's act, because it is everybody's class.
 */
export function createClassLearnerService(deps: {
  readonly classes: ClassLearnerPort;
  readonly activation: LearningActivationPort;
  readonly limiter: RateLimiterPort;
  readonly key: LearningLimitKey;
  readonly clock?: () => Date;
}) {
  const store = deps.classes;
  const now = deps.clock ?? (() => new Date());
  const run = <T>(work: Promise<T>): Promise<T> => work.catch(asLearningRefusal);

  function account(actor: LearningActor): string {
    const parsed = learningAccountIdSchema.safeParse(actor?.accountId);
    if (!parsed.success) throw new LearningRefusal('denied');
    return parsed.data;
  }

  const offset = (value: number) =>
    Number.isInteger(value) && value >= 0 && value <= 25_000 ? value : 0;

  return {
    /** Whether live learning is activated — the honest state My Classes shows. */
    activated(): Promise<boolean> {
      return deps.activation.activeMode().then((mode) => mode !== null);
    },

    async upcoming(actor: LearningActor) {
      return run(store.upcoming(account(actor), now()));
    },

    async past(actor: LearningActor, start = 0) {
      return run(store.past(account(actor), now(), offset(start)));
    },

    async session(actor: LearningActor, sessionId: string) {
      const accountId = account(actor);
      const id = classIdSchema.safeParse(sessionId);
      return id.success ? run(store.session(accountId, id.data)) : null;
    },

    /** The meeting address, under the disclosure rule; `null` whenever any condition fails. */
    async meetingUrl(actor: LearningActor, sessionId: string) {
      const accountId = account(actor);
      const id = classIdSchema.safeParse(sessionId);
      if (!id.success) return null;
      if ((await deps.activation.activeMode()) === null) return null;
      return run(store.meetingUrl(accountId, id.data));
    },

    /** Cancels the person's own confirmed future trial Booking. */
    async cancelBooking(
      actor: LearningActor,
      bookingId: string,
      expectedVersion: number,
    ) {
      const accountId = account(actor);
      const decision = await deps.limiter.consume(
        deps.key('learning-write', accountId),
        LEARNER_WRITE_RULE,
      );
      if (!decision.allowed) throw new LearningRefusal('rate-limited');
      return run(
        store.cancelBooking({
          accountId,
          bookingId: classIdSchema.parse(bookingId),
          expectedVersion: classVersionSchema.parse(expectedVersion),
        }),
      );
    },

    async teachers(actor: LearningActor) {
      return run(store.teachers(account(actor), now()));
    },
  };
}

export type ClassLearnerService = ReturnType<typeof createClassLearnerService>;
