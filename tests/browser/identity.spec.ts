import {
  BUTTON,
  LABEL,
  NEW_PASSWORD,
  PASSWORD,
  confirmVerification,
  emailChangeLink,
  alertIn,
  expect,
  freshEmail,
  newDevice,
  registerAndSignIn,
  resetLink,
  signIn,
  signOut,
  signUp,
  statusIn,
  test,
  verificationLink,
} from './support.ts';

/**
 * PHASE 2 CHUNK 1 — the journeys, in a real browser.
 *
 * WHAT IS PROVED HERE AND NOWHERE ELSE. The Vitest suites prove the services,
 * the adapters and the database behaviour thoroughly, and they prove them
 * faster. What they cannot prove is what a browser does: that following an
 * emailed link with a real client consumes nothing, that a session cookie
 * survives a navigation and dies on sign-out, that a form is operable from the
 * keyboard, and that Urdu and Arabic render right-to-left.
 *
 * Those are Phase-2 claims, and a claim about a browser needs a browser.
 */

test.describe('registration and verification', () => {
  test('creates an account, verifies it, and signs in', async ({ page }) => {
    const email = freshEmail('journey');

    await page.goto('/en/signup');
    await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible();

    await page.getByLabel(LABEL.name).fill('Journey Proof');
    await page.getByLabel(LABEL.email).fill(email);
    await page.getByLabel(LABEL.password, { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: BUTTON.signUp }).click();

    // The SAME message whether or not the address was already registered.
    await expect(statusIn(page)).toContainText('Check your email');

    await confirmVerification(page, email);
    await signIn(page, email, PASSWORD);

    await expect(page.getByText(email)).toBeVisible();
  });

  test('a GET on the verification link consumes NOTHING', async ({ page }) => {
    const email = freshEmail('scanner');
    await signUp(page, email, PASSWORD);

    const link = await verificationLink(email);

    // THE CLASS-D PROPERTY, with a real client. A mail scanner, a link
    // prefetcher or a security appliance fetches the URL — repeatedly — and
    // the link the person is about to click must still work
    // (SECURITY_BASELINE.md §7.4).
    for (let visit = 0; visit < 3; visit += 1) {
      const response = await page.request.get(link);
      expect(response.ok()).toBe(true);
    }

    await page.goto(link);
    await page.getByRole('button', { name: BUTTON.confirmAddress }).click();
    await expect(statusIn(page)).toContainText('confirmed');

    // And it is single use: the link is dead the second time.
    await page.goto(link);
    await expect(alertIn(page)).toBeVisible();
  });

  test('offers a resend when a link is not usable', async ({ page }) => {
    const email = freshEmail('resend');

    await page.goto(
      `/en/verify-email?email=${encodeURIComponent(email)}&token=${'x'.repeat(43)}`,
    );

    await expect(alertIn(page)).toBeVisible();
    await expect(
      page.getByRole('button', { name: BUTTON.sendAnotherLink }),
    ).toBeVisible();
  });

  test('refuses an incomplete link without saying more', async ({ page }) => {
    await page.goto('/en/verify-email');
    await expect(alertIn(page)).toContainText('incomplete');
  });

  test('refuses to sign in before the address is confirmed', async ({ page }) => {
    const email = freshEmail('unverified');
    await signUp(page, email, PASSWORD);

    await page.goto('/en/signin');
    await page.getByLabel(LABEL.email).fill(email);
    await page.getByLabel(LABEL.password, { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: BUTTON.signIn, exact: true }).click();

    await expect(alertIn(page)).toBeVisible();
  });
});

