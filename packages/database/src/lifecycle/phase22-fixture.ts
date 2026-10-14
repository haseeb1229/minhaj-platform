import 'server-only';

import { deepStrictEqual } from 'node:assert';
import { randomUUID } from 'node:crypto';

import type { SqlSession } from './sql-connection.ts';

/**
 * POPULATED PHASE-22 STATE for the recovery rehearsals.
 *
 * WHAT THE RECOVERY FIXTURE PROVES THAT A SCHEMA CHECK DOES NOT. That Learning
 * came back with its public catalogue still WHOLE — every published Course's
 * syllabus complete and in order, every published path holding only published
 * Courses in its order, every former slug still reserved for the record that
 * held it — and every person's learning still THEIR OWN, each progress row
 * naming a lesson of the very Course its enrolment is on:
 *
 *   - a published live Course with English and Urdu words, a typed Taxonomy
 *     Topic, a People Person named as its teacher, an Urdu content language
 *     and two ordered modules of three ordered lessons — renamed once, so its
 *     slug history holds a former slug that still resolves to it;
 *   - a published self-paced Course of one module and one lesson;
 *   - a draft Course with words only, which no public reader may see;
 *   - a published LearningPath holding the two published Courses in a
 *     deliberate order, renamed once as well;
 *   - two synthetic accounts: one enrolled on both published Courses with a
 *     lesson completed on each and a trial request on the live one, the other
 *     enrolled on the live Course with no progress;
 *   - the search passes owed for the published Course and the published path.
 *
 * NOTHING HERE IS ANYBODY'S DATA. Every title, summary, description and body
 * is a `NON_LEARNING_FIXTURE_…` sentinel, every slug a
 * `non-learning-fixture-…` sentinel, every address `@learning-proof.invalid`,
 * and the topic and teacher are the earlier fixtures' synthetic rows. Rows are
 * written directly by the owner: the recovery databases are disposable and
 * created by the run that writes them, and the adapters' own write paths are
 * proved by `db:test:permissions` and the integration suites.
 */

const TEXT = {
  learner: 'NON_LEARNING_FIXTURE_ACCOUNT learner',
  other: 'NON_LEARNING_FIXTURE_ACCOUNT second',
  title: 'NON_LEARNING_FIXTURE_TITLE',
  summary: 'NON_LEARNING_FIXTURE_SUMMARY synthetic summary',
  description: 'NON_LEARNING_FIXTURE_DESCRIPTION synthetic description',
  body: 'NON_LEARNING_FIXTURE_BODY synthetic lesson body',
} as const;

export interface Phase22Fixture {
  readonly runId: string;
  readonly learnerId: string;
  readonly otherId: string;
  readonly liveCourseId: string;
  readonly pacedCourseId: string;
  readonly draftCourseId: string;
  readonly firstModuleId: string;
  readonly secondModuleId: string;
  readonly pacedModuleId: string;
  readonly firstLessonId: string;
  readonly secondLessonId: string;
  readonly thirdLessonId: string;
  readonly pacedLessonId: string;
  readonly pathId: string;
  readonly trialId: string;
}

export interface Phase22References {
  /** The Phase-3B Topic the live Course is classified under. */
  readonly topicId: string;
  /** The Phase-5 Person the live Course names as its teacher. */
  readonly personId: string;
}

export function newPhase22Fixture(): Phase22Fixture {
  return {
    runId: randomUUID().replaceAll('-', ''),
    learnerId: randomUUID(),
    otherId: randomUUID(),
    liveCourseId: randomUUID(),
    pacedCourseId: randomUUID(),
    draftCourseId: randomUUID(),
    firstModuleId: randomUUID(),
    secondModuleId: randomUUID(),
    pacedModuleId: randomUUID(),
    firstLessonId: randomUUID(),
    secondLessonId: randomUUID(),
    thirdLessonId: randomUUID(),
    pacedLessonId: randomUUID(),
    pathId: randomUUID(),
    trialId: randomUUID(),
  };
}

