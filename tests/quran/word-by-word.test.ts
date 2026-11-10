import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import {
  QURAN_WORD_POSITION_MAX,
  ayahWords,
  isAyahWordToken,
  wordByWordInputSchema,
  wordGlossChangeSchema,
  wordGlossSaveSchema,
} from '../../packages/contracts/src/quran/values.ts';
import { openingWords } from '../../apps/web/src/components/quran/juz-layout.ts';
import {
  TransliterationText,
  WordByWordText,
} from '../../apps/web/src/components/quran/scripture.tsx';

/**
 * Quran Part 7 — THE WORD SEGMENTATION and the two study layers' elements.
 *
 * NOTHING HERE IS THE QURAN. Every "Ayah" is a neutral, invented Arabic phrase
 * ("this is a test text …") written with the Tanzil Uthmani 1.1 encoding's
 * conventions as this repository records them (`tanzil-corpus.ts`, the Juz
 * opening-words proof): a pause sign (U+06D6–U+06DC) set as its own
 * space-separated run after the word it follows, the rub' al-hizb ۞ as the
 * run that opens a quarter's first Ayah, the sajdah ۩ as the run that closes
 * an Ayah of prostration, a letter carrying the maddah (U+0653) as the
 * opening letters of a Surah are written, the dagger alef on a tatweel and
 * the alef wasla. The shapes are the edition's; the words are not scripture.
 */

/** A pause sign of each kind the Uthmani text sets between words. */
const SIGNS = ['ۖ', 'ۗ', 'ۘ', 'ۙ', 'ۚ', 'ۛ', 'ۜ'] as const;
const RUB_EL_HIZB = '۞';
const SAJDAH = '۩';

/** Invented phrases in the edition's shapes — never an Ayah. */
const PHRASE = 'هَـٰذَا نَصٌّ ٱخْتِبَارِيٌّ';

/** The words joined back with the whitespace between them: the text again. */
function rejoined(text: string): string {
  const words = ayahWords(text);
  let out = '';
  let at = words[0]?.start ?? 0;
  out += text.slice(0, at);
  for (const word of words) {
    out += text.slice(at, word.start) + word.text;
    at = word.end;
  }
  return out + text.slice(at);
}

