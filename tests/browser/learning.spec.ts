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
 * accounts are fresh. NO OTHER SPEC PUBLISHES A COURSE while this file runs —
 * `messaging.spec.ts` does, but only AFTER it, as a dependent Playwright
 * project — which is what makes the
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
    // The request itself says nothing is booked and links no class. Since Phase
    // 23 the section's help explains what WOULD happen once a class is
    // confirmed — that one sentence is the only booking word the page may hold.
    expect(await request.innerText()).not.toMatch(BOOKED);
    await expect(
      request.getByRole('link', { name: copy('myLearning.trials.openClass') }),
    ).toHaveCount(0);
    expect(
      (await main.innerText()).replace(copy('myLearning.trials.help'), ''),
    ).not.toMatch(BOOKED);
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

/* ===========================================================================
 * 8. Phase 23 — teachers and live classes
 * ========================================================================= */

/**
 * Phase 23 — Teacher Experience & Live Classes, against the production build.
 *
 * WHAT ONLY A BROWSER CAN PROVE: that while live learning is switched off the
 * public schedule, Find a Teacher, My Classes and the Teacher area say so in
 * words and invent nothing; that the Teacher area is a 404 to anyone who does
 * not hold `teaching.perform` NOW — a teacher profile alone grants nothing, and
 * a revoked assignment stops answering on the next request — and shows a
 * teacher only the Course they are scoped to; that an operator scopes a
 * teacher, confirms a learner's trial request into a teacher's open window and
 * schedules a class with a Google Meet link, all through the pages; that the
 * meeting link reaches the class's own participants on their own pages and no
 * public document; that a class moved from a stale page is refused visibly, a
 * mark is one row whose latest value wins, and a cancelled or completed class
 * offers no join link; that Find a Teacher lists only operational teachers,
 * narrows by every filter and explains an unknown one; and that the new
 * surfaces are right-to-left in Urdu and Arabic, reflow at 320 pixels and at
 * 200% zoom, reach their controls by keyboard with a visible focus, and state
 * every status in words.
 *
 * THE ACTIVATION IS THIS FILE'S. `LiveLearningActivation` is a database-wide,
 * immutable singleton no other spec writes before this file has finished
 * (`messaging.spec.ts` runs after it). The switched-off proofs run first,
 * against a precondition asserted on the database; only then does this file
 * write the one `fixture` row, which every later public page must announce
 * with its test-state banner.
 *
 * WHO WRITES WHAT. Identity's role assignments and display names, People's
 * published teacher profiles and the activation are other owners' or an
 * operator's facts, written as fixtures through the privileged session.
 * Everything Learning owns — the scope, the windows, the trial confirmation,
 * the classes, the meeting links, the marks, every move, cancellation and
 * completion — is done through the pages.
 */

/** Synthetic Google Meet addresses; the last is a lookalike host. */
const MEET = {
  created: 'https://meet.google.com/xyz-wvut-srq',
  join: 'https://meet.google.com/abc-defg-hij',
  trial: 'https://meet.google.com/tri-alxy-zab',
  invalid: 'https://meet.google.com.evil.example/abc-defg-hij',
} as const;

