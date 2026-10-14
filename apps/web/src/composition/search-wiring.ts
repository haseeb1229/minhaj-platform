import 'server-only';

import type { EditorialPublicReaderPort, NewsKind } from '@minhaj/contracts/editorial';
import { newsPathOf, pagePath } from '@minhaj/contracts/editorial';
import type { FatwaPublicReaderPort } from '@minhaj/contracts/fatwa';
import type { HadithPublicReaderPort } from '@minhaj/contracts/hadith';
import type { LearningPublicReaderPort } from '@minhaj/contracts/learning';
import type { LibraryPublicReaderPort, ScholarlyKind } from '@minhaj/contracts/library';
import type { MediaPublicReaderPort } from '@minhaj/contracts/media';
import type { PeopleReaderPort } from '@minhaj/contracts/people';
import type { QuranPublicReaderPort } from '@minhaj/contracts/quran';
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
import { audioTrackPathOf, videoPathOf } from '@/components/media/presentation';
import { createEditorialSearchSources } from '@/contexts/editorial';
import { createFatwaSearchProjection } from '@/contexts/fatwa';
import { createHadithSearchProjection } from '@/contexts/hadith';
import { createLearningSearchProjection } from '@/contexts/learning';
import {
  createLibrarySearchSource,
  createScholarlySearchSource,
} from '@/contexts/library';
import { createAudioSearchSource, createVideoSearchSource } from '@/contexts/media';
import { createPersonSearchSource } from '@/contexts/people-contributors';
import { createQuranSearchProjection } from '@/contexts/quran';
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
 * Work's page — with the Edition selected — under `/library/books/{slug}`, the
 * Phase-9 Library routes, an issue beneath its Magazine's CURRENT slug, a
 * Phase-10 Video at `/watch/videos/{slug}`, a Phase-11 AudioTrack at
 * `/listen/lectures/{slug}`, and each Phase-13 News family at its own
 * canonical address beneath `/news`, a Phase-18 Ayah at its permanent
 * citation address `/quran/surah/{surah}/{ayah}`, and a Phase-19 Hadith
 * citation at its permanent address `/hadith/{collection}/{number}`, and a
 * Phase-20 published ruling at `/fatwa/{slug}`, and a Phase-22 published Course at
 * `/learn/courses/{slug}` and LearningPath at `/learn/paths/{slug}`.
 */

export interface SearchOwnerReaders {
  readonly taxonomy: TaxonomyReaderPort;
  readonly people: PeopleReaderPort;
  readonly editorial: EditorialPublicReaderPort;
  readonly library: LibraryPublicReaderPort;
  readonly media: MediaPublicReaderPort;
  readonly quran: QuranPublicReaderPort;
  readonly hadith: HadithPublicReaderPort;
  readonly fatwa: FatwaPublicReaderPort;
  readonly learning: LearningPublicReaderPort;
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
  const quran = createQuranSearchProjection(readers.quran);
  const hadith = createHadithSearchProjection(readers.hadith);
  const fatwa = createFatwaSearchProjection(readers.fatwa);
  const learning = createLearningSearchProjection(readers.learning);

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
  // Editorial's own public predicate answers which News records are published
  // NOW, and at what slug — a withdrawn record's stale projection is withheld,
  // and a renamed one resolves to its current address.
  const news =
    (kind: NewsKind): SearchTargetResolver =>
    async (ids) =>
      mapOf(await readers.editorial.publishedNewsTargets(kind, ids), (row) =>
        newsPathOf(kind, row.slug),
      );

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
      video: createVideoSearchSource(readers.media),
      audio: createAudioSearchSource(readers.media),
      'news-article': editorial.news['news-article'],
      'press-release': editorial.news['press-release'],
      statement: editorial.news.statement,
      'media-coverage': editorial.news['media-coverage'],
      'quran-ayah': quran.source,
      hadith: hadith.source,
      fatwa: fatwa.source,
      course: learning.course.source,
      'learning-path': learning.path.source,
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
      // Media's own public predicate answers which Videos are published NOW,
      // and at what slug — a withdrawn Video's stale projection is withheld.
      video: async (ids) =>
        mapOf(await readers.media.publicVideoTargets(ids), (row) =>
          videoPathOf(row.slug),
        ),
      // The same for an AudioTrack: only published tracks, at their current slug.
      audio: async (ids) =>
        mapOf(await readers.media.publicAudioTargets(ids), (row) =>
          audioTrackPathOf(row.slug),
        ),
      'news-article': news('news-article'),
      'press-release': news('press-release'),
      statement: news('statement'),
      'media-coverage': news('media-coverage'),
      // Quran's own public predicate answers which Ayat are public NOW — the
      // corpus active and the Ayah present — at their permanent citation.
      'quran-ayah': quran.target,
      // Hadith's own public predicate answers which citations are public NOW —
      // activated, mapped, unconflicted and verified at the current version.
      hadith: hadith.target,
      // Fatwa's own public predicate answers which rulings are public NOW —
      // activated, published, not withdrawn — so a stale row of a withdrawn
      // ruling is withheld before it is returned.
      fatwa: fatwa.target,
      // Learning's own public predicate answers which Courses and LearningPaths
      // are published NOW, and at what slug — a stale row of a Course returned
      // to draft or archived is withheld before it is returned.
      course: learning.course.target,
      'learning-path': learning.path.target,
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
