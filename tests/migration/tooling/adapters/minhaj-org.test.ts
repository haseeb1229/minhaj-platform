import { describe, expect, it } from 'vitest';

import {
  createMinhajOrgEditorialAdapter,
  createMinhajOrgPageAdapter,
  createMinhajOrgPersonAdapter,
  MINHAJ_ORG_BASE_URL,
  MINHAJ_ORG_EDITORIAL_ADAPTER_KEY,
  MINHAJ_ORG_PAGE_ADAPTER_KEY,
  profileName,
  type MinhajOrgEditorialAdapterOptions,
} from '../../../../scripts/migration/adapters/minhaj-org.ts';

import {
  evidenceOf,
  fakeSite,
  htmlPage,
  pendingItem,
  textFile,
  UNDECODABLE,
  type FakeSite,
} from './fake-site.ts';

/**
 * The minhaj.org news/article adapter against SYNTHETIC pages built on the
 * site's template (main column, sidebar widgets, `article.post`, share and
 * comment chrome). No network; no real page's words.
 */

const ORIGIN = 'https://www.minhaj.org';

function adapter(overrides: Partial<MinhajOrgEditorialAdapterOptions> = {}) {
  return createMinhajOrgEditorialAdapter({
    baseUrl: MINHAJ_ORG_BASE_URL,
    selection: { pages: 2, limit: 10 },
    kind: 'editorial.news',
    section: 'News-Events',
    language: 'english',
    reservedTids: [],
    ...overrides,
  });
}

/* ---------------------------------------------------------------- listings */

function newsListing(
  cards: readonly string[],
  pageLinks: readonly number[],
  section = 'News-Events',
) {
  const pagination = pageLinks
    .map(
      (page) =>
        `<li><a class="page-numbers" href="/english/${section}/page/${page}/">${page}</a></li>`,
    )
    .join('');
  return `<!doctype html><html lang="en-US"><head><meta charset="utf-8"><title>Synthetic listing</title></head><body>
<header><div class="widget"><div class="tb_widget_recent_list">
<div class="layout_post_2"><div class="item_content"><h4><a href="/english/tid/900/Synthetic-Widget.html">Synthetic widget item</a></h4><span class="meta_date">March 2016</span></div></div>
</div></div></header>
<section><div class="container"><div class="row">
<div class="col col_6_of_12">
<h1 class="page_title">Synthetic all news</h1>
<div class="row"><div class="col col_12_of_12">
${cards
  .map(
    (href) => `<div class="layout_post_2 clearfix">
<div class="item_thumb"><div class="thumb_hover"><a href="${href}"><img src="https://minhaj.net/images-texts/synthetic.jpg" alt=""></a></div></div>
<div class="item_content"><h4><a href="${href}">Synthetic headline</a></h4><p><a href="${href}">Synthetic excerpt</a></p>
<div class="item_meta clearfix"><span class="meta_date">October 23, 2026</span></div></div></div>`,
  )
  .join('\n')}
</div></div>
<ul class="page-numbers">${pagination}</ul>
</div>
<div class="col col_3_of_12"><div class="widget"><div class="layout_post_2"><div class="item_content"><h4><a href="/english/tid/901/Synthetic-Sidebar.html">Synthetic sidebar</a></h4></div></div></div></div>
</div></div></section></body></html>`;
}

const PAGE_ONE_CARDS = [
  '/english/tid/101/Synthetic-Headline-One.html',
  '/english/General/tid/101/Synthetic-Headline-One-Again.html',
  '/english/tid/102/Synthetic-Headline-Two.html',
  'https://minhaj.net/english/tid/990/Off-Host.html',
  '/urdu/tid/991/',
  '/english/lkcatid/1/Synthetic-Category.html',
  `${ORIGIN}/english/UK/tid/103/Synthetic-Headline-Three.html#top`,
];
const PAGE_TWO_CARDS = [
  '/english/tid/104/Synthetic-Four.html',
  '/english/tid/105/Synthetic-Five.html',
];

type Route = Parameters<FakeSite['set']>[1];

function siteOf(extra: Record<string, Route> = {}): FakeSite {
  return fakeSite({
    [`${ORIGIN}/robots.txt`]: textFile('User-agent: *\nAllow: /\n'),
    [`${ORIGIN}/english/News-Events/`]: htmlPage(newsListing(PAGE_ONE_CARDS, [1, 2, 3])),
    [`${ORIGIN}/english/News-Events/page/2/`]: htmlPage(
      newsListing(PAGE_TWO_CARDS, [1, 2]),
    ),
    ...extra,
  });
}

const site = (extra: Record<string, Route> = {}) => siteOf(extra).fetcher;

const key = (tid: number, lang = 'english') => `${ORIGIN}/${lang}/tid/${tid}/`;

