import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Browser, BrowserContext, Locator, Page, Response } from '@playwright/test';

import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import {
  PASSWORD,
  accountIdFor,
  baseUrl,
  enrolSecondFactorInBrowser,
  expect,
  grantRole,
  privilegedSession,
  registerAndSignIn,
  test,
  totpCodeFor,
} from './support';

/**
 * Phase 20 — Fatwa in a real browser, against the production build.
 *
 * WHAT ONLY A BROWSER CAN PROVE: that while the service is not activated every
 * public Fatwa page says so honestly and the ask page offers nothing to type
 * into; that asking always goes through sign-in with a validated return path;
 * that one question travels the whole workflow THROUGH THE ADMINISTRATION —
 * asked, filed, assigned, drafted with a separately written public question,
 * sent for review and published behind its own step-up — by four different
 * accounts; that the public ruling carries the fixture banner, `noindex` and
 * no canonical or structured-data claim, and never the asker's words; that
 * the asker alone sees their question and is led to the ruling; that an
 * account holding every protected key but no Fatwa key is refused every Fatwa
 * screen; and that the pages reflow at 320 pixels and at 200% zoom, are
 * walked by keyboard, and do not move.
 *
 * ONE SERIAL FILE, BECAUSE ACTIVATION IS DATABASE-WIDE. `FatwaActivation` is
 * an immutable singleton: the inactive proofs run first, the fixture
 * activation is written once, and everything after it is one ordered journey.
 *
 * NOTHING HERE IS A FATWA. Every question, public question, ruling, title,
 * category and topic is a `NON_FATWA_FIXTURE…` sentinel, and the activation
 * is of `fixture` authority. The owner-only rows — the topic, the category and
 * the activation — are written on the MIGRATION connection, as the operator
 * writes them; every workflow step is a real browser interaction.
 */

// NO RETRY. The journey activates the database's Fatwa service, so a retry
// could only meet its own activation and refuse.
test.describe.configure({ mode: 'serial', retries: 0 });

let sql: SqlSession;
const contexts: BrowserContext[] = [];

const run = randomUUID().replaceAll('-', '').slice(0, 10);

/** A word only the asker's PRIVATE question carries. */
const PRIVATE_WORD = `privfatwa${run}`;
/** A word only the PUBLISHED public question and ruling carry. */
const PUBLIC_WORD = `pubfatwa${run}`;

const TEXT = {
  question: `NON_FATWA_FIXTURE_PRIVATE_QUESTION ${PRIVATE_WORD} synthetic sentinel only`,
  title: `NON_FATWA_FIXTURE title ${run}`,
  publicQuestion: `NON_FATWA_FIXTURE_PUBLIC_QUESTION ${PUBLIC_WORD} synthetic sentinel only`,
  ruling: `NON_FATWA_FIXTURE_RULING ${PUBLIC_WORD} synthetic sentinel only`,
} as const;

const ids = {
  topic: randomUUID(),
  category: randomUUID(),
};

const slug = {
  topic: `fixture-topic-fatwa-${run}`,
  category: `fixture-category-fatwa-${run}`,
  ruling: `fixture-ruling-${run}`,
};

const NAME = {
  topic: `NON_FATWA_FIXTURE topic ${run}`,
  category: `NON_FATWA_FIXTURE category ${run}`,
};

const RULING = `/fatwa/${slug.ruling}`;
const FATWA_KEYS = ['question.receive', 'fatwa.answer', 'fatwa.publish'] as const;

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

interface FatwaCopy {
  readonly fixture: string;
  readonly unavailable: { readonly body: string };
}

/** The shipped catalogue's Fatwa copy in each interface locale. */
const COPY = Object.fromEntries(
  LOCALES.map((locale) => [
    locale,
    (
      JSON.parse(readFileSync(path.join(MESSAGES, `${locale}.json`), 'utf8')) as {
        fatwa: FatwaCopy;
      }
    ).fatwa,
  ]),
) as Record<UiLocale, FatwaCopy>;

/** A SQL Server Unicode literal. Values are this file's own constants. */
const n = (value: string) => `N'${value.replaceAll("'", "''")}'`;

