import { describe, expect, it } from 'vitest';

import {
  MIGRATION_LIMITS,
  STAGED_PAYLOAD_SCHEMAS,
  SURAH_AYAH_COUNTS,
  type ParsedEditorial,
  type ParsedFatwa,
  type ParsedMagazine,
  type ParsedMagazineIssue,
  type ParsedQuranTranslation,
  type ParsedRecord,
  type ParsedVideo,
  type ParsedWork,
} from '../../packages/contracts/src/migration/index.ts';
import {
  normalIsbn,
  normaliseRecord,
  recordHrefs,
  type Normalisation,
} from '../../apps/web/src/contexts/migration-provenance/domain/kinds.ts';
import { REDACTED } from '../../apps/web/src/contexts/migration-provenance/domain/normalize.ts';

/**
 * ONE NORMALISER PER KIND (MIGRATION_STRATEGY.md §4.6–§4.7).
 *
 * Each kind maps its fields, raises its issue codes, never invents a value
 * (a missing one is an issue or `null`, never a default from elsewhere),
 * redacts and flags incidental personal data, and its payload passes the
 * contract's strict schema whenever no issue was raised.
 */

const NOW = new Date('2026-10-20T00:00:00Z');
const EXTERNAL_KEY = 'https://library.fixture.invalid/items/17';

const COMMON = {
  primaryLocale: 'en',
  languageCode: 'en',
  publishedOn: null,
  legacyIdentifier: null,
  categories: [],
  links: [],
  assets: [],
} as const;

function normalise(
  parsed: ParsedRecord,
  options: {
    readonly defaultLanguageCode?: string | null;
    readonly legacyIdentifier?: string | null;
    readonly rewrite?: (href: string) => string | null;
  } = {},
): Normalisation {
  return normaliseRecord({
    parsed,
    defaultLanguageCode: options.defaultLanguageCode ?? null,
    legacyIdentifier: options.legacyIdentifier ?? null,
    externalKey: EXTERNAL_KEY,
    rewrite: options.rewrite ?? ((href) => href),
    now: NOW,
  });
}

/** Every normalisation the suite makes, to prove the schema invariant over all of them. */
const seen: Normalisation[] = [];
function run(parsed: ParsedRecord, options?: Parameters<typeof normalise>[1]) {
  const result = normalise(parsed, options);
  seen.push(result);
  return result;
}

const payloadOf = <T>(result: Normalisation) => result.payload as unknown as T;

/* ===========================================================================
 * library.work
 * ========================================================================= */

const WORK: ParsedWork = Object.freeze({
  ...COMMON,
  kind: 'library.work',
  title: '  Islam in   Dialogue ',
  languageCode: 'ur',
  legacyIdentifier: 'book-17',
  descriptionHtml: '<p>About <b>the</b> book.<script>x()</script></p>',
  edition: {
    label: ' First  edition ',
    publisher: 'Minhaj-ul-Quran Publications',
    publicationYear: '2005',
    isbn: '978-0-306-40615-7',
    pageCount: ' 320 ',
    readableAssetUrl: 'https://library.fixture.invalid/read/17.pdf#page=2',
    downloadAssetUrl: null,
  },
});

const work = (
  overrides: Partial<ParsedWork> = {},
  edition: Partial<ParsedWork['edition']> = {},
) => run({ ...WORK, ...overrides, edition: { ...WORK.edition, ...edition } });

