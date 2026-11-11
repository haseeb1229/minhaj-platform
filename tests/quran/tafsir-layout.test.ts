import { describe, expect, it } from 'vitest';

import {
  bookTitle,
  bySurah,
  citationsIn,
  groupHolding,
  lectureHref,
  passageCitation,
  readLectureStart,
  resourceCount,
  resourcesForAyah,
  surahCounts,
  surahTafsirLayout,
  tafsirAyahPath,
  tafsirSurahPath,
  type TafsirResources,
} from '../../apps/web/src/components/quran/tafsir-layout.ts';

/**
 * Quran Part 8 — the Tafsir hub's one layout: what explains an Ayah (the
 * reader's Tafsir action and panel), a Surah's tafsir grouped by overlapping
 * passage, the hub's grid and shelves, and the addresses a lecture is opened
 * at. Pure, over synthetic owners: no Quran text is involved.
 */

interface Book {
  readonly id: string;
  readonly passages: readonly { surah: number; ayahFrom: number; ayahTo: number }[];
}
interface Lecture {
  readonly id: string;
  readonly passages: readonly {
    surah: number;
    ayahFrom: number;
    ayahTo: number;
    startSeconds: number | null;
  }[];
}

const entry = (id: string, surah: number, startAyah: number, endAyah: number) => ({
  workId: 'tafsir-1',
  entry: { id, surah, startAyah, endAyah, text: `NON_QURAN_FIXTURE ${id}` },
});

const resources: TafsirResources<Book, Lecture> = {
  texts: [entry('e1', 2, 1, 5), entry('e2', 2, 6, 10), entry('e3', 2, 255, 257)],
  books: [
    { id: 'whole-baqarah', passages: [{ surah: 2, ayahFrom: 1, ayahTo: 286 }] },
    { id: 'kursi-book', passages: [{ surah: 2, ayahFrom: 255, ayahTo: 255 }] },
    {
      id: 'two-places',
      passages: [
        { surah: 2, ayahFrom: 3, ayahTo: 4 },
        { surah: 2, ayahFrom: 8, ayahTo: 9 },
        { surah: 18, ayahFrom: 1, ayahTo: 10 },
      ],
    },
  ],
  lectures: [
    {
      id: 'kursi-lecture',
      passages: [{ surah: 2, ayahFrom: 255, ayahTo: 256, startSeconds: 754 }],
    },
    {
      id: 'whole-lecture',
      passages: [{ surah: 2, ayahFrom: 1, ayahTo: 286, startSeconds: null }],
    },
  ],
};

describe('what explains one Ayah', () => {
  it('finds entries, books and lectures covering it — a lecture with its covering passage', () => {
    const found = resourcesForAyah(resources, 2, 255);
    expect(found.texts.map((text) => text.entry.id)).toEqual(['e3']);
    expect(found.books.map((book) => book.id)).toEqual(['whole-baqarah', 'kursi-book']);
    expect(
      found.lectures.map((lecture) => [lecture.video.id, lecture.passage.startSeconds]),
    ).toEqual([
      ['kursi-lecture', 754],
      ['whole-lecture', null],
    ]);
    expect(resourceCount(found)).toBe(5);
  });

  it('finds nothing where nothing explains it — the reader then offers no action', () => {
    const found = resourcesForAyah({ texts: [], books: [], lectures: [] }, 2, 255);
    expect(resourceCount(found)).toBe(0);
    expect(resourceCount(resourcesForAyah(resources, 3, 1))).toBe(0);
  });
});

describe('a Surah’s tafsir, grouped', () => {
  const layout = surahTafsirLayout(resources, 2);

  it('puts what explains the whole Surah first, and nowhere else', () => {
    expect(layout.whole.books.map((book) => book.id)).toEqual(['whole-baqarah']);
    expect(layout.whole.lectures.map((lecture) => lecture.video.id)).toEqual([
      'whole-lecture',
    ]);
    for (const group of layout.groups) {
      expect(group.books.map((book) => book.id)).not.toContain('whole-baqarah');
      expect(group.lectures.map((lecture) => lecture.video.id)).not.toContain(
        'whole-lecture',
      );
    }
  });

  it('merges overlapping passages and keeps adjoining ones apart', () => {
    expect(layout.groups.map((group) => [group.from, group.to])).toEqual([
      [1, 5],
      [6, 10],
      [255, 257],
    ]);
    const [first, second, third] = layout.groups;
    expect(first?.texts.map((text) => text.entry.id)).toEqual(['e1']);
    expect(first?.books.map((book) => book.id)).toEqual(['two-places']);
    expect(second?.books.map((book) => book.id)).toEqual(['two-places']);
    expect(third?.books.map((book) => book.id)).toEqual(['kursi-book']);
    expect(third?.lectures.map((lecture) => lecture.video.id)).toEqual(['kursi-lecture']);
  });

  it('names the group an Ayah is in, or none', () => {
    expect(groupHolding(layout, 256)?.from).toBe(255);
    expect(groupHolding(layout, 100)).toBeNull();
  });

  it('shows a book with two passages in one group once', () => {
    const merged = surahTafsirLayout(
      {
        texts: [],
        books: [
          {
            id: 'b',
            passages: [
              { surah: 2, ayahFrom: 1, ayahTo: 5 },
              { surah: 2, ayahFrom: 4, ayahTo: 8 },
            ],
          },
        ],
        lectures: [],
      },
      2,
    );
    expect(merged.groups).toHaveLength(1);
    expect(merged.groups[0]?.books).toHaveLength(1);
    expect([merged.groups[0]?.from, merged.groups[0]?.to]).toEqual([1, 8]);
  });

  it('treats an entry over the whole Surah as whole-Surah tafsir', () => {
    const whole = surahTafsirLayout(
      { texts: [entry('all', 1, 1, 7)], books: [], lectures: [] },
      1,
    );
    expect(whole.whole.texts).toHaveLength(1);
    expect(whole.groups).toEqual([]);
  });
});

