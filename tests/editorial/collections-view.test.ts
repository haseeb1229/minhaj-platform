import { describe, expect, it, vi } from 'vitest';

import {
  COLLECTION_LISTING_PAGE,
  COLLECTION_MAX_OFFSET,
  collectionListingQuerySchema,
  holdsOf,
  type EditorialPublicReaderPort,
} from '../../packages/contracts/src/editorial/index.ts';
import { createEditorialReadService } from '../../apps/web/src/contexts/editorial/application/public-service.ts';
import {
  COLLECTIONS_MAX_PAGE,
  DEFAULT_COLLECTIONS_VIEW,
  collectionOrderPath,
  collectionOrderRedirect,
  collectionsCanonicalRedirect,
  collectionsFiltered,
  collectionsHref,
  collectionsListingHref,
  collectionsReadQuery,
  readCollectionOrder,
  readCollectionsView,
} from '../../apps/web/src/components/editorial/collections-view.ts';

/**
 * News & Events Part 2 — the Collection pages' address rules, and the public
 * read service refusing a malformed listing view before any read.
 *
 * ONE ADDRESS PER VIEW: the parameters are read tolerantly (anything
 * malformed, repeated or out of range is simply absent), written back in one
 * canonical order with neutral values omitted, and every other spelling — a
 * form's empty controls, Phase 15's `?offset=`, another parameter order, a
 * curated or unknown `?order` — is ONE redirect to it. What a view asks of
 * Editorial is accepted by Editorial's own schema, the authoritative boundary.
 */

const TOPIC = '3f2b8c1e-9a4d-4c7b-8e2f-1a2b3c4d5e6f';

describe('reading the listing’s view', () => {
  it('reads every parameter, and nothing is the default view', () => {
    expect(readCollectionsView({})).toEqual(DEFAULT_COLLECTIONS_VIEW);
    expect(
      readCollectionsView({
        topic: TOPIC.toUpperCase(),
        holds: 'video',
        language: 'ur',
        sort: 'oldest',
        page: '3',
      }),
    ).toEqual({ topic: TOPIC, holds: 'video', language: 'ur', sort: 'oldest', page: 3 });
  });

  it('drops a malformed, unknown, repeated or out-of-range value rather than failing', () => {
    expect(
      readCollectionsView({
        topic: 'not-an-id',
        holds: 'podcast',
        language: 'fr',
        sort: 'title',
        page: '0',
      }),
    ).toEqual(DEFAULT_COLLECTIONS_VIEW);
    expect(
      readCollectionsView({
        topic: [TOPIC, TOPIC],
        holds: ['news', 'work'],
        page: '2.5',
      }),
    ).toEqual(DEFAULT_COLLECTIONS_VIEW);
    expect(readCollectionsView({ page: String(COLLECTIONS_MAX_PAGE + 1) }).page).toBe(1);
    expect(readCollectionsView({ page: String(COLLECTIONS_MAX_PAGE) }).page).toBe(
      COLLECTIONS_MAX_PAGE,
    );
  });

  it('reads Phase 15’s ?offset= as the page holding the Collection it began with', () => {
    expect(readCollectionsView({ offset: '0' }).page).toBe(1);
    expect(readCollectionsView({ offset: '19' }).page).toBe(1);
    expect(readCollectionsView({ offset: '20' }).page).toBe(2);
    expect(readCollectionsView({ offset: '45' }).page).toBe(3);
    expect(readCollectionsView({ offset: String(COLLECTION_MAX_OFFSET) }).page).toBe(
      COLLECTIONS_MAX_PAGE,
    );
    for (const offset of ['-20', '1e3', String(COLLECTION_MAX_OFFSET + 1), ['20', '40']])
      expect(readCollectionsView({ offset }).page, String(offset)).toBe(1);
    // A page wins over a former offset.
    expect(readCollectionsView({ offset: '40', page: '7' }).page).toBe(7);
  });

  it('counts an order as no narrowing', () => {
    expect(collectionsFiltered(DEFAULT_COLLECTIONS_VIEW)).toBe(false);
    expect(collectionsFiltered({ ...DEFAULT_COLLECTIONS_VIEW, sort: 'oldest' })).toBe(
      false,
    );
    for (const change of [
      { topic: TOPIC },
      { holds: 'work' },
      { language: 'ar' },
    ] as const)
      expect(collectionsFiltered({ ...DEFAULT_COLLECTIONS_VIEW, ...change })).toBe(true);
  });
});

