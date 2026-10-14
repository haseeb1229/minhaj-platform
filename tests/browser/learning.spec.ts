import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Browser, BrowserContext, Locator, Page } from '@playwright/test';

import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import {
  newPhase5Fixture,
  writePhase5Fixture,
  type Phase5Fixture,
} from '../../packages/database/src/lifecycle/phase5-fixture.ts';
import {
  BUTTON,
  LABEL,
  PASSWORD,
  accountIdFor,
  asTwoVisitors,
  baseUrl,
  expect,
  firstDifference,
  grantRole,
  knowledgeOf,
  privilegedSession,
  registerAndSignIn,
  test,
} from './support';

/**
 * Phase 22 — Learning in a real browser, against the production build.
 *
 * WHAT ONLY A BROWSER CAN PROVE: that Learn says honestly when nothing is
 * published and invents nothing; that the public catalogue lists only
 * published Courses, that every filter narrows and an unknown one explains an
 * empty result rather than broadening, that a Course page shows its syllabus
 * but never a lesson's text, that a draft is a 404 and a former slug ONE 301;
 * that a Course page is the SAME document for an anonymous visitor and two
 * different signed-in people, sets no cookie, and survives its private island
 * failing; that a learner enrols, reads, marks lessons complete and requests a
 * trial class — which enrols nobody and books nothing — and finds all of it on
 * their own My Learning pages and on nobody else's; that the personal handlers
 * refuse another origin and an anonymous caller; that Learning administration
 * is refused without its keys, read-only with `learning.read`, freezes a
 * published syllabus, names its ordering controls with their positions and
 * refuses a stale save visibly; and that the surfaces are right-to-left in
 * Urdu and Arabic, reflow at 320 pixels and at 200% zoom, reach their controls
 * by keyboard with a visible focus, label every control, say progress in words
 * and do not move under reduced motion.
 *
 * ONE SERIAL FILE, BECAUSE IT IS ONE CATALOGUE'S STORY. The first proof is
 * the empty catalogue, so it must run before anything is published; every
 * later step reads what the one before it did.
 *
 * EVERYTHING IS SYNTHETIC. Every word is a `NON_LEARNING_FIXTURE` sentinel and
 * every slug a `non-learning-fixture-` one, which no other spec looks for; the
 * accounts are fresh. NO OTHER SPEC PUBLISHES A COURSE, which is what makes the
 * empty-catalogue proof order-independent across files — it asserts that
 * precondition against the database rather than assuming it. The Quran corpus
 * and the Hadith activation are database-wide singletons owned by
 * `quran.spec.ts` and `hadith.spec.ts`, so this file never activates either:
 * `/quran/courses` and `/hadith/courses` are asserted against whichever honest
 * state those specs leave them in.
 */

test.describe.configure({ mode: 'serial', retries: 0 });

let sql: SqlSession;
let people: Phase5Fixture;
const contexts: BrowserContext[] = [];

const run = randomUUID().replaceAll('-', '').slice(0, 10);

const ids = {
  paced: randomUUID(),
  live: randomUUID(),
  spare: randomUUID(),
  draft: randomUUID(),
  path: randomUUID(),
  pacedModule: randomUUID(),
  liveModuleA: randomUUID(),
  liveModuleB: randomUUID(),
  spareModule: randomUUID(),
  draftModuleA: randomUUID(),
  draftModuleB: randomUUID(),
  pacedLessonOne: randomUUID(),
  pacedLessonTwo: randomUUID(),
  liveLessonOne: randomUUID(),
  liveLessonTwo: randomUUID(),
  spareLesson: randomUUID(),
  draftLessonOne: randomUUID(),
  draftLessonTwo: randomUUID(),
} as const;

const slug = {
  pacedFormer: `non-learning-fixture-paced-former-${run}`,
  paced: `non-learning-fixture-paced-${run}`,
  live: `non-learning-fixture-live-${run}`,
  spare: `non-learning-fixture-spare-${run}`,
  draft: `non-learning-fixture-draft-${run}`,
  pathFormer: `non-learning-fixture-path-former-${run}`,
  path: `non-learning-fixture-path-${run}`,
} as const;

const SENTINEL = 'NON_LEARNING_FIXTURE';

const TEXT = {
  paced: `${SENTINEL} paced ${run}`,
  pacedAr: `مقرر اختباري ${run}`,
  pacedSummary: `${SENTINEL}_SUMMARY paced ${run}`,
  live: `${SENTINEL} live ${run}`,
  liveSummary: `${SENTINEL}_SUMMARY live ${run}`,
  spare: `${SENTINEL} spare ${run}`,
  draft: `${SENTINEL} draft ${run}`,
  draftFirstSave: `${SENTINEL} draft saved first ${run}`,
  draftStaleSave: `${SENTINEL} draft saved stale ${run}`,
  path: `${SENTINEL} path ${run}`,
  pacedModule: `${SENTINEL}_MODULE paced ${run}`,
  liveModuleA: `${SENTINEL}_MODULE live first ${run}`,
  liveModuleB: `${SENTINEL}_MODULE live second ${run}`,
  spareModule: `${SENTINEL}_MODULE spare ${run}`,
  draftModuleA: `${SENTINEL}_MODULE draft first ${run}`,
  draftModuleB: `${SENTINEL}_MODULE draft second ${run}`,
  moduleSummary: `${SENTINEL}_MODULE_SUMMARY ${run}`,
  pacedLessonOne: `${SENTINEL}_LESSON paced one ${run}`,
  pacedLessonTwo: `${SENTINEL}_LESSON paced two ${run}`,
  liveLessonOne: `${SENTINEL}_LESSON live one ${run}`,
  liveLessonTwo: `${SENTINEL}_LESSON live two ${run}`,
  spareLesson: `${SENTINEL}_LESSON spare ${run}`,
  draftLessonOne: `${SENTINEL}_LESSON draft one ${run}`,
  draftLessonTwo: `${SENTINEL}_LESSON draft two ${run}`,
  lessonSummary: `${SENTINEL}_LESSON_SUMMARY ${run}`,
  /** Every lesson body carries this; no public document may. */
  body: `${SENTINEL}_BODY`,
} as const;

const BODY = {
  pacedOne: `${TEXT.body} paced one ${run}`,
  pacedTwo: `${TEXT.body} paced two ${run}`,
  liveOne: `${TEXT.body} live one ${run}`,
  liveTwo: `${TEXT.body} live two ${run}`,
  spare: `${TEXT.body} spare ${run}`,
  draftOne: `${TEXT.body} draft one ${run}`,
  draftTwo: `${TEXT.body} draft two ${run}`,
} as const;

const PAGE = {
  paced: `/en/learn/courses/${slug.paced}`,
  live: `/en/learn/courses/${slug.live}`,
  spare: `/en/learn/courses/${slug.spare}`,
  draft: `/en/learn/courses/${slug.draft}`,
  path: `/en/learn/paths/${slug.path}`,
} as const;

/** What a booked, confirmed or scheduled class would be called — never shown. */
const BOOKED = /\bbooked\b|\bconfirmed\b|\bscheduled for\b|\bjoin the class\b/i;

/* ===========================================================================
 * Copy, read from the catalogues the pages render
 * ========================================================================= */

const MESSAGES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'apps',
  'web',
  'messages',
);

type UiLocale = 'en' | 'ur' | 'ar';

const CATALOGUE: Readonly<Record<UiLocale, unknown>> = {
  en: JSON.parse(readFileSync(path.join(MESSAGES, 'en.json'), 'utf8')),
  ur: JSON.parse(readFileSync(path.join(MESSAGES, 'ur.json'), 'utf8')),
  ar: JSON.parse(readFileSync(path.join(MESSAGES, 'ar.json'), 'utf8')),
};

/** One message by its dotted key, with `{name}` placeholders filled. */
function copy(
  key: string,
  values: Readonly<Record<string, string | number>> = {},
  locale: UiLocale = 'en',
): string {
  let node: unknown = CATALOGUE[locale];
  for (const part of key.split('.'))
    node =
      typeof node === 'object' && node !== null
        ? (node as Record<string, unknown>)[part]
        : undefined;
  if (typeof node !== 'string') throw new Error(`No copy ${locale}:${key}`);
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    node,
  );
}

const progressText = (completed: number, total: number) =>
  copy('myLearning.progress.lessons', { completed, total });

/** A SQL Server Unicode literal. Values are this file's own constants. */
const n = (value: string) => `N'${value.replaceAll("'", "''")}'`;

async function scalar(statement: string): Promise<number> {
  const [row] = await sql.query<{ value: number }>(statement);
  return Number(row?.value ?? Number.NaN);
}

/* ===========================================================================
 * Page helpers
 * ========================================================================= */

