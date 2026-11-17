import { describe, expect, it } from 'vitest';

import {
  AUTHORS_PAGE,
  DEFAULT_AUTHORS_VIEW,
  DEFAULT_DOWNLOADS_VIEW,
  DEFAULT_SALE_POINTS_VIEW,
  authorsCanonicalRedirect,
  authorsHref,
  bareRedirect,
  downloadsCanonicalRedirect,
  downloadsHref,
  fileFormat,
  fileSize,
  kindHref,
  readAuthorsView,
  readDownloadsView,
  readSalePointsView,
  resourcesRedirect,
  salePointsCanonicalRedirect,
  salePointsHref,
} from '../../apps/web/src/components/library/browse-view.ts';
// Shared with Watch Part 2's speakers since then: one rule for both directories.
import {
  foldName,
  initialOf,
  nameMatches,
} from '../../apps/web/src/components/topic-hub/address.ts';

/**
 * Library Part 2 — the browse and access pages' address rules: the view a
 * URL names, the address each control and link builds, one address per view,
 * and the pure presentation decisions (initials, name search, file facts).
 * Tolerant of anything a visitor or a crawler types; never widening.
 */

const TOPIC = '0f1e2d3c-4b5a-4968-8776-655443322110';
const PERSON = '5b0e1d2c-3f4a-4b5c-8d6e-7f8091a2b3c4';

describe('kindHref — one spelling of every kind’s filtered listing', () => {
  it('leads books to the books listing and every other kind to its own', () => {
    expect(kindHref('en', 'work', { topic: TOPIC })).toBe(
      `/library/books?topic=${TOPIC}`,
    );
    expect(kindHref('ur', 'work', { language: 'ar' })).toBe(
      '/ur/library/books?language=ar',
    );
    expect(kindHref('en', 'research', { topic: TOPIC })).toBe(
      `/library/research?topic=${TOPIC}`,
    );
    expect(kindHref('ar', 'research-paper', { language: 'ur' })).toBe(
      '/ar/library/research-papers?language=ur',
    );
    expect(kindHref('en', 'publication', {})).toBe('/library/publications');
    // A Topic as Taxonomy stores it is spelled as the canonical address does.
    expect(kindHref('en', 'work', { topic: TOPIC.toUpperCase() })).toBe(
      `/library/books?topic=${TOPIC}`,
    );
    expect(kindHref('en', 'publication', { topic: TOPIC.toUpperCase() })).toBe(
      `/library/publications?topic=${TOPIC}`,
    );
    expect(kindHref('en', 'encyclopedia', { language: 'en' })).toBe(
      '/library/encyclopedias?language=en',
    );
    expect(kindHref('en', 'magazine', { topic: TOPIC })).toBe(
      `/library/magazines?topic=${TOPIC}`,
    );
  });
});

describe('resourcesRedirect — the directory is one view', () => {
  it('answers the bare directory in place', () => {
    expect(resourcesRedirect('en', {})).toBeNull();
    // A parameter the page does not read is left alone.
    expect(resourcesRedirect('en', { utm_source: 'x' })).toBeNull();
  });

  it('sends a typed view to that kind’s own listing, with the filters it takes', () => {
    expect(
      resourcesRedirect('en', {
        type: 'books',
        topic: TOPIC,
        language: 'ur',
        contributor: PERSON,
        from: '1990',
        to: '2000',
      }),
    ).toBe(
      `/library/books?topic=${TOPIC}&language=ur&contributor=${PERSON}&from=1990&to=2000`,
    );
    expect(
      resourcesRedirect('ur', { type: 'research', language: 'ar', from: '2001' }),
    ).toBe('/ur/library/research?language=ar');
    // Library Part 3: the written works take a decade, not a year range — a
    // range that is exactly one decade is kept as it, any other dropped —
    // and a contributor, as the books do. A Magazine takes a Topic alone.
    expect(
      resourcesRedirect('en', { type: 'research-papers', from: '1990', to: '1999' }),
    ).toBe('/library/research-papers?decade=1990');
    expect(
      resourcesRedirect('en', { type: 'research-papers', from: '1990', to: '2000' }),
    ).toBe('/library/research-papers');
    expect(resourcesRedirect('en', { type: 'research', contributor: PERSON })).toBe(
      `/library/research?contributor=${PERSON}`,
    );
    expect(
      resourcesRedirect('en', {
        type: 'magazines',
        topic: TOPIC,
        language: 'ur',
        from: '1',
      }),
    ).toBe(`/library/magazines?topic=${TOPIC}`);
    expect(resourcesRedirect('en', { type: 'articles', topic: TOPIC })).toBe(
      '/library/articles',
    );
  });

  it('drops an inverted range for a scholarly kind and a malformed filter everywhere', () => {
    expect(
      resourcesRedirect('en', { type: 'publications', from: '2005', to: '2001' }),
    ).toBe('/library/publications');
    expect(
      resourcesRedirect('en', { type: 'encyclopedias', topic: 'nope', language: '<x>' }),
    ).toBe('/library/encyclopedias');
  });

  it('answers an unknown or repeated type with the bare directory', () => {
    expect(resourcesRedirect('en', { type: 'videos' })).toBe('/library/resources');
    expect(resourcesRedirect('ar', { type: ['books', 'research'] })).toBe(
      '/ar/library/resources',
    );
    expect(resourcesRedirect('en', { topic: TOPIC })).toBe('/library/resources');
  });
});

