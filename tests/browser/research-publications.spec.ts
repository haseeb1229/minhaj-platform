import { randomUUID } from 'node:crypto';

import type { BrowserContext, Page } from '@playwright/test';

import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import {
  newPhase5Fixture,
  writePhase5Fixture,
} from '../../packages/database/src/lifecycle/phase5-fixture.ts';
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
 * Phase 9 — Research, ResearchPaper, Publication, Magazine, MagazineIssue and
 * Encyclopedia in a real browser, against the production build.
 *
 * WHAT ONLY A BROWSER CAN PROVE: that the pages are usable signed out and set no
 * cookie; that citations, contributors and topics are real links; that the
 * periodical hierarchy is navigable in both directions; that a former slug —
 * including a former Magazine slug with a former issue slug — answers ONE 301
 * through the real proxy; that Urdu renders right-to-left; that nothing scrolls
 * sideways at 320px; that a Phase-9 record is found by the running search sweep,
 * and withheld the moment it is withdrawn; and that administration works, is
 * refused without the permission, and refuses a stale save visibly.
 *
 * EVERYTHING IS SYNTHETIC. Titles, abstracts, citations and text are proofs.
 */

test.describe.configure({ mode: 'serial' });

let sql: SqlSession;
const contexts: BrowserContext[] = [];

const run = randomUUID().replaceAll('-', '').slice(0, 10);
const WORD = `quasarfixture${run}`;
const PAPER_WORD = `nimbusfixture${run}`;

const researchId = randomUUID();
const paperId = randomUUID();
const publicationId = randomUUID();
const encyclopediaId = randomUUID();
const magazineId = randomUUID();
const firstIssueId = randomUUID();
const secondIssueId = randomUUID();
const draftIssueId = randomUUID();

const researchOld = `browser-research-old-${run}`;
const researchSlug = `browser-research-${run}`;
const paperSlug = `browser-paper-${run}`;
const publicationSlug = `browser-publication-${run}`;
const encyclopediaSlug = `browser-encyclopedia-${run}`;
const magazineOld = `browser-magazine-old-${run}`;
const magazineSlug = `browser-magazine-${run}`;
const issueOld = `spring-old-${run}`;
const issueSlug = `spring-${run}`;

const RESEARCH_TITLE = `Synthetic browser research ${WORD}`;
const MAGAZINE_TITLE = `Synthetic browser monthly ${WORD}`;

async function grant(accountId: string, keys: readonly string[]): Promise<void> {
  await grantRole(sql, accountId, keys, 'Scholarly browser proof');
}