describe('library.work', () => {
  it('maps every field, sanitised and exact', () => {
    const result = work();
    expect(result.issues).toEqual([]);
    expect(result.kind).toBe('library.work');
    expect(result.payload).toEqual({
      kind: 'library.work',
      slug: 'book-17',
      primaryLocale: 'en',
      languageCode: 'ur',
      labels: [
        { locale: 'en', title: 'Islam in Dialogue', description: 'About the book.' },
      ],
      legacyIdentifier: 'book-17',
      edition: {
        label: 'First edition',
        publisher: 'Minhaj-ul-Quran Publications',
        publicationYear: 2005,
        isbn: '9780306406157',
        pageCount: 320,
        readableAssetUrl: 'https://library.fixture.invalid/read/17.pdf',
        downloadAssetUrl: null,
      },
    });
    expect(result).toMatchObject({
      title: 'Islam in Dialogue',
      languageCode: 'ur',
      personalData: false,
      // An ISBN only ever ASKS a person — never collapses a record.
      identity: { key: 'isbn:9780306406157', signal: 'identifier', hard: false },
    });
    expect(STAGED_PAYLOAD_SCHEMAS['library.work'].safeParse(result.payload).success).toBe(
      true,
    );
  });

  it('prefers the item legacy identifier, and names the kind in a digest slug', () => {
    expect(payloadOf<{ slug: string }>(work({}, {})).slug).toBe('book-17');
    expect(
      payloadOf<{ slug: string; legacyIdentifier: string }>(
        normalise(WORK, { legacyIdentifier: 'item-9' }),
      ),
    ).toMatchObject({ slug: 'item-9', legacyIdentifier: 'item-9' });
    expect(
      payloadOf<{ slug: string }>(work({ legacyIdentifier: null, title: 'منہاج' })).slug,
    ).toMatch(/^book-[0-9a-f]{12}$/);
  });

  it('checks ISBN check digits, ISBN-10 and ISBN-13 alike', () => {
    expect(normalIsbn('978-0-306-40615-7')).toBe('9780306406157');
    expect(normalIsbn('0-306-40615-2')).toBe('0306406152');
    expect(normalIsbn('0-8044-2957-x')).toBe('080442957X');
    for (const bad of [
      '978-0-306-40615-8',
      '0-306-40615-3',
      '977-0-306-40615-7',
      'ISBN',
      '',
    ])
      expect(normalIsbn(bad)).toBeNull();
    const result = work({}, { isbn: '978-0-306-40615-8' });
    expect(result.issues).toEqual(['isbn-invalid']);
    // Never corrected, never kept: the bad value is not carried forward.
    expect(payloadOf<{ edition: { isbn: unknown } }>(result).edition.isbn).toBeNull();
    expect(result.identity).toBeNull();
  });

  it('refuses an implausible publication year and page count without guessing', () => {
    for (const year of ['999', '20055', 'MMV', '2099', '2005 CE'])
      expect(work({}, { publicationYear: year }).issues).toEqual(['year-invalid']);
    expect(work({}, { publicationYear: '2026' }).issues).toEqual([]);
    for (const pages of ['0', 'abc', '100001', '-3', '12.5'])
      expect(work({}, { pageCount: pages }).issues).toEqual(['page-count-invalid']);
    const absent = work({}, { publicationYear: null, pageCount: null, isbn: null });
    expect(absent.issues).toEqual([]);
    expect(payloadOf<{ edition: object }>(absent).edition).toMatchObject({
      publicationYear: null,
      pageCount: null,
      isbn: null,
    });
  });

  it('requires an edition label, never inventing one', () => {
    for (const label of [null, '   '] as const) {
      const result = work({}, { label });
      expect(result.issues).toEqual(['edition-label-missing']);
      expect(payloadOf<{ edition: { label: string } }>(result).edition.label).toBe('');
    }
  });

  it('keeps only canonical https asset URLs', () => {
    const result = work(
      {},
      {
        readableAssetUrl: 'http://library.fixture.invalid/read/17.pdf',
        downloadAssetUrl: 'https://user:pw@library.fixture.invalid/d.pdf',
      },
    );
    expect(payloadOf<{ edition: object }>(result).edition).toMatchObject({
      readableAssetUrl: null,
      downloadAssetUrl: null,
    });
  });

  it('raises title, locale, language and description issues', () => {
    expect(work({ title: '   ' }).issues).toEqual(['title-missing']);
    expect(work({ title: 'x'.repeat(MIGRATION_LIMITS.title + 1) }).issues).toEqual([
      'title-too-long',
    ]);
    const foreign = work({ primaryLocale: 'fr' as ParsedWork['primaryLocale'] });
    expect(foreign.issues).toEqual(['primary-label-missing']);
    expect(payloadOf<{ labels: unknown[] }>(foreign).labels).toEqual([]);
    expect(work({ languageCode: null }).issues).toEqual(['language-missing']);
    expect(work({ languageCode: 'urdu language' }).issues).toEqual(['language-invalid']);
    expect(
      work({ descriptionHtml: `<p>${'w'.repeat(MIGRATION_LIMITS.description + 1)}</p>` })
        .issues,
    ).toEqual(['description-too-long']);
  });

  it('uses the source’s declared default language, and only that', () => {
    const result = normalise(
      { ...WORK, languageCode: null },
      { defaultLanguageCode: 'ar' },
    );
    expect(result.issues).toEqual([]);
    expect(result.languageCode).toBe('ar');
  });

  it('redacts and flags incidental personal data', () => {
    const result = work({ descriptionHtml: '<p>Order from sales@example.com</p>' });
    expect(result.personalData).toBe(true);
    expect(JSON.stringify(result.payload)).not.toContain('sales@example.com');
    expect(JSON.stringify(result.payload)).toContain(REDACTED);
  });
});

