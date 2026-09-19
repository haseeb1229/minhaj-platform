import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { repoRoot } from '../architecture/architecture-harness.ts';
import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';

import {
  accountIdFor,
  baseUrl,
  expect,
  privilegedSession,
  registerAndSignIn,
  statusIn,
  test,
} from './support';

/**
 * PHASE 5 in a real browser.
 *
 * WHAT ONLY A BROWSER CAN SHOW. That the contributor profile renders for a
 * visitor who has never signed in and renders IDENTICALLY for one who has; that
 * a withdrawn contributor is a 404 rather than a page with a banner; that the
 * two author aliases answer 301 and land in one hop; that a missing translation
 * produces a visible notice rather than a silent substitution; that an Urdu
 * profile is laid out right-to-left; and that an operator holding
 * `people.read` and nothing else is shown no control they cannot use.
 *
 * THE EDITOR IS NOT AN ADMINISTRATOR, and that is the point of the setup. The
 * People permissions are granted through an ORDINARY CUSTOM ROLE, so what these
 * journeys prove is that the two new permissions work on their own — not that
 * the platform administrator can do everything, which was never in doubt. It
 * also keeps this spec clear of the one-time bootstrap, which is a singleton for
 * the life of the database and belongs to `admin.spec.ts`.
 *
 * The roles are created against the DATABASE because granting one through the
 * interface needs a bootstrapped administrator with a step-up grant — another
 * spec's subject, and a long detour through a journey this file is not about.
 * Nothing about the People surfaces themselves is set up that way: every
 * assertion below is the product.
 *
 * THE PUBLIC FIXTURES ARE WRITTEN DIRECTLY, for a different reason. Creating
 * them through the administrative UI would make every public assertion depend
 * on the admin journeys passing first, so a single broken form would report
 * fifteen failures with one cause. The admin journeys create their own records
 * through the interface; the public journeys read records whose state is known.
 *
 * NOBODY REAL APPEARS HERE. Every contributor carries this run's identifier and
 * the localised names are the words for "proof" in each script — no invented
 * scholar, no invented qualification, and no religious standing attributed to
 * anyone (OPEN_DECISIONS.md §6.3, SECURITY_BASELINE.md §18.1).
 */

test.describe.configure({ mode: 'serial' });

let sql: SqlSession;

/** The signed-in editor's cookie jar, reused by every administrative journey. */
const EDITOR_STATE = path.join(repoRoot, 'test-results', 'browser-people-editor.json');

/** A reader who holds `people.read` and nothing else. */
const READER_STATE = path.join(repoRoot, 'test-results', 'browser-people-reader.json');

/** Client addresses outside the per-test space, for the setup navigations. */
const EDITOR_CLIENT = '100.64.253.1';
const READER_CLIENT = '100.64.253.2';

/** The run's public fixtures, filled in by `beforeAll`. */
const FIXTURE = {
  /** Published, en + ur, with an author facet and an archived scholar facet. */
  published: '',
  /** Published, Urdu-original only — the fallback and RTL case. */
  urduOnly: '',
  /** A draft: publicly invisible. */
  draft: '',
  /** Archived: publicly invisible, and previously visible. */
  archived: '',
  /** The editor's own account, for the link journeys. */
  editorAccountId: '',
};

/** Localised proof names, in each script. Not anybody's name. */
const NAME = {
  en: 'Recovery proof contributor',
  ur: 'براؤزر ثبوت معاون',
} as const;

function proofSlug(prefix: string): string {
  return `browser-people-${prefix}-${randomUUID().slice(0, 8)}`;
}

/**
 * THE polite status region that says a particular thing.
 *
 * NOT `.first()`. The contributor editor carries many forms, each with its own
 * result region, so the first status after a successful mutation is rarely the
 * one being asserted.
 */
function announced(page: Page, text: string) {
  return statusIn(page).filter({ hasText: text });
}

/**
 * THE language-fallback notice on a contributor profile, and nothing else.
 *
 * Matched inside `main` and by its own wording. The notice is an informational
 * `Alert`, which renders `role="status"` — polite rather than interrupting —
 * and both the public shell and this page carry status regions, so a bare role
 * match would assert something about whichever one happened to come first.
 */
function languageNotice(page: Page) {
  return page
    .getByRole('main')
    .getByRole('status')
    .filter({ hasText: /not been translated|ترجمہ نہیں|لم تُترجم/ });
}

/** Grants one account a custom role holding exactly the named permissions. */
async function grantRole(
  accountId: string,
  label: string,
  permissions: readonly string[],
): Promise<void> {
  const roleId = randomUUID();
  const roleKey = `browser-people-${label}-${randomUUID().slice(0, 8)}`;

  await sql.query(`
    INSERT INTO [dbo].[Role] ([id], [key], [name], [description], [system])
    VALUES (N'${roleId}', N'${roleKey}', N'Browser people ${label}',
            N'Created by the Phase-5 browser proof.', 0);
  `);
  for (const permission of permissions) {
    await sql.query(`
      INSERT INTO [dbo].[RolePermission] ([roleId], [permissionKey])
      VALUES (N'${roleId}', N'${permission}');
    `);
  }
  await sql.query(`
    INSERT INTO [dbo].[RoleAssignment] ([id], [userId], [roleId], [grantedReason])
    VALUES (NEWID(), N'${accountId}', N'${roleId}', N'BROWSER-PROOF people ${label}');
  `);
}