test.describe('sign-in and sessions', () => {
  test('refuses a wrong password without saying which half was wrong', async ({
    page,
  }) => {
    const { email } = await registerAndSignIn(page, 'wrong-password');
    await signOut(page);

    await page.goto('/en/signin');
    await page.getByLabel(LABEL.email).fill(email);
    await page
      .getByLabel(LABEL.password, { exact: true })
      .fill('not-the-right-one-at-all');
    await page.getByRole('button', { name: BUTTON.signIn, exact: true }).click();
    const known = await alertIn(page).textContent();

    await page.goto('/en/signin');
    await page.getByLabel(LABEL.email).fill(freshEmail('nobody'));
    await page
      .getByLabel(LABEL.password, { exact: true })
      .fill('not-the-right-one-at-all');
    await page.getByRole('button', { name: BUTTON.signIn, exact: true }).click();

    // Identical prose for "no such account" and "wrong password".
    expect(await alertIn(page).textContent()).toBe(known);
  });

  test('signs out, and the protected page is no longer reachable', async ({ page }) => {
    await registerAndSignIn(page, 'signout');
    await signOut(page);

    // The cookie is gone, so `/my` sends the visitor to sign in rather than
    // rendering anything.
    await page.goto('/en/my');
    await page.waitForURL(/\/signin/);
  });

  test('lists active sessions and signs one of them out', async ({
    browser,
    clientAddress,
    page,
  }) => {
    const { email } = await registerAndSignIn(page, 'sessions');

    // A genuinely separate context — its own cookie jar, which is what makes
    // it a different device rather than a second tab.
    const other = await newDevice(browser, clientAddress);
    await signIn(other.page, email, PASSWORD);

    await page.goto('/en/my/settings/security');

    const sessions = page.getByRole('list', { name: 'Active sessions' });
    await expect(sessions.getByRole('listitem')).toHaveCount(2);

    // Exactly one row is marked as this device, and it carries no sign-out
    // button — a person must not be able to strand themselves from here.
    await expect(page.getByText('This device')).toHaveCount(1);
    await expect(sessions.getByRole('button', { name: BUTTON.signOut })).toHaveCount(1);

    await sessions.getByRole('button', { name: BUTTON.signOut }).click();

    // The list shrinking IS the completion signal. There is no success banner
    // for this action, and asserting on the other device before the action has
    // finished would be a race that passes or fails by timing.
    await expect(sessions.getByRole('listitem')).toHaveCount(1);

    await other.page.goto('/en/my');
    await other.page.waitForURL(/\/signin/);

    await page.goto('/en/my');
    await expect(page.getByText(email)).toBeVisible();

    await other.context.close();
  });

  test('signs out everywhere else in one action', async ({
    browser,
    clientAddress,
    page,
  }) => {
    const { email } = await registerAndSignIn(page, 'revoke-others');

    const devices = [
      await newDevice(browser, clientAddress),
      await newDevice(browser, clientAddress),
    ];

    for (const device of devices) await signIn(device.page, email, PASSWORD);

    await page.goto('/en/my/settings/security');

    const sessions = page.getByRole('list', { name: 'Active sessions' });
    await expect(sessions.getByRole('listitem')).toHaveCount(3);

    await page.getByRole('button', { name: BUTTON.revokeOthers }).click();

    // THE OBSERVABLE OUTCOME, not a banner. Success is what removes the other
    // sessions, so the list collapsing to this device and the polite "No other
    // sessions." notice replacing the button ARE the completion signal — the
    // same shape the revoke-one proof above relies on.
    //
    // Both halves matter: the count proves the revocation reached the
    // database, and the notice proves the page re-rendered rather than leaving
    // a stale list on screen.
    await expect(sessions.getByRole('listitem')).toHaveCount(1);
    await expect(statusIn(page).filter({ hasText: 'No other sessions' })).toBeVisible();

    for (const device of devices) {
      await device.page.goto('/en/my');
      await device.page.waitForURL(/\/signin/);
    }

    await page.goto('/en/my');
    await expect(page.getByText(email)).toBeVisible();

    for (const device of devices) await device.context.close();
  });
});

