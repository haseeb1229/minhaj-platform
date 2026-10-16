import { z } from 'zod';

import { localeSchema, type Locale } from '../env/shared.ts';

/**
 * Learning — Course, CourseModule, Lesson, LearningPath, Enrolment, Progress and
 * the request side of TrialClassRequest (DOMAIN_MODEL.md §13, DELIVERY_PLAN.md
 * Phase 22).
 *
 * WHAT PHASE 22 IS, AND WHAT IT IS NOT. A public catalogue of Courses and
 * LearningPaths, a signed-in person's own Enrolments and lesson Progress, and a
 * signed-in person's REQUEST for a trial class. Nothing here schedules, confirms
 * or books anything: there is no ClassSession, Availability, Attendance,
 * Booking, meeting provider or meeting address, and no teacher authority
 * (Phase 23). A Course's teachers are PUBLIC ATTRIBUTION — typed People
 * references — and confer nothing on anybody (DOMAIN_MODEL.md §13.2).
 *
 * NO CERTIFICATE, ASSESSMENT, PRICE OR ENTITLEMENT. A Course is studied, not
 * bought, graded or certified; none of those concepts has an owner contract.
 *
 * PLAIN TEXT ONLY. Every text field — a lesson's body included — is plain text
 * rendered as text nodes, so there is no markup to sanitise and no address a
 * lesson can smuggle into the page.
 */

export const learningIdSchema = z.uuid();

/** An account id as Identity issues it — opaque here, never parsed. */
export const learningAccountIdSchema = z.string().min(1).max(36);

export const learningVersionSchema = z.number().int().positive().max(2_147_483_646);

/**
 * The words Learn's own routes use beside a slug (ROUTE_MAP.md §3.5). A Course
 * or LearningPath slug can never be one of them — refused here and by a SQL
 * CHECK on the record and on its slug history — so no future Learn surface is
 * ever shadowed by a catalogue entry that claimed its word first.
 */
export const LEARNING_RESERVED_SLUGS = Object.freeze([
  'courses',
  'paths',
  'live',
  'trial',
  'training',
  'resources',
  'teachers',
] as const);

/** One slug grammar for Courses and LearningPaths, each with its own namespace. */
export const learningSlugSchema = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .refine(
    (slug) => !(LEARNING_RESERVED_SLUGS as readonly string[]).includes(slug),
    'That slug is reserved.',
  );

/**
 * The smallest lifecycle the catalogue needs: Learning has no review step, so
 * there is no workflow to import (DOMAIN_MODEL.md §19.2 is Editorial's).
 */
export const LEARNING_STATES = Object.freeze(['draft', 'published', 'archived'] as const);
export type LearningState = (typeof LEARNING_STATES)[number];
export const learningStateSchema = z.enum(LEARNING_STATES);

/**
 * WHO A COURSE IS PITCHED AT — Learning's own catalogue facet behind `?level=`
 * (ROUTE_MAP.md §3.5), not an external scholarly classification. Three values,
 * because three is what a learner can choose between without a glossary.
 * `null` is an honest "not stated": a Course is never forced into a level.
 */
export const COURSE_LEVELS = Object.freeze([
  'beginner',
  'intermediate',
  'advanced',
] as const);
export type CourseLevel = (typeof COURSE_LEVELS)[number];
export const courseLevelSchema = z.enum(COURSE_LEVELS);

/**
 * HOW A COURSE IS STUDIED — the facet behind `?format=`. `self-paced`: the
 * learner works through the lessons alone. `live`: the Course is taught in
 * classes with a teacher, its lessons the syllabus. Only a `live` Course takes
 * trial-class requests; the classes themselves are Phase 23's.
 */
export const COURSE_FORMATS = Object.freeze(['self-paced', 'live'] as const);
export type CourseFormat = (typeof COURSE_FORMATS)[number];
export const courseFormatSchema = z.enum(COURSE_FORMATS);

/** Every bound in one place, each enforced again by a SQL CHECK or column size. */
export const LEARNING_LIMITS = Object.freeze({
  title: 240,
  summary: 1000,
  description: 8000,
  lessonBody: 20_000,
  topics: 12,
  teachers: 6,
  /** Modules in one Course. */
  modules: 20,
  /** Lessons in one module. */
  lessons: 30,
  /** Courses in one LearningPath. */
  pathCourses: 30,
});

/** One public or administrative listing page. */
export const LEARNING_PAGE = 24;

/** One page of the teacher facet. */
export const LEARNING_FACET_PAGE = 50;

