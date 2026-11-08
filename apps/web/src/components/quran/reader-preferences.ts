import {
  QURAN_AYAH_NUMBER_MAX,
  QURAN_SURAH_MAX,
  type QuranRef,
} from '@minhaj/contracts/quran';

/**
 * THE READER'S OWN BROWSER MEMORY (R2; benchmark patterns 4 and 6) — PURE,
 * so what is stored, and what is accepted back, is unit-tested.
 *
 * PRESENTATION AND PLACE, NOTHING ELSE. Which translations are shown, how
 * large the Arabic and the translation are set, and the last Ayah read on this
 * device. Kept in `localStorage` under two keys, never sent anywhere, carrying
 * no account identifier; an account's reading position is Personalisation's,
 * set only through its own signed-in controls on an Ayah page.
 *
 * STORED DATA IS DATA, NOT TRUST. A person can edit it, so every read is
 * validated against the ranges this UI offers — and against the corpus's own
 * counts where they are known — and anything else is the default.
 */

export const PREFERENCES_KEY = 'minhaj.quran.reader';
export const LAST_READ_KEY = 'minhaj.quran.lastRead';

/** Which of the default translations are shown beside the Arabic. */
export const TRANSLATION_SHOWS = Object.freeze(['ur', 'en', 'both', 'none'] as const);
export type TranslationShow = (typeof TRANSLATION_SHOWS)[number];

/** The two translation languages the quick choice offers, in its order. */
export const TRANSLATION_LANGUAGES = Object.freeze(['ur', 'en'] as const);
export type TranslationLanguage = (typeof TRANSLATION_LANGUAGES)[number];

/** How far each size may move, as a multiple of the reader's base size. */
export const SCALE = Object.freeze({ min: 0.8, max: 1.6, step: 0.1, initial: 1 });

export interface ReaderPreferences {
  /** `null`: the page's own default for the interface language. */
  readonly translations: TranslationShow | null;
  readonly arabicScale: number;
  readonly translationScale: number;
}

export const DEFAULT_PREFERENCES: ReaderPreferences = Object.freeze({
  translations: null,
  arabicScale: SCALE.initial,
  translationScale: SCALE.initial,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scaleOf(value: unknown): number {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= SCALE.min &&
    value <= SCALE.max
    ? value
    : SCALE.initial;
}

/** Stored preferences, validated; anything unreadable is the default. */
export function readPreferences(raw: string | null): ReaderPreferences {
  if (raw === null) return DEFAULT_PREFERENCES;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_PREFERENCES;
  }
  if (!isRecord(parsed)) return DEFAULT_PREFERENCES;
  const show = parsed['translations'];
  return {
    translations:
      typeof show === 'string' && (TRANSLATION_SHOWS as readonly string[]).includes(show)
        ? (show as TranslationShow)
        : null,
    arabicScale: scaleOf(parsed['arabicScale']),
    translationScale: scaleOf(parsed['translationScale']),
  };
}

export function writePreferences(preferences: ReaderPreferences): string {
  return JSON.stringify({
    translations: preferences.translations,
    arabicScale: preferences.arabicScale,
    translationScale: preferences.translationScale,
  });
}

/**
 * One step up or down, rounded to the step so repeated presses cannot grow a
 * floating-point tail, and held inside the range.
 */
export function stepScale(value: number, direction: 1 | -1): number {
  const stepped = Math.round((value + direction * SCALE.step) / SCALE.step) * SCALE.step;
  return Math.min(SCALE.max, Math.max(SCALE.min, Number(stepped.toFixed(2))));
}

/** The choices a page can honour, given the default translations it rendered. */
export function availableShows(
  languages: readonly TranslationLanguage[],
): readonly TranslationShow[] {
  return TRANSLATION_SHOWS.filter((show) =>
    show === 'none'
      ? true
      : show === 'both'
        ? TRANSLATION_LANGUAGES.every((language) => languages.includes(language))
        : languages.includes(show),
  );
}

/**
 * The page's own default: the interface language's translation where there is
 * one; none in Arabic, whose readers read the text itself; otherwise the one
 * that exists.
 */
export function defaultShow(
  locale: string,
  languages: readonly TranslationLanguage[],
): TranslationShow {
  if (locale === 'ar') return 'none';
  const own = TRANSLATION_LANGUAGES.find(
    (language) => language === locale && languages.includes(language),
  );
  return own ?? languages[0] ?? 'none';
}

/** A stored choice where the page can honour it, else the page's default. */
export function resolveShow(
  stored: TranslationShow | null,
  languages: readonly TranslationLanguage[],
  fallback: TranslationShow,
): TranslationShow {
  return stored !== null && availableShows(languages).includes(stored)
    ? stored
    : fallback;
}

/** The last Ayah read in this browser, as stored. */
export function writeLastRead(ref: QuranRef): string {
  return JSON.stringify({ surah: ref.surah, ayah: ref.ayah });
}

function wholeIn(value: unknown, max: number): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max
  );
}

/**
 * The stored last-read Ayah, or `null`. With the corpus's counts (`ayahCounts`
 * indexed by Surah number) an Ayah past its Surah's end is refused too.
 */
export function readLastRead(
  raw: string | null,
  ayahCounts?: ReadonlyMap<number, number>,
): QuranRef | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const surah = parsed['surah'];
  const ayah = parsed['ayah'];
  if (!wholeIn(surah, QURAN_SURAH_MAX) || !wholeIn(ayah, QURAN_AYAH_NUMBER_MAX))
    return null;
  if (ayahCounts !== undefined) {
    const count = ayahCounts.get(surah);
    if (count === undefined || ayah > count) return null;
  }
  return { surah, ayah };
}
