import { describe, expect, it } from 'vitest';

import {
  RECITATION_STREAM_ORIGINS,
  RECITATION_TIMING_MAX_MS,
  recitationSegmentInputSchema,
  recitationStreamOf,
  recitationStreamSchema,
  recitationStreamUrl,
  timingProblem,
  type AyahTiming,
} from '../../packages/contracts/src/quran/index.ts';

/**
 * Quran Part 5 — the CONTRACT's recitation rules: a segment's per-Ayah timing
 * covers its range exactly once, non-empty and monotonic; a streamed
 * recitation's location is an allowlisted provider and a path of its one
 * shape, never a URL, and the one address of each Surah's file is derived from
 * them.
 *
 * NOTHING HERE IS THE QURAN. Timings are made-up milliseconds; the stream
 * folders are `NON_QURAN_FIXTURE`-style engineering names.
 */

const span = (ayah: number, startMs: number, endMs: number): AyahTiming => ({
  ayah,
  startMs,
  endMs,
});

describe('a segment is timed for each Ayah exactly once, monotonic and non-empty', () => {
  const range = { startAyah: 3, endAyah: 5 };

  it('accepts a contiguous timing and one with gaps between ayat', () => {
    expect(
      timingProblem(range, [span(3, 0, 10), span(4, 10, 20), span(5, 20, 30)]),
    ).toBeNull();
    // An opening before the first Ayah and pauses between them are not overlaps.
    expect(
      timingProblem(range, [
        span(3, 6420, 9000),
        span(4, 9500, 12000),
        span(5, 12000, 20000),
      ]),
    ).toBeNull();
  });

  it('judges the timing in Ayah order, whatever order it arrives in', () => {
    expect(
      timingProblem(range, [span(5, 20, 30), span(3, 0, 10), span(4, 10, 20)]),
    ).toBeNull();
  });

  it.each([
    ['a missing Ayah', [span(3, 0, 10), span(5, 20, 30)]],
    ['an Ayah twice', [span(3, 0, 10), span(3, 10, 20), span(5, 20, 30)]],
    ['an Ayah outside the range', [span(3, 0, 10), span(4, 10, 20), span(6, 20, 30)]],
    [
      'one more than the range',
      [span(2, 0, 5), span(3, 5, 10), span(4, 10, 20), span(5, 20, 30)],
    ],
    ['nothing at all', []],
  ])('refuses %s as coverage', (_label, timings) => {
    expect(timingProblem(range, timings)).toBe('coverage');
  });

  it('refuses an empty or reversed span', () => {
    expect(timingProblem(range, [span(3, 0, 10), span(4, 10, 10), span(5, 20, 30)])).toBe(
      'empty-span',
    );
    expect(timingProblem(range, [span(3, 0, 10), span(4, 15, 12), span(5, 20, 30)])).toBe(
      'empty-span',
    );
  });

  it('refuses an Ayah that begins before the previous one ends', () => {
    expect(timingProblem(range, [span(3, 0, 10), span(4, 9, 20), span(5, 20, 30)])).toBe(
      'overlap',
    );
  });
});

