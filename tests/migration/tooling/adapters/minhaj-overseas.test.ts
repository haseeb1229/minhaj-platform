import { describe, expect, it } from 'vitest';

import {
  createMinhajOverseasCountryAdapter,
  MINHAJ_OVERSEAS_ADAPTER_KEY,
  MINHAJ_OVERSEAS_COUNTRIES,
  MINHAJ_OVERSEAS_LISTING,
} from '../../../../scripts/migration/adapters/minhaj-overseas.ts';

import { evidenceOf, fakeSite, htmlPage, textFile } from './fake-site.ts';

/**
 * The Minhaj Overseas countries adapter (Phase 30-R) over a SYNTHETIC listing
 * shaped like the real "countries" page: visible country links, commented-out
 * ones, chrome links that share the path shape, and a link whose text does
 * not say its country.
 */

const SITE = 'https://minhajoverseas.com';
const LISTING_URL = `${SITE}${MINHAJ_OVERSEAS_LISTING}`;

function listing(): string {
  return `<!doctype html><html lang="en"><body>
<nav><a href="/english/News/">News &amp; Events</a><a href="/english/Contact-Us/">Contact Us</a></nav>
<div class="entry_content">
<a href="/english/Australia/">Australia</a>
<a href="/english/Hong-Kong/">Hong Kong</a>
<a href="/english/Denmark/">Denmark</a>
<a href="/english/Korea/">Korea</a>
<a href="/english/UK/">Synthetic United Kingdom</a>
<a href="https://other.example/english/Spain/">Spain</a>
<!-- <a href="/english/Belgium/">Belgium</a> -->
<a href="/english/Australia/">Australia</a>
</div></body></html>`;
}

function site() {
  return fakeSite({
    [`${SITE}/robots.txt`]: htmlPage('not found', { status: 404 }),
    [LISTING_URL]: htmlPage(listing()),
  });
}

const adapter = (limit = 50) =>
  createMinhajOverseasCountryAdapter({ selection: { pages: 1, limit } });

describe('identity', () => {
  it('declares what it is, and stays on its own host', () => {
    expect(adapter()).toMatchObject({
      adapterKey: MINHAJ_OVERSEAS_ADAPTER_KEY,
      contentKind: 'global.country',
      accessMethod: 'http',
    });
    expect(() =>
      createMinhajOverseasCountryAdapter({
        baseUrl: 'https://www.minhajoverseas.com/',
        selection: { pages: 1, limit: 5 },
      }),
    ).toThrow();
  });

  it('keeps a fixed, unambiguous table: ISO codes, and no "Korea"', () => {
    const codes = Object.values(MINHAJ_OVERSEAS_COUNTRIES).map((entry) => entry.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[A-Z]{2}$/);
    expect(MINHAJ_OVERSEAS_COUNTRIES['Korea']).toBeUndefined();
  });
});

describe('discovery', () => {
  it('takes only the visible table countries whose link says their name', async () => {
    const result = await adapter().discover(null, site().fetcher);
    expect(result).toEqual({
      kind: 'page',
      next: null,
      items: [
        {
          externalKey: `${SITE}/english/Australia/`,
          originalUrl: `${SITE}/english/Australia/`,
          legacyIdentifier: 'country-Australia',
        },
        {
          externalKey: `${SITE}/english/Hong-Kong/`,
          originalUrl: `${SITE}/english/Hong-Kong/`,
          legacyIdentifier: 'country-Hong-Kong',
        },
        {
          externalKey: `${SITE}/english/Denmark/`,
          originalUrl: `${SITE}/english/Denmark/`,
          legacyIdentifier: 'country-Denmark',
        },
      ],
    });
  });

  it('honours the limit, and a missing robots.txt allows (RFC 9309)', async () => {
    const source = site();
    const result = await adapter(2).discover(null, source.fetcher);
    expect(result.kind === 'page' && result.items).toHaveLength(2);
    expect(source.requested).toEqual([`${SITE}/robots.txt`, LISTING_URL]);
  });

  it('refuses a listing robots.txt disallows', async () => {
    const source = fakeSite({
      [`${SITE}/robots.txt`]: textFile('User-agent: *\nDisallow: /english/\n'),
      [LISTING_URL]: htmlPage(listing()),
    });
    expect(await adapter().discover(null, source.fetcher)).toMatchObject({
      kind: 'outcome',
      outcome: { detail: 'robots-disallowed' },
    });
  });
});

describe('parse', () => {
  it('names the country and its code from the fixed table, by the page path', () => {
    expect(
      adapter().parse(
        evidenceOf('<html><body>news</body></html>', `${SITE}/english/Hong-Kong/`),
      ),
    ).toEqual({
      kind: 'parsed',
      record: {
        kind: 'global.country',
        title: 'Hong Kong',
        code: 'HK',
        primaryLocale: 'en',
        languageCode: 'en',
        publishedOn: null,
        legacyIdentifier: 'country-Hong-Kong',
        categories: [],
        links: [],
        assets: [],
      },
    });
  });

  it('excludes a path the table does not name — never guessing a country', () => {
    for (const path of ['/english/Korea/', '/english/Atlantis/', '/english/tid/1/', '/'])
      expect(
        adapter().parse(evidenceOf('<html><body>x</body></html>', `${SITE}${path}`)),
      ).toEqual({ kind: 'excluded', reason: 'not-a-listed-country' });
  });
});
