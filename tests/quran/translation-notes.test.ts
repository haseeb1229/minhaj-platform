import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type {
  AyahSearchRecord,
  PublicLayerWork,
  QuranPublicReaderPort,
  TranslationNote,
} from '../../packages/contracts/src/quran/index.ts';
import {
  TRANSLATION_NOTE_MARKER,
  tieTranslationNotes,
  translationInputSchema,
  translationNoteMarks,
  translationTextChangeSchema,
} from '../../packages/contracts/src/quran/index.ts';
import type { SearchHit } from '../../packages/contracts/src/search/index.ts';
import { createQuranSearchProjection } from '../../apps/web/src/contexts/quran/index.ts';
import {
  comparePath,
  compareRequest,
  coverageSummary,
  inReadingOrder,
} from '../../apps/web/src/components/quran/compare.ts';
import { TranslationText } from '../../apps/web/src/components/quran/scripture.tsx';
import {
  noteParagraphs,
  noteSegments,
} from '../../apps/web/src/components/quran/translation-notes.ts';
import { layersShown } from '../../apps/web/src/components/quran/search-view.ts';
import { quranHitDisplays } from '../../apps/web/src/components/search/quran-hit.ts';

/**
 * Quran Part 6 — the translator's notes: the one rule that ties a note to a
 * mark in its translation, how the reader cuts the text at those marks
 * without changing a character, what the notes look like on the page, the
 * translations pages' own rules (the compare view's address, the order works
 * are shown in, coverage counted, never claimed), and how notes are matched
 * and shown by search — as notes, never as the translation.
 *
 * NOTHING HERE IS THE QURAN OR A REAL NOTE. Every text is a
 * `NON_QURAN_FIXTURE` sentinel; the marks are the shapes the source uses.
 */

const note = (
  ordinal: number,
  marker: string,
  text = `NON_QURAN_FIXTURE_NOTE_${String(ordinal)}`,
) => ({ ordinal, marker, text }) satisfies TranslationNote;

describe('the tie rule', () => {
  it('finds every star run and numbered mark, in order', () => {
    expect(
      translationNoteMarks('NON_QURAN_FIXTURE a٭ b* c** (1) d (12) e (0) (100)'),
    ).toEqual([
      { start: 19, end: 20, kind: 'star', size: 1 },
      { start: 22, end: 23, kind: 'star', size: 1 },
      { start: 25, end: 27, kind: 'star', size: 2 },
      { start: 28, end: 31, kind: 'numbered', size: 1 },
      { start: 34, end: 38, kind: 'numbered', size: 12 },
    ]);
  });

  it('ties star notes to star runs of their own length, in order, either spelling', () => {
    expect(tieTranslationNotes('x٭', [{ marker: '٭' }])).toEqual([0]);
    expect(tieTranslationNotes('x*', [{ marker: '٭' }])).toEqual([0]);
    expect(tieTranslationNotes('x٭', [{ marker: '٭:' }])).toEqual([0]);
    expect(tieTranslationNotes('a* b**', [{ marker: '*' }, { marker: '**' }])).toEqual([
      0, 1,
    ]);
    // Fewer notes than marks: the rest stay text.
    expect(tieTranslationNotes('a٭ b٭', [{ marker: '٭' }])).toEqual([0]);
    // A length no run has, a second note for one mark, or the wrong order.
    expect(tieTranslationNotes('a*', [{ marker: '**' }])).toBeNull();
    expect(tieTranslationNotes('a٭', [{ marker: '٭' }, { marker: '٭' }])).toBeNull();
    expect(tieTranslationNotes('a** b*', [{ marker: '*' }, { marker: '**' }])).toBeNull();
  });

  it('carries star notes on a text with no star mark as the Ayah’s own', () => {
    expect(tieTranslationNotes('no mark at all', [{ marker: '*' }])).toEqual([null]);
    expect(tieTranslationNotes('a (1)', [{ marker: '*' }])).toEqual([null]);
  });

  it('ties numbered entries 1…m to the marks (1)…(m), exactly', () => {
    expect(
      tieTranslationNotes('a (1) b (2)', [{ marker: '1:-' }, { marker: '2:-' }]),
    ).toEqual([0, 1]);
    expect(tieTranslationNotes('a (1) b (2)', [{ marker: '1:-' }])).toBeNull();
    expect(tieTranslationNotes('a (2)', [{ marker: '1:-' }])).toBeNull();
    expect(
      tieTranslationNotes('a (1) b (2)', [{ marker: '2:-' }, { marker: '1:-' }]),
    ).toBeNull();
    // Numbered marks no note answers stay text.
    expect(tieTranslationNotes('a (20)', [])).toEqual([]);
  });

  it('ties an unmarked note only as the Ayah’s only note, to its one mark', () => {
    expect(tieTranslationNotes('a٭', [{ marker: '' }])).toEqual([0]);
    expect(tieTranslationNotes('no mark', [{ marker: '' }])).toEqual([null]);
    expect(tieTranslationNotes('a٭ b (1)', [{ marker: '' }])).toBeNull();
    expect(tieTranslationNotes('a٭', [{ marker: '' }, { marker: '٭' }])).toBeNull();
  });

  it('refuses a marker of no admitted shape, and more than twenty notes', () => {
    for (const marker of ['#', '٭٭٭٭٭', '0:-', '100:-', ' ٭', '٭ ', '::', '1:'])
      expect(TRANSLATION_NOTE_MARKER.test(marker), marker).toBe(false);
    expect(tieTranslationNotes('a٭', [{ marker: '#' }])).toBeNull();
    expect(
      tieTranslationNotes(
        'no mark',
        Array.from({ length: 21 }, () => ({ marker: '*' })),
      ),
    ).toBeNull();
  });

  it('refuses notes the schema would have to repair, and notes on a removed text', () => {
    const ok = { ayah: 1, text: 'NON_QURAN_FIXTURE٭' };
    expect(
      translationTextChangeSchema.safeParse({
        ...ok,
        notes: [{ marker: '٭', text: 'NON_QURAN_FIXTURE_NOTE' }],
      }).success,
    ).toBe(true);
    expect(translationTextChangeSchema.safeParse(ok).success).toBe(true);
    for (const change of [
      { ...ok, notes: [{ marker: '٭', text: ' padded' }] },
      { ...ok, notes: [{ marker: '٭', text: '' }] },
      { ...ok, notes: [{ marker: '٭', text: 'x', extra: true }] },
      { ayah: 1, text: null, notes: [{ marker: '٭', text: 'x' }] },
    ])
      expect(translationTextChangeSchema.safeParse(change).success).toBe(false);
  });

  it('keeps the compare view’s address free of any translation’s slug', () => {
    const value = {
      slug: 'compare',
      name: 'NON_QURAN_FIXTURE',
      description: null,
      attribution: null,
      languageCode: 'en',
      sourceId: null,
      contributors: [],
    };
    expect(translationInputSchema.safeParse(value).success).toBe(false);
    expect(
      translationInputSchema.safeParse({ ...value, slug: 'compare-notes' }).success,
    ).toBe(true);
  });
});

