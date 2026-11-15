import { z } from 'zod';

import {
  courseQuerySchema,
  learningIdSchema,
  learningSlugSchema,
  topicCourseQuerySchema,
  topicTotalsInputSchema,
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

    /**
     * Learn Part 1 — where one published Course stands: the published paths
     * holding it and the Courses studied with it. A malformed identifier is
     * refused here, before any read.
     */
    courseRelations(courseId: unknown) {
      return reader.courseRelations(learningIdSchema.parse(courseId));
    },

    /**
     * Quran Part 13 — a Topic's course hub, composed at Layer 4: one bounded
     * page of the published Courses on the named Topic, the aggregates the hub
     * is navigated by, and the published LearningPaths holding one of them.
     * Since Learn Part 1 the same reads serve the catalogue (`scope:
     * 'catalogue'`), where the Topic is an optional filter. Every field is
     * parsed here (an unknown scope, level, format or order, a malformed Topic
     * or teacher, an offset past the bound), before any read.
     */
    topicCourses(raw: unknown = {}) {
      return reader.topicCourses(topicCourseQuerySchema.parse(raw));
    },

    topicCourseFacets(raw: unknown = {}) {
      return reader.topicCourseFacets(topicCourseQuerySchema.parse(raw));
    },

    topicCoursePaths(topic: unknown = null) {
      return reader.topicCoursePaths(learningIdSchema.nullable().parse(topic));
    },

    /**
     * Learn Part 2 — the Topic index: per asked Topic, how many published
     * Courses its hub opens with. The Topics are parsed here (identifiers,
     * distinct, at most `TOPIC_TOTALS_MAX`) before any read; none asked
     * reads nothing.
     */
    async topicCourseTotals(raw: unknown) {
      const topics = topicTotalsInputSchema.parse(raw);
      if (topics.length === 0) return [];
      return reader.topicCourseTotals(topics);
    },

    paths(offset = 0) {
      return reader.paths(browseOffset.parse(offset));
    },

    /**
     * Learn Part 2 — the paths catalogue: the same page as `paths`, each path
     * with what its published Courses hold together, and the catalogue's
     * figures. The offset is parsed here, before any read.
     */
    pathSummaries(offset = 0) {
      return reader.pathSummaries(browseOffset.parse(offset));
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