describe('writing a view’s one address', () => {
  it('omits neutral values and writes the rest in one order', () => {
    expect(collectionsHref('en', DEFAULT_COLLECTIONS_VIEW)).toBe('/collections');
    expect(collectionsHref('ur', DEFAULT_COLLECTIONS_VIEW)).toBe('/ur/collections');
    expect(
      collectionsHref('ar', {
        topic: TOPIC.toUpperCase(),
        holds: 'news',
        language: 'en',
        sort: 'oldest',
        page: 2,
      }),
    ).toBe(`/ar/collections?topic=${TOPIC}&holds=news&language=en&sort=oldest&page=2`);
  });

  it('returns to the first page when anything but the page changes', () => {
    const view = { ...DEFAULT_COLLECTIONS_VIEW, holds: 'video' as const, page: 4 };
    expect(collectionsHref('en', view)).toBe('/collections?holds=video&page=4');
    expect(collectionsHref('en', view, { page: 5 })).toBe(
      '/collections?holds=video&page=5',
    );
    expect(collectionsHref('en', view, { holds: null })).toBe('/collections');
    expect(collectionsHref('en', view, { language: 'ur' })).toBe(
      '/collections?holds=video&language=ur',
    );
    expect(collectionsListingHref('en', { topic: TOPIC })).toBe(
      `/collections?topic=${TOPIC}`,
    );
  });

  it('redirects every other spelling ONCE, and never the address itself', () => {
    const cases: [Record<string, string | string[]>, string | null][] = [
      [{}, null],
      [{ topic: TOPIC, holds: 'work' }, null],
      // A form's empty controls and its default order.
      [{ topic: '', language: '', sort: 'newest' }, '/collections'],
      [{ topic: TOPIC, language: '', sort: 'newest' }, `/collections?topic=${TOPIC}`],
      // Another order of the same parameters.
      [{ holds: 'work', topic: TOPIC }, `/collections?topic=${TOPIC}&holds=work`],
      // An identifier in upper case is written in lower case.
      [{ topic: TOPIC.toUpperCase() }, `/collections?topic=${TOPIC}`],
      // Phase 15's offset.
      [{ offset: '40' }, '/collections?page=3'],
      [{ offset: '0' }, '/collections'],
      // Malformed and repeated values.
      [{ page: '1' }, '/collections'],
      [{ holds: 'podcast' }, '/collections'],
      [{ language: ['en', 'ur'] }, '/collections'],
    ];
    for (const [query, expected] of cases)
      expect(collectionsCanonicalRedirect('en', query), JSON.stringify(query)).toBe(
        expected,
      );
    // A parameter the listing does not read is no reason to redirect.
    expect(collectionsCanonicalRedirect('en', { utm: 'x' })).toBeNull();
    // A redirect's target is itself canonical: one hop, never two.
    for (const [, expected] of cases) {
      if (expected === null) continue;
      const target = new URL(expected, 'https://proof.invalid');
      expect(
        collectionsCanonicalRedirect('en', Object.fromEntries(target.searchParams)),
        expected,
      ).toBeNull();
    }
  });

  it('asks Editorial for exactly the view, in a form its schema accepts', () => {
    const view = {
      topic: TOPIC,
      holds: 'article' as const,
      language: 'ar' as const,
      sort: 'oldest' as const,
      page: 3,
    };
    const query = collectionsReadQuery(view);
    expect(query).toEqual({
      topic: TOPIC,
      holds: 'article',
      language: 'ar',
      sort: 'oldest',
      offset: 2 * COLLECTION_LISTING_PAGE,
      limit: COLLECTION_LISTING_PAGE,
    });
    expect(collectionListingQuerySchema.safeParse(query).success).toBe(true);
    const deepest = collectionsReadQuery({
      ...DEFAULT_COLLECTIONS_VIEW,
      page: COLLECTIONS_MAX_PAGE,
    });
    expect(collectionListingQuerySchema.safeParse(deepest).success).toBe(true);
  });
});