test.describe('returnTo', () => {
  test('returns to a validated destination after signing in', async ({ page }) => {
    const { email } = await registerAndSignIn(page, 'return-good');
    await signOut(page);

    await page.goto('/en/signin?returnTo=%2Fen%2Fmy%2Fsettings%2Fprofile');
    await page.getByLabel(LABEL.email).fill(email);
    await page.getByLabel(LABEL.password, { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: BUTTON.signIn, exact: true }).click();

    await page.waitForURL('**/my/settings/profile');
  });

  test('refuses to leave the site, whatever the destination looks like', async ({
    page,
  }) => {
    const { email } = await registerAndSignIn(page, 'return-hostile');

    // Three shapes, not thirty: the exhaustive hostile-input table is proved
    // directly against `safeReturnTo` in `tests/identity/protocol.test.ts`.
    // What a browser adds is that the REDIRECT actually lands where the rule
    // says — and each attempt costs a sign-in from a real budget.
    for (const hostile of [
      'https://evil.example/steal',
      '//evil.example',
      '/\\evil.example',
    ]) {
      await signOut(page);

      await page.goto(`/en/signin?returnTo=${encodeURIComponent(hostile)}`);
      await page.getByLabel(LABEL.email).fill(email);
      await page.getByLabel(LABEL.password, { exact: true }).fill(PASSWORD);
      await page.getByRole('button', { name: BUTTON.signIn, exact: true }).click();

      // An open redirect under a trusted domain is a phishing primitive. Every
      // one of these lands on the safe fallback instead.
      await page.waitForURL('**/en/my');
      expect(new URL(page.url()).pathname).toBe('/en/my');
    }
  });
});

test.describe('passwords', () => {
  test('resets a forgotten password through the emailed link', async ({ page }) => {
    const { email } = await registerAndSignIn(page, 'reset');
    await signOut(page);

    await page.goto('/en/forgot-password');
    await page.getByLabel(LABEL.email).fill(email);
    await page.getByRole('button', { name: BUTTON.sendResetLink }).click();
    await expect(statusIn(page)).toBeVisible();

    const link = await resetLink(email);

    // The GET renders and consumes nothing here too.
    expect((await page.request.get(link)).ok()).toBe(true);

    await page.goto(link);
    await page.getByLabel(LABEL.newPassword).fill(NEW_PASSWORD);
    await page.getByRole('button', { name: BUTTON.saveNewPassword }).click();
    await expect(statusIn(page)).toBeVisible();

    await signIn(page, email, NEW_PASSWORD);
    await expect(page.getByText(email)).toBeVisible();
  });

  test('changes the password and keeps THIS device signed in', async ({ page }) => {
    const { email } = await registerAndSignIn(page, 'change-password');

    await page.goto('/en/my/settings/security');
    await page.locator('#currentPassword').fill(PASSWORD);
    await page.locator('#newPassword').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: BUTTON.changePassword }).click();
    await expect(
      statusIn(page).filter({ hasText: 'password has been changed' }),
    ).toBeVisible();

    // THE ROTATION. The library replaces every session for the account — this
    // one included — and the replacement cookie has to reach the browser, or
    // the person is signed out one request after being told it worked.
    await page.goto('/en/my');
    await expect(page.getByText(email)).toBeVisible();

    await signOut(page);
    await signIn(page, email, NEW_PASSWORD);
  });

  test('refuses a wrong current password and changes nothing', async ({ page }) => {
    const { email } = await registerAndSignIn(page, 'change-refused');

    await page.goto('/en/my/settings/security');
    await page.locator('#currentPassword').fill('not-the-current-password');
    await page.locator('#newPassword').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: BUTTON.changePassword }).click();

    await expect(alertIn(page)).toBeVisible();

    await signOut(page);
    await signIn(page, email, PASSWORD);
  });
});

