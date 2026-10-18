import { randomUUID } from 'node:crypto';

import type { Browser, BrowserContext, Locator, Page, Request } from '@playwright/test';

import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import {
  copy,
  expectHeadingsInOrder,
  expectLabelledControls,
  expectVisibleFocus,
  mainHeading,
  overflowOf,
  tabTo,
  type UiLocale,
} from './messaging-pages';
import {
  accountIdFor,
  alertIn,
  asTwoVisitors,
  baseUrl,
  expect,
  firstDifference,
  grantRole,
  knowledgeOf,
  privilegedSession,
  registerAndSignIn,
  test,
} from './support';

/**
 * Phase 26 — Membership in a real browser, against the production build.
 *
 * WHAT ONLY A BROWSER CAN PROVE: that the public Membership page is read
 * without an account in every locale, sets no cookie, lists published types
 * only — never a draft or an archived one — shows a type written in another
 * language in that language with an honest notice, links to My Membership,
 * is the same document signed in and signed out, names nobody, speaks of no
 * fee or payment, and reflows at 320 and 640 pixels around an unbroken title;
 * that My Membership sends a signed-out visitor to sign in, is private and
 * unindexed, makes ONE application however often it is asked for, withdraws
 * one only after confirmation, lets a person apply again, shows nobody else's
 * and answers another person's application as not found even when its id is
 * posted; that the export is the person's own, privately; that the
 * administration is a 404 without a Membership key, read-only with
 * `membership.read` — a replayed act refused — and with
 * `membership.administer` creates a type, adds its Urdu words, publishes it,
 * refuses a stale form as a conflict, reviews and approves (the Membership
 * begins for the applicant), rejects, and ends a Membership; that a member
 * ends their own and may apply again; and that the surfaces keep their
 * heading outline, label their controls, reach the apply button by keyboard
 * with a visible focus and say every status in words.
 *
 * ONE SERIAL FILE. Every step reads what the one before it did: the
 * application withdrawn is the one applied for, the one approved is the one
 * re-made, the Membership ended is the one approval began.
 *
 * WHO WRITES WHAT. Identity's accounts, their display names and role
 * assignments are its facts, written as fixtures through the privileged
 * session. The four types the public page is proved against — published,
 * published with an unbroken title, draft and archived — are seeded the same
 * way, on the migration connection, through every state the lifecycle
 * triggers admit. Everything else — the type created through the
 * administration, every application, review, decision and closure — is done
 * through the pages.
 *
 * EMAIL IS NOT PROVED HERE. Each transition's durable intent and its delivery
 * are the SQL and unit proofs' to establish.
 *
 * EVERYTHING IS SYNTHETIC. Every word is a `NON_MEMBERSHIP_FIXTURE` sentinel,
 * which no other spec looks for.
 */

// NO RETRY. A retry would meet its own applications and Memberships and
// prove nothing about the first attempt.
test.describe.configure({ mode: 'serial', retries: 0 });

let sql: SqlSession;
const contexts: BrowserContext[] = [];

const run = randomUUID().replaceAll('-', '').slice(0, 10);
const SENTINEL = 'NON_MEMBERSHIP_FIXTURE';
const LOCALES: readonly UiLocale[] = ['en', 'ur', 'ar'];

const ids = {
  open: randomUUID(),
  long: randomUUID(),
  draft: randomUUID(),
  archived: randomUUID(),
} as const;

const TEXT = {
  open: `${SENTINEL}_OPEN ${run}`,
  // One unbroken token, as long as a title may be: the reflow hazard.
  long: `${SENTINEL}_LONG_${'w'.repeat(118)}${run}`,
  draft: `${SENTINEL}_UNSEEN_DRAFTED ${run}`,
  archived: `${SENTINEL}_UNSEEN_RETIRED ${run}`,
  created: `${SENTINEL}_MADE ${run}`,
  createdUr: `${SENTINEL}_MADE اردو ${run}`,
  applicant: `${SENTINEL} applicant ${run}`,
  other: `${SENTINEL} other ${run}`,
  operator: `${SENTINEL} operator ${run}`,
  reader: `${SENTINEL} reader ${run}`,
} as const;

/** Words a Membership surface must never use: Membership is not a payment. */
const PAYMENT =
  /\b(fees?|dues|payments?|pay|paid|price|pricing|donat\w*|subscriptions?|invoices?|receipts?|checkout|currency|amount)\b/iu;

/** A SQL Server Unicode literal. Values are this file's own constants. */
const n = (value: string) => `N'${value.replaceAll("'", "''")}'`;

async function scalar(statement: string): Promise<number> {
  const [row] = await sql.query<{ value: number }>(statement);
  return Number(row?.value ?? Number.NaN);
}

/* ===========================================================================
 * Seeding
 * ========================================================================= */

/**
 * One type in English, walked through exactly the states the lifecycle
 * trigger admits: inserted as a draft at version 1, then published and
 * archived one version at a time, with the instants each state implies.
 */
async function seedType(
  id: string,
  title: string,
  displayOrder: number,
  state: 'draft' | 'published' | 'archived',
  guidance: string | null = null,
): Promise<void> {
  const steps = [
    `INSERT INTO [dbo].[MembershipType] ([id],[primaryLocale],[displayOrder]) VALUES (N'${id}', N'en', ${String(displayOrder)});`,
    `INSERT INTO [dbo].[MembershipTypeTranslation] ([membershipTypeId],[locale],[title],[summary],[description],[guidance]) VALUES
      (N'${id}', N'en', ${n(title)}, ${n(`${SENTINEL} summary ${run}`)}, ${n(`${SENTINEL} description ${run}`)}, ${guidance === null ? 'NULL' : n(guidance)});`,
  ];
  if (state !== 'draft')
    steps.push(
      `UPDATE [dbo].[MembershipType] SET [state]=N'published', [publishedAt]=SYSUTCDATETIME(), [version]=2, [updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${id}';`,
    );
  if (state === 'archived')
    steps.push(
      `UPDATE [dbo].[MembershipType] SET [state]=N'archived', [archivedAt]=SYSUTCDATETIME(), [version]=3, [updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${id}';`,
    );
  await sql.query(steps.join('\n'));
}

