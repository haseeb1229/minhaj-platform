import localFont from 'next/font/local';

/**
 * THE SHIPPED TYPEFACES — the one module that may declare a font
 * (Rebaseline R1, owner-approved interim identity, 2026-11-06).
 *
 * SELF-HOSTED OPEN-LICENCE FACES ONLY. Every file below sits beside its SIL Open
 * Font License 1.1 text in `./fonts/<family>/OFL.txt`, was taken byte-for-byte
 * from the exact Fontsource release named here (a repackaging of the canonical
 * upstream project, recorded with SHA-256 in TECH_STACK.md §18.9), and is served
 * from this origin by Next — no font CDN, no third-party request, nothing the
 * CSP's `font-src 'self'` has to widen for. Google-hosted font loading is
 * forbidden by test (`tests/config/fonts.test.ts`): it fetches at build time.
 *
 * FOUR FAMILIES, EACH WITH ONE JOB (the type roles in ARCHITECTURE.md §13.3):
 *
 *   display  Newsreader — headings and English long-form reading
 *            (@fontsource-variable/newsreader 5.3.0, Production Type, OFL)
 *   ui       Instrument Sans — interface text, navigation, metadata
 *            (@fontsource-variable/instrument-sans 5.3.0, OFL)
 *   urdu     Gulzar — GENUINE NASTALIQ for Urdu headings and Urdu reading
 *            (@fontsource/gulzar 5.3.0, googlefonts/gulzar, OFL)
 *   naskh    Noto Naskh Arabic — Arabic, and dense Urdu interface text where
 *            Nastaliq is unsuitable (@fontsource/noto-naskh-arabic 5.3.0, OFL)
 *
 * NO QURAN FACE. Quran text keeps its own specialised typography and no corpus
 * is active; a Quran display face arrives with an approved corpus and is never
 * used for ordinary Arabic interface text. Jameel Noori Nastaleeq is not
 * shipped: its licence is unclear.
 *
 * LOADING. The two Latin faces are preloaded — every page renders them — with
 * metric-adjusted fallbacks so the swap does not move the layout. The Arabic-
 * script faces are NOT preloaded: an English page loads them only if it shows
 * Urdu or Arabic text, which the browser discovers itself.
 */

export const displayFace = localFont({
  src: [
    { path: './fonts/newsreader/newsreader-latin-wght-normal.woff2', style: 'normal' },
    { path: './fonts/newsreader/newsreader-latin-wght-italic.woff2', style: 'italic' },
  ],
  weight: '200 800',
  variable: '--font-face-display',
  display: 'swap',
  preload: true,
  fallback: ['Georgia', 'Times New Roman', 'serif'],
  adjustFontFallback: 'Times New Roman',
});

export const uiFace = localFont({
  src: './fonts/instrument-sans/instrument-sans-latin-wght-normal.woff2',
  weight: '400 700',
  style: 'normal',
  variable: '--font-face-ui',
  display: 'swap',
  preload: true,
  fallback: ['system-ui', 'Segoe UI', 'Arial', 'sans-serif'],
  adjustFontFallback: 'Arial',
});

export const urduFace = localFont({
  src: './fonts/gulzar/gulzar-arabic-400-normal.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-face-urdu',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
});

export const naskhFace = localFont({
  src: [
    {
      path: './fonts/noto-naskh-arabic/noto-naskh-arabic-arabic-400-normal.woff2',
      weight: '400',
    },
    {
      path: './fonts/noto-naskh-arabic/noto-naskh-arabic-arabic-600-normal.woff2',
      weight: '600',
    },
  ],
  style: 'normal',
  variable: '--font-face-naskh',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
});

/** The class names that define all four `--font-face-*` variables, for `<html>`. */
export const FONT_VARIABLES = [
  displayFace.variable,
  uiFace.variable,
  urduFace.variable,
  naskhFace.variable,
].join(' ');