/** Rejects anything that is not this module's own generated shape. */
function assertSafe(fixture: Phase22Fixture): void {
  if (!/^[0-9a-f]{32}$/.test(fixture.runId))
    throw new Error('Phase-22 fixture runId does not match the expected pattern.');
  for (const [name, value] of Object.entries(fixture)) {
    if (name === 'runId') continue;
    if (!/^[0-9a-f-]{36}$/.test(value))
      throw new Error(`Phase-22 fixture field '${name}' is not a generated identifier.`);
  }
}

function assertReferences(references: Phase22References): void {
  for (const id of [references.topicId, references.personId])
    if (!/^[a-z0-9-]{1,36}$/i.test(id))
      throw new Error('Invalid synthetic Phase-22 fixture reference.');
}

/** Every public address this fixture holds, current and former. */
function slugs(
  fixture: Phase22Fixture,
): Readonly<
  Record<'liveFormer' | 'live' | 'paced' | 'draft' | 'pathFormer' | 'path', string>
> {
  const stem = fixture.runId.slice(0, 16);
  return {
    liveFormer: `non-learning-fixture-live-former-${stem}`,
    live: `non-learning-fixture-live-${stem}`,
    paced: `non-learning-fixture-paced-${stem}`,
    draft: `non-learning-fixture-draft-${stem}`,
    pathFormer: `non-learning-fixture-path-former-${stem}`,
    path: `non-learning-fixture-path-${stem}`,
  };
}

/**
 * Writes the populated Phase-22 state into the SOURCE database, before backup,
 * with the MIGRATION principal, so the real keys, CHECKs and triggers are
 * exercised: each Course published only once its syllabus is complete, the
 * path published only once it holds published Courses, every slug reserved by
 * the database's own trigger, and every enrolment, progress row and trial
 * request accepted only on a Course that takes it.
 */
