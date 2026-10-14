import 'server-only';

import { z } from 'zod';

import {
  applyPathChange,
  courseInputSchema,
  learningAdminQuerySchema,
  learningIdSchema,
  learningTransitionSchema,
  learningVersionSchema,
  lessonChangeSchema,
  moduleChangeSchema,
  pathChangeSchema,
  pathInputSchema,
  type LearningActor,
  type LearningAuthorityPort,
  type LearningPersistencePort,
  type LearningReferencesPort,
} from '@minhaj/contracts/learning';

import {
  asLearningRefusal,
  isLearningRefusalReason,
  LearningRefusal,
} from './refusal.ts';

/**
 * The Learning administrative service — the catalogue of Courses, their modules
 * and lessons, and LearningPaths (DELIVERY_PLAN.md Phase 22).
 *
 * TWO AUTHORITIES, RE-CHECKED LIVE ON EVERY CALL. `learning.read` opens a
 * record and the counts of who is enrolled; `learning.administer` is what every
 * change requires. The check reads the principal's CURRENT permission set, so a
 * revoked role refuses the next action rather than the next sign-in
 * (SECURITY_BASELINE.md §3.4 rule 2).
 *
 * NO TEACHER AUTHORITY, NO LEARNER. A Course's teachers are public attribution
 * to People and are never consulted for anything; nothing here can confirm a
 * trial class, edit a learner's progress or see who enrolled.
 *
 * EVERY INPUT IS PARSED HERE, by strict schemas, and REFERENCES ARE ASKED OF
 * THEIR OWNERS: a teacher must be a published People contributor, a topic an
 * active Taxonomy topic and a content language an active Taxonomy language —
 * answered at Layer 4, never by a Learning query against another context.
 */

