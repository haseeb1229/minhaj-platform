import { localizedPath } from '@minhaj/contracts';
import {
  SURAH_TOTAL,
  canonicalPassageOrder,
  isWholeSurah,
  passageCovers,
  surahAyahCount,
  type PassageSurahCount,
  type QuranPassage,
  type TimedQuranPassage,
} from '@minhaj/contracts/passage';

/**
 * THE TAFSIR HUB'S RULES (Quran Part 8) — pure, so every page that lays tafsir
 * out (the hub, a Surah's tafsir page, the reader's Tafsir panel) groups and
 * places by ONE definition, proved by unit test.
 *
 * Three kinds of resource explain a passage, each owned elsewhere and composed
 * here at Layer 4: a public Tafsir's ENTRY (Quran's text work, an entry over a
 * contiguous range of one Surah), a public Library WORK carrying Quran passages
 * and a published Media VIDEO carrying passages (each with where the lecture
 * begins). Nothing here reads anything; it arranges what the owners answered.
 */

export interface TafsirTextEntry {
  readonly workId: string;
  readonly entry: {
    readonly id: string;
    readonly surah: number;
    readonly startAyah: number;
    readonly endAyah: number;
    readonly text: string;
  };
}

interface WithPassages<P extends QuranPassage> {
  readonly id: string;
  readonly passages: readonly P[];
}

export interface TafsirResources<
  B extends WithPassages<QuranPassage>,
  V extends WithPassages<TimedQuranPassage>,
> {
  readonly texts: readonly TafsirTextEntry[];
  readonly books: readonly B[];
  readonly lectures: readonly V[];
}

/** A lecture with the passage it is shown for — whose start it opens at. */
export interface PlacedLecture<V> {
  readonly video: V;
  readonly passage: TimedQuranPassage;
}

export interface AyahResources<B, V> {
  readonly texts: readonly TafsirTextEntry[];
  readonly books: readonly B[];
  readonly lectures: readonly PlacedLecture<V>[];
}

/* ---- Addresses ----------------------------------------------------------- */

export function tafsirSurahPathOf(surah: number): string {
  return `/quran/tafsir/surah/${String(surah)}`;
}

export function tafsirSurahPath(locale: string, surah: number): string {
  return localizedPath(locale, tafsirSurahPathOf(surah));
}

/** The element of an Ayah on its Surah's tafsir page. */
export function tafsirAyahId(surah: number, ayah: number): string {
  return `tafsir-${String(surah)}-${String(ayah)}`;
}

/** An Ayah's place on its Surah's tafsir page. */
export function tafsirAyahPath(locale: string, surah: number, ayah: number): string {
  return `${tafsirSurahPath(locale, surah)}#${tafsirAyahId(surah, ayah)}`;
}

/** "18:10" or "18:1–10" — a passage as a citation. */
export function passageCitation(passage: QuranPassage): string {
  return passage.ayahFrom === passage.ayahTo
    ? `${String(passage.surah)}:${String(passage.ayahFrom)}`
    : `${String(passage.surah)}:${String(passage.ayahFrom)}–${String(passage.ayahTo)}`;
}

/** A lecture's address, opened at the passage's start where one is recorded. */
export function lectureHref(videoPath: string, passage: TimedQuranPassage): string {
  return passage.startSeconds === null || passage.startSeconds === 0
    ? videoPath
    : `${videoPath}?start=${String(passage.startSeconds)}`;
}

/** A positive whole number of seconds from `?start=`, within the video if known. */
export function readLectureStart(
  raw: string | string[] | undefined,
  duration: number | null,
): number | null {
  if (typeof raw !== 'string' || !/^\d{1,5}$/u.test(raw)) return null;
  const value = Number(raw);
  if (value < 1 || value > 86_399) return null;
  return duration === null || value < duration ? value : null;
}

/* ---- One Ayah ------------------------------------------------------------ */

/**
 * What explains one Ayah: the entries covering it, the books one of whose
 * passages covers it, and the lectures one of whose passages does — each
 * lecture with the FIRST such passage (its start is where to open it).
 */
export function resourcesForAyah<
  B extends WithPassages<QuranPassage>,
  V extends WithPassages<TimedQuranPassage>,
