import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { BrowserContext, Page } from '@playwright/test';

import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import {
  sha256,
  syntheticStorageKey,
} from '../../packages/database/src/lifecycle/phase11-fixture.ts';
import { syntheticPng } from '../../packages/database/src/lifecycle/phase12-fixture.ts';
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
 * Phase 14 — Events in a real browser, against the production build.
 *
 * WHAT ONLY A BROWSER CAN SHOW, beyond what the schedule, SQL and presentation
 * proofs already establish: the Event editor authors a schedule in an IANA zone
 * with a Centre and a Gallery through three separate hands, refuses
 * self-approval and a read-only or unrelated account at the action as well as
 * in the markup; a daylight-saving gap, a repeated hour and an end before its
 * start are refused in words with the typed input kept; a schedule edit after
 * approval returns the Event to draft; the public listing, detail, gallery
 * view and a Centre's Local Events render the intended local time and the
 * zone's name for an anonymous visitor with no cookie and the same body signed
 * in; a geography filter narrows and an invalid one lists nothing; a former
 * slug is one 301, with or without `/gallery`; a withdrawn Centre or Gallery
 * degrades honestly while the Event stays public; and Urdu and Arabic render
 * right-to-left at 320 pixels and at 200% zoom with no horizontal scroll.
 *
 * EVERYTHING IS SYNTHETIC. Titles say they are fixtures; every address is
 * `.invalid`; every Country code is drawn from the ISO 3166-1 USER-ASSIGNED
 * ranges, which no real country holds; the photograph is a generated gradient.
 */

test.describe.configure({ mode: 'serial' });

let sql: SqlSession;
const contexts: BrowserContext[] = [];
let author: Page, reviewer: Page, publisher: Page, reader: Page, outsider: Page;

const run = randomUUID().replaceAll('-', '').slice(0, 8);
const ZONE = 'America/New_York';

const id = {
  country: randomUUID(),
  otherCountry: randomUUID(),
  city: randomUUID(),
  centre: randomUUID(),
  gallery: randomUUID(),
  photo: randomUUID(),
  asset: randomUUID(),
};

const place = {
  country: `browser-event-country-${run}`,
  otherCountry: `browser-event-elsewhere-${run}`,
  city: `browser-event-city-${run}`,
  centre: `browser-event-centre-${run}`,
  gallery: `browser-event-gallery-${run}`,
};

const NAME = {
  country: `Synthetic Event Country ${run}`,
  otherCountry: `Synthetic Elsewhere Country ${run}`,
  city: `Synthetic Event City ${run}`,
  centre: `Synthetic Event Centre ${run}`,
};
const ADDRESS = `Unit 0, Synthetic Event Street ${run}`;
const GALLERY_TITLE = `Synthetic event gallery ${run}`;

/** Current Event slugs — the renaming test moves the main one on. */
const slug = {
  main: `browser-event-${run}`,
  renamed: `browser-event-${run}-renamed`,
  past: `browser-event-past-${run}`,
  dst: `browser-event-dst-${run}`,
};
const TITLE = {
  en: `Synthetic browser event ${run}`,
  ur: `آزمائشی تقریب ${run}`,
  past: `Synthetic past browser event ${run}`,
  dst: `Synthetic daylight saving event ${run}`,
};

/**
 * The main Event's schedule. The first occurrence is long over and in winter
 * (Eastern Standard Time); the second is ahead and in summer (Eastern Daylight
 * Time) — its end is moved after approval, which is the edit that returns the
 * Event to draft.
 */
const WINTER = {
  start: '2025-01-10T10:00',
  end: '2025-01-10T12:00',
  instant: '2025-01-10T15:00:00Z',
  machine: '2025-01-10T10:00:00-05:00',
};
const SUMMER = {
  start: '2027-06-15T18:00',
  end: '2027-06-15T20:00',
  movedEnd: '2027-06-15T21:00',
  instant: '2027-06-15T22:00:00Z',
  machine: '2027-06-15T18:00:00-04:00',
};

let codes: { country: string; other: string };
let mainEditor = '';

/* ========================================================================== */

/**
 * Country codes no record in this database holds, from the user-assigned
 * ranges — taken from the END of the pool, so a parallel Global proof (which
 * takes from the start) and this one do not reach for the same code.
 */
async function freeCountryCodes(count: number): Promise<string[]> {
  const taken = new Set(
    (await sql.query<{ code: string }>('SELECT [code] FROM [dbo].[Country];')).map(
      (row) => row.code,
    ),
  );
  const letters = (from: string, to: string) =>
    Array.from({ length: to.charCodeAt(0) - from.charCodeAt(0) + 1 }, (_, index) =>
      String.fromCharCode(from.charCodeAt(0) + index),
    );
  const pool = [
    ...letters('A', 'Z').map((letter) => `X${letter}`),
    ...letters('M', 'Z').map((letter) => `Q${letter}`),
  ]
    .filter((code) => !taken.has(code))
    .reverse();
  if (pool.length < count) throw new Error('No free user-assigned Country codes remain.');
  return pool.slice(0, count);
}

/** The words the server writes for one occurrence, computed the same way. */
function occurrenceText(start: string, end: string, instant: string, locale = 'en') {
  const format = new Intl.DateTimeFormat(locale, {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'UTC',
  });
  const text = format.formatRange(
    new Date(`${start}:00.000Z`),
    new Date(`${end}:00.000Z`),
  );
  const zone =
    new Intl.DateTimeFormat(locale, { timeZone: ZONE, timeZoneName: 'long' })
      .formatToParts(new Date(instant))
      .find((part) => part.type === 'timeZoneName')?.value ?? ZONE;
  return { text, zone };
}

