import { describe, expect, it } from 'vitest';

import {
  createMinhajBooksWorkAdapter,
  MINHAJ_BOOKS_ADAPTER_KEY,
} from '../../../../scripts/migration/adapters/minhajbooks.ts';

import { evidenceOf, fakeSite, htmlPage, pendingItem, textFile } from './fake-site.ts';

/**
 * The Minhaj Books work adapter over SYNTHETIC pages shaped like the real
 * site: discovery bounds, robots, keys, and a parse that reads the book and
 * never the sale-point, sponsor or price chrome.
 */

const SITE = 'https://www.minhajbooks.com';
const LISTING = '/english/cat/Synthetic-Category/';
const SELECTION = { pages: 2, limit: 25 };

const bookKey = (id: number, slug: string) => `${SITE}/english/book/${id}/${slug}/`;

function card(href: string, title = 'Synthetic card'): string {
  return `<div class="col-md-4 col-sm-6"><div class="best-seller-pro">
  <figure><img src="${SITE}/images-books/thumbnails400/synthetic.jpg" alt="${title}"></figure>
  <div class="kode-caption"><h3>${title}</h3>
    <a href="${href}" class="add-to-cart">Click to Read</a><a target="_blank" href="${SITE}/images-books/Synthetic/Synthetic_1.pdf" class="add-to-cart mt-20">Click To Download</a>
  </div></div></div>`;
}

function listing(cards: string[], nextHref?: string): string {
  const next =
    nextHref === undefined
      ? ''
      : `<nav><ul class="pagination"><li class="active"><a href="#">1</a></li><li><a href="${nextHref}" aria-label="Next"><span>Next</span></a></li></ul></nav>`;
  return `<!DOCTYPE html><html lang="en"><body>
  <div class="widget"><h2>Synthetic Category (4)</h2></div>
  <div class="lib-related-products postList"><div class="row">${cards.join('\n')}</div></div>
  ${next}</body></html>`;
}

interface BookOptions {
  id?: number;
  title?: string;
  language?: string;
  rows?: string;
  intro?: string;
  statedId?: number;
}

function bookPage(options: BookOptions = {}): string {
  const id = options.id ?? 101;
  const stated = options.statedId ?? id;
  const intro =
    options.intro ??
    `<div id="BookIntro" class="tab-pane"><div class="dir-rtl"><p>Synthetic introduction <b>words</b>.</p>
<ul><li>Synthetic point</li></ul></div></div>`;
  return `<!DOCTYPE html><html lang="en"><head>
<meta property="og:locale" content="en_US"><title>Synthetic - Minhaj Books</title></head><body>
<div class="lib-book-detail">
  <div class="kode-thumb"><img src="${SITE}/images-books/thumbnails600/Synthetic_${id}.jpg" alt=""></div>
  <div class="kode-text">
    <h2>${options.title ?? 'Synthetic Book Title'}</h2>
    <p>Synthetic subtitle</p>
    <div class="product-price">
      <p>Category : <a href="/english/cat/Synthetic-Category/"><span class="color">Synthetic Category </span></a></p>
      <p>Author :  <a href="/english/author/Synthetic-Author/"><span class="color">Synthetic Author</span></a></p>
      <p>Book Language : <a href="/english/Urdu/"><span class="color">${options.language ?? 'Urdu'}</span></a></p><p>Pages : <span class="color">264</span></p><p>Price : <span class="color">Rs.999</span></p>${options.rows ?? '<p>Binding : <span class="color">Hard</span></p>'}
    </div>
  </div>
  <a href="https://shop.synthetic.example/item/1" data-mbk-book-id="${stated}">Buy</a>
  <div class="kode-text"><h4>Read & Download</h4><a href="/english/book/Synthetic-Book/read/img/btid/7/" class="add-to-cart" data-mbk-book-id="${stated}">Read Online</a>
  <form action="https://pay.synthetic.example/" data-mbk-book-id="${stated}"><input type="hidden" name="item_number" value="Synthetic paypal item"></form></div>
</div>
<div class="tab-content">
  <div id="index"><ul><li><a href="/english/book/Synthetic-Book/read/img/btid/7/">Synthetic chapter</a></li></ul></div>
  ${intro}
  <div id="buybook"><p>Synthetic Sales Office</p><p>sales@synthetic.example</p><p>+00-000-000-0000</p></div>
  <div id="sponsorlist"><p>Synthetic Sponsor Person</p></div>
</div></body></html>`;
}

