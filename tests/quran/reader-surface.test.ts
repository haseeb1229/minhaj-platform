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
  PREFERENCES_KEY,
  READER_BOOT_SCRIPT,
  SCALE,
  TRANSLATIONS_RENDERED_MAX,
  defaultShown,
  layerShownOf,
  presentationOf,
  readLastRead,
  readPreferences,
  shownOf,
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
    expect(quickJumpPathOf({ kind: 'page', page: 50 })).toBe('/quran/page/50');
    expect(quickJumpPathOf({ kind: 'unknown' })).toBeNull();
  });

  it('opens a mushaf page only where the corpus records one (Quran Part 1)', () => {
    expect(parseQuickJump('page 50', INDEX, 604)).toEqual({ kind: 'page', page: 50 });
    expect(parseQuickJump('p50', INDEX, 604)).toEqual({ kind: 'page', page: 50 });
    expect(parseQuickJump('Page. 604', INDEX, 604)).toEqual({ kind: 'page', page: 604 });
    expect(parseQuickJump('صفحہ ۵۰', INDEX, 604)).toEqual({ kind: 'page', page: 50 });
    expect(parseQuickJump('الصفحة 3', INDEX, 604)).toEqual({ kind: 'page', page: 3 });
    expect(parseQuickJump('صفحة 3', INDEX, 604)).toEqual({ kind: 'page', page: 3 });
    // Past the last recorded page, page 0, or a corpus that records no pages.
    expect(parseQuickJump('page 605', INDEX, 604)).toEqual({ kind: 'unknown' });
    expect(parseQuickJump('page 0', INDEX, 604)).toEqual({ kind: 'unknown' });
    expect(parseQuickJump('page 5', INDEX)).toEqual({ kind: 'unknown' });
  });

  it('folds names for comparison only', () => {
    expect(foldName('Al-Kahf')).toBe('kahf');
    expect(foldName('الكَهْف')).toBe('كهف');
    // A doubled Latin letter is written once (Quran Part 2), so a reader's
    // "Fatiha" meets a recorded "Al-Faatiha" — on both sides of the comparison.
    expect(foldName('An-Nas')).toBe('anas');
    expect(foldName('Al-Faatiha')).toBe(foldName('Fatiha'));
  });
});

