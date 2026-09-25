import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { BrowserContext, Page, Request } from '@playwright/test';

import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import {
  sha256,
  syntheticStorageKey,
} from '../../packages/database/src/lifecycle/phase11-fixture.ts';
import {
  pngChunk,
  syntheticPng,
} from '../../packages/database/src/lifecycle/phase12-fixture.ts';
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
 * Phase 12 — photographs and galleries in a real browser, against the
 * production build.
 *
 * WHAT ONLY A BROWSER CAN PROVE: that the grids paint REAL images from this
 * origin only, with no broken image anywhere — a photograph whose bytes are
 * missing says so in words; that the viewer opens from the keyboard, is a real
 * modal dialog, pages by button and arrow key in the reading direction, and
 * gives focus back when it closes; that an image a browser already holds stops
 * being shown the moment its Photo is withdrawn; that every surface works
 * signed out, sets no cookie and is identical signed in; that a former Gallery
 * address answers one 301; that Urdu and Arabic render right-to-left; that
 * nothing scrolls sideways at 320px; and that the administration uploads
 * photographs through its own route, refuses what is not a whole bounded
 * image, refuses a publish with no image and a stale save, and refuses a
 * cross-origin or unauthorised upload.
 *
 * THE SCANNER IS DELIBERATELY UNREACHABLE in this suite, so a browser upload
 * always ends "not cleared" — the fail-closed outcome. A clean scan is proved
 * with the real scanner in the Database foundation job. The images the pages
 * SHOW are seeded as Storage leaves them after a clean scan: generated colour
 * gradients, never a photograph of anyone.
 */

test.describe.configure({ mode: 'serial' });

let sql: SqlSession;
const contexts: BrowserContext[] = [];

const run = randomUUID().replaceAll('-', '').slice(0, 10);

const LANDSCAPE = syntheticPng(480, 320, { hue: 20 });
const PORTRAIT = syntheticPng(240, 360, { hue: 90 });
const PANORAMA = syntheticPng(900, 200, { hue: 160 });
const WITHDRAWN = syntheticPng(300, 300, { hue: 200 });

const photo = {
  landscape: randomUUID(),
  portrait: randomUUID(),
  panorama: randomUUID(),
  missing: randomUUID(),
  draft: randomUUID(),
  archived: randomUUID(),
  withdrawn: randomUUID(),
};
const asset = {
  landscape: randomUUID(),
  portrait: randomUUID(),
  panorama: randomUUID(),
  missing: randomUUID(),
  draft: randomUUID(),
  archived: randomUUID(),
  withdrawn: randomUUID(),
};

const galleryId = randomUUID();
const hiddenGalleryId = randomUUID();
const galleryOld = `browser-gallery-old-${run}`;
const gallerySlug = `browser-gallery-${run}`;
const hiddenSlug = `browser-gallery-hidden-${run}`;

const LANDSCAPE_ALT = `A synthetic warm gradient, wider than it is tall ${run}`;
const LANDSCAPE_CAPTION = `Synthetic caption for the landscape gradient ${run}`;
const PORTRAIT_CAPTION_UR = `آزمائشی عمودی تصویر کا کیپشن ${run}`;
const PANORAMA_CAPTION = `Synthetic panorama known only to its year ${run}`;
const DRAFT_CAPTION = `Synthetic hidden draft photograph ${run}`;
const ARCHIVED_CAPTION = `Synthetic archived photograph ${run}`;
const GALLERY_TITLE = `Synthetic browser gallery ${run}`;
const HIDDEN_TITLE = `Synthetic gallery with nothing public ${run}`;

const imageRoute = (photoId: string, assetId: string) =>
  `/assets/media/photos/${photoId}/${assetId}`;

/** A clean Asset row, and — unless `missing` — its bytes in the run's storage root. */
async function seedAsset(id: string, bytes: Uint8Array, missing = false): Promise<void> {
  const key = syntheticStorageKey();
  if (!missing) {
    const file = path.join(browserEnvironment().storageRoot, ...key.split('/'));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  }
  await sql.query(
    `INSERT INTO [dbo].[Asset] ([id],[storageKey],[mediaType],[byteSize],[checksum],[state],[updatedAt]) VALUES (N'${id}',N'${key}',N'image/png',${String(bytes.byteLength)},N'${sha256(bytes)}',N'clean',SYSUTCDATETIME());`,
  );
}

