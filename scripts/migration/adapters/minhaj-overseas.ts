import type {
  DiscoveredItem,
  MigrationSourceAdapter,
  ParseResult,
  ParsedCountry,
} from '@minhaj/contracts/migration';

import { decodeHtml, loadHtml } from './html-source.ts';
import { createListingDiscovery, keyOf } from './markup-support.ts';
import {
  checkSelection,
  pathOf,
  retrieveOnce,
  siteRoot,
  type SourceSelection,
} from './source-support.ts';

/**
 * MINHAJ OVERSEAS (Phase 30-R) — the Directorate of Foreign Affairs' official
 * site, linked from minhaj.org's own contact page, and its page "MQI in
 * different Countries of the world": the countries the organisation itself
 * states it is present in, as `global.country`.
 *
 *   discover — that ONE page (`/english/tid/32789/`): each visible country
 *              link `/english/{Country}/` whose name is in the fixed table
 *              below. Commented-out links are not links (the parser does not
 *              see them), so a country the page hides is never read.
 *   key      — the country's own page, `https://minhajoverseas.com/english/{Country}/`.
 *   parse    — the country page is fetched as the record's evidence and legacy
 *              address; its name and ISO 3166-1 alpha-2 code come from the FIXED
 *              table keyed by the page's path — the name exactly as the listing
 *              writes it. A path not in the table is no country: never guessed.
 *              "Korea" is deliberately absent — it does not say which Korea.
 */

export const MINHAJ_OVERSEAS_ADAPTER_KEY = 'minhaj-overseas-country';
export const MINHAJ_OVERSEAS_HOST = 'minhajoverseas.com';
export const MINHAJ_OVERSEAS_BASE_URL = `https://${MINHAJ_OVERSEAS_HOST}/`;
export const MINHAJ_OVERSEAS_LISTING = '/english/tid/32789/';

/** Path segment → the name the listing writes and the ISO 3166-1 alpha-2 code. */
export const MINHAJ_OVERSEAS_COUNTRIES: Readonly<
  Record<string, { readonly name: string; readonly code: string }>
> = Object.freeze({
  Australia: { name: 'Australia', code: 'AU' },
  Austria: { name: 'Austria', code: 'AT' },
  Bahrain: { name: 'Bahrain', code: 'BH' },
  Bangladesh: { name: 'Bangladesh', code: 'BD' },
  Canada: { name: 'Canada', code: 'CA' },
  Denmark: { name: 'Denmark', code: 'DK' },
  Egypt: { name: 'Egypt', code: 'EG' },
  Finland: { name: 'Finland', code: 'FI' },
  France: { name: 'France', code: 'FR' },
  Germany: { name: 'Germany', code: 'DE' },
  Greece: { name: 'Greece', code: 'GR' },
  'Hong-Kong': { name: 'Hong Kong', code: 'HK' },
  India: { name: 'India', code: 'IN' },
  Indonesia: { name: 'Indonesia', code: 'ID' },
  Iran: { name: 'Iran', code: 'IR' },
  Ireland: { name: 'Ireland', code: 'IE' },
  Italy: { name: 'Italy', code: 'IT' },
  Japan: { name: 'Japan', code: 'JP' },
  Jordan: { name: 'Jordan', code: 'JO' },
  Malaysia: { name: 'Malaysia', code: 'MY' },
  Netherlands: { name: 'Netherlands', code: 'NL' },
  Norway: { name: 'Norway', code: 'NO' },
  Philippines: { name: 'Philippines', code: 'PH' },
  'South-Africa': { name: 'South Africa', code: 'ZA' },
  Spain: { name: 'Spain', code: 'ES' },
  Sweden: { name: 'Sweden', code: 'SE' },
  Taiwan: { name: 'Taiwan', code: 'TW' },
  Turkey: { name: 'Turkey', code: 'TR' },
  UAE: { name: 'UAE', code: 'AE' },
  UK: { name: 'UK', code: 'GB' },
});

const COUNTRY_PATH = /^\/english\/([A-Za-z]+(?:-[A-Za-z]+)*)\/$/;

export interface MinhajOverseasCountryAdapterOptions {
  readonly baseUrl?: string;
  readonly selection: SourceSelection;
}

export function createMinhajOverseasCountryAdapter(
  options: MinhajOverseasCountryAdapterOptions,
): MigrationSourceAdapter {
  const base = siteRoot(
    options.baseUrl ?? MINHAJ_OVERSEAS_BASE_URL,
    MINHAJ_OVERSEAS_HOST,
  );
  checkSelection(options.selection);
  const listingUrl = new URL(MINHAJ_OVERSEAS_LISTING, base).toString();

  const discover = createListingDiscovery({
    base,
    selection: { pages: 1, limit: options.selection.limit },
    listingUrl: () => listingUrl,
    readListing($) {
      const hrefs: string[] = [];
      $('a[href]').each((_index, anchor) => {
        const href = $(anchor).attr('href') ?? '';
        const segment = COUNTRY_PATH.exec(href)?.[1];
        if (segment === undefined) return;
        const known = MINHAJ_OVERSEAS_COUNTRIES[segment];
        // A link is a country of the list only when it says that country's name.
        if (known !== undefined && $(anchor).text().trim() === known.name)
          hrefs.push(href);
      });
      return { hrefs, pageLinks: [] };
    },
    itemOf(target): DiscoveredItem | null {
      const segment = COUNTRY_PATH.exec(target.pathname)?.[1];
      if (segment === undefined || MINHAJ_OVERSEAS_COUNTRIES[segment] === undefined)
        return null;
      const externalKey = keyOf(base, `/english/${segment}/`);
      return {
        externalKey,
        originalUrl: externalKey,
        legacyIdentifier: `country-${segment}`,
      };
    },
  });

  return {
    adapterKey: MINHAJ_OVERSEAS_ADAPTER_KEY,
    adapterVersion: '1',
    parserKey: 'cheerio-minhaj-overseas-country',
    parserVersion: '1',
    contentKind: 'global.country',
    accessMethod: 'http',
    discover,
    retrieve: retrieveOnce,

    parse(evidence): ParseResult {
      const decoded = decodeHtml(evidence.body, evidence.contentType);
      if (!decoded.ok) return { kind: 'failed', detail: decoded.detail };
      const segment = COUNTRY_PATH.exec(pathOf(evidence.finalUrl) ?? '')?.[1];
      const known =
        segment === undefined ? undefined : MINHAJ_OVERSEAS_COUNTRIES[segment];
      if (segment === undefined || known === undefined)
        return { kind: 'excluded', reason: 'not-a-listed-country' };
      // The page must be the site's own page, not an error template.
      if (loadHtml(decoded.html)('body').length !== 1)
        return { kind: 'failed', detail: 'record-structure-missing' };
      const record: ParsedCountry = {
        kind: 'global.country',
        title: known.name,
        code: known.code,
        primaryLocale: 'en',
        languageCode: 'en',
        publishedOn: null,
        legacyIdentifier: `country-${segment}`,
        categories: [],
        links: [],
        assets: [],
      };
      return { kind: 'parsed', record };
    },
  };
}
