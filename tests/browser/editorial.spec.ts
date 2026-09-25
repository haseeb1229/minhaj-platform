import { randomUUID } from 'node:crypto';
import type { BrowserContext, Page } from '@playwright/test';
import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import {
  accountIdFor,
  baseUrl,
  expect,
  privilegedSession,
  registerAndSignIn,
  test,
  grantRole,
} from './support';

test.describe.configure({ mode: 'serial' });
let sql: SqlSession;
let contexts: BrowserContext[] = [];
let author: Page, reviewer: Page, publisher: Page;
let articlePath = '',
  pagePath = '';
const slug = 'browser-editorial-' + randomUUID().slice(0, 8);
const renamed = slug + '-renamed';
const title = 'Synthetic editorial browser proof';
async function grant(id: string, keys: readonly string[]) {
  await grantRole(sql, id, keys, 'Editorial browser proof');
}
async function clickSaved(page: Page, name: string) {
  if (name === 'Save triage') {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
    return;
  }
  const next =
    Number(await page.locator('input[name="version"]').first().inputValue()) + 1;
  await page.getByRole('button', { name, exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Version ' + next }),
  ).toBeVisible();
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120000);
  sql = await privilegedSession();
  const pages: Page[] = [];
  const keys = [
    ['content.read', 'content.author', 'content.review'],
    ['content.read', 'content.review'],
    [
      'content.read',
      'content.publish',
      'correspondence.read',
      'correspondence.administer',
    ],
  ];
  for (let index = 0; index < keys.length; index++) {
    const context = await browser.newContext({
      baseURL: baseUrl(),
      extraHTTPHeaders: { 'x-forwarded-for': '100.64.252.' + (index + 1) },
    });
    contexts.push(context);
    const page = await context.newPage();
    pages.push(page);
    const { email } = await registerAndSignIn(page, 'editorial-' + index);
    await grant(await accountIdFor(sql, email), keys[index]!);
  }
  [author, reviewer, publisher] = pages as [Page, Page, Page];
});
test.afterAll(async () => {
  for (const context of contexts) await context.close();
  contexts = [];
  await sql?.close();
});

