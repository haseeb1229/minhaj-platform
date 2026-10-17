import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Locator, Page } from '@playwright/test';

import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import { expect } from './support';

/**
 * What the Messaging browser proofs share — Phase 24's `messaging.spec.ts`
 * and Phase 25's `realtime.spec.ts` read the same pages, so they read them
 * the same way: the copy from the catalogues the pages render, the composer
 * and a message by their accessible names, the structural checks every
 * surface must pass, and the one shape of teaching relationship a
 * conversation exists on.
 *
 * NOTHING HERE WRITES A MESSAGING FACT. The relationship below is Learning's
 * and Identity's, written as their owners' fixtures; every conversation and
 * message stays the pages' to create.
 */

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

export type UiLocale = 'en' | 'ur' | 'ar';

const CATALOGUE: Readonly<Record<UiLocale, unknown>> = {
  en: JSON.parse(readFileSync(path.join(MESSAGES, 'en.json'), 'utf8')),
  ur: JSON.parse(readFileSync(path.join(MESSAGES, 'ur.json'), 'utf8')),
  ar: JSON.parse(readFileSync(path.join(MESSAGES, 'ar.json'), 'utf8')),
};

/** One message by its dotted key, with `{name}` placeholders filled. */
export function copy(
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

/** An English `{count, plural, one {…} other {…}}` message, for one count. */
export function plural(key: string, count: number): string {
  const match = /one \{([^}]*)\} other \{([^}]*)\}/u.exec(copy(key));
  if (match === null) throw new Error(`No plural forms in ${key}`);
  return (count === 1 ? (match[1] ?? '') : (match[2] ?? '')).replaceAll(
    '#',
    String(count),
  );
}

/* ===========================================================================
 * Page helpers
 * ========================================================================= */