/** Writes one contributor directly, in a known state. */
async function seedContributor(input: {
  readonly slug: string;
  readonly primaryLocale: 'en' | 'ur';
  readonly status: 'draft' | 'published' | 'archived';
  readonly translations: readonly { locale: 'en' | 'ur'; name: string }[];
  readonly facets?: readonly { kind: string; status: string }[];
  readonly variant?: string;
}): Promise<void> {
  const personId = randomUUID();

  await sql.query(`
    INSERT INTO [dbo].[Person] ([id], [slug], [primaryLocale], [status])
    VALUES (N'${personId}', N'${input.slug}', N'${input.primaryLocale}', N'${input.status}');
  `);

  for (const translation of input.translations) {
    await sql.query(`
      INSERT INTO [dbo].[PersonTranslation] ([personId], [locale], [name])
      VALUES (N'${personId}', N'${translation.locale}', N'${translation.name}');
    `);
  }

  if (input.variant !== undefined) {
    await sql.query(`
      INSERT INTO [dbo].[PersonNameVariant] ([id], [personId], [locale], [value], [normalised])
      VALUES (NEWID(), N'${personId}', N'${input.primaryLocale}', N'${input.variant}',
              N'${input.variant.toLowerCase()}');
    `);
  }

  for (const facet of input.facets ?? []) {
    await sql.query(`
      INSERT INTO [dbo].[${facet.kind}] ([id], [personId], [status])
      VALUES (NEWID(), N'${personId}', N'${facet.status}');
    `);
  }
}

test.beforeAll(async ({ browser }) => {
  sql = await privilegedSession();

  // ---- the editor, holding both People permissions -------------------------
  const editorContext = await browser.newContext({
    baseURL: baseUrl(),
    extraHTTPHeaders: { 'x-forwarded-for': EDITOR_CLIENT },
  });
  const editorPage = await editorContext.newPage();

  const { email: editorEmail } = await registerAndSignIn(editorPage, 'people-editor');
  FIXTURE.editorAccountId = await accountIdFor(sql, editorEmail);
  await grantRole(FIXTURE.editorAccountId, 'editor', [
    'people.read',
    'people.administer',
  ]);

  // Live authorisation, so the authority is in effect on the next request — no
  // re-sign-in and no session refresh. Proven by navigating straight to a route
  // that was refused a moment ago.
  const editorResponse = await editorPage.goto('/en/admin/people/persons');
  expect(editorResponse?.status()).toBe(200);

  await editorContext.storageState({ path: EDITOR_STATE });
  await editorContext.close();

  // ---- the reader, holding `people.read` alone -----------------------------
  const readerContext = await browser.newContext({
    baseURL: baseUrl(),
    extraHTTPHeaders: { 'x-forwarded-for': READER_CLIENT },
  });
  const readerPage = await readerContext.newPage();

  const { email: readerEmail } = await registerAndSignIn(readerPage, 'people-reader');
  await grantRole(await accountIdFor(sql, readerEmail), 'reader', ['people.read']);

  const readerResponse = await readerPage.goto('/en/admin/people/persons');
  expect(readerResponse?.status()).toBe(200);

  await readerContext.storageState({ path: READER_STATE });
  await readerContext.close();

  // ---- the public fixtures -------------------------------------------------
  FIXTURE.published = proofSlug('published');
  FIXTURE.urduOnly = proofSlug('urdu');
  FIXTURE.draft = proofSlug('draft');
  FIXTURE.archived = proofSlug('archived');

  await seedContributor({
    slug: FIXTURE.published,
    primaryLocale: 'en',
    status: 'published',
    translations: [
      { locale: 'en', name: NAME.en },
      { locale: 'ur', name: NAME.ur },
    ],
    // THREE FACETS IN THREE STATES: an active author, an active teacher, and an
    // archived scholar. Only the two active ones may appear publicly.
    facets: [
      { kind: 'AuthorProfile', status: 'active' },
      { kind: 'TeacherProfile', status: 'active' },
      { kind: 'ScholarProfile', status: 'archived' },
    ],
    variant: 'Proof Alternative Spelling',
  });

  // A HISTORICAL CONTRIBUTOR: Urdu-original, no account, author facet only.
  await seedContributor({
    slug: FIXTURE.urduOnly,
    primaryLocale: 'ur',
    status: 'published',
    translations: [{ locale: 'ur', name: NAME.ur }],
    facets: [{ kind: 'AuthorProfile', status: 'active' }],
  });

  await seedContributor({
    slug: FIXTURE.draft,
    primaryLocale: 'en',
    status: 'draft',
    translations: [{ locale: 'en', name: NAME.en }],
  });

  await seedContributor({
    slug: FIXTURE.archived,
    primaryLocale: 'en',
    status: 'archived',
    translations: [{ locale: 'en', name: NAME.en }],
  });
});

