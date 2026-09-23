import 'server-only';

import type {
  EditorialPublicReaderPort,
  EditorialSearchRecord,
} from '@minhaj/contracts/editorial';
import type { SearchScopeSource } from '@minhaj/contracts/search';

import { editorialPlainText } from './rich-text.ts';

/**
 * Editorial's search projections — PUBLISHED Articles and Pages only
 * (DELIVERY_PLAN.md Phase 17).
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
 * THE YEAR IS THE GENUINE PUBLICATION YEAR, taken from `publishedAt` in UTC.
 */
function documentsOf(kind: 'article' | 'page', record: EditorialSearchRecord) {
  const year = record.publishedAt.getUTCFullYear();
  return record.translations.map((translation) => ({
    kind,
    resourceId: record.id,
    textLanguage: translation.languageCode,
    contentLanguage: translation.languageCode,
    title: translation.title,
    summary: translation.excerpt,
    body: editorialPlainText(translation.document),
    year,
    topicIds: [...record.topicIds],
  }));
}

export function createEditorialSearchSources(reader: EditorialPublicReaderPort): {
  readonly article: SearchScopeSource;
  readonly page: SearchScopeSource;
} {
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
  };
}