/** A content-language reference, in the shape Taxonomy's `Language.code` takes. */
export const learningLanguageCodeSchema = z
  .string()
  .min(2)
  .max(16)
  .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/);

const text = (max: number) => z.string().trim().max(max);

const ids = (max: number) =>
  z
    .array(learningIdSchema)
    .max(max)
    .refine((values) => new Set(values).size === values.length);

/** Each locale at most once, and the primary one present. */
function primaryLabelled(
  value: {
    readonly primaryLocale: Locale;
    readonly labels: readonly { locale: Locale }[];
  },
  ctx: z.RefinementCtx,
): void {
  if (
    !value.labels.some((label) => label.locale === value.primaryLocale) ||
    new Set(value.labels.map((label) => label.locale)).size !== value.labels.length
  ) {
    ctx.addIssue({
      code: 'custom',
      message: 'A unique primary locale label is required.',
    });
  }
}

/** Each locale at most once. Whether the Course's primary one is present is checked at publication. */
function uniqueLocales(
  labels: readonly { locale: Locale }[],
  ctx: z.RefinementCtx,
): void {
  if (new Set(labels.map((label) => label.locale)).size !== labels.length)
    ctx.addIssue({ code: 'custom', message: 'Each locale may be labelled once.' });
}

/* ===========================================================================
 * Labels — localized descriptive text, never a translation of the content
 * ========================================================================= */

const courseLabelSchema = z
  .object({
    locale: localeSchema,
    title: text(LEARNING_LIMITS.title).min(1),
    summary: text(LEARNING_LIMITS.summary),
    description: text(LEARNING_LIMITS.description),
  })
  .strict();
export type CourseLabel = z.infer<typeof courseLabelSchema>;

const outlineLabelSchema = z
  .object({
    locale: localeSchema,
    title: text(LEARNING_LIMITS.title).min(1),
    summary: text(LEARNING_LIMITS.summary),
  })
  .strict();
/** A module's or a lesson's title and summary in one locale — the public syllabus. */
export type OutlineLabel = z.infer<typeof outlineLabelSchema>;

const lessonLabelSchema = outlineLabelSchema
  .extend({ body: text(LEARNING_LIMITS.lessonBody) })
  .strict();
/** A lesson's syllabus words plus its body — which only an enrolled learner reads. */
export type LessonLabel = z.infer<typeof lessonLabelSchema>;

const pathLabelSchema = courseLabelSchema;
export type PathLabel = CourseLabel;

/* ===========================================================================
 * Administrative inputs
 * ========================================================================= */

/**
 * A Course's catalogue facts as an operator saves them. The lifecycle is NOT
 * here: publishing, returning to draft and archiving are their own named acts
 * (`courseTransitionSchema`), each with its own invariant. A new Course starts
 * as a draft.
 */
export const courseInputSchema = z
  .object({
    slug: learningSlugSchema,
    primaryLocale: localeSchema,
    level: courseLevelSchema.nullable(),
    format: courseFormatSchema,
    languageCode: learningLanguageCodeSchema,
    labels: z.array(courseLabelSchema).min(1).max(3),
    topicIds: ids(LEARNING_LIMITS.topics),
    /** Public attribution to published People, in display order. Grants nothing. */
    teacherIds: ids(LEARNING_LIMITS.teachers),
  })
  .strict()
  .superRefine(primaryLabelled);

export type CourseValue = z.output<typeof courseInputSchema>;

/** Where a Course or a LearningPath may be moved to. */
export const learningTransitionSchema = learningStateSchema;

const outlineLabelsSchema = z
  .array(outlineLabelSchema)
  .min(1)
  .max(3)
  .superRefine(uniqueLocales);
const lessonLabelsSchema = z
  .array(lessonLabelSchema)
  .min(1)
  .max(3)
  .superRefine(uniqueLocales);

const direction = z.enum(['earlier', 'later']);

/**
 * One named change to a Course's modules.
 *
 * NAMED CHANGES, NOT A LIST THE BROWSER SUPPLIES, applied to the outline the
 * operator was shown — the Course's expected version — and ONLY while the
 * Course is a draft: a published outline is frozen, so the public never sees a
 * half-built one.
 */
