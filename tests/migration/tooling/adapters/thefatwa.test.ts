import { describe, expect, it } from 'vitest';

import {
  createTheFatwaAdapter,
  THEFATWA_ADAPTER_KEY,
  THEFATWA_BASE_URL,
  type TheFatwaAdapterOptions,
} from '../../../../scripts/migration/adapters/thefatwa.ts';

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
 * The thefatwa.com adapter against SYNTHETIC pages built on the site's
 * template. The structural Urdu labels (سوال نمبر, سائل, مقام, تاریخ اشاعت,
 * زمرہ, جواب, مفتی) are the template's; every other word is synthetic.
 *
 * THE ASKER. Every real ruling page names its asker and their town. Here the
 * asker block carries synthetic sentinels, and the suite proves they reach no
 * parsed field, wherever the template puts the block.
 */

const ORIGIN = 'https://thefatwa.com';
const ASKER_NAME = 'SENTINEL-ASKER-NAME-7f3a';
const ASKER_CITY = 'SENTINEL-ASKER-CITY-9c1e';

function adapter(overrides: Partial<TheFatwaAdapterOptions> = {}) {
  return createTheFatwaAdapter({
    baseUrl: THEFATWA_BASE_URL,
    selection: { pages: 2, limit: 10 },
    listing: 'latest',
    ...overrides,
  });
}

const key = (id: number) => `${ORIGIN}/urdu/questionID/${id}/`;
const item = (id: number) => ({
  externalKey: key(id),
  originalUrl: key(id),
  legacyIdentifier: `q-${id}`,
});

/* ---------------------------------------------------------------- listings */

function listing(
  ids: readonly (number | string)[],
  current: number,
  pages: readonly number[],
  name = 'latest',
) {
  const cards = ids
    .map((id) => {
      const href =
        typeof id === 'string' ? id : `/urdu/questionID/${id}/نمونہ-سوال-${id}/`;
      return `<li><div class="listWrpService featured-wrap"><div class="row"><div class="col-md-10">
  <h3><a href="${href}">${String(id)} - Synthetic question title</a></h3>
  <!--p class="para">Synthetic excerpt</p-->
  </div><div class="col-md-2"><div class="click-btn"><a href="${href}">مزید</a></div></div></div></div></li>`;
    })
    .join('\n');
  const pagination = pages
    .map((page) =>
      page === current
        ? `<li class="active"><a href="#">${page}</a></li>`
        : `<li><a href="/urdu/${name}/page/${page}">${page}</a></li>`,
    )
    .join('');
  return `<!doctype html><html lang="en"><body>
<form><select id="cat"><option value="1">Synthetic category</option></select></form>
<ul class="listService">
${cards}
</ul>
<ul class="pagination">${pagination}</ul>
<div class="leftSidebar"><ul class="papu-post"><li><a href="/urdu/questionID/77/">Synthetic related</a></li></ul></div>
</body></html>`;
}

function siteOf(extra: Record<string, Route> = {}): FakeSite {
  return fakeSite({
    [`${ORIGIN}/urdu/latest/`]: htmlPage(
      listing(
        [
          501,
          502,
          501,
          `${ORIGIN}/urdu/questionID/503/x/`,
          'https://www.thefatwa.com/urdu/questionID/504/',
          '/urdu/cat/5/',
        ],
        1,
        [1, 2, 3],
      ),
    ),
    [`${ORIGIN}/urdu/latest/page/2`]: htmlPage(listing([505, 506], 2, [1, 2])),
    ...extra,
  });
}

const site = (extra: Record<string, Route> = {}) => siteOf(extra).fetcher;

describe('identity and options', () => {
  it('declares what it is', () => {
    expect(adapter()).toMatchObject({
      adapterKey: THEFATWA_ADAPTER_KEY,
      adapterVersion: '1',
      parserKey: 'cheerio-thefatwa-ruling',
      parserVersion: '1',
      contentKind: 'fatwa.ruling',
      accessMethod: 'http',
    });
  });

  it('refuses an unsafe base URL, an unknown listing or a bad selection', () => {
    for (const baseUrl of [
      'http://thefatwa.com/',
      'https://www.thefatwa.com/',
      'https://thefatwa.com/urdu/',
      'https://thefatwa.com/#x',
    ])
      expect(() => adapter({ baseUrl })).toThrow();
    for (const listingName of ['trend', 'ask-scholar', '../latest'])
      expect(() => adapter({ listing: listingName as never })).toThrow(/listing/);
    expect(() => adapter({ selection: { pages: 0, limit: 5 } })).toThrow(/selection/);
  });
});