describe('identity and options', () => {
  it('declares what it is, per kind', () => {
    expect(adapter()).toMatchObject({
      adapterKey: MINHAJ_ORG_EDITORIAL_ADAPTER_KEY,
      adapterVersion: '4',
      parserKey: 'cheerio-minhaj-org-editorial',
      parserVersion: '3',
      contentKind: 'editorial.news',
      accessMethod: 'http',
    });
    expect(adapter({ kind: 'editorial.article', section: 'Articles' }).contentKind).toBe(
      'editorial.article',
    );
  });

  it('refuses an unsafe base URL, section, selection, language or kind', () => {
    for (const baseUrl of [
      'http://www.minhaj.org/',
      'https://minhaj.org/',
      'https://www.example.org/',
      'https://www.minhaj.org/english/',
      'https://www.minhaj.org/?a=1',
      'https://user:pw@www.minhaj.org/',
      'https://www.minhaj.org:8443/',
      'https://127.0.0.1/',
      'not a url',
    ])
      expect(() => adapter({ baseUrl })).toThrow();
    for (const section of ['', '../x', 'a/b', 'News Events', '-x'])
      expect(() => adapter({ section })).toThrow(/section/);
    for (const selection of [
      { pages: 0, limit: 1 },
      { pages: 1, limit: 0 },
      { pages: 1.5, limit: 2 },
      { pages: 1, limit: Number.NaN },
    ])
      expect(() => adapter({ selection })).toThrow(/selection/);
    expect(() => adapter({ language: 'french' as never })).toThrow(/language/);
    expect(() => adapter({ kind: 'media.video' as never })).toThrow(/kind/);
  });
});

