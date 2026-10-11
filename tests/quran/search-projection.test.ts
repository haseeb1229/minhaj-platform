import { describe, expect, it } from 'vitest';

import type {
  AyahSearchRecord,
  QuranPublicReaderPort,
  QuranRef,
} from '../../packages/contracts/src/quran/index.ts';
import {
  SEARCH_SUMMARY_MAX_LENGTH,
  searchDocumentSourceSchema,
} from '../../packages/contracts/src/search/index.ts';
import { createQuranSearchProjection } from '../../apps/web/src/contexts/quran/index.ts';

/**
 * Phase 18 — Quran's search projection, over a fake public reader.
 *
 * WHAT IS PROVED: the citation is the one result; the canonical Arabic is the
 * `ar` document and is never displaced by a layer; each other language of
 * public layer text is one document in deterministic slug order; nothing is
 * normalised or added to a text; and only Ayat the reader says are public now
 * resolve, at `/quran/surah/{surah}/{ayah}`.
 *
 * Every string is a synthetic sentinel. No scripture appears anywhere.
 */

const NEUTRAL = 'نص اختبار غير قرآني';
const TOPIC = '00000000-0000-4000-8000-000000000009';

const layer = (
  slug: string,
  languageCode: string,
  text: string,
  kind: 'translation' | 'transliteration' = 'translation',
) => ({ kind, slug, name: `NON_QURAN_FIXTURE ${slug}`, languageCode, text });

const record = (overrides: Partial<AyahSearchRecord> = {}): AyahSearchRecord => ({
  surah: 2,
  ayah: 3,
  text: `NON_QURAN_FIXTURE_CANONICAL_2_3 ${NEUTRAL}`,
  stamp: 'fixture-stamp-1',
  topicIds: [TOPIC],
  layers: [],
  ...overrides,
});

function harness(options: {
  readonly record?: AyahSearchRecord | null;
  readonly scopes?: readonly { readonly ref: QuranRef; readonly stamp: string }[];
  readonly visible?: (refs: readonly QuranRef[]) => readonly QuranRef[];
}) {
  const asked: { readonly method: string; readonly args: readonly unknown[] }[] = [];
  const reader = {
    async searchAyah(ref: QuranRef) {
      asked.push({ method: 'searchAyah', args: [ref] });
      return options.record === undefined ? record() : options.record;
    },
    async searchAyahScopes(after: QuranRef | null, limit: number) {
      asked.push({ method: 'searchAyahScopes', args: [after, limit] });
      return options.scopes ?? [];
    },
    async publicAyahTargets(refs: readonly QuranRef[]) {
      asked.push({ method: 'publicAyahTargets', args: [refs] });
      return options.visible ? options.visible(refs) : refs;
    },
  } as unknown as QuranPublicReaderPort;
  return { projection: createQuranSearchProjection(reader), asked };
}

