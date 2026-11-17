import { randomUUID } from 'node:crypto';

import { AxeBuilder } from '@axe-core/playwright';
import type { BrowserContext, Page, Request, TestInfo } from '@playwright/test';

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
  grantRole,
} from './support';

/**
 * Phase 10 — Watch in a real browser, against the production build.
 *
 * WHAT ONLY A BROWSER CAN PROVE: that a Video page makes NO request to any
 * provider until the visitor asks — and then only to the privacy-enhanced host
 * the CSP names; that one press of Play both loads it and starts it (R2) while
 * nothing else autoplays; that the frame carries an accessible title;
 * that a known-unavailable video offers no player at all; that the Watch pages
 * work signed out and set no cookie; that every former address — a Video, a
 * Playlist, and a series that has since become a programme — answers ONE 301
 * through the real proxy; that Urdu renders right-to-left; that nothing
 * scrolls sideways at 320px; that a Video is found by the running search sweep
 * and withheld once withdrawn; and that administration works, validates the
 * provider, orders a Playlist and refuses a stale save visibly.
 *
 * WATCH PART 1: the listing is the shared Videos listing over the whole of
 * Media — figures, format tabs with counts, a Topic filter with counts and its
 * chip, one address per view (a `?format=`, a former `?offset=` and the
 * Topic view each one redirect); a Video's page carries its Series with the
 * previous and next episode and a share button; the landing carries its
 * figures, its ways in by Topic and every menu item. No fixture is added: the
 * programme's two episodes and the education Topic already here prove them.
 *
 * WATCH PART 2: the Series, programme and Playlist directories (figures,
 * counted filters, chips, one address per view) and pages (where to begin,
 * the numbered list, speakers and Topics), and the speakers' directory. One
 * fixture is added: a SERIES (the programme is the other kind) whose one
 * episode is the undated unavailable video, titled to sort last ("Zz…") so
 * it crowds no other spec's first page or shelf.
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
/** The canonical education Topic's identifier, as an address spells it. */
let educationId: string;
const contexts: BrowserContext[] = [];

const run = randomUUID().replaceAll('-', '').slice(0, 10);
const WORD = `pewterfixture${run}`;
const WITHDRAWN_WORD = `lindenfixture${run}`;

const lectureId = randomUUID();
const interviewId = randomUUID();
const unavailableId = randomUUID();
const draftId = randomUUID();
const programId = randomUUID();
const seriesId = randomUUID();
const playlistId = randomUUID();

const lectureOld = `browser-lecture-old-${run}`;
const lectureSlug = `browser-lecture-${run}`;
const interviewSlug = `browser-interview-${run}`;
const unavailableSlug = `browser-unavailable-${run}`;
const draftSlug = `browser-draft-${run}`;
const seriesOld = `browser-series-old-${run}`;
const programSlug = `browser-program-${run}`;
const seriesSlug = `browser-series-${run}`;
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
const SERIES_TITLE = `Zz synthetic browser series ${run}`;

