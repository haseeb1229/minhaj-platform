import { describe, expect, it } from 'vitest';

import {
  QURAN_LIMITS,
  type CandidateAyah,
} from '../../packages/contracts/src/quran/index.ts';
import {
  compareExact,
  decodeExact,
  verifyCorpus,
} from '../../apps/web/src/contexts/quran/index.ts';

/**
 * Phase 18 — exact verification of religious text, pure.
 *
 * WHAT IS PROVED: equality is code point for code point and NOTHING ELSE. Every
 * case below is a pair a normalising comparison would call equal — a changed
 * mark, a lookalike letter, a precomposed letter beside its decomposition, a
 * byte-order mark, a whitespace difference — and each must be a difference at
 * the right code-point offset. A report names references and offsets only.
 *
 * EVERY STRING HERE IS SYNTHETIC. Letters and marks are named by escape and
 * never form scripture; corpus fixtures are `NON_QURAN_FIXTURE` sentinels with
 * the neutral phrase "non-Quranic test text".
 */

const NEUTRAL = 'نص اختبار غير قرآني';
const sentinel = (surah: number, ayah: number) =>
  `NON_QURAN_FIXTURE_CANONICAL_${surah}_${ayah} ${NEUTRAL}`;

const BEH = 'ب';
const FATHA = 'َ';
const KASRA = 'ِ';
const ARABIC_YEH = 'ي';
const FARSI_YEH = 'ی';

describe('compareExact', () => {
  it('passes only an identical text', () => {
    expect(compareExact(sentinel(1, 1), sentinel(1, 1))).toBeNull();
    expect(compareExact('', '')).toBeNull();
  });

  it('fails one changed code point at its offset', () => {
    expect(compareExact('NON_QURAN_FIXTURE_A', 'NON_QURAN_FIXTURE_B')).toBe(18);
  });

  it('counts code points, not UTF-16 units, before an astral character', () => {
    const astral = '\u{1D400}';
    expect(astral.length).toBe(2);
    expect(compareExact(`${astral}${astral}A`, `${astral}${astral}B`)).toBe(2);
    expect(compareExact(`${astral}A`, '\u{1D401}A')).toBe(0);
  });

  it('fails a changed combining mark', () => {
    expect(compareExact(`${BEH}${FATHA}${BEH}`, `${BEH}${KASRA}${BEH}`)).toBe(1);
  });

  it('fails a removed or added combining mark', () => {
    expect(compareExact(`${BEH}${FATHA}${BEH}`, `${BEH}${BEH}`)).toBe(1);
    expect(compareExact(`${BEH}${BEH}`, `${BEH}${BEH}${FATHA}`)).toBe(2);
  });

  it('fails inserted, removed and trailing whitespace', () => {
    expect(compareExact('NON QURAN', 'NONQURAN')).toBe(3);
    expect(compareExact('NON  QURAN', 'NON QURAN')).toBe(4);
    expect(compareExact('NON QURAN ', 'NON QURAN')).toBe(9);
    expect(compareExact(' NON QURAN', 'NON QURAN')).toBe(0);
    expect(compareExact('NON QURAN', 'NON QURAN')).toBe(3);
  });

  it('fails the Arabic yeh against its Farsi lookalike', () => {
    expect(compareExact(`${BEH}${ARABIC_YEH}`, `${BEH}${FARSI_YEH}`)).toBe(1);
  });

  it('fails a precomposed letter against its canonically equivalent decomposition', () => {
    const precomposed = 'é';
    const decomposed = 'é';
    // They ARE the same text to Unicode normalisation — which is the point.
    expect(precomposed.normalize('NFD')).toBe(decomposed);
    expect(decomposed.normalize('NFC')).toBe(precomposed);
    expect(compareExact(`X${precomposed}`, `X${decomposed}`)).toBe(1);
  });

  it('fails an invisible joiner and a case difference', () => {
    expect(compareExact(`${BEH}‍${BEH}`, `${BEH}${BEH}`)).toBe(1);
    expect(compareExact('non_quran', 'NON_QURAN')).toBe(0);
  });
});

describe('decodeExact', () => {
  const utf8 = (text: string) => new TextEncoder().encode(text);

  it('decodes well-formed UTF-8 exactly', () => {
    const text = `${sentinel(2, 3)} ${BEH}${FATHA}\u{1D400}`;
    expect(decodeExact(utf8(text), 'utf-8')).toEqual({ ok: true, text });
  });

  it('keeps a byte-order mark, so it is a difference at offset 0', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('NON_QURAN_FIXTURE')]);
    const decoded = decodeExact(bytes, 'utf-8');
    expect(decoded).toEqual({ ok: true, text: '﻿NON_QURAN_FIXTURE' });
    if (!decoded.ok) throw new Error('unreachable');
    expect(compareExact(decoded.text, 'NON_QURAN_FIXTURE')).toBe(0);
  });

  it('refuses malformed bytes rather than replacing them', () => {
    for (const bytes of [
      [0xc3, 0x28], // a lead byte without its continuation
      [0x80], // a lone continuation byte
      [0xc0, 0xaf], // an overlong encoding
      [0xed, 0xa0, 0x80], // an encoded surrogate
      [0xf4, 0x90, 0x80, 0x80], // beyond the Unicode range
      [0xe0, 0xa0], // truncated at the end
    ]) {
      expect(decodeExact(new Uint8Array(bytes), 'utf-8'), bytes.join(',')).toEqual({
        ok: false,
        reason: 'malformed-encoding',
      });
    }
  });

  it('refuses every encoding but utf-8, without guessing', () => {
    for (const encoding of ['utf-16le', 'latin1', 'windows-1256', 'UTF-8', 'utf8', '']) {
      expect(decodeExact(utf8('NON_QURAN_FIXTURE'), encoding), encoding).toEqual({
        ok: false,
        reason: 'unsupported-encoding',
      });
    }
  });
});