export const moduleChangeSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), labels: outlineLabelsSchema }).strict(),
  z
    .object({
      op: z.literal('edit'),
      moduleId: learningIdSchema,
      labels: outlineLabelsSchema,
    })
    .strict(),
  z.object({ op: z.literal('remove'), moduleId: learningIdSchema }).strict(),
  z.object({ op: z.literal('move'), moduleId: learningIdSchema, direction }).strict(),
]);
export type ModuleChange = z.infer<typeof moduleChangeSchema>;

/** One named change to a Course's lessons, by the same rules. A lesson never changes module. */
export const lessonChangeSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal('add'),
      moduleId: learningIdSchema,
      labels: lessonLabelsSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal('edit'),
      lessonId: learningIdSchema,
      labels: lessonLabelsSchema,
    })
    .strict(),
  z.object({ op: z.literal('remove'), lessonId: learningIdSchema }).strict(),
  z.object({ op: z.literal('move'), lessonId: learningIdSchema, direction }).strict(),
]);
export type LessonChange = z.infer<typeof lessonChangeSchema>;

export const pathInputSchema = z
  .object({
    slug: learningSlugSchema,
    primaryLocale: localeSchema,
    labels: z.array(pathLabelSchema).min(1).max(3),
  })
  .strict()
  .superRefine(primaryLabelled);

export type PathValue = z.output<typeof pathInputSchema>;

/** One named change to a LearningPath's ordered Courses. */
export const pathChangeSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), courseId: learningIdSchema }).strict(),
  z.object({ op: z.literal('remove'), courseId: learningIdSchema }).strict(),
  z.object({ op: z.literal('move'), courseId: learningIdSchema, direction }).strict(),
]);
export type PathChange = z.infer<typeof pathChangeSchema>;

/* ===========================================================================
 * Queries
 * ========================================================================= */

/**
 * The public Course catalogue's filters (ROUTE_MAP.md §3.5: topic, level,
 * language, format, teacher). Each NARROWS the public predicate and none can
 * widen it. `teacher` is a People identifier: Layer 4 resolves the People slug
 * in the address, so Learning never reads People.
 */
export const courseQuerySchema = z
  .object({
    offset: z.number().int().min(0).max(25_000).default(0),
    topic: learningIdSchema.nullable().default(null),
    level: courseLevelSchema.nullable().default(null),
    language: learningLanguageCodeSchema.nullable().default(null),
    format: courseFormatSchema.nullable().default(null),
    teacher: learningIdSchema.nullable().default(null),
  })
  .strict();

export type CourseQuery = z.infer<typeof courseQuerySchema>;

/** An administrative directory's filters: a state and a bounded text match. */
export const learningAdminQuerySchema = z
  .object({
    offset: z.number().int().min(0).max(25_000).default(0),
    state: learningStateSchema.nullable().default(null),
    text: z.string().trim().max(200).nullable().default(null),
  })
  .strict();

export type LearningAdminQuery = z.infer<typeof learningAdminQuerySchema>;

/* ===========================================================================
 * Records
 * ========================================================================= */

/** One card: catalogue facts and counts, never a description or a lesson. */
export interface CourseListing {
  readonly id: string;
  readonly slug: string;
  readonly primaryLocale: Locale;
  readonly state: LearningState;
  readonly level: CourseLevel | null;
  readonly format: CourseFormat;
  /** The CONTENT language, a Taxonomy reference. Never the interface locale. */
  readonly languageCode: string;
  readonly labels: readonly OutlineLabel[];
  readonly teacherIds: readonly string[];
  readonly modules: number;
  readonly lessons: number;
  readonly version: number;
  readonly updatedAt: Date;
}

export interface CoursePage {
  readonly items: readonly CourseListing[];
  readonly hasMore: boolean;
}

/** A lesson as the syllabus names it: no body. */
export interface LessonOutline {
  readonly id: string;
  readonly position: number;
  readonly labels: readonly OutlineLabel[];
}

export interface ModuleOutline {
  readonly id: string;
  readonly position: number;
  readonly labels: readonly OutlineLabel[];
  readonly lessons: readonly LessonOutline[];
}

/**
 * One Course with its full description and syllabus — what the public detail
 * page, an enrolled learner and the administrative editor all read. Lesson
 * BODIES are never part of it.
 */
export interface CourseDetail extends Omit<CourseListing, 'labels'> {
  readonly labels: readonly CourseLabel[];
  readonly topicIds: readonly string[];
  readonly outline: readonly ModuleOutline[];
}

/** One lesson with its body. */
export interface LessonRecord {
  readonly id: string;
  readonly courseId: string;
  readonly moduleId: string;
  readonly position: number;
  readonly labels: readonly LessonLabel[];
}

