import { describe, expect, it } from 'vitest';

import {
  createMinhajInfoIssueAdapter,
  createMinhajInfoMagazineAdapter,
  MINHAJ_INFO_ISSUE_ADAPTER_KEY,
  MINHAJ_INFO_MAGAZINE_ADAPTER_KEY,
} from '../../../../scripts/migration/adapters/minhaj-info.ts';

import { evidenceOf, fakeSite, htmlPage, pendingItem, textFile } from './fake-site.ts';

/**
 * The minhaj.info magazine and issue adapters over SYNTHETIC pages shaped
 * like the real archive and issue pages.
 */

const SITE = 'https://minhaj.info';
const MAGAZINE = '/synthetic-mags';
const MAGAZINE_URL = `${SITE}${MAGAZINE}`;
const SELECTION = { pages: 1, limit: 12 };

function archivePage(issueHrefs: string[]): string {
  const cards = issueHrefs
    .map(
      (href) => `<a class="icard rv d0 in" data-y="2026" href="${href}">
  <div class="cover"><div class="ph">مصنوعی<small class="latin">2026</small></div>
  <img src="${SITE}/i/284/mag/mags/titlethumbs/2026-01.webp" alt=""></div>
  <div class="cap"><h3>مصنوعی ماہ</h3></div></a>`,
    )
    .join('\n');
  return `<!DOCTYPE html><html lang="en" dir="rtl"><head>
<link rel="canonical" href="${MAGAZINE_URL}"><meta property="og:locale" content="ur"></head><body>
<aside class="drawer"><a class="dr-call" href="tel:+0000000000">Synthetic call</a></aside>
<main id="main"><section class="phero"><div class="wrap"><div>
  <p class="eyebrow">Publication archive</p>
  <h1 id="pubTitle">مصنوعی رسالہ</h1>
  <p id="pubBlurb">مصنوعی <b>تعارف</b> کے الفاظ۔</p>
</div></div></section>
<div class="sh" id="gridTop"><p class="eyebrow"><span id="count">${issueHrefs.length}</span> ISSUES</p></div>
<div class="igrid" id="issueGrid">${cards}</div></main>
<footer><a href="mailto:office@synthetic.example">office@synthetic.example</a></footer>
</body></html>`;
}

function issuePage(
  options: { jsonLd?: string; dlcTitle?: string | null; cards?: string } = {},
): string {
  const dlc =
    options.dlcTitle === null
      ? ''
      : `<aside class="aside"><section class="scard dlc"><h3>${options.dlcTitle ?? 'شمارہ مصنوعی 2026ء'}</h3>
  <div class="dl"><a href="${SITE}/mag/mags/2026-08/pdf/Synthetic_2026-08.pdf">PDF</a></div></section></aside>`;
  const cards =
    options.cards ??
    `<article class="acard rv d0" data-s="Synthetic data-s words">
  <a class="thumb" href="${SITE}/synthetic-mags/Synthetic-August-2026/one" aria-hidden="true"><img src="${SITE}/mag/x.webp" alt=""></a>
  <div class="body"><div class="meta"><span class="chip">مصنوعی رسالہ</span><span class="date">AUG 2026</span></div>
  <h3><a href="${SITE}/synthetic-mags/Synthetic-August-2026/one">Synthetic &lt;title&gt; one &amp; more</a></h3>
  <div class="foot"><p><a class="auth-link" href="${SITE}/author?name=x">Synthetic Author: One</a></p><a href="${SITE}/synthetic-mags/Synthetic-August-2026/one">read</a></div></div>
</article>
<article class="acard rv d1" data-s="Synthetic two">
  <div class="body"><h3><a href="${SITE}/synthetic-mags/Synthetic-August-2026/two">مصنوعی مضمون دو</a></h3>
  <div class="foot"><p></p></div></div>
</article>`;
  return `<!DOCTYPE html><html lang="en" dir="rtl"><head>
<meta property="og:locale" content="ur">${options.jsonLd === undefined ? '' : `<script type="application/ld+json">${options.jsonLd}</script>`}
</head><body>
<main id="main"><section class="phero"><div class="wrap"><div>
  <nav class="crumbs"><a href="${SITE}">سرورق</a><a href="${MAGAZINE_URL}">مصنوعی رسالہ</a><span>مصنوعی ماہ 2026ء</span></nav>
  <p class="eyebrow issue-eyebrow">AUG 2026</p>
  <h1 class="issue-title">مصنوعی رسالہ</h1>
</div></div></section>
<section class="section"><div class="wrap adetail"><div><div class="grid3">${cards}</div></div>${dlc}</div></section></main>
<footer><a href="tel:+0000000000">+00 000 0000</a></footer>
</body></html>`;
}