/* ===========================================================================
 * library.magazine and library.magazine-issue
 * ========================================================================= */

const MAGAZINE: ParsedMagazine = Object.freeze({
  ...COMMON,
  kind: 'library.magazine',
  title: 'Monthly Minhaj-ul-Quran',
  legacyIdentifier: 'mmq',
  descriptionHtml: '<p>The monthly magazine.</p>',
});

describe('library.magazine', () => {
  it('maps every field', () => {
    const result = run(MAGAZINE);
    expect(result.issues).toEqual([]);
    expect(result.payload).toEqual({
      kind: 'library.magazine',
      slug: 'mmq',
      primaryLocale: 'en',
      labels: [
        {
          locale: 'en',
          title: 'Monthly Minhaj-ul-Quran',
          description: 'The monthly magazine.',
        },
      ],
      legacyIdentifier: 'mmq',
    });
    expect(result.identity).toBeNull();
    expect(result.languageCode).toBe('en');
  });

  it('raises its issues, and names the kind in a digest slug', () => {
    expect(run({ ...MAGAZINE, title: '' }).issues).toEqual(['title-missing']);
    expect(run({ ...MAGAZINE, languageCode: null }).issues).toEqual(['language-missing']);
    expect(
      run({ ...MAGAZINE, primaryLocale: 'de' as ParsedMagazine['primaryLocale'] }).issues,
    ).toEqual(['primary-label-missing']);
    expect(
      payloadOf<{ slug: string }>(
        run({ ...MAGAZINE, legacyIdentifier: null, title: 'ماہنامہ' }),
      ).slug,
    ).toMatch(/^magazine-[0-9a-f]{12}$/);
  });

  it('redacts and flags personal data in its description', () => {
    const result = run({ ...MAGAZINE, descriptionHtml: '<p>Call +92 300 1234567</p>' });
    expect(result.personalData).toBe(true);
    expect(JSON.stringify(result.payload)).not.toContain('1234567');
  });
});

const ISSUE: ParsedMagazineIssue = Object.freeze({
  ...COMMON,
  kind: 'library.magazine-issue',
  title: 'January 2020',
  languageCode: 'ur',
  publishedOn: '2020-01-01',
  legacyIdentifier: 'mmq-2020-01',
  bodyHtml: '<h1>Contents</h1><ol><li>Editorial</li><li>Lecture</li></ol>',
  volume: ' 34 ',
  issueNumber: '1',
  magazineUrl: 'https://Library.fixture.invalid/magazines/mmq#top',
});