/** Moves focus by Tab alone until it lands on `target`. */
export async function tabTo(page: Page, target: Locator): Promise<void> {
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
export async function expectVisibleFocus(target: Locator, where: string): Promise<void> {
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
export function overflowOf(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/** Exactly one `h1`, first, and no level skipped on the way down. */
export async function expectHeadingsInOrder(page: Page, where: string): Promise<void> {
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
export async function expectLabelledControls(page: Page, where: string): Promise<void> {
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

/** The page's own first-level heading, once a streamed page has settled. */
export function mainHeading(page: Page): Locator {
  return page.getByRole('main').getByRole('heading', { level: 1 }).first();
}

/** The composer's message box. */
export function composerBox(page: Page): Locator {
  return page
    .getByRole('main')
    .getByRole('textbox', { name: copy('messages.composer.label'), exact: true });
}

/** The composer's submit button. */
export function sendButton(page: Page): Locator {
  return page
    .getByRole('main')
    .getByRole('button', { name: copy('messages.composer.submit'), exact: true });
}

/** One message in a thread, by who sent it and something it says. */
export function messageFrom(page: Page, sender: string, text: string): Locator {
  return page
    .getByRole('main')
    .getByRole('article', { name: copy('messages.thread.messageFrom', { name: sender }) })
    .filter({ hasText: text });
}

/** Writes and sends one message through the composer, and waits for the page to say so. */
export async function send(page: Page, body: string): Promise<void> {
  await composerBox(page).fill(body);
  await sendButton(page).click();
  await expect(page.getByRole('main')).toContainText(copy('messages.composer.sent'));
}

/* ===========================================================================
 * The relationship a conversation exists on
 * ========================================================================= */

export interface TeachingFixture {
  readonly learnerId: string;
  readonly teacherId: string;
  /** Neutral, spec-owned identifiers and words no other spec looks for. */
  readonly ids: {
    readonly course: string;
    readonly module: string;
    readonly lesson: string;
    readonly scope: string;
    readonly session: string;
  };
  readonly slug: string;
  readonly course: string;
  readonly module: string;
  readonly lesson: string;
  readonly operator: string;
}

/**
 * Learning's facts, written as its owner's fixtures: one published live Course
 * with a whole syllabus, the learner's enrolment on it, and the teacher's
 * current scope on it under their live `teaching.perform` assignment — the
 * exact shape the teaching relationship is read from — and one scheduled
 * class of that Course, because My Teachers lists the teachers of a person's
 * classes. Live learning is switched on only if nothing has switched it on.
 */
export async function seedTeaching(
  sql: SqlSession,
  fixture: TeachingFixture,
): Promise<void> {
  const { ids } = fixture;
  const n = (value: string) => `N'${value.replaceAll("'", "''")}'`;
  const [assignment] = await sql.query<{ id: string }>(`
    SELECT TOP (1) ra.[id] AS [id] FROM [dbo].[RoleAssignment] ra
      JOIN [dbo].[RolePermission] rp ON rp.[roleId]=ra.[roleId] AND rp.[permissionKey]=N'teaching.perform'
      WHERE ra.[userId]=N'${fixture.teacherId}' AND ra.[revokedAt] IS NULL;`);
  if (assignment === undefined) throw new Error('The teacher holds no teaching role.');
  // A scheduled class of the Course, ten days out, in UTC wall-clock time.
  const day = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  const [starts, ends] = [`${day}T10:00`, `${day}T11:00`];

  await sql.query(`
    INSERT INTO [dbo].[Course] ([id],[slug],[primaryLocale],[state],[level],[format],[languageCode],[publishedAt],[version],[updatedAt]) VALUES
      (N'${ids.course}', ${n(fixture.slug)}, N'en', N'draft', N'beginner', N'live', N'en', NULL, 1, SYSUTCDATETIME());
    INSERT INTO [dbo].[CourseLabel] ([courseId],[locale],[title],[summary],[description]) VALUES
      (N'${ids.course}', N'en', ${n(fixture.course)}, N'', N'');
    INSERT INTO [dbo].[CourseModule] ([id],[courseId],[position]) VALUES
      (N'${ids.module}', N'${ids.course}', 0);
    INSERT INTO [dbo].[CourseModuleLabel] ([moduleId],[locale],[title],[summary]) VALUES
      (N'${ids.module}', N'en', ${n(fixture.module)}, N'');
    INSERT INTO [dbo].[Lesson] ([id],[courseId],[moduleId],[position]) VALUES
      (N'${ids.lesson}', N'${ids.course}', N'${ids.module}', 0);
    INSERT INTO [dbo].[LessonLabel] ([lessonId],[locale],[title],[summary],[body]) VALUES
      (N'${ids.lesson}', N'en', ${n(fixture.lesson)}, N'', ${n(`${fixture.lesson} body`)});
    UPDATE [dbo].[Course] SET [state]=N'published', [publishedAt]=SYSUTCDATETIME(), [version]=2, [updatedAt]=SYSUTCDATETIME()
      WHERE [id]=N'${ids.course}';
    INSERT INTO [dbo].[Enrolment] ([userId],[courseId],[enrolledAt]) VALUES
      (N'${fixture.learnerId}', N'${ids.course}', SYSUTCDATETIME());
    INSERT INTO [dbo].[CourseTeachingAssignment] ([id],[courseId],[userId],[roleAssignmentId],[grantedAt]) VALUES
      (N'${ids.scope}', N'${ids.course}', N'${fixture.teacherId}', N'${assignment.id}', SYSUTCDATETIME());
    IF NOT EXISTS (SELECT 1 FROM [dbo].[LiveLearningActivation])
      INSERT INTO [dbo].[LiveLearningActivation] ([id],[authority],[authorisedBy]) VALUES (1, N'fixture', ${n(fixture.operator)});
    INSERT INTO [dbo].[ClassSession] ([id],[courseId],[kind],[scopeId],[startsAt],[endsAt],[timeZone],[startsLocal],[endsLocal],[state]) VALUES
      (N'${ids.session}', N'${ids.course}', N'course', N'${ids.scope}', '${starts}:00', '${ends}:00', N'UTC', N'${starts}', N'${ends}', N'scheduled');
  `);
}
