import { z } from 'zod';

import type { Locale } from '@minhaj/contracts';
import {
  QURAN_AYAH_NUMBER_MAX,
  QURAN_JUZ_MAX,
  QURAN_SURAH_MAX,
  numericSegment,
  quranSlugSchema,
  type PublicRecitationSegment,
  type PublicSurah,
  type PublicTajweedRule,
  type QuranRef,
  type TafsirEntryRecord,
  type TajweedRuleText,
} from '@minhaj/contracts/quran';

import { isSupportedLocale } from '@/config/locale';

/**
 * Presentation decisions for the public Quran surfaces — PURE and free of React
 * (ROUTE_MAP.md §3.3; DELIVERY_PLAN.md Phase 18).
 *
 * Which address a Surah, an Ayah, a Juz or a layered work has; which reading
 * preferences a URL asks for; and where a Tafsir entry or a recitation segment
 * belongs. Each has ONE implementation: the pages, the sitemap and the search
 * labels all call these, so no two can spell a citation differently.
 *
 * NOTHING HERE KNOWS WHAT THE QURAN SAYS. No count of ayat, no Surah name and
 * no Juz boundary is written here — every such fact arrives from the reader,
 * and the numeric ceilings below only refuse an impossible address.
 */

type Query = Record<string, string | string[] | undefined>;

const part = (value: string) => encodeURIComponent(value);

/* ===========================================================================
 * Addresses — locale-free first, then prefixed once
 * ========================================================================= */

/** The LOCALE-FREE canonical citation of one Ayah (ROUTE_MAP.md §2.1). */
export function ayahPathOf(ref: QuranRef): string {
  return `/quran/surah/${String(ref.surah)}/${String(ref.ayah)}`;
}

export function ayahPath(locale: string, ref: QuranRef): string {
  return `/${locale}${ayahPathOf(ref)}`;
}

export function surahPathOf(surah: number): string {
  return `/quran/surah/${String(surah)}`;
}

export function surahPath(locale: string, surah: number): string {
  return `/${locale}${surahPathOf(surah)}`;
}

export function juzPathOf(juz: number): string {
  return `/quran/juz/${String(juz)}`;
}

export function juzPath(locale: string, juz: number): string {
  return `/${locale}${juzPathOf(juz)}`;
}

/** The Quran section address under a locale: `/{locale}/quran[/{section}]`. */
export function quranPath(locale: string, section = ''): string {
  return section === '' ? `/${locale}/quran` : `/${locale}/quran/${section}`;
}

export function translationPath(locale: string, slug: string): string {
  return `/${locale}/quran/translations/${part(slug)}`;
}

export function tafsirPath(locale: string, slug: string): string {
  return `/${locale}/quran/tafsir/${part(slug)}`;
}

export function tajweedRulePath(locale: string, slug: string): string {
  return `/${locale}/quran/tajweed/${part(slug)}`;
}

/** A reciter's recitations — addressed by the PERSON's public slug. */
export function reciterPath(locale: string, personSlug: string): string {
  return `/${locale}/quran/recitations/${part(personSlug)}`;
}

/** A recitation segment's bytes: first-party, addressed by all three identifiers. */
export function recitationAssetPath(segment: {
  readonly recitationId: string;
  readonly segmentId: string;
  readonly assetId: string;
}): string {
  return `/assets/quran/recitations/${part(segment.recitationId)}/${part(segment.segmentId)}/${part(segment.assetId)}`;
}

/** The `#ayah-{n}` anchor every Ayah carries on a Surah page. */
export function ayahAnchor(ayah: number): string {
  return `ayah-${String(ayah)}`;
}

/* ===========================================================================
 * Path segments
 * ========================================================================= */

/** A Surah number from a path segment — canonical decimal, within the range. */
export function readSurahSegment(value: string): number | null {
  return numericSegment(value, QURAN_SURAH_MAX);
}

export function readAyahSegment(value: string): number | null {
  return numericSegment(value, QURAN_AYAH_NUMBER_MAX);
}

export function readJuzSegment(value: string): number | null {
  return numericSegment(value, QURAN_JUZ_MAX);
}

/** A layered work's or a rule's slug from a path segment, or `null`. */
export function readSlugSegment(value: string): string | null {
  return quranSlugSchema.safeParse(value).success ? value : null;
}

/* ===========================================================================
 * Reading preferences — query parameters, never path segments
 * ========================================================================= */

/** The four layers a reader may choose, in the order the form lists them. */
export const READING_LAYERS = Object.freeze([
  'translation',
  'transliteration',
  'tafsir',
  'reciter',
] as const);

export type ReadingLayer = (typeof READING_LAYERS)[number];