export interface TeacherFacet {
  readonly id: string;
  readonly courses: number;
}

export interface TeacherFacetPage {
  readonly items: readonly TeacherFacet[];
  readonly hasMore: boolean;
}

export interface PathListing {
  readonly id: string;
  readonly slug: string;
  readonly primaryLocale: Locale;
  readonly state: LearningState;
  readonly labels: readonly OutlineLabel[];
  readonly courses: number;
  readonly version: number;
  readonly updatedAt: Date;
}

export interface PathPage {
  readonly items: readonly PathListing[];
  readonly hasMore: boolean;
}

/** A LearningPath with its description and its ordered Courses. */
export interface PathDetail extends Omit<PathListing, 'labels'> {
  readonly labels: readonly PathLabel[];
  readonly members: readonly CourseListing[];
}

export interface LearningSitemapRow {
  readonly slug: string;
  /** The interface locales the record genuinely has words in. */
  readonly locales: readonly string[];
  readonly updatedAt: Date;
}

/**
 * What Search may know about one public Course: its words, content language,
 * topics and the public syllabus (module and lesson titles and summaries).
 * Never a lesson body — that is enrolled learners' — and never a teacher's name:
 * a person is found as a Person result.
 */
export interface CourseSearchRecord {
  readonly id: string;
  /** Opaque; moves whenever anything this projection reads moves. */
  readonly stamp: string;
  readonly primaryLocale: Locale;
  readonly labels: readonly CourseLabel[];
  readonly outline: readonly ModuleOutline[];
  readonly languageCode: string;
  readonly topicIds: readonly string[];
}

/** What Search may know about one public LearningPath: its own words. */
export interface PathSearchRecord {
  readonly id: string;
  readonly stamp: string;
  readonly primaryLocale: Locale;
  readonly labels: readonly PathLabel[];
}

/* ---- Administrative summaries — counts, never a person ------------------ */

/**
 * How many accounts are enrolled on one Course and how many have completed
 * every current lesson. COUNTS ONLY: no Learning permission reveals who.
 */
export interface EnrolmentSummary {
  readonly course: CourseListing;
  readonly learners: number;
  readonly completed: number;
}

export interface EnrolmentSummaryPage {
  readonly items: readonly EnrolmentSummary[];
  readonly hasMore: boolean;
}

/** How many trial-class requests one live Course holds, and the oldest. Counts only. */
export interface TrialSummary {
  readonly course: CourseListing;
  readonly requests: number;
  readonly oldest: Date | null;
}

export interface TrialSummaryPage {
  readonly items: readonly TrialSummary[];
  readonly hasMore: boolean;
}

/* ---- A learner's own state ---------------------------------------------- */

/**
 * One of a person's Enrolments. The Course is shown in whatever state it is in
 * now: a Course returned to draft or archived is `available: false`, and the
 * learner's Progress on it is kept, not deleted.
 */
export interface LearnerCourseSummary {
  readonly course: CourseListing;
  readonly available: boolean;
  readonly enrolledAt: Date;
  readonly completedLessons: number;
}

export interface LearnerCoursePage {
  readonly items: readonly LearnerCourseSummary[];
  readonly hasMore: boolean;
}

/** One enrolled Course with the learner's completed lessons. */
export interface LearnerCourse {
  readonly course: CourseDetail;
  readonly available: boolean;
  readonly enrolledAt: Date;
  readonly completedLessonIds: readonly string[];
}

/** One Course of a path, as one learner stands on it. */
export interface LearnerPathCourse {
  readonly course: CourseListing;
  readonly enrolled: boolean;
  readonly completedLessons: number;
}

/**
 * A published LearningPath as one learner stands on it — DERIVED from that
 * learner's own Course Enrolments and Progress. There is no PathEnrolment.
 */
export interface LearnerPath {
  readonly path: PathListing;
  readonly courses: readonly LearnerPathCourse[];
}

/** What the private island on a public Course page may show the signed-in visitor. */
export interface LearnerCourseState {
  readonly enrolled: boolean;
  readonly trialRequested: boolean;
}

/**
 * A person's request for a trial class on one live Course. A REQUEST ONLY: it
 * reserves no teacher, names no time, creates no booking or class and confers
 * no enrolment. Confirmation is Phase 23's, as its own aggregate.
 */