/** Presses a workflow button and waits for the version it produces. */
async function clickSaved(page: Page, name: string) {
  const next =
    Number(await page.locator('input[name="version"]').first().inputValue()) + 1;
  await page.getByRole('button', { name, exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: `Version ${String(next)}` }),
  ).toBeVisible();
}

/** Submit, approve by another person, publish by a third. */
async function throughWorkflow(editor: string) {
  await author.goto(editor);
  await clickSaved(author, 'Submit for review');
  await reviewer.goto(editor);
  await clickSaved(reviewer, 'Approve revision');
  await publisher.goto(editor);
  await clickSaved(publisher, 'Publish');
}

async function eventRow(eventId: string) {
  const [row] = await sql.query<{
    state: string;
    version: number;
    approvedRevision: number | null;
  }>(
    `SELECT [state],[version],[approvedRevision] FROM [dbo].[Event] WHERE [id]=N'${eventId}';`,
  );
  if (row === undefined) throw new Error(`No Event ${eventId}`);
  return { ...row, version: Number(row.version) };
}

const eventIdOf = (editor: string) => editor.split('/').pop() ?? '';

/* ---------------------------------------------------------------------------
 * A Server Action, replayed by another account.
 *
 * The markup hiding a control is presentation; the refusal that matters is the
 * action's. A real submission is captured as the browser sends it — the same
 * action identifier, router state and multipart body — and posted again from a
 * different signed-in context, with chosen fields rewritten. Nothing about the
 * request is invented except the account presenting it.
 * ------------------------------------------------------------------------- */

interface CapturedAction {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

async function captureAction(page: Page, trigger: () => Promise<void>) {
  const sent = page.waitForRequest(
    (request) =>
      request.method() === 'POST' && request.headers()['next-action'] !== undefined,
  );
  await trigger();
  const request = await sent;
  const all = await request.allHeaders();
  const headers: Record<string, string> = {};
  for (const name of [
    'next-action',
    'next-router-state-tree',
    'content-type',
    'accept',
    'origin',
  ])
    if (all[name] !== undefined) headers[name] = all[name];
  return {
    url: request.url(),
    headers,
    body: request.postDataBuffer()?.toString('utf8') ?? '',
  } satisfies CapturedAction;
}

async function replayAction(
  page: Page,
  captured: CapturedAction,
  fields: Record<string, string>,
): Promise<string> {
  let body = captured.body;
  for (const [name, value] of Object.entries(fields)) {
    // React prefixes a bound form's fields with its argument slot (`_1_`).
    const pattern = new RegExp(`(name="(?:_?\\d+_)?${name}"\\r\\n\\r\\n)[^\\r]*`);
    expect(pattern.test(body), `the captured action carries ${name}`).toBe(true);
    body = body.replace(pattern, `$1${value}`);
  }
  const response = await page.request.post(captured.url, {
    headers: captured.headers,
    data: Buffer.from(body, 'utf8'),
    maxRedirects: 0,
  });
  return response.text();
}

/**
 * How far the page scrolls sideways, and — when it does — the innermost
 * elements reaching past the edge, so a failure names its cause.
 */
async function overflowOf(
  page: Page,
): Promise<{ overflow: number; offenders: string[] }> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const overflow = root.scrollWidth - root.clientWidth;
    if (overflow <= 0) return { overflow, offenders: [] };
    const beyond = [...document.body.querySelectorAll('*')].filter((element) => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && (box.right > root.clientWidth + 1 || box.left < -1);
    });
    const innermost = beyond.filter(
      (element) => !beyond.some((other) => other !== element && element.contains(other)),
    );
    return {
      overflow,
      offenders: innermost.slice(0, 5).map((element) => {
        const box = element.getBoundingClientRect();
        return `<${element.tagName.toLowerCase()}> ${String(Math.round(box.width))}px: ${(element.textContent ?? '').trim().slice(0, 60)}`;
      }),
    };
  });
}