async function grant(accountId: string, keys: readonly string[]): Promise<void> {
  await grantRole(sql, accountId, keys, 'Photo browser proof');
}

/** Every request the page makes to an origin that is not the application's. */
function thirdPartyRequests(page: Page): Request[] {
  const seen: Request[] = [];
  const own = new URL(baseUrl()).origin;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith('http') && url.origin !== own) seen.push(request);
  });
  return seen;
}

/** Every image in `main` has loaded real pixels — no broken image box anywhere. */
async function everyImageLoaded(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  const images = page.locator('main img');
  const total = await images.count();
  for (let index = 0; index < total; index += 1) {
    const image = images.nth(index);
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        image.evaluate(
          (element: HTMLImageElement) => element.complete && element.naturalWidth > 0,
        ),
      )
      .toBe(true);
  }
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  sql = await privilegedSession();

  await seedAsset(asset.landscape, LANDSCAPE);
  await seedAsset(asset.portrait, PORTRAIT);
  await seedAsset(asset.panorama, PANORAMA);
  // Recorded clean, bytes gone — as after a restore that lost the file.
  await seedAsset(asset.missing, LANDSCAPE, true);
  await seedAsset(asset.draft, LANDSCAPE);
  await seedAsset(asset.archived, LANDSCAPE);
  await seedAsset(asset.withdrawn, WITHDRAWN);

  await sql.query(`
    INSERT INTO [dbo].[Photo] ([id],[primaryLocale],[state],[credit],[takenYear],[takenMonth],[takenDay],[assetId],[width],[height],[createdAt],[updatedAt]) VALUES
      (N'${photo.landscape}', N'en', N'published', N'Synthetic Photo Unit', 1995, 3, 12, N'${asset.landscape}', 480, 320, DATEADD(SECOND, -60, SYSUTCDATETIME()), SYSUTCDATETIME()),
      (N'${photo.portrait}', N'ur', N'published', NULL, 1995, 3, NULL, N'${asset.portrait}', 240, 360, DATEADD(SECOND, -50, SYSUTCDATETIME()), SYSUTCDATETIME()),
      (N'${photo.panorama}', N'en', N'published', NULL, 1989, NULL, NULL, N'${asset.panorama}', 900, 200, DATEADD(SECOND, -40, SYSUTCDATETIME()), SYSUTCDATETIME()),
      (N'${photo.missing}', N'en', N'published', NULL, NULL, NULL, NULL, N'${asset.missing}', 480, 320, DATEADD(SECOND, -30, SYSUTCDATETIME()), SYSUTCDATETIME()),
      (N'${photo.draft}', N'en', N'draft', NULL, 1995, NULL, NULL, N'${asset.draft}', 480, 320, DATEADD(SECOND, -20, SYSUTCDATETIME()), SYSUTCDATETIME()),
      (N'${photo.archived}', N'en', N'archived', NULL, 1995, NULL, NULL, N'${asset.archived}', 480, 320, DATEADD(SECOND, -10, SYSUTCDATETIME()), SYSUTCDATETIME()),
      (N'${photo.withdrawn}', N'en', N'published', NULL, NULL, NULL, NULL, N'${asset.withdrawn}', 300, 300, DATEADD(SECOND, -5, SYSUTCDATETIME()), SYSUTCDATETIME());
    INSERT INTO [dbo].[PhotoLabel] ([photoId],[locale],[altText],[caption]) VALUES
      (N'${photo.landscape}', N'en', N'${LANDSCAPE_ALT}', N'${LANDSCAPE_CAPTION}'),
      (N'${photo.portrait}', N'ur', NULL, N'${PORTRAIT_CAPTION_UR}'),
      (N'${photo.panorama}', N'en', NULL, N'${PANORAMA_CAPTION}'),
      (N'${photo.draft}', N'en', NULL, N'${DRAFT_CAPTION}'),
      (N'${photo.archived}', N'en', NULL, N'${ARCHIVED_CAPTION}');

    INSERT INTO [dbo].[Gallery] ([id],[slug],[primaryLocale],[state],[version],[updatedAt]) VALUES
      (N'${galleryId}', N'${galleryOld}', N'en', N'published', 1, SYSUTCDATETIME()),
      (N'${hiddenGalleryId}', N'${hiddenSlug}', N'en', N'published', 1, SYSUTCDATETIME());
    UPDATE [dbo].[Gallery] SET [slug]=N'${gallerySlug}', [version]=2 WHERE [id]=N'${galleryId}';
    INSERT INTO [dbo].[GalleryLabel] ([galleryId],[locale],[title],[description]) VALUES
      (N'${galleryId}', N'en', N'${GALLERY_TITLE}', N'A synthetic gallery for the browser proof.'),
      (N'${galleryId}', N'ur', N'آزمائشی گیلری ${run}', N''),
      (N'${hiddenGalleryId}', N'en', N'${HIDDEN_TITLE}', N'');
    INSERT INTO [dbo].[GalleryItem] ([galleryId],[photoId],[position]) VALUES
      (N'${galleryId}', N'${photo.draft}', 0),
      (N'${galleryId}', N'${photo.portrait}', 1),
      (N'${galleryId}', N'${photo.missing}', 2),
      (N'${galleryId}', N'${photo.landscape}', 3),
      (N'${galleryId}', N'${photo.archived}', 4),
      (N'${hiddenGalleryId}', N'${photo.draft}', 0);
  `);
});

