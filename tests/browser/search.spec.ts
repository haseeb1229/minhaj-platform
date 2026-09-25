import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { repoRoot } from '../architecture/architecture-harness.ts';
import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import {
  accountIdFor,
  alertIn,
  baseUrl,
  expect,
  privilegedSession,
  registerAndSignIn,
  statusIn,
  test,
  grantRole,
} from './support';

/**
 * Phase 17 — Search in a real browser, against the production build.
 *
 * WHAT ONLY A BROWSER CAN PROVE: that the page works signed out and sets no
 * cookie, that its robots directive is `noindex`, that Urdu renders right to
 * left with each result in its own language, that nothing overflows a small
 * phone, that the form works from the keyboard, that the request proxy
 * throttles a flood of queries, that an operator can rebuild the index through
 * the real action — and that a record withdrawn behind the index's back is
 * withheld by the running application, not merely by a unit under test.
 *
 * EVERYTHING IS SYNTHETIC, and every title says so.
 */

test.describe.configure({ mode: 'serial' });

let sql: SqlSession;

const run = randomUUID().replaceAll('-', '').slice(0, 10);
const WORD = `zarqonfixture${run}`;
const PERSON_NAME = `Browser Search Contributor ${WORD}`;
const WORK_TITLE = `Browser search handbook ${WORD}`;
const DRAFT_TITLE = `Browser search draft ${WORD}`;
const URDU_NAME = `آزمائشی تلاش ${WORD}`;

const personId = randomUUID();
const workId = randomUUID();
const draftWorkId = randomUUID();
const editionId = randomUUID();
const draftEditionId = randomUUID();

const OPERATOR_STATE = path.join(
  repoRoot,
  'test-results',
  'browser-search-operator.json',
);
const OPERATOR_CLIENT = '100.64.250.17';
const OUTSIDER_CLIENT = '100.64.250.18';

/** Waits for DERIVED work — the index is asynchronous by design (§8.5). */
async function eventuallyFound(page: Page, query: string, text: string): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.goto(`/en/search?q=${encodeURIComponent(query)}`);
        // The results arrive in the streamed page; its heading exists only once
        // they have, so the text read below is the rendered result, not the
        // loading state.
        await page.getByRole('heading', { level: 1, name: 'Search' }).waitFor();
        return page.getByRole('main').innerText();
      },
      { timeout: 90_000, intervals: [1_000, 2_000, 3_000] },
    )
    .toContain(text);
}

