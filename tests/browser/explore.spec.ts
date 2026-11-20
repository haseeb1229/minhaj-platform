import { randomUUID } from 'node:crypto';

import { AxeBuilder } from '@axe-core/playwright';
import type { BrowserContext, Locator, Page, TestInfo } from '@playwright/test';

import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import {
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
 * Explore (Rebaseline R2) — the organisation's own section in a real browser,
 * against the production build.
 *
 * WHAT ONLY A BROWSER CAN SHOW: that the front door lists every section and
 * every page with an honest status in words; that a section landing counts
 * its published pages and lists the rest as awaiting, each saying what it will
 * hold; that a page awaiting its Page says so, offers the open parts of the
 * platform that serve its reader now, and steps to its neighbours; that the
 * Shaykh-ul-Islam's four listings and the feeds page say why they are not
 * open rather than listing anything in their place; that a PUBLISHED Page —
 * made here through the real three-person Editorial workflow — stands in its
 * section's trail with Share and the rest of its section; that the allowlist
 * still answers 404 for everything it does not name; that a session changes
 * nothing; and that every surface reflows at 320 px and is axe-clean at
 * 1440 px in English, Urdu and Arabic.
 *
 * ONE PUBLISHED PAGE, AT AN ADDRESS NO OTHER SPEC READS. `organization/awards`
 * is bound here and nowhere else in the suite; its title is a "Zz…" filler,
 * so it never crowds another spec's first page. A retried run finds it
 * already published and reuses it (a binding holds one Page).
 */

test.describe.configure({ mode: 'serial' });

const BINDING = '/explore/organization/awards';
const run = randomUUID().replaceAll('-', '').slice(0, 8);
let title = `Zz synthetic Explore proof ${run}`;

let sql: SqlSession;
const contexts: BrowserContext[] = [];
let author: Page, reviewer: Page, publisher: Page;

/** Presses a workflow button and waits for the version it produces. */
async function clickSaved(page: Page, name: string) {
  const next =
    Number(await page.locator('input[name="version"]').first().inputValue()) + 1;
  await page.getByRole('button', { name, exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: `Version ${String(next)}` }),
  ).toBeVisible();
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  sql = await privilegedSession();
  const keys = [
    ['content.read', 'content.author'],
    ['content.read', 'content.review'],
    ['content.read', 'content.publish'],
  ];
  const pages: Page[] = [];
  for (const [index, grant] of keys.entries()) {
    const context = await browser.newContext({
      baseURL: baseUrl(),
      extraHTTPHeaders: { 'x-forwarded-for': `100.64.247.${String(index + 1)}` },
    });
    contexts.push(context);
    const page = await context.newPage();
    pages.push(page);
    const { email } = await registerAndSignIn(page, `explore-${String(index)}`);
    await grantRole(sql, await accountIdFor(sql, email), grant, 'Explore browser proof');
  }
  [author, reviewer, publisher] = pages as [Page, Page, Page];

  const existing = await sql.query<{ state: string }>(
    `SELECT [state] FROM [dbo].[Page] WHERE [routeBinding] = N'${BINDING}';`,
  );
  if (existing.length > 0) {
    // A retry of this file: the binding already holds its one Page.
    expect(existing[0]?.state).toBe('published');
    const response = await author.request.get(BINDING);
    const heading = /<h1[^>]*>([^<]+)<\/h1>/u.exec(await response.text());
    title = heading?.[1] ?? title;
    return;
  }

  await author.goto('/admin/editorial/pages/new');
  await author.getByLabel('Page destination', { exact: true }).selectOption(BINDING);
  await author.locator('#en-title').fill(title);
  await author
    .getByRole('textbox', { name: 'Body (en)', exact: true })
    .fill('Synthetic, non-authoritative text for the Explore browser proof.');
  await author.getByRole('button', { name: 'Save revision', exact: true }).click();
  await author.waitForURL(/\/admin\/editorial\/pages\/[0-9a-f-]{36}$/u);
  const path = new URL(author.url()).pathname;
  await clickSaved(author, 'Submit for review');
  await reviewer.goto(path);
  await clickSaved(reviewer, 'Approve revision');
  await publisher.goto(path);
  await clickSaved(publisher, 'Publish');
});