/* ========================================================================== */

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  sql = await privilegedSession();

  const [country, other] = await freeCountryCodes(2);
  codes = { country: country!, other: other! };

  // One published photograph, stored as Storage leaves it after a clean scan,
  // so the Gallery is LISTED (a Gallery with nothing public is not).
  const bytes = syntheticPng(480, 320, { hue: 40 });
  const key = syntheticStorageKey();
  const file = path.join(browserEnvironment().storageRoot, ...key.split('/'));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, bytes);

  await sql.query(`
    INSERT INTO [dbo].[Country] ([id],[code],[slug],[primaryLocale],[state]) VALUES
      (N'${id.country}', N'${codes.country}', N'${place.country}', N'en', N'published'),
      (N'${id.otherCountry}', N'${codes.other}', N'${place.otherCountry}', N'en', N'published');
    INSERT INTO [dbo].[CountryLabel] ([countryId],[locale],[name]) VALUES
      (N'${id.country}', N'en', N'${NAME.country}'),
      (N'${id.otherCountry}', N'en', N'${NAME.otherCountry}');
    INSERT INTO [dbo].[City] ([id],[countryId],[regionId],[slug],[primaryLocale],[state]) VALUES
      (N'${id.city}', N'${id.country}', NULL, N'${place.city}', N'en', N'published');
    INSERT INTO [dbo].[CityLabel] ([cityId],[locale],[name]) VALUES
      (N'${id.city}', N'en', N'${NAME.city}');
    INSERT INTO [dbo].[Centre] ([id],[slug],[countryId],[regionId],[cityId],[isVirtual],[latitude],[longitude],[primaryLocale],[state]) VALUES
      (N'${id.centre}', N'${place.centre}', N'${id.country}', NULL, N'${id.city}', 0, NULL, NULL, N'en', N'published');
    INSERT INTO [dbo].[CentreLabel] ([centreId],[locale],[name],[description],[address]) VALUES
      (N'${id.centre}', N'en', N'${NAME.centre}', NULL, N'${ADDRESS}');

    INSERT INTO [dbo].[Asset] ([id],[storageKey],[mediaType],[byteSize],[checksum],[state],[updatedAt]) VALUES
      (N'${id.asset}', N'${key}', N'image/png', ${String(bytes.byteLength)}, N'${sha256(bytes)}', N'clean', SYSUTCDATETIME());
    INSERT INTO [dbo].[Photo] ([id],[primaryLocale],[state],[credit],[takenYear],[takenMonth],[takenDay],[assetId],[width],[height],[createdAt],[updatedAt]) VALUES
      (N'${id.photo}', N'en', N'published', NULL, NULL, NULL, NULL, N'${id.asset}', 480, 320, SYSUTCDATETIME(), SYSUTCDATETIME());
    INSERT INTO [dbo].[PhotoLabel] ([photoId],[locale],[altText],[caption]) VALUES
      (N'${id.photo}', N'en', N'A synthetic gradient for the event proof ${run}', NULL);
    INSERT INTO [dbo].[Gallery] ([id],[slug],[primaryLocale],[state],[version],[updatedAt]) VALUES
      (N'${id.gallery}', N'${place.gallery}', N'en', N'published', 1, SYSUTCDATETIME());
    INSERT INTO [dbo].[GalleryLabel] ([galleryId],[locale],[title],[description]) VALUES
      (N'${id.gallery}', N'en', N'${GALLERY_TITLE}', N'A synthetic gallery for the event proof.');
    INSERT INTO [dbo].[GalleryItem] ([galleryId],[photoId],[position]) VALUES
      (N'${id.gallery}', N'${id.photo}', 0);
  `);

  const roles: readonly (readonly string[])[] = [
    // The author ALSO holds review, so the self-approval refusal is the
    // workflow's rule and not merely a missing permission.
    ['content.read', 'content.author', 'content.review'],
    ['content.read', 'content.review'],
    ['content.read', 'content.publish'],
    ['content.read'],
    ['global.read', 'global.administer', 'media.read', 'media.administer'],
  ];
  const pages: Page[] = [];
  for (const [index, keys] of roles.entries()) {
    const context = await browser.newContext({
      baseURL: baseUrl(),
      extraHTTPHeaders: { 'x-forwarded-for': `100.64.245.${String(index + 1)}` },
    });
    contexts.push(context);
    const page = await context.newPage();
    pages.push(page);
    const { email } = await registerAndSignIn(page, `events-${String(index)}`);
    await grantRole(sql, await accountIdFor(sql, email), keys, 'Events browser proof');
  }
  [author, reviewer, publisher, reader, outsider] = pages as [
    Page,
    Page,
    Page,
    Page,
    Page,
  ];
});

test.afterAll(async () => {
  for (const context of contexts) await context.close();
  await sql?.close();
});

/* ========================================================================== */