function adapter(selection = SELECTION, listingPath = LISTING) {
  return createMinhajBooksWorkAdapter({ listing: listingPath, selection });
}

function parseBook(html: string, url = bookKey(101, 'Synthetic-Book')) {
  return adapter().parse(evidenceOf(html, url));
}

describe('identity and construction', () => {
  it('declares what it is', () => {
    expect(adapter()).toMatchObject({
      adapterKey: MINHAJ_BOOKS_ADAPTER_KEY,
      adapterVersion: '1',
      parserKey: 'cheerio-minhajbooks-work',
      parserVersion: '1',
      contentKind: 'library.work',
      accessMethod: 'http',
    });
  });

  it('refuses another host, plain http, a non-root base, a bad listing or selection', () => {
    const make =
      (baseUrl: string, listingPath = LISTING, selection = SELECTION) =>
      () =>
        createMinhajBooksWorkAdapter({ baseUrl, listing: listingPath, selection });
    expect(make('https://minhajbooks.com/')).toThrow();
    expect(make('http://www.minhajbooks.com/')).toThrow();
    expect(make('https://www.minhajbooks.com/english/')).toThrow();
    expect(make('https://www.minhajbooks.com/', '/urdu/cat/X/')).toThrow();
    expect(make('https://www.minhajbooks.com/', '/english/cat/../../admin/')).toThrow();
    expect(
      make('https://www.minhajbooks.com/', LISTING, { pages: 0, limit: 5 }),
    ).toThrow();
    expect(
      make('https://www.minhajbooks.com/', LISTING, { pages: 1, limit: 1.5 }),
    ).toThrow();
    expect(make('https://www.minhajbooks.com/')).not.toThrow();
  });
});