/** Waits for DERIVED work — the running sweep indexes asynchronously (§8.5). */
async function eventuallyFound(page: Page, query: string, text: string): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.goto(`/en/search?q=${encodeURIComponent(query)}`);
        await page.getByRole('heading', { level: 1, name: 'Search' }).waitFor();
        return page.getByRole('main').innerText();
      },
      { timeout: 90_000, intervals: [1_000, 2_000, 3_000] },
    )
    .toContain(text);
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  sql = await privilegedSession();

  const people = newPhase5Fixture();
  await writePhase5Fixture(sql, people);
  const [topic] = await sql.query<{ id: string }>(
    "SELECT [id] FROM [Topic] WHERE [slug] = N'education';",
  );
  if (topic === undefined) throw new Error('The canonical education topic is missing.');

  const document = JSON.stringify({
    sections: ['opening', 'closing'].map((key) => ({
      key,
      title: `Synthetic ${key} section`,
      paragraphs: [`Synthetic, non-authoritative ${key} text. `.repeat(12)],
    })),
  });

  // Created at their OLD slugs and renamed, so the triggers reserve both and the
  // proxy has genuine former addresses to answer.
  await sql.query(`
    INSERT INTO [dbo].[Research] ([id],[slug],[primaryLocale],[languageCode],[state],[publicationYear],[institutionalContext],[abstract],[document],[version],[updatedAt])
    VALUES (N'${researchId}', N'${researchOld}', N'en', N'en', N'published', 2020, N'A synthetic institute',
            N'Synthetic abstract, first paragraph.' + CHAR(10) + CHAR(10) + N'Synthetic abstract, second paragraph.', N'${document}', 1, SYSUTCDATETIME());
    UPDATE [dbo].[Research] SET [slug]=N'${researchSlug}', [version]=2 WHERE [id]=N'${researchId}';
    INSERT INTO [dbo].[ResearchLabel] ([researchId],[locale],[title],[summary]) VALUES
      (N'${researchId}', N'en', N'${RESEARCH_TITLE}', N'A synthetic summary.'),
      (N'${researchId}', N'ur', N'آزمائشی تحقیق ${run}', N'');
    INSERT INTO [dbo].[ResearchContributor] ([researchId],[personId],[role],[position])
      VALUES (N'${researchId}', N'${people.linkedPersonId}', N'author', 0);
    INSERT INTO [dbo].[ResearchTopic] ([researchId],[topicId]) VALUES (N'${researchId}', N'${topic.id}');
    INSERT INTO [dbo].[ResearchCitation] ([researchId],[position],[text],[url],[doi]) VALUES
      (N'${researchId}', 0, N'Synthetic citation one', N'https://example.org/one', N'10.1234/browser.one'),
      (N'${researchId}', 1, N'Synthetic citation two', NULL, NULL);

    INSERT INTO [dbo].[ResearchPaper] ([id],[slug],[primaryLocale],[languageCode],[state],[publishedOn],[publicationYear],[venue],[doi],[version],[updatedAt])
    VALUES (N'${paperId}', N'${paperSlug}', N'en', N'ar', N'published', '2022-03-04', 2022,
            N'Synthetic Journal of Browsers', N'10.1234/browser.paper', 1, SYSUTCDATETIME());
    INSERT INTO [dbo].[ResearchPaperLabel] ([researchPaperId],[locale],[title],[summary]) VALUES
      (N'${paperId}', N'en', N'Synthetic browser paper ${PAPER_WORD}', N''),
      (N'${paperId}', N'ar', N'ورقة تجريبية للمتصفح', N'');

    INSERT INTO [dbo].[Publication] ([id],[slug],[primaryLocale],[languageCode],[state],[publisher],[version],[updatedAt])
    VALUES (N'${publicationId}', N'${publicationSlug}', N'en', N'en', N'published', N'Synthetic Press', 1, SYSUTCDATETIME());
    INSERT INTO [dbo].[PublicationLabel] ([publicationId],[locale],[title],[summary])
      VALUES (N'${publicationId}', N'en', N'Synthetic browser booklet', N'');

    INSERT INTO [dbo].[Encyclopedia] ([id],[slug],[primaryLocale],[languageCode],[state],[document],[version],[updatedAt])
    VALUES (N'${encyclopediaId}', N'${encyclopediaSlug}', N'en', N'en', N'published', N'${document}', 1, SYSUTCDATETIME());
    INSERT INTO [dbo].[EncyclopediaLabel] ([encyclopediaId],[locale],[title],[summary])
      VALUES (N'${encyclopediaId}', N'en', N'Synthetic browser encyclopedia', N'');

    INSERT INTO [dbo].[Magazine] ([id],[slug],[primaryLocale],[state],[version],[updatedAt])
    VALUES (N'${magazineId}', N'${magazineOld}', N'en', N'published', 1, SYSUTCDATETIME());
    UPDATE [dbo].[Magazine] SET [slug]=N'${magazineSlug}', [version]=2 WHERE [id]=N'${magazineId}';
    INSERT INTO [dbo].[MagazineLabel] ([magazineId],[locale],[title],[summary])
      VALUES (N'${magazineId}', N'en', N'${MAGAZINE_TITLE}', N'A synthetic periodical.');
    INSERT INTO [dbo].[MagazineIssue] ([id],[magazineId],[slug],[primaryLocale],[languageCode],[state],[volume],[issueNumber],[publicationYear],[version],[updatedAt]) VALUES
      (N'${firstIssueId}', N'${magazineId}', N'winter-${run}', N'en', N'en', N'published', 1, 1, 2021, 1, SYSUTCDATETIME()),
      (N'${secondIssueId}', N'${magazineId}', N'${issueOld}', N'en', N'en', N'published', 1, 2, 2021, 1, SYSUTCDATETIME()),
      (N'${draftIssueId}', N'${magazineId}', N'draft-${run}', N'en', N'en', N'draft', 1, 3, 2021, 1, SYSUTCDATETIME());
    UPDATE [dbo].[MagazineIssue] SET [slug]=N'${issueSlug}', [version]=2 WHERE [id]=N'${secondIssueId}';
    INSERT INTO [dbo].[MagazineIssueLabel] ([magazineIssueId],[locale],[title],[summary]) VALUES
      (N'${firstIssueId}', N'en', N'Synthetic winter issue', N''),
      (N'${secondIssueId}', N'en', N'Synthetic spring issue', N''),
      (N'${draftIssueId}', N'en', N'Synthetic hidden draft issue', N'');

    INSERT INTO [dbo].[SearchIndexRequest] ([scopeKind],[scopeId]) VALUES
      (N'research', N'${researchId}'), (N'research-paper', N'${paperId}'),
      (N'magazine', N'${magazineId}'), (N'magazine-issue', N'${secondIssueId}');
  `);
});

