import {
  QURAN_AYAH_NUMBER_MAX,
  QURAN_SURAH_MAX,
  QURAN_TAJWEED_SPANS_MAX,
  isTajweedRule,
  tajweedSpanProblem,
  type TajweedRule,
  type TajweedSpan,
} from '@minhaj/contracts/quran';

/**
 * THE TAJWEED COLOUR OVERLAY, READ AND RE-ALIGNED — pure, so every rule is
 * proved without a database (Quran Part 9; owner decision, OPEN_DECISIONS.md
 * §1.2 item 4).
 *
 * THE SOURCE. Collin Fair's quran-tajweed publishes ONE data file under CC BY
 * 4.0, `tajweed.hafs.uthmani-pause-sajdah.json`: for every Ayah, rule spans
 * `{rule, start, end}` in Unicode CODE POINTS into the Tanzil Uthmani text the
 * project shipped beside it, `quran-uthmani.txt` (Tanzil Uthmani 1.0.2,
 * downloaded about 2017-04-06; Tanzil's licence, verbatim). Only these two
 * files are read. The project's classifier code carries no licence and is
 * never run or copied.
 *
 * THE PROBLEM. Our canonical text is Tanzil Uthmani 1.1, which differs from
 * that copy in most ayat — a tatweel before a superscript alif, pause marks
 * written as their own words, a hamza spelled differently, and the 2017 file's
 * Bismillah written at the head of each Surah's first Ayah. The spans' offsets
 * therefore point at the wrong letters of our text unless they are re-aligned.
 *
 * THE RULE: NEITHER TEXT IS EVER CHANGED, AND NO SPAN IS EVER GUESSED.
 *   - An Ayah whose 1.1 text EQUALS its 2017 text keeps its offsets unchanged.
 *   - Otherwise a code-point diff (Myers' shortest edit script) pairs every
 *     code point the two texts share. A span is carried over only if EVERY
 *     code point it covers is a shared one and they land CONSECUTIVELY in 1.1 —
 *     so its 1.1 substring is identical, code point for code point, to its
 *     2017 substring, and no edit lies inside it (an inserted tatweel, a
 *     changed hamza). An edit at a span's edge stays outside it, uncoloured.
 *   - If ANY span of an Ayah cannot be carried over, the WHOLE Ayah is skipped
 *     — never a partial Ayah, never an adjusted span.
 * The re-alignment is the change CC BY 4.0 asks a re-user to note; the
 * attribution says "re-aligned to Tanzil Uthmani v1.1".
 */

/** The file names the operator places, as the source publishes them. */
export const TAJWEED_FILES = Object.freeze({
  annotations: 'tajweed.hafs.uthmani-pause-sajdah.json',
  baseText: 'quran-uthmani.txt',
});

/**
 * The most edits one Ayah's two texts may differ by before the Ayah is
 * skipped as `too-different` — a bound on the diff's work, far above any real
 * difference between two printings of one Ayah (the 2017 Bismillah alone is
 * 39 code points).
 */
export const TAJWEED_MAX_EDITS = 400;

/** Why the source files are refused whole — a category, never text. */
export class TajweedSourceRefusal extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`the tajweed source is refused: ${reason}`);
    this.name = 'TajweedSourceRefusal';
    this.reason = reason;
  }
}

/** `surah:ayah`, the key both files are read into. */
export const ayahKey = (surah: number, ayah: number) =>
  `${String(surah)}:${String(ayah)}`;

/** The source's rule name, as our vocabulary spells it, or null. */
export function tajweedRuleOf(sourceName: string): TajweedRule | null {
  if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/u.test(sourceName)) return null;
  const rule = sourceName.replaceAll('_', '-');
  return isTajweedRule(rule) ? rule : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const keysAre = (value: Record<string, unknown>, keys: readonly string[]) => {
  const own = Object.keys(value).sort();
  const want = [...keys].sort();
  return own.length === want.length && own.every((key, index) => key === want[index]);
};

const whole = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

