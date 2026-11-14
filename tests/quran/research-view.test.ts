import { describe, expect, it } from 'vitest';

import { QURAN_RESEARCH_PAGE, quranResearchQuerySchema } from '@minhaj/contracts/library';

import {
  DEFAULT_RESEARCH_QUERY,
  EXCERPT,
  RESEARCH_MAX_PAGE,
  byDecade,
  decadeOf,
  excerptOf,
  readResearchQuery,
  researchCanonicalRedirect,
  researchFiltered,
  researchHref,
  researchPageCount,
  researchRange,
  researchReadQuery,
} from '../../apps/web/src/components/quran/research-view.ts';

/**
 * Quran Part 12 — the Quran Research hub's address rules: the view a URL
 * names, the address each control and link builds, the query Library is
 * asked, the decade timeline and the abstract's excerpt. Tolerant of anything
 * a visitor or a crawler types; never widening.
 */

const PERSON = '5b0e1d2c-3f4a-4b5c-8d6e-7f8091a2b3c4';
const TOPIC = '0f1e2d3c-4b5a-4968-8776-655443322110';

describe('readResearchQuery', () => {
  it('reads the neutral view from an empty address', () => {
    expect(readResearchQuery({})).toEqual(DEFAULT_RESEARCH_QUERY);
    expect(researchFiltered(readResearchQuery({}))).toBe(false);
  });

  it('reads every parameter it knows, the kind by its short word', () => {
    expect(
      readResearchQuery({
        kind: 'paper',
        language: 'ur',
        contributor: PERSON,
        decade: '1990',
        fulltext: '1',
        sort: 'oldest',
        page: '3',
      }),
    ).toEqual({
      kind: 'research-paper',
      language: 'ur',
      contributor: PERSON,
      decade: 1990,
      fullText: true,
      sort: 'oldest',
      page: 3,
    });
    expect(readResearchQuery({ kind: 'research' }).kind).toBe('research');
    expect(readResearchQuery({ sort: 'title' }).sort).toBe('title');
    expect(researchFiltered(readResearchQuery({ fulltext: '1' }))).toBe(true);
    expect(researchFiltered(readResearchQuery({ sort: 'title', page: '2' }))).toBe(false);
  });

  it('drops what is malformed, out of range or repeated, rather than failing', () => {
    expect(
      readResearchQuery({
        kind: 'research-paper',
        language: '<script>',
        contributor: 'not-a-uuid',
        decade: '1995',
        fulltext: 'yes',
        sort: 'random',
        page: '0',
      }),
    ).toEqual(DEFAULT_RESEARCH_QUERY);
    expect(readResearchQuery({ decade: '-10' }).decade).toBeNull();
    expect(readResearchQuery({ decade: '10000' }).decade).toBeNull();
    expect(readResearchQuery({ decade: '199.0' }).decade).toBeNull();
    expect(readResearchQuery({ decade: ['1990', '2000'] }).decade).toBeNull();
    expect(readResearchQuery({ kind: ['paper', 'research'] }).kind).toBe('all');
    expect(readResearchQuery({ fulltext: ['1', '1'] }).fullText).toBe(false);
    expect(readResearchQuery({ fulltext: '0' }).fullText).toBe(false);
    expect(readResearchQuery({ language: 'x'.repeat(17) }).language).toBeNull();
    expect(readResearchQuery({ page: String(RESEARCH_MAX_PAGE + 1) }).page).toBe(1);
    expect(readResearchQuery({ page: String(RESEARCH_MAX_PAGE) }).page).toBe(
      RESEARCH_MAX_PAGE,
    );
    expect(readResearchQuery({ page: '1e3' }).page).toBe(1);
  });

  it('accepts the first decade and a regional language, and folds an identifier', () => {
    expect(readResearchQuery({ decade: '0' }).decade).toBe(0);
    expect(readResearchQuery({ decade: '9990' }).decade).toBe(9990);
    expect(readResearchQuery({ language: 'ur-PK' }).language).toBe('ur-PK');
    expect(readResearchQuery({ contributor: PERSON.toUpperCase() }).contributor).toBe(
      PERSON,
    );
  });

  it('always reads a query Library’s own schema accepts, up to its offset bound', () => {
    for (const raw of [
      {},
      { kind: 'paper', decade: '2020', fulltext: '1', sort: 'title' },
      { page: String(RESEARCH_MAX_PAGE), decade: '0', language: 'ar' },
    ])
      expect(
        quranResearchQuerySchema.safeParse(
          researchReadQuery(readResearchQuery(raw), TOPIC, 'en'),
        ).success,
      ).toBe(true);
  });
});

