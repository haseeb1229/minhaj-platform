import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PLAN,
  DURATION_TOLERANCE_MS,
  REPEAT_MAX,
  SEEK_TOLERANCE_MS,
  afterSegment,
  audioSource,
  ayahAt,
  neighbourAyah,
  playbackRate,
  readSurahAudio,
  repeatCount,
  segmentFor,
  startMsOf,
  tick,
  ticksOf,
  timingFits,
  untimed,
  type Cursor,
  type PlayPlan,
  type PlayableSegment,
  type SurahAudio,
  type TimingTuple,
} from '../../apps/web/src/components/quran/recitation-plan.ts';

/**
 * Quran Part 5 — THE RECITATION PLAYER'S RULES, without a browser: how the
 * data route's body is read (fail closed, field by field), which Ayah a
 * position is, where playing from an Ayah begins, and what each tick and each
 * end of a file asks the player to do — advance, repeat, loop a range, stop.
 *
 * NOTHING HERE IS THE QURAN. Timings are made-up milliseconds, the slug and
 * the stream folder are `non-quran-fixture` names, and the identifiers are
 * random.
 */

const RECITATION = 'non-quran-fixture-recitation';
const STREAM = { provider: 'mp3quran', path: 'audio/non-quran-fixture/r1' } as const;

/** Ayat 1..count, each 1 s long, starting after a 2 s opening. */
function evenTimings(count: number, start = 1, opening = 2000): TimingTuple[] {
  return Array.from({ length: count }, (_, index) => [
    start + index,
    opening + index * 1000,
    opening + (index + 1) * 1000,
  ]);
}

function segment(
  surah: number,
  startAyah: number,
  endAyah: number,
  timings: readonly TimingTuple[] | null = evenTimings(
    endAyah - startAyah + 1,
    startAyah,
  ),
): PlayableSegment {
  return {
    id: randomUUID(),
    surah,
    startAyah,
    endAyah,
    audio: { kind: 'stream', stream: STREAM, surah },
    timings,
  };
}

const cursorAt = (ayah: number | null, heard = 0, passes = 0): Cursor => ({
  surah: 2,
  ayah,
  heard,
  passes,
});

/* ===========================================================================
 * Reading the data route's body
 * ========================================================================= */

describe('the data route’s body is read field by field, and fails closed', () => {
  const ids = {
    recitationId: randomUUID(),
    segmentId: randomUUID(),
    assetId: randomUUID(),
  };
  const body = (segments: unknown[], extra: Record<string, unknown> = {}) => ({
    recitation: RECITATION,
    surah: 2,
    segments,
    ...extra,
  });
  const asset = {
    id: ids.segmentId,
    startAyah: 1,
    endAyah: 2,
    audio: { kind: 'asset', ...ids },
    timings: [
      [1, 0, 100],
      [2, 100, 200],
    ],
  };
  const stream = {
    id: randomUUID(),
    startAyah: 3,
    endAyah: 3,
    audio: { kind: 'stream', stream: STREAM, surah: 2 },
    timings: null,
  };
  const expected = { recitation: RECITATION, surah: 2 };

  it('reads a first-party and a streamed segment, ordered by range, untimed kept as null', () => {
    const read = readSurahAudio(body([stream, asset]), expected);
    expect(read?.segments.map((each) => each.startAyah)).toEqual([1, 3]);
    expect(read?.segments[1]?.timings).toBeNull();
    expect(read?.segments[0]?.timings).toEqual([
      [1, 0, 100],
      [2, 100, 200],
    ]);
    const [first, second] = read?.segments ?? [];
    expect(first === undefined ? null : audioSource(first.audio)).toBe(
      `/assets/quran/recitations/${ids.recitationId}/${ids.segmentId}/${ids.assetId}`,
    );
    expect(second === undefined ? null : audioSource(second.audio)).toBe(
      'https://cdn.mp3quran.net/audio/non-quran-fixture/r1/002.mp3',
    );
  });

  it.each([
    ['another recitation', { recitation: 'other' }],
    ['another Surah', { surah: 3 }],
  ])('refuses a body for %s', (_label, extra) => {
    expect(readSurahAudio(body([asset], extra), expected)).toBeNull();
  });

  it.each([null, 'text', 7, [], { recitation: RECITATION, surah: 2 }])(
    'refuses a body that is not one (%j)',
    (value) => {
      expect(readSurahAudio(value, expected)).toBeNull();
    },
  );

  it.each([
    ['a malformed segment id', { ...asset, id: 'not-a-uuid' }],
    ['a malformed asset id', { ...asset, audio: { ...asset.audio, assetId: '../x' } }],
    [
      'an unknown audio kind',
      { ...asset, audio: { kind: 'url', url: 'https://x.test/a.mp3' } },
    ],
    [
      'a stream the allowlist refuses',
      {
        ...stream,
        audio: {
          kind: 'stream',
          stream: { provider: 'mp3quran', path: 'https://x' },
          surah: 2,
        },
      },
    ],
    [
      'an unknown provider',
      {
        ...stream,
        audio: {
          kind: 'stream',
          stream: { provider: 'other', path: STREAM.path },
          surah: 2,
        },
      },
    ],
    ['a stream of another Surah', { ...stream, audio: { ...stream.audio, surah: 9 } }],
    ['a reversed range', { ...asset, startAyah: 3, endAyah: 2 }],
    ['an Ayah 0', { ...asset, startAyah: 0 }],
    ['a timing that misses an Ayah', { ...asset, timings: [[1, 0, 100]] }],
    [
      'a timing out of order',
      {
        ...asset,
        timings: [
          [2, 0, 100],
          [1, 100, 200],
        ],
      },
    ],
    [
      'an overlapping timing',
      {
        ...asset,
        timings: [
          [1, 0, 150],
          [2, 100, 200],
        ],
      },
    ],
    [
      'an empty span',
      {
        ...asset,
        timings: [
          [1, 0, 0],
          [2, 0, 200],
        ],
      },
    ],
    [
      'a timing beyond the ceiling',
      {
        ...asset,
        timings: [
          [1, 0, 100],
          [2, 100, 43_200_001],
        ],
      },
    ],
    [
      'a malformed tuple',
      {
        ...asset,
        timings: [
          [1, 0],
          [2, 100, 200],
        ],
      },
    ],
  ])('drops %s, keeping the rest', (_label, bad) => {
    const read = readSurahAudio(body([bad, stream]), expected);
    expect(read?.segments).toHaveLength(1);
    expect(read?.segments[0]?.startAyah).toBe(3);
  });
});

