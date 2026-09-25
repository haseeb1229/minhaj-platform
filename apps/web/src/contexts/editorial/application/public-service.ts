import { z } from 'zod';
import {
  NEWS_EARLIEST_YEAR,
  NEWS_MAX_OFFSET,
  NEWS_PAGE,
  NEWS_TOPIC_PREVIEW,
  editorialIdSchema,
  editorialSlugSchema,
  isReservedNewsSlug,
  newsKindSchema,
  validPageBinding,
  type EditorialPublicReaderPort,
  type NewsKind,
  type NewsPage,
} from '@minhaj/contracts/editorial';

const newsOffsetSchema = z.number().int().min(0).max(NEWS_MAX_OFFSET);

/**
 * The archive's query, validated again here whatever the page tolerated: a
 * year within the accepted range and a month only together with a year.
 */
const archiveFilterSchema = z
  .strictObject({
    year: z.number().int().min(NEWS_EARLIEST_YEAR).max(9998).nullable(),
    month: z.number().int().min(1).max(12).nullable(),
    offset: newsOffsetSchema,
  })
  .refine((value) => value.month === null || value.year !== null);

export function createEditorialReadService(reader: EditorialPublicReaderPort) {
  /** A slug that cannot name a published record of this family answers null. */
  const newsSlug = (kind: NewsKind, slug: string) =>
    editorialSlugSchema.safeParse(slug).success &&
    !(kind === 'news-article' && isReservedNewsSlug(slug));
  return {
    async articleCanonicalSlug(slug: string) {
      if (!editorialSlugSchema.safeParse(slug).success) return null;
      return reader.articleCanonicalSlug(slug);
    },
    async pageCanonicalSlug(binding: string, slug: string) {
      if (
        !validPageBinding(binding, slug) ||
        !editorialSlugSchema.safeParse(slug).success
      )
        return null;
      return reader.pageCanonicalSlug(binding, slug);
    },
    helpPages(offset = 0) {
      z.number().int().min(0).max(10_000_000).parse(offset);
      return reader.publishedHelpPages(offset, 25);
    },
    async article(slug: string) {
      if (!editorialSlugSchema.safeParse(slug).success) return null;
      return reader.publicArticle(slug);
    },
    async page(binding: string, slug = 'page') {
      if (
        !validPageBinding(binding, slug) ||
        !editorialSlugSchema.safeParse(slug).success
      )
        return null;
      return reader.publicPage(binding, slug);
    },
    articles(offset = 0) {
      z.number().int().min(0).max(10_000_000).parse(offset);
      return reader.publishedArticles(offset, 25);
    },
    articleSitemap(offset: number, limit: number) {
      return reader.articleSitemap(offset, limit);
    },
    pageSitemap(offset: number, limit: number) {
      return reader.pageSitemap(offset, limit);
    },

    /* ---- Phase 13: News ------------------------------------------------- */

    async newsCanonicalSlug(kind: NewsKind, slug: string) {
      if (!newsSlug(newsKindSchema.parse(kind), slug)) return null;
      return reader.newsCanonicalSlug(kind, slug);
    },
    async news(kind: NewsKind, slug: string) {
      if (!newsSlug(newsKindSchema.parse(kind), slug)) return null;
      return reader.publicNews(kind, slug);
    },
    async newsList(kind: NewsKind, offset = 0): Promise<NewsPage> {
      return reader.publishedNews(
        newsKindSchema.parse(kind),
        newsOffsetSchema.parse(offset),
        NEWS_PAGE,
      );
    },
    async newsArchive(filter: {
      readonly year: number | null;
      readonly month: number | null;
      readonly offset: number;
    }): Promise<NewsPage> {
      const parsed = archiveFilterSchema.parse(filter);
      return reader.newsTimeline({ ...parsed, limit: NEWS_PAGE, topicId: null });
    },
    newsArchivePeriods() {
      return reader.newsArchivePeriods();
    },
    /** The most recent published News on a topic, for the topic hub. */
    async newsOnTopic(topicId: string): Promise<NewsPage> {
      return reader.newsTimeline({
        offset: 0,
        limit: NEWS_TOPIC_PREVIEW,
        year: null,
        month: null,
        topicId: editorialIdSchema.parse(topicId),
      });
    },
    newsSitemap(kind: NewsKind, offset: number, limit: number) {
      return reader.newsSitemap(kind, offset, limit);
    },
  };
}
