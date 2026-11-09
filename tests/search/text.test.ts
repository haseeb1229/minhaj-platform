import { describe, expect, it } from 'vitest';

import {
  foldForReading,
  readingWords,
} from '../../packages/contracts/src/search/fold.ts';
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
    expect(foldForMatching('الْمَكْتَبَةُ')).toBe(foldForMatching('المكتبة'));
    expect(foldForMatching('تعلیمِ')).toBe(foldForMatching('تعلیم'));
    expect(foldForMatching('اعلیٰ')).toBe(foldForMatching('اعلی'));
  });

  it('removes joiners and tatweel, so a compound is one word however it is typed', () => {
    expect(foldForMatching('کتاب\u200Cخانہ')).toBe(foldForMatching('کتابخانہ'));
    expect(foldForMatching('مكـــتبة')).toBe(foldForMatching('مكتبة'));
  });

  it('composes to NFC and lower-cases Latin text', () => {
    expect(foldForMatching('Cafe\u0301 LIBRARY')).toBe('café library');
  });

  it('unifies the Arabic-script letters ordinary typing writes interchangeably (Quran Part 4)', () => {
    // Alef forms and the alef wasla.
    for (const alef of ['أ', 'إ', 'آ', 'ٱ']) expect(foldForMatching(alef)).toBe('ا');
    // Alef maqsura, Urdu/Farsi yeh and yeh with hamza: one yeh.
    for (const yeh of ['ى', 'ی', 'ئ']) expect(foldForMatching(yeh)).toBe('ي');
    // Keheh and kaf; taa marbuta and the Arabic and Urdu heh forms.
    expect(foldForMatching('ک')).toBe('ك');
    for (const heh of ['ة', 'ہ', 'ۃ', 'ھ']) expect(foldForMatching(heh)).toBe('ه');
    expect(foldForMatching('ؤ')).toBe('و');
    // The hamza on the line is a letter, and stays one: the Arabic word
    // breaker reads a word by it.
    expect(foldForMatching('شيء')).toBe('شيء');
    expect(foldForMatching('شيء')).not.toBe(foldForMatching('شي'));
    // So the Urdu-keyboard spelling of a word meets the Arabic one.
    expect(foldForMatching('اللہ')).toBe(foldForMatching('الله'));
    expect(foldForMatching('نئی')).toBe(foldForMatching('نئي'));
  });

  it('is the same function for stored text and for queries', () => {
    const stored = matchingText({ title: 'الْمَكْتَبَةُ', summary: '', body: '' });
    const query = queryTerms('المكتبة');
    expect('terms' in query && stored.includes(query.terms[0] ?? '')).toBe(true);
  });
});

/**
 * THE UTHMANI ORTHOGRAPHY, as the Tanzil Uthmani encoding writes single words
 * — the alef wasla, the dagger alef set on a tatweel, a waw carrying the
 * dagger alef, the small high yeh, the small waw, the hamza on a tatweel, the
 * vocative particle joined to its noun. Each sample is ONE WORD (or one joined
 * particle and word) of ordinary Arabic vocabulary, never an Ayah; what is
 * proved is that the word typed in ordinary spelling is one of the words the
 * indexed copy carries, and that the stored text is never what changes.
 */
describe('the Uthmani orthography meets ordinary typing (Quran Part 4)', () => {
  /** The words an indexed text is matched by: its plain fold, then its reading. */
  const indexed = (text: string) =>
    new Set([
      ...(foldForMatching(text).match(/[\p{L}\p{M}\p{N}]+/gu) ?? []),
      ...readingWords(text),
    ]);
  const typed = (query: string) => {
    const terms = queryTerms(query);
    if (!('terms' in terms)) throw new Error(`no terms in ${query}`);
    return terms.terms;
  };

  it.each([
    ['ٱللَّهِ', 'الله'],
    ['ٱللَّهِ', 'اللہ'],
    ['ٱلرَّحْمَـٰنِ', 'الرحمن'],
    ['ٱلرَّحْمَـٰنِ', 'الرحمان'],
    ['ٱلصَّلَوٰةَ', 'الصلاة'],
    ['ٱلصَّلَوٰةَ', 'الصلاه'],
    ['ٱلْحَيَوٰةِ', 'الحياة'],
    ['ٱلْكِتَـٰبُ', 'الكتاب'],
    ['هَـٰذَا', 'هذا'],
    ['إِبْرَٰهِـۧمَ', 'إبراهيم'],
    ['ٱلَّيْلِ', 'الليل'],
    ['شَيْـًٔا', 'شيئا'],
    ['ءَامَنُوا', 'آمنوا'],
    ['ءَامَنُوا', 'امنوا'],
    ['دَاوُۥدَ', 'داود'],
    ['دَاوُۥدَ', 'داوود'],
    ['يَـٰٓأَيُّهَا', 'يا أيها'],
    ['ٱلْكِتَـٰبُ', 'ٱلْكِتَـٰبُ'],
  ])('%s is found by typing %s', (stored, query) => {
    const words = indexed(stored);
    for (const term of typed(query)) expect(words, `${query} → ${term}`).toContain(term);
  });

  it('reads the marks as letters only to ADD words; the plain fold is unchanged', () => {
    // The plain fold keeps the dagger-alef-less spelling (الرحمن); the reading
    // adds the spelled-out one (الرحمان) — both are indexed, neither replaces.
    expect(foldForMatching('ٱلرَّحْمَـٰنِ')).toBe(foldForMatching('الرحمن'));
    expect(foldForReading('ٱلرَّحْمَـٰنِ')).toBe(foldForMatching('الرحمان'));
    expect(readingWords('ٱلرَّحْمَـٰنِ')).toEqual([foldForMatching('الرحمان')]);
    // A word written with no Uthmani mark has no second reading.
    expect(readingWords('المكتبة العامة in the city')).toEqual([]);
    // A pronoun's lengthening (bihī) is not a letter in ordinary spelling.
    expect(readingWords('بِهِۦ')).toEqual([]);
  });

  it('indexes the reading inside the body bound, and never alters the input', () => {
    const stored = 'ٱلصَّلَوٰةَ وَٱلْكِتَـٰبُ';
    const copy = `${stored}`;
    const matched = matchingText({ title: '2:3', summary: stored, body: '' });
    expect(stored).toBe(copy);
    const [plain, added] = matched.split('\n').slice(-2);
    expect(plain).toBe(foldForMatching(stored));
    expect(added?.split(' ')).toEqual(readingWords(stored));
    expect(
      matchingText({ title: 't', summary: '', body: 'ٱلصَّلَوٰةَ '.repeat(3_000) })
        .length,
    ).toBeLessThanOrEqual(20_000);
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

  it('keeps Arabic and Urdu words whole, folded as the index folds them', () => {
    expect(queryTerms('کتب خانہ، المكتبة')).toEqual({
      terms: [
        foldForMatching('کتب'),
        foldForMatching('خانہ'),
        foldForMatching('المكتبة'),
      ],
    });
    expect(queryTerms('کتب خانہ، المكتبة')).toEqual({
      terms: ['كتب', 'خانه', 'المكتبه'],
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