describe('discovery', () => {
  it('walks the selected listing pages, main column only, keyed by tid', async () => {
    const source = siteOf();
    const subject = adapter();

    const first = await subject.discover(null, source.fetcher);
    expect(first).toEqual({
      kind: 'page',
      items: [
        { externalKey: key(101), originalUrl: key(101), legacyIdentifier: 'tid-101' },
        { externalKey: key(102), originalUrl: key(102), legacyIdentifier: 'tid-102' },
        { externalKey: key(103), originalUrl: key(103), legacyIdentifier: 'tid-103' },
      ],
      next: '2:3',
    });
    const second = await subject.discover('2:3', source.fetcher);
    expect(second).toEqual({
      kind: 'page',
      items: [
        { externalKey: key(104), originalUrl: key(104), legacyIdentifier: 'tid-104' },
        { externalKey: key(105), originalUrl: key(105), legacyIdentifier: 'tid-105' },
      ],
      next: null,
    });
    // robots.txt read once per adapter instance.
    expect(source.requested.filter((url) => url.endsWith('/robots.txt'))).toHaveLength(1);
    expect(source.requested).not.toContain(`${ORIGIN}/english/News-Events/page/3/`);
  });

  it('gives the same item the same key on every run and from a resumed cursor', async () => {
    const run = async () => {
      const subject = adapter();
      const first = await subject.discover(null, site());
      if (first.kind !== 'page' || first.next === null)
        throw new Error('expected two pages');
      // A fresh adapter instance resumes from the stored cursor alone.
      const resumed = await adapter().discover(first.next, site());
      if (resumed.kind !== 'page') throw new Error('expected a page');
      return [...first.items, ...resumed.items];
    };
    expect(await run()).toEqual(await run());
  });

  it('honours selection.pages and selection.limit', async () => {
    const onePage = await adapter({ selection: { pages: 1, limit: 10 } }).discover(
      null,
      site(),
    );
    expect(onePage).toMatchObject({ kind: 'page', next: null });

    const two = await adapter({ selection: { pages: 2, limit: 2 } }).discover(
      null,
      site(),
    );
    expect(two).toEqual({
      kind: 'page',
      items: [
        { externalKey: key(101), originalUrl: key(101), legacyIdentifier: 'tid-101' },
        { externalKey: key(102), originalUrl: key(102), legacyIdentifier: 'tid-102' },
      ],
      next: null,
    });

    const four = adapter({ selection: { pages: 2, limit: 4 } });
    const page1 = await four.discover(null, site());
    expect(page1).toMatchObject({ kind: 'page', next: '2:3' });
    const page2 = await four.discover('2:3', site());
    expect(page2).toEqual({
      kind: 'page',
      items: [
        { externalKey: key(104), originalUrl: key(104), legacyIdentifier: 'tid-104' },
      ],
      next: null,
    });
  });

  it('refuses a cursor it did not issue', async () => {
    for (const cursor of ['abc', '1:0', '3:0', '2:10', '2:-1', '02:1', '../2'])
      await expect(adapter().discover(cursor, site())).rejects.toThrow(/cursor/);
  });

  it('refuses a listing robots.txt disallows and never queues a disallowed item', async () => {
    const blocked = await adapter().discover(
      null,
      site({
        [`${ORIGIN}/robots.txt`]: textFile(
          'User-agent: *\nDisallow: /english/News-Events/\n',
        ),
      }),
    );
    expect(blocked).toEqual({
      kind: 'outcome',
      outcome: {
        kind: 'refused',
        classification: 'scope-refused',
        requestedUrl: `${ORIGIN}/english/News-Events/`,
        detail: 'robots-disallowed',
      },
    });

    const partial = await adapter().discover(
      null,
      site({
        [`${ORIGIN}/robots.txt`]: textFile(
          'User-agent: OneMinhajMigration\nDisallow: /english/tid/102/\n\nUser-agent: *\nAllow: /\n',
        ),
      }),
    );
    if (partial.kind !== 'page') throw new Error('expected a page');
    expect(partial.items.map((item) => item.legacyIdentifier)).toEqual([
      'tid-101',
      'tid-103',
    ]);
  });

  it('hands back an unreadable robots.txt and reads it again next time', async () => {
    const subject = adapter();
    const failing = await subject.discover(
      null,
      site({ [`${ORIGIN}/robots.txt`]: htmlPage('', { status: 503 }) }),
    );
    expect(failing).toMatchObject({
      kind: 'outcome',
      outcome: { kind: 'response', status: 503 },
    });

    const recovered = await subject.discover(null, site());
    expect(recovered).toMatchObject({ kind: 'page', next: '2:3' });
  });

  it('treats a missing robots.txt as no rules', async () => {
    const result = await adapter().discover(
      null,
      site({ [`${ORIGIN}/robots.txt`]: htmlPage('', { status: 404 }) }),
    );
    expect(result).toMatchObject({ kind: 'page' });
  });

  it('hands a failed listing fetch back as the outcome', async () => {
    const result = await adapter().discover(
      null,
      site({ [`${ORIGIN}/english/News-Events/`]: htmlPage('', { status: 429 }) }),
    );
    expect(result).toMatchObject({
      kind: 'outcome',
      outcome: { kind: 'response', status: 429 },
    });
  });

  it('refuses a listing it cannot recognise rather than reporting an empty, complete page', async () => {
    const unrecognised = {
      kind: 'outcome',
      outcome: {
        kind: 'refused',
        classification: 'unsupported-type',
        requestedUrl: `${ORIGIN}/english/News-Events/`,
        detail: 'index-unrecognised',
      },
    };
    for (const body of [
      '<!doctype html><title>Synthetic redesign</title><div>no listing</div>',
      newsListing([], [1, 2]),
      newsListing(
        ['https://minhaj.net/english/tid/1/', '/english/lkcatid/2/x.html'],
        [1, 2],
      ),
      // Pagination that skips page 2.
      newsListing(PAGE_ONE_CARDS, [1, 3]),
    ])
      expect(
        await adapter().discover(
          null,
          site({ [`${ORIGIN}/english/News-Events/`]: htmlPage(body) }),
        ),
      ).toEqual(unrecognised);
    expect(
      await adapter().discover(
        null,
        site({
          [`${ORIGIN}/english/News-Events/`]: htmlPage('{}', {
            contentType: 'application/json',
          }),
        }),
      ),
    ).toEqual(unrecognised);
  });

  it('reads the Articles listing layout', async () => {
    const articles = `<!doctype html><html><body><section><div class="row">
<div class="col col_6_of_12"><h1 class="page_title"><a href="/english/Articles/"> Articles </a></h1>
<div class="row"><div class="col col_12_of_12"><div class="widget">
<select class="select"><option value="/english/Articles/Synthetic-Author/">Synthetic Author</option></select>
<div class="tb_widget_articles clearfix"><ul>
<li><a href="/english/tid/201/Synthetic-Article-One.html">Synthetic article one</a>
<div class="item_meta clearfix"><span class="meta_author"><a href="/english/Articles/MISC/">MISC</a></span> <span class="meta_date">March 30, 2026</span></div></li>
<li><a href="/english/tid/202/Synthetic-Article-Two.html">Synthetic article two</a></li>
</ul></div></div></div></div>
<ul class="page-numbers"><li><span class="page-numbers current">1</span></li><li><a class="page-numbers" href="/english/Articles/page/2/">2</a></li><li><a class="page-nextback" href="/english/Articles/page/2/">Next</a></li></ul>
</div></div></section></body></html>`;
    const result = await adapter({
      kind: 'editorial.article',
      section: 'Articles',
    }).discover(
      null,
      fakeSite({ [`${ORIGIN}/english/Articles/`]: htmlPage(articles) }).fetcher,
    );
    expect(result).toEqual({
      kind: 'page',
      items: [
        { externalKey: key(201), originalUrl: key(201), legacyIdentifier: 'tid-201' },
        { externalKey: key(202), originalUrl: key(202), legacyIdentifier: 'tid-202' },
      ],
      next: '2:2',
    });
  });

  it('reads the Press-Release listing layout and its named page links', async () => {
    const releases = `<!doctype html><html><body><section><div class="row">
<div class="col col_6_of_12"><h1 class="page_title">Press Release</h1>
<div class="row"><div class="col col_12_of_12"><div class="tb_widget_recent_listpr clearfix">
<div class="item clearfix"><div class="item_content"><h4><a href="/english/tid/301/Synthetic-Release-One.html">Synthetic release one</a></h4></div></div>
<div class="item clearfix"><div class="item_content"><h4><a href="/english/tid/302/Synthetic-Release-Two.html">Synthetic release two</a></h4></div></div>
</div></div></div>
<ul class="page-numbers"><li><span class="page-numbers current">1</span></li><li><a class="page-numbers" href="/english/Press-Release/page/2/Press-Release-Minhaj-ul-Quran-Intenational.html">2</a></li></ul>
</div>
<div class="col col_3_of_12"><div class="tb_widget_recent_listpr"><div class="item_content"><h4><a href="/english/tid/909/Synthetic-Sidebar-Release.html">Sidebar</a></h4></div></div></div>
</div></section></body></html>`;
    const result = await adapter({
      kind: 'editorial.press-release',
      section: 'Press-Release',
    }).discover(
      null,
      fakeSite({ [`${ORIGIN}/english/Press-Release/`]: htmlPage(releases) }).fetcher,
    );
    expect(result).toEqual({
      kind: 'page',
      items: [
        { externalKey: key(301), originalUrl: key(301), legacyIdentifier: 'tid-301' },
        { externalKey: key(302), originalUrl: key(302), legacyIdentifier: 'tid-302' },
      ],
      next: '2:2',
    });
  });

  it('never takes a tid another source owns, so one address maps to one record', async () => {
    const listing = newsListing(
      ['/english/tid/501/Synthetic-Owned.html', '/english/tid/502/Synthetic-Free.html'],
      [],
    );
    const result = await adapter({ reservedTids: ['501'] }).discover(
      null,
      fakeSite({ [`${ORIGIN}/english/News-Events/`]: htmlPage(listing) }).fetcher,
    );
    expect(result).toEqual({
      kind: 'page',
      items: [
        { externalKey: key(502), originalUrl: key(502), legacyIdentifier: 'tid-502' },
      ],
      next: null,
    });
    // A listing whose every item another source owns is not this listing.
    expect(
      await adapter({ reservedTids: ['501', '502'] }).discover(
        null,
        fakeSite({ [`${ORIGIN}/english/News-Events/`]: htmlPage(listing) }).fetcher,
      ),
    ).toMatchObject({ kind: 'outcome' });
  });

  it('keys a link under an empty category segment by its tid, like any other (Phase 30-RF)', async () => {
    const listing = newsListing(
      ['/english//tid/601/Synthetic-Uncategorised.html', '/english/tid/601/Again.html'],
      [],
    );
    const result = await adapter().discover(
      null,
      fakeSite({ [`${ORIGIN}/english/News-Events/`]: htmlPage(listing) }).fetcher,
    );
    expect(result).toEqual({
      kind: 'page',
      items: [
        { externalKey: key(601), originalUrl: key(601), legacyIdentifier: 'tid-601' },
      ],
      next: null,
    });
  });

  it('still reads the links of a listing whose excerpt the source cut mid-character', async () => {
    const listing = new TextEncoder().encode(
      newsListing(['/english/tid/401/Synthetic-Cut.html'], []),
    );
    // The first two bytes of a three-byte character, then markup again.
    const cut = new Uint8Array([0x62, 0xe1, 0xb9, 0x2e, 0x2e, 0x2e]);
    const at = new TextDecoder().decode(listing).indexOf('Synthetic excerpt');
    const body = new Uint8Array([...listing.slice(0, at), ...cut, ...listing.slice(at)]);
    const page = (url: string) => ({
      ...htmlPage('')(url),
      body,
    });
    const result = await adapter().discover(
      null,
      fakeSite({ [`${ORIGIN}/english/News-Events/`]: page }).fetcher,
    );
    expect(result).toEqual({
      kind: 'page',
      items: [
        { externalKey: key(401), originalUrl: key(401), legacyIdentifier: 'tid-401' },
      ],
      next: null,
    });
  });

  it('keys an Urdu section by its own language', async () => {
    const urdu = newsListing(
      ['/urdu/tid/301/', '/english/tid/302/x.html'],
      [],
    ).replaceAll('/english/News-Events/', '/urdu/News-Events/');
    const result = await adapter({ language: 'urdu' }).discover(
      null,
      fakeSite({ [`${ORIGIN}/urdu/News-Events/`]: htmlPage(urdu) }).fetcher,
    );
    expect(result).toEqual({
      kind: 'page',
      items: [
        {
          externalKey: key(301, 'urdu'),
          originalUrl: key(301, 'urdu'),
          legacyIdentifier: 'tid-301',
        },
      ],
      next: null,
    });
  });
});

