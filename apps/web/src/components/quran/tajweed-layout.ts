import {
  tajweedSpanProblem,
  type TajweedRule,
  type TajweedSpan,
} from '@minhaj/contracts/quran';

/**
 * HOW AN AYAH IS DRAWN IN TAJWEED COLOURS (Quran Part 9) — pure, so the one
 * promise that matters is proved by test: the runs, joined, ARE the stored
 * text, code point for code point.
 *
 * The overlay's spans are `[start, end)` in CODE POINTS and may overlap or
 * nest (two rules meeting on one letter). The text is cut at every span edge
 * into runs; each run carries every rule covering it, and is coloured by the
 * one that began LAST — the innermost, most specific mark. A run no span
 * covers is plain text. Nothing is added, removed, re-ordered or normalised,
 * and a run never splits a code point (a surrogate pair stays whole), so the
 * browser shapes and joins the letters across runs exactly as across one text
 * node — only the colour changes.
 *
 * FAIL CLOSED. Spans that do not lie over this text (`tajweedSpanProblem`:
 * empty, past its end, out of order) colour nothing: the Ayah is drawn plain.
 */

export interface TajweedRun {
  /** A verbatim slice of the stored text. */
  readonly text: string;
  /** The rule the run is coloured by, or `null` for plain text. */
  readonly rule: TajweedRule | null;
  /** Every rule covering the run, in the order their spans began. */
  readonly rules: readonly TajweedRule[];
}

export function tajweedRuns(text: string, spans: readonly TajweedSpan[]): TajweedRun[] {
  if (spans.length === 0 || tajweedSpanProblem(text, spans) !== null)
    return text === '' ? [] : [{ text, rule: null, rules: [] }];
  const points = [...text];
  const edges = new Set<number>([0, points.length]);
  for (const span of spans) {
    edges.add(span.start);
    edges.add(span.end);
  }
  const cuts = [...edges].sort((a, b) => a - b);
  const runs: TajweedRun[] = [];
  for (let index = 0; index + 1 < cuts.length; index += 1) {
    const from = cuts[index] ?? 0;
    const to = cuts[index + 1] ?? 0;
    if (to <= from) continue;
    const covering = spans.filter((span) => span.start <= from && span.end >= to);
    const rules = covering.map((span) => span.rule);
    runs.push({
      text: points.slice(from, to).join(''),
      rule: rules.at(-1) ?? null,
      rules: [...new Set(rules)],
    });
  }
  return runs;
}

/** The class a coloured run and a legend swatch carry for a rule. */
export const tajweedClass = (rule: TajweedRule) => `tj tj-${rule}`;

/**
 * The legend's groups: rules that sound alike share a family, which is also
 * how the high-contrast styles tell them apart without colour (`globals.css`).
 * Each rule of the vocabulary is in exactly one family (proved by test).
 */
export const TAJWEED_FAMILIES: readonly {
  readonly family: 'nasal' | 'merged' | 'lengthened' | 'echo' | 'unsounded';
  readonly rules: readonly TajweedRule[];
}[] = [
  {
    family: 'nasal',
    rules: [
      'ghunnah',
      'idghaam-ghunnah',
      'idghaam-shafawi',
      'ikhfa',
      'ikhfa-shafawi',
      'iqlab',
    ],
  },
  {
    family: 'merged',
    rules: ['idghaam-no-ghunnah', 'idghaam-mutajanisayn', 'idghaam-mutaqaribayn'],
  },
  {
    family: 'lengthened',
    rules: ['madd-2', 'madd-246', 'madd-muttasil', 'madd-munfasil', 'madd-6'],
  },
  { family: 'echo', rules: ['qalqalah'] },
  { family: 'unsounded', rules: ['hamzat-wasl', 'lam-shamsiyyah', 'silent'] },
];