test.afterAll(async () => {
  await sql?.close();
});

/* ===========================================================================
 * The public contributor profile
 * ========================================================================= */

test.describe('the public contributor profile', () => {
  test('renders for a visitor who has never signed in', async ({ page }) => {
    const response = await page.goto(`/en/people/${FIXTURE.published}`);

    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(NAME.en);

    // NO SESSION WAS CREATED BY READING IT. A public page that set a cookie
    // would be a public page a shared cache cannot hold.
    expect(await page.context().cookies()).toHaveLength(0);
  });

  test('shows only the facets that are genuinely active', async ({ page }) => {
    await page.goto(`/en/people/${FIXTURE.published}`);
    const main = page.getByRole('main');

    await expect(main).toContainText('Author');
    await expect(main).toContainText('Teacher');
    // The scholar facet is ARCHIVED and must not appear at all — not greyed
    // out, not labelled "archived": absent.
    await expect(main).not.toContainText('Scholar');
  });

  test('shows the alternative spellings an administrator entered', async ({ page }) => {
    await page.goto(`/en/people/${FIXTURE.published}`);

    await expect(page.getByRole('main')).toContainText('Proof Alternative Spelling');
  });

  test('serves the same content to a signed-in and a signed-out visitor', async ({
    page,
    browser,
    clientAddress,
  }) => {
    // A REAL session, created through the product, then used to fetch the
    // contributor page. If anything in that page read the session, what that
    // visitor reads would differ from what everybody else reads
    // (ARCHITECTURE.md §8.1).
    await registerAndSignIn(page, 'people-cache');

    const cookies = await page.context().cookies();
    expect(cookies.length, 'the journey must produce a real session').toBeGreaterThan(0);

    const anonymous = await browser.newContext({
      extraHTTPHeaders: { 'x-forwarded-for': clientAddress },
    });
    const base = test.info().project.use.baseURL;

    /**
     * THE READABLE TEXT of a response, and why the MARKUP is not compared.
     *
     * A contributor profile is STREAMED. React flushes a suspense boundary's
     * fallback first and appends the resolved content later, inside a hidden
     * container that a reveal script then moves into place — so WHERE a given
     * element sits in the raw HTML depends on whether the database read
     * finished before the shell flushed. Two ANONYMOUS responses differ that
     * way, which means any markup-level comparison would be asserting that the
     * framework is deterministic rather than that this page ignores a session.
     *
     * The TEXT is not affected: whichever container it arrives in, a completed
     * response carries every word exactly once. That is also the thing the rule
     * is actually about — what a visitor reads must not depend on who they are.
     *
     * The comparison is proved non-vacuous below: the text is checked to be
     * substantial and to contain the contributor's name, and two anonymous
     * responses are compared to each other first.
     */
    const textOf = (body: string): string =>
      body
        .replaceAll(/<script[\s\S]*?<\/script>/g, ' ')
        .replaceAll(/<style[\s\S]*?<\/style>/g, ' ')
        // `<title>` goes too, for the same streaming reason: the document's
        // metadata is resolved beside the database read and lands in `<head>`
        // or is flushed later depending on which finished first, so its TEXT
        // appears at a different point — or, mid-stream, not yet at all. What
        // the title says is proved by the SEO suite, against the metadata
        // function rather than against a race.
        .replaceAll(/<title[\s\S]*?<\/title>/g, ' ')
        .replaceAll(/<[^>]*>/g, ' ')
        .replaceAll(/\s+/g, ' ')
        .trim();

    for (const slug of [FIXTURE.published, FIXTURE.urduOnly]) {
      const url = `${base}/en/people/${slug}`;

      const first = await anonymous.request.get(url);
      const second = await anonymous.request.get(url);
      const signedIn = await page.context().request.get(url);

      expect(first.status(), slug).toBe(200);
      expect(signedIn.status(), slug).toBe(200);

      const anonymousText = textOf(await first.text());

      // The content is really there, so a comparison of two blanks cannot pass.
      expect(anonymousText.length, slug).toBeGreaterThan(200);
      expect(anonymousText, slug).toContain('Contributions');

      // TWO ANONYMOUS RESPONSES AGREE, which is what makes the comparison
      // below meaningful.
      expect(textOf(await second.text()), `${slug}: two anonymous responses`).toBe(
        anonymousText,
      );

      // AND THE SIGNED-IN REQUEST RECEIVES THE SAME CONTENT.
      expect(textOf(await signedIn.text()), `${slug}: signed in vs signed out`).toBe(
        anonymousText,
      );
    }

    await anonymous.close();
  });

  test('echoes no session material anywhere in the response', async ({ page }) => {
    // THE OTHER HALF, and one a content comparison could never make: that
    // nothing about the REQUESTING visitor is sent back. Asserted over the
    // whole response rather than over the readable text, because a leak into a
    // script payload or a meta tag would be a leak just the same.
    await registerAndSignIn(page, 'people-no-session-echo');

    const cookies = await page.context().cookies();
    const sessionCookie = cookies[0];
    expect(sessionCookie, 'the journey must produce a real session').toBeDefined();

    const base = test.info().project.use.baseURL;
    const response = await page
      .context()
      .request.get(`${base}/en/people/${FIXTURE.published}`);
    const body = await response.text();

    expect(body).not.toContain(sessionCookie!.value);
    expect(body).not.toContain(`${sessionCookie!.name}=`);
    expect(body).not.toContain(FIXTURE.editorAccountId);

    // NO EMAIL ADDRESS, matched by SHAPE rather than by a bare `@`: a stylesheet
    // carries `@media` and the Flight payload carries `@` in other roles, so the
    // character alone would be a false positive rather than a finding.
    expect(body).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);

    // And none of the privilege vocabulary a public page must never carry.
    expect(body.toLowerCase()).not.toContain('roleassignment');
    expect(body.toLowerCase()).not.toContain('canteach');
    expect(body.toLowerCase()).not.toContain('people.administer');
  });

  test('varies no public response header on a real session cookie', async ({
    page,
    browser,
    clientAddress,
  }) => {
    // The headers half, which the rendered DOM cannot show. `set-cookie` is the
    // one that would matter most: a public page that issued or refreshed
    // anything per visitor could not be held by a shared cache.
    await registerAndSignIn(page, 'people-cache-headers');

    const anonymous = await browser.newContext({
      extraHTTPHeaders: { 'x-forwarded-for': clientAddress },
    });
    const base = test.info().project.use.baseURL;
    const url = `${base}/en/people/${FIXTURE.published}`;

    const signedIn = await page.context().request.get(url);
    const signedOut = await anonymous.request.get(url);

    expect(signedIn.status()).toBe(200);
    expect(signedOut.status()).toBe(200);

    for (const header of ['cache-control', 'content-type', 'vary']) {
      expect(signedIn.headers()[header], header).toBe(signedOut.headers()[header]);
    }

    expect(signedIn.headers()['set-cookie']).toBeUndefined();
    expect(signedOut.headers()['set-cookie']).toBeUndefined();

    await anonymous.close();
  });

  test('sets no locale preference cookie on an ordinary visit', async ({ page }) => {
    // A Phase-4 contract: only an explicit language-switch action persists a
    // preference. An ordinary locale-prefixed response must not.
    await page.goto(`/ur/people/${FIXTURE.published}`);

    const preference = (await page.context().cookies()).find(
      ({ name }) => name === 'NEXT_LOCALE',
    );
    expect(preference).toBeUndefined();
  });

  test('answers 404 for a draft, an archived record and an unknown slug', async ({
    page,
  }) => {
    for (const slug of [FIXTURE.draft, FIXTURE.archived, 'no-such-contributor']) {
      const response = await page.goto(`/en/people/${slug}`);
      expect(response?.status(), slug).toBe(404);
    }
  });
});

