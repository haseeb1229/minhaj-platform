import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { AxeBuilder } from '@axe-core/playwright';
import type { BrowserContext, Page, Request, TestInfo } from '@playwright/test';

import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import {
  newPhase5Fixture,
  writePhase5Fixture,
  type Phase5Fixture,
} from '../../packages/database/src/lifecycle/phase5-fixture.ts';
import {
  sha256,
  syntheticSilentMp3,
  syntheticStorageKey,
} from '../../packages/database/src/lifecycle/phase11-fixture.ts';
import {
  accountIdFor,
  baseUrl,
  browserEnvironment,
  expect,
  privilegedSession,
  registerAndSignIn,
  test,
  grantRole,
} from './support';

/**
 * Phase 11 — Listen in a real browser, against the production build.
 *
 * WHAT ONLY A BROWSER CAN PROVE: that a track's page plays its recording from
 * THIS origin only, with the native player reachable by keyboard and nothing
 * playing on its own; that seeking is served by a real Range response; that a
 * track whose file cannot be served says so instead of offering a dead control;
 * that the Listen pages work signed out and set no cookie; that every former
 * address answers ONE 301 through the real proxy; that Urdu renders
 * right-to-left; that nothing scrolls sideways at 320px; that a track is found
 * by the running search sweep and withheld once withdrawn; and that the
 * administration uploads a file LARGER than the Server Action cap through its
 * own route, refuses a publish with no audio, refuses a stale save, and refuses
 * a cross-origin or unauthorised upload.
 *
 * THE SCANNER IS DELIBERATELY UNREACHABLE in this suite (`scripts/browser-server.mjs`),
 * so a browser upload always ends "not cleared" — which is the fail-closed
 * outcome worth proving here. A clean scan is proved with the real scanner in
 * the Database foundation job. Files the pages PLAY are seeded as Storage would
 * leave them after a clean scan: synthetic silence, never a recording of anyone.
 */

test.describe.configure({ mode: 'serial' });

let sql: SqlSession;
let people: Phase5Fixture;
let educationId: string;
const contexts: BrowserContext[] = [];

const run = randomUUID().replaceAll('-', '').slice(0, 10);
const WORD = `marlowfixture${run}`;
const WITHDRAWN_WORD = `brackenfixture${run}`;

const AUDIO = syntheticSilentMp3(120);

const lectureId = randomUUID();
const urduId = randomUUID();
const draftId = randomUUID();
const withdrawnId = randomUUID();
const seriesId = randomUUID();

const lectureAsset = randomUUID();
const urduAsset = randomUUID();
const draftAsset = randomUUID();
const withdrawnAsset = randomUUID();

const lectureOld = `browser-audio-old-${run}`;
const lectureSlug = `browser-audio-${run}`;
const urduSlug = `browser-audio-urdu-${run}`;
const draftSlug = `browser-audio-draft-${run}`;
const withdrawnSlug = `browser-audio-withdrawn-${run}`;
const seriesOld = `browser-audio-series-old-${run}`;
const seriesSlug = `browser-audio-series-${run}`;

const LECTURE_TITLE = `Synthetic browser recording ${WORD}`;
const URDU_TITLE = `Synthetic Urdu recording ${run}`;
const WITHDRAWN_TITLE = `Synthetic withdrawn recording ${WITHDRAWN_WORD}`;
const SERIES_TITLE = `Synthetic browser audio series ${run}`;

/** A clean Asset row, and — unless `missing` — its bytes in the run's storage root. */
async function seedAsset(id: string, missing = false): Promise<void> {
  const key = syntheticStorageKey();
  if (!missing) {
    const file = path.join(browserEnvironment().storageRoot, ...key.split('/'));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, AUDIO);
  }
  await sql.query(
    `INSERT INTO [dbo].[Asset] ([id],[storageKey],[mediaType],[byteSize],[checksum],[state],[updatedAt]) VALUES (N'${id}',N'${key}',N'audio/mpeg',${String(AUDIO.byteLength)},N'${sha256(AUDIO)}',N'clean',SYSUTCDATETIME());`,
  );
}

async function grant(accountId: string, keys: readonly string[]): Promise<void> {
  await grantRole(sql, accountId, keys, 'Listen browser proof');
}

/** Waits for DERIVED work — the running sweep indexes asynchronously (§8.5). */
async function eventuallyFound(page: Page, query: string, text: string): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.goto(`/search?q=${encodeURIComponent(query)}`);
        await page.getByRole('heading', { level: 1, name: 'Search' }).waitFor();
        return page.getByRole('main').innerText();
      },
      { timeout: 90_000, intervals: [1_000, 2_000, 3_000] },
    )
    .toContain(text);
}

