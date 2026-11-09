import {
  citationOf,
  type AyahSearchRecord,
  type QuranRef,
} from '@minhaj/contracts/quran';

import { highlightSegments } from '@/components/search/highlight';

/**
 * QURAN SEARCH — the page's own rules (Quran Part 4). PURE and free of React
 * and of server code, so the page and the tests share one implementation.
 *
 * THE FILTERS ARE NAVIGATION OVER THE READER'S OWN STRUCTURE. `?surah=` and
 * `?juz=` are canonical decimal numbers the reader confirms exist; `?language=`
 * is one of the languages the public texts are written in. Each becomes either
 * a restriction built from the reader's numbers — the citations of a Surah, of
 * a Juz's range, or both at once — or a refusal the page states. No value a URL
 * carries is ever passed on as written.
 *
 * NOTHING HERE KNOWS WHAT THE QURAN SAYS. Counts and ranges arrive from the
 * reader; texts arrive from its current public records and are only cut for a
 * snippet and marked for a highlight — never folded, respelled or joined.
 */

type Query = Readonly<Record<string, string | readonly string[] | undefined>>;

/** One parameter as one bounded string; a repeated parameter is its first value. */
function single(query: Query, name: string, max: number): string {
  const value = query[name];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? first.slice(0, max) : '';
}

/** What the page echoes into its form and its links — bounded, never trusted. */
export interface QuranSearchForm {
  readonly q: string;
  readonly surah: string;
  readonly juz: string;
  readonly language: string;
}

export interface QuranSearchFilters {
  readonly surah: number | null;
  readonly juz: number | null;
  /** A language of the public texts, lower case: `ar` for the Arabic. */
  readonly language: string | null;
}

export type QuranFilterIssue = 'surah' | 'juz' | 'language';

export interface QuranSearchCatalogue {
  readonly surahs: readonly { readonly number: number; readonly ayahCount: number }[];
  readonly juz: readonly {
    readonly number: number;
    readonly start: QuranRef;
    readonly end: QuranRef;
  }[];
  /** The languages a visitor may choose, lower case — `ar` and each public layer's. */
  readonly languages: readonly string[];
}

const NUMBER = /^[1-9][0-9]{0,2}$/;

/** The filters an address asks for, each confirmed against the catalogue or refused. */
export function readQuranSearch(
  query: Query,
  catalogue: QuranSearchCatalogue,
): {
  readonly form: QuranSearchForm;
  readonly filters: QuranSearchFilters;
  readonly issues: readonly QuranFilterIssue[];
} {
  const form: QuranSearchForm = {
    q: single(query, 'q', 400),
    surah: single(query, 'surah', 8),
    juz: single(query, 'juz', 8),
    language: single(query, 'language', 16),
  };
  const issues: QuranFilterIssue[] = [];

  const number = (
    value: string,
    known: readonly { readonly number: number }[],
    issue: QuranFilterIssue,
  ): number | null => {
    if (value === '') return null;
    const found = NUMBER.test(value)
      ? known.find((entry) => entry.number === Number(value))
      : undefined;
    if (found === undefined) issues.push(issue);
    return found?.number ?? null;
  };

  const surah = number(form.surah, catalogue.surahs, 'surah');
  const juz = number(form.juz, catalogue.juz, 'juz');
  const wanted = form.language.toLowerCase();
  const language =
    wanted === '' ? null : catalogue.languages.includes(wanted) ? wanted : null;
  if (wanted !== '' && language === null) issues.push('language');

  return { form, filters: { surah, juz, language }, issues };
}

/** Whether any filter is set — what opens the filter panel and offers "clear all". */
export function hasQuranFilters(filters: QuranSearchFilters): boolean {
  return filters.surah !== null || filters.juz !== null || filters.language !== null;
}

/**
 * The page's own address for a query, its filters and a page of results —
 * empty values and the first page left out, so equal searches share one URL.
 */
export function quranSearchHref(
  path: string,
  state: {
    readonly q: string;
    readonly surah?: number | null;
    readonly juz?: number | null;
    readonly language?: string | null;
    readonly page?: number;
  },
): string {
  const search = new URLSearchParams();
  if (state.q !== '') search.set('q', state.q);
  if (state.surah != null) search.set('surah', String(state.surah));
  if (state.juz != null) search.set('juz', String(state.juz));
  if (state.language != null && state.language !== '')
    search.set('language', state.language);
  if (state.page !== undefined && state.page > 1) search.set('page', String(state.page));
  const text = search.toString();
  return text === '' ? path : `${path}?${text}`;
}

/**
 * The citations a Surah and Juz filter allow, in canonical order — `null` when
 * neither is set, and empty when the two do not overlap. Built from the
 * reader's own counts and Juz ranges, never from the address.
 */
