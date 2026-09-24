import 'server-only';

import type { EditorialPublicReaderPort } from '@minhaj/contracts/editorial';
import { pagePath } from '@minhaj/contracts/editorial';
import type { LibraryPublicReaderPort, ScholarlyKind } from '@minhaj/contracts/library';
import type { PeopleReaderPort } from '@minhaj/contracts/people';
import type {
  SearchKind,
  SearchScopeKind,
  SearchScopeSource,
  SearchTargetResolver,
} from '@minhaj/contracts/search';
import type { TaxonomyReaderPort } from '@minhaj/contracts/taxonomy';
import type { SearchTopic } from '@minhaj/search';

import { EDITION_PARAM } from '@/components/library/presentation';
import { scholarlyPathOf } from '@/components/library/scholarly-presentation';
import { createEditorialSearchSources } from '@/contexts/editorial';
import {
  createLibrarySearchSource,
  createScholarlySearchSource,
} from '@/contexts/library';
import { createPersonSearchSource } from '@/contexts/people-contributors';
import { createTopicSearchSource } from '@/contexts/taxonomy';

/**
 * Search's owners, wired — Layer 4 (DOMAIN_MODEL.md §3.3).
 *
 * THE ONLY PLACE THAT KNOWS BOTH SIDES. The Search service knows no owner and
 * no route; each owner knows its own projection and nothing of Search's engine.
 * This module hands each owner's projection to the service and turns each
 * owner's CURRENT public identity into a path — which is exactly the
 * cross-context composition Layer 4 exists for.
 *
 * PUBLIC READERS ONLY. Every port here is an owner's public, session-free read,
 * so the search graph reaches no session, no authorisation service and no
 * authentication library (ARCHITECTURE.md §8.1, §8.3.1.1).
 *
 * NO SINGLETON, NO ENVIRONMENT. `search.ts` builds the runtime from this; the
 * live-database proofs build their own from the SAME function over a disposable
 * database, so what is proved is what runs.
 *
 * PATHS ARE LOCALE-FREE; the page prefixes the reader's interface locale. The
 * shapes are the owners' own public routes (ROUTE_MAP.md §3): `/topics/{slug}`,
 * `/people/{slug}`, `/library/articles/{slug}`, a Page's reserved binding, a
 * Work's page — with the Edition selected — under `/library/books/{slug}`, and
 * the Phase-9 Library routes, an issue beneath its Magazine's CURRENT slug.
 */

export interface SearchOwnerReaders {
  readonly taxonomy: TaxonomyReaderPort;
  readonly people: PeopleReaderPort;
  readonly editorial: EditorialPublicReaderPort;
  readonly library: LibraryPublicReaderPort;
}

const segment = (value: string) => encodeURIComponent(value);

function mapOf<T extends { readonly id: string }>(
  rows: readonly T[],
  path: (row: T) => string,
): ReadonlyMap<string, string> {
  return new Map(rows.map((row) => [row.id, path(row)]));
}

export function searchWiring(readers: SearchOwnerReaders): {
  readonly sources: Readonly<Record<SearchScopeKind, SearchScopeSource>>;
  readonly targets: Readonly<Record<SearchKind, SearchTargetResolver>>;
  readonly resolveTopic: (slug: string, locale: string) => Promise<SearchTopic | null>;
} {
  const editorial = createEditorialSearchSources(readers.editorial);

  const editions: SearchTargetResolver = async (ids) =>
    mapOf(
      await readers.library.publicEditionTargets(ids),
      (row) =>
        `/library/books/${segment(row.workSlug)}?${EDITION_PARAM}=${segment(row.id)}`,
    );

  const scholarly = (kind: ScholarlyKind) => ({
    source: createScholarlySearchSource(readers.library, kind),
    target: (async (ids) =>
      mapOf(await readers.library.scholarlyTargets(kind, ids), (row) =>
        scholarlyPathOf(kind, row.slug, row.magazineSlug),
      )) satisfies SearchTargetResolver,
  });
  const research = scholarly('research');
  const researchPaper = scholarly('research-paper');
  const publication = scholarly('publication');
  const magazine = scholarly('magazine');
  const magazineIssue = scholarly('magazine-issue');
  const encyclopedia = scholarly('encyclopedia');

  return {
    sources: {
      topic: createTopicSearchSource(readers.taxonomy),
      person: createPersonSearchSource(readers.people),
      article: editorial.article,
      page: editorial.page,
      work: createLibrarySearchSource(readers.library),
      research: research.source,
      'research-paper': researchPaper.source,
      publication: publication.source,
      magazine: magazine.source,
      'magazine-issue': magazineIssue.source,
      encyclopedia: encyclopedia.source,
    },

    targets: {
      // Taxonomy's and People's existing bounded reference reads already answer
      // "which of these are public now, and at what slug".
      topic: async (ids) =>
        mapOf(
          await readers.taxonomy.topicReferences(ids, 'en'),
          (row) => `/topics/${segment(row.slug)}`,
        ),
      person: async (ids) =>
        mapOf(
          await readers.people.contributorReferences(ids, 'en'),
          (row) => `/people/${segment(row.slug)}`,
        ),
      article: async (ids) =>
        mapOf(
          await readers.editorial.publishedArticleTargets(ids),
          (row) => `/library/articles/${segment(row.slug)}`,
        ),
      page: async (ids) =>
        mapOf(await readers.editorial.publishedPageTargets(ids), (row) =>
          pagePath(row.routeBinding, row.slug),
        ),
      work: async (ids) =>
        mapOf(
          await readers.library.publicWorkTargets(ids),
          (row) => `/library/books/${segment(row.slug)}`,
        ),
      edition: editions,
      'book-translation': editions,
      research: research.target,
      'research-paper': researchPaper.target,
      publication: publication.target,
      magazine: magazine.target,
      'magazine-issue': magazineIssue.target,
      encyclopedia: encyclopedia.target,
    },

    async resolveTopic(slug, locale) {
      const topic = await readers.taxonomy.findTopicBySlug({
        slug,
        locale: locale === 'ur' || locale === 'ar' ? locale : 'en',
      });
      if (topic === null || topic.status !== 'active') return null;
      return { id: topic.id, slug: topic.slug, name: topic.label.name };
    },
  };
}
