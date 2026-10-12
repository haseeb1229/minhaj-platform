import { describe, expect, it } from 'vitest';

import {
  HADITH_LIMITS,
  HADITH_NUMBER_MAX,
  HADITH_RESERVED_SLUGS,
  bookCreateSchema,
  chapterCreateSchema,
  citationSetSchema,
  collectionCreateSchema,
  collectionNamesSchema,
  conflictFacetsOf,
  gradingInputSchema,
  hadithCollectionSlugSchema,
  hadithNumberSchema,
  hadithNumberSegment,
  hadithSlugSchema,
  hadithSourceReferenceSchema,
  recordCorrectionSchema,
  recordCreateSchema,
  translationInputSchema,
} from '../../packages/contracts/src/hadith/index.ts';

/**
 * Phase 19 — the Hadith contract's validators.
 *
 * WHAT IS PROVED: a source reference is kept EXACTLY — refused, never trimmed,
 * when it is padded or holds any control character, and returned byte for byte
 * when it holds Arabic letters and combining marks; a citation number segment
 * is canonical decimal and nothing else; the Hadith section's own path words
 * are never a collection slug; a grading names its grader, label, language and
 * reference, and a grader once per version; a chain and its language arrive
 * together; and the citation mapping states its reason for every change.
 *
 * Every string is a synthetic sentinel. No Hadith text, grading, grader or
 * collection name appears anywhere.
 */

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const grading = (n: number, overrides: Record<string, unknown> = {}) => ({
  grader: `NON_HADITH_FIXTURE_GRADER_${n}`,
  label: `NON_HADITH_FIXTURE_GRADING_${n}`,
  labelLanguage: 'ar',
  reference: `NON_HADITH_FIXTURE_REFERENCE_${n}`,
  ...overrides,
});

const recordCreate = (overrides: Record<string, unknown> = {}) => ({
  editionId: ID(1),
  sourceReference: 'NON_HADITH_FIXTURE_REFERENCE_1',
  citationNumber: 7,
  bookId: ID(2),
  chapterId: null,
  text: 'NON_HADITH_FIXTURE_TEXT_1',
  textLanguage: 'ar',
  chain: 'NON_HADITH_FIXTURE_CHAIN_1',
  chainLanguage: 'ar',
  gradings: [grading(1)],
  evidence: 'NON_HADITH_FIXTURE_EVIDENCE_1',
  ...overrides,
});

const citation = (overrides: Record<string, unknown> = {}) => ({
  collectionId: ID(1),
  number: 7,
  hadithId: ID(3),
  state: 'mapped',
  expectedVersion: 0,
  evidence: 'NON_HADITH_FIXTURE_EVIDENCE_1',
  reason: null,
  ...overrides,
});

const ok = (
  schema: { safeParse(value: unknown): { success: boolean } },
  value: unknown,
) => schema.safeParse(value).success;

