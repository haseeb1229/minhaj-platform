import { localizedPath } from '@minhaj/contracts';

/**
 * THE TOPIC HUBS' TOLERANT READERS AND THE ONE-ADDRESS RULE (Quran Parts
 * 10–13; shared by the Quran and Hadith hubs since Hadith Part 1) — pure, so
 * every hub's address rules (`./books-view`, `./videos-view`,
 * `./research-view`, `./courses-view`) read and write their GET parameters
 * the same way, proved by unit test.
 *
 * TOLERANT, NEVER TRUSTING. One value of one parameter, a whole number in
 * range, an identifier, a content-language code — anything else is absent,
 * never an error page; what a hub builds from it is parsed again by its
 * owner's read service, the authoritative boundary.
 */

export type Query = Record<string, string | string[] | undefined>;

export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
/** Taxonomy's language-code shape (`libraryLanguageCodeSchema`). */
export const LANGUAGE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u;

export function single(query: Query, key: string, max: number): string | null {
  const raw = query[key];
  return typeof raw === 'string' && raw !== '' && raw.length <= max ? raw : null;
}

export function whole(text: string | null, min: number, max: number): number | null {
  if (text === null || !/^\d{1,5}$/u.test(text)) return null;
  const value = Number(text);
  return value >= min && value <= max ? value : null;
}

/** An identifier parameter, folded to lower case, or null. */
export function identifier(query: Query, key: string): string | null {
  const value = single(query, key, 64);
  return value !== null && UUID.test(value) ? value.toLowerCase() : null;
}

/** A content-language parameter, or null. */
export function language(query: Query): string | null {
  const value = single(query, 'language', 16);
  return value !== null && LANGUAGE.test(value) ? value : null;
}

/* ---- Names: a first-letter index and a name search ----------------------
 * Library Part 2's contributor directory first; shared with Watch Part 2's
 * speakers, so the two directories index and search names by ONE rule.
 */

/** The longest name search a directory reads. */
const NAME_QUERY_MAX = 60;

/** The initial a name is indexed under: its first letter, upper case, else `#`. */
export function initialOf(name: string, locale: string): string {
  const first = [...name.trim().normalize('NFC')][0];
  if (first === undefined || !/\p{L}/u.test(first)) return '#';
  return first.toLocaleUpperCase(locale);
}

/** A `?letter` parameter as one initial: a single letter (upper-cased) or `#`. */
export function letterOf(query: Query, locale: string): string | null {
  const value = single(query, 'letter', 4);
  if (value === null) return null;
  const characters = [...value.normalize('NFC')];
  if (characters.length !== 1) return null;
  if (value === '#') return '#';
  return /^\p{L}$/u.test(value.normalize('NFC')) ? initialOf(value, locale) : null;
}

/** A `?q` name search, its whitespace collapsed; empty or over-long is absent. */
export function nameQuery(query: Query): string | null {
  const value = single(query, 'q', 200);
  if (value === null) return null;
  const collapsed = value.replaceAll(/\s+/gu, ' ').trim();
  return collapsed === '' || collapsed.length > NAME_QUERY_MAX ? null : collapsed;
}

/**
 * A name as a search compares it: decomposed, every combining mark (an accent,
 * a vowel sign, a harakah) and the tatweel removed, lower case, whitespace
 * collapsed — so "Tahir" finds "Ṭāhir" and an unvowelled Arabic search finds a
 * vowelled name.
 */
export function foldName(text: string): string {
  return text
    .normalize('NFKD')
    .replaceAll(/[\p{M}ـ]/gu, '')
    .toLowerCase()
    .replaceAll(/\s+/gu, ' ')
    .trim();
}

/** Whether a name answers a search: every word of it appears in the name. */
export function nameMatches(name: string, q: string): boolean {
  const folded = foldName(name);
  return foldName(q)
    .split(' ')
    .every((word) => folded.includes(word));
}

/** A hub's address: its locale-free path and its parameters, neutral ones omitted. */
export function hubHref(locale: string, path: string, search: URLSearchParams): string {
  const text = search.toString();
  return localizedPath(locale, `${path}${text === '' ? '' : `?${text}`}`);
}

/**
 * The canonical address, or `null` when the request already spells it: the
 * hub's own parameters as the request carried them — in its own order, so
 * another order is caught — against the address built from the parsed view.
 * Parameters the hub does not read are left alone unless a redirect happens
 * anyway.
 */
export function unlessCanonical(
  locale: string,
  path: string,
  query: Query,
  keys: ReadonlySet<string>,
  canonical: string,
): string | null {
  const requested = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (!keys.has(key)) continue;
    if (typeof value === 'string') requested.append(key, value);
    else if (Array.isArray(value))
      for (const entry of value) requested.append(key, entry);
  }
  return hubHref(locale, path, requested) === canonical ? null : canonical;
}

/** How many pages of `size` a total fills; at least one. */
export function pageCount(total: number, size: number): number {
  return Math.max(1, Math.ceil(total / size));
}

/** "25–48" of a page of `size`, or null when the page holds nothing. */
export function pageRange(
  page: number,
  shown: number,
  size: number,
): { readonly from: number; readonly to: number } | null {
  if (shown === 0) return null;
  const from = (page - 1) * size + 1;
  return { from, to: from + shown - 1 };
}

/**
 * A copy of an owner's name map keyed by the identifier in lower case: an
 * address carries an identifier in lower case (`identifier`), while an owner
 * returns it as stored, so options and chips compare without case.
 */
export function caseless<V>(map: ReadonlyMap<string, V>): Map<string, V> {
  return new Map([...map].map(([id, value]) => [id.toLowerCase(), value]));
}
