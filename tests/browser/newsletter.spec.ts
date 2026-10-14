import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Browser, BrowserContext, Locator, Page } from '@playwright/test';

import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import {
  accountIdFor,
  baseUrl,
  browserEnvironment,
  expect,
  grantRole,
  privilegedSession,
  registerAndSignIn,
  test,
} from './support';

/**
 * Phase 21 — the newsletter in a real browser, against the production build.
 *
 * WHAT ONLY A BROWSER CAN PROVE: that the public form gives one neutral answer
 * whatever the address's state, so it cannot be used to learn who subscribes;
 * that opening an emailed confirmation link — as a mail scanner or prefetcher
 * would — confirms nothing, and only the POST the person makes does, once;
 * that unsubscribing needs no account, is idempotent, and that coming back
 * needs a fresh confirmation; that having an account subscribes nobody; that
 * the operator surface opens only to `newsletter.read`, shows masked addresses
 * and offers its two confirmed acts only to `newsletter.operate`; and that
 * these pages are right-to-left in Urdu and Arabic, reflow at 320 pixels and
 * at 200% zoom, and are reached by keyboard with a visible focus.
 *
 * HOW A SPEC GETS THE EMAILED LINK. Not from an outbox, and never from a
 * stored token — none is stored. The link is re-derived exactly as the
 * dispatcher derives it at send time: the HMAC of the purpose, subscriber,
 * generation and the issuance's salt under the run's `NEWSLETTER_TOKEN_KEY`,
 * read from the subscriber row over the migration connection.
 *
 * Every address is a fresh `@proof.invalid` one, and every account is new.
 */

test.describe.configure({ mode: 'serial', retries: 0 });

let sql: SqlSession;
const contexts: BrowserContext[] = [];

const run = randomUUID().replaceAll('-', '').slice(0, 10);

const MESSAGES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'apps',
  'web',
  'messages',
);

type UiLocale = 'en' | 'ur' | 'ar';
const LOCALES: readonly UiLocale[] = ['en', 'ur', 'ar'];

interface NewsletterCopy {
  readonly title: string;
  readonly form: { readonly email: string; readonly submit: string };
  readonly result: { readonly sent: string };
  readonly confirm: {
    readonly title: string;
    readonly submit: string;
    readonly done: string;
  };
  readonly unsubscribe: {
    readonly title: string;
    readonly submit: string;
    readonly done: string;
  };
  readonly link: { readonly invalid: string };
  readonly admin: {
    readonly title: string;
    readonly noAddress: string;
    readonly suppress: { readonly submit: string; readonly done: string };
    readonly reinstate: { readonly submit: string; readonly done: string };
    readonly refused: { readonly confirmRequired: string };
    readonly columns: { readonly actions: string };
  };
}

/** The shipped catalogue's newsletter copy in each interface locale. */
const COPY = Object.fromEntries(
  LOCALES.map((locale) => [
    locale,
    (
      JSON.parse(readFileSync(path.join(MESSAGES, `${locale}.json`), 'utf8')) as {
        newsletter: NewsletterCopy;
      }
    ).newsletter,
  ]),
) as Record<UiLocale, NewsletterCopy>;
const EN = COPY.en;

let sequence = 0;

/**
 * A fresh address whose FIRST letter is chosen, because the operator surface
 * masks an address to its first character and its domain.
 */
function address(initial: string): string {
  sequence += 1;
  return `${initial}${run}-${String(sequence)}@proof.invalid`;
}

/** A SQL Server Unicode literal. Values are this file's own constants. */
const n = (value: string) => `N'${value.replaceAll("'", "''")}'`;

interface SubscriberRow {
  readonly id: string;
  readonly state: string;
  readonly locale: string;
  readonly generation: number;
  readonly email: string | null;
  readonly confirmSalt: string | null;
  readonly unsubscribeSalt: string | null;
  readonly confirmedAt: Date | null;
  readonly version: number;
}

