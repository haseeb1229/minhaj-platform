import { randomBytes, randomUUID } from 'node:crypto';

import type { Browser, BrowserContext, Locator, Page, Request } from '@playwright/test';

import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import {
  donationsFixture,
  sessionOf,
  simulator,
  withWebhooks,
} from './donations-control';
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
  ADMIN,
  PASSWORD,
  accountIdFor,
  alertIn,
  baseUrl,
  enrolSecondFactorInBrowser,
  expect,
  grantRole,
  privilegedSession,
  registerAndSignIn,
  statusIn,
  test,
  totpCodeFor,
} from './support';

/**
 * Phase 27 — Donations in a real browser, against the production build and
 * the repository's Stripe simulator (`scripts/browser-server.mjs`).
 *
 * WHAT ONLY A BROWSER CAN PROVE: that `/donate` says honestly that giving is
 * unavailable — and offers no form — until the database records an
 * activation; that the fixture environment is announced by a TEST banner and
 * never indexed; that an anonymous gift sends the browser to the provider's
 * hosted page and back and NOWHERE else, and that its status page says
 * pending until the provider's VERIFIED webhook arrives — a return address
 * whose query claims success changes nothing; that a double click or a
 * replayed submission starts one donation; that a declined card, a failed
 * payment and a cancellation each read as what they are; that a gift started
 * from My donations is linked and found by "Check again" when no webhook
 * arrives; that nobody else sees it and a guessed address finds nothing; that
 * the administration is a 404 without `donations.read`, reads and filters
 * with it and acts with nothing more, reconciles with `donations.administer`,
 * and refunds only with `donations.refund` behind the `donation-refund`
 * step-up; that no page of ours carries a card or payment-detail field; and
 * that the giving surfaces read right-to-left in Urdu and Arabic, reflow at
 * 320 and 640 pixels around an unbroken title, keep a visible keyboard focus
 * and honour reduced motion.
 *
 * ONE SERIAL FILE. The activation is a database-wide immutable singleton, so
 * the "not activated" proof must come first and everything after it reads
 * what the earlier steps did: the donation refunded is the one paid
 * anonymously, the one reconciled is the one whose webhooks were dropped.
 * No other spec writes Donations data or drives the simulator.
 *
 * WHO WRITES WHAT. Identity's accounts and roles, the campaigns and the
 * activation are fixtures written through the privileged session — the
 * activation exactly as an operator records it. Every donation, payment,
 * cancellation, reconciliation and refund is done through the pages and the
 * simulator's own hosted page; the simulator's control surface only holds,
 * drops or releases webhooks, and settles an asynchronous payment the way the
 * provider would.
 *
 * EVERYTHING IS SYNTHETIC. Every word is a `NON_GIVING_FIXTURE` sentinel,
 * which no other spec looks for.
 */

// NO RETRY. The activation and every donation outlive an attempt, so a retry
// would meet them and prove nothing about the first one.
test.describe.configure({ mode: 'serial', retries: 0 });

let sql: SqlSession;
const contexts: BrowserContext[] = [];

const run = randomUUID().replaceAll('-', '').slice(0, 10);
const SENTINEL = 'NON_GIVING_FIXTURE';
const LOCALES: readonly UiLocale[] = ['en', 'ur', 'ar'];

const ids = {
  main: randomUUID(),
  long: randomUUID(),
  draft: randomUUID(),
} as const;

const TEXT = {
  main: `${SENTINEL}_WELL ${run}`,
  mainUr: `${SENTINEL}_WELL اردو ${run}`,
  // One unbroken token, as long as a title may be: the reflow hazard.
  long: `${SENTINEL}_LONG_${'w'.repeat(118)}${run}`,
  draft: `${SENTINEL}_UNSEEN_DRAFT ${run}`,
  operator: `${SENTINEL} operator ${run}`,
} as const;

/** Inputs that would collect payment details. None may exist on our pages. */
const PAYMENT_DETAIL_FIELDS =
  'input[autocomplete^="cc-" i], input[name*="card" i], input[id*="card" i], ' +
  'input[name*="cvc" i], input[name*="cvv" i], input[name*="iban" i], ' +
  'input[name*="expiry" i], iframe';

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
 * One campaign, walked through exactly the states the lifecycle trigger
 * admits: inserted as a draft at version 1 with its words and currencies,
 * then published one version later.
 */
async function seedCampaign(
  id: string,
  displayOrder: number,
  words: readonly { readonly locale: UiLocale; readonly title: string }[],
  currencies: readonly string[],
  publish: boolean,
): Promise<void> {
  const steps = [
    `INSERT INTO [dbo].[DonationCampaign] ([id],[primaryLocale],[displayOrder]) VALUES (N'${id}', N'en', ${String(displayOrder)});`,
    ...words.map(
      ({ locale, title }) =>
        `INSERT INTO [dbo].[DonationCampaignTranslation] ([campaignId],[locale],[title],[summary],[description]) VALUES
          (N'${id}', N'${locale}', ${n(title)}, ${n(`${SENTINEL} summary ${locale} ${run}`)}, ${n(`${SENTINEL} description ${locale} ${'x'.repeat(140)}${run}`)});`,
    ),
    ...currencies.map(
      (values) =>
        `INSERT INTO [dbo].[DonationCampaignCurrency] ([campaignId],[currency],[currencyExponent],[minimumMinor],[maximumMinor],[suggested1Minor],[suggested2Minor],[suggested3Minor]) VALUES (N'${id}', ${values});`,
    ),
  ];
  if (publish)
    steps.push(
      `UPDATE [dbo].[DonationCampaign] SET [state]=N'published', [publishedAt]=SYSUTCDATETIME(), [version]=2, [updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${id}';`,
    );
  await sql.query(steps.join('\n'));
}