describe('verifyCorpus', () => {
  const ayah = (surah: number, number: number, juz = 1, text = sentinel(surah, number)) =>
    ({ surah, ayah: number, juz, text }) satisfies CandidateAyah;

  const reference = [ayah(1, 1), ayah(1, 2), ayah(2, 1, 2), ayah(2, 2, 2)];

  it('passes a candidate equal to the source', () => {
    expect(verifyCorpus(reference, [...reference])).toEqual({
      passed: true,
      checked: 4,
      mismatchCount: 0,
      mismatches: [],
    });
  });

  it('reports the first differing code point of a changed text', () => {
    const changed = `${sentinel(1, 2).slice(0, 5)}#${sentinel(1, 2).slice(6)}`;
    const report = verifyCorpus(reference, [
      ayah(1, 1),
      ayah(1, 2, 1, changed),
      ayah(2, 1, 2),
      ayah(2, 2, 2),
    ]);
    expect(report).toEqual({
      passed: false,
      checked: 4,
      mismatchCount: 1,
      mismatches: [{ reason: 'text-mismatch', ref: { surah: 1, ayah: 2 }, offset: 5 }],
    });
  });

  it('reports unknown, duplicate and missing references and a Juz mismatch', () => {
    const report = verifyCorpus(reference, [
      ayah(1, 1),
      ayah(1, 1),
      ayah(2, 1, 3),
      ayah(2, 2, 2),
      ayah(3, 1, 2),
    ]);
    expect(report.passed).toBe(false);
    expect(report.checked).toBe(5);
    expect(report.mismatches).toEqual([
      { reason: 'duplicate-reference', ref: { surah: 1, ayah: 1 }, offset: null },
      { reason: 'missing-reference', ref: { surah: 1, ayah: 2 }, offset: null },
      { reason: 'juz-mismatch', ref: { surah: 2, ayah: 1 }, offset: null },
      { reason: 'unknown-reference', ref: { surah: 3, ayah: 1 }, offset: null },
    ]);
    expect(report.mismatchCount).toBe(4);
  });

  it('reports a Juz and a text difference of one Ayah separately', () => {
    const report = verifyCorpus(reference, [
      ayah(1, 1, 2, `${sentinel(1, 1)}${FATHA}`),
      ayah(1, 2),
      ayah(2, 1, 2),
      ayah(2, 2, 2),
    ]);
    expect(report.mismatches).toEqual([
      { reason: 'juz-mismatch', ref: { surah: 1, ayah: 1 }, offset: null },
      {
        reason: 'text-mismatch',
        ref: { surah: 1, ayah: 1 },
        offset: [...sentinel(1, 1)].length,
      },
    ]);
  });

  it('orders the report canonically whatever order the candidate arrives in', () => {
    const candidate = [ayah(2, 2, 3), ayah(1, 2, 1, 'X'), ayah(2, 1, 2), ayah(1, 1, 2)];
    const forward = verifyCorpus(reference, candidate);
    const backward = verifyCorpus(reference, [...candidate].reverse());
    expect(backward).toEqual(forward);
    expect(forward.mismatches.map((entry) => entry.ref)).toEqual([
      { surah: 1, ayah: 1 },
      { surah: 1, ayah: 2 },
      { surah: 2, ayah: 2 },
    ]);
  });

  it('counts every mismatch but names at most the bound', () => {
    const many = Array.from({ length: 30 }, (_, index) => ayah(5, index + 1));
    const report = verifyCorpus(
      many,
      many.map((entry) => ({ ...entry, text: `${entry.text}${KASRA}` })),
    );
    expect(report.mismatchCount).toBe(30);
    expect(report.mismatches).toHaveLength(QURAN_LIMITS.reportedMismatches);
    expect(report.mismatches[0]?.ref).toEqual({ surah: 5, ayah: 1 });
  });

  it('never carries text in the report', () => {
    const report = verifyCorpus(reference, [
      ayah(1, 1, 1, `${sentinel(1, 1)}${FARSI_YEH}`),
      ayah(9, 9, 9, 'NON_QURAN_FIXTURE_UNKNOWN_CANDIDATE'),
    ]);
    const serialised = JSON.stringify(report);
    expect(serialised).not.toContain('NON_QURAN_FIXTURE');
    expect(serialised).not.toContain(NEUTRAL);
    expect(serialised).not.toContain(FARSI_YEH);
    for (const mismatch of report.mismatches)
      expect(Object.keys(mismatch).sort()).toEqual(['offset', 'reason', 'ref']);
  });
});
