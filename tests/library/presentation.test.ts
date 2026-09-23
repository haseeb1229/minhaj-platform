import { describe, expect, it } from 'vitest';

import type {
  EditionRecord,
  WorkRecord,
} from '../../packages/contracts/src/library/index.ts';
import {
  assetPath,
  bibliography,
  booksPath,
  canClaimBook,
  editionAccess,
  labelFor,
  readLibraryQuery,
  selectEdition,
  workPath,
} from '../../apps/web/src/components/library/presentation.ts';

/**
 * Phase 8 — the Library presentation decisions, as pure functions.
 *
 * These are the parts of Library presentation that can be wrong in a way markup
 * does not show: which language a title is rendered from, which Edition an address
 * selects, what a visitor may do with an Edition, and when a `Book` claim may be
 * made. Every fixture is synthetic and unmistakably non-authoritative.
 */

const WORK: WorkRecord = {
  id: '00000000-0000-4000-8000-000000000801',
  slug: 'synthetic-proof-work',
  primaryLocale: 'ar',
  state: 'published',
  isFeatured: false,
  version: 1,
  updatedAt: new Date('2035-01-01T00:00:00Z'),
  labels: [
    { locale: 'ar', title: 'عمل تجريبي', description: '' },
    { locale: 'en', title: 'Synthetic proof work', description: 'Non-authoritative.' },
  ],
  contributors: [],
  topicIds: [],
  salePointIds: [],
};

function edition(overrides: Partial<EditionRecord>): EditionRecord {
  return {
    id: '00000000-0000-4000-8000-0000000008a1',
    workId: WORK.id,
    label: 'Synthetic edition',
    languageCode: 'ar',
    state: 'published',
    publisher: null,
    publicationYear: null,
    isbn: null,
    pageCount: null,
    reading: 'unavailable',
    download: 'denied',
    readableAssetId: null,
    downloadAssetId: null,
    document: null,
    contentVersion: null,
    version: 1,
    updatedAt: new Date('2035-01-01T00:00:00Z'),
    translation: null,
    ...overrides,
  };
}

const DOCUMENT = {
  sections: [{ key: 'opening', title: 'Opening', paragraphs: ['Synthetic text.'] }],
};

describe('localized descriptive metadata is presentation, never translation', () => {
  it('renders the requested locale when a label exists in it', () => {
    expect(labelFor(WORK, 'en')).toMatchObject({
      locale: 'en',
      title: 'Synthetic proof work',
    });
  });

  it('falls back to the primary locale and REPORTS which language it rendered', () => {
    // An Urdu interface over a Work described in Arabic and English gets the
    // Arabic label — and the caller is told it is Arabic, so it can mark `lang`.
    expect(labelFor(WORK, 'ur')).toMatchObject({ locale: 'ar', title: 'عمل تجريبي' });
  });

  it('never implies an Edition exists in the label language', () => {
    // The English LABEL exists; no English EDITION does. The selector must not
    // invent one to match the label.
    const arabic = edition({ languageCode: 'ar' });
    expect(selectEdition([arabic], 'en', WORK.primaryLocale, null)?.languageCode).toBe(
      'ar',
    );
  });
});

describe('Edition selection is deterministic and a selection is never an authority', () => {
  const urdu = edition({
    id: '00000000-0000-4000-8000-0000000008b1',
    languageCode: 'ur-PK',
  });
  const arabic = edition({
    id: '00000000-0000-4000-8000-0000000008b2',
    languageCode: 'ar',
  });
  const english = edition({
    id: '00000000-0000-4000-8000-0000000008b3',
    languageCode: 'en',
  });

  it('honours an explicit selection of a visible Edition', () => {
    expect(selectEdition([urdu, arabic, english], 'en', 'ar', arabic.id)).toBe(arabic);
  });

  it('ignores an identifier that names no visible Edition', () => {
    // A draft Edition is absent from the public list, so naming it by URL selects
    // the default rather than bringing it into view.
    const hidden = '00000000-0000-4000-8000-0000000008ff';
    expect(selectEdition([urdu, arabic, english], 'en', 'ar', hidden)).toBe(english);
  });

  it('prefers the interface language by subtag, then the primary, then the first', () => {
    expect(selectEdition([arabic, urdu], 'ur', 'ar', null)).toBe(urdu);
    expect(selectEdition([urdu, arabic], 'en', 'ar', null)).toBe(arabic);
    expect(selectEdition([urdu], 'en', 'ar', null)).toBe(urdu);
    expect(selectEdition([], 'en', 'ar', null)).toBeNull();
  });

  it('returns the same Edition for the same address on every call', () => {
    const first = selectEdition([urdu, arabic, english], 'ar', 'ar', null);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(selectEdition([urdu, arabic, english], 'ar', 'ar', null)).toBe(first);
    }
  });
});

