import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import {
  ArabicText,
  TranslationText,
} from '../../apps/web/src/components/quran/scripture.tsx';
import {
  arabicIndic,
  ayahCopyText,
  citationLine,
} from '../../apps/web/src/components/quran/citation.ts';
import {
  QUICK_JUMP_MAX_LENGTH,
  foldName,
  parseQuickJump,
  quickJumpPathOf,
  type JumpSurah,
} from '../../apps/web/src/components/quran/quick-jump.ts';
import {
  DEFAULT_PREFERENCES,
  SCALE,
  availableShows,
  defaultShow,
  readLastRead,
  readPreferences,
  resolveShow,
  stepScale,
  writeLastRead,
  writePreferences,
} from '../../apps/web/src/components/quran/reader-preferences.ts';

/**
 * R2 — THE QURAN READER'S OWN DECISIONS: the quick jump ("18", "18:10", a
 * name, "juz 15"), the browser-only preferences and last-read place, the
 * copied citation — and the one rule above all the others, that the Arabic a
 * page renders and a reader copies is the stored string, byte for byte.
 *
 * NOTHING HERE IS THE QURAN. The index below is synthetic structure with
 * made-up names; the "Arabic" is a sentinel carrying the characters a careless
 * transform would damage (combining marks, tatweel, the small high signs,
 * surrounding spaces, a non-joiner).
 */

const INDEX: readonly JumpSurah[] = [
  { number: 1, ayahCount: 7, names: ['Al-Fixture', 'الفكسچر'] },
  { number: 2, ayahCount: 4, names: ['Al-Sample'] },
  { number: 18, ayahCount: 110, names: ['Al-Kahf', 'الكهف'] },
  { number: 19, ayahCount: 98, names: ['Maryam', 'مريم'] },
  { number: 114, ayahCount: 6, names: ['An-Nas', 'الناس'] },
];

/** Not Quran text: a sentinel full of characters that must survive untouched. */
const SENTINEL = ' NON_QURAN_FIXTURE بِسْمِ ٱلْـمِثَالِ ۝ ٰـۖ‌ ۖۚ ';