test.describe('email change', () => {
  test('moves the address once the new one proves itself', async ({ page }) => {
    const { email } = await registerAndSignIn(page, 'change-email');
    const destination = freshEmail('destination');

    await page.goto('/en/my/settings/security');
    await page.getByLabel(LABEL.newEmail).fill(destination);
    await page.locator('#emailCurrentPassword').fill(PASSWORD);
    await page.getByRole('button', { name: BUTTON.changeEmail }).click();

    // The SPECIFIC message, not merely "a status region appeared". This page
    // renders a permanent status — the "No other sessions." notice — so a
    // generic wait resolves instantly and races ahead of the submission.
    await expect(statusIn(page).filter({ hasText: 'confirmation link' })).toBeVisible();

    await page.goto(await emailChangeLink(email, destination));
    await page.getByRole('button', { name: BUTTON.confirmAddress }).click();
    await expect(statusIn(page).filter({ hasText: 'has been changed' })).toBeVisible();

    await page.goto('/en/my');
    await expect(page.getByText(destination)).toBeVisible();
  });

  test('costs the password, not merely a live session', async ({ page }) => {
    const { email } = await registerAndSignIn(page, 'change-stepup');
    const destination = freshEmail('destination');

    await page.goto('/en/my/settings/security');
    await page.getByLabel(LABEL.newEmail).fill(destination);
    await page.locator('#emailCurrentPassword').fill('not-the-password');
    await page.getByRole('button', { name: BUTTON.changeEmail }).click();

    await expect(alertIn(page)).toBeVisible();

    // Nothing moved, and the account still answers to its original address.
    await page.goto('/en/my');
    await expect(page.getByText(email)).toBeVisible();
  });

  test('needs a session as well as the link', async ({
    browser,
    clientAddress,
    page,
  }) => {
    const { email } = await registerAndSignIn(page, 'change-needs-session');
    const destination = freshEmail('destination');

    await page.goto('/en/my/settings/security');
    await page.getByLabel(LABEL.newEmail).fill(destination);
    await page.locator('#emailCurrentPassword').fill(PASSWORD);
    await page.getByRole('button', { name: BUTTON.changeEmail }).click();
    await expect(statusIn(page).filter({ hasText: 'confirmation link' })).toBeVisible();

    const link = await emailChangeLink(email, destination);

    // A signed-OUT visitor holding the link — somebody who intercepted the
    // message — is told to sign in and moves nobody's address. Every recovery
    // path runs through the account address, which is what makes it the most
    // valuable thing to take.
    const stranger = await newDevice(browser, clientAddress);

    await stranger.page.goto(link);
    await expect(
      statusIn(stranger.page).filter({ hasText: 'Sign in to the account' }),
    ).toBeVisible();
    await expect(
      stranger.page.getByRole('button', { name: BUTTON.confirmAddress }),
    ).toHaveCount(0);

    await stranger.context.close();
  });
});

test.describe('closure and clean re-registration', () => {
  test('closes an account and frees the address for a NEW one', async ({ page }) => {
    const { email } = await registerAndSignIn(page, 'closure');

    await page.goto('/en/my/settings/security');
    await page.getByLabel(LABEL.closeConfirm).fill(PASSWORD);
    await page.getByRole('button', { name: BUTTON.closeAccount }).click();
    await page.waitForURL(/\/en$/);

    // Signed out everywhere, and the old credential no longer works.
    await page.goto('/en/signin');
    await page.getByLabel(LABEL.email).fill(email);
    await page.getByLabel(LABEL.password, { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: BUTTON.signIn, exact: true }).click();
    await expect(alertIn(page)).toBeVisible();

    // The SAME address registers again, and the account it creates starts from
    // nothing (DOMAIN_MODEL.md §4.6).
    await signUp(page, email, NEW_PASSWORD);
    await confirmVerification(page, email);
    await signIn(page, email, NEW_PASSWORD);

    await expect(page.getByText(email)).toBeVisible();
  });

  test('refuses closure without the password', async ({ page }) => {
    await registerAndSignIn(page, 'closure-refused');

    await page.goto('/en/my/settings/security');
    await page.getByLabel(LABEL.closeConfirm).fill('not-the-password');
    await page.getByRole('button', { name: BUTTON.closeAccount }).click();

    await expect(alertIn(page)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Security' })).toBeVisible();
  });
});

test.describe('sign-in methods', () => {
  test('shows the credential method and NO Google affordance', async ({ page }) => {
    await registerAndSignIn(page, 'methods');

    await page.goto('/en/my/settings/security');

    await expect(page.getByText('Email and password')).toBeVisible();
    await expect(page.getByText('only way to sign in')).toBeVisible();

    // Phase 2G's, and absent until it works. An affordance that does nothing
    // invites somebody to rely on it.
    await expect(page.getByText(/google/i)).toHaveCount(0);
  });
});

test.describe('the webhook path', () => {
  test('is not reachable by GET, and refuses an unsigned POST', async ({ page }) => {
    // Protocol class B. The whole authentication of this path is a signature
    // over the raw body, so an unsigned request is an unauthenticated one —
    // and it is refused rather than degraded (SECURITY_BASELINE.md §7.2).
    expect((await page.request.get('/api/webhooks/resend')).status()).toBe(405);

    const unsigned = await page.request.post('/api/webhooks/resend', {
      data: { type: 'email.bounced', data: { to: ['victim@proof.invalid'] } },
    });

    expect(unsigned.status()).toBe(401);
  });
});