/* ===========================================================================
 * Accounts and page helpers
 * ========================================================================= */

interface Actor {
  readonly page: Page;
  readonly id: string;
  readonly email: string;
  /** Identity's display name — what an operator is shown. */
  readonly name: string;
}

/** A fresh signed-in account on its own context and client address, named as a sentinel. */
async function account(
  browser: Browser,
  index: number,
  prefix: string,
  name: string,
): Promise<Actor> {
  const context = await browser.newContext({
    baseURL: baseUrl(),
    extraHTTPHeaders: { 'x-forwarded-for': `100.64.238.${String(index)}` },
  });
  contexts.push(context);
  const page = await context.newPage();
  const { email } = await registerAndSignIn(page, prefix);
  const id = await accountIdFor(sql, email);
  await sql.query(`UPDATE [dbo].[User] SET [name]=${n(name)} WHERE [id]=N'${id}';`);
  return { page, id, email, name };
}

/** The private surface is never cached and never indexed. */
async function expectPrivateSurface(page: Page, target: string): Promise<void> {
  const response = await page.context().request.get(target, { maxRedirects: 0 });
  expect(response.status(), target).toBe(200);
  const cache = response.headers()['cache-control'] ?? '';
  expect(cache, target).toContain('private');
  expect(cache, target).toContain('no-store');
  await page.goto(target);
  await expect(mainHeading(page), target).toBeVisible();
  await expect(page.locator('meta[name="robots"]').first(), target).toHaveAttribute(
    'content',
    /noindex/,
  );
}

/** The page's own words say nothing of fees, payment or donations. */
async function expectNoPaymentWords(page: Page, where: string): Promise<void> {
  const main = page.getByRole('main');
  expect(await main.innerText(), where).not.toMatch(PAYMENT);
  await expect(
    main.locator(
      'input[name*="amount" i], input[name*="currency" i], input[name*="fee" i], input[name*="price" i]',
    ),
    where,
  ).toHaveCount(0);
}

/** One list on My Membership, by its accessible name. */
function myList(page: Page, key: 'open' | 'memberships' | 'apply' | 'history'): Locator {
  return page
    .getByRole('main')
    .getByRole('list', { name: copy(`myMembership.${key}.heading`), exact: true });
}

/** The apply button My Membership offers for one type. */
function applyButton(page: Page, title: string): Locator {
  return page.getByRole('main').getByRole('button', {
    name: copy('myMembership.apply.submit', { title }),
    exact: true,
  });
}

/** Applies for one type from My Membership, and waits for the notice it lands on. */
async function apply(
  page: Page,
  title: string,
  notice: 'submitted' | 'existing',
): Promise<void> {
  await applyButton(page, title).click();
  await page.waitForURL(new RegExp(`/en/my/membership\\?done=${notice}$`, 'u'));
  await expect(page.getByRole('main')).toContainText(copy(`myMembership.done.${notice}`));
}

/** One application of an account, newest first, as the database holds it. */
async function applicationsOf(
  accountId: string,
  typeId: string,
): Promise<{ id: string; status: string; version: number }[]> {
  return sql.query<{ id: string; status: string; version: number }>(
    `SELECT [id],[status],[version] FROM [dbo].[MembershipApplication]
       WHERE [applicantUserId]=N'${accountId}' AND [membershipTypeId]=N'${typeId}'
       ORDER BY [submittedAt] DESC, [id];`,
  );
}

/** The account's one OPEN application of a type. */
async function openApplication(
  accountId: string,
  typeId: string,
): Promise<{ id: string; version: number }> {
  const open = (await applicationsOf(accountId, typeId)).filter((row) =>
    ['submitted', 'under_review'].includes(row.status),
  );
  expect(open, 'exactly one open application').toHaveLength(1);
  const [row] = open;
  if (row === undefined) throw new Error('No open application.');
  return row;
}

/** A Server Action submission, captured on its way out so it can be sent again. */
interface Submission {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: Buffer;
}

async function captured(request: Request): Promise<Submission> {
  const body = request.postDataBuffer();
  if (body === null) throw new Error('The submission carried no body.');
  const headers = Object.fromEntries(
    Object.entries(await request.allHeaders()).filter(
      ([name]) => !['cookie', 'content-length', 'host', 'connection'].includes(name),
    ),
  );
  return { url: request.url(), headers, body };
}

/** The application detail an operator opens. */
function detailPath(applicationId: string): string {
  return `/en/admin/membership/applications/${applicationId}`;
}

/** Opens an application, starts its review after confirming, and waits for the decision forms. */
async function startReview(page: Page, applicationId: string): Promise<void> {
  await page.goto(detailPath(applicationId));
  const main = page.getByRole('main');
  await expect(mainHeading(page)).toHaveText(copy('adminMembership.application.title'));
  await main.locator('#review-confirm').check();
  await main
    .getByRole('button', { name: copy('adminMembership.review.submit'), exact: true })
    .click();
  await expect(
    main.getByRole('button', {
      name: copy('adminMembership.decide.approve'),
      exact: true,
    }),
  ).toBeVisible();
}

/** Decides an application under review, after confirming, and waits for the outcome. */
async function decide(page: Page, decision: 'approve' | 'reject'): Promise<void> {
  const main = page.getByRole('main');
  await main.locator(`#${decision}-confirm`).check();
  await main
    .getByRole('button', {
      name: copy(`adminMembership.decide.${decision}`),
      exact: true,
    })
    .click();
  await expect(main).toContainText(copy('adminMembership.application.terminal'));
  await expect(main).toContainText(
    copy(
      `membership.status.application.${decision === 'approve' ? 'approved' : 'rejected'}`,
    ),
  );
}

