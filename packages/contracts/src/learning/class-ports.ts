import type { MeetingProviderKey } from './meeting.ts';
import type {
  AdminTrialRequestPage,
  AttendanceReportRow,
  AttendanceStatus,
  AvailabilityRecord,
  BookingRecord,
  ClassAdminQuery,
  ClassCommunicationIntentRecord,
  ClassCommunicationPurpose,
  ClassSessionPage,
  ClassSessionView,
  LearnerClassPage,
  LearnerClassView,
  LearnerTeacherView,
  LiveLearningAuthority,
  OperationalTeacher,
  PublicSessionPage,
  SessionParticipant,
  TeacherStudentDetail,
  TeacherStudentPage,
  TeachingScopePage,
  TeachingScopeView,
} from './classes.ts';
import type { CourseDetail, CoursePage, LessonRecord } from './values.ts';

/**
 * The Phase-23 ports between Learning and what it depends on
 * (ARCHITECTURE.md §3.1.1, §4.1) — alongside the Phase-22 ports in
 * `./ports.ts`. The same discipline: every operation is ONE named act with
 * its own bounds, no repository, no `where`, no transaction handle.
 *
 * THE SURFACES, AND WHY THE SPLIT IS A SECURITY BOUNDARY.
 *
 *   - `LearningTeachingAuthorityPort` is Identity's answer, at Layer 4: does
 *     this account hold this key NOW, and which of its RoleAssignments carry
 *     `teaching.perform` NOW. A teacher operation starts by asking it, on
 *     EVERY request; a revoked assignment stops answering on the next one.
 *   - `LearningTeacherDirectoryPort` is People's answer: which of these
 *     accounts are linked to a published Person with an active TeacherProfile.
 *     A profile grants nothing; it is asked only to LIST and to admit a scope.
 *   - `TeachingPort` is a teacher's OWN surface. Every method takes a
 *     `TeacherIdentity` — the account AND the live assignment ids Identity just
 *     reported — and every query carries both in its own predicate beside the
 *     scope's `endedAt IS NULL` and the activation gate. An absent scope is a
 *     denial, never global authority.
 *   - `ClassAdminPort` is the operator surface behind `learning.classes.read`
 *     and `learning.classes.administer`. It may confirm, schedule, reschedule,
 *     cancel, complete, scope and replace; it can grant no Identity key.
 *   - `ClassLearnerPort` is a person's OWN classes, keyed by their account in
 *     every predicate: current Enrolment or own Booking, nothing else.
 *   - `ClassPublicReaderPort` takes no actor and returns no participant, no
 *     address and no private window.
 *   - `ClassCommunicationPort` is the durable owner intent the Layer-4
 *     dispatcher relays through the shared email concern.
 */

/** The ONE thing Learning asks Identity about an operator or a teacher. */
export interface LearningTeachingAuthorityPort {
  permits(accountId: string, permission: string): Promise<boolean>;
  /**
   * The identifiers of the account's LIVE RoleAssignments whose active role
   * carries `teaching.perform`, for an ACTIVE account; empty otherwise. In
   * grant order, so the earliest is a deterministic choice for a new scope.
   */
  liveTeachingAssignments(accountId: string): Promise<readonly string[]>;
}

/** What Learning asks People about teachers — presentation and admission, never authority. */
export interface LearningTeacherDirectoryPort {
  /** Of the accounts named, those linked to a PUBLISHED Person holding an ACTIVE TeacherProfile. */
  teacherAccounts(accountIds: readonly string[]): Promise<readonly string[]>;
}

/** What Learning asks Identity to resolve a service mail's recipient, at dispatch. */
export interface LearningRecipientPort {
  /** The address and interface locale of each ACTIVE account named; a missing one is owed nothing. */
  recipients(accountIds: readonly string[]): Promise<
    readonly {
      readonly accountId: string;
      readonly email: string;
      readonly locale: string;
    }[]
  >;
}

/**
 * A teacher as a request has just established them: the session's account
 * and the live `teaching.perform` assignments Identity reported for it. Built
 * by the service, never by a form; carried into every teaching query.
 */
export interface TeacherIdentity {
  readonly accountId: string;
  readonly assignmentIds: readonly string[];
}