/** A UTC calendar date `days` from now, as a `datetime-local` value's date. */
function dateIn(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/** Wall-clock times in UTC, the zone every form here is given. */
const WHEN = {
  windowOne: [`${dateIn(2)}T09:00`, `${dateIn(2)}T10:00`],
  windowTwo: [`${dateIn(2)}T12:00`, `${dateIn(2)}T13:00`],
  regular: [`${dateIn(3)}T10:00`, `${dateIn(3)}T11:00`],
  moved: [`${dateIn(3)}T14:00`, `${dateIn(3)}T15:00`],
  stale: [`${dateIn(3)}T16:00`, `${dateIn(3)}T17:00`],
  later: [`${dateIn(5)}T10:00`, `${dateIn(5)}T11:00`],
} as const;

interface Actor {
  readonly page: Page;
  readonly id: string;
  /** Identity's display name — what an operator or a teacher is shown. */
  readonly name: string;
}

interface Teacher extends Actor {
  /** People's slug and public name — what a visitor is shown. */
  readonly slug: string;
  readonly publicName: string;
}

let teacherOne: Teacher;
let teacherTwo: Teacher;
let profileOnly: Teacher;
let operator: Actor;
let catalogueReader: Actor;
let student: Actor;
let bystander: Actor;
let trialSessionId: string;
let regularSessionId: string;
let laterSessionId: string;

/** One row of a privileged read. */
async function rowOf<T>(statement: string): Promise<T | undefined> {
  const [row] = await sql.query<T>(statement);
  return row;
}

/** A fresh signed-in account whose Identity display name is a sentinel. */
async function namedAccount(
  browser: Browser,
  index: number,
  prefix: string,
  name: string,
): Promise<Actor> {
  const { page, id } = await account(browser, index, prefix);
  await sql.query(`UPDATE [dbo].[User] SET [name]=${n(name)} WHERE [id]=N'${id}';`);
  return { page, id, name };
}

/** People's published contributor with an ACTIVE TeacherProfile, linked to the account. */
async function publishTeacherProfile(actor: Actor, key: string): Promise<Teacher> {
  const personId = randomUUID();
  const personSlug = `non-learning-fixture-teacher-${key}-${run}`;
  const publicName = `${SENTINEL} teacher ${key} ${run}`;
  await sql.query(`
    INSERT INTO [dbo].[Person] ([id],[slug],[userId],[primaryLocale],[status])
      VALUES (N'${personId}', N'${personSlug}', N'${actor.id}', N'en', N'published');
    INSERT INTO [dbo].[PersonTranslation] ([personId],[locale],[name],[biography])
      VALUES (N'${personId}', N'en', ${n(publicName)}, NULL);
    INSERT INTO [dbo].[TeacherProfile] ([id],[personId],[status])
      VALUES (NEWID(), N'${personId}', N'active');
    INSERT INTO [dbo].[TeacherProfileLanguage] ([teacherProfileId],[languageCode])
      SELECT [id], N'ur' FROM [dbo].[TeacherProfile] WHERE [personId]=N'${personId}';
  `);
  return { ...actor, slug: personSlug, publicName };
}

/** The page's own first-level heading, once a streamed page has settled. */
function mainHeading(page: Page): Locator {
  return page.getByRole('main').getByRole('heading', { level: 1 }).first();
}

/**
 * A Learning administration page refused to a viewer who MAY enter the area.
 *
 * The area streams behind its `loading.tsx`, so a page's own key check runs
 * after the response's status line has gone: the refusal arrives as the
 * not-found document in the stream (Next's 404 fallback marker), with none of
 * the page — no `main`, no title, no record. That document is what is proved.
 * (A viewer with no administrative key at all is refused by the shell before
 * anything streams, and gets the 404 status too — proved in section 6.)
 */
async function expectRefusedInArea(page: Page, target: string): Promise<void> {
  const response = await page.goto(target);
  const html = (await response?.text()) ?? '';
  expect(html, target).toContain('NEXT_HTTP_ERROR_FALLBACK;404');
  await expect(page.getByRole('main'), target).toHaveCount(0);
  for (const secret of [TEXT.live, SENTINEL]) expect(html, target).not.toContain(secret);
}

/** Scopes an account to the live Course through the scopes page. */
async function grantScope(page: Page, accountId: string): Promise<void> {
  await page.goto('/en/admin/learning/classes/scopes');
  await expect(mainHeading(page)).toHaveText(copy('adminLearning.classes.scopes'));
  await page.locator('#grant-course').selectOption({ label: TEXT.live });
  await page.locator('#grant-account').fill(accountId);
  await page
    .getByRole('button', { name: copy('adminLearning.classes.grantSubmit') })
    .click();
}

/** Fills and submits the operator's "Schedule a class" form; the class's page follows. */
async function scheduleClass(
  page: Page,
  teacher: Actor,
  [starts, ends]: readonly [string, string],
  meetingUrl: string,
): Promise<void> {
  await page.goto('/en/admin/learning/classes/new');
  await expect(mainHeading(page)).toHaveText(copy('adminLearning.classes.create'));
  await page
    .locator('#new-scope')
    .selectOption({ label: `${TEXT.live} — ${teacher.name}` });
  await page.locator('#new-zone').selectOption('UTC');
  await page.locator('#new-starts').fill(starts);
  await page.locator('#new-ends').fill(ends);
  await page.locator('#new-meeting').fill(meetingUrl);
  await page
    .getByRole('button', { name: copy('adminLearning.classes.createSubmit') })
    .click();
}

/** The class identifier an operator's class page is addressed by. */
function classIdIn(url: string): string {
  const match = /\/classes\/([0-9a-fA-F-]{36})$/.exec(new URL(url).pathname);
  if (match?.[1] === undefined) throw new Error(`No class identifier in ${url}`);
  return match[1];
}

test.describe('Phase 23 — before live learning is switched on', () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    teacherOne = await publishTeacherProfile(
      await namedAccount(
        browser,
        7,
        'learning-teacher-one',
        `${SENTINEL} account one ${run}`,
      ),
      'one',
    );
    await grantRole(sql, teacherOne.id, ['teaching.perform'], `${SENTINEL} teaching`);
    teacherTwo = await publishTeacherProfile(
      await namedAccount(
        browser,
        8,
        'learning-teacher-two',
        `${SENTINEL} account two ${run}`,
      ),
      'two',
    );
    await grantRole(sql, teacherTwo.id, ['teaching.perform'], `${SENTINEL} teaching`);
    // A published teacher profile and NO teaching role: a profile grants nothing.
    profileOnly = await publishTeacherProfile(
      await namedAccount(
        browser,
        9,
        'learning-profile-only',
        `${SENTINEL} account profile ${run}`,
      ),
      'profile-only',
    );
    operator = await namedAccount(
      browser,
      10,
      'learning-class-operator',
      `${SENTINEL} operator ${run}`,
    );
    await grantRole(
      sql,
      operator.id,
      ['learning.classes.read', 'learning.classes.administer'],
      `${SENTINEL} class operator`,
    );
    catalogueReader = await namedAccount(
      browser,
      11,
      'learning-catalogue-reader',
      `${SENTINEL} catalogue reader ${run}`,
    );
    await grantRole(sql, catalogueReader.id, ['learning.read'], `${SENTINEL} catalogue`);
    student = await namedAccount(
      browser,
      12,
      'learning-student',
      `${SENTINEL} student ${run}`,
    );
    bystander = await namedAccount(
      browser,
      13,
      'learning-bystander',
      `${SENTINEL} bystander ${run}`,
    );
  });

  test('Live learning and Find a teacher say plainly that nothing is switched on', async ({
    page,
  }) => {
    // THE PRECONDITION, PROVED: no other spec writes the activation, and this
    // file has not yet.
    expect(
      await scalar('SELECT COUNT_BIG(*) AS [value] FROM [dbo].[LiveLearningActivation];'),
    ).toBe(0);

    for (const [target, unavailable] of [
      ['/en/learn/live', copy('learnLive.unavailable.body')],
      ['/en/learn/teachers', copy('learnTeachers.unavailable.body')],
      [
        '/en/learn/teachers?availability=available',
        copy('learnTeachers.unavailable.body'),
      ],
    ] as const) {
      const response = await page.goto(target);
      expect(response?.status(), target).toBe(200);
      expect(response?.headers()['set-cookie'], target).toBeUndefined();
      await expect(page.locator('meta[name="robots"]').first(), target).toHaveAttribute(
        'content',
        /noindex/,
      );
      const main = page.getByRole('main');
      await expect(main, target).toContainText(unavailable);
      await expect(main, target).not.toContainText(SENTINEL);
      // No test banner and no list: there is nothing to label.
      for (const banner of [copy('learnLive.fixture'), copy('learnTeachers.fixture')])
        await expect(main, target).not.toContainText(banner);
      for (const list of [copy('learnLive.listLabel'), copy('learnTeachers.title')])
        await expect(
          main.getByRole('list', { name: list, exact: true }),
          target,
        ).toHaveCount(0);
      await expect(
        main.getByRole('link', { name: copy('learnLive.unavailable.browse') }),
        target,
      ).toHaveAttribute('href', '/en/learn/courses');
    }
  });

  test('a teacher is told the area is off, a learner sees the notice, and only a scope can be prepared', async () => {
    test.setTimeout(120_000);
    // A real teacher meets the honest not-switched-on page, with no sections.
    const teacher = teacherOne.page;
    for (const target of [
      '/en/teacher',
      '/en/teacher/availability',
      '/en/teacher/students',
    ]) {
      const response = await teacher.goto(target);
      expect(response?.status(), target).toBe(200);
      await expect(mainHeading(teacher), target).toHaveText(
        copy('teacher.notActivated.title'),
      );
      await expect(teacher.getByRole('main'), target).toContainText(
        copy('teacher.notActivated.body'),
      );
      await expect(
        teacher.getByRole('navigation', { name: copy('teacher.nav.label') }),
        target,
      ).toHaveCount(0);
      await expect(teacher.getByRole('main').locator('form'), target).toHaveCount(0);
    }

    // A learner's My Classes says so in words, and offers nothing to join.
    const response = await student.page.goto('/en/my/classes');
    expect(response?.status()).toBe(200);
    const mine = student.page.getByRole('main');
    await expect(mine).toContainText(copy('myClasses.notActivated'));
    await expect(mine).toContainText(copy('myClasses.upcoming.empty'));
    await expect(student.page.locator('a[href*="meet.google.com"]')).toHaveCount(0);

    // The operator is told too; a profile alone cannot be scoped, a teacher can.
    const op = operator.page;
    await op.goto('/en/admin/learning/classes');
    await expect(mainHeading(op)).toHaveText(copy('adminLearning.surface.classes'));
    await expect(op.getByRole('main')).toContainText(
      copy('adminLearning.classes.notActivated'),
    );

    await grantScope(op, profileOnly.id);
    await expect(
      op
        .getByRole('alert')
        .filter({ hasText: copy('adminLearning.failure.notATeacher') }),
    ).toBeVisible();
    await grantScope(op, teacherOne.id);
    await expect(
      op.getByRole('status').filter({ hasText: copy('adminLearning.saved') }),
    ).toBeVisible();
    const scopes = op.getByRole('table', {
      name: copy('adminLearning.classes.scopesCurrent'),
    });
    const row = scopes.getByRole('row').filter({ hasText: teacherOne.name });
    await expect(row).toContainText(TEXT.live);
    await expect(row).toContainText(copy('adminLearning.classes.scopeCurrent'));
    await expect(scopes).not.toContainText(profileOnly.name);
    for (const [who, expected] of [
      [teacherOne.id, 1],
      [profileOnly.id, 0],
    ] as const)
      expect(
        await scalar(
          `SELECT COUNT_BIG(*) AS [value] FROM [dbo].[CourseTeachingAssignment] WHERE [userId]=N'${who}' AND [courseId]=N'${ids.live}' AND [endedAt] IS NULL;`,
        ),
      ).toBe(expected);

    // …and no class can be scheduled on it until live learning is on.
    await scheduleClass(op, teacherOne, WHEN.regular, MEET.created);
    await expect(
      op
        .getByRole('alert')
        .filter({ hasText: copy('adminLearning.failure.notActivated') }),
    ).toBeVisible();
    expect(
      await scalar('SELECT COUNT_BIG(*) AS [value] FROM [dbo].[ClassSession];'),
    ).toBe(0);
  });
});