describe('library.magazine-issue', () => {
  it('maps every field, the body as blocks and the magazine as a reference', () => {
    const result = run(ISSUE);
    expect(result.issues).toEqual([]);
    expect(result.payload).toEqual({
      kind: 'library.magazine-issue',
      slug: 'mmq-2020-01',
      primaryLocale: 'en',
      languageCode: 'ur',
      labels: [{ locale: 'en', title: 'January 2020', description: '' }],
      publishedOn: '2020-01-01',
      volume: '34',
      issueNumber: '1',
      magazine: {
        role: 'magazine',
        legacyUrl: 'https://library.fixture.invalid/magazines/mmq',
      },
      body: [
        { type: 'heading', level: 2, content: [{ text: 'Contents' }] },
        {
          type: 'list',
          ordered: true,
          items: [[{ text: 'Editorial' }], [{ text: 'Lecture' }]],
        },
      ],
      legacyIdentifier: 'mmq-2020-01',
    });
  });

  it('requires an https magazine reference — a resolution never guesses', () => {
    for (const magazineUrl of [
      'http://library.fixture.invalid/magazines/mmq',
      '/magazines/mmq',
      'not a url',
      'https://user:pw@library.fixture.invalid/m',
    ]) {
      const result = run({ ...ISSUE, magazineUrl });
      expect(result.issues).toEqual(['reference-missing']);
      expect(
        payloadOf<{ magazine: { legacyUrl: string } }>(result).magazine.legacyUrl,
      ).toBe('');
    }
  });

  it('has no body when the page carries none', () => {
    for (const bodyHtml of [null, '', '<p> </p>'])
      expect(payloadOf<{ body: unknown }>(run({ ...ISSUE, bodyHtml })).body).toBeNull();
  });

  it('refuses an implausible date and drops an over-long volume without inventing one', () => {
    for (const publishedOn of ['2020-02-30', '2030-01-01', '1899-12-31', 'Jan 2020'])
      expect(run({ ...ISSUE, publishedOn }).issues).toEqual(['date-implausible']);
    expect(
      payloadOf<{ volume: unknown }>(run({ ...ISSUE, volume: 'v'.repeat(41) })).volume,
    ).toBe(null);
    expect(
      payloadOf<{ issueNumber: unknown }>(run({ ...ISSUE, issueNumber: null }))
        .issueNumber,
    ).toBeNull();
  });

  it('redacts and flags personal data in its body', () => {
    const result = run({ ...ISSUE, bodyHtml: '<p>Subscribe: subs@example.com</p>' });
    expect(result.personalData).toBe(true);
    expect(JSON.stringify(result.payload)).not.toContain('subs@example.com');
    expect(JSON.stringify(result.payload)).toContain(REDACTED);
  });

  it('names the kind in a digest slug', () => {
    expect(
      payloadOf<{ slug: string }>(
        run({ ...ISSUE, legacyIdentifier: null, title: 'جنوری' }),
      ).slug,
    ).toMatch(/^issue-[0-9a-f]{12}$/);
  });
});

/* ===========================================================================
 * editorial.news and editorial.article
 * ========================================================================= */

const NEWS: ParsedEditorial = Object.freeze({
  ...COMMON,
  kind: 'editorial.news',
  title: 'Conference held',
  publishedOn: '2024-03-01',
  legacyIdentifier: 'news-501',
  excerptHtml: '<p>A <b>short</b> summary.</p>',
  bodyHtml:
    '<p>First paragraph with <a href="/news/500">a link</a>.</p><h3>More</h3><p>Second.</p>',
});

describe('editorial.news and editorial.article', () => {
  it('maps every field, the body as rich blocks with links rewritten', () => {
    const result = run(NEWS, {
      rewrite: (href) => (href === '/news/500' ? '/news/conference-2023' : null),
    });
    expect(result.issues).toEqual([]);
    expect(result.payload).toEqual({
      kind: 'editorial.news',
      slug: 'news-501',
      languageCode: 'en',
      title: 'Conference held',
      excerpt: 'A short summary.',
      body: [
        {
          type: 'paragraph',
          content: [
            { text: 'First paragraph with ' },
            { text: 'a link', href: '/news/conference-2023' },
            { text: '.' },
          ],
        },
        { type: 'heading', level: 3, content: [{ text: 'More' }] },
        { type: 'paragraph', content: [{ text: 'Second.' }] },
      ],
      publishedOn: '2024-03-01',
      legacyIdentifier: 'news-501',
    });
    const article = run({ ...NEWS, kind: 'editorial.article' });
    expect(article.issues).toEqual([]);
    expect(article.kind).toBe('editorial.article');
    expect(article.payload.kind).toBe('editorial.article');
  });

  it('accepts en, ur and ar only', () => {
    for (const languageCode of ['en', 'ur', 'ar'])
      expect(run({ ...NEWS, languageCode }).issues).toEqual([]);
    for (const languageCode of ['fa', 'fr', 'pa'])
      expect(run({ ...NEWS, languageCode }).issues).toEqual(['language-unsupported']);
    expect(run({ ...NEWS, languageCode: null }).issues).toEqual(['language-missing']);
  });

  it('requires a body and bounds the title and excerpt', () => {
    for (const bodyHtml of ['', '<p>  </p>', '<script>only()</script>'])
      expect(run({ ...NEWS, bodyHtml }).issues).toEqual(['body-missing']);
    expect(run({ ...NEWS, title: 't'.repeat(201) }).issues).toEqual(['title-too-long']);
    expect(run({ ...NEWS, title: ' ' }).issues).toEqual(['title-missing']);
    expect(run({ ...NEWS, excerptHtml: `<p>${'e'.repeat(601)}</p>` }).issues).toEqual([
      'excerpt-too-long',
    ]);
    const noExcerpt = run({ ...NEWS, excerptHtml: null });
    expect(noExcerpt.issues).toEqual([]);
    expect(payloadOf<{ excerpt: string }>(noExcerpt).excerpt).toBe('');
  });

  it('names its kind in a digest slug', () => {
    const untitled = { ...NEWS, legacyIdentifier: null, title: 'خبر' };
    expect(payloadOf<{ slug: string }>(run(untitled)).slug).toMatch(
      /^news-[0-9a-f]{12}$/,
    );
    expect(
      payloadOf<{ slug: string }>(run({ ...untitled, kind: 'editorial.article' })).slug,
    ).toMatch(/^article-[0-9a-f]{12}$/);
  });

  it('redacts and flags personal data in body and excerpt', () => {
    for (const overrides of [
      { bodyHtml: '<p>Reach the author at author@example.com</p>' },
      { excerptHtml: '<p>Call 0300 1234567</p>' },
    ]) {
      const result = run({ ...NEWS, ...overrides });
      expect(result.personalData).toBe(true);
      expect(JSON.stringify(result.payload)).not.toMatch(/author@example\.com|1234567/);
    }
  });

  it('refuses an implausible date', () => {
    expect(run({ ...NEWS, publishedOn: '2027-01-01' }).issues).toEqual([
      'date-implausible',
    ]);
  });
});

