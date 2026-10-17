import { randomUUID } from 'node:crypto';

import type {
  Browser,
  BrowserContext,
  Locator,
  Page,
  Request,
  WebSocket,
} from '@playwright/test';

import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import {
  composerBox,
  copy,
  expectHeadingsInOrder,
  expectLabelledControls,
  expectVisibleFocus,
  mainHeading,
  messageFrom,
  overflowOf,
  send,
  seedTeaching,
  sendButton,
  tabTo,
} from './messaging-pages';
import { isRealtimeRunning, startRealtime, stopRealtime } from './realtime-control';
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
 * Phase 25 — live Messaging in a real browser, through the real front door.
 *
 * THE STACK UNDER TEST IS THE DEPLOYED SHAPE. The browser talks to the NGINX
 * front door only; NGINX sends `/socket.io/` to the realtime process (started
 * from its composition entry against this run's disposable database) and
 * everything else to the production build. The socket carries the browser's
 * own session cookie and nothing else.
 *
 * WHAT ONLY A BROWSER CAN PROVE: that a message one person sends appears on
 * the other person's open page WITHOUT a reload, exactly once, and is sent
 * through the socket rather than the page; that presence and typing are shown
 * as words; that a reply is sent by keyboard alone and focus stays on Send;
 * that with the realtime process STOPPED the page says live updates are
 * unavailable, still lists its history, and still sends — through the Server
 * Action — a message that is stored; that when the process is STARTED again
 * the page reconnects on its own, with one connection, and the message sent
 * during the outage appears exactly once on both sides; that an unrelated
 * signed-in account reaches nothing, not by the page, the catch-up read or
 * the socket itself, and is sent no frame of the conversation; that the live
 * surfaces are right-to-left in Urdu and Arabic, reflow at 320 and 640 pixels
 * around an unbroken message that arrived live, keep their structure, do not
 * move under reduced motion — and that no message body is ever written to the
 * browser console.
 *
 * A DUPLICATE IS COUNTED, NOT GUESSED. Every message item carries its
 * identifier as `data-message-id`; "exactly once" is a count of those items.
 *
 * ONE SERIAL FILE, AFTER MESSAGING. A conversation exists only on a published
 * live Course while live learning and Messaging are on; `messaging.spec.ts`
 * proves Messaging's switched-off state before it writes that activation, so
 * this file runs after it (`playwright.config.ts`) and writes either
 * activation only if nothing has. Identity's and Learning's facts are
 * fixtures; every conversation and message is made through the pages.
 *
 * EVERYTHING IS SYNTHETIC: `NON_REALTIME_FIXTURE` sentinels no other spec
 * looks for.
 */

test.describe.configure({ mode: 'serial', retries: 0 });

let sql: SqlSession;
const contexts: BrowserContext[] = [];

const run = randomUUID().replaceAll('-', '').slice(0, 10);
const SENTINEL = 'NON_REALTIME_FIXTURE';

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
  stranger: `${SENTINEL} stranger ${run}`,
  first: `${SENTINEL}_BODY first ${run}`,
  keyboard: `${SENTINEL}_BODY keyboard ${run}`,
  outage: `${SENTINEL}_BODY outage ${run}`,
  restored: `${SENTINEL}_BODY restored ${run}`,
  probe: `${SENTINEL}_BODY probe ${run}`,
  long: `${SENTINEL}_BODY long ${run}`,
  motion: `${SENTINEL}_BODY motion ${run}`,
} as const;

/** An unbroken token — the reflow hazard, delivered live. */
const LONG_TOKEN = 'y'.repeat(300);

/**
 * How long a page may take to come back on its own after the realtime
 * process does: the island's reconnection ceiling (5 s) with its +50% jitter,
 * plus one handshake and subscription acknowledgement (10 s, the island's own
 * acknowledgement bound). Derived from the client's settings, not padded.
 */
const RECONNECT_BOUND_MS = 5_000 * 1.5 + 10_000;