describe('a segment input carries its timing only when it holds together', () => {
  it('accepts a segment without timing, and one with a valid timing', () => {
    expect(
      recitationSegmentInputSchema.safeParse({ surah: 2, startAyah: 1, endAyah: 2 })
        .success,
    ).toBe(true);
    expect(
      recitationSegmentInputSchema.safeParse({
        surah: 2,
        startAyah: 1,
        endAyah: 2,
        timings: [span(1, 0, 100), span(2, 100, 250)],
      }).success,
    ).toBe(true);
  });

  it.each([
    ['partial', [span(1, 0, 100)]],
    ['overlapping', [span(1, 0, 100), span(2, 50, 250)]],
    ['empty', []],
    ['beyond the ceiling', [span(1, 0, 100), span(2, 100, RECITATION_TIMING_MAX_MS + 1)]],
    ['negative', [span(1, -1, 100), span(2, 100, 250)]],
    ['fractional', [span(1, 0, 100.5), span(2, 101, 250)]],
  ])('refuses a %s timing', (_label, timings) => {
    expect(
      recitationSegmentInputSchema.safeParse({
        surah: 2,
        startAyah: 1,
        endAyah: 2,
        timings,
      }).success,
    ).toBe(false);
  });

  it('refuses a field nobody named in a timing entry', () => {
    expect(
      recitationSegmentInputSchema.safeParse({
        surah: 2,
        startAyah: 1,
        endAyah: 1,
        timings: [{ ayah: 1, startMs: 0, endMs: 10, polygon: '1,2 3,4' }],
      }).success,
    ).toBe(false);
  });
});

describe('a stream is an allowlisted provider and a path, never a URL', () => {
  const good = { provider: 'mp3quran', path: 'audio/non-quran-fixture/r1' } as const;

  it('admits a provider folder of the one shape', () => {
    expect(recitationStreamSchema.safeParse(good).success).toBe(true);
    expect(recitationStreamOf(good.provider, good.path)).toEqual(good);
    expect(recitationStreamOf('mp3quran', 'audio/fixture/r12')).not.toBeNull();
  });

  it.each([
    ['an unknown provider', 'other', 'audio/non-quran-fixture/r1'],
    ['a URL', 'mp3quran', 'https://cdn.mp3quran.net/audio/fixture/r1'],
    ['another host in the path', 'mp3quran', '//evil.example/audio/fixture/r1'],
    ['upper case', 'mp3quran', 'audio/Fixture/r1'],
    ['a parent step', 'mp3quran', 'audio/../r1'],
    ['a trailing slash', 'mp3quran', 'audio/fixture/r1/'],
    ['a file name', 'mp3quran', 'audio/fixture/r1/001.mp3'],
    ['a query', 'mp3quran', 'audio/fixture/r1?x=1'],
    ['no moshaf', 'mp3quran', 'audio/fixture'],
    ['moshaf zero', 'mp3quran', 'audio/fixture/r0'],
    ['a doubled hyphen', 'mp3quran', 'audio/fix--ture/r1'],
    ['an empty path', 'mp3quran', ''],
  ])('fails closed on %s', (_label, provider, path) => {
    expect(recitationStreamOf(provider, path)).toBeNull();
    expect(recitationStreamSchema.safeParse({ provider, path }).success).toBe(false);
  });

  it('is no stream at all when either half is missing', () => {
    expect(recitationStreamOf(null, 'audio/fixture/r1')).toBeNull();
    expect(recitationStreamOf('mp3quran', null)).toBeNull();
  });

  it('derives exactly one address per Surah, zero-padded, on the provider origin', () => {
    expect(recitationStreamUrl(good, 1)).toBe(
      'https://cdn.mp3quran.net/audio/non-quran-fixture/r1/001.mp3',
    );
    expect(recitationStreamUrl(good, 114)).toBe(
      'https://cdn.mp3quran.net/audio/non-quran-fixture/r1/114.mp3',
    );
  });

  it('refuses to derive an address for an impossible Surah or an unadmitted stream', () => {
    expect(() => recitationStreamUrl(good, 0)).toThrow();
    expect(() => recitationStreamUrl(good, 115)).toThrow();
    expect(() => recitationStreamUrl(good, 2.5)).toThrow();
    expect(() =>
      recitationStreamUrl({ provider: 'mp3quran', path: 'audio/../r1' }, 1),
    ).toThrow();
  });

  it('names exactly the providers’ origins for the media policy', () => {
    expect(RECITATION_STREAM_ORIGINS).toEqual(['https://cdn.mp3quran.net']);
    expect(Object.isFrozen(RECITATION_STREAM_ORIGINS)).toBe(true);
  });
});
