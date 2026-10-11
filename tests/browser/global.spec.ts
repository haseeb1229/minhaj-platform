import { randomUUID } from 'node:crypto';

import type { BrowserContext, Page } from '@playwright/test';

import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import {
  accountIdFor,
  baseUrl,
  expect,
  grantRole,
  privilegedSession,
  registerAndSignIn,
  test,
} from './support';

/**
 * Phase 16 — the Global Network directory in a real browser, against the
 * production build.
 *
 * WHAT ONLY A BROWSER CAN SHOW, beyond what the SQL and service proofs already
 * establish: the public directory renders its flexible hierarchy — a Country
 * with no Region, a Region with its City, a virtual Centre serving a City —
 * for an anonymous visitor with no cookie and the same knowledge signed in; a
 * withheld ancestor hides a Centre; Find a Centre is a labelled,
 * keyboard-reachable GET form that tells an invalid filter apart; contacts are
 * real links and the contact page sends nothing; a former slug, nested or not,
 * is ONE 301 with its locale kept; a Centre's News is chosen in the News editor
 * and attributed only while the Centre is public; the administration is
 * refused, read-only or writable by permission and refuses a stale save; and
 * Urdu and Arabic render right-to-left with no horizontal scroll at 320px.
 *
 * EVERYTHING IS SYNTHETIC. No real centre, place, address or telephone number
 * is named; every address is `.invalid`; every Country code is drawn from the
 * ISO 3166-1 USER-ASSIGNED ranges, which no real country holds.
 */

test.describe.configure({ mode: 'serial' });

let sql: SqlSession;
const contexts: BrowserContext[] = [];
let author: Page, reviewer: Page, publisher: Page;
let stranger: Page, reader: Page, administrator: Page;

const run = randomUUID().replaceAll('-', '').slice(0, 8);

const id = {
  plainCountry: randomUUID(),
  regionalCountry: randomUUID(),
  region: randomUUID(),
  archivedRegion: randomUUID(),
  plainCity: randomUUID(),
  regionalCity: randomUUID(),
  physical: randomUUID(),
  virtual: randomUUID(),
  long: randomUUID(),
  draft: randomUUID(),
  underArchived: randomUUID(),
};

/** Current slugs — the renaming test moves some of them on. */
const slug = {
  plainCountry: `browser-plain-${run}`,
  regionalCountry: `browser-regional-${run}`,
  region: `browser-region-${run}`,
  archivedRegion: `browser-archived-region-${run}`,
  plainCity: `browser-plain-city-${run}`,
  regionalCity: `browser-region-city-${run}`,
  physical: `browser-physical-${run}`,
  virtual: `browser-virtual-${run}`,
  long: `browser-long-${run}`,
  draft: `browser-draft-${run}`,
  underArchived: `browser-under-archived-${run}`,
};

const NAME = {
  plainCountry: `Synthetic Plain Country ${run}`,
  regionalCountry: `Synthetic Regional Country ${run}`,
  region: `Synthetic Region ${run}`,
  archivedRegion: `Synthetic Archived Region ${run}`,
  plainCity: `Synthetic Plain City ${run}`,
  regionalCity: `Synthetic Region City ${run}`,
  physical: `Synthetic Physical Centre ${run}`,
  virtual: `Synthetic Virtual Centre ${run}`,
  // One UNBROKEN 60-character word beside ordinary ones: a long compound name
  // must still reflow at 320px rather than force a horizontal scroll.
  long: `Synthetic Centre ${'Unbrokencompoundword'.repeat(3)} With An Exceptionally Long Demonstration Name ${run}`,
  draft: `Synthetic Draft Centre ${run}`,
  underArchived: `Synthetic Centre Under An Archived Region ${run}`,
};

const ADDRESS = `Unit 0, Synthetic Proof Street\nSynthetic Quarter ${run}`;
const LONG_ADDRESS = `Building 0000, Synthetic${'Unbrokenaddressword'.repeat(3)} Avenue With Many Ordinary Words\nSynthetic Administrative Quarter Of The Demonstration District, Synthetic Province ${run}`;
const DESCRIPTION = `A synthetic centre for the browser proof ${run}.`;
const PHONE = '+00 000 0000';
const EMAIL = `centre-${run}@example.invalid`;
const WEBSITE = `https://centre-${run}.example.invalid/`;

const NEWS_SLUG = `browser-centre-news-${run}`;
const NEWS_TITLE = `Synthetic centre news ${run}`;

/** Country codes no record in this database holds, from the user-assigned ranges. */
let codes: { plain: string; regional: string; created: string };

