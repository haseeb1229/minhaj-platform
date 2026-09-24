import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { repoRoot } from '../architecture/architecture-harness.ts';
import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';

import {
  accountIdFor,
  alertIn,
  baseUrl,
  expect,
  privilegedSession,
  registerAndSignIn,
  statusIn,
  test,
} from './support';

/**
 * PHASE 3B in a real browser.
 *
 * WHAT ONLY A BROWSER CAN SHOW. That an account with no taxonomy permission is
 * refused the route rather than shown a partial page; that a topic created in
 * one request is named in three languages across several more; that a cycle is
 * refused by the server and reported as something a person can act on; that the
 * mapping surface offers no control over content that does not exist; and that
 * all of it renders right-to-left in Urdu.
 *
 * THE EDITOR IS NOT AN ADMINISTRATOR, and that is the point of the setup. The
 * taxonomy permissions are granted through an ORDINARY CUSTOM ROLE, so what
 * these journeys prove is that the new permissions work on their own — not that
 * the platform administrator can do everything, which was never in doubt. It
 * also keeps this spec clear of the one-time bootstrap, which is a singleton
 * for the life of the database and belongs to `admin.spec.ts`.
 *
 * The role is created against the DATABASE because granting one through the
 * interface needs a bootstrapped administrator with a step-up grant — another
 * spec's subject, and a long detour through a journey this file is not about.
 * Nothing about the taxonomy surfaces themselves is set up that way: every
 * assertion below is the product.
 */

test.describe.configure({ mode: 'serial' });

let sql: SqlSession;

/**
 * The signed-in editor's cookie jar, reused by every journey below.
 *
 * Beside the administrator's, for the same reason: sign-in is rate limited per
 * account, so a suite that signed the editor in once per test would start
 * failing on the sixth for a reason unrelated to anything it proves.
 */
const EDITOR_STATE = path.join(repoRoot, 'test-results', 'browser-taxonomy-editor.json');

/** A client address outside the per-test space, for the setup navigation. */
const SETUP_CLIENT = '100.64.254.1';

/** A slug nothing else can collide with, and obviously a browser proof. */
function proofSlug(prefix: string): string {
  return `browser-${prefix}-${randomUUID().slice(0, 8)}`;
}

/**
 * THE polite status region that says a particular thing.
 *
 * NOT `.first()`. A taxonomy page carries several forms, each with its own
 * result region, so the first status after a successful mutation is rarely the
 * one being asserted. Asking for the region whose text is the one expected
 * keeps each assertion about its own form.
 */
function announced(page: Page, text: string) {
  return statusIn(page).filter({ hasText: text });
}

test.beforeAll(async ({ browser }) => {
  sql = await privilegedSession();

  const context = await browser.newContext({
    baseURL: baseUrl(),
    extraHTTPHeaders: { 'x-forwarded-for': SETUP_CLIENT },
  });
  const page = await context.newPage();

  const { email } = await registerAndSignIn(page, 'taxonomy');
  const accountId = await accountIdFor(sql, email);

  // An ordinary custom role holding exactly the two Taxonomy permissions.
  const roleId = randomUUID();
  const roleKey = `browser-taxonomy-${randomUUID().slice(0, 8)}`;

  await sql.query(`
    INSERT INTO [dbo].[Role] ([id], [key], [name], [description], [system])
    VALUES (N'${roleId}', N'${roleKey}', N'Browser taxonomy editor',
            N'Created by the Phase-3B browser proof.', 0);
  `);
  await sql.query(`
    INSERT INTO [dbo].[RolePermission] ([roleId], [permissionKey])
    VALUES (N'${roleId}', N'taxonomy.read'), (N'${roleId}', N'taxonomy.administer');
  `);
  await sql.query(`
    INSERT INTO [dbo].[RoleAssignment] ([id], [userId], [roleId], [grantedReason])
    VALUES (NEWID(), N'${accountId}', N'${roleId}', N'BROWSER-PROOF taxonomy editor');
  `);

  // Live authorisation, so the authority is in effect on the next request —
  // no re-sign-in, no session refresh. Proven here by navigating straight to a
  // route that was refused a moment ago.
  const response = await page.goto('/en/admin/taxonomy/topics');
  expect(response?.status()).toBe(200);

  await context.storageState({ path: EDITOR_STATE });
  await context.close();
});

test.afterAll(async () => {
  await sql?.close();
});

