import type { CheerioAPI } from 'cheerio';

import {
  canonicalSourceUrl,
  type DiscoveredItem,
  type MigrationFetchPort,
  type MigrationSourceAdapter,
} from '@minhaj/contracts/migration';

import { decodeHtml, loadHtml } from './html-source.ts';
import {
  robotsDisallowed,
  robotsReader,
  unrecognisedIndex,
  type SourceSelection,
} from './source-support.ts';

/**
 * Reading LEGACY SERVER-RENDERED MARKUP, for the adapters whose sites need it
 * (minhaj.org, minhaj.tv, thefatwa.com, minhajbooks.com, minhaj.info):
 *
 *   - discovery over a paginated LISTING (these sites' sitemaps and feeds are
 *     dead or partial), bounded by the operator's selection, honouring
 *     robots.txt;
 *   - exact source slicing, so markup reaches normalisation as the source
 *     wrote it, minus only the non-content chrome an adapter names;
 *   - deterministic reading of the digits and written dates those sites
 *     print.
 *
 * The site-independent pieces (selection, site root, robots.txt, refusals,
 * retrieval, locale rule) are `source-support.ts`'s and are used from there.
 * Nothing here sanitises, guesses or persists.
 */

/* ===========================================================================
 * Discovery over a paginated listing
 * ========================================================================= */

/** A listing or section path segment as the site writes it: no slashes, no dots. */
export function checkSegment(name: string, value: string): string {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,78}[A-Za-z0-9])?$/.test(value))
    throw new Error(`${name} must be a single listing path segment`);
  return value;
}

/** What one listing page offers. */
export interface ListingPage {
  /** Item hrefs, in document order, exactly as written. */
  readonly hrefs: readonly string[];
  /** Listing page numbers the page's pagination links to. */
  readonly pageLinks: readonly number[];
  /**
   * True when `pageLinks` holds only the page's NEXT link (a site with a
   * "Next" link but no page numbers): then, when discovery follows it, it
   * must name exactly the following page.
   */
  readonly nextOnly?: true;
}

export interface ListingDiscoveryOptions {
  readonly base: URL;
  readonly selection: SourceSelection;
  /** The absolute URL of listing page `page` (1-based). */
  listingUrl(page: number): string;
  /** The page's items and pagination, or null when it is not this listing. */
  readListing($: CheerioAPI, finalUrl: string): ListingPage | null;
  /** The item an own-host https URL names, or null when it names no item of this kind. */
  itemOf(url: URL): DiscoveredItem | null;
}

const CURSOR_PATTERN = /^([1-9][0-9]{0,4}):(0|[1-9][0-9]{0,5})$/;

/**
 * DISCOVERY, one listing page per call. The cursor is `{page}:{queued}` —
 * the next listing page and how many items earlier pages already gave — so
 * a resumed run honours the same `limit` without remembering anything else.
 * A cursor this discovery could not have issued for the selection (including
 * one written under a wider selection since narrowed) is refused.
 *
 * Only own-host `https` links that name an item of this kind are queued,
 * deduplicated by legacy identifier (else key), never one robots.txt
 * disallows; a listing robots.txt disallows is refused, as is a page whose
 * every item it disallows.
 *
 * A page the adapter cannot recognise — no listing, no item of this kind, or
 * a pagination that does not lead to the following page — is a REFUSAL, never
 * an empty page: an empty page would complete discovery and mark every record
 * of the source missing.
 */