describe('the quick jump', () => {
  it('opens a Surah by its number, and only one the corpus has', () => {
    expect(parseQuickJump('18', INDEX)).toEqual({ kind: 'surah', surah: 18 });
    expect(parseQuickJump(' 114 ', INDEX)).toEqual({ kind: 'surah', surah: 114 });
    expect(parseQuickJump('3', INDEX)).toEqual({ kind: 'unknown' });
    expect(parseQuickJump('115', INDEX)).toEqual({ kind: 'unknown' });
    expect(parseQuickJump('0', INDEX)).toEqual({ kind: 'unknown' });
  });

  it('opens a citation in any common spelling, within the Surah’s own count', () => {
    for (const input of [
      '18:10',
      '18 10',
      '18.10',
      '18-10',
      '18/10',
      '18،10',
      '١٨:١٠',
      '۱۸:۱۰',
    ])
      expect(parseQuickJump(input, INDEX), input).toEqual({
        kind: 'ayah',
        surah: 18,
        ayah: 10,
      });
    expect(parseQuickJump('18:110', INDEX)).toEqual({
      kind: 'ayah',
      surah: 18,
      ayah: 110,
    });
    expect(parseQuickJump('18:111', INDEX)).toEqual({ kind: 'unknown' });
    expect(parseQuickJump('18:0', INDEX)).toEqual({ kind: 'unknown' });
    expect(parseQuickJump('3:1', INDEX)).toEqual({ kind: 'unknown' });
  });

  it('opens a Juz in the three interface languages, 1 to 30 only', () => {
    expect(parseQuickJump('juz 15', INDEX)).toEqual({ kind: 'juz', juz: 15 });
    expect(parseQuickJump('Juz15', INDEX)).toEqual({ kind: 'juz', juz: 15 });
    expect(parseQuickJump('para 30', INDEX)).toEqual({ kind: 'juz', juz: 30 });
    expect(parseQuickJump('پارہ ۱۵', INDEX)).toEqual({ kind: 'juz', juz: 15 });
    expect(parseQuickJump('الجزء 1', INDEX)).toEqual({ kind: 'juz', juz: 1 });
    expect(parseQuickJump('juz 31', INDEX)).toEqual({ kind: 'unknown' });
    expect(parseQuickJump('juz 0', INDEX)).toEqual({ kind: 'unknown' });
  });

  it('finds a Surah by a RECORDED name — whole, its start, or within it', () => {
    expect(parseQuickJump('kahf', INDEX)).toEqual({ kind: 'surah', surah: 18 });
    expect(parseQuickJump('Al-Kahf', INDEX)).toEqual({ kind: 'surah', surah: 18 });
    expect(parseQuickJump('surah al kahf', INDEX)).toEqual({ kind: 'surah', surah: 18 });
    expect(parseQuickJump('الكهف', INDEX)).toEqual({ kind: 'surah', surah: 18 });
    expect(parseQuickJump('سورة الْكَهْف', INDEX)).toEqual({ kind: 'surah', surah: 18 });
    expect(parseQuickJump('mary', INDEX)).toEqual({ kind: 'surah', surah: 19 });
    expect(parseQuickJump('nas', INDEX)).toEqual({ kind: 'surah', surah: 114 });
  });

  it('never guesses: a name nobody recorded, noise and over-long input match nothing', () => {
    expect(parseQuickJump('kahfx', INDEX)).toEqual({ kind: 'unknown' });
    expect(parseQuickJump('', INDEX)).toEqual({ kind: 'unknown' });
    expect(parseQuickJump('   ', INDEX)).toEqual({ kind: 'unknown' });
    expect(parseQuickJump('k', INDEX)).toEqual({ kind: 'unknown' });
    expect(parseQuickJump('<script>', INDEX)).toEqual({ kind: 'unknown' });
    expect(parseQuickJump('https://example.invalid/', INDEX)).toEqual({
      kind: 'unknown',
    });
    expect(parseQuickJump('1'.repeat(QUICK_JUMP_MAX_LENGTH + 1), INDEX)).toEqual({
      kind: 'unknown',
    });
    // With no names recorded at all, only numbers work.
    const unnamed = INDEX.map((surah) => ({ ...surah, names: [] }));
    expect(parseQuickJump('kahf', unnamed)).toEqual({ kind: 'unknown' });
    expect(parseQuickJump('18', unnamed)).toEqual({ kind: 'surah', surah: 18 });
  });

  it('builds its address from the confirmed numbers, never from the text typed', () => {
    expect(quickJumpPathOf({ kind: 'surah', surah: 18 })).toBe('/quran/surah/18');
    expect(quickJumpPathOf({ kind: 'ayah', surah: 18, ayah: 10 })).toBe(
      '/quran/surah/18/10',
    );
    expect(quickJumpPathOf({ kind: 'juz', juz: 15 })).toBe('/quran/juz/15');
    expect(quickJumpPathOf({ kind: 'unknown' })).toBeNull();
  });

  it('folds names for comparison only', () => {
    expect(foldName('Al-Kahf')).toBe('kahf');
    expect(foldName('الكَهْف')).toBe('كهف');
    expect(foldName('An-Nas')).toBe('annas');
  });
});

