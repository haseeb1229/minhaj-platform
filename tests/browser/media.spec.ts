import { randomUUID } from 'node:crypto';

import type { BrowserContext, Page, Request } from '@playwright/test';

import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import {
  newPhase5Fixture,
  writePhase5Fixture,
  type Phase5Fixture,
} from '../../packages/database/src/lifecycle/phase5-fixture.ts';
import {
  accountIdFor,
  baseUrl,
  expect,
  privilegedSession,
  registerAndSignIn,
  test,
} from './support';

/**
 * Phase 10 — Watch in a real browser, against the production build.
 *
 * WHAT ONLY A BROWSER CAN PROVE: that a Video page makes NO request to any
 * provider until the visitor asks — and then only to the privacy-enhanced host
 * the CSP names; that the frame carries an accessible title and no autoplay;
 * that a known-unavailable video offers no player at all; that the Watch pages
 * work signed out and set no cookie; that every former address — a Video, a
 * Playlist, and a series that has since become a programme — answers ONE 301
 * through the real proxy; that Urdu renders right-to-left; that nothing
 * scrolls sideways at 320px; that a Video is found by the running search sweep
 * and withheld once withdrawn; and that administration works, validates the
 * provider, orders a Playlist and refuses a stale save visibly.
 *
 * NO PROVIDER IS CONTACTED. The one provider request the activation test makes
 * is answered by a stub, so the suite proves what the page asks for without
 * depending on — or disclosing anything to — a real third party.
 *
 * EVERYTHING IS SYNTHETIC. Titles, transcripts and provider identifiers are
 * invented for the proof.
 */

test.describe.configure({ mode: 'serial' });

let sql: SqlSession;
let people: Phase5Fixture;
const contexts: BrowserContext[] = [];

const run = randomUUID().replaceAll('-', '').slice(0, 10);
const WORD = `pewterfixture${run}`;
const WITHDRAWN_WORD = `lindenfixture${run}`;

const lectureId = randomUUID();
const interviewId = randomUUID();
const unavailableId = randomUUID();
const draftId = randomUUID();
const programId = randomUUID();
const playlistId = randomUUID();

const lectureOld = `browser-lecture-old-${run}`;
const lectureSlug = `browser-lecture-${run}`;
const interviewSlug = `browser-interview-${run}`;
const unavailableSlug = `browser-unavailable-${run}`;
const draftSlug = `browser-draft-${run}`;
const seriesOld = `browser-series-old-${run}`;
const programSlug = `browser-program-${run}`;
const playlistOld = `browser-playlist-old-${run}`;
const playlistSlug = `browser-playlist-${run}`;

const LECTURE_ID = `Lx${run.slice(0, 9)}`;
const INTERVIEW_ID = `7${run.replaceAll(/[a-f]/g, '1').slice(0, 8)}`;
const UNAVAILABLE_ID = `Ux${run.slice(0, 9)}`;
const DRAFT_ID = `Dx${run.slice(0, 9)}`;

const LECTURE_TITLE = `Synthetic browser lecture ${WORD}`;
const INTERVIEW_TITLE = `Synthetic browser interview ${WITHDRAWN_WORD}`;
const UNAVAILABLE_TITLE = `Synthetic unavailable video ${run}`;
const PROGRAM_TITLE = `Synthetic browser programme ${run}`;
const PLAYLIST_TITLE = `Synthetic browser playlist ${run}`;

async function grant(accountId: string, keys: readonly string[]): Promise<void> {
  const role = randomUUID();
  await sql.query(
    `INSERT INTO [Role] ([id],[key],[name],[description],[system]) VALUES (N'${role}',N'proof-${role}',N'Media browser proof',N'Synthetic fixture',0); INSERT INTO [RoleAssignment] ([userId],[roleId]) VALUES (N'${accountId}',N'${role}');`,
  );
  for (const key of keys) {
    await sql.query(
      `INSERT INTO [RolePermission] ([roleId],[permissionKey]) VALUES (N'${role}',N'${key}');`,
    );
  }
}

/** Waits for DERIVED work — the running sweep indexes asynchronously (§8.5). */
async function eventuallyFound(page: Page, query: string, text: string): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.goto(`/en/search?q=${encodeURIComponent(query)}`);
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