/* ===========================================================================
 * Where things are
 * ========================================================================= */

describe('the Ayah being heard and where playing begins', () => {
  const timed = segment(2, 1, 3, [
    [1, 2000, 3000],
    [2, 3500, 4000],
    [3, 4000, 6000],
  ]);

  it('is none during the opening, and the last begun Ayah after it — pauses included', () => {
    expect(ayahAt(timed, 0)).toBeNull();
    expect(ayahAt(timed, 1999)).toBeNull();
    expect(ayahAt(timed, 2000)).toBe(1);
    expect(ayahAt(timed, 3200)).toBe(1);
    expect(ayahAt(timed, 3500)).toBe(2);
    expect(ayahAt(timed, 4000)).toBe(3);
    expect(ayahAt(timed, 9_999_999)).toBe(3);
  });

  it('finds the Ayah in a long Surah by binary search', () => {
    const long = segment(2, 1, 286, evenTimings(286));
    for (const ayah of [1, 2, 143, 285, 286])
      expect(ayahAt(long, 2000 + (ayah - 1) * 1000 + 500)).toBe(ayah);
  });

  it('is none for an untimed segment', () => {
    expect(ayahAt(segment(2, 1, 3, null), 5000)).toBeNull();
  });

  it('begins the first Ayah at the very start, so the opening is heard, and any other at its timing', () => {
    expect(startMsOf(timed, 1)).toBe(0);
    expect(startMsOf(timed, 2)).toBe(3500);
    expect(startMsOf(segment(2, 1, 3, null), 2)).toBe(0);
    // A segment beginning later in the Surah begins at its own start too.
    expect(startMsOf(segment(2, 5, 7), 5)).toBe(0);
  });

  it('places a tick where each timed Ayah begins, as a fraction of the duration', () => {
    expect(ticksOf(timed, 8000)).toEqual([
      { ayah: 1, at: 0.25 },
      { ayah: 2, at: 0.4375 },
      { ayah: 3, at: 0.5 },
    ]);
    // A timing beyond what the file actually holds draws no tick.
    expect(ticksOf(timed, 3600).map((each) => each.ayah)).toEqual([1, 2]);
    expect(ticksOf(timed, 0)).toEqual([]);
    expect(ticksOf(segment(2, 1, 3, null), 8000)).toEqual([]);
  });

  it('finds a segment and the neighbouring ayat the audio holds', () => {
    const audio: SurahAudio = {
      recitation: RECITATION,
      surah: 2,
      segments: [segment(2, 1, 3), segment(2, 4, 6)],
    };
    expect(segmentFor(audio, 5)?.index).toBe(1);
    expect(segmentFor(audio, 7)).toBeNull();
    expect(neighbourAyah(audio, 3, 1)).toBe(4);
    expect(neighbourAyah(audio, 1, -1)).toBeNull();
    expect(neighbourAyah(audio, 6, 1)).toBeNull();
  });
});