export function createListingDiscovery(
  options: ListingDiscoveryOptions,
): MigrationSourceAdapter['discover'] {
  const { base, selection } = options;
  const robots = robotsReader(base);

  return async (cursor: string | null, fetcher: MigrationFetchPort) => {
    let page = 1;
    let queued = 0;
    if (cursor !== null) {
      const match = CURSOR_PATTERN.exec(cursor);
      if (match === null) throw new Error('invalid discovery cursor');
      page = Number(match[1]);
      queued = Number(match[2]);
      if (page < 2 || page > selection.pages || queued >= selection.limit)
        throw new Error('invalid discovery cursor');
    }

    const gate = await robots(fetcher);
    if (gate.kind === 'outcome') return gate;
    const policy = gate.policy;
    const listingUrl = options.listingUrl(page);
    if (!policy.allows(listingUrl))
      return { kind: 'outcome', outcome: robotsDisallowed(listingUrl) } as const;

    const outcome = await fetcher.fetch(listingUrl);
    if (outcome.kind !== 'response' || outcome.status !== 200)
      return { kind: 'outcome', outcome } as const;
    const refuse = {
      kind: 'outcome',
      outcome: unrecognisedIndex(outcome.requestedUrl),
    } as const;
    const decoded = decodeHtml(outcome.body, outcome.contentType);
    if (!decoded.ok) return refuse;
    const listing = options.readListing(loadHtml(decoded.html), outcome.finalUrl);
    if (listing === null || listing.hrefs.length === 0) return refuse;

    // Items of this kind on the source's own host, in listing order.
    const candidates: DiscoveredItem[] = [];
    for (const href of listing.hrefs) {
      let target: URL;
      try {
        target = new URL(href, outcome.finalUrl);
      } catch {
        continue;
      }
      if (target.hostname !== base.hostname || target.protocol !== 'https:') continue;
      const item = options.itemOf(target);
      if (item !== null) candidates.push(item);
    }
    // A listing with no item of this kind is not this listing (an audio
    // listing given to the video adapter, a redesigned page).
    if (candidates.length === 0) return refuse;
    const allowed = candidates.filter((item) =>
      policy.allows(item.originalUrl ?? item.externalKey),
    );
    if (allowed.length === 0)
      return {
        kind: 'outcome',
        outcome: robotsDisallowed(outcome.requestedUrl),
      } as const;

    const remaining = selection.limit - queued;
    const items: DiscoveredItem[] = [];
    const seen = new Set<string>();
    for (const item of allowed) {
      if (items.length >= remaining) break;
      const identity = item.legacyIdentifier ?? item.externalKey;
      if (seen.has(identity)) continue;
      seen.add(identity);
      items.push(item);
    }

    const total = queued + items.length;
    let next: string | null = null;
    if (total < selection.limit && page < selection.pages) {
      const later = listing.pageLinks.filter((linked) => linked > page);
      const leads = listing.nextOnly
        ? listing.pageLinks.every((linked) => linked === page + 1)
        : later.includes(page + 1);
      if (later.length > 0 || (listing.nextOnly && listing.pageLinks.length > 0)) {
        // A pagination that does not lead to the following page cannot be
        // walked faithfully.
        if (!leads) return refuse;
        next = `${page + 1}:${total}`;
      }
    }
    return { kind: 'page', items, next } as const;
  };
}

/**
 * The listing page numbers that pagination hrefs name: `{listingPath}` itself
 * is page 1, `{listingPath}page/{n}` (with or without a trailing slash) is n.
 */
export function pageNumbersOf(
  hrefs: readonly string[],
  finalUrl: string,
  base: URL,
  listingPath: string,
): number[] {
  const pages = new Set<number>();
  for (const href of hrefs) {
    let url: URL;
    try {
      url = new URL(href, finalUrl);
    } catch {
      continue;
    }
    if (url.hostname !== base.hostname) continue;
    if (url.pathname === listingPath) {
      pages.add(1);
      continue;
    }
    if (!url.pathname.startsWith(listingPath)) continue;
    const match = /^page\/([1-9][0-9]{0,4})\/?$/.exec(
      url.pathname.slice(listingPath.length),
    );
    if (match) pages.add(Number(match[1]));
  }
  return [...pages].sort((a, b) => a - b);
}

/** The canonical external key of `path` on the source's own origin. */
export function keyOf(base: URL, path: string): string {
  return canonicalSourceUrl(new URL(path, base.origin));
}

/* ===========================================================================
 * Exact source slicing
 * ========================================================================= */

/** A half-open range of offsets into the decoded document. */
export interface SourceRange {
  readonly start: number;
  readonly end: number;
}

interface LocatedNode {
  readonly type?: string;
  readonly children?: readonly LocatedNode[];
  readonly sourceCodeLocation?: {
    readonly startOffset?: number;
    readonly endOffset?: number;
    readonly startTag?: { readonly endOffset: number } | undefined;
    readonly endTag?:
      { readonly startOffset: number; readonly endOffset: number } | undefined;
  } | null;
}

/** The node's whole source, tags included. */
export function outerRange(node: unknown): SourceRange | null {
  const location = (node as LocatedNode | undefined)?.sourceCodeLocation;
  if (
    location === null ||
    location === undefined ||
    location.startOffset === undefined ||
    location.endOffset === undefined
  )
    return null;
  return { start: location.startOffset, end: location.endOffset };
}

/**
 * The element's content: from the end of its start tag to the start of its
 * end tag, or — where the source omitted the end tag — to where the parser
 * closed it.
 */
export function innerRange(node: unknown): SourceRange | null {
  const location = (node as LocatedNode | undefined)?.sourceCodeLocation;
  if (location?.startTag === undefined) return null;
  const end = location.endTag?.startOffset ?? location.endOffset;
  if (end === undefined) return null;
  return { start: location.startTag.endOffset, end };
}

/** The element's end tag, when the source wrote one. */
export function endTagRange(node: unknown): SourceRange | null {
  const tag = (node as LocatedNode | undefined)?.sourceCodeLocation?.endTag;
  return tag === undefined ? null : { start: tag.startOffset, end: tag.endOffset };
}

/** Every HTML comment at or below `node`. */
export function commentRanges(node: unknown): SourceRange[] {
  const ranges: SourceRange[] = [];
  const walk = (current: LocatedNode) => {
    if (current.type === 'comment') {
      const range = outerRange(current);
      if (range !== null) ranges.push(range);
      return;
    }
    for (const child of current.children ?? []) walk(child);
  };
  walk(node as LocatedNode);
  return ranges;
}

