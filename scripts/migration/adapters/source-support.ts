import type { Locale } from '@minhaj/contracts';
import {
  checkSourceUrl,
  type DiscoveredItem,
  type FetchOutcome,
  type MigrationFetchPort,
  type MigrationSourceAdapter,
  type ParsedAsset,
  type ParsedImage,
  type PendingItem,
  type RetrievedEvidence,
} from '@minhaj/contracts/migration';
import type { CheerioAPI } from 'cheerio';

import { readRobots, type RobotsPolicy } from '../robots.ts';

import { cleanText } from './html-source.ts';

/**
 * What every real-source adapter shares (MIGRATION_STRATEGY.md §3.2, §4.1),
 * whatever the site: the site-root check applied at construction, the
 * bounded selection, robots.txt read once per adapter instance, the refusals
 * discovery hands back, discovery over a fixed list of records, the one-GET
 * retrieval, the explicit script rule for a primary locale, and JSON-LD
 * reading. Nothing here knows a site's markup — that stays in each adapter,
 * and the legacy-markup readers several adapters share live in
 * `markup-support.ts`.
 */

/* ===========================================================================
 * Construction
 * ========================================================================= */

/**
 * The Stage-1A representative selection; Stage 1B widens the same numbers
 * over the same registrations, so a record keeps its external key.
 */
export interface SourceSelection {
  /** Listing pages discovery may walk. */
  readonly pages: number;
  /** Items discovery may queue in total. */
  readonly limit: number;
}

const MAX_SELECTION_PAGES = 1000;
const MAX_SELECTION_LIMIT = 100_000;

export function checkSelection(selection: SourceSelection): void {
  if (
    !Number.isInteger(selection.pages) ||
    selection.pages < 1 ||
    selection.pages > MAX_SELECTION_PAGES ||
    !Number.isInteger(selection.limit) ||
    selection.limit < 1 ||
    selection.limit > MAX_SELECTION_LIMIT
  )
    throw new Error(
      'the selection needs whole numbers: 1 ≤ pages ≤ 1000, 1 ≤ limit ≤ 100000',
    );
}

/**
 * The source's base URL: `https`, EXACTLY the adapter's own host, the site
 * root, no query or fragment, acceptable to the SSRF policy — anything else
 * is refused at construction.
 */
export function siteRoot(baseUrl: string, host: string): URL {
  const verdict = checkSourceUrl(baseUrl, [host]);
  if (
    !verdict.ok ||
    verdict.url.protocol !== 'https:' ||
    verdict.url.pathname !== '/' ||
    verdict.url.search !== '' ||
    verdict.url.hash !== ''
  )
    throw new Error(`this adapter serves https://${host}/ only`);
  return verdict.url;
}

/* ===========================================================================
 * Discovery: refusals, robots.txt, a fixed list of records
 * ========================================================================= */

/** A listing the adapter does not recognise: a refusal, never an empty page. */
export function unrecognisedIndex(requestedUrl: string): FetchOutcome {
  return {
    kind: 'refused',
    classification: 'unsupported-type',
    requestedUrl,
    detail: 'index-unrecognised',
  };
}

/** A listing (or every selected record) the source's robots.txt disallows. */
export function robotsDisallowed(requestedUrl: string): FetchOutcome {
  return {
    kind: 'refused',
    classification: 'scope-refused',
    requestedUrl,
    detail: 'robots-disallowed',
  };
}

/**
 * robots.txt, read ONCE per adapter instance. Only a DEFINITIVE answer is
 * cached: a 200 (its rules) or a 4xx (no rules, RFC 9309 §2.3.1.3). Anything
 * else — a 5xx, a redirect left unresolved, a refusal, a network failure or a
 * timeout — is handed back as the outcome, for the pipeline to classify and
 * retry, and is read again next time: an unreadable robots.txt is never
 * taken as permission. Nothing is queued until a policy exists.
 */
export function robotsReader(
  base: URL,
): (
  fetcher: MigrationFetchPort,
) => Promise<
  | { readonly kind: 'policy'; readonly policy: RobotsPolicy }
  | { readonly kind: 'outcome'; readonly outcome: FetchOutcome }