describe('project', () => {
  it('projects the canonical text as the ar document of the citation', async () => {
    const { projection } = harness({});
    const projected = await projection.source.project('2:3');
    expect(projected).toEqual({
      stamp: 'fixture-stamp-1',
      documents: [
        {
          kind: 'quran-ayah',
          resourceId: '2:3',
          textLanguage: 'ar',
          contentLanguage: 'ar',
          title: '2:3',
          summary: `NON_QURAN_FIXTURE_CANONICAL_2_3 ${NEUTRAL}`,
          body: '',
          year: null,
          topicIds: [TOPIC],
        },
      ],
    });
    for (const document of projected?.documents ?? [])
      expect(searchDocumentSourceSchema.safeParse(document).success).toBe(true);
  });

  it('projects one document per layer language, in slug order, summarised by the first', async () => {
    const { projection } = harness({
      record: record({
        layers: [
          layer('zeta-fixture', 'en', 'NON_QURAN_FIXTURE_EN_ZETA'),
          layer('alpha-fixture', 'en', 'NON_QURAN_FIXTURE_EN_ALPHA'),
          layer('beta-fixture', 'ur', 'NON_QURAN_FIXTURE_UR_BETA'),
          layer('gamma-fixture', 'en', 'NON_QURAN_FIXTURE_EN_GAMMA', 'transliteration'),
        ],
      }),
    });
    const documents = (await projection.source.project('2:3'))?.documents ?? [];
    expect(documents.map((document) => document.textLanguage)).toEqual([
      'ar',
      'en',
      'ur',
    ]);

    const english = documents[1];
    expect(english).toMatchObject({
      resourceId: '2:3',
      title: '2:3',
      contentLanguage: 'en',
      summary: 'NON_QURAN_FIXTURE_EN_ALPHA',
      body: 'NON_QURAN_FIXTURE_EN_GAMMA\n\nNON_QURAN_FIXTURE_EN_ZETA',
      topicIds: [TOPIC],
    });
    expect(documents[2]).toMatchObject({
      contentLanguage: 'ur',
      summary: 'NON_QURAN_FIXTURE_UR_BETA',
      body: '',
    });
    for (const document of documents)
      expect(searchDocumentSourceSchema.safeParse(document).success).toBe(true);
  });

  it('never lets an Arabic-language layer stand in for the canonical text', async () => {
    const { projection } = harness({
      record: record({
        layers: [layer('arabic-fixture', 'ar', 'NON_QURAN_FIXTURE_AR_LAYER')],
      }),
    });
    const documents = (await projection.source.project('2:3'))?.documents ?? [];
    expect(documents).toHaveLength(1);
    expect(documents[0]).toMatchObject({
      textLanguage: 'ar',
      summary: `NON_QURAN_FIXTURE_CANONICAL_2_3 ${NEUTRAL}`,
      body: 'NON_QURAN_FIXTURE_AR_LAYER',
    });
  });

  it('groups one language however its code is cased', async () => {
    const { projection } = harness({
      record: record({
        layers: [
          layer('a-fixture', 'en-GB', 'NON_QURAN_FIXTURE_A'),
          layer('b-fixture', 'en-gb', 'NON_QURAN_FIXTURE_B'),
        ],
      }),
    });
    const documents = (await projection.source.project('2:3'))?.documents ?? [];
    expect(documents.map((document) => document.textLanguage)).toEqual(['ar', 'en-GB']);
  });

  it('bounds the summary by code point, adds nothing, and keeps the whole text matchable', async () => {
    const long = `\u{1D400}${'بَ'.repeat(SEARCH_SUMMARY_MAX_LENGTH)}`;
    const { projection } = harness({ record: record({ text: long }) });
    const [canonical] = (await projection.source.project('2:3'))?.documents ?? [];
    const summary = [...(canonical?.summary ?? '')];
    expect(summary).toHaveLength(SEARCH_SUMMARY_MAX_LENGTH);
    expect(long.startsWith(canonical?.summary ?? '-')).toBe(true);
    expect(canonical?.body).toBe(long);
  });

  it('passes texts through exactly — no normalisation', async () => {
    const text = 'é ی بَ‍';
    const { projection } = harness({
      record: record({ text, layers: [layer('x-fixture', 'en', ` ${text}`)] }),
    });
    const documents = (await projection.source.project('2:3'))?.documents ?? [];
    expect(documents[0]?.summary).toBe(text);
    expect(documents[1]?.summary).toBe(` ${text}`);
  });

  it('is absent when the reader says the Ayah is not public', async () => {
    const { projection } = harness({ record: null });
    expect(await projection.source.project('2:3')).toBeNull();
  });

  it('asks nothing for an identifier that is not a canonical citation', async () => {
    const { projection, asked } = harness({});
    for (const id of ['02:3', '2:03', '2-3', '0:1', '115:1', '2:3:4', 'x', ''])
      expect(await projection.source.project(id), id).toBeNull();
    expect(asked).toEqual([]);
  });
});

describe('list', () => {
  it('enumerates the reader scopes as citations, continuing from a citation', async () => {
    const { projection, asked } = harness({
      scopes: [
        { ref: { surah: 1, ayah: 7 }, stamp: 's1' },
        { ref: { surah: 2, ayah: 1 }, stamp: 's2' },
      ],
    });
    expect(await projection.source.list({ after: null, limit: 50 })).toEqual([
      { id: '1:7', stamp: 's1' },
      { id: '2:1', stamp: 's2' },
    ]);
    await projection.source.list({ after: '2:1', limit: 50 });
    expect(asked.map((entry) => entry.args)).toEqual([
      [null, 50],
      [{ surah: 2, ayah: 1 }, 50],
    ]);
  });

  it('refuses a cursor it did not produce rather than guessing a position', async () => {
    const { projection, asked } = harness({});
    await expect(
      projection.source.list({ after: 'garbage', limit: 50 }),
    ).rejects.toThrow();
    expect(asked).toEqual([]);
  });
});

describe('target', () => {
  it('resolves only Ayat public now, at their permanent citation address', async () => {
    const { projection, asked } = harness({
      visible: (refs) => refs.filter((ref) => ref.surah !== 9),
    });
    const resolved = await projection.target(['2:3', '9:1', 'nope', '02:3', '2:3']);
    expect([...resolved]).toEqual([['2:3', '/quran/surah/2/3']]);
    expect(asked).toEqual([
      {
        method: 'publicAyahTargets',
        args: [
          [
            { surah: 2, ayah: 3 },
            { surah: 9, ayah: 1 },
          ],
        ],
      },
    ]);
  });

  it('asks nothing when no id is a citation', async () => {
    const { projection, asked } = harness({});
    expect((await projection.target(['x', ''])).size).toBe(0);
    expect(asked).toEqual([]);
  });
});