test.describe('Phase 23 — switched on, and who may enter', () => {
  test('switching on (as a fixture) opens the Teacher area to a teacher, with only its delivered sections', async () => {
    expect(
      await scalar('SELECT COUNT_BIG(*) AS [value] FROM [dbo].[LiveLearningActivation];'),
    ).toBe(0);
    await sql.query(
      `INSERT INTO [dbo].[LiveLearningActivation] ([id],[authority],[authorisedBy]) VALUES (1, N'fixture', N'${SENTINEL} browser operator');`,
    );

    const teacher = teacherOne.page;
    const response = await teacher.goto('/en/teacher');
    expect(response?.status()).toBe(200);
    await expect(mainHeading(teacher)).toHaveText(copy('teacher.title'));
    const nav = teacher.getByRole('navigation', { name: copy('teacher.nav.label') });
    const sections = [
      'overview',
      'today',
      'calendar',
      'students',
      'messages',
      'courses',
      'resources',
      'attendance',
      'availability',
      'profile',
    ];
    await expect(nav.getByRole('link')).toHaveText(
      sections.map((key) => copy(`teacher.nav.${key}`)),
    );
    // MESSAGES (Phase 24) is a delivered section: its link goes to a page that
    // renders for an activated teacher. Messaging itself is switched on only by
    // `messaging.spec.ts`, which runs after this file, so the page says so.
    await expect(
      nav.getByRole('link', { name: copy('teacher.nav.messages'), exact: true }),
    ).toHaveAttribute('href', '/en/teacher/messages');
    expect((await teacher.goto('/en/teacher/messages'))?.status()).toBe(200);
    await expect(mainHeading(teacher)).toHaveText(copy('messages.title'));
    await expect(teacher.getByRole('main')).toContainText(
      copy('messages.teacher.notActivated'),
    );

    // The scope prepared while switched off is the one Course this teacher has.
    await teacher.goto('/en/teacher/courses');
    const courses = teacher.getByRole('list', { name: copy('teacher.courses.list') });
    await expect(courses).toContainText(TEXT.live);
    await expect(courses).not.toContainText(TEXT.paced);
  });

  test('a profile alone, a teaching role alone and a catalogue key alone each open nothing more', async () => {
    test.setTimeout(120_000);
    // A published teacher profile with no live `teaching.perform`: no area.
    for (const target of [
      '/en/teacher',
      '/en/teacher/students',
      '/en/teacher/availability',
    ]) {
      const response = await profileOnly.page.goto(target);
      expect(response?.status(), target).toBe(404);
      await expect(
        profileOnly.page.getByRole('navigation', { name: copy('teacher.nav.label') }),
        target,
      ).toHaveCount(0);
    }

    // `teaching.perform` with no scope: the area, and nothing in it.
    const two = teacherTwo.page;
    expect((await two.goto('/en/teacher'))?.status()).toBe(200);
    await expect(mainHeading(two)).toHaveText(copy('teacher.title'));
    await expect(two.getByRole('main')).toContainText(copy('teacher.overview.todayNone'));
    await expect(two.getByRole('main')).toContainText(copy('teacher.overview.nextNone'));
    for (const [target, empty] of [
      ['/en/teacher/courses', copy('teacher.courses.empty')],
      ['/en/teacher/students', copy('teacher.students.empty')],
      ['/en/teacher/resources', copy('teacher.resources.empty')],
      ['/en/teacher/calendar', copy('teacher.calendar.empty')],
    ] as const) {
      await two.goto(target);
      await expect(two.getByRole('main'), target).toContainText(empty);
      await expect(two.getByRole('main'), target).not.toContainText(TEXT.live);
    }

    // `learning.read` alone: the request COUNTS, never who asked; no classes.
    const reader = catalogueReader.page;
    await reader.goto('/en/admin/learning/trials');
    const main = reader.getByRole('main');
    await expect(mainHeading(reader)).toHaveText(copy('adminLearning.surface.trials'));
    await expect(main).toContainText(copy('adminLearning.trials.notScheduled'));
    const requests = await scalar(
      `SELECT COUNT_BIG(*) AS [value] FROM [dbo].[TrialClassRequest] WHERE [courseId]=N'${ids.live}';`,
    );
    await expect(
      reader
        .getByRole('table', { name: copy('adminLearning.surface.trials') })
        .getByRole('row')
        .filter({ hasText: TEXT.live })
        .getByRole('cell'),
    ).toHaveText([TEXT.live, /\S/, String(requests), /\S/]);
    await expect(
      main.getByRole('heading', { name: copy('adminLearning.trials.requestsHeading') }),
    ).toHaveCount(0);
    await expect(main.getByRole('button')).toHaveCount(0);
    const text = await reader.locator('body').innerText();
    for (const secret of ['Browser Proof', student.name, otherEmail, learnerEmail])
      expect(text).not.toContain(secret);
    await expect(
      reader
        .getByRole('navigation', { name: copy('adminLearning.title'), exact: true })
        .getByRole('link', { name: copy('adminLearning.surface.classes') }),
    ).toHaveCount(0);
    for (const target of [
      '/en/admin/learning/classes',
      '/en/admin/learning/classes/scopes',
      '/en/admin/learning/classes/new',
    ])
      await expectRefusedInArea(reader, target);

    // The class keys alone: the area root sends them to classes; the trials
    // page shows who asked, and the catalogue's counts stay the catalogue's.
    const op = operator.page;
    await op.goto('/en/admin/learning');
    await op.waitForURL(/\/en\/admin\/learning\/classes$/);
    await expect(mainHeading(op)).toHaveText(copy('adminLearning.surface.classes'));
    await expect(
      op
        .getByRole('navigation', { name: copy('adminLearning.title'), exact: true })
        .getByRole('link'),
    ).toHaveText([
      copy('adminLearning.surface.trials'),
      copy('adminLearning.surface.classes'),
    ]);
    await expectRefusedInArea(op, '/en/admin/learning/courses');
    await op.goto('/en/admin/learning/trials');
    await expect(mainHeading(op)).toHaveText(copy('adminLearning.surface.trials'));
    await expect(
      op.getByRole('main').getByRole('heading', {
        name: copy('adminLearning.trials.requestsHeading'),
      }),
    ).toBeVisible();
    await expect(op.getByRole('main')).toContainText(
      copy('adminLearning.trials.notBookedUntilConfirmed'),
    );
    await expect(
      op.getByRole('table', { name: copy('adminLearning.surface.trials') }),
    ).toHaveCount(0);
  });
});

