import { describe, expect, it } from 'vitest';

import {
  magazineInputSchema,
  magazineIssueInputSchema,
  researchInputSchema,
  researchPaperInputSchema,
  SCHOLARLY_INPUT_SCHEMAS,
  SCHOLARLY_KINDS,
  scholarlyQuerySchema,
  type LibraryPublicReaderPort,
  type ScholarlySearchRecord,
} from '../../packages/contracts/src/library/index.ts';
import { searchDocumentSourceSchema } from '../../packages/contracts/src/search/index.ts';
import {
  doiHref,
  issuePath,
  paragraphsOf,
  readScholarlyQuery,
  scholarlyLabel,
  scholarlyPath,
  scholarlyPathOf,
  scholarlyQueryPath,
  standaloneKindOfSegment,
} from '../../apps/web/src/components/library/scholarly-presentation.ts';
import { createScholarlySearchSource } from '../../apps/web/src/contexts/library/index.ts';

/**
 * Phase 9 — the scholarly and periodical contracts, their presentation decisions
 * and their search projection, without a database.
 *
 * The live SQL, redirect and search proofs are in `scholarly.integration.test.ts`
 * and `tests/search/scholarly*.integration.test.ts`; these pin the rules a
 * database cannot see — what the trust boundary refuses, what an address spells,
 * and what the owner hands to Search.
 */

const PERSON = '00000000-0000-4000-8000-000000000001';
const TOPIC = '00000000-0000-4000-8000-000000000002';
const MAGAZINE = '00000000-0000-4000-8000-000000000003';

const described = {
  slug: 'synthetic-proof',
  primaryLocale: 'en',
  state: 'published',
  labels: [{ locale: 'en', title: 'Synthetic proof', summary: '' }],
  contributors: [{ personId: PERSON, role: 'author' }],
  topicIds: [TOPIC],
};

const research = {
  ...described,
  languageCode: 'ur',
  publicationYear: null,
  publishedOn: null,
  institutionalContext: null,
  abstract: null,
  citations: [],
  document: null,
};

describe('six distinct inputs, one set of shared rules', () => {
  it('declares exactly the six Phase-9 aggregates, each with its own schema', () => {
    expect([...SCHOLARLY_KINDS].sort()).toEqual([
      'encyclopedia',
      'magazine',
      'magazine-issue',
      'publication',
      'research',
      'research-paper',
    ]);
    expect(Object.keys(SCHOLARLY_INPUT_SCHEMAS).sort()).toEqual(
      [...SCHOLARLY_KINDS].sort(),
    );
  });

  it('keeps each aggregate to its own fields — strictly', () => {
    expect(researchInputSchema.safeParse(research).success).toBe(true);
    // A venue and a DOI are a PAPER's facts, never a research work's.
    expect(researchInputSchema.safeParse({ ...research, venue: 'X' }).success).toBe(
      false,
    );
    expect(
      researchPaperInputSchema.safeParse({ ...research, venue: 'Synthetic', doi: null })
        .success,
    ).toBe(true);
    // A Magazine has no content language and no date: its issues do.
    expect(magazineInputSchema.safeParse(described).success).toBe(true);
    expect(
      magazineInputSchema.safeParse({ ...described, languageCode: 'en' }).success,
    ).toBe(false);
  });

  it('requires a unique label in the primary locale and no duplicate credit', () => {
    expect(
      researchInputSchema.safeParse({ ...research, primaryLocale: 'ur' }).success,
    ).toBe(false);
    expect(
      researchInputSchema.safeParse({
        ...research,
        contributors: [
          { personId: PERSON, role: 'author' },
          { personId: PERSON, role: 'author' },
        ],
      }).success,
    ).toBe(false);
    // The SAME person in two roles is two genuine credits.
    expect(
      researchInputSchema.safeParse({
        ...research,
        contributors: [
          { personId: PERSON, role: 'author' },
          { personId: PERSON, role: 'editor' },
        ],
      }).success,
    ).toBe(true);
  });

  it('refuses a contribution role outside the accepted vocabulary', () => {
    expect(
      researchInputSchema.safeParse({
        ...research,
        contributors: [{ personId: PERSON, role: 'supervisor' }],
      }).success,
    ).toBe(false);
  });
});

