import { describe, expect, it } from 'vitest';

import type {
  LibraryPublicReaderPort,
  TopicResearchQuery,
} from '../../packages/contracts/src/library/index.ts';
import { createLibraryReadService } from '../../apps/web/src/contexts/library/index.ts';

/**
 * Quran Part 12 (named for the Topic in Hadith Part 1) — the Topic Research
 * read's trust boundary. Every field of the query is parsed by Library's
 * public read service BEFORE any read: a value that is malformed, out of
 * range or unknown reaches no adapter, and an accepted one reaches it with
 * every default stated.
 */

const TOPIC = '0f1e2d3c-4b5a-4968-8776-655443322110';

function recording() {
  const seen: { method: string; query: TopicResearchQuery }[] = [];
  const reader = {
    topicResearch: async (query: TopicResearchQuery) => {
      seen.push({ method: 'topicResearch', query });
      return { items: [], total: 0, hasMore: false };
    },
    topicResearchFacets: async (query: TopicResearchQuery) => {
      seen.push({ method: 'topicResearchFacets', query });
      return {
        hub: {
          records: 0,
          research: 0,
          papers: 0,
          readable: 0,
          languages: 0,
          contributors: 0,
          earliest: null,
          latest: null,
        },
        kinds: { all: 0, research: 0, papers: 0 },
        languages: { items: [], hasMore: false },
        contributors: { items: [], hasMore: false },
        decades: [],
        readable: 0,
      };
    },
  } as unknown as LibraryPublicReaderPort;
  return { service: createLibraryReadService(reader), seen };
}

describe('Library’s public Topic Research read', () => {
  it('states every default for an empty query', async () => {
    const { service, seen } = recording();
    await service.topicResearch();
    await service.topicResearchFacets({});
    const expected: TopicResearchQuery = {
      topic: null,
      kind: 'all',
      language: null,
      contributor: null,
      decade: null,
      fullText: false,
      sort: 'newest',
      titleLocale: null,
      offset: 0,
      limit: 20,
    };
    expect(seen).toEqual([
      { method: 'topicResearch', query: expected },
      { method: 'topicResearchFacets', query: expected },
    ]);
  });

  it('passes a full, valid query through unchanged', async () => {
    const { service, seen } = recording();
    const query = {
      topic: TOPIC,
      kind: 'research-paper',
      language: 'ur-PK',
      contributor: TOPIC,
      decade: 9990,
      fullText: true,
      sort: 'title',
      titleLocale: 'ar',
      offset: 25_000,
      limit: 1,
    };
    await service.topicResearch(query);
    await service.topicResearchFacets({ ...query, kind: 'research', decade: 0 });
    expect(seen[0]?.query).toEqual(query);
    expect(seen[1]?.query).toEqual({ ...query, kind: 'research', decade: 0 });
  });

  it.each([
    ['an unknown kind', { kind: 'publication' }],
    ['a kind spelled as the address spells it', { kind: 'paper' }],
    ['an unknown order', { sort: 'popular' }],
    ['a year that is no decade', { decade: 1995 }],
    ['a negative decade', { decade: -10 }],
    ['a decade past the last year', { decade: 10_000 }],
    ['a fractional decade', { decade: 1990.5 }],
    ['a decade as text', { decade: '1990' }],
    ['full text as text', { fullText: '1' }],
    ['a malformed Topic', { topic: 'quran' }],
    ['a malformed contributor', { contributor: "x' OR 1=1 --" }],
    ['a malformed language', { language: "ur'; DROP TABLE Research;--" }],
    ['an unknown title locale', { titleLocale: 'fr' }],
    ['a negative offset', { offset: -1 }],
    ['an offset past the bound', { offset: 25_001 }],
    ['a page larger than the hub’s', { limit: 21 }],
    ['an empty page', { limit: 0 }],
    ['a field it does not know', { state: 'draft' }],
  ])('refuses %s before any read', async (_name, raw) => {
    const { service, seen } = recording();
    expect(() => service.topicResearch(raw)).toThrow();
    expect(() => service.topicResearchFacets(raw)).toThrow();
    expect(seen).toEqual([]);
  });
});
