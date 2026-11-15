import { describe, expect, it } from 'vitest';

import type {
  LibraryPublicReaderPort,
  TopicWorksQuery,
} from '../../packages/contracts/src/library/index.ts';
import { createLibraryReadService } from '../../apps/web/src/contexts/library/index.ts';

/**
 * Quran Part 10 (named for the Topic in Hadith Part 1) — the Topic Works
 * read's trust boundary. Every field of the
 * query is parsed by Library's public read service BEFORE any read: a value
 * that is malformed, out of range or contradictory reaches no adapter, and an
 * accepted one reaches it with every default stated. The Quran passage parts
 * (shelves, a Surah, the Quran order) are accepted only with `quranPassages`.
 */

const TOPIC = '0f1e2d3c-4b5a-4968-8776-655443322110';

function recording() {
  const seen: { method: string; query: TopicWorksQuery }[] = [];
  const reader = {
    topicWorks: async (query: TopicWorksQuery) => {
      seen.push({ method: 'topicWorks', query });
      return { items: [], total: 0, hasMore: false };
    },
    topicWorkFacets: async (query: TopicWorksQuery) => {
      seen.push({ method: 'topicWorkFacets', query });
      return {
        hub: { works: 0, explaining: 0, featured: 0, languages: 0 },
        shelves: { all: 0, explaining: 0 },
        languages: { items: [], hasMore: false },
        contributors: { items: [], hasMore: false },
        surahs: [],
      };
    },
  } as unknown as LibraryPublicReaderPort;
  return { service: createLibraryReadService(reader), seen };
}

describe('Library’s public Topic Works read', () => {
  it('states every default for an empty query', async () => {
    const { service, seen } = recording();
    await service.topicWorks();
    await service.topicWorkFacets({});
    const expected: TopicWorksQuery = {
      scope: 'topic',
      topic: null,
      quranPassages: false,
      shelf: 'all',
      surah: null,
      language: null,
      contributor: null,
      from: null,
      to: null,
      readable: false,
      downloadable: false,
      featured: false,
      sort: 'title',
      titleLocale: null,
      offset: 0,
      limit: 24,
    };
    expect(seen).toEqual([
      { method: 'topicWorks', query: expected },
      { method: 'topicWorkFacets', query: expected },
    ]);
  });

  it('passes a full, valid query through unchanged', async () => {
    const { service, seen } = recording();
    const query = {
      scope: 'topic',
      topic: TOPIC,
      quranPassages: true,
      shelf: 'explains',
      surah: 114,
      language: 'ur-PK',
      contributor: TOPIC,
      from: 1,
      to: 9999,
      readable: true,
      downloadable: true,
      featured: true,
      sort: 'quran',
      titleLocale: 'ar',
      offset: 25_000,
      limit: 1,
    };
    await service.topicWorks(query);
    expect(seen[0]?.query).toEqual(query);
  });

  it('passes a full query without the passage parts through unchanged', async () => {
    const { service, seen } = recording();
    const query = {
      scope: 'topic',
      topic: TOPIC,
      quranPassages: false,
      shelf: 'all',
      surah: null,
      language: 'ar',
      contributor: TOPIC,
      from: 1990,
      to: 1990,
      readable: false,
      downloadable: false,
      featured: false,
      sort: 'newest',
      titleLocale: 'ur',
      offset: 24,
      limit: 24,
    };
    await service.topicWorkFacets(query);
    expect(seen[0]?.query).toEqual(query);
  });

  it('passes a whole-Library query (Library Part 1) through unchanged — the Topic a filter', async () => {
    const { service, seen } = recording();
    const query = {
      scope: 'library',
      topic: null,
      quranPassages: false,
      shelf: 'all',
      surah: null,
      language: null,
      contributor: null,
      from: 1980,
      to: 2020,
      readable: true,
      downloadable: false,
      featured: false,
      sort: 'title',
      titleLocale: 'en',
      offset: 0,
      limit: 24,
    };
    await service.topicWorks(query);
    await service.topicWorkFacets({ ...query, topic: TOPIC });
    expect(seen).toEqual([
      { method: 'topicWorks', query },
      { method: 'topicWorkFacets', query: { ...query, topic: TOPIC } },
    ]);
  });

  it.each([
    [
      'a Surah beside the general shelf',
      { quranPassages: true, shelf: 'general', surah: 2 },
    ],
    ['Surah 0', { quranPassages: true, surah: 0 }],
    ['Surah 115', { quranPassages: true, surah: 115 }],
    ['a fractional Surah', { quranPassages: true, surah: 1.5 }],
    ['a shelf without the passage parts', { shelf: 'explains' }],
    ['the general shelf without the passage parts', { shelf: 'general' }],
    ['a Surah without the passage parts', { surah: 2 }],
    ['the Quran order without the passage parts', { sort: 'quran' }],
    ['a passage flag that is not a boolean', { quranPassages: 'true' }],
    ['an unknown shelf', { shelf: 'drafts' }],
    ['an unknown order', { sort: 'popular' }],
    ['a malformed Topic', { topic: 'quran' }],
    ['a malformed contributor', { contributor: "x' OR 1=1 --" }],
    ['a malformed language', { language: "ur'; DROP TABLE Work;--" }],
    ['an unknown title locale', { titleLocale: 'fr' }],
    ['a negative offset', { offset: -1 }],
    ['an offset past the bound', { offset: 25_001 }],
    ['a page larger than the hub’s', { limit: 25 }],
    ['an empty page', { limit: 0 }],
    ['a field it does not know', { state: 'draft' }],
    ['an unknown scope', { scope: 'everything' }],
    [
      'the whole Library with the passage parts',
      { scope: 'library', quranPassages: true },
    ],
    ['a shelf in the whole Library', { scope: 'library', shelf: 'explains' }],
    ['an inverted year range', { from: 2001, to: 2000 }],
    ['year 0', { from: 0 }],
    ['year 10000', { to: 10_000 }],
    ['a fractional year', { from: 1999.5 }],
    ['an availability flag that is not a boolean', { readable: '1' }],
    ['a download flag that is not a boolean', { downloadable: 1 }],
  ])('refuses %s before any read', async (_name, raw) => {
    const { service, seen } = recording();
    expect(() => service.topicWorks(raw)).toThrow();
    expect(() => service.topicWorkFacets(raw)).toThrow();
    expect(seen).toEqual([]);
  });
});
