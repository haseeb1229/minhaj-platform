import { describe, expect, it } from 'vitest';

import {
  PUBLISHED_RECORDS_PAGE,
  TOPIC_RESEARCH_PAGE,
  publishedRecordsQuerySchema,
  topicResearchQuerySchema,
} from '@minhaj/contracts/library';

import {
  DEFAULT_RESEARCH_QUERY,
  EXCERPT,
  LIBRARY_ENCYCLOPEDIAS,
  LIBRARY_PUBLICATIONS,
  LIBRARY_RESEARCH,
  LIBRARY_RESEARCH_PAPERS,
  RESEARCH_MAX_PAGE,
  byDecade,
  decadeOf,
  excerptOf,
  libraryRecordsReadQuery,
  readResearchQuery,
  researchCanonicalRedirect,
  researchFiltered,
  researchHref,
  researchPageCount,
  researchRange,
  researchReadQuery,
} from '../../apps/web/src/components/topic-hub/research-view.ts';
import { QURAN_RESEARCH as QURAN } from '../../apps/web/src/components/quran/hubs.ts';
import { HADITH_RESEARCH as HADITH } from '../../apps/web/src/components/hadith/hubs.ts';

/**
 * Quran Part 12 and Hadith Part 1 — a Research hub's address rules (the
 * Quran's scope and Hadith's): the view a URL
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
        topicResearchQuerySchema.safeParse(
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
    expect(researchHref(QURAN, 'en', DEFAULT_RESEARCH_QUERY)).toBe('/quran/research');
    expect(researchHref(QURAN, 'ur', DEFAULT_RESEARCH_QUERY)).toBe('/ur/quran/research');
    expect(researchHref(QURAN, 'ar', DEFAULT_RESEARCH_QUERY)).toBe('/ar/quran/research');
  });

  it('writes every narrowing value in one fixed order, and the page last', () => {
    expect(researchHref(QURAN, 'en', view)).toBe(
      `/quran/research?kind=paper&language=ur&contributor=${PERSON}&decade=2010&fulltext=1&sort=title&page=4`,
    );
  });

  it('returns to the first page whenever anything but the page changes', () => {
    expect(researchHref(QURAN, 'en', view, { decade: null })).toBe(
      `/quran/research?kind=paper&language=ur&contributor=${PERSON}&fulltext=1&sort=title`,
    );
    expect(researchHref(QURAN, 'en', view, { kind: 'all', fullText: false })).toBe(
      `/quran/research?language=ur&contributor=${PERSON}&decade=2010&sort=title`,
    );
    expect(researchHref(QURAN, 'en', view, { page: 5 })).toContain('&page=5');
    expect(researchHref(QURAN, 'en', view, { page: 1 })).not.toContain('page=');
  });

  it('round-trips: the address it builds reads back as the same view', () => {
    const href = researchHref(QURAN, 'en', view);
    const params = Object.fromEntries(new URL(href, 'https://x.invalid').searchParams);
    expect(readResearchQuery(params)).toEqual(view);
  });
});

describe('researchCanonicalRedirect', () => {
  it('leaves a canonical address, and the bare hub, alone', () => {
    expect(researchCanonicalRedirect(QURAN, 'en', {})).toBeNull();
    expect(
      researchCanonicalRedirect(QURAN, 'ur', {
        kind: 'research',
        decade: '1990',
        page: '2',
      }),
    ).toBeNull();
    // A parameter the hub does not read — the former related view's offset
    // among them — is not its business.
    expect(researchCanonicalRedirect(QURAN, 'en', { utm_source: 'x' })).toBeNull();
    expect(researchCanonicalRedirect(QURAN, 'en', { offset: '25' })).toBeNull();
  });

  it('sends what a filter form submits — every control, empty ones included — to one address', () => {
    expect(
      researchCanonicalRedirect(QURAN, 'en', {
        language: '',
        contributor: PERSON,
        decade: '',
        fulltext: '',
        sort: 'newest',
      }),
    ).toBe(`/quran/research?contributor=${PERSON}`);
    expect(
      researchCanonicalRedirect(QURAN, 'ar', {
        kind: 'paper',
        fulltext: '1',
        sort: 'newest',
      }),
    ).toBe('/ar/quran/research?kind=paper&fulltext=1');
  });

  it('sends another order, a malformed or repeated value to the parsed view', () => {
    expect(researchCanonicalRedirect(QURAN, 'en', { sort: 'title', kind: 'paper' })).toBe(
      '/quran/research?kind=paper&sort=title',
    );
    expect(
      researchCanonicalRedirect(QURAN, 'en', {
        decade: '1995',
        page: '-1',
        kind: 'drafts',
      }),
    ).toBe('/quran/research');
    expect(researchCanonicalRedirect(QURAN, 'en', { language: ['ur', 'en'] })).toBe(
      '/quran/research',
    );
    expect(researchCanonicalRedirect(QURAN, 'en', { page: '1' })).toBe('/quran/research');
    // The contract's spelling of a kind is not the address's.
    expect(researchCanonicalRedirect(QURAN, 'en', { kind: 'research-paper' })).toBe(
      '/quran/research',
    );
    // Built from the parsed view, never from the typed text.
    expect(
      researchCanonicalRedirect(QURAN, 'en', { language: 'https://evil.example/' }),
    ).toBe('/quran/research');
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
    const href = researchHref(QURAN, 'en', view);
    const params = Object.fromEntries(new URL(href, 'https://x.invalid').searchParams);
    expect(researchCanonicalRedirect(QURAN, 'en', params)).toBeNull();
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
      offset: 2 * TOPIC_RESEARCH_PAGE,
      limit: TOPIC_RESEARCH_PAGE,
    });
    expect(researchReadQuery(DEFAULT_RESEARCH_QUERY, null, 'en').topic).toBeNull();
  });

  it('counts pages and states the range a page shows', () => {
    expect(researchPageCount(0)).toBe(1);
    expect(researchPageCount(TOPIC_RESEARCH_PAGE)).toBe(1);
    expect(researchPageCount(TOPIC_RESEARCH_PAGE + 1)).toBe(2);
    expect(researchRange(1, 0)).toBeNull();
    expect(researchRange(2, 3)).toEqual({
      from: TOPIC_RESEARCH_PAGE + 1,
      to: TOPIC_RESEARCH_PAGE + 3,
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

describe('the Hadith Research hub’s address', () => {
  it('is its own, in every locale, under the same rules', () => {
    expect(researchHref(HADITH, 'en', DEFAULT_RESEARCH_QUERY)).toBe('/hadith/research');
    expect(researchHref(HADITH, 'ur', DEFAULT_RESEARCH_QUERY)).toBe(
      '/ur/hadith/research',
    );
    expect(researchCanonicalRedirect(HADITH, 'en', {})).toBeNull();
    expect(researchCanonicalRedirect(HADITH, 'ar', { kind: 'paper', language: '' })).toBe(
      '/ar/hadith/research?kind=paper',
    );
  });
});

/* ===========================================================================
 * Library Part 3 — the whole Library's listings of one kind
 * ========================================================================= */