/** Every request the page makes to an origin that is not the application's. */
function thirdPartyRequests(page: Page): Request[] {
  const seen: Request[] = [];
  const own = new URL(baseUrl()).origin;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith('http') && url.origin !== own) seen.push(request);
  });
  return seen;
}

const bytesRoute = (trackId: string, assetId: string) =>
  `/assets/media/audio/${trackId}/${assetId}`;

/** No serious or critical axe finding; anything lesser is annotated. */
async function axe(page: Page, target: string, testInfo: TestInfo): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
  for (const finding of results.violations.filter((v) => !blocking.includes(v)))
    testInfo.annotations.push({
      type: 'axe',
      description: `${target}: ${finding.id} (${String(finding.impact)})`,
    });
  expect(
    blocking.map((violation) => `${violation.id}: ${violation.nodes.length}`),
    target,
  ).toEqual([]);
}

/**
 * Is a Quran corpus active in this run's database?
 *
 * PHASE 18 MADE `/listen/recitations` CONDITIONAL; WATCH PART 3 MADE IT A 301.
 * It leads to Quran's recitation catalogue at its one address: absent (404)
 * and unlinked while no corpus is active, one 301 to `/quran/recitations`
 * once one is. The corpus is a database singleton that
 * `quran.spec.ts` activates part-way through its own journey, and spec files
 * run in parallel against one database, so this file cannot choose the state —
 * it reads it, and holds the page to the contract for the state it finds. The
 * deterministic proof of BOTH states, in order, is `quran.spec.ts`.
 */
async function quranCorpusActive(): Promise<boolean> {
  const [row] = await sql.query<{ total: number }>(
    'SELECT COUNT_BIG(*) AS [total] FROM [dbo].[QuranActivation];',
  );
  if (row === undefined) throw new Error('The Quran activation could not be read.');
  return Number(row.total) > 0;
}

/**
 * Observes something in a Quran state that did NOT change while it was
 * observed. Activation is one-way within a run, so a pass that straddled it is
 * simply repeated, and the next one is stable.
 */
async function inStableQuranState<T>(
  observe: () => Promise<T>,
): Promise<{ active: boolean; observed: T }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = await quranCorpusActive();
    const observed = await observe();
    if ((await quranCorpusActive()) === before) return { active: before, observed };
  }
  throw new Error('The Quran corpus changed state during every observation.');
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  sql = await privilegedSession();

  people = newPhase5Fixture();
  await writePhase5Fixture(sql, people);
  const [topic] = await sql.query<{ id: string }>(
    "SELECT [id] FROM [Topic] WHERE [slug] = N'education';",
  );
  if (topic === undefined) throw new Error('The canonical education topic is missing.');
  educationId = topic.id.toLowerCase();

  await seedAsset(lectureAsset);
  // Recorded clean, bytes missing — as after a restore that lost the file.
  await seedAsset(urduAsset, true);
  await seedAsset(draftAsset);
  await seedAsset(withdrawnAsset);

  // An audio series renamed once; a lecture renamed once, at place 1 of it; an
  // Urdu recording at place 2 whose file is gone; a draft; and a published
  // recording the search proof later withdraws.
  await sql.query(`
    INSERT INTO [dbo].[AudioSeries] ([id],[slug],[primaryLocale],[state],[version],[updatedAt])
    VALUES (N'${seriesId}', N'${seriesOld}', N'en', N'published', 1, SYSUTCDATETIME());
    UPDATE [dbo].[AudioSeries] SET [slug]=N'${seriesSlug}', [version]=2 WHERE [id]=N'${seriesId}';
    INSERT INTO [dbo].[AudioSeriesLabel] ([seriesId],[locale],[title],[description])
      VALUES (N'${seriesId}', N'en', N'${SERIES_TITLE}', N'A synthetic audio series.');

    INSERT INTO [dbo].[AudioTrack] ([id],[slug],[primaryLocale],[state],[languageCode],[durationSeconds],[recordedOn],[transcript],[assetId],[seriesId],[seriesPosition],[version],[updatedAt]) VALUES
      (N'${lectureId}', N'${lectureOld}', N'en', N'published', N'en', 3, '2032-03-04',
       N'Synthetic transcript, first paragraph.' + CHAR(10) + CHAR(10) + N'Synthetic transcript, second paragraph.',
       N'${lectureAsset}', N'${seriesId}', 1, 1, SYSUTCDATETIME()),
      (N'${urduId}', N'${urduSlug}', N'en', N'published', N'ur', NULL, NULL, NULL,
       N'${urduAsset}', N'${seriesId}', 2, 1, SYSUTCDATETIME()),
      (N'${draftId}', N'${draftSlug}', N'en', N'draft', N'en', NULL, NULL, NULL,
       N'${draftAsset}', NULL, NULL, 1, SYSUTCDATETIME()),
      (N'${withdrawnId}', N'${withdrawnSlug}', N'en', N'published', N'en', NULL, NULL, NULL,
       N'${withdrawnAsset}', NULL, NULL, 1, SYSUTCDATETIME());
    UPDATE [dbo].[AudioTrack] SET [slug]=N'${lectureSlug}', [version]=2 WHERE [id]=N'${lectureId}';
    INSERT INTO [dbo].[AudioTrackLabel] ([trackId],[locale],[title],[description]) VALUES
      (N'${lectureId}', N'en', N'${LECTURE_TITLE}', N'A synthetic description.'),
      (N'${lectureId}', N'ur', N'آزمائشی ریکارڈنگ ${run}', N''),
      (N'${urduId}', N'en', N'${URDU_TITLE}', N''),
      (N'${draftId}', N'en', N'Synthetic hidden draft recording ${run}', N''),
      (N'${withdrawnId}', N'en', N'${WITHDRAWN_TITLE}', N'');
    INSERT INTO [dbo].[AudioTrackSpeaker] ([trackId],[personId],[position]) VALUES
      (N'${lectureId}', N'${people.linkedPersonId}', 0);
    INSERT INTO [dbo].[AudioTrackTopic] ([trackId],[topicId]) VALUES (N'${lectureId}', N'${topic.id}');

    INSERT INTO [dbo].[SearchIndexRequest] ([scopeKind],[scopeId]) VALUES
      (N'audio', N'${lectureId}'), (N'audio', N'${withdrawnId}');
  `);
});

