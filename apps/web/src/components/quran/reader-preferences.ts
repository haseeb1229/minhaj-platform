import {
  QURAN_AYAH_NUMBER_MAX,
  QURAN_SURAH_MAX,
  quranSlugSchema,
  type QuranRef,
} from '@minhaj/contracts/quran';

/**
 * THE READER'S OWN BROWSER MEMORY (R2; Quran Part 1, owner direction
 * 2026-11-09) — PURE, so what is stored, what is accepted back and how it is
 * shown are unit-tested.
 *
 * PRESENTATION AND PLACE, NOTHING ELSE. The reading mode, which of the page's
 * translations are shown and how, the two text sizes, the line spacing, and
 * the last Ayah read on this device. Kept in `localStorage` under two keys,
 * never sent anywhere, carrying no account identifier; an account's reading
 * position is Personalisation's, set only through its own signed-in controls.
 *
 * STORED DATA IS DATA, NOT TRUST. A person can edit it, so every read is
 * validated against the values this UI offers — and against the corpus's own
 * counts where they are known — and anything else is the default.
 *
 * APPLIED BEFORE THE FIRST PAINT. A reading page carries `READER_BOOT_SCRIPT`
 * as the first child of its reader element, so a returning reader's mode and
 * sizes are in place before the text is drawn (no layout shift). The script is
 * the same rules as `presentationOf` below, written once more as a few lines of
 * plain JavaScript because it must run before any bundle has loaded; the two
 * are held equal by `tests/quran/reader-surface.test.ts`, which runs the
 * script against the same stored values and compares the result.
 */

export const PREFERENCES_KEY = 'minhaj.quran.reader';
export const LAST_READ_KEY = 'minhaj.quran.lastRead';

/** Verse by verse with translations; flowing Arabic; grouped by mushaf page. */
export const READING_MODES = Object.freeze(['translation', 'reading', 'mushaf'] as const);
export type ReadingMode = (typeof READING_MODES)[number];

export const LEADINGS = Object.freeze(['compact', 'comfortable', 'spacious'] as const);
export type Leading = (typeof LEADINGS)[number];

/** Several translations one under another, or side by side on a wide screen. */
export const TRANSLATION_LAYOUTS = Object.freeze(['stacked', 'side'] as const);
export type TranslationLayout = (typeof TRANSLATION_LAYOUTS)[number];

/** How far each size may move, as a multiple of the reader's base size. */
export const SCALE = Object.freeze({ min: 0.8, max: 1.6, step: 0.1, initial: 1 });

/**
 * How many translations one reading page renders beside the Arabic, so any of
 * them can be shown or hidden without another request. More public works than
 * this are chosen one at a time through the reading form (`?translation=`).
 */
export const TRANSLATIONS_RENDERED_MAX = 4;

export interface ReaderPreferences {
  readonly mode: ReadingMode;
  /** The master switch: no translation at all while off. */
  readonly translationsOn: boolean;
  /** The works chosen by slug, in order; `null` is the page's own default. */
  readonly translations: readonly string[] | null;
  readonly arabicScale: number;
  readonly translationScale: number;
  readonly leading: Leading;
  readonly layout: TranslationLayout;
}