/** Moves focus by Tab alone until it lands on `target`. */
async function tabTo(page: Page, target: Locator): Promise<void> {
  const handle = await target.elementHandle();
  if (handle === null) throw new Error('The keyboard target is not on the page.');
  let reached = false;
  for (let step = 0; step < 200 && !reached; step += 1) {
    await page.keyboard.press('Tab');
    reached = await handle.evaluate((element) => document.activeElement === element);
  }
  expect(reached, 'reached by Tab alone').toBe(true);
}

/** The focused element shows a visible focus indicator. */
async function expectVisibleFocus(target: Locator, where: string): Promise<void> {
  const focus = await target.evaluate((element) => {
    const style = globalThis.getComputedStyle(element);
    return {
      visible: element.matches(':focus-visible'),
      outline: style.outlineStyle,
      width: Number.parseFloat(style.outlineWidth),
      shadow: style.boxShadow,
    };
  });
  expect(focus.visible, where).toBe(true);
  expect(
    (focus.outline !== 'none' && focus.width > 0) || focus.shadow !== 'none',
    `${where} ${JSON.stringify(focus)}`,
  ).toBe(true);
}

/** Horizontal overflow of the document, in CSS pixels (≤ 0 means none). */
function overflowOf(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/** Exactly one `h1`, first, and no level skipped on the way down. */
async function expectHeadingsInOrder(page: Page, where: string): Promise<void> {
  const levels = await page
    .locator('main')
    .first()
    .locator('h1, h2, h3, h4, h5, h6')
    .evaluateAll((headings) => headings.map((heading) => Number(heading.tagName[1])));
  expect(levels[0], where).toBe(1);
  expect(
    levels.filter((level) => level === 1),
    where,
  ).toHaveLength(1);
  for (let index = 1; index < levels.length; index += 1)
    expect(
      (levels[index] ?? 0) - (levels[index - 1] ?? 0),
      `${where} ${JSON.stringify(levels)}`,
    ).toBeLessThanOrEqual(1);
}

/** Every visible form control in the main region has an accessible label. */
async function expectLabelledControls(page: Page, where: string): Promise<void> {
  const unlabelled = await page
    .locator('main')
    .first()
    .locator('input:not([type="hidden"]), select, textarea')
    .evaluateAll((controls) =>
      controls
        .filter((control) => {
          const element = control as HTMLInputElement;
          const named =
            (element.labels?.length ?? 0) > 0 ||
            (element.getAttribute('aria-label') ?? '').trim() !== '' ||
            (element.getAttribute('aria-labelledby') ?? '').trim() !== '';
          return !named;
        })
        .map((control) => control.outerHTML.slice(0, 120)),
    );
  expect(unlabelled, where).toEqual([]);
}

/** The private Learning island on a public Course page. */
function islandOn(page: Page): Locator {
  return page.getByRole('region', { name: copy('learningIsland.heading') });
}

/** Opens a Course page and waits for the island to finish its private read. */
async function openWithIsland(page: Page, target: string): Promise<void> {
  const state = page.waitForResponse((response) =>
    response.url().includes('/api/my/learning/state'),
  );
  const response = await page.goto(target);
  expect(response?.status(), target).toBe(200);
  expect((await state).status(), target).toBe(200);
}

/** The headers a same-origin island POST carries. */
function intentHeaders(): Record<string, string> {
  return { origin: baseUrl(), 'x-minhaj-intent': 'personal' };
}

/** A signed-in account on its own context and client address. */
async function account(
  browser: Browser,
  index: number,
  prefix: string,
): Promise<{ page: Page; id: string; email: string }> {
  const context = await browser.newContext({
    baseURL: baseUrl(),
    extraHTTPHeaders: { 'x-forwarded-for': `100.64.251.${String(index)}` },
  });
  contexts.push(context);
  const page = await context.newPage();
  const { email } = await registerAndSignIn(page, prefix);
  return { page, id: await accountIdFor(sql, email), email };
}

/* ===========================================================================
 * Fixture
 * ========================================================================= */

/**
 * The catalogue, written by the owner as every earlier browser spec writes
 * its records — drafted whole, then published, so the real CHECKs and the
 * whole-syllabus, frozen-syllabus and slug-reservation triggers are
 * exercised: a published self-paced Course renamed once (so a former slug
 * exists) with English and Arabic words; a published live Course with a
 * teacher; a published spare Course this file later archives; a draft Course
 * whose syllabus is still open; and a published path holding the first two in
 * order.
 */
async function seedCatalogue(): Promise<void> {
  const topics = await sql.query<{ id: string; slug: string }>(
    "SELECT [id],[slug] FROM [dbo].[Topic] WHERE [slug] IN (N'quran', N'hadith');",
  );
  const topic = (name: string) => {
    const row = topics.find((entry) => entry.slug === name);
    if (row === undefined) throw new Error(`The canonical ${name} topic is missing.`);
    return row.id;
  };
  const course =
    '[id],[slug],[primaryLocale],[state],[level],[format],[languageCode],[publishedAt],[version],[updatedAt]';
  const moduleWords = (id: string, title: string) =>
    `(N'${id}', N'en', ${n(title)}, ${n(TEXT.moduleSummary)})`;
  const lessonWords = (id: string, title: string, body: string) =>
    `(N'${id}', N'en', ${n(title)}, ${n(TEXT.lessonSummary)}, ${n(body)})`;

  await sql.query(`
    INSERT INTO [dbo].[Course] (${course}) VALUES
      (N'${ids.paced}', N'${slug.pacedFormer}', N'en', N'draft', N'beginner', N'self-paced', N'en', NULL, 1, SYSUTCDATETIME()),
      (N'${ids.live}', N'${slug.live}', N'en', N'draft', N'intermediate', N'live', N'ur', NULL, 1, SYSUTCDATETIME()),
      (N'${ids.spare}', N'${slug.spare}', N'en', N'draft', N'advanced', N'self-paced', N'en', NULL, 1, SYSUTCDATETIME()),
      (N'${ids.draft}', N'${slug.draft}', N'en', N'draft', NULL, N'self-paced', N'en', NULL, 1, SYSUTCDATETIME());
    INSERT INTO [dbo].[CourseLabel] ([courseId],[locale],[title],[summary],[description]) VALUES
      (N'${ids.paced}', N'en', ${n(TEXT.paced)}, ${n(TEXT.pacedSummary)}, N'${SENTINEL}_DESCRIPTION paced'),
      (N'${ids.paced}', N'ar', ${n(TEXT.pacedAr)}, N'', N''),
      (N'${ids.live}', N'en', ${n(TEXT.live)}, ${n(TEXT.liveSummary)}, N'${SENTINEL}_DESCRIPTION live'),
      (N'${ids.spare}', N'en', ${n(TEXT.spare)}, N'', N''),
      (N'${ids.draft}', N'en', ${n(TEXT.draft)}, N'', N'');
    INSERT INTO [dbo].[CourseTopic] ([courseId],[topicId]) VALUES
      (N'${ids.paced}', N'${topic('quran')}'),
      (N'${ids.live}', N'${topic('hadith')}');
    INSERT INTO [dbo].[CourseTeacher] ([courseId],[personId],[position]) VALUES
      (N'${ids.live}', N'${people.linkedPersonId}', 0);
    INSERT INTO [dbo].[CourseModule] ([id],[courseId],[position]) VALUES
      (N'${ids.pacedModule}', N'${ids.paced}', 0),
      (N'${ids.liveModuleA}', N'${ids.live}', 0),
      (N'${ids.liveModuleB}', N'${ids.live}', 1),
      (N'${ids.spareModule}', N'${ids.spare}', 0),
      (N'${ids.draftModuleA}', N'${ids.draft}', 0),
      (N'${ids.draftModuleB}', N'${ids.draft}', 1);
    INSERT INTO [dbo].[CourseModuleLabel] ([moduleId],[locale],[title],[summary]) VALUES
      ${moduleWords(ids.pacedModule, TEXT.pacedModule)},
      ${moduleWords(ids.liveModuleA, TEXT.liveModuleA)},
      ${moduleWords(ids.liveModuleB, TEXT.liveModuleB)},
      ${moduleWords(ids.spareModule, TEXT.spareModule)},
      ${moduleWords(ids.draftModuleA, TEXT.draftModuleA)},
      ${moduleWords(ids.draftModuleB, TEXT.draftModuleB)};
    INSERT INTO [dbo].[Lesson] ([id],[courseId],[moduleId],[position]) VALUES
      (N'${ids.pacedLessonOne}', N'${ids.paced}', N'${ids.pacedModule}', 0),
      (N'${ids.pacedLessonTwo}', N'${ids.paced}', N'${ids.pacedModule}', 1),
      (N'${ids.liveLessonOne}', N'${ids.live}', N'${ids.liveModuleA}', 0),
      (N'${ids.liveLessonTwo}', N'${ids.live}', N'${ids.liveModuleB}', 0),
      (N'${ids.spareLesson}', N'${ids.spare}', N'${ids.spareModule}', 0),
      (N'${ids.draftLessonOne}', N'${ids.draft}', N'${ids.draftModuleA}', 0),
      (N'${ids.draftLessonTwo}', N'${ids.draft}', N'${ids.draftModuleB}', 0);
    INSERT INTO [dbo].[LessonLabel] ([lessonId],[locale],[title],[summary],[body]) VALUES
      ${lessonWords(ids.pacedLessonOne, TEXT.pacedLessonOne, BODY.pacedOne)},
      ${lessonWords(ids.pacedLessonTwo, TEXT.pacedLessonTwo, BODY.pacedTwo)},
      ${lessonWords(ids.liveLessonOne, TEXT.liveLessonOne, BODY.liveOne)},
      ${lessonWords(ids.liveLessonTwo, TEXT.liveLessonTwo, BODY.liveTwo)},
      ${lessonWords(ids.spareLesson, TEXT.spareLesson, BODY.spare)},
      ${lessonWords(ids.draftLessonOne, TEXT.draftLessonOne, BODY.draftOne)},
      ${lessonWords(ids.draftLessonTwo, TEXT.draftLessonTwo, BODY.draftTwo)};
    UPDATE [dbo].[Course] SET [slug]=N'${slug.paced}', [version]=2 WHERE [id]=N'${ids.paced}';
    UPDATE [dbo].[Course] SET [state]=N'published', [publishedAt]=SYSUTCDATETIME(), [version]=[version]+1, [updatedAt]=SYSUTCDATETIME()
      WHERE [id] IN (N'${ids.paced}', N'${ids.live}', N'${ids.spare}');
  `);

  await sql.query(`
    INSERT INTO [dbo].[LearningPath] ([id],[slug],[primaryLocale],[state],[publishedAt],[version],[updatedAt]) VALUES
      (N'${ids.path}', N'${slug.pathFormer}', N'en', N'draft', NULL, 1, SYSUTCDATETIME());
    INSERT INTO [dbo].[LearningPathLabel] ([pathId],[locale],[title],[summary],[description]) VALUES
      (N'${ids.path}', N'en', ${n(TEXT.path)}, N'${SENTINEL}_SUMMARY path', N'');
    INSERT INTO [dbo].[LearningPathCourse] ([pathId],[courseId],[position]) VALUES
      (N'${ids.path}', N'${ids.paced}', 0),
      (N'${ids.path}', N'${ids.live}', 1);
    UPDATE [dbo].[LearningPath] SET [slug]=N'${slug.path}', [state]=N'published',
      [publishedAt]=SYSUTCDATETIME(), [version]=2, [updatedAt]=SYSUTCDATETIME()
      WHERE [id]=N'${ids.path}';
  `);
}

let learner: Page;
let learnerId: string;
let learnerEmail: string;
let other: Page;
let otherId: string;
let otherEmail: string;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  sql = await privilegedSession();
  // A published People contributor to name as the live Course's teacher.
  people = newPhase5Fixture();
  await writePhase5Fixture(sql, people);
});

