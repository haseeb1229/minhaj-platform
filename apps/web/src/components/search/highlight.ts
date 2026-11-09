import { foldForMatching, foldSegments, MATCH_WORD } from '@minhaj/contracts/search';

/**
 * Which parts of a result's text match the query, as SEGMENTS — never markup.
 *
 * SAFE BY SHAPE. The caller renders each segment as a React text node, wrapping
 * the matching ones in `<mark>`. No HTML string is built, so text stored in the
 * index — whatever an owner published — can never become markup here
 * (DELIVERY_PLAN.md Phase 17 §22).
 *
 * THE ENGINE'S FOLD, NOT A SECOND ONE (Quran Part 4). The typed words and the
 * text are compared through the Search vocabulary's own matching fold
 * (`@minhaj/contracts/search`, `fold.ts`): case, harakat and Quranic marks,
 * letter variants and — through the Uthmani reading — the long vowels the
 * Quran text writes as marks. So "الصلاة" typed plainly marks "ٱلصَّلَوٰةَ"
 * in the canonical text, marks and all, and the segments are always cut from
 * the ORIGINAL text: a combining mark is never split from its letter.
 *
 * COSMETIC, NOT AUTHORITATIVE. The engine decided what matched; this only helps
 * a reader see why. It does not reproduce stemming or clitic analysis beyond
 * finding a typed word inside a longer one, so a result found through a word's
 * other form is simply shown unhighlighted rather than highlighted wrongly.
 */

export interface Segment {
  readonly text: string;
  readonly match: boolean;
}

/** The most typed words highlighted — the same bound the engine applies. */
const MAX_WORDS = 8;

/**
 * One UTF-16 unit of a word: a letter, a combining mark, a digit — or half of
 * a surrogate pair, which only a supplementary-plane letter ever is here.
 */
const WORD_UNIT = /^[\p{L}\p{M}\p{N}\uD800-\uDFFF]$/u;

/** Marks, in `marked`, every original character a folded occurrence of `word` came from. */
function markFold(
  text: string,
  reading: boolean,
  words: readonly string[],
  marked: boolean[],
): void {
  const segments = foldSegments(text, reading);
  let folded = '';
  const origin: { start: number; end: number }[] = [];
  for (const segment of segments) {
    folded += segment.text;
    // One origin per UTF-16 unit of the folded text, so `indexOf` offsets map.
    const source = { start: segment.start, end: segment.end };
    origin.push(...Array.from({ length: segment.text.length }, () => source));
  }
  for (const word of words) {
    let from = folded.indexOf(word);
    while (from !== -1) {
      for (let index = from; index < from + word.length; index += 1) {
        const source = origin[index];
        if (source === undefined) continue;
        for (let at = source.start; at < source.end; at += 1) marked[at] = true;
      }
      from = folded.indexOf(word, from + word.length);
    }
  }
}

export function highlightSegments(text: string, query: string): readonly Segment[] {
  // Words of two or more letters, marks or digits, folded as the engine folds them.
  const words = [
    ...new Set(
      (foldForMatching(query).match(MATCH_WORD) ?? []).filter(
        (word) => [...word].length >= 2,
      ),
    ),
  ]
    .sort((a, b) => b.length - a.length)
    .slice(0, MAX_WORDS);
  if (words.length === 0) return [{ text, match: false }];

  const marked = new Array<boolean>(text.length).fill(false);
  markFold(text, false, words, marked);
  markFold(text, true, words, marked);

  // WHOLE WORDS. A typed word found inside a longer one — a prefix the engine
  // matched, an Arabic word behind its joined article or preposition — marks
  // the whole word, so a highlight never cuts a joined Arabic word in two.
  for (let index = 0; index < text.length; index += 1) {
    if (!marked[index]) continue;
    let left = index;
    while (left > 0 && !marked[left - 1] && WORD_UNIT.test(text[left - 1] ?? ''))
      left -= 1;
    for (let at = left; at < index; at += 1) marked[at] = true;
    let right = index;
    while (right + 1 < text.length && WORD_UNIT.test(text[right + 1] ?? '')) right += 1;
    for (let at = index; at <= right; at += 1) marked[at] = true;
    index = right;
  }

  const segments: Segment[] = [];
  let start = 0;
  for (let index = 1; index <= text.length; index += 1) {
    if (index === text.length || marked[index] !== marked[start]) {
      segments.push({ text: text.slice(start, index), match: marked[start] ?? false });
      start = index;
    }
  }
  return segments;
}