const magazineAdapter = (magazines = [MAGAZINE, '/second-mags'], selection = SELECTION) =>
  createMinhajInfoMagazineAdapter({ magazines, selection });
const issueAdapter = (selection = SELECTION) =>
  createMinhajInfoIssueAdapter({ magazine: MAGAZINE, selection });

describe('identity and construction', () => {
  it('declares what each adapter is', () => {
    expect(magazineAdapter()).toMatchObject({
      adapterKey: MINHAJ_INFO_MAGAZINE_ADAPTER_KEY,
      adapterVersion: '1',
      parserKey: 'cheerio-minhaj-info-magazine',
      parserVersion: '1',
      contentKind: 'library.magazine',
      accessMethod: 'http',
    });
    expect(issueAdapter()).toMatchObject({
      adapterKey: MINHAJ_INFO_ISSUE_ADAPTER_KEY,
      adapterVersion: '1',
      parserKey: 'cheerio-minhaj-info-magazine-issue',
      parserVersion: '1',
      contentKind: 'library.magazine-issue',
      accessMethod: 'http',
    });
  });

  it('refuses another host, http, a non-root base and malformed archive paths', () => {
    const make =
      (baseUrl: string, magazine = MAGAZINE) =>
      () =>
        createMinhajInfoIssueAdapter({ baseUrl, magazine, selection: SELECTION });
    expect(make('https://www.minhaj.info/')).toThrow();
    expect(make('http://minhaj.info/')).toThrow();
    expect(make('https://minhaj.info/mags/')).toThrow();
    expect(make('https://minhaj.info/', 'synthetic-mags')).toThrow();
    expect(make('https://minhaj.info/', '/a/b')).toThrow();
    expect(() => magazineAdapter([])).toThrow();
    expect(() => magazineAdapter([MAGAZINE], { pages: 1, limit: 0 })).toThrow();
  });
});

