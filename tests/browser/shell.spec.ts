import type { Locator, Page, Response } from '@playwright/test';

import {
  baseUrl,
  expect,
  firstDifference,
  knowledgeOf,
  localizedPath,
  registerAndSignIn,
  test,
} from './support';

/**
 * THE PUBLIC SHELL in a real browser (Phase 4, rebuilt by Rebaseline R1).
 *
 * WHAT ONLY A BROWSER CAN SHOW. That the address alone decides the interface
 * language — English unprefixed, `/en/…` one permanent hop away, no cookie and
 * no `Accept-Language` ever redirecting anybody; that the header always shows
 * all nine domains with their mega menus, a real search form, an account entry
 * and Donate; that the mobile drawer traps focus and locks the page behind it;
 * that the footer is the full six-column index with the legal documents, the
 * organisation's mark and the one pre-adoption statement; that every link the
 * header and footer offer answers; that the private surfaces wear
 * the same product bar; that nothing scrolls sideways at 320 pixels in Arabic;
 * that the Content-Security-Policy does not break the page it protects; and —
 * the one that matters most — that a visitor carrying a session cookie and a
 * visitor carrying none are served the same public document.
 *
 * THE NAVIGATION IS UNCONDITIONAL (owner direction 2026-11-08). The header and
 * footer show the same links whatever other specs publish in parallel, so this
 * file asserts them exactly; a destination with nothing published answers with
 * its own honest state, never a 404.
 *
 * NO PUBLIC SURFACE HERE NEEDS AN ACCOUNT, and that is itself the claim: the
 * public platform is fully usable signed out (PRODUCT_SCOPE.md).
 */

/** Every public surface this phase delivers, as locale-free paths. */
const PUBLIC_PATHS = [
  '',
  '/explore',
  '/explore/about',
  '/explore/about/vision',
  '/explore/shaykh-ul-islam/biography',
  '/explore/community',
  '/legal/privacy',
  '/sitemap',
] as const;

const LOCALES = [
  ['en', 'ltr'],
  ['ur', 'rtl'],
  ['ar', 'rtl'],
] as const;

/** The English shell's own words (apps/web/messages/en.json, `shell`). */
const NAV = 'Main navigation';
const SWITCHER = 'Choose a language';
const SEARCH_LABEL = 'Search One Minhaj';
const WORDMARK = /^One Minhaj\s*—\s*Home$/;
const ORGANISATION = 'Minhaj-ul-Quran International';
const PRE_ADOPTION = 'not currently commissioned';

/**
 * The nine domains of the primary navigation, always shown, in this order
 * (apps/web/src/shell/menus.ts), in each locale's own words.
 */
const DOMAINS = {
  en: [
    'Explore',
    'Quran',
    'Hadith',
    'Learn',
    'Library',
    'Watch',
    'Fatwa',
    'News and Events',
    'Global Network',
  ],
  ur: [
    'دریافت',
    'قرآن',
    'حدیث',
    'تعلیم',
    'کتب خانہ',
    'ویڈیو',
    'فتویٰ',
    'خبریں اور تقریبات',
    'عالمی نیٹ ورک',
  ],
  ar: [
    'استكشاف',
    'القرآن',
    'الحديث',
    'التعلّم',
    'المكتبة',
    'المرئيات',
    'الفتاوى',
    'الأخبار والفعاليات',
    'الشبكة العالمية',
  ],
} as const;

/** Each domain's landing, in the same order. */
const LANDINGS = [
  '/explore',
  '/quran',
  '/hadith',
  '/learn',
  '/library',
  '/watch',
  '/fatwa',
  '/news',
  '/global',
] as const;

/** The six footer columns, in order (INFORMATION_ARCHITECTURE.md §4). */
const FOOTER_COLUMNS = [
  'About Minhaj-ul-Quran',
  'Knowledge',
  'Library and Media',
  'Learn and Participate',
  'Our Work',
  'Global and Contact',
] as const;

/** The footer's closing row: every legal document, always, then the sitemap. */
const FOOTER_UTILITY = [
  '/legal/privacy',
  '/legal/terms',
  '/legal/cookies',
  '/legal/accessibility',
  '/sitemap',
] as const;

/** The organisation's official channels, the only links that leave the app. */
const OFFICIAL_CHANNELS: readonly string[] = [
  'https://www.youtube.com/DrQadri',
  'https://www.facebook.com/MinhajulQuran',
  'https://twitter.com/TahirulQadri',
  'https://apps.apple.com/us/developer/minhaj-publications/id998868018',
  'https://play.google.com/store/apps/dev?id=6490820456874948658',
];

/** Only the app's own addresses are fetched by a link check. */
const internal = (href: string) => href.startsWith('/');

/** Does the document scroll sideways? The one thing no layout may do. */
async function overflows(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
}

/** The `href` of every visible link inside `scope`, in document order. */
async function hrefsOf(scope: Locator): Promise<string[]> {
  return scope
    .getByRole('link')
    .evaluateAll((links) =>
      links.map((link) => (link as HTMLAnchorElement).getAttribute('href') ?? ''),
    );
}

/** The `href` of every anchor inside `scope`, visible or not. */
async function anchorsOf(scope: Locator): Promise<string[]> {
  return scope
    .locator('a[href]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
}

/** The path and query of an address. */
function pathAndQuery(url: string): string {
  const parsed = new URL(url, baseUrl());
  return `${parsed.pathname}${parsed.search}`;
}

/* ===========================================================================
 * The public surfaces
 * ========================================================================= */

test.describe('the public shell, signed out', () => {
  test('serves every delivered surface in all three locales', async ({ page }) => {
    for (const [locale, direction] of LOCALES) {
      for (const path of PUBLIC_PATHS) {
        const target = localizedPath(locale, path);
        const response = await page.goto(target);

        // Served at its own address — no hop on the way, in any locale.
        expect(response?.status(), target).toBe(200);
        expect(response?.request().redirectedFrom(), target).toBeNull();

        const document = await page.evaluate(() => ({
          lang: globalThis.document.documentElement.lang,
          dir: globalThis.document.documentElement.dir,
        }));

        expect(document.lang, `${target} lang`).toBe(locale);
        expect(document.dir, `${target} dir`).toBe(direction);

        // Exactly one first-level heading, and it is translated rather than
        // English under a prefix.
        await expect(page.getByRole('heading', { level: 1 }), target).toHaveCount(1);
      }
    }
  });

  test('needs no cookie at all', async ({ browser }) => {
    // A brand-new context with no storage whatsoever. A public page that
    // needed a cookie to render would fail here and nowhere else — and a page
    // that SET one would show up in the jar.
    const context = await browser.newContext();
    const page = await context.newPage();

    for (const path of PUBLIC_PATHS) {
      const response = await page.goto(`${baseUrl()}${localizedPath('en', path)}`);
      expect(response?.ok(), path).toBe(true);
      expect(response?.headers()['set-cookie'], path).toBeUndefined();
    }

    // The Urdu and Arabic addresses store nothing either: there is no locale
    // preference cookie any more.
    for (const locale of ['ur', 'ar'] as const) {
      const response = await page.goto(
        `${baseUrl()}${localizedPath(locale, '/explore')}`,
      );
      expect(response?.headers()['set-cookie'], locale).toBeUndefined();
    }

    expect(await context.cookies()).toHaveLength(0);
    await context.close();
  });

  test('gives every page the landmarks a screen reader navigates by', async ({
    page,
  }) => {
    await page.goto('/explore');

    await expect(page.getByRole('banner')).toHaveCount(1);
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('contentinfo')).toHaveCount(1);
  });

  test('offers a skip link that actually moves focus', async ({ page }) => {
    await page.goto('/');

    await page.keyboard.press('Tab');

    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();

    // Visible once focused, not merely present in the markup: a skip link
    // nobody can see is a skip link nobody uses.
    await expect(skip).toBeInViewport();

    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => globalThis.location.hash)).toBe('#main-content');
  });
});