/* ===========================================================================
 * Fixture
 * ========================================================================= */

let applicant: Actor;
let other: Actor;
let operator: Actor;
let reader: Actor;

/** The type created through the administration. */
let createdId: string;
/** The operator's real reorder submission, replayed later by the reader. */
let reorder: Submission;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  sql = await privilegedSession();

  await seedType(ids.open, TEXT.open, 900, 'published', `${SENTINEL} guidance ${run}`);
  await seedType(ids.long, TEXT.long, 901, 'published');
  await seedType(ids.draft, TEXT.draft, 902, 'draft');
  await seedType(ids.archived, TEXT.archived, 903, 'archived');

  applicant = await account(browser, 1, 'membership-applicant', TEXT.applicant);
  other = await account(browser, 2, 'membership-other', TEXT.other);
  operator = await account(browser, 3, 'membership-operator', TEXT.operator);
  await grantRole(
    sql,
    operator.id,
    ['membership.read', 'membership.administer'],
    `${SENTINEL} administration`,
  );
  reader = await account(browser, 4, 'membership-reader', TEXT.reader);
  await grantRole(sql, reader.id, ['membership.read'], `${SENTINEL} reading`);
});

test.afterAll(async () => {
  for (const context of contexts) await context.close();
  await sql?.close();
});

/* ===========================================================================
 * 1. The public page
 * ========================================================================= */

test.describe('the public Membership page', () => {
  test('is read without an account in every locale, lists published types only, and links to My Membership', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    for (const locale of LOCALES) {
      const target = `/${locale}/membership`;
      const response = await page.goto(target);
      expect(response?.status(), target).toBe(200);
      expect(response?.headers()['set-cookie'], target).toBeUndefined();
      await expect(page.locator('html'), target).toHaveAttribute(
        'dir',
        locale === 'en' ? 'ltr' : 'rtl',
      );
      await expect(page.locator('html'), target).toHaveAttribute('lang', locale);
      await expect(mainHeading(page), target).toHaveText(
        copy('membership.title', {}, locale),
      );
      const main = page.getByRole('main');

      // Published, in display order; a draft and an archived type do not exist here.
      for (const title of [TEXT.open, TEXT.long])
        await expect(
          main.getByRole('heading', { level: 3, name: title, exact: true }),
          target,
        ).toBeVisible();
      const html = await page.content();
      for (const hidden of [TEXT.draft, TEXT.archived])
        expect(html, `${target} ${hidden}`).not.toContain(hidden);

      // Written only in English: shown in English, marked as such, with the
      // notice in the reader's own language — and no notice on an English page.
      const card = main.getByRole('listitem').filter({ hasText: TEXT.open });
      await expect(card.locator('[lang="en"]').getByRole('heading'), target).toHaveText(
        TEXT.open,
      );
      const notice = card.getByRole('status');
      if (locale === 'en') await expect(notice, target).toHaveCount(0);
      else
        await expect(notice, target).toHaveText(
          copy('membership.types.fallback', { language: 'English' }, locale),
        );
      await expect(card, target).toContainText(`${SENTINEL} guidance ${run}`);

      // Applying is My Minhaj's; the page links there and embeds no form.
      await expect(
        main.getByRole('link', {
          name: copy('membership.cta.link', {}, locale),
          exact: true,
        }),
        target,
      ).toHaveAttribute('href', `/${locale}/my/membership`);
      await expect(main.locator('form'), target).toHaveCount(0);
      await expect(main.getByRole('button'), target).toHaveCount(0);
    }
    await page.goto('/en/membership');
    await expectNoPaymentWords(page, '/en/membership');
  });

  test('is the same document signed in and signed out, and names nobody', async ({
    request,
  }) => {
    test.setTimeout(120_000);
    for (const target of ['/en/membership', '/ur/membership'])
      for (const visitor of [applicant, other]) {
        const { anonymous, signedIn } = await asTwoVisitors(
          request,
          visitor.page.context().request,
          target,
        );
        expect(anonymous.status(), target).toBe(200);
        expect(signedIn.status(), target).toBe(200);
        expect(anonymous.headers()['set-cookie'], target).toBeUndefined();
        expect(signedIn.headers()['set-cookie'], target).toBeUndefined();
        const [html, signedInHtml] = [await anonymous.text(), await signedIn.text()];
        expect(
          firstDifference(knowledgeOf(html), knowledgeOf(signedInHtml)),
          `${target} differs signed in`,
        ).toBe('identical');
        for (const secret of [visitor.email, visitor.id, visitor.name])
          expect(signedInHtml, target).not.toContain(secret);
      }
  });

  test('reflows at 320px and 640px around an unbroken title', async ({ page }) => {
    test.setTimeout(120_000);
    // 640 CSS pixels is a 1280-pixel window at 200% zoom.
    for (const width of [320, 640]) {
      await page.setViewportSize({ width, height: 800 });
      for (const locale of LOCALES) {
        const target = `/${locale}/membership`;
        const where = `${String(width)}px ${target}`;
        const response = await page.goto(target);
        expect(response?.status(), where).toBe(200);
        await expect(
          page.getByRole('main').getByRole('heading', { name: TEXT.long, exact: true }),
          where,
        ).toBeVisible();
        expect(await overflowOf(page), where).toBeLessThanOrEqual(0);
        await expectHeadingsInOrder(page, where);
      }
    }
  });
});

/* ===========================================================================
 * 2. My Membership
 * ========================================================================= */