export const DEFAULT_PREFERENCES: ReaderPreferences = Object.freeze({
  mode: 'translation',
  translationsOn: true,
  translations: null,
  arabicScale: SCALE.initial,
  translationScale: SCALE.initial,
  leading: 'comfortable',
  layout: 'stacked',
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

function oneOf<T extends string>(values: readonly T[], value: unknown, fallback: T): T {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** A stored list of works: slugs only, each once, at most the rendered maximum. */
function worksOf(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const slugs = value.filter(
    (slug): slug is string =>
      typeof slug === 'string' && quranSlugSchema.safeParse(slug).success,
  );
  if (slugs.length !== value.length) return null;
  return [...new Set(slugs.slice(0, TRANSLATIONS_RENDERED_MAX))];
}

/**
 * Stored preferences, validated; anything unreadable is the default. The R2
 * shape (`translations: 'ur' | 'en' | 'both' | 'none'`) is read too: `none`
 * keeps translations off and the rest fall back to the page's default.
 */
export function readPreferences(raw: string | null): ReaderPreferences {
  if (raw === null) return DEFAULT_PREFERENCES;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_PREFERENCES;
  }
  if (!isRecord(parsed)) return DEFAULT_PREFERENCES;
  const legacyOff = parsed['translations'] === 'none';
  return {
    mode: oneOf(READING_MODES, parsed['mode'], DEFAULT_PREFERENCES.mode),
    translationsOn: legacyOff ? false : parsed['translationsOn'] !== false,
    translations: worksOf(parsed['translations']),
    arabicScale: scaleOf(parsed['arabicScale']),
    translationScale: scaleOf(parsed['translationScale']),
    leading: oneOf(LEADINGS, parsed['leading'], DEFAULT_PREFERENCES.leading),
    layout: oneOf(TRANSLATION_LAYOUTS, parsed['layout'], DEFAULT_PREFERENCES.layout),
  };
}

export function writePreferences(preferences: ReaderPreferences): string {
  return JSON.stringify({
    mode: preferences.mode,
    translationsOn: preferences.translationsOn,
    translations: preferences.translations,
    arabicScale: preferences.arabicScale,
    translationScale: preferences.translationScale,
    leading: preferences.leading,
    layout: preferences.layout,
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

/* ===========================================================================
 * Which translations are shown
 * ========================================================================= */

/** The primary subtag of a content-language code: `ur-PK` → `ur`. */
export const primaryLanguage = (code: string): string => code.split('-')[0] ?? code;

/**
 * The page's own default among the translations it rendered (by index): the
 * interface language's first where there is one; none in Arabic, whose readers
 * read the text itself; otherwise the first rendered.
 */
export function defaultShown(
  locale: string,
  languages: readonly string[],
): readonly number[] {
  if (locale === 'ar' || languages.length === 0) return [];
  const own = languages.findIndex((language) => primaryLanguage(language) === locale);
  return [own >= 0 ? own : 0];
}

/** What one reading page rendered, as its reader element declares it. */
export interface RenderedTranslations {
  /** The rendered works' slugs, in index order. */
  readonly slugs: readonly string[];
  /** The indexes shown when nothing is stored. */
  readonly defaults: readonly number[];
  /** The address chose the work itself: it always shows. */
  readonly fixed: boolean;
}

/** The rendered translations shown, by index, ascending. */
export function shownOf(
  preferences: ReaderPreferences,
  page: RenderedTranslations,
): readonly number[] {
  if (page.fixed) return page.slugs.map((_, index) => index);
  if (!preferences.translationsOn) return [];
  if (preferences.translations === null) return [...page.defaults];
  if (preferences.translations.length === 0) return [];
  const chosen = preferences.translations
    .map((slug) => page.slugs.indexOf(slug))
    .filter((index) => index >= 0);
  return chosen.length === 0
    ? [...page.defaults]
    : [...new Set(chosen)].sort((a, b) => a - b);
}

/* ===========================================================================
 * What the reader element carries
 * ========================================================================= */

/**
 * The attributes and custom properties a reader element takes for a set of
 * preferences. `null` leaves a value as the server rendered it: the mode on a
 * page without modes (a citation), and the Arabic scale when the address set
 * a size of its own.
 */
export interface ReaderPresentation {
  readonly mode: ReadingMode | null;
  readonly shown: string;
  readonly leading: Leading;
  readonly layout: TranslationLayout;
  readonly arabicScale: number | null;
  readonly translationScale: number;
}

export function presentationOf(
  preferences: ReaderPreferences,
  page: RenderedTranslations & {
    readonly modes: boolean;
    readonly explicitSize: boolean;
  },
): ReaderPresentation {
  return {
    mode: page.modes ? preferences.mode : null,
    shown: shownOf(preferences, page).join(' '),
    leading: preferences.leading,
    layout: preferences.layout,
    arabicScale: page.explicitSize ? null : preferences.arabicScale,
    translationScale: preferences.translationScale,
  };
}

/**
 * The same rules, run by the browser before the first paint. It reads only
 * the reader element's own declared attributes and this browser's stored
 * preferences, and writes only `data-*` attributes and two CSS custom
 * properties on that element (through the CSSOM, which `style-src 'self'`
 * permits). It never throws: unreadable storage leaves the server's render.
 * Its first act marks the element `data-script`, so controls that need script
 * are drawn from the first paint when script runs, and never without it.
 */
export const READER_BOOT_SCRIPT = `(function(r){if(!r)return;r.setAttribute("data-script","");var p;try{p=JSON.parse(window.localStorage.getItem(${JSON.stringify(PREFERENCES_KEY)})||"null")}catch(e){return}if(!p||typeof p!=="object"||Array.isArray(p))return;function one(v,a){return typeof v==="string"&&a.indexOf(v)>=0}function sc(v){return typeof v==="number"&&isFinite(v)&&v>=${String(SCALE.min)}&&v<=${String(SCALE.max)}}if(r.hasAttribute("data-modes")&&one(p.mode,${JSON.stringify(READING_MODES)}))r.setAttribute("data-mode",p.mode);if(one(p.leading,${JSON.stringify(LEADINGS)}))r.setAttribute("data-leading",p.leading);if(one(p.layout,${JSON.stringify(TRANSLATION_LAYOUTS)}))r.setAttribute("data-layout",p.layout);if(!r.hasAttribute("data-fixed")){var s=(r.getAttribute("data-slugs")||"").split(" ").filter(Boolean),d=r.getAttribute("data-shown")||"",w=null;if(p.translationsOn===false||p.translations==="none")w="";else if(Array.isArray(p.translations)){var ok=true;for(var i=0;i<p.translations.length;i++)if(typeof p.translations[i]!=="string"||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.translations[i])||p.translations[i].length<2||p.translations[i].length>120)ok=false;if(ok){if(p.translations.length===0)w="";else{var c=[];for(var j=0;j<p.translations.length&&j<${String(TRANSLATIONS_RENDERED_MAX)};j++){var k=s.indexOf(p.translations[j]);if(k>=0&&c.indexOf(k)<0)c.push(k)}c.sort(function(a,b){return a-b});w=c.length?c.join(" "):d}}}if(w!==null)r.setAttribute("data-shown",w)}if(sc(p.arabicScale)&&!r.hasAttribute("data-explicit-size"))r.style.setProperty("--quran-arabic-scale",String(p.arabicScale));if(sc(p.translationScale))r.style.setProperty("--quran-translation-scale",String(p.translationScale))})(document.currentScript&&document.currentScript.parentElement)`;

/* ===========================================================================
 * The last place read on this device
 * ========================================================================= */

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
