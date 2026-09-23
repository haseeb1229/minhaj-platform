import { describe, expect, it } from 'vitest';

import {
  editionInputSchema,
  formatReaderDocument,
  parseReaderDocument,
  readerPosition,
  salePointInputSchema,
  translationInputSchema,
  validIsbn,
  workInputSchema,
} from '../../packages/contracts/src/library/index.ts';

/**
 * Phase 8 — the Library contracts at the trust boundary.
 *
 * Synthetic, non-authoritative text only. No book content is real.
 */

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('the reader document authoring format', () => {
  const text = [
    '## Opening',
    'A synthetic paragraph that',
    'wraps across two lines.',
    '',
    'A second paragraph.',
    '',
    '## الباب الأول',
    'نص تجريبي غير موثوق.',
    '',
    '## Opening',
    'A repeated title gets a distinct key.',
  ].join('\n');

  it('parses titled sections with derived, schema-valid, unique keys', () => {
    const document = parseReaderDocument(text);

    expect(document?.sections.map((section) => section.key)).toEqual([
      'opening',
      // A non-Latin title yields a POSITIONAL key, deterministic for the input.
      'section-2',
      'opening-2',
    ]);
    expect(document?.sections[0]?.paragraphs).toEqual([
      'A synthetic paragraph that wraps across two lines.',
      'A second paragraph.',
    ]);
  });

  it('treats markup as literal text, never as structure', () => {
    const document = parseReaderDocument('## Title\n<script>alert(1)</script> **bold**');
    expect(document?.sections[0]?.paragraphs[0]).toBe(
      '<script>alert(1)</script> **bold**',
    );
  });

  it('round-trips through its inverse, so editing is not retyping', () => {
    const document = parseReaderDocument(text);
    expect(document).not.toBeNull();
    if (document === null) return;
    expect(parseReaderDocument(formatReaderDocument(document))).toEqual(document);
  });

  it('refuses a document with no section at all', () => {
    expect(parseReaderDocument('Text before any heading.')).toBeNull();
    expect(parseReaderDocument('')).toBeNull();
  });
});

describe('the stable position identifier', () => {
  it('is built from edition, content version and section key — and nothing else', () => {
    // The function has no parameter a font size, zoom level, theme, viewport or
    // account could arrive through, so a reading-preference change cannot move it.
    expect(readerPosition.length).toBe(3);

    const first = readerPosition(ID(1), 'a'.repeat(64), 'opening');
    expect(readerPosition(ID(1), 'a'.repeat(64), 'opening')).toBe(first);
    expect(first).toMatch(/^edition-[0-9a-f-]+-[0-9a-f]{64}-opening$/);
  });

  it('distinguishes editions and content versions', () => {
    const base = readerPosition(ID(1), 'a'.repeat(64), 'opening');
    expect(readerPosition(ID(2), 'a'.repeat(64), 'opening')).not.toBe(base);
    expect(readerPosition(ID(1), 'b'.repeat(64), 'opening')).not.toBe(base);
  });
});

describe('bibliographic validation', () => {
  it('validates ISBN-10 and ISBN-13 check digits and never requires one', () => {
    expect(validIsbn('0306406152')).toBe(true);
    expect(validIsbn('9780306406157')).toBe(true);
    expect(validIsbn('9780306406158')).toBe(false);
    expect(validIsbn('not-an-isbn')).toBe(false);
  });

  const base = {
    workId: ID(1),
    label: 'Synthetic edition',
    languageCode: 'en',
    state: 'draft',
    publisher: null,
    publicationYear: null,
    isbn: null,
    pageCount: null,
    reading: 'unavailable',
    download: 'denied',
    readableAssetId: null,
    downloadAssetId: null,
    document: null,
  };

  it('accepts an Edition with every optional fact absent', () => {
    expect(editionInputSchema.safeParse(base).success).toBe(true);
  });

  it('normalises a hyphenated ISBN and refuses a fabricated one', () => {
    expect(editionInputSchema.parse({ ...base, isbn: '978-0-306-40615-7' }).isbn).toBe(
      '9780306406157',
    );
    expect(
      editionInputSchema.safeParse({ ...base, isbn: '978-0-306-40615-8' }).success,
    ).toBe(false);
  });

  it('refuses a non-positive page count and an unbounded year', () => {
    expect(editionInputSchema.safeParse({ ...base, pageCount: 0 }).success).toBe(false);
    expect(
      editionInputSchema.safeParse({ ...base, publicationYear: 10_000 }).success,
    ).toBe(false);
  });

  it('refuses availability decisions that have nothing behind them', () => {
    expect(editionInputSchema.safeParse({ ...base, reading: 'allowed' }).success).toBe(
      false,
    );
    expect(editionInputSchema.safeParse({ ...base, download: 'allowed' }).success).toBe(
      false,
    );
  });

  it('refuses a field nobody named', () => {
    expect(
      editionInputSchema.safeParse({ ...base, rightsHolder: 'anyone' }).success,
    ).toBe(false);
  });
});

describe('translations and localized labels are different things', () => {
  it('a Work requires a label in its primary locale, once per locale', () => {
    const work = {
      slug: 'synthetic-proof',
      primaryLocale: 'ur',
      state: 'draft',
      isFeatured: false,
      labels: [{ locale: 'en', title: 'Synthetic', description: '' }],
      contributors: [],
      topicIds: [],
      salePointIds: [],
    };
    expect(workInputSchema.safeParse(work).success).toBe(false);
    expect(
      workInputSchema.safeParse({
        ...work,
        labels: [{ locale: 'ur', title: 'تجرباتی', description: '' }],
      }).success,
    ).toBe(true);
  });

  it('a translation needs translators and may not be its own source', () => {
    expect(
      translationInputSchema.safeParse({
        editionId: ID(5),
        expectedVersion: 1,
        sourceEditionId: null,
        translatorIds: [],
      }).success,
    ).toBe(false);
    expect(
      translationInputSchema.safeParse({
        editionId: ID(5),
        expectedVersion: 1,
        sourceEditionId: ID(5),
        translatorIds: [ID(6)],
      }).success,
    ).toBe(false);
  });
});

describe('sale points are information, and links are https only', () => {
  const point = { name: 'Synthetic point', address: '', contact: '', state: 'draft' };

  it('accepts https and refuses http and embedded credentials', () => {
    expect(
      salePointInputSchema.safeParse({ ...point, url: 'https://example.invalid/' })
        .success,
    ).toBe(true);
    expect(
      salePointInputSchema.safeParse({ ...point, url: 'http://example.invalid/' })
        .success,
    ).toBe(false);
    expect(
      salePointInputSchema.safeParse({
        ...point,
        url: 'https://user:pass@example.invalid/',
      }).success,
    ).toBe(false);
  });

  it('has no price, stock or order field to accept', () => {
    expect(
      salePointInputSchema.safeParse({ ...point, url: null, price: 10 }).success,
    ).toBe(false);
  });
});
