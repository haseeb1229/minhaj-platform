import type { Locator, Page } from '@playwright/test';

import { expect, localizedPath, test } from './support';

/**
 * VISUAL SNAPSHOTS of a few stable surfaces (Rebaseline R2) — OPT-IN, and not
 * yet a gate.
 *
 * WHY OPT-IN. A screenshot baseline is only comparable on the platform and
 * font stack that rendered it, so the baselines are LINUX renders (the CI
 * runner's), and no baseline is committed yet. Running this anywhere else, or
 * without baselines, would either fail for a reason unrelated to the product
 * or "pass" by writing a new baseline — so it SKIPS, visibly, unless it runs on
 * Linux with `MINHAJ_VISUAL_BASELINE` set. It becomes a gate only when Linux
 * baselines are committed AND the `Browser flows` job sets that variable;
 * until both happen, nothing here is claimed as a check.
 *
 * PRODUCING THE BASELINES. On a Linux host prepared like the `Browser flows`
 * job (the SQL Server container, `npm run db:generate`, `npm run build`,
 * `npm run test:browser:install`, the pinned NGINX image):
 *
 *   MINHAJ_VISUAL_BASELINE=1 npm run test:browser -- visual.spec.ts --update-snapshots
 *
 * then review every PNG under `tests/browser/__screenshots__/visual.spec.ts/`
 * as you would any diff, and commit them. A deliberate design change is
 * re-baselined the same way, in the commit that makes it.
 *
 * WHAT IS PHOTOGRAPHED, AND WHAT IS NOT. Only regions whose SIZE and content do
 * not depend on what the parallel specs publish: the phone header (its grouped
 * navigation lives in the Menu sheet), the footer's brand column, the words of
 * the home and Library heroes (their pictures and cover stacks are content),
 * the search empty state, and the sign-in form. The desktop navigation and the
 * footer's link groups follow live presence and change size as other specs
 * publish, so a screenshot of them would compare the run's timing, not the
 * design. Animations are stopped and reduced motion requested; every
 * screenshot waits for the self-hosted fonts.
 */

test.skip(
  process.platform !== 'linux',
  'Visual baselines are Linux renders; other platforms rasterise text differently.',
);
test.skip(
  !process.env['MINHAJ_VISUAL_BASELINE'],
  'Visual comparison runs only with MINHAJ_VISUAL_BASELINE set, once Linux baselines are committed (see this file’s header).',
);

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 375, height: 812 };

/** A query nothing in any run's database matches. */
const NO_MATCH = 'zqxjvwkp';

/** Opens `target` at `viewport` and waits until the page's fonts are settled. */
async function open(
  page: Page,
  target: string,
  viewport: { width: number; height: number },
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const response = await page.goto(target);
  expect(response?.status(), target).toBe(200);
  await page.evaluate(async () => {
    await globalThis.document.fonts.ready;
  });
}

/** The words of a page's hero: its heading, lede and actions, never its picture. */
function heroWords(page: Page): Locator {
  return page.getByRole('main').getByRole('heading', { level: 1 }).locator('xpath=..');
}

test.describe('visual snapshots', () => {
  test('the phone header, in both directions', async ({ page }) => {
    for (const locale of ['en', 'ur'] as const) {
      await open(page, localizedPath(locale, `/search?q=${NO_MATCH}`), PHONE);
      await expect(page.locator('header').first()).toHaveScreenshot(
        `header-phone-${locale}.png`,
      );
    }
  });

  test('the footer’s brand column', async ({ page }) => {
    await open(page, localizedPath('en', `/search?q=${NO_MATCH}`), DESKTOP);
    await expect(
      page.locator('#footer-channels').locator('xpath=../..'),
    ).toHaveScreenshot('footer-brand-en.png');
  });

  test('the home and Library heroes', async ({ page }) => {
    await open(page, localizedPath('en', ''), DESKTOP);
    await expect(heroWords(page)).toHaveScreenshot('home-hero-en.png');

    await open(page, localizedPath('en', '/library'), DESKTOP);
    await expect(heroWords(page)).toHaveScreenshot('library-hero-en.png');
  });

  test('the search empty state, in both directions', async ({ page }) => {
    for (const locale of ['en', 'ur'] as const) {
      await open(page, localizedPath(locale, `/search?q=${NO_MATCH}`), DESKTOP);
      await expect(
        page.getByRole('main').locator('div.border-dashed').first(),
      ).toHaveScreenshot(`search-empty-${locale}.png`);
    }
  });

  test('the sign-in form on a phone, right to left', async ({ page }) => {
    await open(page, localizedPath('ur', '/signin'), PHONE);
    await expect(page.getByRole('main')).toHaveScreenshot('signin-phone-ur.png');
  });
});
