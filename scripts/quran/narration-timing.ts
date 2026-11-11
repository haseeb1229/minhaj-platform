import {
  QURAN_SURAH_MAX,
  RECITATION_TIMING_MAX_MS,
  timingProblem,
  translationSpanProblem,
  type AyahTiming,
  type TranslationSpan,
} from '@minhaj/contracts/quran';

/**
 * THE IRFAN-UL-QURAN NARRATION'S ALIGNMENT FILE, READ AND JUDGED — pure, so
 * every rule is proved without a database (Quran translation audio; owner
 * request 2026-11-10, OPEN_DECISIONS.md §1.2).
 *
 * The narration plays, Surah by Surah, an Arabic passage of one or more ayat
 * and then its Urdu translation. `narration-timing.json` was DERIVED offline by
 * spectral alignment of each narration file against Abdulrahman Al-Sudais's
 * murattal as mp3quran.net publishes it (read 54) and its per-Ayah timings: it
 * says, per accepted Surah, when each Ayah's Arabic is heard and where each
 * passage's Urdu is heard, in milliseconds from the start of that Surah's MP3
 * inside the attested archive. Surahs the alignment could not prove are listed
 * as `rejected` and carry nothing.
 *
 * NOTHING IS ADJUSTED. A file that is not exactly this shape — every accepted
 * Surah's every Ayah once and in order, passages partitioning the Surah, an
 * Urdu span exactly on each passage's last Ayah and between its Arabic and the
 * next Ayah's, every Surah either accepted or rejected — is refused whole.
 * Times are copied, never moved, rounded or inferred.
 */

/** The alignment's reference: the timed recording the narration's Arabic matched. */
export const NARRATION_ALIGNMENT_REFERENCE = Object.freeze({
  read: 54,
  folder: 'audio/abdulrahman-sudais/r1',
  /** The recitation `recitations-mp3quran` records for that read (`planRead`). */
  slug: 'abdulrahman-sudais-r1',
  audioFolderUrl: 'https://cdn.mp3quran.net/audio/abdulrahman-sudais/r1/',
});

/** One accepted Surah: every Ayah's Arabic, and each passage's translation. */
export interface NarrationSurah {
  readonly surah: number;
  readonly timings: readonly AyahTiming[];
  readonly spans: readonly TranslationSpan[];
}

export interface NarrationTiming {
  /** Accepted Surahs, ascending. */
  readonly surahs: readonly NarrationSurah[];
  /** Surahs the alignment rejected, ascending; nothing of theirs is read. */
  readonly rejected: readonly number[];
}

/** Why the file is refused — a category and, where one applies, the Surah. */
export class NarrationTimingRefusal extends Error {
  readonly reason: string;
  readonly surah: number | null;

