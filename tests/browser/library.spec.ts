import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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
  browserEnvironment,
  expect,
  privilegedSession,
  registerAndSignIn,
  test,
  grantRole,
} from './support';

/**
 * Phase 8 — the Library in a real browser, against the production build.
 *
 * WHAT ONLY A BROWSER CAN PROVE: that the long-form reader is navigable by
 * keyboard, that it reflows at small widths without horizontal scroll, that the
 * position identifier survives a reload and a type-size change, that Urdu and
 * Arabic render right-to-left with the edition's own direction inside the
 * interface's, that the old slug answers 301 through the real proxy, and that the
 * byte routes answer — or refuse — over HTTP through the real locale matcher.
 *
 * EVERYTHING IS SYNTHETIC. The Work, its Editions and their text say they are
 * proofs; the people are the Phase-5 rehearsal contributors; the "PDF" is a few
 * bytes with a PDF header. No real book, no real rights decision.
 */

test.describe.configure({ mode: 'serial' });

let sql: SqlSession;
const contexts: BrowserContext[] = [];
const people = newPhase5Fixture();

const run = randomUUID().replaceAll('-', '').slice(0, 12);
const currentSlug = `browser-library-${run}`;
const oldSlug = `browser-library-old-${run}`;
const draftSlug = `browser-library-draft-${run}`;

const workId = randomUUID();
const draftWorkId = randomUUID();
const datedWorkId = randomUUID();
const datedSlug = `browser-library-dated-${run}`;
const datedTitle = `Zz synthetic dated library proof ${run}`;
const arabicId = randomUUID();
const urduId = randomUUID();
const draftEditionId = randomUUID();
const downloadAssetId = randomUUID();
const deniedAssetId = randomUUID();
const salePointId = randomUUID();

// Library Part 2: this run's own contributor, downloadable Edition and sale
// point, each named "Zz…" so it sorts last and crowds no other spec's first
// page, and found by its unique name or address.
const authorId = randomUUID();
const authorSlug = `browser-library-author-${run}`;
const authorName = `Zz synthetic library author ${run}`;
const browseWorkId = randomUUID();
const browseSlug = `browser-library-browse-${run}`;
const browseTitle = `Zz synthetic browse proof ${run}`;
const browseEditionId = randomUUID();
const browseAssetId = randomUUID();
const browseSalePointId = randomUUID();
const browseSalePoint = `Zz synthetic sale point ${run}`;
let topicId = '';
let topicSlug = '';

const CONTENT_VERSION = 'd'.repeat(64);
const SECTIONS = ['opening', 'middle', 'closing'] as const;
const position = (key: string) => `edition-${arabicId}-${CONTENT_VERSION}-${key}`;

const PDF = Buffer.from('%PDF-1.4\n% synthetic browser proof document\n%%EOF\n');

/**
 * Places a synthetic file in the run's disposable storage root and records it as a
 * CLEAN asset, exactly as Storage would have after a successful scan. The browser
 * suite runs with an unreachable scanner on purpose, so a clean asset has to be
 * seeded; the scanner's real behaviour is proved by the Database foundation job.
 */
async function seedCleanAsset(id: string): Promise<void> {
  const hex = randomBytes(16).toString('hex');
  const key = `${hex.slice(0, 2)}/${hex.slice(2, 4)}/${hex}`;
  const file = path.join(browserEnvironment().storageRoot, ...key.split('/'));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, PDF);
  const checksum = createHash('sha256').update(PDF).digest('hex');

  await sql.query(
    `INSERT INTO [dbo].[Asset] ([id],[storageKey],[mediaType],[byteSize],[checksum],[state],[updatedAt]) VALUES (N'${id}',N'${key}',N'application/pdf',${PDF.byteLength},N'${checksum}',N'clean',SYSUTCDATETIME());`,
  );
}

