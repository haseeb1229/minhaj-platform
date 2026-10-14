import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  getApplicationPrincipalCredentials,
  getDatabaseRuntimeUrl,
} from '../../packages/database/src/config.ts';
import { provisionApplicationPrincipal } from '../../packages/database/src/lifecycle/application-principal.ts';
import {
  assertApprovedLocalTarget,
  localTargetPolicy,
} from '../../packages/database/src/lifecycle/local-target.ts';
import {
  openSession,
  parseSqlServerUrl,
  type SqlSession,
} from '../../packages/database/src/lifecycle/sql-connection.ts';
import {
  courseInputSchema,
  courseQuerySchema,
  LEARNING_RESERVED_SLUGS,
  pathInputSchema,
  type CourseDetail,
  type CourseValue,
  type LearnerPort,
  type LearningDispositionPort,
  type LearningExportPort,
  type LearningPersistencePort,
  type LearningPublicReaderPort,
  type LessonLabel,
  type OutlineLabel,
  type PathDetail,
} from '../../packages/contracts/src/learning/index.ts';
import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';
import {
  account,
  count,
  freshSlug,
  modulePositions,
  n,
  ownedRows,
  person,
  sentinel,
  topic,
} from './fixture-sql.ts';

/**
 * Phase 22 — Learning's adapters over a REAL SQL Server, running as the REAL
 * least-privilege RUNTIME principal.
 *
 * WHAT ONLY THE DATABASE CAN PROVE: that a draft never reaches a public read;
 * that publication needs a complete syllabus and a published syllabus is
 * frozen — by the adapter's own answer AND by the migration's triggers beneath
 * it; that every stale version conflicts inside the writing transaction; that
 * concurrent reorders, enrolments and trial requests serialise to one outcome;
 * that an enrolment never lands on a Course being withdrawn; that a slug is
 * reserved for ever and resolves in one hop; that a published path holds only
 * published Courses; that every learner act is keyed by its own account; and
 * that closure removes a person's rows in bounded, resumable batches.
 *
 * TWO CONNECTIONS, TWO ROLES. The owner/migration session writes what only
 * another context may write — accounts, Topics, People — runs the raw
 * statements that prove the trigger floor, and inspects. EVERYTHING Learning
 * does goes through its adapters, whose Prisma client is bound to the
 * provisioned RUNTIME principal.
 *
 * NOTHING HERE IS CONTENT OR A REAL ADDRESS (see `./fixture-sql.ts`).
 */

const live = databaseConfigured ? describe : describe.skip;

const reasonOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    const reason = (error as { reason?: unknown } | null)?.reason;
    return typeof reason === 'string' ? reason : 'unclassified';
  }
  return 'accepted';
};

/** Recovers an SQL Server error number from a driver error, or null. */
const sqlNumber = async (promise: Promise<unknown>): Promise<number | null> => {
  try {
    await promise;
  } catch (error) {
    const number = (error as { number?: unknown } | null)?.number;
    return typeof number === 'number' ? number : null;
  }
  return null;
};

const outlineLabels = (kind: string, key: string): OutlineLabel[] => [
  { locale: 'en', title: sentinel(kind, key), summary: sentinel(`${kind}_SUMMARY`, key) },
];

const lessonLabels = (key: string): LessonLabel[] => [
  {
    locale: 'en',
    title: sentinel('LESSON', key),
    summary: sentinel('LESSON_SUMMARY', key),
    body: sentinel('LESSON_BODY', key),
  },
];

const publicQuery = (filters: Record<string, unknown>) =>
  courseQuerySchema.parse(filters);