  constructor(reason: string, surah: number | null = null) {
    super(
      surah === null
        ? `the alignment file is refused: ${reason}`
        : `the alignment file is refused: ${reason} (Surah ${String(surah)})`,
    );
    this.name = 'NarrationTimingRefusal';
    this.reason = reason;
    this.surah = surah;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const ms = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= RECITATION_TIMING_MAX_MS;

/** A Surah-numbered key set: "1".."114", canonical spelling only. */
function surahKeys(value: Record<string, unknown>, what: string): readonly number[] {
  const keys = Object.keys(value).map((key) => {
    const surah = Number(key);
    if (
      !/^[1-9][0-9]{0,2}$/.test(key) ||
      !Number.isInteger(surah) ||
      surah < 1 ||
      surah > QURAN_SURAH_MAX
    )
      throw new NarrationTimingRefusal(`${what} names something other than a Surah`);
    return surah;
  });
  return keys.sort((a, b) => a - b);
}

const same = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * The file's `source` must be the attested archive the narration was stored
 * from — its one address, its exact size and its SHA-256.
 */
export function assertNarrationSource(
  body: unknown,
  archive: { readonly url: string; readonly bytes: number; readonly sha256: string },
): void {
  const source = record(record(body)?.['source']);
  if (
    source === null ||
    source['url'] !== archive.url ||
    source['bytes'] !== archive.bytes ||
    source['sha256'] !== archive.sha256
  )
    throw new NarrationTimingRefusal('its source is not the attested narration archive');
}

/**
 * Reads the whole file against the canonical corpus's Ayah counts, or refuses.
 * `archive` is the attested narration archive the times are relative to.
 */
export function readNarrationTiming(
  body: unknown,
  ayahCounts: ReadonlyMap<number, number>,
  archive: { readonly url: string; readonly bytes: number; readonly sha256: string },
): NarrationTiming {
  const file = record(body);
  if (file === null) throw new NarrationTimingRefusal('it is not a JSON object');
  assertNarrationSource(file, archive);

  const method = file['method'];
  if (
    !Array.isArray(method) ||
    method.length === 0 ||
    !method.every((step) => typeof step === 'string')
  )
    throw new NarrationTimingRefusal('it does not state its method');

  const identified = record(record(file['reciterIdentification'])?.['identified']);
  if (
    identified === null ||
    identified['mp3quranReadId'] !== NARRATION_ALIGNMENT_REFERENCE.read ||
    identified['audioFolder'] !== NARRATION_ALIGNMENT_REFERENCE.audioFolderUrl
  )
    throw new NarrationTimingRefusal(
      'its reference is not the expected timed recitation',
    );

  const surahs = record(file['surahs']);
  const groups = record(file['groups']);
  const quality = record(file['quality']);
  const rejected = record(file['rejected']);
  if (surahs === null || groups === null || quality === null || rejected === null)
    throw new NarrationTimingRefusal('it lacks its surahs, groups, quality or rejected');
  const accepted = surahKeys(surahs, 'surahs');
  const refused = surahKeys(rejected, 'rejected');
  if (!same(accepted, surahKeys(groups, 'groups')))
    throw new NarrationTimingRefusal('its groups do not name exactly its Surahs');
  if (!same(accepted, surahKeys(quality, 'quality')))
    throw new NarrationTimingRefusal('its quality does not name exactly its Surahs');
  // Every Surah accounted for exactly once: accepted, or rejected — never both.
  const all = [...accepted, ...refused].sort((a, b) => a - b);
  if (
    !same(
      all,
      Array.from({ length: QURAN_SURAH_MAX }, (_, index) => index + 1),
    )
  )
    throw new NarrationTimingRefusal('it does not account for each Surah exactly once');

  return {
    surahs: accepted.map((surah) =>
      readSurah(surah, surahs[String(surah)], groups[String(surah)], ayahCounts),
    ),
    rejected: refused,
  };
}

function readSurah(
  surah: number,
  rawRows: unknown,
  rawGroups: unknown,
  ayahCounts: ReadonlyMap<number, number>,
): NarrationSurah {
  const ayahCount = ayahCounts.get(surah);
  if (ayahCount === undefined) throw new NarrationTimingRefusal('unknown Surah', surah);
  if (!Array.isArray(rawRows) || rawRows.length !== ayahCount)
    throw new NarrationTimingRefusal('not every Ayah is timed', surah);
  if (!Array.isArray(rawGroups) || rawGroups.length === 0)
    throw new NarrationTimingRefusal('no passages', surah);

  // The passages: [first, last] pairs partitioning 1..ayahCount, in order.
  const passages: { readonly from: number; readonly to: number }[] = [];
  let next = 1;
  for (const group of rawGroups) {
    if (!Array.isArray(group) || group.length !== 2)
      throw new NarrationTimingRefusal('a passage is malformed', surah);
    const [from, to] = group as unknown[];
    if (from !== next || typeof to !== 'number' || !Number.isInteger(to) || to < from)
      throw new NarrationTimingRefusal('the passages do not partition the Surah', surah);
    passages.push({ from, to });
    next = to + 1;
  }
  if (next !== ayahCount + 1)
    throw new NarrationTimingRefusal('the passages do not partition the Surah', surah);
  const lastOfPassage = new Set(passages.map((passage) => passage.to));

  const timings: AyahTiming[] = [];
  const urdu = new Map<number, { readonly startMs: number; readonly endMs: number }>();
  for (const [index, raw] of rawRows.entries()) {
    if (!Array.isArray(raw) || raw.length !== 5)
      throw new NarrationTimingRefusal('an Ayah row is malformed', surah);
    const [ayah, startMs, endMs, urduStart, urduEnd] = raw as unknown[];
    if (ayah !== index + 1 || !ms(startMs) || !ms(endMs))
      throw new NarrationTimingRefusal('an Ayah row is malformed', surah);
    timings.push({ ayah, startMs, endMs });
    // The Urdu is given exactly on a passage's last Ayah, and nowhere else.
    if (lastOfPassage.has(ayah)) {
      if (!ms(urduStart) || !ms(urduEnd))
        throw new NarrationTimingRefusal('a passage has no translation span', surah);
      urdu.set(ayah, { startMs: urduStart, endMs: urduEnd });
    } else if (urduStart !== null || urduEnd !== null) {
      throw new NarrationTimingRefusal(
        'a translation span is not on a passage end',
        surah,
      );
    }
  }

  const spans: TranslationSpan[] = passages.map((passage) => {
    const span = urdu.get(passage.to);
    if (span === undefined)
      throw new NarrationTimingRefusal('a passage has no translation span', surah);
    return { startAyah: passage.from, endAyah: passage.to, ...span };
  });

  const range = { startAyah: 1, endAyah: ayahCount };
  const timing = timingProblem(range, timings);
  if (timing !== null) throw new NarrationTimingRefusal(`timing ${timing}`, surah);
  const translation = translationSpanProblem(range, timings, spans);
  if (translation !== null)
    throw new NarrationTimingRefusal(`translation ${translation}`, surah);
  return { surah, timings, spans };
}