test.afterAll(async () => {
  for (const context of contexts) await context.close();
  await sql?.close();
});

/* ========================================================================== */

test.describe('an anonymous visitor reads research and publications', () => {
  test('lists research signed out, sets no cookie, and filters honestly', async ({
    page,
  }) => {
    const response = await page.goto('/en/library/research');
    expect(response?.status()).toBe(200);
    expect(response?.headers()['set-cookie']).toBeUndefined();
    await expect(page.getByRole('link', { name: RESEARCH_TITLE })).toBeVisible();

    await page.goto('/en/library/research-papers?language=ar');
    await expect(
      page.getByRole('link', { name: `Synthetic browser paper ${PAPER_WORD}` }),
    ).toBeVisible();

    // A filter that matches nothing says so, and offers the way back.
    await page.goto('/en/library/research-papers?language=ur&from=1900&to=1901');
    await expect(
      page.getByText('Nothing published matches these filters.'),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Clear all filters' }).first().click();
    await expect(page).toHaveURL(/\/en\/library\/research-papers$/);
  });

  test('shows a research record with its abstract, citations, people, topics and text', async ({
    page,
  }) => {
    await page.goto(`/en/library/research/${researchSlug}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(RESEARCH_TITLE);

    await expect(page.getByRole('heading', { name: 'Abstract' })).toBeVisible();
    await expect(page.getByText('Synthetic abstract, second paragraph.')).toBeVisible();
    await expect(page.getByText('A synthetic institute')).toBeVisible();

    const citations = page
      .getByRole('list')
      .filter({ hasText: 'Synthetic citation one' });
    await expect(citations.getByRole('listitem')).toHaveCount(2);
    await expect(
      citations.getByRole('link', { name: 'DOI 10.1234/browser.one' }),
    ).toHaveAttribute('href', 'https://doi.org/10.1234/browser.one');
    await expect(citations.getByRole('link', { name: 'Source' })).toHaveAttribute(
      'href',
      'https://example.org/one',
    );

    await expect(page.getByRole('link', { name: 'Education' }).first()).toHaveAttribute(
      'href',
      '/en/topics/education',
    );
    await expect(page.locator('a[href^="/en/people/"]').first()).toBeVisible();

    // The full text, navigable by keyboard.
    const contents = page.getByRole('navigation', { name: 'Contents' });
    await contents.getByRole('link', { name: 'Synthetic closing section' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#section-closing$/);

    // Pre-adoption: not indexable, so no machine-readable claim at all.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/,
    );
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
  });

  test('states plainly when no full text is available', async ({ page }) => {
    await page.goto(`/en/library/publications/${publicationSlug}`);
    await expect(page.getByText('Synthetic Press')).toBeVisible();
    await expect(
      page.getByText('The full text is not available on this platform.'),
    ).toBeVisible();
    await page.goto(`/en/library/encyclopedias/${encyclopediaSlug}`);
    await expect(page.locator('#library-reader')).toBeVisible();
  });

  test('renders Urdu right-to-left with the text in its own language', async ({
    page,
  }) => {
    await page.goto(`/ur/library/research-papers/${paperSlug}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ur');
    // The Arabic content language is marked on the fact that states it.
    await expect(page.locator('dd [lang="ar"]').first()).toBeVisible();

    await page.goto(`/ur/library/research/${researchSlug}`);
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toHaveText(`آزمائشی تحقیق ${run}`);
    await expect(heading).toHaveAttribute('lang', 'ur');
  });

  test('reflows at a 320px width without horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    for (const path of [
      '/en/library/research',
      `/en/library/research/${researchSlug}`,
      `/ur/library/magazines/${magazineSlug}/issues/${issueSlug}`,
    ]) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});

/* ========================================================================== */

test.describe('a periodical and its issues', () => {
  test('lists public issues newest first, and never a draft', async ({ page }) => {
    await page.goto(`/en/library/magazines/${magazineSlug}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(MAGAZINE_TITLE);
    const issues = page.getByRole('list', { name: 'Issues' });
    await expect(issues.getByRole('listitem')).toHaveCount(2);
    await expect(issues.getByRole('link')).toHaveText([
      'Synthetic spring issue',
      'Synthetic winter issue',
    ]);
    await expect(page.getByText('Synthetic hidden draft issue')).toHaveCount(0);
  });

  test('places an issue within its Magazine, with its numbers and neighbours', async ({
    page,
  }) => {
    await page.goto(`/en/library/magazines/${magazineSlug}/issues/${issueSlug}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Synthetic spring issue',
    );
    await expect(page.getByText('Volume 1, issue 2')).toBeVisible();

    const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(breadcrumb.getByRole('link', { name: MAGAZINE_TITLE })).toHaveAttribute(
      'href',
      `/en/library/magazines/${magazineSlug}`,
    );

    const neighbours = page.getByRole('navigation', {
      name: 'Other issues of this magazine',
    });
    await neighbours.getByRole('link', { name: /Previous issue/ }).click();
    await expect(page).toHaveURL(new RegExp(`/issues/winter-${run}$`));
    // The draft third issue is not a neighbour.
    await expect(page.getByRole('link', { name: /Next issue/ })).toHaveText(
      /Synthetic spring issue/,
    );
  });

  test('answers every former address with exactly one 301 to the current one', async ({
    request,
  }) => {
    const hop = async (from: string, to: string) => {
      const response = await request.get(from, { maxRedirects: 0 });
      expect(response.status(), from).toBe(301);
      expect(
        new URL(response.headers()['location'] ?? '', baseUrl()).pathname,
        from,
      ).toBe(to);
    };

    await hop(
      `/ur/library/research/${researchOld}`,
      `/ur/library/research/${researchSlug}`,
    );
    await hop(
      `/en/library/magazines/${magazineOld}`,
      `/en/library/magazines/${magazineSlug}`,
    );
    // BOTH halves former: still ONE hop, straight to the current full address.
    await hop(
      `/ar/library/magazines/${magazineOld}/issues/${issueOld}`,
      `/ar/library/magazines/${magazineSlug}/issues/${issueSlug}`,
    );
    await hop(
      `/en/library/magazines/${magazineSlug}/issues/${issueOld}`,
      `/en/library/magazines/${magazineSlug}/issues/${issueSlug}`,
    );

    const draft = await request.get(
      `/en/library/magazines/${magazineSlug}/issues/draft-${run}`,
      { maxRedirects: 0 },
    );
    expect(draft.status()).toBe(404);
  });
});

/* ========================================================================== */

test.describe('Library-wide surfaces include what Phase 9 delivered', () => {
  test('lists the new sections on the landing, resources and topic pages', async ({
    page,
  }) => {
    await page.goto('/en/library');
    for (const name of [
      'Research',
      'Research papers',
      'Publications',
      'Encyclopedias',
      'Magazines and journals',
    ]) {
      await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
    }

    await page.goto('/en/library/resources');
    await expect(page.getByRole('link', { name: RESEARCH_TITLE })).toBeVisible();
    await expect(page.getByRole('link', { name: 'All research papers' })).toBeVisible();

    await page.goto('/en/topics/education');
    const section = page.getByRole('region', { name: 'Research on this topic' });
    await expect(section.getByRole('link', { name: RESEARCH_TITLE })).toHaveAttribute(
      'href',
      `/en/library/research/${researchSlug}`,
    );
  });
});

/* ========================================================================== */

test.describe('search finds Phase-9 records, and never a withdrawn one', () => {
  test('finds a record at its current address, then withholds it once withdrawn', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await eventuallyFound(page, WORD, RESEARCH_TITLE);
    // The issue is found by its Magazine's name, which its projection carries.
    await eventuallyFound(page, WORD, 'Synthetic spring issue');
    const results = page.getByRole('list', { name: 'Search results' });
    await expect(results.getByRole('link', { name: RESEARCH_TITLE })).toHaveAttribute(
      'href',
      `/en/library/research/${researchSlug}`,
    );
    await expect(
      results.getByRole('link', { name: 'Synthetic spring issue' }),
    ).toHaveAttribute(
      'href',
      `/en/library/magazines/${magazineSlug}/issues/${issueSlug}`,
    );

    await eventuallyFound(page, PAPER_WORD, `Synthetic browser paper ${PAPER_WORD}`);
    // Withdrawn with no indexing request: the stale row is still in the index,
    // and the query-time visibility check is all that stands between it and the
    // page.
    await sql.query(
      `UPDATE [dbo].[ResearchPaper] SET [state]=N'archived' WHERE [id]=N'${paperId}';`,
    );
    await page.goto(`/en/search?q=${PAPER_WORD}`);
    await page.getByRole('heading', { level: 1, name: 'Search' }).waitFor();
    await expect(page.getByText(`Synthetic browser paper ${PAPER_WORD}`)).toHaveCount(0);
  });
});

