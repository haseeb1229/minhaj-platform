import { describe, expect, it } from 'vitest';

import {
  createMinhajTvVideoAdapter,
  durationSecondsOf,
  MINHAJ_TV_BASE_URL,
  MINHAJ_TV_VIDEO_ADAPTER_KEY,
  type MinhajTvVideoAdapterOptions,
} from '../../../../scripts/migration/adapters/minhaj-tv.ts';

import {
  evidenceOf,
  fakeSite,
  htmlPage,
  pendingItem,
  textFile,
  UNDECODABLE,
  type FakeSite,
} from './fake-site.ts';

type Route = Parameters<FakeSite['set']>[1];

/**
 * The minhaj.tv video adapter against SYNTHETIC pages built on the site's
 * template: the speeches grid, the video tabs, the footer's constant YouTube
 * embed, and the "Label: value" metadata rows. No network; no real words.
 */

const ORIGIN = 'https://www.minhaj.tv';
const ROBOTS = `User-Agent: *
Allow: /

Disallow: /include
Disallow: /urdu
Disallow: /english/Blocked-Listing/
Disallow: /english/video/3/
`;

function adapter(overrides: Partial<MinhajTvVideoAdapterOptions> = {}) {
  return createMinhajTvVideoAdapter({
    baseUrl: MINHAJ_TV_BASE_URL,
    selection: { pages: 2, limit: 10 },
    listing: 'Latest-Speeches',
    ...overrides,
  });
}

const videoUrl = (id: number, slug = `Synthetic-Speech-${id}`) =>
  `${ORIGIN}/english/video/${id}/${slug}.html`;

function grid(
  cards: readonly string[],
  pageLinks: readonly number[],
  listing = 'Latest-Speeches',
) {
  return `<!doctype html><html><body>
<div class="row"><div class="col-sm-12 main-content">
<div class="section-header"><h3>Synthetic speeches</h3></div>
<div class="row video-section meta-maxwidth-230">
${cards
  .map(
    (href) => `<div class="col-sm-4 col-xs-6 item responsive-height">
<div class="item-img"><a href="${href}"><img src="/images-charts/thumb230/synthetic.jpg" alt=""></a></div>
<h3><a href="${href}" title="Synthetic">Synthetic speech</a></h3>
<h5>Speech By: <a href="/english//">Synthetic Speaker</a></h5>
<div class="meta"><span class="date">2026-09-20</span><span class="views">1</span></div></div>`,
  )
  .join('\n')}
</div>
<ul class="pagination">${pageLinks
    .map(
      (page) =>
        `<li><a class="page-numbers" href="/english/${listing}/page/${page}/">${page}</a></li>`,
    )
    .join('')}</ul>
</div></div>
<div class="video-section"><div class="item"><h3><a href="/english/video/999/Synthetic-Sidebar.html">Synthetic sidebar</a></h3></div></div>
</body></html>`;
}

function site(extra: Record<string, Route> = {}) {
  return fakeSite({
    [`${ORIGIN}/robots.txt`]: textFile(ROBOTS),
    [`${ORIGIN}/english/Latest-Speeches/`]: htmlPage(
      grid(
        [
          '/english/video/1/Synthetic-Speech-1.html',
          '/english/video/1/Synthetic-Speech-1-Renamed.html',
          '/english/audio/7/Synthetic-Audio.html',
          '/english/video/2/Synthetic-Speech-2.html',
          '/english/video/3/Synthetic-Speech-3.html',
          'https://www.youtube.com/english/video/8/x.html',
          '/urdu/video/9/Synthetic.html',
        ],
        [1, 2, 3],
      ),
    ),
    [`${ORIGIN}/english/Latest-Speeches/page/2/`]: htmlPage(
      grid(
        [
          '/english/video/4/Synthetic-Speech-4.html',
          '/english/video/5/Synthetic-Speech-5.html',
        ],
        [1, 2],
      ),
    ),
    ...extra,
  }).fetcher;
}

const item = (id: number) => ({
  externalKey: videoUrl(id),
  originalUrl: videoUrl(id),
  legacyIdentifier: `mtv-${id}`,
});

