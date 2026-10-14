import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Browser, BrowserContext, Locator, Page } from '@playwright/test';

import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import {
  BUTTON,
  LABEL,
  PASSWORD,
  accountIdFor,
  baseUrl,
  expect,
  privilegedSession,
  registerAndSignIn,
  test,
} from './support';

/**
 * Phase 21 — Personalisation in a real browser, against the production build.
 *
 * WHAT ONLY A BROWSER CAN PROVE: that a public content page is the SAME
 * document for a signed-in reader and an anonymous one, and sets no cookie,
 * while the private island fills itself in only after hydration; that the
 * island offers a signed-out visitor sign-in with a validated way back; that
 * what a person saves, notes, collects, reads and sets from the public pages
 * arrives on their own `/my` pages — and on nobody else's; that a stale edit
 * is a conflict rather than an overwrite; that history stays off until the
 * person turns it on; that the export downloads their own data; that the
 * `/api/my/*` handlers refuse a request without the intent header, from
 * another origin, or without a session; and that every Phase-21 `/my` page is
 * private, unindexed, right-to-left in Urdu and Arabic, reflows at 320 pixels
 * and at 200% zoom, has an ordered outline and a visible focus, and does not
 * move under reduced motion.
 *
 * ONE SERIAL FILE, BECAUSE IT IS ONE PERSON'S JOURNEY. Each step reads what
 * the one before it saved.
 *
 * EVERYTHING IS SYNTHETIC. One published Work and one published Video carry
 * neutral `Quillwort` titles that no other spec looks for; the accounts are
 * fresh. The Quran corpus is a database-wide SINGLETON owned by
 * `quran.spec.ts`, so this file never creates one: the island on an Ayah page
 * and the reading position it sets are proved there, against that spec's own
 * activated fixture corpus.
 */

test.describe.configure({ mode: 'serial', retries: 0 });

let sql: SqlSession;
const contexts: BrowserContext[] = [];

const run = randomUUID().replaceAll('-', '').slice(0, 10);

const ids = { work: randomUUID(), edition: randomUUID(), video: randomUUID() };
const slug = { work: `quillwort-book-${run}`, video: `quillwort-talk-${run}` };

const TITLE = {
  work: `Quillwort keepsake book ${run}`,
  video: `Quillwort keepsake talk ${run}`,
  collection: `Quillwort shelf ${run}`,
} as const;

/** Words only one account's private text carries. */
const NOTE = `quillnote${run} first private words`;
const NOTE_EDIT = `quillnote${run} edited private words`;
const NOTE_STALE = `quillnote${run} stale private words`;
const OTHER_NOTE = `quillother${run} another person's words`;

const PAGE = {
  work: `/en/library/books/${slug.work}`,
  video: `/en/watch/videos/${slug.video}`,
} as const;

/** A YouTube-shaped identifier of this run's own. */
const PROVIDER_ID = `Qw${run.slice(0, 9)}`;

const MESSAGES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'apps',
  'web',
  'messages',
);

type UiLocale = 'en' | 'ur' | 'ar';
const LOCALES: readonly UiLocale[] = ['en', 'ur', 'ar'];

interface Catalogue {
  readonly personalIsland: Record<string, string>;
  readonly personal: Readonly<
    Record<string, Record<string, string | Record<string, string>>>
  >;
}

const EN = JSON.parse(readFileSync(path.join(MESSAGES, 'en.json'), 'utf8')) as Catalogue;
const ISLAND = EN.personalIsland;

/** One string from the English `personal` catalogue. */
function copy(area: string, key: string): string {
  const value = EN.personal[area]?.[key];
  if (typeof value !== 'string') throw new Error(`No copy personal.${area}.${key}`);
  return value;
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

/** The private island on a public page, once it has asked who is reading. */
function islandOn(page: Page): Locator {
  return page.getByRole('region', { name: ISLAND['heading'] ?? '' });
}

/** The island's Save toggle — ONE label, its state in `aria-pressed`. */
function saveButton(page: Page): Locator {
  return islandOn(page).getByRole('button', { name: ISLAND['save'] ?? '', exact: true });
}

/** Opens a public page and waits for the island to finish its private read. */
async function openWithIsland(page: Page, target: string): Promise<void> {
  const state = page.waitForResponse((response) =>
    response.url().includes('/api/my/target-state'),
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
    extraHTTPHeaders: { 'x-forwarded-for': `100.64.244.${String(index)}` },
  });
  contexts.push(context);
  const page = await context.newPage();
  const { email } = await registerAndSignIn(page, prefix);
  return { page, id: await accountIdFor(sql, email), email };
}