async function freeCountryCodes(count: number): Promise<string[]> {
  const taken = new Set(
    (await sql.query<{ code: string }>('SELECT [code] FROM [dbo].[Country];')).map(
      (row) => row.code,
    ),
  );
  const letters = (from: string, to: string) =>
    Array.from({ length: to.charCodeAt(0) - from.charCodeAt(0) + 1 }, (_, index) =>
      String.fromCharCode(from.charCodeAt(0) + index),
    );
  const pool = [
    ...letters('A', 'Z').map((letter) => `X${letter}`),
    ...letters('M', 'Z').map((letter) => `Q${letter}`),
    'AA',
    'ZZ',
  ].filter((code) => !taken.has(code));
  if (pool.length < count) throw new Error('No free user-assigned Country codes remain.');
  return pool.slice(0, count);
}

/** Presses a workflow button and waits for the version it produces. */
async function clickSaved(page: Page, name: string) {
  const next =
    Number(await page.locator('input[name="version"]').first().inputValue()) + 1;
  await page.getByRole('button', { name, exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: `Version ${String(next)}` }),
  ).toBeVisible();
}

/** Submit, approve by another person, publish by a third. */
async function throughWorkflow(path: string) {
  await author.goto(path);
  await clickSaved(author, 'Submit for review');
  await reviewer.goto(path);
  await clickSaved(reviewer, 'Approve revision');
  await publisher.goto(path);
  await clickSaved(publisher, 'Publish');
}

/**
 * How far the page scrolls sideways at the current viewport, and — when it
 * does — the innermost elements reaching past the edge, so a failure names
 * its cause rather than only a number.
 */
async function overflowOf(
  page: Page,
): Promise<{ overflow: number; offenders: string[] }> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const overflow = root.scrollWidth - root.clientWidth;
    if (overflow <= 0) return { overflow, offenders: [] };
    const beyond = [...document.body.querySelectorAll('*')].filter((element) => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && (box.right > root.clientWidth + 1 || box.left < -1);
    });
    const innermost = beyond.filter(
      (element) => !beyond.some((other) => other !== element && element.contains(other)),
    );
    return {
      overflow,
      offenders: innermost.slice(0, 5).map((element) => {
        const box = element.getBoundingClientRect();
        return `<${element.tagName.toLowerCase()} class="${element.getAttribute('class') ?? ''}"> ${String(Math.round(box.width))}px: ${(element.textContent ?? '').trim().slice(0, 60)}`;
      }),
    };
  });
}

