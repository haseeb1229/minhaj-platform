import { describe, expect, it } from 'vitest';

import type {
  PublicRecitationSegment,
  TafsirEntryRecord,
} from '../../packages/contracts/src/quran/index.ts';
import {
  DEFAULT_TEXT_SIZE,
  NO_READING_CHOICE,
  ayahAnchor,
  ayahPath,
  ayahPathOf,
  juzPath,
  nextAyah,
  offsetPathOf,
  pageLinks,
  previousAyah,
  quranSearchRequest,
  readAyahSegment,
  readJuzSegment,
  readQuranOffset,
  readReadingRequest,
  readSlugSegment,
  readSurahSegment,
  recitationAssetPath,
  segmentCovering,
  surahName,
  surahPath,
  tafsirPlacement,
  tajweedLocales,
  tajweedTextFor,
  withReading,
} from '../../apps/web/src/components/quran/presentation.ts';
import {
  citationOfResource,
  quranHitLayer,
} from '../../apps/web/src/components/search/quran-hit.ts';

/**
 * Phase 18 — the public Quran surfaces' pure presentation decisions.
 *
 * EVERY NUMBER HERE IS SYNTHETIC. No Surah length, Juz boundary, name or text
 * of the Quran is written in this file: counts are arbitrary values chosen to
 * exercise a boundary, and the only "text" is unmistakable sentinel text. A
 * test that needed a real fact of the corpus would be the wrong test.
 */

describe('a citation has exactly one address', () => {
  it('builds the canonical Ayah citation, locale-free and prefixed once', () => {
    expect(ayahPathOf({ surah: 2, ayah: 3 })).toBe('/quran/surah/2/3');
    expect(ayahPath('ur', { surah: 2, ayah: 3 })).toBe('/ur/quran/surah/2/3');
    expect(surahPath('ar', 7)).toBe('/ar/quran/surah/7');
    expect(juzPath('en', 4)).toBe('/en/quran/juz/4');
    expect(ayahAnchor(12)).toBe('ayah-12');
  });

  it('addresses recitation bytes by recitation, segment and asset, encoded', () => {
    expect(
      recitationAssetPath({ recitationId: 'r/1', segmentId: 's 2', assetId: 'a?3' }),
    ).toBe('/assets/quran/recitations/r%2F1/s%202/a%3F3');
  });
});

describe('path segments are canonical decimals within the structural ceilings', () => {
  it.each([
    ['1', 1],
    ['114', 114],
    ['115', null],
    ['0', null],
    ['01', null],
    ['2a', null],
    ['+2', null],
    [' 2', null],
    ['', null],
    ['1e2', null],
  ])('reads Surah segment %j as %j', (segment, expected) => {
    expect(readSurahSegment(segment)).toBe(expected);
  });

  it('bounds an Ayah by the structural ceiling and a Juz by its range', () => {
    expect(readAyahSegment('999')).toBe(999);
    expect(readAyahSegment('1000')).toBeNull();
    expect(readJuzSegment('30')).toBe(30);
    expect(readJuzSegment('31')).toBeNull();
    expect(readJuzSegment('0')).toBeNull();
  });

  it('accepts only an immutable-slug shape for a work or rule', () => {
    expect(readSlugSegment('fixture-work-one')).toBe('fixture-work-one');
    for (const bad of ['Fixture', 'a', 'x--y', '-x', 'x-', '../x', 'x y', 'x%2Fy'])
      expect(readSlugSegment(bad), bad).toBeNull();
  });
});

