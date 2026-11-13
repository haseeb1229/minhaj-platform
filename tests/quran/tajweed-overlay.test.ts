import { describe, expect, it } from 'vitest';

import type { TajweedSpan } from '../../packages/contracts/src/quran/index.ts';
import {
  TAJWEED_MAX_EDITS,
  assertAnnotationsFitBaseText,
  codePointPairs,
  planTajweedOverlay,
  readTajweedAnnotations,
  readTajweedBaseText,
  realignAyah,
  tajweedRuleOf,
  TajweedSourceRefusal,
} from '../../scripts/quran/tajweed-overlay.ts';
import { BASE_TEXT_FILE, CANONICAL, annotationFile } from './tajweed-fixture.ts';

/**
 * Quran Part 9 — the tajweed colour overlay's re-alignment, proved pure.
 *
 * THE ONE PROMISE: a span is carried from the 2017 text to the canonical text
 * only if the code points it covers are the SAME code points, contiguous, in
 * both — so it colours exactly what its source coloured — and an Ayah with any
 * span that cannot be carried is skipped whole. Neither text is ever changed.
 *
 * NOTHING HERE IS THE QURAN. The texts are sentinels in the shapes the real
 * files differ by (`./tajweed-fixture.ts`): a tatweel before a superscript
 * alif, a pause mark written as its own word, a hamza spelled differently, and
 * a Bismillah-like opening written at the head of a first Ayah.
 */

const span = (rule: TajweedSpan['rule'], start: number, end: number): TajweedSpan => ({
  rule,
  start,
  end,
});

/** The code points a span covers in a text. */
const covered = (text: string, at: { start: number; end: number }) =>
  [...text].slice(at.start, at.end).join('');

describe('the code-point diff', () => {
  it('pairs every shared code point, in order, and nothing else', () => {
    const from = [...'abcde'];
    const to = [...'aXbcYe'];
    const pairs = codePointPairs(from, to, 10);
    expect(pairs === null ? null : [...pairs]).toEqual([0, 2, 3, -1, 5]);
    for (const [index, paired] of [...(pairs ?? [])].entries())
      if (paired >= 0) expect(to[paired]).toBe(from[index]);
  });

  it('counts code points, so a character outside the BMP is one position', () => {
    const astral = '\u{1D49C}';
    const pairs = codePointPairs([...`${astral}b`], [...`x${astral}b`], 10);
    expect(pairs === null ? null : [...pairs]).toEqual([1, 2]);
  });

  it('gives up past its bound rather than working without one', () => {
    expect(codePointPairs([...'aaaa'], [...'bbbb'], 3)).toBeNull();
    expect(codePointPairs([...'aaaa'], [...'bbbb'], 8)).not.toBeNull();
  });

  it('handles empty texts', () => {
    expect([...(codePointPairs([], [...'ab'], 4) ?? [9])]).toEqual([]);
    expect([...(codePointPairs([...'ab'], [], 4) ?? [])]).toEqual([-1, -1]);
  });
});

