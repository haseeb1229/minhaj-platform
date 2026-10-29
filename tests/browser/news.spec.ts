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

/**
 * Phase 13 — News in a real browser, against the application under test.
 *
 * WHAT ONLY A BROWSER CAN SHOW, and nothing the SQL and Search proofs already
 * establish: the administrative forms author each family through the shared
 * workflow with the fields that family owns and the refusals it deserves; the
 * public News and Events surfaces render every family, the archive and the
 * photograph links for an anonymous visitor with no cookie, and the same body
 * for a signed-in one; a coverage record's source is a described outbound link
 * and never an embed; the static `/news` routes are never shadowed; a former
 * slug is one 301; and Urdu reads right to left at 320 pixels and at 200% zoom
 * with no horizontal scroll.
 *
 * EVERYTHING IS SYNTHETIC. Titles say they are fixtures; every address is
 * `.invalid`.
 */

test.describe.configure({ mode: 'serial' });

let sql: SqlSession;
let contexts: BrowserContext[] = [];
let author: Page, reviewer: Page, publisher: Page;
const run = randomUUID().slice(0, 8);
const slugs = {
  news: `browser-news-${run}`,
  statement: `browser-statement-${run}`,
  statementRenamed: `browser-statement-${run}-renamed`,
  coverage: `browser-coverage-${run}`,
};
const TITLE = {
  news: `Synthetic browser news ${run}`,
  statement: `Synthetic browser statement ${run}`,
  coverage: `Synthetic browser coverage ${run}`,
};
const ISSUER = 'Synthetic Browser Issuing Office';
const OUTLET = 'Synthetic Browser Outlet';
const SOURCE = `https://coverage-${run}.example.invalid/story`;
const paths: Record<string, string> = {};

async function grant(id: string, keys: readonly string[]) {
  await grantRole(sql, id, keys, 'News browser proof');
}

/** Presses a workflow button and waits for the version it produces. */
async function clickSaved(page: Page, name: string) {
  const next =
    Number(await page.locator('input[name="version"]').first().inputValue()) + 1;
  await page.getByRole('button', { name, exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Version ' + next }),
  ).toBeVisible();
}

/** Submit, approve by another person, publish by a third. */
async function throughWorkflow(path: string) {
  await author.goto(path);
  await clickSaved(author, 'Submit for review');
  await expect(
    author.getByRole('button', { name: 'Approve revision', exact: true }),
  ).toHaveCount(0);
  await reviewer.goto(path);
  await clickSaved(reviewer, 'Approve revision');
  await publisher.goto(path);
  await clickSaved(publisher, 'Publish');
}

async function saveNew(page: Page, segment: string, fill: () => Promise<void>) {
  await page.goto(`/en/admin/editorial/${segment}/new`);
  await fill();
  await page.getByRole('button', { name: 'Save revision', exact: true }).click();
  await page.waitForURL(new RegExp(`/admin/editorial/${segment}/[0-9a-f-]{36}$`));
  return new URL(page.url()).pathname;
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120000);
  sql = await privilegedSession();
  const pages: Page[] = [];
  const keys = [
    ['content.read', 'content.author'],
    ['content.read', 'content.review'],
    ['content.read', 'content.publish'],
  ];
  for (let index = 0; index < keys.length; index++) {
    const context = await browser.newContext({
      baseURL: baseUrl(),
      extraHTTPHeaders: { 'x-forwarded-for': '100.64.253.' + (index + 1) },
    });
    contexts.push(context);
    const page = await context.newPage();
    pages.push(page);
    const { email } = await registerAndSignIn(page, 'news-' + index);
    await grant(await accountIdFor(sql, email), keys[index]!);
  }
  [author, reviewer, publisher] = pages as [Page, Page, Page];
});

test.afterAll(async () => {
  for (const context of contexts) await context.close();
  contexts = [];
  await sql?.close();
});

