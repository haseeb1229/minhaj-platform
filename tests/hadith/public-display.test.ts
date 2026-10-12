import { describe, expect, it } from 'vitest';

import type { HadithSearchRecord } from '../../packages/contracts/src/hadith/index.ts';
import {
  SEARCH_SUMMARY_MAX_LENGTH,
  type SearchHit,
} from '../../packages/contracts/src/search/index.ts';
import {
  collectionName,
  derivedDirection,
  hadithSearchRequest,
  readCollectionSegment,
  readHadithOffset,
  readNumberSegment,
  structureName,
} from '../../apps/web/src/components/hadith/presentation.ts';
import {
  hadithHitDisplays,
  hadithHitIds,
  hadithHitKey,
} from '../../apps/web/src/components/search/hadith-hit.ts';

/**
 * Phase 19 — the public Hadith presentation decisions, PURE: which address a
 * segment may name, which name a structure is shown under, and what a `hadith`
 * search result DISPLAYS — the owner's CURRENT text, never the index's summary.
 *
 * NOTHING HERE IS HADITH: every text is a `NON_HADITH_FIXTURE` sentinel.
 */

const STALE = 'NON_HADITH_FIXTURE stale indexed summary';
const CITATION = '00000000-0000-4000-8000-000000000001';

const hit = (resourceId: string, textLanguage: string, kind = 'hadith'): SearchHit =>
  ({
    kind,
    resourceId,
    href: '/hadith/fixture-collection-a/1',
    title: 'fixture-collection-a 1',
    summary: STALE,
    textLanguage,
    contentLanguage: textLanguage,
    year: null,
  }) as SearchHit;

const record = (overrides: Partial<HadithSearchRecord> = {}): HadithSearchRecord => ({
  citationId: CITATION,
  collectionSlug: 'fixture-collection-a',
  number: 1,
  text: 'NON_HADITH_FIXTURE_TEXT_1',
  textLanguage: 'ar',
  translations: [{ languageCode: 'en', text: 'NON_HADITH_FIXTURE_TRANSLATION_1' }],
  topicIds: [],
  stamp: 'stamp',
  ...overrides,
});

describe('what a hadith search result displays', () => {
  it('shows the CURRENT original, labelled as the original, never the summary', () => {
    const displays = hadithHitDisplays([hit(CITATION, 'ar')], [record()]);
    expect(displays.get(hadithHitKey(hit(CITATION, 'ar')))).toEqual({
      layer: 'original',
      language: 'ar',
      text: 'NON_HADITH_FIXTURE_TEXT_1',
      collectionSlug: 'fixture-collection-a',
      number: 1,
    });
  });

  it('shows a current translation as a translation, never as the original', () => {
    const displays = hadithHitDisplays([hit(CITATION, 'EN')], [record()]);
    expect(displays.get(hadithHitKey(hit(CITATION, 'EN')))).toMatchObject({
      layer: 'translation',
      language: 'en',
      text: 'NON_HADITH_FIXTURE_TRANSLATION_1',
    });
  });

  it('falls back to the original when the translation is withdrawn', () => {
    const displays = hadithHitDisplays(
      [hit(CITATION, 'en')],
      [record({ translations: [] })],
    );
    const shown = displays.get(hadithHitKey(hit(CITATION, 'en')));
    expect(shown?.layer).toBe('original');
    expect(shown?.text).not.toContain('stale');
  });

  it('omits a citation that is not public now, and ignores other kinds', () => {
    const displays = hadithHitDisplays(
      [hit(CITATION, 'ar'), hit('1:1', 'ar', 'quran-ayah')],
      [],
    );
    expect(displays.size).toBe(0);
    expect(
      hadithHitIds([hit(CITATION, 'ar'), hit(CITATION, 'en'), hit('x', 'ar', 'video')]),
    ).toEqual([CITATION]);
  });

  it('cuts a long text to the summary bound by code point', () => {
    const long = '\u{1F600}'.repeat(SEARCH_SUMMARY_MAX_LENGTH + 5);
    const displays = hadithHitDisplays([hit(CITATION, 'ar')], [record({ text: long })]);
    expect([
      ...(displays.get(hadithHitKey(hit(CITATION, 'ar')))?.text ?? ''),
    ]).toHaveLength(SEARCH_SUMMARY_MAX_LENGTH);
  });
});

describe('Hadith addresses and names', () => {
  it('refuses a section word, a malformed slug and a non-canonical number', () => {
    expect(readCollectionSegment('fixture-collection-a')).toBe('fixture-collection-a');
    for (const word of ['search', 'collections', 'browse', 'articles', 'scholars'])
      expect(readCollectionSegment(word), word).toBeNull();
    expect(readCollectionSegment('Fixture')).toBeNull();
    expect(readNumberSegment('7')).toBe(7);
    for (const bad of ['0', '07', '1000000', '7a', '-1', ''])
      expect(readNumberSegment(bad), bad).toBeNull();
  });

  it('reads a bounded offset and fixes the search type', () => {
    expect(readHadithOffset({ offset: '50' })).toBe(50);
    expect(readHadithOffset({ offset: '-5' })).toBe(0);
    expect(readHadithOffset({ offset: ['50', '100'] })).toBe(0);
    expect(hadithSearchRequest({ q: 'x', type: 'video', page: '2', topic: 't' })).toEqual(
      {
        q: 'x',
        type: 'hadith',
        page: '2',
      },
    );
  });

  it('sets Arabic right-to-left whatever the interface locale', () => {
    expect(derivedDirection('ar')).toBe('rtl');
    expect(derivedDirection('ur-PK')).toBe('rtl');
    expect(derivedDirection('en')).toBe('ltr');
  });

  it('names a collection in the locale it is actually in', () => {
    const names = [
      { locale: 'ur' as const, name: 'NON_HADITH_FIXTURE_NAME', description: null },
    ];
    expect(collectionName(names, 'en')).toEqual({
      text: 'NON_HADITH_FIXTURE_NAME',
      locale: 'ur',
      description: null,
    });
    expect(collectionName([], 'en')).toBeNull();
  });

  it("falls back to the source's own title in its own language, then to nothing", () => {
    expect(
      structureName(
        { names: [], title: 'NON_HADITH_FIXTURE_TITLE', titleLanguage: 'ar' },
        'en',
      ),
    ).toEqual({ text: 'NON_HADITH_FIXTURE_TITLE', language: 'ar' });
    expect(
      structureName({ names: [], title: null, titleLanguage: null }, 'en'),
    ).toBeNull();
  });
});
