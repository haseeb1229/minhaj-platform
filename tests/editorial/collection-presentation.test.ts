import { afterAll, describe, expect, it, vi } from 'vitest';

import {
  COLLECTION_MAX_OFFSET,
  type PublicCollection,
} from '../../packages/contracts/src/editorial/index.ts';

/**
 * Phase 15 — the Collection pages' pure presentation rules: how `/collections`
 * is paged (an invalid offset is the first page, never a wider read), which of
 * a member's titles a reader is shown (only a title its owner gave), and what a
 * Collection page claims to search engines (only the languages it genuinely
 * has, and nothing at all on the pre-adoption origin).
 *
 * THE INDEXING POSTURE IS SET PER TEST, as the Event and News presentation
 * proofs do, so canonical and alternate URLs are checked for what they say and
 * the fail-closed posture is asserted separately.
 */

const ORIGIN = 'https://collections-seo.proof.invalid';

async function withIndexing(enabled: boolean) {
  vi.resetModules();
  process.env['MINHAJ_BUILD_PUBLIC_INDEXING_ENABLED'] = enabled ? 'true' : 'false';
  process.env['AUTH_BASE_URL'] = ORIGIN;
  return import('../../apps/web/src/components/editorial/collection-presentation.ts');
}

afterAll(() => {
  delete process.env['MINHAJ_BUILD_PUBLIC_INDEXING_ENABLED'];
});

const translation = (
  languageCode: 'en' | 'ur' | 'ar',
  title: string,
  excerpt = '',
  seoTitle = '',
) => ({
  languageCode,
  title,
  excerpt,
  seoTitle,
  seoDescription: '',
  html: '<p>Synthetic</p>',
});

function record(): PublicCollection {
  return {
    slug: 'synthetic-collection',
    primaryLanguage: 'ur',
    translations: [
      translation('en', 'Synthetic collection fixture', 'A synthetic summary.', 'SEO'),
      translation('ur', 'مصنوعی مجموعہ'),
    ],
    topicIds: [],
    contributors: [],
    members: [{ kind: 'work', id: '00000000-0000-4000-8000-000000000001' }],
    publishedAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-02T00:00:00Z'),
  };
}

describe('the /collections offset', () => {
  it('reads a plain whole number within the listing', async () => {
    const { readCollectionOffset, collectionsPath } = await withIndexing(false);
    expect(readCollectionOffset({ offset: '40' })).toBe(40);
    expect(readCollectionOffset({ offset: String(COLLECTION_MAX_OFFSET) })).toBe(
      COLLECTION_MAX_OFFSET,
    );
    expect(collectionsPath('ur', 40)).toBe('/ur/collections?offset=40');
    expect(collectionsPath('en')).toBe('/collections');
  });

  it('answers anything else with the first page, never a wider read', async () => {
    const { readCollectionOffset } = await withIndexing(false);
    for (const offset of [
      undefined,
      '',
      '-20',
      '2.5',
      '1e3',
      ' 20',
      String(COLLECTION_MAX_OFFSET + 1),
      '123456789',
      ['20', '40'],
    ])
      expect(readCollectionOffset({ offset }), String(offset)).toBe(0);
  });
});

describe('the title a member is shown with', () => {
  const target = {
    id: '00000000-0000-4000-8000-000000000002',
    slug: 'synthetic-member',
    titles: [
      { languageCode: 'ur', title: 'مصنوعی رکن' },
      { languageCode: 'en', title: 'Synthetic member' },
    ],
  };

  it('is the owner’s title in the interface locale when it has one', async () => {
    const { memberTitle } = await withIndexing(false);
    expect(memberTitle(target, 'ur')).toEqual({ text: 'مصنوعی رکن', languageCode: 'ur' });
  });

  it('falls back to another title the owner gave, in a stable order', async () => {
    const { memberTitle } = await withIndexing(false);
    expect(memberTitle(target, 'ar')).toEqual({
      text: 'Synthetic member',
      languageCode: 'en',
    });
    expect(
      memberTitle({ ...target, titles: [...target.titles].reverse() }, 'ar'),
    ).toEqual({ text: 'Synthetic member', languageCode: 'en' });
  });

  it('is the public slug only when the owner gives no title at all', async () => {
    const { memberTitle } = await withIndexing(false);
    expect(
      memberTitle({ ...target, titles: [{ languageCode: 'en', title: '' }] }, 'en'),
    ).toEqual({ text: 'synthetic-member', languageCode: null });
  });
});

describe('canonical and hreflang', () => {
  it('lists only the languages the Collection genuinely exists in', async () => {
    const { collectionMetadata } = await withIndexing(true);
    const metadata = collectionMetadata(record(), 'ar');
    expect(metadata.robots).toEqual({ index: true, follow: true });
    expect(metadata.alternates?.canonical).toBe(
      `${ORIGIN}/ur/collections/synthetic-collection`,
    );
    expect(metadata.alternates?.languages).toEqual({
      en: `${ORIGIN}/collections/synthetic-collection`,
      ur: `${ORIGIN}/ur/collections/synthetic-collection`,
      'x-default': `${ORIGIN}/collections/synthetic-collection`,
    });
  });

  it('uses the Collection’s own SEO words, else its title', async () => {
    const { collectionMetadata } = await withIndexing(true);
    expect(collectionMetadata(record(), 'en').title).toBe('SEO');
    expect(collectionMetadata(record(), 'ur').title).toBe('مصنوعی مجموعہ');
  });

  it('claims nothing on the pre-adoption origin', async () => {
    const { collectionMetadata } = await withIndexing(false);
    const metadata = collectionMetadata(record(), 'en');
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.alternates).toBeUndefined();
  });
});

describe('the order a Collection is read in (R2)', () => {
  const at = (iso: string | null, id: string) => ({
    id,
    target: {
      id,
      slug: id,
      titles: [],
      ...(iso === null ? {} : { chronologyAt: new Date(iso) }),
    },
  });
  // Curated: a 2019 report, a book (no date), 2003, 2019 again, 2011.
  const members = [
    at('2019-03-01T00:00:00Z', 'a'),
    at(null, 'book'),
    at('2003-05-01T00:00:00Z', 'b'),
    at('2019-03-01T00:00:00Z', 'c'),
    at('2011-01-01T00:00:00Z', 'd'),
  ];

  it('is the curated order unless a date order is asked for exactly', async () => {
    const { readCollectionOrder, collectionOrderPath } = await withIndexing(false);
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

  it('keeps the curated order as given', async () => {
    const { orderMembers } = await withIndexing(false);
    expect(orderMembers(members, 'curated')).toBe(members);
  });

  it('orders by date stably, with undated members last in their curated place', async () => {
    const { orderMembers } = await withIndexing(false);
    const ids = (order: 'newest' | 'oldest') =>
      orderMembers(members, order).map((member) => member.id);
    expect(ids('newest')).toEqual(['a', 'c', 'd', 'b', 'book']);
    expect(ids('oldest')).toEqual(['b', 'd', 'a', 'c', 'book']);
    // The input is never reordered in place.
    expect(members.map((member) => member.id)).toEqual(['a', 'book', 'b', 'c', 'd']);
  });

  it('groups by the UTC year a member states, and by none when it states none', async () => {
    const { memberYear } = await withIndexing(false);
    expect(memberYear(at('2019-12-31T23:30:00Z', 'x').target)).toBe(2019);
    expect(memberYear(at(null, 'y').target)).toBeNull();
    expect(memberYear({ id: 'z', slug: 'z', titles: [], chronologyAt: null })).toBeNull();
  });
});
