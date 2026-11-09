import { describe, expect, it } from 'vitest';

import type { AyahSearchRecord } from '../../packages/contracts/src/quran/index.ts';
import {
  parseQuickJump,
  type JumpSurah,
} from '../../apps/web/src/components/quran/quick-jump.ts';
import {
  citationsWithin,
  hasArabicScript,
  hasQuranFilters,
  layersShown,
  quranSearchHref,
  readQuranSearch,
  RESULT_LAYERS_MAX,
  SNIPPET_LENGTH,
  snippetOf,
} from '../../apps/web/src/components/quran/search-view.ts';

/**
 * Quran Part 4 — the Quran search page's own rules, pure: its filters read
 * against the reader's structure, the citations a Surah or Juz filter allows,
 * which layer texts a result shows, the snippet of a long one, and the
 * citation or name a query is taken to name.
 *
 * NOTHING HERE IS THE QURAN. The structure is invented (three Surahs of 3, 4
 * and 45 ayat; Juz 2 beginning at 2:3), every name is a sentinel and every text
 * is a `NON_QURAN_FIXTURE` string or neutral prose.
 */

const SURAHS = [
  { number: 1, ayahCount: 3 },
  { number: 2, ayahCount: 4 },
  { number: 3, ayahCount: 45 },
];
const JUZ = [
  { number: 1, start: { surah: 1, ayah: 1 }, end: { surah: 2, ayah: 2 } },
  { number: 2, start: { surah: 2, ayah: 3 }, end: { surah: 3, ayah: 45 } },
];
const CATALOGUE = { surahs: SURAHS, juz: JUZ, languages: ['ar', 'en', 'ur'] };

describe('the filters are confirmed against the reader, never passed on as written', () => {
  it('reads a Surah, a Juz and a text language the catalogue holds', () => {
    expect(
      readQuranSearch({ q: 'word', surah: '2', juz: '1', language: 'EN' }, CATALOGUE),
    ).toEqual({
      form: { q: 'word', surah: '2', juz: '1', language: 'EN' },
      filters: { surah: 2, juz: 1, language: 'en' },
      issues: [],
    });
    expect(readQuranSearch({}, CATALOGUE).filters).toEqual({
      surah: null,
      juz: null,
      language: null,
    });
  });

  it.each([
    [{ surah: '4' }, ['surah']],
    [{ surah: '02' }, ['surah']],
    [{ surah: '1e1' }, ['surah']],
    [{ juz: '3' }, ['juz']],
    [{ juz: '-1' }, ['juz']],
    [{ language: 'fr' }, ['language']],
    [{ surah: '0', juz: '0', language: 'xx' }, ['surah', 'juz', 'language']],
  ])('refuses %o in words', (query, issues) => {
    const read = readQuranSearch(query, CATALOGUE);
    expect(read.issues).toEqual(issues);
    expect(hasQuranFilters(read.filters)).toBe(false);
  });

  it('takes the first of a repeated parameter and bounds what it echoes', () => {
    const read = readQuranSearch(
      { surah: ['3', '1'], q: 'x'.repeat(1_000), language: 'e'.repeat(40) },
      CATALOGUE,
    );
    expect(read.filters.surah).toBe(3);
    expect(read.form.q).toHaveLength(400);
    expect(read.form.language).toHaveLength(16);
  });
});

describe('a Surah or Juz filter is a restriction built from the reader’s numbers', () => {
  it('is none without a filter', () => {
    expect(citationsWithin({ surah: null, juz: null }, CATALOGUE)).toBeNull();
  });

  it('allows a Surah’s citations, a Juz’s range, or both at once', () => {
    expect(citationsWithin({ surah: 2, juz: null }, CATALOGUE)).toEqual([
      '2:1',
      '2:2',
      '2:3',
      '2:4',
    ]);
    const second = citationsWithin({ surah: null, juz: 2 }, CATALOGUE);
    expect(second?.slice(0, 3)).toEqual(['2:3', '2:4', '3:1']);
    expect(second).toHaveLength(2 + 45);
    expect(citationsWithin({ surah: 2, juz: 2 }, CATALOGUE)).toEqual(['2:3', '2:4']);
  });

  it('is empty — nothing to search — when the two do not overlap', () => {
    expect(citationsWithin({ surah: 3, juz: 1 }, CATALOGUE)).toEqual([]);
    expect(citationsWithin({ surah: null, juz: 9 }, CATALOGUE)).toEqual([]);
  });
});