describe('retrieval', () => {
  it('returns the bytes of a 200 and hands anything else back', async () => {
    const source = fakeSite({
      [key(101)]: htmlPage('<p>x</p>', {
        finalUrl: `${ORIGIN}/english/General/tid/101/x.html`,
      }),
      [key(102)]: htmlPage('', { status: 429, retryAfter: '9' }),
    }).fetcher;
    expect(await adapter().retrieve(pendingItem(key(101), null), source)).toMatchObject({
      kind: 'evidence',
      requestedUrl: key(101),
      finalUrl: `${ORIGIN}/english/General/tid/101/x.html`,
      httpStatus: 200,
    });
    expect(await adapter().retrieve(pendingItem(key(102), null), source)).toMatchObject({
      kind: 'outcome',
      outcome: { kind: 'response', status: 429, retryAfter: '9' },
    });
    expect(await adapter().retrieve(pendingItem(key(103), null), source)).toMatchObject({
      kind: 'outcome',
      outcome: { kind: 'response', status: 404 },
    });
  });
});

/* ------------------------------------------------------------------ detail */

interface DetailOptions {
  readonly ogLocale?: string | null;
  readonly dateCreated?: string | null;
  readonly dated?: string;
  readonly title?: string;
  readonly body?: string;
  readonly article?: boolean;
  readonly copyright?: string;
}

