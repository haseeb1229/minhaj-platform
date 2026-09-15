import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  test as base,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';

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

  context: async ({ browser, clientAddress }, use) => {
    const context = await browser.newContext({
      extraHTTPHeaders: { 'x-forwarded-for': clientAddress },
    });

    await use(context);
    await context.close();
  },
});

export { expect } from '@playwright/test';

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