describe('the reader’s preferences, as this browser stores them', () => {
  it('round-trips what it writes', () => {
    const stored = {
      translations: 'both',
      arabicScale: 1.3,
      translationScale: 0.9,
    } as const;
    expect(readPreferences(writePreferences(stored))).toEqual(stored);
  });

  it('treats anything unreadable or out of range as the default, never as trust', () => {
    expect(readPreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(readPreferences('not json')).toEqual(DEFAULT_PREFERENCES);
    expect(readPreferences('[]')).toEqual(DEFAULT_PREFERENCES);
    expect(
      readPreferences(
        JSON.stringify({ translations: 'fr', arabicScale: 99, translationScale: '1.2' }),
      ),
    ).toEqual(DEFAULT_PREFERENCES);
    expect(
      readPreferences(JSON.stringify({ arabicScale: Number.NaN, translationScale: -1 })),
    ).toEqual(DEFAULT_PREFERENCES);
  });

  it('steps sizes on a clean grid and holds them inside the range', () => {
    expect(stepScale(1, 1)).toBe(1.1);
    expect(stepScale(1.1, 1)).toBe(1.2);
    expect(stepScale(1.2, -1)).toBe(1.1);
    let scale = SCALE.initial;
    for (let step = 0; step < 50; step += 1) scale = stepScale(scale, 1);
    expect(scale).toBe(SCALE.max);
    for (let step = 0; step < 50; step += 1) scale = stepScale(scale, -1);
    expect(scale).toBe(SCALE.min);
  });

  it('offers only the translation choices the page rendered', () => {
    expect(availableShows(['ur', 'en'])).toEqual(['ur', 'en', 'both', 'none']);
    expect(availableShows(['en'])).toEqual(['en', 'none']);
    expect(availableShows([])).toEqual(['none']);
  });

  it('defaults to the interface language’s translation; none in Arabic', () => {
    expect(defaultShow('ur', ['ur', 'en'])).toBe('ur');
    expect(defaultShow('en', ['ur', 'en'])).toBe('en');
    expect(defaultShow('ar', ['ur', 'en'])).toBe('none');
    expect(defaultShow('ur', ['en'])).toBe('en');
    expect(defaultShow('en', [])).toBe('none');
  });

  it('honours a stored choice only where the page can, else its own default', () => {
    expect(resolveShow('both', ['ur', 'en'], 'en')).toBe('both');
    expect(resolveShow('ur', ['en'], 'en')).toBe('en');
    expect(resolveShow('both', ['en'], 'en')).toBe('en');
    expect(resolveShow('none', [], 'none')).toBe('none');
    expect(resolveShow(null, ['ur', 'en'], 'ur')).toBe('ur');
  });

  it('keeps the last place read only when the corpus has it', () => {
    const counts = new Map([
      [18, 110],
      [114, 6],
    ]);
    expect(readLastRead(writeLastRead({ surah: 18, ayah: 10 }), counts)).toEqual({
      surah: 18,
      ayah: 10,
    });
    expect(readLastRead(writeLastRead({ surah: 18, ayah: 111 }), counts)).toBeNull();
    expect(readLastRead(writeLastRead({ surah: 19, ayah: 1 }), counts)).toBeNull();
    expect(readLastRead(JSON.stringify({ surah: 115, ayah: 1 }))).toBeNull();
    expect(readLastRead(JSON.stringify({ surah: 1.5, ayah: 1 }))).toBeNull();
    expect(readLastRead(JSON.stringify({ surah: '18', ayah: 1 }))).toBeNull();
    expect(readLastRead('{')).toBeNull();
    expect(readLastRead(null)).toBeNull();
  });
});

describe('what a reader copies', () => {
  it('names the place and the sources in one line', () => {
    expect(
      citationLine({
        label: 'Al-Kahf',
        ref: { surah: 18, ayah: 10 },
        sources: ['Tanzil Uthmani', 'Irfan-ul-Quran'],
      }),
    ).toBe('Al-Kahf 18:10 — Tanzil Uthmani / Irfan-ul-Quran');
    expect(citationLine({ label: null, ref: { surah: 2, ayah: 3 }, sources: [] })).toBe(
      '2:3',
    );
    expect(
      citationLine({ label: '', ref: { surah: 2, ayah: 3 }, sources: ['', 'Work'] }),
    ).toBe('2:3 — Work');
  });

  it('carries the Arabic first and byte for byte, everything else after it', () => {
    const text = ayahCopyText({
      arabic: SENTINEL,
      translations: ['First translation.', '', 'Second translation.'],
      citation: 'Al-Sample 2:3 — Tanzil Uthmani',
      url: 'https://example.invalid/quran/surah/2/3',
    });
    expect(text.startsWith(SENTINEL)).toBe(true);
    expect(text.slice(0, SENTINEL.length)).toBe(SENTINEL);
    expect(Buffer.from(text.slice(0, SENTINEL.length), 'utf8')).toEqual(
      Buffer.from(SENTINEL, 'utf8'),
    );
    expect(text).toBe(
      `${SENTINEL}\n\nFirst translation.\n\nSecond translation.\n\nAl-Sample 2:3 — Tanzil Uthmani\nhttps://example.invalid/quran/surah/2/3`,
    );
  });

  it('writes the ayah-end number in Arabic-Indic digits', () => {
    expect(arabicIndic(0)).toBe('٠');
    expect(arabicIndic(110)).toBe('١١٠');
    expect(arabicIndic(286)).toBe('٢٨٦');
  });
});

/* ===========================================================================
 * Rendering — the Arabic is the stored string, in its own text node
 * ========================================================================= */

/** Every host element of a given tag in a tree. */
function all(node: ReactNode, tag: string): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((child: ReactNode) => all(child, tag));
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  const own = element.type === tag ? [element] : [];
  return [...own, ...all(element.props.children as ReactNode, tag)];
}

