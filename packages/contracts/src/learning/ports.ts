import type {
  CourseDetail,
  CourseListing,
  CoursePage,
  CourseQuery,
  CourseSearchRecord,
  CourseValue,
  EnrolmentSummaryPage,
  LearnerCourse,
  LearnerCoursePage,
  LearnerCourseState,
  LearnerPath,
  LearningAdminQuery,
  LearningExport,
  LearningSitemapRow,
  LearningState,
  LessonChange,
  LessonRecord,
  ModuleChange,
  PathDetail,
  PathPage,
  PathSearchRecord,
  PathValue,
  TeacherFacetPage,
  TrialRequestRecord,
  TrialSummaryPage,
} from './values.ts';

/**
 * The ports between the Learning context and what it depends on
 * (ARCHITECTURE.md §3.1.1, §4.1).
 *
 * The context lives in `apps/web/src/contexts/learning/` and its adapter in
 * `packages/database/src/adapters/learning/`; neither imports the other, and
 * both import this. Every operation is ONE named act with its own bounds — no
 * repository, no `where`, no transaction handle, no generic page type.
 *
 * FOUR SURFACES, AND THE SPLIT IS A SECURITY BOUNDARY.
 *
 *   - `LearningPublicReaderPort` takes no actor and has no method that returns
 *     a draft, an archived record, a lesson body or anybody's state: the public
 *     Learn pages are built on it and cannot render withheld or private state by
 *     forgetting a check.
 *   - `LearningPersistencePort` is the catalogue's administration, reached only
 *     through the Learning service, which re-checks `learning.read` or
 *     `learning.administer` live on every call. It reads COUNTS of learners,
 *     never a learner.
 *   - `LearnerPort` is a person's OWN Enrolments, Progress and trial requests.
 *     Every method takes the account it acts for, and every query carries that
 *     account in its own predicate — the primary defence against horizontal
 *     escalation (SECURITY_BASELINE.md §3.4 rule 4). No staff key reaches it.
 *   - `LearningExportPort` and `LearningDispositionPort` serve the person's
 *     export and their closed account's disposition, coordinated at Layer 4.
 */

export interface LearningActor {
  readonly accountId: string;
}

/** The ONE thing Learning asks Identity about an operator: does this account hold this permission now? */
export interface LearningAuthorityPort {
  permits(accountId: string, permission: string): Promise<boolean>;
}

/**
 * The questions Learning asks its Layer-1 owners, answered at Layer 4. A teacher
 * must be a published People contributor, a topic an active Taxonomy topic, a
 * content language an active Taxonomy language. Learning never reads those
 * owners' tables and copies none of their words.
 */
export interface LearningReferencesPort {
  validPeople(ids: readonly string[]): Promise<boolean>;
  validTopics(ids: readonly string[]): Promise<boolean>;
  validLanguage(code: string): Promise<boolean>;
}

/** Of the accounts named, those Identity reports CLOSED — the only account fact disposition needs. */
export interface LearningClosedAccountPort {
  closedAccounts(accountIds: readonly string[]): Promise<readonly string[]>;
}

/* ===========================================================================
 * Public reads — published state only
 * ========================================================================= */

export interface LearningPublicReaderPort {
  /** One bounded page of PUBLISHED Courses, narrowed by the filters, latest publication first. */
  courses(query: CourseQuery): Promise<CoursePage>;
  /** One published Course by its CURRENT slug, with its public syllabus. */
  course(slug: string): Promise<CourseDetail | null>;
  /** The current slug a current or FORMER slug of a published Course resolves to. */
  courseCanonicalSlug(slug: string): Promise<string | null>;
  /** The People attributed as teachers on at least one published Course, with counts. */
  teacherFacets(offset: number): Promise<TeacherFacetPage>;

  /** One bounded page of PUBLISHED LearningPaths, latest publication first. */
  paths(offset: number): Promise<PathPage>;
  /** One published LearningPath by its CURRENT slug, with its published Courses in order. */
  path(slug: string): Promise<PathDetail | null>;
  pathCanonicalSlug(slug: string): Promise<string | null>;

  /** Canonical sitemap rows of published Courses or LearningPaths. */
  sitemap(
    kind: 'course' | 'path',
    offset: number,
    limit: number,
  ): Promise<readonly LearningSitemapRow[]>;

  /** Search projection reads, under the same public predicate. */
  searchCourse(id: string): Promise<CourseSearchRecord | null>;
  searchCourses(input: {
    readonly after: string | null;
    readonly limit: number;
  }): Promise<readonly { readonly id: string; readonly stamp: string }[]>;
  /** Current public addresses of whichever of `ids` are published now. Bounded. */
  publicCourseTargets(
    ids: readonly string[],
  ): Promise<readonly { readonly id: string; readonly slug: string }[]>;
  searchPath(id: string): Promise<PathSearchRecord | null>;
  searchPaths(input: {
    readonly after: string | null;
    readonly limit: number;
  }): Promise<readonly { readonly id: string; readonly stamp: string }[]>;
  publicPathTargets(
    ids: readonly string[],
  ): Promise<readonly { readonly id: string; readonly slug: string }[]>;
}

/* ===========================================================================
 * Administration — the catalogue, and counts of learners
 * ========================================================================= */

