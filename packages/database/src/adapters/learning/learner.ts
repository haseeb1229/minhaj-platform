import 'server-only';

import { randomUUID } from 'node:crypto';

import type { Locale } from '@minhaj/contracts';
import {
  LEARNING_PAGE,
  type LearnerPath,
  type LearnerPort,
} from '@minhaj/contracts/learning';

import { getDatabaseClient } from '../../client.ts';
import {
  COURSE_DETAIL_SELECT,
  COURSE_LISTING_SELECT,
  PUBLIC_PATH_LISTING_SELECT,
  toCourseDetail,
  toCourseListing,
  toPathListing,
  type CourseListingRow,
  type PathListingRow,
} from './records.ts';
import {
  boundedOffset,
  isUniqueViolation,
  LearningDataError,
  PUBLISHED,
  refusalNumber,
  refuse,
  type Client,
} from './shared.ts';

/**
 * A learner's OWN Enrolments, Progress and trial-class requests
 * (DOMAIN_MODEL.md §13.3–13.5).
 *
 * THE ACCOUNT IS IN EVERY PREDICATE. Each method takes the account it acts for,
 * and every statement below carries that account in its own WHERE — the
 * primary defence against horizontal escalation (SECURITY_BASELINE.md §3.4
 * rule 4). Somebody else's Enrolment answers exactly like a missing one; no
 * staff key reaches this surface, and nothing here returns another account.
 *
 * STUDY BEGINS ONLY ON A PUBLISHED COURSE, decided under a lock the Course's
 * own lifecycle change must wait for. An enrolment, a completion or a trial
 * request first reads the Course's state WITH (HOLDLOCK) — a shared lock held
 * to commit — so a concurrent withdrawal, whose claim needs the exclusive lock
 * on the same row, waits until the act has committed or seen the withdrawal.
 * The migration's triggers (51275–51277) are the floor beneath that read.
 *
 * IDEMPOTENT AND MONOTONIC. A second enrolment is the first; a lesson completed
 * twice keeps its FIRST instant; a second trial request is the first. A
 * uniqueness collision with one's own twin is that idempotent answer, decided
 * OUTSIDE the failed transaction by confirming the row exists.
 */

/** How many paths and trial requests one learner's page shows. */
const LEARNER_PATHS = 50;
const LEARNER_TRIALS = 100;

/** The Course's state and format, read under a shared lock held to commit. */
async function lockedCourse(
  tx: Client,
  courseId: string,
): Promise<{ readonly state: string; readonly format: string } | null> {
  const [row] = await tx.$queryRaw<{ state: string; format: string }[]>`
    SELECT [state], [format] FROM [dbo].[Course] WITH (HOLDLOCK, ROWLOCK)
    WHERE [id] = ${courseId}`;
  return row ?? null;
}

/** Completed lessons per Course, for one account, in ONE statement for a page. */
async function completedByCourse(
  db: Client,
  userId: string,
  courseIds: readonly string[],
): Promise<ReadonlyMap<string, number>> {
  if (courseIds.length === 0) return new Map();
  const rows = await db.lessonProgress.groupBy({
    by: ['courseId'],
    where: { userId, courseId: { in: [...new Set(courseIds)] } },
    _count: { lessonId: true },
  });
  return new Map(rows.map((row) => [row.courseId, row._count.lessonId]));
}

interface LearnerPathRow extends PathListingRow {
  readonly courses: readonly {
    readonly course: CourseListingRow & {
      readonly enrolments: readonly { readonly courseId: string }[];
    };
  }[];
}

/** A path's select as one account stands on it: its own Enrolments only. */
function learnerPathSelect(userId: string) {
  return {
    ...PUBLIC_PATH_LISTING_SELECT,
    courses: {
      where: { course: PUBLISHED },
      orderBy: [{ position: 'asc' as const }, { courseId: 'asc' as const }],
      select: {
        course: {
          select: {
            ...COURSE_LISTING_SELECT,
            enrolments: { where: { userId }, select: { courseId: true } },
          },
        },
      },
    },
  };
}

function learnerPathOf(
  row: LearnerPathRow,
  completed: ReadonlyMap<string, number>,
): LearnerPath {
  return {
    path: toPathListing(row),
    courses: row.courses.map(({ course }) => ({
      course: toCourseListing(course),
      enrolled: course.enrolments.length > 0,
      completedLessons: completed.get(course.id) ?? 0,
    })),
  };
}