/* ===========================================================================
 * Fixture
 * ========================================================================= */

let owner: Page;
let ownerId: string;
let ownerEmail: string;
let other: Page;
let collectionId: string;

/** Every Phase-21 `/my` route, without its locale. Filled once a collection exists. */
const MY_ROUTES = [
  '/my',
  '/my/saved',
  '/my/saved/bookmarks',
  '/my/saved/notes',
  '/my/saved/collections',
  '/my/history/reading',
  '/my/history/watch',
  '/my/progress/quran',
  '/my/notifications',
  '/my/settings/interests',
  '/my/settings/notifications',
  '/my/settings/privacy',
];

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  sql = await privilegedSession();

  await sql.query(`
    INSERT INTO [dbo].[Work] ([id],[slug],[primaryLocale],[state],[isFeatured],[version],[updatedAt])
      VALUES (N'${ids.work}', N'${slug.work}', N'en', N'published', 0, 1, SYSUTCDATETIME());
    INSERT INTO [dbo].[WorkLabel] ([workId],[locale],[title],[description])
      VALUES (N'${ids.work}', N'en', ${n(TITLE.work)}, N'A neutral fixture.');
    INSERT INTO [dbo].[Edition] ([id],[workId],[languageCode],[label],[state],[isbn],[reading],[download],[downloadAssetId],[document],[contentVersion],[version],[updatedAt])
      VALUES (N'${ids.edition}', N'${ids.work}', N'en', N'Quillwort edition', N'published', NULL, N'unavailable', N'denied', NULL, NULL, NULL, 1, SYSUTCDATETIME());

    INSERT INTO [dbo].[Video] ([id],[slug],[primaryLocale],[state],[isFeatured],[provider],[providerVideoId],[availability],[format],[languageCode],[durationSeconds],[publishedOn],[captions],[transcript],[seriesId],[seriesPosition],[version],[updatedAt])
      VALUES (N'${ids.video}', N'${slug.video}', N'en', N'published', 0, N'youtube', '${PROVIDER_ID}', N'available', N'lecture', N'en', 600, '2030-01-01', 0, NULL, NULL, NULL, 1, SYSUTCDATETIME());
    INSERT INTO [dbo].[VideoLabel] ([videoId],[locale],[title],[description])
      VALUES (N'${ids.video}', N'en', ${n(TITLE.video)}, N'A neutral fixture.');
  `);

  ({
    page: owner,
    id: ownerId,
    email: ownerEmail,
  } = await account(browser, 1, 'personal-owner'));
  ({ page: other } = await account(browser, 2, 'personal-other'));
});

test.afterAll(async () => {
  for (const context of contexts) await context.close();
  await sql?.close();
});

/* ===========================================================================
 * 1. The public page is the same for everybody
 * ========================================================================= */