/** The operator's act: online giving is activated for the fixture scope. */
async function activateFixtureGiving(): Promise<void> {
  await sql.query(
    `INSERT INTO [dbo].[DonationActivation] ([id],[provider],[environment],[accountKey],[authority],[authorisedBy])
       VALUES (1, N'stripe', N'fixture', ${n(donationsFixture().accountKey)}, N'fixture', ${n(TEXT.operator)});`,
  );
}

/* ===========================================================================
 * Reading what happened
 * ========================================================================= */

interface DonationRow {
  readonly id: string;
  readonly state: string;
  readonly createState: string;
  readonly donorUserId: string | null;
  readonly campaignId: string;
  readonly currency: string;
  readonly expected: string;
  readonly refunded: string;
  readonly checkoutReference: string | null;
}

const DONATION_COLUMNS = `[id],[state],[createState],[donorUserId],[campaignId],[currency],
  CONVERT(NVARCHAR(20),[expectedMinor]) AS [expected],
  CONVERT(NVARCHAR(20),[refundedMinor]) AS [refunded],[checkoutReference]`;

/** Every donation one operation id started — there must only ever be one. */
async function donationsOf(operationId: string): Promise<DonationRow[]> {
  return sql.query<DonationRow>(
    `SELECT ${DONATION_COLUMNS} FROM [dbo].[Donation] WHERE [operationId]=N'${operationId}';`,
  );
}

/** The one donation an operation id started. */
async function donationOf(operationId: string): Promise<DonationRow> {
  const rows = await donationsOf(operationId);
  expect(rows, `exactly one donation for ${operationId}`).toHaveLength(1);
  const [row] = rows;
  if (row === undefined) throw new Error('No donation.');
  return row;
}

async function stateOf(operationId: string): Promise<string> {
  return (await donationOf(operationId)).state;
}

/** Checkout creations the provider actually performed for one donation. */
async function performedCreates(donationId: string): Promise<number> {
  const requests =
    await simulator<
      { route: string; idempotencyKey: string | null; replayed: boolean }[]
    >('requests');
  return requests.filter(
    (entry) =>
      entry.route === 'POST /v1/checkout/sessions' &&
      entry.idempotencyKey === `donation:${donationId}` &&
      !entry.replayed,
  ).length;
}

/* ===========================================================================
 * Accounts and page helpers
 * ========================================================================= */

interface Actor {
  readonly page: Page;
  readonly id: string;
  readonly email: string;
}

/** A fresh signed-in account on its own context and client address. */
async function account(browser: Browser, index: number, prefix: string): Promise<Actor> {
  const context = await browser.newContext({
    baseURL: baseUrl(),
    extraHTTPHeaders: { 'x-forwarded-for': `100.64.239.${String(index)}` },
  });
  contexts.push(context);
  const page = await context.newPage();
  const { email } = await registerAndSignIn(page, prefix);
  return { page, id: await accountIdFor(sql, email), email };
}

/** One campaign's panel on a giving page, found by its title. */
function campaignCard(page: Page, title: string): Locator {
  return page
    .getByRole('main')
    .locator('li')
    .filter({ has: page.getByRole('heading', { level: 3, name: title, exact: true }) });
}

function giveButton(card: Locator, locale: UiLocale = 'en'): Locator {
  return card.getByRole('button', {
    name: copy('donations.form.submit', {}, locale),
    exact: true,
  });
}

const STATUS_PATH = /\/en\/donate\/status\/[A-Za-z0-9_-]{43}(?:\?.*)?$/u;

/** Waits for the provider's hosted checkout page and returns its session id. */
async function onHostedPage(page: Page): Promise<string> {
  await page.waitForURL(
    (url) =>
      url.origin === donationsFixture().simulatorOrigin &&
      url.pathname.startsWith('/c/pay/'),
    { timeout: 60_000 },
  );
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fixture checkout');
  return sessionOf(page.url());
}

/**
 * Types an amount in US dollars into a campaign's form. Typed text wins over
 * any suggestion. Filled afresh before every submission: React resets an
 * action form's fields once its action settles.
 */
async function fillUsd(card: Locator, amount: string): Promise<void> {
  await card
    .getByLabel(copy('donations.form.currency'), { exact: true })
    .selectOption('USD');
  await card.getByLabel(copy('donations.form.amount'), { exact: true }).fill(amount);
}

/**
 * Starts one gift of a typed US-dollar amount from a campaign's form and lands
 * on the hosted page. Returns the form's operation id, read BEFORE
 * submitting, and the checkout session.
 */
async function startGift(
  page: Page,
  title: string,
  amount: string,
): Promise<{ operationId: string; session: string }> {
  const card = campaignCard(page, title);
  const operationId = await card.locator('input[name="operationId"]').inputValue();
  await fillUsd(card, amount);
  await giveButton(card).click();
  return { operationId, session: await onHostedPage(page) };
}

/** Pays on the hosted page and follows the provider's return to the status page. */
async function payAndReturn(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Pay', exact: true }).click();
  await page.waitForURL(STATUS_PATH, { timeout: 120_000 });
  return new URL(page.url()).pathname;
}

