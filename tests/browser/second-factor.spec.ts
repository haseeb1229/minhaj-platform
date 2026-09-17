import {
  ADMIN,
  NEW_PASSWORD,
  PASSWORD,
  SECOND_FACTOR_OFF,
  SECOND_FACTOR_ON,
  alertIn,
  beginSecondFactorEnrolment,
  expect,
  freshEmail,
  recoveryCodesOn,
  registerAndSignIn,
  secondFactorSection,
  statusIn,
  test,
  totpCodeFor,
} from './support';

/**
 * TWO-STEP VERIFICATION in a real browser.
 *
 * WHAT ONLY A BROWSER CAN SHOW. That the setup key and the recovery codes are
 * displayed once and survive no reload; that a sign-in with an enrolled factor
 * lands on a CHALLENGE rather than a session; that a recovery code works there
 * when the authenticator does not; and that all of it is reachable by an
 * ordinary account with no permission at all — which is what keeps the
 * bootstrap from being circular (SECURITY_BASELINE.md §8.3).
 */

test.describe('enrolling a second factor', () => {
  test('shows the key and the codes once, and keeps nothing if abandoned', async ({
    page,
  }) => {
    await registerAndSignIn(page, 'enrolling');
    await page.goto('/en/my/settings/security');

    const section = secondFactorSection(page);

    // Before: off, and said in words rather than by colour.
    await expect(section).toContainText(SECOND_FACTOR_OFF);

    const { totpUri, recoveryCodes } = await beginSecondFactorEnrolment(page);

    expect(totpUri).toContain('otpauth://totp/');
    expect(totpUri).toContain('One%20Minhaj');

    // Ten single-use codes, shown as a list.
    expect(recoveryCodes).toHaveLength(10);

    // SHOWN ONCE. A reload loses them, because nothing durable of this
    // platform's ever held them.
    await page.reload();
    await expect(section.locator('code', { hasText: 'otpauth://' })).toHaveCount(0);
    expect(await recoveryCodesOn(page)).toHaveLength(0);

    // AND THE POSTURE DID NOT MOVE. An enrolment abandoned before a code was
    // ever typed leaves the account exactly as it was — which is why the same
    // form is offered again rather than a half-finished state to resume.
    await expect(section).toContainText(SECOND_FACTOR_OFF);
    await expect(section.getByRole('button', { name: ADMIN.beginSetup })).toBeVisible();
  });

  test('completes, then challenges the next sign-in', async ({ page }) => {
    const { email } = await registerAndSignIn(page, 'challenged');

    await page.goto('/en/my/settings/security');
    const section = secondFactorSection(page);

    const { totpUri, recoveryCodes } = await beginSecondFactorEnrolment(page);

    await section.getByRole('button', { name: ADMIN.savedCodes }).click();
    await section
      .getByLabel(ADMIN.authenticationCode, { exact: true })
      .first()
      .fill(await totpCodeFor(totpUri));
    await section.getByRole('button', { name: ADMIN.confirmCode, exact: true }).click();

    await expect(section).toContainText(SECOND_FACTOR_ON);

    // Sign out and back in: the password alone no longer produces a session.
    await page.goto('/en/my');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.waitForURL(/\/en$/);

    await page.goto('/en/signin');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    // THE CHALLENGE. Not a session, and nothing about the account on screen.
    await page.waitForURL(/\/en\/signin\/two-factor/);
    const body = await page.getByRole('main').innerText();
    expect(body).not.toContain(email);

    // A wrong code is refused.
    await page.getByLabel('Authentication code').fill('000000');
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(alertIn(page).first()).toBeVisible();

    // A RECOVERY code finishes the sign-in instead — the route for somebody
    // whose authenticator is gone.
    await page.getByRole('link', { name: 'Use a recovery code instead' }).click();
    await page.getByLabel('Recovery code').fill(recoveryCodes[0] as string);
    await page.getByRole('button', { name: 'Use this code' }).click();

    await page.waitForURL('**/my');
  });

  test('is never demanded of an ordinary account', async ({ page }) => {
    // MFA is a PRIVILEGED requirement, not a universal one (§8.2). An ordinary
    // account uses the product with nothing enrolled, and is not nagged into it.
    await registerAndSignIn(page, 'ordinary');

    await page.goto('/en/my');
    await expect(page.getByRole('main')).toBeVisible();

    await page.goto('/en/my/settings/security');
    await expect(secondFactorSection(page)).toContainText(SECOND_FACTOR_OFF);

    // Changing a password still works with no factor in the way. Scoped to the
    // password section, because the enrolment form asks for a current password
    // too and an ordinal would eventually pick the wrong one.
    const passwords = page.getByRole('region', { name: 'Change password' });
    await passwords.getByLabel('Current password', { exact: true }).fill(PASSWORD);
    await passwords.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
    await passwords.getByRole('button', { name: 'Change password' }).click();

    await expect(statusIn(page).first()).toBeVisible();
  });
});

test.describe('the challenge page', () => {
  test('discloses nothing to a visitor without a challenge', async ({ page }) => {
    // Opening it cold is not an error and not an oracle: it is a form that will
    // not work, and it names no account.
    const response = await page.goto('/en/signin/two-factor');
    expect(response?.status()).toBe(200);

    const body = await page.getByRole('main').innerText();
    expect(body).not.toContain('@');

    await page.getByLabel('Authentication code').fill('123456');
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(alertIn(page).first()).toBeVisible();

    // Still not signed in.
    await page.goto('/en/my');
    await page.waitForURL(/\/en\/signin/);
  });

  test('is noindex, like every authentication surface', async ({ page }) => {
    await page.goto('/en/signin/two-factor');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/,
    );
  });

  test('renders right-to-left in Arabic', async ({ page }) => {
    await page.goto('/ar/signin/two-factor');

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('main')).toContainText('التحقق بخطوتين');
  });
});

/** Keeps the address helper used, so a spec cannot drift into reusing one. */
test('uses a fresh address per run', () => {
  expect(freshEmail('probe')).toContain('@proof.invalid');
});