describe('discovery', () => {
  it('walks the listing pages, own host only, deduplicated, keyed by question id', async () => {
    const subject = adapter();
    const source = siteOf();
    // www.thefatwa.com is another host: its link is not queued.
    expect(await subject.discover(null, source.fetcher)).toEqual({
      kind: 'page',
      items: [item(501), item(502), item(503)],
      next: '2:3',
    });
    expect(await subject.discover('2:3', source.fetcher)).toEqual({
      kind: 'page',
      items: [item(505), item(506)],
      next: null,
    });
    expect(source.requested).toEqual([
      `${ORIGIN}/robots.txt`,
      `${ORIGIN}/urdu/latest/`,
      `${ORIGIN}/urdu/latest/page/2`,
    ]);
  });

  it('honours the selection and resumes from the cursor alone', async () => {
    expect(
      await adapter({ selection: { pages: 1, limit: 50 } }).discover(null, site()),
    ).toMatchObject({
      kind: 'page',
      next: null,
    });
    expect(
      await adapter({ selection: { pages: 2, limit: 2 } }).discover(null, site()),
    ).toEqual({
      kind: 'page',
      items: [item(501), item(502)],
      next: null,
    });
    expect(
      await adapter({ selection: { pages: 2, limit: 4 } }).discover('2:3', site()),
    ).toEqual({
      kind: 'page',
      items: [item(505)],
      next: null,
    });
  });

  it('reads the ImportantQuestions listing the same way', async () => {
    const result = await adapter({ listing: 'ImportantQuestions' }).discover(
      null,
      fakeSite({
        [`${ORIGIN}/urdu/ImportantQuestions/`]: htmlPage(
          listing([601], 1, [1], 'ImportantQuestions'),
        ),
      }).fetcher,
    );
    expect(result).toEqual({ kind: 'page', items: [item(601)], next: null });
  });

  it('honours robots.txt', async () => {
    const blocked = await adapter().discover(
      null,
      site({
        [`${ORIGIN}/robots.txt`]: textFile('User-agent: *\nDisallow: /urdu/latest/\n'),
      }),
    );
    expect(blocked).toMatchObject({
      kind: 'outcome',
      outcome: {
        kind: 'refused',
        classification: 'scope-refused',
        detail: 'robots-disallowed',
      },
    });
    const partial = await adapter().discover(
      null,
      site({
        [`${ORIGIN}/robots.txt`]: textFile(
          'User-agent: *\nDisallow: /urdu/questionID/502/\n',
        ),
      }),
    );
    expect(partial).toMatchObject({ kind: 'page', items: [item(501), item(503)] });
  });

  it('refuses an unrecognised listing and hands back a failed one', async () => {
    for (const body of [
      '<!doctype html><p>Synthetic redesign</p>',
      listing([], 1, [1, 2]),
      listing(['/urdu/cat/5/'], 1, [1]),
    ])
      expect(
        await adapter().discover(
          null,
          site({ [`${ORIGIN}/urdu/latest/`]: htmlPage(body) }),
        ),
      ).toMatchObject({
        kind: 'outcome',
        outcome: {
          kind: 'refused',
          classification: 'unsupported-type',
          detail: 'index-unrecognised',
        },
      });
    expect(
      await adapter().discover(
        null,
        site({ [`${ORIGIN}/urdu/latest/`]: htmlPage('', { status: 502 }) }),
      ),
    ).toMatchObject({ kind: 'outcome', outcome: { kind: 'response', status: 502 } });
  });
});

describe('retrieval', () => {
  it('returns a 200 and hands anything else back', async () => {
    const source = fakeSite({ [key(501)]: htmlPage('<p>x</p>') }).fetcher;
    expect(await adapter().retrieve(pendingItem(key(501), null), source)).toMatchObject({
      kind: 'evidence',
      httpStatus: 200,
    });
    expect(await adapter().retrieve(pendingItem(key(502), null), source)).toMatchObject({
      kind: 'outcome',
      outcome: { status: 404 },
    });
  });
});

/* ------------------------------------------------------------------ detail */