/* ===========================================================================
 * REVIEW-ONLY: fatwa.ruling
 * ========================================================================= */

const FATWA: ParsedFatwa = Object.freeze({
  ...COMMON,
  kind: 'fatwa.ruling',
  title: 'On combining prayers while travelling',
  languageCode: 'ur',
  legacyIdentifier: 'fatwa-88',
  questionHtml: '<p>May a traveller combine prayers?</p>',
  answerHtml: '<p>The answer, exactly as given.</p><blockquote>A quotation.</blockquote>',
  sourceReference: ' Ref No. 1234 ',
  attributedTo: 'Mufti (as the source names)',
});

describe('fatwa.ruling (review-only)', () => {
  it('maps every field exactly, question and answer as blocks', () => {
    const result = run(FATWA);
    expect(result.issues).toEqual([]);
    expect(result.payload).toEqual({
      kind: 'fatwa.ruling',
      slug: 'fatwa-88',
      languageCode: 'ur',
      title: 'On combining prayers while travelling',
      question: [
        { type: 'paragraph', content: [{ text: 'May a traveller combine prayers?' }] },
      ],
      answer: [
        { type: 'paragraph', content: [{ text: 'The answer, exactly as given.' }] },
        { type: 'quote', content: [{ text: 'A quotation.' }] },
      ],
      sourceReference: 'Ref No. 1234',
      attributedTo: 'Mufti (as the source names)',
      publishedOn: null,
      legacyIdentifier: 'fatwa-88',
    });
    // A source reference only asks a person, never collapses.
    expect(result.identity).toMatchObject({ signal: 'identifier', hard: false });
    expect(result.identity?.key.startsWith('fatwa:')).toBe(true);
  });

  it('requires both the question and the answer', () => {
    expect(run({ ...FATWA, questionHtml: '' }).issues).toEqual(['question-missing']);
    expect(run({ ...FATWA, answerHtml: '<p> </p>' }).issues).toEqual(['answer-missing']);
    expect(run({ ...FATWA, questionHtml: '', answerHtml: '' }).issues).toEqual([
      'question-missing',
      'answer-missing',
    ]);
  });

  it('never infers an attribution or a reference', () => {
    const result = run({ ...FATWA, sourceReference: null, attributedTo: null });
    expect(result.issues).toEqual([]);
    expect(payloadOf<object>(result)).toMatchObject({
      sourceReference: null,
      attributedTo: null,
    });
    expect(result.identity).toBeNull();
  });

  it('redacts and flags the asker’s incidental personal data in the published question', () => {
    const result = run({
      ...FATWA,
      questionHtml:
        '<p>I am Ali (ali.khan@example.com, +92 300 1234567). May I combine?</p>',
    });
    expect(result.personalData).toBe(true);
    const question = JSON.stringify(payloadOf<{ question: unknown }>(result).question);
    expect(question).not.toMatch(/ali\.khan|1234567/);
    expect(question).toContain(REDACTED);
  });

  it('names the kind in a digest slug', () => {
    expect(
      payloadOf<{ slug: string }>(
        run({ ...FATWA, legacyIdentifier: null, title: 'فتویٰ' }),
      ).slug,
    ).toMatch(/^fatwa-[0-9a-f]{12}$/);
  });
});

