import { describe, expect, it } from 'vitest';

import type { MediaPublicReaderPort } from '../../packages/contracts/src/media/index.ts';
import { createMediaReadService } from '../../apps/web/src/contexts/media/index.ts';

/**
 * Watch Part 3 — Listen's reads at their trust boundary. Every value a
 * visitor's address could shape — a listing's filters, order, page and title
 * language; the series a page names; a track's place — is parsed by Media's
 * public read service BEFORE any read: a malformed, unknown or out-of-range
 * value reaches no adapter, and an accepted one reaches it with every default
 * stated. The audio series' directory takes nothing at all.
 */

const ID = '0f1e2d3c-4b5a-4968-8776-655443322110';

function recording() {
  const seen: { method: string; query: unknown }[] = [];
  const reader = {
    audioListing: async (query: unknown) => {
      seen.push({ method: 'audioListing', query });
      return { items: [], total: 0, hasMore: false };
    },
    audioListingFacets: async (query: unknown) => {
      seen.push({ method: 'audioListingFacets', query });
      return null;
    },
    audioSeriesDirectory: async () => {
      seen.push({ method: 'audioSeriesDirectory', query: null });
      return { items: [], hasMore: false };
    },
    audioSeriesSummary: async (query: unknown) => {
      seen.push({ method: 'audioSeriesSummary', query });
      return null;
    },
    audioSeriesNeighbours: async (query: unknown) => {
      seen.push({ method: 'audioSeriesNeighbours', query });
      return { previous: null, next: null, tracks: 0 };
    },
  } as unknown as MediaPublicReaderPort;
  return { service: createMediaReadService(reader), seen };
}

const LISTING_DEFAULTS = {
  topic: null,
  language: null,
  speaker: null,
  series: null,
  length: null,
  sort: 'newest',
  titleLocale: null,
  offset: 0,
  limit: 24,
};

describe('Listen’s public reads', () => {
  it('states every default of an unfiltered listing, for the page and its facets', async () => {
    const { service, seen } = recording();
    await service.audioListing();
    await service.audioListingFacets({});
    expect(seen).toEqual([
      { method: 'audioListing', query: LISTING_DEFAULTS },
      { method: 'audioListingFacets', query: LISTING_DEFAULTS },
    ]);
  });

  it('passes a whole view through, each filter narrowing it', async () => {
    const { service, seen } = recording();
    const view = {
      topic: ID,
      language: 'ur',
      speaker: ID,
      series: ID,
      length: 'long',
      sort: 'title',
      titleLocale: 'ar',
      offset: 48,
      limit: 6,
    };
    await service.audioListing(view);
    expect(seen.map((entry) => entry.query)).toEqual([view]);
  });

  it('refuses a malformed, unknown or out-of-range view before any read', async () => {
    const { service, seen } = recording();
    for (const raw of [
      { topic: 'education' },
      { speaker: 'someone' },
      { series: '12' },
      { language: 'e' },
      { length: 'epic' },
      { sort: 'popular' },
      { sort: 'quran' },
      { titleLocale: 'fr' },
      { offset: -1 },
      { offset: 25_001 },
      { offset: 1.5 },
      { limit: 0 },
      { limit: 25 },
      // Strict: a field of any other shape is refused, never ignored — a
      // recitation's, a format, a draft state.
      { surah: 1 },
      { format: 'lecture' },
      { state: 'draft' },
    ]) {
      expect(() => service.audioListing(raw), JSON.stringify(raw)).toThrow();
      expect(() => service.audioListingFacets(raw), JSON.stringify(raw)).toThrow();
    }
    expect(seen).toEqual([]);
  });

  it('asks for the audio series’ directory with nothing a visitor could shape', async () => {
    const { service, seen } = recording();
    await service.audioSeriesDirectory();
    expect(seen).toEqual([{ method: 'audioSeriesDirectory', query: null }]);
  });

  it('names a series by its identifier alone', async () => {
    const { service, seen } = recording();
    await service.audioSeriesSummary(ID);
    expect(seen.map((entry) => entry.query)).toEqual([ID]);
    for (const raw of ['', 'a-series', `${ID}x`, '12'])
      expect(() => service.audioSeriesSummary(raw), raw).toThrow();
    expect(seen).toHaveLength(1);
  });

  it('asks a track’s neighbours only by a series and a place in range', async () => {
    const { service, seen } = recording();
    await service.audioSeriesNeighbours({ series: ID, position: 3 });
    expect(seen.map((entry) => entry.query)).toEqual([{ series: ID, position: 3 }]);
    for (const raw of [
      {},
      { series: ID },
      { position: 3 },
      { series: 'a-series', position: 3 },
      { series: ID, position: 0 },
      { series: ID, position: 100_001 },
      { series: ID, position: 2.5 },
      { series: ID, position: 3, state: 'draft' },
    ])
      expect(() => service.audioSeriesNeighbours(raw), JSON.stringify(raw)).toThrow();
    expect(seen).toHaveLength(1);
  });
});