describe('re-aligning one Ayah', () => {
  const base = 'كَلِمَةٌ مَٰثَالٌ وَنَصٌّ';

  it('keeps the offsets of an Ayah whose two texts are equal', () => {
    const spans = [span('madd-2', 11, 12), span('ghunnah', 20, 23)];
    expect(realignAyah(base, base, spans)).toEqual({ kind: 'unchanged', spans });
  });

  it('moves every span past text inserted BEFORE it', () => {
    const canonical = `۞ ${base}`;
    const spans = [span('madd-2', 11, 12), span('ghunnah', 20, 23)];
    const aligned = realignAyah(base, canonical, spans);
    expect(aligned).toEqual({
      kind: 'remapped',
      spans: [span('madd-2', 13, 14), span('ghunnah', 22, 25)],
    });
    if (aligned.kind !== 'skipped')
      for (const [index, moved] of aligned.spans.entries())
        expect(covered(canonical, moved)).toBe(covered(base, spans[index]!));
  });

  it('keeps every span before text inserted AFTER it', () => {
    const canonical = `${base} ۚ`;
    const spans = [span('madd-2', 11, 12)];
    expect(realignAyah(base, canonical, spans)).toEqual({
      kind: 'remapped',
      spans,
    });
  });

  it('skips the WHOLE Ayah when text is inserted INSIDE any span', () => {
    // A tatweel between the meem's fatha and the superscript alif, inside a
    // span over all three.
    const canonical = base.replace('مَٰ', 'مَـٰ');
    expect(
      realignAyah(base, canonical, [span('ghunnah', 20, 23), span('madd-2', 9, 12)]),
    ).toEqual({ kind: 'skipped', reason: 'span-on-changed-text' });
  });

  it('leaves text inserted exactly at a span edge OUTSIDE it, uncoloured', () => {
    // The same tatweel, but the span is the superscript alif alone: it begins
    // right after the insertion and still colours exactly that alif.
    const canonical = base.replace('مَٰ', 'مَـٰ');
    const spans = [span('madd-2', 11, 12)];
    const aligned = realignAyah(base, canonical, spans);
    expect(aligned).toEqual({ kind: 'remapped', spans: [span('madd-2', 12, 13)] });
    expect(covered(canonical, { start: 12, end: 13 })).toBe('ٰ');
    // And a span ending right before an insertion keeps its end.
    const before = [span('qalqalah', 9, 11)];
    expect(realignAyah(base, canonical, before)).toEqual({
      kind: 'remapped',
      spans: before,
    });
  });

  it('skips the Ayah when a span covers a changed or removed code point', () => {
    // A hamza on the line becomes a tatweel with a hamza above (two code points).
    const hamza = 'سَمَاءٌ نَصٌّ';
    const changed = hamza.replace('ءٌ', 'ـٌٔ');
    expect(realignAyah(hamza, changed, [span('madd-muttasil', 3, 6)])).toEqual({
      kind: 'skipped',
      reason: 'span-on-changed-text',
    });
    // Removed inside the span.
    expect(realignAyah(base, base.replace('ٌّ', 'ّ'), [span('ghunnah', 20, 25)])).toEqual(
      { kind: 'skipped', reason: 'span-on-changed-text' },
    );
  });

  it('carries spans whose text is untouched although the Ayah changed elsewhere', () => {
    const hamza = 'سَمَاءٌ نَصٌّ';
    const changed = hamza.replace('ءٌ', 'ـٌٔ');
    // The span over "نَصٌّ" moves by the one extra code point.
    const aligned = realignAyah(hamza, changed, [span('ghunnah', 8, 13)]);
    expect(aligned).toEqual({ kind: 'remapped', spans: [span('ghunnah', 9, 14)] });
  });

  it('moves a span that begins on a combining mark with the mark', () => {
    const marked = 'بَٰبِ';
    const canonical = `ۛ ${marked}`;
    // The span is the superscript alif (U+0670), a combining mark, alone.
    const aligned = realignAyah(marked, canonical, [span('madd-2', 2, 3)]);
    expect(aligned).toEqual({ kind: 'remapped', spans: [span('madd-2', 4, 5)] });
    expect(covered(canonical, { start: 4, end: 5 })).toBe('ٰ');
  });

  it('carries overlapping and nested spans, each by its own code points', () => {
    const canonical = `ۖ ${base}`;
    const spans = [
      span('ghunnah', 18, 22),
      span('ikhfa', 20, 25),
      span('silent', 21, 22),
    ];
    const aligned = realignAyah(base, canonical, spans);
    expect(aligned).toEqual({
      kind: 'remapped',
      spans: [span('ghunnah', 20, 24), span('ikhfa', 22, 27), span('silent', 23, 24)],
    });
  });

  it('drops an opening the canonical text does not write, and keeps the spans after it', () => {
    const opening = 'بِسْمِ مِثَالٍ';
    const spans = [span('madd-2', opening.length + 1 + 11, opening.length + 1 + 12)];
    const aligned = realignAyah(`${opening} ${base}`, base, spans);
    expect(aligned).toEqual({ kind: 'remapped', spans: [span('madd-2', 11, 12)] });
  });

  it('skips an Ayah whose texts differ beyond the diff’s bound', () => {
    const long = 'ب'.repeat(TAJWEED_MAX_EDITS);
    expect(
      realignAyah(long, 'ت'.repeat(TAJWEED_MAX_EDITS), [span('silent', 0, 1)]),
    ).toEqual({ kind: 'skipped', reason: 'too-different' });
  });

  it('over random edits, every carried span covers exactly the code points it covered', () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    const letters = [...'بَتِثُجٰـۖ ء'];
    const pick = () => letters[Math.floor(random() * letters.length)]!;
    let carried = 0;
    for (let trial = 0; trial < 400; trial += 1) {
      const from = Array.from({ length: 20 + Math.floor(random() * 40) }, pick);
      const to = [...from];
      for (let edit = Math.floor(random() * 4); edit > 0; edit -= 1) {
        const at = Math.floor(random() * (to.length + 1));
        if (random() < 0.5) to.splice(at, 0, pick());
        else to.splice(Math.min(at, to.length - 1), 1);
      }
      const spans: TajweedSpan[] = [];
      for (let start = 0; start + 2 < from.length; start += 3 + Math.floor(random() * 6))
        spans.push(span('ghunnah', start, start + 1 + Math.floor(random() * 3)));
      const aligned = realignAyah(from.join(''), to.join(''), spans);
      if (aligned.kind === 'skipped') continue;
      carried += 1;
      expect(aligned.spans).toHaveLength(spans.length);
      for (const [index, moved] of aligned.spans.entries())
        expect(to.slice(moved.start, moved.end).join('')).toBe(
          from.slice(spans[index]!.start, spans[index]!.end).join(''),
        );
    }
    expect(carried).toBeGreaterThan(50);
  });
});