/**
 * The annotation file, every Ayah's spans exactly as it gives them, or a
 * refusal: an array of `{surah, ayah, annotations}` in strictly ascending
 * citation order, each annotation exactly `{rule, start, end}` with a known
 * rule and `0 <= start < end`, ordered by their start. Overlapping and nested
 * spans are the source's own (two rules meeting on one letter) and are kept.
 */
export function readTajweedAnnotations(
  body: unknown,
): ReadonlyMap<string, readonly TajweedSpan[]> {
  if (!Array.isArray(body) || body.length === 0)
    throw new TajweedSourceRefusal('the annotation file is not a list of ayat');
  const ayat = new Map<string, readonly TajweedSpan[]>();
  let previous = 0;
  for (const entry of body) {
    const value = record(entry);
    if (value === null || !keysAre(value, ['surah', 'ayah', 'annotations']))
      throw new TajweedSourceRefusal('an entry is not {surah, ayah, annotations}');
    const { surah, ayah, annotations } = value;
    if (!whole(surah, 1, QURAN_SURAH_MAX) || !whole(ayah, 1, QURAN_AYAH_NUMBER_MAX))
      throw new TajweedSourceRefusal('an entry names no Ayah');
    const order = surah * 1000 + ayah;
    if (order <= previous)
      throw new TajweedSourceRefusal('the ayat are not in ascending citation order');
    previous = order;
    if (!Array.isArray(annotations) || annotations.length > QURAN_TAJWEED_SPANS_MAX)
      throw new TajweedSourceRefusal('an Ayah’s annotations are not a bounded list');
    const spans = annotations.map((annotation): TajweedSpan => {
      const span = record(annotation);
      if (span === null || !keysAre(span, ['rule', 'start', 'end']))
        throw new TajweedSourceRefusal('an annotation is not {rule, start, end}');
      const rule = typeof span['rule'] === 'string' ? tajweedRuleOf(span['rule']) : null;
      if (rule === null)
        throw new TajweedSourceRefusal('an annotation names an unknown rule');
      const { start, end } = span;
      if (
        !whole(start, 0, Number.MAX_SAFE_INTEGER) ||
        !whole(end, 1, Number.MAX_SAFE_INTEGER)
      )
        throw new TajweedSourceRefusal('an annotation’s offsets are not whole numbers');
      return { rule, start, end };
    });
    let previousStart = 0;
    for (const span of spans) {
      if (span.end <= span.start)
        throw new TajweedSourceRefusal('an annotation is empty');
      if (span.start < previousStart)
        throw new TajweedSourceRefusal('an Ayah’s annotations are not ordered by start');
      previousStart = span.start;
    }
    ayat.set(ayahKey(surah, ayah), spans);
  }
  return ayat;
}

/**
 * The 2017 base text, `surah|ayah|text` per line in strictly ascending
 * citation order, then only blank lines and the Tanzil notice (`#` lines) —
 * or a refusal. The file ends its lines with CR LF, which belongs to no Ayah;
 * the text is otherwise taken exactly as written — nothing is trimmed.
 */
export function readTajweedBaseText(content: string): ReadonlyMap<string, string> {
  const ayat = new Map<string, string>();
  let previous = 0;
  let notice = false;
  // The file ends its lines with CR LF; the line ending is not the Ayah's.
  for (const line of content.split(/\r?\n/u)) {
    const ayah = /^([1-9][0-9]{0,2})\|([1-9][0-9]{0,2})\|(.+)$/u.exec(line);
    if (ayah !== null && !notice) {
      const surah = Number(ayah[1]);
      const number = Number(ayah[2]);
      const order = surah * 1000 + number;
      if (surah > QURAN_SURAH_MAX || order <= previous)
        throw new TajweedSourceRefusal(
          'the base text is not in ascending citation order',
        );
      previous = order;
      const text = ayah[3] ?? '';
      if (/^\s|\s$/u.test(text))
        throw new TajweedSourceRefusal(
          'an Ayah of the base text has surrounding whitespace',
        );
      ayat.set(ayahKey(surah, number), text);
      continue;
    }
    if (line === '') continue;
    if (line.startsWith('#') && ayat.size > 0) {
      notice = true;
      continue;
    }
    throw new TajweedSourceRefusal('the base text has a line that is not an Ayah');
  }
  if (ayat.size === 0) throw new TajweedSourceRefusal('the base text has no ayat');
  return ayat;
}