>(resources: TafsirResources<B, V>, surah: number, ayah: number): AyahResources<B, V> {
  return {
    texts: resources.texts.filter(
      ({ entry }) =>
        entry.surah === surah && entry.startAyah <= ayah && ayah <= entry.endAyah,
    ),
    books: resources.books.filter((book) =>
      book.passages.some((passage) => passageCovers(passage, surah, ayah)),
    ),
    lectures: resources.lectures.flatMap((video) => {
      const passage = video.passages.find((entry) => passageCovers(entry, surah, ayah));
      return passage === undefined ? [] : [{ video, passage }];
    }),
  };
}

export function resourceCount(found: AyahResources<unknown, unknown>): number {
  return found.texts.length + found.books.length + found.lectures.length;
}

/* ---- One Surah ----------------------------------------------------------- */

export interface PassageGroup<B, V> {
  /** The ayat the group spans, inclusive. */
  readonly from: number;
  readonly to: number;
  readonly texts: readonly TafsirTextEntry[];
  readonly books: readonly B[];
  readonly lectures: readonly PlacedLecture<V>[];
}

export interface SurahTafsirLayout<B, V> {
  /** What explains the whole Surah: shown first. */
  readonly whole: AyahResources<B, V>;
  /** Everything else, as groups of overlapping passages in canonical order. */
  readonly groups: readonly PassageGroup<B, V>[];
}

/**
 * A SURAH'S TAFSIR, GROUPED. Whole-Surah resources first; then every other
 * entry and passage in this Surah as an interval, and overlapping intervals
 * merged into one group — so a book on 2:255–257 and a lecture on 2:255 read
 * together, while adjoining entries (1–5, 6–10) stay apart. A resource with a
 * whole-Surah passage is not repeated in a group; one with two passages in a
 * group appears once (a lecture with the earlier passage's start).
 */
export function surahTafsirLayout<
  B extends WithPassages<QuranPassage>,
  V extends WithPassages<TimedQuranPassage>,
>(resources: TafsirResources<B, V>, surah: number): SurahTafsirLayout<B, V> {
  const count = surahAyahCount(surah) ?? 0;
  const wholeEntry = (entry: TafsirTextEntry['entry']) =>
    entry.surah === surah && entry.startAyah === 1 && entry.endAyah === count;
  const whole = {
    texts: resources.texts.filter(({ entry }) => wholeEntry(entry)),
    books: resources.books.filter((book) =>
      book.passages.some((passage) => passage.surah === surah && isWholeSurah(passage)),
    ),
    lectures: resources.lectures.flatMap((video) => {
      const passage = video.passages.find(
        (entry) => entry.surah === surah && isWholeSurah(entry),
      );
      return passage === undefined ? [] : [{ video, passage }];
    }),
  };
  const wholeBooks = new Set(whole.books.map((book) => book.id));
  const wholeLectures = new Set(whole.lectures.map((lecture) => lecture.video.id));

  type Interval =
    | {
        readonly from: number;
        readonly to: number;
        readonly kind: 'text';
        readonly text: TafsirTextEntry;
      }
    | {
        readonly from: number;
        readonly to: number;
        readonly kind: 'book';
        readonly book: B;
      }
    | {
        readonly from: number;
        readonly to: number;
        readonly kind: 'lecture';
        readonly lecture: PlacedLecture<V>;
      };
  const intervals: Interval[] = [
    ...resources.texts
      .filter(({ entry }) => entry.surah === surah && !wholeEntry(entry))
      .map((text) => ({
        from: text.entry.startAyah,
        to: text.entry.endAyah,
        kind: 'text' as const,
        text,
      })),
    ...resources.books
      .filter((book) => !wholeBooks.has(book.id))
      .flatMap((book) =>
        book.passages
          .filter((passage) => passage.surah === surah)
          .map((passage) => ({
            from: passage.ayahFrom,
            to: passage.ayahTo,
            kind: 'book' as const,
            book,
          })),
      ),
    ...resources.lectures
      .filter((video) => !wholeLectures.has(video.id))
      .flatMap((video) =>
        canonicalPassageOrder(
          video.passages.filter((passage) => passage.surah === surah),
        ).map((passage) => ({
          from: passage.ayahFrom,
          to: passage.ayahTo,
          kind: 'lecture' as const,
          lecture: { video, passage },
        })),
      ),
  ].sort((a, b) => a.from - b.from || a.to - b.to);

  const groups: {
    from: number;
    to: number;
    texts: TafsirTextEntry[];
    books: B[];
    lectures: PlacedLecture<V>[];
  }[] = [];
  for (const interval of intervals) {
    let group = groups.at(-1);
    if (group === undefined || interval.from > group.to) {
      group = {
        from: interval.from,
        to: interval.to,
        texts: [],
        books: [],
        lectures: [],
      };
      groups.push(group);
    } else group.to = Math.max(group.to, interval.to);
    if (interval.kind === 'text') group.texts.push(interval.text);
    else if (interval.kind === 'book') {
      if (!group.books.some((book) => book.id === interval.book.id))
        group.books.push(interval.book);
    } else if (
      !group.lectures.some((entry) => entry.video.id === interval.lecture.video.id)
    )
      group.lectures.push(interval.lecture);
  }
  return { whole, groups };
}

