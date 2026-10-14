import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type {
  CourseDetail,
  LearningPersistencePort,
} from '../../packages/contracts/src/learning/index.ts';
import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';
import { account, freshSlug, n } from '../learning/fixture-sql.ts';
import { buildSearchHarness, type SearchHarness } from './harness.ts';

/**
 * Phase 22 — Courses and LearningPaths in the Search foundation, over REAL SQL
 * Server Full-Text Search.
 *
 * WHAT IS PROVED, and only against the live engine:
 *
 *   - a draft Course or path is never indexed, though every save owes a pass;
 *   - a published Course is ONE result at `/learn/courses/{slug}`, found by its
 *     words and its PUBLIC syllabus (module and lesson titles and summaries) —
 *     and never by a lesson body, which only an enrolled learner reads;
 *   - a published path is ONE result at `/learn/paths/{slug}`;
 *   - a slug change moves the result's address;
 *   - an archived Course is WITHHELD at query time while its stale row remains,
 *     its owed pass then drops it, and a Course returned to draft whose pass was
 *     lost is dropped by reconciliation;
 *   - the inventory rebuilds from the owner alone, and reconciliation repairs a
 *     lost projection and an unannounced change and then converges.
 *
 * NOTHING HERE IS A COURSE. Every text is a `NON_LEARNING_FIXTURE_…` sentinel
 * followed by one invented Latin word, so a query can name exactly one text.
 *
 * Runs in the `Database foundation` CI job (`npm run test:search`), where a
 * skipped suite fails the job (`scripts/assert-search-proofs.mjs`).
 */

const live = databaseConfigured ? describe : describe.skip;

const WORD = {
  shared: 'quarrystepfixture',
  title1: 'lanternwickfixture',
  summary1: 'mossgatefixture',
  module1: 'cobbleridgefixture',
  lesson1: 'reedhollowfixture',
  body1: 'ashvanefixture',
  draft: 'pinecradlefixture',
  title2: 'willowmerefixture',
  title3: 'stonebrookfixture',
  path: 'heronfoldfixture',
} as const;

const label = (title: string, summary = '', description = '') => ({
  locale: 'en' as const,
  title,
  summary,
  description,
});