export async function writePhase22Fixture(
  sql: SqlSession,
  fixture: Phase22Fixture,
  references: Phase22References,
): Promise<void> {
  assertSafe(fixture);
  assertReferences(references);
  const f = fixture;
  const r = references;
  const s = slugs(f);
  const stem = f.runId.slice(0, 16);
  const course =
    '[id],[slug],[primaryLocale],[state],[level],[format],[languageCode],[publishedAt],[version],[updatedAt]';
  const label = (id: string, locale: string): string =>
    `(N'${id}', N'${locale}', N'${TEXT.title} ${locale}', N'${TEXT.summary}', N'${TEXT.description}')`;
  const words = (id: string, position: number): string =>
    `(N'${id}', N'en', N'${TEXT.title} ${String(position)}', N'${TEXT.summary}')`;
  const lessonWords = (id: string, position: number): string =>
    `(N'${id}', N'en', N'${TEXT.title} ${String(position)}', N'${TEXT.summary}', N'${TEXT.body}')`;

  // ---- the catalogue, drafted whole and then published -------------------------
  await sql.query(`
    INSERT INTO [dbo].[Course] (${course}) VALUES
      (N'${f.liveCourseId}', N'${s.liveFormer}', N'en', N'draft', N'intermediate', N'live', N'ur', NULL, 1, '2026-10-06T07:00:00'),
      (N'${f.pacedCourseId}', N'${s.paced}', N'en', N'draft', NULL, N'self-paced', N'en', NULL, 1, '2026-10-06T07:00:00'),
      (N'${f.draftCourseId}', N'${s.draft}', N'ar', N'draft', N'beginner', N'live', N'ar', NULL, 1, '2026-10-06T07:00:00');
    INSERT INTO [dbo].[CourseLabel] ([courseId],[locale],[title],[summary],[description]) VALUES
      ${label(f.liveCourseId, 'en')}, ${label(f.liveCourseId, 'ur')},
      ${label(f.pacedCourseId, 'en')}, ${label(f.draftCourseId, 'ar')};
    INSERT INTO [dbo].[CourseTopic] ([courseId],[topicId]) VALUES (N'${f.liveCourseId}', N'${r.topicId}');
    INSERT INTO [dbo].[CourseTeacher] ([courseId],[personId],[position]) VALUES (N'${f.liveCourseId}', N'${r.personId}', 0);
    INSERT INTO [dbo].[CourseModule] ([id],[courseId],[position]) VALUES
      (N'${f.firstModuleId}', N'${f.liveCourseId}', 0),
      (N'${f.secondModuleId}', N'${f.liveCourseId}', 1),
      (N'${f.pacedModuleId}', N'${f.pacedCourseId}', 0);
    INSERT INTO [dbo].[CourseModuleLabel] ([moduleId],[locale],[title],[summary]) VALUES
      ${words(f.firstModuleId, 0)}, ${words(f.secondModuleId, 1)}, ${words(f.pacedModuleId, 0)};
    INSERT INTO [dbo].[Lesson] ([id],[courseId],[moduleId],[position]) VALUES
      (N'${f.firstLessonId}', N'${f.liveCourseId}', N'${f.firstModuleId}', 0),
      (N'${f.secondLessonId}', N'${f.liveCourseId}', N'${f.firstModuleId}', 1),
      (N'${f.thirdLessonId}', N'${f.liveCourseId}', N'${f.secondModuleId}', 0),
      (N'${f.pacedLessonId}', N'${f.pacedCourseId}', N'${f.pacedModuleId}', 0);
    INSERT INTO [dbo].[LessonLabel] ([lessonId],[locale],[title],[summary],[body]) VALUES
      ${lessonWords(f.firstLessonId, 0)}, ${lessonWords(f.secondLessonId, 1)},
      ${lessonWords(f.thirdLessonId, 2)}, ${lessonWords(f.pacedLessonId, 0)};
    UPDATE [dbo].[Course] SET [slug]=N'${s.live}', [version]=2, [updatedAt]='2026-10-06T07:10:00'
      WHERE [id]=N'${f.liveCourseId}';
    UPDATE [dbo].[Course] SET [state]=N'published', [publishedAt]='2026-10-06T07:20:00',
      [version]=[version]+1, [updatedAt]='2026-10-06T07:20:00'
      WHERE [id] IN (N'${f.liveCourseId}', N'${f.pacedCourseId}');
  `);

  await sql.query(`
    INSERT INTO [dbo].[LearningPath] ([id],[slug],[primaryLocale],[state],[publishedAt],[version],[updatedAt]) VALUES
      (N'${f.pathId}', N'${s.pathFormer}', N'en', N'draft', NULL, 1, '2026-10-06T07:30:00');
    INSERT INTO [dbo].[LearningPathLabel] ([pathId],[locale],[title],[summary],[description]) VALUES
      ${label(f.pathId, 'en')};
    INSERT INTO [dbo].[LearningPathCourse] ([pathId],[courseId],[position]) VALUES
      (N'${f.pathId}', N'${f.pacedCourseId}', 0),
      (N'${f.pathId}', N'${f.liveCourseId}', 1);
    UPDATE [dbo].[LearningPath] SET [slug]=N'${s.path}', [state]=N'published',
      [publishedAt]='2026-10-06T07:40:00', [version]=2, [updatedAt]='2026-10-06T07:40:00'
      WHERE [id]=N'${f.pathId}';
    INSERT INTO [dbo].[SearchIndexRequest] ([scopeKind],[scopeId],[requestedAt]) VALUES
      (N'course', N'${f.liveCourseId}', '2026-10-06T07:20:00'),
      (N'learning-path', N'${f.pathId}', '2026-10-06T07:40:00');
  `);

  // ---- two accounts and their own learning ----------------------------------------
  await sql.query(`
    INSERT INTO [dbo].[User] ([id],[name],[email],[emailVerified],[createdAt],[updatedAt],[locale],[status],[twoFactorEnabled]) VALUES
      (N'${f.learnerId}', N'${TEXT.learner}', N'learner-${stem}@learning-proof.invalid', 0, '2026-10-06T08:00:00', '2026-10-06T08:00:00', N'ur', N'active', 0),
      (N'${f.otherId}', N'${TEXT.other}', N'second-${stem}@learning-proof.invalid', 0, '2026-10-06T08:00:00', '2026-10-06T08:00:00', N'en', N'active', 0);
    INSERT INTO [dbo].[Enrolment] ([userId],[courseId],[enrolledAt]) VALUES
      (N'${f.learnerId}', N'${f.liveCourseId}', '2026-10-06T08:10:00'),
      (N'${f.learnerId}', N'${f.pacedCourseId}', '2026-10-06T08:11:00'),
      (N'${f.otherId}', N'${f.liveCourseId}', '2026-10-06T08:12:00');
    INSERT INTO [dbo].[LessonProgress] ([userId],[courseId],[lessonId],[completedAt]) VALUES
      (N'${f.learnerId}', N'${f.liveCourseId}', N'${f.secondLessonId}', '2026-10-06T08:20:00'),
      (N'${f.learnerId}', N'${f.pacedCourseId}', N'${f.pacedLessonId}', '2026-10-06T08:21:00');
    INSERT INTO [dbo].[TrialClassRequest] ([id],[userId],[courseId],[requestedAt]) VALUES
      (N'${f.trialId}', N'${f.learnerId}', N'${f.liveCourseId}', '2026-10-06T08:30:00');
  `);
}

