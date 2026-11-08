import { expect, localizedPath, test } from './support';

/**
 * THE HOME PAGE'S UNCONDITIONAL MODULES in a real browser (restored after R2,
 * owner direction 2026-11-08).
 *
 * What the home page shows whatever any parallel spec publishes: the hero's
 * search box and its way to Explore, the Quran and Hadith as two separate
 * sources that each say whether a text is available, the platform's six other
 * areas, and the organisation's seven Explore sections. Content modules
 * (news, Events, rulings, audio, topics…) render only when their owner has
 * something published, so they are proved by their own domains' specs.
 */

test.describe('the home page', () => {
  test('searches from the hero with a real GET form, in every locale', async ({
    page,
  }) => {
    for (const locale of ['en', 'ur', 'ar'] as const) {
      expect((await page.goto(localizedPath(locale, '')))?.status(), locale).toBe(200);
      const form = page.getByRole('main').locator('form[role="search"]');
      await expect(form, locale).toHaveCount(1);
      await expect(form).toHaveAttribute('method', 'get');
      await expect(form).toHaveAttribute('action', localizedPath(locale, '/search'));
      await expect(form.locator('input[name="q"]')).toHaveCount(1);
    }

    await page.goto('/');
    const search = page.getByRole('search', {
      name: 'Search the Quran, Hadith, the Library and more',
    });
    await search.getByRole('searchbox').fill('prayer');
    await search.getByRole('button', { name: 'Find' }).click();
    await page.waitForURL((url) => url.pathname === '/search');
    expect(new URL(page.url()).searchParams.get('q')).toBe('prayer');
  });

  test('always offers Explore, both sources, every area and every Explore section', async ({
    page,
  }) => {
    await page.goto('/');
    const main = page.getByRole('main');

    await expect(
      main.getByRole('link', { name: 'Explore the platform' }).first(),
    ).toHaveAttribute('href', '/explore');

    // The Quran and the Hadith: peers, always present, each saying in words
    // whether its text is available here.
    const sources = main.getByRole('region', { name: 'Quran and Hadith' });
    await expect(
      sources.getByRole('link', { name: 'Quran', exact: true }),
    ).toHaveAttribute('href', '/quran');
    await expect(
      sources.getByRole('link', { name: 'Hadith', exact: true }),
    ).toHaveAttribute('href', '/hadith');
    await expect(sources.getByRole('listitem')).toHaveCount(2);

    const areas = main.getByRole('region', { name: 'Across the platform' });
    for (const href of ['/learn', '/library', '/watch', '/fatwa', '/news', '/global'])
      await expect(areas.locator(`a[href="${href}"]`), href).toHaveCount(1);

    const explore = main.getByRole('region', { name: 'Explore', exact: true });
    await expect(explore.getByRole('listitem')).toHaveCount(7);
    for (const link of await explore.getByRole('link').all()) {
      const href = await link.getAttribute('href');
      expect(href).not.toBeNull();
      expect((await page.request.get(href!)).status(), href ?? '').toBe(200);
    }
  });
});
