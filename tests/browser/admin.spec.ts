import type { Page } from '@playwright/test';

import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';

import {
  ADMIN,
  ADMINISTRATOR_STATE,
  PASSWORD,
  accountIdFor,
  alertIn,
  baseUrl,
  bootstrapAdministrator,
  enrolSecondFactorInBrowser,
  expect,
  privilegedSession,
  registerAndSignIn,
  signIn,
  statusIn,
  test,
  totpCodeFor,
} from './support';

/**
 * PHASE 2 CHUNK 2 in a real browser.
 *
 * WHAT ONLY A BROWSER CAN SHOW. That an unauthorised account is refused the
 * route rather than shown a partial page; that the step-up prompt and the
 * privileged action are two separate server round trips; that granting a role
 * signs the other person out on their own device; that the bootstrap surface
 * offers no button; and that all of it renders right-to-left in Urdu.
 *
 * THE BOOTSTRAP HAPPENS AGAINST THE DATABASE, because it has no HTTP path by
 * design (SECURITY_BASELINE.md §8.3). Everything after it is the product.
 *
 * SERIAL, AND DELIBERATELY SO. The bootstrap is a singleton — the
 * `IdentityBootstrap` primary key and its CHECK constraint permit exactly one
 * row, for the whole life of the database — so this file has exactly one
 * administrator and every privileged test is that same person. Running the
 * file in one worker, in order, is what lets the account be created once and
 * then reused; the other spec files still run in parallel with it.
 */

test.describe.configure({ mode: 'serial' });

let sql: SqlSession;

/** The one administrator, and the setup key each step-up needs a code from. */
let administrator: { email: string; totpUri: string };

/**
 * A client address for the bootstrap, outside the per-test space.
 *
 * The per-test addresses are derived from test titles; this one is fixed and
 * distinct, so the setup work never spends a budget a test is relying on.
 */
const BOOTSTRAP_CLIENT = '100.64.255.1';

test.beforeAll(async ({ browser }) => {
  sql = await privilegedSession();

  const context = await browser.newContext({
    baseURL: baseUrl(),
    extraHTTPHeaders: { 'x-forwarded-for': BOOTSTRAP_CLIENT },
  });
  const page = await context.newPage();

  const { email } = await registerAndSignIn(page, 'admin');
  await bootstrapAdministrator(sql, await accountIdFor(sql, email));

  // THE ROLE IS HELD IMMEDIATELY; THE CAPABILITIES ARE NOT. The dashboard says
  // so before it says anything else, which is the one thing a freshly
  // bootstrapped administrator most needs to be told (§8.3).
  await page.goto('/en/admin');
  await expect(statusIn(page).first()).toContainText('two-step verification');

  const enrolment = await enrolSecondFactorInBrowser(page);
  administrator = { email, totpUri: enrolment.totpUri };

  // The signed-in cookie jar every privileged test below starts from.
  await context.storageState({ path: ADMINISTRATOR_STATE });
  await context.close();
});

test.afterAll(async () => {
  await sql?.close();
});

/**
 * THE polite status region that says a particular thing.
 *
 * NOT `.first()`. An administrative page carries several forms, each with its
 * own result region, and the step-up prompt sits above all of them — so the
 * first status on the page after a successful mutation is the step-up saying
 * "Confirmed", not the mutation saying what it did. Asking for the region
 * whose text is the one expected keeps each assertion about its own form.
 */
function announced(page: Page, text: string) {
  return statusIn(page).filter({ hasText: text });
}

/** Earns a step-up grant on whichever administrative page is open. */
async function stepUp(page: Page) {
  await page.getByLabel(ADMIN.password, { exact: true }).first().fill(PASSWORD);
  await page
    .getByLabel(ADMIN.authenticationCode, { exact: true })
    .first()
    .fill(await totpCodeFor(administrator.totpUri));
  await page.getByRole('button', { name: ADMIN.stepUp, exact: true }).first().click();

  await expect(announced(page, 'Confirmed')).toBeVisible();
}

