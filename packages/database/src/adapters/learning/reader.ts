import 'server-only';

import type { Locale } from '@minhaj/contracts';
import {
  LEARNING_FACET_PAGE,
  LEARNING_PAGE,
  type LearningPublicReaderPort,
} from '@minhaj/contracts/learning';

import { getDatabaseClient } from '../../client.ts';
import {
  COURSE_DETAIL_SELECT,
  COURSE_LISTING_SELECT,
  coursePage,
  DESCRIBED_LABELS,
  describedLabelsOf,
  outlineOf,
  PATH_SELECT,
  pathPage,
  PUBLIC_PATH_LISTING_SELECT,
  toCourseDetail,
  toPathDetail,
} from './records.ts';
import { bounded, boundedOffset, PUBLISHED, stampOf, TARGET_BATCH } from './shared.ts';

/**
 * The Learning public reader — the catalogue as anybody may see it
 * (ROUTE_MAP.md §3.5).
 *
 * ONE PUBLIC PREDICATE, applied IN THE QUERY: a Course or a LearningPath is
 * public when it is `published`, and a path shows only its published Courses —
 * which the database already guarantees, and which every read here states
 * again so the guarantee is never the only thing standing between a draft and
 * the page. Listing, detail, redirect, sitemap and search all compose the same
 * predicate, so no two can disagree about what exists.
 *
 * NO ACTOR AND NOTHING PRIVATE. No method takes an account, returns a lesson
 * body or touches an Enrolment, Progress row or trial request: the public
 * pages are built on this port and cannot render a learner's state by
 * forgetting a check.
 */

/**
 * Newest publication first. `publishedAt` is set whenever a Course or path is
 * published, and the slug — unique — makes the order total.
 */
const LATEST = [{ publishedAt: 'desc' }, { slug: 'asc' }, { id: 'asc' }] as const;

/** A sitemap read's own ceiling, whatever the caller asks for. */
const SITEMAP_MAX = 5_000;

