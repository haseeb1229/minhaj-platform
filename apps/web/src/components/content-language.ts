import type { Locale } from '@minhaj/contracts';

/**
 * THE CONTENT-LANGUAGE MARK ON A CARD (R2, audit F10).
 *
 * A card whose words are in another language than the interface says so in
 * words: an English page that lists an Urdu headline labels it "Urdu", so a
 * reader who cannot read the script knows what it is rather than meeting it
 * unannounced. A card in the interface's own language carries no mark.
 *
 * THE NAME IS IN THE INTERFACE LANGUAGE ("Urdu" on an English page, "اردو" on
 * an Urdu one, "الأوردية" on an Arabic one) — it is read by the person using
 * this interface. That is a different job from the language switcher, whose
 * endonyms are read by somebody looking for their own language.
 *
 * Compared on the primary language subtag, so `ur-PK` content on an Urdu page
 * carries no mark. PURE: a test can call it directly.
 */
export function contentLanguageBadge(
  contentCode: string,
  locale: Locale,
): { readonly label: string; readonly code: string } | undefined {
  const primary = (contentCode.split('-')[0] ?? '').toLowerCase();
  if (primary === '' || primary === locale) return undefined;
  let label: string | undefined;
  try {
    label = new Intl.DisplayNames([locale], { type: 'language', fallback: 'code' }).of(
      contentCode,
    );
  } catch {
    // A malformed code has no name; the card says nothing rather than guess.
    return undefined;
  }
  return label === undefined || label === '' ? undefined : { label, code: contentCode };
}

/**
 * The interface language first, then everything else — each group keeping the
 * order it arrived in (newest first, for a news page). Nothing is hidden: an
 * English reader still sees the Urdu stories, after the English ones (F10).
 */
export function interfaceLanguageFirst<T>(
  items: readonly T[],
  languageOf: (item: T) => string,
  locale: Locale,
): T[] {
  const own = (item: T) =>
    (languageOf(item).split('-')[0] ?? '').toLowerCase() === locale;
  return [...items.filter(own), ...items.filter((item) => !own(item))];
}