/* ===========================================================================
 * Refusals
 * ========================================================================= */

test.describe('taxonomy routes refuse an account without the permission', () => {
  test('answers 404 rather than confirming the route exists', async ({ page }) => {
    await registerAndSignIn(page, 'no-taxonomy');

    // 404, not 403: a 403 confirms the route exists and that somebody may use
    // it, which is a map of the platform's privileged shape handed to anyone
    // with an account (SECURITY_BASELINE.md §1.5).
    for (const route of ['topics', 'mapping', 'languages', 'tags']) {
      const response = await page.goto(`/en/admin/taxonomy/${route}`);
      expect(response?.status(), `/${route} must be 404`).toBe(404);
    }
  });

  test('sends a signed-out visitor to sign in, with a safe internal return path', async ({
    page,
  }) => {
    await page.goto('/en/admin/taxonomy/topics');
    await page.waitForURL(/\/en\/signin\?returnTo=/);

    // THE ADMINISTRATIVE SHELL REDIRECTS, not the page: a Next layout renders
    // before the route beneath it and cannot see the requested pathname, so the
    // Phase-2 shell sends a signed-out visitor to `/{locale}/admin` rather than
    // to the deep path they asked for. That is a navigational shortfall rather
    // than a security one — the target is a fixed internal path, so there is no
    // open redirect to be had — and it is the Phase-2 shell's behaviour, not
    // something this phase introduced or may quietly change.
    //
    // Asserted as it ACTUALLY IS, and asserted strictly: the return path is
    // locale-prefixed, internal, and carries no absolute URL.
    const returnTo = new URL(page.url()).searchParams.get('returnTo');

    expect(returnTo).toBe('/en/admin');
    expect(returnTo?.startsWith('//')).toBe(false);
    expect(returnTo).not.toMatch(/^https?:/);
  });
});

/* ===========================================================================
 * The editor's journeys
 * ========================================================================= */