/* ===========================================================================
 * REVIEW-ONLY: quran.translation
 * ========================================================================= */

const QURAN: ParsedQuranTranslation = Object.freeze({
  ...COMMON,
  kind: 'quran.translation',
  title: 'ignored — the work names a translation',
  languageCode: 'ur',
  legacyIdentifier: 'iuq-1',
  work: ' Irfan-ul-Quran (Urdu) ',
  surah: 1,
  ayat: [
    { ayah: 1, text: ' \tاللہ کے نام سے شروع  ' },
    { ayah: 2, text: 'سب تعریفیں اللہ ہی کے لئے ہیں' },
  ],
});

describe('quran.translation (review-only)', () => {
  it('keeps every ayah’s words exactly, trimming only ASCII whitespace at the ends', () => {
    const result = run(QURAN);
    expect(result.issues).toEqual([]);
    expect(result.payload).toEqual({
      kind: 'quran.translation',
      work: 'Irfan-ul-Quran (Urdu)',
      languageCode: 'ur',
      surah: 1,
      ayat: [
        { ayah: 1, text: 'اللہ کے نام سے شروع' },
        { ayah: 2, text: 'سب تعریفیں اللہ ہی کے لئے ہیں' },
      ],
      legacyIdentifier: 'iuq-1',
    });
    expect(result.title).toBe('Irfan-ul-Quran (Urdu) · 1');
    expect(result.identity).toEqual({
      key: 'quran:irfan ul quran urdu:ur:1',
      signal: 'identifier',
      hard: false,
    });
    // Internal double spaces and a no-break space are the source's own.
    const exact = run({ ...QURAN, ayat: [{ ayah: 1, text: 'a  b ' }] });
    expect(payloadOf<{ ayat: { text: string }[] }>(exact).ayat[0]?.text).toBe('a  b ');
  });

  it('refuses a surah that does not exist', () => {
    for (const surah of [null, 0, 115, 1.5, -1]) {
      const result = run({ ...QURAN, surah });
      expect(result.issues).toContain('surah-invalid');
      expect(
        STAGED_PAYLOAD_SCHEMAS['quran.translation'].safeParse(result.payload).success,
      ).toBe(false);
    }
    expect(run({ ...QURAN, surah: 114, ayat: [{ ayah: 6, text: 't' }] }).issues).toEqual(
      [],
    );
  });

  it('refuses an ayah outside its surah, a duplicate, or one without a number — never renumbering', () => {
    const count = SURAH_AYAH_COUNTS[0] ?? 0;
    expect(count).toBe(7);
    for (const ayat of [
      [{ ayah: 8, text: 'beyond' }],
      [{ ayah: 0, text: 'zero' }],
      [{ ayah: null, text: 'unnumbered' }],
      [{ ayah: 2.5, text: 'fraction' }],
      [
        { ayah: 1, text: 'first' },
        { ayah: 1, text: 'again' },
      ],
    ]) {
      const result = run({ ...QURAN, ayat: [...ayat, { ayah: 7, text: 'seven' }] });
      expect(result.issues).toEqual(['ayah-invalid']);
    }
    const kept = run({
      ...QURAN,
      ayat: [
        { ayah: 3, text: 'three' },
        { ayah: 3, text: 'dup' },
      ],
    });
    // The good ayah stays at its own number; the duplicate is not moved.
    expect(payloadOf<{ ayat: unknown[] }>(kept).ayat).toEqual([
      { ayah: 3, text: 'three' },
    ]);
    expect(
      run({ ...QURAN, surah: 2, ayat: [{ ayah: 286, text: 'last' }] }).issues,
    ).toEqual([]);
    expect(
      run({ ...QURAN, surah: 2, ayat: [{ ayah: 287, text: 'none' }] }).issues,
    ).toContain('ayah-invalid');
  });

  it('requires text and a work', () => {
    expect(run({ ...QURAN, ayat: [] }).issues).toEqual(['body-missing']);
    expect(run({ ...QURAN, ayat: [{ ayah: 1, text: ' \n ' }] }).issues).toEqual([
      'body-missing',
    ]);
    expect(run({ ...QURAN, work: '  ' }).issues).toContain('title-missing');
    expect(run({ ...QURAN, languageCode: null }).issues).toEqual(['language-missing']);
  });

  it('flags — but never alters — personal-data-like text in scripture', () => {
    const text = 'Call 0300 1234567';
    const result = run({ ...QURAN, ayat: [{ ayah: 1, text }] });
    expect(result.personalData).toBe(true);
    expect(payloadOf<{ ayat: { text: string }[] }>(result).ayat[0]?.text).toBe(text);
  });
});