describe('the word segmentation (ayahWords)', () => {
  it('cuts the stored text on whitespace, verbatim, numbering words from 1', () => {
    const words = ayahWords(PHRASE);
    expect(words.map((word) => word.text)).toEqual(['هَـٰذَا', 'نَصٌّ', 'ٱخْتِبَارِيٌّ']);
    expect(words.map((word) => word.position)).toEqual([1, 2, 3]);
    for (const word of words) expect(PHRASE.slice(word.start, word.end)).toBe(word.text);
  });

  it('attaches every pause sign to the word before it — a sign is never a word', () => {
    for (const sign of SIGNS) {
      const text = `كَلِمَةٌ ${sign} ثَانِيَةٌ ثَالِثَةٌ`;
      expect(isAyahWordToken(sign), sign).toBe(false);
      expect(
        ayahWords(text).map((word) => word.text),
        sign,
      ).toEqual([`كَلِمَةٌ ${sign}`, 'ثَانِيَةٌ', 'ثَالِثَةٌ']);
    }
    // Two signs in a row, and the stored spacing between them, stay with it.
    expect(ayahWords('أَوَّلُ ۛ  ۚ ثَانٍ').map((word) => word.text)).toEqual([
      'أَوَّلُ ۛ  ۚ',
      'ثَانٍ',
    ]);
  });

  it('attaches the rub’ al-hizb that opens a text to the word after it', () => {
    const text = `${RUB_EL_HIZB} ${PHRASE}`;
    const words = ayahWords(text);
    expect(words).toHaveLength(3);
    expect(words[0]).toEqual({
      position: 1,
      start: 0,
      end: 9,
      text: `${RUB_EL_HIZB} هَـٰذَا`,
    });
  });

  it('attaches the closing sajdah sign to the last word', () => {
    const words = ayahWords(`${PHRASE} ${SAJDAH}`);
    expect(words).toHaveLength(3);
    expect(words.at(-1)?.text).toBe(`ٱخْتِبَارِيٌّ ${SAJDAH}`);
  });

  it('counts letters written alone with the maddah as one word', () => {
    const opening = 'بٓتٓثٓ';
    expect(isAyahWordToken(opening)).toBe(true);
    expect(ayahWords(`${opening} ${PHRASE}`).map((word) => word.text)).toEqual([
      opening,
      'هَـٰذَا',
      'نَصٌّ',
      'ٱخْتِبَارِيٌّ',
    ]);
  });

  it('gives back exactly the stored text — spacing, signs and marks untouched', () => {
    for (const text of [
      PHRASE,
      `${RUB_EL_HIZB} ${PHRASE} ۚ ${PHRASE} ${SAJDAH}`,
      'كَلِمَةٌ  ثَانِيَةٌ',
      'NON_QURAN_FIXTURE_CANONICAL_1_1 نص اختبار غير قرآني بَ',
    ])
      expect(rejoined(text), text).toBe(text);
  });

  it('has no word in a text of signs alone, and none in an empty one', () => {
    expect(ayahWords(`${RUB_EL_HIZB} ۚ`)).toEqual([]);
    expect(ayahWords('')).toEqual([]);
  });

  it('is the rule the Juz opening words follow: the same words, in the same order', () => {
    const text = `${RUB_EL_HIZB} ${PHRASE} ۚ ${PHRASE}`;
    const opening = openingWords(text, 4);
    const words = ayahWords(text);
    // The opening words begin at the first WORD (the leading sign is not one)
    // and end at the fourth word itself — the sign after the third is inside.
    expect(opening.text).toBe(text.slice(text.indexOf('هَـٰذَا'), words[3]?.end));
  });
});

describe('a word-by-word work and its glosses, as the contract accepts them', () => {
  it('takes a Translation’s contributor roles, and no other', () => {
    const base = {
      slug: 'fixture-word-by-word',
      name: 'NON_QURAN_FIXTURE word by word',
      description: null,
      attribution: null,
      languageCode: 'en',
      sourceId: null,
      contributors: [
        { personId: '00000000-0000-4000-8000-000000000001', role: 'translator' },
      ],
    };
    expect(wordByWordInputSchema.safeParse(base).success).toBe(true);
    expect(
      wordByWordInputSchema.safeParse({
        ...base,
        contributors: [{ personId: base.contributors[0]!.personId, role: 'author' }],
      }).success,
    ).toBe(false);
  });

  it('accepts one line per gloss, exactly as written, and refuses what it would have to repair', () => {
    const ok = (glosses: unknown) =>
      wordGlossChangeSchema.safeParse({ ayah: 1, glosses }).success;
    expect(ok([{ position: 1, text: 'NON_QURAN_FIXTURE this' }])).toBe(true);
    expect(ok([])).toBe(true);
    expect(ok([{ position: 0, text: 'x' }])).toBe(false);
    expect(ok([{ position: QURAN_WORD_POSITION_MAX + 1, text: 'x' }])).toBe(false);
    expect(ok([{ position: 1, text: ' padded' }])).toBe(false);
    expect(ok([{ position: 1, text: 'two\nlines' }])).toBe(false);
    expect(ok([{ position: 1, text: '' }])).toBe(false);
    expect(
      ok([
        { position: 2, text: 'a' },
        { position: 2, text: 'b' },
      ]),
    ).toBe(false);
  });

  it('changes an Ayah once per save', () => {
    const change = { ayah: 3, glosses: [{ position: 1, text: 'x' }] };
    expect(wordGlossSaveSchema.safeParse({ surah: 2, changes: [change] }).success).toBe(
      true,
    );
    expect(
      wordGlossSaveSchema.safeParse({ surah: 2, changes: [change, change] }).success,
    ).toBe(false);
    expect(wordGlossSaveSchema.safeParse({ surah: 2, changes: [] }).success).toBe(false);
  });
});

