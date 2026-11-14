import { z } from 'zod';

import { localeSchema } from '../env/shared.ts';
import {
  courseFormatSchema,
  courseLevelSchema,
  learningIdSchema,
  learningLanguageCodeSchema,
  type CourseListing,
  type PathListing,
} from './values.ts';

/**
 * QURAN PART 13 — A TOPIC'S COURSES, AS A HUB READS THEM.
 *
 * Which Courses are "courses on a Topic" is Learning's answer: every PUBLISHED
 * Course filed under the Topic a caller names by identifier (its first
 * consumer, the Quran Courses hub, names Taxonomy's `quran` Topic, resolved at
 * Layer 4 — Learning holds only the key). With no Topic (`topic: null`) the
 * set is empty, never every Course.
 *
 * The catalogue's own `courses` read answers a page and whether there is
 * more; a hub also needs how many Courses a view holds, the counts each choice
 * would show and an order a learner chooses by. So:
 *
 *   `format`    `self-paced` or `live`, or either;
 *   `level`     a stated level; an unstated level is matched by none;
 *   `language`  the Course's CONTENT language, never the interface locale;
 *   `teacher`   a People identifier attributed as a teacher (attribution
 *               only — it grants nothing, DOMAIN_MODEL.md §13.2);
 *   `sort`      `level` (beginner, intermediate, advanced, then unstated;
 *               within a level the latest publication first), `newest` (the
 *               latest publication first) or `title` (A–Z by the title a
 *               reader of `titleLocale` is shown). Every order ends on the
 *               slug and the identifier, so it is total.
 *
 * NOTHING HERE IS PRIVATE: no learner, enrolment, progress, request, class or
 * lesson body. A card is the catalogue's own `CourseListing`.
 */

export const TOPIC_COURSES_PAGE = 12;

/** How many LearningPaths a Topic's hub names at once. */
export const TOPIC_COURSE_PATHS = 6;

export const TOPIC_COURSE_SORTS = Object.freeze(['level', 'newest', 'title'] as const);
export type TopicCourseSort = (typeof TOPIC_COURSE_SORTS)[number];
export const topicCourseSortSchema = z.enum(TOPIC_COURSE_SORTS);

export const topicCourseQuerySchema = z
  .object({
    topic: learningIdSchema.nullable().default(null),
    format: courseFormatSchema.nullable().default(null),
    level: courseLevelSchema.nullable().default(null),
    language: learningLanguageCodeSchema.nullable().default(null),
    teacher: learningIdSchema.nullable().default(null),
    sort: topicCourseSortSchema.default('level'),
    titleLocale: localeSchema.nullable().default(null),
    offset: z.number().int().min(0).max(25_000).default(0),
    limit: z.number().int().min(1).max(TOPIC_COURSES_PAGE).default(TOPIC_COURSES_PAGE),
  })
  .strict();

export type TopicCourseQuery = z.infer<typeof topicCourseQuerySchema>;

/** One page of a Topic's published Courses, with how many the query admits. */
export interface TopicCoursePage {
  readonly items: readonly CourseListing[];
  readonly total: number;
  readonly hasMore: boolean;
}

/** One facet value and how many Courses choosing it would show. */
export interface TopicCourseFacet {
  readonly id: string;
  readonly courses: number;
}

export interface TopicCourseFacetPage {
  readonly items: readonly TopicCourseFacet[];
  readonly hasMore: boolean;
}

/**
 * The aggregates a Topic's course hub is navigated by — each ONE grouped,
 * bounded read counting published Courses on the Topic:
 *
 *   `hub`        the whole set, unfiltered: Courses, those taught live and
 *                self-paced, their lessons, the distinct People attributed as
 *                teachers and the distinct content languages;
 *   `formats`    the set under every filter but the format;
 *   `levels`     stated level → Courses, without the level filter;
 *   `languages`  content language → Courses, without the language filter;
 *   `teachers`   Person → Courses, without the teacher filter.
 */
export interface TopicCourseFacets {
  readonly hub: {
    readonly courses: number;
    readonly live: number;
    readonly selfPaced: number;
    readonly lessons: number;
    readonly teachers: number;
    readonly languages: number;
  };
  readonly formats: {
    readonly all: number;
    readonly live: number;
    readonly selfPaced: number;
  };
  readonly levels: {
    readonly beginner: number;
    readonly intermediate: number;
    readonly advanced: number;
  };
  readonly languages: TopicCourseFacetPage;
  readonly teachers: TopicCourseFacetPage;
}

/**
 * The PUBLISHED LearningPaths holding at least one published Course on the
 * Topic — the latest publication first, as the paths catalogue orders them —
 * at most `TOPIC_COURSE_PATHS`. A path's own count is of its published
 * Courses, on any Topic, as every public path card counts them.
 */
export type TopicCoursePaths = readonly PathListing[];