test.describe('My Membership', () => {
  test('a signed-out visitor is sent to sign in, and the export refuses them', async ({
    page,
    request,
  }) => {
    await page.goto('/en/my/membership');
    await page.waitForURL(/\/en\/signin\?/);
    const url = new URL(page.url());
    expect(`${url.pathname}${url.search}`).toBe(
      `/en/signin?returnTo=${encodeURIComponent('/en/my/membership')}`,
    );
    const response = await request.get('/api/my/export/membership');
    expect(response.status()).toBe(401);
    expect(response.headers()['cache-control']).toBe('private, no-store');
  });

  test('is private, and one application is made however often it is asked for', async () => {
    test.setTimeout(180_000);
    const page = applicant.page;
    await expectPrivateSurface(page, '/en/my/membership');
    await expect(myList(page, 'open')).toHaveCount(0);
    await expect(page.getByRole('main')).toContainText(copy('myMembership.open.empty'));

    // A second page, loaded BEFORE applying, still offers the form.
    const stale = await page.context().newPage();
    await stale.goto('/en/my/membership');
    await expect(applyButton(stale, TEXT.open)).toBeVisible();

    await apply(page, TEXT.open, 'submitted');
    const entry = myList(page, 'open')
      .getByRole('listitem')
      .filter({ hasText: TEXT.open });
    await expect(entry).toContainText(copy('membership.status.application.submitted'));
    await expect(entry).toContainText(copy('myMembership.open.submittedHelp'));
    // In progress: the type now says so instead of offering a second.
    const offer = myList(page, 'apply')
      .getByRole('listitem')
      .filter({ hasText: TEXT.open });
    await expect(offer).toContainText(copy('myMembership.apply.inProgress'));
    await expect(applyButton(page, TEXT.open)).toHaveCount(0);

    // The stale page asks again: answered with the application in progress.
    await applyButton(stale, TEXT.open).click();
    await stale.waitForURL(/\/en\/my\/membership\?done=existing$/u);
    await expect(stale.getByRole('main')).toContainText(
      copy('myMembership.done.existing'),
    );
    await stale.close();

    const rows = await applicationsOf(applicant.id, ids.open);
    expect(rows.map((row) => [row.status, row.version])).toEqual([['submitted', 1]]);
  });

  test('withdrawing needs the confirmation, then withdraws; applying again is allowed', async () => {
    test.setTimeout(180_000);
    const page = applicant.page;
    await page.goto('/en/my/membership');
    const entry = myList(page, 'open')
      .getByRole('listitem')
      .filter({ hasText: TEXT.open });
    const withdraw = entry.getByRole('button', {
      name: copy('myMembership.withdraw.submit'),
      exact: true,
    });

    // Unconfirmed: refused in words, and nothing changes.
    await withdraw.click();
    await expect(alertIn(page)).toHaveText(copy('myMembership.failure.confirmRequired'));
    expect((await applicationsOf(applicant.id, ids.open))[0]?.status).toBe('submitted');

    await entry
      .getByLabel(copy('myMembership.withdraw.confirm'), { exact: true })
      .check();
    await withdraw.click();
    await page.waitForURL(/\/en\/my\/membership\?done=withdrawn$/u);
    const main = page.getByRole('main');
    await expect(main).toContainText(copy('myMembership.done.withdrawn'));
    await expect(main).toContainText(copy('myMembership.open.empty'));
    const earlier = myList(page, 'history').getByRole('listitem').filter({
      hasText: TEXT.open,
    });
    await expect(earlier).toContainText(copy('membership.status.application.withdrawn'));
    await expect(earlier).toContainText(copy('membership.withdrawalSource.applicant'));

    await apply(page, TEXT.open, 'submitted');
    expect(
      (await applicationsOf(applicant.id, ids.open)).map((row) => row.status),
    ).toEqual(['submitted', 'withdrawn']);
  });

  test('another account never sees it, and naming it in a withdrawal finds nothing', async () => {
    test.setTimeout(180_000);
    const mine = await openApplication(applicant.id, ids.open);
    const page = other.page;
    const response = await page.goto('/en/my/membership');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('main')).toContainText(copy('myMembership.open.empty'));
    await expect(page.getByRole('main')).toContainText(
      copy('myMembership.history.empty'),
    );
    expect(await page.content()).not.toContain(mine.id);

    // Their own application gives them a withdrawal form — which they aim at
    // the other person's application, at its current version.
    await apply(page, TEXT.open, 'submitted');
    const theirs = await openApplication(other.id, ids.open);
    const entry = myList(page, 'open')
      .getByRole('listitem')
      .filter({ hasText: TEXT.open });
    await entry.locator('form').evaluate(
      (form, target) => {
        (form.querySelector('input[name="id"]') as HTMLInputElement).value = target.id;
        (form.querySelector('input[name="version"]') as HTMLInputElement).value = String(
          target.version,
        );
      },
      { id: mine.id, version: mine.version },
    );
    await entry
      .getByLabel(copy('myMembership.withdraw.confirm'), { exact: true })
      .check();
    await entry
      .getByRole('button', { name: copy('myMembership.withdraw.submit'), exact: true })
      .click();
    await expect(alertIn(page)).toHaveText(copy('myMembership.failure.notFound'));

    // Neither application moved.
    expect(await openApplication(applicant.id, ids.open)).toEqual(mine);
    expect(await openApplication(other.id, ids.open)).toEqual(theirs);
  });

  test('the export is the person’s own data, privately', async () => {
    test.setTimeout(120_000);
    const response = await applicant.page
      .context()
      .request.get('/api/my/export/membership');
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers['cache-control']).toBe('private, no-store');
    expect(headers['content-disposition']).toMatch(
      /^attachment; filename="minhaj-membership-data-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    const document = (await response.json()) as {
      schema: string;
      applications: { id: string; membershipTypeId: string; status: string }[];
      memberships: unknown[];
    };
    expect(document.schema).toBe('minhaj.membership.export');
    const own = await applicationsOf(applicant.id, ids.open);
    expect(document.applications.map((entry) => entry.id).sort()).toEqual(
      own.map((row) => row.id).sort(),
    );
    expect(document.applications.map((entry) => entry.membershipTypeId)).toEqual([
      ids.open,
      ids.open,
    ]);
    expect(document.memberships).toEqual([]);
    const raw = JSON.stringify(document);
    const theirs = await openApplication(other.id, ids.open);
    for (const secret of [theirs.id, other.email, applicant.email, TEXT.open, other.id])
      expect(raw).not.toContain(secret);

    const stranger = (await (
      await other.page.context().request.get('/api/my/export/membership')
    ).json()) as { applications: { id: string }[]; memberships: unknown[] };
    expect(stranger.applications.map((entry) => entry.id)).toEqual([theirs.id]);
    expect(stranger.memberships).toEqual([]);

    // Another site cannot make the browser spend the person's export budget.
    const embedded = await applicant.page
      .context()
      .request.get('/api/my/export/membership', {
        headers: { 'sec-fetch-site': 'cross-site' },
      });
    expect(embedded.status()).toBe(403);
  });
});

