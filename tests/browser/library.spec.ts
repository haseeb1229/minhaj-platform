import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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

const run = randomUUID().replaceAll('-', '').slice(0, 12);
const currentSlug = `browser-library-${run}`;
const oldSlug = `browser-library-old-${run}`;
const draftSlug = `browser-library-draft-${run}`;

const workId = randomUUID();
const draftWorkId = randomUUID();
const arabicId = randomUUID();
const urduId = randomUUID();
const draftEditionId = randomUUID();
const downloadAssetId = randomUUID();
const deniedAssetId = randomUUID();
const salePointId = randomUUID();

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
  const role = randomUUID();
  await sql.query(
    `INSERT INTO [Role] ([id],[key],[name],[description],[system]) VALUES (N'${role}',N'proof-${role}',N'Library browser proof',N'Synthetic fixture',0); INSERT INTO [RoleAssignment] ([userId],[roleId]) VALUES (N'${id}',N'${role}');`,
  );
  for (const key of keys) {
    await sql.query(
      `INSERT INTO [RolePermission] ([roleId],[permissionKey]) VALUES (N'${role}',N'${key}');`,
    );
  }
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  sql = await privilegedSession();

  const people = newPhase5Fixture();
  await writePhase5Fixture(sql, people);

  const [topic] = await sql.query<{ id: string }>(
    "SELECT TOP 1 [id] FROM [Topic] WHERE [status]=N'active' ORDER BY [id];",
  );
  if (topic === undefined) throw new Error('No seeded Topic is available.');

  await seedCleanAsset(downloadAssetId);
  await seedCleanAsset(deniedAssetId);

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
    const response = await page.goto('/en/library/books');
    expect(response?.status()).toBe(200);
    expect(response?.headers()['set-cookie']).toBeUndefined();

    await expect(
      page.getByRole('link', { name: 'Synthetic browser proof work' }),
    ).toBeVisible();
    await expect(page.getByText('Synthetic hidden draft work')).toHaveCount(0);

    // The Urdu INTERFACE lists every content language — it is not an Urdu filter.
    // The Work has no Urdu LABEL, so it is titled in its own primary language
    // (Arabic), marked as Arabic, rather than in an invented Urdu title.
    await page.goto('/ur/library/books');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const arabicTitle = page.getByRole('link', { name: 'عمل تجريبي للمتصفح' });
    await expect(arabicTitle).toBeVisible();
    await expect(page.locator('h2', { has: arabicTitle })).toHaveAttribute('lang', 'ar');

    // A content-language filter is the visitor's choice and narrows in SQL.
    await page.goto('/en/library/books?language=ur');
    await expect(
      page.getByRole('link', { name: 'Synthetic browser proof work' }),
    ).toBeVisible();
  });

  test('shows the Work with truthful editions, translation and availability', async ({
    page,
  }) => {
    await page.goto(`/en/library/books/${currentSlug}`);

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

    await page.goto(`/en/library/books/${currentSlug}?edition=${draftEditionId}`);
    await expect(page.getByText('Synthetic draft edition')).toHaveCount(0);
  });

  test('reads the whole edition, by keyboard, with a stable position', async ({
    page,
  }) => {
    await page.goto(`/en/library/books/${currentSlug}?edition=${arabicId}`);

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
    const [stored] = await sql.query<{ total: number }>(
      `SELECT COUNT_BIG(*) AS [total] FROM sys.tables WHERE [name] LIKE N'%Reading%' OR [name] LIKE N'%Bookmark%';`,
    );
    expect(Number(stored?.total ?? -1)).toBe(0);
  });

  test('reflows at a 320px width without horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/en/library/books/${currentSlug}?edition=${arabicId}`);
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
    await page.goto(`/en/library/books/${currentSlug}?edition=${arabicId}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('#library-reader')).toHaveAttribute('dir', 'rtl');
  });

  test('says honestly when an edition cannot be read or downloaded', async ({ page }) => {
    const response = await page.goto(
      `/en/library/books/${currentSlug}?edition=${urduId}`,
    );
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

    const unknown = await request.get(`/en/library/books/${draftSlug}`, {
      maxRedirects: 0,
    });
    expect(unknown.status()).toBe(404);
  });
});

/* ========================================================================== */

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
      const response = await stranger.goto(`/en/admin/library/${surface}`);
      expect(response?.status(), surface).toBe(404);
    }
  });

  let createdWorkId = '';
  let createdEditionId = '';
  const adminSlug = `browser-admin-work-${run}`;

  test('creates and edits a Work, and a stale save conflicts visibly', async () => {
    await admin.goto('/en/admin/library/works');
    await admin.locator('#work-slug').fill(adminSlug);
    await admin.locator('#work-title-en').fill('Synthetic admin proof work');
    await admin.locator('#work-state').selectOption('published');
    await admin.getByRole('button', { name: 'Create', exact: true }).click();
    await admin.waitForURL(/\/en\/admin\/library\/works\/[0-9a-f-]{36}$/);
    createdWorkId = admin.url().split('/').pop() ?? '';

    // Two tabs open the SAME version.
    const second = await admin.context().newPage();
    await second.goto(`/en/admin/library/works/${createdWorkId}`);

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
    await admin.goto('/en/admin/library/editions');
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
    await admin.waitForURL(/\/en\/admin\/library\/editions\/[0-9a-f-]{36}$/);
    createdEditionId = admin.url().split('/').pop() ?? '';

    await admin.goto(`/en/admin/library/translations?edition=${createdEditionId}`);
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

    await admin.goto('/en/admin/library/sale-points');
    await admin.locator('#sale-name-new').fill(`Synthetic admin sale point ${run}`);
    await admin.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(admin.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();

    // The Edition text is readable publicly, through the plain-text format.
    await admin.goto(`/en/library/books/${adminSlug}`);
    await expect(admin.getByText('Synthetic admin proof text.')).toBeVisible();
  });

  test('refuses to attach a file the scanner could not clear, and attaches nothing', async () => {
    await admin.goto(`/en/admin/library/editions/${createdEditionId}`);
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