const centrePath = (locale: string, centre: string) =>
  `/${locale}/global/centres/${centre}`;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  sql = await privilegedSession();

  const [plain, regional, created] = await freeCountryCodes(3);
  codes = { plain: plain!, regional: regional!, created: created! };

  await sql.query(`
    INSERT INTO [dbo].[Country] ([id],[code],[slug],[primaryLocale],[state]) VALUES
      (N'${id.plainCountry}', N'${codes.plain}', N'${slug.plainCountry}', N'en', N'published'),
      (N'${id.regionalCountry}', N'${codes.regional}', N'${slug.regionalCountry}', N'en', N'published');
    INSERT INTO [dbo].[CountryLabel] ([countryId],[locale],[name]) VALUES
      (N'${id.plainCountry}', N'en', N'${NAME.plainCountry}'),
      (N'${id.regionalCountry}', N'en', N'${NAME.regionalCountry}');

    INSERT INTO [dbo].[Region] ([id],[countryId],[slug],[primaryLocale],[state]) VALUES
      (N'${id.region}', N'${id.regionalCountry}', N'${slug.region}', N'en', N'published'),
      (N'${id.archivedRegion}', N'${id.regionalCountry}', N'${slug.archivedRegion}', N'en', N'archived');
    INSERT INTO [dbo].[RegionLabel] ([regionId],[locale],[name]) VALUES
      (N'${id.region}', N'en', N'${NAME.region}'),
      (N'${id.archivedRegion}', N'en', N'${NAME.archivedRegion}');

    INSERT INTO [dbo].[City] ([id],[countryId],[regionId],[slug],[primaryLocale],[state]) VALUES
      (N'${id.plainCity}', N'${id.plainCountry}', NULL, N'${slug.plainCity}', N'en', N'published'),
      (N'${id.regionalCity}', N'${id.regionalCountry}', N'${id.region}', N'${slug.regionalCity}', N'en', N'published');
    INSERT INTO [dbo].[CityLabel] ([cityId],[locale],[name]) VALUES
      (N'${id.plainCity}', N'en', N'${NAME.plainCity}'),
      (N'${id.regionalCity}', N'en', N'${NAME.regionalCity}');

    INSERT INTO [dbo].[Centre] ([id],[slug],[countryId],[regionId],[cityId],[isVirtual],[latitude],[longitude],[primaryLocale],[state]) VALUES
      (N'${id.physical}', N'${slug.physical}', N'${id.plainCountry}', NULL, N'${id.plainCity}', 0, 12.345678, -45.678901, N'en', N'published'),
      (N'${id.long}', N'${slug.long}', N'${id.plainCountry}', NULL, N'${id.plainCity}', 0, NULL, NULL, N'en', N'published'),
      (N'${id.virtual}', N'${slug.virtual}', N'${id.regionalCountry}', NULL, NULL, 1, NULL, NULL, N'en', N'published'),
      (N'${id.draft}', N'${slug.draft}', N'${id.regionalCountry}', NULL, NULL, 0, NULL, NULL, N'en', N'draft'),
      (N'${id.underArchived}', N'${slug.underArchived}', N'${id.regionalCountry}', N'${id.archivedRegion}', NULL, 0, NULL, NULL, N'en', N'published');
    INSERT INTO [dbo].[CentreLabel] ([centreId],[locale],[name],[description],[address]) VALUES
      (N'${id.physical}', N'en', N'${NAME.physical}', N'${DESCRIPTION}', N'${ADDRESS}'),
      (N'${id.long}', N'en', N'${NAME.long}', NULL, N'${LONG_ADDRESS}'),
      (N'${id.virtual}', N'en', N'${NAME.virtual}', NULL, NULL),
      (N'${id.draft}', N'en', N'${NAME.draft}', NULL, NULL),
      (N'${id.underArchived}', N'en', N'${NAME.underArchived}', NULL, NULL);
    INSERT INTO [dbo].[CentreContact] ([centreId],[position],[channel],[value]) VALUES
      (N'${id.physical}', 0, N'phone', N'${PHONE}'),
      (N'${id.physical}', 1, N'email', N'${EMAIL}'),
      (N'${id.physical}', 2, N'website', N'${WEBSITE}'),
      (N'${id.long}', 0, N'website', N'https://synthetic-very-long-proof-host-name-${run}.example.invalid/a/very/long/path/that/must/wrap');
    INSERT INTO [dbo].[CentreServiceCity] ([centreId],[cityId],[countryId]) VALUES
      (N'${id.virtual}', N'${id.regionalCity}', N'${id.regionalCountry}');
  `);

  const roles: readonly (readonly string[])[] = [
    ['content.read', 'content.author'],
    ['content.read', 'content.review'],
    ['content.read', 'content.publish'],
    [],
    ['global.read'],
    ['global.read', 'global.administer'],
  ];
  const pages: Page[] = [];
  for (const [index, keys] of roles.entries()) {
    const context = await browser.newContext({
      baseURL: baseUrl(),
      extraHTTPHeaders: { 'x-forwarded-for': `100.64.246.${String(index + 1)}` },
    });
    contexts.push(context);
    const page = await context.newPage();
    pages.push(page);
    const { email } = await registerAndSignIn(page, `global-${String(index)}`);
    if (keys.length > 0)
      await grantRole(sql, await accountIdFor(sql, email), keys, 'Global browser proof');
  }
  [author, reviewer, publisher, stranger, reader, administrator] = pages as [
    Page,
    Page,
    Page,
    Page,
    Page,
    Page,
  ];
});

test.afterAll(async () => {
  for (const context of contexts) await context.close();
  await sql?.close();
});

/* ========================================================================== */

