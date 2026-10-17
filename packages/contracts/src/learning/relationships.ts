/**
 * Learning's CURRENT teaching relationship — the one fact Messaging may ask
 * Learning (DOMAIN_MODEL.md §3.2 `Messaging → Learning`, §15.3).
 *
 * WHY IT EXISTS. Messaging decides whether two people may speak to each other;
 * whether one of them currently TEACHES the other on a Course is Learning's
 * knowledge, and duplicating it in Messaging would give the platform two
 * sources of truth for who may reach a learner. This is the narrowest answer
 * that decision needs, and nothing else: no list of learners, no Course detail,
 * no class, no attendance and no address.
 *
 * TWO HALVES, BECAUSE ACCOUNT CLOSURE NEEDS THEM APART. A relationship is
 * current when BOTH halves hold:
 *
 *   - the TEACHER half — live learning is activated, Identity reports at least
 *     one live RoleAssignment carrying `teaching.perform` for the teacher, and
 *     a teaching scope on the Course is current under one of those exact
 *     assignments, on a Course that is published;
 *   - the LEARNER half — live learning is activated and the learner holds an
 *     Enrolment on that published Course.
 *
 * The learner half is the Enrolment and nothing broader: a trial Booking is not
 * a teaching relationship in Learning's own student list, so it is not one
 * here either. Messaging alone combines the halves; it needs them separately
 * only for the terminal-history rule a VERIFIED account closure creates
 * (DOMAIN_MODEL.md §15.6), where the remaining participant keeps reading only
 * while their OWN half is still current.
 *
 * A FACT READER, NOT A GATE. It checks no permission of its caller, writes no
 * audit row and never refuses with "not activated" — an inactive platform simply
 * answers `false` everywhere. Every answer is read live: nothing is cached
 * between requests, so a revocation or a withdrawal wins on the next one.
 */

/** One question: does this teacher currently teach this learner on this Course? */
export interface TeachingStandingQuery {
  readonly teacherAccountId: string;
  readonly learnerAccountId: string;
  readonly courseId: string;
}

/** The two halves of one answer. A current relationship is `teacher && learner`. */
export interface TeachingStanding {
  readonly teacher: boolean;
  readonly learner: boolean;
}

/** A Course on which a teacher currently teaches the asking learner. */
export interface CurrentTeacher {
  readonly teacherAccountId: string;
  readonly courseId: string;
}

/** At most this many questions are answered in one call. */
export const TEACHING_STANDING_BATCH = 100;

/** At most this many current teachers are returned for one learner. */
export const CURRENT_TEACHERS_MAX = 50;

/**
 * The persistence Learning answers from. Every method is one bounded, named
 * read; the live Identity assignment ids are supplied by the service, never by
 * a caller, and every query carries them in its own predicate.
 */
export interface LearningRelationshipReaderPort {
  /** Whether a LiveLearningActivation row exists. */
  activated(): Promise<boolean>;
  /**
   * Of `courseIds`, those on which `teacherAccountId` holds a current scope
   * made under one of `assignmentIds`, on a published Course. Bounded by the
   * input, which the adapter caps again.
   */
  teachingCourses(input: {
    readonly teacherAccountId: string;
    readonly assignmentIds: readonly string[];
    readonly courseIds: readonly string[];
  }): Promise<readonly string[]>;
  /**
   * Of the `(learner, course)` pairs, those where the learner holds an
   * Enrolment on that published Course — as `learner|course` keys.
   */
  enrolments(
    pairs: readonly { readonly learnerAccountId: string; readonly courseId: string }[],
  ): Promise<readonly string[]>;
  /**
   * The current scopes on published Courses the learner is enrolled on —
   * teacher, Course and the RoleAssignment each scope was made under — in
   * teacher then Course order, at most `CURRENT_TEACHERS_MAX`.
   */
  scopesForLearner(learnerAccountId: string): Promise<
    readonly {
      readonly teacherAccountId: string;
      readonly courseId: string;
      readonly roleAssignmentId: string;
    }[]
  >;
}

/** Identity's answer, at Layer 4: which RoleAssignments carry `teaching.perform` NOW. */
export interface LearningLiveTeachingPort {
  liveTeachingAssignments(accountId: string): Promise<readonly string[]>;
}

/** The service Messaging consumes. */
export interface LearningRelationshipService {
  /** One answer per query, in query order. At most `TEACHING_STANDING_BATCH`. */
  standing(
    queries: readonly TeachingStandingQuery[],
  ): Promise<readonly TeachingStanding[]>;
  /** The teachers currently teaching this learner, with the Course of each. */
  currentTeachers(learnerAccountId: string): Promise<readonly CurrentTeacher[]>;
}

/** The key one `(learner, course)` pair answers under. */
export function enrolmentKey(learnerAccountId: string, courseId: string): string {
  return `${learnerAccountId}|${courseId}`;
}
