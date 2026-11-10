import type { Locale } from '@minhaj/contracts';
import {
  QURAN_JUZ_WINDOW,
  isAyahWordToken,
  type PublicAyahPlace,
  type QuranRef,
} from '@minhaj/contracts/quran';

import {
  HIZB_PATTERN,
  JUZ_PREFIX,
  QUICK_JUMP_MAX_LENGTH,
  asciiDigits,
} from './quick-jump';

/**
 * HOW A JUZ IS SHOWN AND READ (Quran Part 3) — PURE and free of React and of
 * server code, so the server pages, the Juz index's client island and the
 * tests share one implementation.
 *
 * NOTHING HERE KNOWS WHAT THE QURAN SAYS. Every citation, hizb, page and word
 * arrives from the public reader; this module only cuts, compares and counts
 * them. No Juz name is written here: a Juz is known by the opening words of
 * its first Ayah, and those words are taken from the stored text unchanged.
 */

/* ===========================================================================
 * The opening words
 * ========================================================================= */

/** How many words of its first Ayah a Juz is shown by. */
export const JUZ_OPENING_WORDS = 3;

/** The opening words of an Ayah, and whether the Ayah goes on after them. */
export interface OpeningWords {
  readonly text: string;
  readonly more: boolean;
}

/**
 * THE OPENING WORDS OF A STORED AYAH TEXT, VERBATIM. The result is one
 * contiguous slice of the text exactly as stored — never respelled,
 * transliterated, normalised or rejoined: from its first word to the end of
 * its `count`-th word. A word is a space-separated run that carries a letter,
 * so a sign the text writes between words (the rub' al-hizb mark ۞ that opens
 * many a Juz, or a pause mark) is never counted as one: one that LEADS the
 * text is not part of its opening words, and one that falls between two of
 * them stays exactly where the text has it. A text with no word has none. The
 * word rule is the contract's one (`isAyahWordToken`), which the word-by-word
 * segmentation uses too (Quran Part 7).
 */
export function openingWords(text: string, count = JUZ_OPENING_WORDS): OpeningWords {
  const words = [...text.matchAll(/\S+/gu)].filter((token) => isAyahWordToken(token[0]));
  const first = words[0];
  const last = words[Math.min(count, words.length) - 1];
  if (first === undefined || last === undefined || count < 1)
    return { text: '', more: false };
  return {
    text: text.slice(first.index, last.index + last[0].length),
    more: words.length > count,
  };
}

/* ===========================================================================
 * The windows a Juz is read in
 * ========================================================================= */

/** One window of a Juz page: a hizb, or one part of a long one. */
export interface JuzWindow {
  /** The hizb the source recorded for these ayat, or null where it recorded none. */
  readonly hizb: number | null;
  /** Which part of its hizb this is, from 1, and how many parts it is read in. */
  readonly part: number;
  readonly parts: number;
  readonly start: QuranRef;
  readonly end: QuranRef;
  /** How many ayat of the Juz come before it. */
  readonly offset: number;
  readonly count: number;
  /** The first and last mushaf page it lies on, where the source recorded pages. */
  readonly pages: { readonly start: number; readonly end: number } | null;
}

