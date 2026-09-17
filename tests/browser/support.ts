import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import {
  expect,
  test as base,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';

import {
  openSession,
  parseSqlServerUrl,
  type SqlSession,
} from '../../packages/database/src/lifecycle/sql-connection.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

/**
 * Support for the browser suite.
 *
 * HOW A SPEC GETS AN EMAILED LINK. Not from an outbox — there is none, and a
 * production table holding rendered links would be exactly the second durable
 * bearer store the architecture forbids. The spec re-materialises the
 * outstanding token through the SAME narrow, server-only operation a delivery
 * retry uses (ARCHITECTURE.md §4.6.1), against the same disposable database
 * the application under test is using.
 *
 * That is not a shortcut around the product. It is the product's own
 * mechanism, exercised from the test process, so the link a spec follows is
 * byte-for-byte the link the message would have carried.
 */

interface BrowserEnvironment {
  readonly databaseUrl: string;
  readonly databaseName: string;
  readonly port: number;
  readonly AUTH_SECRETS: string;
  readonly RATE_LIMIT_DIGEST_KEY: string;
  readonly EMAIL_DIGEST_KEY: string;
}

let environment: BrowserEnvironment | null = null;

/** The configuration `scripts/browser-server.mjs` wrote for this run. */
export function browserEnvironment(): BrowserEnvironment {
  environment ??= JSON.parse(
    readFileSync(path.join(repoRoot, 'test-results', 'browser-environment.json'), 'utf8'),
  ) as BrowserEnvironment;

  return environment;
}

/** Where the application under test is listening, as an absolute origin. */
export function baseUrl(): string {
  return `http://127.0.0.1:${browserEnvironment().port}`;
}

/**
 * Where the one bootstrapped administrator's signed-in state is kept.
 *
 * WHY A SAVED SESSION RATHER THAN SIGNING IN AGAIN. Two real constraints meet
 * here. The bootstrap is a SINGLETON by database constraint — exactly one
 * account can ever be made the first administrator — so every privileged spec
 * has to be the same person. And sign-in is rate limited per account, five in
 * fifteen minutes, so a suite that signed that person in once per test would
 * start failing on the sixth for a reason unrelated to anything it proves.
 *
 * Reusing the cookie jar is also what a person does: they sign in once and
 * keep working. The sign-in-with-a-factor path is proved on its own, in the
 * spec that exists for it.
 */
export const ADMINISTRATOR_STATE = path.join(
  repoRoot,
  'test-results',
  'browser-administrator.json',
);

/* ===========================================================================
 * Client identity
 * ========================================================================= */

/**
 * A client address of this test's own.
 *
 * THE LIMITER IS REAL, and its per-client budget is real too: sign-up permits
 * five per client per hour. A suite that presented itself as one client would
 * exhaust that budget after five accounts and then report "rate limited" as
 * the outcome of every later proof — a suite failing for a reason unrelated to
 * anything it tests.
 *
 * The app under test runs with `TRUST_PROXY_HEADERS=true`, which is its
 * DEPLOYED posture: NGINX terminates and sets the forwarding header. Supplying
 * one per test is therefore not a bypass — it is the suite behaving like the
 * many different visitors it is standing in for.
 *
 * Derived from the test title, so it is stable across a retry: a retried test
 * gets its own budget back rather than inheriting a spent one.
 *
 * 100.64.0.0/10 is RFC 6598 shared address space — routable nowhere, and
 * belonging to nobody.
 */
export function clientAddressFor(testInfo: TestInfo): string {
  const digest = createHash('sha256').update(testInfo.titlePath.join(' > ')).digest();

  return `100.64.${digest[0] ?? 0}.${digest[1] ?? 1}`;
}

/**
 * The suite's `test`, with one client address per test.
 *
 * Overriding `context` rather than `page` so that everything the test opens —
 * including a second "device" — shares the identity, unless the test asks for
 * a different one.
 */
export const test = base.extend<{ clientAddress: string }>({
  clientAddress: async ({ baseURL }, use, testInfo) => {
    // `baseURL` is destructured only to give the fixture a dependency it can
    // name: Playwright fixtures take a dependency object, and an empty pattern
    // is the shape ESLint rejects.
    void baseURL;

    await use(clientAddressFor(testInfo));
  },

  context: async ({ browser, contextOptions, clientAddress }, use) => {
    // `contextOptions` FIRST, so the project's own configuration survives —
    // `baseURL`, which is what makes every relative `goto` in this suite work,
    // and `storageState` where a spec asks for one. Constructing the options
    // from scratch here silently dropped both.
    const context = await browser.newContext({
      ...contextOptions,
      extraHTTPHeaders: {
        ...contextOptions.extraHTTPHeaders,
        'x-forwarded-for': clientAddress,
      },
    });

    await use(context);
    await context.close();
  },
});

export { expect };

/* ===========================================================================
 * Regions
 * ========================================================================= */

/**
 * The APPLICATION's alert region, not the framework's.
 *
 * Next renders its own route announcer as `role="alert"` at the document
 * level — permanently present, and empty except during a navigation. A bare
 * `getByRole('alert')` therefore matches it as well as the form's message,
 * which makes "an error was announced" pass on a page with no error at all.
 *
 * Scoping to `<main>` picks the one the product owns. The announcer sits
 * outside it, which is exactly why the scope is a reliable discriminator
 * rather than a fragile one.
 */
export function alertIn(page: Page): Locator {
  return page.getByRole('main').getByRole('alert');
}

/** The application's polite status region, scoped the same way. */
export function statusIn(page: Page): Locator {
  return page.getByRole('main').getByRole('status');
}

/**
 * A second device for the SAME person.
 *
 * Its own cookie jar — which is what makes it a device rather than a tab — and
 * the same client address, because it is the same visitor.
 */
export async function newDevice(
  browser: Browser,
  clientAddress: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    extraHTTPHeaders: { 'x-forwarded-for': clientAddress },
  });

  return { context, page: await context.newPage() };
}