/* ===========================================================================
 * The address decides the language (Rebaseline R1)
 * ========================================================================= */

test.describe('locale addresses', () => {
  test('answers a legacy /en address with ONE permanent hop, query preserved', async ({
    page,
  }) => {
    for (const [legacy, canonical] of [
      ['/en', '/'],
      ['/en/explore', '/explore'],
      [
        '/en/explore/about/vision?ref=legacy&page=2',
        '/explore/about/vision?ref=legacy&page=2',
      ],
      ['/en/sitemap', '/sitemap'],
      ['/en/legal/privacy', '/legal/privacy'],
      ['/en/signin?returnTo=%2Fmy', '/signin?returnTo=%2Fmy'],
    ] as const) {
      const response = await page.request.get(legacy, { maxRedirects: 0 });

      // Permanent, so a former link's authority transfers; uncached, like every
      // other hop the proxy answers, and it stores nothing.
      expect(response.status(), legacy).toBe(301);
      expect(response.headers()['set-cookie'], legacy).toBeUndefined();
      expect(response.headers()['cache-control'], legacy).toBe('no-store');

      // Same origin — a redirect built from the request never leaves the site.
      const location = new URL(response.headers()['location'] ?? '', baseUrl());
      expect(location.origin, legacy).toBe(new URL(baseUrl()).origin);
      expect(`${location.pathname}${location.search}`, legacy).toBe(canonical);

      // ONE hop: the target answers itself, with no second redirect.
      const landed = await page.request.get(canonical, { maxRedirects: 0 });
      expect(landed.status(), canonical).toBe(200);
    }

    // And in a browser: the navigation lands on the unprefixed page, in
    // English, through exactly one redirect.
    const response = await page.goto('/en/explore/about/vision?ref=browser');
    expect(pathAndQuery(page.url())).toBe('/explore/about/vision?ref=browser');
    expect(response?.status()).toBe(200);
    const hop = response?.request().redirectedFrom();
    expect(hop).toBeTruthy();
    expect(hop?.redirectedFrom()).toBeNull();
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
  });

  test('never redirects an unprefixed address by cookie or Accept-Language', async ({
    browser,
    clientAddress,
  }) => {
    // A browser that says, every way it can, that it prefers Urdu: its locale,
    // its Accept-Language header, and the preference cookie the platform used
    // to honour. None of it may move an unprefixed English address.
    const context = await browser.newContext({
      locale: 'ur-PK',
      extraHTTPHeaders: {
        'accept-language': 'ur-PK,ur;q=0.9,ar;q=0.8',
        'x-forwarded-for': clientAddress,
      },
    });
    await context.addCookies([{ name: 'NEXT_LOCALE', value: 'ur', url: baseUrl() }]);
    const page = await context.newPage();

    const redirects: string[] = [];
    page.on('response', (response) => {
      if (response.status() >= 300 && response.status() < 400)
        redirects.push(response.url());
    });

    for (const path of ['/', '/explore', '/sitemap']) {
      const response = await page.goto(`${baseUrl()}${path}`);
      expect(response?.status(), path).toBe(200);
      expect(new URL(page.url()).pathname, path).toBe(path);
      expect(await page.evaluate(() => document.documentElement.lang), path).toBe('en');
      expect(await page.evaluate(() => document.documentElement.dir), path).toBe('ltr');

      const raw = await context.request.get(`${baseUrl()}${path}`, { maxRedirects: 0 });
      expect(raw.status(), path).toBe(200);
      expect(raw.headers()['set-cookie'], path).toBeUndefined();
    }

    expect(redirects).toEqual([]);

    // Nothing was written back: the only cookie is the stale one this test set.
    expect((await context.cookies()).map(({ name }) => name)).toEqual(['NEXT_LOCALE']);
    await context.close();
  });

  test('switches language with plain links that keep the exact page and query', async ({
    page,
  }) => {
    const responses: Response[] = [];
    page.on('response', (response) => responses.push(response));

    await page.goto('/explore/about/vision?ref=switcher');
    const switcher = page.getByRole('banner').getByRole('navigation', { name: SWITCHER });

    for (const [locale, name, direction] of [
      ['en', 'English', 'ltr'],
      ['ur', 'اردو', 'rtl'],
      ['ar', 'العربية', 'rtl'],
    ] as const) {
      const link = switcher.getByRole('link', { name, exact: true });
      // Each link IS the target locale's canonical address — English
      // unprefixed, so switching to it never passes through a `/en/…` hop —
      // announced in its own language and direction.
      await expect(link, locale).toHaveAttribute(
        'href',
        localizedPath(locale, '/explore/about/vision?ref=switcher'),
      );
      await expect(link, locale).toHaveAttribute('hreflang', locale);
      await expect(link, locale).toHaveAttribute('lang', locale);
      await expect(link, locale).toHaveAttribute('dir', direction);
    }
    await expect(
      switcher.getByRole('link', { name: 'English', exact: true }),
    ).toHaveAttribute('aria-current', 'page');

    await switcher.getByRole('link', { name: 'اردو', exact: true }).click();
    await page.waitForURL((url) => url.pathname === '/ur/explore/about/vision');
    expect(pathAndQuery(page.url())).toBe('/ur/explore/about/vision?ref=switcher');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');

    // And back to English, straight to the unprefixed address.
    await page
      .getByRole('banner')
      .getByRole('link', { name: 'English', exact: true })
      .click();
    await page.waitForURL((url) => url.pathname === '/explore/about/vision');
    expect(pathAndQuery(page.url())).toBe('/explore/about/vision?ref=switcher');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');

    // NOTHING IS STORED. The choice lives in the address alone: no cookie, no
    // redirect anywhere in the journey, and the bare home stays English.
    expect(await page.context().cookies()).toHaveLength(0);
    for (const response of responses)
      expect(response.headers()['set-cookie'], response.url()).toBeUndefined();
    expect(
      responses
        .filter((response) => response.status() >= 300 && response.status() < 400)
        .map((response) => response.url()),
    ).toEqual([]);
    await page.goto('/');
    expect(new URL(page.url()).pathname).toBe('/');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
  });
});