/**
 * The two files agree: every annotated Ayah is an Ayah of the base text and
 * every span lies within it — the file the offsets were made for.
 */
export function assertAnnotationsFitBaseText(
  annotations: ReadonlyMap<string, readonly TajweedSpan[]>,
  baseText: ReadonlyMap<string, string>,
): void {
  if (annotations.size !== baseText.size)
    throw new TajweedSourceRefusal('the two files do not hold the same ayat');
  for (const [key, spans] of annotations) {
    const text = baseText.get(key);
    if (text === undefined)
      throw new TajweedSourceRefusal('an annotated Ayah is not in the base text');
    if (tajweedSpanProblem(text, spans) !== null)
      throw new TajweedSourceRefusal(
        'an annotation lies outside its Ayah of the base text',
      );
  }
}

/**
 * MYERS' SHORTEST EDIT SCRIPT over code points: for each code point of `from`,
 * the index of the code point of `to` it is paired with, or -1 when it was
 * removed. `null` when the texts differ by more than `maxEdits` insertions and
 * deletions. Paired code points are always equal.
 */
export function codePointPairs(
  from: readonly string[],
  to: readonly string[],
  maxEdits: number,
): Int32Array | null {
  // The common head and tail are paired as they stand, and only the middle is
  // diffed: a phrase added at the head of one text (the 2017 Bismillah) is then
  // one removal, never re-paired with a later word that repeats its letters.
  let head = 0;
  while (head < from.length && head < to.length && from[head] === to[head]) head += 1;
  let tail = 0;
  while (
    tail < from.length - head &&
    tail < to.length - head &&
    from[from.length - 1 - tail] === to[to.length - 1 - tail]
  )
    tail += 1;
  const middle = myersPairs(
    from.slice(head, from.length - tail),
    to.slice(head, to.length - tail),
    maxEdits,
  );
  if (middle === null) return null;
  const pairs = new Int32Array(from.length).fill(-1);
  for (let index = 0; index < head; index += 1) pairs[index] = index;
  for (const [index, paired] of middle.entries())
    pairs[head + index] = paired < 0 ? -1 : head + paired;
  for (let index = 1; index <= tail; index += 1)
    pairs[from.length - index] = to.length - index;
  return pairs;
}

