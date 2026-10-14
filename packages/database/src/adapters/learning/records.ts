import 'server-only';

import type { Prisma } from '@prisma/client';

import type { Locale } from '@minhaj/contracts';
import {
  LEARNING_PAGE,
  type CourseDetail,
  type CourseFormat,
  type CourseLabel,
  type CourseLevel,
  type CourseListing,
  type CoursePage,
  type LearningState,
  type ModuleOutline,
  type OutlineLabel,
  type PathDetail,
  type PathListing,
  type PathPage,
} from '@minhaj/contracts/learning';

import { PUBLISHED, type Client } from './shared.ts';

/**
 * How Learning's records are read and shaped — one definition of a card, a
 * syllabus and a path, used by the catalogue, the public reader and the
 * learner's own surface alike, so no two can disagree about what a listing
 * carries or leak what another withholds.
 *
 * NO LESSON BODY IS SELECTED HERE. A card, a Course page and a syllabus carry a
 * lesson's title and summary only; the body is read by exactly two named
 * queries elsewhere — the administrative editor's and an enrolled learner's —
 * so a public read cannot return one by forgetting a field.
 *
 * NO N+1. Labels, teachers, module counts and lesson counts are selected with
 * the page: Prisma batches each relation level into one statement for the
 * whole page, never one per row.
 */

/* ===========================================================================
 * Query fragments
 * ========================================================================= */

const BY_LOCALE = { locale: 'asc' } as const;
const BY_POSITION = [{ position: 'asc' }, { id: 'asc' }] as const;

/** A title and a summary per locale — the public syllabus words. */
export const OUTLINE_LABELS = {
  select: { locale: true, title: true, summary: true },
  orderBy: BY_LOCALE,
} as const;

/** Title, summary and description per locale — a Course's or a path's own words. */
export const DESCRIBED_LABELS = {
  select: { locale: true, title: true, summary: true, description: true },
  orderBy: BY_LOCALE,
} as const;

const TEACHERS = {
  select: { personId: true },
  orderBy: [{ position: 'asc' }, { personId: 'asc' }],
} satisfies Prisma.Course$teachersArgs;

/**
 * What a card needs: the catalogue facts, the words of its title and summary,
 * and its counts. Each module's lesson count rides with the module, so the
 * card's lesson total is summed from the same statement — at most twenty
 * modules a Course, by CHECK.
 */
export const COURSE_LISTING_SELECT = {
  id: true,
  slug: true,
  primaryLocale: true,
  state: true,
  level: true,
  format: true,
  languageCode: true,
  version: true,
  updatedAt: true,
  labels: OUTLINE_LABELS,
  teachers: TEACHERS,
  modules: { select: { _count: { select: { lessons: true } } } },
} satisfies Prisma.CourseSelect;

/** One Course with its description and its syllabus — titles and summaries only. */
export const COURSE_DETAIL_SELECT = {
  id: true,
  slug: true,
  primaryLocale: true,
  state: true,
  level: true,
  format: true,
  languageCode: true,
  version: true,
  updatedAt: true,
  labels: DESCRIBED_LABELS,
  teachers: TEACHERS,
  topics: { select: { topicId: true }, orderBy: { topicId: 'asc' } },
  modules: {
    select: {
      id: true,
      position: true,
      labels: OUTLINE_LABELS,
      lessons: {
        select: { id: true, position: true, labels: OUTLINE_LABELS },
        orderBy: [...BY_POSITION],
      },
    },
    orderBy: [...BY_POSITION],
  },
} satisfies Prisma.CourseSelect;

export const PATH_SELECT = {
  id: true,
  slug: true,
  primaryLocale: true,
  state: true,
  version: true,
  updatedAt: true,
} satisfies Prisma.LearningPathSelect;

/** A public card counts only the Courses a public reader could open. */
export const PUBLIC_PATH_LISTING_SELECT = {
  ...PATH_SELECT,
  labels: OUTLINE_LABELS,
  _count: { select: { courses: { where: { course: PUBLISHED } } } },
} satisfies Prisma.LearningPathSelect;

export const PATH_LISTING_SELECT = {
  ...PATH_SELECT,
  labels: OUTLINE_LABELS,
  _count: { select: { courses: true } },
} satisfies Prisma.LearningPathSelect;

/* ===========================================================================
 * Row shapes — stated structurally, so no Prisma type crosses a boundary
 * ========================================================================= */

interface OutlineLabelRow {
  readonly locale: string;
  readonly title: string;
  readonly summary: string;
}

interface DescribedLabelRow extends OutlineLabelRow {
  readonly description: string;
}

interface CourseFacts {
  readonly id: string;
  readonly slug: string;
  readonly primaryLocale: string;
  readonly state: string;
  readonly level: string | null;
  readonly format: string;
  readonly languageCode: string;
  readonly version: number;
  readonly updatedAt: Date;
  readonly teachers: readonly { readonly personId: string }[];
}

export interface CourseListingRow extends CourseFacts {
  readonly labels: readonly OutlineLabelRow[];
  readonly modules: readonly { readonly _count: { readonly lessons: number } }[];
}

interface OutlineRow {
  readonly id: string;
  readonly position: number;
  readonly labels: readonly OutlineLabelRow[];
}