/** The status page says this state, in words, with its explanation. */
async function expectState(page: Page, key: string): Promise<void> {
  const main = page.getByRole('main');
  await expect(main).toContainText(copy(`donations.state.${key}`));
  await expect(main).toContainText(copy(`donations.stateHelp.${key}`));
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

function actionRequest(page: Page): Promise<Request> {
  return page.waitForRequest(
    (request) =>
      request.method() === 'POST' && request.headers()['next-action'] !== undefined,
  );
}

/** No card, bank or payment-detail field, and nothing framed. */
async function expectNoPaymentDetailFields(page: Page, where: string): Promise<void> {
  await expect(page.locator(PAYMENT_DETAIL_FIELDS), where).toHaveCount(0);
}

/** The administration's record of one donation. */
function recordPath(donationId: string): string {
  return `/en/admin/donations/${donationId}`;
}

/* ===========================================================================
 * Fixture
 * ========================================================================= */

let donor: Actor;
let stranger: Actor;
let reader: Actor;
let operator: Actor;
let refunder: Actor;
let refunderTotp: string;

/** The anonymous, paid gift — refunded later. */
let paid: { operationId: string; statusPath: string };
/** The linked gift. */
let linked: { operationId: string };
/** The paid gift whose webhooks were dropped — reconciled later. */
let unheard: { operationId: string };

test.beforeAll(async ({ browser }) => {
  test.setTimeout(900_000);
  sql = await privilegedSession();

  await seedCampaign(
    ids.main,
    9001,
    [
      { locale: 'en', title: TEXT.main },
      { locale: 'ur', title: TEXT.mainUr },
    ],
    [
      "'USD', 2, 100, 100000, 1000, 2500, 5000",
      "'JPY', 0, 100, 1000000, 500, 1000, NULL",
    ],
    true,
  );
  await seedCampaign(
    ids.long,
    9002,
    [{ locale: 'en', title: TEXT.long }],
    ["'USD', 2, 100, 100000, NULL, NULL, NULL"],
    true,
  );
  await seedCampaign(
    ids.draft,
    9003,
    [{ locale: 'en', title: TEXT.draft }],
    ["'USD', 2, 100, 100000, NULL, NULL, NULL"],
    false,
  );

  donor = await account(browser, 1, 'giving-donor');
  stranger = await account(browser, 2, 'giving-stranger');
  await grantRole(sql, stranger.id, ['taxonomy.read'], `${SENTINEL} another area`);
  reader = await account(browser, 3, 'giving-reader');
  await grantRole(sql, reader.id, ['donations.read'], `${SENTINEL} reading`);
  operator = await account(browser, 4, 'giving-operator');
  await grantRole(
    sql,
    operator.id,
    ['donations.read', 'donations.administer'],
    `${SENTINEL} administration`,
  );
  refunder = await account(browser, 5, 'giving-refunder');
  await grantRole(
    sql,
    refunder.id,
    ['donations.read', 'donations.refund'],
    `${SENTINEL} refunds`,
  );
  // A refund moves money: a complete second-factor posture, through the UI.
  refunderTotp = (await enrolSecondFactorInBrowser(refunder.page)).totpUri;
});

test.afterAll(async () => {
  // Delivery back on, whatever happened, for anything still running.
  await simulator('setWebhookMode', 'deliver').catch(() => undefined);
  for (const context of contexts) await context.close();
  await sql?.close();
});

/* ===========================================================================
 * 1. Availability is the database's decision
 * ========================================================================= */

test.describe('availability', () => {
  test('without an activation, /donate says giving is unavailable and offers no form', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    expect(
      await scalar('SELECT COUNT_BIG(*) AS [value] FROM [dbo].[DonationActivation];'),
      'the migrated database records no activation',
    ).toBe(0);

    for (const locale of LOCALES) {
      const target = `/${locale}/donate`;
      const response = await page.goto(target);
      expect(response?.status(), target).toBe(200);
      expect(response?.headers()['set-cookie'], target).toBeUndefined();
      await expect(mainHeading(page), target).toHaveText(
        copy('donations.title', {}, locale),
      );
      const main = page.getByRole('main');
      await expect(main, target).toContainText(copy('donations.unavailable', {}, locale));
      // The campaigns are described; none can be given to.
      await expect(campaignCard(page, TEXT.long), target).toContainText(
        copy('donations.campaigns.closed', {}, locale),
      );
      await expect(main.locator('form'), target).toHaveCount(0);
      await expect(main.getByRole('button'), target).toHaveCount(0);
      // No test banner: nothing is running, test or otherwise.
      await expect(main, target).not.toContainText('TEST ENVIRONMENT');
      expect(await page.content(), target).not.toContain(TEXT.draft);
      await expectNoPaymentDetailFields(page, target);
    }

    // My donations says the same, and offers no form either.
    await donor.page.goto('/en/my/donations');
    const mine = donor.page.getByRole('main');
    await expect(mine).toContainText(copy('donations.unavailable'));
    await expect(mine).toContainText(copy('myDonations.history.empty'));
    await expect(
      mine.getByRole('button', { name: copy('donations.form.submit') }),
    ).toHaveCount(0);
  });

  test('activated for the fixture, /donate shows the TEST banner, is never indexed, and asks for no payment details', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await activateFixtureGiving();

    for (const locale of LOCALES) {
      const target = `/${locale}/donate`;
      const response = await page.goto(target);
      expect(response?.status(), target).toBe(200);
      expect(response?.headers()['set-cookie'], target).toBeUndefined();
      await expect(page.locator('html'), target).toHaveAttribute(
        'dir',
        locale === 'en' ? 'ltr' : 'rtl',
      );
      await expect(page.locator('html'), target).toHaveAttribute('lang', locale);
      await expect(page.getByRole('main').getByRole('note'), target).toHaveText(
        copy('donations.banner.fixture', {}, locale),
      );
      await expect(page.locator('meta[name="robots"]').first(), target).toHaveAttribute(
        'content',
        /noindex/u,
      );
      // Words in the reader's language where the campaign has them; English,
      // said so, where it has not.
      const title = locale === 'ur' ? TEXT.mainUr : TEXT.main;
      const card = campaignCard(page, title);
      await expect(
        card.locator(`[lang="${locale === 'ur' ? 'ur' : 'en'}"]`).first(),
      ).toBeVisible();
      if (locale === 'ar')
        await expect(card.getByRole('status')).toHaveText(
          copy('donations.campaign.fallback', { language: 'English' }, locale),
        );
      await expect(giveButton(card, locale), target).toBeVisible();
      await expect(page.getByRole('main'), target).toContainText(
        copy('donations.form.provider', {}, locale),
      );
      expect(await page.content(), target).not.toContain(TEXT.draft);
      await expectNoPaymentDetailFields(page, target);
    }
  });
});

/* ===========================================================================
 * 2. Giving anonymously
 * ========================================================================= */

