import { randomUUID } from 'node:crypto';

import { AxeBuilder } from '@axe-core/playwright';
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
const relatedId = randomUUID();
const undatedIssueId = randomUUID();

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
// Library Part 3: 'Zz…' and undated, so it sorts last in every order and
// crowds no other spec's first page on the shared database.
const RELATED_TITLE = `Zz synthetic related research ${run}`;
const UNDATED_ISSUE = `Zz synthetic undated issue ${run}`;
let educationTopic = '';
const MAGAZINE_TITLE = `Synthetic browser monthly ${WORD}`;

async function grant(accountId: string, keys: readonly string[]): Promise<void> {
  await grantRole(sql, accountId, keys, 'Scholarly browser proof');
}

/** Waits for DERIVED work — the running sweep indexes asynchronously (§8.5). */
async function eventuallyFound(page: Page, query: string, text: string): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.goto(`/search?q=${encodeURIComponent(query)}`);
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
  educationTopic = topic.id.toLowerCase();

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

    INSERT INTO [dbo].[Research] ([id],[slug],[primaryLocale],[languageCode],[state],[version],[updatedAt])
    VALUES (N'${relatedId}', N'browser-related-${run}', N'en', N'en', N'published', 1, SYSUTCDATETIME());
    INSERT INTO [dbo].[ResearchLabel] ([researchId],[locale],[title],[summary])
      VALUES (N'${relatedId}', N'en', N'${RELATED_TITLE}', N'');
    INSERT INTO [dbo].[ResearchContributor] ([researchId],[personId],[role],[position])
      VALUES (N'${relatedId}', N'${people.linkedPersonId}', N'author', 0);
    INSERT INTO [dbo].[ResearchTopic] ([researchId],[topicId]) VALUES (N'${relatedId}', N'${topic.id}');

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
    INSERT INTO [dbo].[MagazineTopic] ([magazineId],[topicId]) VALUES (N'${magazineId}', N'${topic.id}');
    INSERT INTO [dbo].[MagazineIssue] ([id],[magazineId],[slug],[primaryLocale],[languageCode],[state],[volume],[issueNumber],[publicationYear],[version],[updatedAt]) VALUES
      (N'${firstIssueId}', N'${magazineId}', N'winter-${run}', N'en', N'en', N'published', 1, 1, 2021, 1, SYSUTCDATETIME()),
      (N'${secondIssueId}', N'${magazineId}', N'${issueOld}', N'en', N'en', N'published', 1, 2, 2021, 1, SYSUTCDATETIME()),
      (N'${draftIssueId}', N'${magazineId}', N'draft-${run}', N'en', N'en', N'draft', 1, 3, 2021, 1, SYSUTCDATETIME()),
      (N'${undatedIssueId}', N'${magazineId}', N'undated-${run}', N'en', N'en', N'published', NULL, NULL, NULL, 1, SYSUTCDATETIME());
    UPDATE [dbo].[MagazineIssue] SET [slug]=N'${issueSlug}', [document]=N'${document}', [version]=2 WHERE [id]=N'${secondIssueId}';
    INSERT INTO [dbo].[MagazineIssueLabel] ([magazineIssueId],[locale],[title],[summary]) VALUES
      (N'${firstIssueId}', N'en', N'Synthetic winter issue', N''),
      (N'${secondIssueId}', N'en', N'Synthetic spring issue', N''),
      (N'${draftIssueId}', N'en', N'Synthetic hidden draft issue', N''),
      (N'${undatedIssueId}', N'en', N'${UNDATED_ISSUE}', N'');

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
    const response = await page.goto('/library/research');
    expect(response?.status()).toBe(200);
    expect(response?.headers()['set-cookie']).toBeUndefined();
    // Library Part 3: each entry names its record twice — the title, and the
    // way to its text or details ("Abstract and details: …") — so the title
    // link is the EXACT name.
    await expect(
      page.getByRole('link', { name: RESEARCH_TITLE, exact: true }),
    ).toBeVisible();

    await page.goto('/library/research-papers?language=ar');
    await expect(
      page.getByRole('link', {
        name: `Synthetic browser paper ${PAPER_WORD}`,
        exact: true,
      }),
    ).toBeVisible();

    // A filter that matches nothing says so, and offers the way back. (The
    // listings take a decade since Library Part 3, not a year range.)
    await page.goto('/library/research-papers?language=ur&decade=1900');
    await expect(
      page.getByText(/^No research paper matches every filter you chose\./),
    ).toBeVisible();
    await page
      .getByRole('main')
      .getByRole('link', { name: 'Clear filters', exact: true })
      .first()
      .click();
    await expect(page).toHaveURL(/\/library\/research-papers$/);
  });

  test('shows a research record with its abstract, citations, people, topics and text', async ({
    page,
  }) => {
    await page.goto(`/library/research/${researchSlug}`);
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
      '/topics/education',
    );
    await expect(page.locator('a[href^="/people/"]').first()).toBeVisible();

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
    await page.goto(`/library/publications/${publicationSlug}`);
    await expect(page.getByText('Synthetic Press')).toBeVisible();
    await expect(
      page.getByText('The full text is not available on this platform.'),
    ).toBeVisible();
    await page.goto(`/library/encyclopedias/${encyclopediaSlug}`);
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
      '/library/research',
      `/library/research/${researchSlug}`,
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
    await page.goto(`/library/magazines/${magazineSlug}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(MAGAZINE_TITLE);
    // R2 (audit F14): the issues are grouped under their year, newest first.
    const issues = page.getByRole('region', { name: 'Issues' });
    await expect(
      issues.getByRole('heading', { name: '2021', exact: true }),
    ).toBeVisible();
    await expect(
      issues.getByRole('list', { name: '2021' }).getByRole('listitem'),
    ).toHaveCount(2);
    // Library Part 3: the region also holds the year index and the undated
    // issue's group, so the issues of 2021 are read from their own list.
    await expect(issues.getByRole('list', { name: '2021' }).getByRole('link')).toHaveText(
      ['Synthetic spring issue', 'Synthetic winter issue'],
    );
    await expect(page.getByText('Synthetic hidden draft issue')).toHaveCount(0);
  });

  test('places an issue within its Magazine, with its numbers and neighbours', async ({
    page,
  }) => {
    await page.goto(`/library/magazines/${magazineSlug}/issues/${issueSlug}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Synthetic spring issue',
    );
    // The numbering opens the page and is stated among the facts (Library
    // Part 3), so it is read from the facts.
    await expect(
      page.getByRole('region', { name: 'Details' }).getByText('Volume 1, issue 2'),
    ).toBeVisible();

    const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(breadcrumb.getByRole('link', { name: MAGAZINE_TITLE })).toHaveAttribute(
      'href',
      `/library/magazines/${magazineSlug}`,
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
    await hop(`/library/magazines/${magazineOld}`, `/library/magazines/${magazineSlug}`);
    // BOTH halves former: still ONE hop, straight to the current full address.
    await hop(
      `/ar/library/magazines/${magazineOld}/issues/${issueOld}`,
      `/ar/library/magazines/${magazineSlug}/issues/${issueSlug}`,
    );
    await hop(
      `/library/magazines/${magazineSlug}/issues/${issueOld}`,
      `/library/magazines/${magazineSlug}/issues/${issueSlug}`,
    );

    const draft = await request.get(
      `/library/magazines/${magazineSlug}/issues/draft-${run}`,
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
    await page.goto('/library');
    for (const name of [
      'Research',
      'Research papers',
      'Publications',
      'Encyclopedias',
      'Magazines and journals',
    ]) {
      // The landing's own list — the shell's header and footer may carry
      // same-named destinations, which is not what this proves.
      await expect(
        page.getByRole('main').getByRole('link', { name, exact: true }),
      ).toBeVisible();
    }
    // The way to every resource type, the Books entry of the directory, and
    // the metadata notice, said on the page (DOMAIN_MODEL.md §10.1).
    const main = page.getByRole('main');
    await expect(
      main.getByRole('link', { name: 'See every resource type', exact: true }),
    ).toHaveAttribute('href', '/library/resources');
    await expect(
      main.getByRole('region', { name: 'Books and editions' }).getByRole('link', {
        name: 'Books',
        exact: true,
      }),
    ).toHaveAttribute('href', '/library/books');
    await expect(main.getByText(/^Titles and descriptions are shown/)).toBeVisible();

    // Library Part 2: `/library/resources` is a directory of every kind with
    // its count (it previewed ten records of each until then), so it is
    // proved by the kinds this spec publishes being counted and linked.
    await page.goto('/library/resources');
    const scholarly = page.getByRole('region', { name: 'Research and publications' });
    await expect(
      scholarly.getByRole('link', { name: 'Research', exact: true }),
    ).toHaveAttribute('href', '/library/research');
    await expect(scholarly.getByText(/^\d+ research records?$/)).toBeVisible();
    await expect(
      scholarly.getByRole('link', { name: 'Research papers', exact: true }),
    ).toHaveAttribute('href', '/library/research-papers');
    await expect(scholarly.getByText(/^\d+ research papers?$/)).toBeVisible();

    await page.goto('/topics/education');
    const section = page.getByRole('region', { name: 'Research on this topic' });
    // Learn Part 2: the shared research entry also names the record in its
    // details link, so the title link is the EXACT name.
    await expect(
      section.getByRole('link', { name: RESEARCH_TITLE, exact: true }),
    ).toHaveAttribute('href', `/library/research/${researchSlug}`);
  });
});