async function grant(id: string, keys: readonly string[]): Promise<void> {
  await grantRole(sql, id, keys, 'Library browser proof');
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  sql = await privilegedSession();

  await writePhase5Fixture(sql, people);

  const [topic] = await sql.query<{ id: string; slug: string }>(
    "SELECT TOP 1 [id],[slug] FROM [Topic] WHERE [status]=N'active' ORDER BY [id];",
  );
  if (topic === undefined) throw new Error('No seeded Topic is available.');
  // Lower case, as every canonical Library address spells an identifier.
  topicId = topic.id.toLowerCase();
  topicSlug = topic.slug;

  await seedCleanAsset(downloadAssetId);
  await seedCleanAsset(deniedAssetId);
  await seedCleanAsset(browseAssetId);

  const document = JSON.stringify({
    sections: SECTIONS.map((key) => ({
      key,
      title: `Synthetic ${key} section`,
      paragraphs: [
        `Synthetic, non-authoritative ${key} text for the browser proof. `.repeat(20),
      ],
    })),
  });

  // Created at the OLD slug and renamed, so the database trigger reserves both
  // and the proxy has a genuine former address to answer 301 for.
  await sql.query(`
    INSERT INTO [dbo].[Work] ([id],[slug],[primaryLocale],[state],[isFeatured],[version],[updatedAt])
    VALUES (N'${workId}', N'${oldSlug}', N'ar', N'published', 0, 1, SYSUTCDATETIME());
    UPDATE [dbo].[Work] SET [slug]=N'${currentSlug}', [version]=2 WHERE [id]=N'${workId}';
    INSERT INTO [dbo].[WorkLabel] ([workId],[locale],[title],[description]) VALUES
      (N'${workId}', N'en', N'Synthetic browser proof work', N'Non-authoritative fixture.'),
      (N'${workId}', N'ar', N'عمل تجريبي للمتصفح', N'');
    INSERT INTO [dbo].[WorkContributor] ([workId],[personId],[role],[position])
      VALUES (N'${workId}', N'${people.linkedPersonId}', N'author', 0);
    INSERT INTO [dbo].[WorkTopic] ([workId],[topicId]) VALUES (N'${workId}', N'${topic.id}');

    INSERT INTO [dbo].[Edition]
      ([id],[workId],[languageCode],[label],[state],[isbn],[reading],[download],[downloadAssetId],[document],[contentVersion],[version],[updatedAt])
    VALUES
      (N'${arabicId}', N'${workId}', N'ar', N'Synthetic Arabic edition', N'published', N'9780306406157',
       N'allowed', N'allowed', N'${downloadAssetId}', N'${document}', N'${CONTENT_VERSION}', 1, SYSUTCDATETIME()),
      (N'${urduId}', N'${workId}', N'ur', N'Synthetic Urdu translation', N'published', NULL,
       N'unavailable', N'denied', N'${deniedAssetId}', NULL, NULL, 1, SYSUTCDATETIME()),
      (N'${draftEditionId}', N'${workId}', N'en', N'Synthetic draft edition', N'draft', NULL,
       N'unavailable', N'denied', NULL, NULL, NULL, 1, SYSUTCDATETIME());

    INSERT INTO [dbo].[BookTranslation] ([editionId],[workId],[sourceEditionId])
      VALUES (N'${urduId}', N'${workId}', N'${arabicId}');
    INSERT INTO [dbo].[BookTranslator] ([editionId],[personId])
      VALUES (N'${urduId}', N'${people.historicalPersonId}');

    INSERT INTO [dbo].[SalePoint] ([id],[name],[address],[contact],[url],[state],[version])
      VALUES (N'${salePointId}', N'Synthetic browser sale point', N'Nowhere, a proof address', N'', NULL, N'published', 1);
    INSERT INTO [dbo].[WorkSalePoint] ([workId],[salePointId]) VALUES (N'${workId}', N'${salePointId}');

    INSERT INTO [dbo].[Work] ([id],[slug],[primaryLocale],[state],[isFeatured],[version],[updatedAt])
    VALUES (N'${draftWorkId}', N'${draftSlug}', N'en', N'draft', 0, 1, SYSUTCDATETIME());
    INSERT INTO [dbo].[WorkLabel] ([workId],[locale],[title],[description])
      VALUES (N'${draftWorkId}', N'en', N'Synthetic hidden draft work', N'');

    -- Library Part 1: a DATED Work by this run's author, so the year-range
    -- filter has a year to offer and to narrow by, whatever else is published.
    -- Titled "Zz" and dated a century back, it sorts last by title and after
    -- every recent Work by date, so it crowds no first page.
    INSERT INTO [dbo].[Work] ([id],[slug],[primaryLocale],[state],[isFeatured],[version],[updatedAt])
      VALUES (N'${datedWorkId}', N'${datedSlug}', N'en', N'published', 0, 1, SYSUTCDATETIME());
    INSERT INTO [dbo].[WorkLabel] ([workId],[locale],[title],[description])
      VALUES (N'${datedWorkId}', N'en', N'${datedTitle}', N'');
    INSERT INTO [dbo].[WorkContributor] ([workId],[personId],[role],[position])
      VALUES (N'${datedWorkId}', N'${people.linkedPersonId}', N'author', 0);
    INSERT INTO [dbo].[Edition]
      ([id],[workId],[languageCode],[label],[state],[publicationYear],[reading],[download],[version],[updatedAt])
    VALUES
      (N'${randomUUID()}', N'${datedWorkId}', N'en', N'Synthetic dated edition', N'published', 1901,
       N'unavailable', N'denied', 1, SYSUTCDATETIME());

    -- Library Part 2: an author of this run alone, credited as author AND
    -- editor on one undated, downloadable Work sold at this run's sale point.
    -- Undated and titled "Zz", it sorts last by title and by date.
    INSERT INTO [dbo].[Person] ([id],[slug],[userId],[primaryLocale],[status])
      VALUES (N'${authorId}', N'${authorSlug}', NULL, N'en', N'published');
    INSERT INTO [dbo].[PersonTranslation] ([personId],[locale],[name],[biography])
      VALUES (N'${authorId}', N'en', N'${authorName}', NULL);
    INSERT INTO [dbo].[Work] ([id],[slug],[primaryLocale],[state],[isFeatured],[version],[updatedAt])
      VALUES (N'${browseWorkId}', N'${browseSlug}', N'en', N'published', 0, 1, SYSUTCDATETIME());
    INSERT INTO [dbo].[WorkLabel] ([workId],[locale],[title],[description])
      VALUES (N'${browseWorkId}', N'en', N'${browseTitle}', N'');
    INSERT INTO [dbo].[WorkContributor] ([workId],[personId],[role],[position]) VALUES
      (N'${browseWorkId}', N'${authorId}', N'author', 0),
      (N'${browseWorkId}', N'${authorId}', N'editor', 1);
    INSERT INTO [dbo].[WorkTopic] ([workId],[topicId]) VALUES (N'${browseWorkId}', N'${topic.id}');
    INSERT INTO [dbo].[Edition]
      ([id],[workId],[languageCode],[label],[state],[pageCount],[reading],[download],[downloadAssetId],[version],[updatedAt])
    VALUES
      (N'${browseEditionId}', N'${browseWorkId}', N'en', N'Synthetic downloadable edition', N'published', 12,
       N'unavailable', N'allowed', N'${browseAssetId}', 1, SYSUTCDATETIME());
    INSERT INTO [dbo].[SalePoint] ([id],[name],[address],[contact],[url],[state],[version])
      VALUES (N'${browseSalePointId}', N'${browseSalePoint}', N'Proof Street ${run}, Proofabad', N'+00 0000 000000', N'https://example.org/proof', N'published', 1);
    INSERT INTO [dbo].[WorkSalePoint] ([workId],[salePointId]) VALUES (N'${browseWorkId}', N'${browseSalePointId}');
  `);
});