/* ===========================================================================
 * Tokens
 * ========================================================================= */

type TokenPurpose = 'email-verification' | 'password-reset';

let mechanics: {
  materialiseOutstandingToken(input: {
    purpose: TokenPurpose;
    email: string;
  }): Promise<{ token: string } | null>;
  materialiseEmailChangeToken(input: {
    currentEmail: string;
    newEmail: string;
  }): Promise<{ token: string } | null>;
} | null = null;

/**
 * Builds the auth-mechanics adapter against the run's database.
 *
 * Imported DYNAMICALLY and after `DATABASE_URL` is set, because the Prisma
 * client is a process-wide singleton bound at first use.
 */
async function authMechanics() {
  if (mechanics !== null) return mechanics;

  const configuration = browserEnvironment();
  process.env['DATABASE_URL'] = configuration.databaseUrl;

  const { createAuthMechanicsAdapter } =
    await import('../../packages/database/src/adapters/identity-access/index.ts');
  const { createRateLimiter } =
    await import('../../packages/database/src/adapters/rate-limiting/index.ts');

  const secrets = configuration.AUTH_SECRETS.split(',').map((entry) => {
    const separator = entry.indexOf(':');
    return {
      version: Number.parseInt(entry.slice(0, separator), 10),
      value: entry.slice(separator + 1),
    };
  });

  // The SAME configuration the server was started with. A different secret
  // would fail to decrypt the token, and the failure would look like a product
  // defect rather than a harness mistake.
  mechanics = createAuthMechanicsAdapter({
    baseUrl: `http://127.0.0.1:${configuration.port}`,
    trustedOrigins: [`http://127.0.0.1:${configuration.port}`],
    secrets,
    useSecureCookies: false,
    passwordLength: { min: 12, max: 128 },
    session: { expiresInSeconds: 604_800, updateAgeSeconds: 86_400 },
    tokenExpiresInSeconds: 3_600,
    tokenAllowedAttempts: 5,

    // The SAME second-factor mechanics the composition configures. The harness
    // never verifies a code through this adapter — it only re-materialises an
    // outstanding token — but the plugin is constructed with the rest of the
    // instance, so an absent configuration is a constructor failure rather
    // than an unused field.
    secondFactor: {
      recoveryCodeCount: 10,
      totpDigits: 6,
      totpPeriodSeconds: 30,
      signInLockout: { maxFailedAttempts: 10, durationSeconds: 900 },
    },
    rateLimiter: createRateLimiter({
      digestKey: configuration.RATE_LIMIT_DIGEST_KEY,
      digestKeyVersion: 1,
    }),
    onTokenIssued: async () => undefined,
  });

  return mechanics;
}

