import 'server-only';

import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';

import type { Locale } from '@minhaj/contracts';
import {
  LEARNING_LIMITS,
  LEARNING_PAGE,
  type CourseDetail,
  type CourseValue,
  type LearningPersistencePort,
  type LessonChange,
  type ModuleChange,
  type PathDetail,
} from '@minhaj/contracts/learning';

import { auditRow } from '../../audit-row.ts';
import { getDatabaseClient } from '../../client.ts';
import { requestSearchIndexing } from '../../search-intent.ts';
import {
  COURSE_DETAIL_SELECT,
  COURSE_LISTING_SELECT,
  courseDetail,
  coursePage,
  DESCRIBED_LABELS,
  listingsByIds,
  PATH_LISTING_SELECT,
  PATH_SELECT,
  pathPage,
  toCourseDetail,
  toCourseListing,
  toPathDetail,
} from './records.ts';
import {
  boundedOffset,
  LearningDataError,
  PUBLISHED,
  RECENTLY_CHANGED,
  refuse,
  textMatch,
  UNMATCHABLE_VERSION,
  type Client,
} from './shared.ts';

/**
 * The Learning catalogue's administration — Courses, their modules and
 * lessons, and LearningPaths (DOMAIN_MODEL.md §13, DELIVERY_PLAN.md Phase 22).
 *
 * OWNED BY THE LEARNING CONTEXT, hosted here (ARCHITECTURE.md §4.1). It is
 * reached only through the Learning service, which re-checks `learning.read`
 * or `learning.administer` live on every call. It reads COUNTS of learners and
 * never a learner: no method returns an account identifier.
 *
 * THE VERSION IS THE LOCK. Every write is ONE transaction that FIRST claims the
 * record's expected version with a conditional update — the serialisation
 * point: of two operators acting on what they were both shown, exactly one
 * proceeds and the other is told it changed — and only then reads, checks and
 * writes under the row lock that claim holds. The row, its replaced sets, its
 * slug reservation (by trigger), its audit entry and its durable search intent
 * commit together or not at all.
 *
 * THE DATABASE IS THE FLOOR. Each rule below — a complete syllabus before
 * publication, a frozen syllabus while published, a published path holding only
 * published Courses — is asked here first, so an operator is told precisely
 * what to do, and is enforced again by the migration's triggers, so no write
 * that slipped past a check can leave the public catalogue broken.
 *
 * LOCK ORDER: COURSE BEFORE PATH. A path's publication and membership changes
 * lock the Courses they will hold (UPDLOCK) BEFORE claiming the path; a
 * Course's own transition claims the Course and only then reads the paths that
 * hold it. Both take the Course first, so neither can wait on the other in a
 * cycle.
 */

/** How many Courses the path editor's chooser offers at once. */
const COURSE_CHOICES = 50;

/* ===========================================================================
 * Claims and checks
 * ========================================================================= */

/** What a claim that changed nothing means: gone, or moved on. */
async function unclaimed(
  tx: Client,
  table: 'course' | 'path',
  id: string,
): Promise<never> {
  const exists =
    table === 'course'
      ? (await tx.course.count({ where: { id } })) > 0
      : (await tx.learningPath.count({ where: { id } })) > 0;
  throw new LearningDataError(exists ? 'conflict' : 'not-found');
}

/**
 * Claims a Course at the version the operator was shown, moving it on — and
 * holding the row's exclusive lock to commit.
 */
async function claimCourse(
  tx: Client,
  id: string,
  expectedVersion: number | null,
): Promise<void> {
  const claimed = await tx.course.updateMany({
    where: { id, version: expectedVersion ?? UNMATCHABLE_VERSION },
    data: { version: { increment: 1 }, updatedAt: new Date() },
  });
  if (claimed.count !== 1) await unclaimed(tx, 'course', id);
}

/**
 * Claims a Course's syllabus for one named change: the expected version, AND
 * not published — the outline is frozen while public. When nothing was claimed
 * the row is read again to say which rule spoke.
 */