describe('the tie rule for bracketed footnote marks (QuranEnc, owner decision 2026-11-10)', () => {
  it('finds "[1]" … "[9999]" as bracketed marks, and nothing else in brackets', () => {
    expect(
      translationNoteMarks('NON_QURAN_FIXTURE [All] a[8] b[2017] [0] [10000] [x]'),
    ).toEqual([
      { start: 25, end: 28, kind: 'bracketed', size: 8 },
      { start: 30, end: 36, kind: 'bracketed', size: 2017 },
    ]);
    for (const marker of ['[1]', '[9999]'])
      expect(TRANSLATION_NOTE_MARKER.test(marker), marker).toBe(true);
    for (const marker of ['[0]', '[01]', '[10000]', '[1', '[ 1]', '[a]'])
      expect(TRANSLATION_NOTE_MARKER.test(marker), marker).toBe(false);
  });

  it('ties each "[n]" to the ONE mark "[n]", in the marks’ order', () => {
    expect(
      tieTranslationNotes('a[3] [all] b[4]', [{ marker: '[3]' }, { marker: '[4]' }]),
    ).toEqual([0, 1]);
    // Fewer notes than marks: the rest stay text.
    expect(tieTranslationNotes('a[3] b[4]', [{ marker: '[4]' }])).toEqual([1]);
    // A mark the text lacks, the wrong order, or a mark set twice.
    expect(tieTranslationNotes('a[3]', [{ marker: '[4]' }])).toBeNull();
    expect(
      tieTranslationNotes('a[3] b[4]', [{ marker: '[4]' }, { marker: '[3]' }]),
    ).toBeNull();
    expect(tieTranslationNotes('a[3] b[3]', [{ marker: '[3]' }])).toBeNull();
    expect(
      tieTranslationNotes('a[3]', [{ marker: '[3]' }, { marker: '[3]' }]),
    ).toBeNull();
  });

  it('leaves the earlier shapes’ rules exactly as they were beside bracketed marks', () => {
    // An unmarked note answers the one star or numbered mark, not a footnote number.
    expect(tieTranslationNotes('a٭ b[1]', [{ marker: '' }])).toEqual([0]);
    expect(tieTranslationNotes('a[1]', [{ marker: '' }])).toEqual([null]);
    expect(tieTranslationNotes('a* b[1]', [{ marker: '*' }, { marker: '[1]' }])).toEqual([
      0, 1,
    ]);
  });

  it('cuts a bracketed mark out exactly, the text joined unchanged', () => {
    const text = 'NON_QURAN_FIXTURE [All] praise[4] -';
    const segments = noteSegments(text, [{ marker: '[4]' }]);
    expect(segments).toEqual([
      { text: 'NON_QURAN_FIXTURE [All] praise', note: null },
      { text: '[4]', note: 0 },
      { text: ' -', note: null },
    ]);
    expect(segments.map((segment) => segment.text).join('')).toBe(text);
  });
});