describe('a source reference is exact', () => {
  it('keeps Arabic letters, digits and combining marks exactly as supplied', () => {
    for (const reference of [
      'NON_HADITH_FIXTURE_REFERENCE_1',
      // Arabic letters with a fatha and a shadda, Arabic-Indic digits and an
      // Arabic comma — kept as given, never re-composed or re-ordered.
      'مَرْجِعّ ١٢٣، ب',
      // A decomposed letter and its precomposed twin are different references.
      'é-1',
      'é-1',
      'A/12 (b)',
    ]) {
      const parsed = hadithSourceReferenceSchema.safeParse(reference);
      expect(parsed.success, JSON.stringify(reference)).toBe(true);
      expect(parsed.data).toBe(reference);
    }
    expect(hadithSourceReferenceSchema.parse('é-1')).not.toBe(
      hadithSourceReferenceSchema.parse('é-1'),
    );
  });

  it('refuses padding, every control character and malformed text — never repairs it', () => {
    for (const reference of [
      '',
      ' NON_HADITH_FIXTURE_REFERENCE_1',
      'NON_HADITH_FIXTURE_REFERENCE_1 ',
      ' NON_HADITH_FIXTURE_REFERENCE_1',
      'NON\tHADITH',
      'NON\nHADITH',
      'NON\rHADITH',
      'NON\u0000HADITH',
      'NON\u001fHADITH',
      'NON\u007fHADITH',
      'NON\uD800HADITH',
      'x'.repeat(65),
    ])
      expect(ok(hadithSourceReferenceSchema, reference), JSON.stringify(reference)).toBe(
        false,
      );
    expect(ok(hadithSourceReferenceSchema, 'x'.repeat(64))).toBe(true);
  });

  it('applies the same exactness to book and chapter references', () => {
    const book = {
      editionId: ID(1),
      slug: 'fixture-book-a',
      reference: ' NON_HADITH_FIXTURE_REFERENCE_1',
      position: 0,
      title: null,
      titleLanguage: null,
    };
    expect(ok(bookCreateSchema, book)).toBe(false);
    expect(
      ok(bookCreateSchema, { ...book, reference: 'NON_HADITH_FIXTURE_REFERENCE_1' }),
    ).toBe(true);
    const chapter = { ...book, bookId: ID(2) } as Record<string, unknown>;
    delete chapter['editionId'];
    expect(ok(chapterCreateSchema, chapter)).toBe(false);
    expect(
      ok(chapterCreateSchema, {
        ...chapter,
        reference: 'NON_HADITH_FIXTURE_REFERENCE_1',
      }),
    ).toBe(true);
  });
});

describe('the public citation number', () => {
  it('reads a canonical decimal path segment and nothing else', () => {
    expect(hadithNumberSegment('1')).toBe(1);
    expect(hadithNumberSegment('42')).toBe(42);
    expect(hadithNumberSegment(String(HADITH_NUMBER_MAX))).toBe(HADITH_NUMBER_MAX);
    for (const segment of [
      '',
      '0',
      '01',
      '007',
      '-1',
      '+1',
      '1.0',
      '1e3',
      ' 1',
      '1 ',
      '0x10',
      '1000000',
      '9999999',
      '１',
      '١',
      '۱',
      'fixture',
    ])
      expect(hadithNumberSegment(segment), JSON.stringify(segment)).toBeNull();
  });

  it('bounds the number structurally', () => {
    expect(ok(hadithNumberSchema, 1)).toBe(true);
    expect(ok(hadithNumberSchema, HADITH_NUMBER_MAX)).toBe(true);
    for (const value of [0, -1, 1.5, HADITH_NUMBER_MAX + 1, Number.NaN, '7'])
      expect(ok(hadithNumberSchema, value), String(value)).toBe(false);
  });
});

describe('collection slugs', () => {
  it('refuses every word the Hadith section already uses as a path', () => {
    expect(HADITH_RESERVED_SLUGS.length).toBeGreaterThan(0);
    for (const slug of HADITH_RESERVED_SLUGS) {
      expect(ok(hadithSlugSchema, slug), slug).toBe(true);
      expect(ok(hadithCollectionSlugSchema, slug), slug).toBe(false);
      expect(ok(collectionCreateSchema, { slug, position: 0 }), slug).toBe(false);
    }
  });

  it('accepts an ordinary slug and refuses a malformed one', () => {
    expect(
      ok(collectionCreateSchema, { slug: 'fixture-collection-a', position: 0 }),
    ).toBe(true);
    for (const slug of [
      'Fixture-collection',
      'a',
      '-fixture',
      'fixture-',
      'fix--ture',
      'fix ture',
    ])
      expect(ok(hadithCollectionSlugSchema, slug), slug).toBe(false);
    expect(
      ok(collectionCreateSchema, {
        slug: 'fixture-collection-a',
        position: HADITH_LIMITS.collectionPosition + 1,
      }),
    ).toBe(false);
  });
});