async function grant(accountId: string, keys: readonly string[]): Promise<void> {
  await grantRole(sql, accountId, keys, 'Media browser proof');
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

  // A SERIES renamed and made a PROGRAMME, so both its family and its slug have
  // a former address; a lecture renamed once; a playlist renamed once, ordered
  // interview-first with a draft member it must never show.
  await sql.query(`
    INSERT INTO [dbo].[Series] ([id],[slug],[kind],[primaryLocale],[state],[version],[updatedAt])
    VALUES (N'${programId}', N'${seriesOld}', N'series', N'en', N'published', 1, SYSUTCDATETIME());
    UPDATE [dbo].[Series] SET [slug]=N'${programSlug}', [kind]=N'program', [version]=2 WHERE [id]=N'${programId}';
    INSERT INTO [dbo].[SeriesLabel] ([seriesId],[locale],[title],[description])
      VALUES (N'${programId}', N'en', N'${PROGRAM_TITLE}', N'A synthetic programme.');
    INSERT INTO [dbo].[Series] ([id],[slug],[kind],[primaryLocale],[state],[version],[updatedAt])
    VALUES (N'${seriesId}', N'${seriesSlug}', N'series', N'en', N'published', 1, SYSUTCDATETIME());
    INSERT INTO [dbo].[SeriesLabel] ([seriesId],[locale],[title],[description])
      VALUES (N'${seriesId}', N'en', N'${SERIES_TITLE}', N'');

    INSERT INTO [dbo].[Video] ([id],[slug],[primaryLocale],[state],[isFeatured],[provider],[providerVideoId],[availability],[format],[languageCode],[durationSeconds],[publishedOn],[captions],[transcript],[seriesId],[seriesPosition],[version],[updatedAt]) VALUES
      (N'${lectureId}', N'${lectureOld}', N'en', N'published', 1, N'youtube', '${LECTURE_ID}', N'available', N'lecture', N'en', 3723, '2031-01-02', 1,
       N'Synthetic transcript, first paragraph.' + CHAR(10) + CHAR(10) + N'Synthetic transcript, second paragraph.', N'${programId}', 1, 1, SYSUTCDATETIME()),
      (N'${interviewId}', N'${interviewSlug}', N'en', N'published', 0, N'vimeo', '${INTERVIEW_ID}', N'available', N'interview', N'ur', 600, '2030-05-06', 0,
       NULL, N'${programId}', 2, 1, SYSUTCDATETIME()),
      (N'${unavailableId}', N'${unavailableSlug}', N'en', N'published', 0, N'youtube', '${UNAVAILABLE_ID}', N'unavailable', NULL, N'en', NULL, NULL, 0,
       NULL, N'${seriesId}', 1, 1, SYSUTCDATETIME()),
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
    const response = await page.goto('/watch');
    expect(response?.status()).toBe(200);
    expect(response?.headers()['set-cookie']).toBeUndefined();
    await expect(page.getByRole('heading', { level: 1, name: 'Watch' })).toBeVisible();

    // Featured means what an operator featured; latest means everything. (R2:
    // the shelves below show every video of their kind, so the claim is made
    // of the sorted section itself.)
    const featured = page.getByRole('region', { name: 'Featured' });
    await expect(featured.getByRole('link', { name: LECTURE_TITLE })).toBeVisible();
    await expect(featured.getByRole('link', { name: INTERVIEW_TITLE })).toHaveCount(0);
    // A kind of video has its own shelf, linked to its own view.
    const interviews = page.getByRole('region', { name: 'Interviews' });
    await expect(interviews.getByRole('link', { name: INTERVIEW_TITLE })).toBeVisible();
    await page.getByRole('link', { name: 'Latest', exact: true }).click();
    await expect(page).toHaveURL(/\/watch\?sort=latest$/);
    await expect(
      page
        .getByRole('region', { name: 'Latest' })
        .getByRole('link', { name: INTERVIEW_TITLE }),
    ).toBeVisible();

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
      expect(hrefs).toContain(`/watch/${surface}`);
    }
    // Phase 11: Listen, Watch's sibling for audio, is linked; audio is never a
    // Watch surface, and galleries are not offered.
    expect(hrefs).toContain('/listen');
    for (const absent of ['/watch/audio', '/watch/galleries']) {
      expect(hrefs).not.toContain(absent);
    }
    // Each group of the browse index says, in a line, what it gathers.
    const browse = page.getByRole('main').getByRole('navigation', { name: 'Browse' });
    for (const intro of [
      'Each kind of recording has a view of its own.',
      'Videos gathered together, to be watched in order.',
      'Find videos by who speaks or what they are about, or listen instead.',
    ])
      await expect(browse.getByText(intro, { exact: true })).toBeVisible();
    // A card paints no remote image.
    await expect(page.locator('main img')).toHaveCount(0);
  });

  test('filters videos by language and by curated view, and says so when nothing matches', async ({
    page,
  }) => {
    await page.goto('/watch/videos?language=ur');
    await expect(page.getByRole('link', { name: INTERVIEW_TITLE })).toBeVisible();
    await expect(page.getByRole('link', { name: LECTURE_TITLE })).toHaveCount(0);

    await page.goto('/watch/lectures');
    await expect(
      page
        .getByRole('list', { name: 'Lectures and speeches', exact: true })
        .getByRole('link', { name: LECTURE_TITLE }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: INTERVIEW_TITLE })).toHaveCount(0);
    await expect(page.getByText('Synthetic hidden draft video')).toHaveCount(0);

    await page.goto(`/watch/interviews?series=${programId}&language=ar`);
    await expect(
      page.getByText('No published video matches these filters.'),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Clear filters' }).first().click();
    await expect(page).toHaveURL(/\/watch\/interviews$/);
  });

  test('shows a Video with its speakers, facts and transcript, and loads NOTHING third-party', async ({
    page,
  }) => {
    const external = thirdPartyRequests(page);
    const response = await page.goto(`/watch/videos/${lectureSlug}`);
    expect(response?.headers()['set-cookie']).toBeUndefined();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(LECTURE_TITLE);

    await expect(
      page.locator(`a[href="/people/${people.linkedSlug}"]`).first(),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Education' }).first()).toHaveAttribute(
      'href',
      '/topics/education',
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
      `/watch/programs/${programSlug}`,
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

  test('loads ONLY the privacy-enhanced provider, by keyboard, and plays on that one press', async ({
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
    await page.goto(`/watch/videos/${lectureSlug}`);

    const play = page.getByRole('button', {
      name: `Play “${LECTURE_TITLE}” (plays from YouTube)`,
    });
    await play.focus();
    await page.keyboard.press('Enter');

    const frame = page.locator('iframe');
    await expect(frame).toHaveCount(1);
    await expect(frame).toHaveAttribute(
      'src',
      `https://www.youtube-nocookie.com/embed/${LECTURE_ID}?rel=0&autoplay=1`,
    );
    await expect(frame).toHaveAttribute('title', `${LECTURE_TITLE} — YouTube player`);
    // The press is the request AND the play: the frame alone is allowed to
    // autoplay, and only this click-created frame exists.
    expect(await frame.getAttribute('allow')).toBe(
      'autoplay; encrypted-media; picture-in-picture; fullscreen',
    );
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
    const player = await request.get(`/watch/videos/${lectureSlug}`);
    const policy = player.headers()['content-security-policy'] ?? '';
    expect(policy.split('default-src').length).toBe(2);
    expect(policy).toContain(
      'frame-src https://www.youtube-nocookie.com https://player.vimeo.com;',
    );
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain('unsafe-eval');
    // Autoplay is delegated on the player page only, to itself and exactly the
    // two privacy-enhanced embed origins; everywhere else it stays refused.
    expect(player.headers()['permissions-policy']).toContain(
      'autoplay=(self "https://www.youtube-nocookie.com" "https://player.vimeo.com")',
    );

    for (const path of ['/watch', '/watch/videos', `/watch/programs/${programSlug}`]) {
      const other = await request.get(path);
      expect(other.headers()['content-security-policy'], path).toContain(
        "frame-src 'none'",
      );
      expect(other.headers()['permissions-policy'], path).toContain('autoplay=()');
    }
  });

  test('offers no player for a video the provider no longer serves', async ({ page }) => {
    await page.goto(`/watch/videos/${unavailableSlug}`);
    await expect(
      page.getByText('YouTube does not currently offer this video to be played here.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /^Play / })).toHaveCount(0);
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: 'Try opening it on YouTube' }),
    ).toHaveAttribute('href', `https://www.youtube.com/watch?v=${UNAVAILABLE_ID}`);
  });

  test('never serves a draft', async ({ request }) => {
    const draft = await request.get(`/watch/videos/${draftSlug}`, { maxRedirects: 0 });
    expect(draft.status()).toBe(404);
  });

  test('lists a programme’s episodes and a playlist’s videos in their own order', async ({
    page,
  }) => {
    await page.goto(`/watch/programs/${programSlug}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(PROGRAM_TITLE);
    const episodes = page.getByRole('list', { name: 'Episodes' });
    await expect(episodes.getByRole('heading')).toHaveText([
      LECTURE_TITLE,
      INTERVIEW_TITLE,
    ]);
    await expect(episodes.getByText('Episode 1')).toBeVisible();

    await page.goto(`/watch/playlists/${playlistSlug}`);
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
    await hop(`/watch/playlists/${playlistOld}`, `/watch/playlists/${playlistSlug}`);
    // A former SERIES slug of what is now a PROGRAMME: one hop, straight to the
    // programme's current address — never through /watch/series first.
    await hop(`/ar/watch/series/${seriesOld}`, `/ar/watch/programs/${programSlug}`);
    await hop(`/watch/programs/${seriesOld}`, `/watch/programs/${programSlug}`);
    // The current slug under the other family is not a second canonical URL.
    await hop(`/watch/series/${programSlug}`, `/watch/programs/${programSlug}`);
    // A speaker's detail is their ONE profile.
    await hop(`/watch/speakers/${people.linkedSlug}`, `/people/${people.linkedSlug}`);
    // Watch Part 1: the Topic view is the listing filtered by it, in its locale.
    const topicView = await request.get('/ur/watch/topics/education', {
      maxRedirects: 0,
    });
    expect(topicView.status()).toBe(301);
    const topicTarget = new URL(topicView.headers()['location'] ?? '', baseUrl());
    expect(`${topicTarget.pathname}${topicTarget.search}`).toBe(
      `/ur/watch/videos?topic=${educationId}`,
    );
    expect(topicView.headers()['x-robots-tag']).toBe('noindex');
    const unknownTopic = await request.get('/watch/topics/no-such-topic-anywhere', {
      maxRedirects: 0,
    });
    expect(unknownTopic.status()).toBe(404);

    for (const missing of [`/watch/videos/${draftSlug}`, '/watch/sermons']) {
      const response = await request.get(missing, { maxRedirects: 0 });
      expect(response.status(), missing).toBe(404);
    }
  });

  test('browses speakers through People, and topics through the hub', async ({
    page,
  }) => {
    await page.goto('/watch/speakers');
    await expect(
      page.locator(`a[href="/people/${people.linkedSlug}"]`).first(),
    ).toBeVisible();

    await page.goto('/watch/topics/education');
    await expect(page).toHaveURL(`/watch/videos?topic=${educationId}`);
    await expect(
      page
        .getByRole('list', { name: 'Videos', exact: true })
        .getByRole('link', { name: LECTURE_TITLE }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Everything on this topic' }),
    ).toHaveAttribute('href', '/topics/education');

    await page.goto('/topics/education');
    const section = page.getByRole('region', { name: 'Videos on this topic' });
    await expect(section.getByRole('link', { name: LECTURE_TITLE })).toHaveAttribute(
      'href',
      `/watch/videos/${lectureSlug}`,
    );

    await page.goto(`/people/${people.linkedSlug}`);
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
      page.getByRole('button', {
        name: `“آزمائشی خطاب ${run}” چلائیں (YouTube سے چلتی ہے)`,
      }),
    ).toBeVisible();
  });

  test('reflows at 320px — and so at 200% zoom — without horizontal scroll', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    for (const path of [
      '/watch',
      '/watch/videos',
      `/watch/videos/${lectureSlug}`,
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

test.describe('Watch Part 1 — the listing, the video page and the landing', () => {
  test('lists every video with figures, format tabs and filters with counts, at one address per view', async ({
    page,
    request,
  }) => {
    await page.goto('/watch/videos');
    await expect(page.getByRole('heading', { level: 1, name: 'Videos' })).toBeVisible();
    // The figures the data supports, and the curated formats as tabs with
    // counts; the tabs keep every other filter.
    await expect(page.getByRole('main')).toContainText(/\d+\s*videos?/);
    const kinds = page.getByRole('navigation', { name: 'Kind of video' });
    await expect(kinds.getByRole('link', { name: /^All videos\s*\d+$/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(kinds.getByRole('link', { name: /^Interviews\s*\d+$/ })).toHaveAttribute(
      'href',
      '/watch/interviews',
    );
    // The Topic filter offers each Topic with what choosing it would show.
    const topic = page.locator('#videos-topic');
    await expect(topic.locator(`option[value="${educationId}"]`)).toHaveText(
      /^Education \(\d+\)$/,
    );
    // Without script: the GET form, then ONE redirect to the view's spelling.
    await topic.selectOption(educationId);
    await page.getByRole('button', { name: 'Show videos' }).click();
    await expect(page).toHaveURL(`/watch/videos?topic=${educationId}`);
    await expect(
      page
        .getByRole('list', { name: 'Videos', exact: true })
        .getByRole('link', { name: LECTURE_TITLE }),
    ).toBeVisible();
    const chips = page.getByRole('list', { name: 'Filters in use' });
    await expect(
      chips.getByRole('link', { name: 'Remove filter: Education' }),
    ).toHaveAttribute('href', '/watch/videos');
    await expect(
      page.getByRole('link', { name: 'Everything on this topic' }),
    ).toHaveAttribute('href', '/topics/education');
    // A tab keeps the Topic.
    await expect(
      page
        .getByRole('navigation', { name: 'Kind of video' })
        .getByRole('link', { name: /^Lectures and speeches\s*\d+$/ }),
    ).toHaveAttribute('href', `/watch/lectures?topic=${educationId}`);

    // A curated view is its own address: its tab is current, and a ?format=
    // or a former ?offset= is one redirect.
    await page.goto('/watch/interviews');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Interviews' }),
    ).toBeVisible();
    await expect(
      page
        .getByRole('navigation', { name: 'Kind of video' })
        .getByRole('link', { name: /^Interviews\s*\d+$/ }),
    ).toHaveAttribute('aria-current', 'page');
    for (const [from, to] of [
      ['/watch/videos?format=interview', '/watch/interviews'],
      ['/ur/watch/videos?format=lecture&language=en', '/ur/watch/lectures?language=en'],
      ['/watch/videos?offset=24', '/watch/videos?page=2'],
      ['/watch/lectures?format=lecture', '/watch/lectures'],
    ]) {
      const response = await request.get(from, { maxRedirects: 0 });
      expect(response.status(), from).toBe(307);
      const target = new URL(response.headers()['location'] ?? '', baseUrl());
      expect(`${target.pathname}${target.search}`, from).toBe(to);
    }
  });

  test('gives an episode its Series, the previous and next episode, and a way to share it', async ({
    page,
  }) => {
    await page.goto(`/watch/videos/${lectureSlug}`);
    const series = page.getByRole('region', { name: PROGRAM_TITLE });
    await expect(series.getByText('Episode 1 of 2')).toBeVisible();
    const steps = series.getByRole('navigation', { name: 'Previous and next episode' });
    await expect(steps.getByRole('link')).toHaveCount(1);
    await steps.getByRole('link', { name: /^Next episode/ }).click();
    await expect(page).toHaveURL(`/watch/videos/${interviewSlug}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(INTERVIEW_TITLE);
    await expect(
      page
        .getByRole('region', { name: PROGRAM_TITLE })
        .getByRole('link', { name: /^Previous episode/ }),
    ).toHaveAttribute('href', `/watch/videos/${lectureSlug}`);
    // With script, a share button; the address it shares is the canonical one.
    await expect(page.getByRole('button', { name: 'Share' })).toBeVisible();
    // An interview names its kind among the facts.
    await expect(page.getByRole('region', { name: 'Details' })).toContainText(
      'Interview',
    );
  });

  test('opens Watch with its figures, ways in by Topic, the subject hubs and every menu item', async ({
    page,
  }) => {
    await page.goto('/watch');
    const main = page.getByRole('main');
    await expect(main).toContainText(/\d+\s*videos?/);
    // Every Topic chip leads to the listing filtered by it, at its one spelling.
    const topics = page.getByRole('list', { name: 'Browse by topic', exact: true });
    for (const href of await topics
      .getByRole('link')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? '')))
      expect(href).toMatch(/^\/watch\/videos\?topic=[0-9a-f-]{36}$/);
    const subjects = page.getByRole('region', { name: 'Videos by subject' });
    await expect(
      subjects.getByRole('link', { name: /Videos on the Quran/ }),
    ).toHaveAttribute('href', '/quran/videos');
    await expect(
      subjects.getByRole('link', { name: /Videos on Hadith/ }),
    ).toHaveAttribute('href', '/hadith/videos');
    // Every item of the Watch menu, and Listen's two listings.
    const hrefs = await main
      .getByRole('link')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
    for (const href of [
      '/watch/videos',
      '/watch/lectures',
      '/watch/events',
      '/watch/highlights',
      '/watch/interviews',
      '/watch/documentaries',
      '/watch/series',
      '/watch/programs',
      '/watch/playlists',
      '/topics',
      '/watch/speakers',
      '/listen',
      '/listen/lectures',
      '/listen/series',
    ])
      expect(hrefs, href).toContain(href);
  });

  test('is axe-clean and never scrolls sideways, in English and Urdu, from 320 to 1440 px', async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    for (const [width, height] of [
      [320, 800],
      [1440, 900],
    ] as const) {
      await page.setViewportSize({ width, height });
      for (const path of [
        '/watch',
        '/watch/videos',
        `/watch/videos?topic=${educationId}`,
        '/watch/lectures',
        `/watch/videos/${lectureSlug}`,
        '/ur/watch',
        '/ur/watch/videos',
        `/ur/watch/videos/${interviewSlug}`,
        '/ar/watch/interviews',
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

test.describe('Watch Part 2 — series, programmes, playlists and speakers', () => {
  test('directs to each kind’s groupings with counted filters, chips and one address per view', async ({
    page,
    request,
  }) => {
    // The series' directory, searched by title: the fixture's Series, never
    // the programme (the other kind).
    await page.goto(`/watch/series?q=${encodeURIComponent(SERIES_TITLE)}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Series' })).toBeVisible();
    const series = page.getByRole('list', { name: 'Series', exact: true });
    await expect(series.getByRole('link', { name: SERIES_TITLE })).toHaveAttribute(
      'href',
      `/watch/series/${seriesSlug}`,
    );
    await expect(series.getByText('1 episode', { exact: true })).toBeVisible();
    await expect(
      page
        .getByRole('list', { name: 'Filters in use' })
        .getByRole('link', { name: `Remove filter: Title: ${SERIES_TITLE}` }),
    ).toHaveAttribute('href', '/watch/series');
    await page.goto(`/watch/series?q=${encodeURIComponent(PROGRAM_TITLE)}`);
    await expect(
      page.getByText('No series matches every filter you chose. Remove one to see more.'),
    ).toBeVisible();

    // The programmes' directory: its figures, and a speaker offered with what
    // choosing them would show, submitted without script.
    await page.goto('/watch/programs');
    await expect(page.getByRole('main')).toContainText(/\d+\s*programmes?/);
    const speaker = page.locator('#groups-speaker');
    await expect(speaker.locator(`option[value="${people.linkedPersonId}"]`)).toHaveText(
      /^Recovery proof contributor \(1\)$/,
    );
    await speaker.selectOption(people.linkedPersonId);
    await page.getByRole('button', { name: 'Show', exact: true }).click();
    await expect(page).toHaveURL(`/watch/programs?speaker=${people.linkedPersonId}`);
    const programmes = page.getByRole('list', { name: 'Programmes', exact: true });
    await expect(programmes.getByRole('link', { name: PROGRAM_TITLE })).toHaveAttribute(
      'href',
      `/watch/programs/${programSlug}`,
    );
    await expect(programmes.getByText('2 episodes', { exact: true })).toBeVisible();
    await expect(
      page
        .getByRole('list', { name: 'Filters in use' })
        .getByRole('link', { name: 'Remove filter: Recovery proof contributor' }),
    ).toHaveAttribute('href', '/watch/programs');

    // The playlists' directory lists the published playlist.
    await page.goto(`/watch/playlists?q=${encodeURIComponent(PLAYLIST_TITLE)}`);
    await expect(
      page
        .getByRole('list', { name: 'Playlists', exact: true })
        .getByRole('link', { name: PLAYLIST_TITLE }),
    ).toHaveAttribute('href', `/watch/playlists/${playlistSlug}`);

    // One address per view: each other spelling is ONE redirect.
    for (const [from, to] of [
      ['/watch/series?q=&language=&speaker=&topic=&sort=newest', '/watch/series'],
      ['/watch/programs?offset=24', '/watch/programs'],
      ['/ur/watch/playlists?page=1&sort=title', '/ur/watch/playlists?sort=title'],
      ['/watch/speakers?offset=50', '/watch/speakers'],
      [`/watch/programs/${programSlug}?offset=0`, `/watch/programs/${programSlug}`],
      [
        `/ur/watch/playlists/${playlistSlug}?page=1`,
        `/ur/watch/playlists/${playlistSlug}`,
      ],
    ]) {
      const response = await request.get(from, { maxRedirects: 0 });
      expect(response.status(), from).toBe(307);
      const target = new URL(response.headers()['location'] ?? '', baseUrl());
      expect(`${target.pathname}${target.search}`, from).toBe(to);
    }
  });

  test('opens a programme on where to begin, with its figures, speakers and Topics', async ({
    page,
  }) => {
    await page.goto(`/watch/programs/${programSlug}`);
    const main = page.getByRole('main');
    await expect(main).toContainText(/2\s*episodes/);
    // Its latest dated episode IS its first, so one way in is offered.
    await expect(
      main.getByRole('link', { name: 'Start from episode 1' }),
    ).toHaveAttribute('href', `/watch/videos/${lectureSlug}`);
    await expect(main.getByRole('link', { name: 'Latest episode' })).toHaveCount(0);
    await expect(
      page
        .getByRole('region', { name: 'Speakers' })
        .locator(`a[href="/people/${people.linkedSlug}"]`),
    ).toBeVisible();
    await expect(
      page
        .getByRole('region', { name: 'Topics' })
        .getByRole('link', { name: 'Education' }),
    ).toHaveAttribute('href', '/topics/education');

    // A series begins at episode 1; an unavailable episode says so.
    await page.goto(`/watch/series/${seriesSlug}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(SERIES_TITLE);
    const episodes = page.getByRole('list', { name: 'Episodes' });
    await expect(episodes.getByRole('heading')).toHaveText([UNAVAILABLE_TITLE]);
    await expect(episodes.getByText('Unavailable', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('main').getByRole('link', { name: 'Start from episode 1' }),
    ).toHaveAttribute('href', `/watch/videos/${unavailableSlug}`);
    // Past its last page, an honest empty page leading back to the first.
    await page.goto(`/watch/series/${seriesSlug}?page=2`);
    await expect(page.getByText('This page is empty')).toBeVisible();
    await expect(
      page.getByRole('main').getByRole('link', { name: 'Go to the first page' }),
    ).toHaveAttribute('href', `/watch/series/${seriesSlug}`);
  });

  test('plays a playlist from the start, and has no latest', async ({ page }) => {
    await page.goto(`/watch/playlists/${playlistSlug}`);
    const main = page.getByRole('main');
    await expect(main.getByRole('link', { name: 'Play from the start' })).toHaveAttribute(
      'href',
      `/watch/videos/${interviewSlug}`,
    );
    await expect(main.getByRole('link', { name: 'Latest episode' })).toHaveCount(0);
    await expect(main).toContainText(/2\s*videos/);
    await expect(
      page.getByText('A playlist is a hand-picked list in a chosen order.', {
        exact: false,
      }),
    ).toBeVisible();
  });

  test('directs to every speaker by name, linked to their profile and their videos', async ({
    page,
  }) => {
    await page.goto(
      `/watch/speakers?q=${encodeURIComponent('Recovery proof contributor')}`,
    );
    await expect(page.getByRole('heading', { level: 1, name: 'Speakers' })).toBeVisible();
    const list = page.getByRole('list', { name: 'Speakers', exact: true });
    await expect(list.locator(`a[href="/people/${people.linkedSlug}"]`)).toHaveText(
      'Recovery proof contributor',
    );
    const videos = list.locator(
      `a[href="/watch/videos?speaker=${people.linkedPersonId}"]`,
    );
    await expect(videos).toHaveAccessibleName(
      /^1 video with Recovery proof contributor$/,
    );
    await videos.click();
    await expect(page).toHaveURL(`/watch/videos?speaker=${people.linkedPersonId}`);
    await expect(
      page
        .getByRole('list', { name: 'Videos', exact: true })
        .getByRole('link', { name: LECTURE_TITLE }),
    ).toBeVisible();
  });

  test('is right-to-left, axe-clean and never scrolls sideways, from 320 to 1440 px', async ({
    page,
  }, testInfo) => {
    test.setTimeout(300_000);
    await page.goto(`/ur/watch/programs/${programSlug}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveAttribute('lang', 'en');
    for (const [width, height] of [
      [320, 800],
      [1440, 900],
    ] as const) {
      await page.setViewportSize({ width, height });
      for (const path of [
        '/watch/series',
        '/watch/programs',
        '/watch/playlists',
        '/watch/speakers',
        `/watch/programs/${programSlug}`,
        `/watch/series/${seriesSlug}`,
        `/watch/playlists/${playlistSlug}`,
        '/ur/watch/series',
        '/ur/watch/speakers',
        `/ur/watch/programs/${programSlug}`,
        '/ar/watch/playlists',
        `/ar/watch/playlists/${playlistSlug}`,
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

test.describe('search finds a Video, and never a withdrawn one', () => {
  test('finds a Video at its current address, then withholds it once withdrawn', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await eventuallyFound(page, WORD, LECTURE_TITLE);
    const results = page.getByRole('list', { name: 'Search results' });
    await expect(results.getByRole('link', { name: LECTURE_TITLE })).toHaveAttribute(
      'href',
      `/watch/videos/${lectureSlug}`,
    );

    await eventuallyFound(page, WITHDRAWN_WORD, INTERVIEW_TITLE);
    // Withdrawn with no indexing request: the stale row is still there, and the
    // query-time visibility check is all that stands between it and the page.
    await sql.query(
      `UPDATE [dbo].[Video] SET [state]=N'archived' WHERE [id]=N'${interviewId}';`,
    );
    await page.goto(`/search?q=${WITHDRAWN_WORD}`);
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
      const response = await stranger.goto(`/admin/media/${surface}`);
      expect(response?.status(), surface).toBe(404);
    }
  });

  test('creates a Video from a provider address, and refuses anything else', async () => {
    const created = `browser-admin-video-${run}`;
    const providerId = `Ad${run.slice(0, 9)}`;
    await admin.goto('/admin/media/videos');
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

    await admin.goto('/admin/media/videos');
    await admin.locator('#new-video-slug').fill(created);
    await admin.locator('#new-video-reference').fill(`https://youtu.be/${providerId}`);
    await admin.locator('#new-video-title-en').fill('Synthetic admin video');
    await admin.locator('#new-video-language').selectOption('en');
    await admin.locator('#new-video-state').selectOption('published');
    await admin.getByRole('button', { name: 'Create', exact: true }).click();
    await admin.waitForURL(/\/admin\/media\/videos\/[0-9a-f-]{36}$/);

    // The editor previews through the same gate: nothing loaded until asked
    // (R2: the same one-press Play the public page shows).
    await expect(
      admin.getByRole('button', {
        name: 'Play “Synthetic admin video” (plays from YouTube)',
      }),
    ).toBeVisible();
    await expect(admin.locator('iframe')).toHaveCount(0);

    const [row] = await sql.query<{ providerVideoId: string }>(
      `SELECT [providerVideoId] FROM [dbo].[Video] WHERE [slug]=N'${created}';`,
    );
    expect(row?.providerVideoId).toBe(providerId);

    await admin.goto(`/watch/videos/${created}`);
    await expect(admin.getByRole('heading', { level: 1 })).toHaveText(
      'Synthetic admin video',
    );
  });

  test('refuses a stale Video save visibly, and keeps the first', async () => {
    await admin.goto(`/admin/media/videos/${lectureId}`);
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
    await admin.goto(`/admin/media/playlists/${playlistId}`);
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