export function createLearner(): LearnerPort {
  const db = getDatabaseClient();

  /** After a uniqueness collision: is the account's row there now? */
  async function confirmed(
    error: unknown,
    exists: () => Promise<number>,
  ): Promise<boolean | null> {
    if (!isUniqueViolation(error)) return null;
    if ((await exists()) > 0) return true;
    throw new LearningDataError('conflict');
  }

  return {
    async enrol(userId, courseId) {
      try {
        return await db.$transaction(async (tx) => {
          const course = await lockedCourse(tx, courseId);
          if (course?.state !== 'published') return false;
          if ((await tx.enrolment.count({ where: { userId, courseId } })) > 0)
            return true;
          await tx.enrolment.create({
            data: { userId, courseId, enrolledAt: new Date() },
          });
          return true;
        });
      } catch (error) {
        const twin = await confirmed(error, () =>
          db.enrolment.count({ where: { userId, courseId } }),
        );
        if (twin !== null) return twin;
        if (refusalNumber(error) !== null) return false;
        refuse(error);
      }
    },

    /** Progress first — it hangs off the Enrolment — and nothing cascades. */
    async leave(userId, courseId) {
      try {
        await db.$transaction(async (tx) => {
          await tx.lessonProgress.deleteMany({ where: { userId, courseId } });
          await tx.enrolment.deleteMany({ where: { userId, courseId } });
        });
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * Under the Course's shared lock the syllabus is frozen (it is published),
     * so a lesson cannot be removed or moved to another Course between the
     * check and the insert. A lesson that is not THIS Course's — a forged pair
     * — answers `unavailable`, exactly like a lesson that does not exist; the
     * composite foreign key refuses it again regardless. A key refusal after
     * the checks can then only be the Enrolment leaving concurrently:
     * `not-enrolled`.
     */
    async completeLesson(userId, courseId, lessonId) {
      try {
        return await db.$transaction(async (tx) => {
          const course = await lockedCourse(tx, courseId);
          if (course?.state !== 'published') return 'unavailable' as const;
          if ((await tx.enrolment.count({ where: { userId, courseId } })) === 0)
            return 'not-enrolled' as const;
          if ((await tx.lesson.count({ where: { id: lessonId, courseId } })) === 0)
            return 'unavailable' as const;
          // MONOTONIC: an existing completion keeps its first instant.
          if ((await tx.lessonProgress.count({ where: { userId, lessonId } })) === 0)
            await tx.lessonProgress.create({
              data: { userId, courseId, lessonId, completedAt: new Date() },
            });
          return 'recorded' as const;
        });
      } catch (error) {
        const twin = await confirmed(error, () =>
          db.lessonProgress.count({ where: { userId, courseId, lessonId } }),
        );
        if (twin !== null) return 'recorded';
        if (refusalNumber(error) !== null) return 'unavailable';
        const code = (error as { code?: unknown } | null)?.code;
        if (code === 'P2003') return 'not-enrolled';
        refuse(error);
      }
    },

    async courses(userId, offset) {
      const rows = await db.enrolment.findMany({
        where: { userId },
        select: { enrolledAt: true, course: { select: COURSE_LISTING_SELECT } },
        orderBy: [{ enrolledAt: 'desc' }, { courseId: 'asc' }],
        skip: boundedOffset(offset),
        take: LEARNING_PAGE + 1,
      });
      const page = rows.slice(0, LEARNING_PAGE);
      const completed = await completedByCourse(
        db,
        userId,
        page.map((row) => row.course.id),
      );
      return {
        items: page.map((row) => ({
          course: toCourseListing(row.course),
          available: row.course.state === 'published',
          enrolledAt: row.enrolledAt,
          completedLessons: completed.get(row.course.id) ?? 0,
        })),
        hasMore: rows.length > LEARNING_PAGE,
      };
    },

    /** By the CURRENT slug, and only through the account's own Enrolment. */
    async course(userId, slug) {
      const row = await db.enrolment.findFirst({
        where: { userId, course: { slug } },
        select: { enrolledAt: true, course: { select: COURSE_DETAIL_SELECT } },
      });
      if (row === null) return null;
      const progress = await db.lessonProgress.findMany({
        where: { userId, courseId: row.course.id },
        select: { lessonId: true },
        orderBy: { lessonId: 'asc' },
      });
      return {
        course: toCourseDetail(row.course),
        available: row.course.state === 'published',
        enrolledAt: row.enrolledAt,
        completedLessonIds: progress.map((entry) => entry.lessonId),
      };
    },

    /**
     * A lesson's BODY — the one learner read that carries it — only for an
     * account enrolled on the Course, while the Course is published. Both
     * conditions and the Course are in the ONE predicate.
     */
    async lesson(userId, courseId, lessonId) {
      const row = await db.lesson.findFirst({
        where: {
          id: lessonId,
          courseId,
          module: { course: { ...PUBLISHED, enrolments: { some: { userId } } } },
        },
        select: {
          id: true,
          courseId: true,
          moduleId: true,
          position: true,
          labels: {
            select: { locale: true, title: true, summary: true, body: true },
            orderBy: { locale: 'asc' },
          },
        },
      });
      return row === null
        ? null
        : {
            ...row,
            labels: row.labels.map((label) => ({
              ...label,
              locale: label.locale as Locale,
            })),
          };
    },

    /** Paths DERIVED from the account's own Enrolments — there is no PathEnrolment. */
    async paths(userId) {
      const rows = await db.learningPath.findMany({
        where: {
          ...PUBLISHED,
          courses: {
            some: { course: { ...PUBLISHED, enrolments: { some: { userId } } } },
          },
        },
        select: learnerPathSelect(userId),
        orderBy: [{ slug: 'asc' }, { id: 'asc' }],
        take: LEARNER_PATHS,
      });
      const completed = await completedByCourse(
        db,
        userId,
        rows.flatMap((row) => row.courses.map((place) => place.course.id)),
      );
      return rows.map((row) => learnerPathOf(row, completed));
    },

    /** Any account may stand on a published path, enrolled or not. */
    async path(userId, slug) {
      const row = await db.learningPath.findFirst({
        where: { slug, ...PUBLISHED },
        select: learnerPathSelect(userId),
      });
      if (row === null) return null;
      const completed = await completedByCourse(
        db,
        userId,
        row.courses.map((place) => place.course.id),
      );
      return learnerPathOf(row, completed);
    },

    async courseState(userId, courseId) {
      const [enrolled, requested] = await Promise.all([
        db.enrolment.count({ where: { userId, courseId } }),
        db.trialClassRequest.count({ where: { userId, courseId } }),
      ]);
      return { enrolled: enrolled > 0, trialRequested: requested > 0 };
    },

    /**
     * A REQUEST ONLY, on a published `live` Course, decided under the Course's
     * shared lock. It reserves no teacher, names no time and books nothing.
     */
    async requestTrial(userId, courseId) {
      try {
        return await db.$transaction(async (tx) => {
          const course = await lockedCourse(tx, courseId);
          if (course?.state !== 'published' || course.format !== 'live') return false;
          if ((await tx.trialClassRequest.count({ where: { userId, courseId } })) > 0)
            return true;
          await tx.trialClassRequest.create({
            data: { id: randomUUID(), userId, courseId, requestedAt: new Date() },
          });
          return true;
        });
      } catch (error) {
        const twin = await confirmed(error, () =>
          db.trialClassRequest.count({ where: { userId, courseId } }),
        );
        if (twin !== null) return twin;
        if (refusalNumber(error) !== null) return false;
        refuse(error);
      }
    },

    async withdrawTrial(userId, courseId) {
      try {
        await db.trialClassRequest.deleteMany({ where: { userId, courseId } });
      } catch (error) {
        refuse(error);
      }
    },

    async trials(userId) {
      const rows = await db.trialClassRequest.findMany({
        where: { userId },
        select: {
          id: true,
          requestedAt: true,
          course: { select: COURSE_LISTING_SELECT },
        },
        orderBy: [{ requestedAt: 'desc' }, { id: 'asc' }],
        take: LEARNER_TRIALS,
      });
      return rows.map((row) => ({
        id: row.id,
        course: toCourseListing(row.course),
        requestedAt: row.requestedAt,
      }));
    },
  };
}