test('authors each family through the shared workflow, refusing what does not belong', async () => {
  test.setTimeout(180000);
  // A NewsArticle may not claim a static /news sibling.
  await author.goto('/en/admin/editorial/news/new');
  await expect(
    author.getByText('A news slug cannot be archive', { exact: false }),
  ).toBeVisible();
  await author.getByLabel('Canonical slug', { exact: true }).fill('archive');
  await author.locator('#en-title').fill(TITLE.news);
  await author
    .getByRole('textbox', { name: 'Body (en)', exact: true })
    .fill('Synthetic non-authoritative news body.');
  await author.getByRole('button', { name: 'Save revision', exact: true }).click();
  await expect(
    author.getByRole('alert').filter({ hasText: 'Check the fields' }),
  ).toBeVisible();
  await author.getByLabel('Canonical slug', { exact: true }).fill(slugs.news);
  await author.getByRole('button', { name: 'Save revision', exact: true }).click();
  await author.waitForURL(/\/admin\/editorial\/news\/[0-9a-f-]{36}$/);
  paths['news'] = new URL(author.url()).pathname;
  await throughWorkflow(paths['news']);

  // A Statement names its issuing authority.
  paths['statement'] = await saveNew(author, 'statements', async () => {
    await author.getByLabel('Canonical slug', { exact: true }).fill(slugs.statement);
    await author.locator('#en-title').fill(TITLE.statement);
    await author.getByLabel('Issuing authority', { exact: true }).first().fill(ISSUER);
    await author
      .getByRole('textbox', { name: 'Body (en)', exact: true })
      .fill('Synthetic non-authoritative statement body.');
  });
  await throughWorkflow(paths['statement']);

  // A coverage source must be a safe HTTPS address.
  await author.goto('/en/admin/editorial/media-coverage/new');
  await author.getByLabel('Canonical slug', { exact: true }).fill(slugs.coverage);
  await author.locator('#en-title').fill(TITLE.coverage);
  await author.getByLabel('Outlet', { exact: true }).fill(OUTLET);
  await author
    .getByLabel('Source address (HTTPS, optional)', { exact: true })
    .fill('javascript:alert(1)');
  await author
    .getByLabel('Date of coverage (optional)', { exact: true })
    .fill('2031-05-06');
  await author
    .getByRole('textbox', { name: 'Body (en)', exact: true })
    .fill('Synthetic summary of another outlet’s coverage, in our own words.');
  await author.getByRole('button', { name: 'Save revision', exact: true }).click();
  await expect(
    author.getByRole('alert').filter({ hasText: 'Check the fields' }),
  ).toBeVisible();
  await author
    .getByLabel('Source address (HTTPS, optional)', { exact: true })
    .fill(SOURCE);
  await author.getByRole('button', { name: 'Save revision', exact: true }).click();
  await author.waitForURL(/\/admin\/editorial\/media-coverage\/[0-9a-f-]{36}$/);
  paths['coverage'] = new URL(author.url()).pathname;
  await throughWorkflow(paths['coverage']);

  // The shared queue holds every family's records awaiting review.
  await reviewer.goto('/en/admin/editorial/queue');
  for (const heading of ['News', 'Press releases', 'Statements', 'Media coverage'])
    await expect(
      reviewer.getByRole('heading', { name: heading, exact: true }),
    ).toBeVisible();
});