describe('discovery', () => {
  function twoPageSite() {
    return fakeSite({
      [`${SITE}${LISTING}`]: htmlPage(
        listing(
          [
            card('/english/book/101/Synthetic-Book-One/'),
            card('/english/book/102/Synthetic-Book-Two/'),
            // The same book again, an off-host copy, and the slug form: none queued.
            card('/english/book/101/Synthetic-Book-One/'),
            card('https://elsewhere.example/english/book/103/Synthetic-Elsewhere/'),
            card('/english/book/Synthetic-Slug-Only/'),
          ],
          `${LISTING}page/2/`,
        ),
      ),
      [`${SITE}${LISTING}page/2/`]: htmlPage(
        listing(
          [
            card('/english/book/104/Synthetic-Book-Four/'),
            card('/english/book/105/Synthetic-Book-Five/'),
          ],
          `${LISTING}page/3/`,
        ),
      ),
    });
  }

  it('walks the selected pages, keys books by the id form, dedups, stays on its host', async () => {
    const site = twoPageSite();
    const discovery = adapter();
    const first = await discovery.discover(null, site.fetcher);
    expect(first).toEqual({
      kind: 'page',
      items: [
        {
          externalKey: bookKey(101, 'Synthetic-Book-One'),
          originalUrl: bookKey(101, 'Synthetic-Book-One'),
          legacyIdentifier: 'book-101',
        },
        {
          externalKey: bookKey(102, 'Synthetic-Book-Two'),
          originalUrl: bookKey(102, 'Synthetic-Book-Two'),
          legacyIdentifier: 'book-102',
        },
      ],
      next: '2:2',
    });
    const second = await discovery.discover('2:2', site.fetcher);
    expect(second).toMatchObject({ kind: 'page', next: null });
    if (second.kind !== 'page') throw new Error('expected a page');
    // Page 2 still links to page 3, but the selection is two pages.
    expect(second.items.map((item) => item.legacyIdentifier)).toEqual([
      'book-104',
      'book-105',
    ]);
    // robots.txt was read once for both pages.
    expect(site.requested.filter((url) => url.endsWith('/robots.txt'))).toHaveLength(1);
  });

  it('is deterministic: the same book always gets the same key', async () => {
    const one = await adapter().discover(null, twoPageSite().fetcher);
    const two = await adapter({ pages: 50, limit: 1000 }).discover(
      null,
      twoPageSite().fetcher,
    );
    if (one.kind !== 'page' || two.kind !== 'page') throw new Error('expected pages');
    expect(two.items.slice(0, one.items.length)).toEqual(one.items);
  });

  it('stops at the selection limit across pages', async () => {
    const site = twoPageSite();
    const discovery = adapter({ pages: 5, limit: 3 });
    const first = await discovery.discover(null, site.fetcher);
    expect(first).toMatchObject({ kind: 'page', next: '2:2' });
    const second = await discovery.discover('2:2', site.fetcher);
    if (second.kind !== 'page') throw new Error('expected a page');
    expect(second.items.map((item) => item.legacyIdentifier)).toEqual(['book-104']);
    expect(second.next).toBeNull();

    const capped = await adapter({ pages: 5, limit: 1 }).discover(
      null,
      twoPageSite().fetcher,
    );
    expect(capped).toMatchObject({ kind: 'page', next: null });
    if (capped.kind === 'page') expect(capped.items).toHaveLength(1);
  });

  it('honours a one-page selection even when the listing has more', async () => {
    const result = await adapter({ pages: 1, limit: 25 }).discover(
      null,
      twoPageSite().fetcher,
    );
    expect(result).toMatchObject({ kind: 'page', next: null });
  });

  it('resumes from a cursor without refetching earlier pages, and validates it', async () => {
    const site = twoPageSite();
    const result = await adapter().discover('2:2', site.fetcher);
    expect(result.kind).toBe('page');
    expect(site.requested).not.toContain(`${SITE}${LISTING}`);
    await expect(adapter().discover('1:0', site.fetcher)).rejects.toThrow('cursor');
    await expect(adapter().discover('2', site.fetcher)).rejects.toThrow('cursor');
    await expect(adapter().discover('x:1', site.fetcher)).rejects.toThrow('cursor');
    // A cursor past a narrowed selection is one discovery could not have
    // issued: refused, without fetching.
    const narrowed = twoPageSite();
    await expect(
      adapter({ pages: 1, limit: 25 }).discover('2:2', narrowed.fetcher),
    ).rejects.toThrow('cursor');
    expect(narrowed.requested).toEqual([]);
  });

  it('refuses a next link that does not advance this listing', async () => {
    for (const bad of [
      `${LISTING}page/1/`,
      `${LISTING}page/5/`,
      '/english/cat/Other/page/2/',
    ]) {
      const site = fakeSite({
        [`${SITE}${LISTING}`]: htmlPage(
          listing([card('/english/book/101/Synthetic-Book-One/')], bad),
        ),
      });
      expect(await adapter().discover(null, site.fetcher)).toEqual({
        kind: 'outcome',
        outcome: {
          kind: 'refused',
          classification: 'unsupported-type',
          requestedUrl: `${SITE}${LISTING}`,
          detail: 'index-unrecognised',
        },
      });
    }
  });

  it('refuses an unrecognisable listing rather than returning an empty page', async () => {
    const cases = [
      htmlPage('<html><body><p>Synthetic page with no grid</p></body></html>'),
      htmlPage(listing([])),
      // Slug-form links only (the new-arrival shape): not keyable stably.
      htmlPage(listing([card('/english/book/Synthetic-Slug-Only/')])),
      htmlPage(listing([card('/english/book/101/X/')]), {
        contentType: 'application/json',
      }),
    ];
    for (const page of cases) {
      const site = fakeSite({ [`${SITE}${LISTING}`]: page });
      const result = await adapter().discover(null, site.fetcher);
      expect(result).toMatchObject({
        kind: 'outcome',
        outcome: { kind: 'refused', detail: 'index-unrecognised' },
      });
    }
  });

  it('hands a failed listing fetch back as the outcome', async () => {
    const site = fakeSite({
      [`${SITE}${LISTING}`]: htmlPage('busy', { status: 503 }),
    });
    expect(await adapter().discover(null, site.fetcher)).toMatchObject({
      kind: 'outcome',
      outcome: { kind: 'response', status: 503 },
    });
  });

  it('honours robots.txt: a disallowed listing is refused, a disallowed book never queued', async () => {
    const blocked = fakeSite({
      [`${SITE}/robots.txt`]: textFile(
        'User-agent: *\nDisallow: /english/cat/Synthetic-Category/',
      ),
      [`${SITE}${LISTING}`]: htmlPage(
        listing([card('/english/book/101/Synthetic-Book-One/')]),
      ),
    });
    expect(await adapter().discover(null, blocked.fetcher)).toEqual({
      kind: 'outcome',
      outcome: {
        kind: 'refused',
        classification: 'scope-refused',
        requestedUrl: `${SITE}${LISTING}`,
        detail: 'robots-disallowed',
      },
    });
    expect(blocked.requested).not.toContain(`${SITE}${LISTING}`);

    const partly = fakeSite({
      [`${SITE}/robots.txt`]: textFile(
        'User-agent: OneMinhajMigration\nDisallow: /english/book/102/',
      ),
      [`${SITE}${LISTING}`]: htmlPage(
        listing([
          card('/english/book/101/Synthetic-Book-One/'),
          card('/english/book/102/Synthetic-Book-Two/'),
        ]),
      ),
    });
    const result = await adapter().discover(null, partly.fetcher);
    if (result.kind !== 'page') throw new Error('expected a page');
    expect(result.items.map((item) => item.legacyIdentifier)).toEqual(['book-101']);
  });

  it('hands back an unreadable robots.txt without caching it, then reads it again', async () => {
    const site = fakeSite({
      [`${SITE}/robots.txt`]: textFile('down', 503),
      [`${SITE}${LISTING}`]: htmlPage(
        listing([card('/english/book/101/Synthetic-Book-One/')]),
      ),
    });
    const discovery = adapter();
    expect(await discovery.discover(null, site.fetcher)).toMatchObject({
      kind: 'outcome',
      outcome: { kind: 'response', status: 503 },
    });
    site.set(`${SITE}/robots.txt`, textFile('User-agent: *\nAllow: /'));
    expect(await discovery.discover(null, site.fetcher)).toMatchObject({ kind: 'page' });
    expect(site.requested.filter((url) => url.endsWith('/robots.txt'))).toHaveLength(2);
  });
});