/* ===========================================================================
 * Page helpers
 * ========================================================================= */

/** The island's connection line. */
function liveStatus(page: Page): Locator {
  return page.getByRole('main').locator('[data-live-status]');
}

/** Every drawn item of one message, found by something it says. */
function itemsSaying(page: Page, text: string): Locator {
  return page.getByRole('main').locator('li[data-message-id]').filter({ hasText: text });
}

/** Server Action submissions a page makes, recorded as they leave. */
function actionPosts(page: Page): Request[] {
  const posts: Request[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.headers()['next-action'] !== undefined)
      posts.push(request);
  });
  return posts;
}

/** Marks the document, so a later check proves it was never reloaded. */
async function markDocument(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.assign(globalThis, { minhajRealtimeMark: true });
  });
}

async function stillSameDocument(page: Page): Promise<boolean> {
  return page.evaluate(() => 'minhajRealtimeMark' in globalThis);
}

const n = (value: string) => `N'${value.replaceAll("'", "''")}'`;

async function scalar(statement: string): Promise<number> {
  const [row] = await sql.query<{ value: number }>(statement);
  return Number(row?.value ?? Number.NaN);
}

function storedMessages(): Promise<number> {
  return scalar(
    `SELECT COUNT_BIG(*) AS [value] FROM [dbo].[Message] WHERE [conversationId]=N'${conversationId}';`,
  );
}

interface Actor {
  readonly page: Page;
  readonly id: string;
  readonly name: string;
  /** Every WebSocket the page opened, to count the live ones. */
  readonly sockets: WebSocket[];
  /** Everything the page wrote to its console. */
  readonly console: string[];
  readonly errors: string[];
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
    extraHTTPHeaders: { 'x-forwarded-for': `100.64.254.${String(index)}` },
  });
  contexts.push(context);
  const page = await context.newPage();
  const sockets: WebSocket[] = [];
  const console: string[] = [];
  const errors: string[] = [];
  page.on('websocket', (socket) => sockets.push(socket));
  page.on('console', (message) => console.push(message.text()));
  page.on('pageerror', (error) => errors.push(error.message));
  const { email } = await registerAndSignIn(page, prefix);
  const id = await accountIdFor(sql, email);
  await sql.query(`UPDATE [dbo].[User] SET [name]=${n(name)} WHERE [id]=N'${id}';`);
  return { page, id, name, sockets, console, errors };
}

/** The page's open transport connections — one, however often it reconnected. */
function openSockets(actor: Actor): number {
  return actor.sockets.filter(
    (socket) => socket.url().includes('/socket.io/') && !socket.isClosed(),
  ).length;
}

/* ===========================================================================
 * Fixture
 * ========================================================================= */

let learner: Actor;
let teacher: Actor;
let stranger: Actor;
let conversationId: string;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  // The harness runs the realtime process for every browser run; a run
  // without it proves nothing here and must say so by failing.
  expect(await isRealtimeRunning(), 'the realtime process is running').toBe(true);
  sql = await privilegedSession();
  learner = await account(browser, 1, 'realtime-learner', TEXT.learner);
  teacher = await account(browser, 2, 'realtime-teacher', TEXT.teacher);
  await grantRole(sql, teacher.id, ['teaching.perform'], `${SENTINEL} teaching`);
  stranger = await account(browser, 3, 'realtime-stranger', TEXT.stranger);
  await seedTeaching(sql, {
    learnerId: learner.id,
    teacherId: teacher.id,
    ids,
    slug: `non-realtime-fixture-${run}`,
    course: TEXT.course,
    module: TEXT.module,
    lesson: TEXT.lesson,
    operator: `${SENTINEL} browser operator`,
  });
  await sql.query(`
    IF NOT EXISTS (SELECT 1 FROM [dbo].[MessagingActivation] WHERE [capability]=N'teacher-student')
      INSERT INTO [dbo].[MessagingActivation] ([capability],[authority],[authorisedBy]) VALUES
        (N'teacher-student', N'fixture', N'${SENTINEL} browser operator');`);
});