test.afterAll(async () => {
  for (const context of contexts) await context.close();
  await sql?.close();
});

/* ========================================================================== */

test.describe('an anonymous visitor listens', () => {
  test('lands on Listen signed out, with its figures, the recordings and only real surfaces', async ({
    page,
  }) => {
    const response = await page.goto('/listen');
    expect(response?.status()).toBe(200);
    expect(response?.headers()['set-cookie']).toBeUndefined();
    await expect(page.getByRole('heading', { level: 1, name: 'Listen' })).toBeVisible();
    const main = page.getByRole('main');
    // The figures the data supports (Watch Part 3).
    await expect(main).toContainText(/\d+\s*recordings/);
    await expect(
      main
        .getByRole('list', { name: 'Latest recordings' })
        .getByRole('link', { name: LECTURE_TITLE }),
    ).toBeVisible();
    await expect(page.getByText('Synthetic hidden draft recording')).toHaveCount(0);
    // The audio series, and the ways in by Topic and by speaker — each a view
    // of the listing, its identifier in lower case.
    await expect(
      main
        .getByRole('list', { name: 'Audio series' })
        .getByRole('link', { name: SERIES_TITLE }),
    ).toHaveAttribute('href', `/listen/series/${seriesSlug}`);
    await expect(
      main.getByRole('list', { name: 'Browse by topic' }).getByRole('link', {
        name: /^Education\s*\d+$/,
      }),
    ).toHaveAttribute('href', `/listen/lectures?topic=${educationId}`);
    await expect(
      main.locator(`a[href="/listen/lectures?speaker=${people.linkedPersonId}"]`),
    ).toHaveCount(1);

    const { active, observed: hrefs } = await inStableQuranState(async () => {
      await page.goto('/listen');
      return page
        .getByRole('main')
        .getByRole('link')
        .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
    });
    for (const surface of [
      '/listen/lectures',
      '/listen/series',
      '/topics',
      '/watch',
      '/watch/speakers',
    ]) {
      expect(hrefs).toContain(surface);
    }
    // The Quran's recitations are linked exactly when Quran has some to show,
    // at their ONE address in the Quran section — never the Listen alias.
    const recitations = hrefs.filter((href) => href.includes('recitation'));
    expect(recitations.every((href) => href.startsWith('/quran/recitations'))).toBe(true);
    expect(recitations.includes('/quran/recitations')).toBe(active);
    // No cover art is invented: a row paints no image at all.
    await expect(page.locator('main img')).toHaveCount(0);
  });

  test('filters recordings with counted options and chips, at one address per view', async ({
    page,
    request,
  }) => {
    await page.goto('/listen/lectures');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Audio lectures' }),
    ).toBeVisible();
    await expect(page.getByRole('main')).toContainText(/\d+\s*recordings/);

    await page.goto('/listen/lectures?language=ur');
    const list = page.getByRole('list', { name: 'Audio lectures' });
    await expect(list.getByRole('link', { name: URDU_TITLE })).toBeVisible();
    await expect(list.getByRole('link', { name: LECTURE_TITLE })).toHaveCount(0);
    const chips = page.getByRole('list', { name: 'Filters in use' });
    await expect(
      chips.getByRole('link', { name: 'Remove filter: Urdu' }),
    ).toHaveAttribute('href', '/listen/lectures');

    // Another order of the same view is ONE redirect to its spelling; a view
    // nothing matches says so and leads back.
    await page.goto(`/listen/lectures?series=${seriesId}&language=ar`);
    await expect(page).toHaveURL(`/listen/lectures?language=ar&series=${seriesId}`);
    await expect(
      page.getByText('No published recording matches these filters.'),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Clear filters' }).first().click();
    await expect(page).toHaveURL(/\/listen\/lectures$/);

    // The series option counts its PUBLISHED recordings; chosen without
    // script, the GET form lands on the view's one address with its chip.
    const series = page.locator('#lectures-series');
    await expect(series.locator(`option[value="${seriesId}"]`)).toHaveText(
      `${SERIES_TITLE} (2)`,
    );
    await series.selectOption(seriesId);
    await page.getByRole('button', { name: 'Show recordings' }).click();
    await expect(page).toHaveURL(`/listen/lectures?series=${seriesId}`);
    await expect(list.getByRole('heading')).toHaveText([LECTURE_TITLE, URDU_TITLE]);
    await expect(
      chips.getByRole('link', { name: `Remove filter: ${SERIES_TITLE}` }),
    ).toHaveAttribute('href', '/listen/lectures');

    // A speaker is a filter of its own, named by its chip.
    await page.goto(`/listen/lectures?speaker=${people.linkedPersonId}`);
    await expect(chips.getByRole('link')).toHaveCount(1);
    await expect(list.getByRole('link', { name: LECTURE_TITLE })).toBeVisible();
    await expect(list.getByRole('link', { name: URDU_TITLE })).toHaveCount(0);

    for (const [from, to] of [
      ['/listen/lectures?offset=24', '/listen/lectures?page=2'],
      ['/listen/lectures?topic=&language=&sort=newest', '/listen/lectures'],
      [
        `/ur/listen/lectures?series=${seriesId.toUpperCase()}`,
        `/ur/listen/lectures?series=${seriesId}`,
      ],
      ['/listen/series?sort=videos', '/listen/series'],
      ['/ar/listen/series?offset=24&q=', '/ar/listen/series'],
      [`/listen/series/${seriesSlug}?page=1`, `/listen/series/${seriesSlug}`],
    ]) {
      const response = await request.get(from, { maxRedirects: 0 });
      expect(response.status(), from).toBe(307);
      const target = new URL(response.headers()['location'] ?? '', baseUrl());
      expect(`${target.pathname}${target.search}`, from).toBe(to);
    }
  });

  test('shows a track with its facts and transcript, playing only from this origin', async ({
    page,
  }) => {
    const external = thirdPartyRequests(page);
    const response = await page.goto(`/listen/lectures/${lectureSlug}`);
    expect(response?.headers()['set-cookie']).toBeUndefined();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(LECTURE_TITLE);

    await expect(
      page.locator(`a[href="/people/${people.linkedSlug}"]`).first(),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Education' }).first()).toHaveAttribute(
      'href',
      '/topics/education',
    );
    await expect(page.getByRole('link', { name: SERIES_TITLE }).first()).toHaveAttribute(
      'href',
      `/listen/series/${seriesSlug}`,
    );
    await page.getByText('Read the transcript').click();
    await expect(page.getByText('Synthetic transcript, second paragraph.')).toBeVisible();

    const audio = page.locator('audio');
    await expect(audio).toHaveCount(1);
    await expect(audio).toHaveAttribute('src', bytesRoute(lectureId, lectureAsset));
    await expect(audio).toHaveAttribute('preload', 'none');
    await expect(audio).toHaveAttribute(
      'aria-label',
      `${LECTURE_TITLE} — audio recording`,
    );
    expect(await audio.getAttribute('autoplay')).toBeNull();
    expect(await audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(
      true,
    );

    // No download is offered: playback grants no right to keep a copy. (Scoped
    // to the page's content: the shell's own navigation is not an offer of
    // this recording.)
    await expect(
      page.getByRole('main').getByRole('link', { name: /download/i }),
    ).toHaveCount(0);
    await expect(page.locator('a[download]')).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    expect(external.map((request) => request.url())).toEqual([]);
    // Pre-adoption: not indexable, so no machine-readable claim at all.
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
  });

  test('plays by keyboard alone, and seeks through a real Range response', async ({
    page,
  }) => {
    const route = bytesRoute(lectureId, lectureAsset);
    const early: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes(route)) early.push(request.url());
    });
    await page.goto(`/listen/lectures/${lectureSlug}`);
    await page.waitForLoadState('networkidle');
    // `preload="none"`: opening the page fetched not one byte of the recording.
    expect(early).toEqual([]);
    const audio = page.locator('audio');

    // Reached by Tab, like any control — no pointer involved.
    let reached = false;
    for (let step = 0; step < 80 && !reached; step += 1) {
      await page.keyboard.press('Tab');
      reached = await audio.evaluate((element) => document.activeElement === element);
    }
    expect(reached).toBe(true);

    const fetched = page.waitForResponse((response) => response.url().includes(route));
    await page.keyboard.press('Space');
    const response = await fetched;

    // The player asks for a RANGE of this origin's own byte route, and is
    // answered with one.
    expect(response.request().headers()['range']).toMatch(/^bytes=\d+-/);
    expect(response.status()).toBe(206);
    expect(response.headers()['content-range']).toMatch(
      new RegExp(`^bytes \\d+-\\d+/${String(AUDIO.byteLength)}$`),
    );

    // And the recording genuinely plays — time advances — and then stops when
    // asked, with nothing having played before the key was pressed.
    await expect
      .poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime), {
        timeout: 10_000,
      })
      .toBeGreaterThan(0);
    await audio.evaluate((element: HTMLAudioElement) => element.pause());
  });

  test('says a recording is unavailable when its file cannot be served — no dead player', async ({
    page,
  }) => {
    await page.goto(`/listen/lectures/${urduSlug}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(URDU_TITLE);
    await expect(
      page.getByText('This recording is not available to play right now.'),
    ).toBeVisible();
    await expect(page.locator('audio')).toHaveCount(0);
  });

  test('serves the bytes only for a published track’s own file', async ({ request }) => {
    const whole = await request.get(bytesRoute(lectureId, lectureAsset));
    expect(whole.status()).toBe(200);
    expect(whole.headers()['content-type']).toBe('audio/mpeg');
    expect(whole.headers()['accept-ranges']).toBe('bytes');
    expect(whole.headers()['cache-control']).toBe('private, no-store');
    expect(whole.headers()['set-cookie']).toBeUndefined();
    expect((await whole.body()).equals(Buffer.from(AUDIO))).toBe(true);

    const part = await request.get(bytesRoute(lectureId, lectureAsset), {
      headers: { range: 'bytes=0-1023' },
    });
    expect(part.status()).toBe(206);
    expect(part.headers()['content-range']).toBe(
      `bytes 0-1023/${String(AUDIO.byteLength)}`,
    );

    for (const [trackId, assetId] of [
      [draftId, draftAsset],
      [lectureId, draftAsset],
      [lectureId, randomUUID()],
      [urduId, urduAsset],
    ] as const) {
      const refused = await request.get(bytesRoute(trackId, assetId), {
        headers: { range: 'bytes=0-9' },
      });
      expect(refused.status(), `${trackId}/${assetId}`).toBe(404);
    }
  });

  test('never serves a draft page, and leads to recitations only in the Quran section', async ({
    request,
  }) => {
    for (const missing of [`/listen/lectures/${draftSlug}`, '/listen/podcasts']) {
      const response = await request.get(missing, { maxRedirects: 0 });
      expect(response.status(), missing).toBe(404);
    }

    const { active, observed } = await inStableQuranState(async () => {
      const response = await request.get('/ur/listen/recitations', { maxRedirects: 0 });
      return {
        status: response.status(),
        headers: response.headers(),
        body: await response.text(),
      };
    });
    expect(observed.headers['set-cookie']).toBeUndefined();
    expect(observed.headers['cache-control']).toBe('no-store');
    expect(observed.headers['x-robots-tag']).toBe('noindex');
    if (!active) {
      // No corpus, no catalogue: absent, never a redirect into nothing.
      expect(observed.status).toBe(404);
      return;
    }
    // A corpus is active: ONE 301 to the catalogue's one address, the locale
    // kept — never a second page of the same catalogue, never Media's audio.
    expect(observed.status).toBe(301);
    expect(observed.headers['location']).toBe('/ur/quran/recitations');
    expect(observed.body).toBe('');
  });

  test('lists an audio series in its own order, opening on where to begin', async ({
    page,
  }) => {
    await page.goto(`/listen/series/${seriesSlug}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(SERIES_TITLE);
    const main = page.getByRole('main');
    await expect(main).toContainText(/2\s*recordings/);
    // Its first published part, by its own number; its latest is its first
    // (the other is undated), so no second way in is offered.
    await expect(main.getByRole('link', { name: 'Start from part 1' })).toHaveAttribute(
      'href',
      `/listen/lectures/${lectureSlug}`,
    );
    await expect(main.getByRole('link', { name: 'Latest recording' })).toHaveCount(0);
    const tracks = page.getByRole('list', { name: 'Recordings' });
    await expect(tracks.getByRole('heading')).toHaveText([LECTURE_TITLE, URDU_TITLE]);
    await expect(tracks.getByText('Part 1')).toBeVisible();
    // Who speaks in it, by People's name and profile.
    await expect(
      page
        .getByRole('region', { name: 'Speakers' })
        .locator(`a[href="/people/${people.linkedSlug}"]`),
    ).toHaveCount(1);
    // Past its last page: said so, with the way back.
    await page.goto(`/listen/series/${seriesSlug}?page=2`);
    await expect(page.getByText('This page is empty')).toBeVisible();
  });

  test('finds an audio series by its title, with its count and chip', async ({
    page,
  }) => {
    await page.goto('/listen/series');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Audio series' }),
    ).toBeVisible();
    await page.getByRole('searchbox', { name: 'Title' }).fill(run);
    await page.getByRole('button', { name: 'Show', exact: true }).click();
    await expect(page).toHaveURL(`/listen/series?q=${run}`);
    const card = page
      .getByRole('list', { name: 'Audio series' })
      .getByRole('listitem')
      .filter({ has: page.getByRole('link', { name: SERIES_TITLE }) });
    await expect(card).toContainText('2 recordings');
    await expect(
      page
        .getByRole('list', { name: 'Filters in use' })
        .getByRole('link', { name: `Remove filter: Title: ${run}` }),
    ).toHaveAttribute('href', '/listen/series');
  });

  test('places a recording in its series, with the previous and next part and Share', async ({
    page,
  }) => {
    await page.goto(`/listen/lectures/${lectureSlug}`);
    const series = page.getByRole('region', { name: SERIES_TITLE });
    await expect(series.getByText('Part 1 of 2')).toBeVisible();
    await expect(series.getByRole('link', { name: /Next recording/ })).toHaveAttribute(
      'href',
      `/listen/lectures/${urduSlug}`,
    );
    await expect(series.getByRole('link', { name: /Previous recording/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Share' })).toBeVisible();

    await page.goto(`/listen/lectures/${urduSlug}`);
    await expect(
      page
        .getByRole('region', { name: SERIES_TITLE })
        .getByRole('link', { name: /Previous recording/ }),
    ).toHaveAttribute('href', `/listen/lectures/${lectureSlug}`);
  });

  test('answers every former address with exactly one 301 to the current one', async ({
    request,
  }) => {
    const hop = async (from: string, to: string) => {
      const response = await request.get(from, { maxRedirects: 0 });
      expect(response.status(), from).toBe(301);
      expect(
        new URL(response.headers()['location'] ?? '', baseUrl()).pathname,
        from,
      ).toBe(to);
    };
    await hop(`/ur/listen/lectures/${lectureOld}`, `/ur/listen/lectures/${lectureSlug}`);
    await hop(`/ar/listen/series/${seriesOld}`, `/ar/listen/series/${seriesSlug}`);
  });

  test('composes audio into the topic hub and the speaker’s profile', async ({
    page,
  }) => {
    await page.goto('/topics/education');
    const section = page.getByRole('region', { name: 'Audio on this topic' });
    await expect(section.getByRole('link', { name: LECTURE_TITLE })).toHaveAttribute(
      'href',
      `/listen/lectures/${lectureSlug}`,
    );

    await page.goto(`/people/${people.linkedSlug}`);
    const audio = page.getByRole('region', { name: 'Audio', exact: true });
    await expect(audio.getByRole('link', { name: LECTURE_TITLE })).toBeVisible();
  });

  test('renders Urdu right-to-left with the title in its own language', async ({
    page,
  }) => {
    await page.goto(`/ur/listen/lectures/${lectureSlug}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ur');
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toHaveText(`آزمائشی ریکارڈنگ ${run}`);
    await expect(heading).toHaveAttribute('lang', 'ur');
    await expect(page.getByRole('heading', { name: 'یہ ریکارڈنگ سنیں' })).toBeVisible();
  });

  test('is axe-clean and reflows from 320 to 1440 px — so at 200% zoom — in en, ur and ar', async ({
    page,
  }, testInfo) => {
    test.setTimeout(300_000);
    for (const [width, height] of [
      [320, 800],
      [1440, 900],
    ] as const) {
      await page.setViewportSize({ width, height });
      for (const path of [
        '/listen',
        '/listen/lectures',
        `/listen/lectures?series=${seriesId}`,
        `/listen/lectures/${lectureSlug}`,
        '/listen/series',
        `/listen/series/${seriesSlug}`,
        '/ur/listen',
        '/ur/listen/lectures',
        `/ur/listen/lectures/${lectureSlug}`,
        `/ur/listen/series/${seriesSlug}`,
        '/ar/listen/lectures',
        '/ar/listen/series',
        `/ar/listen/series/${seriesSlug}`,
      ]) {
        await page.goto(path);
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${path} at ${String(width)}`).toBeLessThanOrEqual(0);
        if (width === 1440) await axe(page, path, testInfo);
      }
    }
  });
});