const COLUMNS =
  '[id],[state],[locale],[generation],[email],[confirmSalt],[unsubscribeSalt],[confirmedAt],[version]';

async function subscriberByEmail(email: string): Promise<SubscriberRow> {
  const [row] = await sql.query<SubscriberRow>(
    `SELECT ${COLUMNS} FROM [dbo].[NewsletterSubscriber] WHERE [email]=${n(email)};`,
  );
  if (row === undefined) throw new Error('No subscriber holds this address.');
  return row;
}

async function subscriberById(id: string): Promise<SubscriberRow> {
  const [row] = await sql.query<SubscriberRow>(
    `SELECT ${COLUMNS} FROM [dbo].[NewsletterSubscriber] WHERE [id]=N'${id}';`,
  );
  if (row === undefined) throw new Error('No subscriber has this id.');
  return row;
}

/** The link the confirmation message for this issuance carries. */
function linkFor(purpose: 'confirm' | 'unsubscribe', row: SubscriberRow): string {
  const salt = purpose === 'confirm' ? row.confirmSalt : row.unsubscribeSalt;
  if (salt === null) throw new Error(`The subscriber holds no ${purpose} salt.`);
  const token = createHmac('sha256', browserEnvironment().NEWSLETTER_TOKEN_KEY)
    .update(`newsletter|${purpose}|${row.id}|${String(row.generation)}|${salt}`)
    .digest('base64url');
  return `/${row.locale}/newsletter/${purpose}?token=${token}`;
}

/** What the form answered, success or not, in the page's own words. */
function answerOn(page: Page): Locator {
  const main = page.getByRole('main');
  return main.getByRole('status').or(main.getByRole('alert'));
}

/** Submits the public form and returns its answer. */
async function subscribe(page: Page, email: string, locale: UiLocale = 'en') {
  await page.goto(`/${locale}/newsletter`);
  await page.getByLabel(COPY[locale].form.email).fill(email);
  await page.getByRole('button', { name: COPY[locale].form.submit, exact: true }).click();
  const answer = answerOn(page);
  await expect(answer).toBeVisible();
  return (await answer.innerText()).trim();
}

/* ===========================================================================
 * Page helpers
 * ========================================================================= */

async function tabTo(page: Page, target: Locator): Promise<void> {
  const handle = await target.elementHandle();
  if (handle === null) throw new Error('The keyboard target is not on the page.');
  let reached = false;
  for (let step = 0; step < 200 && !reached; step += 1) {
    await page.keyboard.press('Tab');
    reached = await handle.evaluate((element) => document.activeElement === element);
  }
  expect(reached, 'reached by Tab alone').toBe(true);
}

async function expectVisibleFocus(target: Locator, where: string): Promise<void> {
  const focus = await target.evaluate((element) => {
    const style = globalThis.getComputedStyle(element);
    return {
      visible: element.matches(':focus-visible'),
      outline: style.outlineStyle,
      width: Number.parseFloat(style.outlineWidth),
      shadow: style.boxShadow,
    };
  });
  expect(focus.visible, where).toBe(true);
  expect(
    (focus.outline !== 'none' && focus.width > 0) || focus.shadow !== 'none',
    `${where} ${JSON.stringify(focus)}`,
  ).toBe(true);
}