> {
  let cached: RobotsPolicy | null = null;
  return async (fetcher) => {
    if (cached !== null) return { kind: 'policy', policy: cached };
    const { policy, outcome } = await readRobots(fetcher, base.origin);
    const definitive =
      outcome.kind === 'response' &&
      (outcome.status === 200 || (outcome.status >= 400 && outcome.status < 500));
    if (!definitive) return { kind: 'outcome', outcome };
    cached = policy;
    return { kind: 'policy', policy };
  };
}

/**
 * DISCOVERY OVER A FIXED LIST: the operator-named records ARE the source's
 * scope (a magazine's archive, a surah's page), so nothing is fetched but
 * robots.txt. One page, no cursor; at most `limit` items, those robots.txt
 * allows. If it allows none, the run is refused rather than completed empty.
 */
export function fixedItemDiscovery(
  base: URL,
  items: readonly DiscoveredItem[],
  limit: number,
): MigrationSourceAdapter['discover'] {
  const robots = robotsReader(base);
  return async (cursor: string | null, fetcher: MigrationFetchPort) => {
    if (cursor !== null) throw new Error('invalid discovery cursor');
    const gate = await robots(fetcher);
    if (gate.kind === 'outcome') return gate;
    const allowed = items
      .slice(0, limit)
      .filter((item) => gate.policy.allows(item.originalUrl ?? item.externalKey));
    if (allowed.length === 0)
      return {
        kind: 'outcome',
        outcome: robotsDisallowed(items[0]?.externalKey ?? base.toString()),
      } as const;
    return { kind: 'page', items: allowed, next: null } as const;
  };
}

/* ===========================================================================
 * Retrieval
 * ========================================================================= */

/** One GET of the record URL; anything but a 200 is handed back as the outcome. */
export async function retrieveOnce(
  item: PendingItem,
  fetcher: MigrationFetchPort,
): Promise<RetrievedEvidence> {
  const outcome = await fetcher.fetch(item.originalUrl ?? item.externalKey);
  if (outcome.kind !== 'response' || outcome.status !== 200)
    return { kind: 'outcome', outcome };
  return {
    kind: 'evidence',
    requestedUrl: outcome.requestedUrl,
    finalUrl: outcome.finalUrl,
    httpStatus: outcome.status,
    contentType: outcome.contentType,
    headers: outcome.headers,
    body: outcome.body,
  };
}

/* ===========================================================================
 * Reading
 * ========================================================================= */

/** The path of a URL, or null when it does not parse. */
export function pathOf(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

/** Collapsed text, or null when nothing is left. */
export function nonEmpty(value: string | undefined): string | null {
  const text = cleanText(value ?? '');
  return text.length === 0 ? null : text;
}

/**
 * THE PRIMARY-LOCALE RULE for a title, from its SCRIPT plus the record's
 * stated language — never from `<html lang>`:
 *
 *   - Latin letters and NO Arabic-script letter → `en`;
 *   - Arabic-script letters and NO Latin letter → the stated language when it
 *     is `ur` or `ar` (the script alone cannot tell Urdu from Arabic);
 *   - anything else — a title mixing both scripts, no letters, or an
 *     Arabic-script title in another or no stated language → null, and the
 *     adapter reports a parse failure for a person rather than guessing.
 */
export function scriptLocale(title: string, languageCode: string | null): Locale | null {
  let arabic = 0;
  let latin = 0;
  for (const char of title) {
    if (!/\p{L}/u.test(char)) continue;
    if (/\p{Script=Arabic}/u.test(char)) arabic += 1;
    else if (/\p{Script=Latin}/u.test(char)) latin += 1;
  }
  if (latin > 0 && arabic === 0) return 'en';
  if (arabic > 0 && latin === 0 && (languageCode === 'ur' || languageCode === 'ar'))
    return languageCode;
  return null;
}

/** Text escaped for HTML element content — nothing added, nothing removed. */
export function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type JsonObject = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Every JSON-LD object on the page (top level, arrays, `@graph` members and
 * nested objects), in document order. A block that is not valid JSON is
 * skipped: JSON-LD is a signal, never the record's structure.
 */
export function jsonLdObjects($: CheerioAPI): JsonObject[] {
  const found: JsonObject[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 8) return;
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, depth + 1);
      return;
    }
    if (!isObject(value)) return;
    found.push(value);
    for (const nested of Object.values(value)) visit(nested, depth + 1);
  };
  $('script[type="application/ld+json"]').each((_index, element) => {
    try {
      visit(JSON.parse($(element).text()), 0);
    } catch {
      // Not JSON: no signal.
    }
  });
  return found;
}