/* ===========================================================================
 * 3. The administration
 * ========================================================================= */

test.describe('Membership administration', () => {
  test('is a 404 to an administrator without a Membership key', async () => {
    test.setTimeout(180_000);
    // An administrative key of another area: the administration opens, and
    // Membership's part of it does not exist.
    await grantRole(sql, other.id, ['taxonomy.read'], `${SENTINEL} another area`);
    const page = other.page;
    expect((await page.goto('/en/admin'))?.status()).toBe(200);
    await expect(
      page.getByRole('link', { name: copy('admin.nav.membership'), exact: true }),
    ).toHaveCount(0);
    const { id } = await openApplication(applicant.id, ids.open);
    for (const target of [
      '/en/admin/membership',
      `/en/admin/membership?type=${ids.open}`,
      '/en/admin/membership/applications',
      detailPath(id),
    ]) {
      const response = await page.goto(target);
      expect(response?.status(), target).toBe(404);
      for (const secret of [TEXT.open, TEXT.draft, TEXT.applicant])
        await expect(page.locator('body'), target).not.toContainText(secret);
    }
  });

  test('membership.administer creates a type, adds its Urdu words and publishes it', async ({
    page: visitor,
  }) => {
    test.setTimeout(240_000);
    const page = operator.page;
    await page.goto('/en/admin/membership');
    await expect(mainHeading(page)).toHaveText(copy('adminMembership.types.title'));
    const main = page.getByRole('main');
    await main.locator('#create-primary').selectOption('en');
    await main.locator('#create-order').fill('7');
    await main.locator('#create-title').fill(TEXT.created);
    await main.locator('#create-summary').fill(`${SENTINEL} made summary ${run}`);
    await main.locator('#create-description').fill(`${SENTINEL} made description ${run}`);
    await main
      .getByRole('button', { name: copy('adminMembership.create.submit'), exact: true })
      .click();
    await page.waitForURL(/\/en\/admin\/membership\?type=[0-9a-f-]{36}$/u);
    createdId = new URL(page.url()).searchParams.get('type') ?? '';
    const editor = main.locator('section[aria-labelledby="membership-editor"]');
    await expect(editor).toContainText(TEXT.created);
    await expect(editor).toContainText(copy('membership.typeState.draft'));
    const [made] = await sql.query<{ state: string; version: number }>(
      `SELECT [state],[version] FROM [dbo].[MembershipType] WHERE [id]=N'${createdId}';`,
    );
    expect(made).toEqual({ state: 'draft', version: 1 });

    // The Urdu words, saved on their own.
    const urdu = main.locator('form').filter({ has: page.locator('#label-ur-title') });
    await urdu.locator('#label-ur-title').fill(TEXT.createdUr);
    await urdu.locator('#label-ur-summary').fill(`${SENTINEL} خلاصہ ${run}`);
    await urdu.locator('#label-ur-description').fill(`${SENTINEL} تفصیل ${run}`);
    await urdu
      .getByRole('button', {
        name: copy('adminMembership.labels.submit', {
          language: copy('adminMembership.localeName.ur'),
        }),
        exact: true,
      })
      .click();
    await expect(urdu.getByRole('status')).toHaveText(copy('adminMembership.saved'));
    expect(
      await scalar(
        `SELECT COUNT_BIG(*) AS [value] FROM [dbo].[MembershipTypeTranslation] WHERE [membershipTypeId]=N'${createdId}' AND [locale]=N'ur';`,
      ),
    ).toBe(1);

    // Published: the editor now offers only archiving.
    await page.goto(`/en/admin/membership?type=${createdId}`);
    await editor
      .getByRole('button', {
        name: copy('adminMembership.lifecycle.to.published'),
        exact: true,
      })
      .click();
    await expect(
      editor.getByRole('button', {
        name: copy('adminMembership.lifecycle.to.archived'),
        exact: true,
      }),
    ).toBeVisible();
    await expect(editor).toContainText(copy('membership.typeState.published'));
    const [published] = await sql.query<{ state: string; version: number }>(
      `SELECT [state],[version] FROM [dbo].[MembershipType] WHERE [id]=N'${createdId}';`,
    );
    expect(published).toEqual({ state: 'published', version: 3 });

    // Public at once: in Urdu with its Urdu words, in Arabic in English with the notice.
    await visitor.goto('/ur/membership');
    const ur = visitor
      .getByRole('main')
      .getByRole('listitem')
      .filter({ hasText: TEXT.createdUr });
    await expect(ur.locator('[lang="ur"]').getByRole('heading')).toHaveText(
      TEXT.createdUr,
    );
    await expect(ur.getByRole('status')).toHaveCount(0);
    await visitor.goto('/ar/membership');
    const ar = visitor
      .getByRole('main')
      .getByRole('listitem')
      .filter({ hasText: TEXT.created });
    await expect(ar.locator('[lang="en"]').getByRole('heading')).toHaveText(TEXT.created);
    await expect(ar.getByRole('status')).toHaveText(
      copy('membership.types.fallback', { language: 'English' }, 'ar'),
    );
  });

  test('a stale form is refused as a conflict, in words', async () => {
    test.setTimeout(180_000);
    const first = operator.page;
    const second = await first.context().newPage();
    const target = `/en/admin/membership?type=${createdId}`;
    for (const page of [first, second]) {
      await page.goto(target);
      await expect(mainHeading(page)).toBeVisible();
      await expect(page.getByRole('main').locator('#type-order')).toHaveValue('7');
    }

    const submitted = first.waitForRequest(
      (request) =>
        request.method() === 'POST' &&
        request.headers()['next-action'] !== undefined &&
        (request.postData() ?? '').includes(createdId),
    );
    const save = (page: Page) =>
      page
        .getByRole('main')
        .getByRole('button', { name: copy('adminMembership.order.submit'), exact: true });
    await first.getByRole('main').locator('#type-order').fill('8');
    await save(first).click();
    reorder = await captured(await submitted);
    await expect(
      first
        .getByRole('main')
        .locator('form')
        .filter({ has: first.locator('#type-order') })
        .getByRole('status'),
    ).toHaveText(copy('adminMembership.saved'));

    // The second page still holds the version it was shown.
    await second.getByRole('main').locator('#type-order').fill('9');
    await save(second).click();
    await expect(alertIn(second)).toHaveText(copy('adminMembership.failure.conflict'));
    await second.close();

    const [row] = await sql.query<{ displayOrder: number; version: number }>(
      `SELECT [displayOrder],[version] FROM [dbo].[MembershipType] WHERE [id]=N'${createdId}';`,
    );
    expect(row).toEqual({ displayOrder: 8, version: 4 });
  });

  test('membership.read alone shows the types, the queue and an application — and no control; a replayed act is refused', async () => {
    test.setTimeout(240_000);
    const page = reader.page;
    // The Membership area opens under `membership.read` alone, with its entry
    // in the administration navigation. (The `/admin` dashboard lists only its
    // own core surfaces, so a holder of a domain key alone — Fatwa, Learning,
    // Messaging, Membership — meets its 404 there; that is the dashboard's
    // existing rule, not Membership's.)
    expect((await page.goto('/en/admin/membership'))?.status()).toBe(200);
    await expect(
      page.getByRole('link', { name: copy('admin.nav.membership'), exact: true }),
    ).toBeVisible();
    await expect(mainHeading(page)).toHaveText(copy('adminMembership.types.title'));
    const main = page.getByRole('main');
    const types = main.getByRole('table', {
      name: copy('adminMembership.types.caption'),
    });
    // EVERY state is listed, and each says its state in words.
    for (const [title, state] of [
      [TEXT.open, 'published'],
      [TEXT.draft, 'draft'],
      [TEXT.archived, 'archived'],
      [TEXT.created, 'published'],
    ] as const)
      await expect(
        types.getByRole('row').filter({ hasText: title }),
        title,
      ).toContainText(copy(`membership.typeState.${state}`));
    await expect(
      main.getByRole('heading', { name: copy('adminMembership.create.heading') }),
    ).toHaveCount(0);
    await expect(main.locator('form')).toHaveCount(0);

    // The editor is a reading: the words, and no act.
    await page.goto(`/en/admin/membership?type=${createdId}`);
    const editor = main.locator('section[aria-labelledby="membership-editor"]');
    await expect(editor).toContainText(TEXT.createdUr);
    await expect(main.locator('form')).toHaveCount(0);
    await expect(main.getByRole('button')).toHaveCount(0);

    // The queue and an application, opened as an audited read.
    const { id } = await openApplication(applicant.id, ids.open);
    await page.goto('/en/admin/membership/applications');
    await expect(mainHeading(page)).toHaveText(
      copy('adminMembership.applications.title'),
    );
    const row = main
      .getByRole('row')
      .filter({ hasText: TEXT.applicant })
      .filter({ hasText: TEXT.open });
    await expect(row).toContainText(copy('membership.status.application.submitted'));
    await expect(
      row.getByRole('link', { name: copy('adminMembership.applications.open') }),
    ).toHaveAttribute('href', detailPath(id));
    // The queue's only form is its GET filter.
    await expect(main.locator('form')).toHaveCount(1);
    await expect(main.locator('form[method="get"]')).toHaveCount(1);

    await page.goto(detailPath(id));
    await expect(mainHeading(page)).toHaveText(copy('adminMembership.application.title'));
    await expect(main).toContainText(copy('adminMembership.application.audited'));
    await expect(main).toContainText(TEXT.applicant);
    await expect(main.locator('form')).toHaveCount(0);
    await expect(main.getByRole('button')).toHaveCount(0);

    // The operator's own reorder, sent again with THIS session: refused by
    // the action's live permission check, and nothing moves.
    const replay = await page.context().request.post(reorder.url, {
      headers: reorder.headers,
      data: reorder.body,
      maxRedirects: 0,
    });
    expect(replay.status()).toBe(200);
    expect(await replay.text()).toContain('"failure":"no-permission"');
    const [type] = await sql.query<{ displayOrder: number; version: number }>(
      `SELECT [displayOrder],[version] FROM [dbo].[MembershipType] WHERE [id]=N'${createdId}';`,
    );
    expect(type).toEqual({ displayOrder: 8, version: 4 });
  });

  test('an application is reviewed and approved, and the Membership begins for the applicant', async () => {
    test.setTimeout(240_000);
    const page = operator.page;
    const { id } = await openApplication(applicant.id, ids.open);

    await page.goto('/en/admin/membership/applications');
    const main = page.getByRole('main');
    await main
      .getByRole('row')
      .filter({ hasText: TEXT.applicant })
      .filter({ hasText: TEXT.open })
      .getByRole('link', { name: copy('adminMembership.applications.open') })
      .click();
    await page.waitForURL(`**${detailPath(id)}`);
    await expect(main).toContainText(copy('adminMembership.application.audited'));
    await expect(main).toContainText(TEXT.applicant);
    await expect(main).toContainText(copy('membership.status.application.submitted'));

    // Unconfirmed: refused in words, and nothing changes.
    await main
      .getByRole('button', { name: copy('adminMembership.review.submit'), exact: true })
      .click();
    await expect(alertIn(page)).toHaveText(
      copy('adminMembership.failure.confirmRequired'),
    );
    expect((await openApplication(applicant.id, ids.open)).version).toBe(1);

    await startReview(page, id);
    await expect(main).toContainText(copy('membership.status.application.underReview'));
    expect((await applicationsOf(applicant.id, ids.open))[0]).toEqual({
      id,
      status: 'under_review',
      version: 2,
    });
    await decide(page, 'approve');

    const [membership] = await sql.query<{ status: string; sourceApplicationId: string }>(
      `SELECT [status],[sourceApplicationId] FROM [dbo].[Membership] WHERE [memberUserId]=N'${applicant.id}' AND [membershipTypeId]=N'${ids.open}';`,
    );
    expect(membership).toEqual({ status: 'active', sourceApplicationId: id });
    expect(
      await scalar(
        `SELECT COUNT_BIG(*) AS [value] FROM [dbo].[AuditLog] WHERE [action]=N'membership.application.accessed' AND [actorId]=N'${operator.id}' AND [targetId]=N'${id}';`,
      ),
    ).toBeGreaterThanOrEqual(1);

    // Private, unindexed, and never the applicant's address.
    for (const target of ['/en/admin/membership/applications', detailPath(id)]) {
      await expectPrivateSurface(page, target);
      const html = await (
        await page.context().request.get(target, { maxRedirects: 0 })
      ).text();
      expect(html, target).not.toContain(applicant.email);
      await expectNoPaymentWords(page, target);
    }

    // The applicant sees the Membership they now hold.
    const mine = applicant.page;
    await mine.goto('/en/my/membership');
    const held = myList(mine, 'memberships')
      .getByRole('listitem')
      .filter({ hasText: TEXT.open });
    await expect(held).toContainText(copy('membership.status.membership.active'));
    const decided = myList(mine, 'history')
      .getByRole('listitem')
      .filter({ hasText: copy('membership.status.application.approved') });
    await expect(decided).toContainText(copy('myMembership.history.membership'));
    await expect(
      myList(mine, 'apply').getByRole('listitem').filter({ hasText: TEXT.open }),
    ).toContainText(copy('myMembership.apply.member'));
    await expect(applyButton(mine, TEXT.open)).toHaveCount(0);
  });

  test('another application is not approved, and the person may apply again', async () => {
    test.setTimeout(240_000);
    const page = operator.page;
    const { id } = await openApplication(other.id, ids.open);
    await startReview(page, id);
    await decide(page, 'reject');
    expect((await applicationsOf(other.id, ids.open))[0]).toEqual({
      id,
      status: 'rejected',
      version: 3,
    });
    expect(
      await scalar(
        `SELECT COUNT_BIG(*) AS [value] FROM [dbo].[Membership] WHERE [memberUserId]=N'${other.id}';`,
      ),
    ).toBe(0);

    const theirs = other.page;
    await theirs.goto('/en/my/membership');
    await expect(
      myList(theirs, 'history').getByRole('listitem').filter({ hasText: TEXT.open }),
    ).toContainText(copy('membership.status.application.rejected'));
    await expect(theirs.getByRole('main')).toContainText(
      copy('myMembership.memberships.empty'),
    );
    await apply(theirs, TEXT.open, 'submitted');
    expect((await applicationsOf(other.id, ids.open)).map((row) => row.status)).toEqual([
      'submitted',
      'rejected',
    ]);
  });

  test('an operator ends a Membership after confirming, and the member is told who ended it', async () => {
    test.setTimeout(300_000);
    // A Membership of the type created through the administration.
    await applicant.page.goto('/en/my/membership');
    await apply(applicant.page, TEXT.created, 'submitted');
    const { id } = await openApplication(applicant.id, createdId);
    const page = operator.page;
    await startReview(page, id);
    await decide(page, 'approve');

    await page.goto(`/en/admin/membership?type=${createdId}`);
    const main = page.getByRole('main');
    const members = main.getByRole('list', {
      name: copy('adminMembership.members.heading'),
      exact: true,
    });
    const member = members.getByRole('listitem').filter({ hasText: TEXT.applicant });
    await expect(member).toContainText(copy('membership.status.membership.active'));
    await expect(member).toContainText(TEXT.created);
    const close = member.getByRole('button', {
      name: copy('adminMembership.members.close'),
      exact: true,
    });
    await close.click();
    await expect(member.getByRole('alert')).toHaveText(
      copy('adminMembership.failure.confirmRequired'),
    );
    await member
      .getByLabel(copy('adminMembership.members.closeConfirm'), { exact: true })
      .check();
    await close.click();
    // Ended: no longer among the active members of this type.
    await expect(main).toContainText(copy('adminMembership.members.empty'));

    const [membership] = await sql.query<{ status: string; closureSource: string }>(
      `SELECT [status],[closureSource] FROM [dbo].[Membership] WHERE [memberUserId]=N'${applicant.id}' AND [membershipTypeId]=N'${createdId}';`,
    );
    expect(membership).toEqual({ status: 'closed', closureSource: 'operator' });
    // Ending it never edits the application that began it.
    expect((await applicationsOf(applicant.id, createdId))[0]?.status).toBe('approved');

    await page.goto(`/en/admin/membership?type=${createdId}&members=closed`);
    await expect(
      members.getByRole('listitem').filter({ hasText: TEXT.applicant }),
    ).toContainText(copy('membership.closureSource.operator'));

    const mine = applicant.page;
    await mine.goto('/en/my/membership');
    const ended = myList(mine, 'memberships')
      .getByRole('listitem')
      .filter({ hasText: TEXT.created });
    await expect(ended).toContainText(copy('membership.status.membership.closed'));
    await expect(ended).toContainText(copy('membership.closureSource.operator'));
    await expect(
      ended.getByRole('button', { name: copy('myMembership.close.submit') }),
    ).toHaveCount(0);
  });
});