test('shows News and Events to an anonymous visitor with no cookie, and the same body signed in', async ({
  page,
}) => {
  const external: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(baseUrl())) external.push(request.url());
  });
  const response = await page.goto('/en/news');
  expect(response?.status()).toBe(200);
  expect(response?.headers()['set-cookie']).toBeUndefined();
  const main = page.getByRole('main');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('News and Events');
  await expect(main.getByRole('link', { name: TITLE.news })).toBeVisible();
  await expect(main.getByRole('link', { name: TITLE.statement })).toBeVisible();
  await expect(main.getByRole('link', { name: TITLE.coverage })).toBeVisible();
  for (const href of [
    '/en/news/press-releases',
    '/en/news/statements',
    '/en/news/media-coverage',
    '/en/news/archive',
    '/en/media/photos',
    '/en/media/galleries',
    '/en/media/archive',
  ])
    await expect(main.locator(`a[href="${href}"]`).first()).toBeVisible();
  // Events (Phase 14) are linked as the other half of News and Events.
  await expect(main.locator('a[href="/en/events"]').first()).toBeVisible();
  // Nothing that does not exist is linked. The newsletter is delivered by
  // Phase 21 and reached from the footer and Explore, not from News.
  await expect(main.locator('a[href="/en/newsletter"]')).toHaveCount(0);
  await expect(page.locator('a[href^="/rss"]')).toHaveCount(0);
  // No picture in the content: these synthetic stories carry no lead image.
  // (Phase 30-R: the shell's official brand lockup is the page's only picture.)
  await expect(main.locator('img')).toHaveCount(0);
  await expect(page.locator('header img')).toHaveAttribute(
    'alt',
    'Minhaj-ul-Quran International',
  );
  // The primary navigation now leads here.
  await expect(
    page
      .getByRole('navigation', { name: 'Main navigation' })
      .locator('a[href="/en/news"]'),
  ).toBeVisible();

  // `?sort=latest` is the same resource, never a path of its own.
  expect((await page.goto('/en/news?sort=latest'))?.status()).toBe(200);
  expect((await page.request.get('/en/news/latest')).status()).toBe(404);

  // A statement names its authority; the page is the same signed in.
  await page.goto(`/en/news/statements/${slugs.statement}`);
  await expect(page.getByText(`Issued by ${ISSUER}`).first()).toBeVisible();
  const text = await page.getByRole('main').innerText();
  await author.goto(`/en/news/statements/${slugs.statement}`);
  expect(await author.getByRole('main').innerText()).toBe(text);
  expect(await page.context().cookies()).toHaveLength(0);

  // Coverage is a summary with a described outbound link — never an embed.
  await page.goto(`/en/news/media-coverage/${slugs.coverage}`);
  const link = page.getByRole('link', { name: /Read the original at/ });
  await expect(link).toHaveAttribute('href', SOURCE);
  await expect(link).toHaveAttribute('rel', 'external noopener noreferrer');
  await expect(link).toContainText('(opens an external site)');
  await expect(page.getByText(/summarises coverage published by/)).toBeVisible();
  await expect(page.locator('iframe, embed, object')).toHaveCount(0);
  expect(external).toEqual([]);

  // The archive lists every family with its type, and tolerates a bad query.
  await page.goto('/en/news/archive');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('News archive');
  await expect(page.getByRole('link', { name: TITLE.coverage })).toBeVisible();
  await expect(page.getByText('Statement', { exact: true }).first()).toBeVisible();
  expect((await page.goto('/en/news/archive?year=abc&month=99'))?.status()).toBe(200);
});

test('answers a former slug with one 301 and never shadows a static route', async ({
  browser,
}) => {
  await author.goto(paths['statement']!);
  await author.getByLabel('Canonical slug', { exact: true }).fill(slugs.statementRenamed);
  // Wait for the saved revision itself — the next version — before moving on.
  await clickSaved(author, 'Save revision');
  await throughWorkflow(paths['statement']!);

  const anon = await browser.newContext({ baseURL: baseUrl() });
  const redirect = await anon.request.get(`/ur/news/statements/${slugs.statement}`, {
    maxRedirects: 0,
  });
  expect(redirect.status()).toBe(301);
  expect(new URL(redirect.headers()['location']!, baseUrl()).pathname).toBe(
    `/ur/news/statements/${slugs.statementRenamed}`,
  );
  for (const path of [
    '/en/news/archive',
    '/en/news/press-releases',
    '/en/news/statements',
    '/en/news/media-coverage',
  ]) {
    const response = await anon.request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(200);
  }
  await anon.close();
});

test('reads right to left at 320 pixels and at 200% zoom with no horizontal scroll', async ({
  page,
}) => {
  for (const [width, path] of [
    [320, '/ur/news'],
    [320, `/ar/news/media-coverage/${slugs.coverage}`],
    [640, '/ur/news/archive'],
  ] as const) {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      path,
    ).toBe(true);
  }
  // An untranslated record says which language it is shown in.
  await page.goto(`/ar/news/${slugs.news}`);
  await expect(page.getByRole('status').filter({ hasText: 'English' })).toBeVisible();
  // Keyboard: the first card link is reachable and visibly focused.
  await page.goto('/ur/news');
  const first = page.getByRole('main').getByRole('link', { name: TITLE.news });
  await first.focus();
  await expect(first).toBeFocused();
});