/* ===========================================================================
 * Localisation and the language notice
 * ========================================================================= */

test.describe('a contributor reads in every interface language', () => {
  test('renders the chrome in the requested language in all three locales', async ({
    page,
  }) => {
    for (const locale of ['en', 'ur', 'ar'] as const) {
      const response = await page.goto(`/${locale}/people/${FIXTURE.published}`);
      expect(response?.status(), locale).toBe(200);

      await expect(page.locator('html')).toHaveAttribute('lang', locale);
    }
  });

  test('lays an Urdu page out right-to-left', async ({ page }) => {
    await page.goto(`/ur/people/${FIXTURE.urduOnly}`);

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(NAME.ur);
  });

  test('shows the genuine translation when one exists', async ({ page }) => {
    // The same contributor, read in two languages, showing two stored names and
    // NO language notice in either.
    //
    // SCOPED TO THE NOTICE ITSELF. The notice is an `Alert` of informational
    // tone, which renders `role="status"` rather than `role="alert"` — polite
    // rather than interrupting — and the public shell carries its own status
    // regions. Matching by role alone would assert something about the shell.
    await page.goto(`/en/people/${FIXTURE.published}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(NAME.en);
    await expect(languageNotice(page)).toHaveCount(0);

    await page.goto(`/ur/people/${FIXTURE.published}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(NAME.ur);
    await expect(languageNotice(page)).toHaveCount(0);
  });

  test('shows a VISIBLE notice when the content is in another language', async ({
    page,
  }) => {
    // ROUTE_MAP.md §9.3: the chrome stays in the requested locale, the content
    // is shown in a language that exists, and a visible notice says so. Never a
    // generated translation and never a silent substitution.
    await page.goto(`/en/people/${FIXTURE.urduOnly}`);

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(NAME.ur);

    const notice = languageNotice(page);
    await expect(notice).toHaveCount(1);
    await expect(notice).toBeVisible();
    // It names BOTH languages: the one asked for and the one shown.
    await expect(notice).toContainText('ur');
  });

  test('marks the contributor name with its own language and direction', async ({
    page,
  }) => {
    // An Urdu name inside an English page is marked `lang="ur"` and `dir` is
    // resolved from the text, so it renders right-to-left without flipping the
    // page around it.
    await page.goto(`/en/people/${FIXTURE.urduOnly}`);

    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toHaveAttribute('lang', 'ur');
    await expect(heading).toHaveAttribute('dir', 'auto');
  });
});

/* ===========================================================================
 * The two legacy aliases
 * ========================================================================= */

test.describe('the author aliases redirect once, permanently', () => {
  for (const alias of ['authors', 'library/authors']) {
    test(`/${alias}/{slug} answers 301 to the canonical profile`, async ({ page }) => {
      const base = test.info().project.use.baseURL;

      // NOT FOLLOWED, so the status itself is observed rather than inferred
      // from where the browser ended up.
      const response = await page.request.get(
        `${base}/en/${alias}/${FIXTURE.published}`,
        { maxRedirects: 0 },
      );

      expect(response.status()).toBe(301);
      expect(response.headers()['location']).toBe(`/en/people/${FIXTURE.published}`);
      // A legacy alias is never indexable, and a redirect carries no document
      // for a `<meta>` to live in.
      expect(response.headers()['x-robots-tag']).toContain('noindex');
    });

    test(`/${alias}/{slug} preserves the locale`, async ({ page }) => {
      const base = test.info().project.use.baseURL;

      const response = await page.request.get(
        `${base}/ur/${alias}/${FIXTURE.published}`,
        { maxRedirects: 0 },
      );

      expect(response.status()).toBe(301);
      expect(response.headers()['location']).toBe(`/ur/people/${FIXTURE.published}`);
    });

    test(`/${alias}/{slug} lands on the profile in ONE hop`, async ({ page }) => {
      const response = await page.goto(`/en/${alias}/${FIXTURE.published}`);

      expect(response?.status()).toBe(200);
      expect(new URL(page.url()).pathname).toBe(`/en/people/${FIXTURE.published}`);

      // EXACTLY ONE REDIRECT. A chain would mean the alias pointed at something
      // that pointed somewhere else, which wastes a crawl and is the duplicate
      // -URL outcome the canonical rule exists to prevent.
      const chain: string[] = [];
      let hop = response?.request().redirectedFrom() ?? null;
      while (hop !== null) {
        chain.push(hop.url());
        hop = hop.redirectedFrom();
      }
      expect(chain).toHaveLength(1);
    });

    test(`/${alias}/{slug} answers 404 rather than redirecting into one`, async ({
      page,
    }) => {
      // A 301 into a page that then 404s is a redirect chain ending in nothing.
      // The resolver can determine absence, so it does.
      const base = test.info().project.use.baseURL;

      for (const slug of [FIXTURE.draft, FIXTURE.archived, 'no-such-contributor']) {
        const response = await page.request.get(`${base}/en/${alias}/${slug}`, {
          maxRedirects: 0,
        });
        expect(response.status(), `${alias}/${slug}`).toBe(404);
      }
    });
  }
});

/* ===========================================================================
 * Indexing posture and structured data
 * ========================================================================= */

test.describe('the pre-adoption posture holds on the contributor profile', () => {
  test('emits noindex and no canonical link', async ({ page }) => {
    // The suite runs the application in its deployed posture, which is
    // pre-adoption: the whole site is `noindex` and advertises no sitemap
    // (ROUTE_MAP.md §9.5). The indexable half is proved in the SEO suite, where
    // the posture can be switched in-process.
    await page.goto(`/en/people/${FIXTURE.published}`);

    // NOT SCOPED TO `head`, which is the same streaming detail the content
    // comparison above had to account for: React resolves this page's metadata
    // beside its database read and hoists the elements once both are done, so
    // an assertion tied to their position would be timing-dependent. The
    // established shell proof matches them document-wide for the same reason.
    const robots = await page.locator('meta[name="robots"]').getAttribute('content');
    expect(robots).toContain('noindex');
    expect(robots).toContain('nofollow');

    expect(await page.locator('link[rel="canonical"]').count()).toBe(0);
    expect(await page.locator('link[rel="alternate"][hreflang]').count()).toBe(0);
  });

  test('publishes no structured data while the deployment may not be indexed', async ({
    page,
  }) => {
    // A machine-readable claim about a real person, published from a
    // developer-controlled origin nobody may index, is exactly the
    // over-claiming §9.6 warns produces manual action penalties.
    await page.goto(`/en/people/${FIXTURE.published}`);

    expect(await page.locator('script[type="application/ld+json"]').count()).toBe(0);
  });

  test('keeps the contributor out of the sitemap, because there is none', async ({
    page,
  }) => {
    const base = test.info().project.use.baseURL;

    expect((await page.request.get(`${base}/sitemap.xml`)).status()).toBe(404);
    expect((await page.request.get(`${base}/sitemaps/people-en.xml`)).status()).toBe(404);

    const robots = await page.request.get(`${base}/robots.txt`);
    expect(await robots.text()).not.toContain('Sitemap');
  });
});

/* ===========================================================================
 * Presentation
 * ========================================================================= */

test.describe('the contributor profile is usable', () => {
  test('fits a phone without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto(`/en/people/${FIXTURE.published}`);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('fits a phone in Urdu without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto(`/ur/people/${FIXTURE.urduOnly}`);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('exposes one first-level heading and a reachable breadcrumb', async ({ page }) => {
    await page.goto(`/en/people/${FIXTURE.published}`);

    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);

    // The breadcrumb is a real navigation landmark, and its link works.
    const home = page.getByRole('navigation').getByRole('link').first();
    await expect(home).toBeVisible();
  });

  test('moves focus through the page with the keyboard alone', async ({ page }) => {
    await page.goto(`/en/people/${FIXTURE.published}`);

    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.tagName ?? '');

    expect(['A', 'BUTTON']).toContain(focused);
  });
});