test.describe('Phase 23 — a class, from a request to a join link', () => {
  test('a teacher offers two windows from the availability page', async () => {
    const teacher = teacherOne.page;
    for (const [starts, ends] of [WHEN.windowOne, WHEN.windowTwo]) {
      await teacher.goto('/en/teacher/availability');
      await expect(mainHeading(teacher)).toHaveText(copy('teacher.availability.title'));
      await teacher
        .getByLabel(copy('teacher.availability.timeZone'), { exact: true })
        .selectOption('UTC');
      await teacher
        .getByLabel(copy('teacher.availability.starts'), { exact: true })
        .fill(starts);
      await teacher
        .getByLabel(copy('teacher.availability.ends'), { exact: true })
        .fill(ends);
      await teacher
        .getByRole('button', { name: copy('teacher.availability.submit') })
        .click();
      await expect(
        teacher
          .getByRole('status')
          .filter({ hasText: copy('teacher.availability.opened') }),
      ).toBeVisible();
    }
    const windows = teacher.getByRole('list', {
      name: copy('teacher.availability.list'),
    });
    await expect(windows.getByRole('listitem')).toHaveCount(2);
    for (const window of await windows.getByRole('listitem').all())
      await expect(
        window.getByText(copy('teacher.availability.open'), { exact: true }),
      ).toBeVisible();

    const rows = await sql.query<{ startsLocal: string; timeZone: string }>(
      `SELECT [startsLocal],[timeZone] FROM [dbo].[Availability] WHERE [userId]=N'${teacherOne.id}' ORDER BY [startsAt];`,
    );
    expect(rows).toEqual([
      { startsLocal: WHEN.windowOne[0], timeZone: 'UTC' },
      { startsLocal: WHEN.windowTwo[0], timeZone: 'UTC' },
    ]);
  });

  test('a learner requests a trial; the operator confirms it into a window, and only then is it booked', async () => {
    test.setTimeout(120_000);
    const learnerPage = student.page;
    await openWithIsland(learnerPage, PAGE.live);
    const island = islandOn(learnerPage);
    await island.getByRole('button', { name: copy('learningIsland.enrol') }).click();
    await expect(island).toContainText(copy('learningIsland.enrolled'));
    await island
      .getByRole('button', { name: copy('learningIsland.requestTrial') })
      .click();
    await expect(island).toContainText(copy('learningIsland.trialRequested'));
    // A request books nothing by itself.
    expect(
      await scalar(
        `SELECT COUNT_BIG(*) AS [value] FROM [dbo].[Booking] WHERE [userId]=N'${student.id}';`,
      ),
    ).toBe(0);

    const op = operator.page;
    await op.goto('/en/admin/learning/trials');
    await expect(mainHeading(op)).toHaveText(copy('adminLearning.surface.trials'));
    const mine = op
      .getByRole('list', { name: copy('adminLearning.trials.requestsHeading') })
      .getByRole('listitem')
      .filter({ hasText: student.name });
    await expect(mine).toContainText(copy('adminLearning.trials.unbooked'));
    const windowOne = await rowOf<{ id: string }>(
      `SELECT TOP (1) [id] FROM [dbo].[Availability] WHERE [userId]=N'${teacherOne.id}' ORDER BY [startsAt];`,
    );
    await mine
      .getByLabel(copy('adminLearning.trials.window'), { exact: true })
      .selectOption(windowOne?.id ?? '');
    await mine
      .getByRole('button', {
        name: copy('adminLearning.trials.confirm', { title: TEXT.live }),
      })
      .click();
    await expect(mine).toContainText(copy('adminLearning.trials.bookingState.confirmed'));
    trialSessionId = classIdIn(
      new URL(
        (await mine
          .getByRole('link', { name: copy('adminLearning.trials.openClass') })
          .getAttribute('href')) ?? '',
        baseUrl(),
      ).toString(),
    );

    const booking = await rowOf<{
      state: string;
      availabilityId: string;
      sessionId: string;
    }>(
      `SELECT [state],[availabilityId],[sessionId] FROM [dbo].[Booking] WHERE [userId]=N'${student.id}';`,
    );
    expect(booking).toEqual({
      state: 'confirmed',
      availabilityId: windowOne?.id,
      sessionId: trialSessionId,
    });

    // The booked window says so in words and can no longer be withdrawn.
    const teacher = teacherOne.page;
    await teacher.goto('/en/teacher/availability');
    const main = teacher.getByRole('main');
    await expect(
      main.getByText(copy('teacher.availability.booked'), { exact: true }),
    ).toBeVisible();
    await expect(main).toContainText(copy('teacher.availability.cannotWithdraw'));
    await expect(
      main.getByRole('button', { name: copy('teacher.availability.withdraw') }),
    ).toHaveCount(1);
  });

  test('the operator schedules a regular class with a Google Meet link', async () => {
    const op = operator.page;
    await scheduleClass(op, teacherOne, WHEN.regular, MEET.created);
    await op.waitForURL(/\/en\/admin\/learning\/classes\/[0-9a-fA-F-]{36}$/);
    regularSessionId = classIdIn(op.url());
    await expect(mainHeading(op)).toHaveText(TEXT.live);
    const main = op.getByRole('main');
    await expect(main).toContainText(copy('adminLearning.classes.kindName.course'));
    await expect(main).toContainText(copy('adminLearning.classes.stateName.scheduled'));
    await expect(main.locator('dl').first()).toContainText(teacherOne.name);
    // The operator's one disclosure: a described link, never the address as text.
    await expect(
      main.getByRole('link', { name: copy('adminLearning.classes.meetingOpen') }),
    ).toHaveAttribute('href', MEET.created);
    expect(await main.innerText()).not.toContain('xyz-wvut-srq');
    const participants = op.getByRole('table', {
      name: copy('adminLearning.classes.participants'),
      exact: true,
    });
    await expect(
      participants.getByRole('row').filter({ hasText: student.name }),
    ).toContainText(copy('adminLearning.classes.participationName.enrolment'));

    // The confirmed trial is a class of its own, with its one participant.
    await op.goto(`/en/admin/learning/classes/${trialSessionId}`);
    await expect(mainHeading(op)).toHaveText(TEXT.live);
    await expect(op.getByRole('main')).toContainText(
      copy('adminLearning.classes.kindName.trial'),
    );
    await expect(op.getByRole('main')).toContainText(
      copy('adminLearning.classes.meetingNone'),
    );
    const trialParticipants = op.getByRole('table', {
      name: copy('adminLearning.classes.participants'),
      exact: true,
    });
    await expect(trialParticipants.getByRole('row')).toHaveCount(2);
    await expect(
      trialParticipants.getByRole('row').filter({ hasText: student.name }),
    ).toContainText(copy('adminLearning.classes.participationName.booking'));
  });

  test('the teacher sets and replaces meeting links, and a lookalike address is refused', async () => {
    const teacher = teacherOne.page;
    const main = teacher.getByRole('main');
    const address = teacher.getByLabel(copy('teacher.meeting.url'), { exact: true });

    await teacher.goto(`/en/teacher/classes/today/${trialSessionId}`);
    await expect(mainHeading(teacher)).toHaveText(TEXT.live);
    await expect(main).toContainText(copy('teacher.kind.trial'));
    await expect(main).toContainText(copy('teacher.meeting.none'));
    await address.fill(MEET.trial);
    await teacher.getByRole('button', { name: copy('teacher.meeting.set') }).click();
    await expect(
      teacher.getByRole('status').filter({ hasText: copy('teacher.meeting.saved') }),
    ).toBeVisible();
    await expect(main.locator(`a[href="${MEET.trial}"]`)).toHaveAccessibleName(
      copy('teacher.meeting.join'),
    );

    await teacher.goto(`/en/teacher/classes/today/${regularSessionId}`);
    await expect(mainHeading(teacher)).toHaveText(TEXT.live);
    await expect(main.locator(`a[href="${MEET.created}"]`)).toHaveCount(1);
    // A lookalike host is refused, visibly, and changes nothing.
    await address.fill(MEET.invalid);
    await teacher.getByRole('button', { name: copy('teacher.meeting.replace') }).click();
    await expect(
      teacher
        .getByRole('alert')
        .filter({ hasText: copy('teacher.failure.invalidMeeting') }),
    ).toBeVisible();
    const meetingOf = async (id: string) =>
      (
        await rowOf<{ meetingUrl: string | null }>(
          `SELECT [meetingUrl] FROM [dbo].[ClassSession] WHERE [id]=N'${id}';`,
        )
      )?.meetingUrl;
    expect(await meetingOf(regularSessionId)).toBe(MEET.created);

    await address.fill(MEET.join);
    await teacher.getByRole('button', { name: copy('teacher.meeting.replace') }).click();
    await expect(
      teacher.getByRole('status').filter({ hasText: copy('teacher.meeting.saved') }),
    ).toBeVisible();
    const join = main.locator(`a[href="${MEET.join}"]`);
    await expect(join).toHaveAccessibleName(copy('teacher.meeting.join'));
    await expect(join).toHaveAttribute('target', '_blank');
    await expect(main.locator(`a[href="${MEET.created}"]`)).toHaveCount(0);
    expect(await meetingOf(regularSessionId)).toBe(MEET.join);
    expect(await meetingOf(trialSessionId)).toBe(MEET.trial);
    // An href, never text: the address is not written out or echoed back.
    expect(await main.innerText()).not.toContain('abc-defg-hij');
    await expect(address).toHaveValue('');
  });

  test('the learner finds both classes, and each join link, on their own pages', async () => {
    const page = student.page;
    const response = await page.goto('/en/my/classes');
    expect(response?.status()).toBe(200);
    await expect(mainHeading(page)).toHaveText(copy('myClasses.title'));
    await expect(page.getByRole('main')).not.toContainText(
      copy('myClasses.notActivated'),
    );
    const upcoming = page.getByRole('list', { name: copy('myClasses.upcoming.heading') });
    await expect(upcoming.getByRole('listitem')).toHaveCount(2);
    const trial = upcoming
      .getByRole('listitem')
      .filter({ hasText: copy('myClasses.participation.booking') });
    const regular = upcoming
      .getByRole('listitem')
      .filter({ hasText: copy('myClasses.participation.enrolment') });
    await expect(trial.locator(`a[href="${MEET.trial}"]`)).toHaveAccessibleName(
      copy('myClasses.join'),
    );
    await expect(regular.locator(`a[href="${MEET.join}"]`)).toHaveAccessibleName(
      copy('myClasses.join'),
    );
    for (const item of [trial, regular])
      await expect(
        item.getByText(copy('myClasses.state.scheduled'), { exact: true }),
      ).toBeVisible();
    await expect(
      regular.getByRole('button', { name: copy('myClasses.cancel.submit') }),
    ).toHaveCount(0);

    await page.goto(`/en/my/classes/${regularSessionId}`);
    await expect(mainHeading(page)).toHaveText(TEXT.live);
    const join = page
      .getByRole('main')
      .getByRole('link', { name: copy('myClasses.join') });
    await expect(join).toHaveCount(1);
    await expect(join).toHaveAttribute('href', MEET.join);
    await expect(join).toHaveAttribute('target', '_blank');
    await expect(join).toHaveAttribute('rel', /noopener/);
    await expect(
      page.getByRole('button', { name: copy('myClasses.cancel.submit') }),
    ).toHaveCount(0);

    // My Learning says the request is confirmed, links the class, and no
    // longer offers to withdraw a request a Booking now rests on.
    await page.goto('/en/my/learning');
    const request = page
      .getByRole('list', { name: copy('myLearning.trials.heading') })
      .getByRole('listitem')
      .filter({ hasText: TEXT.live });
    await expect(request).toContainText(copy('myLearning.trials.bookedConfirmed'));
    await expect(
      request.getByRole('link', { name: copy('myLearning.trials.openClass') }),
    ).toHaveAttribute('href', `/en/my/classes/${trialSessionId}`);
    await expect(request.getByRole('button')).toHaveCount(0);
  });
});