/**
 * The exact source of `range` with the `excluded` ranges cut out. Every kept
 * character is the source's own; nothing is re-serialised.
 */
export function sliceExcluding(
  html: string,
  range: SourceRange,
  excluded: readonly SourceRange[],
): string {
  const cuts = excluded
    .map((cut) => ({
      start: Math.max(cut.start, range.start),
      end: Math.min(cut.end, range.end),
    }))
    .filter((cut) => cut.start < cut.end)
    .sort((a, b) => a.start - b.start);
  let text = '';
  let position = range.start;
  for (const cut of cuts) {
    if (cut.start > position) text += html.slice(position, cut.start);
    position = Math.max(position, cut.end);
  }
  if (position < range.end) text += html.slice(position, range.end);
  return text;
}

/* ===========================================================================
 * Text and dates
 * ========================================================================= */

/** Arabic-Indic and Extended (Persian/Urdu) digits as ASCII, for reading numbers only. */
export function asciiDigits(text: string): string {
  return text.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (digit) =>
    String((digit.codePointAt(0) ?? 0) & 0xf),
  );
}

/** A real calendar date as `YYYY-MM-DD`, or null. */
export function calendarDate(year: number, month: number, day: number): string | null {
  if (year < 1000 || year > 2999 || month < 1 || month > 12 || day < 1) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** An ISO `YYYY-MM-DD` the source wrote, if it is a real date. */
export function isoDateOf(text: string | undefined): string | null {
  const match = /^\s*([0-9]{4})-([0-9]{2})-([0-9]{2})\s*$/.exec(text ?? '');
  if (match === null) return null;
  return calendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

/**
 * Month names as these sites print them. Urdu and Arabic keys are FOLDED
 * (Arabic yeh/kaf to their Urdu forms) for lookup only — the source's text is
 * never changed.
 */
const MONTHS: ReadonlyMap<string, number> = new Map(
  (
    [
      ['january', 1],
      ['jan', 1],
      ['february', 2],
      ['feb', 2],
      ['march', 3],
      ['mar', 3],
      ['april', 4],
      ['apr', 4],
      ['may', 5],
      ['june', 6],
      ['jun', 6],
      ['july', 7],
      ['jul', 7],
      ['august', 8],
      ['aug', 8],
      ['september', 9],
      ['sep', 9],
      ['sept', 9],
      ['october', 10],
      ['oct', 10],
      ['november', 11],
      ['nov', 11],
      ['december', 12],
      ['dec', 12],
      // Urdu
      ['جنوری', 1],
      ['فروری', 2],
      ['مارچ', 3],
      ['اپریل', 4],
      ['مئی', 5],
      ['جون', 6],
      ['جولائی', 7],
      ['اگست', 8],
      ['ستمبر', 9],
      ['اکتوبر', 10],
      ['نومبر', 11],
      ['دسمبر', 12],
      // Arabic (Gregorian month names)
      ['يناير', 1],
      ['فبراير', 2],
      ['مارس', 3],
      ['أبريل', 4],
      ['ابريل', 4],
      ['إبريل', 4],
      ['مايو', 5],
      ['يونيو', 6],
      ['يوليو', 7],
      ['أغسطس', 8],
      ['اغسطس', 8],
      ['سبتمبر', 9],
      ['أكتوبر', 10],
      ['اكتوبر', 10],
      ['نوفمبر', 11],
      ['ديسمبر', 12],
    ] as const
  ).map(([name, month]) => [foldMonth(name), month]),
);

function foldMonth(name: string): string {
  return name.toLowerCase().replace(/[يى]/g, 'ی').replace(/ك/g, 'ک');
}

/**
 * A WRITTEN date, deterministically: `YYYY-MM-DD`, `23 October 2026`,
 * `October 23, 2026`, `31 دسمبر 2026ء`, `25 يناير 2026ء`. Anything else —
 * a month and year only, an unknown month name, an impossible date — is
 * null: a date is never guessed.
 */
export function writtenDateOf(text: string | undefined): string | null {
  const value = asciiDigits(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    // The Urdu/Arabic year mark (hamza) printed after the year.
    .replace(/\s*ء$/, '');
  const iso = isoDateOf(value);
  if (iso !== null) return iso;
  const dayFirst = /^([0-9]{1,2})\s+([^\s,0-9]+),?\s+([0-9]{4})$/.exec(value);
  if (dayFirst) {
    const month = MONTHS.get(foldMonth(dayFirst[2] ?? ''));
    return month === undefined
      ? null
      : calendarDate(Number(dayFirst[3]), month, Number(dayFirst[1]));
  }
  const monthFirst = /^([^\s,0-9]+)\.?\s+([0-9]{1,2}),?\s+([0-9]{4})$/.exec(value);
  if (monthFirst) {
    const month = MONTHS.get(foldMonth(monthFirst[1] ?? ''));
    return month === undefined
      ? null
      : calendarDate(Number(monthFirst[3]), month, Number(monthFirst[2]));
  }
  return null;
}