test('authors, independently approves, schedules, cancels and publishes an Article', async () => {
  await author.goto('/en/admin/editorial/articles/new');
  await author.getByLabel('Canonical slug', { exact: true }).fill(slug);
  await author.locator('#en-title').fill(title);
  const editor = author.getByRole('textbox', { name: 'Body (en)', exact: true });
  await editor.fill('Synthetic non-authoritative body.');
  await editor.press('ControlOrMeta+a');
  await editor.press('ControlOrMeta+b');
  await author.getByRole('button', { name: 'Save revision', exact: true }).click();
  await author.waitForURL(/\/admin\/editorial\/articles\/[0-9a-f-]{36}$/);
  articlePath = new URL(author.url()).pathname;
  await clickSaved(author, 'Submit for review');
  await expect(
    author.getByRole('button', { name: 'Approve revision', exact: true }),
  ).toHaveCount(0);
  await reviewer.goto(articlePath);
  await clickSaved(reviewer, 'Approve revision');
  await expect(
    reviewer.getByRole('button', { name: 'Publish', exact: true }),
  ).toHaveCount(0);
  await publisher.goto(articlePath);
  await publisher
    .getByLabel('Publication instant (UTC)', { exact: true })
    .fill('2040-01-01T00:00:00Z');
  await publisher
    .getByLabel('Display time zone (IANA)', { exact: true })
    .fill('Asia/Karachi');
  await clickSaved(publisher, 'Schedule');
  await clickSaved(publisher, 'Cancel schedule');
  await clickSaved(publisher, 'Publish');
  await expect(publisher.getByText('Published', { exact: false }).first()).toBeVisible();
});
test('reports stale edits and permanently redirects an old slug in one hop', async ({
  browser,
}) => {
  await author.goto(articlePath);
  const second = await contexts[0]!.newPage();
  await second.goto(articlePath);
  await author.getByLabel('Canonical slug', { exact: true }).fill(renamed);
  await author.getByRole('button', { name: 'Save revision', exact: true }).click();
  await expect(author.getByText('Version 7', { exact: false })).toBeVisible();
  await second.locator('#en-title').fill('Stale overwrite must not win');
  await second.getByRole('button', { name: 'Save revision', exact: true }).click();
  await expect(
    second.getByRole('alert').filter({ hasText: 'This record changed.' }),
  ).toBeVisible();
  await second.close();
  await clickSaved(author, 'Submit for review');
  await reviewer.goto(articlePath);
  await clickSaved(reviewer, 'Approve revision');
  await publisher.goto(articlePath);
  await clickSaved(publisher, 'Publish');
  const anon = await browser.newContext({ baseURL: baseUrl() });
  const redirect = await anon.request.get('/ur/library/articles/' + slug, {
    maxRedirects: 0,
  });
  expect(redirect.status()).toBe(301);
  expect(new URL(redirect.headers()['location']!, baseUrl()).href).toBe(
    baseUrl() + '/ur/library/articles/' + renamed,
  );
  expect(
    (
      await anon.request.get('/ur/library/articles/' + renamed, { maxRedirects: 0 })
    ).status(),
  ).toBe(200);
  await anon.close();
});
test('publishes a Page through an independent review workflow', async () => {
  await author.goto('/en/admin/editorial/pages/new');
  await author
    .getByLabel('Page destination', { exact: true })
    .selectOption('help-article');
  await author.getByLabel('Canonical slug', { exact: true }).fill(slug);
  await author.locator('#en-title').fill('Synthetic help browser proof');
  await author
    .getByRole('textbox', { name: 'Body (en)', exact: true })
    .fill('Synthetic help text. Non-authoritative.');
  await author.getByRole('button', { name: 'Save revision', exact: true }).click();
  await author.waitForURL(/\/admin\/editorial\/pages\/[0-9a-f-]{36}$/);
  pagePath = new URL(author.url()).pathname;
  await clickSaved(author, 'Submit for review');
  await reviewer.goto(pagePath);
  await clickSaved(reviewer, 'Approve revision');
  await publisher.goto(pagePath);
  await clickSaved(publisher, 'Publish');
});
test('renders signed-out fallback content with no cookies and the same signed-in body', async ({
  page,
}) => {
  for (const locale of ['en', 'ur', 'ar']) {
    const response = await page.goto('/' + locale + '/library/articles/' + renamed);
    expect(response?.status()).toBe(200);
    expect(response?.headers()['cache-control']).toContain('no-store');
    expect(response?.headers()['set-cookie']).toBeUndefined();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
    if (locale !== 'en') await expect(page.getByRole('status')).toContainText('en');
    const text = await page.getByRole('main').innerText();
    await author.goto('/' + locale + '/library/articles/' + renamed);
    expect(await author.getByRole('main').innerText()).toBe(text);
    expect(await page.context().cookies()).toHaveLength(0);
  }
  await page.goto('/en/help/' + slug);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Synthetic help browser proof',
  );
});
test('accepts private correspondence and restricts triage to the operator', async ({
  page,
}) => {
  await page.goto('/en/contact');
  await page.getByLabel('Name', { exact: true }).fill('Synthetic correspondent');
  await page.getByLabel('Email', { exact: true }).fill('editorial-browser@proof.invalid');
  await page.getByLabel('Subject', { exact: true }).fill('Synthetic private contact');
  await page.getByLabel('Body', { exact: true }).fill('PRIVATE-BROWSER-CORRESPONDENCE');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Your submission was received.');
  await page.goto('/en/feedback');
  await page.getByLabel('Body', { exact: true }).fill('PRIVATE-BROWSER-FEEDBACK');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Your submission was received.');
  await author.goto('/en/admin/editorial/correspondence');
  await expect(
    author.getByText('PRIVATE-BROWSER-CORRESPONDENCE', { exact: true }),
  ).toHaveCount(0);
  await publisher.goto('/en/admin/editorial/correspondence');
  await expect(
    publisher.getByText('PRIVATE-BROWSER-CORRESPONDENCE', { exact: true }),
  ).toBeVisible();
  await publisher.locator('select[name="state"]').last().selectOption('triaged');
  await publisher
    .getByLabel('Private operator note', { exact: true })
    .fill('PRIVATE-BROWSER-NOTE');
  await clickSaved(publisher, 'Save triage');
  expect(
    await (await page.request.get('/en/library/articles/' + renamed)).text(),
  ).not.toContain('PRIVATE-BROWSER-');
});
test('keeps the keyboard editor inside a small RTL viewport without violating CSP', async () => {
  const errors: string[] = [];
  author.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await author.setViewportSize({ width: 320, height: 720 });
  await author.emulateMedia({ reducedMotion: 'reduce' });
  await author.goto('/ur/admin/editorial/articles/new');
  const editor = author.getByRole('textbox', { name: /\(ur\)/ });
  await editor.fill('Synthetic RTL proof');
  await editor.press('ControlOrMeta+b');
  await editor.press('End');
  await expect(author.locator('html')).toHaveAttribute('dir', 'rtl');
  expect(
    await author.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(
    errors.filter((message) =>
      /Content Security Policy|Refused to apply inline style/i.test(message),
    ),
  ).toEqual([]);
});

test('replaces a reserved Page placeholder only after independent publication', async ({
  page,
}) => {
  await page.goto('/en/volunteer');
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText(
    'Synthetic volunteer fixture',
  );
  await author.goto('/en/admin/editorial/pages/new');
  await author.getByLabel('Page destination', { exact: true }).selectOption('/volunteer');
  await author.locator('#en-title').fill('Synthetic volunteer fixture');
  await author
    .getByRole('textbox', { name: 'Body (en)', exact: true })
    .fill('Synthetic engineering fixture. Not organizational guidance.');
  await author.getByRole('button', { name: 'Save revision', exact: true }).click();
  await author.waitForURL(/\/admin\/editorial\/pages\/[0-9a-f-]{36}$/);
  const adminPath = new URL(author.url()).pathname;
  await clickSaved(author, 'Submit for review');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText(
    'Synthetic volunteer fixture',
  );
  await reviewer.goto(adminPath);
  await clickSaved(reviewer, 'Approve revision');
  await publisher.goto(adminPath);
  await clickSaved(publisher, 'Publish');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Synthetic volunteer fixture',
  );
});

test('rejects a cross-origin correspondence Server Action without writing', async ({
  page,
}) => {
  await page.goto('/en/feedback');
  await page.getByLabel('Body', { exact: true }).fill('CROSS-ORIGIN-MUST-NOT-WRITE');
  await page.route('**/en/feedback', async (route) => {
    if (route.request().method() === 'POST')
      await route.continue({
        headers: { ...route.request().headers(), origin: 'https://foreign.invalid' },
      });
    else await route.continue();
  });
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && response.url().endsWith('/en/feedback'),
  );
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  expect((await responsePromise).status()).toBeGreaterThanOrEqual(400);
  const [result] = await sql.query<{ count: number }>(
    "SELECT COUNT(*) AS [count] FROM [Feedback] WHERE [body]=N'CROSS-ORIGIN-MUST-NOT-WRITE';",
  );
  expect(Number(result?.count)).toBe(0);
});
