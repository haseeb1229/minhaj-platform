/**
 * REVISION DIFF (R2, audit F31) — what changed between two revisions of an
 * editorial record, word by word, for the editor's history panel.
 *
 * PURE, and bounded. Text is compared as words (whitespace kept with the word
 * before it, so the result reassembles exactly); the common start and end are
 * peeled off first, and only the changed middle goes through the
 * longest-common-subsequence table. A middle too large for that table is
 * reported as one removal and one addition rather than allowed to cost
 * quadratic time on a request — `truncated` says so.
 *
 * The body is compared as TEXT. Revisions store sanitised HTML; `htmlToText`
 * drops the markup (block boundaries become line breaks) and decodes the
 * handful of entities the sanitiser emits, so a diff shows words a person
 * wrote, never tags. Nothing here is rendered as HTML.
 */

export type DiffKind = 'same' | 'added' | 'removed';

export interface DiffSegment {
  readonly kind: DiffKind;
  readonly text: string;
}

export interface WordDiff {
  readonly segments: readonly DiffSegment[];
  /** True when nothing differs. */
  readonly identical: boolean;
  /** True when the changed middle was too large to align word by word. */
  readonly truncated: boolean;
}

/** The largest changed middle (in words, each side) aligned word by word. */
export const DIFF_LIMIT = 1_500;

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
};

/** Sanitised HTML as the text a reader sees: tags out, blocks as line breaks. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/h[1-6]|\/li|\/blockquote|\/div)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
      const named = ENTITIES[name.toLowerCase()];
      if (named !== undefined) return named;
      if (name.startsWith('#')) {
        const code =
          name[1] === 'x' || name[1] === 'X'
            ? Number.parseInt(name.slice(2), 16)
            : Number.parseInt(name.slice(1), 10);
        return Number.isInteger(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : whole;
      }
      return whole;
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Words with their trailing whitespace, so `tokens(x).join('') === x`. */
export function tokens(text: string): readonly string[] {
  return text.match(/\s+|\S+\s*/g) ?? [];
}

function push(out: DiffSegment[], kind: DiffKind, text: string): void {
  if (text === '') return;
  const last = out.at(-1);
  if (last !== undefined && last.kind === kind) {
    out[out.length - 1] = { kind, text: last.text + text };
  } else {
    out.push({ kind, text });
  }
}

/** The changes that turn `before` into `after`, word by word. */
export function wordDiff(before: string, after: string): WordDiff {
  if (before === after) {
    return {
      segments: before === '' ? [] : [{ kind: 'same', text: before }],
      identical: true,
      truncated: false,
    };
  }
  const a = tokens(before);
  const b = tokens(after);

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }

  const out: DiffSegment[] = [];
  push(out, 'same', a.slice(0, start).join(''));

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  let truncated = false;

  if (midA.length > DIFF_LIMIT || midB.length > DIFF_LIMIT) {
    truncated = true;
    push(out, 'removed', midA.join(''));
    push(out, 'added', midB.join(''));
  } else {
    // lcs[i][j]: the common subsequence length of midA[i..] and midB[j..].
    const width = midB.length + 1;
    const lcs = new Uint16Array((midA.length + 1) * width);
    for (let i = midA.length - 1; i >= 0; i -= 1) {
      for (let j = midB.length - 1; j >= 0; j -= 1) {
        lcs[i * width + j] =
          midA[i] === midB[j]
            ? (lcs[(i + 1) * width + j + 1] ?? 0) + 1
            : Math.max(lcs[(i + 1) * width + j] ?? 0, lcs[i * width + j + 1] ?? 0);
      }
    }
    let i = 0;
    let j = 0;
    while (i < midA.length && j < midB.length) {
      if (midA[i] === midB[j]) {
        push(out, 'same', midA[i] ?? '');
        i += 1;
        j += 1;
      } else if ((lcs[(i + 1) * width + j] ?? 0) >= (lcs[i * width + j + 1] ?? 0)) {
        push(out, 'removed', midA[i] ?? '');
        i += 1;
      } else {
        push(out, 'added', midB[j] ?? '');
        j += 1;
      }
    }
    push(out, 'removed', midA.slice(i).join(''));
    push(out, 'added', midB.slice(j).join(''));
  }

  push(out, 'same', a.slice(endA).join(''));
  return { segments: out, identical: false, truncated };
}
