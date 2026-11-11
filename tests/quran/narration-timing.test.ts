import { describe, expect, it } from 'vitest';

import {
  translationSpanProblem,
  type AyahTiming,
  type TranslationSpan,
} from '../../packages/contracts/src/quran/values.ts';
import {
  NARRATION_ALIGNMENT_REFERENCE,
  NarrationTimingRefusal,
  readNarrationTiming,
} from '../../scripts/quran/narration-timing.ts';
import { IRFAN_NARRATION } from '../../scripts/quran/recitations-runtime.ts';
import {
  EXCERPT_AYAH_COUNTS,
  NARRATION_TIMING_EXCERPT,
  wholeFile,
} from './narration-timing-fixture.ts';

/**
 * Quran translation audio — THE ALIGNMENT FILE IS READ WHOLE OR REFUSED.
 *
 * The fixture is a verbatim excerpt of the real file (Surahs 103, 112, 114:
 * one passage of three ayat; four one-Ayah passages; passages of 3, 2 and 1),
 * every other Surah marked rejected, so the reader's rules are proved on the
 * shapes the alignment really produced. Nothing is adjusted: a file that does
 * not hold together is refused with nothing to import.
 */

const ARCHIVE = IRFAN_NARRATION;

type Row = [number, number, number, number | null, number | null];

function file(edit: (body: Record<string, unknown>) => void = () => undefined) {
  const body = wholeFile();
  edit(body);
  return body;
}

const rows = (body: Record<string, unknown>, surah: number) =>
  (body['surahs'] as Record<string, Row[]>)[String(surah)] as Row[];
const groups = (body: Record<string, unknown>, surah: number) =>
  (body['groups'] as Record<string, [number, number][]>)[String(surah)] as [
    number,
    number,
  ][];

function refusal(body: unknown): NarrationTimingRefusal {
  try {
    readNarrationTiming(body, EXCERPT_AYAH_COUNTS, ARCHIVE);
  } catch (error) {
    if (error instanceof NarrationTimingRefusal) return error;
    throw error;
  }
  throw new Error('The file was accepted.');
}