async function claimOutline(
  tx: Client,
  courseId: string,
  expectedVersion: number,
): Promise<void> {
  const claimed = await tx.course.updateMany({
    where: { id: courseId, version: expectedVersion, state: { not: 'published' } },
    data: { version: { increment: 1 }, updatedAt: new Date() },
  });
  if (claimed.count === 1) return;
  const row = await tx.course.findFirst({
    where: { id: courseId },
    select: { state: true },
  });
  throw new LearningDataError(
    row === null ? 'not-found' : row.state === 'published' ? 'not-draft' : 'conflict',
  );
}

async function claimPath(
  tx: Client,
  id: string,
  expectedVersion: number | null,
): Promise<void> {
  const claimed = await tx.learningPath.updateMany({
    where: { id, version: expectedVersion ?? UNMATCHABLE_VERSION },
    data: { version: { increment: 1 }, updatedAt: new Date() },
  });
  if (claimed.count !== 1) await unclaimed(tx, 'path', id);
}

/**
 * The trigger's own question, asked first: a module, every module with a
 * lesson, and words in the primary locale on the Course, every module and
 * every lesson.
 */
async function syllabusComplete(
  tx: Client,
  courseId: string,
  locale: string,
): Promise<boolean> {
  const [row] = await tx.$queryRaw<{ complete: number }[]>`
    SELECT CASE WHEN
      EXISTS (SELECT 1 FROM [dbo].[CourseLabel] l WHERE l.[courseId] = ${courseId} AND l.[locale] = ${locale})
      AND EXISTS (SELECT 1 FROM [dbo].[CourseModule] m WHERE m.[courseId] = ${courseId})
      AND NOT EXISTS (
        SELECT 1 FROM [dbo].[CourseModule] m
        WHERE m.[courseId] = ${courseId}
          AND (
            NOT EXISTS (SELECT 1 FROM [dbo].[Lesson] s WHERE s.[moduleId] = m.[id])
            OR NOT EXISTS (SELECT 1 FROM [dbo].[CourseModuleLabel] ml WHERE ml.[moduleId] = m.[id] AND ml.[locale] = ${locale})
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM [dbo].[Lesson] s
        WHERE s.[courseId] = ${courseId}
          AND NOT EXISTS (SELECT 1 FROM [dbo].[LessonLabel] sl WHERE sl.[lessonId] = s.[id] AND sl.[locale] = ${locale})
      )
    THEN 1 ELSE 0 END AS [complete]`;
  return Number(row?.complete ?? 0) === 1;
}

/**
 * Locks the named Courses for update — FIRST, before any path is claimed — and
 * answers each one's state as it now stands under that lock. A Course that
 * does not exist is simply absent from the answer.
 */
async function lockCourses(
  tx: Client,
  ids: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.$queryRaw<{ id: string; state: string }[]>`
    SELECT [id], [state] FROM [dbo].[Course] WITH (UPDLOCK, ROWLOCK)
    WHERE [id] IN (${Prisma.join([...ids])})`;
  return new Map(rows.map((row) => [row.id, row.state]));
}

/* ===========================================================================
 * Writing a Course's catalogue facts
 * ========================================================================= */

/** Labels, topics and teachers, replaced wholesale. Teachers keep display order. */
async function replaceCourseSets(tx: Client, courseId: string, value: CourseValue) {
  await tx.courseLabel.deleteMany({ where: { courseId } });
  await tx.courseLabel.createMany({
    data: value.labels.map((label) => ({ courseId, ...label })),
  });

  await tx.courseTopic.deleteMany({ where: { courseId } });
  if (value.topicIds.length > 0)
    await tx.courseTopic.createMany({
      data: value.topicIds.map((topicId) => ({ courseId, topicId })),
    });

  await tx.courseTeacher.deleteMany({ where: { courseId } });
  if (value.teacherIds.length > 0)
    await tx.courseTeacher.createMany({
      data: value.teacherIds.map((personId, position) => ({
        courseId,
        personId,
        position,
      })),
    });
}

function courseColumns(value: CourseValue) {
  return {
    slug: value.slug,
    primaryLocale: value.primaryLocale,
    level: value.level,
    format: value.format,
    languageCode: value.languageCode,
    updatedAt: new Date(),
  };
}

async function detailOrConflict(tx: Client, id: string): Promise<CourseDetail> {
  const detail = await courseDetail(tx, id);
  if (detail === null) throw new LearningDataError('conflict');
  return detail;
}

