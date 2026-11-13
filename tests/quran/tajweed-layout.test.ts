import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import {
  QURAN_TAJWEED_RULES,
  type TajweedSpan,
} from '../../packages/contracts/src/quran/index.ts';
import { ArabicText } from '../../apps/web/src/components/quran/scripture.tsx';
import {
  TAJWEED_FAMILIES,
  tajweedRuns,
} from '../../apps/web/src/components/quran/tajweed-layout.ts';

/**
 * Quran Part 9 — an Ayah drawn in tajweed colours.
 *
 * THE TEXT IS NEVER CHANGED: the runs, joined, are the stored text code point
 * for code point; the Arabic paragraph's text — what a screen reader reads and
 * Copy takes — is the stored string; and spans that do not lie over the text
 * colour nothing. Shaping across runs is the browser's and is proved in
 * Chromium (`tests/browser/quran.spec.ts`).
 *
 * NOTHING HERE IS THE QURAN: sentinel words with the marks a careless cut
 * would damage — a superscript alif, a tatweel, a shadda over a tanween — and
 * a character outside the Basic Multilingual Plane.
 */

const TEXT = 'NON_QURAN_FIXTURE كَلِمَةٌ مَـٰثَالٌ وَنَصٌّ';
const offset = [...'NON_QURAN_FIXTURE '].length;
const span = (rule: TajweedSpan['rule'], start: number, end: number): TajweedSpan => ({
  rule,
  start: offset + start,
  end: offset + end,
});

const joined = (runs: readonly { text: string }[]) =>
  runs.map((run) => run.text).join('');

/** Every string a rendered tree carries, in document order. */
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node))
    return textOf((node as ReactElement<{ children?: ReactNode }>).props.children);
  return '';
}

/** The first element in a tree whose props match. */
function find(
  node: ReactNode,
  match: (props: Record<string, unknown>) => boolean,
): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, match);
      if (found !== null) return found;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const element = node as ReactElement<Record<string, unknown>>;
  if (match(element.props)) return element;
  return find(element.props['children'] as ReactNode, match);
}

describe('tajweed runs', () => {
  it('join back into the stored text, code point for code point', () => {
    const spans = [
      span('madd-2', 11, 13),
      span('ghunnah', 21, 24),
      span('silent', 24, 26),
    ];
    const runs = tajweedRuns(TEXT, spans);
    expect(joined(runs)).toBe(TEXT);
    expect(runs.filter((run) => run.rule !== null).map((run) => run.rule)).toEqual([
      'madd-2',
      'ghunnah',
      'silent',
    ]);
    // A tatweel and the superscript alif after it stay together in their run.
    expect(runs.find((run) => run.rule === 'madd-2')?.text).toBe('ـٰ');
  });

  it('cut overlapping and nested spans at every edge, coloured by the innermost', () => {
    const spans = [
      span('ghunnah', 18, 23),
      span('ikhfa', 21, 26),
      span('silent', 22, 23),
    ];
    const runs = tajweedRuns(TEXT, spans);
    expect(joined(runs)).toBe(TEXT);
    const coloured = runs.filter((run) => run.rule !== null);
    expect(coloured.map((run) => [run.rule, run.rules])).toEqual([
      ['ghunnah', ['ghunnah']],
      ['ikhfa', ['ghunnah', 'ikhfa']],
      ['silent', ['ghunnah', 'ikhfa', 'silent']],
      ['ikhfa', ['ikhfa']],
    ]);
  });

  it('never split a character outside the Basic Multilingual Plane', () => {
    const astral = 'بِ\u{1D49C}تِ';
    const runs = tajweedRuns(astral, [{ rule: 'qalqalah', start: 2, end: 3 }]);
    expect(runs.map((run) => run.text)).toEqual(['بِ', '\u{1D49C}', 'تِ']);
    expect(joined(runs)).toBe(astral);
  });

  it('colour nothing when the spans do not lie over this text', () => {
    for (const spans of [
      [{ rule: 'ghunnah', start: 0, end: 999 }],
      [{ rule: 'ghunnah', start: 3, end: 3 }],
      [
        { rule: 'ghunnah', start: 5, end: 6 },
        { rule: 'ikhfa', start: 1, end: 2 },
      ],
    ] as const)
      expect(tajweedRuns(TEXT, spans)).toEqual([{ text: TEXT, rule: null, rules: [] }]);
    expect(tajweedRuns('', [])).toEqual([]);
  });

  it('place every rule of the vocabulary in exactly one family of the key', () => {
    const listed = TAJWEED_FAMILIES.flatMap((family) => family.rules);
    expect([...listed].sort()).toEqual([...QURAN_TAJWEED_RULES].sort());
    expect(new Set(listed).size).toBe(listed.length);
  });
});

describe('the Arabic of an Ayah in tajweed colours', () => {
  const render = (spans: readonly TajweedSpan[]) =>
    ArabicText({
      id: 'arabic-1-1',
      label: 'Arabic',
      text: TEXT,
      ayah: 1,
      tajweed: spans,
    });
  const paragraph = (spans: readonly TajweedSpan[]) =>
    find(render(spans), (props) => 'data-ayah-arabic' in props);

  it('keeps the paragraph’s text the stored text exactly', () => {
    const spans = [
      span('madd-2', 11, 13),
      span('ghunnah', 18, 23),
      span('ikhfa', 21, 26),
    ];
    const element = paragraph(spans);
    expect(element).not.toBeNull();
    expect(textOf(element!.props['children'] as ReactNode)).toBe(TEXT);
    expect(element!.props['lang']).toBe('ar');
    expect(element!.props['dir']).toBe('rtl');
  });

  it('draws each coloured run as a bare span carrying its rule’s class and rules', () => {
    const element = paragraph([span('ghunnah', 18, 23), span('ikhfa', 21, 26)]);
    const runs = (element!.props['children'] as ReactNode[]).filter(
      isValidElement,
    ) as ReactElement<{ className: string; 'data-tajweed': string; children: string }>[];
    expect(runs.map((run) => [run.props.className, run.props['data-tajweed']])).toEqual([
      ['tj tj-ghunnah', 'ghunnah'],
      ['tj tj-ikhfa', 'ghunnah ikhfa'],
      ['tj tj-ikhfa', 'ikhfa'],
    ]);
    for (const run of runs) expect(typeof run.props.children).toBe('string');
  });

  it('renders the stored text as the paragraph’s only child without spans', () => {
    expect(paragraph([])!.props['children']).toBe(TEXT);
  });
});