describe('gradings are sourced data', () => {
  it('requires a grader, a label, its language and a reference', () => {
    expect(ok(gradingInputSchema, grading(1))).toBe(true);
    for (const field of ['grader', 'label', 'labelLanguage', 'reference']) {
      const missing = Object.fromEntries(
        Object.entries(grading(1)).filter(([key]) => key !== field),
      );
      expect(ok(gradingInputSchema, missing), field).toBe(false);
      expect(ok(gradingInputSchema, grading(1, { [field]: '' })), field).toBe(false);
    }
    expect(ok(gradingInputSchema, grading(1, { labelLanguage: 'Arabic' }))).toBe(false);
    expect(ok(gradingInputSchema, { ...grading(1), rank: 1 })).toBe(false);
  });

  it('keeps the grader and the label exactly, refusing padding', () => {
    expect(
      ok(gradingInputSchema, grading(1, { grader: ' NON_HADITH_FIXTURE_GRADER_1' })),
    ).toBe(false);
    expect(
      ok(gradingInputSchema, grading(1, { label: 'NON_HADITH_FIXTURE_GRADING_1 ' })),
    ).toBe(false);
  });

  it('keeps the grading reference exactly, refusing padding and control characters', () => {
    // Inner spacing, a mark and a joiner are the source's own: kept, unaltered.
    const exact = 'NON_HADITH_FIXTURE_REFERENCE_3  بَ‍ب';
    const parsed = gradingInputSchema.safeParse(grading(1, { reference: exact }));
    expect(parsed.success).toBe(true);
    expect(parsed.data?.reference).toBe(exact);
    for (const reference of [
      ' NON_HADITH_FIXTURE_REFERENCE_3',
      'NON_HADITH_FIXTURE_REFERENCE_3 ',
      '\tNON_HADITH_FIXTURE_REFERENCE_3',
      'NON_HADITH_FIXTURE_REFERENCE_3\n',
      ' NON_HADITH_FIXTURE_REFERENCE_3',
      'NON_HADITH_FIXTURE\u0007REFERENCE_3',
      'NON_HADITH_FIXTURE\u0000REFERENCE_3',
      'NON_HADITH_FIXTURE_REFERENCE_3\u007F',
      'NON_HADITH_FIXTURE_REFERENCE_3\uD800',
      ' ',
    ])
      expect(
        ok(gradingInputSchema, grading(1, { reference })),
        JSON.stringify(reference),
      ).toBe(false);
  });

  it('names a grader once per version', () => {
    expect(
      ok(recordCreateSchema, recordCreate({ gradings: [grading(1), grading(2)] })),
    ).toBe(true);
    expect(
      ok(
        recordCreateSchema,
        recordCreate({
          gradings: [grading(1), grading(2, { grader: grading(1).grader })],
        }),
      ),
    ).toBe(false);
    expect(ok(recordCreateSchema, recordCreate({ gradings: [] }))).toBe(true);
    expect(
      ok(
        recordCreateSchema,
        recordCreate({
          gradings: Array.from({ length: HADITH_LIMITS.gradings + 1 }, (_, n) =>
            grading(n),
          ),
        }),
      ),
    ).toBe(false);
  });
});