describe('the narration alignment file', () => {
  it('reads the excerpt: every Ayah timed once, passages partitioning each Surah', () => {
    const read = readNarrationTiming(file(), EXCERPT_AYAH_COUNTS, ARCHIVE);
    expect(read.surahs.map((entry) => entry.surah)).toEqual([103, 112, 114]);
    expect(read.rejected).toHaveLength(111);

    const [s103, s112, s114] = read.surahs;
    // Surah 103 is one passage of three ayat, translated once after Ayah 3.
    expect(s103?.timings.map((timing) => timing.ayah)).toEqual([1, 2, 3]);
    expect(s103?.spans).toEqual([
      { startAyah: 1, endAyah: 3, startMs: 23800, endMs: 81200 },
    ]);
    // Surah 112: four passages of one Ayah, each translation after its Arabic.
    expect(s112?.spans.map((span) => [span.startAyah, span.endAyah])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ]);
    expect(s112?.timings[0]).toEqual({ ayah: 1, startMs: 9540, endMs: 11930 });
    // Surah 114: passages 1–3, 4–5 and 6.
    expect(s114?.spans.map((span) => [span.startAyah, span.endAyah])).toEqual([
      [1, 3],
      [4, 5],
      [6, 6],
    ]);
  });

  it('copies every time exactly as written', () => {
    const read = readNarrationTiming(file(), EXCERPT_AYAH_COUNTS, ARCHIVE);
    for (const entry of read.surahs) {
      const source = NARRATION_TIMING_EXCERPT.surahs[
        String(entry.surah) as keyof typeof NARRATION_TIMING_EXCERPT.surahs
      ] as readonly (readonly (number | null)[])[];
      expect(entry.timings).toEqual(
        source.map(([ayah, startMs, endMs]) => ({ ayah, startMs, endMs })),
      );
      for (const span of entry.spans) {
        const last = source[span.endAyah - 1];
        expect([span.startMs, span.endMs]).toEqual([last?.[3], last?.[4]]);
      }
    }
  });

  it('names the expected reference: mp3quran read 54, Abdulrahman Al-Sudais', () => {
    expect(NARRATION_TIMING_EXCERPT.reciterIdentification.identified.mp3quranReadId).toBe(
      NARRATION_ALIGNMENT_REFERENCE.read,
    );
    expect(NARRATION_ALIGNMENT_REFERENCE.slug).toBe('abdulrahman-sudais-r1');
  });

  it('refuses a source other than the attested archive', () => {
    for (const [field, value] of [
      ['sha256', '0'.repeat(64)],
      ['bytes', 687_598_352],
      ['url', 'https://example.invalid/Quran_mp3.zip'],
    ] as const) {
      const body = file((edit) => {
        (edit['source'] as Record<string, unknown>)[field] = value;
      });
      expect(refusal(body).reason).toMatch(/attested narration archive/);
    }
  });

  it('refuses another reference recitation, and a file with no method', () => {
    expect(
      refusal(
        file((body) => {
          (
            (body['reciterIdentification'] as Record<string, unknown>)[
              'identified'
            ] as Record<string, unknown>
          )['mp3quranReadId'] = 31;
        }),
      ).reason,
    ).toMatch(/reference/);
    expect(refusal(file((body) => void (body['method'] = []))).reason).toMatch(/method/);
  });

  it('refuses a Surah neither accepted nor rejected, or both', () => {
    expect(
      refusal(
        file((body) => {
          delete (body['rejected'] as Record<string, string>)['1'];
        }),
      ).reason,
    ).toMatch(/each Surah exactly once/);
    expect(
      refusal(
        file((body) => {
          (body['rejected'] as Record<string, string>)['112'] = 'NON_QURAN_FIXTURE';
        }),
      ).reason,
    ).toMatch(/each Surah exactly once/);
  });

  it('refuses a Surah whose ayat are not each timed once, in order', () => {
    // One Ayah missing.
    expect(refusal(file((body) => void rows(body, 112).pop())).surah).toBe(112);
    // Two ayat swapped.
    const swapped = refusal(
      file((body) => {
        const list = rows(body, 114);
        const [first, second] = [list[0], list[1]];
        if (first !== undefined && second !== undefined) {
          list[0] = second;
          list[1] = first;
        }
      }),
    );
    expect(swapped.surah).toBe(114);
    // An Ayah that overlaps the one before it.
    const overlap = refusal(
      file((body) => {
        const second = rows(body, 103)[1];
        if (second !== undefined) second[1] = 10_000;
      }),
    );
    expect(overlap.reason).toMatch(/timing overlap/);
  });

  it('refuses passages that do not partition the Surah', () => {
    expect(refusal(file((body) => void groups(body, 114).pop())).reason).toMatch(
      /partition/,
    );
    expect(
      refusal(
        file((body) => {
          const list = groups(body, 114);
          list[1] = [5, 5];
        }),
      ).reason,
    ).toMatch(/partition/);
  });

  it('refuses a translation span off a passage end, or missing on one', () => {
    // Surah 114's Ayah 2 is inside the passage 1–3: it carries no Urdu.
    expect(
      refusal(
        file((body) => {
          const row = rows(body, 114)[1];
          if (row !== undefined) {
            row[3] = 13310;
            row[4] = 14000;
          }
        }),
      ).reason,
    ).toMatch(/not on a passage end/);
    expect(
      refusal(
        file((body) => {
          const row = rows(body, 112)[0];
          if (row !== undefined) row[4] = null;
        }),
      ).reason,
    ).toMatch(/no translation span/);
  });

  it('refuses a translation heard inside its Arabic or over the next Ayah', () => {
    expect(
      refusal(
        file((body) => {
          const row = rows(body, 112)[0];
          if (row !== undefined) row[3] = 11_000;
        }),
      ).reason,
    ).toMatch(/translation order/);
    expect(
      refusal(
        file((body) => {
          const row = rows(body, 112)[0];
          if (row !== undefined) row[4] = 19_000;
        }),
      ).reason,
    ).toMatch(/translation order/);
  });

  it('refuses a time that is not a whole number of milliseconds within the ceiling', () => {
    for (const value of [-1, 1.5, 43_200_001, '9540'])
      expect(
        refusal(
          file((body) => {
            const row = rows(body, 112)[0] as unknown[];
            row[1] = value;
          }),
        ).reason,
      ).toMatch(/malformed/);
  });

  it('refuses a Surah the corpus does not have the same ayat for', () => {
    expect(
      (() => {
        try {
          readNarrationTiming(
            file(),
            new Map([...EXCERPT_AYAH_COUNTS, [112, 5]]),
            ARCHIVE,
          );
        } catch (error) {
          return (error as NarrationTimingRefusal).surah;
        }
        return null;
      })(),
    ).toBe(112);
  });
});

describe('the translation span rule', () => {
  const timings: AyahTiming[] = [
    { ayah: 1, startMs: 0, endMs: 1000 },
    { ayah: 2, startMs: 1000, endMs: 4000 },
    { ayah: 3, startMs: 6000, endMs: 7000 },
  ];
  const range = { startAyah: 1, endAyah: 3 };
  const span = (
    startAyah: number,
    endAyah: number,
    startMs: number,
    endMs: number,
  ): TranslationSpan => ({ startAyah, endAyah, startMs, endMs });

  it('accepts passages partitioning the range, each between its Arabic and the next', () => {
    expect(
      translationSpanProblem(range, timings, [
        span(1, 2, 4000, 6000),
        span(3, 3, 7000, 9000),
      ]),
    ).toBeNull();
  });

  it('names what is wrong', () => {
    expect(translationSpanProblem(range, timings, [span(1, 2, 4000, 6000)])).toBe(
      'coverage',
    );
    expect(
      translationSpanProblem(range, timings, [
        span(1, 2, 4000, 6000),
        span(2, 3, 7000, 9000),
      ]),
    ).toBe('coverage');
    expect(
      translationSpanProblem(range, timings, [
        span(1, 2, 5000, 5000),
        span(3, 3, 7000, 9000),
      ]),
    ).toBe('empty-span');
    expect(
      translationSpanProblem(range, timings, [
        span(1, 2, 3900, 6000),
        span(3, 3, 7000, 9000),
      ]),
    ).toBe('order');
    expect(
      translationSpanProblem(range, timings, [
        span(1, 2, 4000, 6100),
        span(3, 3, 7000, 9000),
      ]),
    ).toBe('order');
  });
});