describe('retrieval', () => {
  it('fetches the record once and hands a non-200 back', async () => {
    const key = bookKey(101, 'Synthetic-Book');
    const site = fakeSite({ [key]: htmlPage(bookPage()) });
    const evidence = await adapter().retrieve(pendingItem(key, 'book-101'), site.fetcher);
    expect(evidence).toMatchObject({ kind: 'evidence', httpStatus: 200, finalUrl: key });
    expect(site.requested).toEqual([key]);

    const gone = await adapter().retrieve(
      pendingItem(bookKey(9, 'Gone'), 'book-9'),
      site.fetcher,
    );
    expect(gone).toMatchObject({
      kind: 'outcome',
      outcome: { kind: 'response', status: 404 },
    });
  });
});

describe('parse', () => {
  it('reads every field of the book', () => {
    const result = parseBook(bookPage());
    expect(result).toEqual({
      kind: 'parsed',
      record: {
        kind: 'library.work',
        title: 'Synthetic Book Title',
        primaryLocale: 'en',
        languageCode: 'ur',
        publishedOn: null,
        legacyIdentifier: 'book-101',
        categories: [{ key: 'Synthetic-Category', label: 'Synthetic Category' }],
        links: ['/english/book/Synthetic-Book/read/img/btid/7/'],
        assets: [],
        descriptionHtml: `<div class="dir-rtl"><p>Synthetic introduction <b>words</b>.</p>
<ul><li>Synthetic point</li></ul></div>`,
        edition: {
          label: 'Hard',
          publisher: null,
          publicationYear: null,
          isbn: null,
          pageCount: '264',
          readableAssetUrl: null,
          downloadAssetUrl: null,
        },
      },
    });
  });

  it('never carries the sale-point, sponsor, buy, PayPal or price chrome', () => {
    const text = JSON.stringify(parseBook(bookPage()));
    for (const leaked of [
      'sales@synthetic.example',
      '+00-000-000-0000',
      'Synthetic Sales Office',
      'Synthetic Sponsor Person',
      'Synthetic paypal item',
      'shop.synthetic.example',
      'Rs.999',
    ])
      expect(text).not.toContain(leaked);
  });

  it('fails a description region that holds a contact tab', () => {
    const intro = `<div id="BookIntro"><p>Synthetic</p><div id="buybook"><p>sales@synthetic.example</p></div></div>`;
    expect(parseBook(bookPage({ intro }))).toEqual({
      kind: 'failed',
      detail: 'description-structure-unexpected',
    });
  });

  it('gives an empty description when the page has none', () => {
    const result = parseBook(bookPage({ intro: '<div id="BookIntro">  </div>' }));
    expect(
      result.kind === 'parsed' && result.record.kind === 'library.work'
        ? result.record.descriptionHtml
        : null,
    ).toBe('');
  });

  it('states publisher, year and ISBN only from rows that state them', () => {
    const rows =
      '<p>Publisher : <span class="color">Synthetic Press</span></p><p>Year : <span class="color">2001</span></p><p>ISBN : <span class="color">978-0-00-000000-2</span></p>';
    const result = parseBook(bookPage({ rows }));
    if (result.kind !== 'parsed' || result.record.kind !== 'library.work')
      throw new Error('expected a work');
    expect(result.record.edition).toMatchObject({
      // No Binding row: the edition is named by its language, as shown.
      label: 'Urdu',
      publisher: 'Synthetic Press',
      publicationYear: '2001',
      isbn: '978-0-00-000000-2',
    });
  });

  it('maps the Book Language through the fixed table, else null', () => {
    const language = (value: string) => {
      const result = parseBook(bookPage({ language: value }));
      return result.kind === 'parsed' ? result.record.languageCode : result;
    };
    expect(language('English')).toBe('en');
    expect(language('Arabic')).toBe('ar');
    expect(language('Others')).toBeNull();
  });

  it('takes the primary locale from the title script', () => {
    const urdu = parseBook(bookPage({ title: 'مصنوعی کتاب', language: 'Urdu' }));
    expect(urdu).toMatchObject({
      kind: 'parsed',
      record: { primaryLocale: 'ur', title: 'مصنوعی کتاب' },
    });
    const arabic = parseBook(bookPage({ title: 'كتاب اصطناعي', language: 'Arabic' }));
    expect(arabic).toMatchObject({ kind: 'parsed', record: { primaryLocale: 'ar' } });
    // An Arabic-script title in a language the script cannot name.
    expect(parseBook(bookPage({ title: 'مصنوعی کتاب', language: 'Others' }))).toEqual({
      kind: 'failed',
      detail: 'primary-locale-undetermined',
    });
  });

  it('excludes a page that is not a book and fails a book page without its structure', () => {
    expect(adapter().parse(evidenceOf(bookPage(), `${SITE}${LISTING}`))).toEqual({
      kind: 'excluded',
      reason: 'not-a-book-page',
    });
    expect(parseBook('<html><body><p>Synthetic</p></body></html>')).toEqual({
      kind: 'failed',
      detail: 'record-structure-missing',
    });
    expect(parseBook(bookPage({ title: ' ' }))).toEqual({
      kind: 'failed',
      detail: 'title-missing',
    });
  });

  it('fails when the page states another book id than its URL', () => {
    expect(parseBook(bookPage({ statedId: 999 }))).toEqual({
      kind: 'failed',
      detail: 'book-id-mismatch',
    });
  });

  it('turns decoding refusals into parse failures', () => {
    const page = bookPage();
    const key = bookKey(101, 'Synthetic-Book');
    expect(adapter().parse(evidenceOf(page, key, 'application/pdf'))).toEqual({
      kind: 'failed',
      detail: 'unsupported-content-type',
    });
    expect(
      adapter().parse(evidenceOf(page, key, 'text/html; charset=windows-1252')),
    ).toEqual({
      kind: 'failed',
      detail: 'unsupported-charset',
    });
    expect(
      adapter().parse({
        body: new Uint8Array([0xff, 0xfe, 0x00]),
        contentType: 'text/html',
        finalUrl: key,
      }),
    ).toEqual({ kind: 'failed', detail: 'invalid-utf8' });
  });
});
