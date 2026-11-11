import { z } from 'zod';

/**
 * `@minhaj/contracts/passage` — a QURAN PASSAGE AS A CITATION VALUE (Quran
 * Part 8, the Tafsir hub; DOMAIN_MODEL.md §3.1, §10.1, §11, §8.8).
 *
 * WHY THIS MODULE IS NOT `@minhaj/contracts/quran`. A Library Work or a Media
 * Video may say which Quran passages it explains — a tafsir book on Surah
 * al-Kahf, a lecture on Ayat al-Kursi. That association is owned by Library and
 * by Media, never by Quran, and neither of them may depend on Quran: the
 * allowlist (§3.1) lists no such edge, and the architecture tests refuse any
 * import of `contracts/quran` from Library or Media. A passage is therefore a
 * plain VALUE — a Surah number and an ayah range, like a bibliographic
 * citation printed in a book — validated against the Quran's STRUCTURE (how
 * many ayat each Surah has), which is a fixed fact rather than Quran's data.
 * Nothing here reads, names or carries Quranic text, and there is no foreign
 * key from a passage to the Ayah table: Layer 4 composes a passage with the
 * Quran's own public reader.
 *
 * Browser-safe and dependency-free beyond Zod: Library, Media, Migration and
 * Quran's presentation may all import it without creating a context edge.
 */

/**
 * The number of ayat in each Surah (index 0 is Surah 1) — the Quran's
 * structure, used only to validate a citation. Moved here from
 * `@minhaj/contracts/migration` (which re-exports it) so a citation can be
 * checked by any owner without that owner depending on Migration or Quran.
 */
export const SURAH_AYAH_COUNTS: readonly number[] = Object.freeze([
  7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128, 111, 110, 98,
  135, 112, 78, 118, 64, 77, 227, 93, 88, 69, 60, 34, 30, 73, 54, 45, 83, 182, 88, 75, 85,
  54, 53, 89, 59, 37, 35, 38, 29, 18, 45, 60, 49, 62, 55, 78, 96, 29, 22, 24, 13, 14, 11,
  11, 18, 12, 12, 30, 52, 52, 44, 28, 28, 20, 56, 40, 31, 50, 40, 46, 42, 29, 19, 36, 25,
  22, 17, 19, 26, 30, 20, 15, 21, 11, 8, 8, 19, 5, 8, 8, 11, 11, 8, 3, 9, 5, 4, 7, 3, 6,
  3, 5, 4, 5, 6,
]);

/** How many Surahs the structure has. */
export const SURAH_TOTAL = SURAH_AYAH_COUNTS.length;

/** The ayat in one Surah, or null for a number that is not a Surah. */
export function surahAyahCount(surah: number): number | null {
  if (!Number.isInteger(surah) || surah < 1 || surah > SURAH_TOTAL) return null;
  return SURAH_AYAH_COUNTS[surah - 1] ?? null;
}

/**
 * How many passages one Work or Video may carry — enough for a commentary on
 * a whole Juz (Juz 30 holds 37 Surahs), never an unbounded list. The SQL CHECK
 * on each owner's `position` holds the same ceiling.
 */
export const QURAN_PASSAGES_MAX = 40;

/**
 * A lecture's start offset into its video, in whole seconds: at most a day
 * less one second (the SQL CHECK holds the same bound). Whether it falls within
 * a video's recorded duration is the owning service's question.
 */
export const PASSAGE_START_MAX_SECONDS = 86_399;

const surahNumber = z.number().int().min(1).max(SURAH_TOTAL);
const ayahNumber = z.number().int().min(1);

/** One passage: a Surah and a contiguous range of its ayat, both ends inclusive. */
export const quranPassageSchema = z
  .strictObject({
    surah: surahNumber,
    ayahFrom: ayahNumber,
    ayahTo: ayahNumber,
  })
  .superRefine((value, ctx) => {
    if (value.ayahFrom > value.ayahTo)
      ctx.addIssue({ code: 'custom', message: 'A passage runs forwards.' });
    const count = surahAyahCount(value.surah);
    if (count !== null && value.ayahTo > count)
      ctx.addIssue({ code: 'custom', message: 'A passage ends within its Surah.' });
  });

export type QuranPassage = z.output<typeof quranPassageSchema>;

/**
 * A lecture's passage (Media): a passage, and where in the video the lecture
 * begins it — `null` when it is not recorded (the video is opened at its
 * start).
 */
export const timedQuranPassageSchema = z
  .strictObject({
    surah: surahNumber,
    ayahFrom: ayahNumber,
    ayahTo: ayahNumber,
    startSeconds: z.number().int().min(0).max(PASSAGE_START_MAX_SECONDS).nullable(),
  })
  .superRefine((value, ctx) => {
    const passage = quranPassageSchema.safeParse({
      surah: value.surah,
      ayahFrom: value.ayahFrom,
      ayahTo: value.ayahTo,
    });
    if (!passage.success)
      ctx.addIssue({ code: 'custom', message: 'Not a passage of the Quran.' });
  });

export type TimedQuranPassage = z.output<typeof timedQuranPassageSchema>;

/**
 * A start offset as an editor types it — `754`, `12:34` or `1:02:03` — in
 * whole seconds; `null` when the field is empty, `NaN` when it is not a time
 * (which the schema then refuses rather than reading as zero).
 */
export function readStartSeconds(text: string | null): number | null {
  if (text === null || text.trim() === '') return null;
  const value = text.trim();
  if (/^\d{1,5}$/u.test(value)) return Number(value);
  const clock = /^(?:(\d{1,2}):)?([0-5]?\d):([0-5]\d)$/u.exec(value);
  if (clock === null) return Number.NaN;
  return Number(clock[1] ?? '0') * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
}

