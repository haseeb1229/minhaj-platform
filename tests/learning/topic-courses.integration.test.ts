import { randomUUID } from 'node:crypto';

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
  type SqlSession,
  parseSqlServerUrl,
} from '../../packages/database/src/lifecycle/sql-connection.ts';
import { createLearningReadService } from '../../apps/web/src/contexts/learning/index.ts';
import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';
import { n, person, sentinel } from './fixture-sql.ts';

/**
 * Quran Part 13 against real SQL Server, as the REAL least-privilege RUNTIME
 * principal — Learning's public Topic course hub read:
 *
 *   - the set: every PUBLISHED Course on the named Topic; a draft, an archived
 *     Course and a Course on another Topic are absent; with no Topic, nothing;
 *   - a format, a level, a content language and a teacher, alone and combined;
 *   - the three orders, each total — by level (unstated last; the latest
 *     publication first within a level), newest, and by the title a reader
 *     of the given locale is shown; bounded pages with the total the query
 *     admits, past the end included;
 *   - each card: the catalogue's own listing — labels, teachers in order, its
 *     module and lesson counts;
 *   - the facets, each leaving its own filter out of its own counts;
 *   - the published LearningPaths holding one of the Topic's Courses.
 *
 * The owner/migration session writes the rows only another context — or an
 * operator — may write; EVERYTHING read goes through Learning's adapter,
 * whose Prisma client is bound to the provisioned runtime principal.
 * Synthetic `NON_LEARNING_FIXTURE_…` words only.
 */

const live = databaseConfigured ? describe : describe.skip;

type Key = 'alif' | 'baa' | 'jeem' | 'daal' | 'haa' | 'draft' | 'archived' | 'elsewhere';