test.describe('the taxonomy editor', () => {
  test.use({ storageState: EDITOR_STATE });

  test('sees the canonical taxonomy, and which topics still need translating', async ({
    page,
  }) => {
    await page.goto('/en/admin/taxonomy/topics');

    const main = page.getByRole('main');
    await expect(main).toContainText('Quran');
    await expect(main).toContainText('Contemporary Issues');
    await expect(main).toContainText('ahl-al-bayt');

    // The canonical seed is MARKED, so an editor can see which rows are
    // foundation data before trying to change one.
    await expect(main.getByText('Canonical').first()).toBeVisible();

    // And the translation gap is shown rather than hidden behind a silent
    // fallback — the whole reason the seed ships in English only.
    await expect(main.getByText(/Missing:/).first()).toBeVisible();
  });

  test('offers no slug, move or archive control for a canonical topic', async ({
    page,
  }) => {
    await page.goto('/en/admin/taxonomy/topics');
    await page
      .getByRole('row')
      .filter({ hasText: 'quran' })
      .getByRole('link', { name: 'Edit' })
      .click();

    const main = page.getByRole('main');
    await expect(main).toContainText('canonical top-level topics');

    // ABSENT FROM THE MARKUP, not disabled. A disabled control would be a
    // client-side rule, and this platform's rule is that the interface does not
    // offer what the server would refuse (SECURITY_BASELINE.md §3.4 rule 1).
    await expect(main.getByRole('button', { name: 'Change slug' })).toHaveCount(0);
    await expect(main.getByRole('button', { name: 'Move topic' })).toHaveCount(0);
    await expect(main.getByRole('button', { name: 'Archive topic' })).toHaveCount(0);

    // Translating it IS offered, because wording a subject in Urdu is
    // editorial work rather than a schema decision.
    await expect(
      main.getByRole('button', { name: 'Save this language' }),
    ).not.toHaveCount(0);
  });

  test('creates a topic, names it in Urdu, and reads it back in Urdu', async ({
    page,
  }) => {
    const slug = proofSlug('topic');

    await page.goto('/en/admin/taxonomy/topics');
    await page.getByLabel('Slug', { exact: true }).first().fill(slug);
    await page.getByLabel('Name (en)', { exact: true }).fill('Browser proof topic');
    await page
      .getByLabel('Description', { exact: true })
      .first()
      .fill('Created by the browser proof.');
    await page.getByRole('button', { name: 'Create topic' }).click();

    await expect(announced(page, 'topic was created')).toBeVisible();
    await expect(page.getByRole('main')).toContainText(slug);

    // Open it, and give it an Urdu name.
    await page
      .getByRole('row')
      .filter({ hasText: slug })
      .getByRole('link', { name: 'Edit' })
      .click();

    // Stable means every Topic, not only the canonical seed. Phase 3B has no
    // redirect or slug-history mechanism, so the create-time slug is displayed
    // as identity and is never offered as an edit.
    await expect(page.getByRole('button', { name: 'Change slug' })).toHaveCount(0);

    // The SECOND translation form on the page is `ur`: the editor renders one
    // per interface locale, in the order the platform declares them.
    const urduName = 'براؤزر کا ثبوت';
    await page.getByLabel('Name', { exact: true }).nth(1).fill(urduName);
    await page.getByRole('button', { name: 'Save this language' }).nth(1).click();
    await expect(announced(page, 'translation was saved')).toBeVisible();

    // THE URDU INTERFACE, showing the Urdu name. Both halves matter: the page
    // renders right-to-left, and the topic is named in the language being read
    // rather than falling back to English.
    await page.goto('/ur/admin/taxonomy/topics');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ur');
    await expect(page.getByRole('main')).toContainText(urduName);
    await expect(page.getByRole('main')).toContainText('موضوعات');
  });

  test('refuses a cycle, and says so in terms a person can act on', async ({ page }) => {
    const parentSlug = proofSlug('parent');
    const childSlug = proofSlug('child');

    // A parent at the root.
    await page.goto('/en/admin/taxonomy/topics');
    await page.getByLabel('Slug', { exact: true }).first().fill(parentSlug);
    await page.getByLabel('Name (en)', { exact: true }).fill('Cycle parent');
    await page.getByRole('button', { name: 'Create topic' }).click();
    await expect(announced(page, 'topic was created')).toBeVisible();

    // A child beneath it, created by browsing INTO the parent first — which is
    // also the proof that the hierarchy is navigable.
    await page
      .getByRole('row')
      .filter({ hasText: parentSlug })
      .getByRole('link', { name: 'Cycle parent' })
      .click();
    await expect(page.getByRole('navigation', { name: 'Topic hierarchy' })).toContainText(
      'Cycle parent',
    );

    await page.getByLabel('Slug', { exact: true }).first().fill(childSlug);
    await page.getByLabel('Name (en)', { exact: true }).fill('Cycle child');
    await page.getByRole('button', { name: 'Create topic' }).click();
    await expect(announced(page, 'topic was created')).toBeVisible();

    // Now try to move the PARENT beneath its own child.
    await page.goto('/en/admin/taxonomy/topics');
    await page
      .getByRole('row')
      .filter({ hasText: parentSlug })
      .getByRole('link', { name: 'Edit' })
      .click();

    await page
      .getByLabel('Parent topic', { exact: true })
      .selectOption({ label: `Cycle child (${childSlug})` });
    await page.getByRole('button', { name: 'Move topic' }).click();

    await expect(
      alertIn(page).filter({ hasText: 'beneath one of its own descendants' }),
    ).toBeVisible();
  });

  test('administers a content language without touching the site languages', async ({
    page,
  }) => {
    await page.goto('/en/admin/taxonomy/languages');

    const main = page.getByRole('main');
    await expect(main).toContainText('content languages, not site languages');
    await expect(main).toContainText('اردو');

    const code = `qaa-x-${randomUUID().slice(0, 6)}`;
    await page.getByLabel('Code', { exact: true }).fill(code);
    await page
      .getByLabel('Name in English', { exact: true })
      .first()
      .fill('Proof tongue');
    await page
      .getByLabel('Name in its own language', { exact: true })
      .first()
      .fill('ثبوت');
    await page.getByRole('button', { name: 'Add language' }).click();

    await expect(announced(page, 'content language was added')).toBeVisible();
    await expect(main).toContainText(code);

    // ONE EDITOR AT A TIME, opened from the row. The listing shows the whole
    // catalogue; rendering a form set per row would be a page nobody can use
    // once an organisation publishes in thirty languages.
    await page
      .getByRole('row')
      .filter({ hasText: code })
      .getByRole('link', { name: 'Edit' })
      .click();

    await expect(main).toContainText(`Editing ${code}`);
    await page
      .getByLabel('Name in English', { exact: true })
      .last()
      .fill('Proof tongue, renamed');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(announced(page, 'content language was saved')).toBeVisible();

    // THE SITE LANGUAGES ARE UNCHANGED. The new content language creates no
    // route, whatever it is called.
    const response = await page.goto(`/${code}/admin/taxonomy/languages`);
    expect(response?.status()).toBe(404);
  });

  test('keeps tags visibly separate from topics', async ({ page }) => {
    await page.goto('/en/admin/taxonomy/tags');

    const main = page.getByRole('main');
    await expect(main).toContainText('Tags are not topics');

    // SCOPED TO THE CREATE FORM. Every row in the listing carries its own
    // "Label" field, so an unscoped lookup would fill the first tag's relabel
    // box and then assert about a tag it never created.
    const createForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Create tag' }),
    });

    const slug = proofSlug('tag');
    await createForm.getByLabel('Slug', { exact: true }).fill(slug);
    await createForm.getByLabel('Label', { exact: true }).fill('امن کانفرنس');
    await createForm.getByRole('button', { name: 'Create tag' }).click();

    await expect(announced(page, 'tag was created')).toBeVisible();
    await expect(main).toContainText(slug);

    // NO HIERARCHY OFFERED. A tag surface with a parent chooser would teach
    // editors to use tags where the canonical taxonomy is required.
    await expect(main.getByLabel('Parent topic')).toHaveCount(0);
    await expect(main.getByRole('button', { name: 'Move' })).toHaveCount(0);

    // Bounded search, and it finds what was just created.
    await page.getByLabel('Find a tag', { exact: true }).fill(slug);
    await page.getByRole('button', { name: 'Search tags' }).click();
    await expect(main).toContainText(slug);
  });

  test('shows typed topic relationships without a generic assignment control', async ({
    page,
  }) => {
    await page.goto('/en/admin/taxonomy/mapping');

    const main = page.getByRole('main');
    // Editorial's ArticleTopic and PageTopic (Phase 6), Library's WorkTopic
    // (Phase 8), and one junction per Phase-9 aggregate: Research,
    // ResearchPaper, Publication, Magazine, MagazineIssue and Encyclopedia —
    // and Media's VideoTopic (Phase 10), each enforced by real foreign keys at
    // both ends.
    await expect(main).toContainText(
      'The database enforces 10 typed topic-assignment relationships.',
    );
    await expect(main).toContainText(
      'Every detected relationship has real foreign keys at both ends.',
    );
    await expect(main).toContainText('How a new kind of content gets topics');

    // NO FORM AT ALL. A generic content picker here would be the polymorphic
    // reference DOMAIN_MODEL.md §6.2 prohibits, delivered as a feature.
    await expect(main.getByRole('button')).toHaveCount(0);
    await expect(main.getByRole('combobox')).toHaveCount(0);
    await expect(main.getByRole('textbox')).toHaveCount(0);
  });
});