/** Every authoritative Phase-22 row this fixture wrote, in a stable order. */
export async function capturePhase22Fixture(
  sql: SqlSession,
  fixture: Phase22Fixture,
): Promise<Readonly<Record<string, string>>> {
  assertSafe(fixture);
  const f = fixture;
  const courses = `N'${f.liveCourseId}',N'${f.pacedCourseId}',N'${f.draftCourseId}'`;
  const users = `N'${f.learnerId}',N'${f.otherId}'`;
  const rows: Record<string, string> = {};

  for (const [name, statement, expected] of [
    [
      'Course',
      `SELECT * FROM [dbo].[Course] WHERE [id] IN (${courses}) ORDER BY [slug]`,
      3,
    ],
    [
      'CourseLabel',
      `SELECT * FROM [dbo].[CourseLabel] WHERE [courseId] IN (${courses}) ORDER BY [courseId], [locale]`,
      4,
    ],
    [
      'CourseSlugHistory',
      `SELECT * FROM [dbo].[CourseSlugHistory] WHERE [courseId] IN (${courses}) ORDER BY [slug]`,
      4,
    ],
    [
      'CourseTopic',
      `SELECT * FROM [dbo].[CourseTopic] WHERE [courseId] IN (${courses})`,
      1,
    ],
    [
      'CourseTeacher',
      `SELECT * FROM [dbo].[CourseTeacher] WHERE [courseId] IN (${courses})`,
      1,
    ],
    [
      'CourseModule',
      `SELECT * FROM [dbo].[CourseModule] WHERE [courseId] IN (${courses}) ORDER BY [courseId], [position]`,
      3,
    ],
    [
      'CourseModuleLabel',
      `SELECT ml.* FROM [dbo].[CourseModuleLabel] ml JOIN [dbo].[CourseModule] m ON m.[id]=ml.[moduleId] WHERE m.[courseId] IN (${courses}) ORDER BY ml.[moduleId]`,
      3,
    ],
    [
      'Lesson',
      `SELECT * FROM [dbo].[Lesson] WHERE [courseId] IN (${courses}) ORDER BY [moduleId], [position]`,
      4,
    ],
    [
      'LessonLabel',
      `SELECT ll.* FROM [dbo].[LessonLabel] ll JOIN [dbo].[Lesson] l ON l.[id]=ll.[lessonId] WHERE l.[courseId] IN (${courses}) ORDER BY ll.[lessonId]`,
      4,
    ],
    ['LearningPath', `SELECT * FROM [dbo].[LearningPath] WHERE [id]=N'${f.pathId}'`, 1],
    [
      'LearningPathLabel',
      `SELECT * FROM [dbo].[LearningPathLabel] WHERE [pathId]=N'${f.pathId}'`,
      1,
    ],
    [
      'LearningPathSlugHistory',
      `SELECT * FROM [dbo].[LearningPathSlugHistory] WHERE [pathId]=N'${f.pathId}' ORDER BY [slug]`,
      2,
    ],
    [
      'LearningPathCourse',
      `SELECT * FROM [dbo].[LearningPathCourse] WHERE [pathId]=N'${f.pathId}' ORDER BY [position]`,
      2,
    ],
    [
      'Enrolment',
      `SELECT * FROM [dbo].[Enrolment] WHERE [userId] IN (${users}) ORDER BY [enrolledAt]`,
      3,
    ],
    [
      'LessonProgress',
      `SELECT * FROM [dbo].[LessonProgress] WHERE [userId] IN (${users}) ORDER BY [completedAt]`,
      2,
    ],
    [
      'TrialClassRequest',
      `SELECT * FROM [dbo].[TrialClassRequest] WHERE [userId] IN (${users})`,
      1,
    ],
    [
      'SearchIndexRequest',
      `SELECT [scopeKind], [scopeId], [requestedAt] FROM [dbo].[SearchIndexRequest] WHERE [scopeId] IN (N'${f.liveCourseId}', N'${f.pathId}') ORDER BY [scopeKind]`,
      2,
    ],
  ] as const) {
    const data = await sql.query(`${statement};`);
    if (data.length !== expected) {
      throw new Error(
        `Phase-22 recovery expected ${String(expected)} ${name} row(s), found ${String(data.length)}.`,
      );
    }
    rows[name] = JSON.stringify(data);
  }

  return rows;
}