describe('the page’s own addresses', () => {
  it('carries the query, every filter and the page, and leaves out what is empty', () => {
    expect(
      quranSearchHref('/quran/search', {
        q: 'a b',
        surah: 2,
        juz: null,
        language: 'ur',
        page: 3,
      }),
    ).toBe('/quran/search?q=a+b&surah=2&language=ur&page=3');
    expect(quranSearchHref('/ur/quran/search', { q: '', page: 1 })).toBe(
      '/ur/quran/search',
    );
  });
});

const layer = (slug: string, languageCode: string, text: string) => ({
  kind: 'translation' as const,
  slug,
  name: `NON_QURAN_FIXTURE ${slug}`,
  languageCode,
  text,
});

const RECORD: Pick<AyahSearchRecord, 'layers'> = {
  layers: [
    layer('urdu-b', 'ur', 'NON_QURAN_FIXTURE آزمائشی متن'),
    layer('english-a', 'en', 'NON_QURAN_FIXTURE lanternwick reading room'),
    layer('english-c', 'en', 'NON_QURAN_FIXTURE second English text'),
  ],
};

describe('which layer texts a result shows', () => {
  const slugs = (context: Parameters<typeof layersShown>[1]) =>
    layersShown(RECORD, context).map((entry) => entry.slug);

  it('shows the texts the typed words mark, in work-slug order', () => {
    expect(
      slugs({ hitLanguage: 'en', language: null, locale: 'ur', query: 'lanternwick' }),
    ).toEqual(['english-a']);
    expect(
      slugs({
        hitLanguage: 'en',
        language: null,
        locale: 'en',
        query: 'NON_QURAN_FIXTURE',
      }),
    ).toEqual(['english-a', 'english-c', 'urdu-b']);
  });

  it('falls back to the hit’s language, then to the reader’s own', () => {
    // Found in English by a form the highlighter does not reproduce.
    expect(
      slugs({ hitLanguage: 'en', language: null, locale: 'ur', query: 'zzz' }),
    ).toEqual(['english-a', 'english-c']);
    // Found in the Arabic: the reader's interface language says what it means.
    expect(
      slugs({ hitLanguage: 'ar', language: null, locale: 'ur', query: 'zzz' }),
    ).toEqual(['urdu-b']);
    expect(
      slugs({ hitLanguage: 'ar', language: null, locale: 'ar', query: 'zzz' }),
    ).toEqual([]);
  });

  it('keeps to a chosen language, and never shows more than its bound', () => {
    expect(
      slugs({ hitLanguage: 'en', language: 'ur', locale: 'en', query: 'lanternwick' }),
    ).toEqual(['urdu-b']);
    expect(
      slugs({
        hitLanguage: 'ar',
        language: 'ar',
        locale: 'en',
        query: 'NON_QURAN_FIXTURE',
      }),
    ).toEqual(['english-a', 'english-c']);
    const many = {
      layers: Array.from({ length: 6 }, (_, index) => layer(`w-${index}`, 'en', 'word')),
    };
    expect(
      layersShown(many, {
        hitLanguage: 'en',
        language: null,
        locale: 'en',
        query: 'word',
      }),
    ).toHaveLength(RESULT_LAYERS_MAX);
  });
});