describe('the hub', () => {
  it('lists all 114 Surahs with counts, zero where nothing explains one', () => {
    const counts = surahCounts({
      texts: new Map([[2, 3]]),
      books: [
        { surah: 2, owners: 4 },
        { surah: 18, owners: 1 },
      ],
      lectures: [{ surah: 2, owners: 2 }],
    });
    expect(counts).toHaveLength(114);
    expect(counts[1]).toEqual({ surah: 2, texts: 3, books: 4, lectures: 2 });
    expect(counts[17]).toEqual({ surah: 18, texts: 0, books: 1, lectures: 0 });
    expect(counts[0]).toEqual({ surah: 1, texts: 0, books: 0, lectures: 0 });
  });

  it('shelves each owner once, under the Surah of its earliest passage', () => {
    expect(
      bySurah(resources.books).map((shelf) => [
        shelf.surah,
        shelf.items.map((book) => book.id),
      ]),
    ).toEqual([[2, ['whole-baqarah', 'kursi-book', 'two-places']]]);
    expect(
      bySurah([
        {
          id: 'x',
          passages: [
            { surah: 18, ayahFrom: 1, ayahTo: 10 },
            { surah: 1, ayahFrom: 1, ayahTo: 7 },
          ],
        },
      ]),
    ).toEqual([{ surah: 1, items: [{ id: 'x', passages: expect.any(Array) }] }]);
  });

  it('writes passages as citations, in order, optionally within one Surah', () => {
    expect(passageCitation({ surah: 2, ayahFrom: 255, ayahTo: 255 })).toBe('2:255');
    expect(passageCitation({ surah: 18, ayahFrom: 1, ayahTo: 10 })).toBe('18:1–10');
    expect(citationsIn(resources.books[2]?.passages ?? [], 2)).toEqual([
      '2:3–4',
      '2:8–9',
    ]);
    expect(citationsIn(resources.books[2]?.passages ?? [], null)).toEqual([
      '2:3–4',
      '2:8–9',
      '18:1–10',
    ]);
  });

  it('chooses a book’s title by the Library’s own rule', () => {
    const book = {
      primaryLocale: 'ur' as const,
      labels: [
        { locale: 'en' as const, title: 'English title' },
        { locale: 'ur' as const, title: 'اردو عنوان' },
      ],
    };
    expect(bookTitle(book, 'en')).toEqual({ locale: 'en', title: 'English title' });
    expect(bookTitle(book, 'ar')).toEqual({ locale: 'ur', title: 'اردو عنوان' });
  });
});

describe('addresses', () => {
  it('places a Surah’s and an Ayah’s tafsir under the hub, localised', () => {
    expect(tafsirSurahPath('en', 18)).toBe('/quran/tafsir/surah/18');
    expect(tafsirSurahPath('ur', 18)).toBe('/ur/quran/tafsir/surah/18');
    expect(tafsirAyahPath('ar', 2, 255)).toBe('/ar/quran/tafsir/surah/2#tafsir-2-255');
  });

  it('opens a lecture at its passage’s start, and at the beginning without one', () => {
    const at = (startSeconds: number | null) => ({
      surah: 2,
      ayahFrom: 1,
      ayahTo: 1,
      startSeconds,
    });
    expect(lectureHref('/watch/videos/a', at(754))).toBe('/watch/videos/a?start=754');
    expect(lectureHref('/watch/videos/a', at(null))).toBe('/watch/videos/a');
    expect(lectureHref('/watch/videos/a', at(0))).toBe('/watch/videos/a');
  });

  it('reads `?start=` only as whole seconds within the video', () => {
    expect(readLectureStart('754', 3600)).toBe(754);
    expect(readLectureStart('754', null)).toBe(754);
    expect(readLectureStart('3600', 3600)).toBeNull();
    for (const wrong of ['0', '-5', '12:34', '1e3', '86400', '', undefined, ['754']])
      expect(readLectureStart(wrong as never, null)).toBeNull();
  });
});