describe('the text cut at its notes’ marks', () => {
  it('joins back into the stored text, character for character', () => {
    for (const [text, notes] of [
      ['NON_QURAN_FIXTURE a٭ b', [note(1, '٭')]],
      ['NON_QURAN_FIXTURE (1) a (2)', [note(1, '1:-'), note(2, '2:-')]],
      ['NON_QURAN_FIXTURE a* b**', [note(1, '*'), note(2, '**')]],
      ['NON_QURAN_FIXTURE a٭', [note(1, '')]],
      ['NON_QURAN_FIXTURE no mark', [note(1, '*')]],
      ['NON_QURAN_FIXTURE a٭ b٭', [note(1, '٭')]],
    ] as const) {
      const segments = noteSegments(text, notes);
      expect(segments.map((segment) => segment.text).join(''), text).toBe(text);
    }
  });

  it('makes only the marks a note answers into notes', () => {
    expect(noteSegments('a٭ b٭', [note(1, '٭')])).toEqual([
      { text: 'a', note: null },
      { text: '٭', note: 0 },
      { text: ' b٭', note: null },
    ]);
    expect(noteSegments('a* b**', [note(1, '*'), note(2, '**')])).toEqual([
      { text: 'a', note: null },
      { text: '*', note: 0 },
      { text: ' b', note: null },
      { text: '**', note: 1 },
    ]);
    // An Ayah-level note, no note, or notes the rule cannot tie: the text whole.
    expect(noteSegments('no mark', [note(1, '*')])).toEqual([
      { text: 'no mark', note: null },
    ]);
    expect(noteSegments('a٭', [])).toEqual([{ text: 'a٭', note: null }]);
    expect(noteSegments('a٭', [note(1, '٭'), note(2, '٭')])).toEqual([
      { text: 'a٭', note: null },
    ]);
  });

  it('reads a note’s paragraphs as its source separated them', () => {
    expect(noteParagraphs('one')).toEqual(['one']);
    expect(noteParagraphs('one\n\ntwo')).toEqual(['one', 'two']);
    expect(noteParagraphs('one\ntwo')).toEqual(['one\ntwo']);
  });
});

/* ===========================================================================
 * The rendered translation
 * ========================================================================= */

function all(node: ReactNode, tag: string): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((child: ReactNode) => all(child, tag));
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  const own = element.type === tag ? [element] : [];
  return [...own, ...all(element.props.children as ReactNode, tag)];
}

/** The text a node renders, as a browser's `textContent` would read it. */
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (!isValidElement(node)) return '';
  return textOf((node as ReactElement<{ children?: ReactNode }>).props.children);
}

const LABELS = {
  locale: 'en',
  direction: 'ltr',
  summary: 'Translator’s note',
  reference: (number: number) => `Translator’s note ${String(number)}`,
} as const;