/** The group holding an Ayah, or null — where a jump to an Ayah lands. */
export function groupHolding<B, V>(
  layout: SurahTafsirLayout<B, V>,
  ayah: number,
): PassageGroup<B, V> | null {
  return layout.groups.find((group) => group.from <= ayah && ayah <= group.to) ?? null;
}

/* ---- The hub ------------------------------------------------------------- */

export interface SurahTafsirCount {
  readonly surah: number;
  readonly texts: number;
  readonly books: number;
  readonly lectures: number;
}

/**
 * Every Surah with what explains it — public Tafsir entries, books and
 * lectures — for the hub's Surah grid. Surahs with nothing are kept (the grid
 * is the whole Quran) with zero counts.
 */
export function surahCounts(input: {
  readonly texts: ReadonlyMap<number, number>;
  readonly books: readonly PassageSurahCount[];
  readonly lectures: readonly PassageSurahCount[];
}): readonly SurahTafsirCount[] {
  const books = new Map(input.books.map((row) => [row.surah, row.owners] as const));
  const lectures = new Map(input.lectures.map((row) => [row.surah, row.owners] as const));
  return Array.from({ length: SURAH_TOTAL }, (_, index) => {
    const surah = index + 1;
    return {
      surah,
      texts: input.texts.get(surah) ?? 0,
      books: books.get(surah) ?? 0,
      lectures: lectures.get(surah) ?? 0,
    };
  });
}

/**
 * Owners grouped under the Surah of their earliest passage, in Surah order —
 * how the hub shelves books and lectures. An owner appears once.
 */
export function bySurah<T extends WithPassages<QuranPassage>>(
  owners: readonly T[],
): readonly { readonly surah: number; readonly items: readonly T[] }[] {
  const groups = new Map<number, T[]>();
  for (const owner of owners) {
    const [first] = canonicalPassageOrder(owner.passages);
    if (first === undefined) continue;
    const list = groups.get(first.surah) ?? [];
    list.push(owner);
    groups.set(first.surah, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([surah, items]) => ({ surah, items }));
}

/** The passages an owner carries in one Surah, as citations, in order. */
export function citationsIn(
  passages: readonly QuranPassage[],
  surah: number | null,
): readonly string[] {
  return canonicalPassageOrder(
    surah === null ? passages : passages.filter((passage) => passage.surah === surah),
  ).map(passageCitation);
}

/**
 * A book's title as a reader of `locale` is shown it — the Library's own rule
 * (`labelFor`): the interface locale's label, else the primary locale's, else
 * the first — over the narrower titles a passage read carries.
 */
export function bookTitle<L extends string>(
  book: {
    readonly primaryLocale: L;
    readonly labels: readonly { readonly locale: L; readonly title: string }[];
  },
  locale: string,
): { readonly locale: L; readonly title: string } {
  const resolved =
    book.labels.find((label) => label.locale === locale) ??
    book.labels.find((label) => label.locale === book.primaryLocale) ??
    book.labels[0];
  return resolved === undefined
    ? { locale: book.primaryLocale, title: '' }
    : { locale: resolved.locale, title: resolved.title };
}