/** The verification link the message for this address would have carried. */
export async function verificationLink(email: string): Promise<string> {
  const material = await (
    await authMechanics()
  ).materialiseOutstandingToken({ purpose: 'email-verification', email });

  if (material === null)
    throw new Error(`No outstanding verification token for ${email}`);

  return link('/en/verify-email', { email, token: material.token });
}

/** The password-reset link for this address. */
export async function resetLink(email: string): Promise<string> {
  const material = await (
    await authMechanics()
  ).materialiseOutstandingToken({ purpose: 'password-reset', email });

  if (material === null) throw new Error(`No outstanding reset token for ${email}`);

  return link('/en/reset-password', { email, token: material.token });
}

/** The email-change confirmation link, which is keyed on a PAIR of addresses. */
export async function emailChangeLink(
  currentEmail: string,
  newEmail: string,
): Promise<string> {
  const material = await (
    await authMechanics()
  ).materialiseEmailChangeToken({ currentEmail, newEmail });

  if (material === null) throw new Error(`No outstanding change token for ${newEmail}`);

  return link('/en/confirm-email-change', { email: newEmail, token: material.token });
}

function link(pathname: string, query: Record<string, string>): string {
  const url = new URL(pathname, `http://127.0.0.1:${browserEnvironment().port}`);

  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

  return `${url.pathname}${url.search}`;
}

/* ===========================================================================
 * Journeys
 * ========================================================================= */

let sequence = 0;

/** A fresh address. `.invalid` is reserved and can never resolve. */
export function freshEmail(prefix = 'browser'): string {
  sequence += 1;
  return `${prefix}-${sequence}-${Date.now()}@proof.invalid`;
}

/** A synthetic sentinel, never a real credential. */
export const PASSWORD = 'browser-suite-passphrase-6620';
export const NEW_PASSWORD = 'browser-suite-replacement-1174';

/** The label text these forms actually use, in one place. */
export const LABEL = {
  name: 'Name',
  email: 'Email address',
  password: 'Password',
  newPassword: 'New password',
  currentPassword: 'Current password',
  newEmail: 'New email address',
  accountLanguage: 'Account language',
  timezone: 'Time zone',
  closeConfirm: 'Enter your password to close the account',
} as const;

export const BUTTON = {
  signUp: 'Create account',
  signIn: 'Sign in',
  signOut: 'Sign out',
  confirmAddress: 'Confirm this address',
  sendAnotherLink: 'Send another link',
  sendResetLink: 'Send the link',
  saveNewPassword: 'Save the new password',
  changePassword: 'Change password',
  changeEmail: 'Change email address',
  revokeOthers: 'Sign out everywhere else',
  closeAccount: 'Close my account',
  save: 'Save',
} as const;

/**
 * Signs up, verifies through the real link, and signs in — through the UI.
 *
 * Every step is a real browser interaction, because the point of this suite is
 * the parts that only exist in a browser.
 */
export async function registerAndSignIn(
  page: Page,
  prefix = 'account',
): Promise<{ email: string }> {
  const email = freshEmail(prefix);

  await signUp(page, email, PASSWORD);
  await confirmVerification(page, email);
  await signIn(page, email, PASSWORD);

  return { email };
}

/** Submits the sign-up form and waits for its uniform acknowledgement. */
export async function signUp(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/en/signup');
  await page.getByLabel(LABEL.name).fill('Browser Proof');
  await page.getByLabel(LABEL.email).fill(email);
  await page.getByLabel(LABEL.password, { exact: true }).fill(password);
  await page.getByRole('button', { name: BUTTON.signUp }).click();
  await statusIn(page).waitFor();
}