/** The Phase-22 tables whose constraints and triggers must return intact. */
const PHASE22_TABLES = [
  'Course',
  'CourseLabel',
  'CourseSlugHistory',
  'CourseTopic',
  'CourseTeacher',
  'CourseModule',
  'CourseModuleLabel',
  'Lesson',
  'LessonLabel',
  'LearningPath',
  'LearningPathLabel',
  'LearningPathSlugHistory',
  'LearningPathCourse',
  'Enrolment',
  'LessonProgress',
  'TrialClassRequest',
] as const;

/** Every Learning trigger, exactly: two slug reservations and ten integrity rules. */
const PHASE22_TRIGGERS = [
  'LearningCourseIntegrity',
  'LearningEnrolmentOpen',
  'LearningLessonFrozen',
  'LearningLessonLabelFrozen',
  'LearningModuleFrozen',
  'LearningModuleLabelFrozen',
  'LearningPathIntegrity',
  'LearningPathPlaces',
  'LearningProgressOpen',
  'LearningReserveCourseSlug',
  'LearningReservePathSlug',
  'LearningTrialOpen',
].join(',');

/**
 * Verifies the restored Learning state and returns one line of what was
 * proved.
 *
 * BEYOND ROW EQUALITY: every title, summary, description, body, slug, name and
 * address is still an unmistakable sentinel; the public catalogue is exactly
 * the two published Courses and the published path, the draft still a draft;
 * each former slug still resolves to the record that held it and to no other;
 * the live Course's syllabus reads back in module and lesson order, complete in
 * its primary locale; the path holds its published Courses in order; its
 * topic, teacher and content language still resolve through real joins; every
 * enrolment, progress row and trial request is still its own account's, each
 * progress row naming a lesson of the Course its enrolment is on; the search
 * passes owed are still owed; both Learning keys are still bundled; and every
 * Phase-22 CHECK, foreign key and trigger is enabled and trusted, with no key
 * cascading at all.
 */