const ENGLISH_BODY = `<p style="text-align:center;">
<img src="https://minhaj.net/images-db10/2026/synthetic-0.jpg" alt="Synthetic image"></p>

<p>Synthetic paragraph one.</p>
<p>Synthetic paragraph two <span class="fb-share-button" data-href="https://www.minhaj.org/x"></span>ends.</p>`;

function detail(options: DetailOptions = {}) {
  const ogLocale = options.ogLocale === undefined ? 'en_US' : options.ogLocale;
  const dateCreated =
    options.dateCreated === undefined ? '2026-10-23' : options.dateCreated;
  const meta = [
    ogLocale === null ? '' : `<meta property="og:locale" content="${ogLocale}">`,
    dateCreated === null ? '' : `<meta itemprop="dateCreated" content="${dateCreated}">`,
    options.copyright === undefined
      ? ''
      : `<meta name="copyright" content="${options.copyright}">`,
  ].join('\n');
  const article =
    options.article === false
      ? ''
      : `<article class="post">
<!-- Entry content -->
<div class="entry_content">
<!-- Entry title -->
<h1 class="entry_title">${options.title ?? 'Synthetic headline one'}</h1>
<!-- End Entry title -->
<div class="meta_date">Dated: <a title="Synthetic" href="/english/Archive/2026-10-23/">${options.dated ?? '23 October 2026'}</a></div><!--div style=" float:left;">
<div class="fb-like" data-href="https://www.facebook.com/synthetic" data-layout="button_count"></div>
</div>
<!--div style="clear:both;"></div-->
<div class="shareaholic-canvas" data-app="share_buttons" data-app-id="1"></div>

${options.body ?? ENGLISH_BODY}
</div>
<!-- End Entry content -->
</article>`;
  return `<!doctype html><html lang="en-US" itemscope itemtype="http://schema.org/NewsArticle"><head>
<meta charset="utf-8">
${meta}
<title>Synthetic</title></head><body>
<header><div class="widget"><span class="meta_date">March 2016</span></div></header>
<section><div class="container"><div class="row"><div class="col col_9_of_12">
${article}
<div id="comments"><div><h4>Comments</h4></div><div class="fb-comments" data-href="https://www.minhaj.org/x"></div></div>
</div></div></div></section></body></html>`;
}

const ENGLISH_URL = `${ORIGIN}/english/General/tid/101/Synthetic-Headline-One.html`;