test.describe('administrative routes', () => {
  test('refuses an account that holds no permission, without confirming the route', async ({
    page,
  }) => {
    await registerAndSignIn(page, 'nobody');

    // 404, not 403: a 403 would confirm the route exists and that somebody may
    // use it, which is a map of the platform's privileged shape handed to
    // anyone with an account (SECURITY_BASELINE.md §1.5).
    const response = await page.goto('/en/admin/identity/users');
    expect(response?.status()).toBe(404);

    // Phase 4's surface is gated the same way and refuses the same way. It
    // discloses the platform's route shape, including reserved routes nothing
    // public links to, so "read-only" is not a reason to leave it open.
    const navigation = await page.goto('/en/admin/system/navigation');
    expect(navigation?.status()).toBe(404);

    // The root is a route too. It must not render an administrative shell to
    // an account with no administrative permission.
    const root = await page.goto('/en/admin');
    expect(root?.status()).toBe(404);
    await expect(page.getByRole('navigation')).toHaveCount(0);
  });

  test('sends a signed-out visitor to sign in, and back again', async ({ page }) => {
    await page.goto('/en/admin/identity/users');
    await page.waitForURL(/\/en\/signin\?returnTo=/);
  });
});

test.describe('the privileged administrator', () => {
  // EVERY TEST BELOW IS THE BOOTSTRAPPED ADMINISTRATOR, already signed in.
  test.use({ storageState: ADMINISTRATOR_STATE });

  test('reads every surface its role reaches', async ({ page }) => {
    await page.goto('/en/admin');
    await expect(page.getByRole('main')).toContainText('Accounts');

    await page.goto('/en/admin/identity/permissions');
    await expect(page.getByRole('main')).toContainText('permissions.grant');
    await expect(page.getByRole('main')).toContainText('Read-only');

    await page.goto('/en/admin/identity/roles');
    await expect(page.getByRole('main')).toContainText('Platform Administrator');
    await expect(page.getByRole('main')).toContainText('Protected system role');

    // The protected role offers no controls at all — not disabled ones. A
    // disabled control would be a client-side rule, and this platform's rule
    // is that the markup does not offer what the server would refuse.
    const protectedRole = page
      .getByRole('listitem')
      .filter({ hasText: 'Protected system role' });
    await expect(
      protectedRole.getByRole('button', { name: 'Deactivate the role' }),
    ).toHaveCount(0);

    await page.goto('/en/admin/identity/assignments');
    await expect(page.getByRole('main')).toContainText('platform-administrator');

    await page.goto('/en/admin/system/audit');
    await expect(page.getByRole('main')).toContainText('identity.bootstrap.completed');

    await page.goto('/en/admin/communications/delivery');
    await expect(page.getByRole('main')).toContainText('Pending');

    await page.goto('/en/admin/identity/users');
    await expect(page.getByRole('main')).toContainText(administrator.email);
  });

  /**
   * PHASE 4 — the navigation status surface, read by the one account that may.
   *
   * It lives here rather than in the shell spec because the bootstrap is a
   * singleton by database constraint: there is exactly one administrator for
   * the life of a database, and this file is where that person exists. The
   * refusal half — an ordinary account reaching the same URL — is proved
   * alongside the other unauthorised-route cases above.
   */
  test('reads the navigation status, and is offered nothing to change', async ({
    page,
  }) => {
    await page.goto('/en/admin/system/navigation');

    const main = page.getByRole('main');

    // A DELIVERED route, a RESERVED placeholder and a DEFERRED domain, each
    // reported as what it is. The third is the one that matters: the shell
    // must be able to say "not built yet" about a promised domain without
    // linking to it anywhere.
    await expect(main).toContainText('Delivered');
    await expect(main).toContainText('Reserved');
    await expect(main).toContainText('Deferred');
    await expect(main).toContainText('No route yet');

    // The posture this deployment is actually in, stated on the screen.
    await expect(main).toContainText('Public indexing is disabled');

    // READ-ONLY, AND NOT BY OMISSION. No form, no submit control, no editor:
    // the registry is code, so there is no mutation contract to expose and a
    // Save button would be a promise nothing keeps.
    await expect(main.getByRole('button')).toHaveCount(0);
    await expect(main.getByRole('textbox')).toHaveCount(0);
    await expect(main.locator('form')).toHaveCount(0);
  });

  test('shows bootstrap status and offers no way to perform it', async ({ page }) => {
    await page.goto('/en/admin/identity/security');

    await expect(page.getByRole('main')).toContainText('Completed');
    await expect(page.getByRole('main')).toContainText('BROWSER-PROOF');

    // READ-ONLY, structurally. Nothing on this page submits anything.
    await expect(page.getByRole('main').getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('main')).toContainText('host-only');
  });

  test('never displays a provider credential', async ({ page }) => {
    await page.goto('/en/admin/system/integrations');

    await expect(page.getByRole('main')).toContainText('Sender address');

    // The environment's synthetic secrets, and anything shaped like a key.
    const body = (await page.getByRole('main').innerText()).toLowerCase();
    expect(body).not.toContain('synthetic-browser-suite');
    expect(body).not.toMatch(/re_[a-z0-9]/);
    expect(body).toContain('credentials are never displayed');
  });

  test('renders the administrative shell right-to-left in Urdu', async ({ page }) => {
    await page.goto('/ur/admin/identity/permissions');

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ur');

    // Translated, not the English fallback.
    await expect(page.getByRole('main')).toContainText('اجازتیں');
  });

  test('gives every administrative table a caption and column headers', async ({
    page,
  }) => {
    await page.goto('/en/admin/system/audit');

    const table = page.getByRole('table').first();
    await expect(table).toBeVisible();
    await expect(table.locator('caption')).toHaveCount(1);
    await expect(table.getByRole('columnheader')).not.toHaveCount(0);
  });

  test('is operable from the keyboard', async ({ page }) => {
    // ON A SURFACE THAT HAS CONTROLS. The dashboard of an account holding no
    // permission is, correctly, a heading and a sentence saying there is
    // nothing — so "tab reaches something" would be asserting a control that
    // ought not to exist. The roles surface is where an administrator actually
    // works, and it is the one that has to be operable without a mouse.
    await page.goto('/en/admin/identity/roles');

    await page.keyboard.press('Tab');
    const focused = page.locator(':focus');
    await expect(focused).toHaveCount(1);

    // A REAL control, not a div somebody made clickable — which looks
    // identical on screen and is unreachable by keyboard and screen reader
    // alike.
    expect(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']).toContain(
      await focused.evaluate((element) => element.tagName),
    );
  });
});