describe('bareRedirect — the Topic and language browses take no parameter', () => {
  it('redirects a former offset once, and nothing else', () => {
    expect(bareRedirect('en', '/library/topics', {})).toBeNull();
    expect(bareRedirect('en', '/library/topics', { offset: '50' })).toBe(
      '/library/topics',
    );
    expect(bareRedirect('ur', '/library/languages', { offset: 'x' })).toBe(
      '/ur/library/languages',
    );
    expect(bareRedirect('en', '/library/languages', { utm_source: 'x' })).toBeNull();
  });
});

describe('the contributor directory’s address', () => {
  it('reads the neutral view from an empty address', () => {
    expect(readAuthorsView({}, 'en')).toEqual(DEFAULT_AUTHORS_VIEW);
  });

  it('reads a letter, a role, a name and a page', () => {
    expect(
      readAuthorsView(
        { letter: 'a', role: 'translator', q: '  Tahir   ul ', page: '3' },
        'en',
      ),
    ).toEqual({ letter: 'A', role: 'translator', q: 'Tahir ul', page: 3 });
    expect(readAuthorsView({ letter: 'م' }, 'ur').letter).toBe('م');
    expect(readAuthorsView({ letter: '#' }, 'en').letter).toBe('#');
  });

  it('drops what it cannot read, and never widens', () => {
    expect(
      readAuthorsView(
        {
          letter: 'ab',
          role: 'publisher',
          q: 'x'.repeat(61),
          page: '0',
        },
        'en',
      ),
    ).toEqual(DEFAULT_AUTHORS_VIEW);
    expect(readAuthorsView({ letter: '7' }, 'en').letter).toBeNull();
    expect(readAuthorsView({ role: ['author', 'editor'] }, 'en').role).toBeNull();
    expect(readAuthorsView({ q: '   ' }, 'en').q).toBeNull();
  });

  it('spells every view one way, neutral values omitted', () => {
    expect(authorsHref('en', DEFAULT_AUTHORS_VIEW)).toBe('/library/authors');
    expect(
      authorsHref('ur', { letter: 'A', role: 'author', q: 'Tahir ul', page: 2 }),
    ).toBe('/ur/library/authors?letter=A&role=author&q=Tahir+ul&page=2');
    expect(authorsHref('en', DEFAULT_AUTHORS_VIEW, { page: 1 })).toBe('/library/authors');
  });

  it('is one redirect from any other spelling, and none from the canonical one', () => {
    expect(authorsCanonicalRedirect('en', {})).toBeNull();
    expect(authorsCanonicalRedirect('en', { role: 'author', letter: 'A' })).toBe(
      '/library/authors?letter=A&role=author',
    );
    expect(authorsCanonicalRedirect('en', { letter: 'A', role: 'author' })).toBeNull();
    expect(authorsCanonicalRedirect('en', { q: '', role: '' })).toBe('/library/authors');
    expect(authorsCanonicalRedirect('en', { letter: 'a' })).toBe(
      '/library/authors?letter=A',
    );
    expect(authorsCanonicalRedirect('en', { page: '1' })).toBe('/library/authors');
    // The former facet pager (50 by count) has no place in an A–Z directory.
    expect(authorsCanonicalRedirect('ar', { offset: '50' })).toBe('/ar/library/authors');
  });

  it('pages the directory by its own size', () => {
    expect(AUTHORS_PAGE).toBe(48);
  });
});

