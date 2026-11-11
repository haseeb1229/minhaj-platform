/**
 * A TRIMMED, VERBATIM EXCERPT of the narration alignment file
 * (`narration-timing.json`, SHA-256 7340502bfb3f07cca8d22f7a74d238addd7e3828173e490636b8014f45e4a1e3): its
 * source, method and identification, and Surahs 103, 112 and 114 exactly as
 * the alignment wrote them — times only, no text and no audio. Every other
 * Surah of the real file is either accepted or rejected; a test that needs a
 * whole file marks the rest rejected (`wholeFile`).
 */
export const NARRATION_TIMING_EXCERPT = {
  source: {
    url: 'https://minhaj.net/downloads/iQuran/Quran_mp3.zip',
    bytes: 687598353,
    sha256: 'd96ea7531a32489870c5db00f463d95b2d95c080884d5b50577f9b3ca0fb8e4a',
    lastModified: 'Sat, 04 Nov 2017 14:23:01 GMT',
    entries: 114,
    entryNaming:
      "'NNN. Name.mp3' (NNN = surah number, 3 digits; e.g. '002. Al-Baqarah.mp3'); every entry deflated, CRC-32 verified on extraction",
    audio:
      "MP3 16 kHz stereo 32 kb/s, ID3 artist 'Minhajcds.com' (format probed on surah 1 only)",
    timesRelativeTo: "start of each surah's mp3 inside the zip",
  },
  method: [
    'Reference alignment against the Abdulrahman Al-Sudais murattal published by mp3quran.net (read id 54, https://cdn.mp3quran.net/audio/abdulrahman-sudais/r1/NNN.mp3) and its per-ayah timings (https://www.mp3quran.net/api/v3/ayat_timing?surah=N&read=54). Audio was decoded to 16 kHz mono with ffmpeg 7.1. Features are 36 log-spaced bands from 120 to 4000 Hz, with a 32 ms window and 10 ms hop, normalised per frame. The match score is the Pearson-style mean product of normalised frames (gain-invariant).',
    'Tempo: the narration time-stretched the Sudais audio in some surahs, with pitch preserved. A tempo ratio rho (narration duration / reference duration) is estimated per surah on a probe ayah over 0.90-1.10 (0.01 steps, then refined to 0.0025). The reference spectrogram is stretched by rho. If the probe correlation is below 0.70, the surah is rejected as a non-matching recording.',
    'Sequential matching: each reference ayah, trimmed to its energetic part, is anchored by its best 3 s window in a forward search window. It is then extended in 2 s pieces forwards and backwards, and every piece must continue contiguously (within 0.3 s) at correlation >= 0.55. One isolated weak piece is tolerated if the next piece continues at >= 0.65. Up to max(2.5 s, 25%) of a reference ayah may stay unmatched at either end, to allow for mp3quran timing slop and editor trims. That trimmed audio must not be found again outside the neighbouring Arabic, which would indicate a split ayah.',
    'Grouping: consecutive ayat whose narration gap equals their reference gap (within 0.4 s) were cut as one piece and form an Arabic group. The narration plays one Urdu translation after each group.',
    'Splice edges: the group start and end are refined by walking from inside the Arabic outwards. The walk stops at 0.25 s of energetic audio that no longer matches the aligned reference (11-frame windowed correlation), and does not stop at pauses inside the recitation. Where that edge falls short of the matched span by more than 0.3 s, sustained chant pitch (175 Hz or above) decides. Ayah boundaries inside a group are the mp3quran timings mapped through the alignment.',
    'Urdu span: the energetic audio between the end of a group and the start of the next group, or the end of the file.',
    'Fail-closed acceptance. Every ayah must be found with locator correlation >= 0.60 that is unambiguous (best minus any other candidate in the window >= 0.05), whole-ayah correlation >= 0.72, at most 25% weak pieces, at least 60% of the reference ayah matched, and duration drift <= max(0.3 s, 3%). Spans must be monotonic and non-overlapping. Every Urdu span must be at least 0.8 s, with an Urdu/Arabic duration ratio of 0.25-15. It must be speech-like (median voiced pitch <= 165 Hz, chant-range share 175-380 Hz <= 50%, and no 1.5 s window with >= 50% chant-range pitch). Its first and last 1.5 s must not contain a run of >= 20 frames matching the reference.',
    'Two checks were made more precise during the run, and both changes can only accept what the earlier rule rejected. (a) Trimmed audio found again inside the neighbouring Arabic group is allowed; before, any re-occurrence rejected the surah. This applies to surahs 38-1 and pass 2. (b) The chant range is bounded at 380 Hz. This applies to surahs 8-1 and pass 2. Surahs accepted earlier passed the stricter rules.',
    'Second pass, recorded as quality.pass = 2: surahs rejected only for duration drift or for the chant-window check were re-run with the drift limit relaxed to max(0.5 s, 5%), and with chant range bounded at 380 Hz so that octave errors on quiet tonal noise are excluded. All other checks were unchanged.',
  ],
  reciterIdentification: {
    summary:
      'The Arabic in the narration is not one recording. Where a surah is accepted, its Arabic was cut from the Abdulrahman Al-Sudais murattal that mp3quran.net publishes as read id 54. Some of those surahs were time-stretched by a constant factor with pitch preserved; see tempoRatio. Every other surah, or part of a surah, uses another recording that could not be identified with clear evidence (see rejected).',
    identified: {
      reciter: 'Abdulrahman Al-Sudais',
      mp3quranReadId: 54,
      audioFolder: 'https://cdn.mp3quran.net/audio/abdulrahman-sudais/r1/',
      timingApi: 'https://www.mp3quran.net/api/v3/ayat_timing?surah=N&read=54',
      evidence: [
        "Surah 112: the narration's four Arabic ayah segments were correlated against surah 112 from all 115 timed reads. Sudais (54) scored 0.90/0.84/0.92/0.91, with match positions 2.30/4.74/7.03/9.82 s in his file. Those positions are monotonic and agree with his published ayah starts 2.44/4.96/7.16/10.04 s to within 0.2 s. The next-best read scored 0.62-0.65 and the median read 0.29 (file evidence-rank-surah112-all-115-reads.txt).",
        'Surahs 103, 108, 113 and 114: every Sudais ayah was found in the narration at 0.76-0.93 normalised spectral correlation by full-file search. Ayat that the narration plays back-to-back sit at exactly the contiguous offsets they have in the Sudais file.',
        'Accepted surahs: every ayah was found again sequentially, piece by piece. The whole-ayah correlation of every accepted ayah is at least 0.72 (per-surah minimum in quality.minWholeAyahCorr).',
      ],
    },
  },
  surahs: {
    '103': [
      [1, 10100, 11040, null, null],
      [2, 11040, 14440, null, null],
      [3, 14440, 23800, 23800, 81200],
    ],
    '112': [
      [1, 9540, 11930, 11930, 18430],
      [2, 18430, 20550, 20550, 27270],
      [3, 27270, 29990, 29990, 35450],
      [4, 35450, 39480, 39480, 42950],
    ],
    '114': [
      [1, 10360, 13310, null, null],
      [2, 13310, 15040, null, null],
      [3, 15040, 17920, 17920, 31080],
      [4, 31080, 35460, null, null],
      [5, 35460, 39560, 39560, 52640],
      [6, 52640, 57510, 57510, 64360],
    ],
  },
  groups: {
    '103': [[1, 3]],
    '112': [
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ],
    '114': [
      [1, 3],
      [4, 5],
      [6, 6],
    ],
  },
  intro: {
    '103': {
      bismillah: [270, 3590, 3590, 10100],
    },
    '112': {
      bismillah: [300, 3620, 3620, 9540],
    },
    '114': {
      bismillah: [280, 3600, 3600, 10360],
    },
  },
  tempoRatio: {
    '103': 1,
    '112': 1,
    '114': 1,
  },
  quality: {
    '103': {
      minLocatorCorr: 0.902,
      minWholeAyahCorr: 0.902,
      minLocatorMargin: 0.259,
      maxUrduChantPitchFrac: 0.03,
      maxUrduChantWindow: 0.14,
      pass: 1,
    },
    '112': {
      minLocatorCorr: 0.838,
      minWholeAyahCorr: 0.838,
      minLocatorMargin: 0.197,
      maxUrduChantPitchFrac: 0.06,
      maxUrduChantWindow: 0,
      pass: 1,
    },
    '114': {
      minLocatorCorr: 0.802,
      minWholeAyahCorr: 0.785,
      minLocatorMargin: 0.194,
      maxUrduChantPitchFrac: 0.02,
      maxUrduChantWindow: 0,
      pass: 1,
    },
  },
} as const;

/** The Surahs of the excerpt and their Ayah counts. */
export const EXCERPT_AYAH_COUNTS: ReadonlyMap<number, number> = new Map([
  [103, 3],
  [112, 4],
  [114, 6],
]);

/** The excerpt as a whole file: every Surah not in it marked rejected. */
export function wholeFile(): Record<string, unknown> {
  const rejected: Record<string, string> = {};
  for (let surah = 1; surah <= 114; surah += 1)
    if (!EXCERPT_AYAH_COUNTS.has(surah))
      rejected[String(surah)] = 'NON_QURAN_FIXTURE not part of the excerpt';
  return structuredClone({ ...NARRATION_TIMING_EXCERPT, rejected }) as Record<
    string,
    unknown
  >;
}