test.beforeAll(async () => {
  test.setTimeout(120_000);
  sql = await privilegedSession();

  people = newPhase5Fixture();
  await writePhase5Fixture(sql, people);
  const [topic] = await sql.query<{ id: string }>(
    "SELECT [id] FROM [Topic] WHERE [slug] = N'education';",
  );
  if (topic === undefined) throw new Error('The canonical education topic is missing.');

  // A SERIES renamed and made a PROGRAMME, so both its family and its slug have
  // a former address; a lecture renamed once; a playlist renamed once, ordered
  // interview-first with a draft member it must never show.
  await sql.query(`
    INSERT INTO [dbo].[Series] ([id],[slug],[kind],[primaryLocale],[state],[version],[updatedAt])
    VALUES (N'${programId}', N'${seriesOld}', N'series', N'en', N'published', 1, SYSUTCDATETIME());
    UPDATE [dbo].[Series] SET [slug]=N'${programSlug}', [kind]=N'program', [version]=2 WHERE [id]=N'${programId}';
    INSERT INTO [dbo].[SeriesLabel] ([seriesId],[locale],[title],[description])
      VALUES (N'${programId}', N'en', N'${PROGRAM_TITLE}', N'A synthetic programme.');

    INSERT INTO [dbo].[Video] ([id],[slug],[primaryLocale],[state],[isFeatured],[provider],[providerVideoId],[availability],[format],[languageCode],[durationSeconds],[publishedOn],[captions],[transcript],[seriesId],[seriesPosition],[version],[updatedAt]) VALUES
      (N'${lectureId}', N'${lectureOld}', N'en', N'published', 1, N'youtube', '${LECTURE_ID}', N'available', N'lecture', N'en', 3723, '2031-01-02', 1,
       N'Synthetic transcript, first paragraph.' + CHAR(10) + CHAR(10) + N'Synthetic transcript, second paragraph.', N'${programId}', 1, 1, SYSUTCDATETIME()),
      (N'${interviewId}', N'${interviewSlug}', N'en', N'published', 0, N'vimeo', '${INTERVIEW_ID}', N'available', N'interview', N'ur', 600, '2030-05-06', 0,
       NULL, N'${programId}', 2, 1, SYSUTCDATETIME()),
      (N'${unavailableId}', N'${unavailableSlug}', N'en', N'published', 0, N'youtube', '${UNAVAILABLE_ID}', N'unavailable', NULL, N'en', NULL, NULL, 0,
       NULL, NULL, NULL, 1, SYSUTCDATETIME()),
      (N'${draftId}', N'${draftSlug}', N'en', N'draft', 0, N'youtube', '${DRAFT_ID}', N'available', N'lecture', N'en', NULL, NULL, 0,
       NULL, NULL, NULL, 1, SYSUTCDATETIME());
    UPDATE [dbo].[Video] SET [slug]=N'${lectureSlug}', [version]=2 WHERE [id]=N'${lectureId}';
    INSERT INTO [dbo].[VideoLabel] ([videoId],[locale],[title],[description]) VALUES
      (N'${lectureId}', N'en', N'${LECTURE_TITLE}', N'A synthetic description.'),
      (N'${lectureId}', N'ur', N'آزمائشی خطاب ${run}', N''),
      (N'${interviewId}', N'en', N'${INTERVIEW_TITLE}', N''),
      (N'${unavailableId}', N'en', N'${UNAVAILABLE_TITLE}', N''),
      (N'${draftId}', N'en', N'Synthetic hidden draft video ${run}', N'');
    INSERT INTO [dbo].[VideoSpeaker] ([videoId],[personId],[position]) VALUES
      (N'${lectureId}', N'${people.linkedPersonId}', 0);
    INSERT INTO [dbo].[VideoTopic] ([videoId],[topicId]) VALUES (N'${lectureId}', N'${topic.id}');

    INSERT INTO [dbo].[Playlist] ([id],[slug],[primaryLocale],[state],[version],[updatedAt])
    VALUES (N'${playlistId}', N'${playlistOld}', N'en', N'published', 1, SYSUTCDATETIME());
    UPDATE [dbo].[Playlist] SET [slug]=N'${playlistSlug}', [version]=2 WHERE [id]=N'${playlistId}';
    INSERT INTO [dbo].[PlaylistLabel] ([playlistId],[locale],[title],[description])
      VALUES (N'${playlistId}', N'en', N'${PLAYLIST_TITLE}', N'');
    INSERT INTO [dbo].[PlaylistVideo] ([playlistId],[videoId],[position]) VALUES
      (N'${playlistId}', N'${interviewId}', 0),
      (N'${playlistId}', N'${draftId}', 1),
      (N'${playlistId}', N'${lectureId}', 2);

    INSERT INTO [dbo].[SearchIndexRequest] ([scopeKind],[scopeId]) VALUES
      (N'video', N'${lectureId}'), (N'video', N'${interviewId}');
  `);
});

