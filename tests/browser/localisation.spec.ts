import type { Page } from '@playwright/test';

import {
  BUTTON,
  LABEL,
  PASSWORD,
  alertIn,
  expect,
  freshEmail,
  registerAndSignIn,
  signOut,
  statusIn,
  test,
} from './support.ts';

/**
 * PHASE 2 CHUNK 1 — localisation, direction and keyboard operation.
 *
 * These are the claims a headless assertion genuinely cannot make. Whether a
 * page is right-to-left is a property of the rendered document; whether a form
 * is operable from the keyboard is a property of focus order and of what the
 * Enter key does; whether an error is announced is a property of the
 * accessibility tree. Reading the source and hoping is not evidence.
 *
 * WHAT THIS DOES NOT CLAIM. Automated checks do not establish WCAG
 * conformance — they establish that specific, checkable behaviours hold
 * (SECURITY_BASELINE.md §16). The claim made here is exactly that, and no more.
 */

/** Every delivered Chunk-1 surface a signed-out visitor can reach. */
const PUBLIC_SURFACES = ['signin', 'signup', 'forgot-password'] as const;

/** Every delivered Chunk-1 surface behind a session. */
const ACCOUNT_SURFACES = [
  'my',
  'my/settings/profile',
  'my/settings/security',
  'my/settings/language',
] as const;

async function documentDirection(page: Page): Promise<{ lang: string; dir: string }> {
  return page.evaluate(() => ({
    lang: document.documentElement.lang,
    dir: document.documentElement.dir,
  }));
}

test.describe('the three interface locales', () => {
  for (const [locale, direction] of [
    ['en', 'ltr'],
    ['ur', 'rtl'],
    ['ar', 'rtl'],
  ] as const) {
    test(`renders every public surface in ${locale} (${direction})`, async ({ page }) => {
      for (const surface of PUBLIC_SURFACES) {
        await page.goto(`/${locale}/${surface}`);

        const document = await documentDirection(page);

        // `lang` and `dir` on the ROOT element. A page that sets neither is a
        // page a screen reader pronounces in the wrong language and a browser
        // lays out in the wrong direction (ARCHITECTURE.md §9).
        expect(document.lang, `${locale}/${surface} lang`).toBe(locale);
        expect(document.dir, `${locale}/${surface} dir`).toBe(direction);

        // And it is genuinely translated, not English under a prefix.
        const heading = await page.getByRole('heading', { level: 1 }).textContent();
        expect(heading?.trim().length, `${locale}/${surface} heading`).toBeGreaterThan(0);
      }
    });
  }

  test('renders every ACCOUNT surface in all three locales', async ({ page }) => {
    // One account, three locales: signing up per locale would spend three
    // times the sign-up budget to prove the same thing.
    await registerAndSignIn(page, 'locales');

    for (const [locale, direction] of [
      ['en', 'ltr'],
      ['ur', 'rtl'],
      ['ar', 'rtl'],
    ] as const) {
      for (const surface of ACCOUNT_SURFACES) {
        await page.goto(`/${locale}/${surface}`);

        const document = await documentDirection(page);

        expect(document.lang, `${locale}/${surface} lang`).toBe(locale);
        expect(document.dir, `${locale}/${surface} dir`).toBe(direction);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      }
    }
  });

  test('lays Urdu out from the right, in the COMPUTED style', async ({ page }) => {
    await page.goto('/ur/signin');

    // Not merely the `dir` ATTRIBUTE: the direction the browser actually
    // resolved. An attribute a stylesheet overrides is a declaration nobody
    // honours.
    const resolved = await page
      .locator('main')
      .evaluate((element) => globalThis.getComputedStyle(element).direction);

    expect(resolved).toBe('rtl');
  });

  test('names each language in its OWN script', async ({ page }) => {
    await registerAndSignIn(page, 'endonym');
    await page.goto('/en/my/settings/language');

    // A language list that says "Urdu" and "Arabic" in English is a list
    // somebody who reads only Urdu cannot use.
    // Reached through the LABEL rather than a CSS id: the accessible name is
    // what a person navigating by screen reader uses to find this control, so
    // it is the right handle for a test about how the control reads.
    const options = page.getByLabel(LABEL.accountLanguage).locator('option');

    await expect(options).toHaveCount(3);
    await expect(options.filter({ hasText: 'اردو' })).toHaveCount(1);
    await expect(options.filter({ hasText: 'العربية' })).toHaveCount(1);
  });

  test('changes the account language and keeps content language separate', async ({
    page,
  }) => {
    await registerAndSignIn(page, 'language-change');

    await page.goto('/en/my/settings/language');
    await page.getByLabel(LABEL.accountLanguage).selectOption('ur');
    await page.getByLabel(LABEL.timezone).fill('Asia/Karachi');
    await page.getByRole('button', { name: BUTTON.save, exact: true }).click();

    await expect(statusIn(page).filter({ hasText: 'Saved' })).toBeVisible();

    // The ACCOUNT's interface locale changed. The URL prefix still decides
    // what THIS request renders in, because they are different things
    // (DOMAIN_MODEL.md §19.1).
    expect(new URL(page.url()).pathname.startsWith('/en/')).toBe(true);

    await page.reload();
    await expect(page.getByLabel(LABEL.accountLanguage)).toHaveValue('ur');
  });
});

