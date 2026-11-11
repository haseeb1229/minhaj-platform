import { describe, expect, it } from 'vitest';

import {
  QURAN_PASSAGES_MAX,
  SURAH_AYAH_COUNTS,
  applyPassageChange,
  canonicalPassageOrder,
  distinctPassages,
  isWholeSurah,
  passageCovers,
  passageMatchesQuery,
  passageOverlaps,
  passageQuerySchema,
  quranPassageSchema,
  readStartSeconds,
  surahAyahCount,
  timedQuranPassageSchema,
  videoPassageChangeSchema,
  workPassageChangeSchema,
  type QuranPassage,
} from '../../packages/contracts/src/passage/index.ts';
import { SURAH_AYAH_COUNTS as MIGRATION_COUNTS } from '../../packages/contracts/src/migration/index.ts';

/**
 * Quran Part 8 — a Quran passage as a CITATION VALUE (`@minhaj/contracts/passage`):
 * the structure check that replaces a foreign key into Quran, the named
 * changes an editor makes, and the query a public "what explains this" read
 * answers. Pure; the SQL half is the Library and Media integration suites.
 */

const passage = (surah: number, ayahFrom: number, ayahTo: number): QuranPassage => ({
  surah,
  ayahFrom,
  ayahTo,
});

describe('the structure a passage is checked against', () => {
  it('is the one list Migration also validates by, moved rather than copied', () => {
    expect(MIGRATION_COUNTS).toBe(SURAH_AYAH_COUNTS);
    expect(SURAH_AYAH_COUNTS).toHaveLength(114);
    expect(SURAH_AYAH_COUNTS.reduce((sum, count) => sum + count, 0)).toBe(6236);
  });

  it('answers a Surah’s count, and nothing for a number that is not a Surah', () => {
    expect(surahAyahCount(1)).toBe(7);
    expect(surahAyahCount(2)).toBe(286);
    expect(surahAyahCount(114)).toBe(6);
    for (const wrong of [0, 115, -1, 1.5, Number.NaN])
      expect(surahAyahCount(wrong)).toBeNull();
  });
});

