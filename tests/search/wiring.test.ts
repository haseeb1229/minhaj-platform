import { describe, expect, it } from 'vitest';

import type { EditorialPublicReaderPort } from '../../packages/contracts/src/editorial/index.ts';
import type { LibraryPublicReaderPort } from '../../packages/contracts/src/library/index.ts';
import type { MediaPublicReaderPort } from '../../packages/contracts/src/media/index.ts';
import type { PeopleReaderPort } from '../../packages/contracts/src/people/index.ts';
import type { QuranPublicReaderPort } from '../../packages/contracts/src/quran/index.ts';
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
    scholarlyTargets: async (kind: string, ids: readonly string[]) =>
      ids
        .filter((id) => id !== 'withdrawn')
        .map((id) => ({
          id,
          slug: `${kind}-${id}`,
          magazineSlug: kind === 'magazine-issue' ? `magazine of ${id}` : null,
        })),
  } as unknown as LibraryPublicReaderPort;
  const media = {
    publicVideoTargets: async (ids: readonly string[]) =>
      ids.filter((id) => id !== 'withdrawn').map((id) => ({ id, slug: `video ${id}` })),
  } as unknown as MediaPublicReaderPort;
  const quran = {
    // Only 2:3 is public now; 2:4 is absent from the corpus or the corpus is
    // not active — the owner simply does not return it.
    publicAyahTargets: async (refs: readonly { surah: number; ayah: number }[]) =>
      refs.filter((ref) => ref.surah === 2 && ref.ayah === 3),
  } as unknown as QuranPublicReaderPort;
  return { taxonomy, people, editorial, library, media, quran };
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

  it('addresses every Phase-9 kind at the Library route the route map names', async () => {
    const { targets } = searchWiring(readers());

    expect((await targets.research(['1'])).get('1')).toBe('/library/research/research-1');
    expect((await targets['research-paper'](['2'])).get('2')).toBe(
      '/library/research-papers/research-paper-2',
    );
    expect((await targets.publication(['3'])).get('3')).toBe(
      '/library/publications/publication-3',
    );
    expect((await targets.magazine(['4'])).get('4')).toBe(
      '/library/magazines/magazine-4',
    );
    expect((await targets.encyclopedia(['5'])).get('5')).toBe(
      '/library/encyclopedias/encyclopedia-5',
    );
    // An issue lives beneath its Magazine's CURRENT slug, each segment encoded.
    expect((await targets['magazine-issue'](['6'])).get('6')).toBe(
      '/library/magazines/magazine%20of%206/issues/magazine-issue-6',
    );
  });

  it('addresses a Video at its Watch route, and omits one Media withdrew', async () => {
    const { targets } = searchWiring(readers());
    const found = await targets.video(['1', 'withdrawn']);
    expect([...found.entries()]).toEqual([['1', '/watch/videos/video%201']]);
  });

  it('addresses an Ayah at its permanent citation, and omits one Quran withholds', async () => {
    const { targets } = searchWiring(readers());
    const found = await targets['quran-ayah'](['2:3', '2:4', 'not-a-citation']);
    expect([...found.entries()]).toEqual([['2:3', '/quran/surah/2/3']]);
  });

  it('omits a Phase-9 record its owner no longer publishes', async () => {
    const { targets } = searchWiring(readers());
    const found = await targets['research-paper'](['1', 'withdrawn']);
    expect([...found.keys()]).toEqual(['1']);
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
