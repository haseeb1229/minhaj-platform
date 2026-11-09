import { localizedPath, type Locale } from '@minhaj/contracts';
import {
  QURAN_AYAH_NUMBER_MAX,
  QURAN_SURAH_MAX,
  numericSegment,
  type PublicLayerWork,
  type PublicTranslationCoverage,
  type QuranRef,
} from '@minhaj/contracts/quran';

import { primaryLanguage } from './reader-preferences';

/**
 * THE TRANSLATIONS PAGES' OWN RULES (Quran Part 6) — PURE, so the compare
 * view's address, the order works are shown in and what a coverage line claims
 * are unit-tested.
 *
 * NOTHING IS CLAIMED THAT IS NOT COUNTED. Coverage is the stored texts and
 * notes of each Surah against the corpus's own Surah counts: a Surah is
 * complete only when every one of its ayat carries text, and no total is
 * written here.
 */

type Query = Record<string, string | string[] | undefined>;

/** `/quran/translations/compare` — every public translation of one Ayah. */
export const COMPARE_PATH = '/quran/translations/compare';

/** The compare view of one Ayah: `?surah=2&ayah=255`, locale-prefixed once. */
export function comparePath(locale: string, ref: QuranRef): string {
  return localizedPath(
    locale,
    `${COMPARE_PATH}?surah=${String(ref.surah)}&ayah=${String(ref.ayah)}`,
  );
}

/** One canonical decimal query value within a range, or null. */
function queryNumber(query: Query, key: string, max: number): number | null {
  const raw = query[key];
  return typeof raw === 'string' ? numericSegment(raw, max) : null;
}

/**
 * Which Ayah the compare view shows, from its address and the corpus's own
 * Surahs. No choice is the first Ayah of the first Surah; a Surah the corpus
 * does not hold, or an Ayah beyond its Surah, is REFUSED — said, never quietly
 * moved to a neighbour (`asked` is then what the address named, for the page
 * to say it does not exist).
 */
export type CompareRequest =
  | { readonly kind: 'shown'; readonly ref: QuranRef }
  | { readonly kind: 'missing'; readonly asked: string };

export function compareRequest(
  query: Query,
  surahs: readonly { readonly number: number; readonly ayahCount: number }[],
): CompareRequest | null {
  const first = surahs[0];
  if (first === undefined) return null;
  const rawSurah = query['surah'];
  const rawAyah = query['ayah'];
  if (
    (rawSurah === undefined || rawSurah === '') &&
    (rawAyah === undefined || rawAyah === '')
  )
    return { kind: 'shown', ref: { surah: first.number, ayah: 1 } };
  const surah = queryNumber(query, 'surah', QURAN_SURAH_MAX);
  const ayah =
    rawAyah === undefined || rawAyah === ''
      ? 1
      : queryNumber(query, 'ayah', QURAN_AYAH_NUMBER_MAX);
  const held = surahs.find((entry) => entry.number === surah);
  if (surah === null || ayah === null || held === undefined || ayah > held.ayahCount)
    return {
      kind: 'missing',
      asked: `${typeof rawSurah === 'string' ? rawSurah : '?'}:${typeof rawAyah === 'string' && rawAyah !== '' ? rawAyah : '1'}`,
    };
  return { kind: 'shown', ref: { surah, ayah } };
}

/**
 * The order translations are shown in, wherever several are shown together —
 * the interface language's first, then Urdu, then English, then the rest in
 * the reader's own (work-slug) order. One rule for the reader and the
 * translations pages.
 */
export function inReadingOrder<T extends Pick<PublicLayerWork, 'languageCode'>>(
  works: readonly T[],
  locale: Locale,
): readonly T[] {
  const rank = (code: string) => {
    const language = primaryLanguage(code);
    return language === locale ? 0 : language === 'ur' ? 1 : language === 'en' ? 2 : 3;
  };
  return works
    .map((work, order) => ({ work, order }))
    .sort(
      (a, b) =>
        rank(a.work.languageCode) - rank(b.work.languageCode) || a.order - b.order,
    )
    .map((entry) => entry.work);
}

/** What one Translation carries, counted against the corpus's Surahs. */
export interface CoverageSummary {
  /** Surahs every Ayah of which carries text. */
  readonly complete: number;
  /** Surahs some but not all of whose ayat carry text. */
  readonly partial: number;
  /** The Surahs the corpus holds. */
  readonly surahs: number;
  readonly ayat: number;
  /** The ayat the corpus holds. */
  readonly totalAyat: number;
  readonly notes: number;
  /** Per Surah of the corpus: ayat with text and notes, zero where none. */
  readonly bySurah: ReadonlyMap<
    number,
    { readonly ayat: number; readonly notes: number }
  >;
}

export function coverageSummary(
  coverage: PublicTranslationCoverage | undefined,
  surahs: readonly { readonly number: number; readonly ayahCount: number }[],
): CoverageSummary {
  const held = new Map((coverage?.surahs ?? []).map((entry) => [entry.surah, entry]));
  const bySurah = new Map<number, { ayat: number; notes: number }>();
  let complete = 0;
  let partial = 0;
  let ayat = 0;
  let notes = 0;
  let totalAyat = 0;
  for (const surah of surahs) {
    const entry = held.get(surah.number);
    const carried = Math.min(entry?.ayat ?? 0, surah.ayahCount);
    bySurah.set(surah.number, { ayat: carried, notes: entry?.notes ?? 0 });
    totalAyat += surah.ayahCount;
    ayat += carried;
    notes += entry?.notes ?? 0;
    if (carried === surah.ayahCount && carried > 0) complete += 1;
    else if (carried > 0) partial += 1;
  }
  return { complete, partial, surahs: surahs.length, ayat, totalAyat, notes, bySurah };
}