describe('a passage', () => {
  it('accepts a forward range within its Surah, and a single Ayah', () => {
    for (const valid of [passage(1, 1, 7), passage(2, 255, 255), passage(114, 1, 6)])
      expect(quranPassageSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ['Surah 0', passage(0, 1, 1)],
    ['Surah 115', passage(115, 1, 1)],
    ['Ayah 0', passage(2, 0, 3)],
    ['a backward range', passage(2, 5, 4)],
    ['an end beyond its Surah', passage(1, 1, 8)],
    ['Al-Baqarah 287', passage(2, 287, 287)],
    ['a fractional Ayah', passage(2, 1.5, 3)],
  ])('refuses %s', (_label, value) => {
    expect(quranPassageSchema.safeParse(value).success).toBe(false);
  });

  it('refuses a field nobody named', () => {
    expect(quranPassageSchema.safeParse({ ...passage(1, 1, 7), text: 'x' }).success).toBe(
      false,
    );
  });

  it('carries a lecture’s start within a day, or none', () => {
    expect(
      timedQuranPassageSchema.safeParse({ ...passage(18, 1, 10), startSeconds: null })
        .success,
    ).toBe(true);
    expect(
      timedQuranPassageSchema.safeParse({ ...passage(18, 1, 10), startSeconds: 86_399 })
        .success,
    ).toBe(true);
    expect(
      timedQuranPassageSchema.safeParse({ ...passage(18, 1, 10), startSeconds: 86_400 })
        .success,
    ).toBe(false);
    expect(
      timedQuranPassageSchema.safeParse({ ...passage(18, 1, 10), startSeconds: -1 })
        .success,
    ).toBe(false);
    expect(
      timedQuranPassageSchema.safeParse({ ...passage(18, 1, 111), startSeconds: 0 })
        .success,
    ).toBe(false);
  });

  it('knows whole Surahs, coverage, overlap and canonical order', () => {
    expect(isWholeSurah(passage(1, 1, 7))).toBe(true);
    expect(isWholeSurah(passage(1, 1, 6))).toBe(false);
    expect(passageCovers(passage(2, 255, 257), 2, 256)).toBe(true);
    expect(passageCovers(passage(2, 255, 257), 3, 256)).toBe(false);
    expect(passageOverlaps(passage(2, 255, 257), 2, 250, 255)).toBe(true);
    expect(passageOverlaps(passage(2, 255, 257), 2, 258, 260)).toBe(false);
    expect(
      canonicalPassageOrder([passage(18, 1, 10), passage(2, 255, 255), passage(2, 1, 5)]),
    ).toEqual([passage(2, 1, 5), passage(2, 255, 255), passage(18, 1, 10)]);
  });

  it('answers a passage query by its Surah and overlapping range', () => {
    const query = passageQuerySchema.parse({ surah: 2, ayahFrom: 250, ayahTo: 256 });
    expect(passageMatchesQuery(passage(2, 255, 257), query)).toBe(true);
    expect(passageMatchesQuery(passage(2, 257, 260), query)).toBe(false);
    expect(passageMatchesQuery(passage(3, 1, 200), query)).toBe(false);
    expect(
      passageMatchesQuery(passage(3, 1, 200), passageQuerySchema.parse({ surah: null })),
    ).toBe(true);
    expect(
      passageQuerySchema.safeParse({ surah: 2, ayahFrom: 9, ayahTo: 3 }).success,
    ).toBe(false);
    expect(passageQuerySchema.safeParse({ surah: 2, limit: 201 }).success).toBe(false);
  });
});

describe('an editor’s named changes', () => {
  const current = [passage(1, 1, 7), passage(2, 255, 255), passage(18, 1, 10)];

  it('adds at the end, and refuses a repeated passage or one beyond the ceiling', () => {
    expect(
      applyPassageChange(current, { op: 'add', passage: passage(112, 1, 4) }),
    ).toEqual({
      passages: [...current, passage(112, 1, 4)],
    });
    expect(
      applyPassageChange(current, { op: 'add', passage: passage(2, 255, 255) }),
    ).toEqual({
      refusal: 'duplicate-passage',
    });
    const full = Array.from({ length: QURAN_PASSAGES_MAX }, (_, index) =>
      passage(2, index + 1, index + 1),
    );
    expect(applyPassageChange(full, { op: 'add', passage: passage(3, 1, 1) })).toEqual({
      refusal: 'limit',
    });
  });

  it('moves one step and removes by place, refusing a place that is not there', () => {
    expect(
      applyPassageChange(current, { op: 'move', position: 1, direction: 'earlier' }),
    ).toEqual({
      passages: [current[1], current[0], current[2]],
    });
    expect(
      applyPassageChange(current, { op: 'move', position: 1, direction: 'later' }),
    ).toEqual({
      passages: [current[0], current[2], current[1]],
    });
    expect(
      applyPassageChange(current, { op: 'move', position: 0, direction: 'earlier' }),
    ).toEqual({
      refusal: 'invalid',
    });
    expect(
      applyPassageChange(current, { op: 'move', position: 2, direction: 'later' }),
    ).toEqual({
      refusal: 'invalid',
    });
    expect(applyPassageChange(current, { op: 'remove', position: 0 })).toEqual({
      passages: [current[1], current[2]],
    });
    expect(applyPassageChange(current, { op: 'remove', position: 3 })).toEqual({
      refusal: 'invalid',
    });
  });

  it('parses a change strictly: a Work’s passage has no start, a Video’s may', () => {
    expect(
      workPassageChangeSchema.safeParse({ op: 'add', passage: passage(1, 1, 7) }).success,
    ).toBe(true);
    expect(
      workPassageChangeSchema.safeParse({
        op: 'add',
        passage: { ...passage(1, 1, 7), startSeconds: 5 },
      }).success,
    ).toBe(false);
    expect(
      videoPassageChangeSchema.safeParse({
        op: 'add',
        passage: { ...passage(1, 1, 7), startSeconds: 5 },
      }).success,
    ).toBe(true);
    expect(
      workPassageChangeSchema.safeParse({ op: 'move', position: 1, direction: 'up' })
        .success,
    ).toBe(false);
    expect(
      workPassageChangeSchema.safeParse({ op: 'remove', position: 40 }).success,
    ).toBe(false);
    expect(
      workPassageChangeSchema.safeParse({ op: 'replace', position: 0 }).success,
    ).toBe(false);
  });

  it('accepts a whole proposed set only without repeats and within the ceiling', () => {
    expect(distinctPassages(current)).toBe(true);
    expect(distinctPassages([...current, passage(1, 1, 7)])).toBe(false);
  });
});

describe('a start time as an editor types it', () => {
  it.each([
    ['', null],
    ['  ', null],
    ['754', 754],
    ['12:34', 754],
    ['1:02:03', 3723],
    ['0:00', 0],
  ] as const)('%j is %s', (text, seconds) => {
    expect(readStartSeconds(text)).toBe(seconds);
  });

  it.each(['12:3', '1:60', 'twelve', '-5', '1:02:03:04', '12.5'])(
    '%j is not a time, never zero',
    (text) => {
      expect(readStartSeconds(text)).toBeNaN();
    },
  );

  it('is null with no field at all', () => {
    expect(readStartSeconds(null)).toBeNull();
  });
});
