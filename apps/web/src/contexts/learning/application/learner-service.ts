import 'server-only';

import { z } from 'zod';

import {
  learningAccountIdSchema,
  learningIdSchema,
  learningSlugSchema,
  type LearnerPort,
  type LearningActor,
} from '@minhaj/contracts/learning';
import type { RateLimitRule, RateLimiterPort } from '@minhaj/contracts/platform';

import { asLearningRefusal, LearningRefusal } from './refusal.ts';

/** A purpose-scoped, digested limiter key, built at Layer 4. */
export type LearningLimitKey = (purpose: string, subject: string) => string;

/** Every learner write — enrol, leave, complete, request, withdraw — per account. */
export const LEARNER_WRITE_RULE: RateLimitRule = Object.freeze({
  window: 3_600,
  max: 300,
});

/**
 * A person's OWN Learning: their Enrolments, lesson Progress and trial-class
 * requests (DELIVERY_PLAN.md Phase 22).
 *
 * THE ACCOUNT IS THE SESSION'S, NEVER THE REQUEST'S. Every method takes the
 * actor Layer 4 resolved from the session, and the adapter carries that account
 * in every query's own predicate, so a guessed Course or lesson identifier
 * reaches only the caller's own rows — another person's Enrolment answers
 * exactly like one that does not exist (SECURITY_BASELINE.md §3.4 rule 4).
 *
 * THREE DISTINCT ACTS, NEVER CONFLATED. Enrolling makes the person a member of
 * a Course. Requesting a trial class records a request on a live Course — it
 * enrols nobody, reserves no teacher, names no time and books nothing; a
 * request is never a confirmed class. Completing a lesson is an explicit act on
 * a Course the person is enrolled on, never inferred from a page view.
 *
 * NO STAFF PATH EXISTS. No permission reaches any method here, and nothing
 * here can write another account's state.
 */
export function createLearnerService(deps: {
  readonly learner: LearnerPort;
  readonly limiter: RateLimiterPort;
  readonly key: LearningLimitKey;
}) {
  const store = deps.learner;
  const run = <T>(work: Promise<T>): Promise<T> => work.catch(asLearningRefusal);

  function account(actor: LearningActor): string {
    const parsed = learningAccountIdSchema.safeParse(actor?.accountId);
    if (!parsed.success) throw new LearningRefusal('denied');
    return parsed.data;
  }

  async function spend(accountId: string): Promise<void> {
    const decision = await deps.limiter.consume(
      deps.key('learning-write', accountId),
      LEARNER_WRITE_RULE,
    );
    if (!decision.allowed) throw new LearningRefusal('rate-limited');
  }

  const offset = (value: number) =>
    Number.isInteger(value) && value >= 0 && value <= 25_000 ? value : 0;

  return {
    /** Enrols on a Course published NOW. Idempotent. */
    async enrol(actor: LearningActor, courseId: string): Promise<void> {
      const accountId = account(actor);
      const course = learningIdSchema.parse(courseId);
      await spend(accountId);
      if (!(await run(store.enrol(accountId, course))))
        throw new LearningRefusal('course-unavailable');
    },

    /** Leaves a Course, removing the person's own Progress on it. Idempotent. */
    async leave(actor: LearningActor, courseId: string): Promise<void> {
      const accountId = account(actor);
      const course = learningIdSchema.parse(courseId);
      await spend(accountId);
      await run(store.leave(accountId, course));
    },

    /** Marks one lesson complete. Idempotent; nothing un-completes it. */
    async completeLesson(
      actor: LearningActor,
      courseId: string,
      lessonId: string,
    ): Promise<void> {
      const accountId = account(actor);
      const course = learningIdSchema.parse(courseId);
      const lesson = learningIdSchema.parse(lessonId);
      await spend(accountId);
      const outcome = await run(store.completeLesson(accountId, course, lesson));
      if (outcome === 'not-enrolled') throw new LearningRefusal('not-enrolled');
      if (outcome === 'unavailable') throw new LearningRefusal('course-unavailable');
    },

    async courses(actor: LearningActor, start = 0) {
      return run(store.courses(account(actor), offset(start)));
    },

    /** One Course the person is enrolled on, by its current slug; `null` otherwise. */
    async course(actor: LearningActor, slug: string) {
      const accountId = account(actor);
      if (!learningSlugSchema.safeParse(slug).success) return null;
      return run(store.course(accountId, slug));
    },

    /** One lesson's body — only on a published Course the person is enrolled on. */
    async lesson(actor: LearningActor, courseId: string, lessonId: string) {
      const accountId = account(actor);
      const course = learningIdSchema.safeParse(courseId);
      const lesson = learningIdSchema.safeParse(lessonId);
      if (!course.success || !lesson.success) return null;
      return run(store.lesson(accountId, course.data, lesson.data));
    },

    async paths(actor: LearningActor) {
      return run(store.paths(account(actor)));
    },

    async path(actor: LearningActor, slug: string) {
      const accountId = account(actor);
      if (!learningSlugSchema.safeParse(slug).success) return null;
      return run(store.path(accountId, slug));
    },

    async courseState(actor: LearningActor, courseId: string) {
      return run(store.courseState(account(actor), learningIdSchema.parse(courseId)));
    },

    /** Records a trial-class REQUEST on a published live Course. Idempotent. */
    async requestTrial(actor: LearningActor, courseId: string): Promise<void> {
      const accountId = account(actor);
      const course = learningIdSchema.parse(courseId);
      await spend(accountId);
      if (!(await run(store.requestTrial(accountId, course))))
        throw new LearningRefusal('course-unavailable');
    },

    /** Withdraws the person's own request. Idempotent. */
    async withdrawTrial(actor: LearningActor, courseId: string): Promise<void> {
      const accountId = account(actor);
      const course = learningIdSchema.parse(courseId);
      await spend(accountId);
      await run(store.withdrawTrial(accountId, course));
    },

    async trials(actor: LearningActor) {
      return run(store.trials(account(actor)));
    },
  };
}

export type LearnerService = ReturnType<typeof createLearnerService>;

/** A Course identifier from a request body, validated before anything else reads it. */
export const learnerCourseBodySchema = z.object({ courseId: learningIdSchema }).strict();