/* ===========================================================================
 * 4. A member ends their own Membership
 * ========================================================================= */

test.describe('a member', () => {
  test('ends their own Membership after confirming, and may apply again', async () => {
    test.setTimeout(240_000);
    const page = applicant.page;
    await page.goto('/en/my/membership');
    const held = myList(page, 'memberships')
      .getByRole('listitem')
      .filter({ hasText: TEXT.open });
    await expect(held).toContainText(copy('membership.status.membership.active'));
    const close = held.getByRole('button', {
      name: copy('myMembership.close.submit'),
      exact: true,
    });

    await close.click();
    await expect(alertIn(page)).toHaveText(copy('myMembership.failure.confirmRequired'));
    await held.getByLabel(copy('myMembership.close.confirm'), { exact: true }).check();
    await close.click();
    await page.waitForURL(/\/en\/my\/membership\?done=closed$/u);
    await expect(page.getByRole('main')).toContainText(copy('myMembership.done.closed'));
    await expect(held).toContainText(copy('membership.status.membership.closed'));
    await expect(held).toContainText(copy('membership.closureSource.member'));

    const [membership] = await sql.query<{ status: string; closureSource: string }>(
      `SELECT [status],[closureSource] FROM [dbo].[Membership] WHERE [memberUserId]=N'${applicant.id}' AND [membershipTypeId]=N'${ids.open}';`,
    );
    expect(membership).toEqual({ status: 'closed', closureSource: 'member' });

    // The account is untouched, and the type is offered again.
    await apply(page, TEXT.open, 'submitted');
    await openApplication(applicant.id, ids.open);
    expect(
      await scalar(
        `SELECT COUNT_BIG(*) AS [value] FROM [dbo].[User] WHERE [id]=N'${applicant.id}' AND [status]=N'active';`,
      ),
    ).toBe(1);
  });
});

