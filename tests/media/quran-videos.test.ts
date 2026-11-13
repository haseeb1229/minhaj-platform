import { describe, expect, it } from 'vitest';

import {
  QURAN_VIDEO_LENGTHS,
  type MediaPublicReaderPort,
  type QuranVideosQuery,
} from '../../packages/contracts/src/media/index.ts';
import { createMediaReadService } from '../../apps/web/src/contexts/media/index.ts';

/**
 * Quran Part 11 — the Quran Videos read's trust boundary. Every field of the
 * query is parsed by Media's public read service BEFORE any read: a value that
 * is malformed, out of range or contradictory reaches no adapter, and an
 * accepted one reaches it with every default stated.
 */

const TOPIC = '0f1e2d3c-4b5a-4968-8776-655443322110';

function recording() {
  const seen: { method: string; query: QuranVideosQuery }[] = [];
  const reader = {
    quranVideos: async (query: QuranVideosQuery) => {
      seen.push({ method: 'quranVideos', query });
      return { items: [], total: 0, hasMore: false };
    },
    quranVideoFacets: async (query: QuranVideosQuery) => {
      seen.push({ method: 'quranVideoFacets', query });
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
      };
    },
  } as unknown as MediaPublicReaderPort;
  return { service: createMediaReadService(reader), seen };
}

describe('Media’s public Quran Videos read', () => {
  it('states every default for an empty query', async () => {
    const { service, seen } = recording();
    await service.quranVideos();
    await service.quranVideoFacets({});
    const expected: QuranVideosQuery = {
      topic: null,
      shelf: 'all',
      surah: null,
      language: null,
      speaker: null,
      series: null,
      length: null,
      featured: false,
      sort: 'newest',
      titleLocale: null,
      offset: 0,
      limit: 24,
    };
    expect(seen).toEqual([
      { method: 'quranVideos', query: expected },
      { method: 'quranVideoFacets', query: expected },
    ]);
  });

  it('passes a full, valid query through unchanged', async () => {
    const { service, seen } = recording();
    const query = {
      topic: TOPIC,
      shelf: 'explains',
      surah: 114,
      language: 'ur-PK',
      speaker: TOPIC,
      series: TOPIC,
      length: 'long',
      featured: true,
      sort: 'quran',
      titleLocale: 'ar',
      offset: 25_000,
      limit: 1,
    };
    await service.quranVideos(query);
    expect(seen[0]?.query).toEqual(query);
  });

  it.each([
    ['a Surah beside the general shelf', { shelf: 'general', surah: 2 }],
    ['Surah 0', { surah: 0 }],
    ['Surah 115', { surah: 115 }],
    ['a fractional Surah', { surah: 1.5 }],
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
  ])('refuses %s before any read', async (_name, raw) => {
    const { service, seen } = recording();
    expect(() => service.quranVideos(raw)).toThrow();
    expect(() => service.quranVideoFacets(raw)).toThrow();
    expect(seen).toEqual([]);
  });

  it('bands every recordable running time exactly once, from one second to the bound', () => {
    const bands = Object.values(QURAN_VIDEO_LENGTHS);
    expect(bands[0]?.from).toBe(1);
    expect(bands.at(-1)?.to).toBe(360_000);
    for (let index = 1; index < bands.length; index += 1)
      expect(bands[index]?.from).toBe((bands[index - 1]?.to ?? 0) + 1);
  });
});