test.beforeAll(async ({ browser }) => {
  sql = await privilegedSession();

  // ---- public fixtures, written as their owners' rows ------------------------
  await sql.query(`
    INSERT INTO [dbo].[Person] ([id], [slug], [primaryLocale], [status])
    VALUES (N'${personId}', N'search-browser-${run}', N'en', N'published');
    INSERT INTO [dbo].[PersonTranslation] ([personId], [locale], [name], [biography])
    VALUES (N'${personId}', N'en', N'${PERSON_NAME}', N'A synthetic contributor for the search proof.'),
           (N'${personId}', N'ur', N'${URDU_NAME}', NULL);

    INSERT INTO [dbo].[Work] ([id], [slug], [primaryLocale], [state], [isFeatured], [version], [updatedAt])
    VALUES (N'${workId}', N'search-browser-work-${run}', N'en', N'published', 0, 1, SYSUTCDATETIME()),
           (N'${draftWorkId}', N'search-browser-draft-${run}', N'en', N'draft', 0, 1, SYSUTCDATETIME());
    INSERT INTO [dbo].[WorkLabel] ([workId], [locale], [title], [description])
    VALUES (N'${workId}', N'en', N'${WORK_TITLE}', N'A synthetic handbook for the search proof.'),
           (N'${draftWorkId}', N'en', N'${DRAFT_TITLE}', N'Never public.');
    INSERT INTO [dbo].[Edition] ([id], [workId], [languageCode], [label], [state], [publicationYear], [reading], [download], [version], [updatedAt])
    VALUES (N'${editionId}', N'${workId}', N'en', N'Synthetic edition', N'published', 2021, N'unavailable', N'denied', 1, SYSUTCDATETIME()),
           (N'${draftEditionId}', N'${draftWorkId}', N'en', N'Synthetic draft edition', N'published', 2021, N'unavailable', N'denied', 1, SYSUTCDATETIME());
  `);

  // ---- the operator, holding exactly the two search keys --------------------
  const context = await browser.newContext({
    baseURL: baseUrl(),
    extraHTTPHeaders: { 'x-forwarded-for': OPERATOR_CLIENT },
    // EXPLICITLY EMPTY: the first test to trigger this hook sits in a block that
    // loads the operator's saved state, and that default must not apply here.
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  const { email } = await registerAndSignIn(page, 'search-operator');
  await grantRole(
    sql,
    await accountIdFor(sql, email),
    ['search.read', 'search.operate'],
    'Synthetic search role',
  );
  expect((await page.goto('/en/admin/system/search'))?.status()).toBe(200);
  await context.storageState({ path: OPERATOR_STATE });
  await context.close();
});

test.afterAll(async () => {
  await sql?.close();
});

test.describe('operating the index', () => {
  test.use({ storageState: OPERATOR_STATE });

  test('an operator sees lag and failures, and rebuilds through the real action', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await page.goto('/en/admin/system/search');

    await expect(
      page.getByRole('heading', { level: 1, name: 'Search indexing' }),
    ).toBeVisible();
    await expect(page.getByText('Waiting to be indexed')).toBeVisible();
    await expect(page.getByText('Searchable documents')).toBeVisible();

    await page.getByRole('button', { name: 'Rebuild the index' }).click();
    await expect(
      statusIn(page).filter({ hasText: 'A full rebuild has started' }),
    ).toBeVisible();

    // The rebuild runs after the response; the owners' rows written above
    // become searchable once the derived work has been done.
    await eventuallyFound(page, WORD, WORK_TITLE);
    await eventuallyFound(page, WORD, PERSON_NAME);
  });
});

test('refuses the operations surface to an account without the permission', async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: baseUrl(),
    extraHTTPHeaders: { 'x-forwarded-for': OUTSIDER_CLIENT },
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  await registerAndSignIn(page, 'search-outsider');

  expect((await page.goto('/en/admin/system/search'))?.status()).toBe(404);
  await context.close();
});

test('searches signed out, sets no cookie, and is never indexable', async ({ page }) => {
  const response = await page.goto(`/en/search?q=${WORD}`);
  expect(response?.status()).toBe(200);
  expect(response?.headers()['set-cookie']).toBeUndefined();
  expect(response?.headers()['cache-control'] ?? '').not.toMatch(/public/);

  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

  const results = page.getByRole('list', { name: 'Search results' });
  await expect(
    results.getByRole('link', { name: WORK_TITLE, exact: true }),
  ).toHaveAttribute('href', `/en/library/books/search-browser-work-${run}`);
  await expect(
    results.getByRole('link', { name: PERSON_NAME, exact: true }),
  ).toHaveAttribute('href', `/en/people/search-browser-${run}`);

  // A draft Work is never indexed, whatever its Edition says.
  await expect(page.getByText(DRAFT_TITLE)).toHaveCount(0);

  // No raw identifier in the visible page.
  const text = await page.getByRole('main').innerText();
  expect(text).not.toContain(workId);
  expect(text).not.toContain(personId);
});