test.describe('Phase 23 — nobody else reaches a class', () => {
  test('another learner and an unscoped teacher are refused every address', async () => {
    test.setTimeout(120_000);
    const page = bystander.page;
    await page.goto('/en/my/classes');
    const main = page.getByRole('main');
    await expect(main).toContainText(copy('myClasses.upcoming.empty'));
    await expect(main).toContainText(copy('myClasses.past.empty'));
    await expect(page.locator('a[href*="meet.google.com"]')).toHaveCount(0);
    const secrets = [MEET.join, MEET.trial, MEET.created, student.name];
    for (const id of [trialSessionId, regularSessionId]) {
      const response = await page.goto(`/en/my/classes/${id}`);
      expect(response?.status(), id).toBe(404);
      const html = await page.content();
      for (const secret of secrets) expect(html, id).not.toContain(secret);
    }

    // A teacher with no scope on the Course reaches none of its records.
    const two = teacherTwo.page;
    for (const target of [
      `/en/teacher/classes/today/${regularSessionId}`,
      `/en/teacher/classes/today/${trialSessionId}`,
      `/en/teacher/attendance/${regularSessionId}`,
      `/en/teacher/students/${student.id}`,
      `/en/teacher/courses/${ids.live}`,
      `/en/teacher/courses/${ids.live}/students`,
    ]) {
      const response = await two.goto(target);
      expect(response?.status(), target).toBe(404);
      const html = await two.content();
      for (const secret of secrets) expect(html, target).not.toContain(secret);
    }
    await two.goto('/en/teacher/students');
    await expect(two.getByRole('main')).toContainText(copy('teacher.students.empty'));
    await expect(two.getByRole('main')).not.toContainText(student.name);
  });

  test('no public page carries a meeting address or a participant, and the schedule is one document for everybody', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    for (const target of [
      '/en/learn/live',
      '/en/learn/teachers',
      PAGE.live,
      '/en/learn',
      '/en/learn/trial',
      `/en/people/${teacherOne.slug}`,
    ]) {
      const response = await request.get(target);
      expect(response.status(), target).toBe(200);
      const html = await response.text();
      expect(html, target).not.toContain('meet.google.com');
      for (const secret of [
        student.name,
        student.id,
        bystander.name,
        teacherOne.name,
        teacherOne.id,
      ])
        expect(html, target).not.toContain(secret);
    }

    // The schedule: the test banner first, then the Course and the teacher's
    // PUBLIC name — the trial and the regular class, and no participant.
    const response = await page.goto('/en/learn/live');
    expect(response?.headers()['set-cookie']).toBeUndefined();
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute(
      'content',
      /noindex/,
    );
    await expect(page.getByRole('note')).toHaveText(copy('learnLive.fixture'));
    const schedule = page.getByRole('list', { name: copy('learnLive.listLabel') });
    await expect(schedule.getByRole('listitem')).toHaveCount(2);
    for (const item of await schedule.getByRole('listitem').all()) {
      await expect(
        item.getByRole('link', { name: TEXT.live, exact: true }),
      ).toHaveAttribute('href', PAGE.live);
      await expect(
        item.getByRole('link', { name: teacherOne.publicName, exact: true }),
      ).toHaveAttribute('href', `/en/people/${teacherOne.slug}`);
    }

    for (const target of ['/en/learn/live', '/en/learn/teachers'])
      for (const visitor of [student, teacherOne]) {
        const { anonymous, signedIn } = await asTwoVisitors(
          request,
          visitor.page.context().request,
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
        expect(signedInHtml, target).not.toContain(visitor.id);
      }
  });
});

