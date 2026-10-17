import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Browser, BrowserContext, Locator, Page, Request } from '@playwright/test';

import { PLATFORM_ADMINISTRATOR_PERMISSIONS } from '../../packages/contracts/src/identity/permissions.ts';
import { syntheticPng } from '../../packages/database/src/lifecycle/phase12-fixture.ts';
import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import {
  accountIdFor,
  baseUrl,
  expect,
  grantRole,
  privilegedSession,
  registerAndSignIn,
  test,
} from './support';

/**
 * Phase 24 — Messaging in a real browser, against the production build.
 *
 * WHAT ONLY A BROWSER CAN PROVE: that a signed-out visitor is sent to sign in
 * and every Messaging handler and byte route refuses them; that the pages say
 * plainly when Messaging is not switched on; that a learner opens a
 * conversation with their CURRENT teacher from My Teachers, writes to them,
 * and a replayed submission of the same rendered form stores one message, not
 * two; that an attachment travels through the streaming upload route and one
 * the scanner cannot clear is refused in words; that the teacher finds the
 * conversation with its unread count in words, reads it and replies, and the
 * learner's "Check for new messages" shows the reply; that a reported message
 * reaches a moderator's queue as metadata only, its evidence opens as an
 * audited act, and a withheld message becomes a neutral sentence for the
 * people in the conversation; that a Platform Administrator without the gated
 * keys meets a 404; that a support conversation is opened, read by staff only
 * after an audited open, claimed and answered; that nobody else reaches a
 * conversation, its catch-up or its bytes; that blocking replaces the composer
 * with the blocked state for both people; that revoking the teacher's role ends
 * the conversation on the very next request; and that the surfaces are
 * private and unindexed, right-to-left in Urdu and Arabic, reflow at 320 and
 * 640 pixels even around an unbroken 300-character token, a long address and
 * a long file name, label every control, send by keyboard and do not move
 * under reduced motion.
 *
 * NOTHING HERE DEPENDS ON REALTIME. Delivery is on request — a reload or the
 * "Check for new messages" press — which is the whole of this phase's
 * transport.
 *
 * ONE SERIAL FILE, AND A DEPENDENT PROJECT. Every step reads what the one
 * before it did. A teacher–student conversation exists only on a published
 * live Course while live learning is on, and `LiveLearningActivation` is the
 * immutable singleton whose absence `learning.spec.ts` proves first; so this
 * file runs only after that one (`playwright.config.ts`), and writes the
 * activation only if Learning has not already.
 *
 * WHO WRITES WHAT. Identity's accounts, display names and role assignments,
 * Learning's Course, enrolment and teaching scope, and both activations are
 * other owners' or an operator's facts, written as fixtures through the
 * privileged session. Everything Messaging owns — the conversations, every
 * message, the read positions, the report, the decision, the claim and the
 * block — is done through the pages.
 *
 * EVERYTHING IS SYNTHETIC. Every word is a `NON_MESSAGING_FIXTURE` sentinel
 * and every slug a `non-messaging-fixture-` one, which no other spec looks for.
 */

test.describe.configure({ mode: 'serial', retries: 0 });

let sql: SqlSession;
const contexts: BrowserContext[] = [];

const run = randomUUID().replaceAll('-', '').slice(0, 10);
const SENTINEL = 'NON_MESSAGING_FIXTURE';

const ids = {
  course: randomUUID(),
  module: randomUUID(),
  lesson: randomUUID(),
  scope: randomUUID(),
  session: randomUUID(),
} as const;

const TEXT = {
  course: `${SENTINEL} course ${run}`,
  module: `${SENTINEL}_MODULE ${run}`,
  lesson: `${SENTINEL}_LESSON ${run}`,
  learner: `${SENTINEL} learner ${run}`,
  teacher: `${SENTINEL} teacher ${run}`,
  moderator: `${SENTINEL} moderator ${run}`,
  staff: `${SENTINEL} staff ${run}`,
  administrator: `${SENTINEL} administrator ${run}`,
  first: `${SENTINEL}_BODY first ${run}`,
  reply: `${SENTINEL}_BODY reply ${run}`,
  support: `${SENTINEL}_BODY support ${run}`,
  supportReply: `${SENTINEL}_BODY support reply ${run}`,
  keyboard: `${SENTINEL}_BODY keyboard ${run}`,
  long: `${SENTINEL}_BODY long ${run}`,
} as const;

/** An unbroken token, a long address and a long file name — the reflow hazards. */
const LONG_TOKEN = 'x'.repeat(300);
const LONG_URL = `https://example.invalid/${'unbroken-path-segment-'.repeat(12)}?${'query=value&'.repeat(12)}end`;
const LONG_FILENAME = `${'synthetic-attachment-with-a-long-name-'.repeat(4)}${run}.png`;

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

/** An English `{count, plural, one {…} other {…}}` message, for one count. */
function plural(key: string, count: number): string {
  const match = /one \{([^}]*)\} other \{([^}]*)\}/u.exec(copy(key));
  if (match === null) throw new Error(`No plural forms in ${key}`);
  return (count === 1 ? (match[1] ?? '') : (match[2] ?? '')).replaceAll(
    '#',
    String(count),
  );
}

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

/** The page's own first-level heading, once a streamed page has settled. */
function mainHeading(page: Page): Locator {
  return page.getByRole('main').getByRole('heading', { level: 1 }).first();
}

/** An administration screen's own section heading — it streams behind a loading state. */
function sectionHeading(page: Page, text: string): Locator {
  return page.getByRole('main').getByRole('heading', { name: text, exact: true });
}

/** The composer's message box. */
function composerBox(page: Page): Locator {
  return page
    .getByRole('main')
    .getByRole('textbox', { name: copy('messages.composer.label'), exact: true });
}

/** The composer's submit button. */
function sendButton(page: Page): Locator {
  return page
    .getByRole('main')
    .getByRole('button', { name: copy('messages.composer.submit'), exact: true });
}

/** One message in a thread, by who sent it and something it says. */
function messageFrom(page: Page, sender: string, text: string): Locator {
  return page
    .getByRole('main')
    .getByRole('article', { name: copy('messages.thread.messageFrom', { name: sender }) })
    .filter({ hasText: text });
}

/** Writes and sends one message through the composer, and waits for the page to say so. */
async function send(page: Page, body: string): Promise<void> {
  await composerBox(page).fill(body);
  await sendButton(page).click();
  await expect(page.getByRole('main')).toContainText(copy('messages.composer.sent'));
}