describe('reading and downloading are distinct decisions', () => {
  it('reflowable text is read in the reader, and no file stands in for it', () => {
    const access = editionAccess(
      edition({
        reading: 'allowed',
        document: DOCUMENT,
        contentVersion: 'a'.repeat(64),
        readableAssetId: '00000000-0000-4000-8000-0000000008c1',
      }),
    );
    expect(access).toEqual({
      reflowable: true,
      readableFile: null,
      downloadable: null,
      unavailable: false,
    });
  });

  it('readable online does not imply downloadable', () => {
    const access = editionAccess(
      edition({ reading: 'allowed', document: DOCUMENT, contentVersion: 'a'.repeat(64) }),
    );
    expect(access.downloadable).toBeNull();
  });

  it('a file existing grants nothing without the decision', () => {
    const access = editionAccess(
      edition({
        reading: 'unavailable',
        download: 'denied',
        readableAssetId: '00000000-0000-4000-8000-0000000008c2',
        downloadAssetId: '00000000-0000-4000-8000-0000000008c3',
      }),
    );
    expect(access).toEqual({
      reflowable: false,
      readableFile: null,
      downloadable: null,
      unavailable: true,
    });
  });

  it('a rights-restricted edition is explicitly unavailable, not blank', () => {
    expect(editionAccess(edition({})).unavailable).toBe(true);
  });

  it('a download-only edition is still reported as not readable here', () => {
    const access = editionAccess(
      edition({
        download: 'allowed',
        downloadAssetId: '00000000-0000-4000-8000-0000000008c4',
      }),
    );
    expect(access.downloadable).toBe('00000000-0000-4000-8000-0000000008c4');
    expect(access.unavailable).toBe(true);
  });
});

describe('bibliographic facts and structured data are never fabricated', () => {
  it('omits absent facts rather than rendering empty rows', () => {
    expect(bibliography(edition({}))).toEqual([]);
    expect(
      bibliography(edition({ publisher: 'Synthetic Press', pageCount: 12 })).map(
        (row) => row.key,
      ),
    ).toEqual(['publisher', 'pageCount']);
  });

  it('claims a Book only with BOTH a genuine ISBN and an author', () => {
    const author = {
      ...WORK,
      contributors: [{ personId: WORK.id, role: 'author' as const }],
    };
    const translatorOnly = {
      ...WORK,
      contributors: [{ personId: WORK.id, role: 'translator' as const }],
    };
    const withIsbn = edition({ isbn: '9780306406157' });

    expect(canClaimBook(author, withIsbn)).toBe(true);
    expect(canClaimBook(author, edition({}))).toBe(false);
    expect(canClaimBook(translatorOnly, withIsbn)).toBe(false);
    expect(canClaimBook(author, null)).toBe(false);
  });
});

describe('addresses', () => {
  it('builds one canonical Work URL, locale preserved', () => {
    expect(workPath('ur', 'synthetic-proof-work')).toBe(
      '/ur/library/books/synthetic-proof-work',
    );
  });

  it('serves bytes unprefixed, naming the Edition, the purpose and the asset', () => {
    expect(
      assetPath(
        '00000000-0000-4000-8000-0000000008a1',
        'download',
        '00000000-0000-4000-8000-0000000008c1',
      ),
    ).toBe(
      '/assets/library/editions/00000000-0000-4000-8000-0000000008a1/download/00000000-0000-4000-8000-0000000008c1',
    );
  });
});

describe('a URL is not a form: the listing query is tolerant, never trusting', () => {
  it('turns garbage into the unfiltered listing instead of an error', () => {
    expect(
      readLibraryQuery({
        offset: '-4',
        from: 'banana',
        topic: 'not-a-uuid',
        contributor: "'; DROP TABLE Work;--",
        downloads: 'yes',
      }),
    ).toEqual({
      offset: 0,
      language: null,
      topic: null,
      contributor: null,
      from: null,
      to: null,
      downloads: false,
    });
  });

  it('discards a repeated parameter rather than choosing one', () => {
    expect(readLibraryQuery({ topic: ['a', 'b'] }).topic).toBeNull();
  });

  it('normalises an inverted year range instead of throwing', () => {
    expect(readLibraryQuery({ from: '2000', to: '1990' })).toMatchObject({
      from: null,
      to: null,
    });
  });

  it('keeps the unfiltered listing at exactly one address', () => {
    const base = readLibraryQuery({});
    expect(booksPath('en', base)).toBe('/en/library/books');
    expect(booksPath('en', base, { language: 'ur', offset: 25 })).toBe(
      '/en/library/books?offset=25&language=ur',
    );
  });
});
