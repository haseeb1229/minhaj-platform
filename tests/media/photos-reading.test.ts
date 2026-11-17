import { describe, expect, it } from 'vitest';

import type { MediaPublicReaderPort } from '../../packages/contracts/src/media/index.ts';
import { createMediaReadService } from '../../apps/web/src/contexts/media/index.ts';

/**
 * News & Events Part 2 — the photograph reads at their trust boundary. Every
 * value a visitor's address could shape — the listing's year, month, Gallery,
 * language, order and page; the directory's order, title language and page —
 * is parsed by Media's public read service BEFORE any read: a malformed,
 * unknown or out-of-range value reaches no adapter, and an accepted one
 * reaches it with every default stated. The archive's periods take nothing.
 */

const GALLERY = '0f1e2d3c-4b5a-4968-8776-655443322110';

function recording() {
  const seen: { method: string; query: unknown }[] = [];
  const reader = {
    photoListing: async (query: unknown) => {
      seen.push({ method: 'photoListing', query });
      return { items: [], total: 0, hasMore: false };
    },
    photoListingFacets: async (query: unknown) => {
      seen.push({ method: 'photoListingFacets', query });
      return null;
    },
    photoArchivePeriods: async () => {
      seen.push({ method: 'photoArchivePeriods', query: null });
      return [];
    },
    galleryDirectory: async (query: unknown) => {
      seen.push({ method: 'galleryDirectory', query });
      return { items: [], total: 0, hasMore: false };
    },
  } as unknown as MediaPublicReaderPort;
  return { service: createMediaReadService(reader), seen };
}

const LISTING_DEFAULTS = {
  year: null,
  month: null,
  gallery: null,
  language: null,
  sort: 'added',
  offset: 0,
  limit: 24,
};

describe('the photographs’ public reads', () => {
  it('states every default of an unfiltered listing, for the page and its facets', async () => {
    const { service, seen } = recording();
    await service.photoListing();
    await service.photoListingFacets({});
    expect(seen).toEqual([
      { method: 'photoListing', query: LISTING_DEFAULTS },
      { method: 'photoListingFacets', query: LISTING_DEFAULTS },
    ]);
  });

  it('passes a whole view through, each filter narrowing it', async () => {
    const { service, seen } = recording();
    const view = {
      year: 1995,
      month: 3,
      gallery: GALLERY,
      language: 'ur',
      sort: 'oldest',
      offset: 48,
      limit: 24,
    };
    await service.photoListing(view);
    expect(seen).toEqual([{ method: 'photoListing', query: view }]);
  });

  it('refuses a malformed, unknown or out-of-range view before any read', async () => {
    const { service, seen } = recording();
    for (const raw of [
      { month: 3 },
      { year: 1825 },
      { year: 10_000 },
      { year: 1995, month: 13 },
      { year: '1995' },
      { gallery: 'a-gallery' },
      { gallery: `${GALLERY}x` },
      { language: 'fr' },
      { sort: 'popular' },
      { sort: 'taken' },
      { offset: -1 },
      { offset: 25_001 },
      { limit: 25 },
      { limit: 0 },
      { topic: GALLERY },
      { credit: 'Someone' },
    ]) {
      expect(() => service.photoListing(raw), JSON.stringify(raw)).toThrow();
      expect(() => service.photoListingFacets(raw), JSON.stringify(raw)).toThrow();
    }
    expect(seen).toEqual([]);
  });

  it('asks for the directory with its defaults stated, and refuses anything else', async () => {
    const { service, seen } = recording();
    await service.galleryDirectory();
    await service.galleryDirectory({ sort: 'title', titleLocale: 'ar', offset: 24 });
    for (const raw of [
      { sort: 'popular' },
      { titleLocale: 'fr' },
      { offset: 25_001 },
      { limit: 25 },
      { state: 'draft' },
    ])
      expect(() => service.galleryDirectory(raw), JSON.stringify(raw)).toThrow();
    expect(seen).toEqual([
      {
        method: 'galleryDirectory',
        query: { sort: 'newest', titleLocale: null, offset: 0, limit: 24 },
      },
      {
        method: 'galleryDirectory',
        query: { sort: 'title', titleLocale: 'ar', offset: 24, limit: 24 },
      },
    ]);
  });

  it('asks for the archive’s periods with nothing a visitor could shape', async () => {
    const { service, seen } = recording();
    await service.photoArchivePeriods();
    expect(seen).toEqual([{ method: 'photoArchivePeriods', query: null }]);
  });
});
