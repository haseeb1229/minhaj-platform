import { describe, expect, it } from 'vitest';

import {
  TOPIC_VIDEO_LENGTHS,
  type MediaPublicReaderPort,
  type TopicVideosQuery,
} from '../../packages/contracts/src/media/index.ts';
import { createMediaReadService } from '../../apps/web/src/contexts/media/index.ts';

/**
 * Quran Part 11 (named for the Topic in Hadith Part 1) — the Topic Videos
 * read's trust boundary. Every field of the query is parsed by Media's public
 * read service BEFORE any read: a value that is malformed, out of range or
 * contradictory reaches no adapter, and an accepted one reaches it with every
 * default stated. The Quran passage parts (shelves, a Surah, the Quran order)
 * are accepted only with `quranPassages`.
 *
 * Watch Part 1: the whole of Media (`scope: 'media'`) is the same read, the
 * Topic a filter there, with a curated `format` filter of any scope — and no
 * passage part. An episode's neighbours are parsed the same way.
 */

const TOPIC = '0f1e2d3c-4b5a-4968-8776-655443322110';

function recording() {
  const seen: { method: string; query: unknown }[] = [];
  const reader = {
    seriesNeighbours: async (query: unknown) => {
      seen.push({ method: 'seriesNeighbours', query });
      return { previous: null, next: null, episodes: 0 };
    },
    topicVideos: async (query: TopicVideosQuery) => {
      seen.push({ method: 'topicVideos', query });
      return { items: [], total: 0, hasMore: false };
    },
    topicVideoFacets: async (query: TopicVideosQuery) => {
      seen.push({ method: 'topicVideoFacets', query });
      return {
        hub: {
          videos: 0,
          explaining: 0,
          featured: 0,
          languages: 0,
          surahs: 0,
          seconds: 0,
        },
        shelves: { all: 0, explaining: 0 },
        languages: { items: [], hasMore: false },
        speakers: { items: [], hasMore: false },
        series: { items: [], hasMore: false },
        lengths: [],
        surahs: [],
        formats: { all: 0, items: [] },
        topics: { items: [], hasMore: false },
      };
    },
  } as unknown as MediaPublicReaderPort;
  return { service: createMediaReadService(reader), seen };
}

describe('Media’s public Topic Videos read', () => {
  it('states every default for an empty query', async () => {
    const { service, seen } = recording();
    await service.topicVideos();
    await service.topicVideoFacets({});
    const expected: TopicVideosQuery = {
      scope: 'topic',
      topic: null,
      quranPassages: false,
      shelf: 'all',
      surah: null,
      language: null,
      speaker: null,
      series: null,
      length: null,
      format: null,
      featured: false,
      sort: 'newest',
      titleLocale: null,
      offset: 0,
      limit: 24,
    };
    expect(seen).toEqual([
      { method: 'topicVideos', query: expected },
      { method: 'topicVideoFacets', query: expected },
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
      speaker: TOPIC,
      series: TOPIC,
      length: 'long',
      format: 'lecture',
      featured: true,
      sort: 'quran',
      titleLocale: 'ar',
      offset: 25_000,
      limit: 1,
    };
    await service.topicVideos(query);
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
      speaker: TOPIC,
      series: TOPIC,
      length: 'short',
      format: null,
      featured: false,
      sort: 'title',
      titleLocale: 'ur',
      offset: 24,
      limit: 24,
    };
    await service.topicVideoFacets(query);
    expect(seen[0]?.query).toEqual(query);
  });

  it('passes a whole-of-Media query — a Topic and a format as filters — through unchanged', async () => {
    const { service, seen } = recording();
    const query = {
      scope: 'media',
      topic: TOPIC,
      quranPassages: false,
      shelf: 'all',
      surah: null,
      language: 'ur',
      speaker: TOPIC,
      series: TOPIC,
      length: 'medium',
      format: 'documentary',
      featured: true,
      sort: 'title',
      titleLocale: 'en',
      offset: 48,
      limit: 12,
    };
    await service.topicVideos(query);
    await service.topicVideoFacets({ scope: 'media' });
    expect(seen[0]?.query).toEqual(query);
    expect(seen[1]?.query).toMatchObject({ scope: 'media', topic: null, format: null });
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
    ['a passage flag that is not a boolean', { quranPassages: 1 }],
    ['an unknown shelf', { shelf: 'drafts' }],
    ['an unknown order', { sort: 'popular' }],
    ['an unknown length', { length: 'endless' }],
    ['a malformed Topic', { topic: 'quran' }],
    ['a malformed speaker', { speaker: "x' OR 1=1 --" }],
    ['a malformed Series', { series: 'series-one' }],
    ['a malformed language', { language: "ur'; DROP TABLE Video;--" }],
    ['an unknown title locale', { titleLocale: 'fr' }],
    ['a negative offset', { offset: -1 }],
    ['an offset past the bound', { offset: 25_001 }],
    ['a page larger than the hub’s', { limit: 25 }],
    ['an empty page', { limit: 0 }],
    ['a field it does not know', { state: 'draft' }],
    ['an unknown scope', { scope: 'everything' }],
    [
      'the whole of Media with the passage parts',
      { scope: 'media', quranPassages: true },
    ],
    ['a shelf in the whole of Media', { scope: 'media', shelf: 'explains' }],
    ['the Quran order in the whole of Media', { scope: 'media', sort: 'quran' }],
    ['an unknown format', { format: 'sermon' }],
    ['a format that is not text', { format: 1 }],
  ])('refuses %s before any read', async (_name, raw) => {
    const { service, seen } = recording();
    expect(() => service.topicVideos(raw)).toThrow();
    expect(() => service.topicVideoFacets(raw)).toThrow();
    expect(seen).toEqual([]);
  });

  it('passes an episode’s place through, and refuses a malformed one before any read', async () => {
    const { service, seen } = recording();
    await service.seriesNeighbours({ series: TOPIC, position: 3 });
    expect(seen).toEqual([
      { method: 'seriesNeighbours', query: { series: TOPIC, position: 3 } },
    ]);
    for (const raw of [
      {},
      { series: 'series-one', position: 1 },
      { series: TOPIC },
      { series: TOPIC, position: 0 },
      { series: TOPIC, position: 1.5 },
      { series: TOPIC, position: 100_001 },
      { series: TOPIC, position: 1, state: 'draft' },
    ])
      expect(() => service.seriesNeighbours(raw), JSON.stringify(raw)).toThrow();
    expect(seen).toHaveLength(1);
  });

  it('bands every recordable running time exactly once, from one second to the bound', () => {
    const bands = Object.values(TOPIC_VIDEO_LENGTHS);
    expect(bands[0]?.from).toBe(1);
    expect(bands.at(-1)?.to).toBe(360_000);
    for (let index = 1; index < bands.length; index += 1)
      expect(bands[index]?.from).toBe((bands[index - 1]?.to ?? 0) + 1);
  });
});