/* ===========================================================================
 * Reserved routes and 404
 * ========================================================================= */

test.describe('reserved routes are honest', () => {
  test('says a reserved page is not published, and publishes nothing', async ({
    page,
  }) => {
    await page.goto('/legal/privacy');

    const main = page.getByRole('main');
    await expect(main).toContainText('Not yet published');

    // The title is there; a policy is not. The page must not contain anything
    // a visitor could mistake for terms they are agreeing to.
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Privacy Policy');
    await expect(main).not.toContainText('we collect');
    await expect(main).not.toContainText('cookies are used');
  });

  test('keeps every reserved route out of the index', async ({ page }) => {
    for (const path of ['/legal/terms', '/explore/about/mission', '/explore']) {
      await page.goto(path);

      const robots = await page.locator('meta[name="robots"]').getAttribute('content');

      expect(robots, path).toContain('noindex');

      // And no canonical claim on a non-indexable deployment.
      await expect(page.locator('link[rel="canonical"]'), path).toHaveCount(0);
      await expect(page.locator('link[rel="alternate"]'), path).toHaveCount(0);
    }
  });

  test('refuses a slug the allowlist does not name', async ({ page }) => {
    for (const path of [
      '/explore/about/not-a-page',
      '/explore/community/anything',
      '/explore/not-a-section',
      '/legal/refunds',
      '/this-does-not-exist',
      '/ur/explore/not-a-section',
    ]) {
      const response = await page.goto(path);

      expect(response?.status(), path).toBe(404);
    }
  });

  test('answers a missing page in the visitor’s own language, and does not redirect', async ({
    page,
  }) => {
    const response = await page.goto('/ur/does-not-exist');

    expect(response?.status()).toBe(404);

    // The locale survives, and the visitor stays where they asked to be — a
    // 404 that bounced to the home page would turn every broken citation into
    // a mystery.
    expect(new URL(page.url()).pathname).toBe('/ur/does-not-exist');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);

    // THE DIRECTION IS ASSERTED ON THE CONTENT, NOT ON `<html>`, because
    // Next.js serves a not-found response inside its own document element and
    // the root layout's `lang`/`dir` never reach it. What matters to a reader
    // is that the page they are looking at is laid out and pronounced
    // correctly, and that is what is checked: the resolved direction, not an
    // attribute somewhere.
    const content = page.getByRole('main').locator('[dir]').first();

    await expect(content).toHaveAttribute('lang', 'ur');
    expect(
      await content.evaluate((element) => globalThis.getComputedStyle(element).direction),
    ).toBe('rtl');

    // No internal detail of any kind.
    const body = (await page.locator('body').innerText()).toLowerCase();
    for (const leak of ['stack', 'webpack', 'at async', 'node_modules', 'prisma']) {
      expect(body, leak).not.toContain(leak);
    }

    // And the links it offers all work.
    for (const link of await page.getByRole('main').getByRole('link').all()) {
      const href = await link.getAttribute('href');
      expect(href).not.toBeNull();

      const target = await page.request.get(href!);
      expect(target.status(), href ?? '').toBe(200);
    }
  });

  test('lists every Explore section and page, each answering honestly', async ({
    page,
  }) => {
    await page.goto('/explore');
    const hrefs = await hrefsOf(page.getByRole('main'));

    // The whole index, whatever is published (owner direction 2026-11-08):
    // all seven sections, their reserved pages, and the newsletter an owner
    // delivers elsewhere — and every one of them answers.
    for (const expected of [
      '/explore/about',
      '/explore/leadership',
      '/explore/shaykh-ul-islam',
      '/explore/organization',
      '/explore/our-work',
      '/explore/community',
      '/explore/digital-resources',
      '/explore/about/vision',
      '/explore/shaykh-ul-islam/biography',
      '/newsletter',
    ])
      expect(hrefs, expected).toContain(expected);
    for (const href of new Set(hrefs))
      expect((await page.request.get(href)).status(), href).toBe(200);

    // A section lists its reserved pages too, the newsletter among them, and
    // says what is still unpublished.
    await page.goto('/explore/digital-resources');
    expect(await hrefsOf(page.getByRole('main'))).toContain('/newsletter');
    await expect(page.getByRole('main')).toContainText('Not yet published');

    // A reserved address renders its honest state, in every locale.
    for (const locale of ['en', 'ur', 'ar'] as const) {
      const target = localizedPath(locale, '/explore/about/vision');
      expect((await page.goto(target))?.status(), target).toBe(200);
      await expect(page.getByRole('heading', { level: 1 }), target).toHaveCount(1);
    }
    await page.goto('/explore/about/vision');
    await expect(page.getByRole('main')).toContainText('Not yet published');
  });
});

/* ===========================================================================
 * The cache boundary, observed
 * ========================================================================= */