test.afterAll(async () => {
  for (const context of contexts) await context.close();
  await sql?.close();
});

/* ========================================================================== */

test.describe('an anonymous visitor browses Watch', () => {
  test('lands on Watch signed out, with honest sorting and only delivered surfaces', async ({
    page,
  }) => {
    const response = await page.goto('/en/watch');
    expect(response?.status()).toBe(200);
    expect(response?.headers()['set-cookie']).toBeUndefined();
    await expect(page.getByRole('heading', { level: 1, name: 'Watch' })).toBeVisible();

    // Featured means what an operator featured; latest means everything.
    await expect(page.getByRole('link', { name: LECTURE_TITLE })).toBeVisible();
    await expect(page.getByRole('link', { name: INTERVIEW_TITLE })).toHaveCount(0);
    await page.getByRole('link', { name: 'Latest' }).click();
    await expect(page).toHaveURL(/\/en\/watch\?sort=latest$/);
    await expect(page.getByRole('link', { name: INTERVIEW_TITLE })).toBeVisible();

    // Every surface it offers exists; audio and galleries are not offered.
    const hrefs = await page
      .getByRole('main')
      .getByRole('link')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
    for (const surface of [
      'videos',
      'lectures',
      'series',
      'programs',
      'playlists',
      'speakers',
    ]) {
      expect(hrefs).toContain(`/en/watch/${surface}`);
    }
    for (const absent of ['/en/listen', '/en/watch/audio', '/en/watch/galleries']) {
      expect(hrefs).not.toContain(absent);
    }
    // A card paints no remote image.
    await expect(page.locator('main img')).toHaveCount(0);
  });

  test('filters videos by language and by curated view, and says so when nothing matches', async ({
    page,
  }) => {
    await page.goto('/en/watch/videos?language=ur');
    await expect(page.getByRole('link', { name: INTERVIEW_TITLE })).toBeVisible();
    await expect(page.getByRole('link', { name: LECTURE_TITLE })).toHaveCount(0);

    await page.goto('/en/watch/lectures');
    await expect(page.getByRole('link', { name: LECTURE_TITLE })).toBeVisible();
    await expect(page.getByRole('link', { name: INTERVIEW_TITLE })).toHaveCount(0);
    await expect(page.getByText('Synthetic hidden draft video')).toHaveCount(0);

    await page.goto(`/en/watch/interviews?series=${programId}&language=ar`);
    await expect(
      page.getByText('No published video matches these filters.'),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Clear all filters' }).first().click();
    await expect(page).toHaveURL(/\/en\/watch\/interviews$/);
  });

  test('shows a Video with its speakers, facts and transcript, and loads NOTHING third-party', async ({
    page,
  }) => {
    const external = thirdPartyRequests(page);
    const response = await page.goto(`/en/watch/videos/${lectureSlug}`);
    expect(response?.headers()['set-cookie']).toBeUndefined();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(LECTURE_TITLE);

    await expect(
      page.locator(`a[href="/en/people/${people.linkedSlug}"]`).first(),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Education' }).first()).toHaveAttribute(
      'href',
      '/en/topics/education',
    );
    await expect(
      page.getByText('Captions are offered in the YouTube player.'),
    ).toBeVisible();
    await expect(page.locator('time[datetime="PT1H2M3S"]').first()).toHaveText('1:02:03');

    await page.getByText('Read the transcript').click();
    await expect(page.getByText('Synthetic transcript, second paragraph.')).toBeVisible();

    // The Series context, at the programme's ONE address.
    await expect(page.getByRole('link', { name: PROGRAM_TITLE }).first()).toHaveAttribute(
      'href',
      `/en/watch/programs/${programSlug}`,
    );

    // Nothing from a provider: no frame, no request, no image.
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(page.locator('main img')).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    expect(external.map((request) => request.url())).toEqual([]);

    // The described fallback is always there, and names the provider.
    await expect(
      page.getByRole('link', { name: `Watch “${LECTURE_TITLE}” on YouTube` }),
    ).toHaveAttribute('href', `https://www.youtube.com/watch?v=${LECTURE_ID}`);

    // Pre-adoption: not indexable, so no machine-readable claim at all.
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
  });

  test('loads ONLY the privacy-enhanced provider, by keyboard, without autoplay', async ({
    page,
  }) => {
    await page.route('https://www.youtube-nocookie.com/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>stub player</title><p>stub</p>',
      }),
    );
    const external = thirdPartyRequests(page);
    await page.goto(`/en/watch/videos/${lectureSlug}`);

    const load = page.getByRole('button', { name: 'Load the video from YouTube' });
    await load.focus();
    await page.keyboard.press('Enter');

    const frame = page.locator('iframe');
    await expect(frame).toHaveCount(1);
    await expect(frame).toHaveAttribute(
      'src',
      `https://www.youtube-nocookie.com/embed/${LECTURE_ID}?rel=0`,
    );
    await expect(frame).toHaveAttribute('title', `${LECTURE_TITLE} — YouTube player`);
    expect(await frame.getAttribute('allow')).not.toContain('autoplay');
    await expect(frame).toBeFocused();

    await page.waitForLoadState('networkidle');
    const hosts = new Set(external.map((request) => new URL(request.url()).host));
    expect([...hosts]).toEqual(['www.youtube-nocookie.com']);

    // Still no cookie, still nothing remembered: reloading is gated again.
    await page.reload();
    await expect(page.locator('iframe')).toHaveCount(0);
  });

  test('sends a frame allowance ONLY on the player page, and one policy there', async ({
    request,
  }) => {
    const player = await request.get(`/en/watch/videos/${lectureSlug}`);
    const policy = player.headers()['content-security-policy'] ?? '';
    expect(policy.split('default-src').length).toBe(2);
    expect(policy).toContain(
      'frame-src https://www.youtube-nocookie.com https://player.vimeo.com;',
    );
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain('unsafe-eval');
    expect(player.headers()['permissions-policy']).toContain('autoplay=()');

    for (const path of [
      '/en/watch',
      '/en/watch/videos',
      `/en/watch/programs/${programSlug}`,
    ]) {
      const other = await request.get(path);
      expect(other.headers()['content-security-policy'], path).toContain(
        "frame-src 'none'",
      );
    }
  });

  test('offers no player for a video the provider no longer serves', async ({ page }) => {
    await page.goto(`/en/watch/videos/${unavailableSlug}`);
    await expect(
      page.getByText('YouTube does not currently offer this video to be played here.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /Load the video/ })).toHaveCount(0);
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: 'Try opening it on YouTube' }),
    ).toHaveAttribute('href', `https://www.youtube.com/watch?v=${UNAVAILABLE_ID}`);
  });

  test('never serves a draft', async ({ request }) => {
    const draft = await request.get(`/en/watch/videos/${draftSlug}`, { maxRedirects: 0 });
    expect(draft.status()).toBe(404);
  });

  test('lists a programme’s episodes and a playlist’s videos in their own order', async ({
    page,
  }) => {
    await page.goto(`/en/watch/programs/${programSlug}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(PROGRAM_TITLE);
    const episodes = page.getByRole('list', { name: 'Episodes' });
    await expect(episodes.getByRole('heading')).toHaveText([
      LECTURE_TITLE,
      INTERVIEW_TITLE,
    ]);
    await expect(episodes.getByText('Episode 1')).toBeVisible();

    await page.goto(`/en/watch/playlists/${playlistSlug}`);
    const videos = page.getByRole('list', { name: 'Videos in this playlist' });
    await expect(videos.getByRole('heading')).toHaveText([
      INTERVIEW_TITLE,
      LECTURE_TITLE,
    ]);
    await expect(page.getByText('Synthetic hidden draft video')).toHaveCount(0);
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

    await hop(`/ur/watch/videos/${lectureOld}`, `/ur/watch/videos/${lectureSlug}`);
    await hop(
      `/en/watch/playlists/${playlistOld}`,
      `/en/watch/playlists/${playlistSlug}`,
    );
    // A former SERIES slug of what is now a PROGRAMME: one hop, straight to the
    // programme's current address — never through /watch/series first.
    await hop(`/ar/watch/series/${seriesOld}`, `/ar/watch/programs/${programSlug}`);
    await hop(`/en/watch/programs/${seriesOld}`, `/en/watch/programs/${programSlug}`);
    // The current slug under the other family is not a second canonical URL.
    await hop(`/en/watch/series/${programSlug}`, `/en/watch/programs/${programSlug}`);
    // A speaker's detail is their ONE profile.
    await hop(
      `/en/watch/speakers/${people.linkedSlug}`,
      `/en/people/${people.linkedSlug}`,
    );

    for (const missing of [`/en/watch/videos/${draftSlug}`, '/en/watch/sermons']) {
      const response = await request.get(missing, { maxRedirects: 0 });
      expect(response.status(), missing).toBe(404);
    }
  });

  test('browses speakers through People, and topics through the hub', async ({
    page,
  }) => {
    await page.goto('/en/watch/speakers');
    await expect(
      page.locator(`a[href="/en/people/${people.linkedSlug}"]`).first(),
    ).toBeVisible();

    await page.goto('/en/watch/topics/education');
    await expect(page.getByRole('link', { name: LECTURE_TITLE })).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Everything on this topic' }),
    ).toHaveAttribute('href', '/en/topics/education');

    await page.goto('/en/topics/education');
    const section = page.getByRole('region', { name: 'Videos on this topic' });
    await expect(section.getByRole('link', { name: LECTURE_TITLE })).toHaveAttribute(
      'href',
      `/en/watch/videos/${lectureSlug}`,
    );

    await page.goto(`/en/people/${people.linkedSlug}`);
    const videos = page.getByRole('region', { name: 'Videos' });
    await expect(videos.getByRole('link', { name: LECTURE_TITLE })).toBeVisible();
  });

  test('renders Urdu right-to-left with the title in its own language', async ({
    page,
  }) => {
    await page.goto(`/ur/watch/videos/${lectureSlug}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ur');
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toHaveText(`آزمائشی خطاب ${run}`);
    await expect(heading).toHaveAttribute('lang', 'ur');
    await expect(
      page.getByRole('button', { name: 'ویڈیو YouTube سے لوڈ کریں' }),
    ).toBeVisible();
  });

  test('reflows at 320px — and so at 200% zoom — without horizontal scroll', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    for (const path of [
      '/en/watch',
      '/en/watch/videos',
      `/en/watch/videos/${lectureSlug}`,
      `/ur/watch/videos/${lectureSlug}`,
      `/ar/watch/playlists/${playlistSlug}`,
    ]) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});