test.afterAll(async () => {
  for (const context of contexts) await context.close();
  await sql?.close();
});

/** The `href` of every link inside `scope`. */
async function hrefsOf(scope: Locator): Promise<string[]> {
  return scope
    .getByRole('link')
    .evaluateAll((links) =>
      links.map((link) => (link as HTMLAnchorElement).getAttribute('href') ?? ''),
    );
}

/** One row of an index: the list item holding the link to `href`. */
function rowOf(scope: Locator, href: string): Locator {
  // The innermost row: an index panel is itself a list item holding the row.
  return scope
    .getByRole('listitem')
    .filter({ has: scope.page().locator(`a[href="${href}"]`) })
    .last();
}

test.describe('the Explore front door', () => {
  test('lists every section and page, each with an honest status in words', async ({
    page,
  }) => {
    expect((await page.goto('/explore'))?.status()).toBe(200);
    const main = page.getByRole('main');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Explore');

    // The figures: the seven sections, and the published pages' own count.
    await expect(main.getByText('sections', { exact: true })).toBeVisible();
    await expect(main.getByText(/^of \d+ pages published$/u)).toBeVisible();

    const index = main.getByRole('region', { name: 'Every section', exact: true });
    await expect(index.getByRole('heading', { level: 3 })).toHaveCount(7);

    // The Page published here is published; a reserved one awaits; a listing
    // is not open; the newsletter is on its owner's page.
    await expect(rowOf(index, BINDING)).toContainText('Published');
    await expect(rowOf(index, '/explore/about/vision')).toContainText(
      'Awaiting publication',
    );
    await expect(rowOf(index, '/explore/shaykh-ul-islam/books')).toContainText(
      'Not open yet',
    );
    await expect(rowOf(index, '/newsletter')).toContainText('On its own page');
    await expect(
      index
        .getByRole('listitem')
        .filter({ has: page.getByRole('heading', { name: 'Organisation', level: 3 }) }),
    ).toContainText(/\d+ of 8 published/u);

    // The published Page is among the organisation's own pages.
    await expect(main.getByRole('link', { name: title }).first()).toHaveAttribute(
      'href',
      BINDING,
    );

    // Every link on the front door answers.
    for (const href of new Set(await hrefsOf(main)))
      expect((await page.request.get(href)).status(), href).toBe(200);
  });
});

test.describe('a section landing', () => {
  test('counts its published pages and lists the rest as awaiting', async ({ page }) => {
    expect((await page.goto('/explore/organization'))?.status()).toBe(200);
    const main = page.getByRole('main');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Organisation');
    await expect(
      main.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link'),
    ).toHaveText(['Home', 'Explore']);
    await expect(main.getByText('of 8 pages published', { exact: true })).toBeVisible();

    const published = main.getByRole('region', { name: 'Published', exact: true });
    await expect(published.getByRole('link', { name: title })).toHaveAttribute(
      'href',
      BINDING,
    );
    const awaiting = main.getByRole('region', { name: 'Still to be published' });
    const governance = awaiting
      .getByRole('listitem')
      .filter({ has: page.locator('a[href="/explore/organization/governance"]') });
    await expect(governance).toContainText('Awaiting publication');
    await expect(governance).toContainText('How the organisation is governed');
    await expect(awaiting.locator(`a[href="${BINDING}"]`)).toHaveCount(0);

    // Something is still unpublished, and said so in the accepted words.
    await expect(main).toContainText('Not yet published');
    const onward = main.getByRole('region', { name: 'Where to find this now' });
    await expect(onward.locator('a[href="/global"]')).toHaveCount(1);
    const others = main.getByRole('navigation', { name: 'Other sections' });
    await expect(others.getByRole('listitem')).toHaveCount(6);
    await expect(others.locator('a[href="/explore/organization"]')).toHaveCount(0);
  });

  test('names the official channels on Digital Resources, and leads to the newsletter', async ({
    page,
  }) => {
    await page.goto('/explore/digital-resources');
    const main = page.getByRole('main');
    const published = main.getByRole('region', { name: 'Published', exact: true });
    await expect(published.locator('a[href="/newsletter"]')).toHaveCount(1);
    const channels = main.getByRole('region', { name: 'Official channels' });
    for (const name of ['YouTube', 'Facebook', 'X', 'App Store', 'Google Play'])
      await expect(channels.getByRole('link', { name, exact: true })).toHaveAttribute(
        'rel',
        'external noopener noreferrer',
      );
  });

  test('keeps Leadership and Community honest until their own Page is published', async ({
    page,
  }) => {
    for (const [target, onward] of [
      ['/explore/community', '/global/find-a-centre'],
      ['/explore/leadership', '/library/authors'],
    ] as const) {
      expect((await page.goto(target))?.status(), target).toBe(200);
      const main = page.getByRole('main');
      await expect(main.getByText('Awaiting publication', { exact: true })).toBeVisible();
      await expect(main).toContainText('Not yet published');
      await expect(
        main
          .getByRole('region', { name: 'Where to find this now' })
          .locator(`a[href="${onward}"]`),
      ).toHaveCount(1);
    }
    // Profiles are called what they are: People records no leadership kind.
    await expect(page.getByRole('main')).not.toContainText('Leadership profiles');
  });
});