/** The shortest edit script itself, over the texts' differing middle. */
function myersPairs(
  from: readonly string[],
  to: readonly string[],
  maxEdits: number,
): Int32Array | null {
  const n = from.length;
  const m = to.length;
  const limit = Math.min(maxEdits, n + m);
  const offset = limit + 1;
  const v = new Int32Array(2 * limit + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= limit && found < 0; d += 1) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0))
          ? (v[offset + k + 1] ?? 0)
          : (v[offset + k - 1] ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && from[x] === to[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return null;
  const pairs = new Int32Array(n).fill(-1);
  let x = n;
  let y = m;
  for (let d = found; d >= 0; d -= 1) {
    const before = trace[d] ?? v;
    const k = x - y;
    const previousK =
      k === -d ||
      (k !== d && (before[offset + k - 1] ?? 0) < (before[offset + k + 1] ?? 0))
        ? k + 1
        : k - 1;
    const previousX = d === 0 ? 0 : (before[offset + previousK] ?? 0);
    const previousY = d === 0 ? 0 : previousX - previousK;
    while (x > previousX && y > previousY) {
      x -= 1;
      y -= 1;
      pairs[x] = y;
    }
    x = previousX;
    y = previousY;
  }
  return pairs;
}

/** Why one Ayah's spans could not be carried to the canonical text. */
export type TajweedSkip =
  /** A span covers a code point the texts do not share, or an edit lies inside it. */
  | 'span-on-changed-text'
  /** The texts differ by more than `TAJWEED_MAX_EDITS`. */
  | 'too-different'
  /** The source annotates no such Ayah. */
  | 'not-annotated';

export type AyahAlignment =
  | { readonly kind: 'unchanged' | 'remapped'; readonly spans: readonly TajweedSpan[] }
  | { readonly kind: 'skipped'; readonly reason: TajweedSkip };

/**
 * One Ayah's spans, from the 2017 text to the canonical text — unchanged,
 * re-mapped, or skipped whole. Neither text is changed.
 */
export function realignAyah(
  baseText: string,
  canonicalText: string,
  spans: readonly TajweedSpan[],
): AyahAlignment {
  if (baseText === canonicalText) return { kind: 'unchanged', spans };
  const from = [...baseText];
  const to = [...canonicalText];
  const pairs = codePointPairs(from, to, TAJWEED_MAX_EDITS);
  if (pairs === null) return { kind: 'skipped', reason: 'too-different' };
  const moved: TajweedSpan[] = [];
  for (const span of spans) {
    const start = pairs[span.start] ?? -1;
    if (start < 0) return { kind: 'skipped', reason: 'span-on-changed-text' };
    for (let index = span.start + 1; index < span.end; index += 1)
      if (pairs[index] !== start + (index - span.start))
        return { kind: 'skipped', reason: 'span-on-changed-text' };
    const end = start + (span.end - span.start);
    // Paired code points are equal, so this always holds; it is checked
    // because it is the whole promise: the span shows exactly what it showed.
    if (to.slice(start, end).join('') !== from.slice(span.start, span.end).join(''))
      return { kind: 'skipped', reason: 'span-on-changed-text' };
    moved.push({ rule: span.rule, start, end });
  }
  // The spans keep their recorded order: ordered by start before, and a
  // carried span moves only with the text around it, so still ordered.
  return { kind: 'remapped', spans: moved };
}

export interface TajweedPlan {
  /** Every canonical Ayah the overlay can colour, in canonical order. */
  readonly ayat: readonly {
    readonly surah: number;
    readonly ayah: number;
    readonly spans: readonly TajweedSpan[];
  }[];
  readonly unchanged: number;
  readonly remapped: number;
  readonly spans: number;
  readonly skipped: Readonly<Record<TajweedSkip, number>>;
}

/**
 * The whole overlay planned against the canonical corpus: every canonical
 * Ayah aligned or skipped, with counts. An annotated Ayah the corpus does not
 * hold refuses the plan — the source would then not be this Quran's.
 */
export function planTajweedOverlay(input: {
  readonly annotations: ReadonlyMap<string, readonly TajweedSpan[]>;
  readonly baseText: ReadonlyMap<string, string>;
  /** The canonical ayat, in canonical order. */
  readonly canonical: readonly {
    readonly surah: number;
    readonly ayah: number;
    readonly text: string;
  }[];
}): TajweedPlan {
  assertAnnotationsFitBaseText(input.annotations, input.baseText);
  const held = new Set(input.canonical.map((entry) => ayahKey(entry.surah, entry.ayah)));
  for (const key of input.annotations.keys())
    if (!held.has(key))
      throw new TajweedSourceRefusal('an annotated Ayah is not in the canonical corpus');
  const ayat: TajweedPlan['ayat'][number][] = [];
  const skipped: Record<TajweedSkip, number> = {
    'span-on-changed-text': 0,
    'too-different': 0,
    'not-annotated': 0,
  };
  let unchanged = 0;
  let remapped = 0;
  let spans = 0;
  for (const entry of input.canonical) {
    const key = ayahKey(entry.surah, entry.ayah);
    const source = input.annotations.get(key);
    const base = input.baseText.get(key);
    if (source === undefined || base === undefined) {
      skipped['not-annotated'] += 1;
      continue;
    }
    const aligned = realignAyah(base, entry.text, source);
    if (aligned.kind === 'skipped') {
      skipped[aligned.reason] += 1;
      continue;
    }
    if (aligned.kind === 'unchanged') unchanged += 1;
    else remapped += 1;
    spans += aligned.spans.length;
    ayat.push({ surah: entry.surah, ayah: entry.ayah, spans: aligned.spans });
  }
  return { ayat, unchanged, remapped, spans, skipped };
}
