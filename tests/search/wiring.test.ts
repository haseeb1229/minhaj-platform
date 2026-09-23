import { describe, expect, it } from 'vitest';

import type { EditorialPublicReaderPort } from '../../packages/contracts/src/editorial/index.ts';
import type { LibraryPublicReaderPort } from '../../packages/contracts/src/library/index.ts';
import type { PeopleReaderPort } from '../../packages/contracts/src/people/index.ts';
import type { TaxonomyReaderPort } from '../../packages/contracts/src/taxonomy/index.ts';
import { searchWiring } from '../../apps/web/src/composition/search-wiring.ts';

/**
 * The Layer-4 wiring between Search and its owners.
 *
 * Result addresses are the OWNERS' canonical public routes (ROUTE_MAP.md §3),
 * built from the owners' CURRENT answer — and an id an owner does not return is
 * simply absent, which is what makes the stale-index rule hold.
 */

function readers() {
  const taxonomy = {
    topicReferences: async (ids: readonly string[]) =>
      ids
        .filter((id) => id !== 'archived')
        .map((id) => ({ id, slug: `topic-${id}`, name: id })),
    findTopicBySlug: async ({ slug }: { slug: string }) =>
      slug === 'retired'
        ? { id: 't9', slug, status: 'archived', label: { name: 'Retired' } }
        : { id: 't1', slug, status: 'active', label: { name: 'Education' } },
  } as unknown as TaxonomyReaderPort;
  const people = {
    contributorReferences: async (ids: readonly string[]) =>
      ids.map((id) => ({ id, slug: `person ${id}`, name: id })),
  } as unknown as PeopleReaderPort;
  const editorial = {
    publishedArticleTargets: async (ids: readonly string[]) =>
      ids.map((id) => ({ id, slug: `article-${id}` })),
    publishedPageTargets: async (ids: readonly string[]) =>
      ids.map((id) => ({ id, routeBinding: 'help-article', slug: `help-${id}` })),
  } as unknown as EditorialPublicReaderPort;
  const library = {
    publicWorkTargets: async (ids: readonly string[]) =>
      ids.map((id) => ({ id, slug: `work-${id}` })),
    publicEditionTargets: async (ids: readonly string[]) =>
      ids.map((id) => ({ id, workSlug: `work-${id}` })),
  } as unknown as LibraryPublicReaderPort;
  return { taxonomy, people, editorial, library };
}

describe('searchWiring', () => {
  it('addresses every result kind at its owner canonical route', async () => {
    const { targets } = searchWiring(readers());

    expect((await targets.topic(['1'])).get('1')).toBe('/topics/topic-1');
    expect((await targets.person(['2'])).get('2')).toBe('/people/person%202');
    expect((await targets.article(['3'])).get('3')).toBe('/library/articles/article-3');
    expect((await targets.page(['4'])).get('4')).toBe('/help/help-4');
    expect((await targets.work(['5'])).get('5')).toBe('/library/books/work-5');
    expect((await targets.edition(['e/6'])).get('e/6')).toBe(
      '/library/books/work-e%2F6?edition=e%2F6',
    );
    expect((await targets['book-translation'](['7'])).get('7')).toBe(
      '/library/books/work-7?edition=7',
    );
  });

  it('omits what the owner does not currently publish', async () => {
    const { targets } = searchWiring(readers());
    const found = await targets.topic(['1', 'archived']);
    expect([...found.keys()]).toEqual(['1']);
  });

  it('resolves only an ACTIVE topic for the filter', async () => {
    const { resolveTopic } = searchWiring(readers());
    expect(await resolveTopic('education', 'ur')).toEqual({
      id: 't1',
      slug: 'education',
      name: 'Education',
    });
    expect(await resolveTopic('retired', 'en')).toBeNull();
  });
});