describe('identity and options', () => {
  it('declares what it is', () => {
    expect(adapter()).toMatchObject({
      adapterKey: MINHAJ_TV_VIDEO_ADAPTER_KEY,
      adapterVersion: '1',
      parserKey: 'cheerio-minhaj-tv-video',
      parserVersion: '1',
      contentKind: 'media.video',
      accessMethod: 'http',
    });
  });

  it('refuses an unsafe base URL, listing or selection', () => {
    for (const baseUrl of [
      'http://www.minhaj.tv/',
      'https://minhaj.tv/',
      'https://www.minhaj.tv/english/',
      'x',
    ])
      expect(() => adapter({ baseUrl })).toThrow();
    for (const listing of ['', 'a/b', '../urdu', 'Latest Speeches'])
      expect(() => adapter({ listing })).toThrow(/listing/);
    expect(() => adapter({ selection: { pages: 1, limit: 0 } })).toThrow(/selection/);
  });
});

describe('discovery', () => {
  it('queues only video cards of the main grid, deduplicated by id, robots honoured', async () => {
    const subject = adapter();
    const source = site();
    expect(await subject.discover(null, source)).toEqual({
      kind: 'page',
      // 1 (once, whatever its slug), 2; audio 7, robots-disallowed 3, the
      // off-host link, the /urdu link and the sidebar's 999 are never queued.
      items: [item(1), item(2)],
      next: '2:2',
    });
    expect(await subject.discover('2:2', source)).toEqual({
      kind: 'page',
      items: [item(4), item(5)],
      next: null,
    });
  });

  it('is stable across runs and honours the selection', async () => {
    const run = () =>
      adapter({ selection: { pages: 1, limit: 24 } }).discover(null, site());
    expect(await run()).toEqual(await run());
    expect(await run()).toMatchObject({ kind: 'page', next: null });
    expect(
      await adapter({ selection: { pages: 2, limit: 1 } }).discover(null, site()),
    ).toEqual({
      kind: 'page',
      items: [item(1)],
      next: null,
    });
    const three = adapter({ selection: { pages: 2, limit: 3 } });
    expect(await three.discover('2:2', site())).toEqual({
      kind: 'page',
      items: [item(4)],
      next: null,
    });
  });

  it('refuses a robots-disallowed listing', async () => {
    const result = await adapter({ listing: 'Blocked-Listing' }).discover(null, site());
    expect(result).toEqual({
      kind: 'outcome',
      outcome: {
        kind: 'refused',
        classification: 'scope-refused',
        requestedUrl: `${ORIGIN}/english/Blocked-Listing/`,
        detail: 'robots-disallowed',
      },
    });
  });

  it('refuses a listing of another kind (audio) rather than completing empty', async () => {
    const audio = grid(
      ['/english/audio/7/Synthetic-Audio.html'],
      [1, 2],
      'Audio-Speeches',
    );
    const result = await adapter({ listing: 'Audio-Speeches' }).discover(
      null,
      site({ [`${ORIGIN}/english/Audio-Speeches/`]: htmlPage(audio) }),
    );
    expect(result).toMatchObject({
      kind: 'outcome',
      outcome: {
        kind: 'refused',
        classification: 'unsupported-type',
        detail: 'index-unrecognised',
      },
    });
  });

  it('refuses a page whose every item robots disallows', async () => {
    const result = await adapter({ listing: 'English-Speeches' }).discover(
      null,
      site({
        [`${ORIGIN}/english/English-Speeches/`]: htmlPage(
          grid(['/english/video/3/x.html'], [], 'English-Speeches'),
        ),
      }),
    );
    expect(result).toMatchObject({
      kind: 'outcome',
      outcome: {
        kind: 'refused',
        classification: 'scope-refused',
        detail: 'robots-disallowed',
      },
    });
  });

  it('hands back a failed listing and refuses an unrecognised one', async () => {
    expect(
      await adapter().discover(
        null,
        site({ [`${ORIGIN}/english/Latest-Speeches/`]: htmlPage('', { status: 503 }) }),
      ),
    ).toMatchObject({ kind: 'outcome', outcome: { kind: 'response', status: 503 } });
    expect(
      await adapter().discover(
        null,
        site({
          [`${ORIGIN}/english/Latest-Speeches/`]: htmlPage(
            '<!doctype html><p>Synthetic redesign</p>',
          ),
        }),
      ),
    ).toMatchObject({ kind: 'outcome', outcome: { detail: 'index-unrecognised' } });
    await expect(adapter().discover('x', site())).rejects.toThrow(/cursor/);
  });
});