test.describe('authoring an Event', () => {
  /** A real save, made by the author, which the read-only account replays. */
  let capturedSave: CapturedAction | null = null;

  test('authors, reviews and publishes through three hands, refusing self-approval and a publish after retiming', async () => {
    test.setTimeout(240_000);

    // The editor names the Centre and the Gallery — never an identifier.
    await author.goto(`/en/admin/editorial/events/new?referenceQuery=${run}`);
    await author.getByLabel('Canonical slug', { exact: true }).fill(slug.main);
    await author.locator('#en-title').fill(TITLE.en);
    await author
      .getByRole('textbox', { name: 'Body (en)', exact: true })
      .fill('Synthetic non-authoritative event description.');
    await author.getByText('Content language: ur', { exact: true }).click();
    await author.locator('input[name="ur-enabled"]').check();
    await author.locator('#ur-title').fill(TITLE.ur);
    await author
      .getByRole('textbox', { name: 'Body (ur)', exact: true })
      .fill('آزمائشی غیر مستند تفصیل۔');
    await author.locator('#centreId').selectOption({ label: NAME.centre });
    await author.getByLabel('Event time zone (IANA)', { exact: true }).selectOption(ZONE);
    // Entered out of order on purpose: the stored schedule is chronological.
    await author.locator('#occurrence-0-start').fill(SUMMER.start);
    await author.locator('#occurrence-0-end').fill(SUMMER.end);
    await author.locator('#occurrence-1-start').fill(WINTER.start);
    await author.locator('#occurrence-1-end').fill(WINTER.end);
    await author.locator('#gallery-0').selectOption({ label: GALLERY_TITLE });
    await author.getByRole('button', { name: 'Save revision', exact: true }).click();
    await author.waitForURL(/\/en\/admin\/editorial\/events\/[0-9a-f-]{36}$/);
    mainEditor = new URL(author.url()).pathname;
    const eventId = eventIdOf(mainEditor);

    // What was saved is what the editor shows again, in order.
    await expect(author.locator('#centreId')).toHaveValue(id.centre);
    await expect(author.locator('#gallery-0')).toHaveValue(id.gallery);
    await expect(author.locator('#eventTimezone')).toHaveValue(ZONE);
    await expect(author.locator('#occurrence-0-start')).toHaveValue(WINTER.start);
    await expect(author.locator('#occurrence-1-start')).toHaveValue(SUMMER.start);
    await expect(author.locator('#occurrence-1-end')).toHaveValue(SUMMER.end);

    // The author submits; approval of their own work is not offered...
    const submitted = await captureAction(author, () =>
      clickSaved(author, 'Submit for review'),
    );
    await expect(
      author.getByRole('button', { name: 'Approve revision', exact: true }),
    ).toHaveCount(0);
    // ...and refused at the action when it is posted anyway.
    const before = await eventRow(eventId);
    expect(before.state).toBe('in-review');
    const selfApproval = await replayAction(author, submitted, {
      action: 'approve',
      version: String(before.version),
    });
    expect(selfApproval).toContain('"failure":"self-approval"');
    expect(await eventRow(eventId)).toEqual(before);

    // An independent reviewer approves; the reviewer cannot publish.
    await reviewer.goto(mainEditor);
    await clickSaved(reviewer, 'Approve revision');
    await expect(
      reviewer.getByRole('button', { name: 'Publish', exact: true }),
    ).toHaveCount(0);

    // Retiming after approval is an ordinary edit: it returns the Event to
    // draft, clears the approval, and publication is no longer offered.
    await author.goto(mainEditor);
    await author.locator('#occurrence-1-end').fill(SUMMER.movedEnd);
    const saved = await captureAction(author, () => clickSaved(author, 'Save revision'));
    expect(saved.body).toContain(SUMMER.movedEnd);
    await expect(
      author.getByRole('status').filter({ hasText: /^Draft · Version \d+$/ }),
    ).toBeVisible();
    const drafted = await eventRow(eventId);
    expect(drafted).toMatchObject({ state: 'draft', approvedRevision: null });
    await publisher.goto(mainEditor);
    await expect(
      publisher.getByRole('status').filter({ hasText: /^Draft · / }),
    ).toBeVisible();
    await expect(
      publisher.getByRole('button', { name: 'Publish', exact: true }),
    ).toHaveCount(0);
    // A publish posted anyway is refused, and nothing changes.
    const early = await replayAction(publisher, submitted, {
      action: 'publish',
      version: String(drafted.version),
    });
    expect(early).toMatch(/"failure":"(approval-required|invalid-state)"/);
    expect(await eventRow(eventId)).toEqual(drafted);

    // Resubmitted, it still needs a fresh approval before it can be published.
    await author.goto(mainEditor);
    await clickSaved(author, 'Submit for review');
    await publisher.goto(mainEditor);
    await expect(
      publisher.getByRole('button', { name: 'Publish', exact: true }),
    ).toHaveCount(0);
    await reviewer.goto(mainEditor);
    await clickSaved(reviewer, 'Approve revision');
    await publisher.goto(mainEditor);
    await clickSaved(publisher, 'Publish');
    expect((await eventRow(eventId)).state).toBe('published');

    // A second, wholly past Event with no Centre, for the past view.
    await author.goto('/en/admin/editorial/events/new');
    await author.getByLabel('Canonical slug', { exact: true }).fill(slug.past);
    await author.locator('#en-title').fill(TITLE.past);
    await author
      .getByRole('textbox', { name: 'Body (en)', exact: true })
      .fill('Synthetic non-authoritative description of an event already held.');
    await author.getByLabel('Event time zone (IANA)', { exact: true }).selectOption(ZONE);
    await author.locator('#occurrence-0-start').fill('2024-05-10T10:00');
    await author.locator('#occurrence-0-end').fill('2024-05-10T11:00');
    await author.getByRole('button', { name: 'Save revision', exact: true }).click();
    await author.waitForURL(/\/en\/admin\/editorial\/events\/[0-9a-f-]{36}$/);
    await throughWorkflow(new URL(author.url()).pathname);

    // The read-only account below replays THIS save — a real one — as itself.
    capturedSave = saved;
  });

  test('gives a read-only account the editor without a form, and refuses what it posts anyway', async () => {
    const eventId = eventIdOf(mainEditor);
    await reader.goto('/en/admin/editorial/events');
    await expect(
      reader.getByRole('heading', { name: 'Events', exact: true }),
    ).toBeVisible();
    await expect(reader.getByRole('link', { name: TITLE.en })).toBeVisible();
    await expect(reader.getByRole('link', { name: 'Create draft' })).toHaveCount(0);

    await reader.goto(mainEditor);
    await expect(
      reader.getByRole('status').filter({ hasText: /^Published · Version \d+$/ }),
    ).toBeVisible();
    await expect(reader.getByLabel('Canonical slug', { exact: true })).toHaveCount(0);
    await expect(reader.locator('#occurrence-0-start')).toHaveCount(0);
    for (const name of [
      'Save revision',
      'Submit for review',
      'Approve revision',
      'Publish',
      'Archive',
    ])
      await expect(reader.getByRole('button', { name, exact: true })).toHaveCount(0);

    // The save the author really made, posted by the reader against the
    // current version with a new title: refused, and nothing is written.
    const before = await eventRow(eventId);
    expect(capturedSave).not.toBeNull();
    const refused = await replayAction(reader, capturedSave!, {
      version: String(before.version),
      'en-title': `READER-MUST-NOT-WRITE ${run}`,
    });
    expect(refused).toContain('"failure":"denied"');
    expect(await eventRow(eventId)).toEqual(before);
    const [written] = await sql.query<{ count: number }>(
      `SELECT COUNT(*) AS [count] FROM [dbo].[EventRevisionTranslation] WHERE [title]=N'READER-MUST-NOT-WRITE ${run}';`,
    );
    expect(Number(written?.count)).toBe(0);
  });

  test('refuses the Event administration to an unrelated account and to an anonymous visitor', async ({
    page,
  }) => {
    const eventId = eventIdOf(mainEditor);
    for (const surface of ['events', 'events/new', `events/${eventId}`]) {
      const response = await outsider.goto(`/en/admin/editorial/${surface}`);
      // Refused as not-found — never a page that confirms what is there.
      expect([200, 404], surface).toContain(response?.status());
      if (response?.status() === 200)
        await expect(outsider.locator('meta[name="robots"]').first()).toHaveAttribute(
          'content',
          /noindex/,
        );
      await expect(outsider.getByText(TITLE.en)).toHaveCount(0);
      await expect(outsider.getByLabel('Canonical slug', { exact: true })).toHaveCount(0);
      await expect(
        outsider.getByRole('heading', { name: 'Events', exact: true }),
      ).toHaveCount(0);
      await expect(
        outsider.getByRole('navigation').locator('a[href="/en/admin/editorial/events"]'),
      ).toHaveCount(0);
    }

    await page.goto('/en/admin/editorial/events');
    await page.waitForURL(/\/en\/signin\?returnTo=/);
    // The administrative shell refuses first, and returns to its own root.
    expect(new URL(page.url()).searchParams.get('returnTo')).toMatch(/^\/en\/admin/);
    await expect(page.getByLabel('Canonical slug', { exact: true })).toHaveCount(0);
    expect(await page.context().cookies()).toHaveLength(0);
  });

  test('refuses a daylight-saving gap, a repeated hour without a choice and an end before its start', async () => {
    await author.goto('/en/admin/editorial/events/new');
    await author.getByLabel('Canonical slug', { exact: true }).fill(slug.dst);
    await author.locator('#en-title').fill(TITLE.dst);
    await author
      .getByRole('textbox', { name: 'Body (en)', exact: true })
      .fill('Synthetic non-authoritative daylight saving proof.');
    await author.getByLabel('Event time zone (IANA)', { exact: true }).selectOption(ZONE);
    const start = author.locator('#occurrence-0-start');
    const end = author.locator('#occurrence-0-end');
    const save = author.getByRole('button', { name: 'Save revision', exact: true });
    const refusal = (text: string) => author.getByRole('alert').filter({ hasText: text });

    // 02:30 on the spring-forward night does not exist in New York.
    await start.fill('2027-03-14T02:30');
    await save.click();
    await expect(
      refusal('A start or end time does not exist in the event'),
    ).toBeVisible();
    await expect(start).toHaveValue('2027-03-14T02:30');
    await expect(author.getByLabel('Canonical slug', { exact: true })).toHaveValue(
      slug.dst,
    );
    expect(new URL(author.url()).pathname).toBe('/en/admin/editorial/events/new');

    // An end before its start.
    await start.fill('2027-01-10T10:00');
    await end.fill('2027-01-10T09:00');
    await save.click();
    await expect(refusal('Each occurrence must end after it starts.')).toBeVisible();
    await expect(end).toHaveValue('2027-01-10T09:00');

    // 01:30 on the fall-back night happens twice: a choice is required.
    await start.fill('2026-11-01T01:30');
    await end.fill('');
    await save.click();
    await expect(refusal('A start or end time happens twice in the event')).toBeVisible();
    await expect(start).toHaveValue('2026-11-01T01:30');
    expect(new URL(author.url()).pathname).toBe('/en/admin/editorial/events/new');

    // The second 01:30 — after the clocks go back, EST, 06:30 UTC — saves.
    await author.locator('#occurrence-0-startFold').selectOption('later');
    await save.click();
    await author.waitForURL(/\/en\/admin\/editorial\/events\/[0-9a-f-]{36}$/);
    await expect(author.locator('#occurrence-0-start')).toHaveValue('2026-11-01T01:30');
    await expect(author.locator('#occurrence-0-startFold')).toHaveValue('later');
    await expect(author.locator('body')).toContainText(
      '2026-11-01 01:30 (2026-11-01T06:30:00.000Z)',
    );
  });
});