describe('parsing with Cheerio', () => {
  it('extracts every field, the body as exact source less the chrome', () => {
    expect(adapter().parse(evidenceOf(detail(), ENGLISH_URL))).toEqual({
      kind: 'parsed',
      record: {
        kind: 'editorial.news',
        title: 'Synthetic headline one',
        primaryLocale: 'en',
        languageCode: 'en',
        publishedOn: '2026-10-23',
        legacyIdentifier: 'tid-101',
        categories: [{ key: 'News-Events', label: 'News-Events' }],
        links: [],
        // The first picture is first-party: the record's lead image, acquired —
        // with rights UNKNOWN, as this page states no notice — and out of the body.
        assets: [
          {
            url: 'https://minhaj.net/images-db10/2026/synthetic-0.jpg',
            licence: 'unknown',
            licenceEvidence: null,
            rightsHolder: null,
          },
        ],
        excerptHtml: null,
        bodyHtml: `<p style="text-align:center;">
</p>

<p>Synthetic paragraph one.</p>
<p>Synthetic paragraph two ends.</p>`,
        leadImage: {
          url: 'https://minhaj.net/images-db10/2026/synthetic-0.jpg',
          alt: 'Synthetic image',
          credit: null,
        },
      },
    });
  });

  it('records the page notice as the lead image rights evidence', () => {
    const result = adapter().parse(
      evidenceOf(
        detail({ copyright: 'Minhaj-ul-Quran International. 2026' }),
        ENGLISH_URL,
      ),
    );
    if (result.kind !== 'parsed') throw new Error('expected a record');
    expect(result.record.assets).toEqual([
      {
        url: 'https://minhaj.net/images-db10/2026/synthetic-0.jpg',
        licence: 'organisation-owned',
        licenceEvidence:
          'The official page presents this image as part of the record, served by minhaj.net; the page states "Minhaj-ul-Quran International. 2026".',
        rightsHolder: 'Minhaj-ul-Quran International',
      },
    ]);
  });

  it('takes no lead image from another host, a non-raster file or plain http', () => {
    for (const src of [
      'https://cdn.example.org/images/synthetic.jpg',
      'https://minhaj.net/images-db10/2026/synthetic.webp',
      'https://minhaj.net/images-db10/2026/synthetic.svg',
      'http://minhaj.net/images-db10/2026/synthetic.jpg',
      'https://user:secret@minhaj.net/images-db10/2026/synthetic.jpg',
    ]) {
      const result = adapter().parse(
        evidenceOf(
          detail({ body: `<p><img src="${src}" alt="x"></p><p>Synthetic words.</p>` }),
          ENGLISH_URL,
        ),
      );
      if (result.kind !== 'parsed' || result.record.kind !== 'editorial.news')
        throw new Error('expected a record');
      expect(result.record.leadImage).toBeNull();
      expect(result.record.assets).toEqual([]);
      // The picture leaves the body either way: the body shows none.
      expect(result.record.bodyHtml).not.toContain('<img');
    }
  });

  it('resolves a site-relative picture against the page and skips one inside chrome', () => {
    const relative = adapter().parse(
      evidenceOf(
        detail({
          body: '<p><img src="/images/synthetic-banner.png" alt="Banner"></p><p>Words.</p>',
        }),
        ENGLISH_URL,
      ),
    );
    if (relative.kind !== 'parsed' || relative.record.kind !== 'editorial.news')
      throw new Error('expected a record');
    expect(relative.record.leadImage?.url).toBe(
      'https://www.minhaj.org/images/synthetic-banner.png',
    );
    const chrome = adapter().parse(
      evidenceOf(
        detail({
          body: '<div class="shareaholic-canvas"><img src="https://minhaj.net/share.png" alt=""></div><p>Words.</p>',
        }),
        ENGLISH_URL,
      ),
    );
    if (chrome.kind !== 'parsed' || chrome.record.kind !== 'editorial.news')
      throw new Error('expected a record');
    expect(chrome.record.leadImage).toBeNull();
  });

  it('reads a press release with the same template', () => {
    const result = adapter({
      kind: 'editorial.press-release',
      section: 'Press-Release',
    }).parse(evidenceOf(detail(), ENGLISH_URL));
    expect(result).toMatchObject({
      kind: 'parsed',
      record: {
        kind: 'editorial.press-release',
        categories: [{ key: 'Press-Release', label: 'Press-Release' }],
      },
    });
  });

  it('never carries the share, like or comment chrome into the body', () => {
    const result = adapter().parse(evidenceOf(detail(), ENGLISH_URL));
    if (result.kind !== 'parsed' || !('bodyHtml' in result.record))
      throw new Error('expected an editorial record');
    for (const chrome of [
      'fb-like',
      'fb-share',
      'fb-comments',
      'shareaholic',
      'entry_title',
      'meta_date',
      '<!--',
      'Comments',
    ])
      expect(result.record.bodyHtml).not.toContain(chrome);
  });

  it('reads an article page as the article kind', () => {
    const result = adapter({ kind: 'editorial.article', section: 'Articles' }).parse(
      evidenceOf(detail(), ENGLISH_URL),
    );
    expect(result).toMatchObject({
      kind: 'parsed',
      record: {
        kind: 'editorial.article',
        categories: [{ key: 'Articles', label: 'Articles' }],
      },
    });
  });

  it('passes hostile markup through exactly — sanitising is normalisation’s job', () => {
    const hostile =
      '<p onclick="alert(1)">Synthetic <script>alert(2)</script><a href="javascript:void(0)">x</a></p>';
    const result = adapter().parse(evidenceOf(detail({ body: hostile }), ENGLISH_URL));
    expect(result).toMatchObject({ kind: 'parsed', record: { bodyHtml: hostile } });
  });

  it('reads an Urdu page: language from the URL, date from the Urdu month name', () => {
    const page = detail({
      ogLocale: 'ur_PK',
      dateCreated: null,
      dated: '31 دسمبر 2025ء',
      title: 'نمونہ سرخی',
      body: '<h3 align="center">نمونہ ذیلی سرخی</h3>\n<p>نمونہ متن</p>',
    }).replace('Dated:', 'مورخہ:');
    const result = adapter({ language: 'urdu' }).parse(
      evidenceOf(page, `${ORIGIN}/urdu/tid/301/`),
    );
    expect(result).toMatchObject({
      kind: 'parsed',
      record: {
        title: 'نمونہ سرخی',
        primaryLocale: 'ur',
        languageCode: 'ur',
        publishedOn: '2025-12-31',
        legacyIdentifier: 'tid-301',
        bodyHtml: '<h3 align="center">نمونہ ذیلی سرخی</h3>\n<p>نمونہ متن</p>',
      },
    });
  });

  it('reads an Arabic page, whose template prints og:locale ur_PK, with an Arabic month name', () => {
    const page = detail({
      ogLocale: 'ur_PK',
      dateCreated: null,
      dated: '25 يناير 2026ء',
      title: 'عنوان تجريبي',
    });
    const result = adapter({ language: 'arabic' }).parse(
      evidenceOf(page, `${ORIGIN}/arabic/tid/401/`),
    );
    expect(result).toMatchObject({
      kind: 'parsed',
      record: { primaryLocale: 'ar', languageCode: 'ar', publishedOn: '2026-01-25' },
    });
  });

  it('fails a page whose og:locale contradicts its URL section', () => {
    expect(
      adapter().parse(evidenceOf(detail({ ogLocale: 'ur_PK' }), ENGLISH_URL)),
    ).toEqual({
      kind: 'failed',
      detail: 'language-conflict',
    });
    expect(
      adapter({ language: 'arabic' }).parse(
        evidenceOf(detail({ ogLocale: 'en_US' }), `${ORIGIN}/arabic/tid/401/`),
      ),
    ).toEqual({ kind: 'failed', detail: 'language-conflict' });
    // A page of another section than the adapter's.
    expect(
      adapter().parse(
        evidenceOf(detail({ ogLocale: 'ur_PK' }), `${ORIGIN}/urdu/tid/301/`),
      ),
    ).toEqual({ kind: 'failed', detail: 'language-conflict' });
  });

  it('accepts a page with no og:locale on its URL section alone', () => {
    expect(
      adapter().parse(evidenceOf(detail({ ogLocale: null }), ENGLISH_URL)),
    ).toMatchObject({
      kind: 'parsed',
      record: { languageCode: 'en' },
    });
  });

  it('dates deterministically, never by guess', () => {
    const date = (dateCreated: string | null, dated: string) => {
      const result = adapter().parse(
        evidenceOf(detail({ dateCreated, dated }), ENGLISH_URL),
      );
      return result.kind === 'parsed' ? result.record.publishedOn : 'not parsed';
    };
    expect(date('2026-10-23', 'nonsense')).toBe('2026-10-23');
    expect(date('--', '04 March 2026')).toBe('2026-03-04');
    expect(date(null, 'March 4, 2026')).toBe('2026-03-04');
    expect(date(null, 'March 2026')).toBeNull();
    expect(date(null, '31 February 2026')).toBeNull();
    expect(date('2026-02-31', 'Synthetic')).toBeNull();
  });

  it('excludes pages that are not editorial posts', () => {
    expect(
      adapter().parse(evidenceOf(detail(), `${ORIGIN}/english/News-Events/`)),
    ).toEqual({
      kind: 'excluded',
      reason: 'not-a-tid-page',
    });
    const listingAtTid = newsListing(PAGE_ONE_CARDS, []);
    expect(adapter().parse(evidenceOf(listingAtTid, ENGLISH_URL))).toEqual({
      kind: 'excluded',
      reason: 'not-an-editorial-post',
    });
  });

  it('fails a page whose structure is missing', () => {
    expect(
      adapter().parse(
        evidenceOf('<!doctype html><title>x</title><p>Synthetic</p>', ENGLISH_URL),
      ),
    ).toEqual({ kind: 'failed', detail: 'record-structure-missing' });
    expect(adapter().parse(evidenceOf(detail({ title: '  ' }), ENGLISH_URL))).toEqual({
      kind: 'failed',
      detail: 'title-missing',
    });
    expect(
      adapter().parse(evidenceOf(detail({ body: '<!-- nothing -->' }), ENGLISH_URL)),
    ).toEqual({
      kind: 'failed',
      detail: 'body-missing',
    });
    expect(adapter().parse(evidenceOf(detail(), 'not a url'))).toEqual({
      kind: 'failed',
      detail: 'final-url-invalid',
    });
  });

  it('fails a body that is not UTF-8 HTML', () => {
    for (const { body, contentType, detail: code } of UNDECODABLE)
      expect(adapter().parse({ body, contentType, finalUrl: ENGLISH_URL })).toEqual({
        kind: 'failed',
        detail: code,
      });
  });
});

