import { describe, expect, it } from 'vitest';

import { parseSearchParams } from '../../packages/search/src/request.ts';

/**
 * The public search request at its trust boundary: every parameter untrusted,
 * every failure a named issue the page can explain.
 */

describe('parseSearchParams', () => {
  it('treats nothing typed as the initial state, not an error', () => {
    expect(parseSearchParams({}).state).toBe('empty');
    expect(parseSearchParams({ q: '   ', type: 'article' }).state).toBe('empty');
  });

  it('parses a complete, valid request', () => {
    const parsed = parseSearchParams({
      q: 'Reading rooms',
      type: 'edition',
      topic: 'islamic-history',
      language: 'UR',
      from: '2001',
      to: '2020',
      page: '3',
    });
    expect(parsed).toMatchObject({
      state: 'valid',
      search: {
        terms: ['reading', 'rooms'],
        kind: 'edition',
        topicSlug: 'islamic-history',
        contentLanguage: 'ur',
        fromYear: 2001,
        toYear: 2020,
        page: 3,
      },
    });
  });

  it('names every invalid parameter, and keeps what was typed for the form', () => {
    const parsed = parseSearchParams({
      q: 'book',
      type: 'video',
      topic: 'Not A Slug!',
      language: 'english language',
      from: '2020',
      to: '2010',
      page: '51',
    });
    expect(parsed.state).toBe('invalid');
    if (parsed.state !== 'invalid') return;
    expect([...parsed.issues].sort()).toEqual(
      ['language', 'page', 'topic', 'type', 'year-range'].sort(),
    );
    expect(parsed.form.type).toBe('video');
  });

  it('refuses a future or unknown result kind', () => {
    for (const type of ['research', 'video', 'fatwa', 'quran', 'hadith', 'event']) {
      expect(parseSearchParams({ q: 'x1', type }).state, type).toBe('invalid');
    }
  });

  it('reads a repeated parameter as its first value, never as a list', () => {
    const parsed = parseSearchParams({
      q: ['first', 'second'],
      type: ['article', 'page'],
    });
    expect(parsed).toMatchObject({
      state: 'valid',
      search: { terms: ['first'], kind: 'article' },
    });
  });

  it('bounds what it echoes back, so a crafted URL cannot reflect unbounded text', () => {
    const parsed = parseSearchParams({ q: 'x'.repeat(10_000) });
    expect(parsed.form.q.length).toBe(400);
    expect(parsed.state).toBe('invalid');
  });

  it('refuses a year that is not a year', () => {
    for (const from of ['0', '10000', '-5', '20a0', '1e3']) {
      expect(parseSearchParams({ q: 'book', from }).state, from).toBe('invalid');
    }
  });
});