test.describe('an anonymous gift', () => {
  test('goes only to the provider and back, and reads pending until the verified webhook arrives', async ({
    page,
    browser,
  }) => {
    test.setTimeout(420_000);
    const app = new URL(baseUrl()).origin;
    const provider = donationsFixture().simulatorOrigin;
    const origins = new Set<string>();
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.protocol === 'http:' || url.protocol === 'https:') origins.add(url.origin);
    });

    await withWebhooks('hold', async () => {
      await page.goto('/en/donate');
      const submitted = actionRequest(page);
      const { operationId, session } = await startGift(page, TEXT.main, '12.34');
      const first = await captured(await submitted);

      // The provider was asked for EXACTLY what the server decided.
      await expect(page.getByTestId('amount')).toHaveText('12.34 USD');
      await expect(page.getByTestId('product')).toHaveText(TEXT.main);
      const started = await donationOf(operationId);
      expect(started).toMatchObject({
        state: 'pending',
        createState: 'created',
        donorUserId: null,
        campaignId: ids.main,
        currency: 'USD',
        expected: '1234',
        checkoutReference: session,
      });

      // The status cookie: HttpOnly, Lax, only on this locale's giving pages.
      const cookie = (await page.context().cookies(`${app}/en/donate/return`)).find(
        (entry) => entry.name === 'minhaj-donation-status',
      );
      expect(cookie).toMatchObject({
        httpOnly: true,
        sameSite: 'Lax',
        path: '/en/donate',
      });

      // THE SAME SUBMISSION AGAIN, while the checkout is open: the same
      // checkout, no second donation, no second token.
      const again = await page.context().request.post(first.url, {
        headers: first.headers,
        data: first.body,
        maxRedirects: 0,
      });
      expect(again.headers()['x-action-redirect'] ?? '').toContain(`/c/pay/${session}`);
      expect(again.headers()['set-cookie']).toBeUndefined();
      expect(await donationsOf(operationId)).toHaveLength(1);
      expect(await performedCreates(started.id)).toBe(1);

      // PAID — but the provider's webhooks are held, so nothing is verified.
      const statusPath = await payAndReturn(page);
      await expectState(page, 'pending');
      await expect(page.getByRole('main')).toContainText(
        copy('donations.status.notProof'),
      );
      expect(await stateOf(operationId)).toBe('pending');
      expect(
        (await simulator<{ type: string }[]>('held')).map((event) => event.type),
      ).toContain('checkout.session.completed');

      // The bearer address is private and never sent on.
      const read = await page.context().request.get(statusPath, { maxRedirects: 0 });
      expect(read.headers()['cache-control']).toContain('no-store');
      expect(read.headers()['referrer-policy']).toBe('no-referrer');
      await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute(
        'content',
        /noindex/u,
      );

      // A RETURN ADDRESS CLAIMING SUCCESS PROVES NOTHING.
      await page.goto(
        `/en/donate/return?status=success&amount=12.34&currency=USD&session_id=${session}`,
      );
      await page.waitForURL(STATUS_PATH);
      expect(new URL(page.url()).pathname).toBe(statusPath);
      await expectState(page, 'pending');
      await page.goto(`${statusPath}?status=succeeded&state=succeeded&paid=1`);
      await expectState(page, 'pending');
      expect(await stateOf(operationId)).toBe('pending');

      // A browser that started nothing is told so, whatever the address says.
      const elsewhere = await browser.newContext({
        baseURL: baseUrl(),
        extraHTTPHeaders: { 'x-forwarded-for': '100.64.239.90' },
      });
      contexts.push(elsewhere);
      const other = await elsewhere.newPage();
      await other.goto(`/en/donate/return?status=success&session_id=${session}`);
      await expect(other.getByRole('main')).toContainText(
        copy('donations.return.missing'),
      );
      expect(new URL(other.url()).pathname).toBe('/en/donate/return');

      // THE PROVIDER'S VERIFIED WEBHOOKS, released: now it is paid.
      const deliveries = await simulator<(number | string)[]>('releaseHeld');
      expect(deliveries.length).toBeGreaterThan(0);
      for (const status of deliveries) expect(status).toBe(200);
      await expect
        .poll(() => stateOf(operationId), { timeout: 60_000 })
        .toBe('succeeded');

      // The page the donor still holds asks again, and shows the provider's answer.
      await page
        .getByRole('main')
        .getByRole('button', { name: copy('donations.status.check.submit'), exact: true })
        .click();
      await page.waitForURL(/\?done=checked$/u);
      await expectState(page, 'succeeded');
      await expect(
        page.getByRole('button', { name: copy('donations.status.check.submit') }),
      ).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: copy('donations.status.cancel.submit') }),
      ).toHaveCount(0);
      await expect(page.getByRole('main')).toContainText(/USD\s12\.34/u);

      // The same submission once more, now that the checkout has closed: refused.
      const late = await page.context().request.post(first.url, {
        headers: first.headers,
        data: first.body,
        maxRedirects: 0,
      });
      expect(late.headers()['x-action-redirect']).toBeUndefined();
      expect(await late.text()).toContain('already-submitted');
      expect(await donationsOf(operationId)).toHaveLength(1);
      expect(await performedCreates(started.id)).toBe(1);

      paid = { operationId, statusPath };
    });

    // THE BROWSER WENT TO THE APPLICATION AND THE PROVIDER'S PAGE, NOWHERE ELSE.
    expect([...origins].sort()).toEqual([app, provider].sort());
  });

  test('a double click starts one donation, and a donor cancels an open checkout only after confirming', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await page.goto('/en/donate');
    const card = campaignCard(page, TEXT.main);
    const operationId = await card.locator('input[name="operationId"]').inputValue();
    // The default suggestion — the first currency's first, 500 yen, a
    // currency with no minor unit — chosen with no typing at all.
    await expect(card.getByLabel(/JPY\s500/u)).toBeChecked();
    await giveButton(card).dblclick();
    const session = await onHostedPage(page);
    await expect(page.getByTestId('amount')).toHaveText('500 JPY');
    const started = await donationOf(operationId);
    expect(started).toMatchObject({
      currency: 'JPY',
      expected: '500',
      checkoutReference: session,
    });
    expect(await performedCreates(started.id)).toBe(1);

    // Back from the provider without paying.
    await page.getByRole('button', { name: 'Cancel and return', exact: true }).click();
    await page.waitForURL(STATUS_PATH, { timeout: 60_000 });
    await expectState(page, 'pending');
    const main = page.getByRole('main');
    const cancel = main.getByRole('button', {
      name: copy('donations.status.cancel.submit'),
      exact: true,
    });

    // Unconfirmed: refused in words, and nothing changes.
    await cancel.click();
    await expect(alertIn(page)).toHaveText(copy('donations.failure.confirmRequired'));
    expect(await stateOf(operationId)).toBe('pending');

    await main
      .getByLabel(copy('donations.status.cancel.confirm'), { exact: true })
      .check();
    await cancel.click();
    await page.waitForURL(/\?done=cancel-requested$/u);
    await expectState(page, 'cancelled');
    await expect(main).toContainText(copy('donations.status.done.cancel'));
    expect(await stateOf(operationId)).toBe('cancelled');
    expect((await simulator<{ status: string }>('session', session)).status).toBe(
      'expired',
    );
  });

  test('a declined card is not a payment, and a failed payment says so', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    // DECLINED: the provider's page says so, the checkout stays open, and the
    // donation is not paid — whatever page the donor returns to.
    await page.goto('/en/donate');
    const declined = await startGift(page, TEXT.main, '7.00');
    await page.getByRole('button', { name: 'Decline', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText(
      'Your card was declined. No payment was taken.',
    );
    await simulator('flush');
    await page.getByRole('button', { name: 'Cancel and return', exact: true }).click();
    await page.waitForURL(STATUS_PATH, { timeout: 60_000 });
    await expectState(page, 'pending');
    expect(await stateOf(declined.operationId)).toBe('pending');

    // FAILED: an asynchronous payment the provider later reports failed —
    // given to the campaign that offers no suggestions, by typing.
    await page.goto('/en/donate');
    const card = campaignCard(page, TEXT.long);
    await expect(card.locator('input[type="radio"]')).toHaveCount(0);
    const failing = await startGift(page, TEXT.long, '3.50');
    await simulator('complete', failing.session, { outcome: 'processing' });
    await simulator('flush');
    expect(await stateOf(failing.operationId)).toBe('pending');
    await simulator('settleAsync', failing.session, 'failed');
    await simulator('flush');
    await expect
      .poll(() => stateOf(failing.operationId), { timeout: 60_000 })
      .toBe('failed');

    // The browser comes back the way a donor would, and reads it in words.
    await page.goto('/en/donate/return');
    await page.waitForURL(STATUS_PATH);
    await expectState(page, 'failed');
    await expect(page.getByRole('main')).toContainText(/USD\s3\.50/u);
    await expect(
      page.getByRole('button', { name: copy('donations.status.cancel.submit') }),
    ).toHaveCount(0);
  });

  test('a checkout address on any host but the provider’s is never followed', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const app = new URL(baseUrl()).origin;
    await page.goto('/en/donate');
    const card = campaignCard(page, TEXT.main);
    const operationId = await card.locator('input[name="operationId"]').inputValue();
    await fillUsd(card, '4.00');

    // The provider answers with an address on another host.
    await simulator(
      'tamperCheckoutUrl',
      'https://checkout.example.invalid/c/pay/elsewhere',
    );
    await giveButton(card).click();
    await expect(alertIn(page)).toHaveText(copy('donations.failure.providerUnavailable'));
    expect(new URL(page.url()).origin).toBe(app);
    const ambiguous = await donationOf(operationId);
    expect(ambiguous.createState).toBe('ambiguous');

    // The same gift on the same form again: the provider's ORIGINAL checkout,
    // under the same key — still one donation, still one checkout created.
    expect(await card.locator('input[name="operationId"]').inputValue()).toBe(
      operationId,
    );
    await fillUsd(card, '4.00');
    await giveButton(card).click();
    const session = await onHostedPage(page);
    const resolved = await donationOf(operationId);
    expect(resolved).toMatchObject({
      createState: 'created',
      checkoutReference: session,
    });
    expect(await performedCreates(resolved.id)).toBe(1);
    await simulator('clearFaults');
  });
});