/** A resolved window: UTC instants plus the wall-clock facts they were scheduled from. */
export interface ResolvedWindow {
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly timeZone: string;
  readonly startsLocal: string;
  readonly endsLocal: string;
}

/** A resolved schedule: a window and the reminder instant it implies, if any. */
export interface ResolvedSchedule extends ResolvedWindow {
  readonly reminderAt: Date | null;
}

/* ===========================================================================
 * Activation
 * ========================================================================= */

export interface LearningActivationPort {
  /** The live-learning authority in force, or `null` while nothing is activated. */
  activeMode(): Promise<LiveLearningAuthority | null>;
}

/* ===========================================================================
 * A teacher's own surface
 * ========================================================================= */

export interface TeachingPort {
  /** The Courses this teacher currently teaches, with each scope. Bounded. */
  courses(teacher: TeacherIdentity): Promise<readonly TeachingScopeView[]>;
  /** One assigned Course with its syllabus, or `null` when not currently scoped. */
  course(teacher: TeacherIdentity, courseId: string): Promise<CourseDetail | null>;
  /** One lesson's body of an assigned Course — the materials a teacher reads. */
  lesson(
    teacher: TeacherIdentity,
    courseId: string,
    lessonId: string,
  ): Promise<LessonRecord | null>;

  /** Learners enrolled on the Courses this teacher currently teaches. Bounded page. */
  students(
    teacher: TeacherIdentity,
    courseId: string | null,
    offset: number,
  ): Promise<TeacherStudentPage>;
  /** One such learner, with their class history on those Courses; `null` if unrelated. */
  student(
    teacher: TeacherIdentity,
    accountId: string,
  ): Promise<TeacherStudentDetail | null>;

  /** Sessions on this teacher's current scopes within [from, to), start order. Bounded. */
  sessions(
    teacher: TeacherIdentity,
    /** A span, and optionally ONE Course the teacher currently teaches. */
    range: { readonly from: Date; readonly to: Date; readonly courseId?: string | null },
    offset: number,
  ): Promise<ClassSessionPage>;
  session(teacher: TeacherIdentity, sessionId: string): Promise<ClassSessionView | null>;
  participants(
    teacher: TeacherIdentity,
    sessionId: string,
  ): Promise<readonly SessionParticipant[]>;
  /**
   * THE DISCLOSURE OPERATION: the meeting address of one of this teacher's
   * SCHEDULED sessions, while activation permits — or `null`.
   */
  meetingUrl(teacher: TeacherIdentity, sessionId: string): Promise<string | null>;

  setMeeting(input: {
    readonly teacher: TeacherIdentity;
    readonly sessionId: string;
    readonly expectedVersion: number;
    readonly meeting: {
      readonly provider: MeetingProviderKey;
      readonly url: string;
    } | null;
  }): Promise<ClassSessionView>;
  reschedule(input: {
    readonly teacher: TeacherIdentity;
    readonly sessionId: string;
    readonly expectedVersion: number;
    readonly schedule: ResolvedSchedule;
  }): Promise<ClassSessionView>;
  cancel(input: {
    readonly teacher: TeacherIdentity;
    readonly sessionId: string;
    readonly expectedVersion: number;
  }): Promise<ClassSessionView>;
  complete(input: {
    readonly teacher: TeacherIdentity;
    readonly sessionId: string;
    readonly expectedVersion: number;
  }): Promise<ClassSessionView>;
  /** Marks or re-marks one eligible participant of one of this teacher's own sessions. */
  markAttendance(input: {
    readonly teacher: TeacherIdentity;
    readonly sessionId: string;
    readonly accountId: string;
    readonly status: AttendanceStatus;
  }): Promise<readonly SessionParticipant[]>;
  attendanceReport(
    teacher: TeacherIdentity,
    offset: number,
  ): Promise<{
    readonly items: readonly AttendanceReportRow[];
    readonly hasMore: boolean;
  }>;

