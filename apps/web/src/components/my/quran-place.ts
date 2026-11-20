/**
 * WHERE A READING POSITION STANDS IN THE MUSHAF (My Minhaj Part 1) — PURE.
 *
 * From the Quran's fixed STRUCTURE alone (how many ayat each Surah has,
 * `@minhaj/contracts/passage`): the ayah's place among all of them in the
 * Mushaf's order, and how far through that order it is. It says where the
 * marked place is — never how much the person has read, which nothing records.
 *
 * A position the structure does not have (a Surah past the last, an ayah past
 * its Surah's end) has no place: `null`, never a guess.
 */
export interface QuranPlace {
  /** The ayah's place among every ayah, 1-based. */
  readonly ordinal: number;
  /** Every ayah in the structure. */
  readonly total: number;
  /** How many ayat the position's Surah has. */
  readonly surahAyat: number;
  /** `ordinal / total`, between 0 and 1. */
  readonly percent: number;
}

export function quranPlace(
  surah: number,
  ayah: number,
  counts: readonly number[],
): QuranPlace | null {
  if (!Number.isInteger(surah) || !Number.isInteger(ayah)) return null;
  if (surah < 1 || surah > counts.length || ayah < 1) return null;
  const surahAyat = counts[surah - 1] ?? 0;
  if (ayah > surahAyat) return null;
  const before = counts.slice(0, surah - 1).reduce((sum, count) => sum + count, 0);
  const total = counts.reduce((sum, count) => sum + count, 0);
  const ordinal = before + ayah;
  return { ordinal, total, surahAyat, percent: ordinal / total };
}
