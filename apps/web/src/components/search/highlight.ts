/**
 * Which parts of a result's text match the query, as SEGMENTS — never markup.
 *
 * SAFE BY SHAPE. The caller renders each segment as a React text node, wrapping
 * the matching ones in `<mark>`. No HTML string is built, so text stored in the
 * index — whatever an owner published — can never become markup here
 * (DELIVERY_PLAN.md Phase 17 §22).
 *
 * COSMETIC, NOT AUTHORITATIVE. The engine decided what matched; this only helps
 * a reader see why. It matches the typed words case-insensitively and does not
 * try to reproduce stemming, so a result found through a word's other form is
 * simply shown unhighlighted rather than highlighted wrongly.
 */

export interface Segment {
  readonly text: string;
  readonly match: boolean;
}

/** Words of two or more letters, marks or digits — the same words the query used. */
const WORD = /[\p{L}\p{M}\p{N}]{2,}/gu;

export function highlightSegments(text: string, query: string): readonly Segment[] {
  const lower = text.toLowerCase();
  // A lower-casing that changes the length would misalign every offset below.
  // Rare, and showing the text plainly is the honest fallback.
  if (lower.length !== text.length) return [{ text, match: false }];

  const words = [...new Set(query.normalize('NFC').toLowerCase().match(WORD) ?? [])]
    .sort((a, b) => b.length - a.length)
    .slice(0, 8);
  if (words.length === 0) return [{ text, match: false }];

  const marked = new Array<boolean>(text.length).fill(false);
  for (const word of words) {
    let from = lower.indexOf(word);
    while (from !== -1) {
      for (let index = from; index < from + word.length; index += 1) marked[index] = true;
      from = lower.indexOf(word, from + word.length);
    }
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