describe('citations — the smallest bounded shape', () => {
  const cite = (overrides: Record<string, unknown>) =>
    researchInputSchema.safeParse({
      ...research,
      citations: [{ text: 'Synthetic reference', url: null, doi: null, ...overrides }],
    }).success;

  it('accepts plain text, an HTTPS address and a DOI, each optional', () => {
    expect(cite({})).toBe(true);
    expect(cite({ url: 'https://example.org/a', doi: '10.1234/abc.def' })).toBe(true);
  });

  it('refuses a non-HTTPS or credentialed address', () => {
    expect(cite({ url: 'http://example.org/a' })).toBe(false);
    expect(cite({ url: 'javascript:alert(1)' })).toBe(false);
    expect(cite({ url: 'https://user:secret@example.org/' })).toBe(false);
  });

  it('refuses a DOI that could break out of the link it is rendered into', () => {
    expect(cite({ doi: '10.1234/abc"onmouseover' })).toBe(false);
    expect(cite({ doi: '10.1234/a b' })).toBe(false);
    expect(cite({ doi: '11.1234/abc' })).toBe(false);
  });

  it('is bounded in count and in length', () => {
    const many = Array.from({ length: 101 }, (_, index) => ({
      text: `Synthetic reference ${String(index)}`,
      url: null,
      doi: null,
    }));
    expect(researchInputSchema.safeParse({ ...research, citations: many }).success).toBe(
      false,
    );
    expect(cite({ text: 'x'.repeat(1001) })).toBe(false);
    expect(cite({ text: '   ' })).toBe(false);
  });
});

describe('date facts — a date is a date, and it agrees with its year', () => {
  it('lets a date supply its own year', () => {
    const parsed = researchInputSchema.parse({ ...research, publishedOn: '2021-03-04' });
    expect(parsed.publicationYear).toBe(2021);
  });

  it('refuses a year and a date that disagree, and an impossible date', () => {
    expect(
      researchInputSchema.safeParse({
        ...research,
        publishedOn: '2021-03-04',
        publicationYear: 2020,
      }).success,
    ).toBe(false);
    expect(
      researchInputSchema.safeParse({ ...research, publishedOn: '2021-02-30' }).success,
    ).toBe(false);
  });
});

describe('an issue belongs to one Magazine, with genuine numbers only', () => {
  const issue = {
    ...research,
    magazineId: MAGAZINE,
    volume: null,
    issueNumber: null,
  };
  delete (issue as Record<string, unknown>)['institutionalContext'];
  delete (issue as Record<string, unknown>)['abstract'];
  delete (issue as Record<string, unknown>)['citations'];

  it('accepts an issue with no printed numbers', () => {
    expect(magazineIssueInputSchema.safeParse(issue).success).toBe(true);
  });

  it('refuses a zero, negative or unbounded number, and a missing Magazine', () => {
    for (const volume of [0, -1, 100_001, 1.5]) {
      expect(magazineIssueInputSchema.safeParse({ ...issue, volume }).success).toBe(
        false,
      );
    }
    expect(
      magazineIssueInputSchema.safeParse({ ...issue, magazineId: 'x' }).success,
    ).toBe(false);
  });
});

describe('public listing query', () => {
  it('refuses an inverted year range at the trust boundary', () => {
    expect(scholarlyQuerySchema.safeParse({ from: 2020, to: 2010 }).success).toBe(false);
  });

  it('tolerates a mistyped URL and turns it into the unfiltered listing', () => {
    expect(
      readScholarlyQuery({
        from: 'banana',
        to: '2020',
        topic: 'not-a-uuid',
        language: ['en', 'ur'],
        offset: '-5',
      }),
    ).toEqual({ offset: 0, language: null, topic: null, from: null, to: 2020 });
    expect(readScholarlyQuery({ from: '2021', to: '2010' })).toMatchObject({
      from: null,
      to: null,
    });
  });

  it('writes one address per view, neutral values omitted', () => {
    const base = '/en/library/research';
    const filters = readScholarlyQuery({});
    expect(scholarlyQueryPath(base, filters)).toBe(base);
    expect(scholarlyQueryPath(base, filters, { topic: TOPIC, offset: 25 })).toBe(
      `${base}?offset=25&topic=${TOPIC}`,
    );
  });
});

describe('addresses', () => {
  it('spells every aggregate at the route the route map names', () => {
    expect(scholarlyPathOf('research', 'a', null)).toBe('/library/research/a');
    expect(scholarlyPathOf('research-paper', 'a', null)).toBe(
      '/library/research-papers/a',
    );
    expect(scholarlyPathOf('publication', 'a', null)).toBe('/library/publications/a');
    expect(scholarlyPathOf('magazine', 'a', null)).toBe('/library/magazines/a');
    expect(scholarlyPathOf('encyclopedia', 'a', null)).toBe('/library/encyclopedias/a');
    expect(issuePath('ur', 'monthly', 'spring')).toBe(
      '/ur/library/magazines/monthly/issues/spring',
    );
    expect(scholarlyPath('ar', 'research', 'a b')).toBe('/ar/library/research/a%20b');
  });

  it('refuses to spell an issue address without its Magazine', () => {
    expect(() => scholarlyPathOf('magazine-issue', 'spring', null)).toThrow();
  });

  it('maps route segments back to kinds, and nothing else', () => {
    expect(standaloneKindOfSegment('research-papers')).toBe('research-paper');
    expect(standaloneKindOfSegment('magazines')).toBe('magazine');
    expect(standaloneKindOfSegment('books')).toBeNull();
    expect(standaloneKindOfSegment('issues')).toBeNull();
  });

  it('links a DOI to its resolver with every segment encoded', () => {
    expect(doiHref('10.1234/a;b:c')).toBe('https://doi.org/10.1234/a%3Bb%3Ac');
  });
});