/** Follows the verification link and confirms it. */
export async function confirmVerification(page: Page, email: string): Promise<void> {
  await page.goto(await verificationLink(email));
  await page.getByRole('button', { name: BUTTON.confirmAddress }).click();
  await statusIn(page).waitFor();
}

/** Signs in through the form and waits for the destination. */
export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/en/signin');
  await page.getByLabel(LABEL.email).fill(email);
  await page.getByLabel(LABEL.password, { exact: true }).fill(password);
  await page.getByRole('button', { name: BUTTON.signIn, exact: true }).click();
  await page.waitForURL('**/my');
}

/** Signs out from `/my` and waits for the public landing page. */
export async function signOut(page: Page): Promise<void> {
  await page.goto('/en/my');
  await page.getByRole('button', { name: BUTTON.signOut, exact: true }).click();
  await page.waitForURL(/\/en$/);
}

/* ===========================================================================
 * Privileged state — Phase 2 Chunk 2
 * ========================================================================= */

/**
 * A privileged session against the run's disposable database.
 *
 * The browser server hands the suite the MIGRATION connection for that
 * database, which is what lets a spec do the two things a browser genuinely
 * cannot: look an account's internal identifier up, and run the HOST-ONLY
 * bootstrap procedure.
 *
 * THAT IS THE POINT, not a shortcut. The bootstrap has no HTTP path by design
 * (SECURITY_BASELINE.md §8.3), so a browser spec that needed one would be
 * asserting the existence of the thing this phase removed. It is performed the
 * way an operator performs it — against the database — and everything after it
 * happens in the browser.
 */
export async function privilegedSession(): Promise<SqlSession> {
  const { databaseUrl } = browserEnvironment();
  return openSession(parseSqlServerUrl(databaseUrl));
}

/** The internal identifier for an address. Never guessed from the address. */
export async function accountIdFor(sql: SqlSession, email: string): Promise<string> {
  const [row] = await sql.query<{ id: string }>(
    `SELECT [id] FROM [dbo].[User] WHERE [email] = N'${email}';`,
  );
  if (row === undefined) throw new Error(`No account for ${email}`);
  return row.id;
}

/** Runs the one-time bootstrap, exactly as `npm run identity:bootstrap` does. */
export async function bootstrapAdministrator(
  sql: SqlSession,
  accountId: string,
  ticket = 'BROWSER-PROOF initial administrator',
): Promise<void> {
  await sql.execute('IdentityBootstrapPlatformAdministrator', {
    targetUserId: accountId,
    ticket,
  });
}

const PERIOD_SECONDS = 30;

/** The last code this process handed out, so the next one is never a repeat. */
let lastCode: string | null = null;

/**
 * The current TOTP code for an enrolment URI.
 *
 * The library's own implementation, over the secret the page displayed — so a
 * code this produces is a code an authenticator app would produce.
 *
 * NEVER THE SAME CODE TWICE IN A ROW. A signed-in administrator steps up
 * several times in one journey, and two step-ups inside one thirty-second
 * window would otherwise submit identical codes. A replayed one-time code is
 * not a second proof, so the helper waits for the period to roll rather than
 * producing a refusal that would look like a product defect.
 */
export async function totpCodeFor(totpUri: string): Promise<string> {
  const encoded = new URL(totpUri).searchParams.get('secret');
  if (encoded === null) throw new Error('The enrolment URI carries no secret.');

  const secret = new TextDecoder().decode(base32.decode(encoded));
  const otp = createOTP(secret, { digits: 6, period: PERIOD_SECONDS });

  let code = await otp.totp();

  if (code === lastCode) {
    // Wait out the remainder of this window, and a moment beyond it so the
    // server and this process agree on which window they are in.
    const elapsed = (Date.now() / 1_000) % PERIOD_SECONDS;
    await new Promise((resolve) =>
      setTimeout(resolve, (PERIOD_SECONDS - elapsed) * 1_000 + 1_000),
    );
    code = await otp.totp();
  }

  lastCode = code;
  return code;
}

/** The labels the Chunk-2 surfaces use, in one place. */
export const ADMIN = {
  beginSetup: 'Begin setup',
  savedCodes: 'I have saved these codes',
  confirmCode: 'Confirm',
  stepUp: 'Confirm',
  password: 'Password',
  currentPassword: 'Current password',
  authenticationCode: 'Authentication code',
  createRole: 'Create the role',
  grantRole: 'Grant the role',
  revoke: 'Revoke',
} as const;