describe('the reader’s preferences, as this browser stores them', () => {
  it('round-trips what it writes', () => {
    const stored = {
      mode: 'mushaf',
      translationsOn: true,
      translations: ['work-b', 'work-a'],
      arabicScale: 1.3,
      translationScale: 0.9,
      leading: 'spacious',
      layout: 'side',
      notes: 'inline',
      transliteration: 'a-transliteration',
      words: 'a-word-by-word',
      tajweed: true,
    } as const;
    expect(readPreferences(writePreferences(stored))).toEqual(stored);
  });

  it('treats anything unreadable or out of range as the default, never as trust', () => {
    expect(readPreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(readPreferences('not json')).toEqual(DEFAULT_PREFERENCES);
    expect(readPreferences('[]')).toEqual(DEFAULT_PREFERENCES);
    expect(
      readPreferences(
        JSON.stringify({
          mode: 'audio',
          translations: 'fr',
          arabicScale: 99,
          translationScale: '1.2',
          leading: 'tight',
          layout: 'grid',
        }),
      ),
    ).toEqual(DEFAULT_PREFERENCES);
    expect(
      readPreferences(JSON.stringify({ arabicScale: Number.NaN, translationScale: -1 })),
    ).toEqual(DEFAULT_PREFERENCES);
    // A list with anything but slugs in it is no choice at all.
    expect(
      readPreferences(JSON.stringify({ translations: ['ok-slug', '<b>'] })).translations,
    ).toBeNull();
    expect(
      readPreferences(JSON.stringify({ translations: ['a1', 2] })).translations,
    ).toBeNull();
  });

  it('reads the R2 shape: "none" keeps translations off, any other is the default', () => {
    expect(readPreferences(JSON.stringify({ translations: 'none' }))).toEqual({
      ...DEFAULT_PREFERENCES,
      translationsOn: false,
    });
    expect(readPreferences(JSON.stringify({ translations: 'both' }))).toEqual(
      DEFAULT_PREFERENCES,
    );
  });

  it('keeps at most the rendered maximum of works, each once', () => {
    const many = ['aa', 'aa', 'bb', 'cc', 'dd', 'ee'];
    expect(readPreferences(JSON.stringify({ translations: many })).translations).toEqual([
      ...new Set(many.slice(0, TRANSLATIONS_RENDERED_MAX)),
    ]);
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

  it('shows the interface language’s translation by default; none in Arabic', () => {
    expect(defaultShown('ur', ['ur', 'en'])).toEqual([0]);
    expect(defaultShown('en', ['ur', 'en-GB'])).toEqual([1]);
    expect(defaultShown('ar', ['ur', 'en'])).toEqual([]);
    expect(defaultShown('ur', ['en'])).toEqual([0]);
    expect(defaultShown('en', [])).toEqual([]);
  });

  it('shows the works chosen among those rendered, else the page’s own default', () => {
    const page = {
      slugs: ['ur-work', 'en-work', 'fr-work'],
      defaults: [1],
      fixed: false,
    };
    const base = DEFAULT_PREFERENCES;
    expect(shownOf(base, page)).toEqual([1]);
    expect(shownOf({ ...base, translations: ['fr-work', 'ur-work'] }, page)).toEqual([
      0, 2,
    ]);
    // Nothing chosen is on this page: the default, never nothing by accident.
    expect(shownOf({ ...base, translations: ['gone'] }, page)).toEqual([1]);
    // Unticked on purpose, or switched off: none.
    expect(shownOf({ ...base, translations: [] }, page)).toEqual([]);
    expect(shownOf({ ...base, translationsOn: false }, page)).toEqual([]);
    // A work the ADDRESS chose always shows.
    expect(
      shownOf(
        { ...base, translationsOn: false },
        { slugs: ['en-work'], defaults: [0], fixed: true },
      ),
    ).toEqual([0]);
  });

  it('shows a study layer only when chosen and rendered, or fixed by the address (Part 7)', () => {
    const layer = { slugs: ['tr-one', 'tr-two'], fixed: false };
    expect(layerShownOf(null, layer)).toBe('');
    expect(layerShownOf('tr-two', layer)).toBe('1');
    // A work this page did not render — withdrawn, or never public — is none.
    expect(layerShownOf('gone', layer)).toBe('');
    expect(layerShownOf('tr-one', { slugs: [], fixed: false })).toBe('');
    // A work the ADDRESS chose always shows, whatever is stored.
    expect(layerShownOf(null, { slugs: ['tr-two'], fixed: true })).toBe('0');
    // Stored values are slugs or nothing.
    expect(
      readPreferences(JSON.stringify({ transliteration: 'B!', words: ['a'] })),
    ).toEqual(DEFAULT_PREFERENCES);
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

/* ===========================================================================
 * The boot script — the same rules before the first paint
 * ========================================================================= */

interface FakeReader {
  readonly attributes: Map<string, string>;
  readonly properties: Map<string, string>;
}

/** Runs the boot script against a fake reader element and a stored value. */
function boot(raw: string | null, attributes: Record<string, string>, throws = false) {
  const reader: FakeReader = {
    attributes: new Map(Object.entries(attributes)),
    properties: new Map(),
  };
  const element = {
    hasAttribute: (name: string) => reader.attributes.has(name),
    getAttribute: (name: string) => reader.attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => reader.attributes.set(name, value),
    style: {
      setProperty: (name: string, value: string) => reader.properties.set(name, value),
    },
  };
  const storage = {
    getItem: (key: string) => {
      if (throws) throw new Error('blocked');
      return key === PREFERENCES_KEY ? raw : null;
    },
  };
  // eslint-disable-next-line no-new-func -- the boot script is the code under test
  new Function('window', 'document', READER_BOOT_SCRIPT)(
    { localStorage: storage },
    { currentScript: { parentElement: element } },
  );
  return reader;
}

const PAGES = [
  {
    attributes: {
      'data-mode': 'translation',
      'data-modes': '',
      'data-slugs': 'ur-work en-work',
      'data-shown': '1',
      'data-leading': 'comfortable',
      'data-layout': 'stacked',
      'data-notes': 'request',
      'data-transliterations': 'tr-one tr-two',
      'data-transliteration': '',
      'data-word-works': 'wbw-one',
      'data-words': '',
      'data-tajweed-overlay': '',
      'data-tajweed': '',
    },
    page: {
      slugs: ['ur-work', 'en-work'],
      defaults: [1],
      fixed: false,
      modes: true,
      explicitSize: false,
      transliterations: { slugs: ['tr-one', 'tr-two'], fixed: false },
      words: { slugs: ['wbw-one'], fixed: false },
      tajweed: true,
    },
  },
  {
    attributes: {
      'data-mode': 'translation',
      'data-slugs': 'en-work',
      'data-shown': '0',
      'data-fixed': '',
      'data-explicit-size': '',
      'data-leading': 'comfortable',
      'data-layout': 'stacked',
      'data-notes': 'request',
      'data-transliterations': 'tr-two',
      'data-transliteration': '0',
      'data-transliteration-fixed': '',
      'data-word-works': '',
      'data-words': '',
      'data-tajweed': '',
    },
    page: {
      slugs: ['en-work'],
      defaults: [0],
      fixed: true,
      modes: false,
      explicitSize: true,
      transliterations: { slugs: ['tr-two'], fixed: true },
      words: { slugs: [], fixed: false },
      tajweed: false,
    },
  },
] as const;

const STORED: readonly (string | null)[] = [
  null,
  'not json',
  '[]',
  '{}',
  JSON.stringify({ translations: 'none' }),
  JSON.stringify({ translations: 'both', arabicScale: 1.3 }),
  JSON.stringify({
    mode: 'reading',
    leading: 'spacious',
    layout: 'side',
    translations: ['ur-work'],
    translationScale: 0.9,
  }),
  JSON.stringify({ mode: 'mushaf', translations: ['en-work', 'ur-work'] }),
  JSON.stringify({ mode: 'bogus', translations: ['B!'], arabicScale: 99 }),
  JSON.stringify({ translations: [] }),
  JSON.stringify({ translationsOn: false, leading: 'compact' }),
  JSON.stringify({ translations: ['gone'] }),
  JSON.stringify({
    translations: ['en-work', 'en-work', 'en-work', 'en-work', 'ur-work'],
  }),
  JSON.stringify({ arabicScale: 1.6, translationScale: 0.8 }),
  // Quran Part 6: where translator's notes are read.
  JSON.stringify({ notes: 'inline' }),
  JSON.stringify({ notes: 'popover', mode: 'reading' }),
  // Quran Part 7: the transliteration and the word-by-word work chosen.
  JSON.stringify({ transliteration: 'tr-two', words: 'wbw-one' }),
  JSON.stringify({ transliteration: 'tr-one', words: 'gone' }),
  JSON.stringify({ transliteration: '<b>', words: 7 }),
  JSON.stringify({ transliteration: null, words: null, mode: 'mushaf' }),
  // Quran Part 9: the tajweed colours, only where the page has an overlay.
  JSON.stringify({ tajweed: true }),
  JSON.stringify({ tajweed: 'on', mode: 'reading' }),
  JSON.stringify({ tajweed: false, words: 'wbw-one' }),
];

describe('the boot script', () => {
  it('applies exactly what presentationOf decides, for every stored value', () => {
    for (const { attributes, page } of PAGES) {
      for (const raw of STORED) {
        const reader = boot(raw, attributes);
        const expected = presentationOf(readPreferences(raw), page);
        const label = `${String(raw)} on ${JSON.stringify(page)}`;
        expect(reader.attributes.get('data-mode'), label).toBe(
          expected.mode ?? 'translation',
        );
        expect(reader.attributes.get('data-shown'), label).toBe(expected.shown);
        expect(reader.attributes.get('data-leading'), label).toBe(expected.leading);
        expect(reader.attributes.get('data-layout'), label).toBe(expected.layout);
        expect(reader.attributes.get('data-notes'), label).toBe(expected.notes);
        expect(reader.attributes.get('data-transliteration'), label).toBe(
          expected.transliteration,
        );
        expect(reader.attributes.get('data-words'), label).toBe(expected.words);
        expect(reader.attributes.get('data-tajweed'), label).toBe(expected.tajweed);
        const arabic = reader.properties.get('--quran-arabic-scale');
        expect(
          arabic === undefined ? (page.explicitSize ? null : 1) : Number(arabic),
          label,
        ).toBe(expected.arabicScale);
        const translation = reader.properties.get('--quran-translation-scale');
        expect(translation === undefined ? 1 : Number(translation), label).toBe(
          expected.translationScale,
        );
      }
    }
  });

  it('marks script as present, and leaves the render alone when storage throws', () => {
    const first = PAGES[0];
    const reader = boot('{"mode":"reading"}', first.attributes, true);
    expect(reader.attributes.has('data-script')).toBe(true);
    expect(reader.attributes.get('data-mode')).toBe('translation');
    expect(reader.properties.size).toBe(0);
  });

  it('is one fixed string: no request value can reach it', () => {
    expect(READER_BOOT_SCRIPT).not.toMatch(/<\/script/iu);
    expect(READER_BOOT_SCRIPT).toContain(JSON.stringify(PREFERENCES_KEY));
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

  it('draws the reading-mode button around the same mark, only when named', () => {
    const tree = ArabicText({
      id: 'arabic-2-3',
      label: 'Arabic text',
      text: SENTINEL,
      ayah: 3,
      open: 'Surah 2, Ayah 3: show its translation',
    });
    const [button, ...others] = all(tree, 'button');
    expect(others).toEqual([]);
    expect(button?.props['type']).toBe('button');
    expect(button?.props['data-ayah-action']).toBe('open');
    // Its name carries the mark it shows (WCAG 2.5.3, label in name).
    expect(button?.props['aria-label']).toBe('۝٣ Surah 2, Ayah 3: show its translation');
    // The text node is still the stored string, alone in its element.
    const [arabic] = all(tree, 'p');
    expect(arabic?.props['children']).toBe(SENTINEL);
    expect(
      all(ArabicText({ id: 'a', label: 'x', text: SENTINEL, ayah: 3 }), 'button'),
    ).toEqual([]);
  });

  it('marks a translation with its own language and names its work', () => {
    const tree = TranslationText({
      id: 'translation-2-3',
      label: 'Translation: Sample work',
      name: 'Sample work',
      text: 'NON_QURAN_FIXTURE translation',
      language: { code: 'ur', direction: 'rtl' },
      index: 1,
    });
    const [text, attribution] = all(tree, 'p');
    expect(text?.props['lang']).toBe('ur');
    expect(text?.props['dir']).toBe('rtl');
    expect(text?.props['children']).toBe('NON_QURAN_FIXTURE translation');
    expect(attribution?.props['id']).toBe('translation-2-3');
    expect(attribution?.props['lang']).toBeUndefined();
    const group = tree as ReactElement<Record<string, unknown>>;
    // Shown or hidden by its place among the rendered translations.
    expect(group.props['data-translation-index']).toBe(1);
    expect(group.props['data-translation-work']).toBe('Sample work');
  });
});