export interface ModuleRow extends OutlineRow {
  readonly lessons: readonly OutlineRow[];
}

export interface CourseDetailRow extends CourseFacts {
  readonly labels: readonly DescribedLabelRow[];
  readonly topics: readonly { readonly topicId: string }[];
  readonly modules: readonly ModuleRow[];
}

interface PathFacts {
  readonly id: string;
  readonly slug: string;
  readonly primaryLocale: string;
  readonly state: string;
  readonly version: number;
  readonly updatedAt: Date;
}

export interface PathListingRow extends PathFacts {
  readonly labels: readonly OutlineLabelRow[];
  readonly _count: { readonly courses: number };
}

/* ===========================================================================
 * Mapping
 * ========================================================================= */

export function outlineLabelsOf(rows: readonly OutlineLabelRow[]): OutlineLabel[] {
  return rows.map((row) => ({
    locale: row.locale as Locale,
    title: row.title,
    summary: row.summary,
  }));
}

export function describedLabelsOf(rows: readonly DescribedLabelRow[]): CourseLabel[] {
  return rows.map((row) => ({
    locale: row.locale as Locale,
    title: row.title,
    summary: row.summary,
    description: row.description,
  }));
}

/** What a card and a detail share: the catalogue facts, without words or counts. */
function facts(row: CourseFacts): Omit<CourseListing, 'labels' | 'modules' | 'lessons'> {
  return {
    id: row.id,
    slug: row.slug,
    primaryLocale: row.primaryLocale as Locale,
    state: row.state as LearningState,
    level: row.level as CourseLevel | null,
    format: row.format as CourseFormat,
    languageCode: row.languageCode,
    teacherIds: row.teachers.map((entry) => entry.personId),
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

export function toCourseListing(row: CourseListingRow): CourseListing {
  return {
    ...facts(row),
    labels: outlineLabelsOf(row.labels),
    modules: row.modules.length,
    lessons: row.modules.reduce((total, module) => total + module._count.lessons, 0),
  };
}

export function outlineOf(modules: readonly ModuleRow[]): ModuleOutline[] {
  return modules.map((module) => ({
    id: module.id,
    position: module.position,
    labels: outlineLabelsOf(module.labels),
    lessons: module.lessons.map((lesson) => ({
      id: lesson.id,
      position: lesson.position,
      labels: outlineLabelsOf(lesson.labels),
    })),
  }));
}

export function toCourseDetail(row: CourseDetailRow): CourseDetail {
  return {
    ...facts(row),
    labels: describedLabelsOf(row.labels),
    topicIds: row.topics.map((entry) => entry.topicId),
    modules: row.modules.length,
    lessons: row.modules.reduce((total, module) => total + module.lessons.length, 0),
    outline: outlineOf(row.modules),
  };
}

export function toPathListing(row: PathListingRow): PathListing {
  return {
    id: row.id,
    slug: row.slug,
    primaryLocale: row.primaryLocale as Locale,
    state: row.state as LearningState,
    labels: outlineLabelsOf(row.labels),
    courses: row._count.courses,
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

export interface PathDetailRow extends PathFacts {
  readonly labels: readonly DescribedLabelRow[];
  readonly courses: readonly { readonly course: CourseListingRow }[];
}

/** A path with its words and its Courses, in the order the read selected them. */
export function toPathDetail(row: PathDetailRow): PathDetail {
  const members = row.courses.map((place) => toCourseListing(place.course));
  return {
    id: row.id,
    slug: row.slug,
    primaryLocale: row.primaryLocale as Locale,
    state: row.state as LearningState,
    labels: describedLabelsOf(row.labels),
    courses: members.length,
    members,
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

/** One page of Course cards from a read of `LEARNING_PAGE + 1` rows. */
export function coursePage(rows: readonly CourseListingRow[]): CoursePage {
  return {
    items: rows.slice(0, LEARNING_PAGE).map(toCourseListing),
    hasMore: rows.length > LEARNING_PAGE,
  };
}

/** One page of path cards from a read of `LEARNING_PAGE + 1` rows. */
export function pathPage(rows: readonly PathListingRow[]): PathPage {
  return {
    items: rows.slice(0, LEARNING_PAGE).map(toPathListing),
    hasMore: rows.length > LEARNING_PAGE,
  };
}

/* ===========================================================================
 * Shared reads
 * ========================================================================= */

/** One Course in any state, with its syllabus, read with the caller's client. */
export async function courseDetail(db: Client, id: string): Promise<CourseDetail | null> {
  const row = await db.course.findFirst({ where: { id }, select: COURSE_DETAIL_SELECT });
  return row === null ? null : toCourseDetail(row);
}

/**
 * Course cards for a set of identifiers, keyed by identifier — the ONE query a
 * summary page needs for every Course it names, whatever order it shows them.
 */
export async function listingsByIds(
  db: Client,
  ids: readonly string[],
): Promise<Map<string, CourseListing>> {
  if (ids.length === 0) return new Map();
  const rows = await db.course.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: COURSE_LISTING_SELECT,
  });
  return new Map(rows.map((row) => [row.id, toCourseListing(row)]));
}