test.describe('a public page', () => {
  test('is the same document signed in and signed out, and sets no cookie', async ({
    request,
  }) => {
    for (const target of [PAGE.work, PAGE.video]) {
      const anonymous = await request.get(target, { maxRedirects: 0 });
      const signedIn = await owner.context().request.get(target, { maxRedirects: 0 });
      expect(anonymous.status(), target).toBe(200);
      expect(signedIn.status(), target).toBe(200);
      expect(anonymous.headers()['set-cookie'], target).toBeUndefined();
      expect(signedIn.headers()['set-cookie'], target).toBeUndefined();

      // BYTE FOR BYTE. The page carries no nonce, no request id and no
      // per-visitor value, so nothing is normalised away: anything that
      // differed would be the session reaching the shared render.
      const [html, signedInHtml] = [await anonymous.text(), await signedIn.text()];
      expect(html, target).toContain(target.includes('books') ? TITLE.work : TITLE.video);
      expect(signedInHtml === html, `${target} differs signed in`).toBe(true);
      expect(html, target).not.toContain(ownerEmail);
      // The island is server-rendered as an empty frame: no toggle state, no
      // sign-in prompt — both arrive only after hydration.
      expect(html, target).not.toContain('aria-pressed');
      expect(html, target).not.toContain(`>${ISLAND['signedOutPrompt'] ?? ''}<`);
    }
  });

  test('invites a signed-out visitor to sign in, and brings them back', async ({
    page,
  }) => {
    await openWithIsland(page, PAGE.work);
    const island = islandOn(page);
    await expect(island).toContainText(ISLAND['signedOutPrompt'] ?? '');
    const link = island.getByRole('link', { name: ISLAND['signIn'] });
    await expect(link).toHaveAttribute(
      'href',
      `/en/signin?returnTo=${encodeURIComponent(PAGE.work)}`,
    );
    await expect(island.getByRole('button')).toHaveCount(0);

    // The return path survives sign-in: the reader lands back on the book,
    // and the island now offers what a signed-in reader can do.
    await link.click();
    await page.waitForURL(/\/en\/signin\?returnTo=/);
    await page.getByLabel(LABEL.email).fill(ownerEmail);
    await page.getByLabel(LABEL.password, { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: BUTTON.signIn, exact: true }).click();
    await page.waitForURL(`**${PAGE.work}`);
    await expect(saveButton(page)).toBeVisible();
    await expect(saveButton(page)).toHaveAttribute('aria-pressed', 'false');
  });
});

/* ===========================================================================
 * 2. One person's journey
 * ========================================================================= */