test.afterAll(async () => {
  // A failure mid-outage must not leave the run without its realtime process.
  if (!(await isRealtimeRunning())) await startRealtime();
  for (const context of contexts) await context.close();
  await sql?.close();
});

/* ===========================================================================
 * 1. Live, both ways
 * ========================================================================= */

test.describe('a learner and their teacher, live', () => {
  test('a message crosses without a reload, exactly once and through the socket; presence and typing are words', async () => {
    test.setTimeout(300_000);
    const page = learner.page;
    await page.goto('/en/my/teachers');
    await page
      .getByRole('main')
      .getByRole('button', {
        name: copy('messages.start.submit', {
          name: copy('myClasses.teachers.unnamed'),
          course: TEXT.course,
        }),
        exact: true,
      })
      .click();
    await page.waitForURL(/\/en\/my\/messages\/[0-9a-f-]{36}$/);
    conversationId = new URL(page.url()).pathname.split('/').at(-1) ?? '';
    await expect(liveStatus(page)).toHaveText(copy('messages.live.live'));

    await teacher.page.goto(`/en/teacher/messages/${conversationId}`);
    await expect(mainHeading(teacher.page)).toHaveText(TEXT.learner);
    await expect(liveStatus(teacher.page)).toHaveText(copy('messages.live.live'));

    // Presence, in words, on both sides.
    await expect(page.getByRole('main')).toContainText(
      copy('messages.live.online', { name: TEXT.teacher }),
    );
    await expect(teacher.page.getByRole('main')).toContainText(
      copy('messages.live.online', { name: TEXT.learner }),
    );

    await markDocument(page);
    await markDocument(teacher.page);
    const posted = actionPosts(teacher.page);

    // Typing, in words — and never what is being typed.
    await composerBox(teacher.page).click();
    await teacher.page.keyboard.type(TEXT.first);
    const typing = page.getByRole('main').locator('[data-live-typing]');
    await expect(typing).toHaveText(copy('messages.live.typing', { name: TEXT.teacher }));
    await expect(page.getByRole('main')).not.toContainText(TEXT.first);

    await sendButton(teacher.page).click();
    await expect(teacher.page.getByRole('main')).toContainText(
      copy('messages.composer.sent'),
    );
    await expect(messageFrom(teacher.page, copy('messages.you'), TEXT.first)).toHaveCount(
      1,
    );
    await expect(messageFrom(page, TEXT.teacher, TEXT.first)).toHaveCount(1);
    await expect(typing).toHaveCount(0);

    expect(await itemsSaying(page, TEXT.first).count(), 'learner items').toBe(1);
    expect(await itemsSaying(teacher.page, TEXT.first).count(), 'teacher items').toBe(1);
    expect(await stillSameDocument(page), 'the learner never reloaded').toBe(true);
    expect(await stillSameDocument(teacher.page), 'the teacher never reloaded').toBe(
      true,
    );
    expect(posted, 'sent through the socket, not the page').toHaveLength(0);
    await expect(composerBox(teacher.page)).toHaveValue('');
    expect(await storedMessages()).toBe(1);

    // A message that arrived live still leads to its report act, in words.
    await expect(
      messageFrom(page, TEXT.teacher, TEXT.first).getByRole('link', {
        name: copy('messages.live.reportReload'),
        exact: true,
      }),
    ).toHaveAttribute('href', `/en/my/messages/${conversationId}`);
  });

  test('a reply is sent by keyboard alone, and focus stays on Send', async () => {
    test.setTimeout(180_000);
    const page = learner.page;
    const box = composerBox(page);
    await tabTo(page, box);
    await expectVisibleFocus(box, 'the message box');
    await page.keyboard.type(TEXT.keyboard);
    const submit = sendButton(page);
    await tabTo(page, submit);
    await expectVisibleFocus(submit, 'Send');
    await page.keyboard.press('Enter');

    await expect(messageFrom(page, copy('messages.you'), TEXT.keyboard)).toHaveCount(1);
    await expect(messageFrom(teacher.page, TEXT.learner, TEXT.keyboard)).toHaveCount(1);
    await expect(box).toHaveValue('');
    await expect(submit).toBeFocused();
    await expectVisibleFocus(submit, 'Send, after sending');
    expect(await storedMessages()).toBe(2);

    for (const [viewer, where] of [
      [page, 'the learner’s live thread'],
      [teacher.page, 'the teacher’s live thread'],
    ] as const) {
      await expectLabelledControls(viewer, where);
      await expectHeadingsInOrder(viewer, where);
    }
  });
});