async function scalar(statement: string): Promise<number> {
  const [row] = await sql.query<{ value: number }>(statement);
  return Number(row?.value ?? Number.NaN);
}

/* ===========================================================================
 * Page helpers
 * ========================================================================= */

/** Moves focus by Tab alone until it lands on `target`. */
async function tabTo(page: Page, target: Locator): Promise<void> {
  const handle = await target.elementHandle();
  if (handle === null) throw new Error('The keyboard target is not on the page.');
  let reached = false;
  for (let step = 0; step < 120 && !reached; step += 1) {
    await page.keyboard.press('Tab');
    reached = await handle.evaluate((element) => document.activeElement === element);
  }
  expect(reached, 'reached by Tab alone').toBe(true);
}

/** The focused element shows a visible focus indicator. */
async function expectVisibleFocus(target: Locator): Promise<void> {
  const focus = await target.evaluate((element) => {
    const style = globalThis.getComputedStyle(element);
    return {
      visible: element.matches(':focus-visible'),
      outline: style.outlineStyle,
      width: Number.parseFloat(style.outlineWidth),
      shadow: style.boxShadow,
    };
  });
  expect(focus.visible).toBe(true);
  expect(
    (focus.outline !== 'none' && focus.width > 0) || focus.shadow !== 'none',
    JSON.stringify(focus),
  ).toBe(true);
}

/** Horizontal overflow of the document, in CSS pixels (≤ 0 means none). */
function overflowOf(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/**
 * The main region's heading outline is walkable: exactly one `h1`, first, and
 * no level skipped on the way down.
 */
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

/**
 * Visits a public fixture-mode Fatwa page and asserts what EVERY such page
 * owes: a 200 with no cookie, the fixture banner in the catalogue's own words,
 * `noindex`, and no canonical, alternate or structured-data claim.
 */
async function visitFixture(
  page: Page,
  target: string,
  locale: UiLocale = 'en',
): Promise<Response> {
  const response = await page.goto(target);
  expect(response?.status(), target).toBe(200);
  expect(response?.headers()['set-cookie'], target).toBeUndefined();
  const banner = page.getByRole('note');
  await expect(banner, target).toHaveCount(1);
  await expect(banner, target).toHaveText(COPY[locale].fixture);
  await expect(page.locator('meta[name="robots"]'), target).toHaveAttribute(
    'content',
    /noindex/,
  );
  await expect(page.locator('link[rel="canonical"]'), target).toHaveCount(0);
  await expect(page.locator('link[rel="alternate"][hreflang]'), target).toHaveCount(0);
  await expect(page.locator('script[type="application/ld+json"]'), target).toHaveCount(0);
  return response as Response;
}

/** The private surface is never cached and never indexed. */
async function expectPrivateSurface(page: Page, target: string): Promise<void> {
  const response = await page.context().request.get(target, { maxRedirects: 0 });
  expect(response.status(), target).toBe(200);
  const cache = response.headers()['cache-control'] ?? '';
  expect(cache, target).toContain('private');
  expect(cache, target).toContain('no-store');
  await page.goto(target);
  await expect(page.locator('meta[name="robots"]'), target).toHaveAttribute(
    'content',
    /noindex/,
  );
}

/** A signed-in account on its own context and client address. */
async function account(
  browser: Browser,
  index: number,
  prefix: string,
): Promise<{ page: Page; id: string }> {
  const context = await browser.newContext({
    baseURL: baseUrl(),
    extraHTTPHeaders: { 'x-forwarded-for': `100.64.248.${String(index)}` },
  });
  contexts.push(context);
  const page = await context.newPage();
  const { email } = await registerAndSignIn(page, prefix);
  return { page, id: await accountIdFor(sql, email) };
}

/* ===========================================================================
 * Fixture
 * ========================================================================= */

let asker: Page;
let askerId: string;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  sql = await privilegedSession();

  // ACTIVATION IS DATABASE-WIDE. A second attempt in the same run's database
  // finds the first attempt's activation and cannot re-prove the inactive
  // state, so it fails here, saying why.
  const existing = await scalar(
    'SELECT (SELECT COUNT_BIG(*) FROM [dbo].[FatwaActivation]) + (SELECT COUNT_BIG(*) FROM [dbo].[FatwaQuestion]) AS [value];',
  );
  if (existing !== 0)
    throw new Error(
      'This run’s database already holds a Fatwa activation or question; the Fatwa journey can run once per database.',
    );

  // The topic and the category the workflow chooses from — everything but the
  // ACTIVATION. Until `FatwaActivation` has its row the service is inactive
  // whatever else exists, which is the first state this file proves.
  await sql.query(`
    INSERT INTO [dbo].[Topic] ([id],[slug],[parentId],[position],[status],[system]) VALUES
      (N'${ids.topic}', N'${slug.topic}', NULL, 953, N'active', 0);
    INSERT INTO [dbo].[TopicTranslation] ([topicId],[locale],[name],[description]) VALUES
      (N'${ids.topic}', N'en', ${n(NAME.topic)}, NULL);
    INSERT INTO [dbo].[FatwaCategory] ([id],[slug],[topicId],[position],[status]) VALUES
      (N'${ids.category}', N'${slug.category}', N'${ids.topic}', 0, N'active');
    INSERT INTO [dbo].[FatwaCategoryName] ([categoryId],[locale],[name]) VALUES
      (N'${ids.category}', N'en', ${n(NAME.category)}),
      (N'${ids.category}', N'ur', ${n(NAME.category)}),
      (N'${ids.category}', N'ar', ${n(NAME.category)});
  `);

  ({ page: asker, id: askerId } = await account(browser, 1, 'fatwa-asker'));
});