/* ========================================================================== */

test.describe('an anonymous visitor finds Events', () => {
  test('lists the upcoming Event in its local time and zone, with no cookie and the same body signed in', async ({
    page,
  }) => {
    const summer = occurrenceText(SUMMER.start, SUMMER.movedEnd, SUMMER.instant);
    expect(summer.zone).toBe('Eastern Daylight Time');

    const response = await page.goto('/en/events');
    expect(response?.status()).toBe(200);
    expect(response?.headers()['set-cookie']).toBeUndefined();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Events');
    const upcoming = page.getByRole('list', { name: 'Upcoming events', exact: true });
    const card = upcoming.getByRole('listitem').filter({ hasText: TITLE.en });
    await expect(card).toHaveCount(1);
    // The occurrence still ahead leads, as the editor stated it, with its zone.
    await expect(card.locator('time')).toHaveText(summer.text);
    await expect(card.locator('time')).toHaveAttribute('datetime', SUMMER.machine);
    await expect(card).toContainText(summer.zone);
    await expect(card).toContainText('and 1 more date');
    await expect(card.getByRole('link', { name: NAME.centre })).toHaveAttribute(
      'href',
      `/en/global/centres/${place.centre}`,
    );
    await expect(card).toContainText(`${NAME.city}, ${NAME.country}`);
    await expect(card.getByRole('link', { name: TITLE.en })).toHaveAttribute(
      'href',
      `/en/events/${slug.main}`,
    );
    await expect(upcoming.getByText(TITLE.past)).toHaveCount(0);
    await expect(page.getByText(TITLE.dst)).toHaveCount(0);
    // No picture in the content; the shell's brand lockup is not an Event's (30-R).
    await expect(page.getByRole('main').locator('img')).toHaveCount(0);

    // The same knowledge signed in, and no cookie was ever set.
    const anonymous = await page.getByRole('main').innerText();
    const signedIn = await author.goto('/en/events');
    expect(signedIn?.headers()['set-cookie']).toBeUndefined();
    expect(await author.getByRole('main').innerText()).toBe(anonymous);
    expect(await page.context().cookies()).toHaveLength(0);

    // News and Events leads here.
    await page.goto('/en/news');
    await expect(
      page.getByRole('main').locator('a[href="/en/events"]').first(),
    ).toBeVisible();
  });

  test('shows the past view, narrows by place, and lists nothing for an invalid filter', async ({
    page,
  }) => {
    await page.goto('/en/events?when=past');
    const past = page.getByRole('list', { name: 'Past events', exact: true });
    await expect(past.getByRole('link', { name: TITLE.past })).toBeVisible();
    await expect(past.getByText(TITLE.en)).toHaveCount(0);
    await expect(
      page
        .getByRole('navigation', { name: 'Upcoming or past events' })
        .getByRole('link', { name: 'Past events' }),
    ).toHaveAttribute('aria-current', 'page');

    // A Country, and a City in it, narrow to the Event held there.
    for (const query of [
      `country=${place.country}`,
      `country=${place.country}&city=${place.city}`,
    ]) {
      const response = await page.goto(`/en/events?${query}`);
      expect(response?.status(), query).toBe(200);
      await expect(
        page
          .getByRole('list', { name: 'Upcoming events', exact: true })
          .getByRole('link', { name: TITLE.en }),
        query,
      ).toBeVisible();
    }
    await expect(page.getByLabel('Country', { exact: true })).toHaveValue(place.country);
    await expect(page.getByLabel('City', { exact: true })).toHaveValue(place.city);

    // Elsewhere, nothing is held: said in words, and nothing is listed.
    await page.goto(`/en/events?country=${place.otherCountry}`);
    await expect(
      page.getByRole('main').getByText('No upcoming events are held in this place.'),
    ).toBeVisible();
    await expect(page.getByText(TITLE.en)).toHaveCount(0);
    // The past Event has no Centre, so a place filter excludes it too.
    await page.goto(`/en/events?when=past&country=${place.country}`);
    await expect(
      page.getByRole('main').getByText('No past events were held in this place.'),
    ).toBeVisible();
    await expect(page.getByText(TITLE.past)).toHaveCount(0);

    // An invalid filter is refused in words, never broadened to everything.
    for (const query of [
      `country=no-such-country-${run}`,
      `city=${place.city}`,
      'city=x',
      `country=${place.country}&city=no-such-city-${run}`,
      `centre=no-such-centre-${run}`,
      'when=tomorrow',
    ]) {
      const response = await page.goto(`/en/events?${query}`);
      expect(response?.status(), query).toBe(200);
      await expect(
        page
          .getByRole('main')
          .getByText(
            'This filter does not name a place or centre in the directory, so no events are listed.',
            { exact: false },
          ),
        query,
      ).toBeVisible();
      await expect(
        page.getByRole('list', { name: 'Upcoming events', exact: true }),
        query,
      ).toHaveCount(0);
      await expect(page.getByText(TITLE.en), query).toHaveCount(0);
    }
  });

  test('shows an Event’s occurrences, its Centre and its photographs, and a noindex gallery view', async ({
    page,
  }) => {
    const winter = occurrenceText(WINTER.start, WINTER.end, WINTER.instant);
    const summer = occurrenceText(SUMMER.start, SUMMER.movedEnd, SUMMER.instant);
    expect(winter.zone).toBe('Eastern Standard Time');

    const response = await page.goto(`/en/events/${slug.main}`);
    expect(response?.status()).toBe(200);
    expect(response?.headers()['set-cookie']).toBeUndefined();
    const main = page.getByRole('main');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(TITLE.en);
    await expect(main.getByText('Upcoming', { exact: true })).toBeVisible();

    // Every occurrence, chronologically, in its intended local time and the
    // zone's name at that instant — standard in winter, daylight in summer.
    const occurrences = main.locator('section[aria-labelledby="event-when"] li');
    await expect(occurrences).toHaveCount(2);
    await expect(occurrences.nth(0).locator('time')).toHaveText(winter.text);
    await expect(occurrences.nth(0).locator('time')).toHaveAttribute(
      'datetime',
      WINTER.machine,
    );
    await expect(occurrences.nth(0)).toContainText(winter.zone);
    await expect(occurrences.nth(0)).toContainText('— held');
    await expect(occurrences.nth(1).locator('time')).toHaveText(summer.text);
    await expect(occurrences.nth(1)).toContainText(summer.zone);
    await expect(occurrences.nth(1)).not.toContainText('held');
    await expect(
      main.getByText('Times are local to where the event is held.'),
    ).toBeVisible();

    // Where: the public Centre, linked, with its place and address.
    const where = main.locator('section[aria-labelledby="event-where"]');
    await expect(where.getByRole('link', { name: NAME.centre })).toHaveAttribute(
      'href',
      `/en/global/centres/${place.centre}`,
    );
    await expect(where).toContainText(`${NAME.city}, ${NAME.country}`);
    await expect(where.locator('address')).toHaveText(ADDRESS);
    await expect(page.locator('iframe, embed, object')).toHaveCount(0);

    // The deployment is pre-adoption: noindex, no canonical claim and no
    // structured data (ROUTE_MAP.md §9.5). The indexable half — canonical and
    // the Event JSON-LD — is proved where the posture can be switched.
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute(
      'content',
      /noindex/,
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);

    const text = await main.innerText();
    await author.goto(`/en/events/${slug.main}`);
    expect(await author.getByRole('main').innerText()).toBe(text);

    // The photographs: a view over the Gallery, linking to its own page.
    const photographs = main.getByRole('link', {
      name: 'View the photographs (1 gallery)',
    });
    await expect(photographs).toHaveAttribute('href', `/en/events/${slug.main}/gallery`);
    await photographs.click();
    await page.waitForURL(new RegExp(`/en/events/${slug.main}/gallery$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Event photographs');
    const cards = page.getByRole('list', { name: 'Event photographs', exact: true });
    const card = cards.locator(`a[href="/en/media/galleries/${place.gallery}"]`).first();
    await expect(card).toBeVisible();
    await expect(cards).toContainText(GALLERY_TITLE);
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute(
      'content',
      'noindex, follow',
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(
      page.getByRole('main').getByRole('link', { name: 'Back to the event' }),
    ).toHaveAttribute('href', `/en/events/${slug.main}`);
    const gallery = await page.request.get(`/en/events/${slug.main}/gallery`);
    expect(gallery.status()).toBe(200);
    expect(gallery.headers()['set-cookie']).toBeUndefined();

    // An Event with no Gallery has no gallery view at all.
    expect((await page.request.get(`/en/events/${slug.past}/gallery`)).status()).toBe(
      404,
    );
    // An unpublished Event is not public, signed in or not.
    expect((await page.request.get(`/en/events/${slug.dst}`)).status()).toBe(404);
    expect((await author.request.get(`/en/events/${slug.dst}`)).status()).toBe(404);
  });
});

/* ========================================================================== */

test.describe('reading direction, reflow and the keyboard', () => {
  test('renders Urdu and Arabic right-to-left, with the Event in its own language', async ({
    page,
  }) => {
    await page.goto('/ur/events');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(
      page.getByRole('main').getByRole('link', { name: TITLE.ur }),
    ).toBeVisible();

    await page.goto(`/ur/events/${slug.main}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(TITLE.ur);

    // Arabic has no translation: the English words, marked English, and said so.
    await page.goto(`/ar/events/${slug.main}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toHaveText(TITLE.en);
    await expect(page.locator('h1').locator('xpath=..')).toHaveAttribute('lang', 'en');
    await expect(
      page.getByRole('main').getByRole('status').filter({ hasText: 'English' }),
    ).toBeVisible();
  });

  test('reflows at 320 pixels and at 200% zoom with no horizontal scroll', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // 640 CSS pixels is a 1280-pixel window at 200% zoom.
    for (const width of [320, 640]) {
      await page.setViewportSize({ width, height: 800 });
      for (const target of [
        '/ur/events',
        `/ur/events?country=${place.country}`,
        `/ur/events/${slug.main}`,
        `/ar/events/${slug.main}`,
        `/ur/events/${slug.main}/gallery`,
      ]) {
        const response = await page.goto(target);
        expect(response?.status(), target).toBe(200);
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        const { overflow, offenders } = await overflowOf(page);
        expect
          .soft(overflow, `${String(width)}px ${target}\n${offenders.join('\n')}`)
          .toBeLessThanOrEqual(0);
      }
    }
  });

  test('labels the place filter visibly and submits it from the keyboard', async ({
    page,
  }) => {
    await page.goto(`/en/events?country=${place.country}`);
    const form = page.getByRole('form', { name: 'Filter events by place' });
    await expect(form.locator('label[for="events-country"]')).toBeVisible();
    await expect(form.locator('label[for="events-country"]')).toHaveText('Country');
    await expect(form.locator('label[for="events-city"]')).toBeVisible();
    await expect(form.locator('label[for="events-city"]')).toHaveText('City');
    const country = form.getByLabel('Country', { exact: true });
    const city = form.getByLabel('City', { exact: true });
    const submit = form.getByRole('button', { name: 'Show events', exact: true });

    await country.focus();
    await expect(country).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(city).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(submit).toBeFocused();

    await city.selectOption(place.city);
    await submit.focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(/city=/);
    expect(new URL(page.url()).searchParams.get('city')).toBe(place.city);
    expect(new URL(page.url()).searchParams.get('country')).toBe(place.country);
    await expect(
      page
        .getByRole('list', { name: 'Upcoming events', exact: true })
        .getByRole('link', { name: TITLE.en }),
    ).toBeVisible();

    // With no Country chosen the City is disabled and skipped.
    await page.goto('/en/events');
    await expect(page.getByLabel('City', { exact: true })).toBeDisabled();
    await page.getByLabel('Country', { exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('button', { name: 'Show events', exact: true }),
    ).toBeFocused();
  });
});

/* ========================================================================== */

test.describe('former addresses', () => {
  test('answers a renamed Event, and its gallery view, with ONE 301 that keeps the locale', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    await author.goto(mainEditor);
    await author.getByLabel('Canonical slug', { exact: true }).fill(slug.renamed);
    await clickSaved(author, 'Save revision');
    // The rename is an ordinary edit: withdrawn until it is published again.
    expect(
      (await request.get(`/en/events/${slug.main}`, { maxRedirects: 0 })).status(),
    ).toBe(404);
    await throughWorkflow(mainEditor);

    const old = slug.main;
    slug.main = slug.renamed;
    for (const [from, to] of [
      [`/en/events/${old}`, `/en/events/${slug.main}`],
      [`/ur/events/${old}`, `/ur/events/${slug.main}`],
      [`/en/events/${old}/gallery`, `/en/events/${slug.main}/gallery`],
      [`/ar/events/${old}/gallery`, `/ar/events/${slug.main}/gallery`],
    ] as const) {
      const response = await request.get(from, { maxRedirects: 0 });
      expect(response.status(), from).toBe(301);
      const target = new URL(response.headers()['location'] ?? '', baseUrl()).pathname;
      expect(target, from).toBe(to);
      // The target is final: no second hop.
      expect((await request.get(target, { maxRedirects: 0 })).status(), target).toBe(200);
    }
  });
});

/* ========================================================================== */

test.describe('a withdrawn Centre or Gallery', () => {
  test('lists the Event among the Centre’s Local Events, and degrades honestly when either is withdrawn', async ({
    page,
  }) => {
    const centre = `/en/global/centres/${place.centre}`;

    // Local Events, on their own page and as a section of the Centre page.
    const local = await page.goto(`${centre}/events`);
    expect(local?.status()).toBe(200);
    expect(local?.headers()['set-cookie']).toBeUndefined();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      `Events at ${NAME.centre}`,
    );
    await expect(
      page
        .getByRole('list', { name: `Events at ${NAME.centre}`, exact: true })
        .getByRole('link', { name: TITLE.en }),
    ).toHaveAttribute('href', `/en/events/${slug.main}`);
    await page.goto(centre);
    const section = page.locator('section[aria-labelledby="centre-events"]');
    await expect(section.getByRole('link', { name: TITLE.en })).toBeVisible();
    await expect(
      section.getByRole('link', { name: 'All events at this centre, upcoming and past' }),
    ).toHaveAttribute('href', `${centre}/events`);

    // The Gallery is withdrawn: the view says so, and the Event stays public.
    await sql.query(
      `UPDATE [dbo].[Gallery] SET [state]=N'archived', [version]=[version]+1, [updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${id.gallery}';`,
    );
    const view = await page.goto(`/en/events/${slug.main}/gallery`);
    expect(view?.status()).toBe(200);
    await expect(
      page
        .getByRole('main')
        .getByText('No photographs of this event are available at the moment.'),
    ).toBeVisible();
    await expect(page.locator('a[href^="/en/media/galleries/"]')).toHaveCount(0);
    const detail = await page.goto(`/en/events/${slug.main}`);
    expect(detail?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(TITLE.en);
    await expect(
      page
        .getByRole('main')
        .getByText('No photographs of this event are available at the moment.'),
    ).toBeVisible();
    await expect(page.locator(`a[href="/en/events/${slug.main}/gallery"]`)).toHaveCount(
      0,
    );

    // The Centre is withdrawn: its Local Events are gone, and the Event stays,
    // no longer naming it.
    await sql.query(
      `UPDATE [dbo].[Centre] SET [state]=N'archived', [version]=[version]+1, [updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${id.centre}';`,
    );
    for (const target of [centre, `${centre}/events`])
      expect((await page.request.get(target, { maxRedirects: 0 })).status(), target).toBe(
        404,
      );
    const after = await page.goto(`/en/events/${slug.main}`);
    expect(after?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(TITLE.en);
    await expect(
      page
        .getByRole('main')
        .getByText(
          'The centre for this event is not listed in the directory at the moment.',
        ),
    ).toBeVisible();
    await expect(page.locator('main a[href^="/en/global/centres/"]')).toHaveCount(0);
    await expect(page.getByText(NAME.centre)).toHaveCount(0);
    // The listing still has it — without a Centre line.
    await page.goto('/en/events');
    const card = page
      .getByRole('list', { name: 'Upcoming events', exact: true })
      .getByRole('listitem')
      .filter({ hasText: TITLE.en });
    await expect(card).toHaveCount(1);
    await expect(card.locator('a[href^="/en/global/centres/"]')).toHaveCount(0);
  });
});
