import type { Locale } from '@minhaj/contracts';
import type { PublicJuz, QuranRevelation } from '@minhaj/contracts/quran';

import { QUICK_JUMP_MAX_LENGTH, asciiDigits, foldName, foldText } from './quick-jump';

/**
 * THE SURAH INDEX — filtering, ordering and grouping (Quran Part 2;
 * ROUTE_MAP.md §3.3). PURE and free of React, so the server answers
 * `/quran/surah?q=…&sort=…` without JavaScript exactly as the client island
 * answers each keystroke, and both are unit-tested here.
 *
 * NOTHING HERE KNOWS WHAT THE QURAN SAYS. Every name, meaning, count,
 * revelation place and Juz span arrives in the rows the server built from the
 * public reader; nothing is written here and nothing folded is ever shown.
 */

/** The orders a reader may choose. The first is the default. */
export const SURAH_SORTS = Object.freeze([
  'number',
  'revelation',
  'longest',
  'shortest',
] as const);
export type SurahSort = (typeof SURAH_SORTS)[number];

/** A text shown with the language it is actually in. */
interface Labelled {
  readonly text: string;
  readonly locale: Locale;
}

/** One Surah as the index shows it — plain data, built on the server. */
export interface SurahIndexRow {
  readonly number: number;
  readonly href: string;
  /** The display name the interface shows, with its language (`surahName`). */
  readonly name: Labelled | null;
  /** What that name means, in its language (`surahMeaning`). */
  readonly meaning: Labelled | null;
  /** The source's Arabic name, shown in the Quran face. */
  readonly nameArabic: string | null;
  readonly ayahCount: number;
  readonly revelation: QuranRevelation | null;
  /** "7 ayat · Meccan · Juz 1" — the row's facts in the interface language. */
  readonly facts: string;
  /** Every recorded name and meaning in every language, and the Arabic name: what a filter matches. */
  readonly terms: readonly string[];
}

/** A reader's request, as read from the address. */
export interface SurahIndexQuery {
  readonly q: string;
  readonly sort: SurahSort;
}

type Query = Record<string, string | string[] | undefined>;

/** One parameter as one string; a repeated one is its first value. */
function single(query: Query, name: string): string {
  const value = query[name];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? first : '';
}

/**
 * `?q=` and `?sort=`, TOLERATED: a filter longer than the quick jump reads is
 * cut to that length, and an unknown order is the default order.
 */
export function readSurahIndexQuery(query: Query): SurahIndexQuery {
  const sort = single(query, 'sort');
  return {
    q: single(query, 'q').slice(0, QUICK_JUMP_MAX_LENGTH),
    sort: (SURAH_SORTS as readonly string[]).includes(sort)
      ? (sort as SurahSort)
      : 'number',
  };
}

/** The address of a request: defaults omitted, so the bare index is the plain one. */
export function surahIndexHref(path: string, query: SurahIndexQuery): string {
  const search = new URLSearchParams();
  if (query.q.trim() !== '') search.set('q', query.q);
  if (query.sort !== 'number') search.set('sort', query.sort);
  const text = search.toString();
  return text === '' ? path : `${path}?${text}`;
}

/** Words a visitor may put before a number ("Surah 18"). */
const NUMBER_PREFIX = /^(?:surah|surat|sura|سورۃ|سورة|سوره|سورت)\s*/iu;

/** A Surah's terms folded once, for a filter that is asked on every keystroke. */
export interface FoldedRow {
  readonly row: SurahIndexRow;
  readonly whole: readonly string[];
  readonly bare: readonly string[];
}

export function foldRows(rows: readonly SurahIndexRow[]): FoldedRow[] {
  return rows.map((row) => ({
    row,
    whole: row.terms.map(foldText).filter((term) => term !== ''),
    bare: row.terms.map(foldName).filter((term) => term !== ''),
  }));
}

/**
 * The rows a filter keeps, in their given order. Empty keeps all. A number
 * ("18", "۱۸", "Surah 18") keeps the Surahs whose number begins with it, so the
 * list narrows digit by digit; anything else keeps the Surahs one of whose
 * names or meanings, in any language or script, contains it — compared folded
 * (case, marks, letter variants, punctuation, a leading article), never shown
 * folded. Text that folds to nothing keeps nothing.
 */
export function filterSurahs(rows: readonly FoldedRow[], raw: string): SurahIndexRow[] {
  const q = asciiDigits(raw).trim().replace(/\s+/g, ' ');
  if (q === '') return rows.map((entry) => entry.row);
  const bareNumber = q.replace(NUMBER_PREFIX, '');
  if (/^\d{1,3}$/.test(bareNumber))
    return rows
      .filter((entry) => String(entry.row.number).startsWith(bareNumber))
      .map((entry) => entry.row);
  const whole = foldText(q);
  const bare = foldName(q);
  if (whole === '') return [];
  return rows
    .filter(
      (entry) =>
        entry.whole.some((term) => term.includes(whole)) ||
        (bare !== '' && entry.bare.some((term) => term.includes(bare))),
    )
    .map((entry) => entry.row);
}

/** Ties always break by number, so an order is the same on every render. */
const byNumber = (a: SurahIndexRow, b: SurahIndexRow) => a.number - b.number;

const ORDER: Readonly<Record<SurahSort, (a: SurahIndexRow, b: SurahIndexRow) => number>> =
  Object.freeze({
    number: byNumber,
    revelation: byNumber,
    longest: (a, b) => b.ayahCount - a.ayahCount || byNumber(a, b),
    shortest: (a, b) => a.ayahCount - b.ayahCount || byNumber(a, b),
  });

/** A group of the index: every row, or the rows of one revelation place. */
export interface SurahGroup {
  readonly key: 'all' | QuranRevelation | 'unrecorded';
  readonly rows: readonly SurahIndexRow[];
}

/**
 * The rows in the chosen order and, for `revelation`, grouped by where the
 * source says each was revealed — Meccan, then Medinan, then any the source
 * did not record — each group in number order; empty groups are omitted.
 * Every other order is one group.
 */
export function arrangeSurahs(
  rows: readonly SurahIndexRow[],
  sort: SurahSort,
): SurahGroup[] {
  const ordered = [...rows].sort(ORDER[sort]);
  if (sort !== 'revelation') return [{ key: 'all', rows: ordered }];
  const groups: SurahGroup[] = [
    { key: 'meccan', rows: ordered.filter((row) => row.revelation === 'meccan') },
    { key: 'medinan', rows: ordered.filter((row) => row.revelation === 'medinan') },
    { key: 'unrecorded', rows: ordered.filter((row) => row.revelation === null) },
  ];
  return groups.filter((group) => group.rows.length > 0);
}

/**
 * Each Surah's first and last Juz, DERIVED from the reader's Juz ranges: a
 * Surah lies in every Juz whose range starts at or before it and ends at or
 * after it. A Surah no range reaches has no span.
 */
export function juzSpans(
  list: readonly PublicJuz[],
): ReadonlyMap<number, { readonly first: number; readonly last: number }> {
  const spans = new Map<number, { first: number; last: number }>();
  for (const juz of list) {
    for (let surah = juz.start.surah; surah <= juz.end.surah; surah += 1) {
      const span = spans.get(surah);
      if (span === undefined) spans.set(surah, { first: juz.number, last: juz.number });
      else {
        span.first = Math.min(span.first, juz.number);
        span.last = Math.max(span.last, juz.number);
      }
    }
  }
  return spans;
}