/* ===========================================================================
 * 5. Every surface: headings, labels, keyboard, words, direction
 * ========================================================================= */

test.describe('the Membership surfaces', () => {
  test('keep their heading outline, label every control and say every status in words', async ({
    page: visitor,
  }) => {
    test.setTimeout(300_000);
    const { id } = await openApplication(applicant.id, ids.open);
    for (const [page, target] of [
      [visitor, '/en/membership'],
      [applicant.page, '/en/my/membership'],
      [operator.page, '/en/admin/membership'],
      [operator.page, `/en/admin/membership?type=${createdId}`],
      [operator.page, '/en/admin/membership/applications'],
      [operator.page, detailPath(id)],
    ] as const) {
      const response = await page.goto(target);
      expect(response?.status(), target).toBe(200);
      await expect(mainHeading(page), target).toBeVisible();
      await expectHeadingsInOrder(page, target);
      await expectLabelledControls(page, target);
      await expectNoPaymentWords(page, target);
    }

    // Status is a word in the badge, never a colour alone.
    const page = applicant.page;
    await page.goto('/en/my/membership');
    await expect(
      myList(page, 'open').getByRole('listitem').filter({ hasText: TEXT.open }),
    ).toContainText(copy('membership.status.application.submitted'));
    const memberships = myList(page, 'memberships').getByRole('listitem');
    for (const title of [TEXT.open, TEXT.created])
      await expect(memberships.filter({ hasText: title }), title).toContainText(
        copy('membership.status.membership.closed'),
      );
    await operator.page.goto(detailPath(id));
    await expect(operator.page.getByRole('main')).toContainText(
      copy('membership.status.application.submitted'),
    );
  });

  test('the apply button is reached by keyboard alone, with a visible focus', async () => {
    test.setTimeout(120_000);
    const page = applicant.page;
    await page.goto('/en/my/membership');
    const target = applyButton(page, TEXT.long);
    await expect(target).toBeVisible();
    await tabTo(page, target);
    await expectVisibleFocus(target, 'the apply button');
  });

  test('My Membership and the administration are right-to-left in Urdu and Arabic, and My Membership reflows', async () => {
    test.setTimeout(300_000);
    for (const locale of ['ur', 'ar'] as const)
      for (const [page, target] of [
        [applicant.page, `/${locale}/my/membership`],
        [operator.page, `/${locale}/admin/membership`],
      ] as const) {
        const response = await page.goto(target);
        expect(response?.status(), target).toBe(200);
        await expect(page.locator('html'), target).toHaveAttribute('dir', 'rtl');
        await expect(page.locator('html'), target).toHaveAttribute('lang', locale);
        await expect(mainHeading(page), target).toBeVisible();
      }

    const page = applicant.page;
    for (const width of [320, 640]) {
      await page.setViewportSize({ width, height: 800 });
      for (const locale of ['en', 'ar'] as const) {
        const target = `/${locale}/my/membership`;
        const where = `${String(width)}px ${target}`;
        const response = await page.goto(target);
        expect(response?.status(), where).toBe(200);
        await expect(mainHeading(page), where).toBeVisible();
        expect(await overflowOf(page), where).toBeLessThanOrEqual(0);
        await expectHeadingsInOrder(page, where);
      }
    }
    await page.setViewportSize({ width: 1280, height: 800 });
  });
});