describe('a Collection’s order (R2), at one address each', () => {
  it('is the curated order unless a date order is asked for exactly', () => {
    expect(readCollectionOrder({})).toBe('curated');
    expect(readCollectionOrder({ order: 'newest' })).toBe('newest');
    expect(readCollectionOrder({ order: 'oldest' })).toBe('oldest');
    for (const order of ['Newest', 'random', '', ['newest', 'oldest']])
      expect(readCollectionOrder({ order }), String(order)).toBe('curated');
    expect(collectionOrderPath('en', 'mawlid', 'curated')).toBe('/collections/mawlid');
    expect(collectionOrderPath('ur', 'mawlid', 'oldest')).toBe(
      '/ur/collections/mawlid?order=oldest',
    );
  });

  it('redirects a curated, unknown or repeated order once to the bare address', () => {
    expect(collectionOrderRedirect('en', 'mawlid', {})).toBeNull();
    expect(collectionOrderRedirect('en', 'mawlid', { order: 'newest' })).toBeNull();
    expect(collectionOrderRedirect('ur', 'mawlid', { order: 'oldest' })).toBeNull();
    for (const order of ['curated', 'sideways', '', ['newest', 'oldest']])
      expect(collectionOrderRedirect('en', 'mawlid', { order }), String(order)).toBe(
        '/collections/mawlid',
      );
    expect(collectionOrderRedirect('ar', 'mawlid', { order: 'curated' })).toBe(
      '/ar/collections/mawlid',
    );
    // Only `?order` is the page's own.
    expect(collectionOrderRedirect('en', 'mawlid', { utm: 'x' })).toBeNull();
  });
});

describe('what a Collection holds, as a reader asks for it', () => {
  it('counts the four News families as news, and every other kind as itself', () => {
    expect(holdsOf('article')).toBe('article');
    expect(holdsOf('work')).toBe('work');
    expect(holdsOf('video')).toBe('video');
    for (const kind of [
      'news-article',
      'press-release',
      'statement',
      'media-coverage',
    ] as const)
      expect(holdsOf(kind)).toBe('news');
  });
});

describe('the listing reads at the public read service', () => {
  function service() {
    const reader = {
      collectionListing: vi.fn(async () => ({ items: [], total: 0, hasMore: false })),
      collectionListingFacets: vi.fn(async () => ({})),
    };
    return {
      reader,
      reads: createEditorialReadService(reader as unknown as EditorialPublicReaderPort),
    };
  }

  it('refuses a malformed view before any read', async () => {
    const { reader, reads } = service();
    const refused: unknown[] = [
      { topic: 'not-an-id' },
      { holds: 'podcast' },
      { holds: 'news-article' },
      { language: 'fr' },
      { sort: 'title' },
      { offset: -1 },
      { offset: COLLECTION_MAX_OFFSET + 1 },
      { offset: 1.5 },
      { limit: 0 },
      { limit: COLLECTION_LISTING_PAGE + 1 },
      { extra: true },
      { topic: 7 },
      null,
      'everything',
    ];
    for (const raw of refused) {
      await expect(reads.collectionListing(raw), JSON.stringify(raw)).rejects.toThrow();
      await expect(
        reads.collectionListingFacets(raw),
        JSON.stringify(raw),
      ).rejects.toThrow();
    }
    expect(reader.collectionListing).not.toHaveBeenCalled();
    expect(reader.collectionListingFacets).not.toHaveBeenCalled();
  });

  it('passes a valid view on with every default filled in', async () => {
    const { reader, reads } = service();
    await reads.collectionListing({ holds: 'video' });
    expect(reader.collectionListing).toHaveBeenCalledWith({
      topic: null,
      holds: 'video',
      language: null,
      sort: 'newest',
      offset: 0,
      limit: COLLECTION_LISTING_PAGE,
    });
    await reads.collectionListingFacets({ topic: TOPIC, sort: 'oldest' });
    expect(reader.collectionListingFacets).toHaveBeenCalledWith({
      topic: TOPIC,
      holds: null,
      language: null,
      sort: 'oldest',
      offset: 0,
      limit: COLLECTION_LISTING_PAGE,
    });
  });
});