test.describe('the anonymous public tree is the same for everybody', () => {
  test('serves identical public HTML with and without a session cookie', async ({
    page,
    browser,
    clientAddress,
  }) => {
    // A REAL session, created through the product, then carried onto a public
    // page. If anything in the public tree read it, the two documents would
    // differ — and the difference would be one visitor's state in a cache
    // entry every visitor shares (ARCHITECTURE.md §8.1).
    await registerAndSignIn(page, 'cache-boundary');

    const cookies = await page.context().cookies();
    expect(cookies.length, 'the journey must actually produce a session').toBeGreaterThan(
      0,
    );

    const anonymous = await browser.newContext({
      extraHTTPHeaders: { 'x-forwarded-for': clientAddress },
    });
    const anonymousPage = await anonymous.newPage();

    // The account entry is the ONE private island in the header: it asks
    // `/api/my/account-state` after load and relabels itself. Its answer is
    // held back here (and proved on its own below), so the rendered trees
    // compare everything the SERVER sent and the page hydrated from it.
    for (const viewer of [page, anonymousPage])
      await viewer.route('**/api/my/account-state', (route) => route.abort());

    for (const path of ['/', '/explore', '/sitemap']) {
      const base = baseUrl();

      // Compared as KNOWLEDGE, not bytes: since Phase 30 the home page is a
      // per-request content route, and two renders of one may flush a Suspense
      // boundary on either side of the shell — scaffolding, never content.
      // Every word, attribute and link must still be identical. Retried only
      // because the header's presence snapshot may refresh between the two
      // loads while a parallel spec publishes; a session leak differs every
      // time.
      await expect(async () => {
        await page.goto(`${base}${path}`);
        await anonymousPage.goto(`${base}${path}`);

        const signedIn = await page.locator('body').innerHTML();
        const signedOut = await anonymousPage.locator('body').innerHTML();

        expect(firstDifference(knowledgeOf(signedOut), knowledgeOf(signedIn)), path).toBe(
          'identical',
        );
      }).toPass({ timeout: 45_000 });
    }

    await anonymous.close();
  });

  test('does not vary public response headers on a real session cookie', async ({
    page,
    browser,
    clientAddress,
  }) => {
    await registerAndSignIn(page, 'cache-headers');

    const cookies = await page.context().cookies();
    expect(cookies.length, 'the request must carry a real session').toBeGreaterThan(0);

    const anonymous = await browser.newContext({
      extraHTTPHeaders: { 'x-forwarded-for': clientAddress },
    });
    const base = baseUrl();

    for (const path of ['/', '/explore', '/sitemap', '/ur', '/ar/explore']) {
      await expect(async () => {
        const signedIn = await page.context().request.get(`${base}${path}`);
        const signedOut = await anonymous.request.get(`${base}${path}`);

        // Knowledge, not bytes, for the same reason as above.
        expect(
          firstDifference(
            knowledgeOf(await signedOut.text()),
            knowledgeOf(await signedIn.text()),
          ),
          path,
        ).toBe('identical');

        const signedHeaders = signedIn.headers();
        const anonymousHeaders = signedOut.headers();

        expect(signedHeaders['set-cookie'], `${path} signed in`).toBeUndefined();
        expect(anonymousHeaders['set-cookie'], `${path} anonymous`).toBeUndefined();
        expect(signedHeaders['cache-control'], `${path} cache-control`).toBe(
          anonymousHeaders['cache-control'],
        );
        expect(signedHeaders['vary'], `${path} vary`).toBe(anonymousHeaders['vary']);
        expect(signedHeaders['vary']?.toLowerCase() ?? '', `${path} vary`).not.toContain(
          'cookie',
        );
      }).toPass({ timeout: 45_000 });
    }

    // The contrast matters: a private page keeps its request-time boundary.
    const privateResponse = await page.context().request.get(`${base}/my`);
    expect(privateResponse.headers()['cache-control'] ?? '').toMatch(/no-store|private/);

    await anonymous.close();
  });

  test('never renders an account detail on a public page', async ({ page }) => {
    const { email } = await registerAndSignIn(page, 'no-leak');

    for (const path of ['/', '/explore', '/legal/privacy', '/sitemap']) {
      await page.goto(path);
      // The account island has had its answer: the header now knows this
      // browser is signed in — and still names nobody.
      await expect(
        page
          .getByRole('banner')
          .getByRole('link', { name: /My Minhaj/ })
          .first(),
      ).toContainText('(signed in)');

      const html = await page.content();

      // The address, the local part of it, and the words a personalised header
      // would use. None of them belongs in a document served from one cache
      // entry to everybody.
      expect(html, path).not.toContain(email);
      expect(html, path).not.toContain(email.split('@')[0]);
      expect(html, path).not.toContain('Browser Proof');
      expect(html.toLowerCase(), path).not.toContain('signed in as');
      expect(html.toLowerCase(), path).not.toContain('sign out');
    }
  });

  test('tells the account island one boolean, privately, and nothing else', async ({
    page,
    browser,
    clientAddress,
  }) => {
    const anonymous = await browser.newContext({
      extraHTTPHeaders: { 'x-forwarded-for': clientAddress },
    });
    const signedOut = await anonymous.request.get(`${baseUrl()}/api/my/account-state`);
    expect(signedOut.status()).toBe(200);
    expect(await signedOut.json()).toEqual({ signedIn: false });
    expect(signedOut.headers()['cache-control']).toBe('private, no-store');
    expect(signedOut.headers()['set-cookie']).toBeUndefined();

    // A cross-site read is refused before any session is resolved.
    const crossSite = await anonymous.request.get(`${baseUrl()}/api/my/account-state`, {
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(crossSite.status()).toBe(403);
    await anonymous.close();

    const { email } = await registerAndSignIn(page, 'account-state');
    const signedIn = await page
      .context()
      .request.get(`${baseUrl()}/api/my/account-state`);
    expect(signedIn.status()).toBe(200);
    const body = await signedIn.text();
    expect(JSON.parse(body)).toEqual({ signedIn: true });
    expect(body).not.toContain(email);
    expect(signedIn.headers()['cache-control']).toBe('private, no-store');
  });
});

/* ===========================================================================
 * The header
 * ========================================================================= */

test.describe('the public header', () => {
  test('is a utility strip and one row: wordmark, the nine domains, search', async ({
    page,
  }) => {
    // Its own budget: every link of the nine menus is requested once.
    test.setTimeout(240_000);
    await page.goto('/explore');
    const banner = page.getByRole('banner');

    // The wordmark goes home.
    const wordmark = banner.getByRole('link', { name: WORDMARK });
    await expect(wordmark).toHaveCount(1);
    await expect(wordmark).toHaveAttribute('href', '/');

    // THE UTILITY STRIP: Find a Centre, Membership, Contact & Help — and
    // Donate, always, whether or not giving is open (`/donate` says so).
    expect(
      await hrefsOf(banner.getByRole('navigation', { name: 'The organisation' })),
    ).toEqual(['/global/find-a-centre', '/membership', '/help']);
    await expect(
      banner.getByRole('link', { name: 'Donate', exact: true }),
    ).toHaveAttribute('href', '/donate');

    // THE NINE DOMAINS, always, in order — one disclosure button each.
    const nav = banner.getByRole('navigation', { name: NAV });
    await expect(nav).toBeVisible();
    const buttons = nav.getByRole('button');
    // The domain the visitor is inside also carries a visually hidden marker.
    const names = (await buttons.allInnerTexts()).map((text) =>
      text.replace('(current section)', '').trim(),
    );
    expect(names).toEqual([...DOMAINS.en]);

    // Every domain's landing is in the header, the sitemap is not.
    const header = await anchorsOf(banner);
    for (const landing of LANDINGS)
      expect(header, `header links ${landing}`).toContain(landing);
    expect(header, 'header links the sitemap').not.toContain('/sitemap');

    // Each domain is a DISCLOSURE: keyboard-operable, never a trap, one open at
    // a time, and every link of its full menu a working page.
    const checked = new Set<string>();
    for (let index = 0; index < names.length; index += 1) {
      const trigger = buttons.nth(index);
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await trigger.focus();
      await page.keyboard.press('Enter');
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator('[aria-modal="true"]:visible')).toHaveCount(0);
      await expect(nav.locator('[aria-expanded="true"]')).toHaveCount(1);
      const panel = page.locator(`#${await trigger.getAttribute('aria-controls')}`);
      await expect(panel).toBeVisible();
      const links = await hrefsOf(panel);
      expect(links, names[index]).toContain(LANDINGS[index]);
      expect(links.length, names[index]).toBeGreaterThan(2);
      for (const href of links) {
        if (checked.has(href)) continue;
        checked.add(href);
        expect((await page.request.get(href)).status(), href).toBe(200);
      }
      await page.keyboard.press('Escape');
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await expect(trigger).toBeFocused();
    }
    // The full map: over a hundred distinct addresses across the nine menus.
    expect(checked.size).toBeGreaterThan(100);

    // ArrowDown opens a domain and moves into its first link, its landing.
    await buttons.first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(buttons.first()).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator(':focus')).toHaveAttribute('href', '/explore');
    await page.keyboard.press('Escape');

    // Explore marks itself as the visitor's current section here.
    await expect(
      nav.getByRole('button', { name: /Explore.*current section/ }),
    ).toHaveCount(1);

    // NO PRE-ADOPTION MARKER in the header, and the organisation's mark only in
    // the footer.
    await expect(banner).not.toContainText(PRE_ADOPTION);
    await expect(banner.getByRole('img', { name: ORGANISATION })).toHaveCount(0);
  });

  test('shows the nine domains in Urdu and Arabic too, mirrored for the keyboard', async ({
    page,
  }) => {
    for (const locale of ['ur', 'ar'] as const) {
      await page.goto(localizedPath(locale, ''));
      const banner = page.getByRole('banner');
      const nav = banner
        .getByRole('navigation')
        .filter({ has: page.getByRole('button') });
      const buttons = nav.getByRole('button');
      expect(
        (await buttons.allInnerTexts()).map((text) => text.trim()),
        locale,
      ).toEqual([...DOMAINS[locale]]);
      for (const landing of LANDINGS)
        expect(await anchorsOf(banner), `${locale} ${landing}`).toContain(
          localizedPath(locale, landing),
        );

      // ArrowLeft moves to the NEXT domain in a right-to-left bar.
      await buttons.first().focus();
      await page.keyboard.press('ArrowLeft');
      await expect(buttons.nth(1), locale).toBeFocused();
      await page.keyboard.press('End');
      await expect(buttons.last(), locale).toBeFocused();
    }
  });

  test('searches from a palette with a real form that submits q by GET', async ({
    page,
  }) => {
    for (const locale of ['en', 'ur'] as const) {
      await page.goto(localizedPath(locale, '/explore'));
      const banner = page.getByRole('banner');
      await banner
        .getByRole('button', { name: locale === 'en' ? 'Search' : 'تلاش' })
        .click();
      const palette = page.getByRole('dialog');
      await expect(palette, locale).toBeVisible();
      const form = palette.getByRole('search');
      await expect(form, locale).toHaveAttribute('method', 'get');
      await expect(form, locale).toHaveAttribute(
        'action',
        localizedPath(locale, '/search'),
      );

      // A labelled field, focused on open — found through its accessible name.
      const field =
        locale === 'en'
          ? form.getByRole('searchbox', { name: SEARCH_LABEL })
          : form.getByRole('searchbox', { name: /.+/ });
      await expect(field, locale).toBeFocused();
      await expect(field, locale).toHaveAttribute('name', 'q');

      await field.fill('vision');
      await field.press('Enter');
      await page.waitForURL((url) => url.pathname === localizedPath(locale, '/search'));
      expect(new URL(page.url()).searchParams.get('q'), locale).toBe('vision');
      await expect(page.getByRole('heading', { level: 1 }), locale).toHaveCount(1);
    }
  });

  test('reaches search from the keyboard straight after the domains, and by Ctrl+K', async ({
    page,
  }) => {
    await page.goto('/');
    const banner = page.getByRole('banner');
    const nav = banner.getByRole('navigation', { name: NAV });
    const stops = await nav.getByRole('button').count();
    expect(stops).toBe(DOMAINS.en.length);

    // From the wordmark, Tab walks the nine domain buttons in order (closed
    // panels hold no stop) and then lands on Search — no hidden duplicate.
    await banner.getByRole('link', { name: WORDMARK }).focus();
    for (let index = 0; index < stops; index += 1) {
      await page.keyboard.press('Tab');
      await expect(nav.locator(':focus'), `stop ${String(index)}`).toHaveCount(1);
    }
    await page.keyboard.press('Tab');
    const search = banner.getByRole('link', { name: 'Search', exact: true });
    await expect(search).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page.getByRole('searchbox', { name: SEARCH_LABEL })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(search).toBeFocused();

    // The shortcut opens the same palette from anywhere on the page.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Control+k');
    await page.keyboard.type('mission');
    await page.keyboard.press('Enter');
    await page.waitForURL((url) => url.pathname === '/search');
    expect(new URL(page.url()).searchParams.get('q')).toBe('mission');
  });

  test('offers the account entry: Sign in when signed out, My Minhaj when signed in', async ({
    page,
    browser,
    clientAddress,
  }) => {
    // The document every visitor shares names My Minhaj; only the island, after
    // load, may relabel it.
    const document = await (await page.request.get('/')).text();
    expect(document).toContain('href="/my"');
    expect(document).toContain('My Minhaj');

    const anonymous = await browser.newContext({
      extraHTTPHeaders: { 'x-forwarded-for': clientAddress },
    });
    const visitor = await anonymous.newPage();
    await visitor.goto(`${baseUrl()}/`);
    const entry = visitor
      .getByRole('banner')
      .getByRole('link', { name: 'Sign in', exact: true });
    await expect(entry).toHaveAttribute('href', '/signin');
    await entry.click();
    await visitor.waitForURL((url) => url.pathname === '/signin');
    await expect(visitor.getByRole('heading', { level: 1 })).toHaveText('Sign in');

    // The address behind the shared label works too: signed out, My Minhaj
    // sends the visitor to sign in with the way back.
    await visitor.goto(`${baseUrl()}/my`);
    await visitor.waitForURL((url) => url.pathname === '/signin');
    expect(new URL(visitor.url()).searchParams.get('returnTo')).toBe('/my');
    await anonymous.close();

    await registerAndSignIn(page, 'account-entry');
    await page.goto('/');
    const mine = page.getByRole('banner').getByRole('link', { name: /signed in/ });
    await expect(mine).toHaveAttribute('href', '/my');
    await expect(page.getByRole('banner').locator('a[href="/signin"]')).toHaveCount(0);
    await mine.click();
    await page.waitForURL((url) => url.pathname === '/my');

    // In Urdu the same entry keeps the Urdu address.
    const [answer] = await Promise.all([
      page.waitForResponse('**/api/my/account-state'),
      page.goto('/ur'),
    ]);
    expect(await answer.json()).toEqual({ signedIn: true });
    await expect(
      page.getByRole('banner').locator('a[href="/ur/my"]:visible'),
    ).toHaveCount(1);
    await expect(page.getByRole('banner').locator('a[href="/ur/signin"]')).toHaveCount(0);
  });
});