/* ===========================================================================
 * Presentation
 * ========================================================================= */

test.describe('the taxonomy surfaces are usable', () => {
  test.use({ storageState: EDITOR_STATE });

  test('renders every surface right-to-left in Arabic', async ({ page }) => {
    for (const route of ['topics', 'mapping', 'languages', 'tags']) {
      await page.goto(`/ar/admin/taxonomy/${route}`);

      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
      // Translated, not the English fallback rendering under an Arabic `lang`.
      await expect(page.getByRole('main')).toContainText(/[؀-ۿ]/);
    }
  });

  test('gives every table a caption and column headers', async ({ page }) => {
    await page.goto('/en/admin/taxonomy/languages');

    const table = page.getByRole('table').first();
    await expect(table).toBeVisible();
    await expect(table.locator('caption')).toHaveCount(1);
    await expect(table.getByRole('columnheader')).not.toHaveCount(0);
  });

  test('is operable from the keyboard', async ({ page }) => {
    await page.goto('/en/admin/taxonomy/tags');

    await page.keyboard.press('Tab');
    const focused = page.locator(':focus');
    await expect(focused).toHaveCount(1);

    // A REAL control, not a div somebody made clickable — which looks identical
    // on screen and is unreachable by keyboard and screen reader alike.
    expect(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']).toContain(
      await focused.evaluate((element) => element.tagName),
    );
  });

  test('keeps the administrative tree out of search indexes', async ({ page }) => {
    const response = await page.goto('/en/admin/taxonomy/topics');
    expect(response?.status()).toBe(200);

    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/,
    );
  });
});
