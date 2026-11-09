import { describe, expect, it } from 'vitest';

import { highlightSegments } from '../../apps/web/src/components/search/highlight.ts';

/**
 * Result highlighting returns SEGMENTS, never markup, so indexed text — whatever
 * an owner published — cannot become HTML on the results page.
 */

describe('highlightSegments', () => {
  it('marks every occurrence of every query word, case-insensitively', () => {
    expect(
      highlightSegments('Reading rooms and the reading list', 'READING list'),
    ).toEqual([
      { text: 'Reading', match: true },
      { text: ' rooms and the ', match: false },
      { text: 'reading', match: true },
      { text: ' ', match: false },
      { text: 'list', match: true },
    ]);
  });

  it('keeps hostile stored text as plain text segments', () => {
    const hostile = '<img src=x onerror=alert(1)> book <script>alert(2)</script>';
    const segments = highlightSegments(hostile, 'book');
    expect(segments.map((segment) => segment.text).join('')).toBe(hostile);
    expect(
      segments.filter((segment) => segment.match).map((segment) => segment.text),
    ).toEqual(['book']);
  });

  it('highlights Arabic and Urdu words', () => {
    const segments = highlightSegments('شہر کا کتب خانہ', 'کتب');
    expect(segments.filter((segment) => segment.match)).toEqual([
      { text: 'کتب', match: true },
    ]);
  });

  it('marks the whole word a typed prefix was found in', () => {
    expect(
      highlightSegments('Libraries and a library', 'librar').filter((s) => s.match),
    ).toEqual([
      { text: 'Libraries', match: true },
      { text: 'library', match: true },
    ]);
  });

  describe('through the engine’s own fold (Quran Part 4)', () => {
    const marked = (text: string, query: string) =>
      highlightSegments(text, query)
        .filter((segment) => segment.match)
        .map((segment) => segment.text);

    it('marks Uthmani words typed in ordinary spelling, marks and all', () => {
      // One word each, as the Tanzil Uthmani encoding writes it — never an Ayah.
      const text = 'ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلصَّلَوٰةَ ٱلْكِتَـٰبُ';
      expect(marked(text, 'الله')).toEqual(['ٱللَّهِ']);
      expect(marked(text, 'الرحمن')).toEqual(['ٱلرَّحْمَـٰنِ']);
      expect(marked(text, 'الصلاة')).toEqual(['ٱلصَّلَوٰةَ']);
      expect(marked(text, 'الكتاب')).toEqual(['ٱلْكِتَـٰبُ']);
      // Urdu-keyboard letters meet the Arabic ones.
      expect(marked(text, 'اللہ')).toEqual(['ٱللَّهِ']);
    });

    it('marks a joined word whole, so an Arabic word is never cut in two', () => {
      expect(marked('وَٱللَّهُ أَعْلَمُ', 'الله')).toEqual(['وَٱللَّهُ']);
    });

    it('cuts every segment from the ORIGINAL text, never the folded one', () => {
      const text = 'ٱلصَّلَوٰةَ وَٱلزَّكَوٰةَ';
      const segments = highlightSegments(text, 'الزكاة');
      expect(segments.map((segment) => segment.text).join('')).toBe(text);
    });
  });

  it('shows the text plainly when there is nothing to mark', () => {
    expect(highlightSegments('Nothing here', '*')).toEqual([
      { text: 'Nothing here', match: false },
    ]);
    expect(highlightSegments('Nothing here', 'absent')).toEqual([
      { text: 'Nothing here', match: false },
    ]);
  });
});