/** Presses "Check for new messages" and waits for the announced count. */
async function checkForMessages(page: Page, count: number): Promise<void> {
  await page
    .getByRole('main')
    .getByRole('button', { name: copy('messages.catchUp.button'), exact: true })
    .click();
  await expect(page.getByRole('main')).toContainText(
    copy('messages.catchUp.found', { count }),
  );
}

/** The headers a same-origin Messaging upload or discard carries. */
function intentHeaders(): Record<string, string> {
  return { origin: baseUrl(), 'x-minhaj-intent': 'messaging-attachment' };
}

/** What a privileged Messaging handler answers a refusal with. */
async function expectRefusal(
  response: Awaited<ReturnType<Page['request']['get']>>,
  status: number,
  failure: string,
  where: string,
): Promise<void> {
  expect(response.status(), where).toBe(status);
  expect(await response.json(), where).toEqual({ status: 'error', failure });
  expect(response.headers()['cache-control'], where).toContain('no-store');
}

/** A byte route's one refusal: the same private 404 for every cause. */
async function expectNoBytes(
  response: Awaited<ReturnType<Page['request']['get']>>,
  where: string,
): Promise<void> {
  expect(response.status(), where).toBe(404);
  const headers = response.headers();
  expect(headers['cache-control'], where).toBe('private, no-store');
  expect(headers['x-robots-tag'], where).toContain('noindex');
  expect(headers['x-content-type-options'], where).toBe('nosniff');
}

/** The catch-up read for one conversation, as the browser's own script asks it. */
function catchUp(page: Page, conversationId: string, after: number) {
  return page
    .context()
    .request.get(
      `/api/messaging/conversations/${conversationId}/messages?after=${String(after)}`,
    );
}

interface Actor {
  readonly page: Page;
  readonly id: string;
  readonly email: string;
  /** Identity's display name — what the other side of a conversation is shown. */
  readonly name: string;
}

/** A fresh signed-in account on its own context and client address, named as a sentinel. */
async function account(
  browser: Browser,
  index: number,
  prefix: string,
  name: string,
): Promise<Actor> {
  const context = await browser.newContext({
    baseURL: baseUrl(),
    extraHTTPHeaders: { 'x-forwarded-for': `100.64.252.${String(index)}` },
  });
  contexts.push(context);
  const page = await context.newPage();
  const { email } = await registerAndSignIn(page, prefix);
  const id = await accountIdFor(sql, email);
  await sql.query(`UPDATE [dbo].[User] SET [name]=${n(name)} WHERE [id]=N'${id}';`);
  return { page, id, email, name };
}

/**
 * The browser's own Server Action submission, captured on its way out, so it
 * can be sent AGAIN exactly as a retrying browser would: the same URL, action
 * header and multipart body. The cookie is the context's own; nothing is
 * forged.
 */
async function replay(
  page: Page,
  request: Request,
): Promise<{ readonly status: number; readonly answer: string }> {
  const headers = Object.fromEntries(
    Object.entries(await request.allHeaders()).filter(
      ([name]) => !['cookie', 'content-length', 'host', 'connection'].includes(name),
    ),
  );
  const body = request.postDataBuffer();
  if (body === null) throw new Error('The submission carried no body.');
  const response = await page
    .context()
    .request.post(request.url(), { headers, data: body, maxRedirects: 0 });
  return { status: response.status(), answer: await response.text() };
}

/* ===========================================================================
 * Fixture
 * ========================================================================= */

let learner: Actor;
let teacher: Actor;
let moderator: Actor;
let staff: Actor;
let administrator: Actor;

let conversationId: string;
let supportId: string;
let reportId: string;

/**
 * Learning's facts, written as its owner's fixtures: one published live Course
 * with a whole syllabus, the learner's enrolment on it, and the teacher's
 * current scope on it under their live `teaching.perform` assignment — the
 * exact shape the teaching relationship is read from — and one scheduled
 * class of that Course, because My Teachers lists the teachers of a person's
 * classes.
 */
async function seedLearning(): Promise<void> {
  const [assignment] = await sql.query<{ id: string }>(`
    SELECT TOP (1) ra.[id] AS [id] FROM [dbo].[RoleAssignment] ra
      JOIN [dbo].[RolePermission] rp ON rp.[roleId]=ra.[roleId] AND rp.[permissionKey]=N'teaching.perform'
      WHERE ra.[userId]=N'${teacher.id}' AND ra.[revokedAt] IS NULL;`);
  if (assignment === undefined) throw new Error('The teacher holds no teaching role.');
  // A scheduled class of the Course, ten days out, in UTC wall-clock time.
  const day = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  const [starts, ends] = [`${day}T10:00`, `${day}T11:00`];

  await sql.query(`
    INSERT INTO [dbo].[Course] ([id],[slug],[primaryLocale],[state],[level],[format],[languageCode],[publishedAt],[version],[updatedAt]) VALUES
      (N'${ids.course}', N'non-messaging-fixture-${run}', N'en', N'draft', N'beginner', N'live', N'en', NULL, 1, SYSUTCDATETIME());
    INSERT INTO [dbo].[CourseLabel] ([courseId],[locale],[title],[summary],[description]) VALUES
      (N'${ids.course}', N'en', ${n(TEXT.course)}, N'', N'');
    INSERT INTO [dbo].[CourseModule] ([id],[courseId],[position]) VALUES
      (N'${ids.module}', N'${ids.course}', 0);
    INSERT INTO [dbo].[CourseModuleLabel] ([moduleId],[locale],[title],[summary]) VALUES
      (N'${ids.module}', N'en', ${n(TEXT.module)}, N'');
    INSERT INTO [dbo].[Lesson] ([id],[courseId],[moduleId],[position]) VALUES
      (N'${ids.lesson}', N'${ids.course}', N'${ids.module}', 0);
    INSERT INTO [dbo].[LessonLabel] ([lessonId],[locale],[title],[summary],[body]) VALUES
      (N'${ids.lesson}', N'en', ${n(TEXT.lesson)}, N'', ${n(`${TEXT.lesson} body`)});
    UPDATE [dbo].[Course] SET [state]=N'published', [publishedAt]=SYSUTCDATETIME(), [version]=2, [updatedAt]=SYSUTCDATETIME()
      WHERE [id]=N'${ids.course}';
    INSERT INTO [dbo].[Enrolment] ([userId],[courseId],[enrolledAt]) VALUES
      (N'${learner.id}', N'${ids.course}', SYSUTCDATETIME());
    INSERT INTO [dbo].[CourseTeachingAssignment] ([id],[courseId],[userId],[roleAssignmentId],[grantedAt]) VALUES
      (N'${ids.scope}', N'${ids.course}', N'${teacher.id}', N'${assignment.id}', SYSUTCDATETIME());
    IF NOT EXISTS (SELECT 1 FROM [dbo].[LiveLearningActivation])
      INSERT INTO [dbo].[LiveLearningActivation] ([id],[authority],[authorisedBy]) VALUES (1, N'fixture', N'${SENTINEL} browser operator');
    INSERT INTO [dbo].[ClassSession] ([id],[courseId],[kind],[scopeId],[startsAt],[endsAt],[timeZone],[startsLocal],[endsLocal],[state]) VALUES
      (N'${ids.session}', N'${ids.course}', N'course', N'${ids.scope}', '${starts}:00', '${ends}:00', N'UTC', N'${starts}', N'${ends}', N'scheduled');
  `);
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  sql = await privilegedSession();
  learner = await account(browser, 1, 'messaging-learner', TEXT.learner);
  teacher = await account(browser, 2, 'messaging-teacher', TEXT.teacher);
  await grantRole(sql, teacher.id, ['teaching.perform'], `${SENTINEL} teaching`);
  moderator = await account(browser, 3, 'messaging-moderator', TEXT.moderator);
  await grantRole(sql, moderator.id, ['messaging.moderate'], `${SENTINEL} moderation`);
  staff = await account(browser, 4, 'messaging-staff', TEXT.staff);
  await grantRole(sql, staff.id, ['messaging.support'], `${SENTINEL} support`);
  // Every key of the protected administrator bundle — which, by design,
  // carries neither gated Messaging key.
  administrator = await account(
    browser,
    5,
    'messaging-administrator',
    TEXT.administrator,
  );
  await grantRole(
    sql,
    administrator.id,
    PLATFORM_ADMINISTRATOR_PERMISSIONS,
    `${SENTINEL} administrator bundle`,
  );
  await seedLearning();
});