test.describe('a page that awaits its Page', () => {
  test('says what it will hold, what is open now, and steps through its section', async ({
    page,
  }) => {
    expect((await page.goto('/explore/about/vision'))?.status()).toBe(200);
    const main = page.getByRole('main');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Vision');
    await expect(
      main.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link'),
    ).toHaveText(['Home', 'Explore', 'About']);
    await expect(
      main.getByText('Awaiting publication', { exact: true }).first(),
    ).toBeVisible();
    await expect(main).toContainText("The organisation's vision, in its own words.");
    await expect(main).toContainText('Not yet published');

    const more = main.getByRole('region', { name: 'More in About' });
    await expect(more.locator('[aria-current="page"]')).toHaveText('Vision');
    await expect(more.getByRole('listitem')).toHaveCount(8);
    const steps = main.getByRole('navigation', { name: 'Previous and next in About' });
    await expect(steps.getByRole('link')).toHaveCount(2);
    await expect(steps.getByRole('link').first()).toHaveAttribute(
      'href',
      '/explore/about/introduction',
    );
    await expect(steps.getByRole('link').last()).toHaveAttribute(
      'href',
      '/explore/about/mission',
    );
    await expect(main.getByRole('link', { name: 'Back to About' })).toHaveAttribute(
      'href',
      '/explore/about',
    );
    for (const href of new Set(await hrefsOf(main)))
      expect((await page.request.get(href)).status(), href).toBe(200);
  });

  test('keeps the Shaykh-ul-Islam listings and the feeds page honest, never filled', async ({
    page,
  }) => {
    for (const [target, onward] of [
      ['/explore/shaykh-ul-islam/books', '/library/books'],
      ['/explore/shaykh-ul-islam/articles', '/library/articles'],
      ['/explore/shaykh-ul-islam/lectures', '/watch/lectures'],
      ['/explore/shaykh-ul-islam/collections', '/collections'],
    ] as const) {
      expect((await page.goto(target))?.status(), target).toBe(200);
      const main = page.getByRole('main');
      await expect(main.getByText('Not open yet', { exact: true }).first()).toBeVisible();
      await expect(
        main.getByRole('heading', { name: 'Why this list is not open yet' }),
      ).toBeVisible();
      await expect(
        main
          .getByRole('region', { name: 'Where to find this now' })
          .locator(`a[href="${onward}"]`),
      ).toHaveCount(1);
    }

    await page.goto('/explore/digital-resources/rss');
    await expect(
      page.getByRole('heading', { name: 'Why there is no feed yet' }),
    ).toBeVisible();
    // No feed address is invented.
    await expect(page.getByRole('main').locator('a[href*="rss"]')).toHaveCount(0);

    await page.goto('/explore/digital-resources/mobile-apps');
    const channels = page
      .getByRole('main')
      .getByRole('region', { name: 'Official channels' });
    await expect(channels.getByRole('link')).toHaveCount(2);
  });
});

