import { describe, expect, it } from 'vitest';

import type {
  HadithCitationTarget,
  HadithPublicReaderPort,
  HadithSearchRecord,
} from '../../packages/contracts/src/hadith/index.ts';
import {
  SEARCH_SUMMARY_MAX_LENGTH,
  searchDocumentSourceSchema,
} from '../../packages/contracts/src/search/index.ts';
import {
  createHadithSearchProjection,
  hadithCitationPath,
} from '../../apps/web/src/contexts/hadith/index.ts';

/**
 * Phase 19 — Hadith's search projection, over a fake public reader.
 *
 * WHAT IS PROVED: the public citation is the one result; the record's own text
 * is the document in its own language and is never displaced by a translation;
 * each other language of public translation is one document; nothing about a
 * chain, a grading or a commentary reaches the index; nothing is normalised or
 * added to a text; a foreign cursor is refused; and only citations the reader
 * says are public now resolve, at `/hadith/{collection}/{number}`.
 *
 * Every string is a synthetic sentinel. No Hadith text appears anywhere.
 */

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CITATION = ID(1);
const TOPIC = ID(9);
const NEUTRAL = 'نص اختبار';

const record = (overrides: Partial<HadithSearchRecord> = {}): HadithSearchRecord => ({
  citationId: CITATION,
  collectionSlug: 'fixture-collection-a',
  number: 7,
  text: `NON_HADITH_FIXTURE_TEXT_1 ${NEUTRAL}`,
  textLanguage: 'ar',
  translations: [],
  topicIds: [TOPIC],
  stamp: 'fixture-stamp-1',
  ...overrides,
});

function harness(options: {
  readonly record?: HadithSearchRecord | null;
  readonly scopes?: readonly { readonly id: string; readonly stamp: string }[];
  readonly visible?: (ids: readonly string[]) => readonly HadithCitationTarget[];
}) {
  const asked: { readonly method: string; readonly args: readonly unknown[] }[] = [];
  const reader = {
    async searchCitation(id: string) {
      asked.push({ method: 'searchCitation', args: [id] });
      return options.record === undefined ? record() : options.record;
    },
    async searchCitationScopes(after: string | null, limit: number) {
      asked.push({ method: 'searchCitationScopes', args: [after, limit] });
      return options.scopes ?? [];
    },
    async publicCitationTargets(ids: readonly string[]) {
      asked.push({ method: 'publicCitationTargets', args: [ids] });
      return options.visible
        ? options.visible(ids)
        : ids.map((citationId) => ({
            citationId,
            collectionSlug: 'fixture-collection-a',
            number: 7,
          }));
    },
  } as unknown as HadithPublicReaderPort;
  return { projection: createHadithSearchProjection(reader), asked };
}