/* ========================================================================== */

test.describe('Research and publications administration', () => {
  let admin: Page;
  let stranger: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    for (const [index, keys] of [
      [0, ['library.read', 'library.administer']],
      [1, [] as string[]],
    ] as const) {
      const context = await browser.newContext({
        baseURL: baseUrl(),
        extraHTTPHeaders: { 'x-forwarded-for': `100.64.247.${String(index + 1)}` },
      });
      contexts.push(context);
      const page = await context.newPage();
      const { email } = await registerAndSignIn(page, `scholarly-${String(index)}`);
      if (keys.length > 0) await grant(await accountIdFor(sql, email), keys);
      if (index === 0) admin = page;
      else stranger = page;
    }
  });

  test('refuses every Phase-9 surface to an account without the permission', async () => {
    for (const surface of [
      'research',
      'research/papers',
      'publications',
      'magazines',
      'encyclopedias',
      `magazines/${magazineId}`,
    ]) {
      const response = await stranger.goto(`/en/admin/library/${surface}`);
      expect(response?.status(), surface).toBe(404);
    }
  });

  test('creates research through the form, and a stale save conflicts visibly', async () => {
    const created = `browser-admin-research-${run}`;
    await admin.goto('/en/admin/library/research');
    await expect(
      admin.getByRole('heading', { level: 1, name: 'Research' }),
    ).toBeVisible();
    await admin.locator('#new-research-slug').fill(created);
    await admin.locator('#new-research-title-en').fill('Synthetic admin research');
    await admin.locator('#new-research-language').selectOption('en');
    await admin.locator('#new-research-state').selectOption('published');
    await admin.locator('#new-research-citation-0-text').fill('Synthetic admin citation');
    await admin.getByRole('button', { name: 'Create', exact: true }).click();
    await admin.waitForURL(/\/en\/admin\/library\/research\/[0-9a-f-]{36}$/);
    const editor = admin.url();

    await admin.goto(`/en/library/research/${created}`);
    await expect(admin.getByText('Synthetic admin citation')).toBeVisible();

    // Two operators open the same version; the second save is refused.
    await admin.goto(editor);
    const second = await admin.context().newPage();
    await second.goto(editor);
    await admin.locator('#research-abstract').fill('Synthetic first abstract.');
    await admin.getByRole('button', { name: 'Save', exact: true }).click();
    await admin.waitForLoadState('networkidle');

    await second.locator('#research-abstract').fill('Synthetic second abstract.');
    await second.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      second.getByRole('alert').filter({ hasText: 'This record changed.' }),
    ).toBeVisible();
    await second.close();

    const [row] = await sql.query<{ abstract: string }>(
      `SELECT [abstract] FROM [dbo].[Research] WHERE [slug]=N'${created}';`,
    );
    expect(row?.abstract).toBe('Synthetic first abstract.');
  });

  test('manages a Magazine’s issues beneath it', async () => {
    await admin.goto(`/en/admin/library/magazines/${magazineId}`);
    const issues = admin.getByRole('table', { name: 'Issues' });
    await expect(
      issues.getByRole('link', { name: 'Synthetic spring issue' }),
    ).toBeVisible();
    await expect(
      issues.getByRole('link', { name: 'Synthetic hidden draft issue' }),
    ).toBeVisible();

    await issues.getByRole('link', { name: 'Synthetic spring issue' }).click();
    await admin.waitForURL(
      new RegExp(`/magazines/${magazineId}/issues/${secondIssueId}$`),
    );
    await expect(admin.getByText('Volume 1, issue 2').first()).toBeVisible();

    // An issue addressed beneath another Magazine is not found, and nothing of it
    // is shown. (The administrative loading boundary has already begun streaming
    // by then, so the not-found state arrives in the body, as it does for every
    // Library editor.)
    await admin.goto(
      `/en/admin/library/magazines/${randomUUID()}/issues/${secondIssueId}`,
    );
    await expect(
      admin.getByRole('heading', { name: 'This page could not be found.' }),
    ).toBeVisible();
    await expect(admin.getByText('Synthetic spring issue')).toHaveCount(0);
  });
});