/* ===========================================================================
 * 2. The realtime process goes away, and comes back
 * ========================================================================= */

test.describe('when the realtime process stops', () => {
  test('history stays, a message still sends through the page and is stored; on restart it appears exactly once', async () => {
    test.setTimeout(300_000);
    const page = learner.page;
    const box = composerBox(teacher.page);
    await box.click();
    await expect(box).toBeFocused();

    await stopRealtime();
    for (const viewer of [page, teacher.page])
      await expect(liveStatus(viewer)).toHaveText(copy('messages.live.unavailable'));
    // The page is still the page: its history and its composer.
    await expect(messageFrom(page, TEXT.teacher, TEXT.first)).toBeVisible();
    await expect(messageFrom(page, copy('messages.you'), TEXT.keyboard)).toBeVisible();
    await expect(page.getByRole('main')).not.toContainText(
      copy('messages.live.online', { name: TEXT.teacher }),
    );

    // Sent through the Server Action, the same form a page without
    // JavaScript posts.
    const submitted = page.waitForRequest(
      (request) =>
        request.method() === 'POST' &&
        request.headers()['next-action'] !== undefined &&
        (request.postData() ?? '').includes(TEXT.outage),
    );
    await send(page, TEXT.outage);
    await submitted;
    await expect(messageFrom(page, copy('messages.you'), TEXT.outage)).toHaveCount(1);
    expect(await storedMessages()).toBe(3);
    // Nothing can carry it to the teacher while the transport is down.
    await expect(messageFrom(teacher.page, TEXT.learner, TEXT.outage)).toHaveCount(0);

    await startRealtime();
    for (const viewer of [teacher.page, page])
      await expect(liveStatus(viewer)).toHaveText(copy('messages.live.live'), {
        timeout: RECONNECT_BOUND_MS,
      });
    await expect(messageFrom(teacher.page, TEXT.learner, TEXT.outage)).toHaveCount(1);
    expect(await itemsSaying(teacher.page, TEXT.outage).count(), 'teacher items').toBe(1);
    expect(await itemsSaying(page, TEXT.outage).count(), 'learner items').toBe(1);
    // One connection each, however many attempts it took; focus where it was.
    expect(openSockets(teacher), 'the teacher’s connections').toBe(1);
    expect(openSockets(learner), 'the learner’s connections').toBe(1);
    await expect(box).toBeFocused();

    // Live again, both ways, once.
    await send(teacher.page, TEXT.restored);
    await expect(messageFrom(page, TEXT.teacher, TEXT.restored)).toHaveCount(1);
    expect(await itemsSaying(page, TEXT.restored).count()).toBe(1);
    expect(await itemsSaying(teacher.page, TEXT.restored).count()).toBe(1);
    expect(await storedMessages()).toBe(4);
  });
});

/* ===========================================================================
 * 3. Nobody else
 * ========================================================================= */

/** What a raw transport client saw: its acknowledgements by id, and every event frame. */
interface Probe {
  readonly connected: boolean;
  /** The close code, once the socket closed — a refused handshake ends here. */
  readonly closed: number | null;
  readonly acks: Record<string, unknown>;
  readonly events: string[];
}