/* ===========================================================================
 * The mobile navigation
 * ========================================================================= */

test.describe('the mobile navigation', () => {
  test.use({ viewport: { width: 375, height: 780 } });

  test('opens, traps focus, locks the page and restores focus on Escape', async ({
    page,
  }) => {
    await page.goto('/');

    const trigger = page.getByRole('button', { name: 'Menu' });
    await expect(trigger).toBeVisible();

    await trigger.click();

    // R2: the shared Sheet primitive — the browser's own modal `<dialog>`.
    const drawer = page.getByRole('dialog', { name: NAV });
    await expect(drawer).toBeVisible();
    expect(await drawer.evaluate((element) => element.matches(':modal'))).toBe(true);

    // Focus moves INTO the drawer when it opens.
    await expect(drawer.getByRole('button', { name: 'Close' })).toBeFocused();

    // The page behind it does not scroll.
    expect(
      await page.evaluate(
        () => globalThis.getComputedStyle(document.documentElement).overflow,
      ),
    ).toBe('hidden');

    // The trap holds, both ways: tabbing past the last focusable returns to the
    // first, and Shift+Tab from the first wraps to the last, rather than
    // escaping to the page underneath or the browser.
    const focusables = await drawer.locator('a[href], button, input, summary').count();
    for (let index = 0; index < focusables + 1; index += 1) {
      await page.keyboard.press('Tab');
      expect(
        await drawer.evaluate((element) => element.contains(document.activeElement)),
        `forward ${String(index)}`,
      ).toBe(true);
    }
    await drawer.getByRole('button', { name: 'Close' }).focus();
    await page.keyboard.press('Shift+Tab');
    expect(
      await drawer.evaluate((element) => element.contains(document.activeElement)),
    ).toBe(true);

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();

    // And the lock is released with it.
    expect(
      await page.evaluate(
        () => globalThis.getComputedStyle(document.documentElement).overflow,
      ),
    ).not.toBe('hidden');
  });

  test('holds search, one accordion per domain, Donate, the organisation and the language', async ({
    page,
  }) => {
    // Its own budget: every link it offers is requested once.
    test.setTimeout(240_000);
    await page.goto('/');

    // The account entry sits in the phone header itself, relabelled for this
    // signed-out browser.
    await expect(
      page.getByRole('banner').getByRole('link', { name: 'Sign in', exact: true }),
    ).toHaveAttribute('href', '/signin');

    await page.getByRole('button', { name: 'Menu' }).click();
    const drawer = page.getByRole('dialog', { name: NAV });
    await expect(drawer).toBeVisible();

    // One accordion per domain, all nine; opened, each lists its landing and
    // every link of its menu.
    const groups = drawer.getByRole('navigation', { name: NAV }).locator('summary');
    expect((await groups.allInnerTexts()).map((text) => text.trim())).toEqual([
      ...DOMAINS.en,
    ]);
    for (let index = 0; index < DOMAINS.en.length; index += 1)
      await groups.nth(index).click();
    const hrefs = await hrefsOf(drawer.getByRole('navigation', { name: NAV }));
    for (const landing of LANDINGS) expect(hrefs).toContain(landing);
    expect(new Set(hrefs).size).toBeGreaterThan(100);

    // Donate, always; the utility links; and the language switcher.
    await expect(
      drawer.getByRole('link', { name: 'Donate', exact: true }),
    ).toHaveAttribute('href', '/donate');
    expect(
      await hrefsOf(drawer.getByRole('navigation', { name: 'The organisation' })),
    ).toEqual(['/global/find-a-centre', '/membership', '/help']);
    await expect(drawer.getByRole('navigation', { name: SWITCHER })).toBeVisible();

    // Every link the drawer offers is a working page.
    for (const href of new Set(await hrefsOf(drawer)))
      expect((await page.request.get(href)).status(), href).toBe(200);

    // The drawer's own search form submits `q` to the search page.
    const field = drawer
      .getByRole('search')
      .getByRole('searchbox', { name: SEARCH_LABEL });
    await field.fill('history');
    await field.press('Enter');
    await page.waitForURL((url) => url.pathname === '/search');
    expect(new URL(page.url()).searchParams.get('q')).toBe('history');
  });

  test('presents no second, hidden copy of the desktop navigation', async ({ page }) => {
    await page.goto('/');
    const banner = page.getByRole('banner');

    // Before the drawer opens, nothing inside it is focusable, and the desktop
    // groups and utility strip are gone at this width, leaving one labelled
    // Search action that opens the palette.
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(banner.getByRole('navigation', { name: NAV })).toHaveCount(0);
    await expect(banner.getByRole('search')).toHaveCount(0);
    const search = banner.getByRole('link', { name: 'Search', exact: true });
    await expect(search).toBeVisible();
    await search.click();
    await expect(page.getByRole('searchbox', { name: SEARCH_LABEL })).toBeFocused();
  });
});