test.afterAll(async () => {
  for (const context of contexts) await context.close();
  await sql?.close();
});

/* ===========================================================================
 * 1. The service is not activated
 * ========================================================================= */

test.describe('while the Fatwa service is not activated', () => {
  test('the landing says so honestly in every locale — no banner, no cookie', async ({
    page,
  }) => {
    for (const locale of LOCALES) {
      const response = await page.goto(`/${locale}/fatwa`);
      expect(response?.status(), locale).toBe(200);
      expect(response?.headers()['set-cookie'], locale).toBeUndefined();
      await expect(page.locator('html')).toHaveAttribute(
        'dir',
        locale === 'en' ? 'ltr' : 'rtl',
      );
      await expect(page.getByText(COPY[locale].unavailable.body)).toBeVisible();
      await expect(page.getByRole('note')).toHaveCount(0);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        'content',
        /noindex/,
      );
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
      const main = page.getByRole('main');
      await expect(main).not.toContainText('NON_FATWA_FIXTURE');
      await expect(main.getByRole('search')).toHaveCount(0);
    }
  });

  test('how it works still renders, and says no question is being accepted', async ({
    page,
  }) => {
    const response = await page.goto('/en/fatwa/how-it-works');
    expect(response?.status()).toBe(200);
    expect(response?.headers()['set-cookie']).toBeUndefined();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'How the Fatwa service works',
    );
    await expect(
      page.getByText('The service is not accepting questions at the moment.'),
    ).toBeVisible();
  });

  test('the removed derived-view paths are absent', async ({ request }) => {
    for (const missing of ['/en/fatwa/latest', '/en/fatwa/popular']) {
      const response = await request.get(missing, { maxRedirects: 0 });
      expect(response.status(), missing).toBe(404);
    }
  });

  test('asking anonymously ends at sign-in with a validated return path', async ({
    page,
  }) => {
    await page.goto('/en/fatwa/ask');
    await page.waitForURL(/\/en\/signin\?/);
    const url = new URL(page.url());
    expect(`${url.pathname}${url.search}`).toBe(
      '/en/signin?returnTo=%2Fen%2Fmy%2Fquestions%2Fask',
    );
  });

  test('a signed-in account is offered nothing to type into', async () => {
    const response = await asker.goto('/en/my/questions/ask');
    expect(response?.status()).toBe(200);
    await expect(
      asker.getByText(
        'The Fatwa service is not accepting questions at the moment, so there is nothing to fill in.',
      ),
    ).toBeVisible();
    await expect(asker.locator('textarea')).toHaveCount(0);
    await expect(asker.getByRole('button', { name: 'Send question' })).toHaveCount(0);
  });
});