test.afterAll(async () => {
  for (const context of contexts) await context.close();
  await sql?.close();
});

/* ========================================================================== */

test.describe('an anonymous visitor reads the Library', () => {
  test('browses books with no session and no cookie, and never sees a draft', async ({
    page,
  }) => {
    const response = await page.goto('/library/books');
    expect(response?.status()).toBe(200);
    expect(response?.headers()['set-cookie']).toBeUndefined();

    await expect(
      page.getByRole('link', { name: 'Synthetic browser proof work' }),
    ).toBeVisible();
    await expect(page.getByText('Synthetic hidden draft work')).toHaveCount(0);
    // Descriptive metadata is not a translated edition, and the listing says so.
    await expect(page.getByText(/^Titles and descriptions are shown/)).toBeVisible();

    // The Urdu INTERFACE lists every content language — it is not an Urdu filter.
    // The Work has no Urdu LABEL, so it is titled in its own primary language
    // (Arabic), marked as Arabic, rather than in an invented Urdu title.
    await page.goto('/ur/library/books');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const arabicTitle = page.getByRole('link', { name: 'عمل تجريبي للمتصفح' });
    await expect(arabicTitle).toBeVisible();
    // Library Part 1: the shared Books listing's cards head their title with
    // an h3 under the listing's own h2 (an h2 per card until then).
    await expect(page.locator('h3', { has: arabicTitle })).toHaveAttribute('lang', 'ar');

    // A content-language filter is the visitor's choice and narrows in SQL.
    await page.goto('/library/books?language=ur');
    await expect(
      page.getByRole('link', { name: 'Synthetic browser proof work' }),
    ).toBeVisible();

    // R2: the reader's order is a choice too, and never admits a draft.
    await page.goto('/library/books?sort=newest');
    // Library Part 1: the shared Books listing's order control.
    await expect(page.locator('#books-sort')).toHaveValue('newest');
    await expect(
      page.getByRole('link', { name: 'Synthetic browser proof work' }),
    ).toBeVisible();
    await expect(page.getByText('Synthetic hidden draft work')).toHaveCount(0);
  });

  test('Library Part 1: the listing filters with counts, chips and one address per view', async ({
    page,
  }) => {
    // This run's own author narrows every view to this run's Work, so the
    // proofs below hold whatever the parallel specs publish.
    const mine = `contributor=${people.linkedPersonId}`;
    const card = () =>
      page.getByRole('list', { name: 'Books', exact: true }).locator('li', {
        has: page.getByRole('link', { name: 'Synthetic browser proof work' }),
      });

    // The listing's figures and its filters, each option with its count.
    await page.goto('/library/books');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Books');
    await expect(page.getByText(/books? in the Library$/)).toBeVisible();
    await expect(page.locator('#books-language option[value="ur"]')).toHaveText(
      /\(\d+\)$/,
    );
    await expect(page.locator('#books-topic option')).not.toHaveCount(0);
    await expect(page.locator('#books-from')).toBeVisible();
    await expect(page.locator('#books-to')).toBeVisible();
    await expect(page.locator('input[name="readable"]')).toBeVisible();
    await expect(page.locator('input[name="downloads"]')).toBeVisible();

    // The card says what an Edition allows: read online, and a download.
    await page.goto(`/library/books?${mine}`);
    await expect(card().getByText('Read online', { exact: true })).toBeVisible();
    await expect(card().getByText('Download', { exact: true })).toBeVisible();

    // Readable online and downloadable each narrow to an Edition that allows it…
    await page.goto(`/library/books?${mine}&readable=1&downloads=1`);
    await expect(card()).toHaveCount(1);
    for (const name of ['Readable online', 'Downloadable'])
      await expect(
        page.getByRole('link', { name: `Remove filter: ${name}` }),
      ).toBeVisible();
    // …and every Edition filter is asked of ONE Edition: the Urdu Edition is
    // neither readable nor in this run's year range, so nothing matches.
    await page.goto(`/library/books?language=ur&${mine}&readable=1`);
    await expect(page.getByText('No books match these filters')).toBeVisible();
    await page.getByRole('link', { name: 'Remove filter: Readable online' }).click();
    await expect(page).toHaveURL(new RegExp(`/library/books\\?language=ur&${mine}$`));
    await expect(card()).toHaveCount(1);

    // A year range narrows to an Edition published inside it.
    await page.goto(`/library/books?${mine}&from=1900&to=1910`);
    await expect(page.getByRole('link', { name: datedTitle })).toBeVisible();
    await expect(card()).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: 'Remove filter: 1900–1910' }),
    ).toBeVisible();

    // One address per view: what the former filter form submitted, and a
    // former offset (25 a page until Library Part 1), are one redirect each.
    await page.goto(`/library/books?sort=title&language=&topic=&from=&to=&${mine}`);
    await expect(page).toHaveURL(new RegExp(`/library/books\\?${mine}$`));
    await page.goto('/library/books?offset=25');
    await expect(page).toHaveURL(/\/library\/books\?page=2$/);
  });

  test('Library Part 1: the landing — figures, ways in, subject hubs and every menu item', async ({
    page,
  }) => {
    const response = await page.goto('/library');
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole('heading', { name: 'The Library at a glance' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /^\d+\s*books?$/ })).toHaveAttribute(
      'href',
      '/library/books',
    );
    const find = page.getByRole('region', { name: 'Find a book' });
    await expect(find.getByRole('heading', { name: 'By topic' })).toBeVisible();
    await expect(find.getByRole('heading', { name: 'By language' })).toBeVisible();
    await expect(find.getByRole('link', { name: 'Every topic' })).toHaveAttribute(
      'href',
      '/library/topics',
    );
    // Library Part 2: the "by kind" way in repeated the directory below it
    // link for link (two "Research" links on one page), so it was removed;
    // the kinds are the directory's alone, and Find a book offers none.
    await expect(find.getByRole('link', { name: 'Research', exact: true })).toHaveCount(
      0,
    );
    await expect(find.getByRole('link', { name: 'Books', exact: true })).toHaveCount(0);
    // The subject hubs, in their own section: the header's Hadith menu also
    // offers "Books on Hadith" once Hadith books exist — the shell's
    // navigation, not this page offering the destination twice.
    const subjects = page.getByRole('region', { name: 'Books by subject' });
    await expect(
      subjects.getByRole('link', { name: 'Books on the Quran' }),
    ).toHaveAttribute('href', '/quran/books');
    await expect(subjects.getByRole('link', { name: 'Books on Hadith' })).toHaveAttribute(
      'href',
      '/hadith/books',
    );
    // Every item of the Library menu is reachable from its front door.
    const main = page.getByRole('main');
    for (const section of [
      'resources',
      'books',
      'authors',
      'topics',
      'languages',
      'articles',
      'research',
      'research-papers',
      'publications',
      'magazines',
      'encyclopedias',
      'downloads',
      'sale-points',
    ])
      await expect(main.locator(`a[href="/library/${section}"]`).first()).toBeAttached();
  });

  test('shows the Work with truthful editions, translation and availability', async ({
    page,
  }) => {
    await page.goto(`/library/books/${currentSlug}`);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Synthetic browser proof work',
    );

    const editions = page.getByRole('list', { name: 'Editions' });
    await expect(
      editions.getByRole('heading', { name: 'Synthetic Arabic edition' }),
    ).toBeVisible();
    await expect(
      editions.getByRole('heading', { name: 'Synthetic Urdu translation' }),
    ).toBeVisible();
    // A DRAFT Edition is not public, even by explicit selection.
    await expect(editions.getByText('Synthetic draft edition')).toHaveCount(0);

    // The translation is stated where it is a FACT, naming its real source, on
    // the Urdu Edition only — the Arabic original is not a translation.
    const urdu = editions
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: 'Synthetic Urdu translation' }) });
    await expect(urdu.getByText('Translated from')).toBeVisible();
    await expect(urdu.getByText('Synthetic Arabic edition')).toBeVisible();
    await expect(editions.getByText('Translated from')).toHaveCount(1);

    // Library Part 1: the source names its translation, and each Edition its
    // own calls to action — only the ones its stored decision allows.
    const arabic = editions
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: 'Synthetic Arabic edition' }) });
    await expect(arabic.getByText('Translated into')).toBeVisible();
    await expect(
      arabic.getByRole('link', { name: 'Synthetic Urdu translation' }),
    ).toHaveAttribute('href', `/library/books/${currentSlug}?edition=${urduId}`);
    await expect(arabic.getByRole('link', { name: /^Download PDF/ })).toHaveAttribute(
      'href',
      `/assets/library/editions/${arabicId}/download/${downloadAssetId}`,
    );
    await expect(arabic.getByText('Readable online')).toBeVisible();
    await expect(
      urdu.getByRole('link', { name: /Download|Read online|Open PDF/ }),
    ).toHaveCount(0);
    await expect(urdu.getByText('Not available online')).toBeVisible();
    // The header's calls follow the selected (Arabic) Edition.
    await expect(
      page
        .getByRole('main')
        .locator('a[href="#library-reading"]', { hasText: 'Read online' }),
    ).toBeVisible();

    await expect(page.getByText('Synthetic browser sale point')).toBeVisible();
    await expect(
      page.getByText('Nothing is sold through this platform', { exact: false }).first(),
    ).toBeVisible();

    // Pre-adoption: not indexable, so no machine-readable Book claim either.
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/,
    );

    await page.goto(`/library/books/${currentSlug}?edition=${draftEditionId}`);
    await expect(page.getByText('Synthetic draft edition')).toHaveCount(0);
  });

  test('reads the whole edition, by keyboard, with a stable position', async ({
    page,
  }) => {
    await page.goto(`/library/books/${currentSlug}?edition=${arabicId}`);

    const reader = page.locator('#library-reader');
    await expect(reader).toHaveAttribute('lang', 'ar');
    await expect(reader).toHaveAttribute('dir', 'rtl');

    for (const key of SECTIONS) {
      await expect(page.locator(`[id="${position(key)}"]`)).toHaveCount(1);
    }

    // KEYBOARD: focus a contents entry, press Enter, arrive at that section.
    const contents = page.getByRole('navigation', { name: 'Contents' });
    await contents.getByRole('link', { name: 'Synthetic middle section' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`#${position('middle')}$`));
    // Library Part 1: the position bar stays with the reader, and the
    // contents mark the section being read.
    await expect(
      page.getByRole('navigation', { name: 'Reading position' }),
    ).toBeVisible();
    await expect(
      contents.getByRole('link', { name: 'Synthetic middle section' }),
    ).toHaveAttribute('aria-current', 'location');

    // Sequential links, as ordinary links.
    await page
      .locator(`[id="${position('middle')}"]`)
      .getByRole('link', { name: 'Next section' })
      .focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`#${position('closing')}$`));

    // A READING-PREFERENCE change moves nothing: same identifiers after it.
    const before = await reader.evaluate((element) => getComputedStyle(element).fontSize);
    await page.getByRole('button', { name: 'Increase: Text size' }).click();
    await page.getByRole('button', { name: 'Increase: Text size' }).click();
    await expect
      .poll(() => reader.evaluate((element) => getComputedStyle(element).fontSize))
      .not.toBe(before);
    for (const key of SECTIONS) {
      await expect(page.locator(`[id="${position(key)}"]`)).toHaveCount(1);
    }

    // RELOAD: the preference persists locally, and the position is unchanged.
    const enlarged = await reader.evaluate(
      (element) => getComputedStyle(element).fontSize,
    );
    await page.reload();
    await expect
      .poll(() => reader.evaluate((element) => getComputedStyle(element).fontSize))
      .toBe(enlarged);
    await expect(page.locator(`[id="${position('closing')}"]`)).toHaveCount(1);

    // No reading position left the browser: nothing about this visit was stored.
    // Since Phase 21 a SIGNED-IN person may keep their own history of a book
    // (one row per Work, never a position inside an Edition); an anonymous
    // visit like this one leaves no personal row naming the Work at all.
    const [stored] = await sql.query<{ total: number }>(
      `SELECT (SELECT COUNT_BIG(*) FROM [dbo].[ReadingHistory] WHERE [workId] = N'${workId}')
             + (SELECT COUNT_BIG(*) FROM [dbo].[SavedItem] WHERE [workId] = N'${workId}') AS [total];`,
    );
    expect(Number(stored?.total ?? -1)).toBe(0);
    // And the edition reader still keeps no position table of its own.
    const [positions] = await sql.query<{ total: number }>(
      `SELECT COUNT_BIG(*) AS [total] FROM sys.tables WHERE [name] LIKE N'%Edition%Position%' OR [name] LIKE N'%ReaderPosition%';`,
    );
    expect(Number(positions?.total ?? -1)).toBe(0);
  });

  test('reflows at a 320px width without horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/library/books/${currentSlug}?edition=${arabicId}`);
    await page.getByRole('button', { name: 'Increase: Text size' }).click();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('keeps the interface and the edition in their own directions', async ({
    page,
  }) => {
    await page.goto(`/ur/library/books/${currentSlug}?edition=${arabicId}`);

    await expect(page.locator('html')).toHaveAttribute('lang', 'ur');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('#library-reader')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('#library-reader-contents')).toHaveAttribute('lang', 'ur');

    // English interface, Arabic edition: the chrome is LTR and the text is RTL.
    await page.goto(`/library/books/${currentSlug}?edition=${arabicId}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('#library-reader')).toHaveAttribute('dir', 'rtl');
  });

  test('says honestly when an edition cannot be read or downloaded', async ({ page }) => {
    const response = await page.goto(`/library/books/${currentSlug}?edition=${urduId}`);
    expect(response?.status()).toBe(200);

    await expect(
      page.getByText('This edition is not available to read on this platform.'),
    ).toBeVisible();
    await expect(
      page.getByText('No download is offered for this edition.'),
    ).toBeVisible();
    await expect(page.locator('#library-reader')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Download this edition/ })).toHaveCount(
      0,
    );
    // Library Part 1: and it leads to the Edition that can be read.
    const other = `/library/books/${currentSlug}?edition=${arabicId}#library-reading`;
    await expect(page.getByRole('main').locator(`a[href="${other}"]`).first()).toHaveText(
      /^Read the .+ edition$/,
    );
  });

  test('Library Part 1: no serious accessibility finding and no sideways scroll, in English and Urdu', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    for (const locale of ['', '/ur'])
      for (const target of [
        '/library',
        '/library/books',
        `/library/books/${currentSlug}?edition=${arabicId}`,
        `/library/books/${currentSlug}?edition=${urduId}`,
      ])
        for (const width of [320, 1440]) {
          const address = `${locale}${target}`;
          await page.setViewportSize({ width, height: 900 });
          const response = await page.goto(address);
          expect(response?.status(), address).toBe(200);
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

  test('redirects the old slug with exactly one 301, locale preserved', async ({
    request,
  }) => {
    const response = await request.get(`/ur/library/books/${oldSlug}`, {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(301);
    expect(response.headers()['location']).toMatch(
      new RegExp(`/ur/library/books/${currentSlug}$`),
    );

    const unknown = await request.get(`/library/books/${draftSlug}`, {
      maxRedirects: 0,
    });
    expect(unknown.status()).toBe(404);
  });
});

/* ========================================================================== */

test.describe('Library Part 2 — the browse and access pages', () => {
  /** A search box's value as a GET form submits it. */
  const typed = (text: string) => encodeURIComponent(text).replaceAll('%20', '+');

  test('the resources directory counts every kind, and a typed view is its listing', async ({
    page,
  }) => {
    const response = await page.goto('/library/resources');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('All resources');
    const books = page.getByRole('region', { name: 'Books and editions' });
    await expect(books.getByRole('link', { name: 'Books', exact: true })).toHaveAttribute(
      'href',
      '/library/books',
    );
    await expect(books.getByText(/^\d+ books?$/)).toBeVisible();
    const access = page.getByRole('region', { name: 'Access and availability' });
    await expect(access.getByText(/^\d+ editions? to download$/)).toBeVisible();
    await expect(access.getByText(/^\d+ sale points?$/)).toBeVisible();
    // The route map's `?type, topic…` is that kind's own listing, in one redirect.
    await page.goto(`/library/resources?type=books&topic=${topicId}`);
    await expect(page).toHaveURL(new RegExp(`/library/books\\?topic=${topicId}$`));
    // The listing it lands on pre-selects that Topic and names its chip: the
    // address spells the identifier in lower case while the Topic is stored in
    // upper case, and the two compare without case — never "A topic".
    await expect(page.locator('select[name="topic"]')).toHaveValue(topicId);
    const chips = page.getByRole('link', { name: /^Remove filter: / });
    await expect(chips).toHaveCount(1);
    await expect(chips.first()).not.toHaveAccessibleName('Remove filter: A topic');
    await page.goto('/library/resources?type=nothing');
    await expect(page).toHaveURL(/\/library\/resources$/);
  });

  test('the author directory: roles, books, profile, filters and one address', async ({
    page,
  }) => {
    const q = typed(authorName);
    const card = page.locator('main li', {
      has: page.getByRole('heading', { name: authorName }),
    });
    await page.goto(`/library/authors?q=${q}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Authors and contributors',
    );
    await expect(
      card.getByRole('link', { name: authorName, exact: true }),
    ).toHaveAttribute('href', `/people/${authorSlug}`);
    await expect(card.getByText('Author of 1 book', { exact: true })).toBeVisible();
    await expect(card.getByText('Editor of 1 book', { exact: true })).toBeVisible();
    await expect(
      card.getByRole('link', { name: `1 book by ${authorName}` }),
    ).toHaveAttribute('href', `/library/books?contributor=${authorId}`);
    // No portrait is recorded, so the initial tile stands in.
    await expect(card.getByText('Z', { exact: true })).toBeVisible();

    // A role narrows; one this person does not hold leaves nobody.
    await page.goto(`/library/authors?role=editor&q=${q}`);
    await expect(card).toHaveCount(1);
    await page.goto(`/library/authors?role=translator&q=${q}`);
    await expect(page.getByText('No one matches')).toBeVisible();
    await page.getByRole('link', { name: 'Remove filter: Translator' }).click();
    await expect(page).toHaveURL(/\/library\/authors\?q=Zz\+synthetic/);
    await expect(card).toHaveCount(1);

    // The first-letter index is a view of its own, spelled one way.
    await page.goto(`/library/authors?letter=z&q=${q}`);
    await expect(page).toHaveURL(/\/library\/authors\?letter=Z&q=Zz\+synthetic/);
    await expect(card).toHaveCount(1);

    // One address per view: empty controls and a former offset, one redirect each.
    await page.goto('/library/authors?q=&role=');
    await expect(page).toHaveURL(/\/library\/authors$/);
    await page.goto('/library/authors?offset=50');
    await expect(page).toHaveURL(/\/library\/authors$/);
  });

  test('topics and languages lead into the listings they count', async ({ page }) => {
    await page.goto('/library/topics');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Topics');
    // The Topic's own entry: its heading links to its Topic page.
    const topicLink = page.locator(`h3 a[href="/topics/${topicSlug}"]`);
    await expect(page.getByRole('main').locator(topicLink)).toBeVisible();
    const entry = page.locator('main li', { has: topicLink });
    await expect(entry.locator(`a[href="/library/books?topic=${topicId}"]`)).toHaveText(
      /^\d+ books?$/,
    );
    await page.goto('/library/topics?offset=50');
    await expect(page).toHaveURL(/\/library\/topics$/);

    await page.goto('/library/languages');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Content languages');
    const arabic = page.locator('main li', { has: page.locator('h2[lang="ar"]') });
    await expect(arabic.locator('h2')).toHaveAttribute('dir', 'rtl');
    await expect(arabic.locator('a[href="/library/books?language=ar"]')).toHaveText(
      /^\d+ books?$/,
    );
  });

  test('downloads: format, size, rights and the unchanged asset route', async ({
    page,
    request,
  }) => {
    const item = page.locator('main li', {
      has: page.getByRole('link', { name: browseTitle }),
    });
    await page.goto('/library/downloads');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Downloads');
    await expect(item.getByRole('link', { name: browseTitle })).toHaveAttribute(
      'href',
      `/library/books/${browseSlug}?edition=${browseEditionId}`,
    );
    await expect(item.getByText(/^PDF, \d+ byte$/)).toBeVisible();
    await expect(
      item.getByText('Download allowed by the rights recorded for this edition'),
    ).toBeVisible();
    const target = `/assets/library/editions/${browseEditionId}/download/${browseAssetId}`;
    await expect(
      item.getByRole('link', { name: 'Download Synthetic downloadable edition' }),
    ).toHaveAttribute('href', target);
    const bytes = await request.get(target);
    expect(bytes.status()).toBe(200);
    expect(bytes.headers()['content-type']).toContain('application/pdf');
    // A denied Edition is never listed, though its file exists.
    await expect(page.getByText('Synthetic Urdu translation')).toHaveCount(0);

    // A filter narrows and says so; the view is the address.
    await page.goto('/library/downloads?language=ar');
    await expect(item).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Remove filter: Arabic' })).toBeVisible();
    await page.goto('/library/downloads?sort=title&language=&topic=');
    await expect(page).toHaveURL(/\/library\/downloads$/);
  });

  test('sale points: business facts, the books each sells and a literal search', async ({
    page,
  }) => {
    const card = page.locator('main li', {
      has: page.getByRole('heading', { name: browseSalePoint }),
    });
    await page.goto(`/library/sale-points?q=${typed(`Proof Street ${run}`)}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Where to buy');
    await expect(card).toHaveCount(1);
    await expect(card.getByText(`Proof Street ${run}, Proofabad`)).toBeVisible();
    await expect(card.getByText('+00 0000 000000')).toBeVisible();
    await expect(card.getByRole('link', { name: /example\.org/ })).toHaveAttribute(
      'href',
      'https://example.org/proof',
    );
    await expect(card.getByText('Sells 1 book from the Library')).toBeVisible();
    await expect(card.getByRole('link', { name: browseTitle })).toHaveAttribute(
      'href',
      `/library/books/${browseSlug}`,
    );
    // A wildcard is a character: "%%%" is in no name or address.
    await page.goto('/library/sale-points?q=%25%25%25');
    await expect(page.getByText('No sale point matches')).toBeVisible();
    await page.goto('/library/sale-points?offset=0');
    await expect(page).toHaveURL(/\/library\/sale-points$/);
  });

  test('every browse page: no serious accessibility finding and no sideways scroll, in English, Urdu and Arabic', async ({
    page,
  }, testInfo) => {
    test.setTimeout(300_000);
    for (const locale of ['', '/ur', '/ar'])
      for (const target of [
        '/library/resources',
        '/library/authors',
        '/library/topics',
        '/library/languages',
        '/library/downloads',
        '/library/sale-points',
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

  test('the directory search is usable by keyboard alone, visibly', async ({ page }) => {
    /** Tab alone until `target` holds focus, then prove the indicator shows. */
    const tabTo = async (target: ReturnType<Page['locator']>, where: string) => {
      const handle = await target.elementHandle();
      if (handle === null) throw new Error(`${where} is not on the page.`);
      let reached = false;
      for (let step = 0; step < 200 && !reached; step += 1) {
        await page.keyboard.press('Tab');
        reached = await handle.evaluate((element) => document.activeElement === element);
      }
      expect(reached, `${where} reached by Tab alone`).toBe(true);
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
    };

    await page.goto('/library/authors');
    await tabTo(page.locator('#authors-q'), 'the name search');
    await page.keyboard.type(authorName);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/library\/authors\?q=Zz\+synthetic/);
    await tabTo(
      page.getByRole('link', { name: authorName, exact: true }),
      'the profile link',
    );
  });
});

test.describe('the byte routes answer only when both owners allow', () => {
  const bytes = (edition: string, purpose: string, asset: string) =>
    `/assets/library/editions/${edition}/${purpose}/${asset}`;

  test('serves an allowed download, unprefixed and uncached', async ({ request }) => {
    const response = await request.get(bytes(arabicId, 'download', downloadAssetId), {
      maxRedirects: 0,
    });

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('application/pdf');
    expect(response.headers()['content-disposition']).toBe('attachment');
    expect(response.headers()['cache-control']).toBe('private, no-store');
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(await response.body()).equals(PDF)).toBe(true);
  });

  test('refuses a restricted, unrelated, mismatched or preview request identically', async ({
    request,
  }) => {
    for (const address of [
      // The file exists and is clean; the edition's download decision is denied.
      bytes(urduId, 'download', deniedAssetId),
      // A clean asset that is not this edition's recorded asset.
      bytes(arabicId, 'download', deniedAssetId),
      // The download file requested as the readable one.
      bytes(arabicId, 'read', downloadAssetId),
      // An operation that does not exist on the public route.
      bytes(arabicId, 'preview', downloadAssetId),
      // Request input cannot turn a deny into an allow.
      `${bytes(urduId, 'download', deniedAssetId)}?public=true`,
      // An unknown asset.
      bytes(arabicId, 'download', randomUUID()),
    ]) {
      const response = await request.get(address, {
        maxRedirects: 0,
        headers: { 'x-library-override': 'allow' },
      });
      expect(response.status(), address).toBe(404);
      expect(await response.text(), address).toBe('Not found');
    }

    // Phase 7's own route stays default-deny for the same bytes.
    const phase7 = await request.get(`/assets/${downloadAssetId}`, { maxRedirects: 0 });
    expect(phase7.status()).toBe(404);
  });

  test('refuses the preview route to an anonymous caller', async ({ request }) => {
    const response = await request.get(
      `/assets/library/previews/${arabicId}/${downloadAssetId}`,
      { maxRedirects: 0 },
    );
    expect(response.status()).toBe(404);
  });
});

/* ========================================================================== */

test.describe('Library administration', () => {
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
        extraHTTPHeaders: { 'x-forwarded-for': `100.64.248.${String(index + 1)}` },
      });
      contexts.push(context);
      const page = await context.newPage();
      const { email } = await registerAndSignIn(page, `library-${String(index)}`);
      if (keys.length > 0) await grant(await accountIdFor(sql, email), keys);
      if (index === 0) admin = page;
      else stranger = page;
    }
  });

  test('refuses a signed-in account without the permission, as a 404', async () => {
    for (const surface of ['works', 'editions', 'translations', 'sale-points']) {
      const response = await stranger.goto(`/admin/library/${surface}`);
      expect(response?.status(), surface).toBe(404);
    }
  });

  let createdWorkId = '';
  let createdEditionId = '';
  const adminSlug = `browser-admin-work-${run}`;

  test('creates and edits a Work, and a stale save conflicts visibly', async () => {
    await admin.goto('/admin/library/works');
    await admin.locator('#work-slug').fill(adminSlug);
    await admin.locator('#work-title-en').fill('Synthetic admin proof work');
    await admin.locator('#work-state').selectOption('published');
    await admin.getByRole('button', { name: 'Create', exact: true }).click();
    await admin.waitForURL(/\/admin\/library\/works\/[0-9a-f-]{36}$/);
    createdWorkId = admin.url().split('/').pop() ?? '';

    // Two tabs open the SAME version.
    const second = await admin.context().newPage();
    await second.goto(`/admin/library/works/${createdWorkId}`);

    await admin.locator('input[name="featured"]').check();
    await admin.getByRole('button', { name: 'Save', exact: true }).click();
    await admin.waitForLoadState('networkidle');

    await second.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      second.getByRole('alert').filter({ hasText: 'This record changed.' }),
    ).toBeVisible();
    await second.close();
  });

  test('creates an Edition, records a genuine translation, and a sale point', async () => {
    await admin.goto('/admin/library/editions');
    await admin.locator('#edition-work').selectOption({ label: adminSlug });
    await admin.locator('#edition-label').fill('Synthetic admin edition');
    await admin.locator('#edition-language').selectOption('en');
    await admin.locator('#edition-state').selectOption('published');
    await admin.locator('#edition-reading').selectOption('allowed');
    await admin
      .locator('#edition-document')
      .fill(
        '## Opening\nSynthetic admin proof text.\n\n## Closing\nMore synthetic text.',
      );
    await admin.getByRole('button', { name: 'Create', exact: true }).click();
    await admin.waitForURL(/\/admin\/library\/editions\/[0-9a-f-]{36}$/);
    createdEditionId = admin.url().split('/').pop() ?? '';

    await admin.goto(`/admin/library/translations?edition=${createdEditionId}`);
    const translator = admin.locator('#translator-0');
    const firstPerson = await translator.locator('option').nth(1).getAttribute('value');
    expect(firstPerson).toBeTruthy();
    await translator.selectOption(firstPerson ?? '');
    await admin.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(admin.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();

    const [translation] = await sql.query<{ total: number }>(
      `SELECT COUNT_BIG(*) AS [total] FROM [BookTranslation] WHERE [editionId]=N'${createdEditionId}';`,
    );
    expect(Number(translation?.total)).toBe(1);

    await admin.goto('/admin/library/sale-points');
    await admin.locator('#sale-name-new').fill(`Synthetic admin sale point ${run}`);
    await admin.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(admin.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();

    // The Edition text is readable publicly, through the plain-text format.
    await admin.goto(`/library/books/${adminSlug}`);
    await expect(admin.getByText('Synthetic admin proof text.')).toBeVisible();
  });

  test('refuses to attach a file the scanner could not clear, and attaches nothing', async () => {
    await admin.goto(`/admin/library/editions/${createdEditionId}`);
    await admin.locator('#asset-file').setInputFiles({
      name: 'synthetic-proof.pdf',
      mimeType: 'application/pdf',
      buffer: PDF,
    });
    await admin.getByRole('button', { name: 'Upload and attach', exact: true }).click();
    await expect(
      admin.getByRole('alert').filter({ hasText: 'could not be cleared by the scanner' }),
    ).toBeVisible();

    const [edition] = await sql.query<{
      readableAssetId: string | null;
      downloadAssetId: string | null;
    }>(
      `SELECT [readableAssetId],[downloadAssetId] FROM [Edition] WHERE [id]=N'${createdEditionId}';`,
    );
    expect(edition?.readableAssetId).toBeNull();
    expect(edition?.downloadAssetId).toBeNull();
  });

  test('previews a recorded file of an unpublished edition only with live authority', async () => {
    const response = await admin.request.get(
      `/assets/library/previews/${urduId}/${deniedAssetId}`,
      { maxRedirects: 0 },
    );
    expect(response.status()).toBe(200);

    const unrelated = await admin.request.get(
      `/assets/library/previews/${urduId}/${downloadAssetId}`,
      { maxRedirects: 0 },
    );
    expect(unrelated.status()).toBe(404);

    const refused = await stranger.request.get(
      `/assets/library/previews/${urduId}/${deniedAssetId}`,
      { maxRedirects: 0 },
    );
    expect(refused.status()).toBe(404);
  });
});