/* ------------------------------------------- organisational pages (30-R) */

const BINDINGS = Object.freeze({
  '101': '/explore/about/introduction',
  '102': '/explore/organization/forums',
});

function pageAdapter(items: readonly string[] = []) {
  return createMinhajOrgPageAdapter({
    baseUrl: MINHAJ_ORG_BASE_URL,
    selection: { pages: 1, limit: 10 },
    items,
    language: 'english',
    bindings: BINDINGS,
  });
}

describe('organisational pages', () => {
  it('declares what it is and refuses two pages sharing one binding', () => {
    expect(pageAdapter()).toMatchObject({
      adapterKey: MINHAJ_ORG_PAGE_ADAPTER_KEY,
      contentKind: 'editorial.page',
      accessMethod: 'http',
    });
    expect(() =>
      createMinhajOrgPageAdapter({
        baseUrl: MINHAJ_ORG_BASE_URL,
        selection: { pages: 1, limit: 10 },
        items: [],
        language: 'english',
        bindings: { '1': '/explore/about/history', '2': '/explore/about/history' },
      }),
    ).toThrow();
    // An operator item outside the catalogue is refused, never read.
    expect(() => pageAdapter(['999'])).toThrow();
  });

  it('discovers exactly the catalogued tids, narrowed by --items', async () => {
    const all = await pageAdapter().discover(null, site());
    expect(all).toMatchObject({
      kind: 'page',
      next: null,
      items: [
        { externalKey: key(101), legacyIdentifier: 'tid-101' },
        { externalKey: key(102), legacyIdentifier: 'tid-102' },
      ],
    });
    const one = await pageAdapter(['102']).discover(null, site());
    expect(one.kind === 'page' && one.items.map((item) => item.externalKey)).toEqual([
      key(102),
    ]);
  });

  it('binds the page to its catalogued route, with its lead image', () => {
    const result = pageAdapter().parse(evidenceOf(detail(), ENGLISH_URL));
    expect(result).toMatchObject({
      kind: 'parsed',
      record: {
        kind: 'editorial.page',
        binding: '/explore/about/introduction',
        title: 'Synthetic headline one',
        languageCode: 'en',
        legacyIdentifier: 'tid-101',
        leadImage: { url: 'https://minhaj.net/images-db10/2026/synthetic-0.jpg' },
      },
    });
    // A tid the catalogue does not name is not a page of this source.
    const other = `${ORIGIN}/english/tid/555/Synthetic-Other.html`;
    expect(pageAdapter().parse(evidenceOf(detail(), other))).toEqual({
      kind: 'excluded',
      reason: 'not-catalogued',
    });
  });

  it('reads a page the site files under no category, at /{lang}//tid/{n}/ (Phase 30-RF)', () => {
    // The site redirects an uncategorised page to an empty category segment;
    // that answer IS the page, read like any other.
    const result = pageAdapter().parse(
      evidenceOf(detail(), `${ORIGIN}/english//tid/101/Synthetic-Headline-One.html`),
    );
    expect(result).toMatchObject({
      kind: 'parsed',
      record: { binding: '/explore/about/introduction', legacyIdentifier: 'tid-101' },
    });
    // Still one section, one number: two empty segments or another language are not.
    for (const path of ['/english///tid/101/x.html', '/french//tid/101/x.html'])
      expect(pageAdapter().parse(evidenceOf(detail(), `${ORIGIN}${path}`))).toEqual({
        kind: 'excluded',
        reason: 'not-a-tid-page',
      });
    expect(
      pageAdapter().parse(evidenceOf(detail(), `${ORIGIN}/urdu//tid/101/x.html`)),
    ).toEqual({ kind: 'failed', detail: 'language-conflict' });
  });
});