test.afterAll(async () => {
  for (const context of contexts) await context.close();
  await sql?.close();
});

/* ===========================================================================
 * 1. Signed out, and before Messaging is switched on
 * ========================================================================= */

test.describe('Messaging, before anyone writes', () => {
  test('a signed-out visitor is sent to sign in, and every handler and byte route refuses', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const nobody = randomUUID();
    for (const target of [
      '/en/my/messages',
      '/en/my/messages/support',
      `/en/my/messages/${nobody}`,
    ]) {
      await page.goto(target);
      await page.waitForURL(/\/en\/signin\?/);
      const url = new URL(page.url());
      expect(`${url.pathname}${url.search}`, target).toBe(
        `/en/signin?returnTo=${encodeURIComponent(target)}`,
      );
    }
    // The Teacher area's and administration's own shells send a visitor to
    // sign in before any page of theirs renders, returning to the area.
    for (const [target, area] of [
      ['/en/teacher/messages', '/en/teacher'],
      [`/en/teacher/messages/${nobody}`, '/en/teacher'],
      ['/en/admin/messaging', '/en/admin'],
    ] as const) {
      await page.goto(target);
      await page.waitForURL(/\/en\/signin\?/);
      const url = new URL(page.url());
      expect(`${url.pathname}${url.search}`, target).toBe(
        `/en/signin?returnTo=${encodeURIComponent(area)}`,
      );
    }

    await expectRefusal(
      await request.get(`/api/messaging/conversations/${nobody}/messages?after=0`),
      403,
      'denied',
      'catch-up',
    );
    await expectRefusal(
      await request.post(`/api/messaging/conversations/${nobody}/attachments`, {
        headers: { ...intentHeaders(), 'content-type': 'application/octet-stream' },
        data: Buffer.from(syntheticPng(4, 4)),
      }),
      403,
      'denied',
      'upload',
    );
    await expectRefusal(
      await request.post(`/api/messaging/attachments/${nobody}/discard`, {
        headers: intentHeaders(),
      }),
      403,
      'denied',
      'discard',
    );
    for (const target of [
      `/assets/messaging/attachments/${nobody}`,
      `/assets/messaging/support/${nobody}`,
      `/assets/messaging/evidence/${nobody}/${randomUUID()}`,
    ])
      await expectNoBytes(await request.get(target, { maxRedirects: 0 }), target);
    expect((await request.get('/api/my/export/messaging')).status()).toBe(401);
  });

  test('the pages say plainly that Messaging is not switched on, and offer nobody', async () => {
    test.setTimeout(180_000);
    // THE PRECONDITION, PROVED: no other spec writes the activation.
    expect(
      await scalar('SELECT COUNT_BIG(*) AS [value] FROM [dbo].[MessagingActivation];'),
    ).toBe(0);

    for (const [viewer, target, words] of [
      [learner.page, '/en/my/messages', copy('messages.notActivated')],
      [learner.page, '/en/my/messages/support', copy('messages.support.notActivated')],
      [teacher.page, '/en/teacher/messages', copy('messages.teacher.notActivated')],
    ] as const) {
      const response = await viewer.goto(target);
      expect(response?.status(), target).toBe(200);
      await expect(viewer.getByRole('main'), target).toContainText(words);
      await expect(
        viewer.getByRole('main').getByRole('button', { name: /^Message / }),
        target,
      ).toHaveCount(0);
    }
    // My Teachers lists the teacher — the relationship is Learning's — and
    // offers no conversation while Messaging is off.
    await learner.page.goto('/en/my/teachers');
    await expect(learner.page.getByRole('main')).toContainText(TEXT.course);
    await expect(
      learner.page.getByRole('main').getByRole('button', { name: /^Message / }),
    ).toHaveCount(0);

    // Switched on as a FIXTURE, which every Messaging page must then announce.
    await sql.query(`
      INSERT INTO [dbo].[MessagingActivation] ([capability],[authority],[authorisedBy]) VALUES
        (N'teacher-student', N'fixture', N'${SENTINEL} browser operator'),
        (N'support', N'fixture', N'${SENTINEL} browser operator');`);
    await learner.page.goto('/en/my/messages');
    const main = learner.page.getByRole('main');
    await expect(main).toContainText(copy('messages.fixture'));
    await expect(main).not.toContainText(copy('messages.notActivated'));
    await expect(main).toContainText(copy('messages.list.empty'));
  });
});

/* ===========================================================================
 * 2. A teacher and a learner
 * ========================================================================= */