describe('magazine discovery and parse', () => {
  it('discovers exactly the named archives, capped by the limit, deduplicated', async () => {
    const site = fakeSite({});
    const result = await magazineAdapter([MAGAZINE, '/second-mags', MAGAZINE]).discover(
      null,
      site.fetcher,
    );
    expect(result).toEqual({
      kind: 'page',
      items: [
        {
          externalKey: MAGAZINE_URL,
          originalUrl: MAGAZINE_URL,
          legacyIdentifier: 'synthetic-mags',
        },
        {
          externalKey: `${SITE}/second-mags`,
          originalUrl: `${SITE}/second-mags`,
          legacyIdentifier: 'second-mags',
        },
      ],
      next: null,
    });
    // Only robots.txt is read: the records are the archive pages themselves.
    expect(site.requested).toEqual([`${SITE}/robots.txt`]);

    const capped = await magazineAdapter([MAGAZINE, '/second-mags'], {
      pages: 1,
      limit: 1,
    }).discover(null, fakeSite({}).fetcher);
    expect(capped).toMatchObject({
      kind: 'page',
      items: [{ legacyIdentifier: 'synthetic-mags' }],
    });
    await expect(magazineAdapter().discover('2', site.fetcher)).rejects.toThrow('cursor');
  });

  it('honours robots.txt', async () => {
    const partly = fakeSite({
      [`${SITE}/robots.txt`]: textFile('User-agent: *\nDisallow: /second-mags'),
    });
    const result = await magazineAdapter().discover(null, partly.fetcher);
    expect(result).toMatchObject({
      kind: 'page',
      items: [{ legacyIdentifier: 'synthetic-mags' }],
    });
    if (result.kind === 'page') expect(result.items).toHaveLength(1);

    const all = fakeSite({
      [`${SITE}/robots.txt`]: textFile('User-agent: *\nDisallow: /'),
    });
    expect(await magazineAdapter().discover(null, all.fetcher)).toMatchObject({
      kind: 'outcome',
      outcome: {
        kind: 'refused',
        classification: 'scope-refused',
        detail: 'robots-disallowed',
      },
    });
  });

  it('parses the archive page as the magazine, and nothing of its chrome', () => {
    const result = magazineAdapter().parse(evidenceOf(archivePage([]), MAGAZINE_URL));
    expect(result).toEqual({
      kind: 'parsed',
      record: {
        kind: 'library.magazine',
        title: 'مصنوعی رسالہ',
        primaryLocale: 'ur',
        languageCode: 'ur',
        publishedOn: null,
        legacyIdentifier: 'synthetic-mags',
        categories: [],
        links: [],
        assets: [],
        descriptionHtml: 'مصنوعی <b>تعارف</b> کے الفاظ۔',
      },
    });
    const text = JSON.stringify(result);
    expect(text).not.toContain('office@synthetic.example');
    expect(text).not.toContain('+0000000000');
  });

  it('prefers JSON-LD inLanguage, never <html lang>, and fails an unnamed script', () => {
    const withLd = archivePage([]).replace(
      '</head>',
      '<script type="application/ld+json">{"@type":"Periodical","inLanguage":"ar"}</script></head>',
    );
    expect(magazineAdapter().parse(evidenceOf(withLd, MAGAZINE_URL))).toMatchObject({
      kind: 'parsed',
      record: { languageCode: 'ar', primaryLocale: 'ar' },
    });
    const noSignal = archivePage([]).replace(
      '<meta property="og:locale" content="ur">',
      '',
    );
    expect(magazineAdapter().parse(evidenceOf(noSignal, MAGAZINE_URL))).toEqual({
      kind: 'failed',
      detail: 'primary-locale-undetermined',
    });
    const latin = archivePage([]).replace('مصنوعی رسالہ</h1>', 'Synthetic Magazine</h1>');
    expect(magazineAdapter().parse(evidenceOf(latin, MAGAZINE_URL))).toMatchObject({
      kind: 'parsed',
      record: { primaryLocale: 'en', title: 'Synthetic Magazine' },
    });
  });

  it('excludes what is not an archive, fails a missing title, refuses bad bytes', () => {
    expect(
      magazineAdapter().parse(
        evidenceOf(issuePage(), `${MAGAZINE_URL}/Synthetic-August-2026`),
      ),
    ).toEqual({ kind: 'excluded', reason: 'not-a-magazine-archive' });
    expect(
      magazineAdapter().parse(
        evidenceOf(archivePage([]).replace('id="pubTitle"', 'id="x"'), MAGAZINE_URL),
      ),
    ).toEqual({ kind: 'failed', detail: 'title-missing' });
    expect(
      magazineAdapter().parse(evidenceOf(archivePage([]), MAGAZINE_URL, 'text/plain')),
    ).toEqual({ kind: 'failed', detail: 'unsupported-content-type' });
  });
});