test.describe('Phase 23 — Find a teacher', () => {
  test('lists the operational teacher only, narrows by every filter, and explains an unknown one', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const listing = () =>
      page.getByRole('list', { name: copy('learnTeachers.title'), exact: true });
    const listed = async (query: string): Promise<void> => {
      const response = await page.goto(`/en/learn/teachers${query}`);
      expect(response?.status(), query).toBe(200);
      await expect(listing().getByRole('heading', { level: 2 }), query).toHaveText([
        teacherOne.publicName,
      ]);
    };

    await listed('');
    await expect(page.getByRole('note')).toHaveText(copy('learnTeachers.fixture'));
    const card = listing()
      .getByRole('listitem')
      .filter({ hasText: teacherOne.publicName });
    await expect(
      card.getByRole('link', { name: teacherOne.publicName, exact: true }),
    ).toHaveAttribute('href', `/en/people/${teacherOne.slug}`);
    await expect(
      card.getByRole('link', { name: TEXT.live, exact: true }),
    ).toHaveAttribute('href', PAGE.live);
    // An open window remains, so the teacher has open times — a fact, not a time.
    await expect(card).toContainText(copy('learnTeachers.available'));
    // Not listed: a teacher with no scope, a profile with no role, and the
    // Course's public attribution, which is not operational status.
    const main = page.getByRole('main');
    for (const absent of [teacherTwo.publicName, profileOnly.publicName])
      await expect(main).not.toContainText(absent);
    await expect(main.locator(`a[href="/en/people/${people.linkedSlug}"]`)).toHaveCount(
      0,
    );

    // Each filter keeps the teacher while it is true of them.
    for (const query of ['?availability=available', '?subject=hadith', '?language=ur'])
      await listed(query);

    // A REAL GET FORM: the labelled choice submits a shareable address.
    await page.goto('/en/learn/teachers');
    await page
      .getByLabel(copy('learnTeachers.filter.availability'), { exact: true })
      .selectOption('available');
    await page.getByRole('button', { name: copy('learn.filter.apply') }).click();
    await expect(page).toHaveURL(
      /\/en\/learn\/teachers\?(.*&)?availability=available(&|$)/,
    );
    await expect(listing().getByRole('heading', { level: 2 })).toHaveText([
      teacherOne.publicName,
    ]);

    // A real subject nobody teaches live is an explained empty result…
    await page.goto('/en/learn/teachers?subject=quran');
    await expect(main).toContainText(copy('learnTeachers.filter.empty'));
    await expect(listing()).toHaveCount(0);

    // …and an unknown value lists NOTHING and says why — it never broadens.
    for (const query of [
      '?availability=bogus',
      '?subject=no-such-topic',
      `?subject=no-such-topic-${run}`,
      '?subject=hadith&availability=bogus',
    ]) {
      await page.goto(`/en/learn/teachers${query}`);
      await expect(main, query).toContainText(copy('learnTeachers.filter.invalid'));
      await expect(listing(), query).toHaveCount(0);
      await expect(main, query).not.toContainText(teacherOne.publicName);
      await expect(
        main.getByRole('link', { name: copy('learn.filter.clear') }).first(),
        query,
      ).toHaveAttribute('href', '/en/learn/teachers');
    }
  });

  test('a teacher address under Learn is ONE 301 to the contributor profile', async ({
    request,
  }) => {
    for (const locale of ['en', 'ur'] as const) {
      const from = `/${locale}/learn/teachers/${teacherOne.slug}`;
      const response = await request.get(from, { maxRedirects: 0 });
      expect(response.status(), from).toBe(301);
      const location = new URL(response.headers()['location'] ?? '', baseUrl());
      expect(location.pathname, from).toBe(`/${locale}/people/${teacherOne.slug}`);
      const landing = await request.get(location.pathname, { maxRedirects: 0 });
      expect(landing.status(), from).toBe(200);
    }
    const unknown = await request.get(
      `/en/learn/teachers/non-learning-fixture-nobody-${run}`,
      { maxRedirects: 0 },
    );
    expect(unknown.status()).toBe(404);
  });
});

