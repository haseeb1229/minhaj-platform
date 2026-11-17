import { randomUUID } from 'node:crypto';
import { AxeBuilder } from '@axe-core/playwright';
import type { BrowserContext, Page, TestInfo } from '@playwright/test';
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
 * NEWS & EVENTS PART 1: the four listings are one listing — figures, counted
 * family tabs, a GET form of counted filters, chips, an honest range and
 * honest empty and past-the-end states, one address per view (every former
 * spelling one redirect); `/news` is also the section's front door; the
 * archive is a year and month index into the listings; a record's page states
 * its reading time, offers Share and leads to its family; and every surface is
 * axe-clean and reflows from 320 to 1440 px in en, ur and ar.
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
  await page.goto(`/admin/editorial/${segment}/new`);
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
  await author.goto('/admin/editorial/news/new');
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
  await author.goto('/admin/editorial/media-coverage/new');
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
  await reviewer.goto('/admin/editorial/queue');
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
  const response = await page.goto('/news');
  expect(response?.status()).toBe(200);
  expect(response?.headers()['set-cookie']).toBeUndefined();
  const main = page.getByRole('main');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('News and Events');
  await expect(main.getByRole('link', { name: TITLE.news })).toBeVisible();
  await expect(main.getByRole('link', { name: TITLE.statement })).toBeVisible();
  await expect(main.getByRole('link', { name: TITLE.coverage })).toBeVisible();
  for (const href of [
    '/news/press-releases',
    '/news/statements',
    '/news/media-coverage',
    '/news/archive',
    '/media/photos',
    '/media/galleries',
    '/media/archive',
  ])
    await expect(main.locator(`a[href="${href}"]`).first()).toBeVisible();
  // Events (Phase 14) are linked as the other half of News and Events.
  await expect(main.locator('a[href="/events"]').first()).toBeVisible();
  // The opening's own ways on — Events and the archive — each offered ONCE
  // under its name (News & Events Part 1: the browse list no longer repeats
  // them, nor the families the tabs and shelves already lead to).
  for (const name of ['Events', 'News archive'])
    await expect(main.getByRole('link', { name, exact: true })).toHaveCount(1);
  // The families as tabs, each counted, the listing's own current.
  const sections = main.getByRole('navigation', { name: 'News sections' });
  await expect(sections.getByRole('link')).toHaveCount(4);
  await expect(sections.getByRole('link', { name: /^News\s*\d+$/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
  for (const href of ['/news/press-releases', '/news/statements', '/news/media-coverage'])
    await expect(sections.locator(`a[href="${href}"]`)).toContainText(/\d/);
  // The family's figures lead the page.
  await expect(main.locator('header').first()).toContainText(/news stor(y|ies)/);
  // The front door's browse list: the rest of News and Events, the newsletter
  // (Phase 21) among them now that News leads to it (owner direction for News
  // & Events Part 1); the year links beside it reach the archive.
  const browse = main.locator('section[aria-labelledby="news-browse"] > div').first();
  for (const href of [
    '/collections',
    '/media/photos',
    '/media/galleries',
    '/media/archive',
    '/newsletter',
  ])
    await expect(browse.locator(`a[href="${href}"]`)).toHaveCount(1);
  for (const href of [
    '/news/press-releases',
    '/news/statements',
    '/news/media-coverage',
    '/news/archive',
    '/events',
  ])
    await expect(browse.locator(`a[href="${href}"]`)).toHaveCount(0);
  await expect(main.locator('a[href="/newsletter"]')).toHaveCount(1);
  // Each other family's shelf leads to its listing, counted.
  await expect(
    main
      .locator('section[aria-labelledby="news-statement"]')
      .getByRole('link', { name: /^All statements \(\d+\)$/ }),
  ).toHaveAttribute('href', '/news/statements');
  // Nothing that does not exist is linked.
  await expect(page.locator('a[href^="/rss"]')).toHaveCount(0);
  // No picture in the content: these synthetic stories carry no lead image.
  // (Rebaseline R1: the organisation's official mark appears once, in the
  // footer; the header carries the product's own wordmark, not a picture.)
  await expect(main.locator('img')).toHaveCount(0);
  await expect(page.locator('header img')).toHaveCount(0);
  await expect(page.locator('footer img')).toHaveAttribute(
    'alt',
    'Minhaj-ul-Quran International',
  );
  // News and Events is one of the nine domains, always (owner direction
  // 2026-11-08): its mega menu leads to this landing, closed until opened.
  const mainNavigation = page
    .getByRole('banner')
    .getByRole('navigation', { name: 'Main navigation' });
  await expect(mainNavigation.locator('a[href="/news"]')).toHaveCount(1);
  // Opening the domain shows the link; the current section is marked for
  // assistive technology on the link and on its domain's trigger.
  const group = mainNavigation.getByRole('button', { name: /^News and Events/ });
  await expect(group).toContainText('(current section)');
  await group.click();
  await expect(mainNavigation.locator('a[href="/news"]')).toBeVisible();
  await expect(mainNavigation.locator('a[href="/news"]')).toHaveAttribute(
    'aria-current',
    'page',
  );

  // `?sort=latest` is the same resource, never a path of its own — now one
  // redirect to the one address of the default order (News & Events Part 1).
  expect((await page.goto('/news?sort=latest'))?.status()).toBe(200);
  expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe('/news');
  expect((await page.request.get('/news/latest')).status()).toBe(404);

  // A statement names its authority; the page is the same signed in.
  await page.goto(`/news/statements/${slugs.statement}`);
  await expect(page.getByText(`Issued by ${ISSUER}`).first()).toBeVisible();
  // News & Events Part 1: how long it takes to read, Share (with script), and
  // its family as a fact leading to the family's listing.
  await expect(page.getByText('1 minute read')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Share', exact: true })).toBeVisible();
  const facts = page.locator('section[aria-labelledby="news-facts"]');
  await expect(
    facts.getByRole('link', { name: 'Statements', exact: true }),
  ).toHaveAttribute('href', '/news/statements');
  const text = await page.getByRole('main').innerText();
  await author.goto(`/news/statements/${slugs.statement}`);
  // Share appears once its island hydrates; compare both pages hydrated.
  await expect(author.getByRole('button', { name: 'Share', exact: true })).toBeVisible();
  expect(await author.getByRole('main').innerText()).toBe(text);
  expect(await page.context().cookies()).toHaveLength(0);

  // Coverage is a summary with a described outbound link — never an embed.
  await page.goto(`/news/media-coverage/${slugs.coverage}`);
  const link = page.getByRole('link', { name: /Read the original at/ });
  await expect(link).toHaveAttribute('href', SOURCE);
  await expect(link).toHaveAttribute('rel', 'external noopener noreferrer');
  await expect(link).toContainText('(opens an external site)');
  await expect(page.getByText(/summarises coverage published by/)).toBeVisible();
  await expect(page.locator('iframe, embed, object')).toHaveCount(0);
  // Its outlet leads to every record of coverage by that outlet.
  await expect(
    page.getByRole('link', { name: `All coverage by ${OUTLET}`, exact: true }),
  ).toHaveAttribute('href', `/news/media-coverage?outlet=${OUTLET.replaceAll(' ', '+')}`);
  expect(external).toEqual([]);

  // The archive is the year and month index of every family (News & Events
  // Part 1), and tolerates a bad query with one redirect to its one address.
  await page.goto('/news/archive');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('News archive');
  const year = new Date().getUTCFullYear();
  const month = new Date().getUTCMonth() + 1;
  const years = page.getByRole('navigation', { name: 'Years' });
  await expect(years.getByRole('link', { name: 'Every year' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await years.locator(`a[href="/news/archive?year=${String(year)}"]`).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    `Published in ${String(year)}`,
  );
  // Each month's count of each family leads into that family's listing for it.
  const into = page
    .locator('section[aria-labelledby="news-archive-months"]')
    .locator(`a[href="/news/statements?year=${String(year)}&month=${String(month)}"]`);
  await expect(into).toContainText(/^\d+ statements?$/);
  await into.click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Statements');
  await expect(
    page.getByRole('main').getByRole('link', { name: TITLE.statement }),
  ).toBeVisible();
  expect((await page.goto('/news/archive?year=abc&month=99'))?.status()).toBe(200);
  expect(new URL(page.url()).search).toBe('');
});

test('lists each family with figures, counted filters, chips and one address per view', async ({
  page,
}) => {
  const year = String(new Date().getUTCFullYear());
  // One redirect for each former spelling, to the view's one address.
  for (const [from, to] of [
    ['/news?lang=ur', '/news?language=ur'],
    ['/news?offset=20', '/news?page=2'],
    ['/news?sort=latest', '/news'],
    ['/ur/news/statements?language=&year=&sort=newest', '/ur/news/statements'],
    [`/news/archive?type=statement&year=${year}`, `/news/statements?year=${year}`],
    ['/news/archive?type=media-coverage&lang=en', '/news/media-coverage?language=en'],
    [`/news/archive?year=${year}&month=1`, `/news/archive?year=${year}`],
  ] as const) {
    const response = await page.request.get(from, { maxRedirects: 0 });
    expect([307, 308], from).toContain(response.status());
    const location = new URL(response.headers()['location']!, baseUrl());
    expect(location.pathname + location.search, from).toBe(to);
  }

  // A year narrows the statements: its chip removes it alone, and the range says how many.
  await page.goto(`/news/statements?year=${year}`);
  const main = page.getByRole('main');
  await expect(main.getByRole('link', { name: TITLE.statement })).toBeVisible();
  const chips = main.getByRole('list', { name: 'Filters in use' });
  await expect(
    chips.getByRole('link', { name: `Remove filter: ${year}`, exact: true }),
  ).toHaveAttribute('href', '/news/statements');
  await expect(main.getByText(/^Showing 1–\d+ of \d+$/)).toBeVisible();
  // The chosen year is offered with its count in the GET form.
  const filters = main.getByRole('form', { name: 'Filter the listing' });
  const yearSelect = filters.getByLabel('Year', { exact: true });
  await expect(yearSelect).toHaveValue(year);
  await expect(yearSelect.locator('option:checked')).toHaveText(
    new RegExp(`^${year} \\(\\d+\\)$`),
  );

  // Media coverage is filtered by its outlet, counted; the GET form submits
  // without script and the empty controls are dropped by one redirect.
  await page.goto(`/news/media-coverage?outlet=${encodeURIComponent(OUTLET)}`);
  const outlet = page
    .getByRole('form', { name: 'Filter the listing' })
    .getByLabel('Outlet', { exact: true });
  await expect(outlet).toHaveValue(OUTLET);
  await expect(outlet.locator('option:checked')).toHaveText(
    /^Synthetic Browser Outlet \(\d+\)$/,
  );
  await page.getByRole('button', { name: 'Show results', exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/news/media-coverage\\?outlet=${OUTLET.replaceAll(' ', '\\+')}$`),
  );
  await expect(
    page.getByRole('main').getByRole('link', { name: TITLE.coverage }),
  ).toBeVisible();

  // Honest states: no match, and a page past the end.
  await page.goto('/news/statements?year=1901');
  await expect(page.getByText('Nothing matches these filters')).toBeVisible();
  await expect(
    page.getByRole('main').getByRole('link', { name: 'Clear filters' }).first(),
  ).toHaveAttribute('href', '/news/statements');
  await page.goto('/news?page=999');
  await expect(page.getByText('There is no page 999 in this listing.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go to the first page' })).toHaveAttribute(
    'href',
    '/news',
  );
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
    '/news/archive',
    '/news/press-releases',
    '/news/statements',
    '/news/media-coverage',
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

/** No serious or critical axe finding; anything lesser is annotated. */
async function axe(page: Page, target: string, testInfo: TestInfo): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
  for (const finding of results.violations.filter((v) => !blocking.includes(v)))
    testInfo.annotations.push({
      type: 'axe',
      description: `${target}: ${finding.id} (${String(finding.impact)})`,
    });
  expect(
    blocking.map((violation) => `${violation.id}: ${violation.nodes.length}`),
    target,
  ).toEqual([]);
}

test('is axe-clean and reflows from 320 to 1440 px — so at 200% zoom — in en, ur and ar', async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  const year = String(new Date().getUTCFullYear());
  for (const [width, height] of [
    [320, 800],
    [1440, 900],
  ] as const) {
    await page.setViewportSize({ width, height });
    for (const path of [
      '/news',
      '/news/statements',
      `/news/media-coverage?outlet=${encodeURIComponent(OUTLET).replaceAll('%20', '+')}`,
      '/news/archive',
      `/news/archive?year=${year}`,
      `/news/statements/${slugs.statementRenamed}`,
      `/news/media-coverage/${slugs.coverage}`,
      `/news/${slugs.news}`,
      '/ur/news',
      '/ur/news/press-releases',
      `/ur/news/archive?year=${year}`,
      `/ur/news/statements/${slugs.statementRenamed}`,
      '/ar/news',
      '/ar/news/media-coverage',
      '/ar/news/archive',
      `/ar/news/${slugs.news}`,
    ]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      // Each address is already its view's one address: no redirect was taken.
      expect(new URL(page.url()).pathname + new URL(page.url()).search, path).toBe(path);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${path} at ${String(width)}`).toBeLessThanOrEqual(0);
      if (width === 1440) await axe(page, path, testInfo);
    }
  }
});