live('Phase 22 Learning against real SQL Server, as the runtime principal', () => {
  let db: DisposableDatabase;
  let app: SqlSession;

  let catalogue: LearningPersistencePort;
  let reader: LearningPublicReaderPort;
  let learner: LearnerPort;
  let exporter: LearningExportPort;
  let disposition: LearningDispositionPort;

  let actor: string;
  let topicId: string;

  beforeAll(async () => {
    // The runtime URL is read BEFORE the harness repoints `DATABASE_URL` at the
    // migration principal, then repointed at the disposable database — and
    // POSITIVELY proved to be the runtime principal on a disposable target.
    const runtimeSource = getDatabaseRuntimeUrl();
    db = await createProofDatabase();
    const runtimeTarget = parseSqlServerUrl(runtimeSource);
    const runtimeUrl = runtimeSource.replace(
      `database=${runtimeTarget.database}`,
      `database=${db.name}`,
    );
    if (runtimeUrl === runtimeSource)
      throw new Error(
        'The runtime URL could not be repointed at the disposable database.',
      );
    const connection = assertApprovedLocalTarget(
      runtimeUrl,
      localTargetPolicy(process.env, 'disposable', 'runtime'),
    );

    const principal = getApplicationPrincipalCredentials();
    await provisionApplicationPrincipal(
      db.admin,
      principal.DATABASE_APP_LOGIN,
      principal.DATABASE_APP_PASSWORD,
    );
    app = await openSession(connection);
    process.env['DATABASE_URL'] = runtimeUrl;

    const database = await import('../../packages/database/src/index.ts');
    catalogue = database.createLearningPersistence();
    reader = database.createLearningPublicReader();
    learner = database.createLearner();
    exporter = database.createLearningExport();
    disposition = database.createLearningDisposition();

    actor = await account(db.admin);
    topicId = await topic(db.admin);
  }, 300_000);

  afterAll(async () => {
    await app?.close();
    await db?.close();
  });

  /* ---- building Courses through the adapter ----------------------------- */

  const courseValue = (
    slug: string,
    teacherId: string,
    overrides: Partial<CourseValue> = {},
  ): CourseValue =>
    courseInputSchema.parse({
      slug,
      primaryLocale: 'en',
      level: 'beginner',
      format: 'self-paced',
      languageCode: 'en',
      labels: [
        {
          locale: 'en',
          title: sentinel('COURSE_TITLE', slug),
          summary: sentinel('COURSE_SUMMARY', slug),
          description: sentinel('COURSE_DESCRIPTION', slug),
        },
      ],
      topicIds: [topicId],
      teacherIds: [teacherId],
      ...overrides,
    });

  async function draftCourse(options: {
    readonly teacher: string;
    readonly modules?: number;
    readonly lessons?: number;
    readonly format?: 'self-paced' | 'live';
    readonly slug?: string;
  }): Promise<CourseDetail> {
    const slug = options.slug ?? freshSlug();
    let detail = await catalogue.saveCourse({
      actorId: actor,
      id: null,
      expectedVersion: null,
      value: courseValue(slug, options.teacher, {
        format: options.format ?? 'self-paced',
      }),
    });
    for (let m = 0; m < (options.modules ?? 1); m += 1)
      detail = await catalogue.changeModule({
        actorId: actor,
        courseId: detail.id,
        expectedVersion: detail.version,
        change: { op: 'add', labels: outlineLabels('MODULE', `${slug}-${String(m)}`) },
      });
    for (const module of detail.outline)
      for (let l = 0; l < (options.lessons ?? 1); l += 1)
        detail = await catalogue.changeLesson({
          actorId: actor,
          courseId: detail.id,
          expectedVersion: detail.version,
          change: {
            op: 'add',
            moduleId: module.id,
            labels: lessonLabels(`${module.id}-${String(l)}`),
          },
        });
    return detail;
  }

  async function publishedCourse(
    options: Parameters<typeof draftCourse>[0],
  ): Promise<CourseDetail> {
    const draft = await draftCourse(options);
    return catalogue.transitionCourse({
      actorId: actor,
      id: draft.id,
      expectedVersion: draft.version,
      state: 'published',
    });
  }

  const transition = (
    course: { id: string; version: number },
    state: CourseDetail['state'],
  ) =>
    catalogue.transitionCourse({
      actorId: actor,
      id: course.id,
      expectedVersion: course.version,
      state,
    });

  async function draftPath(): Promise<PathDetail> {
    const slug = freshSlug('path');
    return catalogue.savePath({
      actorId: actor,
      id: null,
      expectedVersion: null,
      value: pathInputSchema.parse({
        slug,
        primaryLocale: 'en',
        labels: [
          {
            locale: 'en',
            title: sentinel('PATH_TITLE', slug),
            summary: sentinel('PATH_SUMMARY', slug),
            description: sentinel('PATH_DESCRIPTION', slug),
          },
        ],
      }),
    });
  }

  const setCourses = (
    path: { id: string; version: number },
    courseIds: readonly string[],
    change: 'add' | 'remove' | 'move' = 'add',
  ) =>
    catalogue.setPathCourses({
      actorId: actor,
      pathId: path.id,
      expectedVersion: path.version,
      courseIds,
      change,
    });

  /* ======================================================================
   * The public predicate
   * ==================================================================== */

  describe('only a published Course or path reaches a public read', () => {
    it('withholds a draft from every public read, then shows it once published, then withholds it once archived', async () => {
      const teacher = await person(db.admin);
      const draft = await draftCourse({ teacher, modules: 2, lessons: 2 });
      const byTeacher = () => reader.courses(publicQuery({ teacher }));

      const hidden = async () => {
        expect((await byTeacher()).items).toEqual([]);
        expect(await reader.course(draft.slug)).toBeNull();
        expect(await reader.courseCanonicalSlug(draft.slug)).toBeNull();
        expect(await reader.searchCourse(draft.id)).toBeNull();
        expect(await reader.publicCourseTargets([draft.id])).toEqual([]);
        expect(
          (await reader.searchCourses({ after: null, limit: 500 })).map((row) => row.id),
        ).not.toContain(draft.id);
        expect(
          (await reader.sitemap('course', 0, 5000)).map((row) => row.slug),
        ).not.toContain(draft.slug);
        expect(
          (await reader.teacherFacets(0)).items.map((facet) => facet.id),
        ).not.toContain(teacher);
      };
      await hidden();

      const published = await transition(draft, 'published');
      const page = await byTeacher();
      expect(page.items.map((item) => item.id)).toEqual([draft.id]);
      expect(page.items[0]).toMatchObject({
        modules: 2,
        lessons: 4,
        teacherIds: [teacher],
      });

      const detail = await reader.course(draft.slug);
      expect(detail?.outline.map((module) => module.lessons.length)).toEqual([2, 2]);
      // The public syllabus carries titles and summaries — NEVER a lesson body.
      expect(JSON.stringify(detail)).not.toContain('NON_LEARNING_FIXTURE_LESSON_BODY');
      const search = await reader.searchCourse(draft.id);
      expect(search?.outline).toHaveLength(2);
      expect(JSON.stringify(search)).not.toContain('NON_LEARNING_FIXTURE_LESSON_BODY');
      expect(await reader.publicCourseTargets([draft.id])).toEqual([
        { id: draft.id, slug: draft.slug },
      ]);
      expect(
        (await reader.sitemap('course', 0, 5000)).find((row) => row.slug === draft.slug)
          ?.locales,
      ).toEqual(['en']);
      expect(
        (await reader.teacherFacets(0)).items.find((facet) => facet.id === teacher),
      ).toEqual({ id: teacher, courses: 1 });

      await transition(published, 'archived');
      await hidden();
    });

    it('narrows by each filter and never widens: an unknown value is an empty page', async () => {
      const teacher = await person(db.admin);
      const live = await publishedCourse({ teacher, format: 'live' });
      const paced = await publishedCourse({ teacher });

      const ids = async (filters: Record<string, unknown>) =>
        (await reader.courses(publicQuery({ teacher, ...filters }))).items
          .map((item) => item.id)
          .sort();

      expect(await ids({})).toEqual([live.id, paced.id].sort());
      expect(await ids({ format: 'live' })).toEqual([live.id]);
      expect(await ids({ format: 'self-paced' })).toEqual([paced.id]);
      expect(await ids({ level: 'advanced' })).toEqual([]);
      expect(await ids({ language: 'ur' })).toEqual([]);
      expect(await ids({ topic: topicId })).toEqual([live.id, paced.id].sort());
      expect(await ids({ topic: '00000000-0000-4000-8000-000000000000' })).toEqual([]);
      expect(
        (
          await reader.courses(
            publicQuery({ teacher: '00000000-0000-4000-8000-000000000000' }),
          )
        ).items,
      ).toEqual([]);
    });
  });

  /* ======================================================================
   * The syllabus — complete before publication, frozen while public
   * ==================================================================== */

  describe('a published Course has a complete, frozen syllabus', () => {
    it('refuses to publish an incomplete syllabus, by the adapter and by the trigger beneath it', async () => {
      const teacher = await person(db.admin);

      const empty = await draftCourse({ teacher, modules: 0 });
      expect(await reasonOf(transition(empty, 'published'))).toBe('incomplete');

      const lessonless = await draftCourse({ teacher, modules: 1, lessons: 0 });
      expect(await reasonOf(transition(lessonless, 'published'))).toBe('incomplete');

      // A lesson with words only in a locale that is not the primary one.
      const partial = await draftCourse({ teacher, modules: 1, lessons: 1 });
      const lesson = partial.outline[0]?.lessons[0];
      if (lesson === undefined) throw new Error('fixture lesson missing');
      const edited = await catalogue.changeLesson({
        actorId: actor,
        courseId: partial.id,
        expectedVersion: partial.version,
        change: {
          op: 'edit',
          lessonId: lesson.id,
          labels: [
            { locale: 'ur', title: sentinel('LESSON', 'ur'), summary: '', body: '' },
          ],
        },
      });
      expect(await reasonOf(transition(edited, 'published'))).toBe('incomplete');
      expect(
        await count(db.admin, 'Course', `[id] = ${n(edited.id)} AND [state] = N'draft'`),
      ).toBe(1);

      // THE FLOOR: a write that skips the adapter meets the same rule.
      expect(
        await sqlNumber(
          db.admin.query(
            `UPDATE [dbo].[Course] SET [state] = N'published', [publishedAt] = SYSUTCDATETIME() WHERE [id] = ${n(empty.id)};`,
          ),
        ),
      ).toBe(51270);
      expect(
        await sqlNumber(
          db.admin.query(`
            INSERT INTO [dbo].[Course] ([id],[slug],[primaryLocale],[state],[format],[languageCode],[publishedAt])
            VALUES (NEWID(), ${n(freshSlug())}, N'en', N'published', N'live', N'en', SYSUTCDATETIME());`),
        ),
      ).toBe(51270);
    });

    it('refuses an outline change while published, by the adapter and by the trigger beneath it', async () => {
      const teacher = await person(db.admin);
      const course = await publishedCourse({ teacher, modules: 1, lessons: 1 });
      const module = course.outline[0];
      const lesson = module?.lessons[0];
      if (module === undefined || lesson === undefined)
        throw new Error('fixture outline missing');

      expect(
        await reasonOf(
          catalogue.changeModule({
            actorId: actor,
            courseId: course.id,
            expectedVersion: course.version,
            change: { op: 'add', labels: outlineLabels('MODULE', 'frozen') },
          }),
        ),
      ).toBe('not-draft');
      expect(
        await reasonOf(
          catalogue.changeLesson({
            actorId: actor,
            courseId: course.id,
            expectedVersion: course.version,
            change: { op: 'remove', lessonId: lesson.id },
          }),
        ),
      ).toBe('not-draft');

      expect(
        await sqlNumber(
          db.admin.query(
            `INSERT INTO [dbo].[CourseModule] ([id],[courseId],[position]) VALUES (NEWID(), ${n(course.id)}, 5);`,
          ),
        ),
      ).toBe(51271);
      expect(
        await sqlNumber(
          db.admin.query(
            `UPDATE [dbo].[LessonLabel] SET [title] = N'x' WHERE [lessonId] = ${n(lesson.id)};`,
          ),
        ),
      ).toBe(51271);
      expect(
        await sqlNumber(
          db.admin.query(
            `DELETE FROM [dbo].[CourseModuleLabel] WHERE [moduleId] = ${n(module.id)};`,
          ),
        ),
      ).toBe(51271);
      expect((await catalogue.course(course.id))?.version).toBe(course.version);
    });

    it('a module of another Course is a missing module: forged identifiers never attach', async () => {
      const teacher = await person(db.admin);
      const mine = await draftCourse({ teacher, modules: 1, lessons: 1 });
      const theirs = await draftCourse({ teacher, modules: 1, lessons: 1 });
      const foreignModule = theirs.outline[0]?.id ?? '';
      const foreignLesson = theirs.outline[0]?.lessons[0]?.id ?? '';

      for (const change of [
        {
          op: 'edit' as const,
          moduleId: foreignModule,
          labels: outlineLabels('MODULE', 'forged'),
        },
        { op: 'remove' as const, moduleId: foreignModule },
        { op: 'move' as const, moduleId: foreignModule, direction: 'later' as const },
      ])
        expect(
          await reasonOf(
            catalogue.changeModule({
              actorId: actor,
              courseId: mine.id,
              expectedVersion: (await catalogue.course(mine.id))?.version ?? 0,
              change,
            }),
          ),
        ).toBe('not-found');
      expect(
        await reasonOf(
          catalogue.changeLesson({
            actorId: actor,
            courseId: mine.id,
            expectedVersion: (await catalogue.course(mine.id))?.version ?? 0,
            change: {
              op: 'add',
              moduleId: foreignModule,
              labels: lessonLabels('forged'),
            },
          }),
        ),
      ).toBe('not-found');
      expect(
        await reasonOf(
          catalogue.changeLesson({
            actorId: actor,
            courseId: mine.id,
            expectedVersion: (await catalogue.course(mine.id))?.version ?? 0,
            change: { op: 'remove', lessonId: foreignLesson },
          }),
        ),
      ).toBe('not-found');
      expect(await count(db.admin, 'Lesson', `[courseId] = ${n(theirs.id)}`)).toBe(1);
      expect(await count(db.admin, 'Lesson', `[courseId] = ${n(mine.id)}`)).toBe(1);
    });

    it('keeps module and lesson positions dense through removal and refuses a move past either end', async () => {
      const teacher = await person(db.admin);
      let course = await draftCourse({ teacher, modules: 3, lessons: 2 });
      const [first, second, third] = course.outline;
      if (first === undefined || second === undefined || third === undefined)
        throw new Error('fixture outline missing');

      expect(
        await reasonOf(
          catalogue.changeModule({
            actorId: actor,
            courseId: course.id,
            expectedVersion: course.version,
            change: { op: 'move', moduleId: first.id, direction: 'earlier' },
          }),
        ),
      ).toBe('invalid');

      course = await catalogue.changeModule({
        actorId: actor,
        courseId: course.id,
        expectedVersion: course.version,
        change: { op: 'remove', moduleId: second.id },
      });
      expect(course.outline.map((module) => [module.id, module.position])).toEqual([
        [first.id, 0],
        [third.id, 1],
      ]);
      expect(await count(db.admin, 'Lesson', `[moduleId] = ${n(second.id)}`)).toBe(0);
      expect(
        await count(db.admin, 'CourseModuleLabel', `[moduleId] = ${n(second.id)}`),
      ).toBe(0);

      const lesson = third.lessons[0];
      if (lesson === undefined) throw new Error('fixture lesson missing');
      course = await catalogue.changeLesson({
        actorId: actor,
        courseId: course.id,
        expectedVersion: course.version,
        change: { op: 'remove', lessonId: lesson.id },
      });
      expect(course.outline[1]?.lessons.map((entry) => entry.position)).toEqual([0]);
    });

    it('caps modules per Course', async () => {
      const teacher = await person(db.admin);
      const course = await draftCourse({ teacher, modules: 20, lessons: 0 });
      expect(course.modules).toBe(20);
      expect(
        await reasonOf(
          catalogue.changeModule({
            actorId: actor,
            courseId: course.id,
            expectedVersion: course.version,
            change: { op: 'add', labels: outlineLabels('MODULE', 'over') },
          }),
        ),
      ).toBe('limit');
    }, 120_000);
  });

  /* ======================================================================
   * Versions and races
   * ==================================================================== */

  describe('every write is claimed at its expected version', () => {
    it('refuses a stale save, transition, outline change and path change as a conflict', async () => {
      const teacher = await person(db.admin);
      const course = await draftCourse({ teacher, modules: 1, lessons: 1 });
      const stale = course.version - 1;
      const value = courseValue(course.slug, teacher);

      expect(
        await reasonOf(
          catalogue.saveCourse({
            actorId: actor,
            id: course.id,
            expectedVersion: stale,
            value,
          }),
        ),
      ).toBe('conflict');
      expect(
        await reasonOf(transition({ id: course.id, version: stale }, 'published')),
      ).toBe('conflict');
      expect(
        await reasonOf(
          catalogue.changeModule({
            actorId: actor,
            courseId: course.id,
            expectedVersion: stale,
            change: { op: 'add', labels: outlineLabels('MODULE', 'stale') },
          }),
        ),
      ).toBe('conflict');

      const path = await draftPath();
      const moved = await setCourses(path, [course.id]);
      expect(await reasonOf(setCourses(path, [], 'remove'))).toBe('conflict');
      expect(moved.members.map((member) => member.id)).toEqual([course.id]);

      expect(
        await reasonOf(
          catalogue.saveCourse({
            actorId: actor,
            id: '00000000-0000-4000-8000-000000000000',
            expectedVersion: 1,
            value: courseValue(freshSlug(), teacher),
          }),
        ),
      ).toBe('not-found');
    });

    it('serialises two concurrent reorders: one wins, positions stay dense and unique', async () => {
      const teacher = await person(db.admin);
      const course = await draftCourse({ teacher, modules: 3, lessons: 0 });
      const [first, , third] = course.outline;
      if (first === undefined || third === undefined)
        throw new Error('fixture outline missing');

      const outcomes = await Promise.all([
        reasonOf(
          catalogue.changeModule({
            actorId: actor,
            courseId: course.id,
            expectedVersion: course.version,
            change: { op: 'move', moduleId: first.id, direction: 'later' },
          }),
        ),
        reasonOf(
          catalogue.changeModule({
            actorId: actor,
            courseId: course.id,
            expectedVersion: course.version,
            change: { op: 'move', moduleId: third.id, direction: 'earlier' },
          }),
        ),
      ]);
      expect(outcomes.sort()).toEqual(['accepted', 'conflict']);
      const positions = await modulePositions(db.admin, course.id);
      expect(positions.map((row) => row.position)).toEqual([0, 1, 2]);
      expect(new Set(positions.map((row) => row.id)).size).toBe(3);
    });
  });

  /* ======================================================================
   * Slugs
   * ==================================================================== */

  describe('a slug is reserved for ever and resolves in one hop', () => {
    it('resolves every former slug to the current one, after two renames', async () => {
      const teacher = await person(db.admin);
      const first = freshSlug();
      let course = await publishedCourse({ teacher, slug: first });
      const second = freshSlug();
      course = await catalogue.saveCourse({
        actorId: actor,
        id: course.id,
        expectedVersion: course.version,
        value: courseValue(second, teacher),
      });
      const third = freshSlug();
      course = await catalogue.saveCourse({
        actorId: actor,
        id: course.id,
        expectedVersion: course.version,
        value: courseValue(third, teacher),
      });

      expect(await reader.courseCanonicalSlug(first)).toBe(third);
      expect(await reader.courseCanonicalSlug(second)).toBe(third);
      expect(await reader.courseCanonicalSlug(third)).toBe(third);
      expect(await reader.course(first)).toBeNull();
      expect((await reader.course(third))?.id).toBe(course.id);

      // Another Course can claim neither a current nor a former slug.
      for (const taken of [first, third])
        expect(
          await reasonOf(
            catalogue.saveCourse({
              actorId: actor,
              id: null,
              expectedVersion: null,
              value: courseValue(taken, teacher),
            }),
          ),
        ).toBe('duplicate-slug');

      // A slug returning to its OWN Course is not reuse.
      const back = await catalogue.saveCourse({
        actorId: actor,
        id: course.id,
        expectedVersion: course.version,
        value: courseValue(first, teacher),
      });
      expect(back.slug).toBe(first);
    });

    it('refuses a reserved word by the schema AND by the SQL CHECK', async () => {
      const teacher = await person(db.admin);
      for (const word of LEARNING_RESERVED_SLUGS)
        expect(
          courseInputSchema.safeParse({
            ...courseValue(freshSlug(), teacher),
            slug: word,
          }).success,
        ).toBe(false);

      const course = await draftCourse({ teacher, modules: 0 });
      expect(
        await sqlNumber(
          db.admin.query(
            `UPDATE [dbo].[Course] SET [slug] = N'courses' WHERE [id] = ${n(course.id)};`,
          ),
        ),
      ).toBe(547);
      expect(
        await sqlNumber(
          db.admin.query(
            `INSERT INTO [dbo].[CourseSlugHistory] ([slug],[courseId]) VALUES (N'paths', ${n(course.id)});`,
          ),
        ),
      ).toBe(547);
    });

    it('lets exactly one of two concurrent creates claim a slug', async () => {
      const teacher = await person(db.admin);
      const slug = freshSlug();
      const create = () =>
        reasonOf(
          catalogue.saveCourse({
            actorId: actor,
            id: null,
            expectedVersion: null,
            value: courseValue(slug, teacher),
          }),
        );
      const outcomes = await Promise.all([create(), create()]);
      expect(outcomes.sort()).toEqual(['accepted', 'duplicate-slug']);
      expect(await count(db.admin, 'Course', `[slug] = ${n(slug)}`)).toBe(1);
    });
  });

  /* ======================================================================
   * Paths
   * ==================================================================== */

  describe('a published path holds only published Courses', () => {
    it('publishes only with members, all published, and keeps them from leaving publication', async () => {
      const teacher = await person(db.admin);
      const a = await publishedCourse({ teacher });
      const b = await publishedCourse({ teacher });
      const draft = await draftCourse({ teacher });
      let path = await draftPath();

      expect(
        await reasonOf(
          catalogue.transitionPath({
            actorId: actor,
            id: path.id,
            expectedVersion: path.version,
            state: 'published',
          }),
        ),
      ).toBe('incomplete');

      path = await setCourses(path, [a.id, draft.id]);
      expect(
        await reasonOf(
          catalogue.transitionPath({
            actorId: actor,
            id: path.id,
            expectedVersion: path.version,
            state: 'published',
          }),
        ),
      ).toBe('course-unavailable');

      path = await setCourses(path, [a.id], 'remove');
      path = await catalogue.transitionPath({
        actorId: actor,
        id: path.id,
        expectedVersion: path.version,
        state: 'published',
      });
      expect(path.state).toBe('published');

      // A draft Course cannot join it; a published one can, and order moves.
      expect(await reasonOf(setCourses(path, [a.id, draft.id]))).toBe(
        'course-unavailable',
      );
      path = await setCourses(path, [a.id, b.id]);
      path = await setCourses(path, [b.id, a.id], 'move');
      expect(path.members.map((member) => member.id)).toEqual([b.id, a.id]);
      expect((await reader.path(path.slug))?.members.map((member) => member.id)).toEqual([
        b.id,
        a.id,
      ]);
      expect(await reasonOf(setCourses(path, [a.id, a.id]))).toBe('duplicate-member');

      // A member cannot leave publication while the path is published.
      const memberA = await catalogue.course(a.id);
      if (memberA === null) throw new Error('fixture course missing');
      expect(await reasonOf(transition(memberA, 'draft'))).toBe('in-published-path');
      expect(
        await sqlNumber(
          db.admin.query(
            `UPDATE [dbo].[Course] SET [state] = N'archived' WHERE [id] = ${n(a.id)};`,
          ),
        ),
      ).toBe(51273);

      // Nor can the path be emptied while published.
      path = await setCourses(path, [a.id], 'remove');
      expect(await reasonOf(setCourses(path, [], 'remove'))).toBe('incomplete');
      expect(
        await sqlNumber(
          db.admin.query(
            `DELETE FROM [dbo].[LearningPathCourse] WHERE [pathId] = ${n(path.id)};`,
          ),
        ),
      ).toBe(51274);
      expect(
        await sqlNumber(
          db.admin.query(
            `INSERT INTO [dbo].[LearningPathCourse] ([pathId],[courseId],[position]) VALUES (${n(path.id)}, ${n(draft.id)}, 7);`,
          ),
        ),
      ).toBe(51272);

      // Once the path is withdrawn, its Course may be too.
      await catalogue.transitionPath({
        actorId: actor,
        id: path.id,
        expectedVersion: path.version,
        state: 'archived',
      });
      expect(await reader.path(path.slug)).toBeNull();
      expect((await transition(memberA, 'draft')).state).toBe('draft');
    });

    it('withholds a draft path from every public read and resolves a former path slug to the current one', async () => {
      const teacher = await person(db.admin);
      const course = await publishedCourse({ teacher });
      let path = await draftPath();
      const former = path.slug;
      path = await setCourses(path, [course.id]);

      expect(await reader.path(path.slug)).toBeNull();
      expect(await reader.pathCanonicalSlug(path.slug)).toBeNull();
      expect(await reader.searchPath(path.id)).toBeNull();
      expect(await reader.publicPathTargets([path.id])).toEqual([]);
      expect(
        (await reader.searchPaths({ after: null, limit: 500 })).map((row) => row.id),
      ).not.toContain(path.id);
      expect((await reader.paths(0)).items.map((item) => item.id)).not.toContain(path.id);
      expect(
        (await reader.sitemap('path', 0, 5000)).map((row) => row.slug),
      ).not.toContain(path.slug);
      expect(
        await reasonOf(
          catalogue.savePath({
            actorId: actor,
            id: path.id,
            expectedVersion: path.version - 1,
            value: pathInputSchema.parse({
              slug: path.slug,
              primaryLocale: 'en',
              labels: [
                {
                  locale: 'en',
                  title: sentinel('PATH_TITLE', 'stale'),
                  summary: '',
                  description: '',
                },
              ],
            }),
          }),
        ),
      ).toBe('conflict');
      expect(
        await reasonOf(
          catalogue.transitionPath({
            actorId: actor,
            id: path.id,
            expectedVersion: path.version - 1,
            state: 'published',
          }),
        ),
      ).toBe('conflict');

      path = await catalogue.transitionPath({
        actorId: actor,
        id: path.id,
        expectedVersion: path.version,
        state: 'published',
      });
      const current = freshSlug('path');
      path = await catalogue.savePath({
        actorId: actor,
        id: path.id,
        expectedVersion: path.version,
        value: pathInputSchema.parse({
          slug: current,
          primaryLocale: 'en',
          labels: [
            {
              locale: 'en',
              title: sentinel('PATH_TITLE', current),
              summary: '',
              description: '',
            },
          ],
        }),
      });
      expect(await reader.pathCanonicalSlug(former)).toBe(current);
      expect((await reader.searchPath(path.id))?.labels[0]?.title).toBe(
        sentinel('PATH_TITLE', current),
      );
      expect((await reader.sitemap('path', 0, 5000)).map((row) => row.slug)).toContain(
        current,
      );
    });
  });

  /* ======================================================================
   * Learners
   * ==================================================================== */

  describe("a learner's own Enrolments, Progress and requests", () => {
    it('enrols only on a published Course, idempotently, and records progress monotonically', async () => {
      const teacher = await person(db.admin);
      const alice = await account(db.admin);
      const draft = await draftCourse({ teacher });
      const course = await publishedCourse({ teacher, modules: 1, lessons: 2 });
      const [first, second] = course.outline[0]?.lessons ?? [];
      if (first === undefined || second === undefined)
        throw new Error('fixture lessons missing');

      expect(await learner.enrol(alice, draft.id)).toBe(false);
      expect(await learner.enrol(alice, '00000000-0000-4000-8000-000000000000')).toBe(
        false,
      );
      expect(await learner.completeLesson(alice, course.id, first.id)).toBe(
        'not-enrolled',
      );

      expect(await learner.enrol(alice, course.id)).toBe(true);
      expect(await learner.enrol(alice, course.id)).toBe(true);
      expect(await count(db.admin, 'Enrolment', `[userId] = ${n(alice)}`)).toBe(1);

      expect(await learner.completeLesson(alice, course.id, first.id)).toBe('recorded');
      const [kept] = await db.admin.query<{ completedAt: Date }>(
        `SELECT [completedAt] FROM [dbo].[LessonProgress] WHERE [userId] = ${n(alice)} AND [lessonId] = ${n(first.id)};`,
      );
      expect(await learner.completeLesson(alice, course.id, first.id)).toBe('recorded');
      const [again] = await db.admin.query<{ completedAt: Date }>(
        `SELECT [completedAt] FROM [dbo].[LessonProgress] WHERE [userId] = ${n(alice)} AND [lessonId] = ${n(first.id)};`,
      );
      expect(again?.completedAt.getTime()).toBe(kept?.completedAt.getTime());

      const mine = await learner.course(alice, course.slug);
      expect(mine?.completedLessonIds).toEqual([first.id]);
      expect(JSON.stringify(mine)).not.toContain('NON_LEARNING_FIXTURE_LESSON_BODY');
      const body = await learner.lesson(alice, course.id, first.id);
      expect(body?.labels[0]?.body).toBe(
        sentinel('LESSON_BODY', `${course.outline[0]?.id ?? ''}-0`),
      );

      const page = await learner.courses(alice, 0);
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({ available: true, completedLessons: 1 });
      expect(await learner.courseState(alice, course.id)).toEqual({
        enrolled: true,
        trialRequested: false,
      });

      await learner.leave(alice, course.id);
      await learner.leave(alice, course.id);
      expect(await ownedRows(db.admin, alice)).toBe(0);
    });

    it("refuses progress on another Course's lesson: forged pairs never attach", async () => {
      const teacher = await person(db.admin);
      const alice = await account(db.admin);
      const mine = await publishedCourse({ teacher });
      const theirs = await publishedCourse({ teacher });
      const foreign = theirs.outline[0]?.lessons[0]?.id ?? '';
      await learner.enrol(alice, mine.id);

      expect(await learner.completeLesson(alice, mine.id, foreign)).toBe('unavailable');
      expect(await learner.completeLesson(alice, theirs.id, foreign)).toBe(
        'not-enrolled',
      );
      expect(await learner.lesson(alice, mine.id, foreign)).toBeNull();
      expect(await count(db.admin, 'LessonProgress', `[userId] = ${n(alice)}`)).toBe(0);

      // THE FLOOR: both keys carry the Course.
      expect(
        await sqlNumber(
          db.admin.query(
            `INSERT INTO [dbo].[LessonProgress] ([userId],[courseId],[lessonId],[completedAt]) VALUES (${n(alice)}, ${n(mine.id)}, ${n(foreign)}, SYSUTCDATETIME());`,
          ),
        ),
      ).toBe(547);
    });

    it('scopes every learner read and act to the account it names', async () => {
      const teacher = await person(db.admin);
      const alice = await account(db.admin);
      const bob = await account(db.admin);
      const course = await publishedCourse({ teacher, format: 'live' });
      const lesson = course.outline[0]?.lessons[0]?.id ?? '';
      await learner.enrol(alice, course.id);
      await learner.completeLesson(alice, course.id, lesson);
      await learner.requestTrial(alice, course.id);
      const before = await ownedRows(db.admin, alice);
      expect(before).toBe(3);

      expect((await learner.courses(bob, 0)).items).toEqual([]);
      expect(await learner.course(bob, course.slug)).toBeNull();
      expect(await learner.lesson(bob, course.id, lesson)).toBeNull();
      expect(await learner.completeLesson(bob, course.id, lesson)).toBe('not-enrolled');
      expect(await learner.trials(bob)).toEqual([]);
      expect(await learner.courseState(bob, course.id)).toEqual({
        enrolled: false,
        trialRequested: false,
      });
      expect(await learner.paths(bob)).toEqual([]);
      await learner.leave(bob, course.id);
      await learner.withdrawTrial(bob, course.id);
      expect(await ownedRows(db.admin, alice)).toBe(before);
      expect((await exporter.collect(bob)).enrolments).toEqual([]);
    });

    it('records one Enrolment from two concurrent enrolments', async () => {
      const teacher = await person(db.admin);
      const alice = await account(db.admin);
      const course = await publishedCourse({ teacher });
      const outcomes = await Promise.all([
        learner.enrol(alice, course.id),
        learner.enrol(alice, course.id),
        learner.enrol(alice, course.id),
      ]);
      expect(outcomes).toEqual([true, true, true]);
      expect(await count(db.admin, 'Enrolment', `[userId] = ${n(alice)}`)).toBe(1);
    });

    it("never leaves an enrolment that the Course's withdrawal did not see", async () => {
      const teacher = await person(db.admin);
      for (let round = 0; round < 4; round += 1) {
        const alice = await account(db.admin);
        const course = await publishedCourse({ teacher });
        const [enrolled, withdrawn] = await Promise.all([
          learner.enrol(alice, course.id),
          reasonOf(transition(course, 'draft')),
        ]);
        expect(withdrawn).toBe('accepted');
        // Either the enrolment committed while the Course was still published —
        // and the withdrawal waited for it — or it saw the withdrawal and
        // wrote nothing. Never a row the answer did not report.
        expect(await count(db.admin, 'Enrolment', `[userId] = ${n(alice)}`)).toBe(
          enrolled ? 1 : 0,
        );
        expect(await learner.enrol(alice, course.id)).toBe(false);
      }
    });

    it('takes trial requests only on a published live Course, one per account', async () => {
      const teacher = await person(db.admin);
      const alice = await account(db.admin);
      const paced = await publishedCourse({ teacher });
      const draftLive = await draftCourse({ teacher, format: 'live' });
      const course = await publishedCourse({ teacher, format: 'live' });

      expect(await learner.requestTrial(alice, paced.id)).toBe(false);
      expect(await learner.requestTrial(alice, draftLive.id)).toBe(false);
      const outcomes = await Promise.all([
        learner.requestTrial(alice, course.id),
        learner.requestTrial(alice, course.id),
      ]);
      expect(outcomes).toEqual([true, true]);
      expect(await count(db.admin, 'TrialClassRequest', `[userId] = ${n(alice)}`)).toBe(
        1,
      );
      expect((await learner.trials(alice)).map((trial) => trial.course.id)).toEqual([
        course.id,
      ]);
      expect(await learner.courseState(alice, course.id)).toEqual({
        enrolled: false,
        trialRequested: true,
      });

      // THE FLOOR: no request on a Course that is not a published live one.
      expect(
        await sqlNumber(
          db.admin.query(
            `INSERT INTO [dbo].[TrialClassRequest] ([id],[userId],[courseId],[requestedAt]) VALUES (NEWID(), ${n(alice)}, ${n(paced.id)}, SYSUTCDATETIME());`,
          ),
        ),
      ).toBe(51276);

      await learner.withdrawTrial(alice, course.id);
      expect(await learner.trials(alice)).toEqual([]);
    });

    it('keeps Enrolments and Progress when a Course is archived, and it leaves the catalogue', async () => {
      const teacher = await person(db.admin);
      const alice = await account(db.admin);
      const course = await publishedCourse({ teacher, modules: 1, lessons: 1 });
      const lesson = course.outline[0]?.lessons[0]?.id ?? '';
      await learner.enrol(alice, course.id);
      await learner.completeLesson(alice, course.id, lesson);

      const archived = await transition(course, 'archived');
      expect(archived.state).toBe('archived');
      expect(await reader.course(course.slug)).toBeNull();
      expect(await ownedRows(db.admin, alice)).toBe(2);

      const page = await learner.courses(alice, 0);
      expect(page.items[0]).toMatchObject({ available: false, completedLessons: 1 });
      expect(await learner.lesson(alice, course.id, lesson)).toBeNull();
      expect(await learner.completeLesson(alice, course.id, lesson)).toBe('unavailable');
      expect(
        await sqlNumber(
          db.admin.query(
            `INSERT INTO [dbo].[Enrolment] ([userId],[courseId],[enrolledAt]) VALUES (${n(await account(db.admin))}, ${n(course.id)}, SYSUTCDATETIME());`,
          ),
        ),
      ).toBe(51275);
    });

    it('derives a learner path from their own Enrolments', async () => {
      const teacher = await person(db.admin);
      const alice = await account(db.admin);
      const a = await publishedCourse({ teacher, modules: 1, lessons: 1 });
      const b = await publishedCourse({ teacher });
      let path = await draftPath();
      path = await setCourses(path, [a.id, b.id]);
      path = await catalogue.transitionPath({
        actorId: actor,
        id: path.id,
        expectedVersion: path.version,
        state: 'published',
      });

      expect(await learner.paths(alice)).toEqual([]);
      const standing = await learner.path(alice, path.slug);
      expect(standing?.courses.map((entry) => entry.enrolled)).toEqual([false, false]);

      await learner.enrol(alice, a.id);
      await learner.completeLesson(alice, a.id, a.outline[0]?.lessons[0]?.id ?? '');
      const mine = await learner.paths(alice);
      expect(mine.map((entry) => entry.path.id)).toEqual([path.id]);
      expect(
        mine[0]?.courses.map((entry) => [
          entry.course.id,
          entry.enrolled,
          entry.completedLessons,
        ]),
      ).toEqual([
        [a.id, true, 1],
        [b.id, false, 0],
      ]);
    });
  });

  /* ======================================================================
   * Administration counts, outline removal, audit and search intent
   * ==================================================================== */

  describe('administration sees counts, never learners', () => {
    it('summarises enrolments and requests without an account identifier', async () => {
      const teacher = await person(db.admin);
      const alice = await account(db.admin);
      const bob = await account(db.admin);
      const course = await publishedCourse({
        teacher,
        modules: 1,
        lessons: 1,
        format: 'live',
      });
      const lesson = course.outline[0]?.lessons[0]?.id ?? '';
      for (const who of [alice, bob]) {
        await learner.enrol(who, course.id);
        await learner.requestTrial(who, course.id);
      }
      await learner.completeLesson(alice, course.id, lesson);

      const enrolments = await catalogue.enrolmentSummary(0);
      const row = enrolments.items.find((item) => item.course.id === course.id);
      expect(row).toMatchObject({ learners: 2, completed: 1 });
      const trials = await catalogue.trialSummary(0);
      expect(trials.items.find((item) => item.course.id === course.id)?.requests).toBe(2);

      for (const page of [enrolments, trials]) {
        const text = JSON.stringify(page);
        expect(text).not.toContain(alice);
        expect(text).not.toContain(bob);
      }
    });

    it("removes a removed lesson's Progress with it, and audits counts and never words", async () => {
      const teacher = await person(db.admin);
      const alice = await account(db.admin);
      const course = await publishedCourse({ teacher, modules: 1, lessons: 2 });
      const lesson = course.outline[0]?.lessons[0]?.id ?? '';
      await learner.enrol(alice, course.id);
      await learner.completeLesson(alice, course.id, lesson);

      const draft = await transition(course, 'draft');
      const changed = await catalogue.changeLesson({
        actorId: actor,
        courseId: course.id,
        expectedVersion: draft.version,
        change: { op: 'remove', lessonId: lesson },
      });
      expect(changed.lessons).toBe(1);
      expect(await count(db.admin, 'LessonProgress', `[userId] = ${n(alice)}`)).toBe(0);
      expect(await count(db.admin, 'Enrolment', `[userId] = ${n(alice)}`)).toBe(1);

      const audit = await db.admin.query<{ action: string; afterState: string | null }>(
        `SELECT [action], [afterState] FROM [dbo].[AuditLog] WHERE [targetId] = ${n(course.id)};`,
      );
      expect(audit.map((entry) => entry.action)).toEqual(
        expect.arrayContaining([
          'learning.course.created',
          'learning.course.outline.changed',
          'learning.course.state-changed',
        ]),
      );
      expect(
        audit.some((entry) => entry.afterState?.includes('"progressRemoved":"1"')),
      ).toBe(true);
      expect(JSON.stringify(audit)).not.toContain('NON_LEARNING_FIXTURE');
      expect(
        await count(
          db.admin,
          'SearchIndexRequest',
          `[scopeKind] = N'course' AND [scopeId] = ${n(course.id)}`,
        ),
      ).toBeGreaterThan(0);
    });
  });

  /* ======================================================================
   * Export and closure
   * ==================================================================== */

  describe("a person's export and their closed account's disposition", () => {
    it('exports identifiers and instants in a fixed order, then disposes in bounded batches', async () => {
      const teacher = await person(db.admin);
      const alice = await account(db.admin);
      const course = await publishedCourse({
        teacher,
        modules: 1,
        lessons: 2,
        format: 'live',
      });
      const [first, second] = course.outline[0]?.lessons ?? [];
      await learner.enrol(alice, course.id);
      await learner.completeLesson(alice, course.id, first?.id ?? '');
      await learner.completeLesson(alice, course.id, second?.id ?? '');
      await learner.requestTrial(alice, course.id);

      const exported = await exporter.collect(alice);
      expect(exported.enrolments).toEqual([
        { courseId: course.id, courseSlug: course.slug, enrolledAt: expect.any(String) },
      ]);
      expect(exported.progress.map((row) => row.lessonId)).toEqual(
        [first?.id ?? '', second?.id ?? ''].sort(),
      );
      expect(exported.trialRequests).toHaveLength(1);
      expect(JSON.stringify(exported)).not.toContain('NON_LEARNING_FIXTURE');
      expect(await exporter.collect(alice)).toEqual(exported);

      expect(await disposition.accountsWithData(null, 1000)).toContain(alice);
      const before = alice.slice(0, -1);
      expect(await disposition.accountsWithData(before, 1000)).toContain(alice);

      // One row per table per call: Progress first, its Enrolment only once
      // no Progress hangs off it, then requests.
      expect(await disposition.disposeAccount(alice, 1)).toBe(2);
      expect(await count(db.admin, 'Enrolment', `[userId] = ${n(alice)}`)).toBe(1);
      expect(await count(db.admin, 'LessonProgress', `[userId] = ${n(alice)}`)).toBe(1);
      expect(await disposition.disposeAccount(alice, 1)).toBe(2);
      expect(await disposition.disposeAccount(alice, 1)).toBe(0);
      expect(await ownedRows(db.admin, alice)).toBe(0);
      expect(await disposition.accountsWithData(before, 1000)).not.toContain(alice);
    });
  });
});