test.describe('a signed-in reader', () => {
  test('the landing invites the optional interests, and nothing is saved yet', async () => {
    await owner.goto('/en/my');
    const main = owner.getByRole('main');
    await expect(main.getByRole('heading', { level: 2 })).toContainText([
      copy('home', 'onboardingHeading'),
      copy('home', 'notificationsHeading'),
      copy('home', 'quranHeading'),
      copy('home', 'savedHeading'),
    ]);
    await expect(main).toContainText(copy('saved', 'empty'));
    await expect(main).toContainText(copy('home', 'quranNone'));
    // History is off, so the landing shows no history panel at all.
    await expect(main).not.toContainText(copy('home', 'historyHeading'));
  });

  test('saves a book and finds it under bookmarks', async () => {
    await openWithIsland(owner, PAGE.work);
    const save = saveButton(owner);
    await expect(save).toHaveAttribute('aria-pressed', 'false');
    await save.click();
    await expect(owner.getByText(ISLAND['savedStatus'] ?? '')).toBeVisible();
    await expect(save).toHaveAttribute('aria-pressed', 'true');

    await owner.goto('/en/my/saved/bookmarks');
    const list = owner.getByRole('list', { name: copy('bookmarks', 'list') });
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(list.getByRole('link', { name: TITLE.work })).toHaveAttribute(
      'href',
      PAGE.work,
    );

    // A reload still knows: the state is the server's, not the tab's.
    await openWithIsland(owner, PAGE.work);
    await expect(saveButton(owner)).toHaveAttribute('aria-pressed', 'true');
  });

  test('a note added on the page is listed, edited under its version, and a stale edit is refused', async () => {
    await openWithIsland(owner, PAGE.work);
    const island = islandOn(owner);
    await island.getByText(ISLAND['noteAdd'] ?? '').click();
    await island.getByRole('textbox', { name: ISLAND['noteLabel'] }).fill(NOTE);
    await island.getByRole('button', { name: ISLAND['noteSave'] }).click();
    await expect(owner.getByText(ISLAND['noteSaved'] ?? '')).toBeVisible();

    await owner.goto('/en/my/saved/notes');
    const list = owner.getByRole('list', { name: copy('notes', 'list') });
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(list).toContainText(NOTE);
    await expect(list.getByRole('link', { name: TITLE.work })).toBeVisible();

    // TWO TABS read version 1. The first edit wins; the second is a conflict.
    const stale = await owner.context().newPage();
    await stale.goto('/en/my/saved/notes');

    await owner.getByText(copy('notes', 'edit')).click();
    const box = owner.getByRole('textbox', { name: copy('notes', 'label'), exact: true });
    await box.fill(NOTE_EDIT);
    await owner.getByRole('button', { name: copy('notes', 'save') }).click();
    await expect(owner.getByText(copy('notes', 'saved'))).toBeVisible();

    await stale.getByText(copy('notes', 'edit')).click();
    await stale
      .getByRole('textbox', { name: copy('notes', 'label'), exact: true })
      .fill(NOTE_STALE);
    await stale.getByRole('button', { name: copy('notes', 'save') }).click();
    await expect(stale.getByRole('main').getByRole('alert')).toHaveText(
      copy('notes', 'conflict'),
    );
    await stale.close();

    const [row] = await sql.query<{ body: string; version: number }>(
      `SELECT n.[body], n.[version] FROM [dbo].[Note] n JOIN [dbo].[SavedItem] s ON s.[id]=n.[savedItemId] WHERE s.[userId]=N'${ownerId}';`,
    );
    expect(row?.body).toBe(NOTE_EDIT);
    expect(Number(row?.version)).toBe(2);

    await owner.goto('/en/my/saved/notes');
    await expect(owner.getByRole('main')).toContainText(NOTE_EDIT);
    await expect(owner.getByRole('main')).not.toContainText(NOTE_STALE);
  });

  test('a private collection is made, filled from the pages, reordered by keyboard and pared down', async () => {
    test.setTimeout(120_000);
    await owner.goto('/en/my/saved/collections');
    await expect(owner.getByRole('main')).toContainText(copy('collections', 'empty'));
    await owner
      .getByRole('textbox', { name: copy('collections', 'titleLabel') })
      .fill(TITLE.collection);
    await owner
      .getByRole('button', { name: copy('collections', 'createSubmit') })
      .click();
    await owner.waitForURL(/\/en\/my\/saved\/collections\/[0-9a-f-]{36}$/);
    collectionId = owner.url().split('/').at(-1) ?? '';
    await expect(owner.getByRole('heading', { level: 1 })).toHaveText(TITLE.collection);
    await expect(owner.getByRole('main')).toContainText(copy('collection', 'empty'));

    // Filled from the public pages' own islands: the book first, then the talk.
    for (const target of [PAGE.work, PAGE.video]) {
      await openWithIsland(owner, target);
      const island = islandOn(owner);
      await island.getByText(ISLAND['collections'] ?? '').click();
      const box = island.getByRole('checkbox', { name: TITLE.collection });
      await expect(box).not.toBeChecked();
      // A CLICK, not `check()`: the box mirrors the server's answer, so it
      // turns checked only once the addition is confirmed.
      await box.click();
      await expect(owner.getByText(ISLAND['collectionAdded'] ?? '')).toBeVisible();
      await expect(box).toBeChecked();
    }

    const detail = `/en/my/saved/collections/${collectionId}`;
    await owner.goto(detail);
    const members = owner
      .getByRole('list', { name: copy('collection', 'members') })
      .getByRole('listitem');
    await expect(members).toHaveCount(2);
    await expect(members.nth(0)).toContainText(TITLE.work);
    await expect(members.nth(1)).toContainText(TITLE.video);
    // The first has nothing above it and the last nothing below it.
    await expect(
      members.nth(0).getByRole('button', { name: copy('collection', 'moveUp') }),
    ).toHaveCount(0);
    await expect(
      members.nth(1).getByRole('button', { name: copy('collection', 'moveDown') }),
    ).toHaveCount(0);

    // BY KEYBOARD ALONE: Tab to "Move down" on the first, and press Enter.
    const down = members
      .nth(0)
      .getByRole('button', { name: copy('collection', 'moveDown') });
    await tabTo(owner, down);
    await expectVisibleFocus(down, 'Move down');
    await owner.keyboard.press('Enter');
    await expect(members.nth(0)).toContainText(TITLE.video);
    await expect(members.nth(1)).toContainText(TITLE.work);

    await members
      .nth(1)
      .getByRole('button', { name: copy('collection', 'removeMember') })
      .click();
    await expect(members).toHaveCount(1);
    await expect(members.nth(0)).toContainText(TITLE.video);

    // The book's bookmark outlives its removal from the list.
    await owner.goto('/en/my/saved/bookmarks');
    await expect(owner.getByRole('link', { name: TITLE.work })).toBeVisible();
  });

  test('history stays off until turned on, then records what is read and watched', async () => {
    test.setTimeout(120_000);
    await owner.goto('/en/my/history/reading');
    const main = owner.getByRole('main');
    await expect(main).toContainText(copy('history', 'off'));
    await expect(main).toContainText(copy('history', 'readingEmpty'));

    // OFF: opening the book sends nothing.
    const sent: string[] = [];
    owner.on('request', (request) => {
      if (request.url().includes('/api/my/history')) sent.push(request.method());
    });
    await openWithIsland(owner, PAGE.work);
    await expect(saveButton(owner)).toBeVisible();
    expect(sent).toEqual([]);
    expect(
      await scalar(
        `SELECT COUNT_BIG(*) AS [value] FROM [dbo].[ReadingHistory] WHERE [userId]=N'${ownerId}';`,
      ),
    ).toBe(0);

    await owner.goto('/en/my/settings/privacy');
    await expect(owner.getByRole('main')).toContainText(copy('privacy', 'historyOff'));
    await owner.getByRole('button', { name: copy('privacy', 'turnOn') }).click();
    await expect(owner.getByRole('main')).toContainText(copy('privacy', 'historyOn'));
    await expect(
      owner.getByRole('button', { name: copy('privacy', 'turnOff') }),
    ).toBeVisible();

    // ON: one record per visit, after render, for the person's own eyes.
    for (const target of [PAGE.work, PAGE.video]) {
      const recorded = owner.waitForResponse(
        (response) =>
          response.url().endsWith('/api/my/history') &&
          response.request().method() === 'POST',
      );
      await openWithIsland(owner, target);
      expect((await recorded).status(), target).toBe(204);
    }

    await owner.goto('/en/my/history/reading');
    await expect(main).not.toContainText(copy('history', 'off'));
    const reading = owner.getByRole('list', { name: copy('history', 'readingList') });
    await expect(reading.getByRole('link', { name: TITLE.work })).toHaveAttribute(
      'href',
      PAGE.work,
    );
    await owner.goto('/en/my/history/watch');
    const watching = owner.getByRole('list', { name: copy('history', 'watchList') });
    await expect(watching.getByRole('link', { name: TITLE.video })).toHaveAttribute(
      'href',
      PAGE.video,
    );
  });

  test('no Quran reading position is shown until one is set', async () => {
    // Setting one needs an active Quran corpus, a database-wide singleton that
    // quran.spec.ts owns; that spec proves the Ayah journey against it.
    await owner.goto('/en/my/progress/quran');
    const main = owner.getByRole('main');
    await expect(main).toContainText(copy('progress', 'empty'));
    await expect(
      main.getByRole('link', { name: copy('progress', 'browse') }),
    ).toHaveAttribute('href', '/en/quran');
    await expect(
      owner.getByRole('button', { name: copy('progress', 'clear') }),
    ).toHaveCount(0);
  });

  test('the interests can be skipped, and answered later', async () => {
    await owner.goto('/en/my/settings/interests');
    const main = owner.getByRole('main');
    const state = EN.personal['interests']?.['state'] as Record<string, string>;
    await expect(main).toContainText(state['none'] ?? '');
    await owner.getByRole('button', { name: copy('interests', 'skip') }).click();
    await expect(main).toContainText(state['skipped'] ?? '');
    // Skipped is a complete answer: the skip offer is gone.
    await expect(
      owner.getByRole('button', { name: copy('interests', 'skip') }),
    ).toHaveCount(0);

    await owner.goto('/en/my');
    await expect(owner.getByRole('main')).not.toContainText(
      copy('home', 'onboardingHeading'),
    );

    await owner.goto('/en/my/settings/interests');
    const interest = EN.personal['interests']?.['interest'] as Record<string, string>;
    const goal = EN.personal['interests']?.['goal'] as Record<string, string>;
    await owner.getByLabel(interest['quran'] ?? '', { exact: true }).check();
    await owner.getByLabel(goal['read-quran-regularly'] ?? '', { exact: true }).check();
    await owner
      .getByRole('button', { name: copy('interests', 'save'), exact: true })
      .click();
    await expect(owner.getByText(copy('interests', 'saved'))).toBeVisible();
    await expect(main).toContainText(state['completed'] ?? '');

    await owner.goto('/en/my');
    const sections = owner.getByRole('navigation', {
      name: copy('home', 'sectionsHeading'),
    });
    await expect(sections.getByRole('link', { name: interest['quran'] })).toHaveAttribute(
      'href',
      '/en/quran',
    );
  });

  test('a notification category is turned off and on again', async () => {
    await owner.goto('/en/my/settings/notifications');
    const list = owner.getByRole('list', { name: copy('notificationSettings', 'list') });
    const category = EN.personal['notificationSettings']?.['category'] as Record<
      string,
      string
    >;
    const row = list.getByRole('listitem').filter({ hasText: category['questions'] });
    await expect(row).toContainText(copy('notificationSettings', 'on'));
    await row
      .getByRole('button', { name: copy('notificationSettings', 'turnOff') })
      .click();
    await expect(
      row.getByRole('button', { name: copy('notificationSettings', 'turnOn') }),
    ).toBeVisible();
    await expect(row).toContainText(copy('notificationSettings', 'off'));
    await row
      .getByRole('button', { name: copy('notificationSettings', 'turnOn') })
      .click();
    await expect(
      row.getByRole('button', { name: copy('notificationSettings', 'turnOff') }),
    ).toBeVisible();

    await owner.goto('/en/my/notifications');
    await expect(owner.getByRole('main')).toContainText(copy('notifications', 'empty'));
  });

  test('the landing shows what this person saved and read', async () => {
    await owner.goto('/en/my');
    const main = owner.getByRole('main');
    const saved = main.getByRole('list', { name: copy('home', 'savedHeading') });
    await expect(saved.getByRole('link', { name: TITLE.work })).toBeVisible();
    await expect(main).toContainText(copy('home', 'historyHeading'));
    const reading = main.getByRole('list', {
      name: EN.personal['nav']?.['reading'] as string,
    });
    await expect(reading.getByRole('link', { name: TITLE.work })).toBeVisible();
    const watch = main.getByRole('list', {
      name: EN.personal['nav']?.['watch'] as string,
    });
    await expect(watch.getByRole('link', { name: TITLE.video })).toBeVisible();
    await expect(main).toContainText(
      (EN.personal['notifications']?.['unreadCount'] as string).replace('{count}', '0'),
    );
  });
});