function overflowOf(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

async function expectHeadingsInOrder(page: Page, where: string): Promise<void> {
  const levels = await page
    .locator('main')
    .first()
    .locator('h1, h2, h3, h4, h5, h6')
    .evaluateAll((headings) => headings.map((heading) => Number(heading.tagName[1])));
  expect(levels[0], where).toBe(1);
  expect(
    levels.filter((level) => level === 1),
    where,
  ).toHaveLength(1);
  for (let index = 1; index < levels.length; index += 1)
    expect(
      (levels[index] ?? 0) - (levels[index - 1] ?? 0),
      `${where} ${JSON.stringify(levels)}`,
    ).toBeLessThanOrEqual(1);
}

/** A link page is never indexed and claims no canonical address. */
async function expectUnindexedLinkPage(page: Page, where: string): Promise<void> {
  await expect(page.locator('meta[name="robots"]'), where).toHaveAttribute(
    'content',
    /noindex/,
  );
  await expect(page.locator('link[rel="canonical"]'), where).toHaveCount(0);
  await expect(page.locator('link[rel="alternate"][hreflang]'), where).toHaveCount(0);
}

/** A signed-in account on its own context and client address. */
async function account(
  browser: Browser,
  index: number,
  prefix: string,
): Promise<{ page: Page; id: string }> {
  const context = await browser.newContext({
    baseURL: baseUrl(),
    extraHTTPHeaders: { 'x-forwarded-for': `100.64.243.${String(index)}` },
  });
  contexts.push(context);
  const page = await context.newPage();
  const { email } = await registerAndSignIn(page, prefix);
  return { page, id: await accountIdFor(sql, email) };
}

const ADMIN = '/en/admin/communications/newsletter';

/** The operator form that names one subscriber. */
function formFor(page: Page, subscriberId: string): Locator {
  return page.locator('form', {
    has: page.locator(`input[name="subscriberId"][value="${subscriberId}"]`),
  });
}

/* ===========================================================================
 * Fixture
 * ========================================================================= */

test.beforeAll(async () => {
  sql = await privilegedSession();
});

test.afterAll(async () => {
  for (const context of contexts) await context.close();
  await sql?.close();
});

/** An address confirmed in the first proof and reused by the later ones. */
const confirmedAddress = address('c');
/** An address confirmed, then unsubscribed, then resubmitted. */
const leavingAddress = address('l');
/** An address the operator suppresses and reinstates. */
const suppressedAddress = address('z');

/* ===========================================================================
 * 1. The public form
 * ========================================================================= */

test.describe('the public newsletter', () => {
  test('answers the same for a fresh, a pending and a confirmed address', async ({
    page,
  }) => {
    const response = await page.goto('/en/newsletter');
    expect(response?.status()).toBe(200);
    expect(response?.headers()['set-cookie']).toBeUndefined();

    const pendingAddress = address('p');
    expect(await subscribe(page, pendingAddress)).toBe(EN.result.sent);
    expect(await subscribe(page, confirmedAddress)).toBe(EN.result.sent);
    await page.goto(linkFor('confirm', await subscriberByEmail(confirmedAddress)));
    await page.getByRole('button', { name: EN.confirm.submit }).click();
    await expect(page.getByRole('main').getByRole('status')).toHaveText(EN.confirm.done);

    // THE SAME WORDS for all three — new, awaiting confirmation, confirmed.
    const answers = [
      await subscribe(page, address('f')),
      await subscribe(page, pendingAddress),
      await subscribe(page, confirmedAddress),
    ];
    expect(answers).toEqual([EN.result.sent, EN.result.sent, EN.result.sent]);

    // ...while what happened differs, and only the database knows it.
    const pending = await subscriberByEmail(pendingAddress);
    expect(pending.state).toBe('pending');
    expect(Number(pending.generation)).toBe(2);
    const confirmed = await subscriberByEmail(confirmedAddress);
    expect(confirmed.state).toBe('confirmed');
    expect(Number(confirmed.generation)).toBe(1);
  });

  test('is the same page signed in and signed out', async ({ request, browser }) => {
    const { page } = await account(browser, 1, 'newsletter-reader-account');
    const anonymous = await request.get('/en/newsletter');
    const signedIn = await page.context().request.get('/en/newsletter');
    expect(anonymous.status()).toBe(200);
    expect(signedIn.headers()['set-cookie']).toBeUndefined();
    expect((await signedIn.text()) === (await anonymous.text()), 'differs').toBe(true);
  });

  test('registering an account subscribes nobody', async ({ page }) => {
    const { email } = await registerAndSignIn(page, 'newsletter-registrant');
    expect(
      Number(
        (
          await sql.query<{ value: number }>(
            `SELECT COUNT_BIG(*) AS [value] FROM [dbo].[NewsletterSubscriber] WHERE [email]=${n(email)};`,
          )
        )[0]?.value,
      ),
    ).toBe(0);
  });
});

/* ===========================================================================
 * 2. The emailed links
 * ========================================================================= */

test.describe('the emailed links', () => {
  let subscriberId: string;
  let unsubscribeLink: string;

  test('opening the confirmation link confirms nothing; pressing the button does, once', async ({
    page,
    request,
  }) => {
    expect(await subscribe(page, leavingAddress)).toBe(EN.result.sent);
    const row = await subscriberByEmail(leavingAddress);
    subscriberId = row.id;
    const confirm = linkFor('confirm', row);

    // A SCANNER'S GET, and a person's: both render, neither confirms.
    const scanned = await request.get(confirm);
    expect(scanned.status()).toBe(200);
    expect(scanned.headers()['set-cookie']).toBeUndefined();
    const response = await page.goto(confirm);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(EN.confirm.title);
    await expectUnindexedLinkPage(page, 'confirm');
    const button = page.getByRole('button', { name: EN.confirm.submit });
    await expect(button).toBeVisible();
    // The page never names the address it is for.
    await expect(page.locator('body')).not.toContainText(leavingAddress);
    expect((await subscriberById(subscriberId)).state).toBe('pending');

    await button.click();
    await expect(page.getByRole('main').getByRole('status')).toHaveText(EN.confirm.done);
    const confirmed = await subscriberById(subscriberId);
    expect(confirmed.state).toBe('confirmed');
    expect(confirmed.confirmedAt).not.toBeNull();

    // USED: the same link is now simply invalid, with nothing to press.
    await page.goto(confirm);
    await expect(page.getByRole('main')).toContainText(EN.link.invalid);
    await expect(page.getByRole('button', { name: EN.confirm.submit })).toHaveCount(0);

    // A malformed token reads the same.
    await page.goto('/en/newsletter/confirm?token=not-a-token');
    await expect(page.getByRole('main')).toContainText(EN.link.invalid);

    unsubscribeLink = linkFor('unsubscribe', confirmed);
  });

  test('unsubscribing needs no account and is idempotent', async ({ page }) => {
    for (const attempt of [1, 2]) {
      const response = await page.goto(unsubscribeLink);
      expect(response?.status(), String(attempt)).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        EN.unsubscribe.title,
      );
      await expectUnindexedLinkPage(page, `unsubscribe ${String(attempt)}`);
      expect((await subscriberById(subscriberId)).state).toBe(
        attempt === 1 ? 'confirmed' : 'unsubscribed',
      );
      await page.getByRole('button', { name: EN.unsubscribe.submit }).click();
      await expect(page.getByRole('main').getByRole('status')).toHaveText(
        EN.unsubscribe.done,
      );
    }

    const left = await subscriberById(subscriberId);
    expect(left.state).toBe('unsubscribed');
    expect(left.email).toBeNull();
    // ONE departure is recorded, however often the link is pressed.
    const [events] = await sql.query<{ value: number }>(
      `SELECT COUNT_BIG(*) AS [value] FROM [dbo].[NewsletterConsentEvent] WHERE [subscriberId]=N'${subscriberId}' AND [event]=N'unsubscribed';`,
    );
    expect(Number(events?.value)).toBe(1);
  });

  test('coming back after unsubscribing needs a fresh confirmation', async ({ page }) => {
    expect(await subscribe(page, leavingAddress)).toBe(EN.result.sent);
    const back = await subscriberById(subscriberId);
    expect(back.state).toBe('pending');
    expect(back.confirmedAt).toBeNull();
    expect(Number(back.generation)).toBe(2);

    // The previous issuance's links are dead; the new one confirms.
    await page.goto(unsubscribeLink);
    await expect(page.getByRole('main')).toContainText(EN.link.invalid);
    await page.goto(linkFor('confirm', back));
    await page.getByRole('button', { name: EN.confirm.submit }).click();
    await expect(page.getByRole('main').getByRole('status')).toHaveText(EN.confirm.done);
    expect((await subscriberById(subscriberId)).state).toBe('confirmed');
  });
});