/* ===========================================================================
 * 3. Giving from an account
 * ========================================================================= */

test.describe('My donations', () => {
  test('a gift on the public page stays unlinked even when signed in', async () => {
    test.setTimeout(240_000);
    const page = donor.page;
    await page.goto('/en/donate');
    const { operationId } = await startGift(page, TEXT.main, '2.00');
    expect((await donationOf(operationId)).donorUserId).toBeNull();
    await page.getByRole('button', { name: 'Cancel and return', exact: true }).click();
    await page.waitForURL(STATUS_PATH, { timeout: 60_000 });
  });

  test('a gift started here is linked, and "Check again" asks the provider when no webhook arrives', async () => {
    test.setTimeout(360_000);
    const page = donor.page;
    const response = await page.context().request.get('/en/my/donations', {
      maxRedirects: 0,
    });
    expect(response.headers()['cache-control']).toContain('no-store');
    await page.goto('/en/my/donations');
    await expect(page.getByRole('main').getByRole('note')).toHaveText(
      copy('donations.banner.fixture'),
    );
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute(
      'content',
      /noindex/u,
    );
    await expectNoPaymentDetailFields(page, '/en/my/donations');

    await withWebhooks('drop', async () => {
      // The second suggestion, chosen by its label.
      const card = campaignCard(page, TEXT.main);
      const operationId = await card.locator('input[name="operationId"]').inputValue();
      await card.getByLabel(/USD\s25\.00/u).check();
      await giveButton(card).click();
      await onHostedPage(page);
      await expect(page.getByTestId('amount')).toHaveText('25.00 USD');
      expect(await donationOf(operationId)).toMatchObject({
        donorUserId: donor.id,
        expected: '2500',
      });

      await payAndReturn(page);
      await expectState(page, 'pending');
      expect(await stateOf(operationId)).toBe('pending');

      await page
        .getByRole('main')
        .getByRole('button', { name: copy('donations.status.check.submit'), exact: true })
        .click();
      await page.waitForURL(/\?done=checked$/u);
      await expectState(page, 'succeeded');
      expect(await stateOf(operationId)).toBe('succeeded');
      linked = { operationId };
    });

    await page.goto('/en/my/donations');
    const history = page
      .getByRole('main')
      .getByRole('list', { name: copy('myDonations.history.heading'), exact: true });
    const entry = history.getByRole('listitem').filter({ hasText: TEXT.main });
    await expect(entry).toHaveCount(1);
    await expect(entry).toContainText(copy('donations.state.succeeded'));
    await expect(entry).toContainText(/USD\s25\.00/u);
    await expect(entry).toContainText(copy('donations.environment.fixture'));

    // The account's home says so too.
    await page.goto('/en/my');
    await expect(page.getByRole('main')).toContainText(copy('myDonations.home.heading'));

    // The export is the person's own, privately.
    const exported = await page.context().request.get('/api/my/export/donations');
    expect(exported.status()).toBe(200);
    expect(exported.headers()['cache-control']).toBe('private, no-store');
    const document = (await exported.json()) as {
      schema: string;
      donations: { id: string; amount: string; state: string }[];
    };
    expect(document.schema).toBe('minhaj.donations.export');
    const own = await donationOf(linked.operationId);
    expect(document.donations.map((row) => [row.id, row.amount, row.state])).toEqual([
      [own.id, '25.00', 'succeeded'],
    ]);
  });

  test('nobody else sees it, and a guessed address finds nothing', async () => {
    test.setTimeout(240_000);
    const own = await donationOf(linked.operationId);
    const anonymous = await donationOf(paid.operationId);
    const page = stranger.page;

    await page.goto('/en/my/donations');
    await expect(page.getByRole('main')).toContainText(copy('myDonations.history.empty'));
    const html = await page.content();
    for (const secret of [own.id, anonymous.id, paid.statusPath, donor.email])
      expect(html).not.toContain(secret);

    const exported = (await (
      await page.context().request.get('/api/my/export/donations')
    ).json()) as { donations: unknown[] };
    expect(exported.donations).toEqual([]);

    // Guessed addresses: an id is not a token, and a token is not guessable.
    const forged = randomBytes(32).toString('base64url');
    for (const target of [
      `/en/my/donations/${own.id}`,
      `/en/donate/status/${own.id}`,
      `/en/donate/status/${forged}`,
      `/en/donate/status/${paid.statusPath.split('/').at(-1) ?? ''}x`,
    ]) {
      const response = await page.goto(target);
      expect(response?.status(), target).toBe(404);
      await expect(page.locator('body'), target).not.toContainText(TEXT.main);
    }

    // The administration does not exist for an administrator of another area.
    expect((await page.goto('/en/admin'))?.status()).toBe(200);
    await expect(
      page.getByRole('link', { name: copy('admin.nav.donations'), exact: true }),
    ).toHaveCount(0);
    for (const target of [
      '/en/admin/donations',
      '/en/admin/donations/campaigns',
      recordPath(own.id),
    ]) {
      const response = await page.goto(target);
      expect(response?.status(), target).toBe(404);
      await expect(page.locator('body'), target).not.toContainText(TEXT.main);
    }
    const csv = await page.context().request.get('/api/admin/donations/export');
    expect(csv.status()).toBe(404);
  });
});

