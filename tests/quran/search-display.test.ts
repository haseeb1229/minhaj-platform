import { describe, expect, it } from 'vitest';

import type { AyahSearchRecord } from '../../packages/contracts/src/quran/index.ts';
import {
  SEARCH_SUMMARY_MAX_LENGTH,
  type SearchHit,
} from '../../packages/contracts/src/search/index.ts';
import {
  quranHitDisplays,
  quranHitKey,
  quranHitRefs,
} from '../../apps/web/src/components/search/quran-hit.ts';

/**
 * Phase 18 — what a `quran-ayah` result DISPLAYS: the owner's CURRENT text,
 * never the index's summary, so a stale index cannot show an archived
 * translation's words or a superseded canonical text.
 *
 * NOTHING HERE IS THE QURAN: every text is a `NON_QURAN_FIXTURE` sentinel.
 */

const STALE = 'NON_QURAN_FIXTURE stale indexed summary';

const hit = (resourceId: string, textLanguage: string, kind = 'quran-ayah'): SearchHit =>
  ({
    kind,
    resourceId,
    href: `/quran/surah/${resourceId.replace(':', '/')}`,
    title: resourceId,
    summary: STALE,
    textLanguage,
    contentLanguage: textLanguage,
    year: null,
  }) as SearchHit;

const layer = (
  slug: string,
  languageCode: string,
  text: string,
  kind: 'translation' | 'transliteration' = 'translation',
) => ({ kind, slug, name: 'NON_QURAN_FIXTURE work', languageCode, text });

const record = (
  surah: number,
  ayah: number,
  layers: AyahSearchRecord['layers'] = [],
  text = `NON_QURAN_FIXTURE_CANONICAL_${surah}_${ayah}`,
): AyahSearchRecord => ({ surah, ayah, text, stamp: 'stamp', topicIds: [], layers });

const display = (hits: readonly SearchHit[], records: readonly AyahSearchRecord[]) => {
  const shown = quranHitDisplays(hits, records);
  return (target: SearchHit) => shown.get(quranHitKey(target));
};

describe('quranHitDisplays', () => {
  it('shows an Arabic hit the CURRENT canonical text, never the indexed summary', () => {
    const arabic = hit('1:1', 'ar');
    const current = record(1, 1, [
      layer('a-arabic-layer', 'ar', 'NON_QURAN_FIXTURE ar layer'),
    ]);
    expect(display([arabic], [current])(arabic)).toEqual({
      layer: 'arabic',
      language: 'ar',
      text: current.text,
    });
  });

  it('shows a layer hit the first current public text in its language, in slug order', () => {
    const english = hit('1:2', 'en');
    const current = record(1, 2, [
      layer('zeta-translation', 'en', 'NON_QURAN_FIXTURE zeta'),
      layer(
        'alpha-transliteration',
        'en',
        'NON_QURAN_FIXTURE alpha translit',
        'transliteration',
      ),
      layer('alpha-transliteration', 'en', 'NON_QURAN_FIXTURE alpha translation'),
      layer('beta-urdu', 'ur', 'NON_QURAN_FIXTURE urdu'),
    ]);
    expect(display([english], [current])(english)).toEqual({
      layer: 'layer',
      language: 'en',
      text: 'NON_QURAN_FIXTURE alpha translation',
    });
  });

  it('matches the layer language case-insensitively and keeps the layer’s own code', () => {
    const british = hit('2:1', 'en-gb');
    const current = record(2, 1, [
      layer('fixture-british', 'en-GB', 'NON_QURAN_FIXTURE gb'),
    ]);
    expect(display([british], [current])(british)).toEqual({
      layer: 'layer',
      language: 'en-GB',
      text: 'NON_QURAN_FIXTURE gb',
    });
  });

  it('falls back to the canonical text, labelled as the Arabic, when the layer is no longer public', () => {
    const english = hit('1:2', 'en');
    const current = record(1, 2, [layer('fixture-urdu', 'ur', 'NON_QURAN_FIXTURE urdu')]);
    const shown = display([english], [current])(english);
    expect(shown).toEqual({ layer: 'arabic', language: 'ar', text: current.text });
    expect(shown?.text).not.toContain(STALE);
  });

  it('omits a hit whose Ayah has no current record, or whose id is not a citation', () => {
    const absent = hit('2:4', 'ar');
    const malformed = hit('not-a-citation', 'ar');
    const shown = quranHitDisplays([absent, malformed], [record(1, 1)]);
    expect(shown.size).toBe(0);
  });

  it('ignores every other kind of hit', () => {
    const other = hit('1:1', 'en', 'audio');
    expect(quranHitDisplays([other], [record(1, 1)]).size).toBe(0);
  });

  it('keeps one display per hit when one Ayah answers in two languages', () => {
    const arabic = hit('1:1', 'ar');
    const english = hit('1:1', 'en');
    const current = record(1, 1, [layer('fixture-en', 'en', 'NON_QURAN_FIXTURE en')]);
    const shown = display([arabic, english], [current]);
    expect(shown(arabic)?.layer).toBe('arabic');
    expect(shown(english)?.text).toBe('NON_QURAN_FIXTURE en');
  });

  it('cuts to the summary bound by code point, never halving a character', () => {
    const long = '\u{1D400}'.repeat(SEARCH_SUMMARY_MAX_LENGTH + 5);
    const arabic = hit('1:1', 'ar');
    const text = display([arabic], [record(1, 1, [], long)])(arabic)?.text ?? '';
    expect([...text]).toHaveLength(SEARCH_SUMMARY_MAX_LENGTH);
    expect(text).toBe('\u{1D400}'.repeat(SEARCH_SUMMARY_MAX_LENGTH));
  });
});

describe('quranHitRefs', () => {
  it('names each Quran citation on the page once, skipping other kinds and non-citations', () => {
    expect(
      quranHitRefs([
        hit('1:1', 'ar'),
        hit('1:1', 'en'),
        hit('2:3', 'ur'),
        hit('bad', 'ar'),
        hit('4:4', 'en', 'video'),
      ]),
    ).toEqual([
      { surah: 1, ayah: 1 },
      { surah: 2, ayah: 3 },
    ]);
  });
});