/* ===========================================================================
 * 3. The operator surface
 * ========================================================================= */

test.describe('the operator surface', () => {
  let reader: Page;
  let operator: Page;
  let suppressedId: string;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    let id: string;
    ({ page: reader, id } = await account(browser, 2, 'newsletter-read'));
    await grantRole(sql, id, ['newsletter.read'], 'Newsletter browser proof');
    ({ page: operator, id } = await account(browser, 3, 'newsletter-operate'));
    await grantRole(
      sql,
      id,
      ['newsletter.read', 'newsletter.operate'],
      'Newsletter browser proof',
    );
  });

  test('is a 404 without newsletter.read, even inside the administration', async ({
    browser,
  }) => {
    const { page, id } = await account(browser, 4, 'newsletter-none');
    // Another administrative key, so the shell itself opens and the refusal
    // is the newsletter surface's own.
    await grantRole(sql, id, ['delivery.read'], 'Newsletter browser proof');
    expect((await page.goto('/en/admin'))?.status()).toBe(200);
    const response = await page.goto(ADMIN);
    expect(response?.status()).toBe(404);
    await expect(page.locator('body')).not.toContainText('•••@proof.invalid');
  });

  test('newsletter.read shows masked addresses and nothing to press', async () => {
    const response = await reader.context().request.get(ADMIN, { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    const cache = response.headers()['cache-control'] ?? '';
    expect(cache).toContain('private');
    expect(cache).toContain('no-store');
    const html = await response.text();
    expect(html).not.toContain(confirmedAddress);
    expect(html).not.toContain(leavingAddress);

    await reader.goto(ADMIN);
    await expect(reader.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/,
    );
    const main = reader.getByRole('main');
    await expect(main.getByRole('heading', { level: 1 })).toHaveText(EN.admin.title);
    await expect(main).toContainText(`c•••@proof.invalid`);
    await expect(main).not.toContainText(confirmedAddress);
    await expect(main.getByRole('button')).toHaveCount(0);
    await expect(
      main.getByRole('columnheader', { name: EN.admin.columns.actions }),
    ).toHaveCount(0);
  });

  test('newsletter.operate suppresses and reinstates, each behind its confirmation', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    expect(await subscribe(page, suppressedAddress)).toBe(EN.result.sent);
    const row = await subscriberByEmail(suppressedAddress);
    suppressedId = row.id;

    await operator.goto(`${ADMIN}?state=pending`);
    const form = formFor(operator, suppressedId);
    await expect(
      form.getByRole('button', { name: EN.admin.suppress.submit }),
    ).toBeVisible();

    // UNCONFIRMED: refused, and nothing changes.
    await form.getByRole('button', { name: EN.admin.suppress.submit }).click();
    await expect(form.getByRole('alert')).toHaveText(EN.admin.refused.confirmRequired);
    expect((await subscriberById(suppressedId)).state).toBe('pending');

    await form.getByRole('checkbox').check();
    await form.getByRole('button', { name: EN.admin.suppress.submit }).click();
    await expect
      .poll(async () => (await subscriberById(suppressedId)).state)
      .toBe('suppressed');
    expect((await subscriberById(suppressedId)).email).toBeNull();

    // A suppressed address typed in again is told the same, and stays put.
    expect(await subscribe(page, suppressedAddress)).toBe(EN.result.sent);
    expect((await subscriberById(suppressedId)).state).toBe('suppressed');

    await operator.goto(`${ADMIN}?state=suppressed`);
    const reinstate = formFor(operator, suppressedId);
    await expect(reinstate).toContainText(EN.admin.reinstate.submit);
    await reinstate.getByRole('checkbox').check();
    await reinstate.getByRole('button', { name: EN.admin.reinstate.submit }).click();
    await expect
      .poll(async () => (await subscriberById(suppressedId)).state)
      .toBe('unsubscribed');

    // Reinstating resubscribes nobody: the address is not held, nor confirmed.
    const after = await subscriberById(suppressedId);
    expect(after.email).toBeNull();
    expect(after.confirmedAt).toBeNull();
  });

  test('the Platform Administrator bundle alone opens it', async ({ browser }) => {
    const bundle = (
      await sql.query<{ permissionKey: string }>(
        `SELECT rp.[permissionKey] FROM [dbo].[RolePermission] rp JOIN [dbo].[Role] r ON r.[id]=rp.[roleId] WHERE r.[key]=N'platform-administrator';`,
      )
    ).map((row) => row.permissionKey);
    expect(bundle).toContain('newsletter.read');
    expect(bundle).toContain('newsletter.operate');

    const { page, id } = await account(browser, 5, 'newsletter-bundle');
    await grantRole(sql, id, bundle, 'Newsletter browser proof — protected bundle');
    const response = await page.goto(ADMIN);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText(
      EN.admin.title,
    );
    await expect(
      page
        .getByRole('main')
        .getByRole('button', { name: EN.admin.suppress.submit })
        .first(),
    ).toBeVisible();
  });

  test('every newsletter page reflows, reads right-to-left, and is keyboard-reachable', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    // A pending address whose confirmation page can be opened again and again:
    // opening it consumes nothing.
    expect(await subscribe(page, address('r'))).toBe(EN.result.sent);
    const [pending] = await sql.query<SubscriberRow>(
      `SELECT TOP 1 ${COLUMNS} FROM [dbo].[NewsletterSubscriber] WHERE [email] LIKE N'r${run}-%';`,
    );
    if (pending === undefined) throw new Error('The pending subscription is missing.');
    const token = new URL(linkFor('confirm', pending), baseUrl()).search;

    // 640 CSS pixels is a 1280-pixel window at 200% zoom.
    for (const width of [320, 640]) {
      for (const viewer of [page, reader])
        await viewer.setViewportSize({ width, height: 800 });
      for (const locale of LOCALES) {
        for (const [viewer, target] of [
          [page, `/${locale}/newsletter`],
          [page, `/${locale}/newsletter/confirm${token}`],
          [reader, `/${locale}/admin/communications/newsletter`],
        ] as const) {
          const response = await viewer.goto(target);
          expect(response?.status(), target).toBe(200);
          await expect(viewer.locator('html'), target).toHaveAttribute(
            'dir',
            locale === 'en' ? 'ltr' : 'rtl',
          );
          expect(
            await overflowOf(viewer),
            `${String(width)}px ${target}`,
          ).toBeLessThanOrEqual(0);
          await expectHeadingsInOrder(viewer, `${String(width)}px ${target}`);
        }
        // Still pending: rendering the page in three languages confirmed nothing.
        expect((await subscriberById(pending.id)).state).toBe('pending');
      }
    }

    for (const viewer of [page, reader])
      await viewer.setViewportSize({ width: 1280, height: 800 });

    await page.goto('/en/newsletter');
    const email = page.getByLabel(EN.form.email);
    await tabTo(page, email);
    await expectVisibleFocus(email, 'newsletter email');
    const subscribeButton = page.getByRole('button', {
      name: EN.form.submit,
      exact: true,
    });
    await tabTo(page, subscribeButton);
    await expectVisibleFocus(subscribeButton, 'subscribe');

    await page.goto(`/ar/newsletter/confirm${token}`);
    const confirmButton = page.getByRole('button', { name: COPY.ar.confirm.submit });
    await tabTo(page, confirmButton);
    await expectVisibleFocus(confirmButton, 'confirm (ar)');

    await reader.goto(ADMIN);
    const filter = reader
      .getByRole('main')
      .getByRole('navigation')
      .getByRole('link')
      .first();
    await tabTo(reader, filter);
    await expectVisibleFocus(filter, 'admin filter');
  });
});