test.afterAll(async () => {
  for (const context of contexts) await context.close();
  await sql?.close();
});

/* ===========================================================================
 * 1. Before anything is published
 * ========================================================================= */

test.describe('before any Course is published', () => {
  test('Learn says so plainly on every public page, and invents nothing', async ({
    page,
  }) => {
    // THE PRECONDITION, PROVED rather than assumed: no other spec publishes a
    // Course or a path, and this is the first proof in this file.
    expect(
      await scalar(
        "SELECT COUNT_BIG(*) AS [value] FROM [dbo].[Course] WHERE [state]=N'published';",
      ),
    ).toBe(0);
    expect(
      await scalar(
        "SELECT COUNT_BIG(*) AS [value] FROM [dbo].[LearningPath] WHERE [state]=N'published';",
      ),
    ).toBe(0);

    for (const [target, empty] of [
      ['/en/learn', copy('learn.landing.empty')],
      ['/en/learn/courses', copy('learn.coursesEmpty')],
      ['/en/learn/paths', copy('learn.pathsEmpty')],
      ['/en/learn/trial', copy('learn.trial.empty')],
    ] as const) {
      const response = await page.goto(target);
      expect(response?.status(), target).toBe(200);
      expect(response?.headers()['set-cookie'], target).toBeUndefined();
      const main = page.getByRole('main');
      await expect(main, target).toContainText(empty);
      await expect(main, target).not.toContainText(SENTINEL);
      await expect(
        main.getByRole('link', { name: /non-learning|NON_LEARNING/ }),
      ).toHaveCount(0);
    }

    // The empty catalogue is a statement, not a list with nothing in it.
    await page.goto('/en/learn/courses');
    await expect(
      page.getByRole('list', { name: copy('learn.sections.courses') }),
    ).toHaveCount(0);
    // The trial page still explains that a request books nothing.
    await page.goto('/en/learn/trial');
    await expect(page.getByRole('main')).toContainText(copy('learn.trial.notBooked'));
  });
});

/* ===========================================================================
 * 2. The published catalogue
 * ========================================================================= */