describe('retrieval', () => {
  it('returns a 200 and hands anything else back', async () => {
    const source = fakeSite({
      [videoUrl(1)]: htmlPage('<p>x</p>'),
      [videoUrl(2)]: htmlPage('', { status: 500 }),
    }).fetcher;
    expect(
      await adapter().retrieve(pendingItem(videoUrl(1), null), source),
    ).toMatchObject({
      kind: 'evidence',
      httpStatus: 200,
    });
    expect(
      await adapter().retrieve(pendingItem(videoUrl(2), null), source),
    ).toMatchObject({
      kind: 'outcome',
      outcome: { status: 500 },
    });
  });
});

/* ------------------------------------------------------------------ detail */

interface VideoPage {
  readonly title?: string;
  readonly embed?: string | null;
  readonly rows?: readonly string[];
}

const FOOTER_ID = 'SynthFootr1';
const DEFAULT_ROWS = [
  'Serial No: 12',
  'Speech No: Sy-01',
  'Duration: 77 Minutes',
  'Place: Synthetic Hall',
  'Dated: <a href="/english/Archive/2026-09/">September 20, 2026</a>',
  'Category: <a href="/english/English-Speeches/">English Speeches</a>',
  'Speech By: <a href="/english/Synthetic-Speaker/">Synthetic Speaker</a>',
];
const DESCRIPTION =
  '<p class="pf0"><span>Synthetic description, part one.</span></p>\n<p>Synthetic part <a href="/english/video/2/x.html">two</a>.</p>';

