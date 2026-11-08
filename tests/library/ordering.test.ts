import { describe, expect, it } from 'vitest';

import { libraryQuerySchema } from '../../packages/contracts/src/library/index.ts';
import {
  issuesByYear,
  listingHref,
} from '../../apps/web/src/components/library/scholarly-presentation.ts';

/**
 * Rebaseline R2 — the Library's reader-facing order (audit F14): the Work
 * listing's order contract, and a periodical's issues grouped by year.
 */

describe('the Work listing order is a closed contract', () => {
  it('keeps the stable catalogue order for a caller that asks for none', () => {
    expect(libraryQuerySchema.parse({})).toMatchObject({ sort: null, titleLocale: null });
  });

  it('admits the two reader orders and an interface locale to read titles in', () => {
    expect(libraryQuerySchema.parse({ sort: 'title', titleLocale: 'ur' })).toMatchObject({
      sort: 'title',
      titleLocale: 'ur',
    });
    expect(libraryQuerySchema.parse({ sort: 'newest' }).sort).toBe('newest');
  });

  it('refuses an order or a locale it does not know — nothing reaches SQL unparsed', () => {
    expect(libraryQuerySchema.safeParse({ sort: 'slug' }).success).toBe(false);
    expect(
      libraryQuerySchema.safeParse({ sort: "title'; DROP TABLE Work;--" }).success,
    ).toBe(false);
    expect(libraryQuerySchema.safeParse({ titleLocale: 'fr' }).success).toBe(false);
  });
});

describe("a magazine's issues, grouped by year", () => {
  const issue = (id: string, publicationYear: number | null) => ({ id, publicationYear });

  it('groups consecutive issues under their year, keeping the periodical order', () => {
    const groups = issuesByYear([
      issue('a', 2026),
      issue('b', 2026),
      issue('c', 2025),
      issue('d', null),
    ]);
    expect(groups.map((group) => group.year)).toEqual([2026, 2025, null]);
    expect(groups[0]?.issues.map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(groups.flatMap((group) => group.issues).map((entry) => entry.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('is empty for no issues', () => {
    expect(issuesByYear([])).toEqual([]);
  });
});

describe('a listing row has one address', () => {
  it('places an issue beneath its magazine and anything else at its own address', () => {
    expect(
      listingHref('ur', {
        kind: 'magazine-issue',
        slug: 'spring',
        issue: { magazineSlug: 'monthly', volume: 1, issueNumber: 2, cover: null },
      }),
    ).toBe('/ur/library/magazines/monthly/issues/spring');
    expect(listingHref('en', { kind: 'research', slug: 'a-study', issue: null })).toBe(
      '/library/research/a-study',
    );
  });
});