/* ------------------------------------------------ public profiles (30-R) */

describe('public profiles', () => {
  const personAdapter = () =>
    createMinhajOrgPersonAdapter({
      baseUrl: MINHAJ_ORG_BASE_URL,
      selection: { pages: 1, limit: 10 },
      items: [],
      language: 'english',
      tids: ['101'],
    });

  it('names the person exactly as the profile title states them', () => {
    expect(profileName('A Profile of Synthetic Person Qadri')).toBe(
      'Synthetic Person Qadri',
    );
    expect(profileName('a profile OF Synthetic Person')).toBe('Synthetic Person');
    expect(profileName('Synthetic Person profile')).toBe('Synthetic Person');
    expect(profileName('Synthetic Person - Profile')).toBe('Synthetic Person');
    expect(profileName('Synthetic Person')).toBe('Synthetic Person');
  });

  it('reads the name, the biography markup and the portrait', () => {
    const result = personAdapter().parse(
      evidenceOf(detail({ title: 'A Profile of Synthetic Person' }), ENGLISH_URL),
    );
    expect(result).toMatchObject({
      kind: 'parsed',
      record: {
        kind: 'people.person',
        name: 'Synthetic Person',
        title: 'A Profile of Synthetic Person',
        legacyIdentifier: 'tid-101',
        portrait: {
          url: 'https://minhaj.net/images-db10/2026/synthetic-0.jpg',
          alt: 'Synthetic image',
        },
      },
    });
    if (result.kind !== 'parsed' || result.record.kind !== 'people.person')
      throw new Error('expected a person');
    expect(result.record.biographyHtml).toContain('Synthetic paragraph one.');
    expect(result.record.biographyHtml).not.toContain('<img');
  });
});