/* ===========================================================================
 * The syllabus — one named change at a time
 * ========================================================================= */

/** One named change to one part of a Course's syllabus. */
type OutlineChange =
  | { readonly part: 'module'; readonly change: ModuleChange }
  | { readonly part: 'lesson'; readonly change: LessonChange };

interface OutlineOutcome {
  readonly change: string;
  readonly progressRemoved: number;
}

async function moduleOf(
  tx: Client,
  courseId: string,
  moduleId: string,
): Promise<{ readonly position: number }> {
  // The Course is IN the predicate: a module of another Course answers exactly
  // like a missing one, so a forged identifier can never reach it.
  const row = await tx.courseModule.findFirst({
    where: { id: moduleId, courseId },
    select: { position: true },
  });
  if (row === null) throw new LearningDataError('not-found');
  return row;
}

async function lessonOf(
  tx: Client,
  courseId: string,
  lessonId: string,
): Promise<{ readonly moduleId: string; readonly position: number }> {
  const row = await tx.lesson.findFirst({
    where: { id: lessonId, courseId },
    select: { moduleId: true, position: true },
  });
  if (row === null) throw new LearningDataError('not-found');
  return row;
}

async function applyModuleChange(
  tx: Client,
  courseId: string,
  change: ModuleChange,
): Promise<OutlineOutcome> {
  switch (change.op) {
    case 'add': {
      const modules = await tx.courseModule.count({ where: { courseId } });
      if (modules >= LEARNING_LIMITS.modules) throw new LearningDataError('limit');
      const moduleId = randomUUID();
      await tx.courseModule.create({
        data: { id: moduleId, courseId, position: modules },
      });
      await tx.courseModuleLabel.createMany({
        data: change.labels.map((label) => ({ moduleId, ...label })),
      });
      return { change: 'add', progressRemoved: 0 };
    }
    case 'edit': {
      await moduleOf(tx, courseId, change.moduleId);
      await tx.courseModuleLabel.deleteMany({ where: { moduleId: change.moduleId } });
      await tx.courseModuleLabel.createMany({
        data: change.labels.map((label) => ({ moduleId: change.moduleId, ...label })),
      });
      return { change: 'edit', progressRemoved: 0 };
    }
    case 'remove': {
      const { position } = await moduleOf(tx, courseId, change.moduleId);
      const lessonIds = (
        await tx.lesson.findMany({
          where: { moduleId: change.moduleId, courseId },
          select: { id: true },
        })
      ).map((lesson) => lesson.id);
      // Children first — nothing cascades. Progress on a removed lesson goes
      // with it: a learner cannot have completed a lesson that is not there.
      const progress =
        lessonIds.length === 0
          ? { count: 0 }
          : await tx.lessonProgress.deleteMany({
              where: { courseId, lessonId: { in: lessonIds } },
            });
      if (lessonIds.length > 0) {
        await tx.lessonLabel.deleteMany({ where: { lessonId: { in: lessonIds } } });
        await tx.lesson.deleteMany({ where: { moduleId: change.moduleId, courseId } });
      }
      await tx.courseModuleLabel.deleteMany({ where: { moduleId: change.moduleId } });
      await tx.courseModule.deleteMany({ where: { id: change.moduleId, courseId } });
      // ONE statement closes the gap, so the order stays dense.
      await tx.$executeRaw`
        UPDATE [dbo].[CourseModule] SET [position] = [position] - 1
        WHERE [courseId] = ${courseId} AND [position] > ${position}`;
      return { change: 'remove', progressRemoved: progress.count };
    }
    case 'move': {
      const { position } = await moduleOf(tx, courseId, change.moduleId);
      const target = change.direction === 'earlier' ? position - 1 : position + 1;
      const neighbour = await tx.courseModule.findFirst({
        where: { courseId, position: target },
        select: { id: true },
      });
      // Past either end is a refused no-op, never a silent one.
      if (neighbour === null) throw new LearningDataError('invalid');
      // A SWAP IN ONE STATEMENT: the unique (course, position) key is checked
      // once the statement completes, never against a half-moved pair.
      await tx.$executeRaw`
        UPDATE [dbo].[CourseModule]
        SET [position] = CASE WHEN [id] = ${change.moduleId} THEN ${target} ELSE ${position} END
        WHERE [courseId] = ${courseId} AND [id] IN (${change.moduleId}, ${neighbour.id})`;
      return { change: 'move', progressRemoved: 0 };
    }
  }
}