export function createLearningService(deps: {
  readonly persistence: LearningPersistencePort;
  readonly authority: LearningAuthorityPort;
  readonly references: LearningReferencesPort;
}) {
  const store = deps.persistence;
  const run = <T>(work: Promise<T>): Promise<T> => work.catch(asLearningRefusal);

  async function permit(
    actor: LearningActor,
    key: 'learning.read' | 'learning.administer',
  ): Promise<void> {
    if (!actor?.accountId || !(await deps.authority.permits(actor.accountId, key)))
      throw new LearningRefusal('denied');
  }

  /** An edit names a record and its expected version; a create names neither. */
  function edit(id: string | null, version: number | null): void {
    if (id !== null) {
      learningIdSchema.parse(id);
      learningVersionSchema.parse(version);
    } else if (version !== null) throw new LearningRefusal('invalid');
  }

  const offset = (value: number) => z.number().int().min(0).max(25_000).parse(value);
  const choiceText = (text: string | null) => {
    const query = z.string().trim().min(1).max(120).safeParse(text);
    return query.success ? query.data : null;
  };

  return {
    async courses(actor: LearningActor, raw: unknown = {}) {
      await permit(actor, 'learning.read');
      return run(store.courses(learningAdminQuerySchema.parse(raw)));
    },

    async course(actor: LearningActor, id: string) {
      await permit(actor, 'learning.read');
      return run(store.course(learningIdSchema.parse(id)));
    },

    async lesson(actor: LearningActor, id: string) {
      await permit(actor, 'learning.read');
      return run(store.lesson(learningIdSchema.parse(id)));
    },

    async saveCourse(
      actor: LearningActor,
      id: string | null,
      expectedVersion: number | null,
      raw: unknown,
    ) {
      await permit(actor, 'learning.administer');
      edit(id, expectedVersion);
      const value = courseInputSchema.parse(raw);
      const checks = await Promise.all([
        deps.references.validPeople(value.teacherIds),
        deps.references.validTopics(value.topicIds),
        deps.references.validLanguage(value.languageCode),
      ]);
      if (checks.includes(false)) throw new LearningRefusal('invalid');
      return run(
        store.saveCourse({ actorId: actor.accountId, id, expectedVersion, value }),
      );
    },

    /**
     * Publish, return to draft or archive. The rules that decide it — a complete
     * syllabus to publish, no published path holding the Course to leave
     * publication — are evaluated by the adapter under the Course's own lock,
     * where a concurrent change cannot slip between the check and the write.
     */
    async transitionCourse(
      actor: LearningActor,
      id: string,
      expectedVersion: number,
      state: unknown,
    ) {
      await permit(actor, 'learning.administer');
      return run(
        store.transitionCourse({
          actorId: actor.accountId,
          id: learningIdSchema.parse(id),
          expectedVersion: learningVersionSchema.parse(expectedVersion),
          state: learningTransitionSchema.parse(state),
        }),
      );
    },

    /** One named module change, applied to the syllabus the operator was shown. */
    async changeModule(
      actor: LearningActor,
      courseId: string,
      expectedVersion: number,
      raw: unknown,
    ) {
      await permit(actor, 'learning.administer');
      return run(
        store.changeModule({
          actorId: actor.accountId,
          courseId: learningIdSchema.parse(courseId),
          expectedVersion: learningVersionSchema.parse(expectedVersion),
          change: moduleChangeSchema.parse(raw),
        }),
      );
    },

    /** One named lesson change, by the same rules. */
    async changeLesson(
      actor: LearningActor,
      courseId: string,
      expectedVersion: number,
      raw: unknown,
    ) {
      await permit(actor, 'learning.administer');
      return run(
        store.changeLesson({
          actorId: actor.accountId,
          courseId: learningIdSchema.parse(courseId),
          expectedVersion: learningVersionSchema.parse(expectedVersion),
          change: lessonChangeSchema.parse(raw),
        }),
      );
    },

    /** Published Courses an operator may add to a LearningPath. */
    async courseChoices(actor: LearningActor, text: string | null) {
      await permit(actor, 'learning.administer');
      return run(store.courseChoices(choiceText(text)));
    },

    async paths(actor: LearningActor, raw: unknown = {}) {
      await permit(actor, 'learning.read');
      return run(store.paths(learningAdminQuerySchema.parse(raw)));
    },

    async path(actor: LearningActor, id: string) {
      await permit(actor, 'learning.read');
      return run(store.path(learningIdSchema.parse(id)));
    },

    async savePath(
      actor: LearningActor,
      id: string | null,
      expectedVersion: number | null,
      raw: unknown,
    ) {
      await permit(actor, 'learning.administer');
      edit(id, expectedVersion);
      return run(
        store.savePath({
          actorId: actor.accountId,
          id,
          expectedVersion,
          value: pathInputSchema.parse(raw),
        }),
      );
    },

    async transitionPath(
      actor: LearningActor,
      id: string,
      expectedVersion: number,
      state: unknown,
    ) {
      await permit(actor, 'learning.administer');
      return run(
        store.transitionPath({
          actorId: actor.accountId,
          id: learningIdSchema.parse(id),
          expectedVersion: learningVersionSchema.parse(expectedVersion),
          state: learningTransitionSchema.parse(state),
        }),
      );
    },

    /**
     * One named change to a LearningPath's order, computed from current state
     * ONLY if that state is the version the operator saw; the adapter then
     * claims that same version atomically, so a concurrent change is a conflict
     * rather than something this one silently reorders or drops.
     */
    async changePath(
      actor: LearningActor,
      pathId: string,
      expectedVersion: number,
      raw: unknown,
    ) {
      await permit(actor, 'learning.administer');
      const id = learningIdSchema.parse(pathId);
      const version = learningVersionSchema.parse(expectedVersion);
      const change = pathChangeSchema.parse(raw);

      const current = await run(store.path(id));
      if (current === null) throw new LearningRefusal('not-found');
      if (current.version !== version) throw new LearningRefusal('conflict');

      const outcome = applyPathChange(
        current.members.map((course) => course.id),
        change,
      );
      if ('refusal' in outcome)
        throw new LearningRefusal(
          isLearningRefusalReason(outcome.refusal) ? outcome.refusal : 'invalid',
        );

      return run(
        store.setPathCourses({
          actorId: actor.accountId,
          pathId: id,
          expectedVersion: version,
          courseIds: outcome.courseIds,
          change: change.op,
        }),
      );
    },

    /** How many are enrolled on each Course — counts, never who. */
    async enrolmentSummary(actor: LearningActor, start = 0) {
      await permit(actor, 'learning.read');
      return run(store.enrolmentSummary(offset(start)));
    },

    /** How many trial-class requests each live Course holds — counts, never who. */
    async trialSummary(actor: LearningActor, start = 0) {
      await permit(actor, 'learning.read');
      return run(store.trialSummary(offset(start)));
    },
  };
}

export type LearningService = ReturnType<typeof createLearningService>;
