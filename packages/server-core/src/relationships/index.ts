import 'server-only';

import {
  CURRENT_TEACHERS_MAX,
  TEACHING_STANDING_BATCH,
  enrolmentKey,
  type CurrentTeacher,
  type LearningLiveTeachingPort,
  type LearningRelationshipReaderPort,
  type LearningRelationshipService,
  type TeachingStanding,
  type TeachingStandingQuery,
} from '@minhaj/contracts/learning';

/**
 * THE current teaching relationship — Learning's, hosted here.
 *
 * OWNERSHIP. `packages/server-core` is a server-only HOST, not an owner. The
 * definition below — what makes a teacher and a learner CURRENTLY related on a
 * Course — is Learning's, and only Learning may change it; placing it here
 * changes where it is exported from, nothing else (ARCHITECTURE.md §3.1, the
 * `relationships/` directory named there).
 *
 * WHY IT IS HERE NOW. Messaging decides every conversation access from this
 * answer (DOMAIN_MODEL.md §15.3), and the Phase-25 realtime transport must
 * reach the same decision through the same code on every event. §3.1.3 admits
 * it ahead of that second process for exactly that reason.
 *
 * WHAT IT HOLDS. Learning's narrow relationship reader and Identity's live
 * `teaching.perform` answer, both injected at Layer 4. No Prisma, no database
 * package, no Messaging import: Learning never depends on Messaging.
 *
 * LIVE, EVERY TIME. Each call re-reads the activation, Identity's assignments
 * and Learning's scopes and Enrolments. Nothing is cached between calls, so a
 * revoked assignment, an ended scope, an unpublished Course or a withdrawn
 * learner answers `false` on the very next one.
 */

export interface LearningRelationshipDependencies {
  readonly reader: LearningRelationshipReaderPort;
  readonly identity: LearningLiveTeachingPort;
}

const NONE: TeachingStanding = Object.freeze({ teacher: false, learner: false });

export function createLearningRelationshipService({
  reader,
  identity,
}: LearningRelationshipDependencies): LearningRelationshipService {
  return {
    async standing(
      queries: readonly TeachingStandingQuery[],
    ): Promise<readonly TeachingStanding[]> {
      if (queries.length > TEACHING_STANDING_BATCH) {
        throw new RangeError(
          `At most ${String(TEACHING_STANDING_BATCH)} relationships per question.`,
        );
      }
      if (queries.length === 0) return [];
      // INACTIVE MEANS NOBODY. Without live learning there is no teaching
      // relationship at all, so every half is false.
      if (!(await reader.activated())) return queries.map(() => NONE);

      // One Identity read per DISTINCT teacher, and one scope read per teacher
      // naming only the Courses asked about — never a per-query round trip.
      const coursesByTeacher = new Map<string, Set<string>>();
      for (const query of queries) {
        const courses = coursesByTeacher.get(query.teacherAccountId) ?? new Set<string>();
        courses.add(query.courseId);
        coursesByTeacher.set(query.teacherAccountId, courses);
      }
      const teaching = new Map<string, ReadonlySet<string>>();
      for (const [teacherAccountId, courses] of coursesByTeacher) {
        const assignmentIds = await identity.liveTeachingAssignments(teacherAccountId);
        // No live assignment: no scope can be current, whatever its row says.
        if (assignmentIds.length === 0) {
          teaching.set(teacherAccountId, new Set());
          continue;
        }
        const current = await reader.teachingCourses({
          teacherAccountId,
          assignmentIds,
          courseIds: [...courses],
        });
        teaching.set(teacherAccountId, new Set(current));
      }

      const enrolled = new Set(
        await reader.enrolments(
          queries.map((query) => ({
            learnerAccountId: query.learnerAccountId,
            courseId: query.courseId,
          })),
        ),
      );

      return queries.map((query) => ({
        teacher: teaching.get(query.teacherAccountId)?.has(query.courseId) ?? false,
        learner: enrolled.has(enrolmentKey(query.learnerAccountId, query.courseId)),
      }));
    },

    async currentTeachers(learnerAccountId: string): Promise<readonly CurrentTeacher[]> {
      if (!(await reader.activated())) return [];
      const scopes = (await reader.scopesForLearner(learnerAccountId)).slice(
        0,
        CURRENT_TEACHERS_MAX,
      );
      const live = new Map<string, ReadonlySet<string>>();
      const current: CurrentTeacher[] = [];
      for (const scope of scopes) {
        let assignments = live.get(scope.teacherAccountId);
        if (assignments === undefined) {
          assignments = new Set(
            await identity.liveTeachingAssignments(scope.teacherAccountId),
          );
          live.set(scope.teacherAccountId, assignments);
        }
        // A scope is current only under an assignment Identity reports live NOW.
        if (
          assignments.has(scope.roleAssignmentId) &&
          scope.teacherAccountId !== learnerAccountId
        ) {
          current.push({
            teacherAccountId: scope.teacherAccountId,
            courseId: scope.courseId,
          });
        }
      }
      return current;
    },
  };
}