function videoPage(options: VideoPage = {}) {
  const embed =
    options.embed === undefined
      ? 'https://www.youtube.com/embed/SynthVid_01?rel=0'
      : options.embed;
  const rows = (options.rows ?? [...DEFAULT_ROWS, `Description: <br>${DESCRIPTION}\n`])
    .map(
      (row) => `\t<div class="col col_6_of_12"><i class="fa fa-play"></i> ${row}</div>`,
    )
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta property="og:locale" content="en_US"><meta itemprop="dateCreated" content="--"></head><body>
<div class="row"><div class="col-sm-8 main-content">
<div class="video-info small"><h1>${options.title ?? 'Synthetic Speech Title'}</h1><div style="clear:both;"></div><h2>(Synthetic subtitle)</h2></div>
<div class="video-gallery"><div class="tab-content" id="VideoTabsContent">
<div class="tab-pane active" id="youtube-tab">${embed === null ? '' : `<iframe class="embed-responsive-item" src="${embed}"></iframe>`}</div>
<div class="tab-pane" id="facebook-tab"><iframe src="https://www.minhaj.tv/facebook.php?video_id=1234567890"></iframe></div>
</div></div>
<div class="row video-options"><div class="fb-like" data-href="x"></div><div class="shareaholic-canvas"></div></div>
<div class="video-details">
<!--span class="date">Released on January 01, 1970</span-->
<div class="post-entry">
${rows}
</div></div></div></div>
<footer><p><iframe src="https://www.youtube.com/embed/${FOOTER_ID}?rel=0&amp;showinfo=0"></iframe></p></footer>
</body></html>`;
}

const PAGE_URL = videoUrl(1);

describe('parsing with Cheerio', () => {
  it('extracts every field of a video page', () => {
    expect(adapter().parse(evidenceOf(videoPage(), PAGE_URL))).toEqual({
      kind: 'parsed',
      record: {
        kind: 'media.video',
        title: 'Synthetic Speech Title',
        primaryLocale: 'en',
        languageCode: 'en',
        provider: 'youtube',
        providerReference: 'SynthVid_01',
        labels: [],
        descriptionHtml: DESCRIPTION,
        publishedOn: '2026-09-20',
        durationSeconds: 4620,
        legacyIdentifier: 'mtv-1',
        categories: [{ key: 'English-Speeches', label: 'English Speeches' }],
        links: [],
        assets: [],
      },
    });
  });

  it('never takes the footer embed as the video', () => {
    const result = adapter().parse(evidenceOf(videoPage({ embed: null }), PAGE_URL));
    expect(result).toMatchObject({
      kind: 'parsed',
      record: { provider: null, providerReference: null },
    });
    expect(JSON.stringify(result)).not.toContain(FOOTER_ID);
    // An embed that is not a YouTube id is no provider reference either.
    expect(
      adapter().parse(
        evidenceOf(videoPage({ embed: 'https://www.youtube.com/embed/short' }), PAGE_URL),
      ),
    ).toMatchObject({
      kind: 'parsed',
      record: { provider: null, providerReference: null },
    });
  });

  it('takes the language only from a language category, and the locale from the title script', () => {
    const rows = (category: string) => [
      'Dated: <a href="/english/Archive/2026-09/">September 2026</a>',
      category,
      'Description: <br>Synthetic',
    ];
    expect(
      adapter().parse(
        evidenceOf(
          videoPage({
            title: 'نمونہ خطاب',
            rows: rows('Category: <a href="/english/Urdu-Speeches/">Urdu</a>'),
          }),
          PAGE_URL,
        ),
      ),
    ).toMatchObject({
      kind: 'parsed',
      record: {
        primaryLocale: 'ur',
        languageCode: 'ur',
        publishedOn: null,
        durationSeconds: null,
      },
    });
    expect(
      adapter().parse(
        evidenceOf(
          videoPage({
            rows: rows('Category: <a href="/english/Synthetic-Topic/">Topic</a>'),
          }),
          PAGE_URL,
        ),
      ),
    ).toMatchObject({
      kind: 'parsed',
      record: { primaryLocale: 'en', languageCode: null },
    });
    // Subtitles say nothing about the speech's language.
    expect(
      adapter().parse(
        evidenceOf(
          videoPage({
            rows: rows('Category: <a href="/english/Arabic-Subtitles/">Subtitles</a>'),
          }),
          PAGE_URL,
        ),
      ),
    ).toMatchObject({ kind: 'parsed', record: { languageCode: null } });
    expect(
      adapter().parse(
        evidenceOf(
          videoPage({
            title: 'نمونہ خطاب',
            rows: rows('Category: <a href="/english/Synthetic-Topic/">Topic</a>'),
          }),
          PAGE_URL,
        ),
      ),
    ).toEqual({ kind: 'failed', detail: 'primary-locale-undetermined' });
    expect(
      adapter().parse(
        evidenceOf(
          videoPage({
            rows: rows(
              'Category: <a href="/english/English-Speeches/">E</a>, <a href="/english/Urdu-Speeches/">U</a>',
            ),
          }),
          PAGE_URL,
        ),
      ),
    ).toEqual({ kind: 'failed', detail: 'language-conflict' });
  });

  it('excludes audio and other pages', () => {
    expect(
      adapter().parse(
        evidenceOf(videoPage(), `${ORIGIN}/english/audio/7/Synthetic-Audio.html`),
      ),
    ).toEqual({ kind: 'excluded', reason: 'not-a-video' });
    expect(
      adapter().parse(evidenceOf(videoPage(), `${ORIGIN}/english/Latest-Speeches/`)),
    ).toEqual({
      kind: 'excluded',
      reason: 'not-a-video-page',
    });
  });

  it('fails a page whose structure is missing', () => {
    expect(adapter().parse(evidenceOf(videoPage({ title: ' ' }), PAGE_URL))).toEqual({
      kind: 'failed',
      detail: 'title-missing',
    });
    expect(adapter().parse(evidenceOf(videoPage({ rows: [] }), PAGE_URL))).toEqual({
      kind: 'failed',
      detail: 'record-structure-missing',
    });
  });

  it('fails a body that is not UTF-8 HTML', () => {
    for (const { body, contentType, detail } of UNDECODABLE)
      expect(adapter().parse({ body, contentType, finalUrl: PAGE_URL })).toEqual({
        kind: 'failed',
        detail,
      });
  });
});

describe('durations', () => {
  it('reads only explicit durations', () => {
    expect(durationSecondsOf('77 Minutes')).toBe(4620);
    expect(durationSecondsOf('1 min')).toBe(60);
    expect(durationSecondsOf('2 Hours 5 Minutes')).toBe(7500);
    expect(durationSecondsOf('1 hour')).toBe(3600);
    expect(durationSecondsOf('1:05:09')).toBe(3909);
    expect(durationSecondsOf('45:30')).toBe(2730);
    for (const text of ['', 'about an hour', '0 Minutes', '0:00', '1:75', 'Minutes 77'])
      expect(durationSecondsOf(text)).toBeNull();
  });
});