/** Consecutive places that share a value, in order. */
function runsOf<T>(
  places: readonly PublicAyahPlace[],
  key: (place: PublicAyahPlace) => T,
): PublicAyahPlace[][] {
  const runs: PublicAyahPlace[][] = [];
  let current: PublicAyahPlace[] = [];
  for (const place of places) {
    const head = current[0];
    if (head !== undefined && key(head) !== key(place)) {
      runs.push(current);
      current = [];
    }
    current.push(place);
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

/**
 * The parts one hizb is read in: whole mushaf pages, never more than `max`
 * ayat, as even as the pages allow. A page the source did not record is no
 * boundary, so its ayat are units of one; a page longer than `max` (none in a
 * real mushaf) is cut at `max`.
 */
function partsOf(run: readonly PublicAyahPlace[], max: number): PublicAyahPlace[][] {
  const units = runsOf(run, (place) => place.page ?? Symbol('unrecorded')).flatMap(
    (unit) => {
      const slices: PublicAyahPlace[][] = [];
      for (let at = 0; at < unit.length; at += max) slices.push(unit.slice(at, at + max));
      return slices;
    },
  );
  const parts: PublicAyahPlace[][] = [];
  let planned = Math.ceil(run.length / max);
  let placed = 0;
  let current: PublicAyahPlace[] = [];
  for (const unit of units) {
    if (current.length > 0) {
      // The size this part should be for the rest to share the remainder evenly.
      const target = (run.length - placed) / (planned - parts.length);
      const now = current.length;
      const next = now + unit.length;
      if (next > max || Math.abs(next - target) > Math.abs(now - target)) {
        parts.push(current);
        placed += now;
        current = [];
        if (parts.length >= planned) planned = parts.length + 1;
      }
    }
    current.push(...unit);
  }
  if (current.length > 0) parts.push(current);
  return parts;
}

/**
 * THE WINDOWS OF A JUZ, from its outline (every Ayah's citation, hizb and page
 * in canonical order). Natural and stable: one window per hizb the source
 * recorded — two to a Juz in the Tanzil structure — and a hizb of more than
 * `max` ayat (the short ayat at the Quran's end) read in parts that break
 * between mushaf pages. Ayat whose hizb the source did not record are read
 * the same way, as one run. The same outline always gives the same windows.
 */
export function juzWindows(
  outline: readonly PublicAyahPlace[],
  max = QURAN_JUZ_WINDOW,
): JuzWindow[] {
  const windows: JuzWindow[] = [];
  let offset = 0;
  for (const run of runsOf(outline, (place) => place.hizb)) {
    const parts = partsOf(run, max);
    parts.forEach((part, index) => {
      const first = part[0];
      const last = part.at(-1);
      if (first === undefined || last === undefined) return;
      const pages = part.flatMap((place) => (place.page === null ? [] : [place.page]));
      windows.push({
        hizb: first.hizb,
        part: index + 1,
        parts: parts.length,
        start: { surah: first.surah, ayah: first.ayah },
        end: { surah: last.surah, ayah: last.ayah },
        offset,
        count: part.length,
        pages:
          pages.length === 0
            ? null
            : { start: Math.min(...pages), end: Math.max(...pages) },
      });
      offset += part.length;
    });
  }
  return windows;
}

type Query = Record<string, string | string[] | undefined>;

/** A canonical decimal query value within `1..max`, or null. */
function decimal(query: Query, name: string, max: number): number | null {
  const raw = query[name];
  if (typeof raw !== 'string' || !/^[1-9][0-9]{0,2}$/.test(raw)) return null;
  const value = Number(raw);
  return value <= max ? value : null;
}

/**
 * The window a Juz page shows for its address: `?hizb=` names a hizb of THIS
 * Juz and `?part=` one of its parts (the first when absent). Anything else —
 * an unknown hizb or part, a malformed value, an old `?offset=` — is the first
 * window: an address can never ask for more than one window, or for nothing.
 */
export function readJuzWindow(query: Query, windows: readonly JuzWindow[]): number {
  const hizb = decimal(query, 'hizb', 999);
  const part = decimal(query, 'part', 999) ?? 1;
  const found = windows.findIndex(
    (window) => window.hizb === hizb && window.part === part,
  );
  return found < 0 ? 0 : found;
}

/**
 * An address with its window: the Juz's first window is the bare address, any
 * other names its hizb and, after the first, its part — `?hizb=4&part=2`. The
 * reading preferences and any fragment already on `href` are kept.
 */
export function withJuzWindow(
  href: string,
  windows: readonly JuzWindow[],
  index: number,
): string {
  const window = windows[index];
  if (index <= 0 || window === undefined) return href;
  const search = new URLSearchParams();
  if (window.hizb !== null) search.set('hizb', String(window.hizb));
  if (window.part > 1 || window.hizb === null) search.set('part', String(window.part));
  const [base = '', hash] = href.split('#');
  const joined = `${base}${base.includes('?') ? '&' : '?'}${search.toString()}`;
  return hash === undefined ? joined : `${joined}#${hash}`;
}

/** The window an Ayah of the Juz is read in, or the first when it is not in one. */
export function windowOf(windows: readonly JuzWindow[], ref: QuranRef): number {
  const key = (place: QuranRef) => place.surah * 1000 + place.ayah;
  const found = windows.findIndex(
    (window) => key(window.start) <= key(ref) && key(ref) <= key(window.end),
  );
  return found < 0 ? 0 : found;
}

/** The first window of each hizb, in order: where the in-Juz navigation points. */
export function hizbStarts(windows: readonly JuzWindow[]): readonly number[] {
  return windows.flatMap((window, index) =>
    window.hizb !== null && window.part === 1 ? [index] : [],
  );
}

/* ===========================================================================
 * The Juz index — one card per Juz, and a filter by number
 * ========================================================================= */

/** A text shown with the language it is actually in. */
interface Labelled {
  readonly text: string;
  readonly locale: Locale;
}

/** One Juz as the index shows it — plain data, built on the server. */
export interface JuzIndexRow {
  readonly number: number;
  readonly href: string;
  /**
   * The opening words of its first Ayah, verbatim (`openingWords`) — null
   * where the index is shown without them (the landing shows no verse).
   */
  readonly opening: OpeningWords | null;
  /** "From 2:142 to 2:252 · 111 ayat" — in the interface language. */
  readonly range: string;
  /** "Pages 22–41" and "Hizb 3–4", where the source recorded them. */
  readonly facts: string;
  /** The Surah it begins in and the one it ends in (the same for a Juz inside one Surah). */
  readonly surahs: readonly { readonly number: number; readonly name: Labelled | null }[];
  /** "37 Surahs" where it spans more than two, else null. */
  readonly surahCount: string | null;
  /** Every hizb recorded in it: "hizb 30" finds the Juz that holds it. */
  readonly hizbs: readonly number[];
}

/** `?q=`, TOLERATED: one string, cut to the length the quick jump reads. */
export function readJuzIndexQuery(query: Query): string {
  const raw = query['q'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return typeof first === 'string' ? first.slice(0, QUICK_JUMP_MAX_LENGTH) : '';
}

/** The index's address for a filter: the bare index when it is empty. */
export function juzIndexHref(path: string, q: string): string {
  if (q.trim() === '') return path;
  return `${path}?${new URLSearchParams({ q }).toString()}`;
}

/**
 * The rows a filter keeps, in order. Empty keeps all. A number ("15", "۱۵",
 * "Juz 15", "Para 15") keeps the Juz whose number begins with it, so the list
 * narrows digit by digit; "hizb 30" keeps the Juz the source recorded that
 * hizb in. Anything else keeps nothing — a Juz is found by its number.
 */
export function filterJuz(rows: readonly JuzIndexRow[], raw: string): JuzIndexRow[] {
  const q = asciiDigits(raw).trim().replace(/\s+/g, ' ').toLowerCase();
  if (q === '') return [...rows];
  const hizb = HIZB_PATTERN.exec(q);
  if (hizb !== null) {
    const number = Number(hizb[1]);
    return rows.filter((row) => row.hizbs.includes(number));
  }
  const bare = q.replace(JUZ_PREFIX, '');
  if (!/^\d{1,2}$/.test(bare)) return [];
  return rows.filter((row) => String(row.number).startsWith(bare));
}