/* ===========================================================================
 * The footer
 * ========================================================================= */

test.describe('the public footer', () => {
  test('is the six-column index, the official channels and the legal row, every link working', async ({
    page,
  }) => {
    // Its own budget: every link it offers is requested once.
    test.setTimeout(240_000);
    await page.goto('/');
    const footer = page.getByRole('contentinfo');

    await expect(footer.getByRole('link', { name: WORDMARK })).toHaveAttribute(
      'href',
      '/',
    );

    // The six columns, always, each a labelled navigation under a heading.
    await expect(footer.getByRole('heading', { level: 2 })).toContainText([
      ...FOOTER_COLUMNS,
    ]);
    for (const [column, sample] of [
      ['About Minhaj-ul-Quran', '/explore/about'],
      ['Knowledge', '/fatwa'],
      ['Library and Media', '/library/books'],
      ['Learn and Participate', '/donate'],
      ['Our Work', '/explore/our-work'],
      ['Global and Contact', '/global/find-a-centre'],
    ] as const) {
      const nav = footer.getByRole('navigation', { name: column, exact: true });
      await expect(nav, column).toBeVisible();
      expect(await hrefsOf(nav), column).toContain(sample);
    }

    // Every legal document, published or not, then the human sitemap.
    expect(
      await hrefsOf(footer.getByRole('navigation', { name: 'Legal and site' })),
    ).toEqual([...FOOTER_UTILITY]);

    // The official channels: exactly minhaj.org's own addresses, outbound.
    const channels = footer.getByRole('navigation', { name: 'Official channels' });
    expect(await hrefsOf(channels)).toEqual([...OFFICIAL_CHANNELS]);
    for (const link of await channels.getByRole('link').all())
      await expect(link).toHaveAttribute('rel', 'external noopener noreferrer');

    // The six columns, the channels and the legal row — nothing else.
    await expect(footer.getByRole('navigation')).toHaveCount(8);

    const seen = new Set(await hrefsOf(footer));
    expect(seen.size).toBeGreaterThan(70);
    for (const href of seen) {
      if (!internal(href)) {
        expect(OFFICIAL_CHANNELS, href).toContain(href);
        continue;
      }
      expect((await page.request.get(href)).status(), href).toBe(200);
    }
  });

  test('always links the legal documents, each answering honestly while unpublished', async ({
    page,
  }) => {
    // No legal page is published during a run: each is still linked, from the
    // page itself too, and answers that it is not yet published.
    for (const document of ['privacy', 'terms', 'cookies', 'accessibility']) {
      const response = await page.goto(`/legal/${document}`);
      expect(response?.status(), document).toBe(200);
      await expect(page.getByRole('main'), document).toContainText('Not yet published');

      const legal = page
        .getByRole('contentinfo')
        .getByRole('navigation', { name: 'Legal and site' });
      await expect(legal.locator(`a[href="/legal/${document}"]`), document).toHaveCount(
        1,
      );
    }
  });

  test('carries the organisation’s mark beside the one pre-adoption statement', async ({
    page,
  }) => {
    for (const locale of ['en', 'ur', 'ar'] as const) {
      await page.goto(localizedPath(locale, ''));
      const footer = page.getByRole('contentinfo');

      // ONCE on the page, and in the footer: the official mark is never used
      // as the product's own logo.
      await expect(page.getByRole('img', { name: ORGANISATION }), locale).toHaveCount(1);
      await expect(footer.getByRole('img', { name: ORGANISATION }), locale).toBeVisible();
    }

    await page.goto('/');
    await expect(page.getByText(PRE_ADOPTION)).toHaveCount(1);
    await expect(page.getByRole('contentinfo')).toContainText(PRE_ADOPTION);
  });
});