/* ===========================================================================
 * Administrative refusals
 * ========================================================================= */

test.describe('the People routes refuse an account without the permission', () => {
  test('answers 404 rather than confirming the route exists', async ({ page }) => {
    await registerAndSignIn(page, 'no-people');

    // 404, not 403: a 403 confirms the route exists and that somebody may use
    // it, which is a map of the platform's privileged shape handed to anyone
    // with an account (SECURITY_BASELINE.md §1.5).
    for (const route of ['persons', 'authors', 'speakers', 'scholars', 'teachers']) {
      const response = await page.goto(`/en/admin/people/${route}`);
      expect(response?.status(), `/${route} must be 404`).toBe(404);
    }
  });

  test('sends a signed-out visitor to sign in, with a safe internal return path', async ({
    page,
  }) => {
    await page.goto('/en/admin/people/persons');
    await page.waitForURL(/\/en\/signin\?returnTo=/);

    const returnTo = new URL(page.url()).searchParams.get('returnTo');

    expect(returnTo).toBe('/en/admin');
    expect(returnTo?.startsWith('//')).toBe(false);
    expect(returnTo).not.toMatch(/^https?:/);
  });
});

/* ===========================================================================
 * The reader — `people.read` and nothing else
 * ========================================================================= */

test.describe('an operator holding only people.read', () => {
  test.use({ storageState: READER_STATE });

  test('sees the directory', async ({ page }) => {
    const response = await page.goto('/en/admin/people/persons');

    expect(response?.status()).toBe(200);
    await expect(page.getByRole('main')).toContainText(FIXTURE.published);
  });

  test('is offered no control they cannot use', async ({ page }) => {
    await page.goto('/en/admin/people/persons');

    // The controls are ABSENT rather than disabled: a disabled control is a
    // client-side rule (SECURITY_BASELINE.md §3.4 rule 1).
    await expect(page.getByRole('button', { name: 'Create contributor' })).toHaveCount(0);

    await page.goto(`/en/admin/people/persons?q=${FIXTURE.published}`);
    await page.getByRole('link', { name: 'Edit' }).first().click();

    await expect(page.getByRole('button', { name: 'Save status' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Link account' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add facet' })).toHaveCount(0);
  });
});