/** Does a JSON-LD object declare this `@type`? */
export function hasJsonLdType(object: JsonObject, type: string): boolean {
  const declared = object['@type'];
  return declared === type || (Array.isArray(declared) && declared.includes(type));
}

/**
 * A language subtag the page states — JSON-LD `inLanguage` first, then
 * `og:locale` (`ur`, `en_US` → `en`) — or null. `<html lang>` is never read.
 */
export function statedLanguage($: CheerioAPI): string | null {
  const fromLd = jsonLdObjects($)
    .map((object) => object['inLanguage'])
    .find((value): value is string => typeof value === 'string');
  const raw = fromLd ?? $('meta[property="og:locale"]').attr('content') ?? '';
  const subtag = (raw.trim().split(/[-_]/, 1)[0] ?? '').toLowerCase();
  return /^[a-z]{2,3}$/.test(subtag) ? subtag : null;
}

/* ===========================================================================
 * First-party images (Phase 30-R)
 * ========================================================================= */

/** The organisation every authorised source names as its rights holder. */
export const FIRST_PARTY_RIGHTS_HOLDER = 'Minhaj-ul-Quran International';

/**
 * The copyright notice the page itself states for the organisation — its
 * `copyright` meta, else a footer line naming it — or null. This is the rights
 * EVIDENCE an acquisition records; a person still decides each image.
 */
export function copyrightNotice($: CheerioAPI): string | null {
  const meta = nonEmpty($('meta[name="copyright"]').attr('content'));
  if (meta !== null && meta.includes(FIRST_PARTY_RIGHTS_HOLDER)) return meta;
  const footer = cleanText($('body').text()).match(
    /(?:Copyrights?\s*)?©\s*[0-9–-]{4,9}\s*Minhaj-ul-Quran International[^.]{0,60}/u,
  );
  return footer === null ? null : footer[0].trim();
}

/** The raster types an image acquisition may expect from a URL's own name. */
const RASTER_PATH = /\.(?:jpe?g|png)$/i;
/** Phase 30-RF. The same, for a record whose domain also shows a still WebP. */
const RASTER_OR_WEBP_PATH = /\.(?:jpe?g|png|webp)$/i;

/**
 * An image the page presents with its record, as the record's own picture and
 * its acquisition: an absolute `https` URL on one of `hosts` — the source's
 * page hosts and its registered first-party asset hosts, nothing else — whose
 * name says JPEG or PNG, or WebP when `webp` says the receiving domain shows
 * one (Phase 30-RF: a Library cover); Storage refuses an animated or malformed
 * WebP either way. Rights are what the page states: `organisation-owned` with
 * the notice as evidence, else `unknown`, which no person can make public.
 */
export function firstPartyImage(
  $: CheerioAPI,
  input: {
    readonly src: string | undefined;
    readonly alt: string | undefined;
    readonly pageUrl: string;
    readonly hosts: readonly string[];
    readonly webp?: boolean;
  },
): { readonly image: ParsedImage; readonly asset: ParsedAsset } | null {
  const src = nonEmpty(input.src);
  if (src === null) return null;
  let url: URL;
  try {
    url = new URL(src, input.pageUrl);
  } catch {
    return null;
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    !input.hosts.includes(url.hostname) ||
    !(input.webp === true ? RASTER_OR_WEBP_PATH : RASTER_PATH).test(url.pathname)
  )
    return null;
  const href = url.toString();
  const notice = copyrightNotice($);
  return {
    image: { url: href, alt: cleanText(input.alt ?? ''), credit: null },
    asset: {
      url: href,
      licence: notice === null ? 'unknown' : 'organisation-owned',
      licenceEvidence:
        notice === null
          ? null
          : `The official page presents this image as part of the record, served by ${url.hostname}; the page states "${notice}".`,
      rightsHolder: notice === null ? null : FIRST_PARTY_RIGHTS_HOLDER,
    },
  };
}