/* ===========================================================================
 * 4. The administration
 * ========================================================================= */

test.describe('Donations administration', () => {
  test('donations.read lists, filters and opens a record — and offers no act', async () => {
    test.setTimeout(300_000);
    const page = reader.page;
    const main = page.getByRole('main');
    expect((await page.goto('/en/admin/donations'))?.status()).toBe(200);
    await expect(mainHeading(page)).toHaveText(copy('adminDonations.records.title'));
    await expect(
      page.getByRole('link', { name: copy('admin.nav.donations'), exact: true }),
    ).toBeVisible();
    const rows = main.locator('tbody tr');
    const total = await scalar('SELECT COUNT_BIG(*) AS [value] FROM [dbo].[Donation];');
    await expect(rows).toHaveCount(total);
    // The only form is the GET filter.
    await expect(main.locator('form')).toHaveCount(1);
    await expect(main.locator('form[method="get"]')).toHaveCount(1);

    // Filters, through the form.
    await main.locator('#filter-state').selectOption('succeeded');
    await main.getByRole('button', { name: copy('adminDonations.filter.apply') }).click();
    await page.waitForURL(/[?&]state=succeeded/u);
    const succeeded = await scalar(
      `SELECT COUNT_BIG(*) AS [value] FROM [dbo].[Donation] WHERE [state]=N'succeeded';`,
    );
    expect(succeeded).toBeGreaterThanOrEqual(2);
    await expect(rows).toHaveCount(succeeded);
    for (const row of await rows.all())
      await expect(row).toContainText(copy('donations.state.succeeded'));

    await page.goto('/en/admin/donations?donor=linked');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(copy('adminDonations.donor.linked'));
    await expect(rows.first()).toContainText(/USD\s25\.00/u);

    await page.goto(`/en/admin/donations?campaign=${ids.long}`);
    await expect(rows).toHaveCount(
      await scalar(
        `SELECT COUNT_BIG(*) AS [value] FROM [dbo].[Donation] WHERE [campaignId]=N'${ids.long}';`,
      ),
    );
    for (const row of await rows.all()) await expect(row).toContainText(TEXT.long);

    // A filter that does not parse is refused, never broadened.
    // (The refusal renders below the area's streaming boundary, so the status
    // line is already sent; what matters is that nothing is listed.)
    await page.goto('/en/admin/donations?state=paid');
    await expect(
      page.getByRole('heading', { name: /^(?:404|Page not found)$/u }),
    ).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(TEXT.main);

    // One record, as an audited read: exact money, redacted references, no act.
    const own = await donationOf(linked.operationId);
    expect((await page.goto(recordPath(own.id)))?.status()).toBe(200);
    await expect(mainHeading(page)).toHaveText(copy('adminDonations.record.title'));
    await expect(main).toContainText(copy('adminDonations.record.audited'));
    // On this audited page only, a linked donor is named by the display name
    // Identity reports (support.ts registers every proof account as
    // `Browser Proof`) — never by the address or the account id.
    await expect(main).toContainText(
      copy('adminDonations.donor.linkedNamed', { name: 'Browser Proof' }),
    );
    await expect(main).toContainText(copy('donations.state.succeeded'));
    const reference = own.checkoutReference ?? '';
    await expect(main).toContainText(`…${reference.slice(-6)}`);
    const html = await page.content();
    expect(html).not.toContain(reference);
    expect(html).not.toContain(donor.email);
    await expect(main.locator('form')).toHaveCount(0);
    await expect(main.getByRole('button')).toHaveCount(0);
    await expectNoPaymentDetailFields(page, recordPath(own.id));
    expect(
      await scalar(
        `SELECT COUNT_BIG(*) AS [value] FROM [dbo].[AuditLog] WHERE [action]=N'donations.record.accessed' AND [actorId]=N'${reader.id}' AND [targetId]=N'${own.id}';`,
      ),
    ).toBeGreaterThanOrEqual(1);

    // The CSV export: private, attached, every record, no whole reference.
    const csv = await page.context().request.get('/api/admin/donations/export');
    expect(csv.status()).toBe(200);
    expect(csv.headers()['content-type']).toBe('text/csv; charset=utf-8');
    expect(csv.headers()['cache-control']).toBe('private, no-store');
    expect(csv.headers()['content-disposition']).toMatch(
      /^attachment; filename="minhaj-donations-\d{4}-\d{2}-\d{2}\.csv"$/u,
    );
    const text = await csv.text();
    expect(text.split(/\r?\n/u).filter((line) => line.trim() !== '')).toHaveLength(
      total + 1,
    );
    expect(text).not.toContain(reference);
    const embedded = await page.context().request.get('/api/admin/donations/export', {
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(embedded.status()).toBe(403);
  });

  test('donations.administer reconciles a gift the webhooks never reached, and is offered no refund', async ({
    page,
  }) => {
    test.setTimeout(360_000);
    await withWebhooks('drop', async () => {
      await page.goto('/en/donate');
      const { operationId } = await startGift(page, TEXT.main, '9.99');
      await payAndReturn(page);
      await expectState(page, 'pending');
      unheard = { operationId };
    });
    const record = await donationOf(unheard.operationId);
    expect(record.state).toBe('pending');

    const admin = operator.page;
    await admin.goto(recordPath(record.id));
    await expect(mainHeading(admin)).toHaveText(copy('adminDonations.record.title'));
    const main = admin.getByRole('main');
    await expect(main).toContainText(copy('donations.state.pending'));

    // No refund here: the key is not held, so neither the form nor its step-up exists.
    await expect(main).not.toContainText(copy('adminDonations.refund.heading'));
    await expect(admin.locator('#refund-amount')).toHaveCount(0);
    await expect(admin.locator('#step-up-password-donation-refund')).toHaveCount(0);

    await main
      .getByRole('button', { name: copy('adminDonations.reconcile.submit'), exact: true })
      .click();
    await expect(
      statusIn(admin).filter({ hasText: copy('adminDonations.reconcile.done') }),
    ).toBeVisible({ timeout: 60_000 });
    expect(await stateOf(unheard.operationId)).toBe('succeeded');
    await admin.goto(recordPath(record.id));
    await expect(main).toContainText(copy('donations.state.succeeded'));
    expect(
      await scalar(
        `SELECT COUNT_BIG(*) AS [value] FROM [dbo].[AuditLog] WHERE [action]=N'donations.reconcile.requested' AND [actorId]=N'${operator.id}';`,
      ),
    ).toBeGreaterThanOrEqual(1);
  });

  test('donations.refund refunds part of a gift, only behind the donation-refund step-up', async ({
    page: visitor,
  }) => {
    test.setTimeout(360_000);
    const record = await donationOf(paid.operationId);
    expect(record).toMatchObject({ state: 'succeeded', expected: '1234' });
    const page = refunder.page;
    const main = page.getByRole('main');
    await page.goto(recordPath(record.id));
    await expect(mainHeading(page)).toHaveText(copy('adminDonations.record.title'));
    // The step-up prompt is this purpose's own.
    await expect(page.locator('#step-up-password-donation-refund')).toBeVisible();
    await expect(page.locator('#step-up-code-donation-refund')).toBeVisible();
    // Reading only: no reconcile without donations.administer.
    await expect(
      main.getByRole('button', { name: copy('adminDonations.reconcile.submit') }),
    ).toHaveCount(0);

    const refund = main.getByRole('button', {
      name: copy('adminDonations.refund.submit'),
      exact: true,
    });
    const amount = page.locator('#refund-amount');
    await expect(amount).toHaveValue('12.34');

    // WITHOUT THE STEP-UP: refused in words, and nothing is reserved.
    await amount.fill('5.00');
    await page.locator('#refund-confirm').check();
    await refund.click();
    await expect(alertIn(page)).toContainText(
      copy('adminDonations.failure.stepUpRequired'),
    );
    expect(
      await scalar(
        `SELECT COUNT_BIG(*) AS [value] FROM [dbo].[DonationRefund] WHERE [donationId]=N'${record.id}';`,
      ),
    ).toBe(0);

    // WITH IT: a partial refund, accepted by the provider.
    await page.goto(recordPath(record.id));
    await page.locator('#step-up-password-donation-refund').fill(PASSWORD);
    await page
      .locator('#step-up-code-donation-refund')
      .fill(await totpCodeFor(refunderTotp));
    await page.getByRole('button', { name: ADMIN.stepUp, exact: true }).click();
    await expect(page.getByText(copy('admin.stepUp.granted'))).toBeVisible();
    await amount.fill('5.00');
    await page.locator('#refund-confirm').check();
    await refund.click();
    await expect(
      statusIn(page).filter({ hasText: copy('adminDonations.refund.accepted') }),
    ).toBeVisible({ timeout: 60_000 });

    const [made] = await sql.query<{ state: string; amount: string; userId: string }>(
      `SELECT [state], CONVERT(NVARCHAR(20),[amountMinor]) AS [amount], [requestedByUserId] AS [userId]
         FROM [dbo].[DonationRefund] WHERE [donationId]=N'${record.id}';`,
    );
    expect(made).toEqual({ state: 'succeeded', amount: '500', userId: refunder.id });
    await expect
      .poll(
        async () => {
          const now = await donationOf(paid.operationId);
          return [now.state, now.refunded];
        },
        { timeout: 60_000 },
      )
      .toEqual(['partially_refunded', '500']);

    await page.goto(recordPath(record.id));
    const refunds = main.getByRole('list', {
      name: copy('adminDonations.refunds.heading'),
      exact: true,
    });
    await expect(refunds.getByRole('listitem')).toHaveCount(1);
    await expect(refunds).toContainText(copy('donations.refundState.succeeded'));
    await expect(refunds).toContainText(/USD\s5\.00/u);
    await expect(page.locator('#refund-amount')).toHaveValue('7.34');

    // The donor's own status page says so, in words.
    await visitor.goto(paid.statusPath);
    await expectState(visitor, 'partiallyRefunded');
    await expect(visitor.getByRole('main')).toContainText(/USD\s5\.00/u);
  });
});

/* ===========================================================================
 * 5. Every surface: direction, reflow, keyboard, motion, labels
 * ========================================================================= */

test.describe('the giving surfaces', () => {
  test('are right-to-left in Urdu and Arabic, and label every control', async ({
    page: visitor,
  }) => {
    test.setTimeout(300_000);
    const own = await donationOf(linked.operationId);
    for (const [page, target] of [
      [visitor, '/ur/donate'],
      [visitor, '/ar/donate'],
      [visitor, paid.statusPath.replace('/en/', '/ur/')],
      [donor.page, '/ur/my/donations'],
      [donor.page, '/ar/my/donations'],
      [reader.page, '/ar/admin/donations'],
      [reader.page, `/ur/admin/donations/${own.id}`],
    ] as const) {
      const response = await page.goto(target);
      expect(response?.status(), target).toBe(200);
      await expect(page.locator('html'), target).toHaveAttribute('dir', 'rtl');
      await expect(page.locator('html'), target).toHaveAttribute(
        'lang',
        target.split('/')[1] ?? '',
      );
      await expect(mainHeading(page), target).toBeVisible();
    }

    for (const [page, target] of [
      [visitor, '/en/donate'],
      [visitor, paid.statusPath],
      [donor.page, '/en/my/donations'],
      [reader.page, '/en/admin/donations'],
      [reader.page, recordPath(own.id)],
    ] as const) {
      const response = await page.goto(target);
      expect(response?.status(), target).toBe(200);
      await expect(mainHeading(page), target).toBeVisible();
      await expectHeadingsInOrder(page, target);
      await expectLabelledControls(page, target);
      await expectNoPaymentDetailFields(page, target);
    }
  });

  test('reflow at 320px and 640px around an unbroken title, with a visible keyboard focus and no motion when reduced', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    // 640 CSS pixels is a 1280-pixel window at 200% zoom.
    for (const width of [320, 640]) {
      await page.setViewportSize({ width, height: 800 });
      for (const target of ['/en/donate', '/ar/donate', paid.statusPath]) {
        const where = `${String(width)}px ${target}`;
        const response = await page.goto(target);
        expect(response?.status(), where).toBe(200);
        await expect(mainHeading(page), where).toBeVisible();
        if (target.endsWith('/donate'))
          await expect(
            page.getByRole('main').getByRole('heading', { name: TEXT.long, exact: true }),
            where,
          ).toBeVisible();
        expect(await overflowOf(page), where).toBeLessThanOrEqual(0);
        await expectHeadingsInOrder(page, where);
      }
    }
    for (const width of [320, 640]) {
      await donor.page.setViewportSize({ width, height: 800 });
      const where = `${String(width)}px /en/my/donations`;
      await donor.page.goto('/en/my/donations');
      await expect(mainHeading(donor.page), where).toBeVisible();
      expect(await overflowOf(donor.page), where).toBeLessThanOrEqual(0);
    }
    await donor.page.setViewportSize({ width: 1280, height: 800 });

    // The giving form, by keyboard alone, with a focus that can be seen.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/en/donate');
    const card = campaignCard(page, TEXT.main);
    const amount = card.getByLabel(copy('donations.form.amount'), { exact: true });
    await tabTo(page, amount);
    await expectVisibleFocus(amount, 'the amount field');
    const submit = giveButton(card);
    await tabTo(page, submit);
    await expectVisibleFocus(submit, 'the giving button');

    // Reduced motion: nothing on the page animates or transitions.
    const durations = await page
      .getByRole('main')
      .locator('*')
      .evaluateAll((elements) =>
        elements.flatMap((element) => {
          const style = globalThis.getComputedStyle(element);
          return [style.transitionDuration, style.animationDuration]
            .join(',')
            .split(',')
            .map((value) => value.trim())
            .map((value) =>
              value.endsWith('ms')
                ? Number.parseFloat(value) / 1000
                : Number.parseFloat(value),
            );
        }),
      );
    expect(durations.length).toBeGreaterThan(0);
    expect(Math.max(...durations)).toBeLessThanOrEqual(0.0001);
  });
});
