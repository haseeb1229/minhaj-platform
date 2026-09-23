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

  it('shows the text plainly when there is nothing to mark', () => {
    expect(highlightSegments('Nothing here', '*')).toEqual([
      { text: 'Nothing here', match: false },
    ]);
    expect(highlightSegments('Nothing here', 'absent')).toEqual([
      { text: 'Nothing here', match: false },
    ]);
  });
});