describe('issue discovery', () => {
  const issues = [
    `${SITE}/synthetic-mags/Synthetic-October-2026`,
    `${SITE}/synthetic-mags/Synthetic-September-2026`,
    `${SITE}/synthetic-mags/Synthetic-October-2026`,
    'https://elsewhere.example/synthetic-mags/Synthetic-Offsite',
    `${SITE}/other-mags/Synthetic-Other`,
    `${SITE}/synthetic-mags/Synthetic-August-2026/an-article`,
    `${SITE}/synthetic-mags/12-2012`,
  ];

  it('takes the newest issues from this archive grid only, in grid order', async () => {
    const site = fakeSite({ [MAGAZINE_URL]: htmlPage(archivePage(issues)) });
    const result = await issueAdapter().discover(null, site.fetcher);
    expect(result).toEqual({
      kind: 'page',
      items: [
        {
          externalKey: `${SITE}/synthetic-mags/Synthetic-October-2026`,
          originalUrl: `${SITE}/synthetic-mags/Synthetic-October-2026`,
          legacyIdentifier: 'synthetic-mags/Synthetic-October-2026',
        },
        {
          externalKey: `${SITE}/synthetic-mags/Synthetic-September-2026`,
          originalUrl: `${SITE}/synthetic-mags/Synthetic-September-2026`,
          legacyIdentifier: 'synthetic-mags/Synthetic-September-2026',
        },
        {
          externalKey: `${SITE}/synthetic-mags/12-2012`,
          originalUrl: `${SITE}/synthetic-mags/12-2012`,
          legacyIdentifier: 'synthetic-mags/12-2012',
        },
      ],
      next: null,
    });

    const capped = await issueAdapter({ pages: 1, limit: 2 }).discover(
      null,
      site.fetcher,
    );
    if (capped.kind !== 'page') throw new Error('expected a page');
    expect(capped.items.map((item) => item.legacyIdentifier)).toEqual([
      'synthetic-mags/Synthetic-October-2026',
      'synthetic-mags/Synthetic-September-2026',
    ]);
    await expect(issueAdapter().discover('2', site.fetcher)).rejects.toThrow('cursor');
  });

  it('refuses an archive it cannot recognise and hands back a failed fetch', async () => {
    for (const page of [
      htmlPage('<html><body><p>Synthetic</p></body></html>'),
      htmlPage(archivePage([])),
      htmlPage(archivePage(['https://elsewhere.example/synthetic-mags/X'])),
    ]) {
      const result = await issueAdapter().discover(
        null,
        fakeSite({ [MAGAZINE_URL]: page }).fetcher,
      );
      expect(result).toMatchObject({
        kind: 'outcome',
        outcome: {
          kind: 'refused',
          classification: 'unsupported-type',
          detail: 'index-unrecognised',
        },
      });
    }
    const failed = await issueAdapter().discover(
      null,
      fakeSite({ [MAGAZINE_URL]: htmlPage('x', { status: 500 }) }).fetcher,
    );
    expect(failed).toMatchObject({
      kind: 'outcome',
      outcome: { kind: 'response', status: 500 },
    });
  });

  it('honours robots.txt for the archive and for each issue', async () => {
    const blocked = fakeSite({
      [`${SITE}/robots.txt`]: textFile('User-agent: *\nDisallow: /synthetic-mags'),
      [MAGAZINE_URL]: htmlPage(archivePage(issues)),
    });
    expect(await issueAdapter().discover(null, blocked.fetcher)).toMatchObject({
      kind: 'outcome',
      outcome: {
        kind: 'refused',
        classification: 'scope-refused',
        detail: 'robots-disallowed',
      },
    });
    expect(blocked.requested).not.toContain(MAGAZINE_URL);

    const partly = fakeSite({
      [`${SITE}/robots.txt`]: textFile(
        'User-agent: *\nDisallow: /synthetic-mags/Synthetic-September',
      ),
      [MAGAZINE_URL]: htmlPage(archivePage(issues)),
    });
    const result = await issueAdapter().discover(null, partly.fetcher);
    if (result.kind !== 'page') throw new Error('expected a page');
    expect(result.items.map((item) => item.legacyIdentifier)).toEqual([
      'synthetic-mags/Synthetic-October-2026',
      'synthetic-mags/12-2012',
    ]);

    // Every issue disallowed, the archive allowed: a refusal, not an empty page.
    const issuesBlocked = fakeSite({
      [`${SITE}/robots.txt`]: textFile(
        'User-agent: *\nAllow: /synthetic-mags$\nDisallow: /synthetic-mags/',
      ),
      [MAGAZINE_URL]: htmlPage(archivePage(issues)),
    });
    expect(await issueAdapter().discover(null, issuesBlocked.fetcher)).toMatchObject({
      kind: 'outcome',
      outcome: {
        kind: 'refused',
        classification: 'scope-refused',
        detail: 'robots-disallowed',
      },
    });
  });

  it('retrieves once and hands a non-200 back', async () => {
    const key = `${SITE}/synthetic-mags/Synthetic-August-2026`;
    const site = fakeSite({ [key]: htmlPage(issuePage()) });
    expect(
      await issueAdapter().retrieve(pendingItem(key, null), site.fetcher),
    ).toMatchObject({
      kind: 'evidence',
      httpStatus: 200,
    });
    expect(
      await issueAdapter().retrieve(pendingItem(`${key}-gone`, null), site.fetcher),
    ).toMatchObject({ kind: 'outcome', outcome: { status: 404 } });
  });
});