test.describe('a privileged mutation, end to end', () => {
  test.use({ storageState: ADMINISTRATOR_STATE });

  test('requires step-up, then grants a role and signs the other person out', async ({
    page,
    browser,
    clientAddress,
  }) => {
    // A second person, signed in on their own device.
    const other = await browser.newContext({
      baseURL: baseUrl(),
      extraHTTPHeaders: { 'x-forwarded-for': clientAddress },
    });
    const otherPage = await other.newPage();
    const { email: otherEmail } = await registerAndSignIn(otherPage, 'grantee');
    const otherId = await accountIdFor(sql, otherEmail);

    // A custom role to grant. Creating one needs a step-up first.
    await page.goto('/en/admin/identity/roles');

    const roleKey = `browser-${Date.now()}`;
    const fillNewRole = async () => {
      await page.getByLabel('Key', { exact: true }).fill(roleKey);
      await page.getByLabel('Name', { exact: true }).first().fill('Browser proof role');
      await page
        .getByLabel('Description', { exact: true })
        .first()
        .fill('Created by the browser proof.');
      await page.getByRole('checkbox', { name: 'audit.read' }).first().check();
    };

    // WITHOUT a step-up: refused, and the refusal says what would work.
    await fillNewRole();
    await page.getByRole('button', { name: ADMIN.createRole }).click();
    await expect(alertIn(page).first()).toContainText('Confirm it is you');

    // WITH a step-up: accepted. TWO SEPARATE ROUND TRIPS — proving who you are
    // and making the change are different requests, and the second one checks
    // the permission, the posture and the grant again on the server.
    await stepUp(page);
    await fillNewRole();
    await page.getByRole('button', { name: ADMIN.createRole }).click();
    await expect(announced(page, 'role was created')).toBeVisible();

    // Grant it, and watch the other person's session end.
    await page.goto('/en/admin/identity/assignments');
    await stepUp(page);

    await page.getByLabel('Account identifier').fill(otherId);
    await page
      .getByLabel('Role', { exact: true })
      .selectOption({ label: 'Browser proof role' });
    await page.getByLabel('Reason or ticket').fill('BROWSER-PROOF grant');
    await page.getByRole('button', { name: ADMIN.grantRole }).click();
    await expect(announced(page, 'signed out')).toBeVisible();

    // THE OTHER DEVICE. A privilege change revokes the affected account's
    // sessions, so their next navigation is a sign-in page — the consequence
    // that only a second browser context can show.
    await otherPage.goto('/en/my');
    await otherPage.waitForURL(/\/en\/signin/);

    // Signing in again, the new authority is live immediately.
    await signIn(otherPage, otherEmail, PASSWORD);
    const audit = await otherPage.goto('/en/admin/system/audit');
    expect(audit?.status()).toBe(200);

    await other.close();
  });
});
