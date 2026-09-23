import { describe, expect, it } from 'vitest';

import {
  displaySummary,
  foldForMatching,
  matchingText,
  queryTerms,
  truncate,
} from '../../packages/search/src/text.ts';

/**
 * Search text handling — the one fold applied to what is indexed and to what is
 * searched, and the only path from a search box to the engine.
 */

describe('foldForMatching', () => {
  it('removes Arabic-script harakat, the superscript alef and Quranic signs', () => {
    expect(foldForMatching('الْمَكْتَبَةُ')).toBe('المكتبة');
    expect(foldForMatching('تعلیمِ')).toBe('تعلیم');
    expect(foldForMatching('اعلیٰ')).toBe('اعلی');
  });

  it('removes joiners and tatweel, so a compound is one word however it is typed', () => {
    expect(foldForMatching('کتاب\u200Cخانہ')).toBe('کتابخانہ');
    expect(foldForMatching('مكـــتبة')).toBe('مكتبة');
  });

  it('composes to NFC and lower-cases Latin text', () => {
    expect(foldForMatching('Cafe\u0301 LIBRARY')).toBe('café library');
  });

  it('is the same function for stored text and for queries', () => {
    const stored = matchingText({ title: 'الْمَكْتَبَةُ', summary: '', body: '' });
    const query = queryTerms('المكتبة');
    expect('terms' in query && stored.includes(query.terms[0] ?? '')).toBe(true);
  });
});

describe('queryTerms — the only path from a search box to the engine', () => {
  it('keeps only letters, marks and digits; every operator becomes a separator', () => {
    const result = queryTerms(`"handbook" AND NOT (room*) ~ NEAR; DROP TABLE -- '`);
    expect(result).toEqual({
      terms: ['handbook', 'and', 'not', 'room', 'near', 'drop', 'table'],
    });
  });

  it('de-duplicates, and refuses what a visitor can fix', () => {
    expect(queryTerms('book Book BOOK')).toEqual({ terms: ['book'] });
    expect(queryTerms('*** "" ()')).toEqual({ issue: 'no-terms' });
    expect(queryTerms('a b c d e f g h i')).toEqual({ issue: 'too-many-terms' });
    expect(queryTerms('x'.repeat(65))).toEqual({ issue: 'term-too-long' });
    expect(queryTerms('word '.repeat(41))).toEqual({ issue: 'query-too-long' });
  });

  it('keeps Arabic and Urdu words whole', () => {
    expect(queryTerms('کتب خانہ، المكتبة')).toEqual({
      terms: ['کتب', 'خانہ', 'المكتبة'],
    });
  });
});

describe('display text', () => {
  it('never splits a supplementary-plane character', () => {
    expect(truncate('ab\u{1F4DA}cd', 3)).toBe('ab\u{1F4DA}');
  });

  it('cuts a long summary at a word boundary and marks the cut', () => {
    const summary = displaySummary(`${'word '.repeat(80)}end`);
    expect(summary.endsWith('…')).toBe(true);
    expect(summary.length).toBeLessThanOrEqual(282);
    expect(summary).not.toMatch(/wor…$/u);
  });

  it('bounds the matched body', () => {
    expect(
      matchingText({ title: 't', summary: '', body: 'x'.repeat(50_000) }).length,
    ).toBe(20_000);
  });
});