export interface TrialRequestRecord {
  readonly id: string;
  readonly course: CourseListing;
  readonly requestedAt: Date;
  /**
   * Phase 23: the Booking that confirmed this request, if one exists. A
   * confirmed request is no longer withdrawn by deletion — its class is
   * cancelled from My Classes — and the trial's session is linked there.
   */
  readonly booking: {
    readonly id: string;
    readonly sessionId: string;
    readonly state: 'confirmed' | 'cancelled' | 'completed';
  } | null;
}

/** Course progress, derived: every current lesson completed is a completed Course. */
export function courseCompleted(completedLessons: number, lessons: number): boolean {
  return lessons > 0 && completedLessons >= lessons;
}

/* ===========================================================================
 * Export and disposition
 * ========================================================================= */

export const LEARNING_EXPORT_SCHEMA = 'minhaj.learning.export';
export const LEARNING_EXPORT_VERSION = 2;

/**
 * A person's own Learning data, by typed identifier — never a Course's words or
 * a lesson's body, which are the catalogue's and public or re-readable.
 */
export interface LearningExport {
  readonly schema: typeof LEARNING_EXPORT_SCHEMA;
  readonly version: typeof LEARNING_EXPORT_VERSION;
  readonly generatedAt: string;
  readonly enrolments: readonly {
    readonly courseId: string;
    readonly courseSlug: string;
    readonly enrolledAt: string;
  }[];
  readonly progress: readonly {
    readonly courseId: string;
    readonly lessonId: string;
    readonly completedAt: string;
  }[];
  readonly trialRequests: readonly {
    readonly id: string;
    readonly courseId: string;
    readonly requestedAt: string;
  }[];
  /**
   * Phase 23 — the person's own classes, by typed identifier: their trial
   * Bookings, the sessions they took part in (as a learner or, if they teach,
   * as the teacher), their own Attendance, their own Availability and their
   * teaching scopes. NEVER another participant, and NEVER a meeting address.
   */
  readonly bookings: readonly {
    readonly id: string;
    readonly requestId: string;
    readonly courseId: string;
    readonly sessionId: string;
    readonly state: 'confirmed' | 'cancelled' | 'completed';
    readonly confirmedAt: string;
    readonly cancelledAt: string | null;
  }[];
  readonly classes: readonly {
    readonly sessionId: string;
    readonly courseId: string;
    readonly kind: 'course' | 'trial';
    readonly startsAt: string;
    readonly endsAt: string;
    readonly timeZone: string;
    readonly state: 'scheduled' | 'completed' | 'cancelled';
    readonly participation: 'enrolment' | 'booking' | 'teacher';
  }[];
  readonly attendance: readonly {
    readonly sessionId: string;
    readonly status: 'present' | 'absent';
    readonly markedAt: string;
  }[];
  readonly availability: readonly {
    readonly id: string;
    readonly startsAt: string;
    readonly endsAt: string;
    readonly timeZone: string;
    readonly state: 'open' | 'withdrawn';
  }[];
  readonly teachingScopes: readonly {
    readonly id: string;
    readonly courseId: string;
    readonly grantedAt: string;
    readonly endedAt: string | null;
  }[];
}

/** How far one disposition got. `complete: false` is honest pending work. */
export interface LearningDispositionProgress {
  readonly removed: number;
  readonly complete: boolean;
}

/* ===========================================================================
 * Pure helpers
 * ========================================================================= */

/**
 * A LearningPath's new ordered Courses after one change, or the reason it
 * cannot apply. PURE, so the rule is proved without a database: adding a member
 * already present is a duplicate, removing or moving an absent one is invalid,
 * and moving past either end is a refused no-op.
 */
export function applyPathChange(
  current: readonly string[],
  change: PathChange,
): { readonly courseIds: readonly string[] } | { readonly refusal: string } {
  const index = current.indexOf(change.courseId);
  switch (change.op) {
    case 'add':
      if (index !== -1) return { refusal: 'duplicate-member' };
      if (current.length >= LEARNING_LIMITS.pathCourses) return { refusal: 'limit' };
      return { courseIds: [...current, change.courseId] };
    case 'remove':
      if (index === -1) return { refusal: 'invalid' };
      return { courseIds: current.filter((id) => id !== change.courseId) };
    case 'move': {
      if (index === -1) return { refusal: 'invalid' };
      const target = change.direction === 'earlier' ? index - 1 : index + 1;
      if (target < 0 || target >= current.length) return { refusal: 'invalid' };
      const next = [...current];
      next[index] = current[target] ?? change.courseId;
      next[target] = change.courseId;
      return { courseIds: next };
    }
  }
}
