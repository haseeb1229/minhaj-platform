import {
  SEARCH_BODY_MAX_LENGTH,
  SEARCH_MAX_TERMS,
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_SUMMARY_MAX_LENGTH,
  SEARCH_TERM_MAX_LENGTH,
  SEARCH_TITLE_MAX_LENGTH,
} from '@minhaj/contracts/search';

/**
 * Text handling for search — engine-independent and applied IDENTICALLY to what
 * is indexed and to what is searched.
 *
 * ONE FOLD, TWO USES. If the stored text and the query were normalised by two
 * different functions they would drift, and a query would stop matching the
 * very text it was typed from. So the same `foldForMatching` produces both.
 *
 * MATCHING TEXT ONLY. Nothing folded is ever displayed: a title keeps its
 * diacritics, its case and its joiners exactly as the owner published it.
 */

/**
 * Arabic-script combining marks: harakat, tanwin, shadda, sukun, the
 * superscript alef and the Quranic annotation signs.
 *
 * Removed for MATCHING because they are optional in ordinary writing — the same
 * word appears with and without them — and because the Urdu word breaker keeps
 * them attached (measured: "تعلیمِ" with its izafat kasra does not match
 * "تعلیم" under it). Removing them from both sides makes that difference
 * disappear for every breaker at once.
 */
const ARABIC_SCRIPT_MARKS =
  /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED]/gu;

/**
 * Characters that join or stretch a word without changing it: the zero-width
 * non-joiner and joiner Urdu uses inside compounds (کتاب, then U+200C, then خانہ), and tatweel.
 * Removed so a word typed with or without them is one word.
 */
// An alternation rather than a character class: a zero-width joiner inside a
// class reads as a joined sequence, which is not what is meant.
const JOINERS = /\u200C|\u200D|\u0640/gu;

/** A word: letters, combining marks and digits. Everything else separates. */
const WORD = /[\p{L}\p{M}\p{N}]+/gu;

export function foldForMatching(text: string): string {
  return text
    .normalize('NFC')
    .replace(ARABIC_SCRIPT_MARKS, '')
    .replace(JOINERS, '')
    .toLowerCase();
}

/** Why a query cannot be run as typed. Each is something the visitor can fix. */
export type QueryIssue =
  'query-too-long' | 'too-many-terms' | 'term-too-long' | 'no-terms';

/**
 * The words of a query, folded, de-duplicated and bounded.
 *
 * THE ONLY PATH FROM A SEARCH BOX TO THE INDEX. What comes out is a list of
 * words made of letters, marks and digits; quotes, operators, wildcards,
 * brackets and punctuation are separators and never survive. The engine
 * adapter composes its grammar from these words and nothing else.
 */
export function queryTerms(
  query: string,
): { readonly terms: readonly string[] } | { readonly issue: QueryIssue } {
  if (query.length > SEARCH_QUERY_MAX_LENGTH) return { issue: 'query-too-long' };

  const words = foldForMatching(query).match(WORD) ?? [];
  const terms = [...new Set(words)];

  if (terms.length === 0) return { issue: 'no-terms' };
  if (terms.length > SEARCH_MAX_TERMS) return { issue: 'too-many-terms' };
  if (terms.some((term) => term.length > SEARCH_TERM_MAX_LENGTH)) {
    return { issue: 'term-too-long' };
  }

  return { terms };
}

/**
 * Cuts text to a length without splitting a character.
 *
 * By CODE POINT, not by UTF-16 unit, so a supplementary-plane character is never
 * halved into an unpaired surrogate the database would store as garbage.
 */
export function truncate(text: string, max: number): string {
  const points = [...text];
  return points.length <= max ? text : points.slice(0, max).join('');
}

/** Collapses runs of whitespace, so a stored summary reads as prose. */
function collapse(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

/**
 * A summary short enough to scan in a result list.
 *
 * Cut at a word boundary where one is near, and marked with an ellipsis when
 * cut at all — a sentence that simply stops mid-word reads as a defect.
 */
const SUMMARY_DISPLAY_LENGTH = 280;

export function displaySummary(text: string): string {
  const collapsed = collapse(text);
  const points = [...collapsed];
  if (points.length <= SUMMARY_DISPLAY_LENGTH) return collapsed;

  const cut = points.slice(0, SUMMARY_DISPLAY_LENGTH).join('');
  const boundary = cut.lastIndexOf(' ');
  const trimmed = boundary > SUMMARY_DISPLAY_LENGTH * 0.6 ? cut.slice(0, boundary) : cut;
  return truncate(`${trimmed}…`, SEARCH_SUMMARY_MAX_LENGTH);
}

export function displayTitle(text: string): string {
  return truncate(collapse(text), SEARCH_TITLE_MAX_LENGTH);
}

/**
 * The text a document is matched by: its title, summary and body, bounded and
 * folded. The title leads, so a short document whose title names the query is
 * dense in it — which is what ranks it above a long one that mentions it once.
 */
export function matchingText(input: {
  readonly title: string;
  readonly summary: string;
  readonly body: string;
}): string {
  const combined = [input.title, input.summary, input.body]
    .map(collapse)
    .filter((part) => part !== '')
    .join('\n');
  return foldForMatching(truncate(combined, SEARCH_BODY_MAX_LENGTH));
}
