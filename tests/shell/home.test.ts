import { describe, expect, it } from 'vitest';

import {
  contentLanguageBadge,
  interfaceLanguageFirst,
} from '../../apps/web/src/components/content-language.ts';
import {
  heroStory,
  newsLayout,
  QUICK_SURAHS,
  quickSurahs,
} from '../../apps/web/src/components/home/presentation.ts';

/**
 * Rebaseline R2 — the home page's pure decisions: which story leads, what the
 * news section shows beside it, which surahs the Quran entry offers, and when
 * a card names its content language (audit F10).
 */

const story = (slug: string, pictured: boolean, language = 'en') => ({
  slug,
  language,
  leadImage: pictured ? { assetId: slug } : null,
});

describe('the content-language mark (F10)', () => {
  it('names another language in the interface language', () => {
    expect(contentLanguageBadge('ur', 'en')).toEqual({ label: 'Urdu', code: 'ur' });
    expect(contentLanguageBadge('en', 'ur')).toEqual({ label: 'انگریزی', code: 'en' });
    expect(contentLanguageBadge('ur', 'ar')?.label).toBe('الأوردية');
  });

  it('marks nothing in the interface language, whatever the region subtag', () => {
    expect(contentLanguageBadge('en', 'en')).toBeUndefined();
    expect(contentLanguageBadge('ur-PK', 'ur')).toBeUndefined();
    expect(contentLanguageBadge('AR', 'ar')).toBeUndefined();
  });

  it('says nothing rather than guess for a code that is not a language', () => {
    expect(contentLanguageBadge('', 'en')).toBeUndefined();
    expect(contentLanguageBadge('not a code!', 'en')).toBeUndefined();
  });
});

describe('the interface language first, nothing hidden', () => {
  it('moves the interface language forward and keeps each group in order', () => {
    const items = [
      story('a', true, 'ur'),
      story('b', true, 'en'),
      story('c', false, 'ur'),
      story('d', false, 'en-GB'),
    ];
    const ordered = interfaceLanguageFirst(items, (item) => item.language, 'en');
    expect(ordered.map((item) => item.slug)).toEqual(['b', 'd', 'a', 'c']);
    expect(ordered).toHaveLength(items.length);
  });
});

describe('the hero and the news section never show one story twice', () => {
  it('leads the hero with the first story that has a picture', () => {
    const items = [story('a', false), story('b', true), story('c', true)];
    expect(heroStory(items)?.slug).toBe('b');
    expect(heroStory([story('a', false)])).toBeNull();
  });

  it('takes the hero out, leads with the next pictured story, keeps the rest in order', () => {
    const items = [
      story('a', false),
      story('b', true),
      story('c', true),
      story('d', false),
    ];
    const hero = heroStory(items);
    const layout = newsLayout(items, hero, 4);
    expect(layout.lead?.slug).toBe('c');
    expect(layout.rest.map((item) => item.slug)).toEqual(['a', 'd']);
  });

  it('has no lead when no other story has a picture, and bounds the rest', () => {
    const items = [
      story('a', true),
      story('b', false),
      story('c', false),
      story('d', false),
    ];
    const layout = newsLayout(items, heroStory(items), 2);
    expect(layout.lead).toBeNull();
    expect(layout.rest.map((item) => item.slug)).toEqual(['b', 'c']);
  });
});

describe('the Quran entry offers only surahs the corpus has', () => {
  it('keeps the quick-link order and drops a surah that is absent', () => {
    const surahs = [67, 1, 36, 2].map((number) => ({ number }));
    expect(quickSurahs(surahs).map((surah) => surah.number)).toEqual([1, 36, 67]);
    expect(quickSurahs([])).toEqual([]);
  });

  it('names real surah numbers only', () => {
    for (const number of QUICK_SURAHS) {
      expect(Number.isInteger(number) && number >= 1 && number <= 114).toBe(true);
    }
  });
});
