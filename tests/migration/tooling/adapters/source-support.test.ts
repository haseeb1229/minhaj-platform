import { describe, expect, it } from 'vitest';

import { loadHtml } from '../../../../scripts/migration/adapters/html-source.ts';
import {
  checkSelection,
  escapeHtmlText,
  fixedItemDiscovery,
  hasJsonLdType,
  jsonLdObjects,
  nonEmpty,
  pathOf,
  retrieveOnce,
  robotsDisallowed,
  robotsReader,
  scriptLocale,
  siteRoot,
  statedLanguage,
  unrecognisedIndex,
} from '../../../../scripts/migration/adapters/source-support.ts';

import { fakeSite, htmlPage, pendingItem, textFile } from './fake-site.ts';

/** The site-independent pieces every real-source adapter shares, on their own. */

const BASE = new URL('https://www.synthetic-source.example/');
const ROBOTS = `${BASE.origin}/robots.txt`;

describe('construction', () => {
  it('accepts whole-number selections within bounds only', () => {
    expect(() => checkSelection({ pages: 1, limit: 1 })).not.toThrow();
    expect(() => checkSelection({ pages: 1000, limit: 100_000 })).not.toThrow();
    for (const selection of [
      { pages: 0, limit: 1 },
      { pages: 1001, limit: 1 },
      { pages: 1, limit: 0 },
      { pages: 1, limit: 100_001 },
      { pages: 1.5, limit: 1 },
      { pages: 1, limit: Number.NaN },
    ])
      expect(() => checkSelection(selection)).toThrow(/selection/);
  });

  it('accepts exactly the https site root of the adapter’s own host', () => {
    expect(
      siteRoot('https://www.synthetic-source.example/', BASE.hostname).toString(),
    ).toBe('https://www.synthetic-source.example/');
    for (const baseUrl of [
      'http://www.synthetic-source.example/',
      'https://synthetic-source.example/',
      'https://www.synthetic-source.example/english/',
      'https://www.synthetic-source.example/?a=1',
      'https://www.synthetic-source.example/#top',
      'https://user:pw@www.synthetic-source.example/',
      'https://www.synthetic-source.example:8443/',
      'https://127.0.0.1/',
      'not a url',
    ])
      expect(() => siteRoot(baseUrl, BASE.hostname)).toThrow(/only/);
  });
});

describe('robots.txt', () => {
  it('caches a 200 policy: read once per reader', async () => {
    const site = fakeSite({ [ROBOTS]: textFile('User-agent: *\nDisallow: /private/\n') });
    const read = robotsReader(BASE);
    const first = await read(site.fetcher);
    const second = await read(site.fetcher);
    if (first.kind !== 'policy' || second.kind !== 'policy')
      throw new Error('expected a policy');
    expect(first.policy.allows(`${BASE.origin}/private/x`)).toBe(false);
    expect(first.policy.allows(`${BASE.origin}/public/x`)).toBe(true);
    expect(site.requested).toEqual([ROBOTS]);
  });

  it('caches a 4xx as no rules', async () => {
    const site = fakeSite({});
    const read = robotsReader(BASE);
    const result = await read(site.fetcher);
    if (result.kind !== 'policy') throw new Error('expected a policy');
    expect(result.policy.allows(`${BASE.origin}/anything`)).toBe(true);
    await read(site.fetcher);
    expect(site.requested).toEqual([ROBOTS]);
  });

  it('hands back every indefinite answer uncached, so it is read again', async () => {
    for (const route of [
      htmlPage('', { status: 503 }),
      htmlPage('', { status: 301 }),
      (url: string) => ({
        kind: 'refused' as const,
        classification: 'redirect-refused' as const,
        requestedUrl: url,
        detail: 'synthetic',
      }),
      (url: string) => ({
        kind: 'failure' as const,
        classification: 'timeout' as const,
        requestedUrl: url,
        detail: 'synthetic',
      }),
    ]) {
      const site = fakeSite({ [ROBOTS]: route });
      const read = robotsReader(BASE);
      expect((await read(site.fetcher)).kind).toBe('outcome');
      site.set(ROBOTS, textFile('User-agent: *\nAllow: /\n'));
      expect((await read(site.fetcher)).kind).toBe('policy');
      expect(site.requested).toEqual([ROBOTS, ROBOTS]);
    }
  });

  it('names its refusals', () => {
    expect(robotsDisallowed('u')).toEqual({
      kind: 'refused',
      classification: 'scope-refused',
      requestedUrl: 'u',
      detail: 'robots-disallowed',
    });
    expect(unrecognisedIndex('u')).toEqual({
      kind: 'refused',
      classification: 'unsupported-type',
      requestedUrl: 'u',
      detail: 'index-unrecognised',
    });
  });
});