describe('names: the index letter and the search', () => {
  it('indexes a name by its first letter, upper case, else by #', () => {
    expect(initialOf('tahir', 'en')).toBe('T');
    expect(initialOf('  Ṭāhir', 'en')).toBe('Ṭ');
    expect(initialOf('محمد طاہر', 'ur')).toBe('م');
    expect(initialOf('1st author', 'en')).toBe('#');
    expect(initialOf('', 'en')).toBe('#');
  });

  it('ignores accents, vowel signs, the tatweel, case and spacing', () => {
    expect(foldName('Ṭāhir  ul-Qādrī')).toBe('tahir ul-qadri');
    expect(foldName('مُحَمَّد')).toBe('محمد');
    expect(foldName('مـحـمد')).toBe('محمد');
  });

  it('matches when every word of the search is in the name', () => {
    expect(nameMatches('Muhammad Ṭāhir-ul-Qādrī', 'tahir qadri')).toBe(true);
    expect(nameMatches('مُحَمَّد طاہر', 'محمد')).toBe(true);
    expect(nameMatches('Muhammad Tahir', 'tahir ahmad')).toBe(false);
  });
});

describe('the downloads listing’s address', () => {
  it('reads every parameter it knows, and drops the rest', () => {
    expect(readDownloadsView({})).toEqual(DEFAULT_DOWNLOADS_VIEW);
    expect(
      readDownloadsView({
        language: 'ur',
        topic: TOPIC.toUpperCase(),
        sort: 'newest',
        page: '2',
      }),
    ).toEqual({ language: 'ur', topic: TOPIC, sort: 'newest', page: 2 });
    expect(
      readDownloadsView({ language: '<script>', topic: 'x', sort: 'price', page: '-1' }),
    ).toEqual(DEFAULT_DOWNLOADS_VIEW);
  });

  it('spells each view once, and redirects every other spelling once', () => {
    expect(downloadsHref('en', DEFAULT_DOWNLOADS_VIEW)).toBe('/library/downloads');
    expect(
      downloadsHref('ar', { language: 'ur', topic: TOPIC, sort: 'newest', page: 3 }),
    ).toBe(`/ar/library/downloads?language=ur&topic=${TOPIC}&sort=newest&page=3`);
    expect(downloadsCanonicalRedirect('en', {})).toBeNull();
    expect(downloadsCanonicalRedirect('en', { sort: 'title', language: '' })).toBe(
      '/library/downloads',
    );
    expect(downloadsCanonicalRedirect('en', { sort: 'newest', language: 'ur' })).toBe(
      '/library/downloads?language=ur&sort=newest',
    );
    // A former offset paged Works; no page of Editions corresponds.
    expect(downloadsCanonicalRedirect('en', { offset: '25' })).toBe('/library/downloads');
  });

  it('names a file’s format and size for a reader', () => {
    expect(fileFormat('application/pdf')).toBe('PDF');
    expect(fileFormat('application/epub+zip')).toBe('EPUB');
    expect(fileSize(2_400_000, 'en')).toBe('2.4 MB');
    expect(fileSize(830_000, 'en')).toBe('830 kB');
    expect(fileSize(512, 'en')).toBe('512 byte');
  });
});

describe('the sale-point directory’s address', () => {
  it('reads a search and a page, collapsing whitespace', () => {
    expect(readSalePointsView({})).toEqual(DEFAULT_SALE_POINTS_VIEW);
    expect(readSalePointsView({ q: '  Lahore   Model Town ', page: '2' })).toEqual({
      q: 'Lahore Model Town',
      page: 2,
    });
    expect(readSalePointsView({ q: 'x'.repeat(81) }).q).toBeNull();
  });

  it('turns a former offset into the page holding its first sale point', () => {
    expect(readSalePointsView({ offset: '25' }).page).toBe(2);
    expect(readSalePointsView({ offset: '0' }).page).toBe(1);
    expect(salePointsCanonicalRedirect('en', { offset: '50' })).toBe(
      '/library/sale-points?page=3',
    );
    expect(salePointsCanonicalRedirect('en', { offset: '0' })).toBe(
      '/library/sale-points',
    );
  });

  it('spells each view once', () => {
    expect(salePointsHref('ur', { q: 'Lahore', page: 2 })).toBe(
      '/ur/library/sale-points?q=Lahore&page=2',
    );
    expect(salePointsCanonicalRedirect('en', { q: 'Lahore' })).toBeNull();
    expect(salePointsCanonicalRedirect('en', { q: ' Lahore ' })).toBe(
      '/library/sale-points?q=Lahore',
    );
    expect(salePointsCanonicalRedirect('en', { q: '' })).toBe('/library/sale-points');
  });
});