describe('a translation with its notes', () => {
  const render = (text: string, notes: readonly TranslationNote[], open = false) =>
    TranslationText({
      id: 'translation-2-3',
      label: 'Translation: Sample work',
      name: 'Sample work',
      text,
      language: { code: 'ur', direction: 'rtl' },
      index: 0,
      notes,
      noteLabels: LABELS,
      open,
    });

  it('draws each answered mark as a link to its note, the text unchanged', () => {
    const text = 'NON_QURAN_FIXTURE ایک٭ دو';
    const tree = render(text, [note(1, '٭', 'NON_QURAN_FIXTURE_NOTE\n\nsecond')]);
    const [paragraph] = all(tree, 'p');
    // What Copy reads (`textContent` of the translation) is the stored text.
    expect(textOf(paragraph?.props['children'] as ReactNode)).toBe(text);
    const [link, ...others] = all(paragraph?.props['children'] as ReactNode, 'a');
    expect(others).toEqual([]);
    expect(link?.props['href']).toBe('#translation-2-3-note-1');
    expect(link?.props['data-note-ref']).toBe('translation-2-3-note-1');
    expect(link?.props['children']).toBe('٭');
    // Its name carries the mark it shows (WCAG 2.5.3, label in name).
    expect(link?.props['aria-label']).toBe('٭ Translator’s note 1');
  });

  it('lists the notes in a disclosure, in the translation’s language and direction', () => {
    const tree = render('NON_QURAN_FIXTURE a٭', [note(1, '٭', 'one\n\ntwo')]);
    const [details] = all(tree, 'details');
    expect(details?.props['open']).toBe(false);
    const [summary] = all(tree, 'summary');
    expect(summary?.props['lang']).toBe('en');
    expect(summary?.props['children']).toBe('Translator’s note');
    const [list] = all(tree, 'ol');
    expect(list?.props['lang']).toBe('ur');
    expect(list?.props['dir']).toBe('rtl');
    const [item] = all(tree, 'li');
    expect(item?.props['id']).toBe('translation-2-3-note-1');
    // The marker as written, then the note's paragraphs exactly.
    expect(textOf(item?.props['children'] as ReactNode)).toBe('٭ onetwo');
    expect(
      all(item?.props['children'] as ReactNode, 'span')
        .filter((span) => span.props['data-note-paragraph'] === '')
        .map((span) => span.props['children']),
    ).toEqual(['one', 'two']);
    expect(all(render('x٭', [note(1, '٭')], true), 'details')[0]?.props['open']).toBe(
      true,
    );
  });

  it('lists an Ayah-level note without placing it in the text', () => {
    const text = 'NON_QURAN_FIXTURE no mark';
    const tree = render(text, [note(1, '*')]);
    const [paragraph] = all(tree, 'p');
    expect(paragraph?.props['children']).toBe(text);
    expect(all(tree, 'li')).toHaveLength(1);
  });

  it('draws nothing more for a translation without notes', () => {
    const tree = render('NON_QURAN_FIXTURE a٭', []);
    expect(all(tree, 'details')).toEqual([]);
    expect(all(tree, 'p')[0]?.props['children']).toBe('NON_QURAN_FIXTURE a٭');
  });
});

/* ===========================================================================
 * The translations pages' rules
 * ========================================================================= */

const SURAHS = [
  { number: 1, ayahCount: 3 },
  { number: 2, ayahCount: 4 },
  { number: 3, ayahCount: 45 },
];

describe('the compare view and coverage', () => {
  it('addresses one Ayah, locale-prefixed once', () => {
    expect(comparePath('en', { surah: 2, ayah: 3 })).toBe(
      '/quran/translations/compare?surah=2&ayah=3',
    );
    expect(comparePath('ur', { surah: 2, ayah: 3 })).toBe(
      '/ur/quran/translations/compare?surah=2&ayah=3',
    );
  });

  it('shows the Ayah asked for, the first by default, and says when none exists', () => {
    expect(compareRequest({}, SURAHS)).toEqual({
      kind: 'shown',
      ref: { surah: 1, ayah: 1 },
    });
    expect(compareRequest({ surah: '2', ayah: '4' }, SURAHS)).toEqual({
      kind: 'shown',
      ref: { surah: 2, ayah: 4 },
    });
    expect(compareRequest({ surah: '3' }, SURAHS)).toEqual({
      kind: 'shown',
      ref: { surah: 3, ayah: 1 },
    });
    for (const query of [
      { surah: '2', ayah: '5' },
      { surah: '4', ayah: '1' },
      { surah: '02', ayah: '1' },
      { surah: '2', ayah: 'x' },
      { surah: ['2', '3'], ayah: '1' },
    ])
      expect(compareRequest(query, SURAHS)?.kind, JSON.stringify(query)).toBe('missing');
    expect(compareRequest({}, [])).toBeNull();
  });

  it('orders works as the reader does: the interface language, Urdu, English, the rest', () => {
    const works = ['fr', 'en', 'ur', 'en-GB', 'ar'].map((languageCode, index) => ({
      languageCode,
      slug: `w${String(index)}`,
    })) as unknown as readonly PublicLayerWork[];
    const order = (locale: 'en' | 'ur' | 'ar') =>
      inReadingOrder(works, locale).map((work) => work.languageCode);
    expect(order('en')).toEqual(['en', 'en-GB', 'ur', 'fr', 'ar']);
    expect(order('ur')).toEqual(['ur', 'en', 'en-GB', 'fr', 'ar']);
    expect(order('ar')).toEqual(['ar', 'ur', 'en', 'en-GB', 'fr']);
  });

  it('counts coverage against the corpus’s own Surahs, never more than they hold', () => {
    const summary = coverageSummary(
      {
        workId: 'w',
        surahs: [
          { surah: 1, ayat: 3, notes: 1 },
          { surah: 2, ayat: 2, notes: 0 },
          { surah: 9, ayat: 5, notes: 2 },
        ],
      },
      SURAHS,
    );
    expect(summary).toMatchObject({
      complete: 1,
      partial: 1,
      surahs: 3,
      ayat: 5,
      totalAyat: 52,
      notes: 1,
    });
    expect(summary.bySurah.get(3)).toEqual({ ayat: 0, notes: 0 });
    expect(coverageSummary(undefined, SURAHS)).toMatchObject({
      complete: 0,
      partial: 0,
      ayat: 0,
      notes: 0,
    });
  });
});