test.describe('an anonymous visitor explores the Global Network', () => {
  test('lands on the World Network with its genuine entry points and no cookie', async ({
    page,
  }) => {
    const response = await page.goto('/en/global');
    expect(response?.status()).toBe(200);
    expect(response?.headers()['set-cookie']).toBeUndefined();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Global Network' }),
    ).toBeVisible();

    const entries = page.getByRole('list', { name: 'Ways into the directory' });
    for (const [name, href] of [
      ['Find a Centre', '/en/global/find-a-centre'],
      ['Countries', '/en/global/countries'],
      ['Centres', '/en/global/centres'],
      ['Pakistan structure', '/en/global/pakistan'],
    ] as const)
      await expect(entries.getByRole('link', { name, exact: true })).toHaveAttribute(
        'href',
        href,
      );

    // Local Events are reached on each Centre's own page, not from the landing.
    await expect(page.locator('a[href*="/events"]')).toHaveCount(0);
    // The seeded Countries are listed; the directory is not called empty.
    const main = page.getByRole('main');
    await expect(main.getByRole('link', { name: NAME.plainCountry })).toBeVisible();
    await expect(
      main.getByText('No centres have been published in the directory yet.', {
        exact: false,
      }),
    ).toHaveCount(0);

    // A plain fetch sets no cookie either, on the landing or on a Centre.
    for (const path of ['/en/global', centrePath('en', slug.physical)]) {
      const plain = await page.request.get(path);
      expect(plain.status(), path).toBe(200);
      expect(plain.headers()['set-cookie'], path).toBeUndefined();
    }
    await page.goto(centrePath('en', slug.physical));
    // Phase 14: the Centre links its own Local Events, and nothing else of Events.
    await expect(
      page.locator(`a[href="${centrePath('en', slug.physical)}/events"]`),
    ).toBeVisible();
    expect(await page.context().cookies()).toHaveLength(0);
  });

  test('shows the same Centre knowledge signed in as signed out', async ({ page }) => {
    await page.goto(centrePath('en', slug.physical));
    const anonymous = await page.getByRole('main').innerText();
    expect(anonymous).toContain(NAME.physical);

    const response = await reader.goto(centrePath('en', slug.physical));
    expect(response?.headers()['set-cookie']).toBeUndefined();
    expect(await reader.getByRole('main').innerText()).toBe(anonymous);
  });

  test('walks a Country with no Region, a Region and a City served from elsewhere', async ({
    page,
  }) => {
    // A Country with no Region: its Cities directly, its Centres — no Regions.
    await page.goto(`/en/global/countries/${slug.plainCountry}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(NAME.plainCountry);
    await expect(page.getByRole('heading', { name: 'Regions', exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole('heading', { name: 'Cities not in a region', exact: true }),
    ).toHaveCount(0);
    const cities = page.getByRole('list', { name: 'Cities', exact: true });
    await expect(cities.getByRole('link', { name: NAME.plainCity })).toHaveAttribute(
      'href',
      `/en/global/countries/${slug.plainCountry}/cities/${slug.plainCity}`,
    );
    const centres = page.getByRole('list', { name: 'Centres', exact: true });
    await expect(centres.getByRole('link', { name: NAME.physical })).toBeVisible();
    await expect(centres.getByRole('link', { name: NAME.long })).toBeVisible();

    // A Country with a Region lists it — and never the archived one.
    await page.goto(`/en/global/countries/${slug.regionalCountry}`);
    const regions = page.getByRole('list', { name: 'Regions', exact: true });
    await expect(regions.getByRole('link', { name: NAME.region })).toBeVisible();
    await expect(page.getByText(NAME.archivedRegion)).toHaveCount(0);
    await expect(page.getByText(NAME.draft)).toHaveCount(0);
    await expect(page.getByText(NAME.underArchived)).toHaveCount(0);

    // The Region lists its City.
    await page.goto(
      `/en/global/countries/${slug.regionalCountry}/regions/${slug.region}`,
    );
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(NAME.region);
    await expect(
      page
        .getByRole('list', { name: 'Cities', exact: true })
        .getByRole('link', { name: NAME.regionalCity }),
    ).toHaveAttribute(
      'href',
      `/en/global/countries/${slug.regionalCountry}/cities/${slug.regionalCity}`,
    );

    // The City lists the virtual Centre that serves it — exactly once.
    await page.goto(
      `/en/global/countries/${slug.regionalCountry}/cities/${slug.regionalCity}`,
    );
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(NAME.regionalCity);
    const served = page.getByRole('list', { name: 'Centres', exact: true });
    await expect(served.getByRole('listitem')).toHaveCount(1);
    await expect(served.getByRole('link', { name: NAME.virtual })).toHaveCount(1);
    await expect(served.getByText(/^Virtual centre ·/)).toBeVisible();

    // The withheld Region and the Centres beneath or beside it are not public.
    for (const path of [
      `/en/global/countries/${slug.regionalCountry}/regions/${slug.archivedRegion}`,
      centrePath('en', slug.draft),
      centrePath('en', slug.underArchived),
      `${centrePath('en', slug.underArchived)}/contact`,
      `${centrePath('en', slug.draft)}/news`,
    ]) {
      const hidden = await page.request.get(path, { maxRedirects: 0 });
      expect(hidden.status(), path).toBe(404);
    }
  });

  test('finds a Centre by City, once, and tells an invalid filter apart', async ({
    page,
  }) => {
    const response = await page.goto(
      `/en/global/find-a-centre?country=${slug.regionalCountry}&city=${slug.regionalCity}`,
    );
    expect(response?.status()).toBe(200);
    const results = page.getByRole('list', { name: 'Centres', exact: true });
    await expect(results.getByRole('listitem')).toHaveCount(1);
    await expect(results.getByRole('link', { name: NAME.virtual })).toHaveCount(1);
    await expect(page.getByText(NAME.physical)).toHaveCount(0);
    // The form reflects the filter it ran.
    await expect(page.getByLabel('Country', { exact: true })).toHaveValue(
      slug.regionalCountry,
    );
    await expect(page.getByLabel('City', { exact: true })).toHaveValue(slug.regionalCity);

    // A Country alone covers every public Centre in it.
    await page.goto(`/en/global/find-a-centre?country=${slug.plainCountry}`);
    const plain = page.getByRole('list', { name: 'Centres', exact: true });
    await expect(plain.getByRole('link', { name: NAME.physical })).toBeVisible();
    await expect(plain.getByRole('link', { name: NAME.long })).toBeVisible();
    await expect(plain.getByText(NAME.virtual)).toHaveCount(0);

    // An unknown City, a withheld Region and a Region AND a City together are
    // each refused in words — never an empty list that looks like "no match".
    for (const query of [
      `country=${slug.regionalCountry}&city=browser-no-such-city-${run}`,
      `country=${slug.regionalCountry}&region=${slug.archivedRegion}`,
      `country=${slug.regionalCountry}&region=${slug.region}&city=${slug.regionalCity}`,
      `city=${slug.regionalCity}`,
    ]) {
      const invalid = await page.goto(`/en/global/find-a-centre?${query}`);
      expect(invalid?.status(), query).toBe(200);
      await expect(
        page
          .getByRole('main')
          .getByText('This filter does not match a place in the public directory.', {
            exact: false,
          }),
        query,
      ).toBeVisible();
      await expect(page.getByRole('list', { name: 'Centres', exact: true })).toHaveCount(
        0,
      );
    }
  });

  test('shows a physical Centre’s genuine facts and contacts as real links', async ({
    page,
  }) => {
    await page.goto(centrePath('en', slug.physical));
    const main = page.getByRole('main');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(NAME.physical);
    await expect(main.getByText(DESCRIPTION)).toBeVisible();
    await expect(main.locator('address').first()).toHaveText(ADDRESS);
    await expect(
      main.getByText('Latitude 12.345678, Longitude -45.678901'),
    ).toBeVisible();
    await expect(main.getByText('Virtual centre', { exact: true })).toHaveCount(0);

    // Where it is, as links into the directory.
    await expect(main.getByRole('link', { name: NAME.plainCity })).toHaveAttribute(
      'href',
      `/en/global/countries/${slug.plainCountry}/cities/${slug.plainCity}`,
    );
    await expect(main.getByRole('link', { name: NAME.plainCountry })).toHaveAttribute(
      'href',
      `/en/global/countries/${slug.plainCountry}`,
    );

    // Contacts: a dialable telephone link, a mail link and a described
    // external website — no map, no embed.
    await expect(main.getByRole('link', { name: PHONE })).toHaveAttribute(
      'href',
      'tel:+000000000',
    );
    await expect(main.getByRole('link', { name: EMAIL })).toHaveAttribute(
      'href',
      `mailto:${EMAIL}`,
    );
    const website = main.getByRole('link', { name: new RegExp(WEBSITE) });
    await expect(website).toHaveAttribute('href', WEBSITE);
    const rel = (await website.getAttribute('rel')) ?? '';
    expect(rel.split(/\s+/)).toEqual(
      expect.arrayContaining(['external', 'noopener', 'noreferrer']),
    );
    await expect(website).toContainText('(external site)');
    await expect(page.locator('iframe, embed, object')).toHaveCount(0);
    await expect(main.getByText('This centre has no published news yet.')).toBeVisible();

    // The contact page lists, and sends nothing.
    await main.getByRole('link', { name: 'All contact details' }).click();
    await expect(page).toHaveURL(
      new RegExp(`${centrePath('en', slug.physical)}/contact$`),
    );
    const contact = page.getByRole('main');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      `Contact details: ${NAME.physical}`,
    );
    await expect(
      contact.getByText('This page does not send messages.', { exact: false }),
    ).toBeVisible();
    await expect(contact.getByRole('link', { name: EMAIL })).toHaveAttribute(
      'href',
      `mailto:${EMAIL}`,
    );
    await expect(contact.locator('form')).toHaveCount(0);
    await expect(contact.locator('input, textarea, button[type="submit"]')).toHaveCount(
      0,
    );
  });

  test('says a virtual Centre is virtual, with no address, and lists what it serves', async ({
    page,
  }) => {
    await page.goto(centrePath('en', slug.virtual));
    const main = page.getByRole('main');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(NAME.virtual);
    await expect(main.getByText('Virtual centre', { exact: true })).toBeVisible();
    await expect(
      main.getByText('This centre has no physical premises.', { exact: false }),
    ).toBeVisible();
    await expect(main.locator('address')).toHaveCount(0);
    await expect(main.getByText('Address', { exact: true })).toHaveCount(0);
    await expect(main.getByText('Coordinates', { exact: true })).toHaveCount(0);
    await expect(
      main.getByRole('heading', { name: 'Also serves', exact: true }),
    ).toBeVisible();
    await expect(main.getByRole('link', { name: NAME.regionalCity })).toBeVisible();
    await expect(
      main.getByText('No public contact details have been published for this centre.'),
    ).toBeVisible();
  });
});

/* ========================================================================== */

test.describe('former addresses', () => {
  test('answers a renamed Country and City with ONE 301 to the current full path', async ({
    request,
  }) => {
    const old = { country: slug.plainCountry, city: slug.plainCity };
    slug.plainCountry = `browser-plain-renamed-${run}`;
    slug.plainCity = `browser-plain-city-renamed-${run}`;
    await sql.query(`
      UPDATE [dbo].[Country] SET [slug]=N'${slug.plainCountry}', [version]=[version]+1, [updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${id.plainCountry}';
      UPDATE [dbo].[City] SET [slug]=N'${slug.plainCity}', [version]=[version]+1, [updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${id.plainCity}';
    `);

    const current = (locale: string) =>
      `/${locale}/global/countries/${slug.plainCountry}/cities/${slug.plainCity}`;
    for (const [locale, from] of [
      ['en', `/en/global/countries/${old.country}/cities/${old.city}`],
      ['ur', `/ur/global/countries/${old.country}/cities/${old.city}`],
      // Only one segment former: still one hop to the whole current address.
      ['en', `/en/global/countries/${old.country}/cities/${slug.plainCity}`],
      ['ar', `/ar/global/countries/${slug.plainCountry}/cities/${old.city}`],
    ] as const) {
      const response = await request.get(from, { maxRedirects: 0 });
      expect(response.status(), from).toBe(301);
      const target = new URL(response.headers()['location'] ?? '', baseUrl()).pathname;
      expect(target, from).toBe(current(locale));
      // The target is final: no second hop.
      expect((await request.get(target, { maxRedirects: 0 })).status(), target).toBe(200);
    }

    const country = await request.get(`/ur/global/countries/${old.country}`, {
      maxRedirects: 0,
    });
    expect(country.status()).toBe(301);
    expect(new URL(country.headers()['location'] ?? '', baseUrl()).pathname).toBe(
      `/ur/global/countries/${slug.plainCountry}`,
    );
  });

  test('answers a renamed Centre’s contact page with ONE 301 that keeps its suffix', async ({
    request,
  }) => {
    const old = slug.physical;
    slug.physical = `browser-physical-renamed-${run}`;
    await sql.query(
      `UPDATE [dbo].[Centre] SET [slug]=N'${slug.physical}', [version]=[version]+1, [updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${id.physical}';`,
    );

    for (const [from, to] of [
      [`${centrePath('ar', old)}/contact`, `${centrePath('ar', slug.physical)}/contact`],
      [`${centrePath('ur', old)}/news`, `${centrePath('ur', slug.physical)}/news`],
      [centrePath('en', old), centrePath('en', slug.physical)],
    ] as const) {
      const response = await request.get(from, { maxRedirects: 0 });
      expect(response.status(), from).toBe(301);
      const target = new URL(response.headers()['location'] ?? '', baseUrl()).pathname;
      expect(target, from).toBe(to);
      expect((await request.get(target, { maxRedirects: 0 })).status(), target).toBe(200);
    }

    // A withheld Centre's address never resolves to anything.
    expect(
      (await request.get(centrePath('en', slug.draft), { maxRedirects: 0 })).status(),
    ).toBe(404);
  });
});

/* ========================================================================== */

test.describe('centre-scoped News', () => {
  test('offers a Centre for News only, and attributes it only while the Centre is public', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    // A press release has no Centre to choose.
    await author.goto('/en/admin/editorial/press-releases/new');
    await expect(author.getByLabel('Canonical slug', { exact: true })).toBeVisible();
    await expect(author.locator('select[name="centreId"]')).toHaveCount(0);

    // A NewsArticle does, by name — and never a withheld draft as if public.
    await author.goto('/en/admin/editorial/news/new');
    const choice = author.getByRole('combobox', {
      name: 'Centre (optional)',
      exact: true,
    });
    await expect(choice).toBeVisible();
    await expect(choice.locator('option', { hasText: NAME.physical })).toHaveCount(1);
    await expect(
      choice.locator('option', { hasText: `${NAME.draft} (Draft)` }),
    ).toHaveCount(1);
    await author.getByLabel('Canonical slug', { exact: true }).fill(NEWS_SLUG);
    await author.locator('#en-title').fill(NEWS_TITLE);
    await author
      .getByRole('textbox', { name: 'Body (en)', exact: true })
      .fill('Synthetic non-authoritative centre news body.');
    await choice.selectOption({ label: NAME.physical });
    await author.getByRole('button', { name: 'Save revision', exact: true }).click();
    await author.waitForURL(/\/admin\/editorial\/news\/[0-9a-f-]{36}$/);
    const editor = new URL(author.url()).pathname;
    await expect(
      author.getByRole('combobox', { name: 'Centre (optional)', exact: true }),
    ).toHaveValue(id.physical);
    await throughWorkflow(editor);

    // The Centre page lists its News, and so does its News page.
    await page.goto(centrePath('en', slug.physical));
    const news = page.getByRole('list', { name: 'News from this centre', exact: true });
    await expect(news.getByRole('link', { name: NEWS_TITLE })).toBeVisible();
    await page.goto(`${centrePath('en', slug.physical)}/news`);
    await expect(
      page.getByRole('main').getByRole('link', { name: NEWS_TITLE }),
    ).toBeVisible();

    // The News names its Centre, as a link to it.
    await page.goto(`/en/news/${NEWS_SLUG}`);
    const attribution = page
      .getByRole('main')
      .locator(`a[href="${centrePath('en', slug.physical)}"]`);
    await expect(attribution).toHaveText(NAME.physical);

    // The Centre is withdrawn: the News stays, and stops naming it.
    await sql.query(
      `UPDATE [dbo].[Centre] SET [state]=N'archived', [version]=[version]+1, [updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${id.physical}';`,
    );
    const after = await page.goto(`/en/news/${NEWS_SLUG}`);
    expect(after?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(NEWS_TITLE);
    await expect(page.locator('a[href^="/en/global/centres/"]')).toHaveCount(0);
    await expect(page.getByText(NAME.physical)).toHaveCount(0);
    for (const path of [
      centrePath('en', slug.physical),
      `${centrePath('en', slug.physical)}/news`,
    ])
      expect((await page.request.get(path)).status(), path).toBe(404);
  });
});

/* ========================================================================== */

test.describe('Global Network administration', () => {
  test('refuses every directory surface to an account without a Global key', async () => {
    for (const surface of [
      'countries',
      'regions',
      'cities',
      'centres',
      'countries/new',
      `countries/${id.regionalCountry}`,
      `centres/${id.virtual}`,
    ]) {
      const response = await stranger.goto(`/en/admin/global/${surface}`);
      expect(response?.status(), surface).toBe(404);
    }
  });

  test('lets a reader see the directory, but create and save nothing', async () => {
    await reader.goto('/en/admin/global/countries');
    await expect(
      reader.getByRole('heading', { level: 1, name: 'Countries' }),
    ).toBeVisible();
    await expect(reader.getByText(slug.regionalCountry).first()).toBeVisible();
    await expect(reader.getByRole('link', { name: 'New Country' })).toHaveCount(0);

    await reader.goto(`/en/admin/global/countries/${id.regionalCountry}`);
    await expect(reader.getByText(codes.regional, { exact: true }).first()).toBeVisible();
    await expect(reader.getByRole('button', { name: 'Save', exact: true })).toHaveCount(
      0,
    );
    await expect(reader.locator('main form')).toHaveCount(0);

    await reader.goto(`/en/admin/global/centres/${id.virtual}`);
    await expect(reader.getByRole('button', { name: 'Save', exact: true })).toHaveCount(
      0,
    );

    // Creating is not offered at all: the page is the not-found page. (Its HTTP
    // status is not asserted — the refusal is thrown after this subtree's
    // loading boundary has streamed, so it arrives as a 200 soft 404.)
    await reader.goto('/en/admin/global/countries/new');
    await expect(reader.getByLabel('ISO code', { exact: true })).toHaveCount(0);
    await expect(reader.getByRole('button', { name: 'Create', exact: true })).toHaveCount(
      0,
    );
    await expect(reader.getByRole('heading', { name: 'New Country' })).toHaveCount(0);
    await expect(reader.locator('meta[name="robots"]').first()).toHaveAttribute(
      'content',
      /noindex/,
    );
  });

  test('lets an administrator create a Country, and refuses a stale save visibly', async () => {
    const created = {
      slug: `browser-admin-country-${run}`,
      name: `Synthetic Administered Country ${run}`,
    };
    await administrator.goto('/en/admin/global/countries');
    await administrator.getByRole('link', { name: 'New Country' }).click();
    await administrator.waitForURL(/\/en\/admin\/global\/countries\/new$/);
    await administrator.getByLabel('ISO code', { exact: true }).fill(codes.created);
    await administrator.getByLabel('Slug', { exact: true }).fill(created.slug);
    await administrator.getByLabel('Name in English', { exact: true }).fill(created.name);
    await administrator.getByRole('button', { name: 'Create', exact: true }).click();
    await administrator.waitForURL(/\/en\/admin\/global\/countries\/[0-9a-f-]{36}$/);
    await expect(
      administrator.getByRole('heading', { level: 1, name: created.name, exact: true }),
    ).toBeVisible();
    const countryId = administrator.url().split('/').pop() ?? '';
    const [row] = await sql.query<{ code: string; state: string; version: number }>(
      `SELECT [code],[state],[version] FROM [dbo].[Country] WHERE [id]=N'${countryId}';`,
    );
    expect(row).toEqual({ code: codes.created, state: 'draft', version: 1 });
    // A draft Country is not public.
    expect(
      (await administrator.request.get(`/en/global/countries/${created.slug}`)).status(),
    ).toBe(404);

    // Two copies of the editor; the first save wins, the second is refused.
    const second = await administrator.context().newPage();
    await second.goto(administrator.url());
    await administrator
      .getByLabel('Name in English', { exact: true })
      .fill(`${created.name} first`);
    await administrator.getByRole('button', { name: 'Save', exact: true }).click();
    await expect
      .poll(async () => {
        const [saved] = await sql.query<{ version: number }>(
          `SELECT [version] FROM [dbo].[Country] WHERE [id]=N'${countryId}';`,
        );
        return Number(saved?.version);
      })
      .toBe(2);

    await second
      .getByLabel('Name in English', { exact: true })
      .fill(`${created.name} stale`);
    await second.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      second
        .getByRole('alert')
        .filter({ hasText: 'This record changed. Reload it before trying again.' }),
    ).toBeVisible();
    // The refused form keeps what was typed.
    await expect(second.getByLabel('Name in English', { exact: true })).toHaveValue(
      `${created.name} stale`,
    );
    await second.close();

    const [label] = await sql.query<{ name: string }>(
      `SELECT [name] FROM [dbo].[CountryLabel] WHERE [countryId]=N'${countryId}' AND [locale]=N'en';`,
    );
    expect(label?.name).toBe(`${created.name} first`);
  });
});

/* ========================================================================== */

test.describe('reading direction, reflow and the keyboard', () => {
  test('renders Urdu and Arabic right-to-left', async ({ page }) => {
    for (const path of ['/ur/global', '/ar/global/find-a-centre']) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
    // An English name on an Arabic page is marked English.
    await page.goto(`/ar/global/countries/${slug.regionalCountry}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveAttribute('lang', 'en');
  });

  test('labels the finder’s controls and reaches its submit button by keyboard', async ({
    page,
  }) => {
    await page.goto(`/en/global/find-a-centre?country=${slug.regionalCountry}`);
    const country = page.getByLabel('Country', { exact: true });
    const region = page.getByLabel('Region', { exact: true });
    const city = page.getByLabel('City', { exact: true });
    const submit = page.getByRole('button', { name: 'Find centres', exact: true });
    await expect(country).toHaveValue(slug.regionalCountry);
    await expect(region).toBeEnabled();
    await expect(city).toBeEnabled();

    await country.focus();
    await expect(country).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(region).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(city).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(submit).toBeFocused();

    // Enter on the focused button submits the GET form with the chosen Region.
    await region.selectOption(slug.region);
    await submit.focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(/region=/);
    expect(new URL(page.url()).searchParams.get('region')).toBe(slug.region);
    await expect(
      page
        .getByRole('list', { name: 'Centres', exact: true })
        .getByRole('link', { name: NAME.virtual }),
    ).toBeVisible();

    // With no Country chosen, the narrower controls are disabled and skipped.
    await page.goto('/en/global/find-a-centre');
    await expect(page.getByLabel('Region', { exact: true })).toBeDisabled();
    await expect(page.getByLabel('City', { exact: true })).toBeDisabled();
    await page.getByLabel('Country', { exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('button', { name: 'Find centres', exact: true }),
    ).toBeFocused();
  });

  test('reflows at 320px without horizontal scroll, even for a very long Centre', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    for (const path of [
      '/en/global/find-a-centre',
      `/en/global/find-a-centre?country=${slug.regionalCountry}`,
      centrePath('en', slug.long),
      `${centrePath('en', slug.long)}/contact`,
      `/en/global/countries/${slug.plainCountry}`,
      '/ur/global',
    ]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      const { overflow, offenders } = await overflowOf(page);
      // Soft, so one run reports every address that scrolls, not only the first.
      expect.soft(overflow, `${path}\n${offenders.join('\n')}`).toBeLessThanOrEqual(0);
    }
    await page.goto(centrePath('en', slug.long));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(NAME.long);
  });
});