async function applyLessonChange(
  tx: Client,
  courseId: string,
  change: LessonChange,
): Promise<OutlineOutcome> {
  switch (change.op) {
    case 'add': {
      await moduleOf(tx, courseId, change.moduleId);
      const lessons = await tx.lesson.count({
        where: { moduleId: change.moduleId, courseId },
      });
      if (lessons >= LEARNING_LIMITS.lessons) throw new LearningDataError('limit');
      const lessonId = randomUUID();
      await tx.lesson.create({
        data: { id: lessonId, courseId, moduleId: change.moduleId, position: lessons },
      });
      await tx.lessonLabel.createMany({
        data: change.labels.map((label) => ({ lessonId, ...label })),
      });
      return { change: 'add', progressRemoved: 0 };
    }
    case 'edit': {
      await lessonOf(tx, courseId, change.lessonId);
      await tx.lessonLabel.deleteMany({ where: { lessonId: change.lessonId } });
      await tx.lessonLabel.createMany({
        data: change.labels.map((label) => ({ lessonId: change.lessonId, ...label })),
      });
      return { change: 'edit', progressRemoved: 0 };
    }
    case 'remove': {
      const { moduleId, position } = await lessonOf(tx, courseId, change.lessonId);
      const progress = await tx.lessonProgress.deleteMany({
        where: { courseId, lessonId: change.lessonId },
      });
      await tx.lessonLabel.deleteMany({ where: { lessonId: change.lessonId } });
      await tx.lesson.deleteMany({ where: { id: change.lessonId, courseId } });
      await tx.$executeRaw`
        UPDATE [dbo].[Lesson] SET [position] = [position] - 1
        WHERE [moduleId] = ${moduleId} AND [courseId] = ${courseId} AND [position] > ${position}`;
      return { change: 'remove', progressRemoved: progress.count };
    }
    case 'move': {
      // Within its own module: a lesson never changes module.
      const { moduleId, position } = await lessonOf(tx, courseId, change.lessonId);
      const target = change.direction === 'earlier' ? position - 1 : position + 1;
      const neighbour = await tx.lesson.findFirst({
        where: { moduleId, courseId, position: target },
        select: { id: true },
      });
      if (neighbour === null) throw new LearningDataError('invalid');
      await tx.$executeRaw`
        UPDATE [dbo].[Lesson]
        SET [position] = CASE WHEN [id] = ${change.lessonId} THEN ${target} ELSE ${position} END
        WHERE [moduleId] = ${moduleId} AND [courseId] = ${courseId}
          AND [id] IN (${change.lessonId}, ${neighbour.id})`;
      return { change: 'move', progressRemoved: 0 };
    }
  }
}

/* ===========================================================================
 * Paths
 * ========================================================================= */

/** A path in any state, with its Courses in any state, in order. */
const PATH_DETAIL_SELECT = {
  ...PATH_SELECT,
  labels: DESCRIBED_LABELS,
  courses: {
    select: { course: { select: COURSE_LISTING_SELECT } },
    orderBy: [{ position: 'asc' }, { courseId: 'asc' }],
  },
} satisfies Prisma.LearningPathSelect;

async function pathOrConflict(tx: Client, id: string): Promise<PathDetail> {
  const row = await tx.learningPath.findFirst({
    where: { id },
    select: PATH_DETAIL_SELECT,
  });
  if (row === null) throw new LearningDataError('conflict');
  return toPathDetail(row);
}

/**
 * Rewrites a path's places to `courseIds` WITHOUT EVER EMPTYING IT: emptying a
 * published path, even for an instant inside a transaction, is refused by its
 * trigger. The places that leave are deleted, those that stay are renumbered
 * in ONE statement — so the unique (path, position) key is checked once the
 * statement completes — and the newcomers are inserted at their places.
 */