describe('presentation', () => {
  it('resolves a label by interface locale, then primary locale — never inventing one', () => {
    const record = {
      primaryLocale: 'ur' as const,
      labels: [
        { locale: 'ur' as const, title: 'اردو عنوان', summary: '' },
        { locale: 'en' as const, title: 'English title', summary: '' },
      ],
    };
    expect(scholarlyLabel(record, 'en').title).toBe('English title');
    expect(scholarlyLabel(record, 'ar').locale).toBe('ur');
  });

  it('splits plain text into paragraphs on blank lines only', () => {
    expect(paragraphsOf('One line\ncontinues.\r\n\r\n  Two.  \n\n\n')).toEqual([
      'One line\ncontinues.',
      'Two.',
    ]);
  });
});

describe('the search projection Library hands to Search', () => {
  function reader(record: ScholarlySearchRecord | null): LibraryPublicReaderPort {
    return {
      scholarlySearchRecord: async () => record,
      scholarlySearchList: async () => [{ id: 'r1', stamp: '3' }],
    } as unknown as LibraryPublicReaderPort;
  }

  const base: ScholarlySearchRecord = {
    kind: 'research-paper',
    id: 'r1',
    stamp: '3',
    primaryLocale: 'en',
    labels: [{ locale: 'en', title: 'Synthetic paper', summary: '' }],
    languageCode: 'ar',
    publicationYear: 2022,
    topicIds: [TOPIC],
    text: ['ملخص تجريبي', 'نص تجريبي'],
    parentLabels: [],
  };

  it('carries the record’s own words only in a document written in its content language', async () => {
    const projection = await createScholarlySearchSource(
      reader(base),
      'research-paper',
    ).project('r1');
    expect(projection?.stamp).toBe('3');
    const documents = projection?.documents ?? [];
    for (const document of documents) {
      expect(searchDocumentSourceSchema.safeParse(document).success).toBe(true);
    }
    // The English label carries NO Arabic text; one Arabic document carries it.
    expect(documents.map((d) => [d.textLanguage, d.contentLanguage, d.body])).toEqual([
      ['en', 'ar', ''],
      ['ar', 'ar', 'ملخص تجريبي\nنص تجريبي'],
    ]);
    expect(documents[1]?.summary).toBe('ملخص تجريبي');
    expect(documents.every((d) => d.year === 2022 && d.topicIds[0] === TOPIC)).toBe(true);
  });

  it('uses the label in the content language, when there is one, instead of an extra document', async () => {
    const record = {
      ...base,
      labels: [
        { locale: 'en' as const, title: 'Synthetic paper', summary: '' },
        { locale: 'ar' as const, title: 'ورقة تجريبية', summary: 'ملخص' },
      ],
    };
    const documents =
      (await createScholarlySearchSource(reader(record), 'research-paper').project('r1'))
        ?.documents ?? [];
    expect(documents.map((d) => d.textLanguage)).toEqual(['en', 'ar']);
    expect(documents[1]?.body).toBe('ملخص تجريبي\nنص تجريبي');
    expect(documents[1]?.summary).toBe('ملخص');
  });

  it('gives a Magazine no content language, and an issue its Magazine’s title to match', async () => {
    const magazine = await createScholarlySearchSource(
      reader({
        ...base,
        kind: 'magazine',
        languageCode: null,
        text: [],
        publicationYear: null,
      }),
      'magazine',
    ).project('r1');
    expect(magazine?.documents.map((d) => d.contentLanguage)).toEqual([null]);

    const issue = await createScholarlySearchSource(
      reader({
        ...base,
        kind: 'magazine-issue',
        languageCode: 'en',
        text: [],
        parentLabels: [{ locale: 'en', title: 'Synthetic monthly', summary: '' }],
      }),
      'magazine-issue',
    ).project('r1');
    expect(issue?.documents.map((d) => d.body)).toEqual(['Synthetic monthly']);
  });

  it('projects nothing for a record that is not public', async () => {
    const source = createScholarlySearchSource(reader(null), 'research');
    expect(await source.project('r1')).toBeNull();
    expect(await source.list({ after: null, limit: 10 })).toEqual([
      { id: 'r1', stamp: '3' },
    ]);
  });
});