export function citationsWithin(
  filters: Pick<QuranSearchFilters, 'surah' | 'juz'>,
  catalogue: Pick<QuranSearchCatalogue, 'surahs' | 'juz'>,
): readonly string[] | null {
  if (filters.surah === null && filters.juz === null) return null;
  const counts = [...catalogue.surahs].sort((a, b) => a.number - b.number);
  const juz =
    filters.juz === null
      ? null
      : (catalogue.juz.find((entry) => entry.number === filters.juz) ?? null);
  if (filters.juz !== null && juz === null) return [];

  const order = (ref: QuranRef) => ref.surah * 1000 + ref.ayah;
  const citations: string[] = [];
  for (const surah of counts) {
    if (filters.surah !== null && surah.number !== filters.surah) continue;
    if (juz !== null && (surah.number < juz.start.surah || surah.number > juz.end.surah))
      continue;
    for (let ayah = 1; ayah <= surah.ayahCount; ayah += 1) {
      const ref = { surah: surah.number, ayah };
      if (juz !== null && (order(ref) < order(juz.start) || order(ref) > order(juz.end)))
        continue;
      citations.push(citationOf(ref));
    }
  }
  return citations;
}

/** Whether the typed words mark anything in a text — the highlighter's own fold. */
function marksIn(text: string, query: string): boolean {
  return highlightSegments(text, query).some((segment) => segment.match);
}

type Layer = AyahSearchRecord['layers'][number];

/** The most layer texts one result shows. */
export const RESULT_LAYERS_MAX = 3;

/**
 * Which public layer texts one result shows beneath its Arabic, in work-slug
 * order:
 *
 *   - with a translation language chosen, that language's texts;
 *   - otherwise every text the typed words mark — "the matching snippets",
 *     a translator's note among them only when the words mark the note
 *     itself, labelled as the note it is (Quran Part 6);
 *   - otherwise, for a result found in a layer language, that language's
 *     texts (the engine matched a form the highlighter does not reproduce);
 *   - otherwise the reader's own interface language's texts, so a result
 *     found in the Arabic still shows what it means — or none at all.
 */
export function layersShown(
  record: Pick<AyahSearchRecord, 'layers'>,
  context: {
    readonly hitLanguage: string;
    readonly language: string | null;
    readonly locale: string;
    readonly query: string;
  },
): readonly Layer[] {
  // Texts before notes, each in work-slug order (a note keeps its own order).
  const noteLast = (kind: string) => (kind === 'note' ? 1 : 0);
  const layers = [...record.layers].sort(
    (a, b) =>
      noteLast(a.kind) - noteLast(b.kind) ||
      (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0) ||
      (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0),
  );
  const ofLanguage = (layer: Layer, code: string) =>
    layer.languageCode.toLowerCase() === code.toLowerCase();
  // A language's texts are its translations and transliterations: a note is
  // shown only where the words mark it.
  const inLanguage = (code: string) =>
    layers.filter((layer) => layer.kind !== 'note' && ofLanguage(layer, code));

  let shown: Layer[];
  if (context.language !== null && context.language !== 'ar') {
    const language = context.language;
    shown = [
      ...inLanguage(language),
      ...layers.filter(
        (layer) =>
          layer.kind === 'note' &&
          ofLanguage(layer, language) &&
          marksIn(layer.text, context.query),
      ),
    ];
  } else {
    const marked =
      context.language === 'ar'
        ? []
        : layers.filter((layer) => marksIn(layer.text, context.query));
    const hit = context.hitLanguage.toLowerCase();
    shown =
      marked.length > 0
        ? marked
        : hit !== 'ar' && context.language === null
          ? inLanguage(hit)
          : inLanguage(context.locale);
  }
  return shown.slice(0, RESULT_LAYERS_MAX);
}

/** The longest snippet of a layer text a result shows, in code points. */
export const SNIPPET_LENGTH = 320;

/**
 * A stretch of a long layer text around the first word the query marks — the
 * whole text when it is short. Cut by code point at spaces where one is near,
 * and said to be cut (`before`, `after`) so the page can show it was; the
 * whole text is one link away, at the Ayah.
 */
export function snippetOf(
  text: string,
  query: string,
): { readonly text: string; readonly before: boolean; readonly after: boolean } {
  const points = [...text];
  if (points.length <= SNIPPET_LENGTH) return { text, before: false, after: false };

  let firstUnit = -1;
  let offset = 0;
  for (const segment of highlightSegments(text, query)) {
    if (segment.match) {
      firstUnit = offset;
      break;
    }
    offset += segment.text.length;
  }
  const first = firstUnit === -1 ? 0 : [...text.slice(0, firstUnit)].length;

  let start = Math.max(0, first - Math.floor(SNIPPET_LENGTH / 4));
  let end = Math.min(points.length, start + SNIPPET_LENGTH);
  start = Math.max(0, end - SNIPPET_LENGTH);

  // Begin after a space and end before one, when one is within reach.
  if (start > 0) {
    const space = points.slice(start, start + 24).indexOf(' ');
    if (space !== -1 && start + space + 1 <= first) start += space + 1;
  }
  if (end < points.length) {
    const tail = points.slice(Math.max(start, end - 24), end);
    const space = tail.lastIndexOf(' ');
    if (space !== -1) end = Math.max(start, end - 24) + space;
  }

  return {
    text: points.slice(start, end).join('').trim(),
    before: start > 0,
    after: end < points.length,
  };
}

/** Whether a typed query holds Arabic-script letters — for the spelling hint. */
export function hasArabicScript(query: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/u.test(query);
}