describe('issue parse', () => {
  const ISSUE_URL = `${SITE}/synthetic-mags/Synthetic-August-2026`;
  const parseIssue = (html: string, url = ISSUE_URL) =>
    issueAdapter().parse(evidenceOf(html, url));

  it('reads every field, references the magazine by the magazine adapter key', async () => {
    const result = parseIssue(issuePage());
    expect(result).toEqual({
      kind: 'parsed',
      record: {
        kind: 'library.magazine-issue',
        title: 'شمارہ مصنوعی 2026ء',
        primaryLocale: 'ur',
        languageCode: 'ur',
        publishedOn: null,
        legacyIdentifier: 'synthetic-mags/Synthetic-August-2026',
        categories: [],
        links: [
          `${SITE}/synthetic-mags/Synthetic-August-2026/one`,
          `${SITE}/synthetic-mags/Synthetic-August-2026/two`,
        ],
        assets: [],
        bodyHtml:
          '<ul><li>Synthetic &lt;title&gt; one &amp; more — Synthetic Author: One</li><li>مصنوعی مضمون دو</li></ul>',
        volume: null,
        issueNumber: null,
        magazineUrl: MAGAZINE_URL,
      },
    });

    // The reference IS the magazine record's external key.
    const magazines = await magazineAdapter([MAGAZINE]).discover(
      null,
      fakeSite({}).fetcher,
    );
    if (magazines.kind !== 'page' || result.kind !== 'parsed')
      throw new Error('expected both');
    expect(
      result.record.kind === 'library.magazine-issue' && result.record.magazineUrl,
    ).toBe(magazines.items[0]?.externalKey);
  });

  it('never carries the page chrome, the PDF, covers or data-s words', () => {
    const text = JSON.stringify(parseIssue(issuePage()));
    for (const leaked of [
      '+00 000 0000',
      'tel:',
      '.pdf',
      '.webp',
      'Synthetic data-s words',
      'AUG 2026',
    ])
      expect(text).not.toContain(leaked);
  });

  it('reads date, volume and number from JSON-LD only, and only a full date', () => {
    const jsonLd = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'PublicationIssue',
      datePublished: '2026-08-01T00:00:00+05:00',
      issueNumber: 8,
      isPartOf: { '@type': 'PublicationVolume', volumeNumber: '40' },
    });
    expect(parseIssue(issuePage({ jsonLd }))).toMatchObject({
      kind: 'parsed',
      record: { publishedOn: '2026-08-01', issueNumber: '8', volume: '40' },
    });
    const monthOnly = JSON.stringify({
      '@type': 'PublicationIssue',
      datePublished: '2026-08',
    });
    expect(parseIssue(issuePage({ jsonLd: monthOnly }))).toMatchObject({
      kind: 'parsed',
      record: { publishedOn: null },
    });
    expect(parseIssue(issuePage({ jsonLd: '{not json' }))).toMatchObject({
      kind: 'parsed',
      record: { publishedOn: null },
    });
  });

  it('falls back to the breadcrumb heading, and gives a null body with no articles', () => {
    expect(parseIssue(issuePage({ dlcTitle: null, cards: '' }))).toMatchObject({
      kind: 'parsed',
      record: { title: 'مصنوعی ماہ 2026ء', bodyHtml: null, links: [] },
    });
  });

  it('excludes what is not an issue, fails another magazine or a missing title', () => {
    expect(parseIssue(archivePage([]), MAGAZINE_URL)).toEqual({
      kind: 'excluded',
      reason: 'not-a-magazine-issue',
    });
    expect(parseIssue(issuePage(), `${ISSUE_URL}/an-article`)).toEqual({
      kind: 'excluded',
      reason: 'not-a-magazine-issue',
    });
    expect(parseIssue(issuePage(), `${SITE}/other-mags/Synthetic-August-2026`)).toEqual({
      kind: 'failed',
      detail: 'magazine-mismatch',
    });
    const untitled = issuePage({ dlcTitle: null }).replace(
      '<span>مصنوعی ماہ 2026ء</span>',
      '',
    );
    expect(parseIssue(untitled)).toEqual({ kind: 'failed', detail: 'title-missing' });
    expect(parseIssue(issuePage(), ISSUE_URL)).toMatchObject({ kind: 'parsed' });
    expect(
      issueAdapter().parse(
        evidenceOf(issuePage(), ISSUE_URL, 'text/html; charset=iso-8859-1'),
      ),
    ).toEqual({ kind: 'failed', detail: 'unsupported-charset' });
  });
});