export async function verifyRestoredPhase22(
  sql: SqlSession,
  fixture: Phase22Fixture,
  expected: Readonly<Record<string, string>>,
  references: Phase22References,
): Promise<string> {
  deepStrictEqual(
    await capturePhase22Fixture(sql, fixture),
    expected,
    'Phase-22 Learning authoritative values changed during recovery.',
  );
  assertReferences(references);
  const f = fixture;
  const r = references;
  const s = slugs(f);
  const courses = `N'${f.liveCourseId}',N'${f.pacedCourseId}',N'${f.draftCourseId}'`;
  const users = `N'${f.learnerId}',N'${f.otherId}'`;

  const [labelled] = await sql.query<Record<string, number>>(`
    SELECT
      (SELECT COUNT(*) FROM [dbo].[CourseLabel] WHERE [courseId] IN (${courses})
         AND ([title] NOT LIKE N'NON[_]LEARNING[_]FIXTURE[_]%' OR [summary] NOT LIKE N'NON[_]LEARNING[_]FIXTURE[_]%'
              OR [description] NOT LIKE N'NON[_]LEARNING[_]FIXTURE[_]%')) AS [courseWords],
      (SELECT COUNT(*) FROM [dbo].[LessonLabel] ll JOIN [dbo].[Lesson] l ON l.[id]=ll.[lessonId]
        WHERE l.[courseId] IN (${courses})
          AND ([title] NOT LIKE N'NON[_]LEARNING[_]FIXTURE[_]%' OR [body] NOT LIKE N'NON[_]LEARNING[_]FIXTURE[_]%')) AS [lessonWords],
      (SELECT COUNT(*) FROM [dbo].[CourseModuleLabel] ml JOIN [dbo].[CourseModule] m ON m.[id]=ml.[moduleId]
        WHERE m.[courseId] IN (${courses}) AND ml.[title] NOT LIKE N'NON[_]LEARNING[_]FIXTURE[_]%') AS [moduleWords],
      (SELECT COUNT(*) FROM [dbo].[LearningPathLabel] WHERE [pathId]=N'${f.pathId}'
         AND [title] NOT LIKE N'NON[_]LEARNING[_]FIXTURE[_]%') AS [pathWords],
      (SELECT COUNT(*) FROM [dbo].[CourseSlugHistory] WHERE [courseId] IN (${courses})
         AND [slug] NOT LIKE N'non-learning-fixture-%')
        + (SELECT COUNT(*) FROM [dbo].[LearningPathSlugHistory] WHERE [pathId]=N'${f.pathId}'
         AND [slug] NOT LIKE N'non-learning-fixture-%') AS [slugs],
      (SELECT COUNT(*) FROM [dbo].[User] WHERE [id] IN (${users})
         AND ([name] NOT LIKE N'NON[_]LEARNING[_]FIXTURE[_]%' OR [email] NOT LIKE N'%@learning-proof.invalid')) AS [accounts];
  `);
  if (
    JSON.stringify(labelled) !==
    '{"courseWords":0,"lessonWords":0,"moduleWords":0,"pathWords":0,"slugs":0,"accounts":0}'
  ) {
    throw new Error(
      `Restored Phase-22 fixture is no longer unmistakably labelled: ${JSON.stringify(labelled)}.`,
    );
  }

  // Publication, redirect history, order, typed references and ownership,
  // through the same joins and predicates the adapters read by.
  const [state] = await sql.query<Record<string, number | string | null>>(`
    SELECT
      (SELECT STRING_AGG([slug], N',') WITHIN GROUP (ORDER BY [slug])
         FROM [dbo].[Course] WHERE [id] IN (${courses}) AND [state]=N'published' AND [publishedAt] IS NOT NULL) AS [published],
      (SELECT [state] FROM [dbo].[Course] WHERE [id]=N'${f.draftCourseId}') AS [draft],
      (SELECT c.[slug] FROM [dbo].[CourseSlugHistory] h JOIN [dbo].[Course] c ON c.[id]=h.[courseId]
        WHERE h.[slug]=N'${s.liveFormer}') AS [courseRedirect],
      (SELECT p.[slug] FROM [dbo].[LearningPathSlugHistory] h JOIN [dbo].[LearningPath] p ON p.[id]=h.[pathId]
        WHERE h.[slug]=N'${s.pathFormer}' AND p.[state]=N'published') AS [pathRedirect],
      (SELECT COUNT(*) FROM [dbo].[CourseSlugHistory] WHERE [courseId]=N'${f.liveCourseId}') AS [liveReserved],
      (SELECT STRING_AGG(l.[id], N',') WITHIN GROUP (ORDER BY m.[position], l.[position])
         FROM [dbo].[Lesson] l JOIN [dbo].[CourseModule] m ON m.[id]=l.[moduleId] AND m.[courseId]=l.[courseId]
         JOIN [dbo].[LessonLabel] ll ON ll.[lessonId]=l.[id] AND ll.[locale]=N'en'
         JOIN [dbo].[CourseModuleLabel] ml ON ml.[moduleId]=m.[id] AND ml.[locale]=N'en'
        WHERE l.[courseId]=N'${f.liveCourseId}') AS [syllabus],
      (SELECT STRING_AGG(pc.[courseId], N',') WITHIN GROUP (ORDER BY pc.[position])
         FROM [dbo].[LearningPathCourse] pc JOIN [dbo].[Course] c ON c.[id]=pc.[courseId] AND c.[state]=N'published'
         JOIN [dbo].[LearningPath] p ON p.[id]=pc.[pathId] AND p.[state]=N'published'
        WHERE pc.[pathId]=N'${f.pathId}') AS [path],
      (SELECT COUNT(*) FROM [dbo].[CourseTopic] ct JOIN [dbo].[Topic] t ON t.[id]=ct.[topicId]
        WHERE ct.[courseId]=N'${f.liveCourseId}' AND t.[id]=N'${r.topicId}')
        + (SELECT COUNT(*) FROM [dbo].[CourseTeacher] tc JOIN [dbo].[Person] p ON p.[id]=tc.[personId]
        WHERE tc.[courseId]=N'${f.liveCourseId}' AND p.[id]=N'${r.personId}')
        + (SELECT COUNT(*) FROM [dbo].[Course] c JOIN [dbo].[Language] g ON g.[code]=c.[languageCode]
        WHERE c.[id]=N'${f.liveCourseId}' AND g.[code]=N'ur') AS [references],
      (SELECT COUNT(*) FROM [dbo].[Enrolment] WHERE [userId]=N'${f.learnerId}') AS [learnerEnrolments],
      (SELECT STRING_AGG([courseId], N',') FROM [dbo].[Enrolment] WHERE [userId]=N'${f.otherId}') AS [otherEnrolments],
      (SELECT COUNT(*) FROM [dbo].[LessonProgress] p
         JOIN [dbo].[Enrolment] e ON e.[userId]=p.[userId] AND e.[courseId]=p.[courseId]
         JOIN [dbo].[Lesson] l ON l.[id]=p.[lessonId] AND l.[courseId]=p.[courseId]
        WHERE p.[userId]=N'${f.learnerId}') AS [progress],
      (SELECT COUNT(*) FROM [dbo].[LessonProgress] WHERE [userId]=N'${f.otherId}') AS [otherProgress],
      (SELECT COUNT(*) FROM [dbo].[TrialClassRequest] t JOIN [dbo].[Course] c ON c.[id]=t.[courseId]
        WHERE t.[id]=N'${f.trialId}' AND t.[userId]=N'${f.learnerId}' AND c.[format]=N'live'
          AND c.[state]=N'published') AS [trial],
      (SELECT STRING_AGG([scopeKind], N',') WITHIN GROUP (ORDER BY [scopeKind])
         FROM [dbo].[SearchIndexRequest] WHERE [scopeId] IN (N'${f.liveCourseId}', N'${f.pathId}')) AS [search],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] rp JOIN [dbo].[Role] o ON o.[id]=rp.[roleId]
        WHERE o.[key]=N'platform-administrator'
          AND rp.[permissionKey] IN (N'learning.read', N'learning.administer')) AS [learningBundled];
  `);
  const expectedState = {
    published: [s.live, s.paced].sort().join(','),
    draft: 'draft',
    courseRedirect: s.live,
    pathRedirect: s.path,
    liveReserved: 2,
    syllabus: `${f.firstLessonId},${f.secondLessonId},${f.thirdLessonId}`,
    path: `${f.pacedCourseId},${f.liveCourseId}`,
    references: 3,
    learnerEnrolments: 2,
    otherEnrolments: f.liveCourseId,
    progress: 2,
    otherProgress: 0,
    trial: 1,
    search: 'course,learning-path',
    learningBundled: 2,
  };
  if (JSON.stringify(state) !== JSON.stringify(expectedState)) {
    throw new Error(
      `Restored Phase-22 Learning state is broken: ${JSON.stringify(state)}.`,
    );
  }

  const tables = PHASE22_TABLES.map((table) => `OBJECT_ID(N'${table}')`).join(',');
  const broken = await sql.query<{ name: string }>(
    `SELECT [name] FROM sys.check_constraints
     WHERE parent_object_id IN (${tables}) AND (is_disabled=1 OR is_not_trusted=1)
     UNION ALL
     SELECT [name] FROM sys.foreign_keys
     WHERE parent_object_id IN (${tables})
       AND (is_disabled=1 OR is_not_trusted=1 OR delete_referential_action<>0 OR update_referential_action<>0)
     UNION ALL
     SELECT [name] FROM sys.triggers WHERE parent_id IN (${tables}) AND is_disabled=1;`,
  );
  if (broken.length > 0) {
    throw new Error(
      `Restored Phase-22 constraints or triggers are not intact: ${broken.map((row) => row.name).join(', ')}`,
    );
  }

  const [counts] = await sql.query<{
    checks: number;
    keys: number;
    triggers: string | null;
    filtered: number;
  }>(
    `SELECT
       (SELECT COUNT_BIG(*) FROM sys.check_constraints WHERE parent_object_id IN (${tables})) AS [checks],
       (SELECT COUNT_BIG(*) FROM sys.foreign_keys WHERE parent_object_id IN (${tables})) AS [keys],
       (SELECT STRING_AGG([name], N',') WITHIN GROUP (ORDER BY [name]) FROM sys.triggers
         WHERE parent_id IN (${tables})) AS [triggers],
       (SELECT COUNT_BIG(*) FROM sys.indexes
         WHERE [object_id] IN (${tables}) AND has_filter=1) AS [filtered];`,
  );
  // 14 CHECKs, 21 foreign keys none of which cascades, the 12 triggers and no
  // filtered index, exactly as the migration creates them: a restore that
  // silently lost one would otherwise read as "none untrusted".
  if (
    Number(counts?.checks ?? 0) !== 14 ||
    Number(counts?.keys ?? 0) !== 21 ||
    counts?.triggers !== PHASE22_TRIGGERS ||
    Number(counts.filtered) !== 0
  ) {
    throw new Error(
      `Restored Phase-22 objects are incomplete: ${JSON.stringify(counts ?? null)}.`,
    );
  }

  return 'a whole public catalogue — two published Courses with ordered, complete syllabi and a draft kept private — a published path in order, former slugs resolving only to their own records, topic, teacher and content language resolving, owner-scoped enrolments with progress bound to their own Course and a live trial request, the search passes owed, both Learning keys bundled and every key, CHECK and trigger trusted with no cascade';
}