test.describe('Phase 23 — a class’s life', () => {
  test('the teacher moves a class, and a page that saw the old version is refused', async () => {
    const teacher = teacherOne.page;
    const target = `/en/teacher/classes/today/${regularSessionId}`;
    await teacher.goto(target);
    await expect(mainHeading(teacher)).toHaveText(TEXT.live);
    const stale = await teacher.context().newPage();
    await stale.goto(target);
    await expect(mainHeading(stale)).toHaveText(TEXT.live);

    const move = async (page: Page, [starts, ends]: readonly [string, string]) => {
      await page
        .getByLabel(copy('teacher.reschedule.timeZone'), { exact: true })
        .selectOption('UTC');
      await page
        .getByLabel(copy('teacher.reschedule.starts'), { exact: true })
        .fill(starts);
      await page.getByLabel(copy('teacher.reschedule.ends'), { exact: true }).fill(ends);
      await page.getByRole('button', { name: copy('teacher.reschedule.submit') }).click();
    };
    await move(teacher, WHEN.moved);
    await expect(
      teacher.getByRole('status').filter({ hasText: copy('teacher.reschedule.moved') }),
    ).toBeVisible();

    await move(stale, WHEN.stale);
    await expect(
      stale.getByRole('alert').filter({ hasText: copy('teacher.failure.conflict') }),
    ).toBeVisible();
    await stale.close();

    const moved = await rowOf<{ startsLocal: string; endsLocal: string; state: string }>(
      `SELECT [startsLocal],[endsLocal],[state] FROM [dbo].[ClassSession] WHERE [id]=N'${regularSessionId}';`,
    );
    expect(moved).toEqual({
      startsLocal: WHEN.moved[0],
      endsLocal: WHEN.moved[1],
      state: 'scheduled',
    });
  });

  test('the teacher marks the learner present, then absent — one mark, the latest', async () => {
    const teacher = teacherOne.page;
    await teacher.goto(`/en/teacher/classes/today/${regularSessionId}`);
    await expect(mainHeading(teacher)).toHaveText(TEXT.live);
    const row = teacher.getByRole('row').filter({ hasText: student.name });
    const word = (key: string) =>
      row.getByText(copy(`teacher.attendance.${key}`), { exact: true });
    await expect(word('unmarked')).toBeVisible();

    await row
      .getByRole('button', {
        name: copy('teacher.session.markPresent', { name: student.name }),
      })
      .click();
    await expect(word('present')).toBeVisible();
    await row
      .getByRole('button', {
        name: copy('teacher.session.markAbsent', { name: student.name }),
      })
      .click();
    await expect(word('absent')).toBeVisible();
    await expect(word('present')).toHaveCount(0);

    const marks = await sql.query<{ status: string }>(
      `SELECT [status] FROM [dbo].[Attendance] WHERE [sessionId]=N'${regularSessionId}' AND [userId]=N'${student.id}';`,
    );
    expect(marks).toEqual([{ status: 'absent' }]);
  });

  test('the learner cancels their trial from My Classes under reduced motion, and its join link goes', async () => {
    const page = student.page;
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/en/my/classes');
    await expect(mainHeading(page)).toHaveText(copy('myClasses.title'));
    expect(
      await page.evaluate(
        () =>
          document
            .getAnimations()
            .filter((animation) => animation.playState === 'running').length,
      ),
    ).toBe(0);
    const trial = page
      .getByRole('list', { name: copy('myClasses.upcoming.heading') })
      .getByRole('listitem')
      .filter({ hasText: copy('myClasses.participation.booking') });
    await trial.getByLabel(copy('myClasses.cancel.confirm')).check();
    await trial.getByRole('button', { name: copy('myClasses.cancel.submit') }).click();

    const past = page.getByRole('list', { name: copy('myClasses.past.heading') });
    await expect(
      past
        .getByRole('listitem')
        .filter({ hasText: copy('myClasses.participation.booking') })
        .getByText(copy('myClasses.state.cancelled'), { exact: true }),
    ).toBeVisible();
    await expect(page.locator(`a[href="${MEET.trial}"]`)).toHaveCount(0);

    const response = await page.goto(`/en/my/classes/${trialSessionId}`);
    expect(response?.status()).toBe(200);
    const main = page.getByRole('main');
    await expect(
      main.getByText(copy('myClasses.state.cancelled'), { exact: true }),
    ).toBeVisible();
    await expect(main.locator('a[href*="meet.google.com"]')).toHaveCount(0);
    await expect(
      main.getByRole('heading', { name: copy('myClasses.detail.joining') }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: copy('myClasses.cancel.submit') }),
    ).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    expect(
      await rowOf(
        `SELECT b.[state] AS [booking], cs.[state] AS [session], cs.[meetingUrl] FROM [dbo].[Booking] b JOIN [dbo].[ClassSession] cs ON cs.[id]=b.[sessionId] WHERE b.[userId]=N'${student.id}';`,
      ),
    ).toEqual({ booking: 'cancelled', session: 'cancelled', meetingUrl: null });

    // The request is still recorded, and says what became of it.
    await page.goto('/en/my/learning');
    await expect(
      page
        .getByRole('list', { name: copy('myLearning.trials.heading') })
        .getByRole('listitem')
        .filter({ hasText: TEXT.live }),
    ).toContainText(copy('myLearning.trials.bookedCancelled'));

    // The teacher's page shows a closed class: no link, no changes.
    const teacher = teacherOne.page;
    await teacher.goto(`/en/teacher/classes/today/${trialSessionId}`);
    const closed = teacher.getByRole('main');
    await expect(
      closed.getByText(copy('teacher.state.cancelled'), { exact: true }),
    ).toBeVisible();
    await expect(closed).toContainText(copy('teacher.meeting.notScheduled'));
    await expect(closed.locator('a[href*="meet.google.com"]')).toHaveCount(0);
    await expect(closed.locator('form')).toHaveCount(0);
  });

  test('a completed class offers no join link to its teacher or its learner', async () => {
    test.setTimeout(120_000);
    // A later class first, on the same scope, for the teacher replacement below.
    const op = operator.page;
    await scheduleClass(op, teacherOne, WHEN.later, '');
    await op.waitForURL(/\/en\/admin\/learning\/classes\/[0-9a-fA-F-]{36}$/);
    laterSessionId = classIdIn(op.url());
    await expect(mainHeading(op)).toHaveText(TEXT.live);
    await expect(op.getByRole('main')).toContainText(
      copy('adminLearning.classes.meetingNone'),
    );

    const teacher = teacherOne.page;
    await teacher.goto(`/en/teacher/classes/today/${regularSessionId}`);
    await expect(mainHeading(teacher)).toHaveText(TEXT.live);
    await teacher.getByRole('button', { name: copy('teacher.complete.submit') }).click();
    const main = teacher.getByRole('main');
    await expect(main).toContainText(
      copy('teacher.session.closed', { state: copy('teacher.state.completed') }),
    );
    await expect(main.locator('a[href*="meet.google.com"]')).toHaveCount(0);
    // A held class still shows its mark.
    await expect(
      teacher
        .getByRole('row')
        .filter({ hasText: student.name })
        .getByText(copy('teacher.attendance.absent'), { exact: true }),
    ).toBeVisible();
    expect(
      await rowOf(
        `SELECT [state],[meetingUrl] FROM [dbo].[ClassSession] WHERE [id]=N'${regularSessionId}';`,
      ),
    ).toEqual({ state: 'completed', meetingUrl: null });

    const page = student.page;
    await page.goto(`/en/my/classes/${regularSessionId}`);
    const mine = page.getByRole('main');
    await expect(
      mine.getByText(copy('myClasses.state.completed'), { exact: true }),
    ).toBeVisible();
    await expect(
      mine.getByText(copy('myClasses.attendance.absent'), { exact: true }),
    ).toBeVisible();
    await expect(mine.locator('a[href*="meet.google.com"]')).toHaveCount(0);
    await page.goto('/en/my/classes');
    await expect(page.locator('a[href*="meet.google.com"]')).toHaveCount(0);
    // The later class is upcoming, with no link until its teacher adds one.
    await expect(
      page
        .getByRole('list', { name: copy('myClasses.upcoming.heading') })
        .getByRole('listitem'),
    ).toHaveCount(1);
  });

  test('revoking the teaching role closes the area on the next request; another scoped teacher takes the class', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await sql.query(
      `UPDATE [dbo].[RoleAssignment] SET [revokedAt]=SYSUTCDATETIME() WHERE [userId]=N'${teacherOne.id}' AND [revokedAt] IS NULL;`,
    );
    for (const target of ['/en/teacher', `/en/teacher/classes/today/${laterSessionId}`]) {
      const response = await teacherOne.page.goto(target);
      expect(response?.status(), target).toBe(404);
      await expect(
        teacherOne.page.getByRole('navigation', { name: copy('teacher.nav.label') }),
        target,
      ).toHaveCount(0);
    }
    // Find a Teacher drops them at once: they are no longer operational.
    await page.goto('/en/learn/teachers');
    await expect(page.getByRole('main')).toContainText(copy('learnTeachers.empty'));
    await expect(page.getByRole('main')).not.toContainText(teacherOne.publicName);

    const op = operator.page;
    await grantScope(op, teacherTwo.id);
    await expect(
      op.getByRole('status').filter({ hasText: copy('adminLearning.saved') }),
    ).toBeVisible();
    await op.goto(`/en/admin/learning/classes/${laterSessionId}`);
    await expect(mainHeading(op)).toHaveText(TEXT.live);
    await op
      .locator('#replacement-scope')
      .selectOption({ label: `${TEXT.live} — ${teacherTwo.name}` });
    await op
      .getByRole('button', { name: copy('adminLearning.classes.replaceTeacherSubmit') })
      .click();
    await expect(op.getByRole('main').locator('dl').first()).toContainText(
      teacherTwo.name,
    );
    expect(
      await rowOf(
        `SELECT s.[userId] FROM [dbo].[ClassSession] cs JOIN [dbo].[CourseTeachingAssignment] s ON s.[id]=cs.[scopeId] WHERE cs.[id]=N'${laterSessionId}';`,
      ),
    ).toEqual({ userId: teacherTwo.id });

    const two = teacherTwo.page;
    const response = await two.goto(`/en/teacher/classes/today/${laterSessionId}`);
    expect(response?.status()).toBe(200);
    await expect(mainHeading(two)).toHaveText(TEXT.live);
    await two.goto('/en/teacher/calendar');
    await expect(two.getByRole('main')).toContainText(TEXT.live);
  });
});