test.describe('the published catalogue', () => {
  test.beforeAll(async () => {
    test.setTimeout(60_000);
    await seedCatalogue();
  });

  test('lists every published Course, and never the draft', async ({ page }) => {
    const response = await page.goto('/en/learn/courses');
    expect(response?.headers()['set-cookie']).toBeUndefined();
    const list = page.getByRole('list', { name: copy('learn.sections.courses') });
    for (const [title, target] of [
      [TEXT.paced, PAGE.paced],
      [TEXT.live, PAGE.live],
      [TEXT.spare, PAGE.spare],
    ] as const)
      await expect(list.getByRole('link', { name: title, exact: true })).toHaveAttribute(
        'href',
        target,
      );
    await expect(page.getByText(TEXT.draft)).toHaveCount(0);

    // The landing shows the recent courses and the path; the trial page only
    // the live Course.
    await page.goto('/en/learn');
    const main = page.getByRole('main');
    await expect(main.getByRole('link', { name: TEXT.paced, exact: true })).toBeVisible();
    await expect(main.getByRole('link', { name: TEXT.path, exact: true })).toBeVisible();
    await expect(main).not.toContainText(TEXT.draft);

    await page.goto('/en/learn/trial');
    const live = page.getByRole('list', { name: copy('learn.trial.courses') });
    await expect(live.getByRole('link', { name: TEXT.live, exact: true })).toBeVisible();
    await expect(live.getByRole('link', { name: TEXT.paced, exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByRole('main')).toContainText(copy('learn.trial.notBooked'));
  });

  test('every filter narrows, alone, combined and through the form', async ({ page }) => {
    const titles = [TEXT.paced, TEXT.live, TEXT.spare];
    const listed = async (query: string): Promise<string[]> => {
      await page.goto(`/en/learn/courses?${query}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const main = await page.getByRole('main').innerText();
      return titles.filter((title) => main.includes(title));
    };

    expect(await listed('level=beginner')).toEqual([TEXT.paced]);
    expect(await listed('level=advanced')).toEqual([TEXT.spare]);
    expect(await listed('format=live')).toEqual([TEXT.live]);
    expect(await listed('topic=quran')).toEqual([TEXT.paced]);
    expect(await listed('topic=hadith')).toEqual([TEXT.live]);
    expect(await listed(`teacher=${people.linkedSlug}`)).toEqual([TEXT.live]);
    expect(await listed('language=ur')).toEqual([TEXT.live]);
    expect((await listed('format=self-paced')).sort()).toEqual(
      [TEXT.paced, TEXT.spare].sort(),
    );

    // Filters combine — each narrows the others — to an explained nothing.
    expect(await listed('level=beginner&format=live')).toEqual([]);
    await expect(page.getByRole('main')).toContainText(copy('learn.filter.empty'));
    await page
      .getByRole('link', { name: copy('learn.filter.clear') })
      .first()
      .click();
    await expect(page).toHaveURL(/\/en\/learn\/courses$/);

    // A REAL GET FORM: the labelled selects submit a shareable address.
    await page
      .getByLabel(copy('learn.filter.level'), { exact: true })
      .selectOption('beginner');
    await page.getByLabel(copy('learn.filter.teacher'), { exact: true }).selectOption('');
    await page.getByRole('button', { name: copy('learn.filter.apply') }).click();
    await expect(page).toHaveURL(/[?&]level=beginner(&|$)/);
    const main = page.getByRole('main');
    await expect(main.getByRole('link', { name: TEXT.paced, exact: true })).toBeVisible();
    await expect(main.getByRole('link', { name: TEXT.live, exact: true })).toHaveCount(0);

    // The teacher choice is the one contributor teaching a published Course.
    await page.goto('/en/learn/courses');
    await page
      .getByLabel(copy('learn.filter.teacher'), { exact: true })
      .selectOption(people.linkedSlug);
    await page.getByRole('button', { name: copy('learn.filter.apply') }).click();
    await expect(main.getByRole('link', { name: TEXT.live, exact: true })).toBeVisible();
    await expect(main.getByRole('link', { name: TEXT.paced, exact: true })).toHaveCount(
      0,
    );
  });

  test('an unknown filter lists nothing and says why — it never broadens', async ({
    page,
  }) => {
    for (const query of [
      'level=expert',
      'format=%3Cscript%3E',
      `topic=no-such-topic-${run}`,
      `teacher=no-such-person-${run}`,
      'topic=quran&level=expert',
    ]) {
      await page.goto(`/en/learn/courses?${query}`);
      const main = page.getByRole('main');
      await expect(main, query).toContainText(copy('learn.filter.invalid'));
      await expect(main, query).not.toContainText(SENTINEL);
      await expect(
        page.getByRole('list', { name: copy('learn.sections.courses') }),
        query,
      ).toHaveCount(0);
      await expect(
        main.getByRole('link', { name: copy('learn.filter.clear') }).first(),
        query,
      ).toHaveAttribute('href', '/en/learn/courses');
    }

    // A well-formed language nobody teaches in is an explained empty result.
    await page.goto('/en/learn/courses?language=zz');
    await expect(page.getByRole('main')).toContainText(copy('learn.filter.empty'));
    await expect(page.getByRole('main')).not.toContainText(SENTINEL);
  });

  test('a Course page shows its syllabus but never a lesson’s text', async ({
    page,
    request,
  }) => {
    const response = await page.goto(PAGE.live);
    expect(response?.status()).toBe(200);
    expect(response?.headers()['set-cookie']).toBeUndefined();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(TEXT.live);
    await expect(page.getByRole('main')).toContainText(TEXT.liveSummary);
    await expect(page.getByRole('main')).toContainText(copy('learn.course.trialNote'));
    await expect(
      page.locator(`main a[href="/en/people/${people.linkedSlug}"]`).first(),
    ).toBeVisible();

    const syllabus = page.getByRole('region', { name: copy('learn.course.syllabus') });
    const modules = syllabus.getByRole('heading', { level: 3 });
    await expect(modules).toHaveCount(2);
    for (const [index, title] of [TEXT.liveModuleA, TEXT.liveModuleB].entries()) {
      await expect(modules.nth(index)).toContainText(
        copy('learn.course.module', { number: index + 1 }),
      );
      await expect(modules.nth(index)).toContainText(title);
    }
    for (const words of [TEXT.liveLessonOne, TEXT.liveLessonTwo, TEXT.lessonSummary])
      await expect(syllabus).toContainText(words);
    await expect(syllabus).toContainText(TEXT.moduleSummary);
    await expect(syllabus).toContainText(copy('learn.course.syllabusNote'));

    // NOT IN THE DOCUMENT AT ALL — not hidden, absent: no lesson body reaches a
    // public page, in its markup or its flight data.
    for (const target of [PAGE.paced, PAGE.live, '/en/learn/courses', PAGE.path]) {
      const html = await (await request.get(target)).text();
      expect(html, target).not.toContain(TEXT.body);
    }
  });

  test('a draft is a 404 and appears nowhere; there is no sitemap to leak it', async ({
    request,
  }) => {
    const draft = await request.get(PAGE.draft, { maxRedirects: 0 });
    expect(draft.status()).toBe(404);
    expect(await draft.text()).not.toContain(TEXT.draft);
    for (const target of [
      '/en/learn',
      '/en/learn/courses',
      '/en/learn/courses?format=self-paced',
      '/en/learn/paths',
      PAGE.path,
      '/en/learn/trial',
      '/en/topics/quran',
    ]) {
      const html = await (await request.get(target)).text();
      expect(html, target).not.toContain(TEXT.draft);
      expect(html, target).not.toContain(slug.draft);
    }
    // Pre-adoption the whole site is unindexed and serves no sitemap at all,
    // so no partition can advertise a draft (or anything else).
    for (const target of [
      '/sitemap.xml',
      '/sitemaps/courses-en.xml',
      '/sitemaps/learning-paths-en.xml',
    ]) {
      const response = await request.get(target, { maxRedirects: 0 });
      expect(response.status(), target).toBe(404);
    }
  });

  test('a former slug answers ONE 301 to the current address', async ({ request }) => {
    for (const [from, to] of [
      [`/ur/learn/courses/${slug.pacedFormer}`, `/ur/learn/courses/${slug.paced}`],
      [`/en/learn/courses/${slug.pacedFormer}`, PAGE.paced],
      [`/ar/learn/paths/${slug.pathFormer}`, `/ar/learn/paths/${slug.path}`],
    ] as const) {
      const response = await request.get(from, { maxRedirects: 0 });
      expect(response.status(), from).toBe(301);
      const location = new URL(response.headers()['location'] ?? '', baseUrl());
      expect(location.pathname, from).toBe(to);
      // ONE hop: the target answers itself.
      const landing = await request.get(location.pathname, { maxRedirects: 0 });
      expect(landing.status(), to).toBe(200);
    }
    // The current slug is not redirected, and a slug nobody held is a 404.
    expect((await request.get(PAGE.paced, { maxRedirects: 0 })).status()).toBe(200);
    expect(
      (
        await request.get(`/en/learn/courses/non-learning-fixture-never-${run}`, {
          maxRedirects: 0,
        })
      ).status(),
    ).toBe(404);
  });

  test('a learning path lists its Courses in order', async ({ page }) => {
    await page.goto('/en/learn/paths');
    await expect(
      page.getByRole('main').getByRole('link', { name: TEXT.path, exact: true }),
    ).toHaveAttribute('href', PAGE.path);

    await page.goto(PAGE.path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(TEXT.path);
    const courses = page.getByRole('list', { name: copy('learn.path.courses') });
    await expect(courses.getByRole('listitem')).toHaveCount(2);
    await expect(courses.getByRole('listitem').nth(0)).toContainText(
      copy('learn.card.step', { number: 1 }),
    );
    await expect(courses.getByRole('listitem').nth(0)).toContainText(TEXT.paced);
    await expect(courses.getByRole('listitem').nth(1)).toContainText(TEXT.live);
  });

  test('Quran, Hadith and the topic hub relate Courses only through Learning’s catalogue', async ({
    page,
  }) => {
    // The corpus and the activation are singletons other specs own; whichever
    // honest state they are in, the view is either the unavailable notice with
    // no Course on it, or Learning's Courses on the topic at their own address.
    for (const [target, unavailable, title, href] of [
      ['/en/quran/courses', copy('quran.unavailable.body'), TEXT.paced, PAGE.paced],
      ['/en/hadith/courses', copy('hadith.unavailable.body'), TEXT.live, PAGE.live],
    ] as const) {
      const response = await page.goto(target);
      expect(response?.status(), target).toBe(200);
      expect(response?.headers()['set-cookie'], target).toBeUndefined();
      const main = page.getByRole('main');
      await expect(main, target).not.toContainText(TEXT.draft);
      if ((await main.innerText()).includes(unavailable)) {
        await expect(main, target).not.toContainText(SENTINEL);
      } else {
        await expect(
          main.getByRole('link', { name: title, exact: true }),
          target,
        ).toHaveAttribute('href', href);
        await expect(main, target).not.toContainText(TEXT.spare);
      }
    }

    await page.goto('/en/topics/quran');
    const section = page.getByRole('region', { name: copy('topics.courses') });
    await expect(
      section.getByRole('link', { name: TEXT.paced, exact: true }),
    ).toHaveAttribute('href', PAGE.paced);
    await expect(section).not.toContainText(TEXT.live);
  });
});

/* ===========================================================================
 * 3. The public page is the same for everybody
 * ========================================================================= */

test.describe('a public Course page', () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    ({
      page: learner,
      id: learnerId,
      email: learnerEmail,
    } = await account(browser, 1, 'learning-learner'));
    ({
      page: other,
      id: otherId,
      email: otherEmail,
    } = await account(browser, 2, 'learning-other'));
  });

  test('is the same document for an anonymous visitor and two people, and sets no cookie', async ({
    request,
  }) => {
    for (const target of [PAGE.paced, PAGE.live, '/en/learn/courses', '/en/learn']) {
      for (const visitor of [learner, other]) {
        const { anonymous, signedIn } = await asTwoVisitors(
          request,
          visitor.context().request,
          target,
        );
        expect(anonymous.status(), target).toBe(200);
        expect(signedIn.status(), target).toBe(200);
        expect(anonymous.headers()['set-cookie'], target).toBeUndefined();
        expect(signedIn.headers()['set-cookie'], target).toBeUndefined();

        const [html, signedInHtml] = [await anonymous.text(), await signedIn.text()];
        expect(
          firstDifference(knowledgeOf(html), knowledgeOf(signedInHtml)),
          `${target} differs signed in`,
        ).toBe('identical');
        for (const secret of [learnerEmail, otherEmail, learnerId, otherId])
          expect(signedInHtml, target).not.toContain(secret);
        // The island is an empty frame on the server: no enrol button, no
        // sign-in prompt — both arrive only after hydration.
        expect(html, target).not.toContain(`>${copy('learningIsland.enrol')}<`);
        expect(html, target).not.toContain(`>${copy('learningIsland.signedOutPrompt')}<`);
      }
    }
  });

  test('invites a signed-out visitor to sign in, and brings them back', async ({
    page,
  }) => {
    await openWithIsland(page, PAGE.live);
    const island = islandOn(page);
    await expect(island).toContainText(copy('learningIsland.signedOutPrompt'));
    await expect(island).toContainText(copy('learningIsland.signedOutLivePrompt'));
    const returnTo = `/en/signin?returnTo=${encodeURIComponent(PAGE.live)}`;
    await expect(
      island.getByRole('link', { name: copy('learningIsland.signInToRequestTrial') }),
    ).toHaveAttribute('href', returnTo);
    await expect(island.getByRole('button')).toHaveCount(0);

    await openWithIsland(page, PAGE.paced);
    const link = islandOn(page).getByRole('link', {
      name: copy('learningIsland.signInToEnrol'),
    });
    await expect(link).toHaveAttribute(
      'href',
      `/en/signin?returnTo=${encodeURIComponent(PAGE.paced)}`,
    );

    // The way back survives sign-in, through the safe return-to allowlist.
    await link.click();
    await page.waitForURL(/\/en\/signin\?returnTo=/);
    await page.getByLabel(LABEL.email).fill(otherEmail);
    await page.getByLabel(LABEL.password, { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: BUTTON.signIn, exact: true }).click();
    await page.waitForURL(`**${PAGE.paced}`);
    await expect(
      islandOn(page).getByRole('button', { name: copy('learningIsland.enrol') }),
    ).toBeVisible();
  });

  test('still renders whole when the island’s private read fails', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/my/learning/state**', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{"ok":false,"failure":"unavailable"}',
      }),
    );
    const state = page.waitForResponse((response) =>
      response.url().includes('/api/my/learning/state'),
    );
    const response = await page.goto(PAGE.paced);
    expect(response?.status()).toBe(200);
    expect((await state).status()).toBe(500);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(TEXT.paced);
    const syllabus = page.getByRole('region', { name: copy('learn.course.syllabus') });
    await expect(syllabus).toContainText(TEXT.pacedLessonOne);
    await expect(page.getByRole('main')).toContainText(TEXT.pacedSummary);
    // The island hides itself rather than break the page or pretend.
    await expect(islandOn(page)).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: copy('learningIsland.enrol') }),
    ).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

/* ===========================================================================
 * 4. One learner's journey
 * ========================================================================= */

test.describe('a learner', () => {
  test('enrols from the island and is told where to continue', async () => {
    await openWithIsland(learner, PAGE.paced);
    const island = islandOn(learner);
    await expect(island).toContainText(copy('learningIsland.privacy'));
    await island.getByRole('button', { name: copy('learningIsland.enrol') }).click();
    await expect(
      learner
        .getByRole('status')
        .getByText(copy('learningIsland.enrolledStatus'), { exact: true }),
    ).toBeVisible();
    await expect(island).toContainText(copy('learningIsland.enrolled'));
    await expect(
      island.getByRole('link', { name: copy('learningIsland.continueLearning') }),
    ).toHaveAttribute('href', `/en/my/learning/courses/${slug.paced}`);

    // A reload still knows: the state is the server's, not the tab's.
    await openWithIsland(learner, PAGE.paced);
    await expect(islandOn(learner)).toContainText(copy('learningIsland.enrolled'));
    await expect(
      islandOn(learner).getByRole('button', { name: copy('learningIsland.enrol') }),
    ).toHaveCount(0);
    expect(
      await scalar(
        `SELECT COUNT_BIG(*) AS [value] FROM [dbo].[Enrolment] WHERE [userId]=N'${learnerId}' AND [courseId]=N'${ids.paced}';`,
      ),
    ).toBe(1);
  });

  test('My Learning lists the Course at “0 of 2”, and the path it is on', async () => {
    const response = await learner.goto('/en/my/learning');
    expect(response?.status()).toBe(200);
    const courses = learner.getByRole('list', {
      name: copy('myLearning.courses.heading'),
    });
    await expect(courses.getByRole('listitem')).toHaveCount(1);
    const item = courses.getByRole('listitem').first();
    await expect(item).toContainText(TEXT.paced);
    await expect(item).toContainText(progressText(0, 2));
    await expect(item.getByRole('link', { name: TEXT.paced })).toHaveAttribute(
      'href',
      `/en/my/learning/courses/${slug.paced}`,
    );

    const paths = learner.getByRole('list', { name: copy('myLearning.paths.heading') });
    await expect(paths).toContainText(TEXT.path);
    await expect(paths).toContainText(
      copy('myLearning.paths.enrolledCount', { enrolled: 1, total: 2 }),
    );
    await expect(learner.getByRole('main')).toContainText(
      copy('myLearning.trials.empty'),
    );
  });

  test('reads a lesson and marks it complete; progress moves in words', async () => {
    await learner.goto(`/en/my/learning/courses/${slug.paced}`);
    const main = learner.getByRole('main');
    await expect(learner.getByRole('heading', { level: 1 })).toHaveText(TEXT.paced);
    await expect(main).toContainText(progressText(0, 2));
    // Opening a lesson records nothing: only the button does.
    await expect(main).toContainText(BODY.pacedOne);
    await expect(main).toContainText(
      copy('myLearning.lesson.position', { number: 1, total: 2 }),
    );
    expect(
      await scalar(
        `SELECT COUNT_BIG(*) AS [value] FROM [dbo].[LessonProgress] WHERE [userId]=N'${learnerId}';`,
      ),
    ).toBe(0);

    await learner
      .getByRole('button', { name: copy('myLearning.lesson.complete') })
      .click();
    await expect(main).toContainText(copy('myLearning.lesson.alreadyCompleted'));
    await expect(main).toContainText(progressText(1, 2));
    await expect(learner).toHaveURL(new RegExp(`\\?lesson=${ids.pacedLessonOne}$`));
    const syllabus = learner.getByRole('region', {
      name: copy('myLearning.course.syllabus'),
    });
    await expect(
      syllabus.getByRole('listitem').filter({ hasText: TEXT.pacedLessonOne }),
    ).toContainText(copy('myLearning.lesson.completed'));
    await expect(
      syllabus.getByRole('listitem').filter({ hasText: TEXT.pacedLessonTwo }),
    ).toContainText(copy('myLearning.lesson.notCompleted'));

    await learner.goto('/en/my/progress/courses');
    const table = learner.getByRole('table', {
      name: copy('myLearning.progressPage.caption'),
    });
    await expect(table.getByRole('row').filter({ hasText: TEXT.paced })).toContainText(
      progressText(1, 2),
    );
  });

  test('completing every lesson says “Completed”', async () => {
    await learner.goto(`/en/my/learning/courses/${slug.paced}`);
    const main = learner.getByRole('main');
    // The next lesson not yet complete is the one opened.
    await expect(main).toContainText(BODY.pacedTwo);
    await learner
      .getByRole('button', { name: copy('myLearning.lesson.complete') })
      .click();
    await expect(main).toContainText(copy('myLearning.lesson.alreadyCompleted'));
    await expect(main).toContainText(copy('myLearning.progress.completed'));

    await learner.goto('/en/my/learning');
    const item = learner
      .getByRole('list', { name: copy('myLearning.courses.heading') })
      .getByRole('listitem')
      .first();
    await expect(item).toContainText(copy('myLearning.progress.completed'));
    await expect(item).not.toContainText('Lessons complete:');

    await learner.goto('/en/my/progress/courses');
    await expect(
      learner
        .getByRole('table', { name: copy('myLearning.progressPage.caption') })
        .getByRole('row')
        .filter({ hasText: TEXT.paced }),
    ).toContainText(copy('myLearning.progress.completed'));
  });

  test('a trial request is a request — it enrols nobody, books nothing, and can be withdrawn', async () => {
    await openWithIsland(learner, PAGE.live);
    const island = islandOn(learner);
    await island
      .getByRole('button', { name: copy('learningIsland.requestTrial') })
      .click();
    await expect(
      learner
        .getByRole('status')
        .getByText(copy('learningIsland.trialRequestedStatus'), { exact: true }),
    ).toBeVisible();
    await expect(island).toContainText(copy('learningIsland.trialRequested'));
    // Still not enrolled: the two are different acts.
    await expect(
      island.getByRole('button', { name: copy('learningIsland.enrol') }),
    ).toBeVisible();
    expect(await island.innerText()).not.toMatch(BOOKED);
    expect(
      await scalar(
        `SELECT COUNT_BIG(*) AS [value] FROM [dbo].[TrialClassRequest] WHERE [userId]=N'${learnerId}' AND [courseId]=N'${ids.live}';`,
      ),
    ).toBe(1);
    expect(
      await scalar(
        `SELECT COUNT_BIG(*) AS [value] FROM [dbo].[Enrolment] WHERE [userId]=N'${learnerId}' AND [courseId]=N'${ids.live}';`,
      ),
    ).toBe(0);

    // A reload knows it, and still offers nothing scheduled.
    await openWithIsland(learner, PAGE.live);
    await expect(islandOn(learner)).toContainText(copy('learningIsland.trialRequested'));

    await learner.goto('/en/my/learning');
    const main = learner.getByRole('main');
    const trials = learner.getByRole('list', { name: copy('myLearning.trials.heading') });
    const request = trials.getByRole('listitem').filter({ hasText: TEXT.live });
    await expect(request).toContainText(copy('myLearning.trials.status'));
    await expect(
      learner.getByRole('list', { name: copy('myLearning.courses.heading') }),
    ).not.toContainText(TEXT.live);
    expect(await main.innerText()).not.toMatch(BOOKED);
    await expect(
      main.getByRole('button', { name: /confirm|schedule|book|join|assign/i }),
    ).toHaveCount(0);

    await request
      .getByRole('button', {
        name: copy('myLearning.trials.withdraw', { title: TEXT.live }),
      })
      .click();
    await expect(main).toContainText(copy('myLearning.trials.empty'));
    expect(
      await scalar(
        `SELECT COUNT_BIG(*) AS [value] FROM [dbo].[TrialClassRequest] WHERE [userId]=N'${learnerId}';`,
      ),
    ).toBe(0);
  });

  test('a Course that leaves the catalogue keeps the person’s place but shows none of its syllabus', async ({
    request,
  }) => {
    await openWithIsland(learner, PAGE.spare);
    await islandOn(learner)
      .getByRole('button', { name: copy('learningIsland.enrol') })
      .click();
    await expect(islandOn(learner)).toContainText(copy('learningIsland.enrolled'));

    await sql.query(
      `UPDATE [dbo].[Course] SET [state]=N'archived', [version]=[version]+1, [updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${ids.spare}';`,
    );
    expect((await request.get(PAGE.spare, { maxRedirects: 0 })).status()).toBe(404);

    await learner.goto('/en/my/learning');
    const item = learner
      .getByRole('list', { name: copy('myLearning.courses.heading') })
      .getByRole('listitem')
      .filter({ hasText: TEXT.spare });
    await expect(item).toContainText(copy('myLearning.courses.unavailable'));

    const response = await learner.goto(`/en/my/learning/courses/${slug.spare}`);
    expect(response?.status()).toBe(200);
    const main = learner.getByRole('main');
    await expect(learner.getByRole('heading', { level: 1 })).toHaveText(TEXT.spare);
    await expect(main).toContainText(copy('myLearning.course.unavailable'));
    // A draft's or archived outline may be mid-edit: none of it is shown, and
    // no progress line claims anything about it.
    await expect(
      main.getByRole('heading', { name: copy('myLearning.course.syllabus') }),
    ).toHaveCount(0);
    for (const hidden of [
      TEXT.spareModule,
      TEXT.spareLesson,
      BODY.spare,
      'Lessons complete:',
    ])
      await expect(main).not.toContainText(hidden);
    await expect(
      main.getByRole('button', { name: copy('myLearning.lesson.complete') }),
    ).toHaveCount(0);

    // Leaving needs the explicit confirmation, then removes the enrolment.
    const leave = main.getByRole('button', { name: copy('myLearning.leave.submit') });
    await leave.click();
    await expect(main).toContainText(copy('myLearning.failure.confirmRequired'));
    await main.getByLabel(copy('myLearning.leave.confirm')).check();
    await leave.click();
    await learner.waitForURL(/\/en\/my\/learning$/);
    await expect(learner.getByRole('main')).not.toContainText(TEXT.spare);
    expect(
      await scalar(
        `SELECT COUNT_BIG(*) AS [value] FROM [dbo].[Enrolment] WHERE [userId]=N'${learnerId}' AND [courseId]=N'${ids.spare}';`,
      ),
    ).toBe(0);
  });
});

/* ===========================================================================
 * 5. Another person sees none of it, and the handlers refuse what they must
 * ========================================================================= */

test.describe('another learner', () => {
  test('sees none of the first person’s learning, and cannot open their Course', async () => {
    for (const [target, empty] of [
      ['/en/my/learning', copy('myLearning.courses.empty')],
      ['/en/my/progress/courses', copy('myLearning.courses.empty')],
    ] as const) {
      await other.goto(target);
      const main = other.getByRole('main');
      await expect(main, target).toContainText(empty);
      await expect(main, target).not.toContainText(TEXT.paced);
      await expect(main, target).not.toContainText(TEXT.live);
    }
    await expect(other.getByRole('main')).not.toContainText(
      copy('myLearning.progress.completed'),
    );
    await other.goto('/en/my/learning');
    await expect(other.getByRole('main')).toContainText(copy('myLearning.trials.empty'));

    // NOT EVEN BY ADDRESS: a Course this person is not enrolled on is a 404,
    // exactly like one that does not exist — and so is a draft.
    for (const target of [
      `/en/my/learning/courses/${slug.paced}`,
      `/en/my/learning/courses/${slug.paced}?lesson=${ids.pacedLessonOne}`,
      `/en/my/learning/courses/${slug.draft}`,
    ]) {
      const response = await other.goto(target);
      expect(response?.status(), target).toBe(404);
      await expect(other.locator('body'), target).not.toContainText(TEXT.body);
    }

    // Their island knows nothing of the first person's choices.
    await openWithIsland(other, PAGE.paced);
    await expect(
      islandOn(other).getByRole('button', { name: copy('learningIsland.enrol') }),
    ).toBeVisible();
    const state = await other
      .context()
      .request.get(`/api/my/learning/state?course=${ids.paced}`);
    expect(state.status()).toBe(200);
    expect(await state.json()).toEqual({
      signedIn: true,
      state: { enrolled: false, trialRequested: false },
    });

    // Their own enrolment and request on the live Course, for the counts
    // administration shows below — and neither reaches the first person.
    await openWithIsland(other, PAGE.live);
    const island = islandOn(other);
    await island.getByRole('button', { name: copy('learningIsland.enrol') }).click();
    await expect(island).toContainText(copy('learningIsland.enrolled'));
    await island
      .getByRole('button', { name: copy('learningIsland.requestTrial') })
      .click();
    await expect(island).toContainText(copy('learningIsland.trialRequested'));

    await learner.goto('/en/my/learning');
    const main = learner.getByRole('main');
    await expect(main).toContainText(copy('myLearning.trials.empty'));
    await expect(
      learner.getByRole('list', { name: copy('myLearning.courses.heading') }),
    ).not.toContainText(TEXT.live);
  });

  test('the Learning handlers refuse another origin, a missing intent and no session', async ({
    request,
  }) => {
    const body = { courseId: ids.paced };
    for (const route of ['enrolments', 'trials'] as const)
      for (const [why, headers] of [
        ['no intent header', { origin: baseUrl() }],
        ['a foreign origin', { ...intentHeaders(), origin: 'https://elsewhere.invalid' }],
        ['no origin', { 'x-minhaj-intent': 'personal' }],
        ['a cross-site fetch', { ...intentHeaders(), 'sec-fetch-site': 'cross-site' }],
      ] as const) {
        const response = await other
          .context()
          .request.post(`/api/my/learning/${route}`, { headers, data: body });
        expect(response.status(), `${route}: ${why}`).toBe(403);
        expect(await response.json(), `${route}: ${why}`).toEqual({
          ok: false,
          failure: 'denied',
        });
        expect(response.headers()['cache-control'], why).toContain('no-store');
      }

    // No session: refused as such, after the same-origin checks pass.
    for (const route of ['enrolments', 'trials'] as const) {
      const anonymous = await request.post(`/api/my/learning/${route}`, {
        headers: intentHeaders(),
        data: body,
      });
      expect(anonymous.status(), route).toBe(401);
      expect(await anonymous.json(), route).toEqual({ ok: false, failure: 'no-session' });
    }
    const signedOut = await request.get(`/api/my/learning/state?course=${ids.paced}`);
    expect(signedOut.status()).toBe(200);
    expect(await signedOut.json()).toEqual({ signedIn: false });
    expect(signedOut.headers()['cache-control']).toBe('private, no-store');
    expect((await request.get('/api/my/export/learning')).status()).toBe(401);
    const embedded = await other
      .context()
      .request.get(`/api/my/learning/state?course=${ids.paced}`, {
        headers: { 'sec-fetch-site': 'cross-site' },
      });
    expect(embedded.status()).toBe(403);

    // A trial request on a self-paced Course is refused by what the Course is.
    const selfPaced = await other.context().request.post('/api/my/learning/trials', {
      headers: intentHeaders(),
      data: body,
    });
    expect(selfPaced.status()).toBe(409);
    expect(await selfPaced.json()).toEqual({ ok: false, failure: 'course-unavailable' });

    // Nothing above changed anything.
    for (const table of ['Enrolment', 'TrialClassRequest'])
      expect(
        await scalar(
          `SELECT COUNT_BIG(*) AS [value] FROM [dbo].[${table}] WHERE [userId]=N'${otherId}' AND [courseId]=N'${ids.paced}';`,
        ),
        table,
      ).toBe(0);
  });

  test('the Learning export is the person’s own data, privately', async () => {
    const response = await learner.context().request.get('/api/my/export/learning');
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers['cache-control']).toBe('private, no-store');
    expect(headers['content-disposition']).toMatch(
      /^attachment; filename="minhaj-learning-data-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    const document = (await response.json()) as {
      schema: string;
      enrolments: { courseId: string }[];
      progress: { courseId: string; lessonId: string }[];
      trialRequests: unknown[];
    };
    expect(document.schema).toBe('minhaj.learning.export');
    expect(document.enrolments.map((entry) => entry.courseId)).toEqual([ids.paced]);
    expect(document.progress.map((entry) => entry.lessonId).sort()).toEqual(
      [ids.pacedLessonOne, ids.pacedLessonTwo].sort(),
    );
    expect(document.trialRequests).toEqual([]);
    const raw = JSON.stringify(document);
    for (const secret of [otherId, otherEmail, learnerEmail, TEXT.body, PASSWORD])
      expect(raw).not.toContain(secret);
  });
});

/* ===========================================================================
 * 6. Administration
 * ========================================================================= */

test.describe('Learning administration', () => {
  let admin: Page;
  let reader: Page;
  let stranger: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    for (const [index, keys, role] of [
      [3, ['learning.read', 'learning.administer'], 'administer'],
      [4, ['learning.read'], 'read'],
      [5, [] as string[], 'none'],
    ] as const) {
      const { page, id } = await account(browser, index, `learning-admin-${role}`);
      if (keys.length > 0) await grantRole(sql, id, keys, 'Learning browser proof');
      if (role === 'administer') admin = page;
      else if (role === 'read') reader = page;
      else stranger = page;
    }
  });

  test('refuses every Learning surface to an account without its keys', async () => {
    for (const surface of [
      'courses',
      'paths',
      'enrolments',
      'trials',
      `courses/${ids.draft}`,
      `courses/${ids.paced}/lessons/${ids.pacedLessonOne}`,
      `paths/${ids.path}`,
    ]) {
      const response = await stranger.goto(`/en/admin/learning/${surface}`);
      expect(response?.status(), surface).toBe(404);
      await expect(stranger.locator('body'), surface).not.toContainText(SENTINEL);
    }
  });

  test('learning.read sees the catalogue and counts — never a learner — and is refused a change', async () => {
    await reader.goto('/en/admin/learning/courses');
    const table = reader.getByRole('table', {
      name: copy('adminLearning.surface.courses'),
    });
    for (const title of [TEXT.paced, TEXT.live, TEXT.spare, TEXT.draft])
      await expect(table, title).toContainText(title);

    await reader.goto('/en/admin/learning/enrolments');
    const enrolments = reader.getByRole('table', {
      name: copy('adminLearning.surface.enrolments'),
    });
    // Title, state, enrolled, completed — waited for, since the page streams.
    for (const [title, learners, completed] of [
      [TEXT.paced, '1', '1'],
      [TEXT.live, '1', '0'],
    ] as const)
      await expect(
        enrolments.getByRole('row').filter({ hasText: title }).getByRole('cell'),
        title,
      ).toHaveText([title, /\S/, learners, completed]);

    await reader.goto('/en/admin/learning/trials');
    const main = reader.getByRole('main');
    await expect(main).toContainText(copy('adminLearning.trials.notScheduled'));
    const trials = reader.getByRole('table', {
      name: copy('adminLearning.surface.trials'),
    });
    await expect(
      trials.getByRole('row').filter({ hasText: TEXT.live }).getByRole('cell'),
    ).toHaveText([TEXT.live, /\S/, '1', /\S/]);
    // COUNTS ONLY: nothing confirms, schedules or assigns, and nobody is named.
    await expect(main.getByRole('button')).toHaveCount(0);
    await expect(
      main.getByRole('link', { name: /confirm|schedule|assign/i }),
    ).toHaveCount(0);
    for (const target of ['/en/admin/learning/enrolments', '/en/admin/learning/trials']) {
      await reader.goto(target);
      await expect(reader.getByRole('table'), target).toBeVisible();
      const text = await reader.locator('body').innerText();
      for (const secret of [
        learnerEmail,
        otherEmail,
        'learning-learner',
        'learning-other',
      ])
        expect(text, target).not.toContain(secret);
    }

    // The form is a read-only holder's to look at, not to use: a save is
    // refused by the server and changes nothing.
    const before = await scalar(
      `SELECT [version] AS [value] FROM [dbo].[Course] WHERE [id]=N'${ids.draft}';`,
    );
    await reader.goto(`/en/admin/learning/courses/${ids.draft}`);
    await reader.locator('#course-en-title').fill(`${TEXT.draft} reader`);
    await reader
      .getByRole('button', { name: copy('adminLearning.save'), exact: true })
      .click();
    await expect(
      reader.getByRole('alert').filter({ hasText: copy('adminLearning.failure.denied') }),
    ).toBeVisible();
    await reader
      .getByRole('button', {
        name: copy('adminLearning.outline.moveModuleLater', {
          title: TEXT.draftModuleA,
          position: 1,
          total: 2,
        }),
      })
      .click();
    await expect(
      reader.getByRole('alert').filter({ hasText: copy('adminLearning.failure.denied') }),
    ).toHaveCount(2);
    expect(
      await scalar(
        `SELECT [version] AS [value] FROM [dbo].[Course] WHERE [id]=N'${ids.draft}';`,
      ),
    ).toBe(before);
  });

  test('a published Course’s syllabus is frozen, with the reason and no outline control', async () => {
    await admin.goto(`/en/admin/learning/courses/${ids.paced}`);
    const main = admin.getByRole('main');
    await expect(main).toContainText(copy('adminLearning.outline.frozen'));
    await expect(main).toContainText(TEXT.pacedLessonOne);
    await expect(main.getByRole('button', { name: /^Move (module|lesson)/ })).toHaveCount(
      0,
    );
    await expect(
      main.getByRole('heading', { name: copy('adminLearning.outline.addModule') }),
    ).toHaveCount(0);
    await expect(
      main.locator('summary').filter({ hasText: /^(Remove|Edit module|Add a lesson)/ }),
    ).toHaveCount(0);

    // The lesson itself is shown read-only, with the same reason.
    await admin.goto(
      `/en/admin/learning/courses/${ids.paced}/lessons/${ids.pacedLessonOne}`,
    );
    await expect(admin.getByRole('main')).toContainText(
      copy('adminLearning.outline.frozen'),
    );
    await expect(admin.getByRole('main')).toContainText(BODY.pacedOne);
    await expect(
      admin
        .getByRole('main')
        .getByRole('button', { name: copy('adminLearning.save'), exact: true }),
    ).toHaveCount(0);
  });

  test('a draft’s ordering controls name what moves and from where, and work', async () => {
    await admin.goto(`/en/admin/learning/courses/${ids.draft}`);
    const first = { title: TEXT.draftModuleA, position: 1, total: 2 };
    const second = { title: TEXT.draftModuleB, position: 2, total: 2 };
    const later = admin.getByRole('button', {
      name: copy('adminLearning.outline.moveModuleLater', first),
    });
    await expect(later).toBeVisible();
    await expect(
      admin.getByRole('button', {
        name: copy('adminLearning.outline.moveModuleEarlier', second),
      }),
    ).toBeVisible();
    // The first has nothing before it and the last nothing after it.
    await expect(
      admin.getByRole('button', {
        name: copy('adminLearning.outline.moveModuleEarlier', first),
      }),
    ).toHaveCount(0);
    await expect(
      admin.getByRole('button', {
        name: copy('adminLearning.outline.moveModuleLater', second),
      }),
    ).toHaveCount(0);

    await later.click();
    await expect(
      admin.getByRole('button', {
        name: copy('adminLearning.outline.moveModuleLater', {
          ...second,
          position: 1,
        }),
      }),
    ).toBeVisible();
    const order = await sql.query<{ id: string }>(
      `SELECT [id] FROM [dbo].[CourseModule] WHERE [courseId]=N'${ids.draft}' ORDER BY [position];`,
    );
    expect(order.map((row) => row.id)).toEqual([ids.draftModuleB, ids.draftModuleA]);
    await expectLabelledControls(admin, 'the draft editor');
  });

  test('refuses a stale save visibly, and keeps the first', async () => {
    const editor = `/en/admin/learning/courses/${ids.draft}`;
    await admin.goto(editor);
    const stale = await admin.context().newPage();
    await stale.goto(editor);

    await admin.locator('#course-en-title').fill(TEXT.draftFirstSave);
    await admin
      .getByRole('button', { name: copy('adminLearning.save'), exact: true })
      .click();
    await expect(admin.getByRole('main').getByRole('heading', { level: 1 })).toHaveText(
      TEXT.draftFirstSave,
    );

    await stale.locator('#course-en-title').fill(TEXT.draftStaleSave);
    await stale
      .getByRole('button', { name: copy('adminLearning.save'), exact: true })
      .click();
    await expect(
      stale
        .getByRole('alert')
        .filter({ hasText: copy('adminLearning.failure.conflict') }),
    ).toBeVisible();
    await stale.close();

    const [row] = await sql.query<{ title: string }>(
      `SELECT [title] FROM [dbo].[CourseLabel] WHERE [courseId]=N'${ids.draft}' AND [locale]=N'en';`,
    );
    expect(row?.title).toBe(TEXT.draftFirstSave);
  });
});

/* ===========================================================================
 * 7. Every locale, every width, the keyboard and reduced motion
 * ========================================================================= */

test.describe('Learning surfaces', () => {
  test('render right-to-left where they should, and reflow at 320px and at 200% zoom', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const targets: readonly [Page, string, boolean][] = [
      [page, '/en/learn/courses', true],
      [page, '/ur/learn/courses', true],
      [page, '/ar/learn/courses', true],
      [page, '/ur/learn', true],
      [page, `/ar/learn/courses/${slug.paced}`, true],
      [page, `/ur/learn/courses/${slug.live}`, true],
      [page, `/ar/learn/paths/${slug.path}`, true],
      [page, '/ur/learn/trial', true],
      [learner, '/ur/my/learning', true],
      [learner, `/ar/my/learning/courses/${slug.paced}`, true],
      [learner, `/ur/my/learning/paths/${slug.path}`, true],
      [learner, '/ar/my/progress/courses', true],
      [learner, '/en/my/learning', true],
    ];
    // 640 CSS pixels is a 1280-pixel window at 200% zoom.
    for (const width of [320, 640]) {
      for (const viewer of [page, learner])
        await viewer.setViewportSize({ width, height: 800 });
      for (const [viewer, target, outline] of targets) {
        const locale = target.split('/')[1] as UiLocale;
        const response = await viewer.goto(target);
        expect(response?.status(), target).toBe(200);
        await expect(viewer.locator('html'), target).toHaveAttribute(
          'dir',
          locale === 'en' ? 'ltr' : 'rtl',
        );
        await expect(viewer.locator('html'), target).toHaveAttribute('lang', locale);
        expect(
          await overflowOf(viewer),
          `${String(width)}px ${target}`,
        ).toBeLessThanOrEqual(0);
        if (outline) await expectHeadingsInOrder(viewer, `${String(width)}px ${target}`);
      }
    }
    for (const viewer of [page, learner])
      await viewer.setViewportSize({ width: 1280, height: 800 });

    // A Course with Arabic words shows them in Arabic, marked as Arabic.
    await page.goto(`/ar/learn/courses/${slug.paced}`);
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toHaveText(TEXT.pacedAr);
    // The words' block carries their language (the title and summary together).
    await expect(heading.locator('xpath=..')).toHaveAttribute('lang', 'ar');
    await expect(heading.locator('xpath=..')).toHaveAttribute('dir', 'rtl');
  });

  test('administration is right-to-left in Urdu and Arabic and reflows too', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const { page: admin, id } = await account(browser, 6, 'learning-admin-rtl');
    await grantRole(
      sql,
      id,
      ['learning.read', 'learning.administer'],
      'Learning RTL proof',
    );
    for (const width of [320, 640]) {
      await admin.setViewportSize({ width, height: 800 });
      for (const target of [
        '/ar/admin/learning/courses',
        '/ur/admin/learning/enrolments',
        '/ar/admin/learning/trials',
        `/ur/admin/learning/courses/${ids.paced}`,
      ]) {
        const response = await admin.goto(target);
        expect(response?.status(), target).toBe(200);
        // The page streams behind a loading state; measure what it settles on.
        await expect(
          admin.getByRole('main').getByRole('heading', { level: 1 }),
          target,
        ).toBeVisible();
        await expect(admin.locator('html'), target).toHaveAttribute('dir', 'rtl');
        expect(
          await overflowOf(admin),
          `${String(width)}px ${target}`,
        ).toBeLessThanOrEqual(0);
      }
    }
    await admin.setViewportSize({ width: 1280, height: 800 });
    await admin.goto('/ar/admin/learning/courses');
    // The operator's locale picks the words: Arabic where the Course has them,
    // its primary language otherwise.
    await expect(admin.getByRole('table')).toContainText(TEXT.pacedAr);
    await expect(admin.getByRole('table')).toContainText(TEXT.live);
  });

  test('the filters and the island are reached by keyboard, visibly, and labelled', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/en/learn/courses');
    for (const label of ['topic', 'level', 'format', 'language', 'teacher'])
      await expect(
        page.getByLabel(copy(`learn.filter.${label}`), { exact: true }),
        label,
      ).toHaveJSProperty('tagName', 'SELECT');
    await expectLabelledControls(page, '/en/learn/courses');
    const topic = page.getByLabel(copy('learn.filter.topic'), { exact: true });
    await tabTo(page, topic);
    await expectVisibleFocus(topic, 'the topic filter');
    const apply = page.getByRole('button', { name: copy('learn.filter.apply') });
    await tabTo(page, apply);
    await expectVisibleFocus(apply, 'Apply filters');

    // The island's Enrol, for a person not yet enrolled, by Tab alone.
    await other.setViewportSize({ width: 1280, height: 800 });
    await openWithIsland(other, PAGE.paced);
    const enrol = islandOn(other).getByRole('button', {
      name: copy('learningIsland.enrol'),
    });
    await expect(enrol).toBeVisible();
    await tabTo(other, enrol);
    await expectVisibleFocus(enrol, 'Enrol');

    // My Learning's own controls are labelled too.
    await learner.goto(`/en/my/learning/courses/${slug.paced}`);
    await expectLabelledControls(learner, 'My Learning course');
  });

  test('nothing moves under reduced motion, and the island still works', async () => {
    await other.emulateMedia({ reducedMotion: 'reduce' });
    for (const target of [PAGE.paced, '/en/learn/courses', '/en/my/learning']) {
      await other.goto(target);
      await expect(other.getByRole('heading', { level: 1 })).toBeVisible();
      const motion = await other.evaluate(() => ({
        running: document
          .getAnimations()
          .filter((animation) => animation.playState === 'running').length,
        styles: [...document.querySelectorAll('main, main *')].map((element) => {
          const style = globalThis.getComputedStyle(element);
          return {
            animation: style.animationName,
            animationDuration: style.animationDuration,
            transition: style.transitionDuration,
          };
        }),
      }));
      expect(motion.running, target).toBe(0);
      for (const style of motion.styles) {
        if (style.animation !== 'none')
          for (const part of style.animationDuration.split(', '))
            expect(Number.parseFloat(part), target).toBeLessThanOrEqual(0.000_01);
        for (const part of style.transition.split(', '))
          expect(Number.parseFloat(part), target).toBeLessThanOrEqual(0.000_01);
      }
    }

    // Still fully usable: the person enrols under the same preference.
    await openWithIsland(other, PAGE.paced);
    await islandOn(other)
      .getByRole('button', { name: copy('learningIsland.enrol') })
      .click();
    await expect(islandOn(other)).toContainText(copy('learningIsland.enrolled'));
    await other.emulateMedia({ reducedMotion: 'no-preference' });
  });
});