live('Quran Part 13 — the Topic course hub read against real SQL Server', () => {
  let db: DisposableDatabase;
  let app: SqlSession;
  let reads: ReturnType<typeof createLearningReadService>;
  let quran: string;
  let hadith: string;
  let teacherA: string;
  let teacherB: string;
  const run = randomUUID().slice(0, 8);
  const id = Object.fromEntries(
    (
      ['alif', 'baa', 'jeem', 'daal', 'haa', 'draft', 'archived', 'elsewhere'] as const
    ).map((key) => [key, randomUUID()]),
  ) as Record<Key, string>;
  const title = (key: Key) =>
    `${key[0]?.toUpperCase() ?? ''}${key.slice(1)} ${sentinel('COURSE', run)}`;
  const path = { quran: randomUUID(), other: randomUUID(), draft: randomUUID() };

  const ids = (page: { items: readonly { id: string }[] }) =>
    page.items.map((item) => item.id);

  beforeAll(async () => {
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
    const { createLearningPublicReader } =
      await import('../../packages/database/src/index.ts');
    reads = createLearningReadService(createLearningPublicReader());

    const topics = await db.admin.query<{ id: string; slug: string }>(
      `SELECT [id],[slug] FROM [dbo].[Topic] WHERE [slug] IN (N'quran', N'hadith');`,
    );
    const topicOf = (slug: string) => {
      const row = topics.find((entry) => entry.slug === slug);
      if (row === undefined) throw new Error(`The seeded ${slug} Topic is missing.`);
      return row.id;
    };
    quran = topicOf('quran');
    hadith = topicOf('hadith');
    teacherA = await person(db.admin);
    teacherB = await person(db.admin);

    /**
     * One Course with a complete syllabus (`lessons`, one module each), its
     * labels, Topics and teachers, written as a draft and then moved to its
     * state — so the migration's own publication triggers admit it.
     */
    const course = (
      key: Key,
      fields: {
        readonly level: string | null;
        readonly format: 'live' | 'self-paced';
        readonly language: string;
        readonly topics: readonly string[];
        readonly teachers: readonly string[];
        readonly lessons: readonly number[];
        readonly published: string;
        readonly state?: 'published' | 'archived' | 'draft';
        readonly arabicTitle?: string;
      },
    ) => {
      const modules = fields.lessons.map((count, position) => {
        const moduleId = randomUUID();
        const lessons = Array.from({ length: count }, (_, index) => {
          const lessonId = randomUUID();
          return `
            INSERT INTO [dbo].[Lesson] ([id],[courseId],[moduleId],[position]) VALUES (N'${lessonId}', N'${id[key]}', N'${moduleId}', ${String(index)});
            INSERT INTO [dbo].[LessonLabel] ([lessonId],[locale],[title],[summary],[body]) VALUES (N'${lessonId}', N'en', ${n(sentinel('LESSON', lessonId))}, N'', ${n(sentinel('BODY', lessonId))});`;
        }).join('');
        return `
          INSERT INTO [dbo].[CourseModule] ([id],[courseId],[position]) VALUES (N'${moduleId}', N'${id[key]}', ${String(position)});
          INSERT INTO [dbo].[CourseModuleLabel] ([moduleId],[locale],[title],[summary]) VALUES (N'${moduleId}', N'en', ${n(sentinel('MODULE', moduleId))}, N'');
          ${lessons}`;
      });
      return `
        INSERT INTO [dbo].[Course] ([id],[slug],[primaryLocale],[state],[level],[format],[languageCode],[publishedAt],[version],[updatedAt]) VALUES
          (N'${id[key]}', N'non-learning-fixture-hub-${key}-${run}', N'en', N'draft',
           ${fields.level === null ? 'NULL' : n(fields.level)}, ${n(fields.format)}, ${n(fields.language)}, NULL, 1, SYSUTCDATETIME());
        INSERT INTO [dbo].[CourseLabel] ([courseId],[locale],[title],[summary],[description]) VALUES
          (N'${id[key]}', N'en', ${n(title(key))}, ${n(sentinel('SUMMARY', key))}, N'')
          ${fields.arabicTitle === undefined ? '' : `, (N'${id[key]}', N'ar', ${n(fields.arabicTitle)}, N'', N'')`};
        ${fields.topics.map((topic) => `INSERT INTO [dbo].[CourseTopic] ([courseId],[topicId]) VALUES (N'${id[key]}', N'${topic}');`).join('\n')}
        ${fields.teachers.map((teacher, position) => `INSERT INTO [dbo].[CourseTeacher] ([courseId],[personId],[position]) VALUES (N'${id[key]}', N'${teacher}', ${String(position)});`).join('\n')}
        ${modules.join('\n')}
        UPDATE [dbo].[Course] SET [state] = N'published', [publishedAt] = '${fields.published}', [version] = 2
          WHERE [id] = N'${id[key]}';
        ${
          fields.state === undefined || fields.state === 'published'
            ? ''
            : `UPDATE [dbo].[Course] SET [state] = N'${fields.state}', [version] = 3 WHERE [id] = N'${id[key]}';`
        }`;
    };

    await db.admin.query(
      [
        course('alif', {
          level: 'beginner',
          format: 'self-paced',
          language: 'en',
          topics: [quran],
          teachers: [teacherA],
          lessons: [2],
          published: '2021-01-01T00:00:00',
        }),
        course('baa', {
          level: 'beginner',
          format: 'live',
          language: 'ur',
          topics: [quran, hadith],
          teachers: [teacherA, teacherB],
          lessons: [1, 2],
          published: '2023-01-01T00:00:00',
        }),
        course('jeem', {
          level: 'intermediate',
          format: 'self-paced',
          language: 'en',
          topics: [quran],
          teachers: [teacherB],
          lessons: [1],
          published: '2022-01-01T00:00:00',
          arabicTitle: `Aaa ${sentinel('ARABIC', run)}`,
        }),
        course('daal', {
          level: 'advanced',
          format: 'live',
          language: 'ar',
          topics: [quran],
          teachers: [],
          lessons: [3],
          published: '2020-01-01T00:00:00',
        }),
        course('haa', {
          level: null,
          format: 'self-paced',
          language: 'en',
          topics: [quran],
          teachers: [],
          lessons: [1],
          published: '2024-01-01T00:00:00',
        }),
        course('draft', {
          level: 'beginner',
          format: 'self-paced',
          language: 'en',
          topics: [quran],
          teachers: [teacherA],
          lessons: [1],
          published: '2025-01-01T00:00:00',
          state: 'draft',
        }),
        course('archived', {
          level: 'beginner',
          format: 'live',
          language: 'en',
          topics: [quran],
          teachers: [teacherB],
          lessons: [1],
          published: '2025-01-01T00:00:00',
          state: 'archived',
        }),
        course('elsewhere', {
          level: 'beginner',
          format: 'self-paced',
          language: 'en',
          topics: [hadith],
          teachers: [teacherA],
          lessons: [1],
          published: '2025-01-01T00:00:00',
        }),
      ].join('\n'),
    );

    const learningPath = (
      key: keyof typeof path,
      members: readonly Key[],
      state: 'published' | 'draft',
      published: string,
    ) => `
      INSERT INTO [dbo].[LearningPath] ([id],[slug],[primaryLocale],[state],[publishedAt],[version],[updatedAt]) VALUES
        (N'${path[key]}', N'non-learning-fixture-hub-path-${key}-${run}', N'en', N'draft', NULL, 1, SYSUTCDATETIME());
      INSERT INTO [dbo].[LearningPathLabel] ([pathId],[locale],[title],[summary],[description]) VALUES
        (N'${path[key]}', N'en', ${n(sentinel('PATH', key))}, N'', N'');
      ${members.map((member, position) => `INSERT INTO [dbo].[LearningPathCourse] ([pathId],[courseId],[position]) VALUES (N'${path[key]}', N'${id[member]}', ${String(position)});`).join('\n')}
      ${
        state === 'published'
          ? `UPDATE [dbo].[LearningPath] SET [state] = N'published', [publishedAt] = '${published}', [version] = 2 WHERE [id] = N'${path[key]}';`
          : ''
      }`;
    await db.admin.query(
      [
        learningPath('quran', ['elsewhere', 'jeem'], 'published', '2024-06-01T00:00:00'),
        learningPath('other', ['elsewhere'], 'published', '2024-07-01T00:00:00'),
        learningPath('draft', ['alif'], 'draft', '2024-08-01T00:00:00'),
      ].join('\n'),
    );
  }, 300_000);

  afterAll(async () => {
    await app?.close();
    await db?.close();
  });

  const query = (fields: Record<string, unknown> = {}) => ({ topic: quran, ...fields });

  it('reads every published Course on the Topic, by level — and never a draft, an archived Course or another Topic’s', async () => {
    const page = await reads.topicCourses(query());
    expect(ids(page)).toEqual([id.baa, id.alif, id.jeem, id.daal, id.haa]);
    expect(page.total).toBe(5);
    expect(page.hasMore).toBe(false);
  });

  it('reads nothing at all without a Topic, and only its own Courses for another', async () => {
    expect(await reads.topicCourses({ topic: null })).toEqual({
      items: [],
      total: 0,
      hasMore: false,
    });
    // Both beginners: the later publication first.
    expect(ids(await reads.topicCourses({ topic: hadith }))).toEqual([
      id.elsewhere,
      id.baa,
    ]);
    expect(ids(await reads.topicCourses({ topic: randomUUID() }))).toEqual([]);
  });

  it('carries the catalogue’s own card for each Course', async () => {
    const page = await reads.topicCourses(query({ format: 'live', level: 'beginner' }));
    expect(page.items).toHaveLength(1);
    const baa = page.items[0];
    expect(baa).toMatchObject({
      id: id.baa,
      slug: `non-learning-fixture-hub-baa-${run}`,
      state: 'published',
      level: 'beginner',
      format: 'live',
      languageCode: 'ur',
      teacherIds: [teacherA, teacherB],
      modules: 2,
      lessons: 3,
    });
    expect(baa?.labels).toEqual([
      { locale: 'en', title: title('baa'), summary: sentinel('SUMMARY', 'baa') },
    ]);
    // A card is never a lesson body or a description.
    expect(JSON.stringify(page)).not.toContain('NON_LEARNING_FIXTURE_BODY');
  });

  it('orders newest first and by title, as the reader’s locale names each Course', async () => {
    expect(ids(await reads.topicCourses(query({ sort: 'newest' })))).toEqual([
      id.haa,
      id.baa,
      id.jeem,
      id.alif,
      id.daal,
    ]);
    expect(
      ids(await reads.topicCourses(query({ sort: 'title', titleLocale: 'en' }))),
    ).toEqual([id.alif, id.baa, id.daal, id.haa, id.jeem]);
    // In Arabic, the one Course with Arabic words is named — and sorted — by them.
    expect(
      ids(await reads.topicCourses(query({ sort: 'title', titleLocale: 'ar' }))),
    ).toEqual([id.jeem, id.alif, id.baa, id.daal, id.haa]);
  });

  it('narrows by format, level, content language and teacher — alone and combined', async () => {
    expect(ids(await reads.topicCourses(query({ format: 'live' })))).toEqual([
      id.baa,
      id.daal,
    ]);
    expect(ids(await reads.topicCourses(query({ format: 'self-paced' })))).toEqual([
      id.alif,
      id.jeem,
      id.haa,
    ]);
    expect(ids(await reads.topicCourses(query({ level: 'beginner' })))).toEqual([
      id.baa,
      id.alif,
    ]);
    expect(ids(await reads.topicCourses(query({ language: 'en' })))).toEqual([
      id.alif,
      id.jeem,
      id.haa,
    ]);
    expect(ids(await reads.topicCourses(query({ teacher: teacherA })))).toEqual([
      id.baa,
      id.alif,
    ]);
    expect(
      ids(await reads.topicCourses(query({ teacher: teacherB, format: 'self-paced' }))),
    ).toEqual([id.jeem]);
    const none = await reads.topicCourses(query({ level: 'advanced', language: 'en' }));
    expect(none).toEqual({ items: [], total: 0, hasMore: false });
    expect(ids(await reads.topicCourses(query({ teacher: randomUUID() })))).toEqual([]);
  });

  it('pages within its bound, with the total the query admits — past the end included', async () => {
    const first = await reads.topicCourses(query({ limit: 2 }));
    expect(ids(first)).toEqual([id.baa, id.alif]);
    expect(first).toMatchObject({ total: 5, hasMore: true });
    const last = await reads.topicCourses(query({ limit: 2, offset: 4 }));
    expect(ids(last)).toEqual([id.haa]);
    expect(last).toMatchObject({ total: 5, hasMore: false });
    const past = await reads.topicCourses(query({ limit: 2, offset: 10 }));
    expect(past).toEqual({ items: [], total: 5, hasMore: false });
    const pastFiltered = await reads.topicCourses(query({ format: 'live', offset: 12 }));
    expect(pastFiltered).toEqual({ items: [], total: 2, hasMore: false });
  });

  it('counts the hub, and each facet without its own filter', async () => {
    expect(await reads.topicCourseFacets(query())).toEqual({
      hub: { courses: 5, live: 2, selfPaced: 3, lessons: 10, teachers: 2, languages: 3 },
      formats: { all: 5, live: 2, selfPaced: 3 },
      levels: { beginner: 2, intermediate: 1, advanced: 1 },
      languages: {
        items: [
          { id: 'en', courses: 3 },
          { id: 'ar', courses: 1 },
          { id: 'ur', courses: 1 },
        ],
        hasMore: false,
      },
      teachers: {
        items: [
          { id: teacherA, courses: 2 },
          { id: teacherB, courses: 2 },
        ].sort((a, b) => (a.id < b.id ? -1 : 1)),
        hasMore: false,
      },
    });

    // Under "taught live": the hub and the formats ignore the format, every
    // other facet counts within it.
    const liveOnly = await reads.topicCourseFacets(query({ format: 'live' }));
    expect(liveOnly.hub.courses).toBe(5);
    expect(liveOnly.formats).toEqual({ all: 5, live: 2, selfPaced: 3 });
    expect(liveOnly.levels).toEqual({ beginner: 1, intermediate: 0, advanced: 1 });
    expect(liveOnly.languages.items).toEqual([
      { id: 'ar', courses: 1 },
      { id: 'ur', courses: 1 },
    ]);

    // Under one teacher: the formats count within that teacher; the teacher
    // facet still offers every teacher, as the other filters allow.
    const byA = await reads.topicCourseFacets(query({ teacher: teacherA }));
    expect(byA.formats).toEqual({ all: 2, live: 1, selfPaced: 1 });
    expect(byA.levels).toEqual({ beginner: 2, intermediate: 0, advanced: 0 });
    expect(byA.teachers.items.map((facet) => facet.id).sort()).toEqual(
      [teacherA, teacherB].sort(),
    );
    const byALive = await reads.topicCourseFacets(
      query({ teacher: teacherA, format: 'live' }),
    );
    expect(
      byALive.teachers.items.map((facet) => [facet.id, facet.courses]).sort(),
    ).toEqual(
      [
        [teacherA, 1],
        [teacherB, 1],
      ].sort(),
    );

    // An unstated level is counted by no level.
    const unstated = await reads.topicCourseFacets(query({ language: 'en' }));
    expect(unstated.levels).toEqual({ beginner: 1, intermediate: 1, advanced: 0 });
    expect(unstated.formats.all).toBe(3);
  });

  it('counts nothing without a Topic', async () => {
    expect(await reads.topicCourseFacets({ topic: null })).toEqual({
      hub: { courses: 0, live: 0, selfPaced: 0, lessons: 0, teachers: 0, languages: 0 },
      formats: { all: 0, live: 0, selfPaced: 0 },
      levels: { beginner: 0, intermediate: 0, advanced: 0 },
      languages: { items: [], hasMore: false },
      teachers: { items: [], hasMore: false },
    });
  });

  it('names the published paths holding one of the Topic’s Courses — never a draft path or another Topic’s', async () => {
    const paths = await reads.topicCoursePaths(quran);
    expect(paths.map((entry) => entry.id)).toEqual([path.quran]);
    expect(paths[0]).toMatchObject({
      slug: `non-learning-fixture-hub-path-quran-${run}`,
      state: 'published',
      courses: 2,
    });
    expect((await reads.topicCoursePaths(hadith)).map((entry) => entry.id)).toEqual([
      path.other,
      path.quran,
    ]);
    expect(await reads.topicCoursePaths(null)).toEqual([]);
  });
});