describe('project', () => {
  it('projects the record text as one document of the citation, in its own language', async () => {
    const { projection } = harness({});
    const projected = await projection.source.project(CITATION);
    expect(projected).toEqual({
      stamp: 'fixture-stamp-1',
      documents: [
        {
          kind: 'hadith',
          resourceId: CITATION,
          textLanguage: 'ar',
          contentLanguage: 'ar',
          title: 'fixture-collection-a 7',
          summary: `NON_HADITH_FIXTURE_TEXT_1 ${NEUTRAL}`,
          body: '',
          year: null,
          topicIds: [TOPIC],
        },
      ],
    });
    for (const document of projected?.documents ?? [])
      expect(searchDocumentSourceSchema.safeParse(document).success).toBe(true);
  });

  it('adds one document per other translation language, many translations in one', async () => {
    const { projection } = harness({
      record: record({
        translations: [
          { languageCode: 'en', text: 'NON_HADITH_FIXTURE_TRANSLATION_1' },
          { languageCode: 'ur', text: 'NON_HADITH_FIXTURE_TRANSLATION_2' },
          { languageCode: 'EN', text: 'NON_HADITH_FIXTURE_TRANSLATION_3' },
        ],
      }),
    });
    const documents = (await projection.source.project(CITATION))?.documents ?? [];
    expect(documents.map((document) => document.textLanguage)).toEqual([
      'ar',
      'en',
      'ur',
    ]);
    expect(new Set(documents.map((document) => document.resourceId))).toEqual(
      new Set([CITATION]),
    );
    const english = documents[1];
    expect(english).toMatchObject({
      kind: 'hadith',
      contentLanguage: 'en',
      title: 'fixture-collection-a 7',
      summary: 'NON_HADITH_FIXTURE_TRANSLATION_1',
      body: 'NON_HADITH_FIXTURE_TRANSLATION_3',
    });
    for (const document of documents)
      expect(searchDocumentSourceSchema.safeParse(document).success).toBe(true);
  });

  it('matches a same-language translation in the body, never as the summary', async () => {
    const { projection } = harness({
      record: record({
        translations: [{ languageCode: 'AR', text: 'NON_HADITH_FIXTURE_TRANSLATION_4' }],
      }),
    });
    const documents = (await projection.source.project(CITATION))?.documents ?? [];
    expect(documents).toHaveLength(1);
    expect(documents[0]?.summary).toBe(`NON_HADITH_FIXTURE_TEXT_1 ${NEUTRAL}`);
    expect(documents[0]?.body).toBe('NON_HADITH_FIXTURE_TRANSLATION_4');
  });

  it('cuts the summary by code point, keeps the whole text in the body, adds nothing', async () => {
    const astral = '\u{1D400}';
    const text = `${'ب'.repeat(SEARCH_SUMMARY_MAX_LENGTH - 1)}${astral}${astral}NON_HADITH_FIXTURE_TEXT_2`;
    const { projection } = harness({ record: record({ text }) });
    const [document] = (await projection.source.project(CITATION))?.documents ?? [];
    expect([...(document?.summary ?? '')]).toHaveLength(SEARCH_SUMMARY_MAX_LENGTH);
    expect(document?.summary.endsWith(astral)).toBe(true);
    expect(document?.body).toBe(text);
  });

  it('indexes no chain, grading, grader or commentary — the reader record carries none', async () => {
    const leaky = {
      ...record(),
      chain: 'NON_HADITH_FIXTURE_CHAIN_1',
      gradings: [
        { grader: 'NON_HADITH_FIXTURE_GRADER_1', label: 'NON_HADITH_FIXTURE_GRADING_1' },
      ],
      commentary: ['NON_HADITH_FIXTURE_COMMENTARY_1'],
      evidence: 'NON_HADITH_FIXTURE_EVIDENCE_1',
    } as HadithSearchRecord;
    const { projection } = harness({ record: leaky });
    const serialised = JSON.stringify(await projection.source.project(CITATION));
    for (const absent of ['CHAIN', 'GRADING', 'GRADER', 'COMMENTARY', 'EVIDENCE'])
      expect(serialised).not.toContain(`NON_HADITH_FIXTURE_${absent}`);
  });

  it('projects nothing for a citation the reader withholds, or an id that is not one', async () => {
    const { projection, asked } = harness({ record: null });
    expect(await projection.source.project(CITATION)).toBeNull();
    expect(await projection.source.project('fixture-collection-a:7')).toBeNull();
    expect(await projection.source.project('7')).toBeNull();
    expect(asked.map((entry) => entry.args[0])).toEqual([CITATION]);
  });
});

describe('list', () => {
  it('enumerates the reader scopes after a cursor it produced', async () => {
    const scopes = [
      { id: ID(2), stamp: 's2' },
      { id: ID(3), stamp: 's3' },
    ];
    const { projection, asked } = harness({ scopes });
    expect(await projection.source.list({ after: null, limit: 50 })).toEqual(scopes);
    expect(await projection.source.list({ after: ID(3), limit: 50 })).toEqual(scopes);
    expect(asked.map((entry) => entry.args)).toEqual([
      [null, 50],
      [ID(3), 50],
    ]);
  });

  it('refuses a foreign cursor rather than guessing a position', async () => {
    const { projection, asked } = harness({});
    for (const after of ['2:3', 'fixture-collection-a 7', ''])
      await expect(projection.source.list({ after, limit: 50 })).rejects.toThrow(
        /cursor/u,
      );
    expect(asked).toEqual([]);
  });
});

describe('target', () => {
  it('addresses only the citations the reader says are public now', async () => {
    const { projection, asked } = harness({
      visible: (ids) =>
        ids
          .filter((id) => id === ID(4))
          .map((citationId) => ({
            citationId,
            collectionSlug: 'fixture-collection-b',
            number: 12,
          })),
    });
    const found = await projection.target([ID(4), ID(5), ID(4), 'not-an-id']);
    expect([...found.entries()]).toEqual([[ID(4), '/hadith/fixture-collection-b/12']]);
    expect(asked).toEqual([{ method: 'publicCitationTargets', args: [[ID(4), ID(5)]] }]);
  });

  it('asks nothing when no id is a citation', async () => {
    const { projection, asked } = harness({});
    expect((await projection.target(['2:3', 'x'])).size).toBe(0);
    expect(asked).toEqual([]);
  });

  it('builds the permanent, locale-free citation address', () => {
    expect(
      hadithCitationPath({ collectionSlug: 'fixture-collection-a', number: 7 }),
    ).toBe('/hadith/fixture-collection-a/7');
  });
});