test.describe('a published Page', () => {
  test('stands in its section trail with Share and the rest of its section', async ({
    page,
  }) => {
    expect((await page.goto(BINDING))?.status()).toBe(200);
    const main = page.getByRole('main');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
    await expect(
      main.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link'),
    ).toHaveText(['Home', 'Explore', 'Organisation']);
    await expect(main.getByRole('button', { name: 'Share' })).toBeVisible();

    const more = main.getByRole('region', { name: 'More in Organisation' });
    await expect(more.locator('[aria-current="page"]')).toHaveText('Awards');
    await expect(rowOf(more, '/explore/organization/governance')).toContainText(
      'Awaiting publication',
    );
    const steps = main.getByRole('navigation', {
      name: 'Previous and next in Organisation',
    });
    // The last page of its section: a previous page and no next.
    await expect(steps.getByRole('link')).toHaveCount(1);
    await expect(steps.getByRole('link')).toHaveAttribute(
      'href',
      '/explore/organization/un-recognition',
    );
    // A published Page carries no reserved notice.
    await expect(main).not.toContainText('Not yet published');
  });

  test('is the same document signed in and signed out', async ({ browser }) => {
    const anonymous = await browser.newContext({ baseURL: baseUrl() });
    try {
      for (const target of ['/explore', '/explore/organization', BINDING]) {
        const pair = await asTwoVisitors(anonymous.request, author.request, target);
        expect(pair.anonymous.status(), target).toBe(200);
        expect(pair.anonymous.headers()['set-cookie'], target).toBeUndefined();
        const expected = knowledgeOf(await pair.anonymous.text());
        const received = knowledgeOf(await pair.signedIn.text());
        expect(received === expected, firstDifference(expected, received)).toBe(true);
      }
    } finally {
      await anonymous.close();
    }
  });
});

test.describe('the allowlist', () => {
  test('answers 404 for every address it does not name, and redirects the newsletter once', async ({
    page,
  }) => {
    for (const target of [
      '/explore/organization/not-a-page',
      '/explore/about/education',
      '/explore/leadership/anything',
      '/explore/community/anything',
      '/explore/shaykh-ul-islam/books/extra',
      '/ar/explore/not-a-section',
    ])
      expect((await page.goto(target))?.status(), target).toBe(404);

    const redirect = await page.request.get('/ur/explore/digital-resources/newsletter', {
      maxRedirects: 0,
    });
    expect([301, 308]).toContain(redirect.status());
    expect(new URL(redirect.headers()['location'] ?? '', baseUrl()).pathname).toBe(
      '/ur/newsletter',
    );
  });
});

test.describe('in every language, at every width', () => {
  test('reflows at 320 px and is axe-clean at 1440 px, right-to-left in Urdu and Arabic', async ({
    page,
  }, testInfo) => {
    test.setTimeout(300_000);
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const target of [
        '/explore',
        '/explore/organization',
        '/explore/leadership',
        '/explore/about/vision',
        '/explore/shaykh-ul-islam/books',
        '/explore/digital-resources/social-media',
        BINDING,
        '/ur/explore',
        '/ur/explore/our-work',
        '/ur/explore/our-work/peace',
        '/ur/explore/community',
        `/ur${BINDING}`,
        '/ar/explore',
        '/ar/explore/shaykh-ul-islam',
        '/ar/explore/digital-resources/rss',
      ]) {
        expect((await page.goto(target))?.status(), target).toBe(200);
        await expect(page.getByRole('heading', { level: 1 }), target).toHaveCount(1);
        const direction = await page.evaluate(() => document.documentElement.dir);
        expect(direction, target).toBe(
          target.startsWith('/ur') || target.startsWith('/ar') ? 'rtl' : 'ltr',
        );
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect.soft(overflow, `${String(width)}px ${target}`).toBeLessThanOrEqual(0);
        if (width === 1440) await axe(page, target, testInfo);
      }
    }
  });
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