describe('the whole Library’s listings of one kind', () => {
  it('fixes the kind by the address, reads the Topic, and keeps every hub default', () => {
    expect(readResearchQuery({}, LIBRARY_RESEARCH)).toEqual({
      ...DEFAULT_RESEARCH_QUERY,
      kind: 'research',
      topic: null,
    });
    expect(readResearchQuery({ kind: 'research' }, LIBRARY_RESEARCH_PAPERS).kind).toBe(
      'research-paper',
    );
    // A published kind is not a research kind: the view's kind stays neutral.
    expect(readResearchQuery({}, LIBRARY_PUBLICATIONS).kind).toBe('all');
    expect(
      readResearchQuery({ topic: TOPIC.toUpperCase() }, LIBRARY_ENCYCLOPEDIAS).topic,
    ).toBe(TOPIC);
    expect(readResearchQuery({ topic: 'quran' }, LIBRARY_RESEARCH).topic).toBeNull();
    // A hub never reads a Topic of its own from the address.
    expect(readResearchQuery({ topic: TOPIC })).not.toHaveProperty('topic');
  });

  it('is unfiltered with nothing but its own kind, and filtered by a Topic', () => {
    const view = readResearchQuery({}, LIBRARY_RESEARCH_PAPERS);
    expect(researchFiltered(view, LIBRARY_RESEARCH_PAPERS)).toBe(false);
    expect(
      researchFiltered(
        readResearchQuery({ topic: TOPIC }, LIBRARY_RESEARCH),
        LIBRARY_RESEARCH,
      ),
    ).toBe(true);
  });

  it('never spells the kind, spells the Topic first, and has one bare address', () => {
    const view = readResearchQuery(
      {
        topic: TOPIC,
        language: 'ur',
        decade: '1990',
        fulltext: '1',
        sort: 'title',
        page: '2',
      },
      LIBRARY_RESEARCH,
    );
    expect(researchHref(LIBRARY_RESEARCH, 'en', view)).toBe(
      `/library/research?topic=${TOPIC}&language=ur&decade=1990&fulltext=1&sort=title&page=2`,
    );
    expect(
      researchHref(LIBRARY_RESEARCH, 'ur', readResearchQuery({}, LIBRARY_RESEARCH)),
    ).toBe('/ur/library/research');
    // The way between the two research listings keeps every filter but the page.
    expect(
      researchHref(
        LIBRARY_RESEARCH_PAPERS,
        'en',
        { ...view, kind: 'research-paper' },
        { page: 1 },
      ),
    ).toBe(
      `/library/research-papers?topic=${TOPIC}&language=ur&decade=1990&fulltext=1&sort=title`,
    );
  });

  it('answers the former Phase-9 parameters with one redirect', () => {
    // `?offset=` (25 a page) is the page holding the record it began with.
    expect(researchCanonicalRedirect(LIBRARY_RESEARCH, 'en', { offset: '25' })).toBe(
      '/library/research?page=2',
    );
    expect(researchCanonicalRedirect(LIBRARY_PUBLICATIONS, 'en', { offset: '48' })).toBe(
      '/library/publications?page=3',
    );
    expect(researchCanonicalRedirect(LIBRARY_RESEARCH, 'en', { offset: '0' })).toBe(
      '/library/research',
    );
    // A year range is no longer read: dropped, never guessed.
    expect(
      researchCanonicalRedirect(LIBRARY_RESEARCH_PAPERS, 'ar', {
        language: 'ar',
        from: '1990',
        to: '1999',
      }),
    ).toBe('/ar/library/research-papers?language=ar');
    // A form's empty controls; a hub's `kind` is not this listing's business.
    expect(
      researchCanonicalRedirect(LIBRARY_ENCYCLOPEDIAS, 'en', {
        topic: '',
        language: '',
        sort: 'newest',
      }),
    ).toBe('/library/encyclopedias');
    expect(
      researchCanonicalRedirect(LIBRARY_RESEARCH, 'en', { kind: 'paper' }),
    ).toBeNull();
    expect(
      researchCanonicalRedirect(LIBRARY_RESEARCH, 'en', { topic: TOPIC }),
    ).toBeNull();
    expect(
      researchCanonicalRedirect(LIBRARY_RESEARCH, 'en', { topic: TOPIC.toUpperCase() }),
    ).toBe(`/library/research?topic=${TOPIC}`);
  });

  it('asks Library for the scope’s kind, and never past its offset bound', () => {
    const deepest = String(Math.floor(25_000 / PUBLISHED_RECORDS_PAGE) + 1);
    const research = libraryRecordsReadQuery(
      { path: '/library/research', kind: 'research' },
      readResearchQuery({ topic: TOPIC, page: '3' }, LIBRARY_RESEARCH),
      'ur',
    );
    expect(research).toEqual({
      scope: 'library',
      kind: 'research',
      topic: TOPIC,
      language: null,
      contributor: null,
      decade: null,
      fullText: false,
      sort: 'newest',
      titleLocale: 'ur',
      offset: 2 * TOPIC_RESEARCH_PAGE,
      limit: TOPIC_RESEARCH_PAGE,
    });
    expect(topicResearchQuerySchema.safeParse(research).success).toBe(true);
    for (const page of [deepest, String(Number(deepest) + 1), '99999']) {
      const read = libraryRecordsReadQuery(
        { path: '/library/publications', kind: 'publication' },
        readResearchQuery({ page }, LIBRARY_PUBLICATIONS),
        'en',
      );
      expect(publishedRecordsQuerySchema.safeParse(read).success, page).toBe(true);
    }
    expect(researchPageCount(25, LIBRARY_PUBLICATIONS)).toBe(2);
    expect(researchRange(2, 1, LIBRARY_ENCYCLOPEDIAS)).toEqual({ from: 25, to: 25 });
  });
});