/* ===========================================================================
 * Search — notes are matched, as notes
 * ========================================================================= */

const layer = (
  kind: 'translation' | 'note',
  slug: string,
  languageCode: string,
  text: string,
) => ({
  kind,
  slug,
  name: `NON_QURAN_FIXTURE ${slug}`,
  languageCode,
  text,
});

const RECORD: AyahSearchRecord = {
  surah: 2,
  ayah: 3,
  text: 'NON_QURAN_FIXTURE_CANONICAL_2_3',
  stamp: 'fixture-stamp',
  topicIds: [],
  layers: [
    layer('translation', 'b-work', 'en', 'NON_QURAN_FIXTURE translation b*'),
    layer('translation', 'a-work', 'en', 'NON_QURAN_FIXTURE translation a'),
    layer('note', 'b-work', 'en', 'NON_QURAN_FIXTURE note Antioch'),
    layer('translation', 'u-work', 'ur', 'NON_QURAN_FIXTURE ترجمہ٭'),
    layer('note', 'u-work', 'ur', 'NON_QURAN_FIXTURE حاشیہ'),
  ],
};

describe('search', () => {
  it('matches each note in its language’s document, after every text, never as its summary', async () => {
    const reader = {
      searchAyah: async () => RECORD,
    } as unknown as QuranPublicReaderPort;
    const projected = await createQuranSearchProjection(reader).source.project('2:3');
    const english = projected?.documents.find((doc) => doc.textLanguage === 'en');
    expect(english?.summary).toBe('NON_QURAN_FIXTURE translation a');
    expect(english?.body).toBe(
      'NON_QURAN_FIXTURE translation b*\n\nNON_QURAN_FIXTURE note Antioch',
    );
    const urdu = projected?.documents.find((doc) => doc.textLanguage === 'ur');
    expect(urdu?.summary).toBe('NON_QURAN_FIXTURE ترجمہ٭');
    expect(urdu?.body).toBe('NON_QURAN_FIXTURE حاشیہ');
  });

  it('displays a translation for a hit in its language, never a note', () => {
    const hit = {
      kind: 'quran-ayah',
      resourceId: '2:3',
      textLanguage: 'en',
    } as unknown as SearchHit;
    const record: AyahSearchRecord = {
      ...RECORD,
      layers: [
        layer('note', 'a-work', 'en', 'NON_QURAN_FIXTURE note'),
        layer('translation', 'b-work', 'en', 'NON_QURAN_FIXTURE translation b'),
      ],
    };
    const [display] = [...quranHitDisplays([hit], [record]).values()];
    expect(display).toEqual({
      layer: 'layer',
      kind: 'translation',
      language: 'en',
      text: 'NON_QURAN_FIXTURE translation b',
    });
  });

  it('shows a note under a result only where the typed words mark it, after the texts', () => {
    const shown = (query: string, language: string | null = null) =>
      layersShown(RECORD, { hitLanguage: 'en', language, locale: 'en', query }).map(
        (entry) => `${entry.kind}:${entry.slug}`,
      );
    expect(shown('Antioch')).toEqual(['note:b-work']);
    expect(shown('translation')).toEqual(['translation:a-work', 'translation:b-work']);
    expect(shown('NON_QURAN_FIXTURE')).toEqual([
      'translation:a-work',
      'translation:b-work',
      'translation:u-work',
    ]);
    // A chosen language: its texts, and its notes only where the words mark them.
    expect(shown('translation', 'en')).toEqual([
      'translation:a-work',
      'translation:b-work',
    ]);
    expect(shown('Antioch', 'en')).toEqual([
      'translation:a-work',
      'translation:b-work',
      'note:b-work',
    ]);
  });
});