describe('researchHref', () => {
  const view = readResearchQuery({
    kind: 'paper',
    language: 'ur',
    contributor: PERSON,
    decade: '2010',
    fulltext: '1',
    sort: 'title',
    page: '4',
  });

  it('gives the unfiltered hub exactly one address, in every locale', () => {
    expect(researchHref('en', DEFAULT_RESEARCH_QUERY)).toBe('/quran/research');
    expect(researchHref('ur', DEFAULT_RESEARCH_QUERY)).toBe('/ur/quran/research');
    expect(researchHref('ar', DEFAULT_RESEARCH_QUERY)).toBe('/ar/quran/research');
  });

  it('writes every narrowing value in one fixed order, and the page last', () => {
    expect(researchHref('en', view)).toBe(
      `/quran/research?kind=paper&language=ur&contributor=${PERSON}&decade=2010&fulltext=1&sort=title&page=4`,
    );
  });

  it('returns to the first page whenever anything but the page changes', () => {
    expect(researchHref('en', view, { decade: null })).toBe(
      `/quran/research?kind=paper&language=ur&contributor=${PERSON}&fulltext=1&sort=title`,
    );
    expect(researchHref('en', view, { kind: 'all', fullText: false })).toBe(
      `/quran/research?language=ur&contributor=${PERSON}&decade=2010&sort=title`,
    );
    expect(researchHref('en', view, { page: 5 })).toContain('&page=5');
    expect(researchHref('en', view, { page: 1 })).not.toContain('page=');
  });

  it('round-trips: the address it builds reads back as the same view', () => {
    const href = researchHref('en', view);
    const params = Object.fromEntries(new URL(href, 'https://x.invalid').searchParams);
    expect(readResearchQuery(params)).toEqual(view);
  });
});

describe('researchCanonicalRedirect', () => {
  it('leaves a canonical address, and the bare hub, alone', () => {
    expect(researchCanonicalRedirect('en', {})).toBeNull();
    expect(
      researchCanonicalRedirect('ur', { kind: 'research', decade: '1990', page: '2' }),
    ).toBeNull();
    // A parameter the hub does not read — the former related view's offset
    // among them — is not its business.
    expect(researchCanonicalRedirect('en', { utm_source: 'x' })).toBeNull();
    expect(researchCanonicalRedirect('en', { offset: '25' })).toBeNull();
  });

  it('sends what a filter form submits — every control, empty ones included — to one address', () => {
    expect(
      researchCanonicalRedirect('en', {
        language: '',
        contributor: PERSON,
        decade: '',
        fulltext: '',
        sort: 'newest',
      }),
    ).toBe(`/quran/research?contributor=${PERSON}`);
    expect(
      researchCanonicalRedirect('ar', { kind: 'paper', fulltext: '1', sort: 'newest' }),
    ).toBe('/ar/quran/research?kind=paper&fulltext=1');
  });

  it('sends another order, a malformed or repeated value to the parsed view', () => {
    expect(researchCanonicalRedirect('en', { sort: 'title', kind: 'paper' })).toBe(
      '/quran/research?kind=paper&sort=title',
    );
    expect(
      researchCanonicalRedirect('en', { decade: '1995', page: '-1', kind: 'drafts' }),
    ).toBe('/quran/research');
    expect(researchCanonicalRedirect('en', { language: ['ur', 'en'] })).toBe(
      '/quran/research',
    );
    expect(researchCanonicalRedirect('en', { page: '1' })).toBe('/quran/research');
    // The contract's spelling of a kind is not the address's.
    expect(researchCanonicalRedirect('en', { kind: 'research-paper' })).toBe(
      '/quran/research',
    );
    // Built from the parsed view, never from the typed text.
    expect(researchCanonicalRedirect('en', { language: 'https://evil.example/' })).toBe(
      '/quran/research',
    );
  });

  it('never redirects an address it built itself', () => {
    const view = readResearchQuery({
      kind: 'research',
      language: 'ur-PK',
      contributor: PERSON,
      decade: '0',
      fulltext: '1',
      sort: 'oldest',
      page: '7',
    });
    const href = researchHref('en', view);
    const params = Object.fromEntries(new URL(href, 'https://x.invalid').searchParams);
    expect(researchCanonicalRedirect('en', params)).toBeNull();
  });
});