live('Phase 22 Learning in Search (real SQL Server FTS)', () => {
  let db: DisposableDatabase;
  let h: SearchHarness;
  let store: LearningPersistencePort;
  let actorId: string;

  const c = { one: '', two: '', three: '', draft: '' };
  const slug = { one: freshSlug('search-one'), two: freshSlug('search-two') };
  let pathId = '';
  let pathSlug = '';

  async function find(q: string, extra: Record<string, string> = {}) {
    const outcome = await h.search.search({ q, ...extra }, { locale: 'en' });
    if (outcome.state !== 'results')
      throw new Error(`Expected results for a proof query, got ${outcome.state}.`);
    return outcome.results;
  }

  async function found(q: string, extra: Record<string, string> = {}) {
    return (await find(q, extra)).hits.map((hit) => hit.resourceId).sort();
  }

  async function documents(kind: 'course' | 'learning-path'): Promise<number> {
    const [row] = await db.admin.query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM [dbo].[SearchDocument] WHERE [kind] = ${n(kind)};`,
    );
    return Number(row?.total ?? -1);
  }

  async function documentsOf(id: string): Promise<number> {
    const [row] = await db.admin.query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM [dbo].[SearchDocument] WHERE [scopeId] = ${n(id)};`,
    );
    return Number(row?.total ?? -1);
  }

  /** How many indexed documents hold `text` anywhere in their stored or matching text. */
  async function indexedWith(text: string): Promise<number> {
    const [row] = await db.admin.query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM [dbo].[SearchDocument]
        WHERE CHARINDEX(${n(text.toLowerCase())}, LOWER(CONCAT([title], [summary], [matchEnglish], [matchArabic], [matchUrdu], [matchOther]))) > 0;`,
    );
    return Number(row?.total ?? -1);
  }

  /** A complete one-module, one-lesson Course, saved as a draft. */
  async function draftCourse(input: {
    readonly slug: string;
    readonly title: string;
    readonly summary?: string;
    readonly module?: string;
    readonly lesson?: string;
    readonly body?: string;
  }): Promise<CourseDetail> {
    const created = await store.saveCourse({
      actorId,
      id: null,
      expectedVersion: null,
      value: {
        slug: input.slug,
        primaryLocale: 'en',
        level: 'beginner',
        format: 'self-paced',
        languageCode: 'en',
        labels: [
          label(
            input.title,
            input.summary ?? '',
            `NON_LEARNING_FIXTURE_DESCRIPTION ${WORD.shared}`,
          ),
        ],
        topicIds: [],
        teacherIds: [],
      },
    });
    const withModule = await store.changeModule({
      actorId,
      courseId: created.id,
      expectedVersion: created.version,
      change: {
        op: 'add',
        labels: [
          {
            locale: 'en',
            title: input.module ?? 'NON_LEARNING_FIXTURE_MODULE',
            summary: '',
          },
        ],
      },
    });
    return store.changeLesson({
      actorId,
      courseId: created.id,
      expectedVersion: withModule.version,
      change: {
        op: 'add',
        moduleId: withModule.outline[0]!.id,
        labels: [
          {
            locale: 'en',
            title: input.lesson ?? 'NON_LEARNING_FIXTURE_LESSON',
            summary: '',
            body: input.body ?? 'NON_LEARNING_FIXTURE_BODY',
          },
        ],
      },
    });
  }

  async function publish(course: CourseDetail): Promise<CourseDetail> {
    return store.transitionCourse({
      actorId,
      id: course.id,
      expectedVersion: course.version,
      state: 'published',
    });
  }

  async function current(id: string): Promise<CourseDetail> {
    const record = await store.course(id);
    if (record === null) throw new Error('fixture course missing');
    return record;
  }

  beforeAll(async () => {
    db = await createProofDatabase();
    h = await buildSearchHarness(db.admin);
    const database = await import('../../packages/database/src/index.ts');
    store = database.createLearningPersistence();
    actorId = await account(db.admin);

    c.one = (
      await publish(
        await draftCourse({
          slug: slug.one,
          title: `NON_LEARNING_FIXTURE_COURSE_1 ${WORD.title1}`,
          summary: `NON_LEARNING_FIXTURE_SUMMARY_1 ${WORD.summary1}`,
          module: `NON_LEARNING_FIXTURE_MODULE_1 ${WORD.module1}`,
          lesson: `NON_LEARNING_FIXTURE_LESSON_1 ${WORD.lesson1}`,
          body: `NON_LEARNING_FIXTURE_BODY_1 ${WORD.body1}`,
        }),
      )
    ).id;
    c.two = (
      await publish(
        await draftCourse({
          slug: slug.two,
          title: `NON_LEARNING_FIXTURE_COURSE_2 ${WORD.title2}`,
        }),
      )
    ).id;
    c.three = (
      await publish(
        await draftCourse({
          slug: freshSlug('search-three'),
          title: `NON_LEARNING_FIXTURE_COURSE_3 ${WORD.title3}`,
        }),
      )
    ).id;
    c.draft = (
      await draftCourse({
        slug: freshSlug('search-draft'),
        title: `NON_LEARNING_FIXTURE_COURSE_DRAFT ${WORD.draft}`,
      })
    ).id;

    pathSlug = freshSlug('search-path');
    const path = await store.savePath({
      actorId,
      id: null,
      expectedVersion: null,
      value: {
        slug: pathSlug,
        primaryLocale: 'en',
        labels: [label(`NON_LEARNING_FIXTURE_PATH ${WORD.path}`)],
      },
    });
    const member = await store.setPathCourses({
      actorId,
      pathId: path.id,
      expectedVersion: path.version,
      courseIds: [c.one],
      change: 'add',
    });
    pathId = (
      await store.transitionPath({
        actorId,
        id: path.id,
        expectedVersion: member.version,
        state: 'published',
      })
    ).id;
  }, 600_000);

  afterAll(async () => {
    await db?.close();
  }, 120_000);

  it('owes a pass for every save, and indexes only what is published', async () => {
    const [row] = await db.admin.query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM [dbo].[SearchIndexRequest]
        WHERE [scopeKind] IN (N'course', N'learning-path') AND [scopeId] = ${n(c.draft)};`,
    );
    expect(Number(row?.total)).toBeGreaterThan(0);

    await h.indexNow();
    expect(await documentsOf(c.draft)).toBe(0);
    expect(await documents('course')).toBe(3);
    expect(await documents('learning-path')).toBe(1);
    expect(await found(WORD.draft)).toEqual([]);
  });

  it('finds a Course by its words and its public syllabus, never by a lesson body', async () => {
    for (const word of [WORD.title1, WORD.summary1, WORD.module1, WORD.lesson1]) {
      const results = await find(word);
      expect(results.hits, word).toHaveLength(1);
      expect(results.hits[0], word).toMatchObject({
        kind: 'course',
        resourceId: c.one,
        href: `/learn/courses/${slug.one}`,
        textLanguage: 'en',
        contentLanguage: 'en',
      });
    }
    // The probe can see a word (above); a lesson body is simply not there.
    expect(await indexedWith(WORD.body1)).toBe(0);
    expect(await indexedWith('NON_LEARNING_FIXTURE_BODY')).toBe(0);
    expect(await found(WORD.body1)).toEqual([]);
  });

  it('finds a published path at /learn/paths/{slug}, and filters by kind', async () => {
    const results = await find(WORD.path);
    expect(results.hits).toHaveLength(1);
    expect(results.hits[0]).toMatchObject({
      kind: 'learning-path',
      resourceId: pathId,
      href: `/learn/paths/${pathSlug}`,
    });
    expect(await found(WORD.title1, { type: 'course' })).toEqual([c.one]);
    expect(await found(WORD.title1, { type: 'learning-path' })).toEqual([]);
    expect(await found(WORD.path, { type: 'learning-path' })).toEqual([pathId]);
  });

  it('moves a result to its new address when the slug changes', async () => {
    const before = await current(c.two);
    const renamed = freshSlug('search-renamed');
    await store.saveCourse({
      actorId,
      id: c.two,
      expectedVersion: before.version,
      value: {
        slug: renamed,
        primaryLocale: 'en',
        level: before.level,
        format: before.format,
        languageCode: before.languageCode,
        labels: before.labels.map((entry) => ({ ...entry })),
        topicIds: [...before.topicIds],
        teacherIds: [...before.teacherIds],
      },
    });
    // The address is resolved at query time, so it moves before any re-index.
    expect((await find(WORD.title2)).hits[0]?.href).toBe(`/learn/courses/${renamed}`);
    await h.indexNow();
    expect((await find(WORD.title2)).hits[0]?.href).toBe(`/learn/courses/${renamed}`);
  });

  it('withholds an archived Course while its stale row remains, then its owed pass drops it', async () => {
    const before = await current(c.three);
    await store.transitionCourse({
      actorId,
      id: c.three,
      expectedVersion: before.version,
      state: 'archived',
    });
    expect(await documentsOf(c.three)).toBe(1);
    const stale = await find(WORD.title3);
    expect(stale.hits).toEqual([]);
    expect(stale.withheld).toBe(1);

    await h.indexNow();
    expect(await documentsOf(c.three)).toBe(0);
    expect((await find(WORD.title3)).withheld).toBe(0);
  });

  it('drops a Course returned to draft whose owed pass was lost, by reconciliation', async () => {
    const before = await current(c.two);
    await store.transitionCourse({
      actorId,
      id: c.two,
      expectedVersion: before.version,
      state: 'draft',
    });
    await db.admin.query(
      `DELETE FROM [dbo].[SearchIndexRequest] WHERE [scopeKind] = N'course' AND [scopeId] = ${n(c.two)};`,
    );
    await h.indexNow();
    expect(await documentsOf(c.two)).toBe(1);
    const stale = await find(WORD.title2);
    expect(stale.hits).toEqual([]);
    expect(stale.withheld).toBe(1);

    expect((await h.search.reconcile()).orphaned).toBe(1);
    await h.indexNow();
    expect(await documentsOf(c.two)).toBe(0);
  });

  it('rebuilds the Learning inventory from the owner alone, starting from empty', async () => {
    await db.admin.query(
      `DELETE FROM [dbo].[SearchDocumentTopic]; DELETE FROM [dbo].[SearchDocument];
       DELETE FROM [dbo].[SearchIndexScope]; DELETE FROM [dbo].[SearchIndexRequest];`,
    );
    await h.engineSettled();
    expect(await found(WORD.title1)).toEqual([]);

    await h.search.rebuild();
    await h.indexNow();
    expect(await documents('course')).toBe(1);
    expect(await documents('learning-path')).toBe(1);
    expect(await found(WORD.title1)).toEqual([c.one]);
    expect(await found(WORD.path)).toEqual([pathId]);
    for (const word of [WORD.title2, WORD.title3, WORD.draft, WORD.body1])
      expect(await found(word), word).toEqual([]);
  });

  it('reconciles a projection the index lost and one its owner changed unannounced', async () => {
    await db.admin.query(
      `DELETE FROM [dbo].[SearchDocument] WHERE [scopeKind] = N'learning-path' AND [scopeId] = ${n(pathId)};`,
    );
    // A Course's words changed with no request, as a restore or a manual repair
    // might: only the owner's stamp — version and instant — can tell.
    await db.admin.query(
      `UPDATE [dbo].[CourseLabel] SET [title] = N'NON_LEARNING_FIXTURE_COURSE_1 corrected'
        WHERE [courseId] = ${n(c.one)};
       UPDATE [dbo].[Course] SET [version] = [version] + 1, [updatedAt] = SYSUTCDATETIME()
        WHERE [id] = ${n(c.one)};`,
    );
    await h.engineSettled();
    expect(await found(WORD.path)).toEqual([]);

    const summary = await h.search.reconcile();
    expect(summary.missing).toBe(1);
    expect(summary.stale).toBe(1);
    await h.indexNow();
    expect(await found(WORD.path)).toEqual([pathId]);
    expect(await found(WORD.title1)).toEqual([]);
    expect(await found(WORD.module1)).toEqual([c.one]);

    expect(await h.search.reconcile()).toMatchObject({
      missing: 0,
      stale: 0,
      orphaned: 0,
    });
  });

  it('reports no swallowed failure', () => {
    expect(h.reported).toEqual([]);
  });
});