/* ===========================================================================
 * The private surfaces are the same product
 * ========================================================================= */

test.describe('the product bar on private surfaces', () => {
  /** The shared bar: wordmark home, a way back, the switcher — no public nav. */
  async function expectProductBar(page: Page, locale: 'en' | 'ur', where: string) {
    const bar = page.getByRole('banner').first();
    await expect(
      bar.getByRole('link', { name: /One Minhaj/ }).first(),
      where,
    ).toHaveAttribute('href', localizedPath(locale, ''));
    await expect(bar.getByRole('navigation').first(), where).toBeVisible();
    // The public navigation stays on the public site.
    await expect(page.getByRole('navigation', { name: NAV }), where).toHaveCount(0);
  }

  test('frames the sign-in pages with the wordmark, a way back and the language switcher', async ({
    page,
  }) => {
    await page.goto('/signin');
    await expect(page).toHaveTitle('Sign in · One Minhaj');
    await expectProductBar(page, 'en', '/signin');
    const bar = page.getByRole('banner').first();
    await expect(
      bar.getByRole('link', { name: 'Back to One Minhaj', exact: true }),
    ).toHaveAttribute('href', '/');
    await expect(
      bar
        .getByRole('navigation', { name: SWITCHER })
        .getByRole('link', { name: 'اردو', exact: true }),
    ).toHaveAttribute('href', '/ur/signin');

    await page.goto('/signup');
    await expect(page).toHaveTitle('Create an account · One Minhaj');
    await expectProductBar(page, 'en', '/signup');

    await page.goto('/ur/signin');
    await expectProductBar(page, 'ur', '/ur/signin');
  });

  test('frames My Minhaj the same way, titled by its area', async ({ page }) => {
    await registerAndSignIn(page, 'product-bar');

    await page.goto('/my');
    await expect(page).toHaveTitle(/(^|· )My Minhaj · One Minhaj$/);
    await expectProductBar(page, 'en', '/my');
    const bar = page.getByRole('banner').first();
    await expect(bar).toContainText('My Minhaj');
    await expect(
      bar.getByRole('link', { name: 'Back to One Minhaj', exact: true }),
    ).toHaveAttribute('href', '/');

    // The switcher keeps the exact private page.
    await bar
      .getByRole('navigation', { name: SWITCHER })
      .getByRole('link', { name: 'العربية', exact: true })
      .click();
    await page.waitForURL((url) => url.pathname === '/ar/my');
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
  });
});

/* ===========================================================================
 * Responsive and RTL
 * ========================================================================= */

test.describe('layout holds at every supported width', () => {
  for (const width of [320, 375, 768, 1024, 1440]) {
    test(`does not scroll sideways at ${width}px, in all three locales`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });

      for (const [locale] of LOCALES) {
        for (const path of PUBLIC_PATHS) {
          const target = localizedPath(locale, path);
          await page.goto(target);

          expect(await overflows(page), `${target} at ${width}px`).toBe(false);
        }
      }
    });
  }

  test('does not scroll sideways with the mobile drawer open', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 780 });
    await page.goto('/ar');

    await page.getByRole('button', { name: 'القائمة' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    expect(await overflows(page)).toBe(false);
  });
});

/* ===========================================================================
 * Motion
 * ========================================================================= */

test.describe('reduced motion is honoured', () => {
  // Emulated on the page itself, as every other spec does. `test.use({
  // reducedMotion })` never reached these pages: the suite's own `context`
  // fixture builds the context from `contextOptions`, which does not carry it.
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('suppresses transition and animation timing', async ({ page }) => {
    await page.goto('/');

    const timings = await page.evaluate(() =>
      [...document.querySelectorAll('header *, footer *')].map((element) => {
        const style = globalThis.getComputedStyle(element);
        return {
          // Named, so a failure says WHICH element still moves.
          element: `${element.tagName.toLowerCase()}.${(element.getAttribute('class') ?? '').slice(0, 120)}`,
          transition: style.transitionDuration,
          animation: style.animationDuration,
        };
      }),
    );

    expect(timings.length).toBeGreaterThan(0);

    for (const timing of timings) {
      for (const duration of [timing.transition, timing.animation]) {
        for (const part of duration.split(', ')) {
          // `0.01ms` is what the reduced-motion rule collapses everything to.
          expect(Number.parseFloat(part), `${timing.element} ${duration}`).toBeLessThan(
            0.02,
          );
        }
      }
    }
  });

  test('still opens the drawer, because motion was never the mechanism', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 780 });
    await page.goto('/');

    const trigger = page.getByRole('button', { name: 'Menu' });
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('dialog', { name: NAV })).toBeVisible();
  });
});

/* ===========================================================================
 * Indexing posture
 * ========================================================================= */

test.describe('the pre-adoption indexing posture', () => {
  test('disallows the whole site in robots.txt, and advertises no sitemap', async ({
    page,
  }) => {
    const response = await page.request.get('/robots.txt');

    expect(response.status()).toBe(200);

    const body = await response.text();
    expect(body).toContain('User-Agent: *');
    expect(body).toContain('Disallow: /');
    expect(body.toLowerCase()).not.toContain('sitemap:');
  });

  test('serves no sitemap at all', async ({ page }) => {
    for (const path of ['/sitemap.xml', '/sitemaps/pages-en.xml']) {
      const response = await page.request.get(path);

      expect(response.status(), path).toBe(404);
    }
  });

  test('emits noindex on every public page', async ({ page }) => {
    for (const [locale] of LOCALES) {
      for (const path of PUBLIC_PATHS) {
        const target = localizedPath(locale, path);
        await page.goto(target);

        const robots = await page.locator('meta[name="robots"]').getAttribute('content');

        expect(robots, target).toContain('noindex');
      }
    }
  });

  test('asserts no organisation identity in structured data', async ({ page }) => {
    // No JSON-LD at all on a pre-adoption origin: a machine-readable claim to
    // be the organisation is exactly what must not be published from a
    // developer-controlled host (ROUTE_MAP.md §9.6).
    for (const path of ['/', '/explore']) {
      await page.goto(path);

      await expect(page.locator('script[type="application/ld+json"]'), path).toHaveCount(
        0,
      );
    }
  });
});

