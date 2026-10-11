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
    expect(collectionsPath('en')).toBe('/en/collections');
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
      en: `${ORIGIN}/en/collections/synthetic-collection`,
      ur: `${ORIGIN}/ur/collections/synthetic-collection`,
      'x-default': `${ORIGIN}/en/collections/synthetic-collection`,
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