const ASKER_BLOCK = `<ul class="featureInfo"><li><i class="fa fa-user"></i><b>سائل:</b> ${ASKER_NAME}<i style="margin-right:35px;" class="fa fa-map-marker"></i>مقام: ${ASKER_CITY}</li>
				</ul>`;
const QUESTION = 'Synthetic question text, <b>as published</b>.';
const ANSWER = `<p>Synthetic answer paragraph one.</p>
	<p class="arabic30pt1">Synthetic quotation.</p>
	<div class="refrenceInfo"><p class="hawala23ptb">Synthetic reference.</p></div>
</p><p class="arabic24pt1">Synthetic closing line.</p>`;

interface FatwaPage {
  readonly id?: number;
  readonly reference?: string;
  readonly ogTitle?: string;
  readonly date?: string;
  readonly mufti?: boolean;
  readonly answerMarker?: boolean;
  readonly answer?: string;
  readonly askerInsideAnswer?: boolean;
  readonly shareWidget?: boolean;
  readonly block?: boolean;
}

function fatwaPage(options: FatwaPage = {}) {
  const id = options.id ?? 501;
  const mufti = options.mufti ?? true;
  const answer = options.askerInsideAnswer
    ? `${options.answer ?? ANSWER}\n${ASKER_BLOCK}`
    : (options.answer ?? ANSWER);
  const marker = options.answerMarker === false ? '<p>' : '<p><b>جواب:</b><br>';
  const block =
    options.block === false
      ? '<div>Synthetic page without a ruling</div>'
      : `<span id="UmairID">
              	<h3><b>سوال نمبر</b>:${options.reference ?? String(id)} <br> <span>${QUESTION}</span></h3>
                ${ASKER_BLOCK}
                <ul class="featureInfo"><li><i class="fa fa-calendar"></i>تاریخ اشاعت: ${options.date ?? '16 جولائی 2025ء'}</li>
                </ul>
                <h4><b>زمرہ:</b> <a href="/urdu/cat/389/نمونہ-زمرہ/" title=Synthetic>نمونہ زمرہ</a>
				</h4>
				${marker}${answer}
${mufti ? '				<h3><a href="/urdu/mufti/9/"><b>مفتی: </b>Synthetic Mufti Name</a></h3>' : ''}
				</span>
${
  mufti
    ? `<div style="max-width: 700px;"><h3 style="color: #155724;">✍️ مفتی تعارف</h3><p>Synthetic institutional note.</p></div>`
    : ''
}
		<!-- AddToAny BEGIN -->
		${options.shareWidget === false ? '' : `<div class="a2a_kit a2a_kit_size_32" data-a2a-url="https://www.thefatwa.com/urdu/questionID/${id}/"><a class="a2a_button_email"></a></div>`}
<!-- AddToAny END -->`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${options.ogTitle ?? 'Synthetic short title'} - فتویٰ آن لائن</title>
<meta property="og:title" content="${options.ogTitle ?? 'Synthetic short title'} - فتویٰ آن لائن">
<meta property="og:url" content="${key(id)}"><meta property="og:locale" content="en_US">
</head><body>
<ul class="nav"><li><a href="/urdu/cat/93/" title="Synthetic">نمونہ</a></li></ul>
<div class="row"><div class="col-md-9">
<div class="listWrpService jobdetail"><div class="row"><div class="col-md-12 col-sm-12 col-xs-12">
${block}
<div class="read-btn"><a href="/urdu/print/${id}/x/">پرنٹ کریں</a></div>
</div></div><hr>
<div class="fb-comments" data-href="${key(id)}"></div>
</div></div>
<div class="col-md-3"><h3>متعلقہ سوالات</h3><ul class="papu-post"><li><a href="/urdu/questionID/77/">Synthetic related</a></li></ul></div>
</div></body></html>`;
}

function parse(options: FatwaPage = {}, url = key(options.id ?? 501)) {
  return adapter().parse(evidenceOf(fatwaPage(options), url));
}

describe('parsing with Cheerio', () => {
  it('extracts every field of a ruling', () => {
    expect(parse()).toEqual({
      kind: 'parsed',
      record: {
        kind: 'fatwa.ruling',
        title: 'Synthetic short title',
        primaryLocale: 'ur',
        languageCode: 'ur',
        publishedOn: '2025-07-16',
        legacyIdentifier: 'q-501',
        categories: [{ key: '389', label: 'نمونہ زمرہ' }],
        links: [],
        assets: [],
        questionHtml: QUESTION,
        answerHtml: ANSWER,
        sourceReference: '501',
        attributedTo: 'Synthetic Mufti Name',
      },
    });
  });

  it('never lets the asker’s name or town reach any parsed field', () => {
    for (const options of [
      {},
      { mufti: false },
      { askerInsideAnswer: true },
      { askerInsideAnswer: true, mufti: false },
    ] satisfies FatwaPage[]) {
      const result = parse(options);
      expect(result.kind).toBe('parsed');
      const serialised = JSON.stringify(result);
      expect(serialised).not.toContain(ASKER_NAME);
      expect(serialised).not.toContain(ASKER_CITY);
      expect(serialised).not.toContain('سائل');
      expect(serialised).not.toContain('مقام');
      expect(serialised).not.toContain('featureInfo');
    }
  });

  it('refuses a page whose asker label would survive into a field', () => {
    expect(
      parse({ answer: '<p>Synthetic <b>سائل:</b> leaked into the answer.</p>' }),
    ).toEqual({
      kind: 'failed',
      detail: 'personal-data-marker',
    });
  });

  it('ends an older ruling, with no mufti line, at the share widget', () => {
    const result = parse({ mufti: false });
    expect(result).toMatchObject({
      kind: 'parsed',
      record: { attributedTo: null, answerHtml: ANSWER },
    });
    // The share widget and the comment widget are chrome.
    expect(JSON.stringify(result)).not.toMatch(/a2a|fb-comments|AddToAny/);
  });

  it('ends at the next piece of chrome when the share widget is gone', () => {
    expect(parse({ mufti: false, shareWidget: false })).toMatchObject({
      kind: 'parsed',
      record: { answerHtml: ANSWER },
    });
  });

  it('reads dates deterministically from Urdu month names and digits', () => {
    const date = (text: string) => {
      const result = parse({ date: text });
      return result.kind === 'parsed' ? result.record.publishedOn : 'not parsed';
    };
    expect(date('31 جنوری 2019ء')).toBe('2019-01-31');
    expect(date('۱۶ جولائی ۲۰۲۵ء')).toBe('2025-07-16');
    expect(date('2 مئی 2020ء')).toBe('2020-05-02');
    expect(date('جولائی 2025ء')).toBeNull();
    expect(date('31 فروری 2019ء')).toBeNull();
    expect(date('16 Synthetic 2025')).toBeNull();
  });

  it('takes the title from the question when the page title carries no site suffix', () => {
    const page = fatwaPage().replaceAll(' - فتویٰ آن لائن', '');
    expect(adapter().parse(evidenceOf(page, key(501)))).toMatchObject({
      kind: 'parsed',
      record: { title: 'Synthetic question text, as published.' },
    });
  });

  it('excludes pages that are not rulings and fails broken ones', () => {
    expect(parse({}, `${ORIGIN}/urdu/index.html`)).toEqual({
      kind: 'excluded',
      reason: 'not-a-fatwa',
    });
    expect(parse({ block: false })).toEqual({
      kind: 'failed',
      detail: 'record-structure-missing',
    });
    expect(parse({ reference: 'Synthetic' })).toEqual({
      kind: 'failed',
      detail: 'reference-missing',
    });
    expect(parse({ reference: '777' })).toEqual({
      kind: 'failed',
      detail: 'reference-conflict',
    });
    expect(parse({ answerMarker: false })).toEqual({
      kind: 'failed',
      detail: 'answer-missing',
    });
    const endless = fatwaPage({ mufti: false, shareWidget: false })
      .replace(/<div class="read-btn">.*?<\/div>/, '')
      .replace(/<div class="fb-comments"[^>]*><\/div>/, '')
      .replace(/<ul class="papu-post">.*?<\/ul>/s, '');
    expect(adapter().parse(evidenceOf(endless, key(501)))).toEqual({
      kind: 'failed',
      detail: 'answer-end-missing',
    });
    expect(parse({ answer: '<!-- only a comment -->' })).toEqual({
      kind: 'failed',
      detail: 'answer-missing',
    });
  });

  it('fails a body that is not UTF-8 HTML', () => {
    for (const { body, contentType, detail } of UNDECODABLE)
      expect(adapter().parse({ body, contentType, finalUrl: key(501) })).toEqual({
        kind: 'failed',
        detail,
      });
  });
});