/* ===========================================================================
 * The editor's journeys
 * ========================================================================= */

test.describe('the contributor editor', () => {
  test.use({ storageState: EDITOR_STATE });

  test('creates a contributor, which arrives as a draft', async ({ page }) => {
    const slug = proofSlug('created');

    await page.goto('/en/admin/people/persons');
    await page.locator('#create-slug').fill(slug);
    await page.locator('#create-name').fill('Created In Browser');
    await page.getByRole('button', { name: 'Create contributor' }).click();

    await announced(page, 'Saved').waitFor();

    // NOT PUBLIC YET, which is the whole point of arriving as a draft.
    const response = await page.request.get(
      `${test.info().project.use.baseURL}/en/people/${slug}`,
    );
    expect(response.status()).toBe(404);

    await page.goto(`/en/admin/people/persons?q=${slug}`);
    await expect(page.getByRole('main')).toContainText('Draft');
  });

  test('publishes a contributor, and the public page then exists', async ({ page }) => {
    const slug = proofSlug('publish');

    await page.goto('/en/admin/people/persons');
    await page.locator('#create-slug').fill(slug);
    await page.locator('#create-name').fill('Published In Browser');
    await page.getByRole('button', { name: 'Create contributor' }).click();
    await announced(page, 'Saved').waitFor();

    await page.goto(`/en/admin/people/persons?q=${slug}`);
    await page.getByRole('link', { name: 'Edit' }).first().click();

    await page.locator('#person-status').selectOption('published');
    await page.getByRole('button', { name: 'Save status' }).click();
    await announced(page, 'Saved').waitFor();

    const response = await page.request.get(
      `${test.info().project.use.baseURL}/en/people/${slug}`,
    );
    expect(response.status()).toBe(200);
  });

  test('adds a translation in another language', async ({ page }) => {
    await page.goto(`/en/admin/people/persons?q=${FIXTURE.published}`);
    await page.getByRole('link', { name: 'Edit' }).first().click();

    // THE ARABIC SECTION, addressed by the field's own id rather than by
    // position. The editor renders one translation form per interface language
    // and a create form below them, so an index would move the day a language
    // is added — and would silently edit the wrong one rather than fail.
    const arabic = page.locator('#name-ar');
    await arabic.fill('اسم الإثبات');
    await page
      .locator('form')
      .filter({ has: arabic })
      .getByRole('button', { name: 'Save', exact: true })
      .click();

    await announced(page, 'Saved').waitFor();

    await page.goto(`/ar/people/${FIXTURE.published}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('اسم الإثبات');
  });

  test('adds several distinct facets and archives one independently', async ({
    page,
  }) => {
    const slug = proofSlug('facets');

    await page.goto('/en/admin/people/persons');
    await page.locator('#create-slug').fill(slug);
    await page.locator('#create-name').fill('Many Facets');
    await page.getByRole('button', { name: 'Create contributor' }).click();
    await announced(page, 'Saved').waitFor();

    await page.goto(`/en/admin/people/persons?q=${slug}`);
    await page.getByRole('link', { name: 'Edit' }).first().click();

    // FOUR DISTINCT AGGREGATES, added one at a time through the interface.
    for (const facet of ['Author', 'Speaker', 'Scholar', 'Teacher']) {
      await page.locator('#add-facet-kind').selectOption({ label: facet });
      await page.getByRole('button', { name: 'Add facet' }).click();
      await announced(page, 'Saved').waitFor();
    }

    await expect(page.getByRole('main')).toContainText('Author');
    await expect(page.getByRole('main')).toContainText('Speaker');
    await expect(page.getByRole('main')).toContainText('Scholar');
    await expect(page.getByRole('main')).toContainText('Teacher');

    // ARCHIVING ONE LEAVES THE OTHERS ALONE, which is why they are four
    // aggregates rather than one row with a type column.
    await page.locator('#facet-status-author').selectOption('archived');
    await page.getByRole('button', { name: 'Save facet status' }).first().click();
    await announced(page, 'Saved').waitFor();

    const badges = page.getByRole('main');
    await expect(badges).toContainText('Archived');
    await expect(badges).toContainText('Draft');
  });

  test('offers no grant control, and shows the capabilities as read-only', async ({
    page,
  }) => {
    await page.goto(`/en/admin/people/persons?q=${FIXTURE.published}`);
    await page.getByRole('link', { name: 'Edit' }).first().click();

    const main = page.getByRole('main');

    // The four projections are SHOWN, so an operator can see what a person is
    // approved to do — and there is nothing to press.
    await expect(main).toContainText('May teach');
    await expect(main).toContainText('teaching.perform');
    await expect(main).toContainText('A profile grants nothing');

    for (const control of ['Grant', 'Approve', 'Grant role', 'Make teacher']) {
      await expect(page.getByRole('button', { name: control })).toHaveCount(0);
    }
  });

  test('projects every capability as No, because none is grantable yet', async ({
    page,
  }) => {
    // The honest answer against a real Phase-5 database: `teaching.perform` and
    // its three siblings belong to contexts that have not shipped, so no
    // assignment can hold one (DOMAIN_MODEL.md §4.5, OPEN_DECISIONS.md §6.3).
    await page.goto(`/en/admin/people/persons?q=${FIXTURE.published}`);
    await page.getByRole('link', { name: 'Edit' }).first().click();

    const capabilityRows = page.getByRole('row').filter({ hasText: 'teaching.perform' });
    await expect(capabilityRows.first()).toContainText('No');
  });

  test('offers no hard-delete control anywhere', async ({ page }) => {
    // Archive is the lifecycle: the runtime principal holds no DELETE on a
    // contributor or on any profile table, so a delete button would be a
    // control that cannot work.
    await page.goto(`/en/admin/people/persons?q=${FIXTURE.published}`);
    await page.getByRole('link', { name: 'Edit' }).first().click();

    for (const control of ['Delete', 'Delete contributor', 'Remove contributor']) {
      await expect(page.getByRole('button', { name: control })).toHaveCount(0);
    }
  });

  test('links an account, and refuses to link the same one twice', async ({ page }) => {
    const first = proofSlug('link-a');
    const second = proofSlug('link-b');

    for (const [slug, name] of [
      [first, 'Link Target One'],
      [second, 'Link Target Two'],
    ]) {
      await page.goto('/en/admin/people/persons');
      await page.locator('#create-slug').fill(slug!);
      await page.locator('#create-name').fill(name!);
      await page.getByRole('button', { name: 'Create contributor' }).click();
      await announced(page, 'Saved').waitFor();
    }

    // The first link succeeds.
    await page.goto(`/en/admin/people/persons?q=${first}`);
    await page.getByRole('link', { name: 'Edit' }).first().click();
    await page.locator('#account-id').fill(FIXTURE.editorAccountId);
    await page.getByRole('button', { name: 'Link account' }).click();
    await announced(page, 'Saved').waitFor();

    // The second is refused by the database's unique index, and reported as
    // something a person can act on.
    await page.goto(`/en/admin/people/persons?q=${second}`);
    await page.getByRole('link', { name: 'Edit' }).first().click();
    await page.locator('#account-id').fill(FIXTURE.editorAccountId);
    await page.getByRole('button', { name: 'Link account' }).click();

    await expect(
      page.getByRole('alert').filter({ hasText: 'already linked' }),
    ).toBeVisible();
  });

  test('refuses a forged account identifier', async ({ page }) => {
    const slug = proofSlug('forged');

    await page.goto('/en/admin/people/persons');
    await page.locator('#create-slug').fill(slug);
    await page.locator('#create-name').fill('Forged Link Target');
    await page.getByRole('button', { name: 'Create contributor' }).click();
    await announced(page, 'Saved').waitFor();

    await page.goto(`/en/admin/people/persons?q=${slug}`);
    await page.getByRole('link', { name: 'Edit' }).first().click();
    await page.locator('#account-id').fill('account-never-created');
    await page.getByRole('button', { name: 'Link account' }).click();

    await expect(
      page.getByRole('alert').filter({ hasText: 'No account exists' }),
    ).toBeVisible();
  });

  test('offers no account search, so managing people is not browsing accounts', async ({
    page,
  }) => {
    // `people.administer` lets somebody attach an account they were given the
    // identifier for; it does not make them an account administrator
    // (SECURITY_BASELINE.md §19.1).
    await page.goto(`/en/admin/people/persons?q=${FIXTURE.published}`);
    await page.getByRole('link', { name: 'Edit' }).first().click();

    await expect(page.locator('#account-id')).toBeVisible();
    await expect(page.getByRole('combobox', { name: /account/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /search accounts/i })).toHaveCount(0);
  });

  test('renders the administrative surface in Urdu, right-to-left', async ({ page }) => {
    await page.goto('/ur/admin/people/persons');

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ur');
    await expect(page.getByRole('main')).toContainText('معاونین');
  });

  test('renders the administrative surface in Arabic', async ({ page }) => {
    await page.goto('/ar/admin/people/persons');

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('main')).toContainText('المساهمون');
  });

  test('offers the four facet directories, each filtered to its own kind', async ({
    page,
  }) => {
    for (const [route, heading] of [
      ['authors', 'Authors'],
      ['speakers', 'Speakers'],
      ['scholars', 'Scholars'],
      ['teachers', 'Teachers'],
    ]) {
      const response = await page.goto(`/en/admin/people/${route}`);
      expect(response?.status(), route).toBe(200);
      // SCOPED TO `main`: the administrative shell renders its own first-level
      // heading in the layout, so every admin page carries two. That is the
      // shell's existing shape rather than anything this phase introduced, and
      // asserting document-wide would be asserting about the shell.
      await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText(
        heading!,
      );
    }

    // The seeded contributor holds an author facet and a teacher facet, and no
    // speaker facet — so it appears on two of the four.
    await page.goto(`/en/admin/people/authors?q=${FIXTURE.published}`);
    await expect(page.getByRole('main')).toContainText(FIXTURE.published);

    await page.goto(`/en/admin/people/speakers?q=${FIXTURE.published}`);
    await expect(page.getByRole('main')).not.toContainText(FIXTURE.published);
  });

  test('keeps all five administrative routes private and unindexed', async ({ page }) => {
    // ROUTE_MAP.md §9.5 gives `/admin/*` a private cache directive and
    // `noindex, nofollow`. Asserted on every one of the five surfaces
    // ROUTE_MAP.md §7 promises, rather than on one of them, because the
    // directive comes from each route's own segment configuration.
    const base = test.info().project.use.baseURL;

    for (const route of ['persons', 'authors', 'speakers', 'scholars', 'teachers']) {
      const response = await page
        .context()
        .request.get(`${base}/en/admin/people/${route}`);
      expect(response.status(), route).toBe(200);

      expect(response.headers()['cache-control'] ?? '', route).toMatch(
        /no-store|private/,
      );

      await page.goto(`/en/admin/people/${route}`);
      const robots = await page.locator('meta[name="robots"]').getAttribute('content');
      expect(robots, route).toContain('noindex');
      expect(robots, route).toContain('nofollow');
    }
  });

  test('says in words that a scholar facet is not religious authority', async ({
    page,
  }) => {
    await page.goto('/en/admin/people/scholars');
    await expect(page.getByRole('main')).toContainText('not an appointment');

    await page.goto('/en/admin/people/teachers');
    await expect(page.getByRole('main')).toContainText('not an approval');
  });
});