/** A passage's identity within its owner: one owner never repeats a passage. */
export function passageKey(passage: QuranPassage): string {
  return `${String(passage.surah)}:${String(passage.ayahFrom)}-${String(passage.ayahTo)}`;
}

/** Whether the passage covers the whole of its Surah. */
export function isWholeSurah(passage: QuranPassage): boolean {
  return passage.ayahFrom === 1 && passage.ayahTo === surahAyahCount(passage.surah);
}

/** Whether the passage covers this Ayah. */
export function passageCovers(
  passage: QuranPassage,
  surah: number,
  ayah: number,
): boolean {
  return passage.surah === surah && passage.ayahFrom <= ayah && ayah <= passage.ayahTo;
}

/** Whether the passage overlaps `from..to` of `surah` (inclusive). */
export function passageOverlaps(
  passage: QuranPassage,
  surah: number,
  from: number,
  to: number,
): boolean {
  return passage.surah === surah && passage.ayahFrom <= to && from <= passage.ayahTo;
}

/** Passages in canonical order — Surah, then where they begin, then where they end. */
export function canonicalPassageOrder<T extends QuranPassage>(
  passages: readonly T[],
): readonly T[] {
  return [...passages].sort(
    (a, b) => a.surah - b.surah || a.ayahFrom - b.ayahFrom || a.ayahTo - b.ayahTo,
  );
}

/**
 * The query a public "what explains this passage" read answers: every public
 * owner one of whose passages overlaps `ayahFrom..ayahTo` of `surah`, or —
 * with `surah` null — every public owner carrying any passage. Bounded.
 */
export const PASSAGE_READ_MAX = 200;
export const passageQuerySchema = z
  .strictObject({
    surah: surahNumber.nullable(),
    ayahFrom: ayahNumber.nullable().default(null),
    ayahTo: ayahNumber.nullable().default(null),
    limit: z.number().int().min(1).max(PASSAGE_READ_MAX).default(PASSAGE_READ_MAX),
  })
  .refine(
    (value) =>
      value.ayahFrom === null || value.ayahTo === null || value.ayahFrom <= value.ayahTo,
  );
export type PassageQuery = z.output<typeof passageQuerySchema>;

/**
 * Whether a passage is one a passage query admits — its Surah, overlapping its
 * range (an open end admits any). The owners' reads apply the same rule in SQL;
 * this is it over a value, so a result is ordered by a passage it was found by.
 */
export function passageMatchesQuery(passage: QuranPassage, query: PassageQuery): boolean {
  if (query.surah === null) return true;
  return (
    passage.surah === query.surah &&
    (query.ayahTo === null || passage.ayahFrom <= query.ayahTo) &&
    (query.ayahFrom === null || passage.ayahTo >= query.ayahFrom)
  );
}

/** How many public owners carry a passage in one Surah. */
export interface PassageSurahCount {
  readonly surah: number;
  readonly owners: number;
}

/* ===========================================================================
 * Named changes — the editor's add, remove and move (the Playlist pattern)
 * ========================================================================= */

const position = z
  .number()
  .int()
  .min(0)
  .max(QURAN_PASSAGES_MAX - 1);
const direction = z.enum(['earlier', 'later']);

export const workPassageChangeSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('add'), passage: quranPassageSchema }),
  z.strictObject({ op: z.literal('remove'), position }),
  z.strictObject({ op: z.literal('move'), position, direction }),
]);
export type WorkPassageChange = z.output<typeof workPassageChangeSchema>;

export const videoPassageChangeSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('add'), passage: timedQuranPassageSchema }),
  z.strictObject({ op: z.literal('remove'), position }),
  z.strictObject({ op: z.literal('move'), position, direction }),
]);
export type VideoPassageChange = z.output<typeof videoPassageChangeSchema>;

/** Why a named change cannot apply to the passages the operator was shown. */
export type PassageRefusal = 'duplicate-passage' | 'limit' | 'invalid';

/**
 * One named change applied to an owner's current, ordered passages. Pure: the
 * owning service applies it to the version the operator saw and persists the
 * result under that same version.
 */
export function applyPassageChange<T extends QuranPassage>(
  current: readonly T[],
  change:
    | { readonly op: 'add'; readonly passage: T }
    | { readonly op: 'remove'; readonly position: number }
    | {
        readonly op: 'move';
        readonly position: number;
        readonly direction: 'earlier' | 'later';
      },
): { readonly passages: readonly T[] } | { readonly refusal: PassageRefusal } {
  switch (change.op) {
    case 'add': {
      const key = passageKey(change.passage);
      if (current.some((passage) => passageKey(passage) === key))
        return { refusal: 'duplicate-passage' };
      if (current.length >= QURAN_PASSAGES_MAX) return { refusal: 'limit' };
      return { passages: [...current, change.passage] };
    }
    case 'remove':
      if (change.position >= current.length) return { refusal: 'invalid' };
      return { passages: current.filter((_, index) => index !== change.position) };
    case 'move': {
      const target =
        change.direction === 'earlier' ? change.position - 1 : change.position + 1;
      const moving = current[change.position];
      const other = current[target];
      if (moving === undefined || other === undefined) return { refusal: 'invalid' };
      const next = [...current];
      next[change.position] = other;
      next[target] = moving;
      return { passages: next };
    }
  }
}

/**
 * A whole proposed set — what the operator command applies — is valid only if
 * it is within the ceiling and repeats no passage.
 */
export function distinctPassages(passages: readonly QuranPassage[]): boolean {
  return (
    passages.length <= QURAN_PASSAGES_MAX &&
    new Set(passages.map(passageKey)).size === passages.length
  );
}
