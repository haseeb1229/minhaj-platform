import { describe, expect, it } from 'vitest';

import { FATWA_MAX_OFFSET } from '../../packages/contracts/src/fatwa/index.ts';
import {
  fatwaBrowseHref,
  fatwaContentLocales,
  fatwaSearchRequest,
  fatwaTextDirection,
  isInvalidBrowse,
  readFatwaBrowse,
  readFatwaOffset,
  readFatwaSort,
  readQuestionId,
  readRulingSegment,
  rulingDescription,
  rulingHref,
} from '../../apps/web/src/components/fatwa/presentation.ts';

/**
 * Phase 20 — the pure presentation decisions behind the public Fatwa pages.
 *
 * WHAT IS PROVED: a sort defaults to `latest` and an unknown one is REFUSED
 * rather than replaced; a malformed category or topic is INVALID, never
 * dropped, so a view can never broaden; an offset is bounded; sorts are query
 * parameters and never paths; Urdu and Arabic rulings are set right-to-left;
 * a ruling exists in exactly its own interface locale; and the search page can
 * pass nothing but `q`, `page` and the fixed `fatwa` type.
 *
 * Every value is a synthetic sentinel. No ruling text appears anywhere.
 */

describe('sort', () => {
  it('defaults to latest when absent or empty', () => {
    expect(readFatwaSort({})).toBe('latest');
    expect(readFatwaSort({ sort: '' })).toBe('latest');
  });

  it('reads the two sorts, the first of a repeated parameter', () => {
    expect(readFatwaSort({ sort: 'popular' })).toBe('popular');
    expect(readFatwaSort({ sort: 'latest' })).toBe('latest');
    expect(readFatwaSort({ sort: ['popular', 'latest'] })).toBe('popular');
  });

  it('refuses an unknown sort instead of substituting the default', () => {
    for (const sort of ['Popular', 'oldest', 'featured', ' latest', 'latest;drop'])
      expect(readFatwaSort({ sort }), sort).toBeNull();
  });
});

describe('offset', () => {
  it('reads a plain bounded offset and treats anything else as the first page', () => {
    expect(readFatwaOffset({})).toBe(0);
    expect(readFatwaOffset({ offset: '20' })).toBe(20);
    expect(readFatwaOffset({ offset: String(FATWA_MAX_OFFSET) })).toBe(FATWA_MAX_OFFSET);
    for (const offset of [
      '-1',
      '1e3',
      '20.5',
      'abc',
      String(FATWA_MAX_OFFSET + 1),
      '9999999',
    ])
      expect(readFatwaOffset({ offset }), offset).toBe(0);
  });
});

describe('browse filters', () => {
  it('reads absent filters as none', () => {
    const browse = readFatwaBrowse({});
    expect(browse).toEqual({
      sort: 'latest',
      category: { state: 'none' },
      topic: { state: 'none' },
      offset: 0,
    });
    expect(isInvalidBrowse(browse)).toBe(false);
  });

  it('reads well-formed slugs for the owner to resolve', () => {
    const browse = readFatwaBrowse({
      sort: 'popular',
      category: 'fixture-category',
      topic: 'fixture-topic',
      offset: '40',
    });
    expect(browse.category).toEqual({ state: 'slug', slug: 'fixture-category' });
    expect(browse.topic).toEqual({ state: 'slug', slug: 'fixture-topic' });
    expect(isInvalidBrowse(browse)).toBe(false);
  });

  it('marks a malformed filter or sort invalid, so nothing broadens', () => {
    for (const query of [
      { category: 'Not A Slug' },
      { category: '../x' },
      { topic: 'UPPER' },
      { topic: ' fixture-topic' },
      { sort: 'random' },
    ]) {
      expect(isInvalidBrowse(readFatwaBrowse(query)), JSON.stringify(query)).toBe(true);
    }
  });

  it('builds sort views as query links, never as /fatwa/latest or /fatwa/popular', () => {
    expect(fatwaBrowseHref('en', { sort: 'latest' })).toBe('/en/fatwa?sort=latest');
    expect(fatwaBrowseHref('ur', { sort: 'popular' })).toBe('/ur/fatwa?sort=popular');
    expect(
      fatwaBrowseHref('ar', {
        sort: 'popular',
        category: 'fixture-category',
        topic: 'fixture-topic',
        offset: 20,
      }),
    ).toBe(
      '/ar/fatwa?sort=popular&category=fixture-category&topic=fixture-topic&offset=20',
    );
    for (const sort of ['latest', 'popular'] as const)
      expect(fatwaBrowseHref('en', { sort })).not.toMatch(/\/fatwa\/(?:latest|popular)/u);
  });
});

describe('segments and addresses', () => {
  it('accepts a ruling slug, refusing the section words and malformed values', () => {
    expect(readRulingSegment('non-fatwa-fixture-ruling')).toBe(
      'non-fatwa-fixture-ruling',
    );
    for (const word of [
      'search',
      'categories',
      'topics',
      'how-it-works',
      'ask',
      'latest',
      'popular',
    ])
      expect(readRulingSegment(word), word).toBeNull();
    expect(readRulingSegment('Bad Slug')).toBeNull();
    expect(rulingHref('ur', 'non-fatwa-fixture-ruling')).toBe(
      '/ur/fatwa/non-fatwa-fixture-ruling',
    );
  });

  it('accepts only a UUID as a question id', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(readQuestionId(id)).toBe(id);
    for (const value of ['1', 'not-an-id', `${id}x`])
      expect(readQuestionId(value), value).toBeNull();
  });
});

describe('language', () => {
  it('sets Urdu and Arabic right-to-left and leaves every other language to the browser', () => {
    expect(fatwaTextDirection('ur')).toBe('rtl');
    expect(fatwaTextDirection('ar')).toBe('rtl');
    expect(fatwaTextDirection('ar-EG')).toBe('rtl');
    expect(fatwaTextDirection('UR')).toBe('rtl');
    expect(fatwaTextDirection('en')).toBe('auto');
    expect(fatwaTextDirection('fr')).toBe('auto');
  });

  it('lists a ruling in exactly its own interface locale, or in none', () => {
    expect(fatwaContentLocales('ur')).toEqual(['ur']);
    expect(fatwaContentLocales('en')).toEqual(['en']);
    expect(fatwaContentLocales('fr')).toEqual([]);
    expect(fatwaContentLocales('ar-EG')).toEqual([]);
  });

  it('describes a ruling by the opening of its public question only, cut by code point', () => {
    expect(rulingDescription('NON_FATWA_FIXTURE_QUESTION\n  one')).toBe(
      'NON_FATWA_FIXTURE_QUESTION one',
    );
    const long = 'س'.repeat(200);
    const description = rulingDescription(long);
    expect([...description]).toHaveLength(151);
    expect(description.endsWith('…')).toBe(true);
  });
});

describe('Fatwa search request', () => {
  it('passes q and page and fixes the type to fatwa', () => {
    expect(fatwaSearchRequest({ q: 'NON_FATWA_FIXTURE', page: '2' })).toEqual({
      q: 'NON_FATWA_FIXTURE',
      type: 'fatwa',
      page: '2',
    });
  });

  it('can be widened by nothing a URL carries', () => {
    expect(
      fatwaSearchRequest({
        q: 'x',
        type: 'article',
        topic: 'fixture-topic',
        language: 'en',
      }),
    ).toEqual({ q: 'x', type: 'fatwa' });
    expect(fatwaSearchRequest({})).toEqual({ q: '', type: 'fatwa' });
  });
});