test.describe('an unrelated account', () => {
  test('reaches nothing — not the page, the catch-up read, nor the socket — and is sent no frame', async () => {
    test.setTimeout(240_000);
    const page = stranger.page;
    const response = await page.goto(`/en/my/messages/${conversationId}`);
    expect(response?.status()).toBe(404);
    await expect(page.locator('body')).not.toContainText(TEXT.first);
    const read = await page
      .context()
      .request.get(`/api/messaging/conversations/${conversationId}/messages?after=0`);
    expect(read.status()).toBe(404);
    expect(await read.json()).toEqual({ status: 'error', failure: 'not-found' });

    // A real, signed-in socket, speaking the protocol by hand — the stranger's
    // own cookie, this origin, asking for someone else's conversation — while
    // the conversation's own people are live.
    expect(await isRealtimeRunning(), 'the realtime process is running').toBe(true);
    await expect(liveStatus(learner.page)).toHaveText(copy('messages.live.live'));
    await page.goto('/en/my');
    await page.evaluate((target) => {
      const probe = {
        connected: false,
        closed: null as number | null,
        acks: {} as Record<string, unknown>,
        events: [] as string[],
      };
      Object.assign(globalThis, { minhajProbe: probe });
      const scheme = globalThis.location.protocol === 'https:' ? 'wss' : 'ws';
      const socket = new WebSocket(
        `${scheme}://${globalThis.location.host}/socket.io/?EIO=4&transport=websocket`,
      );
      Object.assign(globalThis, { minhajProbeSocket: socket });
      socket.addEventListener('close', (event) => {
        probe.closed = event.code;
      });
      socket.addEventListener('message', (event) => {
        const frame = String(event.data);
        if (frame === '2') socket.send('3');
        else if (frame.startsWith('0')) socket.send('40');
        else if (frame.startsWith('40')) {
          probe.connected = true;
          socket.send(`420["conversation:subscribe",{"conversationId":"${target}"}]`);
          socket.send(
            `421["conversation:catch-up",{"conversationId":"${target}","after":0}]`,
          );
          socket.send(`422["typing:set",{"conversationId":"${target}","typing":true}]`);
        } else if (frame.startsWith('43')) {
          const match = /^43(\d+)(.*)$/su.exec(frame);
          if (match !== null) probe.acks[match[1] ?? ''] = JSON.parse(match[2] ?? 'null');
        } else if (frame.startsWith('42')) probe.events.push(frame);
      });
    }, conversationId);
    await page.waitForFunction(() => {
      const probe = (globalThis as unknown as { minhajProbe: Probe }).minhajProbe;
      return Object.keys(probe.acks).length === 3 || probe.closed !== null;
    });
    const answered = await page.evaluate(
      () => (globalThis as unknown as { minhajProbe: Probe }).minhajProbe,
    );
    expect(
      answered.closed,
      'the stranger’s socket was admitted, then refused',
    ).toBeNull();

    // While it listens, the conversation carries a new message to its people.
    await send(teacher.page, TEXT.probe);
    await expect(messageFrom(learner.page, TEXT.teacher, TEXT.probe)).toHaveCount(1);

    const probe = await page.evaluate(() => {
      const global = globalThis as unknown as {
        minhajProbe: Probe;
        minhajProbeSocket: { close(): void };
      };
      global.minhajProbeSocket.close();
      return global.minhajProbe;
    });
    expect(probe.connected).toBe(true);
    // Following it and reading it are the same not-found a missing one gets;
    // signalling typing in it is refused too.
    const refused = [{ ok: false, failure: 'not-found' }];
    expect(probe.acks['0'], 'subscribe').toEqual(refused);
    expect(probe.acks['1'], 'catch-up').toEqual(refused);
    expect(probe.acks['2'], 'typing').toEqual([expect.objectContaining({ ok: false })]);
    expect(Object.keys(probe.acks).sort()).toEqual(['0', '1', '2']);
    expect(probe.events, 'no frame of the conversation').toEqual([]);
    await expect(learner.page.getByRole('main')).not.toContainText(TEXT.stranger);
  });
});

