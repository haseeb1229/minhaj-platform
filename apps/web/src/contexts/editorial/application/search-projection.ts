import 'server-only';

import {
  NEWS_KINDS,
  type EditorialPublicReaderPort,
  type EditorialSearchRecord,
  type NewsKind,
} from '@minhaj/contracts/editorial';
import type { SearchScopeSource } from '@minhaj/contracts/search';

import { editorialPlainText } from './rich-text.ts';

/**
 * Editorial's search projections — PUBLISHED Articles, Pages and, since Phase
 * 13, the four News families (DELIVERY_PLAN.md Phases 13 and 17).
 *
 * WHAT IS NEVER HERE: drafts, records in review, approved-but-unpublished and
 * scheduled revisions, archived records, and the private correspondence area
 * (ContactInquiry and Feedback "never appear in public listings, search or
 * caches" — DELIVERY_PLAN.md Phase 6). The reader returns only the published
 * current revision, so none of them can be projected by accident.
 *
 * ONE DOCUMENT PER TRANSLATION, and each translation's language IS a content
 * Language (a real reference to Taxonomy's catalogue), so these documents are
 * what the content-language filter selects.
 *
 * THE YEAR IS THE RECORD'S CHRONOLOGY YEAR in UTC: the source's own
 * publication date where a dated record states one (Phase 30-R), else the
 * genuine publication instant — never a migration or approval time.
 *
 * A NEWS RECORD'S OWN WORDS ONLY. A Statement's issuing authority and a
 * MediaCoverage record's outlet name are matched with its body because a
 * visitor searches for them; a coverage record's source ADDRESS is not, and
 * nothing of the third party's article is ever projected — none is stored.
 */
function documentsOf(kind: 'article' | 'page' | NewsKind, record: EditorialSearchRecord) {
  const year = (record.chronologyAt ?? record.publishedAt).getUTCFullYear();
  return record.translations.map((translation) => ({
    kind,
    resourceId: record.id,
    textLanguage: translation.languageCode,
    contentLanguage: translation.languageCode,
    title: translation.title,
    summary: translation.excerpt,
    body: [translation.issuer, record.outlet, editorialPlainText(translation.document)]
      .filter((part): part is string => part !== undefined && part !== '')
      .join('\n'),
    year,
    topicIds: [...record.topicIds],
  }));
}

export function createEditorialSearchSources(reader: EditorialPublicReaderPort): {
  readonly article: SearchScopeSource;
  readonly page: SearchScopeSource;
  readonly news: Readonly<Record<NewsKind, SearchScopeSource>>;
} {
  const newsSource = (kind: NewsKind): SearchScopeSource => ({
    async project(id) {
      const record = await reader.searchNews(kind, id);
      return record === null
        ? null
        : { stamp: record.stamp, documents: documentsOf(kind, record) };
    },
    list: (input) => reader.searchNewsList(kind, input),
  });
  return {
    article: {
      async project(id) {
        const record = await reader.searchArticle(id);
        return record === null
          ? null
          : { stamp: record.stamp, documents: documentsOf('article', record) };
      },
      list: (input) => reader.searchArticles(input),
    },
    page: {
      async project(id) {
        const record = await reader.searchPage(id);
        return record === null
          ? null
          : { stamp: record.stamp, documents: documentsOf('page', record) };
      },
      list: (input) => reader.searchPages(input),
    },
    news: Object.fromEntries(
      NEWS_KINDS.map((kind) => [kind, newsSource(kind)]),
    ) as Record<NewsKind, SearchScopeSource>,
  };
}