test.describe('Phase 23 — every locale, every width, the keyboard', () => {
  test('the new surfaces are right-to-left in Urdu and Arabic', async ({ page }) => {
    test.setTimeout(180_000);
    for (const locale of ['ur', 'ar'] as const)
      for (const [viewer, target] of [
        [page, `/${locale}/learn/live`],
        [page, `/${locale}/learn/teachers`],
        [student.page, `/${locale}/my/classes`],
        [teacherTwo.page, `/${locale}/teacher`],
        [teacherTwo.page, `/${locale}/teacher/availability`],
        [operator.page, `/${locale}/admin/learning/classes`],
      ] as const) {
        const response = await viewer.goto(target);
        expect(response?.status(), target).toBe(200);
        await expect(mainHeading(viewer), target).toBeVisible();
        await expect(viewer.locator('html'), target).toHaveAttribute('dir', 'rtl');
        await expect(viewer.locator('html'), target).toHaveAttribute('lang', locale);
      }
  });

  test('they reflow at 320px and at 200% zoom, with headings in order', async () => {
    test.setTimeout(300_000);
    const viewers = [student.page, teacherTwo.page, operator.page];
    // 640 CSS pixels is a 1280-pixel window at 200% zoom.
    for (const width of [320, 640]) {
      for (const viewer of viewers) await viewer.setViewportSize({ width, height: 800 });
      for (const locale of ['en', 'ar'] as const)
        for (const [viewer, target] of [
          [student.page, `/${locale}/my/classes`],
          [student.page, `/${locale}/my/classes/${regularSessionId}`],
          [teacherTwo.page, `/${locale}/teacher`],
          [teacherTwo.page, `/${locale}/teacher/classes/today/${laterSessionId}`],
          [teacherTwo.page, `/${locale}/teacher/availability`],
          [operator.page, `/${locale}/admin/learning/classes/${laterSessionId}`],
        ] as const) {
          const response = await viewer.goto(target);
          expect(response?.status(), target).toBe(200);
          await expect(mainHeading(viewer), target).toBeVisible();
          expect(
            await overflowOf(viewer),
            `${String(width)}px ${target}`,
          ).toBeLessThanOrEqual(0);
          await expectHeadingsInOrder(viewer, `${String(width)}px ${target}`);
        }
    }
    for (const viewer of viewers)
      await viewer.setViewportSize({ width: 1280, height: 800 });
  });

  test('a class page’s meeting form and marks are labelled and reached by keyboard, and every status is a word', async () => {
    test.setTimeout(120_000);
    const teacher = teacherTwo.page;
    await teacher.goto(`/en/teacher/classes/today/${laterSessionId}`);
    await expect(mainHeading(teacher)).toHaveText(TEXT.live);
    await expectLabelledControls(teacher, 'the teacher’s class page');

    const address = teacher.getByLabel(copy('teacher.meeting.url'), { exact: true });
    await tabTo(teacher, address);
    await expectVisibleFocus(address, 'the meeting address');
    const present = teacher.getByRole('button', {
      name: copy('teacher.session.markPresent', { name: student.name }),
    });
    await tabTo(teacher, present);
    await expectVisibleFocus(present, 'Mark present');

    // States in words, not colour: the class and each participant's mark.
    const main = teacher.getByRole('main');
    await expect(
      main.getByText(copy('teacher.state.scheduled'), { exact: true }),
    ).toBeVisible();
    await expect(
      teacher
        .getByRole('row')
        .filter({ hasText: student.name })
        .getByText(copy('teacher.attendance.unmarked'), { exact: true }),
    ).toBeVisible();

    // The learner's own history says cancelled, completed and absent in words.
    await student.page.goto('/en/my/classes');
    const past = student.page.getByRole('list', { name: copy('myClasses.past.heading') });
    for (const key of ['state.cancelled', 'state.completed', 'attendance.absent'])
      await expect(
        past.getByText(copy(`myClasses.${key}`), { exact: true }),
        key,
      ).toBeVisible();
    const upcoming = student.page.getByRole('list', {
      name: copy('myClasses.upcoming.heading'),
    });
    await expect(
      upcoming.getByText(copy('myClasses.state.scheduled'), { exact: true }),
    ).toBeVisible();
  });
});