test.afterAll(async () => {
  for (const context of contexts) await context.close();
  await sql?.close();
});

/* ========================================================================== */

test.describe('an anonymous visitor looks at photographs', () => {
  test('browses real, first-party images, with no broken box and nothing unpublished', async ({
    page,
  }) => {
    const external = thirdPartyRequests(page);
    const response = await page.goto('/en/media/photos');
    expect(response?.status()).toBe(200);
    expect(response?.headers()['set-cookie']).toBeUndefined();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Photographs' }),
    ).toBeVisible();

    const main = page.getByRole('main');
    await expect(main.getByText(LANDSCAPE_CAPTION)).toBeVisible();
    await expect(main.getByText(DRAFT_CAPTION)).toHaveCount(0);
    await expect(main.getByText(ARCHIVED_CAPTION)).toHaveCount(0);

    // The photograph whose bytes are gone is a statement, never an image.
    await expect(
      main.getByText('This image is not available right now.').filter({ visible: true }),
    ).toBeVisible();
    const sources = await main
      .locator('img')
      .evaluateAll((images) => images.map((image) => image.getAttribute('src') ?? ''));
    expect(sources.length).toBeGreaterThanOrEqual(4);
    expect(sources.every((source) => source.startsWith('/assets/media/photos/'))).toBe(
      true,
    );
    expect(sources).not.toContain(imageRoute(photo.missing, asset.missing));
    expect(sources).not.toContain(imageRoute(photo.draft, asset.draft));
    await everyImageLoaded(page);

    // A genuine alternative is used; a missing one is said to be missing —
    // never invented, never passed off as decorative.
    await expect(main.getByRole('img', { name: LANDSCAPE_ALT })).toBeVisible();
    await expect(
      main.getByRole('img', { name: 'Photograph without a description' }).first(),
    ).toBeVisible();
    await expect(main.locator('img[alt=""]')).toHaveCount(0);

    // Known facts only: the full date, the credit — and nothing for the unknown.
    await expect(
      main.getByText('March 12, 1995 · Credit: Synthetic Photo Unit'),
    ).toBeVisible();

    // The three photograph surfaces, and no download.
    for (const href of ['/en/media/galleries', '/en/media/archive']) {
      await expect(main.locator(`a[href="${href}"]`).first()).toBeVisible();
    }
    await expect(page.getByRole('link', { name: /download/i })).toHaveCount(0);
    expect(external.map((request) => request.url())).toEqual([]);
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
  });

  test('opens the viewer from the keyboard, pages in order, and gives focus back', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/en/media/galleries/${gallerySlug}`);
    await everyImageLoaded(page);

    const tile = page
      .getByRole('link', { name: /Photograph without a description/ })
      .first();
    await tile.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name: 'Photograph viewer' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Photograph 1 of 2')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
    await expect(dialog.getByText(PORTRAIT_CAPTION_UR)).toHaveAttribute('lang', 'ur');

    await page.keyboard.press('ArrowRight');
    await expect(dialog.getByText('Photograph 2 of 2')).toBeVisible();
    await expect(dialog.getByRole('img', { name: LANDSCAPE_ALT })).toBeVisible();
    await expect(dialog.getByText(LANDSCAPE_CAPTION)).toBeVisible();

    // Wraps rather than stranding focus on a vanished button.
    await dialog.getByRole('button', { name: 'Next photograph' }).click();
    await expect(dialog.getByText('Photograph 1 of 2')).toBeVisible();
    await dialog.getByRole('button', { name: 'Previous photograph' }).click();
    await expect(dialog.getByText('Photograph 2 of 2')).toBeVisible();

    // The page behind is inert and locked while it is open.
    await expect(page.locator('html')).toHaveClass(/shell-scroll-locked/);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(tile).toBeFocused();
    await expect(page.locator('html')).not.toHaveClass(/shell-scroll-locked/);
  });

  test('lists a gallery with a genuine cover and its public count, and hides one with nothing public', async ({
    page,
  }) => {
    const response = await page.goto('/en/media/galleries');
    expect(response?.headers()['set-cookie']).toBeUndefined();
    const card = page.getByRole('listitem').filter({ hasText: GALLERY_TITLE });
    await expect(card).toBeVisible();
    // The first PUBLIC photograph in order is the cover: the draft before it
    // is skipped; the portrait has no alternative text, and says so.
    await expect(card.locator('img')).toHaveAttribute(
      'src',
      imageRoute(photo.portrait, asset.portrait),
    );
    await expect(card.getByText('3 photographs')).toBeVisible();
    await expect(page.getByText(HIDDEN_TITLE)).toHaveCount(0);
    await everyImageLoaded(page);
  });

  test('shows a gallery’s public photographs in its order, and an honest empty state', async ({
    page,
  }) => {
    await page.goto(`/en/media/galleries/${gallerySlug}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(GALLERY_TITLE);
    const list = page.getByRole('list', { name: 'Photographs' });
    const figures = list.locator('figure');
    await expect(figures).toHaveCount(3);
    await expect(figures.nth(0)).toContainText(PORTRAIT_CAPTION_UR);
    await expect(
      figures
        .nth(1)
        .getByText('This image is not available right now.')
        .filter({ visible: true }),
    ).toHaveCount(1);
    await expect(figures.nth(1).locator('img')).toHaveCount(0);
    await expect(figures.nth(2)).toContainText(LANDSCAPE_CAPTION);
    await expect(page.getByText(DRAFT_CAPTION)).toHaveCount(0);
    await expect(page.getByText(ARCHIVED_CAPTION)).toHaveCount(0);

    // Published, but nothing in it is public: it answers, and says so.
    await page.goto(`/en/media/galleries/${hiddenSlug}`);
    await expect(
      page.getByText('None of this gallery’s photographs is available yet.'),
    ).toBeVisible();
    await expect(page.locator('main img')).toHaveCount(0);
  });

  test('answers the former gallery address with exactly one 301, locale preserved', async ({
    request,
  }) => {
    for (const locale of ['en', 'ur']) {
      const response = await request.get(`/${locale}/media/galleries/${galleryOld}`, {
        maxRedirects: 0,
      });
      expect(response.status()).toBe(301);
      expect(new URL(response.headers()['location'] ?? '', baseUrl()).pathname).toBe(
        `/${locale}/media/galleries/${gallerySlug}`,
      );
    }
  });

  test('browses the archive by the date taken — never by when a record was made', async ({
    page,
  }) => {
    await page.goto('/en/media/archive');
    const years = page.getByRole('navigation', { name: 'Years' });
    await expect(years.getByRole('link', { name: /1995/ })).toBeVisible();
    await expect(years.getByRole('link', { name: /1989/ })).toBeVisible();
    // The undated photographs are not in the archive at all.
    await expect(
      page.locator(`img[src="${imageRoute(photo.withdrawn, asset.withdrawn)}"]`),
    ).toHaveCount(0);

    await years.getByRole('link', { name: /1995/ }).click();
    await expect(page).toHaveURL(/\/en\/media\/archive\?year=1995$/);
    await expect(
      page.getByRole('heading', { name: 'Photographs from 1995' }),
    ).toBeVisible();
    await expect(page.getByText(PANORAMA_CAPTION)).toHaveCount(0);
    const months = page.getByRole('navigation', { name: 'Months' });
    await months.getByRole('link', { name: /March/ }).click();
    await expect(
      page.getByRole('heading', { name: 'Photographs from March 1995' }),
    ).toBeVisible();
    await expect(page.getByText(LANDSCAPE_CAPTION)).toBeVisible();
    await expect(page.getByText(DRAFT_CAPTION)).toHaveCount(0);

    // A year known alone stays a year.
    await page.goto('/en/media/archive?year=1989');
    await expect(page.getByText(PANORAMA_CAPTION)).toBeVisible();
    await expect(page.getByText('1989', { exact: true }).first()).toBeVisible();
  });

  test('serves an image only for a published Photo’s own asset, and revalidates it', async ({
    request,
  }) => {
    const served = await request.get(imageRoute(photo.landscape, asset.landscape));
    expect(served.status()).toBe(200);
    expect(served.headers()['content-type']).toBe('image/png');
    expect(served.headers()['cache-control']).toBe('private, no-cache');
    expect(served.headers()['x-content-type-options']).toBe('nosniff');
    expect(served.headers()['set-cookie']).toBeUndefined();
    expect((await served.body()).equals(Buffer.from(LANDSCAPE))).toBe(true);
    const etag = served.headers()['etag'] ?? '';
    const again = await request.get(imageRoute(photo.landscape, asset.landscape), {
      headers: { 'if-none-match': etag },
    });
    expect(again.status()).toBe(304);

    for (const [photoId, assetId] of [
      [photo.draft, asset.draft],
      [photo.archived, asset.archived],
      [photo.missing, asset.missing],
      [photo.landscape, asset.portrait],
      [photo.landscape, randomUUID()],
    ] as const) {
      const refused = await request.get(imageRoute(photoId, assetId));
      expect(refused.status(), `${photoId}/${assetId}`).toBe(404);
    }
    for (const missing of [
      '/en/media/downloads',
      `/en/media/photos/${photo.landscape}`,
    ]) {
      expect((await request.get(missing, { maxRedirects: 0 })).status(), missing).toBe(
        404,
      );
    }
  });

  test('stops showing an image the moment its Photo is withdrawn, even from the cache', async ({
    page,
  }) => {
    const route = imageRoute(photo.withdrawn, asset.withdrawn);
    await page.goto('/en/media/photos');
    await everyImageLoaded(page);
    await expect(page.locator(`img[src="${route}"]`)).toHaveCount(1);

    await sql.query(
      `UPDATE [dbo].[Photo] SET [state]=N'archived' WHERE [id]=N'${photo.withdrawn}';`,
    );
    // The page no longer offers it...
    await page.reload();
    await expect(page.locator(`img[src="${route}"]`)).toHaveCount(0);
    // ...and the browser, which still holds the bytes, may not reuse them:
    // its revalidation is refused.
    const status = await page.evaluate(async (url) => {
      const response = await fetch(url, { cache: 'no-cache' });
      return response.status;
    }, route);
    expect(status).toBe(404);
  });

  test('renders Urdu and Arabic right-to-left, each text in its own language', async ({
    page,
  }) => {
    await page.goto(`/ur/media/galleries/${gallerySlug}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toHaveText(`آزمائشی گیلری ${run}`);
    await expect(heading).toHaveAttribute('lang', 'ur');
    await expect(page.getByText(PORTRAIT_CAPTION_UR)).toHaveAttribute('lang', 'ur');
    // An English caption on an Urdu page is marked English.
    await expect(page.getByText(LANDSCAPE_CAPTION)).toHaveAttribute('lang', 'en');

    await page.goto('/ar/media/photos');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'الصور' })).toBeVisible();
  });

  test('pages the viewer with the arrow keys in the reading direction', async ({
    page,
  }) => {
    await page.goto(`/ar/media/galleries/${gallerySlug}`);
    await everyImageLoaded(page);
    await page.locator('a[data-photo-index="0"]').focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'عارض الصور' });
    await expect(dialog.getByText('الصورة 1 من 2')).toBeVisible();
    // In Arabic, LEFT goes forward.
    await page.keyboard.press('ArrowLeft');
    await expect(dialog.getByText('الصورة 2 من 2')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('reflows at 320px — and so at 200% zoom — without horizontal scroll', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    for (const address of [
      '/en/media/photos',
      '/en/media/galleries',
      `/en/media/galleries/${gallerySlug}`,
      '/en/media/archive?year=1995',
      `/ur/media/galleries/${gallerySlug}`,
      '/ar/media/archive',
    ]) {
      await page.goto(address);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, address).toBeLessThanOrEqual(0);
    }
  });
});

/* ========================================================================== */

test.describe('photograph administration', () => {
  let admin: Page;
  let reader: Page;
  let stranger: Page;
  let createdGallery: string;

  const uploadHeaders = (version: number) => ({
    origin: new URL(baseUrl()).origin,
    'content-type': 'application/octet-stream',
    'x-minhaj-intent': 'media-photo-upload',
    'x-expected-version': String(version),
  });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    for (const [index, keys] of [
      [0, ['media.read', 'media.administer']],
      [1, ['media.read']],
      [2, [] as string[]],
    ] as const) {
      const context = await browser.newContext({
        baseURL: baseUrl(),
        extraHTTPHeaders: { 'x-forwarded-for': `100.64.250.${String(index + 1)}` },
      });
      contexts.push(context);
      const page = await context.newPage();
      const { email } = await registerAndSignIn(page, `photos-${String(index)}`);
      if (keys.length > 0) await grant(await accountIdFor(sql, email), keys);
      if (index === 0) admin = page;
      else if (index === 1) reader = page;
      else stranger = page;
    }
  });

  test('shows the same public page signed in as signed out', async ({ page }) => {
    await page.goto(`/en/media/galleries/${gallerySlug}`);
    const anonymous = await page.getByRole('main').innerText();
    const response = await admin.goto(`/en/media/galleries/${gallerySlug}`);
    expect(response?.headers()['set-cookie']).toBeUndefined();
    expect(await admin.getByRole('main').innerText()).toBe(anonymous);
  });

  test('refuses every photograph surface, and the upload, to an account without the permission', async () => {
    for (const surface of [
      'photos',
      'galleries',
      `photos/${photo.landscape}`,
      `galleries/${galleryId}`,
    ]) {
      const response = await stranger.goto(`/en/admin/media/${surface}`);
      expect(response?.status(), surface).toBe(404);
    }
    const upload = await stranger.request.post(
      `/api/admin/media/photos/${photo.draft}/asset`,
      {
        headers: uploadHeaders(1),
        data: Buffer.from(LANDSCAPE),
      },
    );
    expect(upload.status()).toBe(403);
    expect(await upload.json()).toEqual({ status: 'error', failure: 'denied' });
  });

  test('lets a reader see, but not preview a draft or change anything', async () => {
    await reader.goto('/en/admin/media/photos');
    await expect(reader.getByRole('heading', { level: 1, name: 'Photos' })).toBeVisible();
    await expect(reader.getByRole('heading', { name: 'Upload photographs' })).toHaveCount(
      0,
    );
    await expect(
      reader
        .getByText(
          'Only media administrators can preview an image that is not published.',
        )
        .first(),
    ).toBeVisible();
    const preview = await reader.request.get(
      `/assets/media/previews/photos/${photo.draft}/${asset.draft}`,
    );
    expect(preview.status()).toBe(404);
    await reader.goto(`/en/admin/media/photos/${photo.draft}`);
    await expect(reader.getByRole('button', { name: 'Save', exact: true })).toHaveCount(
      0,
    );
  });

  test('previews a draft for a live administrator, and lists the gaps to fill', async () => {
    await admin.goto('/en/admin/media/photos?gap=alt');
    await expect(admin.getByText('No alternative text').first()).toBeVisible();
    await admin.goto(`/en/admin/media/photos/${photo.draft}`);
    const image = admin.getByRole('main').locator('img').first();
    await expect(image).toHaveAttribute(
      'src',
      `/assets/media/previews/photos/${photo.draft}/${asset.draft}`,
    );
    await expect
      .poll(() =>
        image.evaluate(
          (element: HTMLImageElement) => element.complete && element.naturalWidth > 0,
        ),
      )
      .toBe(true);
    await expect(admin.getByText('480 × 320 pixels, as displayed.')).toBeVisible();
  });

  test('uploads photographs as drafts through their own route — and, unscanned, attaches nothing', async () => {
    test.setTimeout(120_000);
    const before = await sql.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM [dbo].[Photo] WHERE [assetId] IS NULL AND [state]=N'draft';",
    );
    // A photograph larger than the Server Action cap — made large by a private
    // chunk of noise, which Storage strips — a non-image, and a tiny file
    // declaring an enormous canvas.
    const large = Buffer.from(
      syntheticPng(64, 64, {
        hue: 3,
        before: [pngChunk('prVt', randomBytes(1_300_000))],
      }),
    );
    expect(large.byteLength).toBeGreaterThan(1024 * 1024);
    const header = new Uint8Array(13);
    new DataView(header.buffer).setUint32(0, 60_000);
    new DataView(header.buffer).setUint32(4, 60_000);
    header[8] = 8;
    header[9] = 2;
    const bomb = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from(pngChunk('IHDR', header)),
    ]);

    await admin.goto('/en/admin/media/photos');
    await admin.locator('input[type="file"]').setInputFiles([
      { name: 'synthetic-large.png', mimeType: 'image/png', buffer: large },
      {
        name: 'not-an-image.png',
        mimeType: 'image/png',
        buffer: Buffer.from('%PDF-1.7\n'),
      },
      { name: 'pixel-bomb.png', mimeType: 'image/png', buffer: bomb },
    ]);
    await admin.getByRole('button', { name: 'Upload the photographs' }).click();

    const report = admin.getByRole('status', { name: 'Upload progress' });
    await expect(
      report.getByText(
        'The image could not be cleared by the safety scan, so it was not attached.',
      ),
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      report.getByText(
        'This file is not a JPEG or PNG image, is damaged, or does not match its stated type.',
      ),
    ).toBeVisible();
    await expect(
      report.getByText('This image has more pixels than the limit allows.', {
        exact: false,
      }),
    ).toBeVisible();
    await expect(report.getByRole('link', { name: 'Open this draft' })).toHaveCount(3);

    const after = await sql.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM [dbo].[Photo] WHERE [assetId] IS NULL AND [state]=N'draft';",
    );
    expect(Number(after[0]?.n)).toBe(Number(before[0]?.n) + 3);
  });

  test('refuses to publish a Photo with no image, and a stale save', async () => {
    const [empty] = await sql.query<{ id: string }>(
      'SELECT TOP 1 [id] FROM [dbo].[Photo] WHERE [assetId] IS NULL ORDER BY [createdAt] DESC;',
    );
    await admin.goto(`/en/admin/media/photos/${String(empty?.id)}`);
    await admin.locator('#photo-state').selectOption('published');
    await admin.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      admin
        .getByRole('alert')
        .filter({ hasText: 'Upload an image before publishing this photograph.' }),
    ).toBeVisible();

    await admin.goto(`/en/admin/media/photos/${photo.draft}`);
    const second = await admin.context().newPage();
    await second.goto(admin.url());
    await admin
      .locator('#photo-alt-en')
      .fill('Synthetic alternative text written by an operator');
    await admin.locator('input[name="en-enabled"]').check();
    await admin.getByRole('button', { name: 'Save', exact: true }).click();
    await admin.waitForLoadState('networkidle');

    await second.locator('#photo-credit').fill('A stale credit');
    await second.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      second.getByRole('alert').filter({ hasText: 'This record changed.' }),
    ).toBeVisible();
    await second.close();

    const [row] = await sql.query<{ altText: string | null; credit: string | null }>(
      `SELECT l.[altText], p.[credit] FROM [dbo].[Photo] p LEFT JOIN [dbo].[PhotoLabel] l ON l.[photoId]=p.[id] AND l.[locale]=N'en' WHERE p.[id]=N'${photo.draft}';`,
    );
    expect(row).toEqual({
      altText: 'Synthetic alternative text written by an operator',
      credit: null,
    });
  });

  test('creates a gallery, adds photographs by looking at them, and reorders them', async () => {
    const slug = `browser-admin-gallery-${run}`;
    await admin.goto('/en/admin/media/galleries');
    await admin.locator('#new-gallery-slug').fill(slug);
    await admin.locator('#new-gallery-title-en').fill('Synthetic admin gallery');
    await admin.getByRole('button', { name: 'Create', exact: true }).click();
    await admin.waitForURL(/\/en\/admin\/media\/galleries\/[0-9a-f-]{36}$/);
    createdGallery = admin.url().split('/').pop() ?? '';
    await expect(admin.getByText('This gallery has no photographs yet.')).toBeVisible();

    await admin.goto(`/en/admin/media/galleries/${createdGallery}?state=published`);
    const choices = admin.getByRole('checkbox', { name: 'Add this photograph' });
    await expect(choices.first()).toBeVisible();
    await choices.nth(0).check();
    await choices.nth(1).check();
    await admin.getByRole('button', { name: 'Add the chosen photographs' }).click();
    await admin.waitForLoadState('networkidle');

    const members = admin
      .getByRole('list', { name: 'Photographs in this gallery' })
      .getByRole('listitem');
    await expect(members).toHaveCount(2);
    await expect(members.nth(0).getByText('Cover')).toBeVisible();
    const order = async () =>
      (
        await sql.query<{ photoId: string }>(
          `SELECT [photoId] FROM [dbo].[GalleryItem] WHERE [galleryId]=N'${createdGallery}' ORDER BY [position];`,
        )
      ).map((row) => row.photoId);
    const [first, second] = await order();
    await members.nth(1).getByRole('button', { name: 'Make it the cover' }).click();
    await expect.poll(order).toEqual([second, first]);

    const [audit] = await sql.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM [dbo].[AuditLog] WHERE [action]=N'media.gallery.membership.changed' AND [targetId]=N'${createdGallery}';`,
    );
    expect(Number(audit?.n)).toBe(2);
  });

  test('refuses a stale membership change visibly, and keeps the first', async () => {
    await admin.goto(`/en/admin/media/galleries/${createdGallery}`);
    const second = await admin.context().newPage();
    await second.goto(admin.url());

    await admin.getByRole('button', { name: 'Remove from the gallery' }).first().click();
    await admin.waitForLoadState('networkidle');
    await second.getByRole('button', { name: 'Move later' }).first().click();
    await expect(
      second.getByRole('alert').filter({ hasText: 'This record changed.' }),
    ).toBeVisible();
    await second.close();

    const [row] = await sql.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM [dbo].[GalleryItem] WHERE [galleryId]=N'${createdGallery}';`,
    );
    expect(Number(row?.n)).toBe(1);
  });

  test('refuses a cross-origin or intent-less upload, and has no state-changing GET', async () => {
    const target = `/api/admin/media/photos/${photo.draft}/asset`;
    for (const headers of [
      { ...uploadHeaders(1), origin: 'https://attacker.invalid' },
      { ...uploadHeaders(1), 'x-minhaj-intent': 'media-audio-upload' },
      { ...uploadHeaders(1), 'sec-fetch-site': 'cross-site' },
    ]) {
      const response = await admin.request.post(target, {
        headers,
        data: Buffer.from(LANDSCAPE),
      });
      expect(response.status(), JSON.stringify(headers)).toBe(403);
    }
    // Refused on its declared length, before a byte is stored.
    const assetsBefore = await sql.query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM [dbo].[Asset];',
    );
    const oversized = await admin.request.post(target, {
      headers: uploadHeaders(1),
      data: Buffer.alloc(16 * 1024 * 1024 + 1),
    });
    expect(oversized.status()).toBe(413);
    expect(await oversized.json()).toEqual({ status: 'error', failure: 'too-large' });
    const assetsAfter = await sql.query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM [dbo].[Asset];',
    );
    expect(Number(assetsAfter[0]?.n)).toBe(Number(assetsBefore[0]?.n));
    expect((await admin.request.get(target)).status()).toBe(405);
  });
});