/* ===========================================================================
 * Navigation is honest about what exists
 * ========================================================================= */

test.describe('navigation is honest about what exists', () => {
  test('renders no link to an undelivered domain, and links every delivered one', async ({
    page,
  }) => {
    // Only domains still awaiting implementation remain absent — absent, not
    // greyed out and not linked to a stub (ROUTE_MAP.md §5.2).
    const deferred = [
      // Phase 15 delivers `/collections` but deliberately no Library-filtered
      // view.
      '/library/collections',
      // Audio is `/listen` and galleries live under `/media`, not `/watch`.
      '/watch/audio',
      '/watch/galleries',
      // Local Events live under each Centre; no `/global/events` exists.
      '/global/events',
      '/people',
    ];

    for (const path of ['/', '/explore', '/sitemap', '/legal/terms']) {
      await page.goto(path);
      const hrefs = await anchorsOf(page.locator('body'));

      // The header and footer link every one of these on every public page,
      // whatever is published (owner direction 2026-11-08), and the human
      // sitemap lists them too.
      for (const delivered of [
        '/contact',
        '/help',
        '/feedback',
        '/library',
        '/library/articles',
        '/search',
        '/topics',
        '/watch',
        '/listen',
        '/global',
        '/global/find-a-centre',
        '/newsletter',
        '/membership',
        '/donate',
        '/collections',
        '/learn/live',
        '/learn/teachers',
        ...LANDINGS,
      ])
        expect(hrefs, `${path} links delivered ${delivered}`).toContain(delivered);

      for (const href of hrefs) {
        for (const domain of deferred)
          expect(href, `${path} links to ${href}`).not.toBe(domain);
        // Every app link is built by the one locale-path contract: an English
        // page never emits a legacy `/en` address that would cost a redirect.
        expect(
          href === '/en' || href.startsWith('/en/') || href.startsWith('/en?'),
          href,
        ).toBe(false);
      }
    }

    await page.goto('/watch');
    await expect(page.locator('main a[href="/listen"]')).toHaveCount(1);
  });

  test('every link on every public page resolves', async ({ page }) => {
    // The blanket check. Dead navigation is the failure this phase is most
    // exposed to, and it is cheap to make impossible rather than unlikely.
    // Its own budget: many of these links are content routes rendered from the
    // database, each requested once. Every one must answer 200.
    test.setTimeout(240_000);
    const seen = new Set<string>();

    for (const path of PUBLIC_PATHS) {
      await page.goto(localizedPath('en', path));

      for (const href of await hrefsOf(page.locator('body'))) {
        if (href === '' || href.startsWith('#') || seen.has(href)) continue;
        // R2: the footer's official channels are the only links that leave the
        // app; they are checked by name, never fetched.
        if (!internal(href)) {
          expect(OFFICIAL_CHANNELS, `${path} -> ${href}`).toContain(href);
          continue;
        }
        seen.add(href);

        const response = await page.request.get(href);
        expect(response.status(), `${path} -> ${href}`).toBe(200);
      }
    }

    expect(seen.size).toBeGreaterThan(15);
  });
});

/* ===========================================================================
 * Security headers
 * ========================================================================= */

test.describe('security headers', () => {
  async function headersOf(page: Page, path: string): Promise<Record<string, string>> {
    const response = (await page.goto(path)) as Response;
    return response.headers();
  }

  test('sends the base policy on a public page, an auth page and an API route', async ({
    page,
  }) => {
    for (const path of ['/', '/ur', '/signin', '/api/health']) {
      const response = await page.request.get(path);
      const headers = response.headers();

      // Whatever an API route answers, the headers must still be on it. A route
      // that escapes the policy is the route an attacker looks for.
      expect(headers['x-content-type-options'], path).toBe('nosniff');
      expect(headers['referrer-policy'], path).toBe('strict-origin-when-cross-origin');
      expect(headers['x-frame-options'], path).toBe('DENY');
      expect(headers['content-security-policy'], path).toContain("default-src 'self'");
      expect(headers['content-security-policy'], path).toContain(
        "frame-ancestors 'none'",
      );
      expect(headers['content-security-policy'], path).not.toContain('unsafe-eval');

      // `style-src` is strict, and stays strict. The script allowance is the
      // one concession the caching boundary forces; nothing forces this one,
      // and a later change that granted it to make something unrelated work
      // would fail here rather than pass unnoticed.
      expect(headers['content-security-policy'], path).toContain("style-src 'self';");
    }
  });

  test('sends exactly one of each header, with nothing contradicting it', async ({
    page,
  }) => {
    const headers = await headersOf(page, '/');

    // Playwright joins repeated headers with a comma; two policies would both
    // apply, and the intersection is rarely what anybody intended.
    expect(headers['content-security-policy']?.split('default-src').length).toBe(2);
    expect(headers['x-frame-options']).toBe('DENY');
  });

  test('breaks nothing it protects', async ({ page }) => {
    const violations: string[] = [];
    const fonts: string[] = [];

    page.on('console', (message) => {
      const text = message.text();
      if (/content security policy|refused to/i.test(text)) violations.push(text);
    });
    page.on('request', (request) => {
      if (request.resourceType() === 'font') fonts.push(request.url());
    });

    // The public shell with its client islands actually exercised — the
    // account entry's same-origin read (`connect-src`), the language switcher
    // and the mobile drawer — and an authentication form, the surface most
    // likely to be broken by `form-action`.
    await page.goto('/');
    await expect(
      page.getByRole('banner').getByRole('link', { name: 'Sign in', exact: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 375, height: 780 });
    await page.getByRole('button', { name: 'Menu' }).click();
    await expect(page.getByRole('dialog', { name: NAV })).toBeVisible();
    await page.keyboard.press('Escape');

    // Urdu headings and Arabic script reading text use their own faces.
    await page.goto('/ur/signin');
    await page.goto('/signin');
    await expect(
      page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }),
    ).toBeVisible();

    // The stylesheet actually applied, which is how a `style-src` mistake
    // shows up: a page that renders unstyled and passes every other check.
    const background = await page.evaluate(
      () => globalThis.getComputedStyle(document.body).backgroundColor,
    );
    expect(background).not.toBe('rgba(0, 0, 0, 0)');

    // The type is SELF-HOSTED: every font the pages asked for came from this
    // origin, and the faces actually loaded under the policy.
    const loaded = await page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts].filter((face) => face.status === 'loaded').length;
    });
    expect(loaded).toBeGreaterThan(0);
    expect(fonts.length).toBeGreaterThan(0);
    for (const font of fonts)
      expect(new URL(font).origin, font).toBe(new URL(baseUrl()).origin);

    expect(violations, violations.join('\n')).toEqual([]);
  });
});