/* ========================================================================== */

test.describe('search finds a recording, and never a withdrawn one', () => {
  test('finds a track at its Listen address, then withholds it once withdrawn', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await eventuallyFound(page, WORD, LECTURE_TITLE);
    const results = page.getByRole('list', { name: 'Search results' });
    await expect(results.getByRole('link', { name: LECTURE_TITLE })).toHaveAttribute(
      'href',
      `/listen/lectures/${lectureSlug}`,
    );

    await eventuallyFound(page, WITHDRAWN_WORD, WITHDRAWN_TITLE);
    await sql.query(
      `UPDATE [dbo].[AudioTrack] SET [state]=N'archived' WHERE [id]=N'${withdrawnId}';`,
    );
    await page.goto(`/search?q=${WITHDRAWN_WORD}`);
    await page.getByRole('heading', { level: 1, name: 'Search' }).waitFor();
    await expect(page.getByText(WITHDRAWN_TITLE)).toHaveCount(0);
  });
});

/* ========================================================================== */

test.describe('audio administration', () => {
  let admin: Page;
  let stranger: Page;
  let createdId: string;

  const uploadHeaders = (version: number) => ({
    origin: new URL(baseUrl()).origin,
    'content-type': 'application/octet-stream',
    'x-minhaj-intent': 'media-audio-upload',
    'x-expected-version': String(version),
  });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    for (const [index, keys] of [
      [0, ['media.read', 'media.administer']],
      [1, [] as string[]],
    ] as const) {
      const context = await browser.newContext({
        baseURL: baseUrl(),
        extraHTTPHeaders: { 'x-forwarded-for': `100.64.249.${String(index + 1)}` },
      });
      contexts.push(context);
      const page = await context.newPage();
      const { email } = await registerAndSignIn(page, `listen-${String(index)}`);
      if (keys.length > 0) await grant(await accountIdFor(sql, email), keys);
      if (index === 0) admin = page;
      else stranger = page;
    }
  });

  test('refuses every audio surface, and the upload, to an account without the permission', async () => {
    for (const surface of ['audio', 'audio/series', `audio/${lectureId}`]) {
      const response = await stranger.goto(`/admin/media/${surface}`);
      expect(response?.status(), surface).toBe(404);
    }
    const upload = await stranger.request.post(
      `/api/admin/media/audio/${lectureId}/asset`,
      {
        headers: uploadHeaders(2),
        data: Buffer.from(AUDIO),
      },
    );
    expect(upload.status()).toBe(403);
    expect(await upload.json()).toEqual({ status: 'error', failure: 'denied' });
  });

  test('creates a draft track, and refuses to publish it with no recording', async () => {
    const slug = `browser-admin-audio-${run}`;
    await admin.goto('/admin/media/audio');
    await expect(admin.getByRole('heading', { level: 1, name: 'Audio' })).toBeVisible();

    await admin.locator('#new-audio-slug').fill(`${slug}-published`);
    await admin.locator('#new-audio-title-en').fill('Synthetic admin recording');
    await admin.locator('#new-audio-language').selectOption('en');
    await admin.locator('#new-audio-state').selectOption('published');
    await admin.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(
      admin
        .getByRole('alert')
        .filter({ hasText: 'Upload a recording before publishing this track.' }),
    ).toBeVisible();

    await admin.goto('/admin/media/audio');
    await admin.locator('#new-audio-slug').fill(slug);
    await admin.locator('#new-audio-title-en').fill('Synthetic admin recording');
    await admin.locator('#new-audio-language').selectOption('en');
    await admin.getByRole('button', { name: 'Create', exact: true }).click();
    await admin.waitForURL(/\/admin\/media\/audio\/[0-9a-f-]{36}$/);
    createdId = admin.url().split('/').pop() ?? '';
    await expect(
      admin.getByText('No recording has been uploaded for this track yet.'),
    ).toBeVisible();
  });

  test('uploads a file larger than the Server Action cap through its own route — and, unscanned, attaches nothing', async () => {
    test.setTimeout(120_000);
    const large = Buffer.from(syntheticSilentMp3(3000));
    expect(large.byteLength).toBeGreaterThan(1024 * 1024);
    const quarantinedBefore = await sql.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM [dbo].[Asset] WHERE [state]=N'quarantined';",
    );

    await admin.goto(`/admin/media/audio/${createdId}`);
    await admin.locator('input[type="file"]').setInputFiles({
      name: 'synthetic-large.mp3',
      mimeType: 'audio/mpeg',
      buffer: large,
    });
    await admin.getByRole('button', { name: 'Upload the recording' }).click();
    await expect(
      admin.getByRole('alert').filter({
        hasText:
          'The file could not be cleared by the safety scan, so it was not attached.',
      }),
    ).toBeVisible({ timeout: 60_000 });

    // The bytes were accepted and held in quarantine — not refused as too large,
    // and never attached.
    const quarantinedAfter = await sql.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM [dbo].[Asset] WHERE [state]=N'quarantined';",
    );
    expect(Number(quarantinedAfter[0]?.n)).toBe(Number(quarantinedBefore[0]?.n) + 1);
    const [track] = await sql.query<{ assetId: string | null }>(
      `SELECT [assetId] FROM [dbo].[AudioTrack] WHERE [id]=N'${createdId}';`,
    );
    expect(track?.assetId).toBeNull();
  });

  test('refuses a cross-origin or intent-less upload before looking at the session', async () => {
    const target = `/api/admin/media/audio/${createdId}/asset`;
    for (const headers of [
      { ...uploadHeaders(1), origin: 'https://attacker.invalid' },
      { ...uploadHeaders(1), 'x-minhaj-intent': 'something-else' },
      { ...uploadHeaders(1), 'sec-fetch-site': 'cross-site' },
    ]) {
      const response = await admin.request.post(target, {
        headers,
        data: Buffer.from(AUDIO),
      });
      expect(response.status(), JSON.stringify(headers)).toBe(403);
    }
    // No state-changing GET exists at all.
    const get = await admin.request.get(target);
    expect(get.status()).toBe(405);
  });

  test('previews an attached file for a live administrator only', async () => {
    await admin.goto(`/admin/media/audio/${lectureId}`);
    await expect(admin.getByText('Ready to play')).toBeVisible();
    const preview = admin.locator('audio');
    await expect(preview).toHaveAttribute(
      'src',
      `/assets/media/previews/audio/${lectureId}/${lectureAsset}`,
    );
    const bytes = await admin.request.get(
      `/assets/media/previews/audio/${draftId}/${draftAsset}`,
    );
    expect(bytes.status()).toBe(200);
    const refused = await stranger.request.get(
      `/assets/media/previews/audio/${draftId}/${draftAsset}`,
    );
    expect(refused.status()).toBe(404);
  });

  test('refuses a stale track save visibly, and keeps the first', async () => {
    await admin.goto(`/admin/media/audio/${lectureId}`);
    const second = await admin.context().newPage();
    await second.goto(admin.url());

    await admin.locator('#audio-duration').fill('0:05');
    await admin.getByRole('button', { name: 'Save', exact: true }).click();
    await admin.waitForLoadState('networkidle');

    await second.locator('#audio-duration').fill('0:09');
    await second.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      second.getByRole('alert').filter({ hasText: 'This record changed.' }),
    ).toBeVisible();
    await second.close();

    const [row] = await sql.query<{ durationSeconds: number }>(
      `SELECT [durationSeconds] FROM [dbo].[AudioTrack] WHERE [id]=N'${lectureId}';`,
    );
    expect(row?.durationSeconds).toBe(5);
  });
});