describe('reading preferences are validated, never broadened', () => {
  it('reads nothing as nothing, at the default size', () => {
    const request = readReadingRequest({});
    expect(request.translation).toEqual({ state: 'none' });
    expect(request.transliteration).toEqual({ state: 'none' });
    expect(request.tafsir).toEqual({ state: 'none' });
    expect(request.reciter).toEqual({ state: 'none' });
    expect(request.size).toBe(DEFAULT_TEXT_SIZE);
  });

  it('reads one well-formed slug per layer as a request', () => {
    const request = readReadingRequest({
      translation: 'fixture-translation',
      tafsir: 'fixture-tafsir',
      reciter: 'fixture-recitation',
      transliteration: 'fixture-scheme',
      size: 'larger',
    });
    expect(request.translation).toEqual({
      state: 'requested',
      slug: 'fixture-translation',
    });
    expect(request.tafsir).toEqual({ state: 'requested', slug: 'fixture-tafsir' });
    expect(request.reciter).toEqual({ state: 'requested', slug: 'fixture-recitation' });
    expect(request.size).toBe('larger');
  });

  it('marks a repeated or malformed value INVALID rather than choosing one', () => {
    const request = readReadingRequest({
      translation: ['first-work', 'second-work'],
      tafsir: 'Not A Slug',
      reciter: '../../escape',
      transliteration: 'x'.repeat(200),
    });
    expect(request.translation).toEqual({ state: 'invalid' });
    expect(request.tafsir).toEqual({ state: 'invalid' });
    expect(request.reciter).toEqual({ state: 'invalid' });
    expect(request.transliteration).toEqual({ state: 'invalid' });
  });

  it('treats an unknown size as the default display size', () => {
    expect(readReadingRequest({ size: 'enormous' }).size).toBe(DEFAULT_TEXT_SIZE);
    expect(readReadingRequest({ size: ['large', 'small'] }).size).toBe(DEFAULT_TEXT_SIZE);
  });

  it('keeps the canonical citation bare when nothing is chosen', () => {
    expect(withReading('/en/quran/surah/2/3', NO_READING_CHOICE)).toBe(
      '/en/quran/surah/2/3',
    );
  });

  it('carries only confirmed preferences, in a fixed order, with the default size omitted', () => {
    expect(
      withReading('/en/quran/surah/2', {
        ...NO_READING_CHOICE,
        reciter: 'fixture-recitation',
        translation: 'fixture-translation',
      }),
    ).toBe(
      '/en/quran/surah/2?translation=fixture-translation&reciter=fixture-recitation',
    );
    expect(
      withReading(
        '/en/quran/surah/2',
        { ...NO_READING_CHOICE, size: 'large' },
        {},
        'ayah-4',
      ),
    ).toBe('/en/quran/surah/2?size=large#ayah-4');
    expect(
      withReading(
        '/en/quran/surah/2',
        { ...NO_READING_CHOICE, tafsir: 'fixture-tafsir' },
        { tafsir: null },
      ),
    ).toBe('/en/quran/surah/2');
  });
});

describe('quran search passes only its own parameters, with the kind fixed', () => {
  it('fixes the type to quran-ayah whatever the URL says', () => {
    expect(
      quranSearchRequest({ q: 'sentinel', type: 'article', topic: 'quran', page: '2' }),
    ).toEqual({ q: 'sentinel', type: 'quran-ayah', page: '2' });
  });

  it('takes the first of a repeated parameter and drops everything else', () => {
    expect(
      quranSearchRequest({ q: ['one', 'two'], language: 'ur', from: '1990' }),
    ).toEqual({ q: 'one', type: 'quran-ayah' });
    expect(quranSearchRequest({})).toEqual({ q: '', type: 'quran-ayah' });
  });
});

describe('paging is bounded and deterministic', () => {
  it.each([
    [{ offset: '100' }, 100],
    [{ offset: '0' }, 0],
    [{ offset: '-1' }, 0],
    [{ offset: 'abc' }, 0],
    [{ offset: ['100', '200'] }, 0],
    [{ offset: '999999' }, 0],
    [{ offset: '25001' }, 0],
    [{}, 0],
  ])('reads %j as offset %j', (query, expected) => {
    expect(readQuranOffset(query)).toBe(expected);
  });

  it('offers previous and next only where a page exists', () => {
    expect(pageLinks(0, 50, 10)).toEqual({ previous: null, next: null });
    expect(pageLinks(0, 50, 120)).toEqual({ previous: null, next: 50 });
    expect(pageLinks(100, 50, 120)).toEqual({ previous: 50, next: null });
    expect(pageLinks(20, 50, 120)).toEqual({ previous: 0, next: 70 });
    expect(offsetPathOf('/en/quran/juz/1', 0)).toBe('/en/quran/juz/1');
    expect(offsetPathOf('/en/quran/juz/1', 100)).toBe('/en/quran/juz/1?offset=100');
  });
});

describe('ayah navigation uses the counts the reader supplies', () => {
  // Synthetic counts: a previous Surah of 9 ayat, a current Surah of 5.
  it('steps back within a Surah and across into the previous one', () => {
    expect(previousAyah({ surah: 3, ayah: 2 }, null)).toEqual({ surah: 3, ayah: 1 });
    expect(previousAyah({ surah: 3, ayah: 1 }, 9)).toEqual({ surah: 2, ayah: 9 });
    expect(previousAyah({ surah: 1, ayah: 1 }, 9)).toBeNull();
    expect(previousAyah({ surah: 3, ayah: 1 }, null)).toBeNull();
  });

  it('steps forward within a Surah and across only when a next Surah exists', () => {
    expect(nextAyah({ surah: 3, ayah: 4 }, 5, false)).toEqual({ surah: 3, ayah: 5 });
    expect(nextAyah({ surah: 3, ayah: 5 }, 5, true)).toEqual({ surah: 4, ayah: 1 });
    expect(nextAyah({ surah: 3, ayah: 5 }, 5, false)).toBeNull();
    expect(nextAyah({ surah: 114, ayah: 5 }, 5, true)).toBeNull();
  });
});

