/**
 * THE OUTSIDE ADDRESSES THE QURAN REFERENCE PREVIEW CREDITS (R2) — the Tanzil
 * Project, whose CC BY 3.0 terms require its source to be named and linked;
 * that licence; and the official Irfan-ul-Quran site of its rights holder.
 *
 * OUTBOUND LINKS ONLY, in exactly this module (pinned by
 * `tests/architecture/phase4-shell-boundaries.test.ts`): nothing here is
 * fetched, embedded or tracked; a browser leaves for one only when a visitor
 * follows the link in "About this text".
 */
/**
 * The translations that are Minhaj-ul-Quran's own — Irfan-ul-Quran in Urdu and
 * English, as the staging reference import names them
 * (`scripts/quran/translation-works.ts`, held equal by the tests). Every other
 * public translation is an external reference translation, credited as such
 * in "About this text".
 */
export const FIRST_PARTY_TRANSLATIONS: readonly string[] = Object.freeze([
  'irfan-ul-quran-ur',
  'irfan-ul-quran-en',
]);

export const REFERENCE_LINKS = Object.freeze({
  tanzil: 'https://tanzil.net/',
  licence: 'https://creativecommons.org/licenses/by/3.0/',
  official: 'https://www.irfan-ul-quran.com/',
});
