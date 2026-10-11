import type { Page, Response } from '@playwright/test';

import { expect, registerAndSignIn, test } from './support';

/**
 * PHASE 4 — the public shell in a real browser.
 *
 * WHAT ONLY A BROWSER CAN SHOW. That a mega menu opens from the keyboard and
 * gives focus back when it closes; that a drawer traps focus and locks the page
 * behind it; that nothing scrolls sideways at 320 pixels in Arabic; that the
 * Content-Security-Policy the server sends does not break the page it protects;
 * and — the one that matters most — that a visitor carrying a session cookie
 * and a visitor carrying none are served the same public document.
 *
 * NO SURFACE HERE NEEDS AN ACCOUNT, and that is itself the claim: the public
 * platform is fully usable signed out (PRODUCT_SCOPE.md).
 */

/** Every public surface this phase delivers, as locale-relative paths. */
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

/** Does the document scroll sideways? The one thing no layout may do. */
async function overflows(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
}

/* ===========================================================================
 * The public surfaces
 * ========================================================================= */

test.describe('the public shell, signed out', () => {
  test('serves every delivered surface in all three locales', async ({ page }) => {
    for (const [locale, direction] of LOCALES) {
      for (const path of PUBLIC_PATHS) {
        const response = await page.goto(`/${locale}${path}`);

        expect(response?.status(), `${locale}${path}`).toBe(200);

        const document = await page.evaluate(() => ({
          lang: globalThis.document.documentElement.lang,
          dir: globalThis.document.documentElement.dir,
        }));

        expect(document.lang, `${locale}${path} lang`).toBe(locale);
        expect(document.dir, `${locale}${path} dir`).toBe(direction);

        // Exactly one first-level heading, and it is translated rather than
        // English under a prefix.
        await expect(
          page.getByRole('heading', { level: 1 }),
          `${locale}${path}`,
        ).toHaveCount(1);
      }
    }
  });

  test('needs no cookie at all', async ({ browser }) => {
    // A brand-new context with no storage whatsoever. A public page that
    // needed a cookie to render would fail here and nowhere else.
    const context = await browser.newContext();
    const page = await context.newPage();

    for (const path of PUBLIC_PATHS) {
      const response = await page.goto(`${test.info().project.use.baseURL}/en${path}`);
      expect(response?.ok(), path).toBe(true);
    }

    expect(await context.cookies()).toHaveLength(0);
    await context.close();
  });

  test('gives every page the landmarks a screen reader navigates by', async ({
    page,
  }) => {
    await page.goto('/en/explore');

    await expect(page.getByRole('banner')).toHaveCount(1);
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('contentinfo')).toHaveCount(1);
  });

  test('offers a skip link that actually moves focus', async ({ page }) => {
    await page.goto('/en');

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
 * Reserved routes and 404
 * ========================================================================= */

test.describe('reserved routes are honest', () => {
  test('says a reserved page is not published, and publishes nothing', async ({
    page,
  }) => {
    await page.goto('/en/legal/privacy');

    const main = page.getByRole('main');
    await expect(main).toContainText('Not yet published');

    // The title is there; a policy is not. The page must not contain anything
    // a visitor could mistake for terms they are agreeing to.
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Privacy Policy');
    await expect(main).not.toContainText('we collect');
    await expect(main).not.toContainText('cookies are used');
  });

  test('keeps every reserved route out of the index', async ({ page }) => {
    for (const path of ['/en/legal/terms', '/en/explore/about/mission', '/en/explore']) {
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
      '/en/explore/about/not-a-page',
      '/en/explore/community/anything',
      '/en/explore/not-a-section',
      '/en/legal/refunds',
      '/en/this-does-not-exist',
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

    for (const path of ['/en', '/en/explore', '/en/sitemap']) {
      const base = test.info().project.use.baseURL;

      await page.goto(`${base}${path}`);
      await anonymousPage.goto(`${base}${path}`);

      const signedIn = await page.locator('body').innerHTML();
      const signedOut = await anonymousPage.locator('body').innerHTML();

      expect(signedIn, path).toBe(signedOut);
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
    const base = test.info().project.use.baseURL;

    for (const path of ['/en', '/en/explore', '/en/sitemap']) {
      const signedIn = await page.context().request.get(`${base}${path}`);
      const signedOut = await anonymous.request.get(`${base}${path}`);

      expect(await signedIn.text(), path).toBe(await signedOut.text());

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
    }

    // The contrast matters: a private page keeps its request-time boundary.
    const privateResponse = await page.context().request.get(`${base}/en/my`);
    expect(privateResponse.headers()['cache-control'] ?? '').toMatch(/no-store|private/);

    await anonymous.close();
  });

  test('never renders an account detail on a public page', async ({ page }) => {
    const { email } = await registerAndSignIn(page, 'no-leak');

    for (const path of ['/en', '/en/explore', '/en/legal/privacy', '/en/sitemap']) {
      await page.goto(path);

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
});

/* ===========================================================================
 * Navigation
 * ========================================================================= */

test.describe('the Explore mega menu', () => {
  test('opens by pointer, and every entry it offers resolves', async ({ page }) => {
    await page.goto('/en');

    const trigger = page.getByRole('button', { name: 'Explore' });
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const panel = page.locator(`#${await trigger.getAttribute('aria-controls')}`);
    await expect(panel).toBeVisible();

    const hrefs = await panel
      .getByRole('link')
      .evaluateAll((links) =>
        links.map((link) => (link as HTMLAnchorElement).getAttribute('href') ?? ''),
      );

    expect(hrefs.length).toBeGreaterThan(20);

    for (const href of hrefs) {
      const response = await page.request.get(href);
      expect(response.status(), href).toBe(200);
    }
  });

  test('opens from the keyboard, closes on Escape and gives focus back', async ({
    page,
  }) => {
    await page.goto('/en');

    const trigger = page.getByRole('button', { name: 'Explore' });

    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');

    // Tab reaches the panel's own links rather than skipping past it.
    await page.keyboard.press('Tab');
    const focusedHref = await page.evaluate(() =>
      (document.activeElement as HTMLAnchorElement | null)?.getAttribute('href'),
    );
    expect(focusedHref).toContain('/en/explore/');

    await page.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    // FOCUS RESTORATION. Closing a menu and dumping focus at the top of the
    // document is how a keyboard visitor loses their place entirely.
    await expect(trigger).toBeFocused();
  });

  test('is a disclosure rather than a trap', async ({ page }) => {
    await page.goto('/en');

    const trigger = page.getByRole('button', { name: 'Explore' });

    // A mega menu is attached to the page, not modal: it must not claim to be.
    await expect(trigger).toHaveAttribute('aria-controls', /.+/);
    await expect(page.locator('[aria-modal="true"]:visible')).toHaveCount(0);
  });
});

test.describe('the mobile navigation', () => {
  test.use({ viewport: { width: 375, height: 780 } });

  test('opens, traps focus, locks the page and restores focus on Escape', async ({
    page,
  }) => {
    await page.goto('/en');

    const trigger = page.getByRole('button', { name: 'Menu' });
    await expect(trigger).toBeVisible();

    await trigger.click();

    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute('aria-modal', 'true');

    // Focus moves INTO the drawer when it opens.
    await expect(drawer.getByRole('button', { name: 'Close' })).toBeFocused();

    // The page behind it does not scroll.
    expect(
      await page.evaluate(
        () => globalThis.getComputedStyle(document.documentElement).overflow,
      ),
    ).toBe('hidden');

    // The trap holds: tabbing from the last focusable returns to the first
    // rather than escaping to the page underneath.
    const focusables = await drawer.locator('a[href], button').count();
    for (let index = 0; index < focusables + 1; index += 1) {
      await page.keyboard.press('Tab');
    }
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

  test('presents no second, hidden copy of the desktop navigation', async ({ page }) => {
    await page.goto('/en');

    // Before the drawer opens, nothing inside it is focusable — a hidden
    // duplicate of every link is a tab order a keyboard visitor walks through
    // for no reason.
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Explore' })).toBeHidden();
  });
});

test.describe('navigation is honest about what exists', () => {
  test('renders no link to an undelivered domain', async ({ page }) => {
    // Only domains still awaiting implementation remain absent.
    // Absent, not greyed out and not linked to a stub (ROUTE_MAP.md §5.2).
    const deferred = [
      '/quran',
      '/hadith',
      '/learn',
      // `/library` is delivered by Phase 8 and its scholarly and periodical
      // surfaces by Phase 9. Phase 15's collections are still absent, and stay
      // asserted absent.
      '/library/collections',
      // `/watch` and `/listen` are delivered by Phases 10 and 11; galleries
      // remain deferred to Phase 12.
      '/watch/audio',
      '/watch/galleries',
      '/fatwa',
      // `/news` is delivered by Phase 13 and `/events` by Phase 14; the
      // newsletter is not, and stays asserted absent.
      '/newsletter',
      // `/global` is delivered by Phase 16. Local Events (Phase 14) live under
      // each Centre, so no `/global/events` exists to be linked.
      '/global/events',
      // `/search` and `/topics` are delivered by Phase 17, and are asserted
      // present below.
      '/donate',
      '/membership',
      '/people',
      '/collections',
    ];

    for (const path of ['/en', '/en/explore', '/en/sitemap', '/en/legal/terms']) {
      await page.goto(path);

      const hrefs = await page
        .getByRole('link')
        .evaluateAll((links) =>
          links.map((link) => (link as HTMLAnchorElement).getAttribute('href') ?? ''),
        );

      for (const delivered of [
        '/contact',
        '/help',
        '/feedback',
        '/library/articles',
        // Phase 8: the Library entry point is in the primary navigation.
        '/library',
        // Phase 17: search in the primary navigation, the topic browser in the
        // footer.
        '/search',
        '/topics',
        // Watch covers both video and audio in the primary navigation.
        '/watch',
        // Phase 16: the Global Network in the primary navigation and Find a
        // Centre in the utility navigation.
        '/global',
        '/global/find-a-centre',
      ]) {
        expect(hrefs, `${path} exposes delivered ${delivered}`).toContain(
          `/en${delivered}`,
        );
      }

      if (path === '/en/sitemap') {
        expect(hrefs, 'sitemap exposes Listen').toContain('/en/listen');
      }

      for (const href of hrefs) {
        for (const domain of deferred) {
          expect(href, `${path} links to ${href}`).not.toBe(`/en${domain}`);
        }
      }
    }

    await page.goto('/en/watch');
    await expect(page.locator('main a[href="/en/listen"]')).toHaveCount(1);
  });

  test('every link on every public page resolves', async ({ page }) => {
    // The blanket check. Dead navigation is the failure this phase is most
    // exposed to, and it is cheap to make impossible rather than unlikely.
    const seen = new Set<string>();

    for (const path of PUBLIC_PATHS) {
      await page.goto(`/en${path}`);

      const hrefs = await page
        .getByRole('link')
        .evaluateAll((links) =>
          links.map((link) => (link as HTMLAnchorElement).getAttribute('href') ?? ''),
        );

      for (const href of hrefs) {
        if (href === '' || href.startsWith('#') || seen.has(href)) continue;
        seen.add(href);

        const response = await page.request.get(href);
        expect(response.status(), `${path} -> ${href}`).toBe(200);
      }
    }

    expect(seen.size).toBeGreaterThan(20);
  });

  test('keeps the language switcher on the route it switches from', async ({ page }) => {
    await page.goto('/en/explore/about/vision');

    await page.getByRole('link', { name: 'اردو' }).click();
    await page.waitForURL('**/ur/explore/about/vision');

    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');

    const preference = (await page.context().cookies()).find(
      ({ name }) => name === 'NEXT_LOCALE',
    );

    expect(preference?.value).toBe('ur');
    expect(preference?.path).toBe('/');
    expect(preference?.sameSite).toBe('Lax');
    expect(preference?.secure).toBe(true);
    expect(preference?.httpOnly).toBe(false);
    expect(preference?.expires ?? 0).toBeGreaterThan(Date.now() / 1_000);

    // The stored value participates in the documented resolution order when
    // the locale segment is absent, but it grants no private route access.
    await page.goto('/');
    await page.waitForURL('**/ur');
  });

  test('links My Minhaj to a route that works', async ({ page }) => {
    await page.goto('/en');

    await page.getByRole('link', { name: 'My Minhaj' }).first().click();

    // Signed out, the account entry point sends the visitor to sign in with a
    // return path — a working destination, not a dead end.
    await page.waitForURL(/\/en\/signin\?returnTo=/);
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
          await page.goto(`/${locale}${path}`);

          expect(await overflows(page), `${locale}${path} at ${width}px`).toBe(false);
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
  test.use({ reducedMotion: 'reduce' });

  test('suppresses transition and animation timing', async ({ page }) => {
    await page.goto('/en');

    const timings = await page.evaluate(() =>
      [...document.querySelectorAll('header *')].map((element) => {
        const style = globalThis.getComputedStyle(element);
        return {
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
          expect(Number.parseFloat(part), duration).toBeLessThan(0.02);
        }
      }
    }
  });

  test('still opens the menu, because motion was never the mechanism', async ({
    page,
  }) => {
    await page.goto('/en');

    await page.getByRole('button', { name: 'Explore' }).click();
    await expect(page.getByRole('button', { name: 'Explore' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
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
        await page.goto(`/${locale}${path}`);

        const robots = await page.locator('meta[name="robots"]').getAttribute('content');

        expect(robots, `${locale}${path}`).toContain('noindex');
      }
    }
  });

  test('asserts no organisation identity in structured data', async ({ page }) => {
    // No JSON-LD at all on a pre-adoption origin: a machine-readable claim to
    // be the organisation is exactly what must not be published from a
    // developer-controlled host (ROUTE_MAP.md §9.6).
    for (const path of ['/en', '/en/explore']) {
      await page.goto(path);

      await expect(page.locator('script[type="application/ld+json"]'), path).toHaveCount(
        0,
      );
    }
  });

  test('states the pre-adoption position where a visitor will see it', async ({
    page,
  }) => {
    await page.goto('/en');

    await expect(page.getByRole('contentinfo')).toContainText(
      'not currently commissioned',
    );
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
    for (const path of ['/en', '/en/signin', '/api/health']) {
      const response = await page.request.get(path);
      const headers = response.headers();

      // `/api/health` is not implemented in this phase; whatever it answers,
      // the headers must still be on it. A route that escapes the policy is
      // the route an attacker looks for.
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
    const headers = await headersOf(page, '/en');

    // Playwright joins repeated headers with a comma; two policies would both
    // apply, and the intersection is rarely what anybody intended.
    expect(headers['content-security-policy']?.split('default-src').length).toBe(2);
    expect(headers['x-frame-options']).toBe('DENY');
  });

  test('breaks nothing it protects', async ({ page }) => {
    const violations: string[] = [];

    page.on('console', (message) => {
      const text = message.text();
      if (/content security policy|refused to/i.test(text)) violations.push(text);
    });

    // The public shell, with its two client islands actually exercised, and an
    // authentication form — the surface most likely to be broken by
    // `form-action` or `connect-src`.
    await page.goto('/en');
    await page.getByRole('button', { name: 'Explore' }).click();
    await page.keyboard.press('Escape');

    await page.goto('/en/signin');
    await expect(
      page.getByRole('button', { name: 'Sign in', exact: true }),
    ).toBeVisible();

    // The stylesheet actually applied, which is how a `style-src` mistake
    // shows up: a page that renders unstyled and passes every other check.
    const background = await page.evaluate(
      () => globalThis.getComputedStyle(document.body).backgroundColor,
    );
    expect(background).not.toBe('rgba(0, 0, 0, 0)');

    expect(violations, violations.join('\n')).toEqual([]);
  });
});