describe('a timing is followed only if it fits the file the player loaded', () => {
  it('fits within the duration, and within its tolerance past it', () => {
    const timed = segment(2, 1, 3, [
      [1, 0, 1000],
      [2, 1000, 2000],
      [3, 2000, 3000],
    ]);
    expect(timingFits(timed, 3000)).toBe(true);
    expect(timingFits(timed, 3000 - DURATION_TOLERANCE_MS)).toBe(true);
    expect(timingFits(timed, 3000 - DURATION_TOLERANCE_MS - 1)).toBe(false);
  });

  it('cannot judge before the duration is known, and an untimed segment always fits', () => {
    expect(timingFits(segment(2, 1, 3), 0)).toBe(true);
    expect(timingFits(segment(2, 1, 3), Number.NaN)).toBe(true);
    expect(timingFits(segment(2, 1, 3, null), 1)).toBe(true);
  });

  it('sets a timing aside without touching the segment it came with', () => {
    const timed = segment(2, 1, 3);
    const plain = untimed(timed);
    expect(plain).toEqual({ ...timed, timings: null });
    expect(timed.timings).not.toBeNull();
  });
});

/* ===========================================================================
 * What happens next
 * ========================================================================= */

describe('each tick says what to do', () => {
  const timed = segment(2, 1, 4);
  const plan = (overrides: Partial<PlayPlan> = {}): PlayPlan => ({
    ...DEFAULT_PLAN,
    ...overrides,
  });

  it('follows the opening, then each Ayah as it begins', () => {
    let cursor = cursorAt(1);
    let decision = tick(plan(), timed, cursor, 500);
    expect(decision).toEqual({ kind: 'continue', cursor: cursorAt(null) });
    cursor = decision.cursor;
    decision = tick(plan(), timed, cursor, 2100);
    expect(decision.cursor.ayah).toBe(1);
    decision = tick(plan(), timed, decision.cursor, 2900);
    expect(decision).toEqual({ kind: 'continue', cursor: cursorAt(1) });
    decision = tick(plan(), timed, decision.cursor, 3050);
    expect(decision).toEqual({ kind: 'continue', cursor: cursorAt(2) });
  });

  it('keeps the Ayah just heard through a pause before the next', () => {
    const paused = segment(2, 1, 2, [
      [1, 0, 1000],
      [2, 1500, 2500],
    ]);
    const decision = tick(plan(), paused, cursorAt(1), 1200);
    expect(decision).toEqual({ kind: 'continue', cursor: cursorAt(1) });
    expect(tick(plan(), paused, decision.cursor, 1600).cursor.ayah).toBe(2);
  });

  it('repeats each Ayah N times by seeking back to its start, then moves on', () => {
    const twice = plan({ repeat: 3 });
    let decision = tick(twice, timed, cursorAt(2), 3999);
    expect(decision.kind).toBe('continue');
    decision = tick(twice, timed, decision.cursor, 4000);
    expect(decision).toEqual({ kind: 'seek', ms: 3000, cursor: cursorAt(2, 1) });
    // The seek lands a little early: still Ayah 2, and the count is kept.
    decision = tick(twice, timed, decision.cursor, 3000 - (SEEK_TOLERANCE_MS - 10));
    expect(decision).toEqual({ kind: 'continue', cursor: cursorAt(2, 1) });
    decision = tick(twice, timed, decision.cursor, 4010);
    expect(decision).toEqual({ kind: 'seek', ms: 3000, cursor: cursorAt(2, 2) });
    decision = tick(twice, timed, decision.cursor, 4020);
    expect(decision).toEqual({ kind: 'continue', cursor: cursorAt(3) });
  });

  it('follows the listener when they jump, and starts the counts again', () => {
    const repeating = plan({ repeat: 5 });
    // Forward past the next Ayah: no repeat of the one they left.
    expect(tick(repeating, timed, cursorAt(1, 2), 5500)).toEqual({
      kind: 'continue',
      cursor: cursorAt(4),
    });
    // Back to an earlier Ayah, well beyond the seek tolerance.
    expect(tick(repeating, timed, cursorAt(3, 2), 2500)).toEqual({
      kind: 'continue',
      cursor: cursorAt(1),
    });
  });

  it('loops a range its number of times, then stops', () => {
    const range = plan({ range: { surah: 2, from: 2, to: 3, times: 2 } });
    let decision = tick(range, timed, cursorAt(3), 5000);
    expect(decision).toEqual({ kind: 'seek', ms: 3000, cursor: cursorAt(2, 0, 1) });
    decision = tick(range, timed, decision.cursor, 3100);
    expect(decision.cursor.ayah).toBe(2);
    decision = tick(range, timed, decision.cursor, 4000);
    expect(decision.cursor).toEqual(cursorAt(3, 0, 1));
    decision = tick(range, timed, decision.cursor, 5000);
    expect(decision).toEqual({ kind: 'stop', cursor: cursorAt(3, 0, 2) });
  });

  it('loops a range of times 0 until stopped', () => {
    const forever = plan({ range: { surah: 2, from: 1, to: 1, times: 0 } });
    let cursor = cursorAt(1);
    for (let pass = 1; pass <= 25; pass += 1) {
      const decision = tick(forever, timed, cursor, 3000);
      expect(decision.kind).toBe('seek');
      cursor = decision.cursor;
      expect(cursor.passes).toBe(pass);
    }
  });

  it('ignores a range of another Surah', () => {
    const elsewhere = plan({ range: { surah: 9, from: 1, to: 3, times: 1 } });
    expect(tick(elsewhere, timed, cursorAt(3), 5000).kind).toBe('continue');
  });

  it('never seeks or stops in an untimed segment', () => {
    const untimed = segment(2, 1, 4, null);
    for (const ms of [0, 1000, 99_999])
      expect(
        tick(
          plan({ repeat: 3, range: { surah: 2, from: 1, to: 2, times: 1 } }),
          untimed,
          cursorAt(2),
          ms,
        ),
      ).toEqual({ kind: 'continue', cursor: cursorAt(null) });
  });

  it('treats the file’s end as the end of its last Ayah', () => {
    expect(
      tick(plan({ repeat: 2 }), timed, cursorAt(4), Number.MAX_SAFE_INTEGER),
    ).toEqual({ kind: 'seek', ms: 5000, cursor: cursorAt(4, 1) });
  });
});