export interface LearningPersistencePort {
  courses(query: LearningAdminQuery): Promise<CoursePage>;
  /** One Course in any state, with its syllabus. */
  course(id: string): Promise<CourseDetail | null>;
  /** One lesson with its body, in any Course state. */
  lesson(id: string): Promise<LessonRecord | null>;
  /**
   * Creates (`id === null`, as a draft) or updates one Course's catalogue facts
   * under its expected version — labels, topics, teachers, slug reservation (by
   * trigger), audit entry and search intent in ONE transaction. A published
   * Course is re-validated in that transaction, so no save leaves it unpublishable.
   */
  saveCourse(input: {
    readonly actorId: string;
    readonly id: string | null;
    readonly expectedVersion: number | null;
    readonly value: CourseValue;
  }): Promise<CourseDetail>;
  /**
   * Moves a Course to `state` under its expected version. Publishing requires a
   * complete syllabus; leaving `published` is refused while a published
   * LearningPath holds the Course. Enrolments and Progress are never touched.
   */
  transitionCourse(input: {
    readonly actorId: string;
    readonly id: string;
    readonly expectedVersion: number;
    readonly state: LearningState;
  }): Promise<CourseDetail>;
  /** One named module change, only while the Course is a draft, under its expected version. */
  changeModule(input: {
    readonly actorId: string;
    readonly courseId: string;
    readonly expectedVersion: number;
    readonly change: ModuleChange;
  }): Promise<CourseDetail>;
  /** One named lesson change, by the same rules. */
  changeLesson(input: {
    readonly actorId: string;
    readonly courseId: string;
    readonly expectedVersion: number;
    readonly change: LessonChange;
  }): Promise<CourseDetail>;
  /** Published Courses an operator may add to a LearningPath, narrowed by text. Bounded. */
  courseChoices(text: string | null): Promise<readonly CourseListing[]>;

  paths(query: LearningAdminQuery): Promise<PathPage>;
  /** One LearningPath in any state, with its Courses in any state, in order. */
  path(id: string): Promise<PathDetail | null>;
  savePath(input: {
    readonly actorId: string;
    readonly id: string | null;
    readonly expectedVersion: number | null;
    readonly value: PathValue;
  }): Promise<PathDetail>;
  /** Publishing requires at least one Course and every Course published. */
  transitionPath(input: {
    readonly actorId: string;
    readonly id: string;
    readonly expectedVersion: number;
    readonly state: LearningState;
  }): Promise<PathDetail>;
  /**
   * Replaces a LearningPath's ordered Courses with `courseIds` — ONLY if the
   * path is still at `expectedVersion`, and, for a published path, only with
   * published Courses — and audits the named change.
   */
  setPathCourses(input: {
    readonly actorId: string;
    readonly pathId: string;
    readonly expectedVersion: number;
    readonly courseIds: readonly string[];
    readonly change: 'add' | 'remove' | 'move';
  }): Promise<PathDetail>;

  /** Learner counts per Course, most learners first. Never a learner. */
  enrolmentSummary(offset: number): Promise<EnrolmentSummaryPage>;
  /** Trial-request counts per live Course, oldest request first. Never a requester. */
  trialSummary(offset: number): Promise<TrialSummaryPage>;
}

/* ===========================================================================
 * A learner's own state — every method scoped to the account it names
 * ========================================================================= */

export interface LearnerPort {
  /**
   * Enrols the account on a Course that is published NOW — decided under a lock
   * the Course's own lifecycle change must wait for. Idempotent: enrolling
   * twice is one Enrolment. Returns false when the Course is not enrollable.
   */
  enrol(accountId: string, courseId: string): Promise<boolean>;
  /** Removes the account's Enrolment on a Course and its Progress there. Idempotent. */
  leave(accountId: string, courseId: string): Promise<void>;
  /**
   * Records that the account completed one lesson of a Course it is enrolled
   * on, while that Course is published. Idempotent and monotonic: the first
   * completion instant is kept, and nothing un-completes a lesson.
   */
  completeLesson(
    accountId: string,
    courseId: string,
    lessonId: string,
  ): Promise<'recorded' | 'not-enrolled' | 'unavailable'>;
  courses(accountId: string, offset: number): Promise<LearnerCoursePage>;
  /** One Course the account is enrolled on, by its current slug — or null. */
  course(accountId: string, slug: string): Promise<LearnerCourse | null>;
  /** One lesson's body, only for an enrolled account on a published Course. */
  lesson(
    accountId: string,
    courseId: string,
    lessonId: string,
  ): Promise<LessonRecord | null>;
  /** Published LearningPaths holding a Course the account is enrolled on. Bounded. */
  paths(accountId: string): Promise<readonly LearnerPath[]>;
  /** One published LearningPath by its current slug, as the account stands on it. */
  path(accountId: string, slug: string): Promise<LearnerPath | null>;
  courseState(accountId: string, courseId: string): Promise<LearnerCourseState>;
  /**
   * Records a trial-class request on a published `live` Course. Idempotent: one
   * request per account and Course. Returns false when the Course takes none.
   */
  requestTrial(accountId: string, courseId: string): Promise<boolean>;
  /** Withdraws the account's request on a Course, deleting it. Idempotent. */
  withdrawTrial(accountId: string, courseId: string): Promise<void>;
  trials(accountId: string): Promise<readonly TrialRequestRecord[]>;
}

export interface LearningExportPort {
  collect(
    accountId: string,
  ): Promise<Omit<LearningExport, 'schema' | 'version' | 'generatedAt'>>;
}

export interface LearningDispositionPort {
  /** Deletes up to `limit` of the account's Learning rows; returns how many went. */
  disposeAccount(accountId: string, limit: number): Promise<number>;
  /** Accounts holding any Learning row, in identifier order after `after`. Bounded. */
  accountsWithData(after: string | null, limit: number): Promise<readonly string[]>;
}