export function createLearningPublicReader(): LearningPublicReaderPort {
  const db = getDatabaseClient();

  return {
    async courses(query) {
      const rows = await db.course.findMany({
        where: {
          // The filters NARROW the public predicate; none of them can widen
          // it, and a value nothing carries is an empty page, never a broader
          // one.
          ...PUBLISHED,
          ...(query.level === null ? {} : { level: query.level }),
          ...(query.format === null ? {} : { format: query.format }),
          ...(query.language === null ? {} : { languageCode: query.language }),
          ...(query.topic === null ? {} : { topics: { some: { topicId: query.topic } } }),
          ...(query.teacher === null
            ? {}
            : { teachers: { some: { personId: query.teacher } } }),
        },
        select: COURSE_LISTING_SELECT,
        orderBy: [...LATEST],
        skip: boundedOffset(query.offset),
        take: LEARNING_PAGE + 1,
      });
      return coursePage(rows);
    },

    async course(slug) {
      const row = await db.course.findFirst({
        where: { slug, ...PUBLISHED },
        select: COURSE_DETAIL_SELECT,
      });
      return row === null ? null : toCourseDetail(row);
    },

    /**
     * A former slug resolves to the CURRENT one in one hop: the history holds
     * every slug a Course ever had, the current one included, each pointing at
     * the Course itself — never at another history row, so there is no chain
     * to follow after two renames.
     */
    async courseCanonicalSlug(slug) {
      const row = await db.courseSlugHistory.findFirst({
        where: { slug, course: PUBLISHED },
        select: { course: { select: { slug: true } } },
      });
      return row?.course.slug ?? null;
    },

    /** Public attribution counted over published Courses only. Grants nothing. */
    async teacherFacets(offset) {
      const rows = await db.courseTeacher.groupBy({
        by: ['personId'],
        where: { course: PUBLISHED },
        _count: { courseId: true },
        orderBy: [{ _count: { courseId: 'desc' } }, { personId: 'asc' }],
        skip: boundedOffset(offset),
        take: LEARNING_FACET_PAGE + 1,
      });
      return {
        items: rows
          .slice(0, LEARNING_FACET_PAGE)
          .map((row) => ({ id: row.personId, courses: row._count.courseId })),
        hasMore: rows.length > LEARNING_FACET_PAGE,
      };
    },

    async paths(offset) {
      const rows = await db.learningPath.findMany({
        where: PUBLISHED,
        select: PUBLIC_PATH_LISTING_SELECT,
        orderBy: [...LATEST],
        skip: boundedOffset(offset),
        take: LEARNING_PAGE + 1,
      });
      return pathPage(rows);
    },

    async path(slug) {
      const row = await db.learningPath.findFirst({
        where: { slug, ...PUBLISHED },
        select: {
          ...PATH_SELECT,
          labels: DESCRIBED_LABELS,
          courses: {
            where: { course: PUBLISHED },
            select: { course: { select: COURSE_LISTING_SELECT } },
            orderBy: [{ position: 'asc' }, { courseId: 'asc' }],
          },
        },
      });
      return row === null ? null : toPathDetail(row);
    },

    async pathCanonicalSlug(slug) {
      const row = await db.learningPathSlugHistory.findFirst({
        where: { slug, path: PUBLISHED },
        select: { path: { select: { slug: true } } },
      });
      return row?.path.slug ?? null;
    },

    async sitemap(kind, offset, limit) {
      const window = {
        orderBy: [{ slug: 'asc' as const }, { id: 'asc' as const }],
        skip: boundedOffset(offset),
        take: bounded(limit, SITEMAP_MAX),
      };
      const select = {
        slug: true,
        updatedAt: true,
        labels: { select: { locale: true }, orderBy: { locale: 'asc' as const } },
      };
      const rows =
        kind === 'course'
          ? await db.course.findMany({ where: PUBLISHED, select, ...window })
          : await db.learningPath.findMany({ where: PUBLISHED, select, ...window });
      return rows.map((row) => ({
        slug: row.slug,
        locales: row.labels.map((label) => label.locale),
        updatedAt: row.updatedAt,
      }));
    },

    /**
     * What Search may know about one public Course: its words, content
     * language, topics and public syllabus. Never a lesson body and never a
     * teacher — a person is found as a Person result.
     */
    async searchCourse(id) {
      const row = await db.course.findFirst({
        where: { id, ...PUBLISHED },
        select: {
          id: true,
          version: true,
          updatedAt: true,
          primaryLocale: true,
          languageCode: true,
          labels: COURSE_DETAIL_SELECT.labels,
          topics: COURSE_DETAIL_SELECT.topics,
          modules: COURSE_DETAIL_SELECT.modules,
        },
      });
      if (row === null) return null;
      return {
        id: row.id,
        stamp: stampOf(row),
        primaryLocale: row.primaryLocale as Locale,
        labels: describedLabelsOf(row.labels),
        outline: outlineOf(row.modules),
        languageCode: row.languageCode,
        topicIds: row.topics.map((entry) => entry.topicId),
      };
    },

    async searchCourses({ after, limit }) {
      const rows = await db.course.findMany({
        where: { ...PUBLISHED, ...(after === null ? {} : { id: { gt: after } }) },
        select: { id: true, version: true, updatedAt: true },
        orderBy: { id: 'asc' },
        take: bounded(limit, TARGET_BATCH),
      });
      return rows.map((row) => ({ id: row.id, stamp: stampOf(row) }));
    },

    async publicCourseTargets(ids) {
      if (ids.length === 0) return [];
      if (ids.length > TARGET_BATCH)
        throw new Error('Learning search batch exceeds its bound.');
      return db.course.findMany({
        where: { id: { in: [...new Set(ids)] }, ...PUBLISHED },
        select: { id: true, slug: true },
        orderBy: { id: 'asc' },
      });
    },

    async searchPath(id) {
      const row = await db.learningPath.findFirst({
        where: { id, ...PUBLISHED },
        select: {
          id: true,
          version: true,
          updatedAt: true,
          primaryLocale: true,
          labels: DESCRIBED_LABELS,
        },
      });
      if (row === null) return null;
      return {
        id: row.id,
        stamp: stampOf(row),
        primaryLocale: row.primaryLocale as Locale,
        labels: describedLabelsOf(row.labels),
      };
    },

    async searchPaths({ after, limit }) {
      const rows = await db.learningPath.findMany({
        where: { ...PUBLISHED, ...(after === null ? {} : { id: { gt: after } }) },
        select: { id: true, version: true, updatedAt: true },
        orderBy: { id: 'asc' },
        take: bounded(limit, TARGET_BATCH),
      });
      return rows.map((row) => ({ id: row.id, stamp: stampOf(row) }));
    },

    async publicPathTargets(ids) {
      if (ids.length === 0) return [];
      if (ids.length > TARGET_BATCH)
        throw new Error('Learning search batch exceeds its bound.');
      return db.learningPath.findMany({
        where: { id: { in: [...new Set(ids)] }, ...PUBLISHED },
        select: { id: true, slug: true },
        orderBy: { id: 'asc' },
      });
    },
  };
}