  availability(
    teacher: TeacherIdentity,
    offset: number,
  ): Promise<{
    readonly items: readonly AvailabilityRecord[];
    readonly hasMore: boolean;
  }>;
  /** Opens one window; refused on overlap with another open window of this teacher. */
  openAvailability(input: {
    readonly teacher: TeacherIdentity;
    readonly window: ResolvedWindow;
  }): Promise<AvailabilityRecord>;
  /** Withdraws an unbooked window under its expected version. */
  withdrawAvailability(input: {
    readonly teacher: TeacherIdentity;
    readonly availabilityId: string;
    readonly expectedVersion: number;
  }): Promise<AvailabilityRecord>;
}

/* ===========================================================================
 * Administration — `learning.classes.read` / `learning.classes.administer`
 * ========================================================================= */

export interface ClassAdminPort {
  /* ---- teaching scopes ---------------------------------------------- */
  scopes(input: {
    readonly courseId: string | null;
    readonly accountId: string | null;
    /** `true` current only, `false` ended only, `null` every scope. */
    readonly current: boolean | null;
    readonly offset: number;
  }): Promise<TeachingScopePage>;
  /**
   * Live-format Courses that are not archived — what a scope may be made on —
   * by slug, bounded page. The class keys' own read, so scoping does not
   * depend on also holding the catalogue's `learning.read`.
   */
  liveCourses(offset: number): Promise<CoursePage>;
  /**
   * Scopes an account to a Course under the exact live assignment named.
   * Refused if a current scope already exists for the pair, the Course is not
   * `live`, or the assignment is not live and the account's (the trigger
   * floor beneath the service's Identity check).
   */
  grantScope(input: {
    readonly actorId: string;
    readonly courseId: string;
    readonly accountId: string;
    readonly roleAssignmentId: string;
  }): Promise<TeachingScopeView>;
  /** Ends a scope under its expected version. Future sessions on it become replacement-required. */
  endScope(input: {
    readonly actorId: string;
    readonly scopeId: string;
    readonly expectedVersion: number;
  }): Promise<TeachingScopeView>;
  /** One scope by identifier, current or ended, with its Course; `null` if unknown. */
  scope(scopeId: string): Promise<TeachingScopeView | null>;

  /* ---- windows an operator confirms into -------------------------------- */
  /** The account that offered one window, or `null`. The service asks Identity about it. */
  availabilityOwner(availabilityId: string): Promise<string | null>;
  /**
   * Open, unbooked, future windows of teachers CURRENTLY scoped to the Course,
   * soonest first. Bounded page. What an operator chooses from to confirm a
   * request on that Course.
   */
  availableWindows(
    courseId: string,
    now: Date,
    offset: number,
  ): Promise<{
    readonly items: readonly AvailabilityRecord[];
    readonly hasMore: boolean;
  }>;

  /* ---- trial requests and bookings ---------------------------------- */
  /** Requests with WHO asked, oldest first. Access is audited by the caller. */
  trialRequests(courseId: string | null, offset: number): Promise<AdminTrialRequestPage>;
  /**
   * Confirms one request into one Booking, one trial ClassSession and the
   * claim of one open window — in ONE transaction, serialised on the window
   * and the teacher: two confirmations of one request, or two of one window,
   * cannot both succeed. The window's teacher must currently be scoped to the
   * request's Course under one of `assignmentIds` (Identity's live list for
   * that teacher, read by the service).
   */
  confirmTrial(input: {
    readonly actorId: string;
    readonly requestId: string;
    readonly availabilityId: string;
    readonly teacherAssignmentIds: readonly string[];
    readonly reminderLeadMinutes: number | null;
  }): Promise<{ readonly booking: BookingRecord; readonly session: ClassSessionView }>;