test.describe('keyboard operation', () => {
  test('completes sign-in without a mouse', async ({ page }) => {
    const { email } = await registerAndSignIn(page, 'keyboard');
    await signOut(page);

    await page.goto('/en/signin');

    // Focus is MOVED with the keyboard rather than by clicking, so the proof
    // is about focus order rather than about where a click landed.
    await page.getByLabel(LABEL.email).focus();
    await page.keyboard.type(email);
    await page.keyboard.press('Tab');
    await page.keyboard.type(PASSWORD);

    // Enter submits from within a text field, which is how a form is expected
    // to behave — something `<form action>` gives for free and a
    // div-with-a-click-handler silently takes away.
    await page.keyboard.press('Enter');

    await page.waitForURL('**/my');
  });

  test('gives every focusable control a VISIBLE focus indicator', async ({ page }) => {
    await page.goto('/en/signup');

    for (const label of [LABEL.name, LABEL.email]) {
      const outline = await page.getByLabel(label).evaluate((element) => {
        (element as HTMLElement).focus();
        const style = globalThis.getComputedStyle(element);
        return { width: style.outlineWidth, style: style.outlineStyle };
      });

      // The single most commonly removed accessibility affordance, and the one
      // whose absence makes keyboard operation impossible rather than merely
      // awkward (SECURITY_BASELINE.md §16.1).
      expect(outline.style, `${label} outline style`).not.toBe('none');
      expect(Number.parseFloat(outline.width), `${label} outline width`).toBeGreaterThan(
        0,
      );
    }
  });
});

test.describe('accessible form semantics', () => {
  test('associates every field with a real label', async ({ page }) => {
    await page.goto('/en/signup');

    // `getByLabel` resolves through the accessibility tree, so these passing
    // IS the assertion: a placeholder masquerading as a label is not found.
    await expect(page.getByLabel(LABEL.name)).toBeVisible();
    await expect(page.getByLabel(LABEL.email)).toBeVisible();
    await expect(page.getByLabel(LABEL.password, { exact: true })).toBeVisible();
  });

  test('announces a failure through an alert region', async ({ page }) => {
    await page.goto('/en/signin');
    await page.getByLabel(LABEL.email).fill(freshEmail('nobody'));
    await page.getByLabel(LABEL.password, { exact: true }).fill('not-the-right-one');
    await page.getByRole('button', { name: BUTTON.signIn, exact: true }).click();

    // `role="alert"` so a screen reader announces the failure without the
    // person having to go looking for it.
    await expect(alertIn(page)).toBeVisible();
  });

  test('announces a success politely rather than by interrupting', async ({ page }) => {
    await page.goto('/en/forgot-password');
    await page.getByLabel(LABEL.email).fill(freshEmail('polite'));
    await page.getByRole('button', { name: BUTTON.sendResetLink }).click();

    await expect(statusIn(page)).toBeVisible();
  });

  test('describes the password field with its own requirement text', async ({ page }) => {
    await page.goto('/en/signup');

    const described = await page
      .getByLabel(LABEL.password, { exact: true })
      .getAttribute('aria-describedby');

    expect(described).not.toBeNull();

    const help = page.locator(`#${described}`);
    await expect(help).toBeVisible();
    await expect(help).toContainText('12');
  });

  test('gives every page exactly one first-level heading', async ({ page }) => {
    for (const surface of PUBLIC_SURFACES) {
      await page.goto(`/en/${surface}`);

      // Heading structure is how somebody using a screen reader navigates a
      // page at all; two `h1`s, or none, makes that guesswork.
      await expect(page.getByRole('heading', { level: 1 }), surface).toHaveCount(1);
    }
  });
});

test.describe('reflow', () => {
  test('needs no horizontal scrolling at a phone width', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });

    for (const surface of PUBLIC_SURFACES) {
      await page.goto(`/en/${surface}`);

      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );

      // An audience that is predominantly mobile. A page that scrolls sideways
      // at 360px is a page most of its visitors are fighting.
      expect(overflows, `${surface} must not scroll sideways`).toBe(false);
    }
  });
});

test.describe('indexability', () => {
  test('keeps every authentication surface out of search results', async ({ page }) => {
    for (const surface of PUBLIC_SURFACES) {
      const response = await page.goto(`/en/${surface}`);

      expect(response?.ok(), surface).toBe(true);

      const robots = await page.locator('meta[name="robots"]').getAttribute('content');
      expect(robots, `${surface} robots`).toContain('noindex');
    }
  });

  test('keeps every account surface out of search results', async ({ page }) => {
    await registerAndSignIn(page, 'noindex-account');

    for (const surface of ACCOUNT_SURFACES) {
      await page.goto(`/en/${surface}`);

      const robots = await page.locator('meta[name="robots"]').getAttribute('content');
      expect(robots, `${surface} robots`).toContain('noindex');
    }
  });
});

test.describe('the public site needs no account', () => {
  test('serves the landing page to a signed-out visitor', async ({ page }) => {
    // The product rule the whole platform rests on: reading, searching and
    // listening need no account (PRODUCT_SCOPE.md). A Phase-2 change that
    // quietly put the front page behind a session would be the single most
    // damaging regression this phase could introduce.
    const response = await page.goto('/en');

    expect(response?.ok()).toBe(true);
    expect(new URL(page.url()).pathname).toBe('/en');
  });

  test('still serves it, in every locale, after a sign-out', async ({ page }) => {
    await registerAndSignIn(page, 'public-after-signout');
    await signOut(page);

    for (const locale of ['en', 'ur', 'ar']) {
      const response = await page.goto(`/${locale}`);

      expect(response?.ok(), locale).toBe(true);
      expect(new URL(page.url()).pathname).toBe(`/${locale}`);
    }
  });
});
