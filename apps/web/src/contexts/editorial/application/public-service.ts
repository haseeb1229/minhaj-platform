import { z } from 'zod';
import {
  editorialSlugSchema,
  validPageBinding,
  type EditorialPublicReaderPort,
} from '@minhaj/contracts/editorial';

export function createEditorialReadService(reader: EditorialPublicReaderPort) {
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
  };
}