  /* ---- sessions ------------------------------------------------------ */
  sessions(query: ClassAdminQuery): Promise<ClassSessionPage>;
  session(sessionId: string): Promise<ClassSessionView | null>;
  /** Participants of one session, by account. Access is audited by the caller. */
  participants(sessionId: string): Promise<readonly SessionParticipant[]>;
  /** The disclosure operation for an operator holding `learning.classes.read`. */
  meetingUrl(sessionId: string): Promise<string | null>;
  /** A regular Course session on a published live Course under a current scope. */
  createSession(input: {
    readonly actorId: string;
    readonly scopeId: string;
    readonly teacherAssignmentIds: readonly string[];
    readonly schedule: ResolvedSchedule;
    readonly meeting: {
      readonly provider: MeetingProviderKey;
      readonly url: string;
    } | null;
  }): Promise<ClassSessionView>;
  reschedule(input: {
    readonly actorId: string;
    readonly sessionId: string;
    readonly expectedVersion: number;
    readonly schedule: ResolvedSchedule;
  }): Promise<ClassSessionView>;
  cancel(input: {
    readonly actorId: string;
    readonly sessionId: string;
    readonly expectedVersion: number;
  }): Promise<ClassSessionView>;
  complete(input: {
    readonly actorId: string;
    readonly sessionId: string;
    readonly expectedVersion: number;
  }): Promise<ClassSessionView>;
  /**
   * Moves a FUTURE scheduled session to another current scope on the same
   * Course, under the session's expected version. Pending reminders to the old
   * teacher are abandoned and one to the new teacher committed.
   */
  replaceTeacher(input: {
    readonly actorId: string;
    readonly sessionId: string;
    readonly expectedVersion: number;
    readonly scopeId: string;
    readonly teacherAssignmentIds: readonly string[];
  }): Promise<ClassSessionView>;
  /** A narrow correction of one participant's mark on a session not cancelled. */
  correctAttendance(input: {
    readonly actorId: string;
    readonly sessionId: string;
    readonly accountId: string;
    readonly status: AttendanceStatus;
  }): Promise<readonly SessionParticipant[]>;
}

/* ===========================================================================
 * A learner's own classes — every method keyed by the account
 * ========================================================================= */

export interface ClassLearnerPort {
  /** Upcoming scheduled classes the account may attend, soonest first. */
  upcoming(accountId: string, now: Date): Promise<readonly LearnerClassView[]>;
  /** Past and terminal classes the account took part in, latest first. Bounded page. */
  past(accountId: string, now: Date, offset: number): Promise<LearnerClassPage>;
  /** One class the account may attend or attended; `null` otherwise. */
  session(accountId: string, sessionId: string): Promise<LearnerClassView | null>;
  /** The disclosure operation for a participant of a SCHEDULED class, while activation permits. */
  meetingUrl(accountId: string, sessionId: string): Promise<string | null>;
  /** Cancels the account's own confirmed future trial Booking — and its single-participant session. */
  cancelBooking(input: {
    readonly accountId: string;
    readonly bookingId: string;
    readonly expectedVersion: number;
  }): Promise<BookingRecord>;
  /** The teachers this account has a genuine relationship with. Bounded. */
  teachers(accountId: string, now: Date): Promise<readonly LearnerTeacherView[]>;
}

/* ===========================================================================
 * Public reads — activated, scheduled, nothing private
 * ========================================================================= */

export interface ClassPublicReaderPort {
  /** Upcoming scheduled sessions on published live Courses, soonest first, while activated. */
  upcomingSessions(now: Date, offset: number): Promise<PublicSessionPage>;
  /** Accounts holding a current scope on a published live Course, with those Courses. Bounded. */
  operationalTeachers(now: Date): Promise<readonly OperationalTeacher[]>;
}

/* ===========================================================================
 * Durable communication intent
 * ========================================================================= */

export interface ClassCommunicationPort {
  /** Pending intents due by `now`, oldest first, bounded; each is claimed for `leaseSeconds`. */
  claimDue(
    now: Date,
    limit: number,
    leaseSeconds: number,
  ): Promise<readonly ClassCommunicationIntentRecord[]>;
  markRelayed(intentId: string): Promise<void>;
  markAbandoned(intentId: string): Promise<void>;
  /**
   * What is owed for one intent NOW: the session as it stands and whether the
   * recipient is still a current participant or the current teacher — or
   * `null` when nothing is owed any more.
   */
  deliverySource(intentId: string): Promise<{
    readonly intent: ClassCommunicationIntentRecord;
    readonly session: ClassSessionView;
    readonly recipientRole: 'learner' | 'teacher';
    readonly owed: boolean;
  } | null>;
  /** Operator view: pending and abandoned intents by purpose. */
  summarise(): Promise<
    readonly {
      readonly purpose: ClassCommunicationPurpose;
      readonly pending: number;
      readonly abandoned: number;
    }[]
  >;
}