describe('what follows the end of a file', () => {
  const audio = (surah: number, segments: number): SurahAudio => ({
    recitation: RECITATION,
    surah,
    segments: Array.from({ length: segments }, (_, index) =>
      segment(surah, index * 3 + 1, index * 3 + 3),
    ),
  });

  it('is the next segment, then the next Surah, while playing continuously', () => {
    expect(afterSegment(DEFAULT_PLAN, audio(2, 2), 0)).toEqual({
      kind: 'segment',
      index: 1,
    });
    expect(afterSegment(DEFAULT_PLAN, audio(2, 2), 1)).toEqual({
      kind: 'surah',
      surah: 3,
    });
  });

  it('stops after the last Surah, when not continuous, and at the end of a range', () => {
    expect(afterSegment(DEFAULT_PLAN, audio(114, 1), 0)).toEqual({ kind: 'stop' });
    expect(afterSegment({ ...DEFAULT_PLAN, continuous: false }, audio(2, 2), 0)).toEqual({
      kind: 'stop',
    });
    expect(
      afterSegment(
        { ...DEFAULT_PLAN, range: { surah: 2, from: 1, to: 2, times: 0 } },
        audio(2, 2),
        0,
      ),
    ).toEqual({ kind: 'stop' });
    // A range of another Surah does not hold this one back.
    expect(
      afterSegment(
        { ...DEFAULT_PLAN, range: { surah: 5, from: 1, to: 2, times: 0 } },
        audio(2, 1),
        0,
      ),
    ).toEqual({ kind: 'surah', surah: 3 });
  });
});

describe('a repeat count and a speed are clamped to what is offered', () => {
  it.each([
    [0, 1],
    [1, 1],
    [3.9, 3],
    [REPEAT_MAX + 5, REPEAT_MAX],
    [-4, 1],
    [Number.NaN, 1],
    ['3', 1],
    [null, 1],
  ])('repeatCount(%j) is %d', (value, expected) => {
    expect(repeatCount(value)).toBe(expected);
  });

  it.each([
    [0.75, 0.75],
    [1, 1],
    [1.25, 1.25],
    [1.5, 1.5],
    [2, 1],
    [0.5, 1],
    ['1.5', 1],
    [undefined, 1],
  ])('playbackRate(%j) is %d', (value, expected) => {
    expect(playbackRate(value)).toBe(expected);
  });
});