describe('the rendered Ayah', () => {
  it('renders the stored Arabic as the ONLY child of its own element, unchanged', () => {
    const tree = ArabicText({
      id: 'arabic-2-3',
      label: 'Arabic text',
      text: SENTINEL,
      ayah: 3,
    });
    const [arabic, ...others] = all(tree, 'p');
    expect(others).toEqual([]);
    expect(arabic?.props['lang']).toBe('ar');
    expect(arabic?.props['dir']).toBe('rtl');
    expect(arabic?.props['translate']).toBe('no');
    // One text node, the stored string itself: nothing appended, trimmed or
    // normalised — compared as bytes, not as "looks the same".
    expect(arabic?.props['children']).toBe(SENTINEL);
    expect(Buffer.from(arabic?.props['children'] as string, 'utf8')).toEqual(
      Buffer.from(SENTINEL, 'utf8'),
    );
  });

  it('draws the ayah-end mark as a separate, hidden element', () => {
    const tree = ArabicText({
      id: 'arabic-2-3',
      label: 'Arabic text',
      text: SENTINEL,
      ayah: 3,
    });
    const marks = all(tree, 'span').filter(
      (span) => span.props['aria-hidden'] === 'true',
    );
    expect(marks).toHaveLength(1);
    expect(marks[0]?.props['children']).toBe('۝٣');
    // Without a number there is no mark at all.
    const bare = ArabicText({ id: 'arabic', label: 'Arabic text', text: SENTINEL });
    expect(
      all(bare, 'span').filter((span) => span.props['aria-hidden'] === 'true'),
    ).toEqual([]);
  });

  it('marks a translation with its own language and names its work', () => {
    const tree = TranslationText({
      id: 'translation-2-3',
      label: 'Translation: Sample work',
      name: 'Sample work',
      text: 'NON_QURAN_FIXTURE translation',
      language: { code: 'ur', direction: 'rtl' },
      quickChoice: 'ur',
    });
    const [text, attribution] = all(tree, 'p');
    expect(text?.props['lang']).toBe('ur');
    expect(text?.props['dir']).toBe('rtl');
    expect(text?.props['children']).toBe('NON_QURAN_FIXTURE translation');
    expect(attribution?.props['id']).toBe('translation-2-3');
    expect(attribution?.props['lang']).toBeUndefined();
    const group = tree as ReactElement<Record<string, unknown>>;
    expect(group.props['data-translation-language']).toBe('ur');
    expect(group.props['data-translation-work']).toBe('Sample work');
    // A translation the address chose carries no quick-choice mark.
    const chosen = TranslationText({
      id: 'ayah-translation',
      label: 'Translation: Sample work',
      name: 'Sample work',
      text: 'x',
      language: { code: 'en', direction: 'ltr' },
      quickChoice: null,
    }) as ReactElement<Record<string, unknown>>;
    expect('data-translation-language' in chosen.props).toBe(false);
  });
});