/* ========================================================================== */

test.describe('search finds a Video, and never a withdrawn one', () => {
  test('finds a Video at its current address, then withholds it once withdrawn', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await eventuallyFound(page, WORD, LECTURE_TITLE);
    const results = page.getByRole('list', { name: 'Search results' });
    await expect(results.getByRole('link', { name: LECTURE_TITLE })).toHaveAttribute(
      'href',
      `/en/watch/videos/${lectureSlug}`,
    );

    await eventuallyFound(page, WITHDRAWN_WORD, INTERVIEW_TITLE);
    // Withdrawn with no indexing request: the stale row is still there, and the
    // query-time visibility check is all that stands between it and the page.
    await sql.query(
      `UPDATE [dbo].[Video] SET [state]=N'archived' WHERE [id]=N'${interviewId}';`,
    );
    await page.goto(`/en/search?q=${WITHDRAWN_WORD}`);
    await page.getByRole('heading', { level: 1, name: 'Search' }).waitFor();
    await expect(page.getByText(INTERVIEW_TITLE)).toHaveCount(0);
  });
});

/* ========================================================================== */

test.describe('Media administration', () => {
  let admin: Page;
  let stranger: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    for (const [index, keys] of [
      [0, ['media.read', 'media.administer']],
      [1, [] as string[]],
    ] as const) {
      const context = await browser.newContext({
        baseURL: baseUrl(),
        extraHTTPHeaders: { 'x-forwarded-for': `100.64.248.${String(index + 1)}` },
      });
      contexts.push(context);
      const page = await context.newPage();
      const { email } = await registerAndSignIn(page, `media-${String(index)}`);
      if (keys.length > 0) await grant(await accountIdFor(sql, email), keys);
      if (index === 0) admin = page;
      else stranger = page;
    }
  });

  test('refuses every Media surface to an account without the permission', async () => {
    for (const surface of [
      'videos',
      'series',
      'playlists',
      `videos/${lectureId}`,
      `playlists/${playlistId}`,
    ]) {
      const response = await stranger.goto(`/en/admin/media/${surface}`);
      expect(response?.status(), surface).toBe(404);
    }
  });

  test('creates a Video from a provider address, and refuses anything else', async () => {
    const created = `browser-admin-video-${run}`;
    const providerId = `Ad${run.slice(0, 9)}`;
    await admin.goto('/en/admin/media/videos');
    await expect(admin.getByRole('heading', { level: 1, name: 'Videos' })).toBeVisible();

    // A hostile "address" is refused with a message the operator can act on.
    await admin.locator('#new-video-slug').fill(`${created}-hostile`);
    await admin.locator('#new-video-reference').fill('javascript:alert(1)');
    await admin.locator('#new-video-title-en').fill('Synthetic admin video');
    await admin.locator('#new-video-language').selectOption('en');
    await admin.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(
      admin.getByRole('alert').filter({ hasText: 'Some of the details are not valid.' }),
    ).toBeVisible();

    await admin.goto('/en/admin/media/videos');
    await admin.locator('#new-video-slug').fill(created);
    await admin.locator('#new-video-reference').fill(`https://youtu.be/${providerId}`);
    await admin.locator('#new-video-title-en').fill('Synthetic admin video');
    await admin.locator('#new-video-language').selectOption('en');
    await admin.locator('#new-video-state').selectOption('published');
    await admin.getByRole('button', { name: 'Create', exact: true }).click();
    await admin.waitForURL(/\/en\/admin\/media\/videos\/[0-9a-f-]{36}$/);

    // The editor previews through the same gate: nothing loaded until asked.
    await expect(
      admin.getByRole('button', { name: 'Load the video from YouTube' }),
    ).toBeVisible();
    await expect(admin.locator('iframe')).toHaveCount(0);

    const [row] = await sql.query<{ providerVideoId: string }>(
      `SELECT [providerVideoId] FROM [dbo].[Video] WHERE [slug]=N'${created}';`,
    );
    expect(row?.providerVideoId).toBe(providerId);

    await admin.goto(`/en/watch/videos/${created}`);
    await expect(admin.getByRole('heading', { level: 1 })).toHaveText(
      'Synthetic admin video',
    );
  });

  test('refuses a stale Video save visibly, and keeps the first', async () => {
    await admin.goto(`/en/admin/media/videos/${lectureId}`);
    const editor = admin.url();
    const second = await admin.context().newPage();
    await second.goto(editor);

    await admin.locator('#video-duration').fill('1:00:00');
    await admin.getByRole('button', { name: 'Save', exact: true }).click();
    await admin.waitForLoadState('networkidle');

    await second.locator('#video-duration').fill('2:00:00');
    await second.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      second.getByRole('alert').filter({ hasText: 'This record changed.' }),
    ).toBeVisible();
    await second.close();

    const [row] = await sql.query<{ durationSeconds: number }>(
      `SELECT [durationSeconds] FROM [dbo].[Video] WHERE [id]=N'${lectureId}';`,
    );
    expect(row?.durationSeconds).toBe(3600);
  });

  test('orders a Playlist with named moves, and refuses a stale one', async () => {
    await admin.goto(`/en/admin/media/playlists/${playlistId}`);
    const members = admin.getByRole('list', { name: 'Videos in this playlist' });
    await expect(members.getByRole('listitem')).toHaveCount(3);

    const stale = await admin.context().newPage();
    await stale.goto(admin.url());

    // Move the lecture (last) up one place.
    await members
      .getByRole('listitem')
      .filter({ hasText: LECTURE_TITLE })
      .getByRole('button', { name: 'Move up' })
      .click();
    await admin.waitForLoadState('networkidle');
    await expect(
      admin
        .getByRole('list', { name: 'Videos in this playlist' })
        .getByRole('listitem')
        .nth(1),
    ).toContainText(LECTURE_TITLE);

    // The second page still shows the old version; its click is refused.
    await stale
      .getByRole('list', { name: 'Videos in this playlist' })
      .getByRole('listitem')
      .first()
      .getByRole('button', { name: 'Remove' })
      .click();
    await expect(
      stale.getByRole('alert').filter({ hasText: 'This record changed.' }),
    ).toBeVisible();
    await stale.close();

    const order = await sql.query<{ videoId: string }>(
      `SELECT [videoId] FROM [dbo].[PlaylistVideo] WHERE [playlistId]=N'${playlistId}' ORDER BY [position];`,
    );
    expect(order.map((entry) => entry.videoId)).toEqual([
      interviewId,
      lectureId,
      draftId,
    ]);
  });
});