describe('layers are placed against the ayat they cover', () => {
  const segment = (id: string, surah: number, start: number, end: number) =>
    ({
      id,
      surah,
      startAyah: start,
      endAyah: end,
      assetId: `asset-${id}`,
    }) satisfies PublicRecitationSegment;

  it('finds the recitation segment covering an Ayah, and none outside every range', () => {
    const segments = [
      segment('a', 2, 1, 4),
      segment('b', 2, 5, 8),
      segment('c', 3, 1, 2),
    ];
    expect(segmentCovering(segments, { surah: 2, ayah: 4 })?.id).toBe('a');
    expect(segmentCovering(segments, { surah: 2, ayah: 5 })?.id).toBe('b');
    expect(segmentCovering(segments, { surah: 3, ayah: 2 })?.id).toBe('c');
    expect(segmentCovering(segments, { surah: 2, ayah: 9 })).toBeNull();
    expect(segmentCovering(segments, { surah: 4, ayah: 1 })).toBeNull();
  });

  const entry = (id: string, start: number, end: number): TafsirEntryRecord => ({
    id,
    surah: 2,
    startAyah: start,
    endAyah: end,
    text: 'NON_QURAN_FIXTURE_TAFSIR',
  });

  it('shows a Tafsir entry after the last shown Ayah of its range', () => {
    const placed = tafsirPlacement(
      [entry('span', 2, 4), entry('tail', 4, 9), entry('outside', 7, 8)],
      [1, 2, 3, 4, 5],
    );
    expect(placed.get(4)?.map((e) => e.id)).toEqual(['span']);
    expect(placed.get(5)?.map((e) => e.id)).toEqual(['tail']);
    expect([...placed.values()].flat().some((e) => e.id === 'outside')).toBe(false);
  });

  it('places a range on the one Ayah a citation page shows', () => {
    const placed = tafsirPlacement([entry('span', 2, 4)], [3]);
    expect(placed.get(3)?.map((e) => e.id)).toEqual(['span']);
  });
});

describe('labels name what they are in the language they are in', () => {
  it('prefers the reader’s own Surah name, then falls back WITH its locale', () => {
    expect(surahName({ names: { en: 'Fixture name', ur: 'فکسچر' } }, 'ur')).toEqual({
      text: 'فکسچر',
      locale: 'ur',
    });
    expect(surahName({ names: { en: 'Fixture name' } }, 'ar')).toEqual({
      text: 'Fixture name',
      locale: 'en',
    });
    expect(surahName({ names: {} }, 'en')).toBeNull();
  });

  it('shows a Tajweed rule in the reader’s language, or says it is falling back', () => {
    const rule = {
      texts: [
        { languageCode: 'ur', title: 'فکسچر', body: 'NON_QURAN_FIXTURE_RULE' },
        { languageCode: 'de', title: 'Fixture', body: 'NON_QURAN_FIXTURE_RULE' },
      ],
    };
    expect(tajweedTextFor(rule, 'ur')).toMatchObject({ fallback: false });
    expect(tajweedTextFor(rule, 'en')).toMatchObject({
      fallback: true,
      text: { languageCode: 'ur' },
    });
    expect(tajweedTextFor({ texts: [] }, 'en')).toBeNull();
    // Only interface locales are alternates; another content language is not.
    expect(tajweedLocales(rule)).toEqual(['ur']);
  });

  it('labels only the canonical `ar` document of a search result as the Arabic', () => {
    expect(quranHitLayer('ar')).toBe('arabic');
    for (const language of ['ur', 'en', 'ar-Latn', 'fa'])
      expect(quranHitLayer(language), language).toBe('layer');
  });

  it('reads a result’s citation only from an exact `surah:ayah` identity', () => {
    expect(citationOfResource('2:3')).toEqual({ surah: 2, ayah: 3 });
    for (const bad of ['2', '2:', ':3', '02:3', '2:3:4', 'a:b', '00000000-0000'])
      expect(citationOfResource(bad), bad).toBeNull();
  });
});