/* ===========================================================================
 * The rendered study layers
 * ========================================================================= */

function all(node: ReactNode, tag: string): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((child: ReactNode) => all(child, tag));
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  const own = element.type === tag ? [element] : [];
  return [...own, ...all(element.props.children as ReactNode, tag)];
}

const textOf = (node: ReactNode): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (!isValidElement(node)) return '';
  return textOf((node as ReactElement<{ children?: ReactNode }>).props.children);
};

describe('a transliteration line', () => {
  it('is the stored text in its own language and direction, named by its work', () => {
    const tree = TransliterationText({
      id: 'transliteration-2-1-1',
      label: 'Transliteration: NON_QURAN_FIXTURE work',
      name: 'NON_QURAN_FIXTURE work',
      text: 'NON_QURAN_FIXTURE_TRANSLITERATION_2_1',
      language: { code: 'en', direction: 'ltr' },
      index: 1,
    });
    expect(tree.props['data-transliteration-index']).toBe(1);
    expect(tree.props['role']).toBe('group');
    expect(tree.props['aria-labelledby']).toBe('transliteration-2-1-1');
    // Aligned to its own reading start, whatever the page's direction.
    expect(String(tree.props['className'])).toContain('me-auto');
    const [text] = all(tree, 'p');
    expect(text?.props['lang']).toBe('en');
    expect(text?.props['dir']).toBe('ltr');
    expect(text?.props['children']).toBe('NON_QURAN_FIXTURE_TRANSLITERATION_2_1');
  });
});

describe('the Arabic word by word', () => {
  const words = ayahWords(`${RUB_EL_HIZB} ${PHRASE} ۚ`);
  const tree = WordByWordText({
    id: 'words-2-1-1',
    label: 'Word by word: NON_QURAN_FIXTURE glosses',
    name: 'NON_QURAN_FIXTURE glosses',
    words,
    glosses: [
      { position: 1, text: 'NON_QURAN_FIXTURE gloss one' },
      { position: 3, text: 'NON_QURAN_FIXTURE gloss three' },
      // A position the text does not have is not shown.
      { position: 9, text: 'NON_QURAN_FIXTURE stray' },
    ],
    language: { code: 'ur', direction: 'rtl' },
    index: 0,
    mark: '۝١',
  });

  it('draws each word of the stored text as a unit, verbatim, right to left', () => {
    const [list] = all(tree, 'ol');
    expect(list?.props['dir']).toBe('rtl');
    const arabic = all(tree, 'span').filter((span) => span.props['lang'] === 'ar');
    // The words, then the presentational end mark.
    expect(arabic.map((span) => span.props['children'])).toEqual([
      ...words.map((word) => word.text),
      '۝١',
    ]);
    for (const span of arabic.slice(0, -1)) {
      expect(span.props['dir']).toBe('rtl');
      expect(span.props['translate']).toBe('no');
    }
  });

  it('sets each gloss beneath its word as real text in its own language', () => {
    const units = all(tree, 'li');
    const glosses = all(tree, 'span').filter((span) => span.props['lang'] === 'ur');
    expect(glosses.map((span) => span.props['children'])).toEqual([
      'NON_QURAN_FIXTURE gloss one',
      'NON_QURAN_FIXTURE gloss three',
    ]);
    for (const gloss of glosses) expect(gloss.props['dir']).toBe('rtl');
    // The unglossed word stands alone; the stray gloss is nowhere.
    expect(textOf(units[1])).toBe(words[1]?.text);
    expect(textOf(tree)).not.toContain('stray');
  });

  it('hides only the end mark from assistive technology, and is named by its work', () => {
    const hidden = all(tree, 'li').filter((li) => li.props['aria-hidden'] === 'true');
    expect(hidden).toHaveLength(1);
    expect(textOf(hidden[0])).toBe('۝١');
    expect(tree.props['aria-labelledby']).toBe('words-2-1-1');
    expect(tree.props['data-words-index']).toBe(0);
  });
});