describe('reading the annotation file', () => {
  it('reads the source’s rule names into the vocabulary, refusing any other', () => {
    expect(tajweedRuleOf('idghaam_mutajanisayn')).toBe('idghaam-mutajanisayn');
    expect(tajweedRuleOf('madd_246')).toBe('madd-246');
    expect(tajweedRuleOf('ghunnah')).toBe('ghunnah');
    expect(tajweedRuleOf('idghaam-ghunnah')).toBeNull();
    expect(tajweedRuleOf('idghaam_mutajaanisain')).toBeNull();
    expect(tajweedRuleOf('Ghunnah')).toBeNull();
    expect(tajweedRuleOf('')).toBeNull();
  });

  it('reads every Ayah’s spans as the file gives them, overlaps included', () => {
    const annotations = readTajweedAnnotations(annotationFile());
    expect([...annotations.keys()]).toEqual(['1:1', '1:2', '1:3', '2:1', '2:2', '2:3']);
    expect(annotations.get('2:2')).toEqual([
      span('ghunnah', 9, 13),
      span('ikhfa', 11, 15),
    ]);
    expect(annotations.get('2:3')).toEqual([]);
  });

  it('refuses a file that is not exactly the source’s shape', () => {
    const good = annotationFile() as {
      surah: number;
      ayah: number;
      annotations: object[];
    }[];
    const variants: [string, unknown][] = [
      ['not a list', { surah: 1 }],
      ['empty', []],
      ['an extra field', [{ ...good[0], note: 'x' }]],
      [
        'an unknown rule',
        [{ surah: 1, ayah: 1, annotations: [{ rule: 'tarqeeq', start: 0, end: 1 }] }],
      ],
      [
        'an empty span',
        [{ surah: 1, ayah: 1, annotations: [{ rule: 'ghunnah', start: 2, end: 2 }] }],
      ],
      [
        'a fractional offset',
        [{ surah: 1, ayah: 1, annotations: [{ rule: 'ghunnah', start: 0.5, end: 2 }] }],
      ],
      [
        'a negative offset',
        [{ surah: 1, ayah: 1, annotations: [{ rule: 'ghunnah', start: -1, end: 2 }] }],
      ],
      [
        'spans out of order',
        [
          {
            surah: 1,
            ayah: 1,
            annotations: [
              { rule: 'ghunnah', start: 5, end: 6 },
              { rule: 'ikhfa', start: 1, end: 2 },
            ],
          },
        ],
      ],
      ['ayat out of order', [good[1], good[0]]],
      ['a repeated Ayah', [good[0], good[0]]],
      ['a Surah beyond 114', [{ surah: 115, ayah: 1, annotations: [] }]],
      [
        'an extra span field',
        [
          {
            surah: 1,
            ayah: 1,
            annotations: [{ rule: 'ghunnah', start: 0, end: 1, x: 1 }],
          },
        ],
      ],
    ];
    for (const [label, body] of variants)
      expect(() => readTajweedAnnotations(body), label).toThrow(TajweedSourceRefusal);
  });
});

