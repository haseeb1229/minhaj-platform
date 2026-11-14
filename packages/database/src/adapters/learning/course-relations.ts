import 'server-only';

import {
  COURSE_PATHS,
  COURSE_RELATED,
  type LearningPublicReaderPort,
} from '@minhaj/contracts/learning';

import { getDatabaseClient } from '../../client.ts';
import {
  COURSE_LISTING_SELECT,
  PUBLIC_PATH_LISTING_SELECT,
  toCourseListing,
  toPathListing,
} from './records.ts';
import { PUBLISHED } from './shared.ts';

/**
 * LEARN PART 1 — WHERE ONE PUBLISHED COURSE STANDS, for its own public page:
 * the published LearningPaths holding it (and its step on each), and the other
 * published Courses studied with it.
 *
 * THE PUBLIC PREDICATE AT EVERY STEP. Nothing is read unless the Course itself
 * is published; a path is named only while published, a step counts only the
 * path's published Courses, and a related Course is only ever a published one
 * — stated in the SQL that ranks it AND in the read that loads its card, so an
 * error in the ranking statement could only drop a Course, never admit one.
 * Every value is a bound parameter; the only SQL text is this module's own.
 *
 * "STUDIED WITH" IS WHAT THE CATALOGUE RECORDS, nothing inferred: another
 * Course sharing a Topic with this one, or a published LearningPath. The more
 * it shares, the earlier it comes; then the latest publication, the slug and
 * the identifier, so the order is total.
 *
 * NOTHING PRIVATE IS READ: no Enrolment, Progress, request, class or lesson
 * body — a card is the catalogue's `COURSE_LISTING_SELECT`.
 */
export function createCourseRelationsReader(): Pick<
  LearningPublicReaderPort,
  'courseRelations'
> {
  const db = getDatabaseClient();

  return {
    async courseRelations(courseId) {
      const course = await db.course.findFirst({
        where: { id: courseId, ...PUBLISHED },
        select: { id: true },
      });
      if (course === null) return { paths: [], related: [] };

      const [paths, ranked] = await Promise.all([
        db.learningPath.findMany({
          where: { ...PUBLISHED, courses: { some: { courseId } } },
          select: {
            ...PUBLIC_PATH_LISTING_SELECT,
            courses: {
              where: { course: PUBLISHED },
              select: { courseId: true },
              orderBy: [{ position: 'asc' }, { courseId: 'asc' }],
            },
          },
          orderBy: [{ publishedAt: 'desc' }, { slug: 'asc' }, { id: 'asc' }],
          take: COURSE_PATHS,
        }),
        db.$queryRaw<{ id: string }[]>`
          SELECT TOP (${COURSE_RELATED}) c.[id]
          FROM [dbo].[Course] c
          CROSS APPLY (
            SELECT (SELECT COUNT(*) FROM [dbo].[CourseTopic] a
                    JOIN [dbo].[CourseTopic] b ON b.[topicId] = a.[topicId]
                    WHERE a.[courseId] = ${courseId} AND b.[courseId] = c.[id])
                 + (SELECT COUNT(*) FROM [dbo].[LearningPathCourse] p
                    JOIN [dbo].[LearningPath] lp
                      ON lp.[id] = p.[pathId] AND lp.[state] = N'published'
                    JOIN [dbo].[LearningPathCourse] q ON q.[pathId] = p.[pathId]
                    WHERE p.[courseId] = ${courseId} AND q.[courseId] = c.[id]) AS [shared]
          ) s
          WHERE c.[state] = N'published' AND c.[id] <> ${courseId} AND s.[shared] > 0
          ORDER BY s.[shared] DESC, c.[publishedAt] DESC, c.[slug] ASC, c.[id] ASC;`,
      ]);

      const ids = ranked.map((row) => row.id);
      const cards =
        ids.length === 0
          ? []
          : await db.course.findMany({
              where: { id: { in: ids }, ...PUBLISHED },
              select: COURSE_LISTING_SELECT,
            });
      const byId = new Map(cards.map((row) => [row.id, toCourseListing(row)]));

      return {
        paths: paths.flatMap((row) => {
          const step = row.courses.findIndex((place) => place.courseId === courseId);
          return step < 0 ? [] : [{ path: toPathListing(row), step: step + 1 }];
        }),
        related: ids.flatMap((id) => {
          const card = byId.get(id);
          return card === undefined ? [] : [card];
        }),
      };
    },
  };
}