describe('records', () => {
  it('pairs a chain with its language, both or neither', () => {
    expect(ok(recordCreateSchema, recordCreate())).toBe(true);
    expect(
      ok(recordCreateSchema, recordCreate({ chain: null, chainLanguage: null })),
    ).toBe(true);
    expect(ok(recordCreateSchema, recordCreate({ chainLanguage: null }))).toBe(false);
    expect(ok(recordCreateSchema, recordCreate({ chain: null }))).toBe(false);
  });

  it('keeps the text exactly: inner line breaks kept, padding and controls refused', () => {
    const text = 'NON_HADITH_FIXTURE_TEXT_1\nسطر ثانٍ';
    expect(recordCreateSchema.parse(recordCreate({ text })).text).toBe(text);
    for (const bad of [
      ' NON_HADITH_FIXTURE_TEXT_1',
      'NON_HADITH_FIXTURE_TEXT_1\n',
      'A\u0000B',
      '',
    ])
      expect(
        ok(recordCreateSchema, recordCreate({ text: bad })),
        JSON.stringify(bad),
      ).toBe(false);
  });

  it('refuses a field nobody named', () => {
    expect(ok(recordCreateSchema, { ...recordCreate(), version: 1 })).toBe(false);
    expect(ok(recordCreateSchema, { ...recordCreate(), narrators: [] })).toBe(false);
  });

  it('states a reason for every correction, under a real version', () => {
    const { editionId: _edition, ...facts } = recordCreate();
    const correction = {
      ...facts,
      id: ID(3),
      expectedVersion: 1,
      reason: 'NON_HADITH_FIXTURE_EVIDENCE_2',
    };
    expect(ok(recordCorrectionSchema, correction)).toBe(true);
    expect(ok(recordCorrectionSchema, { ...correction, reason: '' })).toBe(false);
    expect(ok(recordCorrectionSchema, { ...correction, expectedVersion: 0 })).toBe(false);
    expect(ok(recordCorrectionSchema, { ...correction, editionId: ID(1) })).toBe(false);
  });

  it('allows a record with no intended citation', () => {
    expect(ok(recordCreateSchema, recordCreate({ citationNumber: null }))).toBe(true);
    expect(ok(recordCreateSchema, recordCreate({ citationNumber: 0 }))).toBe(false);
  });
});

describe('the citation mapping', () => {
  it('creates a citation only as mapped', () => {
    expect(ok(citationSetSchema, citation())).toBe(true);
    expect(ok(citationSetSchema, citation({ state: 'withdrawn' }))).toBe(false);
  });

  it('states the reason for every change to an existing citation', () => {
    expect(ok(citationSetSchema, citation({ expectedVersion: 2 }))).toBe(false);
    expect(
      ok(
        citationSetSchema,
        citation({
          expectedVersion: 2,
          state: 'withdrawn',
          reason: 'NON_HADITH_FIXTURE_EVIDENCE_2',
        }),
      ),
    ).toBe(true);
  });

  it('requires evidence and a real citation number', () => {
    expect(ok(citationSetSchema, citation({ evidence: '' }))).toBe(false);
    expect(ok(citationSetSchema, citation({ number: 0 }))).toBe(false);
    expect(ok(citationSetSchema, citation({ number: HADITH_NUMBER_MAX + 1 }))).toBe(
      false,
    );
    expect(ok(citationSetSchema, citation({ state: 'preferred' }))).toBe(false);
    expect(ok(citationSetSchema, { ...citation(), winner: true })).toBe(false);
  });
});

describe('layered input', () => {
  it('keeps a translation exact and names a registered source by id only', () => {
    const value = {
      languageCode: 'en',
      text: 'NON_HADITH_FIXTURE_TRANSLATION_1',
      attribution: null,
      sourceSystemId: ID(4),
      contributors: [],
    };
    expect(ok(translationInputSchema, value)).toBe(true);
    expect(
      ok(translationInputSchema, { ...value, text: 'NON_HADITH_FIXTURE_TRANSLATION_1 ' }),
    ).toBe(false);
    expect(ok(translationInputSchema, { ...value, sourceSystemId: 'fixture' })).toBe(
      false,
    );
  });

  it('names each interface locale once', () => {
    const names = {
      id: ID(1),
      expectedVersion: 1,
      names: [{ locale: 'en', name: 'Fixture collection A', description: null }],
    };
    expect(ok(collectionNamesSchema, names)).toBe(true);
    expect(
      ok(collectionNamesSchema, { ...names, names: [...names.names, ...names.names] }),
    ).toBe(false);
    expect(
      ok(collectionNamesSchema, {
        ...names,
        names: [{ locale: 'fr', name: 'Fixture collection A', description: null }],
      }),
    ).toBe(false);
  });
});

describe('conflict facets', () => {
  it('reads only facets the contract knows', () => {
    expect(conflictFacetsOf('text,chain,structure,grading')).toEqual([
      'text',
      'chain',
      'structure',
      'grading',
    ]);
    expect(conflictFacetsOf('text,unknown,,grading')).toEqual(['text', 'grading']);
    expect(conflictFacetsOf('')).toEqual([]);
  });
});
