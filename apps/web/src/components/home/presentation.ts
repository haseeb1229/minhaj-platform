/**
 * The home page's pure decisions (R2) — free of React and of data access, so a
 * test can call them directly.
 */

/**
 * The surahs the Quran entry offers as quick links: the Opening, and the
 * surahs customarily recited on Fridays and at night. Navigation only — the
 * names, Arabic text and counts are the corpus's own; nothing here is a
 * religious claim.
 */
export const QUICK_SURAHS = Object.freeze([1, 18, 36, 55, 56, 67] as const);

/** The quick-link surahs the corpus actually has, in `QUICK_SURAHS` order. */
export function quickSurahs<T extends { readonly number: number }>(
  surahs: readonly T[],
): T[] {
  const byNumber = new Map(surahs.map((surah) => [surah.number, surah]));
  return QUICK_SURAHS.flatMap((number) => {
    const surah = byNumber.get(number);
    return surah === undefined ? [] : [surah];
  });
}

/**
 * The hero's picture: the first story that has one, from a list already in
 * reading order (the interface language first). `null` when none has a
 * picture — the hero is then words alone, never a stock image.
 */
export function heroStory<T extends { readonly leadImage: unknown }>(
  items: readonly T[],
): T | null {
  return items.find((item) => item.leadImage !== null) ?? null;
}

/**
 * The news section's lead and the stories beside it, after the hero's story is
 * taken out so nothing appears twice. The lead is the first remaining story
 * with a picture (a lead without one is a headline, not a lead), and the
 * others keep their order.
 */
export function newsLayout<T extends { readonly leadImage: unknown }>(
  items: readonly T[],
  hero: T | null,
  others: number,
): { readonly lead: T | null; readonly rest: readonly T[] } {
  const remaining = items.filter((item) => item !== hero);
  const lead = remaining.find((item) => item.leadImage !== null) ?? null;
  return {
    lead,
    rest: remaining.filter((item) => item !== lead).slice(0, others),
  };
}