describe('a long layer text is shown as a snippet around the first match', () => {
  it('shows a short text whole', () => {
    expect(snippetOf('short text', 'text')).toEqual({
      text: 'short text',
      before: false,
      after: false,
    });
  });

  it('cuts a long text around the match, at spaces, and says it was cut', () => {
    const text = `${'alpha '.repeat(120)}lanternwick ${'omega '.repeat(120)}`.trim();
    const snippet = snippetOf(text, 'lanternwick');
    expect(snippet.text).toContain('lanternwick');
    expect([...snippet.text].length).toBeLessThanOrEqual(SNIPPET_LENGTH);
    expect(snippet.before).toBe(true);
    expect(snippet.after).toBe(true);
    expect(snippet.text.startsWith('alpha')).toBe(true);
    expect(snippet.text.endsWith('omega')).toBe(true);
    // Every character shown is the text's own, in order.
    expect(text.includes(snippet.text)).toBe(true);
  });

  it('opens a long text at its start when nothing is marked', () => {
    const text = 'word '.repeat(200).trim();
    const snippet = snippetOf(text, 'absent');
    expect(snippet.before).toBe(false);
    expect(snippet.after).toBe(true);
  });
});

describe('the spelling hint is offered for Arabic-script queries', () => {
  it('tells Arabic and Urdu script from Latin', () => {
    expect(hasArabicScript('الصلاة')).toBe(true);
    expect(hasArabicScript('نماز')).toBe(true);
    expect(hasArabicScript('prayer 2:255')).toBe(false);
  });
});

describe('a query that names a place (Quran Part 4)', () => {
  const INDEX: JumpSurah[] = [
    {
      number: 1,
      ayahCount: 3,
      names: ['NON_QURAN_FIXTURE Opening', 'The Sentinel Start'],
    },
    { number: 2, ayahCount: 4, names: ['Al-Fixtura', 'الفكسترة', 'The Lantern'] },
    { number: 3, ayahCount: 45, names: ['Al-Sentinela'] },
  ];
  const whole = (raw: string) => parseQuickJump(raw, INDEX, 6, new Map(), 'whole');
  const loose = (raw: string) => parseQuickJump(raw, INDEX, 6, new Map());

  it('reads a citation in any digits and separators', () => {
    for (const raw of ['2:4', '۲:۴', '٢:٤', '2 4', '2.4']) {
      expect(whole(raw), raw).toEqual({ kind: 'ayah', surah: 2, ayah: 4 });
    }
    expect(whole('2:5')).toEqual({ kind: 'unknown' });
  });

  it('reads "Surah N" and a name followed by an Ayah number', () => {
    expect(whole('Surah 3')).toEqual({ kind: 'surah', surah: 3 });
    expect(whole('surah 2:4')).toEqual({ kind: 'ayah', surah: 2, ayah: 4 });
    expect(whole('سورة 2')).toEqual({ kind: 'surah', surah: 2 });
    expect(whole('al-fixturah 3')).toEqual({ kind: 'ayah', surah: 2, ayah: 3 });
    expect(whole('الفكسترة ٤')).toEqual({ kind: 'ayah', surah: 2, ayah: 4 });
    expect(whole('Al-Fixtura 9')).toEqual({ kind: 'unknown' });
    // The quick jump reads the same forms.
    expect(loose('al-fixtura 3')).toEqual({ kind: 'ayah', surah: 2, ayah: 3 });
  });

  it('takes a whole name — never an ordinary word — as a name', () => {
    expect(whole('Al-Fixtura')).toEqual({ kind: 'surah', surah: 2 });
    expect(whole('the lantern')).toEqual({ kind: 'surah', surah: 2 });
    // An ordinary word that only begins a recorded meaning is a text search:
    expect(whole('the')).toEqual({ kind: 'unknown' });
    expect(whole('lantern')).toEqual({ kind: 'unknown' });
    // …which the landing's quick jump, a navigation box, still reads loosely.
    expect(loose('the')).toEqual({ kind: 'surah', surah: 1 });
    expect(loose('lantern')).toEqual({ kind: 'surah', surah: 2 });
    // A spelling that only differs at its end still names the Surah.
    expect(whole('sentinelah')).toEqual({ kind: 'surah', surah: 3 });
  });
});
