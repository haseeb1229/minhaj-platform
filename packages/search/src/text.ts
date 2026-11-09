import {
  foldForMatching,
  MATCH_WORD,
  readingWords,
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

/** A word: letters, combining marks and digits. Everything else separates. */
const WORD = MATCH_WORD;

/**
 * The plain fold (`@minhaj/contracts/search` `fold.ts`): NFC, lower case,
 * Arabic-script harakat and Quranic marks, joiners, tatweel and the hamza on
 * the line removed, and the Arabic-script letters ordinary typing writes
 * interchangeably unified. Re-exported so every caller here names one fold.
 */
export { foldForMatching };

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
 *
 * THE UTHMANI READING IS ADDED, NEVER SUBSTITUTED (Quran Part 4). Where a text
 * writes long vowels as Quranic marks — the dagger alef, a waw carrying it, a
 * small waw or yeh, a hamza on a tatweel — the words its READING spells
 * differently (`readingWords`: الكتاب beside الكتب, الصلاه beside الصلوه) follow
 * the folded text on a line of their own, inside the same bound. A query is
 * folded plainly, so it meets the word whichever way ordinary spelling writes
 * it. A text with no such marks gains nothing.
 */
export function matchingText(input: {
  readonly title: string;
  readonly summary: string;
  readonly body: string;
}): string {
  const combined = truncate(
    [input.title, input.summary, input.body]
      .map(collapse)
      .filter((part) => part !== '')
      .join('\n'),
    SEARCH_BODY_MAX_LENGTH,
  );
  const folded = foldForMatching(combined);

  let budget = SEARCH_BODY_MAX_LENGTH - [...folded].length - 1;
  const added: string[] = [];
  for (const word of readingWords(combined)) {
    const cost = [...word].length + 1;
    if (cost > budget) break;
    added.push(word);
    budget -= cost;
  }
  return added.length === 0 ? folded : `${folded}\n${added.join(' ')}`;
}
