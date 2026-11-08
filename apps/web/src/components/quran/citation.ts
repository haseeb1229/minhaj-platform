import { citationOf, type QuranRef } from '@minhaj/contracts/quran';

/**
 * WHAT A READER COPIES AND SHARES (R2; benchmark pattern 25). PURE, so the
 * reader's client island and the tests build the same text.
 *
 * THE ARABIC IS CARRIED, NEVER EDITED. The copied text begins with the Ayah's
 * Arabic exactly as the page rendered it — the stored string, byte for byte —
 * and everything this module adds (translations, the citation line, the
 * address) follows it on lines of its own. Nothing is trimmed, normalised or
 * appended into the Arabic.
 */

/**
 * "Al-Kahf 18:10 — Tanzil Uthmani / Irfan-ul-Quran": the Surah's recorded name
 * (or none), the canonical citation, and the named sources of what is copied.
 */
export function citationLine(input: {
  readonly label: string | null;
  readonly ref: QuranRef;
  readonly sources: readonly string[];
}): string {
  const place =
    input.label === null || input.label === ''
      ? citationOf(input.ref)
      : `${input.label} ${citationOf(input.ref)}`;
  const sources = input.sources.filter((source) => source !== '');
  return sources.length === 0 ? place : `${place} — ${sources.join(' / ')}`;
}

/** The text placed on the clipboard for one Ayah. */
export function ayahCopyText(input: {
  readonly arabic: string;
  readonly translations: readonly string[];
  readonly citation: string;
  readonly url: string;
}): string {
  const parts = [input.arabic];
  const translations = input.translations.filter((text) => text !== '');
  if (translations.length > 0) parts.push(translations.join('\n\n'));
  parts.push(`${input.citation}\n${input.url}`);
  return parts.join('\n\n');
}

const ARABIC_INDIC_ZERO = 0x0660;

/** A number in Arabic-Indic digits, for the ayah-end marker (presentation only). */
export function arabicIndic(value: number): string {
  return String(value).replace(/\d/g, (digit) =>
    String.fromCharCode(ARABIC_INDIC_ZERO + Number(digit)),
  );
}