/* ========================================================================== */

test.describe('Library Part 3 — the written works and periodicals', () => {
  test('the research listings: figures, the two kinds, a Topic and a decade, one address per view', async ({
    page,
  }) => {
    await page.goto(`/library/research?topic=${educationTopic}`);
    const main = page.getByRole('main');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Research');
    // The two kinds are two listings: the way between them keeps the filters.
    const kinds = main.getByRole('navigation', { name: 'Kinds of research' });
    await expect(kinds.getByRole('link', { name: /^Research \d+$/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(
      kinds.getByRole('link', { name: /^Research papers \d+$/ }),
    ).toHaveAttribute('href', `/library/research-papers?topic=${educationTopic}`);
    await expect(
      main.getByRole('link', { name: RESEARCH_TITLE, exact: true }),
    ).toBeVisible();
    await expect(
      main.getByRole('link', { name: RELATED_TITLE, exact: true }),
    ).toBeVisible();
    // The Topic is a chip that removes itself, and an option with its count.
    await expect(main.locator('#research-topic option:checked')).toHaveText(
      /^Education \(\d+\)$/,
    );
    await main.getByRole('link', { name: 'Remove filter: Education' }).click();
    await expect(page).toHaveURL(/\/library\/research$/);

    // The decade timeline: a dated record under its decade, the undated last.
    await page.goto('/library/research?decade=2020');
    await expect(
      page.getByRole('main').getByRole('link', { name: RESEARCH_TITLE, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('main').getByRole('link', { name: RELATED_TITLE, exact: true }),
    ).toHaveCount(0);

    // Former Phase-9 addresses: the offset to its page, a year range dropped.
    await page.goto('/library/research?offset=0');
    await expect(page).toHaveURL(/\/library\/research$/);
    await page.goto('/library/research?from=2019&to=2021&sort=title');
    await expect(page).toHaveURL(/\/library\/research\?sort=title$/);
    // A form's empty controls are one redirect.
    await page.goto('/library/research?topic=&language=&decade=&fulltext=&sort=newest');
    await expect(page).toHaveURL(/\/library\/research$/);
  });

  test('a research record: its calls to action, access, and related works — never twice', async ({
    page,
  }) => {
    await page.goto(`/library/research/${researchSlug}`);
    const main = page.getByRole('main');
    await expect(
      main.getByRole('link', { name: 'Read the full text', exact: true }),
    ).toHaveAttribute('href', '#library-reading');
    const facts = main.getByRole('region', { name: 'Details' });
    await expect(facts.getByText('Yes — 2 sections, below')).toBeVisible();
    await expect(facts.getByText('Not offered on this platform')).toBeVisible();
    await expect(facts.getByText('2 works cited')).toBeVisible();

    const onTopic = main.getByRole('region', { name: 'More on Education' });
    await expect(
      onTopic.getByRole('link', { name: RELATED_TITLE, exact: true }),
    ).toHaveAttribute('href', `/library/research/browser-related-${run}`);
    await expect(
      onTopic.getByRole('link', { name: 'All research on Education', exact: true }),
    ).toHaveAttribute('href', `/library/research?topic=${educationTopic}`);
    // The same record is never offered again "by" its author.
    await expect(main.getByRole('region', { name: /^More by / })).toHaveCount(0);
    await expect(main.getByRole('link', { name: RESEARCH_TITLE })).toHaveCount(0);
  });

  test('publications and encyclopedias: their listings, entries and honest states', async ({
    page,
  }) => {
    await page.goto('/library/publications');
    const main = page.getByRole('main');
    const booklet = main.getByRole('listitem').filter({
      has: page.getByRole('link', { name: 'Synthetic browser booklet', exact: true }),
    });
    await expect(booklet.getByText('Published by Synthetic Press')).toBeVisible();
    await expect(
      booklet.getByRole('link', { name: 'Details: Synthetic browser booklet' }),
    ).toHaveAttribute('href', `/library/publications/${publicationSlug}`);

    // Nothing in a decade: said, with the way back.
    await page.goto('/library/publications?decade=1900');
    await expect(
      page.getByRole('main').getByText('No publication matches these filters'),
    ).toBeVisible();

    await page.goto('/library/encyclopedias');
    const encyclopedia = page
      .getByRole('main')
      .getByRole('listitem')
      .filter({ hasText: 'Synthetic browser encyclopedia' });
    await expect(encyclopedia.getByText('2 entries')).toBeVisible();
    await encyclopedia
      .getByRole('link', { name: 'Read the entries: Synthetic browser encyclopedia' })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/library/encyclopedias/${encyclopediaSlug}$`),
    );
    await expect(
      page.getByRole('main').getByRole('link', { name: 'Read the entries', exact: true }),
    ).toHaveAttribute('href', '#library-reading');
    await expect(page.getByRole('heading', { level: 2, name: 'Entries' })).toBeVisible();
  });

  test('the periodicals directory: each title with its issues, years and latest issue', async ({
    page,
  }) => {
    await page.goto('/library/magazines');
    const entry = page
      .getByRole('main')
      .getByRole('listitem')
      .filter({ has: page.getByRole('link', { name: MAGAZINE_TITLE, exact: true }) });
    await expect(entry.getByText('3 issues')).toBeVisible();
    await expect(entry.getByText('2021', { exact: true })).toBeVisible();
    await expect(
      entry.getByRole('link', { name: 'Latest issue: Synthetic spring issue' }),
    ).toHaveAttribute('href', `/library/magazines/${magazineSlug}/issues/${issueSlug}`);

    // Under its Topic, and a former parameter dropped by one redirect.
    await page.goto(`/library/magazines?topic=${educationTopic}`);
    await expect(
      page.getByRole('main').getByRole('link', { name: MAGAZINE_TITLE, exact: true }),
    ).toBeVisible();
    await page.goto('/library/magazines?offset=25');
    await expect(page).toHaveURL(/\/library\/magazines$/);
  });

  test('a Magazine: its figures, latest issue, year index and pages', async ({
    page,
  }) => {
    await page.goto(`/library/magazines/${magazineSlug}`);
    const main = page.getByRole('main');
    await expect(main.getByText('3 issues', { exact: true })).toBeVisible();
    await expect(
      // The title is said to assistive technology only ("Open the latest issue
      // : …"); the link is named by both.
      main.getByRole('link', {
        name: /^Open the latest issue\s*:\s*Synthetic spring issue$/,
      }),
    ).toHaveAttribute('href', `/library/magazines/${magazineSlug}/issues/${issueSlug}`);

    const index = main.getByRole('navigation', { name: 'Issues by year' });
    await expect(index.getByRole('link')).toHaveText([
      'All years3',
      '20212',
      'Year not recorded1',
    ]);
    await expect(index.getByRole('link', { name: /^All years\s*3$/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await index.getByRole('link', { name: /^2021\s*2$/ }).click();
    await expect(page).toHaveURL(
      new RegExp(`/library/magazines/${magazineSlug}\\?year=2021$`),
    );
    const issues = page.getByRole('region', { name: 'Issues' });
    await expect(
      issues.getByRole('list', { name: '2021' }).getByRole('listitem'),
    ).toHaveCount(2);
    await expect(issues.getByText(UNDATED_ISSUE)).toHaveCount(0);

    await page.goto(`/library/magazines/${magazineSlug}?undated=1`);
    await expect(
      page.getByRole('region', { name: 'Issues' }).getByText(UNDATED_ISSUE),
    ).toBeVisible();

    // A year with nothing, and a page past the end: said, with the way back.
    await page.goto(`/library/magazines/${magazineSlug}?year=1990`);
    await expect(page.getByText('No issue of this magazine is from 1990.')).toBeVisible();
    await page.goto(`/library/magazines/${magazineSlug}?offset=25`);
    await expect(page).toHaveURL(
      new RegExp(`/library/magazines/${magazineSlug}\\?page=2$`),
    );
    await expect(
      page.getByText('There are fewer issues than page 2 would hold.'),
    ).toBeVisible();
  });

  test('an issue: its contents through the reader, its access, and more of its Magazine', async ({
    page,
  }) => {
    await page.goto(`/library/magazines/${magazineSlug}/issues/${issueSlug}`);
    const main = page.getByRole('main');
    await expect(
      main.getByRole('link', { name: 'See what is in this issue', exact: true }),
    ).toHaveAttribute('href', '#library-reading');
    await expect(
      page.getByRole('heading', { level: 2, name: 'In this issue' }),
    ).toBeVisible();
    await expect(
      main
        .getByRole('region', { name: 'Details' })
        .getByText('Not offered on this platform'),
    ).toBeVisible();
    const more = main.getByRole('region', { name: `More from ${MAGAZINE_TITLE}` });
    await expect(
      more.getByRole('link', { name: 'Synthetic winter issue' }),
    ).toBeVisible();
    await expect(more.getByRole('link', { name: UNDATED_ISSUE })).toBeVisible();
    await expect(
      more.getByRole('link', { name: `All issues of ${MAGAZINE_TITLE}` }),
    ).toHaveAttribute('href', `/library/magazines/${magazineSlug}`);

    // An issue without its contents here says so — and offers no reading.
    await page.goto(`/library/magazines/${magazineSlug}/issues/winter-${run}`);
    await expect(
      page.getByText('The contents of this issue are not available on this platform.'),
    ).toBeVisible();
    await expect(page.locator('#library-reading')).toHaveCount(0);
  });

  test('the Articles listing is Editorial’s one listing, one address per page', async ({
    page,
  }) => {
    await page.goto('/library/articles?offset=0');
    await expect(page).toHaveURL(/\/library\/articles$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Articles');
    const main = page.getByRole('main');
    await expect(
      main.getByText(/^1–\d+ of \d+ articles?$/).or(main.getByText('No articles yet')),
    ).toBeVisible();
    await page.goto('/library/articles?page=two');
    await expect(page).toHaveURL(/\/library\/articles$/);
  });

  test('every Part 3 surface: no serious accessibility finding and no sideways scroll, in English, Urdu and Arabic', async ({
    page,
  }, testInfo) => {
    test.setTimeout(600_000);
    for (const locale of ['', '/ur', '/ar'])
      for (const target of [
        '/library/research',
        '/library/research-papers',
        '/library/publications',
        '/library/encyclopedias',
        '/library/magazines',
        '/library/articles',
        `/library/research/${researchSlug}`,
        `/library/publications/${publicationSlug}`,
        `/library/encyclopedias/${encyclopediaSlug}`,
        `/library/magazines/${magazineSlug}`,
        `/library/magazines/${magazineSlug}/issues/${issueSlug}`,
      ])
        for (const width of [320, 1440]) {
          const address = `${locale}${target}`;
          await page.setViewportSize({ width, height: 900 });
          const response = await page.goto(address);
          expect(response?.status(), address).toBe(200);
          await expect(page.locator('html')).toHaveAttribute(
            'dir',
            locale === '' ? 'ltr' : 'rtl',
          );
          const overflow = await page.evaluate(
            () =>
              document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          expect(overflow, `${address} at ${String(width)}px`).toBeLessThanOrEqual(0);
          if (width !== 1440) continue;
          const results = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
            .analyze();
          const blocking = results.violations.filter(
            (violation) =>
              violation.impact === 'serious' || violation.impact === 'critical',
          );
          for (const finding of results.violations.filter((v) => !blocking.includes(v)))
            testInfo.annotations.push({
              type: 'axe',
              description: `${address}: ${finding.id} (${String(finding.impact)})`,
            });
          expect(
            blocking.map((violation) => `${violation.id}: ${violation.nodes.length}`),
            address,
          ).toEqual([]);
        }
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
      `/library/research/${researchSlug}`,
    );
    await expect(
      results.getByRole('link', { name: 'Synthetic spring issue' }),
    ).toHaveAttribute('href', `/library/magazines/${magazineSlug}/issues/${issueSlug}`);

    await eventuallyFound(page, PAPER_WORD, `Synthetic browser paper ${PAPER_WORD}`);
    // Withdrawn with no indexing request: the stale row is still in the index,
    // and the query-time visibility check is all that stands between it and the
    // page.
    await sql.query(
      `UPDATE [dbo].[ResearchPaper] SET [state]=N'archived' WHERE [id]=N'${paperId}';`,
    );
    await page.goto(`/search?q=${PAPER_WORD}`);
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
      const response = await stranger.goto(`/admin/library/${surface}`);
      expect(response?.status(), surface).toBe(404);
    }
  });

  test('creates research through the form, and a stale save conflicts visibly', async () => {
    const created = `browser-admin-research-${run}`;
    await admin.goto('/admin/library/research');
    await expect(
      admin.getByRole('heading', { level: 1, name: 'Research' }),
    ).toBeVisible();
    await admin.locator('#new-research-slug').fill(created);
    await admin.locator('#new-research-title-en').fill('Synthetic admin research');
    await admin.locator('#new-research-language').selectOption('en');
    await admin.locator('#new-research-state').selectOption('published');
    await admin.locator('#new-research-citation-0-text').fill('Synthetic admin citation');
    await admin.getByRole('button', { name: 'Create', exact: true }).click();
    await admin.waitForURL(/\/admin\/library\/research\/[0-9a-f-]{36}$/);
    const editor = admin.url();

    await admin.goto(`/library/research/${created}`);
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
    await admin.goto(`/admin/library/magazines/${magazineId}`);
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
    await admin.goto(`/admin/library/magazines/${randomUUID()}/issues/${secondIssueId}`);
    await expect(
      admin.getByRole('heading', { name: 'This page could not be found.' }),
    ).toBeVisible();
    await expect(admin.getByText('Synthetic spring issue')).toHaveCount(0);
  });
});