describe('reading the 2017 base text', () => {
  it('reads each Ayah exactly, past CR LF line ends and the Tanzil notice', () => {
    const text = readTajweedBaseText(BASE_TEXT_FILE);
    expect(text.size).toBe(6);
    expect(text.get('2:1')?.startsWith('بِسْمِ مِثَالٍ ')).toBe(true);
    expect([...text.values()].every((value) => !value.includes('\r'))).toBe(true);
  });

  it('refuses anything that is not the file’s shape', () => {
    for (const [label, content] of [
      ['no ayat', '# notice only\r\n'],
      ['a stray line', `${BASE_TEXT_FILE}stray\r\n`],
      ['an Ayah after the notice', `${BASE_TEXT_FILE}3|1|نص\r\n`],
      ['out of order', '1|2|نص\r\n1|1|نص\r\n'],
      ['surrounding whitespace', '1|1| نص\r\n'],
      ['a Surah beyond 114', '115|1|نص\r\n'],
    ] as const)
      expect(() => readTajweedBaseText(content), label).toThrow(TajweedSourceRefusal);
  });

  it('refuses annotations that do not lie within their Ayah of the base text', () => {
    const base = readTajweedBaseText(BASE_TEXT_FILE);
    const annotations = new Map(readTajweedAnnotations(annotationFile()));
    expect(() => assertAnnotationsFitBaseText(annotations, base)).not.toThrow();
    annotations.set('1:1', [span('ghunnah', 0, 999)]);
    expect(() => assertAnnotationsFitBaseText(annotations, base)).toThrow(
      /outside its Ayah/,
    );
    annotations.delete('1:1');
    expect(() => assertAnnotationsFitBaseText(annotations, base)).toThrow(/same ayat/);
  });
});

describe('planning the overlay against the canonical corpus', () => {
  const annotations = readTajweedAnnotations(annotationFile());
  const baseText = readTajweedBaseText(BASE_TEXT_FILE);

  it('aligns, re-maps or skips every canonical Ayah, and counts each', () => {
    const plan = planTajweedOverlay({ annotations, baseText, canonical: CANONICAL });
    expect(plan.ayat.map((entry) => `${entry.surah}:${entry.ayah}`)).toEqual([
      '1:1',
      '1:2',
      '2:1',
      '2:2',
      '2:3',
    ]);
    expect(plan).toMatchObject({
      unchanged: 2,
      remapped: 3,
      skipped: { 'span-on-changed-text': 1, 'too-different': 0, 'not-annotated': 0 },
    });
    expect(plan.spans).toBe(
      plan.ayat.reduce((total, entry) => total + entry.spans.length, 0),
    );
    // Every carried span covers the code points its source span covered.
    for (const entry of plan.ayat) {
      const key = `${entry.surah}:${entry.ayah}`;
      const canonical = CANONICAL.find((a) => `${a.surah}:${a.ayah}` === key)!.text;
      for (const [index, carried] of entry.spans.entries())
        expect(covered(canonical, carried)).toBe(
          covered(baseText.get(key)!, annotations.get(key)![index]!),
        );
    }
  });

  it('counts a canonical Ayah the source does not annotate as skipped', () => {
    const plan = planTajweedOverlay({
      annotations,
      baseText,
      canonical: [...CANONICAL, { surah: 2, ayah: 4, text: 'نص' }],
    });
    expect(plan.skipped['not-annotated']).toBe(1);
  });

  it('refuses a source that annotates an Ayah the corpus does not hold', () => {
    expect(() =>
      planTajweedOverlay({
        annotations,
        baseText,
        canonical: CANONICAL.filter((entry) => entry.surah !== 2 || entry.ayah !== 3),
      }),
    ).toThrow(/not in the canonical corpus/);
  });
});