/* ===========================================================================
 * 2. A fixture activation, and one question through the whole workflow
 * ========================================================================= */

test.describe('a fixture activation', () => {
  let secondAsker: Page;
  let receiver: Page;
  let answerer: Page;
  let answererId: string;
  let publisher: Page;
  let publisherTotp: string;
  let questionId: string;
  let fatwaId: string;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);

    // THE OPERATOR'S ACT. From now on the service accepts questions.
    await sql.query(`
      INSERT INTO [dbo].[FatwaActivation] ([id],[authority],[authorisedBy])
        VALUES (1, N'fixture', N'NON_FATWA_FIXTURE browser operator');
    `);

    ({ page: secondAsker } = await account(browser, 2, 'fatwa-asker-two'));
    let receiverId: string;
    ({ page: receiver, id: receiverId } = await account(browser, 3, 'fatwa-receiver'));
    await grantRole(sql, receiverId, ['question.receive'], 'Fatwa browser proof');
    ({ page: answerer, id: answererId } = await account(browser, 4, 'fatwa-answerer'));
    await grantRole(sql, answererId, ['fatwa.answer'], 'Fatwa browser proof');
    let publisherId: string;
    ({ page: publisher, id: publisherId } = await account(browser, 5, 'fatwa-publisher'));
    await grantRole(sql, publisherId, ['fatwa.publish'], 'Fatwa browser proof');

    // Publication needs a COMPLETE privileged posture: a second factor enrolled
    // and its recovery codes confirmed, through the UI.
    publisherTotp = (await enrolSecondFactorInBrowser(publisher)).totpUri;
  });

  test('the asker reads the privacy terms first, asks, and lands on an opaque address', async () => {
    const page = asker;
    await page.goto('/en/my/questions/ask');
    const privacy = page.locator('section[aria-labelledby="ask-privacy"]');
    await expect(privacy.getByRole('heading', { level: 2 })).toHaveText(
      'How your question is handled',
    );
    await expect(privacy.getByRole('listitem')).toHaveCount(4);
    await expect(privacy).toContainText('It is never published as you wrote it.');

    const box = page.getByRole('textbox', { name: 'Your question' });
    await expect(box).toBeVisible();
    await box.fill(TEXT.question);
    await page.getByRole('button', { name: 'Send question' }).click();
    await page.waitForURL(/\/en\/my\/questions\/[0-9a-f-]{36}$/);

    // THE ADDRESS IS THE QUESTION'S OPAQUE ID, NEVER ITS WORDS.
    const url = page.url();
    expect(url).not.toContain(PRIVATE_WORD);
    expect(url).not.toContain('NON_FATWA');
    questionId = url.split('/').at(-1) ?? '';
    const [row] = await sql.query<{ askerId: string; status: string; body: string }>(
      `SELECT [askerId],[status],[body] FROM [dbo].[FatwaQuestion] WHERE [id]=N'${questionId}';`,
    );
    expect(row).toEqual({ askerId, status: 'submitted', body: TEXT.question });

    const main = page.getByRole('main');
    await expect(main).toContainText(TEXT.question);
    await expect(main).toContainText('Received');

    // The list names the question by date and status — never by its words.
    await page.goto('/en/my/questions');
    const list = page.getByRole('list', { name: 'Your questions' });
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(list.getByRole('link')).toHaveAttribute(
      'href',
      `/en/my/questions/${questionId}`,
    );
    await expect(page.getByRole('main')).not.toContainText(PRIVATE_WORD);

    for (const target of [
      '/en/my/questions',
      '/en/my/questions/ask',
      `/en/my/questions/${questionId}`,
    ])
      await expectPrivateSurface(page, target);
  });

  test('another account cannot open the question, and does not see it listed', async () => {
    const response = await secondAsker.goto(`/en/my/questions/${questionId}`);
    expect(response?.status()).toBe(404);
    await expect(secondAsker.locator('body')).not.toContainText(PRIVATE_WORD);

    await secondAsker.goto('/en/my/questions');
    await expect(
      secondAsker.getByText('You have not asked a question yet.'),
    ).toBeVisible();
    await expect(secondAsker.getByRole('list', { name: 'Your questions' })).toHaveCount(
      0,
    );
    expect(
      await secondAsker
        .locator('a[href]')
        .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? '')),
    ).not.toContain(`/en/my/questions/${questionId}`);
  });

  test('question.receive files and assigns the question — the list never shows its words', async () => {
    const page = receiver;
    await page.goto('/en/admin/fatwa/questions');
    const main = page.getByRole('main');
    await expect(
      main.getByRole('link', { name: `Open question ${questionId.slice(0, 8)}` }),
    ).toHaveAttribute('href', `/en/admin/fatwa/questions/${questionId}`);
    await expect(main).not.toContainText(PRIVATE_WORD);
    await expectPrivateSurface(page, '/en/admin/fatwa/questions');

    // The detail is an audited read, and says so before the text.
    const detail = `/en/admin/fatwa/questions/${questionId}`;
    await page.goto(detail);
    await expect(main).toContainText('Your opening this page has been recorded.');
    await expect(main).toContainText(TEXT.question);

    const triage = page.locator('section[aria-labelledby="fatwa-triage"]');
    await triage.locator('#fatwa-triage-category').selectOption(ids.category);
    await triage.getByRole('button', { name: 'File question' }).click();
    // Filed: the only category is now the question's own, so triage offers no
    // other, and assignment opens.
    await expect(triage).toContainText('No other active category is available.');
    await expect(page.locator('#fatwa-assign-answerer')).toBeVisible();

    await page.goto(detail);
    const assign = page.locator('section[aria-labelledby="fatwa-assign"]');
    await assign.locator('#fatwa-assign-answerer').selectOption(answererId);
    await assign.getByRole('button', { name: 'Assign' }).click();
    // Assigned: the one answerer now holds it, so nobody else is offered.
    await expect(assign).toContainText('Nobody else may answer questions at the moment.');

    const [row] = await sql.query<{
      status: string;
      categoryId: string;
      assigneeId: string;
    }>(
      `SELECT [status],[categoryId],[assigneeId] FROM [dbo].[FatwaQuestion] WHERE [id]=N'${questionId}';`,
    );
    expect(row).toEqual({
      status: 'assigned',
      categoryId: ids.category,
      assigneeId: answererId,
    });
    await expectPrivateSurface(page, detail);
  });

  test('fatwa.answer drafts a separate public question and sends it for review', async () => {
    const page = answerer;
    const draft = `/en/admin/fatwa/drafts/${questionId}`;
    await page.goto(draft);
    const main = page.getByRole('main');
    await expect(main).toContainText(TEXT.question);

    // THE PUBLIC QUESTION IS ITS OWN FIELD, empty, never pre-filled with the
    // original, and the instruction to write it anew sits beside it.
    const publicQuestion = page.getByRole('textbox', { name: 'Public question' });
    await expect(publicQuestion).toHaveValue('');
    await expect(
      main.getByText(
        'Write the anonymised public question yourself — never paste the original.',
      ),
    ).toBeVisible();

    await page.getByRole('textbox', { name: 'Address' }).fill(slug.ruling);
    await page.getByRole('textbox', { name: 'Title' }).fill(TEXT.title);
    await publicQuestion.fill(TEXT.publicQuestion);
    await page.getByRole('textbox', { name: 'Ruling', exact: true }).fill(TEXT.ruling);
    await page.locator('#fatwa-draft-language').selectOption('en');
    await expect(page.locator('#fatwa-draft-category')).toHaveValue(ids.category);
    await page.locator(`#fatwa-topic-${ids.topic}`).check();
    await page.getByRole('button', { name: 'Save revision' }).click();
    // Saved: revision 1 exists and can now be sent for review.
    await expect(page.locator('section[aria-labelledby="fatwa-submit"]')).toContainText(
      'Revision 1 goes to a scholar with publication authority.',
    );

    await page.goto(draft);
    const submit = page.locator('section[aria-labelledby="fatwa-submit"]');
    await submit.getByRole('button', { name: 'Send for review' }).click();
    await expect(page.getByRole('main')).toContainText(
      'The latest revision is with a scholar for review.',
    );
    await expect(submit).toHaveCount(0);

    const [row] = await sql.query<{ id: string; reviewState: string; slug: string }>(
      `SELECT [id],[reviewState],[slug] FROM [dbo].[Fatwa] WHERE [questionId]=N'${questionId}';`,
    );
    expect(row?.reviewState).toBe('in_review');
    expect(row?.slug).toBe(slug.ruling);
    fatwaId = row?.id ?? '';
    const [revision] = await sql.query<{ publicQuestion: string; authorId: string }>(
      `SELECT [publicQuestion],[authorId] FROM [dbo].[FatwaRevision] WHERE [fatwaId]=N'${fatwaId}';`,
    );
    expect(revision).toEqual({
      publicQuestion: TEXT.publicQuestion,
      authorId: answererId,
    });
    await expectPrivateSurface(page, draft);
  });

  test('fatwa.publish publishes only behind the fatwa-publication step-up', async () => {
    test.setTimeout(120_000);
    const page = publisher;
    await page.goto('/en/admin/fatwa/review');
    await page.getByRole('main').getByRole('link', { name: TEXT.title }).click();
    const review = `/en/admin/fatwa/review/${fatwaId}`;
    await page.waitForURL(`**${review}`);

    // The step-up prompt is this purpose's own.
    await expect(page.locator('#step-up-password-fatwa-publication')).toBeVisible();
    await expect(page.locator('#step-up-code-fatwa-publication')).toBeVisible();
    await expectPrivateSurface(page, review);

    // WITHOUT THE STEP-UP: refused, and nothing is published.
    await page.locator('#fatwa-publish-confirm').check();
    await page.getByRole('button', { name: 'Publish revision' }).click();
    await expect(
      page.getByText('Confirm it is you for Fatwa publication, then try again.'),
    ).toBeVisible();
    expect(
      await scalar(
        `SELECT COUNT_BIG(*) AS [value] FROM [dbo].[FatwaPublication] WHERE [fatwaId]=N'${fatwaId}';`,
      ),
    ).toBe(0);

    // WITH IT: published, by this account, under that grant.
    await page.goto(review);
    await page.locator('#step-up-password-fatwa-publication').fill(PASSWORD);
    await page
      .locator('#step-up-code-fatwa-publication')
      .fill(await totpCodeFor(publisherTotp));
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(
      page.getByText('Confirmed. You can make administrative changes'),
    ).toBeVisible();
    await page.locator('#fatwa-publish-confirm').check();
    await page.getByRole('button', { name: 'Publish revision' }).click();
    await page.waitForURL(`**/en/admin/fatwa/published/${fatwaId}`);

    const [publication] = await sql.query<{ purpose: string; sequence: number }>(
      `SELECT g.[purpose], p.[sequence] FROM [dbo].[FatwaPublication] p JOIN [dbo].[StepUpGrant] g ON g.[id]=p.[stepUpGrantId] WHERE p.[fatwaId]=N'${fatwaId}';`,
    );
    expect(publication).toEqual({ purpose: 'fatwa-publication', sequence: 1 });
  });

  test('the public ruling carries the banner and the public question — never the private one', async ({
    page,
  }) => {
    const response = await visitFixture(page, `/en${RULING}`);
    const html = await response.text();
    expect(html).not.toContain(PRIVATE_WORD);
    expect(html).not.toContain('NON_FATWA_FIXTURE_PRIVATE_QUESTION');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(TEXT.title);
    const question = page.locator('section[aria-labelledby="fatwa-question"]');
    await expect(question.getByRole('heading')).toHaveText(
      'Question (as published, anonymised)',
    );
    await expect(question.locator('p[lang]')).toHaveText(TEXT.publicQuestion);
    const ruling = page.locator('section[aria-labelledby="fatwa-ruling"]');
    await expect(ruling.locator('p[lang]')).toHaveText(TEXT.ruling);
    await expect(ruling.locator('p[lang]')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('link', { name: NAME.topic })).toHaveAttribute(
      'href',
      `/en/topics/${slug.topic}`,
    );
    expect(await page.content()).not.toContain(PRIVATE_WORD);

    // Read in another interface locale, it says which language it is in.
    await visitFixture(page, `/ur${RULING}`, 'ur');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(
      page.locator('section[aria-labelledby="fatwa-ruling"] p[lang]'),
    ).toHaveText(TEXT.ruling);
  });

  test('the asker sees the question answered, with a link to the ruling', async () => {
    const page = asker;
    await page.goto(`/en/my/questions/${questionId}`);
    const main = page.getByRole('main');
    await expect(main).toContainText('Answered');
    const link = main.getByRole('link', { name: 'Read the published ruling' });
    await expect(link).toHaveAttribute('href', `/en${RULING}`);
    await link.click();
    await page.waitForURL(`**/en${RULING}`);
    await expect(page.getByRole('note')).toHaveText(COPY.en.fixture);
  });

  test('both orders list the ruling, and every view stays out of the index', async ({
    page,
  }) => {
    for (const target of [
      '/en/fatwa',
      '/en/fatwa?sort=latest',
      '/en/fatwa?sort=popular',
    ]) {
      await visitFixture(page, target);
      const list = page.getByRole('list', { name: 'Published rulings' });
      await expect(list.getByRole('link', { name: TEXT.title }), target).toHaveAttribute(
        'href',
        `/en${RULING}`,
      );
      await expect(page.getByRole('main'), target).not.toContainText(PRIVATE_WORD);
    }
    for (const locale of ['ur', 'ar'] as const) {
      await visitFixture(page, `/${locale}/fatwa`, locale);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    }
  });

  test('search finds the ruling by a public word, and nothing by a private one', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    // DERIVED WORK: indexed asynchronously, so the page is polled — never
    // slept on — and the polls are spaced inside the search admission budget.
    await expect
      .poll(
        async () => {
          const response = await page.goto(
            `/en/fatwa/search?q=${encodeURIComponent(PUBLIC_WORD)}`,
          );
          expect(response?.status()).toBe(200);
          await page.getByRole('heading', { level: 1 }).waitFor();
          return page.getByRole('main').innerText();
        },
        { timeout: 120_000, intervals: [2_000, 3_000, 5_000] },
      )
      .toContain(TEXT.title);

    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/,
    );
    await expect(page.getByRole('note')).toHaveText(COPY.en.fixture);
    const results = page.locator('ol[aria-labelledby="fatwa-results"] > li');
    await expect(results).toHaveCount(1);
    await expect(page.getByRole('link', { name: TEXT.title })).toHaveAttribute(
      'href',
      `/en${RULING}`,
    );

    // The asker's own words were never indexed.
    const response = await page.goto(
      `/en/fatwa/search?q=${encodeURIComponent(PRIVATE_WORD)}`,
    );
    expect(response?.status()).toBe(200);
    await expect(page.locator('ol[aria-labelledby="fatwa-results"] > li')).toHaveCount(0);
    await expect(page.getByRole('main')).not.toContainText(TEXT.title);
  });

  test('every protected key but no Fatwa key opens no Fatwa screen', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const bundle = (
      await sql.query<{ permissionKey: string }>(
        `SELECT rp.[permissionKey] FROM [dbo].[RolePermission] rp JOIN [dbo].[Role] r ON r.[id]=rp.[roleId] WHERE r.[key]=N'platform-administrator';`,
      )
    ).map((row) => row.permissionKey);
    expect(bundle.length).toBeGreaterThan(10);
    for (const key of FATWA_KEYS) expect(bundle).not.toContain(key);

    const { page, id } = await account(browser, 6, 'fatwa-bundle');
    await grantRole(sql, id, bundle, 'Fatwa browser proof — protected bundle');

    const statuses: Record<string, number | undefined> = {};
    for (const surface of [
      '',
      '/questions',
      `/questions/${questionId}`,
      '/assignment',
      '/drafts',
      `/drafts/${questionId}`,
      '/review',
      `/review/${fatwaId}`,
      '/published',
      '/categories',
    ]) {
      const response = await page.goto(`/en/admin/fatwa${surface}`);
      statuses[surface === '' ? '/' : surface] = response?.status();
      await expect(page.locator('body'), surface).not.toContainText(PRIVATE_WORD);
    }
    expect(
      Object.values(statuses).every((status) => status === 404),
      JSON.stringify(statuses),
    ).toBe(true);
  });

  test('pages reflow at 320px and at 200% zoom, outline and keyboard included', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    // 640 CSS pixels is a 1280-pixel window at 200% zoom.
    for (const width of [320, 640]) {
      for (const viewer of [page, asker])
        await viewer.setViewportSize({ width, height: 800 });
      for (const target of [
        ...LOCALES.map((locale) => `/${locale}/fatwa`),
        ...LOCALES.map((locale) => `/${locale}${RULING}`),
      ]) {
        const response = await page.goto(target);
        expect(response?.status(), target).toBe(200);
        expect(
          await overflowOf(page),
          `${String(width)}px ${target}`,
        ).toBeLessThanOrEqual(0);
        await expectHeadingsInOrder(page, `${String(width)}px ${target}`);
      }
      for (const locale of LOCALES) {
        const target = `/${locale}/my/questions/ask`;
        const response = await asker.goto(target);
        expect(response?.status(), target).toBe(200);
        expect(
          await overflowOf(asker),
          `${String(width)}px ${target}`,
        ).toBeLessThanOrEqual(0);
        await expectHeadingsInOrder(asker, `${String(width)}px ${target}`);
      }
    }

    // The ask box is labelled, and its submit is reached by keyboard alone.
    await asker.setViewportSize({ width: 1280, height: 800 });
    await asker.goto('/en/my/questions/ask');
    const box = asker.locator('textarea');
    await expect(box).toHaveCount(1);
    await expect(asker.getByRole('textbox', { name: 'Your question' })).toHaveAttribute(
      'name',
      'body',
    );
    const submit = asker.getByRole('button', { name: 'Send question' });
    await tabTo(asker, submit);
    await expectVisibleFocus(submit);
  });

  test('the ruling never moves', async ({ page }) => {
    // First with no preference — published text itself carries no animation
    // or transition — then under `reduce`, where nothing on the page may move
    // beyond the platform's global 0.01ms ceiling.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(`/en${RULING}`);
    const text = await page.evaluate(() =>
      [...document.querySelectorAll('main section p[lang], main h1, main h1 *')].map(
        (element) => {
          const style = globalThis.getComputedStyle(element);
          return { animation: style.animationName, transition: style.transitionDuration };
        },
      ),
    );
    expect(text.length).toBeGreaterThanOrEqual(3);
    for (const style of text) {
      expect(style.animation).toBe('none');
      for (const part of style.transition.split(', '))
        expect(Number.parseFloat(part), style.transition).toBe(0);
    }

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/en${RULING}`);
    const motion = await page.evaluate(() => ({
      running: document
        .getAnimations()
        .filter((animation) => animation.playState === 'running').length,
      styles: [...document.querySelectorAll('main, main *')].map((element) => {
        const style = globalThis.getComputedStyle(element);
        return {
          animation: style.animationName,
          animationDuration: style.animationDuration,
          transition: style.transitionDuration,
        };
      }),
    }));
    expect(motion.running).toBe(0);
    expect(motion.styles.length).toBeGreaterThan(10);
    for (const style of motion.styles) {
      if (style.animation !== 'none')
        for (const part of style.animationDuration.split(', '))
          expect(Number.parseFloat(part), style.animationDuration).toBeLessThanOrEqual(
            0.000_01,
          );
      for (const part of style.transition.split(', '))
        expect(Number.parseFloat(part), style.transition).toBeLessThanOrEqual(0.000_01);
    }
  });
});