/**
 * What one preference parameter asked for.
 *
 * `invalid` is a value that is not one slug — repeated, malformed or too long.
 * It is NEVER widened to "any" or narrowed to "the first": the page says the
 * request could not be honoured and shows no layer for it (Phase 18 §5).
 */
export type LayerRequest =
  | { readonly state: 'none' }
  | { readonly state: 'invalid' }
  | { readonly state: 'requested'; readonly slug: string };

/** How large the Arabic is set. Ephemeral — a query value, never an account setting. */
export const TEXT_SIZES = Object.freeze(['small', 'medium', 'large', 'larger'] as const);
export type TextSize = (typeof TEXT_SIZES)[number];
export const DEFAULT_TEXT_SIZE: TextSize = 'medium';

export interface ReadingRequest {
  readonly translation: LayerRequest;
  readonly transliteration: LayerRequest;
  readonly tafsir: LayerRequest;
  readonly reciter: LayerRequest;
  readonly size: TextSize;
}

function layerRequest(query: Query, key: ReadingLayer): LayerRequest {
  const raw = query[key];
  if (raw === undefined || raw === '') return { state: 'none' };
  if (typeof raw !== 'string') return { state: 'invalid' };
  return quranSlugSchema.safeParse(raw).success
    ? { state: 'requested', slug: raw }
    : { state: 'invalid' };
}

/**
 * A URL's reading preferences, TOLERATED: each is read as one string and
 * shape-checked. Whether a requested slug names a PUBLIC work is the reader's
 * question, asked by the page; nothing here can make a withheld work visible.
 * An unknown size is the default size — a display preference, not a layer.
 */
export function readReadingRequest(query: Query): ReadingRequest {
  const size = query['size'];
  return {
    translation: layerRequest(query, 'translation'),
    transliteration: layerRequest(query, 'transliteration'),
    tafsir: layerRequest(query, 'tafsir'),
    reciter: layerRequest(query, 'reciter'),
    size:
      typeof size === 'string' && (TEXT_SIZES as readonly string[]).includes(size)
        ? (size as TextSize)
        : DEFAULT_TEXT_SIZE,
  };
}

/** The preferences a page actually honours — only slugs the reader confirmed. */
export interface ReadingChoice {
  readonly translation: string | null;
  readonly transliteration: string | null;
  readonly tafsir: string | null;
  readonly reciter: string | null;
  readonly size: TextSize;
}

export const NO_READING_CHOICE: ReadingChoice = Object.freeze({
  translation: null,
  transliteration: null,
  tafsir: null,
  reciter: null,
  size: DEFAULT_TEXT_SIZE,
});

/**
 * An address carrying the confirmed preferences, neutral values omitted, in a
 * fixed order — so a citation with no preference is exactly the canonical
 * citation, and a reader moving from Ayah to Ayah keeps what they chose.
 */
export function withReading(
  path: string,
  choice: ReadingChoice,
  overrides: Partial<ReadingChoice> = {},
  anchor: string | null = null,
): string {
  const merged = { ...choice, ...overrides };
  const search = new URLSearchParams();
  for (const layer of READING_LAYERS) {
    const slug = merged[layer];
    if (slug !== null) search.set(layer, slug);
  }
  if (merged.size !== DEFAULT_TEXT_SIZE) search.set('size', merged.size);
  const text = search.toString();
  return `${path}${text === '' ? '' : `?${text}`}${anchor === null ? '' : `#${anchor}`}`;
}

/* ===========================================================================
 * Paging
 * ========================================================================= */

/** A plain `?offset=`, bounded; anything else is the first page. */
export function readQuranOffset(query: Query): number {
  const raw = query['offset'];
  return z.coerce
    .number()
    .int()
    .min(0)
    .max(25_000)
    .catch(0)
    .parse(typeof raw === 'string' && /^\d{1,5}$/.test(raw) ? raw : 0);
}

/** A paged address. The first page is the bare address. */
export function offsetPathOf(path: string, offset: number): string {
  return offset <= 0 ? path : `${path}?offset=${String(offset)}`;
}

/** The previous and next page offsets of a bounded page, or `null` at an end. */
export function pageLinks(
  offset: number,
  size: number,
  total: number,
): { readonly previous: number | null; readonly next: number | null } {
  return {
    previous: offset > 0 ? Math.max(0, offset - size) : null,
    next: offset + size < total ? offset + size : null,
  };
}

/* ===========================================================================
 * Citation navigation
 * ========================================================================= */

/**
 * The Ayah before a citation: the previous one in its Surah, or the LAST Ayah
 * of the previous Surah — whose length the caller read from the reader, never
 * from a table here. `null` at the very beginning.
 */