/* ===========================================================================
 * 4. Every locale, every width, no motion, nothing in the console
 * ========================================================================= */

test.describe('the live surfaces', () => {
  test('are right-to-left in Urdu and Arabic and reflow at 320px and 640px around a long message that arrived live', async () => {
    test.setTimeout(600_000);
    const page = learner.page;
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/en/my/messages/${conversationId}`);
    await expect(liveStatus(page)).toHaveText(copy('messages.live.live'));
    await send(teacher.page, `${TEXT.long}\n${LONG_TOKEN}`);
    await expect(messageFrom(page, TEXT.teacher, TEXT.long)).toHaveCount(1);
    await expect(page.getByRole('main').getByText(LONG_TOKEN)).toBeVisible();
    expect(await overflowOf(page), '320px, delivered live').toBeLessThanOrEqual(0);
    await page.setViewportSize({ width: 640, height: 800 });
    expect(await overflowOf(page), '640px, delivered live').toBeLessThanOrEqual(0);

    for (const width of [320, 640])
      for (const locale of ['en', 'ur', 'ar'] as const)
        for (const [viewer, target, other] of [
          [page, `/${locale}/my/messages/${conversationId}`, TEXT.teacher],
          [teacher.page, `/${locale}/teacher/messages/${conversationId}`, TEXT.learner],
        ] as const) {
          const where = `${String(width)}px ${target}`;
          await viewer.setViewportSize({ width, height: 800 });
          expect((await viewer.goto(target))?.status(), where).toBe(200);
          await expect(viewer.locator('html'), where).toHaveAttribute(
            'dir',
            locale === 'en' ? 'ltr' : 'rtl',
          );
          await expect(viewer.locator('html'), where).toHaveAttribute('lang', locale);
          await expect(liveStatus(viewer), where).toHaveText(
            copy('messages.live.live', {}, locale),
          );
          await expect(viewer.getByRole('main'), where).toContainText(
            copy('messages.live.online', { name: other }, locale),
          );
          await expect(
            viewer.getByRole('main').getByText(LONG_TOKEN),
            where,
          ).toBeVisible();
          expect(await overflowOf(viewer), where).toBeLessThanOrEqual(0);
          await expectHeadingsInOrder(viewer, where);
        }
    for (const viewer of [page, teacher.page])
      await viewer.setViewportSize({ width: 1280, height: 800 });
  });

  test('do not move under reduced motion, raise no error, and write no message to the console', async () => {
    test.setTimeout(180_000);
    const page = learner.page;
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/en/my/messages/${conversationId}`);
    await expect(liveStatus(page)).toHaveText(copy('messages.live.live'));
    await teacher.page.goto(`/en/teacher/messages/${conversationId}`);
    await expect(liveStatus(teacher.page)).toHaveText(copy('messages.live.live'));

    // Typing and a live arrival — the moments a page might animate.
    const stillness = async (where: string) => {
      await expect(page.locator('main [class*="animate-"]'), where).toHaveCount(0);
      const running = await page.evaluate(
        () =>
          document
            .getAnimations()
            .filter((animation) => animation.playState === 'running').length,
      );
      expect(running, where).toBe(0);
    };
    await composerBox(teacher.page).click();
    await teacher.page.keyboard.type(TEXT.motion);
    await expect(page.getByRole('main').locator('[data-live-typing]')).toBeVisible();
    await stillness('while the other person types');
    await sendButton(teacher.page).click();
    await expect(messageFrom(page, TEXT.teacher, TEXT.motion)).toHaveCount(1);
    await stillness('as a message arrives');
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    for (const actor of [learner, teacher, stranger]) {
      expect(actor.errors, `${actor.name}: page errors`).toEqual([]);
      const leaked = actor.console.filter((line) => line.includes(SENTINEL));
      expect(leaked, `${actor.name}: console`).toEqual([]);
    }
  });
});