/** The section heading, in English — the locale every journey spec uses. */
const SECOND_FACTOR_HEADING = 'Two-step verification';

/** What the summary sentence says in each of the two states a spec asserts. */
export const SECOND_FACTOR_ON = 'Two-step verification is on';
export const SECOND_FACTOR_OFF = 'Two-step verification is off';

/**
 * THE two-step verification section of the account's security surface.
 *
 * SCOPED BY ITS ACCESSIBLE NAME, not by position. The same page carries a
 * "Current password" field for changing the password as well, so an ordinal
 * would pick whichever form happens to render first — and would silently start
 * picking the other one the day a section moves. Asking for the named region
 * also proves the section is labelled, which is what its `aria-labelledby` is
 * for.
 */
export function secondFactorSection(page: Page): Locator {
  return page.getByRole('region', { name: SECOND_FACTOR_HEADING });
}

/** The recovery codes as the page renders them: `xxxxx-xxxxx`, one per item. */
export async function recoveryCodesOn(page: Page): Promise<string[]> {
  const entries = await secondFactorSection(page).getByRole('listitem').allInnerTexts();

  return entries
    .map((entry) => entry.trim())
    .filter((entry) => /^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/.test(entry));
}

/**
 * Begins an enrolment and returns what the page shows ONCE.
 *
 * The setup key is read off the rendered page rather than out of the database,
 * which is what proves the key a person is shown is the key that works.
 */
export async function beginSecondFactorEnrolment(
  page: Page,
): Promise<{ totpUri: string; recoveryCodes: string[] }> {
  const section = secondFactorSection(page);

  await section.getByLabel(ADMIN.currentPassword, { exact: true }).fill(PASSWORD);
  await section.getByRole('button', { name: ADMIN.beginSetup }).click();

  const totpUri = await section
    .locator('code', { hasText: 'otpauth://' })
    .first()
    .innerText();
  expect(totpUri).toContain('otpauth://totp/');

  return { totpUri, recoveryCodes: await recoveryCodesOn(page) };
}

/**
 * Enrols a second factor THROUGH THE UI, and confirms the recovery codes.
 *
 * Every step is a real interaction. It returns the setup key, because a
 * privileged journey needs a fresh code for each later step-up and the key is
 * shown exactly once — re-reading it later is impossible by design.
 */
export async function enrolSecondFactorInBrowser(
  page: Page,
): Promise<{ totpUri: string; recoveryCodes: string[] }> {
  await page.goto('/en/my/settings/security');

  const section = secondFactorSection(page);
  const enrolment = await beginSecondFactorEnrolment(page);

  await section.getByRole('button', { name: ADMIN.savedCodes }).click();

  await section
    .getByLabel(ADMIN.authenticationCode, { exact: true })
    .first()
    .fill(await totpCodeFor(enrolment.totpUri));
  await section.getByRole('button', { name: ADMIN.confirmCode, exact: true }).click();

  // THE POSTURE, not merely "something was announced". The summary sentence is
  // a status region whatever it says, so waiting for a status alone would pass
  // on a page that had done nothing at all.
  await expect(section).toContainText(SECOND_FACTOR_ON);

  return enrolment;
}

/**
 * Signs in with the password AND the second factor, answering the challenge.
 *
 * Used whenever a spec needs the one bootstrapped administrator on a fresh
 * context: the password alone stops producing a session the moment a factor is
 * enrolled, which is the property the suite proves elsewhere.
 */
export async function signInWithSecondFactor(
  page: Page,
  email: string,
  totpUri: string,
): Promise<void> {
  await page.goto('/en/signin');
  await page.getByLabel(LABEL.email).fill(email);
  await page.getByLabel(LABEL.password, { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: BUTTON.signIn, exact: true }).click();

  await page.waitForURL(/\/signin\/two-factor/);

  await page.getByLabel('Authentication code').fill(await totpCodeFor(totpUri));
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await page.waitForURL('**/my');
}