/* ===========================================================================
 * 3. Another person sees none of it, and the handlers refuse what they must
 * ========================================================================= */

test.describe('another account', () => {
  test('cannot open the collection, and lists nothing of the first person’s', async () => {
    const response = await other.goto(`/en/my/saved/collections/${collectionId}`);
    expect(response?.status()).toBe(404);
    await expect(other.locator('body')).not.toContainText(TITLE.collection);

    for (const [target, empty] of [
      ['/en/my/saved/bookmarks', copy('bookmarks', 'empty')],
      ['/en/my/saved/notes', copy('notes', 'empty')],
      ['/en/my/saved/collections', copy('collections', 'empty')],
      ['/en/my/history/reading', copy('history', 'readingEmpty')],
    ] as const) {
      await other.goto(target);
      const main = other.getByRole('main');
      await expect(main, target).toContainText(empty);
      await expect(main, target).not.toContainText(TITLE.work);
      await expect(main, target).not.toContainText(TITLE.collection);
    }

    // NOT EVEN BY NAMING IT: adding to somebody else's collection is "not
    // found", exactly as an id that does not exist.
    const foreign = await other.context().request.post('/api/my/collection-items', {
      headers: intentHeaders(),
      data: {
        action: 'add',
        collectionId,
        target: { kind: 'work', id: ids.work },
        expectedVersion: 1,
      },
    });
    expect(foreign.status()).toBe(404);
    expect(await foreign.json()).toEqual({ ok: false, failure: 'not-found' });

    // Their island knows nothing of the first person's choices.
    await openWithIsland(other, PAGE.work);
    await expect(saveButton(other)).toHaveAttribute('aria-pressed', 'false');
    const island = islandOn(other);
    await island.getByText(ISLAND['collections'] ?? '').click();
    await expect(island).toContainText(ISLAND['collectionsEmpty'] ?? '');

    // Their own note, for the export proof below.
    const note = await other.context().request.post('/api/my/notes', {
      headers: intentHeaders(),
      data: {
        action: 'write',
        target: { kind: 'work', id: ids.work },
        body: OTHER_NOTE,
        expectedVersion: 0,
      },
    });
    expect(note.status()).toBe(200);
  });

  test('the personal handlers refuse a missing intent, another origin and no session', async ({
    request,
  }) => {
    const body = { action: 'add', target: { kind: 'video', id: ids.video } };
    const post = (headers: Record<string, string>) =>
      owner.context().request.post('/api/my/bookmarks', { headers, data: body });

    for (const [why, headers] of [
      ['no intent header', { origin: baseUrl() }],
      ['a foreign origin', { ...intentHeaders(), origin: 'https://elsewhere.invalid' }],
      ['no origin', { 'x-minhaj-intent': 'personal' }],
      ['a cross-site fetch', { ...intentHeaders(), 'sec-fetch-site': 'cross-site' }],
    ] as const) {
      const response = await post(headers);
      expect(response.status(), why).toBe(403);
      expect(await response.json(), why).toEqual({ ok: false, failure: 'denied' });
      expect(response.headers()['cache-control'], why).toContain('no-store');
    }

    // No session: refused as such, after the same-origin checks pass.
    const anonymous = await request.post('/api/my/bookmarks', {
      headers: intentHeaders(),
      data: body,
    });
    expect(anonymous.status()).toBe(401);
    expect(await anonymous.json()).toEqual({ ok: false, failure: 'no-session' });
    const export_ = await request.get('/api/my/export');
    expect(export_.status()).toBe(401);
    const crossSite = await owner
      .context()
      .request.get('/api/my/export', { headers: { 'sec-fetch-site': 'cross-site' } });
    expect(crossSite.status()).toBe(403);

    // Signed out, the island's read is an answer rather than an error.
    const state = await request.get(`/api/my/target-state?kind=work&id=${ids.work}`);
    expect(state.status()).toBe(200);
    expect(await state.json()).toEqual({ signedIn: false });
    expect(state.headers()['cache-control']).toBe('private, no-store');

    // Nothing above changed anything: the video was never bookmarked.
    expect(
      await scalar(
        `SELECT COUNT_BIG(*) AS [value] FROM [dbo].[Bookmark] b JOIN [dbo].[SavedItem] s ON s.[id]=b.[savedItemId] WHERE s.[userId]=N'${ownerId}' AND s.[videoId]=N'${ids.video}';`,
      ),
    ).toBe(0);

    // ...and the same request, admitted, works — so the refusals are not vacuous.
    const admitted = await post(intentHeaders());
    expect(admitted.status()).toBe(200);
    expect(await admitted.json()).toEqual({ ok: true });
    const removed = await owner.context().request.post('/api/my/bookmarks', {
      headers: intentHeaders(),
      data: { ...body, action: 'remove' },
    });
    expect(removed.status()).toBe(200);
  });

  test('the export downloads this person’s own data, privately', async () => {
    const response = await owner.context().request.get('/api/my/export');
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers['cache-control']).toBe('private, no-store');
    expect(headers['x-robots-tag']).toBe('noindex');
    expect(headers['content-type']).toContain('application/json');
    expect(headers['content-disposition']).toMatch(
      /^attachment; filename="minhaj-personal-data-\d{4}-\d{2}-\d{2}\.json"$/,
    );

    // Through the page's own link, as a download.
    await owner.goto('/en/my/settings/privacy');
    const [download] = await Promise.all([
      owner.waitForEvent('download'),
      owner.getByRole('link', { name: copy('privacy', 'exportLink') }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^minhaj-personal-data-.*\.json$/);
    const file = await download.path();
    const document = JSON.parse(readFileSync(file, 'utf8')) as {
      schema: string;
      version: number;
      settings: { historyEnabled: boolean };
      bookmarks: { target: { kind: string; id?: string } }[];
      notes: { target: { kind: string; id?: string }; body: string }[];
      collections: { title: string; members: unknown[] }[];
    };
    expect(document.schema).toBe('minhaj.personalisation.export');
    expect(document.version).toBe(1);
    expect(document.settings.historyEnabled).toBe(true);
    expect(document.bookmarks.map((entry) => entry.target)).toContainEqual({
      kind: 'work',
      id: ids.work,
    });
    expect(document.notes).toHaveLength(1);
    expect(document.notes[0]?.body).toBe(NOTE_EDIT);
    expect(document.collections.map((entry) => entry.title)).toEqual([TITLE.collection]);

    // Nobody else's data — not the other account's note on the same book,
    // and no identity detail at all.
    const raw = JSON.stringify(document);
    expect(raw).not.toContain(OTHER_NOTE);
    expect(raw).not.toContain(ownerEmail);
    expect(raw).not.toContain(PASSWORD);
  });
});

/* ===========================================================================
 * 4. Every Phase-21 `/my` page
 * ========================================================================= */

test.describe('every Phase-21 My Minhaj page', () => {
  const routes = () => [...MY_ROUTES, `/my/saved/collections/${collectionId}`];

  test('sends a signed-out visitor to sign in, with the way back', async ({ page }) => {
    test.setTimeout(120_000);
    for (const route of routes()) {
      await page.goto(`/en${route}`);
      await page.waitForURL(/\/en\/signin\?/);
      const url = new URL(page.url());
      expect(`${url.pathname}${url.search}`, route).toBe(
        `/en/signin?returnTo=${encodeURIComponent(`/en${route}`)}`,
      );
    }
  });

  test('is private, unindexed, focusable and keyboard-reachable', async () => {
    test.setTimeout(180_000);
    await owner.setViewportSize({ width: 1280, height: 800 });
    for (const route of routes()) {
      const target = `/en${route}`;
      const response = await owner.context().request.get(target, { maxRedirects: 0 });
      expect(response.status(), target).toBe(200);
      const cache = response.headers()['cache-control'] ?? '';
      expect(cache, target).toContain('private');
      expect(cache, target).toContain('no-store');
      expect(response.headers()['set-cookie'], target).toBeUndefined();

      await owner.goto(target);
      await expect(owner.locator('meta[name="robots"]'), target).toHaveAttribute(
        'content',
        /noindex/,
      );
      const first = owner
        .getByRole('main')
        .locator('a[href], button, input:not([type="hidden"]), textarea, select, summary')
        .first();
      await tabTo(owner, first);
      await expectVisibleFocus(first, target);
    }
  });

  test('renders in every locale, right-to-left where it should, and reflows', async () => {
    test.setTimeout(420_000);
    // 640 CSS pixels is a 1280-pixel window at 200% zoom.
    for (const width of [320, 640]) {
      await owner.setViewportSize({ width, height: 800 });
      for (const locale of LOCALES)
        for (const route of routes()) {
          const target = `/${locale}${route}`;
          const response = await owner.goto(target);
          expect(response?.status(), target).toBe(200);
          await expect(owner.locator('html'), target).toHaveAttribute(
            'dir',
            locale === 'en' ? 'ltr' : 'rtl',
          );
          await expect(owner.locator('html'), target).toHaveAttribute('lang', locale);
          expect(
            await overflowOf(owner),
            `${String(width)}px ${target}`,
          ).toBeLessThanOrEqual(0);
          await expectHeadingsInOrder(owner, `${String(width)}px ${target}`);
        }
    }
    await owner.setViewportSize({ width: 1280, height: 800 });
  });

  test('nothing moves under reduced motion', async () => {
    await owner.emulateMedia({ reducedMotion: 'reduce' });
    for (const target of [
      '/en/my',
      `/en/my/saved/collections/${collectionId}`,
      '/en/my/settings/privacy',
    ]) {
      await owner.goto(target);
      await expect(owner.getByRole('heading', { level: 1 })).toBeVisible();
      const motion = await owner.evaluate(() => ({
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

    // Still fully usable: the island works under the same preference.
    await openWithIsland(owner, PAGE.video);
    const save = saveButton(owner);
    await save.click();
    await expect(save).toHaveAttribute('aria-pressed', 'true');
    await save.click();
    await expect(save).toHaveAttribute('aria-pressed', 'false');
    await owner.emulateMedia({ reducedMotion: 'no-preference' });
  });
});
