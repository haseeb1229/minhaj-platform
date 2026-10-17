import 'server-only';

import {
  CURRENT_TEACHERS_MAX,
  TEACHING_STANDING_BATCH,
  enrolmentKey,
  type LearningRelationshipReaderPort,
} from '@minhaj/contracts/learning';

import { getDatabaseClient } from '../../client.ts';
import { PUBLISHED, refuse } from './shared.ts';

/**
 * Learning's CURRENT-relationship reader (DOMAIN_MODEL.md §3.2, §15.3) — the
 * persistence half of the one fact Messaging may ask Learning.
 *
 * FACTS, NEVER A DECISION. Each method is one bounded read of Learning's own
 * tables; combining the halves, and asking Identity which assignments are live
 * NOW, is the hosted relationship service's job. The live assignment ids it
 * passes are carried in the scope query's own predicate, so a revoked
 * assignment's scope can never answer for it.
 *
 * PUBLISHED IN THE QUERY. A scope or an Enrolment on a Course that is not
 * published is no relationship at all, and the Course state is joined into
 * every statement rather than checked afterwards.
 *
 * NO ACTIVATION GATE HERE BEYOND `activated()`: the service asks it first and
 * answers `false` everywhere when it is off, so every other method is only
 * ever reached on an activated platform.
 */
export function createLearningRelationshipReader(): LearningRelationshipReaderPort {
  const db = getDatabaseClient();

  return {
    async activated() {
      try {
        // The same question `activated` asks, on the owner's single row.
        return (await db.liveLearningActivation.count()) > 0;
      } catch (error) {
        refuse(error);
      }
    },

    async teachingCourses({ teacherAccountId, assignmentIds, courseIds }) {
      const courses = [...new Set(courseIds)].slice(0, TEACHING_STANDING_BATCH);
      const assignments = [...new Set(assignmentIds)].slice(0, TEACHING_STANDING_BATCH);
      // An empty list matches nothing; answering without a query says so.
      if (courses.length === 0 || assignments.length === 0) return [];
      try {
        const rows = await db.courseTeachingAssignment.findMany({
          where: {
            userId: teacherAccountId,
            roleAssignmentId: { in: assignments },
            endedAt: null,
            courseId: { in: courses },
            course: PUBLISHED,
          },
          select: { courseId: true },
          distinct: ['courseId'],
        });
        return rows.map((row) => row.courseId);
      } catch (error) {
        refuse(error);
      }
    },

    async enrolments(pairs) {
      const unique = new Map<string, { learnerAccountId: string; courseId: string }>();
      for (const pair of pairs) {
        if (unique.size >= TEACHING_STANDING_BATCH) break;
        unique.set(enrolmentKey(pair.learnerAccountId, pair.courseId), pair);
      }
      if (unique.size === 0) return [];
      try {
        const rows = await db.enrolment.findMany({
          where: {
            OR: [...unique.values()].map((pair) => ({
              userId: pair.learnerAccountId,
              courseId: pair.courseId,
            })),
            course: PUBLISHED,
          },
          select: { userId: true, courseId: true },
        });
        return rows.map((row) => enrolmentKey(row.userId, row.courseId));
      } catch (error) {
        refuse(error);
      }
    },

    async scopesForLearner(learnerAccountId) {
      try {
        const rows = await db.courseTeachingAssignment.findMany({
          where: {
            endedAt: null,
            course: { ...PUBLISHED, enrolments: { some: { userId: learnerAccountId } } },
          },
          select: { userId: true, courseId: true, roleAssignmentId: true },
          orderBy: [{ userId: 'asc' }, { courseId: 'asc' }, { id: 'asc' }],
          take: CURRENT_TEACHERS_MAX,
        });
        return rows.map((row) => ({
          teacherAccountId: row.userId,
          courseId: row.courseId,
          roleAssignmentId: row.roleAssignmentId,
        }));
      } catch (error) {
        refuse(error);
      }
    },
  };
}
