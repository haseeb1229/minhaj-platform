import { describe, expect, it } from 'vitest';

import { facetCount, facetKinds } from '../../apps/web/src/components/search/facets.ts';

/**
 * R2 — the results page's type facets: offered only for domains with published
 * content, the chosen type always kept, and a count only where the index gives
 * one. Pure; no database.
 */

describe('facetKinds', () => {
  it('offers only people and pages when nothing else is published', () => {
    expect(facetKinds(new Set(), '')).toEqual(['person', 'page']);
  });

  it('offers a domain’s kind once its content is published, in reading order', () => {
    expect(facetKinds(new Set(['watch', 'books', 'quran'] as const), '')).toEqual([
      'quran-ayah',
      'work',
      'video',
      'person',
      'page',
    ]);
  });

  it('keeps the chosen type visible even without evidence for it', () => {
    expect(facetKinds(new Set(), 'fatwa')).toEqual(['person', 'page', 'fatwa']);
    expect(facetKinds(new Set(), 'encyclopedia')).toEqual([
      'person',
      'page',
      'encyclopedia',
    ]);
  });

  it('never offers a type the index does not know', () => {
    expect(facetKinds(new Set(), 'not-a-kind')).toEqual(['person', 'page']);
    expect(facetKinds(new Set(), '<script>')).toEqual(['person', 'page']);
  });

  it('does not repeat the chosen type when it is already offered', () => {
    expect(facetKinds(new Set(['watch'] as const), 'video')).toEqual([
      'video',
      'person',
      'page',
    ]);
  });
});

describe('facetCount', () => {
  it('states the total in the interface’s numerals', () => {
    expect(facetCount({ total: 1234, capped: false }, 500, 'en')).toBe('1,234');
    expect(facetCount({ total: 12, capped: false }, 500, 'ar')).toBe(
      new Intl.NumberFormat('ar').format(12),
    );
  });

  it('marks a capped total as more than the ceiling', () => {
    expect(facetCount({ total: 500, capped: true }, 500, 'en')).toBe('500+');
  });
});