export function previousAyah(
  ref: QuranRef,
  previousSurahAyahCount: number | null,
): QuranRef | null {
  if (ref.ayah > 1) return { surah: ref.surah, ayah: ref.ayah - 1 };
  if (ref.surah <= 1 || previousSurahAyahCount === null || previousSurahAyahCount < 1)
    return null;
  return { surah: ref.surah - 1, ayah: previousSurahAyahCount };
}

/** The Ayah after a citation, crossing into the next Surah when one exists. */
export function nextAyah(
  ref: QuranRef,
  ayahCount: number,
  nextSurahExists: boolean,
): QuranRef | null {
  if (ref.ayah < ayahCount) return { surah: ref.surah, ayah: ref.ayah + 1 };
  return nextSurahExists && ref.surah < QURAN_SURAH_MAX
    ? { surah: ref.surah + 1, ayah: 1 }
    : null;
}

/* ===========================================================================
 * Layers placed against ayat
 * ========================================================================= */

/** The recitation segment whose range covers an Ayah, if any. */
export function segmentCovering(
  segments: readonly PublicRecitationSegment[],
  ref: QuranRef,
): PublicRecitationSegment | null {
  return (
    segments.find(
      (segment) =>
        segment.surah === ref.surah &&
        segment.startAyah <= ref.ayah &&
        ref.ayah <= segment.endAyah,
    ) ?? null
  );
}

/**
 * Where each Tafsir entry is shown on a page of ayat: after the LAST shown Ayah
 * of its range, so commentary on several ayat follows all of them rather than
 * interrupting the first. An entry that overlaps none of the shown ayat is not
 * placed at all. Order within one Ayah is the entries' own order.
 */
export function tafsirPlacement(
  entries: readonly TafsirEntryRecord[],
  shownAyat: readonly number[],
): ReadonlyMap<number, readonly TafsirEntryRecord[]> {
  const placed = new Map<number, TafsirEntryRecord[]>();
  for (const entry of entries) {
    let at: number | null = null;
    for (const ayah of shownAyat) {
      if (ayah >= entry.startAyah && ayah <= entry.endAyah && (at === null || ayah > at))
        at = ayah;
    }
    if (at === null) continue;
    const list = placed.get(at) ?? [];
    list.push(entry);
    placed.set(at, list);
  }
  return placed;
}

/* ===========================================================================
 * Labels
 * ========================================================================= */

/** Locales tried, in order, for a Surah's display name after the reader's own. */
const NAME_ORDER: readonly Locale[] = ['en', 'ur', 'ar'];

/**
 * A Surah's display name for an interface locale: the reader's own when the
 * operator recorded one, otherwise the first that exists — returned WITH the
 * locale it is actually in, so the element is marked with that language rather
 * than passed off as a translation. `null` when no name was recorded at all;
 * the page then says "Surah {number}" and nothing more.
 */
export function surahName(
  surah: Pick<PublicSurah, 'names'>,
  locale: Locale,
): { readonly text: string; readonly locale: Locale } | null {
  for (const candidate of [locale, ...NAME_ORDER]) {
    const text = surah.names[candidate];
    if (text !== undefined && text !== '') return { text, locale: candidate };
  }
  return null;
}

/* ===========================================================================
 * Tajweed — the language a rule is shown in
 * ========================================================================= */

/**
 * The text of a rule a page shows: the interface locale's when the source
 * supplied one, otherwise the first it did — and the page then SAYS it is
 * showing another language rather than passing it off as a translation.
 */
export function tajweedTextFor(
  rule: Pick<PublicTajweedRule, 'texts'>,
  locale: Locale,
): { readonly text: TajweedRuleText; readonly fallback: boolean } | null {
  const own = rule.texts.find((text) => text.languageCode === locale);
  if (own !== undefined) return { text: own, fallback: false };
  const first = rule.texts[0];
  return first === undefined ? null : { text: first, fallback: true };
}

/** The interface locales a rule genuinely has text in — its `hreflang` set. */
export function tajweedLocales(rule: Pick<PublicTajweedRule, 'texts'>): Locale[] {
  return rule.texts.flatMap((text) =>
    isSupportedLocale(text.languageCode) ? [text.languageCode] : [],
  );
}

/* ===========================================================================
 * Quran search — what is passed to the shared Search service
 * ========================================================================= */

/** One parameter as one string; a repeated parameter is its first value. */
function single(query: Query, name: string): string {
  const value = query[name];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? first : '';
}

/** The only parameters this page passes to Search — and the type, fixed. */
export function quranSearchRequest(query: Query): Record<string, string> {
  const q = single(query, 'q');
  const page = single(query, 'page');
  return {
    q,
    type: 'quran-ayah',
    ...(page === '' ? {} : { page }),
  };
}