/* ===========================================================================
 * media.video through the dispatcher
 * ========================================================================= */

const VIDEO: ParsedVideo = Object.freeze({
  ...COMMON,
  kind: 'media.video',
  title: 'Lecture',
  provider: 'youtube',
  providerReference: 'https://youtu.be/dQw4w9WgXcQ',
  labels: [],
  descriptionHtml: '<p>Words</p>',
  durationSeconds: 60,
  legacyIdentifier: 'lec-1',
});

describe('media.video through the dispatcher', () => {
  it('carries a provider id as the one HARD identity', () => {
    const result = run(VIDEO);
    expect(result.issues).toEqual([]);
    expect(result.identity).toEqual({
      key: 'youtube:dQw4w9WgXcQ',
      signal: 'provider-id',
      hard: true,
    });
    expect(run({ ...VIDEO, providerReference: 'nonsense' }).identity).toBeNull();
  });
});

/* ===========================================================================
 * Invariants over every normalisation above
 * ========================================================================= */

describe('the strict schema is the last word', () => {
  it('every payload with no issue passes its kind’s schema; every schema failure carries an issue', () => {
    expect(seen.length).toBeGreaterThan(60);
    for (const result of seen) {
      const passes = STAGED_PAYLOAD_SCHEMAS[result.kind].safeParse(
        result.payload,
      ).success;
      if (result.issues.length === 0) expect(passes).toBe(true);
      if (!passes) expect(result.issues.length).toBeGreaterThan(0);
      expect(result.payload.kind).toBe(result.kind);
      expect(result.title.length).toBeGreaterThan(0);
      expect(result.title.length).toBeLessThanOrEqual(MIGRATION_LIMITS.title);
    }
  });

  it('a payload no specific issue names still cannot pass as valid', () => {
    // An over-long work name has no issue of its own; the schema still refuses it.
    const result = normalise({ ...QURAN, work: 'w'.repeat(201) });
    expect(result.issues.length).toBeGreaterThan(0);
  });
});

describe('recordHrefs', () => {
  const marked = (tag: string) => `<p><a href="/${tag}">${tag}</a></p>`;

  it('covers the links and every markup field of every kind, in order', () => {
    const cases: [ParsedRecord, string[]][] = [
      [
        {
          ...VIDEO,
          links: ['https://x.example/l'],
          descriptionHtml: marked('description'),
          labels: [{ locale: 'ur', title: 't', descriptionHtml: marked('label') }],
        },
        ['https://x.example/l', '/description', '/label'],
      ],
      [{ ...WORK, descriptionHtml: marked('work') }, ['/work']],
      [{ ...MAGAZINE, descriptionHtml: marked('magazine') }, ['/magazine']],
      [{ ...ISSUE, bodyHtml: marked('issue') }, ['/issue']],
      [{ ...ISSUE, bodyHtml: null, links: ['/listed'] }, ['/listed']],
      [
        { ...NEWS, bodyHtml: marked('body'), excerptHtml: marked('excerpt') },
        ['/body', '/excerpt'],
      ],
      [{ ...NEWS, bodyHtml: marked('body'), excerptHtml: null }, ['/body']],
      [
        { ...FATWA, questionHtml: marked('question'), answerHtml: marked('answer') },
        ['/question', '/answer'],
      ],
      [{ ...QURAN, links: ['/surah/1'] }, ['/surah/1']],
    ];
    for (const [record, hrefs] of cases) expect(recordHrefs(record)).toEqual(hrefs);
  });
});
