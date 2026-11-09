import { localizedPath } from '@minhaj/contracts';
import type { PublicAyah, QuranRef } from '@minhaj/contracts/quran';

/**
 * HOW A LONG READING IS LAID OUT (Quran Part 1, owner direction 2026-11-09) —
 * PURE and free of React and of server code, so the server pages, the reader's
 * client island and the tests share one implementation.
 *
 * WINDOWS, NOT ONE GIANT DOCUMENT. A Surah page renders one WINDOW of
 * `QURAN_WINDOW` ayat, server-side and complete without JavaScript; the next
 * window is a plain link (`?from=41`), which the reader island fetches and
 * appends as the reader nears it. Windows start at fixed places (1, 41, 81 …),
 * so every window has one stable address, and any Ayah's window is computed
 * from its number alone — which is how `/quran/surah/2#ayah-2-255` lands on
 * the right Ayah although the server never sees the fragment.
 *
 * NOTHING HERE KNOWS WHAT THE QURAN SAYS. Counts, pages, Juz and hizb numbers
 * all arrive from the reader; this module only compares them.
 */

/** How many ayat one window of a Surah page holds. */
export const QURAN_WINDOW = 40;

/** The first Ayah of the window an Ayah falls in: 1, 41, 81 … */
export function windowStartOf(ayah: number): number {
  return (
    Math.floor((Math.max(1, Math.trunc(ayah)) - 1) / QURAN_WINDOW) * QURAN_WINDOW + 1
  );
}

/**
 * The window a Surah page shows for its `?from=` value. Anything that is not
 * one canonical decimal Ayah number inside the Surah is the first window —
 * an address can never ask for more than one window, or for nothing.
 */
export function readWindow(
  raw: string | string[] | undefined,
  ayahCount: number,
): { readonly start: number; readonly end: number } {
  const value =
    typeof raw === 'string' && /^[1-9][0-9]{0,2}$/.test(raw) ? Number(raw) : 1;
  const start = value <= ayahCount ? windowStartOf(value) : 1;
  return { start, end: Math.min(ayahCount, start + QURAN_WINDOW - 1) };
}

/** An address with its window: the first window is the bare address. */
export function withWindow(href: string, start: number): string {
  if (start <= 1) return href;
  const [base = '', hash] = href.split('#');
  const joined = `${base}${base.includes('?') ? '&' : '?'}from=${String(start)}`;
  return hash === undefined ? joined : `${joined}#${hash}`;
}

/** The element identifier every Ayah carries wherever it is listed: `ayah-2-255`. */
export function ayahElementId(ref: QuranRef): string {
  return `ayah-${String(ref.surah)}-${String(ref.ayah)}`;
}

/**
 * The Ayah a Surah page's fragment names: `#ayah-2-255` (the current form) or
 * `#ayah-255` (the form earlier links carry), for THIS Surah only. Anything
 * else — another Surah, a number past its count, noise — is `null`.
 */
export function ayahOfFragment(
  hash: string,
  surah: number,
  ayahCount: number,
): number | null {
  const match = /^#?ayah-(?:([1-9][0-9]{0,2})-)?([1-9][0-9]{0,2})$/.exec(hash);
  if (match === null) return null;
  if (match[1] !== undefined && Number(match[1]) !== surah) return null;
  const ayah = Number(match[2]);
  return ayah <= ayahCount ? ayah : null;
}

/**
 * Where an Ayah is READ in its Surah — its window, at its own element — as a
 * locale-prefixed address: `/quran/surah/2?from=241#ayah-2-255`.
 */
export function surahPlacePath(locale: string, ref: QuranRef): string {
  return localizedPath(
    locale,
    withWindow(
      `/quran/surah/${String(ref.surah)}#${ayahElementId(ref)}`,
      windowStartOf(ref.ayah),
    ),
  );
}

/** The mushaf page address: `/quran/page/50`. */
export function mushafPagePath(locale: string, page: number): string {
  return localizedPath(locale, `/quran/page/${String(page)}`);
}

/* ===========================================================================
 * Markers — where a Juz, a hizb and a mushaf page begin
 * ========================================================================= */

/** What begins AT an Ayah: each number is set only where that division starts. */
export interface AyahBoundary {
  readonly juz: number | null;
  readonly hizb: number | null;
  readonly page: number | null;
}

type Placed = Pick<PublicAyah, 'juz' | 'hizb' | 'page'>;

/**
 * For each Ayah, the divisions that begin at it — decided by comparing it with
 * the Ayah before it in canonical order (`previous` is the one before the
 * first, or `null` at the very beginning of the corpus, where everything
 * begins). A division the source did not record (`null`) never begins.
 */
export function boundariesOf(
  ayat: readonly Placed[],
  previous: Placed | null,
): readonly AyahBoundary[] {
  let before: Placed | null = previous;
  return ayat.map((ayah) => {
    const starts = (key: 'juz' | 'hizb' | 'page'): number | null => {
      const value = ayah[key];
      if (value === null) return null;
      return before === null || before[key] !== value ? value : null;
    };
    const boundary = { juz: starts('juz'), hizb: starts('hizb'), page: starts('page') };
    before = ayah;
    return boundary;
  });
}

/** The first and last value of a division across a run, or `null` if unrecorded. */
export function spanOf(
  first: Placed | null,
  last: Placed | null,
  key: 'juz' | 'page',
): { readonly start: number; readonly end: number } | null {
  const start = first?.[key] ?? null;
  const end = last?.[key] ?? null;
  return start === null || end === null ? null : { start, end };
}

/* ===========================================================================
 * Where to start — fixed citations, never text
 * ========================================================================= */

/**
 * The popular starting points /quran/read offers. CITATIONS ONLY: each is a
 * Surah number (and, for Ayat al-Kursi, an Ayah), shown with the names the
 * corpus recorded and offered only where the active corpus holds that place.
 */
export const STARTING_POINTS = Object.freeze([
  { key: 'fatiha', ref: { surah: 1, ayah: 1 }, whole: true },
  { key: 'kahf', ref: { surah: 18, ayah: 1 }, whole: true },
  { key: 'yasin', ref: { surah: 36, ayah: 1 }, whole: true },
  { key: 'mulk', ref: { surah: 67, ayah: 1 }, whole: true },
  { key: 'kursi', ref: { surah: 2, ayah: 255 }, whole: false },
] as const);

export type StartingPoint = (typeof STARTING_POINTS)[number];

/** The starting points this corpus can honour, given its Surahs' counts. */
export function startingPointsIn(
  ayahCounts: ReadonlyMap<number, number>,
): readonly StartingPoint[] {
  return STARTING_POINTS.filter((point) => {
    const count = ayahCounts.get(point.ref.surah);
    return count !== undefined && point.ref.ayah <= count;
  });
}
