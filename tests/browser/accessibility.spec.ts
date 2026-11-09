import { AxeBuilder } from '@axe-core/playwright';
import type { Page, TestInfo } from '@playwright/test';

import { expect, localizedPath, registerAndSignIn, test } from './support';

/**
 * AN AUTOMATED ACCESSIBILITY SMOKE (Rebaseline R2), against the production build.
 *
 * WHAT IT CLAIMS. Each representative page, in English (LTR) and Urdu (RTL), at
 * a desktop and a phone width, has no `serious` or `critical` violation of the
 * WCAG 2.0, 2.1 and 2.2 level A and AA rules axe-core can check automatically —
 * contrast, names and labels, landmarks, ARIA validity, language, target size
 * and the rest. Lesser findings (`moderate`, `minor`) are reported as test
 * annotations rather than failures, so they are visible without blocking.
 *
 * WHAT IT DOES NOT CLAIM. Automated rules find perhaps a third of real
 * accessibility problems. Keyboard journeys, focus management, reading order,
 * screen-reader announcement and reflow are proved by the behavioural specs
 * that own each surface (`shell.spec.ts`, `library.spec.ts`, …) and by the
 * manual acceptance of SECURITY_BASELINE.md §16; passing this is not a WCAG
 * 2.2 AA conformance claim (§16.3).
 *
 * WHAT IS ON THE PAGES. Whatever the run's database holds when the scan
 * reaches them: the other specs publish into it in parallel, so a landing may
 * be an honest empty state or a populated list, and the Quran landing may be in
 * either of its modes. Both are surfaces a visitor can meet, so both must pass;
 * the scan does not depend on which one it finds. Pages that need a seeded
 * record (a book's detail, a video) are left to their own specs.
 */

/** The WCAG levels the platform targets (SECURITY_BASELINE.md §16: WCAG 2.2 AA). */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** Impacts that fail the smoke; every other finding is annotated. */
const BLOCKING = new Set(['serious', 'critical']);

/** The public pages scanned, as locale-free paths. None needs an account. */
const PUBLIC_PATHS = [
  '',
  '/quran',
  // Quran Part 1: the reader entry — the honest unavailable state or the start
  // page, whichever the run's corpus gives; both must pass.
  '/quran/read',
  '/library',
  '/watch',
  '/news',
  '/collections',
  '/explore',
  '/search?q=minhaj',
  '/signin',
] as const;

const LOCALES = [
  ['en', 'ltr'],
  ['ur', 'rtl'],
] as const;

const WIDTHS = [
  ['desktop', { width: 1280, height: 800 }],
  ['phone', { width: 375, height: 812 }],
] as const;

/**
 * Loads `target`, proves it is the real page in the right language and
 * direction — a scan of an error page or a redirect would pass vacuously — and
 * returns the blocking violations, annotating the rest.
 */
async function scan(
  page: Page,
  testInfo: TestInfo,
  target: string,
  locale: string,
  direction: string,
): Promise<string[]> {
  const response = await page.goto(target);
  expect(response?.status(), target).toBe(200);
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.locator('html')).toHaveAttribute('dir', direction);
  await expect(page.getByRole('main').first()).toBeVisible();

  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

  const blocking: string[] = [];
  for (const violation of results.violations) {
    const where = violation.nodes
      .slice(0, 5)
      .map((node) => `      ${node.target.join(' ')}`)
      .join('\n');
    const summary = `${target} — [${violation.impact ?? 'unknown'}] ${violation.id}: ${violation.help} (${violation.nodes.length} node(s))`;

    if (BLOCKING.has(violation.impact ?? '')) blocking.push(`${summary}\n${where}`);
    else testInfo.annotations.push({ type: 'axe', description: summary });
  }
  return blocking;
}

for (const [label, viewport] of WIDTHS) {
  test.describe(`accessibility smoke at ${label} width`, () => {
    for (const [locale, direction] of LOCALES) {
      test(`the public pages in ${locale} have no serious or critical violation`, async ({
        page,
      }, testInfo) => {
        // Nine full-page scans in one test: give it the slow-test allowance.
        test.slow();
        await page.setViewportSize(viewport);

        const blocking: string[] = [];
        for (const path of PUBLIC_PATHS)
          blocking.push(
            ...(await scan(
              page,
              testInfo,
              localizedPath(locale, path),
              locale,
              direction,
            )),
          );

        // Every page is scanned before judging, so one run reports them all.
        expect(blocking, blocking.join('\n')).toEqual([]);
      });
    }

    test('My Minhaj, signed in, has no serious or critical violation in either direction', async ({
      page,
    }, testInfo) => {
      test.slow();
      await page.setViewportSize(viewport);
      await registerAndSignIn(page, 'accessibility');

      const blocking: string[] = [];
      for (const [locale, direction] of LOCALES)
        blocking.push(
          ...(await scan(
            page,
            testInfo,
            localizedPath(locale, '/my'),
            locale,
            direction,
          )),
        );

      expect(blocking, blocking.join('\n')).toEqual([]);
    });
  });
}