async function rewritePlaces(tx: Client, pathId: string, courseIds: readonly string[]) {
  await tx.learningPathCourse.deleteMany({
    where:
      courseIds.length === 0
        ? { pathId }
        : { pathId, courseId: { notIn: [...courseIds] } },
  });
  const kept = new Set(
    (
      await tx.learningPathCourse.findMany({
        where: { pathId },
        select: { courseId: true },
      })
    ).map((place) => place.courseId),
  );
  if (kept.size > 0) {
    const cases = Prisma.join(
      courseIds
        .map((courseId, position) => ({ courseId, position }))
        .filter((place) => kept.has(place.courseId))
        .map((place) => Prisma.sql`WHEN ${place.courseId} THEN ${place.position}`),
      ' ',
    );
    await tx.$executeRaw`
      UPDATE [dbo].[LearningPathCourse]
      SET [position] = CASE [courseId] ${cases} END
      WHERE [pathId] = ${pathId}`;
  }
  const arriving = courseIds
    .map((courseId, position) => ({ pathId, courseId, position }))
    .filter((place) => !kept.has(place.courseId));
  if (arriving.length > 0) await tx.learningPathCourse.createMany({ data: arriving });
}

/* ===========================================================================
 * Administration
 * ========================================================================= */

export function createLearningPersistence(): LearningPersistencePort {
  const db = getDatabaseClient();

  /** One named outline change: claim, apply, index, audit — one transaction. */
  async function changeOutline(
    actorId: string,
    courseId: string,
    expectedVersion: number,
    outline: OutlineChange,
  ): Promise<CourseDetail> {
    try {
      return await db.$transaction(async (tx) => {
        await claimOutline(tx, courseId, expectedVersion);
        const outcome =
          outline.part === 'module'
            ? await applyModuleChange(tx, courseId, outline.change)
            : await applyLessonChange(tx, courseId, outline.change);
        const detail = await detailOrConflict(tx, courseId);

        // The outline is part of the Course's search document. Harmless for a
        // draft: the indexer projects only what is public now.
        await requestSearchIndexing(tx, 'course', courseId);

        await tx.auditLog.create({
          data: auditRow({
            actorType: 'user',
            actorId,
            action: 'learning.course.outline.changed',
            targetType: 'course',
            targetId: courseId,
            before: { version: String(expectedVersion) },
            after: {
              version: String(detail.version),
              part: outline.part,
              change: outcome.change,
              modules: String(detail.modules),
              lessons: String(detail.lessons),
              progressRemoved: String(outcome.progressRemoved),
            },
            authorisingSource: 'learning.administer',
          }),
        });
        return detail;
      });
    } catch (error) {
      refuse(error);
    }
  }

  return {
    async courses(query) {
      const rows = await db.course.findMany({
        where: {
          ...(query.state === null ? {} : { state: query.state }),
          ...textMatch(query.text),
        },
        select: COURSE_LISTING_SELECT,
        orderBy: [...RECENTLY_CHANGED],
        skip: boundedOffset(query.offset),
        take: LEARNING_PAGE + 1,
      });
      return coursePage(rows);
    },

    async course(id) {
      const row = await db.course.findFirst({
        where: { id },
        select: COURSE_DETAIL_SELECT,
      });
      return row === null ? null : toCourseDetail(row);
    },

    async lesson(id) {
      const row = await db.lesson.findFirst({
        where: { id },
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

    /**
     * ORDER MATTERS FOR AN EDIT. The version is claimed first — the
     * serialisation point. The sets are replaced next, and only then are the
     * Course's own columns written: the integrity trigger re-validates a
     * PUBLISHED Course on every update of its row, so the new words must
     * already be there when it looks. A save that would leave a published
     * Course without words in its (new) primary locale is refused as
     * `incomplete`, and nothing of it commits.
     */
    async saveCourse({ actorId, id, expectedVersion, value }) {
      try {
        return await db.$transaction(async (tx) => {
          const courseId = id ?? randomUUID();
          let previous: { readonly slug: string; readonly state: string } | null = null;

          if (id !== null) {
            await claimCourse(tx, id, expectedVersion);
            previous = await tx.course.findFirst({
              where: { id },
              select: { slug: true, state: true },
            });
            await replaceCourseSets(tx, courseId, value);
            await tx.course.update({ where: { id }, data: courseColumns(value) });
          } else {
            // A new Course is a draft. The slug trigger reserves its slug in
            // this same transaction.
            await tx.course.create({
              data: {
                ...courseColumns(value),
                id: courseId,
                state: 'draft',
                publishedAt: null,
              },
            });
            await replaceCourseSets(tx, courseId, value);
          }

          const detail = await detailOrConflict(tx, courseId);

          // DURABLE SEARCH INTENT, committed with the change (ARCHITECTURE.md
          // §8.5). Unconditional: the indexer re-projects from current public
          // state, so a redundant request costs one idempotent projection.
          await requestSearchIndexing(tx, 'course', courseId);

          // Identifiers, states and counts — never a title or a description
          // (SECURITY_BASELINE.md §13.4).
          await tx.auditLog.create({
            data: auditRow({
              actorType: 'user',
              actorId,
              action: `learning.course.${previous === null ? 'created' : 'updated'}`,
              targetType: 'course',
              targetId: courseId,
              ...(previous === null
                ? {}
                : {
                    before: {
                      version: String(expectedVersion),
                      state: previous.state,
                    },
                  }),
              after: {
                version: String(detail.version),
                state: detail.state,
                format: detail.format,
                slugChanged: String(previous !== null && previous.slug !== value.slug),
                labels: String(value.labels.length),
                topics: String(value.topicIds.length),
                teachers: String(value.teacherIds.length),
              },
              authorisingSource: 'learning.administer',
            }),
          });

          return detail;
        });
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * A NAMED LIFECYCLE ACT. The claim takes the Course's exclusive lock, and
     * the questions are asked under it: no path can be published around this
     * Course, and no outline change can land, between the answer and the
     * write. Enrolments and Progress are never touched — a learner keeps their
     * place on a Course that is withdrawn, and finds it again if it returns.
     */
    async transitionCourse({ actorId, id, expectedVersion, state }) {
      try {
        return await db.$transaction(async (tx) => {
          await claimCourse(tx, id, expectedVersion);
          const current = await tx.course.findFirst({
            where: { id },
            select: { state: true, primaryLocale: true },
          });
          if (current === null) throw new LearningDataError('conflict');
          if (current.state === state) throw new LearningDataError('invalid');

          if (current.state === 'published') {
            const holding = await tx.learningPathCourse.count({
              where: { courseId: id, path: PUBLISHED },
            });
            if (holding > 0) throw new LearningDataError('in-published-path');
          }
          if (
            state === 'published' &&
            !(await syllabusComplete(tx, id, current.primaryLocale))
          )
            throw new LearningDataError('incomplete');

          await tx.course.update({
            where: { id },
            // `publishedAt` is the LATEST publication; a withdrawal keeps it.
            data: {
              state,
              ...(state === 'published' ? { publishedAt: new Date() } : {}),
            },
          });

          const detail = await detailOrConflict(tx, id);
          await requestSearchIndexing(tx, 'course', id);
          await tx.auditLog.create({
            data: auditRow({
              actorType: 'user',
              actorId,
              action: 'learning.course.state-changed',
              targetType: 'course',
              targetId: id,
              before: { version: String(expectedVersion), state: current.state },
              after: { version: String(detail.version), state: detail.state },
              authorisingSource: 'learning.administer',
            }),
          });
          return detail;
        });
      } catch (error) {
        refuse(error);
      }
    },

    changeModule: ({ actorId, courseId, expectedVersion, change }) =>
      changeOutline(actorId, courseId, expectedVersion, { part: 'module', change }),

    changeLesson: ({ actorId, courseId, expectedVersion, change }) =>
      changeOutline(actorId, courseId, expectedVersion, { part: 'lesson', change }),

    async courseChoices(text) {
      const rows = await db.course.findMany({
        where: { ...PUBLISHED, ...textMatch(text) },
        select: COURSE_LISTING_SELECT,
        orderBy: [{ slug: 'asc' }, { id: 'asc' }],
        take: COURSE_CHOICES,
      });
      return rows.map(toCourseListing);
    },

    async paths(query) {
      const rows = await db.learningPath.findMany({
        where: {
          ...(query.state === null ? {} : { state: query.state }),
          ...textMatch(query.text),
        },
        select: PATH_LISTING_SELECT,
        orderBy: [...RECENTLY_CHANGED],
        skip: boundedOffset(query.offset),
        take: LEARNING_PAGE + 1,
      });
      return pathPage(rows);
    },

    async path(id) {
      const row = await db.learningPath.findFirst({
        where: { id },
        select: PATH_DETAIL_SELECT,
      });
      return row === null ? null : toPathDetail(row);
    },

    async savePath({ actorId, id, expectedVersion, value }) {
      try {
        return await db.$transaction(async (tx) => {
          const pathId = id ?? randomUUID();
          let previous: { readonly slug: string; readonly state: string } | null = null;
          const columns = {
            slug: value.slug,
            primaryLocale: value.primaryLocale,
            updatedAt: new Date(),
          };

          if (id !== null) {
            await claimPath(tx, id, expectedVersion);
            previous = await tx.learningPath.findFirst({
              where: { id },
              select: { slug: true, state: true },
            });
            await tx.learningPathLabel.deleteMany({ where: { pathId } });
            await tx.learningPathLabel.createMany({
              data: value.labels.map((label) => ({ pathId, ...label })),
            });
            await tx.learningPath.update({ where: { id }, data: columns });
          } else {
            await tx.learningPath.create({
              data: { ...columns, id: pathId, state: 'draft', publishedAt: null },
            });
            await tx.learningPathLabel.createMany({
              data: value.labels.map((label) => ({ pathId, ...label })),
            });
          }

          const detail = await pathOrConflict(tx, pathId);
          await requestSearchIndexing(tx, 'learning-path', pathId);
          await tx.auditLog.create({
            data: auditRow({
              actorType: 'user',
              actorId,
              action: `learning.path.${previous === null ? 'created' : 'updated'}`,
              targetType: 'learning-path',
              targetId: pathId,
              ...(previous === null
                ? {}
                : {
                    before: { version: String(expectedVersion), state: previous.state },
                  }),
              after: {
                version: String(detail.version),
                state: detail.state,
                slugChanged: String(previous !== null && previous.slug !== value.slug),
                labels: String(value.labels.length),
              },
              authorisingSource: 'learning.administer',
            }),
          });
          return detail;
        });
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * Publishing a path locks its Courses FIRST (see LOCK ORDER above), then
     * claims the path; a membership change in between moved the version, so
     * the claim fails and nothing stale is published. Under those locks: at
     * least one Course, and every one published.
     */
    async transitionPath({ actorId, id, expectedVersion, state }) {
      try {
        return await db.$transaction(async (tx) => {
          const memberIds = (
            await tx.learningPathCourse.findMany({
              where: { pathId: id },
              select: { courseId: true },
            })
          ).map((place) => place.courseId);
          const states =
            state === 'published' ? await lockCourses(tx, memberIds) : new Map();

          await claimPath(tx, id, expectedVersion);
          const current = await tx.learningPath.findFirst({
            where: { id },
            select: { state: true },
          });
          if (current === null) throw new LearningDataError('conflict');
          if (current.state === state) throw new LearningDataError('invalid');
          if (state === 'published') {
            if (memberIds.length === 0) throw new LearningDataError('incomplete');
            if (memberIds.some((courseId) => states.get(courseId) !== 'published'))
              throw new LearningDataError('course-unavailable');
          }

          await tx.learningPath.update({
            where: { id },
            data: {
              state,
              ...(state === 'published' ? { publishedAt: new Date() } : {}),
            },
          });

          const detail = await pathOrConflict(tx, id);
          await requestSearchIndexing(tx, 'learning-path', id);
          await tx.auditLog.create({
            data: auditRow({
              actorType: 'user',
              actorId,
              action: 'learning.path.state-changed',
              targetType: 'learning-path',
              targetId: id,
              before: { version: String(expectedVersion), state: current.state },
              after: {
                version: String(detail.version),
                state: detail.state,
                courses: String(detail.courses),
              },
              authorisingSource: 'learning.administer',
            }),
          });
          return detail;
        });
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * THE VERSION IS THE LOCK, as for a Playlist — with the Courses the path
     * will hold locked first. A published path takes only published Courses
     * and never becomes empty.
     */
    async setPathCourses({ actorId, pathId, expectedVersion, courseIds, change }) {
      try {
        return await db.$transaction(async (tx) => {
          if (new Set(courseIds).size !== courseIds.length)
            throw new LearningDataError('duplicate-member');
          if (courseIds.length > LEARNING_LIMITS.pathCourses)
            throw new LearningDataError('limit');

          const states = await lockCourses(tx, courseIds);
          await claimPath(tx, pathId, expectedVersion);
          const current = await tx.learningPath.findFirst({
            where: { id: pathId },
            select: { state: true },
          });
          if (current === null) throw new LearningDataError('conflict');
          if (current.state === 'published') {
            if (courseIds.length === 0) throw new LearningDataError('incomplete');
            if (courseIds.some((courseId) => states.get(courseId) !== 'published'))
              throw new LearningDataError('course-unavailable');
          }

          await rewritePlaces(tx, pathId, courseIds);

          const detail = await pathOrConflict(tx, pathId);
          await requestSearchIndexing(tx, 'learning-path', pathId);
          await tx.auditLog.create({
            data: auditRow({
              actorType: 'user',
              actorId,
              action: 'learning.path.membership.changed',
              targetType: 'learning-path',
              targetId: pathId,
              before: { version: String(expectedVersion) },
              after: {
                version: String(detail.version),
                change,
                courses: String(courseIds.length),
              },
              authorisingSource: 'learning.administer',
            }),
          });
          return detail;
        });
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * COUNTS, COMPUTED IN SQL. A learner has completed a Course when their
     * Progress there covers every current lesson — the same rule as
     * `courseCompleted` — and a Course with no lessons is completed by nobody.
     * No account identifier leaves the statement.
     */
    async enrolmentSummary(offset) {
      const rows = await db.$queryRaw<
        { courseId: string; learners: number; completed: number }[]
      >`
        WITH [learner] AS (
          SELECT e.[courseId],
                 (SELECT COUNT(*) FROM [dbo].[LessonProgress] p
                  WHERE p.[userId] = e.[userId] AND p.[courseId] = e.[courseId]) AS [done]
          FROM [dbo].[Enrolment] e
        ),
        [syllabus] AS (
          SELECT [courseId], COUNT(*) AS [lessons] FROM [dbo].[Lesson] GROUP BY [courseId]
        )
        SELECT l.[courseId],
               COUNT(*) AS [learners],
               SUM(CASE WHEN s.[lessons] > 0 AND l.[done] >= s.[lessons] THEN 1 ELSE 0 END) AS [completed]
        FROM [learner] l
        LEFT JOIN [syllabus] s ON s.[courseId] = l.[courseId]
        GROUP BY l.[courseId]
        ORDER BY [learners] DESC, l.[courseId] ASC
        OFFSET ${boundedOffset(offset)} ROWS FETCH NEXT ${LEARNING_PAGE + 1} ROWS ONLY`;
      const listings = await listingsByIds(
        db,
        rows.slice(0, LEARNING_PAGE).map((row) => row.courseId),
      );
      return {
        items: rows.slice(0, LEARNING_PAGE).flatMap((row) => {
          const course = listings.get(row.courseId);
          return course === undefined
            ? []
            : [
                {
                  course,
                  learners: Number(row.learners),
                  completed: Number(row.completed),
                },
              ];
        }),
        hasMore: rows.length > LEARNING_PAGE,
      };
    },

    /** Requests per Course, the longest-waiting first. Never a requester. */
    async trialSummary(offset) {
      const rows = await db.$queryRaw<
        { courseId: string; requests: number; oldest: Date | null }[]
      >`
        SELECT [courseId], COUNT(*) AS [requests], MIN([requestedAt]) AS [oldest]
        FROM [dbo].[TrialClassRequest]
        GROUP BY [courseId]
        ORDER BY [oldest] ASC, [courseId] ASC
        OFFSET ${boundedOffset(offset)} ROWS FETCH NEXT ${LEARNING_PAGE + 1} ROWS ONLY`;
      const listings = await listingsByIds(
        db,
        rows.slice(0, LEARNING_PAGE).map((row) => row.courseId),
      );
      return {
        items: rows.slice(0, LEARNING_PAGE).flatMap((row) => {
          const course = listings.get(row.courseId);
          return course === undefined
            ? []
            : [{ course, requests: Number(row.requests), oldest: row.oldest }];
        }),
        hasMore: rows.length > LEARNING_PAGE,
      };
    },
  };
}
