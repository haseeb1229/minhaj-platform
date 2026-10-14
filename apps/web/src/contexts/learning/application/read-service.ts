import { z } from 'zod';

import {
  courseQuerySchema,
  learningSlugSchema,
  type LearningPublicReaderPort,
} from '@minhaj/contracts/learning';

/**
 * The PUBLIC Learning reads — what every Learn page is built on.
 *
 * NO ACTOR, NO SESSION, NO PERMISSION, and the SHAPE is what makes that
 * structural: there is no parameter a viewer's identity could arrive through,
 * so no catalogue page can vary with who is looking (ARCHITECTURE.md §8.1). A
 * person's Enrolment, Progress and trial requests reach a public page only
 * through its private island, after it loads — never through this read.
 *
 * EVERY INPUT IS VALIDATED HERE, at the trust boundary. A slug from a URL
 * segment that does not match the grammar resolves to `null` — the page's own
 * 404 — rather than reaching a query.
 */

const browseOffset = z.number().int().min(0).max(25_000);

const validSlug = (slug: string): boolean => learningSlugSchema.safeParse(slug).success;

export function createLearningReadService(reader: LearningPublicReaderPort) {
  return {
    courses(raw: unknown = {}) {
      return reader.courses(courseQuerySchema.parse(raw));
    },

    course(slug: string) {
      return validSlug(slug) ? reader.course(slug) : Promise.resolve(null);
    },

    courseCanonicalSlug(slug: string) {
      return validSlug(slug) ? reader.courseCanonicalSlug(slug) : Promise.resolve(null);
    },

    teacherFacets(offset = 0) {
      return reader.teacherFacets(browseOffset.parse(offset));
    },

    paths(offset = 0) {
      return reader.paths(browseOffset.parse(offset));
    },

    path(slug: string) {
      return validSlug(slug) ? reader.path(slug) : Promise.resolve(null);
    },

    pathCanonicalSlug(slug: string) {
      return validSlug(slug) ? reader.pathCanonicalSlug(slug) : Promise.resolve(null);
    },

    /**
     * One page of canonical URLs for the machine sitemap — a wider offset bound
     * than a browse, because the sitemap reads the whole published catalogue.
     */
    sitemap(kind: 'course' | 'path', offset: number, limit: number) {
      return reader.sitemap(
        z.enum(['course', 'path']).parse(kind),
        z.number().int().min(0).max(10_000_000).parse(offset),
        z.number().int().min(1).max(5000).parse(limit),
      );
    },
  };
}

export type LearningReadService = ReturnType<typeof createLearningReadService>;