describe('researchReadQuery and paging', () => {
  it('asks Library for one page by offset, with the Topic and the reader’s title locale', () => {
    expect(
      researchReadQuery(readResearchQuery({ page: '3', fulltext: '1' }), TOPIC, 'ur'),
    ).toEqual({
      topic: TOPIC,
      kind: 'all',
      language: null,
      contributor: null,
      decade: null,
      fullText: true,
      sort: 'newest',
      titleLocale: 'ur',
      offset: 2 * QURAN_RESEARCH_PAGE,
      limit: QURAN_RESEARCH_PAGE,
    });
    expect(researchReadQuery(DEFAULT_RESEARCH_QUERY, null, 'en').topic).toBeNull();
  });

  it('counts pages and states the range a page shows', () => {
    expect(researchPageCount(0)).toBe(1);
    expect(researchPageCount(QURAN_RESEARCH_PAGE)).toBe(1);
    expect(researchPageCount(QURAN_RESEARCH_PAGE + 1)).toBe(2);
    expect(researchRange(1, 0)).toBeNull();
    expect(researchRange(2, 3)).toEqual({
      from: QURAN_RESEARCH_PAGE + 1,
      to: QURAN_RESEARCH_PAGE + 3,
    });
  });
});

describe('the decade timeline', () => {
  it('names the decade a year falls in, and none for an undated record', () => {
    expect(decadeOf(1999)).toBe(1990);
    expect(decadeOf(2000)).toBe(2000);
    expect(decadeOf(7)).toBe(0);
    expect(decadeOf(null)).toBeNull();
  });

  it('groups a page by decade in the order given, never re-sorting it', () => {
    const items = [2021, 2020, 2019, 2011, 1999, null, null].map((year, index) => ({
      id: index,
      publicationYear: year,
    }));
    expect(
      byDecade(items).map((group) => [group.decade, group.items.map((item) => item.id)]),
    ).toEqual([
      [2020, [0, 1]],
      [2010, [2, 3]],
      [1990, [4]],
      [null, [5, 6]],
    ]);
    expect(byDecade([])).toEqual([]);
  });
});

describe('excerptOf', () => {
  it('keeps a short first paragraph whole, whitespace collapsed', () => {
    expect(excerptOf('  A short\n abstract.  \n\nSecond paragraph.')).toBe(
      'A short abstract.',
    );
    expect(excerptOf('\r\n\r\nOnly after a blank line.')).toBe(
      'Only after a blank line.',
    );
  });

  it('cuts a long one at a word boundary, with an ellipsis, never mid-word', () => {
    const words = Array.from({ length: 120 }, (_, index) => `word${String(index)}`);
    const excerpt = excerptOf(words.join(' '));
    expect(excerpt).not.toBeNull();
    expect((excerpt ?? '').length).toBeLessThanOrEqual(EXCERPT + 1);
    expect(excerpt?.endsWith('…')).toBe(true);
    const kept = (excerpt ?? '').slice(0, -1).split(' ');
    expect(kept).toEqual(words.slice(0, kept.length));
  });

  it('cuts text without spaces at the limit rather than not at all', () => {
    expect(excerptOf('ا'.repeat(EXCERPT + 50))).toBe(`${'ا'.repeat(EXCERPT)}…`);
  });

  it('says nothing for an absent or blank text', () => {
    expect(excerptOf(null)).toBeNull();
    expect(excerptOf('   \n\n  ')).toBeNull();
  });
});