describe('discovery over a fixed list', () => {
  const items = [1, 2, 3].map((n) => ({
    externalKey: `${BASE.origin}/record/${n}`,
    originalUrl: `${BASE.origin}/record/${n}`,
    legacyIdentifier: `record-${n}`,
  }));

  it('queues at most `limit` items robots.txt allows, on one page', async () => {
    const site = fakeSite({ [ROBOTS]: textFile('User-agent: *\nDisallow: /record/2\n') });
    expect(await fixedItemDiscovery(BASE, items, 2)(null, site.fetcher)).toEqual({
      kind: 'page',
      items: [items[0]],
      next: null,
    });
    expect(await fixedItemDiscovery(BASE, items, 3)(null, site.fetcher)).toEqual({
      kind: 'page',
      items: [items[0], items[2]],
      next: null,
    });
  });

  it('refuses when robots.txt allows none, and refuses any cursor', async () => {
    const site = fakeSite({ [ROBOTS]: textFile('User-agent: *\nDisallow: /\n') });
    expect(await fixedItemDiscovery(BASE, items, 3)(null, site.fetcher)).toEqual({
      kind: 'outcome',
      outcome: robotsDisallowed(items[0]?.externalKey ?? ''),
    });
    await expect(fixedItemDiscovery(BASE, items, 3)('2:0', site.fetcher)).rejects.toThrow(
      /cursor/,
    );
  });

  it('hands back an unreadable robots.txt', async () => {
    const site = fakeSite({ [ROBOTS]: htmlPage('', { status: 500 }) });
    expect(await fixedItemDiscovery(BASE, items, 3)(null, site.fetcher)).toMatchObject({
      kind: 'outcome',
      outcome: { kind: 'response', status: 500 },
    });
  });
});

describe('retrieval', () => {
  it('is one GET; anything but a 200 is the outcome', async () => {
    const url = `${BASE.origin}/record/1`;
    const site = fakeSite({
      [url]: htmlPage('<p>Synthetic</p>', { finalUrl: `${BASE.origin}/record/1/x` }),
    });
    expect(await retrieveOnce(pendingItem(url, null), site.fetcher)).toMatchObject({
      kind: 'evidence',
      requestedUrl: url,
      finalUrl: `${BASE.origin}/record/1/x`,
      httpStatus: 200,
    });
    expect(
      await retrieveOnce(pendingItem(`${BASE.origin}/record/2`, null), site.fetcher),
    ).toMatchObject({ kind: 'outcome', outcome: { kind: 'response', status: 404 } });
    expect(site.requested).toHaveLength(2);
  });
});

describe('reading', () => {
  it('reads paths and non-empty text', () => {
    expect(pathOf('https://www.synthetic-source.example/a/b?c=1')).toBe('/a/b');
    expect(pathOf('not a url')).toBeNull();
    expect(nonEmpty('  Synthetic   words ')).toBe('Synthetic words');
    expect(nonEmpty(' \n ')).toBeNull();
    expect(nonEmpty(undefined)).toBeNull();
  });

  it('decides a primary locale from the title script, never by guess', () => {
    expect(scriptLocale('Synthetic Title', null)).toBe('en');
    expect(scriptLocale('Synthetic Title 2', 'ur')).toBe('en');
    expect(scriptLocale('نمونہ عنوان', 'ur')).toBe('ur');
    expect(scriptLocale('عنوان تجريبي', 'ar')).toBe('ar');
    // The script alone cannot tell Urdu from Arabic.
    expect(scriptLocale('نمونہ عنوان', null)).toBeNull();
    expect(scriptLocale('نمونہ عنوان', 'en')).toBeNull();
    // A title in both scripts, or with no letters, is for a person to decide.
    expect(scriptLocale('Synthetic (نمونہ)', 'ur')).toBeNull();
    expect(scriptLocale('Synthetic (نمونہ)', null)).toBeNull();
    expect(scriptLocale('123 — 456', 'en')).toBeNull();
  });

  it('escapes text for HTML content and nothing else', () => {
    expect(escapeHtmlText(`Synthetic <b>"a" & 'b'</b>`)).toBe(
      'Synthetic &lt;b&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/b&gt;',
    );
    expect(escapeHtmlText('نمونہ')).toBe('نمونہ');
  });

  it('reads JSON-LD objects, types and the stated language', () => {
    const $ = loadHtml(`<!doctype html><html lang="en"><head>
<meta property="og:locale" content="en_US">
<script type="application/ld+json">{"@graph":[{"@type":["Article","Thing"],"inLanguage":"ur","isPartOf":{"@type":"PublicationIssue","issueNumber":7}}]}</script>
<script type="application/ld+json">not json</script>
</head><body></body></html>`);
    const objects = jsonLdObjects($);
    expect(objects.some((object) => hasJsonLdType(object, 'Article'))).toBe(true);
    expect(
      objects.find((object) => hasJsonLdType(object, 'PublicationIssue'))?.[
        'issueNumber'
      ],
    ).toBe(7);
    expect(objects.some((object) => hasJsonLdType(object, 'Book'))).toBe(false);
    // JSON-LD first; og:locale only without it; <html lang> never.
    expect(statedLanguage($)).toBe('ur');
    expect(
      statedLanguage(
        loadHtml('<html lang="ur"><meta property="og:locale" content="en_US">'),
      ),
    ).toBe('en');
    expect(statedLanguage(loadHtml('<html lang="ur"><p>x</p></html>'))).toBeNull();
  });
});