test('filters combine and every state is explained', async ({ page }) => {
  await page.goto(`/en/search?q=${WORD}&type=person`);
  const results = page.getByRole('list', { name: 'Search results' });
  await expect(results.getByRole('listitem')).toHaveCount(1);
  await expect(results).toContainText(PERSON_NAME);

  await page.goto(`/en/search?q=${WORD}&from=2020&to=2022`);
  await expect(page.getByRole('list', { name: 'Search results' })).toContainText(
    `${WORK_TITLE} — Synthetic edition`,
  );
  await expect(page.getByRole('list', { name: 'Search results' })).not.toContainText(
    PERSON_NAME,
  );

  await page.goto(`/en/search?q=${WORD}zzzznomatch`);
  await expect(page.getByText(/No results for/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Browse topics' }).first()).toBeVisible();

  await page.goto('/en/search?q=%2A%2A%2A&page=99');
  await expect(alertIn(page)).toContainText('Type at least one letter or number.');
  await expect(alertIn(page)).toContainText('That page of results is not available.');

  await page.goto('/en/search');
  await expect(page.getByText('What would you like to find?')).toBeVisible();
});

test('works from the keyboard, with the form state kept after searching', async ({
  page,
}) => {
  await page.goto('/en/search');
  const box = page.getByLabel('Search for', { exact: true });
  await box.focus();
  await page.keyboard.type(WORD);
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(new RegExp(`q=${WORD}`));
  await expect(page.getByLabel('Search for', { exact: true })).toHaveValue(WORD);
  await expect(page.getByRole('list', { name: 'Search results' })).toContainText(
    WORK_TITLE,
  );
});

test('renders Urdu right to left, each result in its own language, without overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`/ur/search?q=${WORD}`);

  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  const urdu = page.getByRole('heading', { level: 3 }).filter({ hasText: URDU_NAME });
  await expect(urdu).toHaveAttribute('lang', 'ur');
  await expect(urdu).toHaveAttribute('dir', 'rtl');

  const english = page.getByRole('heading', { level: 3, name: WORK_TITLE, exact: true });
  await expect(english).toHaveAttribute('dir', 'ltr');

  await page.locator('summary').click();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('never discloses a record withdrawn behind the index back', async ({ page }) => {
  await page.goto(`/en/search?q=${WORD}&type=person`);
  await expect(page.getByRole('list', { name: 'Search results' })).toContainText(
    PERSON_NAME,
  );

  // Withdrawn DIRECTLY, with no indexing request: the index still holds the
  // document, and only the application's visibility recheck stands between it
  // and a visitor.
  await sql.query(
    `UPDATE [dbo].[Person] SET [status] = N'archived' WHERE [id] = N'${personId}';`,
  );
  const [held] = await sql.query<{ documents: number }>(
    `SELECT COUNT(*) AS documents FROM [dbo].[SearchDocument] WHERE [resourceId] = N'${personId}';`,
  );
  expect(Number(held?.documents)).toBeGreaterThan(0);

  await page.goto(`/en/search?q=${WORD}&type=person`);
  await expect(page.getByText(PERSON_NAME)).toHaveCount(0);
  await expect(page.getByText(/No results for/)).toBeVisible();

  await sql.query(
    `UPDATE [dbo].[Person] SET [status] = N'published' WHERE [id] = N'${personId}';`,
  );
});

test('throttles a flood of queries at the request boundary', async ({
  page,
  clientAddress,
}) => {
  // Thirty queries a minute per client. The flood uses this test's own address,
  // so no other test's budget is touched.
  let last = 0;
  for (let request = 0; request < 31; request += 1) {
    const response = await page.request.get(`/en/search?q=${WORD}`, {
      headers: { 'x-forwarded-for': clientAddress },
      maxRedirects: 0,
    });
    last = response.status();
  }
  expect(last).toBe(303);

  await page.goto(`/en/search?q=${WORD}`);
  await expect(page).toHaveURL(/\/en\/search\/limited$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Search paused' }),
  ).toBeVisible();

  // HEAD renders the page too, so it is throttled exactly like GET.
  const head = await page.request.head(`/en/search?q=${WORD}`, {
    headers: { 'x-forwarded-for': clientAddress },
    maxRedirects: 0,
  });
  expect(head.status()).toBe(303);

  // An empty search page spends nothing and is still available.
  expect((await page.goto('/en/search'))?.status()).toBe(200);
});

test('the topic hub is navigable and searchable within', async ({ page }) => {
  await page.goto('/en/topics');
  await page.getByRole('link', { name: 'Education', exact: true }).click();
  await expect(page).toHaveURL(/\/en\/topics\/education$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Education');

  const within = page.getByRole('search', { name: 'Search within this topic' });
  await within.getByLabel('Search this topic for').fill(WORD);
  await within.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/topic=education/);
  await expect(page.getByText('Topic: Education')).toBeVisible();

  expect((await page.goto('/en/topics/no-such-topic-anywhere'))?.status()).toBe(404);
});

test('a missing page offers search', async ({ page }) => {
  const response = await page.goto(`/en/does-not-exist-${run}`);
  expect(response?.status()).toBe(404);

  await page.getByLabel('Search the site').fill(WORD);
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(new RegExp(`/en/search\\?q=${WORD}`));
});