test.describe('a learner and their teacher', () => {
  test('the learner opens the conversation from My Teachers and writes; a replayed submission stores one message', async () => {
    test.setTimeout(240_000);
    const page = learner.page;
    const start = copy('messages.start.submit', {
      name: copy('myClasses.teachers.unnamed'),
      course: TEXT.course,
    });
    await page.goto('/en/my/teachers');
    await page
      .getByRole('main')
      .getByRole('button', { name: start, exact: true })
      .click();
    await page.waitForURL(/\/en\/my\/messages\/[0-9a-f-]{36}$/);
    conversationId = new URL(page.url()).pathname.split('/').at(-1) ?? '';
    await expect(mainHeading(page)).toHaveText(TEXT.teacher);
    await expect(page.getByRole('main')).toContainText(TEXT.course);
    await expect(page.getByRole('main')).toContainText(copy('messages.thread.empty'));

    // Pressing it again RETURNS the same conversation; it never opens a second.
    await page.goto('/en/my/teachers');
    await page
      .getByRole('main')
      .getByRole('button', { name: start, exact: true })
      .click();
    await page.waitForURL(`**/en/my/messages/${conversationId}`);
    expect(
      await scalar(
        `SELECT COUNT_BIG(*) AS [value] FROM [dbo].[Conversation] WHERE [courseId]=N'${ids.course}';`,
      ),
    ).toBe(1);

    // The real submission, captured on its way out…
    const submitted = page.waitForRequest(
      (request) =>
        request.method() === 'POST' &&
        request.headers()['next-action'] !== undefined &&
        (request.postData() ?? '').includes(TEXT.first),
    );
    await send(page, TEXT.first);
    const original = await submitted;
    await expect(messageFrom(page, copy('messages.you'), TEXT.first)).toHaveCount(1);

    // …and sent again, byte for byte, as a retrying browser would. The service
    // answers the same operation with the message it already stored.
    const again = await replay(page, original);
    expect(again.status).toBe(200);
    // The action ANSWERED, as a success — not a framework refusal of the replay.
    expect(again.answer).toContain('"status":"success"');
    expect(
      await scalar(
        `SELECT COUNT_BIG(*) AS [value] FROM [dbo].[Message] WHERE [conversationId]=N'${conversationId}';`,
      ),
    ).toBe(1);
    await page.reload();
    await expect(messageFrom(page, copy('messages.you'), TEXT.first)).toHaveCount(1);
  });

  test('an attachment travels through the upload route, and one the scanner cannot clear is refused in words', async () => {
    test.setTimeout(180_000);
    const page = learner.page;
    // 320 pixels, so the long file name's reflow is measured where it is hardest.
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/en/my/messages/${conversationId}`);
    const picker = page
      .getByRole('main')
      .getByLabel(copy('messages.composer.attach'), { exact: true });
    await expect(picker).toBeVisible();

    const uploaded = page.waitForResponse(
      (response) =>
        response
          .url()
          .endsWith(`/api/messaging/conversations/${conversationId}/attachments`) &&
        response.request().method() === 'POST',
    );
    await picker.setInputFiles({
      name: LONG_FILENAME,
      mimeType: 'image/png',
      buffer: Buffer.from(syntheticPng(8, 8, { hue: 200 })),
    });
    // The browser run's scanner is deliberately unreachable (scripts/browser-server.mjs),
    // so an upload whose scan cannot complete is refused rather than attached.
    const answer = await uploaded;
    expect(answer.status()).toBe(422);
    expect(await answer.json()).toEqual({ status: 'error', failure: 'not-cleared' });
    expect(answer.headers()['cache-control']).toContain('no-store');

    const files = page
      .getByRole('main')
      .getByRole('list', { name: copy('messages.composer.attachments') });
    await expect(files).toContainText(
      `${copy('messages.composer.uploadFailed', { name: LONG_FILENAME })} ${copy('messages.failure.notCleared')}`,
    );
    expect(await overflowOf(page), '320px with a long file name').toBeLessThanOrEqual(0);

    await files
      .getByRole('button', {
        name: copy('messages.composer.remove', { name: LONG_FILENAME }),
      })
      .click();
    await expect(files).toHaveCount(0);
    expect(
      await scalar(
        `SELECT COUNT_BIG(*) AS [value] FROM [dbo].[MessageAttachment] WHERE [conversationId]=N'${conversationId}' AND [state] IN (N'ready', N'attached');`,
      ),
    ).toBe(0);
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test('the teacher finds the conversation with its unread count in words, reads it and replies', async () => {
    test.setTimeout(180_000);
    const page = teacher.page;
    const response = await page.goto('/en/teacher/messages');
    expect(response?.status()).toBe(200);
    const list = page
      .getByRole('main')
      .getByRole('list', { name: copy('messages.list.heading') });
    const entry = list.getByRole('listitem').filter({ hasText: TEXT.learner });
    await expect(entry).toContainText(plural('messages.list.unread', 1));
    await expect(entry).toContainText(TEXT.course);

    await entry.getByRole('link', { name: TEXT.learner }).click();
    await page.waitForURL(`**/en/teacher/messages/${conversationId}`);
    await expect(mainHeading(page)).toHaveText(TEXT.learner);
    await expect(messageFrom(page, TEXT.learner, TEXT.first)).toBeVisible();
    await send(page, TEXT.reply);
    await expect(messageFrom(page, copy('messages.you'), TEXT.reply)).toBeVisible();

    // Shown, therefore read: the count is gone on the next visit.
    await page.goto('/en/teacher/messages');
    await expect(
      page.getByRole('main').getByRole('listitem').filter({ hasText: TEXT.learner }),
    ).not.toContainText(plural('messages.list.unread', 1));
  });

  test('the learner checks for new messages and the reply appears; the catch-up read is private', async () => {
    test.setTimeout(120_000);
    const page = learner.page;
    // The page still shows only the first message: nothing pushed the reply here.
    await expect(messageFrom(page, TEXT.teacher, TEXT.reply)).toHaveCount(0);
    await checkForMessages(page, 1);
    await expect(messageFrom(page, TEXT.teacher, TEXT.reply)).toBeVisible();

    const response = await catchUp(page, conversationId, 0);
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('no-store');
    const body = (await response.json()) as {
      status: string;
      page: { messages: { own: boolean; body: string | null; withheld: boolean }[] };
    };
    expect(body.status).toBe('success');
    expect(body.page.messages.map((message) => [message.own, message.body])).toEqual([
      [true, TEXT.first],
      [false, TEXT.reply],
    ]);
    const embedded = await page
      .context()
      .request.get(`/api/messaging/conversations/${conversationId}/messages?after=0`, {
        headers: { 'sec-fetch-site': 'cross-site' },
      });
    await expectRefusal(embedded, 403, 'denied', 'a cross-site read');
  });
});

/* ===========================================================================
 * 3. Reporting and moderation
 * ========================================================================= */

test.describe('a report, and its moderation', () => {
  test('the learner reports the reply for a controlled reason', async () => {
    test.setTimeout(120_000);
    const page = learner.page;
    await page.goto(`/en/my/messages/${conversationId}`);
    const reply = messageFrom(page, TEXT.teacher, TEXT.reply);
    await reply.getByText(copy('messages.safety.reportMessage'), { exact: true }).click();
    await reply
      .getByLabel(copy('messages.safety.reason'), { exact: true })
      .selectOption('harassment');
    await reply
      .getByRole('checkbox', { name: copy('messages.safety.reportConfirm') })
      .check();
    await reply
      .getByRole('button', { name: copy('messages.safety.reportSubmit'), exact: true })
      .click();
    await expect(reply).toContainText(copy('messages.safety.reportDone'));

    const [report] = await sql.query<{ id: string; messageId: string | null }>(
      `SELECT [id],[messageId] FROM [dbo].[MessagingReport] WHERE [conversationId]=N'${conversationId}' AND [state]=N'open';`,
    );
    if (report === undefined) throw new Error('No report was filed.');
    reportId = report.id;
    const [replied] = await sql.query<{ id: string }>(
      `SELECT [id] FROM [dbo].[Message] WHERE [conversationId]=N'${conversationId}' AND [senderUserId]=N'${teacher.id}';`,
    );
    expect(report.messageId).toBe(replied?.id);

    // Holding no administrative key at all, the teacher meets the shell's 404.
    expect((await teacher.page.goto('/en/admin/messaging/reports'))?.status()).toBe(404);
  });

  test('a moderator sees metadata in the queues, reads the evidence as an audited act, and withholds the message', async () => {
    test.setTimeout(240_000);
    const page = moderator.page;
    const short = reportId.slice(0, 8);

    // The area root sends a moderator to the first surface the key opens.
    await page.goto('/en/admin/messaging');
    await page.waitForURL('**/en/admin/messaging/moderation');
    await expect(
      sectionHeading(page, copy('adminMessaging.moderation.title')),
    ).toBeVisible();
    const queue = page
      .getByRole('main')
      .getByRole('table', { name: copy('adminMessaging.moderation.caption') });
    await expect(
      queue.getByRole('link', {
        name: copy('adminMessaging.moderation.review', { id: short }),
      }),
    ).toBeVisible();
    await expect(page.getByRole('main')).not.toContainText(TEXT.reply);

    await page.goto('/en/admin/messaging/reports');
    await expect(
      sectionHeading(page, copy('adminMessaging.reports.title')),
    ).toBeVisible();
    const row = page
      .getByRole('main')
      .getByRole('row')
      .filter({ hasText: copy('adminMessaging.reports.open', { id: short }) });
    for (const words of [
      copy('adminMessaging.reason.harassment'),
      copy('adminMessaging.target.message'),
      copy('adminMessaging.kind.teacher-student'),
      copy('adminMessaging.reportState.open'),
    ])
      await expect(row).toContainText(words);
    // IDENTIFIERS, REASONS, STATES — never content, never a person.
    for (const secret of [TEXT.reply, TEXT.first, TEXT.learner, TEXT.teacher])
      await expect(page.getByRole('main')).not.toContainText(secret);

    await row
      .getByRole('link', { name: copy('adminMessaging.reports.open', { id: short }) })
      .click();
    await page.waitForURL(`**/en/admin/messaging/reports/${reportId}`);
    await expect(
      sectionHeading(page, copy('adminMessaging.evidence.title', { id: short })),
    ).toBeVisible();
    const main = page.getByRole('main');
    await expect(main).toContainText(copy('adminMessaging.evidence.audited'));
    const reported = messageFrom(page, TEXT.teacher, TEXT.reply);
    await expect(reported).toContainText(copy('messages.thread.reported'));
    await expect(messageFrom(page, TEXT.learner, TEXT.first)).toBeVisible();
    expect(
      await scalar(
        `SELECT COUNT_BIG(*) AS [value] FROM [dbo].[AuditLog] WHERE [action]=N'messaging.evidence.accessed' AND [actorId]=N'${moderator.id}' AND [targetId]=N'${reportId}';`,
      ),
    ).toBeGreaterThanOrEqual(1);

    await main
      .getByRole('radio', {
        name: copy('adminMessaging.decision.option.withhold-message'),
      })
      .check();
    await main
      .getByRole('checkbox', { name: copy('adminMessaging.decision.confirm') })
      .check();
    await main
      .getByRole('button', { name: copy('adminMessaging.decision.submit'), exact: true })
      .click();
    await expect(main).toContainText(
      copy('adminMessaging.decision.done.withhold-message'),
    );
    await expect(main).toContainText(copy('adminMessaging.reportState.resolved'));
    // Evidence keeps the withheld message, marked.
    await expect(reported).toContainText(copy('messages.thread.withheldBadge'));
  });

  test('the people in the conversation see a neutral sentence where the message was', async () => {
    test.setTimeout(120_000);
    for (const [viewer, target, replier, writer] of [
      [
        learner.page,
        `/en/my/messages/${conversationId}`,
        TEXT.teacher,
        copy('messages.you'),
      ],
      [
        teacher.page,
        `/en/teacher/messages/${conversationId}`,
        copy('messages.you'),
        TEXT.learner,
      ],
    ] as const) {
      await viewer.goto(target);
      const main = viewer.getByRole('main');
      await expect(main, target).not.toContainText(TEXT.reply);
      await expect(
        messageFrom(viewer, replier, copy('messages.thread.withheld')),
        target,
      ).toBeVisible();
      // Only the reported message is withheld; the rest of the thread stands.
      await expect(messageFrom(viewer, writer, TEXT.first), target).toBeVisible();
    }
    // Nothing is left to report on a withheld message.
    await learner.page.goto(`/en/my/messages/${conversationId}`);
    await expect(
      messageFrom(learner.page, TEXT.teacher, copy('messages.thread.withheld')).getByText(
        copy('messages.safety.reportMessage'),
      ),
    ).toHaveCount(0);
    const response = await catchUp(learner.page, conversationId, 1);
    const body = (await response.json()) as {
      page: { messages: { body: string | null; withheld: boolean }[] };
    };
    expect(body.page.messages).toEqual([
      expect.objectContaining({ body: null, withheld: true }),
    ]);
  });

  test('Messaging administration is a 404 to a Platform Administrator without its gated keys', async () => {
    test.setTimeout(180_000);
    const page = administrator.page;
    // The administration area is open to them…
    expect((await page.goto('/en/admin'))?.status()).toBe(200);
    await expect(
      page.getByRole('link', { name: copy('admin.nav.messaging'), exact: true }),
    ).toHaveCount(0);
    // …and Messaging's is not, at any address.
    for (const target of [
      '/en/admin/messaging',
      '/en/admin/messaging/support',
      '/en/admin/messaging/moderation',
      '/en/admin/messaging/reports',
      `/en/admin/messaging/reports/${reportId}`,
      `/en/admin/messaging/support/${randomUUID()}`,
    ]) {
      const response = await page.goto(target);
      expect(response?.status(), target).toBe(404);
      await expect(page.locator('body'), target).not.toContainText(SENTINEL);
    }
  });
});

/* ===========================================================================
 * 4. Support
 * ========================================================================= */

test.describe('a support conversation', () => {
  test('a person opens one and writes; staff see metadata only until an audited open', async () => {
    test.setTimeout(240_000);
    const page = learner.page;
    await page.goto('/en/my/messages/support');
    await page
      .getByRole('main')
      .getByRole('button', { name: copy('messages.support.start'), exact: true })
      .click();
    await page.waitForURL(/\/en\/my\/messages\/[0-9a-f-]{36}$/);
    supportId = new URL(page.url()).pathname.split('/').at(-1) ?? '';
    expect(supportId).not.toBe(conversationId);
    await expect(mainHeading(page)).toHaveText(copy('messages.supportName'));
    await send(page, TEXT.support);

    // The support page now continues the one open conversation.
    await page.goto('/en/my/messages/support');
    await expect(
      page
        .getByRole('main')
        .getByRole('link', { name: copy('messages.support.continue'), exact: true }),
    ).toHaveAttribute('href', `/en/my/messages/${supportId}`);

    const desk = staff.page;
    await desk.goto('/en/admin/messaging');
    await desk.waitForURL('**/en/admin/messaging/support');
    await expect(
      sectionHeading(desk, copy('adminMessaging.support.title')),
    ).toBeVisible();
    const row = desk
      .getByRole('main')
      .getByRole('table', { name: copy('adminMessaging.support.captionOpen') })
      .getByRole('row')
      .filter({
        hasText: copy('adminMessaging.support.open', { id: supportId.slice(0, 8) }),
      });
    await expect(row).toContainText(copy('adminMessaging.support.unclaimed'));
    await expect(row).toContainText(copy('adminMessaging.support.awaiting'));
    for (const secret of [TEXT.support, TEXT.learner, learner.email])
      await expect(desk.getByRole('main')).not.toContainText(secret);
    // The support key is not the moderation key: no report surface is offered.
    await expect(
      desk.getByRole('link', {
        name: copy('adminMessaging.surface.reports'),
        exact: true,
      }),
    ).toHaveCount(0);
    expect(
      await scalar(
        `SELECT COUNT_BIG(*) AS [value] FROM [dbo].[AuditLog] WHERE [action]=N'messaging.support.accessed' AND [targetId]=N'${supportId}';`,
      ),
    ).toBe(0);

    await row.getByRole('link').click();
    await desk.waitForURL(`**/en/admin/messaging/support/${supportId}`);
    const main = desk.getByRole('main');
    await expect(main).toContainText(copy('adminMessaging.conversation.audited'));
    await expect(messageFrom(desk, TEXT.learner, TEXT.support)).toBeVisible();
    expect(
      await scalar(
        `SELECT COUNT_BIG(*) AS [value] FROM [dbo].[AuditLog] WHERE [action]=N'messaging.support.accessed' AND [actorId]=N'${staff.id}' AND [targetId]=N'${supportId}';`,
      ),
    ).toBeGreaterThanOrEqual(1);
    // Read, but not answerable until claimed.
    await expect(composerBox(desk)).toHaveCount(0);
    await expect(main).toContainText(copy('adminMessaging.conversation.replyNeedsClaim'));
  });

  test('staff claim it and reply; the person checks for new messages and sees Minhaj Support', async () => {
    test.setTimeout(180_000);
    // The person has their conversation open while staff answer it.
    const page = learner.page;
    await page.goto(`/en/my/messages/${supportId}`);
    await expect(messageFrom(page, copy('messages.you'), TEXT.support)).toBeVisible();

    const desk = staff.page;
    const main = desk.getByRole('main');
    await main
      .getByRole('button', {
        name: copy('adminMessaging.conversation.claim'),
        exact: true,
      })
      .click();
    await expect(composerBox(desk)).toBeVisible();
    await expect(main).not.toContainText(
      copy('adminMessaging.conversation.replyNeedsClaim'),
    );
    expect(
      await scalar(
        `SELECT COUNT_BIG(*) AS [value] FROM [dbo].[ConversationParticipant] WHERE [conversationId]=N'${supportId}' AND [userId]=N'${staff.id}' AND [role]=N'support' AND [leftAt] IS NULL;`,
      ),
    ).toBe(1);
    await send(desk, TEXT.supportReply);
    await expect(
      messageFrom(desk, copy('messages.you'), TEXT.supportReply),
    ).toBeVisible();

    // Nothing pushed it; the person asks, and the reply is shown.
    await expect(
      messageFrom(page, copy('messages.supportName'), TEXT.supportReply),
    ).toHaveCount(0);
    await checkForMessages(page, 1);
    await expect(
      messageFrom(page, copy('messages.supportName'), TEXT.supportReply),
    ).toBeVisible();
    // The staff member is the organisation, never a personal name.
    await expect(page.getByRole('main')).not.toContainText(TEXT.staff);
    const caught = (await (await catchUp(page, supportId, 1)).json()) as {
      page: { messages: { body: string | null; own: boolean }[] };
    };
    expect(caught.page.messages.map((message) => [message.own, message.body])).toEqual([
      [false, TEXT.supportReply],
    ]);
  });

  test('nobody else reaches either conversation, its catch-up or its bytes', async () => {
    test.setTimeout(180_000);
    for (const [who, viewer] of [
      ['an administrator', administrator.page],
      ['the teacher', teacher.page],
      ['a moderator', moderator.page],
    ] as const) {
      const response = await viewer.goto(`/en/my/messages/${supportId}`);
      expect(response?.status(), `${who}: support`).toBe(404);
      await expect(viewer.locator('body'), who).not.toContainText(TEXT.support);
      await expectRefusal(
        await catchUp(viewer, supportId, 0),
        404,
        'not-found',
        `${who}: support catch-up`,
      );
    }
    for (const [who, viewer] of [
      ['an administrator', administrator.page],
      ['a moderator', moderator.page],
      ['support staff', staff.page],
    ] as const) {
      const response = await viewer.goto(`/en/my/messages/${conversationId}`);
      expect(response?.status(), `${who}: teaching`).toBe(404);
      await expect(viewer.locator('body'), who).not.toContainText(TEXT.first);
      await expectRefusal(
        await catchUp(viewer, conversationId, 0),
        404,
        'not-found',
        `${who}: teaching catch-up`,
      );
    }
    // A teacher's own surface does not open a support conversation either.
    expect((await teacher.page.goto(`/en/teacher/messages/${supportId}`))?.status()).toBe(
      404,
    );
    // No attachment was ever attached here (the scanner refused it), so every
    // byte address is the one private 404 — for a participant and a stranger.
    const nothing = randomUUID();
    for (const [viewer, target] of [
      [administrator.page, `/assets/messaging/attachments/${nothing}`],
      [learner.page, `/assets/messaging/attachments/${nothing}`],
      [staff.page, `/assets/messaging/support/${nothing}`],
      [moderator.page, `/assets/messaging/evidence/${reportId}/${nothing}`],
    ] as const)
      await expectNoBytes(
        await viewer.context().request.get(target, { maxRedirects: 0 }),
        target,
      );
  });

  test('each export is the person’s own data, privately', async () => {
    test.setTimeout(120_000);
    const response = await learner.page.context().request.get('/api/my/export/messaging');
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers['cache-control']).toBe('private, no-store');
    expect(headers['content-disposition']).toMatch(
      /^attachment; filename="minhaj-messaging-data-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    const document = (await response.json()) as {
      schema: string;
      conversations: { id: string }[];
      messages: { body: string }[];
      reports: { id: string }[];
    };
    expect(document.schema).toBe('minhaj.messaging.export');
    expect(document.conversations.map((entry) => entry.id).sort()).toEqual(
      [conversationId, supportId].sort(),
    );
    expect(document.messages.map((entry) => entry.body).sort()).toEqual(
      [TEXT.first, TEXT.support].sort(),
    );
    expect(document.reports.map((entry) => entry.id)).toEqual([reportId]);
    const raw = JSON.stringify(document);
    for (const secret of [TEXT.reply, TEXT.supportReply, teacher.email, staff.email])
      expect(raw).not.toContain(secret);

    const stranger = (await (
      await administrator.page.context().request.get('/api/my/export/messaging')
    ).json()) as { conversations: unknown[]; messages: unknown[] };
    expect(stranger.conversations).toEqual([]);
    expect(stranger.messages).toEqual([]);
  });
});

/* ===========================================================================
 * 5. Blocking
 * ========================================================================= */

test.describe('a block', () => {
  test('replaces the composer with the blocked state for both people, until it is lifted', async () => {
    test.setTimeout(180_000);
    const page = learner.page;
    await page.goto(`/en/my/messages/${conversationId}`);
    const main = page.getByRole('main');
    await main
      .getByText(copy('messages.safety.block', { name: TEXT.teacher }), { exact: true })
      .click();
    await main
      .getByRole('checkbox', { name: copy('messages.safety.blockConfirm') })
      .check();
    await main
      .getByRole('button', { name: copy('messages.safety.blockSubmit'), exact: true })
      .click();
    await expect(main).toContainText(copy('messages.state.blockedByMe'));
    await expect(composerBox(page)).toHaveCount(0);

    // The other side is told neutrally — not who decided it.
    await teacher.page.goto(`/en/teacher/messages/${conversationId}`);
    await expect(teacher.page.getByRole('main')).toContainText(
      copy('messages.state.blocked'),
    );
    await expect(teacher.page.getByRole('main')).not.toContainText(
      copy('messages.state.blockedByMe'),
    );
    await expect(composerBox(teacher.page)).toHaveCount(0);
    expect(
      await scalar(
        `SELECT COUNT_BIG(*) AS [value] FROM [dbo].[MessagingBlock] WHERE [blockerUserId]=N'${learner.id}' AND [blockedUserId]=N'${teacher.id}';`,
      ),
    ).toBe(1);

    await main
      .getByRole('button', {
        name: copy('messages.safety.unblockSubmit', { name: TEXT.teacher }),
        exact: true,
      })
      .click();
    await expect(composerBox(page)).toBeVisible();
    await teacher.page.reload();
    await expect(composerBox(teacher.page)).toBeVisible();
  });
});

/* ===========================================================================
 * 6. Every surface: private, every locale, every width, the keyboard
 * ========================================================================= */

test.describe('the Messaging surfaces', () => {
  test('are private and unindexed', async () => {
    test.setTimeout(300_000);
    for (const [viewer, target] of [
      [learner.page, '/en/my/messages'],
      [learner.page, `/en/my/messages/${conversationId}`],
      [learner.page, '/en/my/messages/support'],
      [learner.page, `/en/my/messages/${supportId}`],
      [teacher.page, '/en/teacher/messages'],
      [teacher.page, `/en/teacher/messages/${conversationId}`],
      [moderator.page, '/en/admin/messaging/moderation'],
      [moderator.page, '/en/admin/messaging/reports'],
      [moderator.page, `/en/admin/messaging/reports/${reportId}`],
      [staff.page, '/en/admin/messaging/support'],
      [staff.page, `/en/admin/messaging/support/${supportId}`],
    ] as const) {
      const response = await viewer.context().request.get(target, { maxRedirects: 0 });
      expect(response.status(), target).toBe(200);
      const cache = response.headers()['cache-control'] ?? '';
      expect(cache, target).toContain('private');
      expect(cache, target).toContain('no-store');
      await viewer.goto(target);
      await expect(mainHeading(viewer), target).toBeVisible();
      await expect(viewer.locator('meta[name="robots"]').first(), target).toHaveAttribute(
        'content',
        /noindex/,
      );
    }
  });

  test('a thread is right-to-left in Urdu and Arabic, and reflows at 320px and 640px around unbroken text', async () => {
    test.setTimeout(600_000);
    await learner.page.goto(`/en/my/messages/${conversationId}`);
    await send(learner.page, `${TEXT.long}\n${LONG_TOKEN}\n${LONG_URL}`);

    for (const locale of ['en', 'ur', 'ar'] as const)
      for (const [viewer, target] of [
        [learner.page, `/${locale}/my/messages/${conversationId}`],
        [teacher.page, `/${locale}/teacher/messages/${conversationId}`],
      ] as const) {
        const response = await viewer.goto(target);
        expect(response?.status(), target).toBe(200);
        await expect(viewer.locator('html'), target).toHaveAttribute(
          'dir',
          locale === 'en' ? 'ltr' : 'rtl',
        );
        await expect(viewer.locator('html'), target).toHaveAttribute('lang', locale);
        // The person's words keep their own direction in any interface.
        await expect(
          viewer
            .getByRole('main')
            .locator('p[dir="auto"]')
            .filter({ hasText: TEXT.first }),
          target,
        ).toHaveCount(1);
        await expect(
          viewer.getByRole('main').getByRole('button', {
            name: copy('messages.composer.submit', {}, locale),
            exact: true,
          }),
          target,
        ).toBeVisible();
      }

    const viewers = [learner.page, teacher.page, moderator.page, staff.page];
    // 640 CSS pixels is a 1280-pixel window at 200% zoom.
    for (const width of [320, 640]) {
      for (const viewer of viewers) await viewer.setViewportSize({ width, height: 800 });
      for (const locale of ['en', 'ar'] as const)
        for (const [viewer, target] of [
          [learner.page, `/${locale}/my/messages/${conversationId}`],
          [learner.page, `/${locale}/my/messages`],
          [learner.page, `/${locale}/my/messages/support`],
          [teacher.page, `/${locale}/teacher/messages/${conversationId}`],
          [teacher.page, `/${locale}/teacher/messages`],
          [moderator.page, `/${locale}/admin/messaging/reports/${reportId}`],
          [staff.page, `/${locale}/admin/messaging/support/${supportId}`],
        ] as const) {
          const where = `${String(width)}px ${target}`;
          const response = await viewer.goto(target);
          expect(response?.status(), where).toBe(200);
          await expect(mainHeading(viewer), where).toBeVisible();
          if (target.includes(conversationId))
            await expect(
              viewer.getByRole('main').getByText(LONG_TOKEN, { exact: false }),
              where,
            ).toBeVisible();
          expect(await overflowOf(viewer), where).toBeLessThanOrEqual(0);
          await expectHeadingsInOrder(viewer, where);
        }
    }
    for (const viewer of viewers)
      await viewer.setViewportSize({ width: 1280, height: 800 });
  });

  test('every control is labelled, a message is sent by keyboard alone, and nothing moves under reduced motion', async () => {
    test.setTimeout(240_000);
    const page = learner.page;
    await page.goto(`/en/my/messages/${conversationId}`);
    await expectLabelledControls(page, 'the learner’s thread');
    await teacher.page.goto(`/en/teacher/messages/${conversationId}`);
    await expectLabelledControls(teacher.page, 'the teacher’s thread');
    await staff.page.goto(`/en/admin/messaging/support/${supportId}`);
    await expect(composerBox(staff.page)).toBeVisible();
    await expectLabelledControls(staff.page, 'the support conversation');
    await moderator.page.goto(`/en/admin/messaging/reports/${reportId}`);
    await expect(
      sectionHeading(
        moderator.page,
        copy('adminMessaging.evidence.title', { id: reportId.slice(0, 8) }),
      ),
    ).toBeVisible();
    await expectLabelledControls(moderator.page, 'the evidence page');

    // By keyboard alone: Tab to the box, type, Tab to Send, press Enter.
    const box = composerBox(page);
    await tabTo(page, box);
    await expectVisibleFocus(box, 'the message box');
    await page.keyboard.type(TEXT.keyboard);
    const submit = sendButton(page);
    await tabTo(page, submit);
    await expectVisibleFocus(submit, 'Send');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('main')).toContainText(copy('messages.composer.sent'));
    await expect(messageFrom(page, copy('messages.you'), TEXT.keyboard)).toBeVisible();

    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const target of [`/en/my/messages/${conversationId}`, '/en/my/messages']) {
      await page.goto(target);
      await expect(mainHeading(page)).toBeVisible();
      await expect(page.locator('main [class*="animate-"]'), target).toHaveCount(0);
      const motion = await page.evaluate(() => ({
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
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  });
});

/* ===========================================================================
 * 7. The relationship ends
 * ========================================================================= */

test.describe('when the teaching role is revoked', () => {
  test('the teacher’s conversation is unavailable on the next request, and the learner is told it ended', async () => {
    test.setTimeout(180_000);
    // Exactly what Identity's revocation writes.
    await sql.query(
      `UPDATE [dbo].[RoleAssignment] SET [revokedAt]=SYSUTCDATETIME() WHERE [userId]=N'${teacher.id}' AND [revokedAt] IS NULL;`,
    );
    for (const target of [
      `/en/teacher/messages/${conversationId}`,
      '/en/teacher/messages',
    ]) {
      const response = await teacher.page.goto(target);
      expect(response?.status(), target).toBe(404);
      await expect(teacher.page.locator('body'), target).not.toContainText(TEXT.first);
    }
    await expectRefusal(
      await catchUp(teacher.page, conversationId, 0),
      403,
      'ended',
      'the former teacher’s catch-up',
    );

    const page = learner.page;
    const response = await page.goto(`/en/my/messages/${conversationId}`);
    expect(response?.status()).toBe(200);
    await expect(mainHeading(page)).toHaveText(copy('messages.ended.title'));
    const main = page.getByRole('main');
    await expect(main).toContainText(copy('messages.ended.body'));
    for (const secret of [TEXT.first, TEXT.teacher, TEXT.course])
      await expect(main).not.toContainText(secret);
    await expect(composerBox(page)).toHaveCount(0);
    await expectRefusal(
      await catchUp(page, conversationId, 0),
      403,
      'ended',
      'the learner’s catch-up',
    );

    // The inbox keeps the support conversation and no longer lists this one.
    await page.goto('/en/my/messages');
    await expect(
      page.getByRole('main').getByRole('link', { name: TEXT.teacher }),
    ).toHaveCount(0);
    await expect(
      page
        .getByRole('main')
        .getByRole('link', { name: copy('messages.supportName'), exact: true }),
    ).toBeVisible();
  });
});
