import { z } from 'zod';

import { foldSchema, localTimeSchema, timeZoneSchema } from '../platform/time.ts';
import { MEETING_PROVIDERS, type MeetingProviderKey } from './meeting.ts';
import {
  learningIdSchema,
  learningVersionSchema,
  type CourseListing,
  type LearningExport,
} from './values.ts';

/**
 * Learning — the teacher experience and live classes (DOMAIN_MODEL.md §13;
 * DELIVERY_PLAN.md Phase 23): the typed Course teaching scope, Availability,
 * Booking, ClassSession, Attendance and the durable class communication
 * intent.
 *
 * WHAT IS POLICY-INDEPENDENT HERE, AND WHAT IS NOT DECIDED. Every mechanism is
 * default-deny: a teacher acts only under a LIVE `teaching.perform` assignment
 * AND a CURRENT typed scope on the exact Course; a learner reaches a class only
 * through a current Enrolment or their own confirmed Booking; nothing is
 * disclosed until live learning is ACTIVATED. No age threshold, guardian rule,
 * vetting policy, minor-retention rule or adults-only rule is modelled —
 * OPEN_DECISIONS.md §2.1 stays open — and no field below could carry one.
 *
 * TIME. An authoritative instant is UTC; the zone a class was scheduled in and
 * its wall-clock start and end are kept beside it, so the intended local time
 * survives a daylight-saving change (§19.5). A wall time a zone skips is
 * refused; one it repeats needs the scheduler's explicit choice.
 *
 * A MEETING ADDRESS IS NEVER PART OF A RECORD. It is read by exactly one named
 * operation, under the disclosure rule, and never listed, logged, audited,
 * exported or mailed (SECURITY_BASELINE.md §11).
 */

/* ===========================================================================
 * Activation — the fail-closed gate
 * ========================================================================= */

export const LIVE_LEARNING_AUTHORITIES = Object.freeze(['fixture', 'approved'] as const);
export type LiveLearningAuthority = (typeof LIVE_LEARNING_AUTHORITIES)[number];

/* ===========================================================================
 * Vocabularies — each a SQL CHECK as well
 * ========================================================================= */

export const AVAILABILITY_STATES = Object.freeze(['open', 'withdrawn'] as const);
export type AvailabilityState = (typeof AVAILABILITY_STATES)[number];

export const SESSION_KINDS = Object.freeze(['course', 'trial'] as const);
export type SessionKind = (typeof SESSION_KINDS)[number];

export const SESSION_STATES = Object.freeze([
  'scheduled',
  'completed',
  'cancelled',
] as const);
export type SessionState = (typeof SESSION_STATES)[number];

export const BOOKING_STATES = Object.freeze([
  'confirmed',
  'cancelled',
  'completed',
] as const);
export type BookingState = (typeof BOOKING_STATES)[number];

export const ATTENDANCE_STATUSES = Object.freeze(['present', 'absent'] as const);
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/**
 * The service mail Learning owns (ARCHITECTURE.md §4.6.1). Each is a
 * transactional purpose: a newsletter unsubscribe never suppresses one.
 */
export const CLASS_COMMUNICATION_PURPOSES = Object.freeze([
  'learning.booking-confirmed',
  'learning.session-rescheduled',
  'learning.session-cancelled',
  'learning.class-reminder',
] as const);
export type ClassCommunicationPurpose = (typeof CLASS_COMMUNICATION_PURPOSES)[number];

export const INTENT_STATES = Object.freeze(['pending', 'relayed', 'abandoned'] as const);
export type IntentState = (typeof INTENT_STATES)[number];

/**
 * REMINDER TIMING. No accepted document names a fixed lead, so none is
 * hard-coded as a product promise: the scheduler CHOOSES one of these leads
 * per session, or none, and the instant is stored on the session. Moving a
 * session keeps its lead and recomputes the instant; the old intent is
 * abandoned and a new one committed, so a moved class never fires yesterday's
 * reminder (DOMAIN_MODEL.md §19.5).
 */
export const REMINDER_LEAD_MINUTES = Object.freeze([60, 180, 1440] as const);
export type ReminderLeadMinutes = (typeof REMINDER_LEAD_MINUTES)[number];

/** Every bound in one place, each enforced again by a SQL CHECK. */
export const CLASS_LIMITS = Object.freeze({
  /** A window or a session is at least this long … */
  minMinutes: 15,
  /** … and at most this long. */
  maxMinutes: 480,
  /** How far ahead anything may be scheduled. */
  horizonDays: 180,
  /** Open windows one teacher may hold at once. */
  openWindows: 200,
  /** Learners one reminder fan-out processes per page. */
  reminderPage: 100,
  /** The calendar years a wall-clock time may fall in. */
  earliestYear: 2026,
  latestYear: 2199,
});

/** One page of classes, students, requests or windows. */
export const CLASS_PAGE = 24;

/* ===========================================================================
 * Inputs
 * ========================================================================= */

const yearBounds = {
  earliestYear: CLASS_LIMITS.earliestYear,
  latestYear: CLASS_LIMITS.latestYear,
};

/**
 * A start and an end as a person states them: local wall-clock times in one
 * IANA zone, each with the person's choice for a repeated hour. Resolved to
 * instants by the service; refused if either time does not exist in the zone
 * or repeats without a choice.
 */
export const classWindowInputSchema = z
  .object({
    timeZone: timeZoneSchema,
    startsLocal: localTimeSchema(yearBounds),
    endsLocal: localTimeSchema(yearBounds),
    startFold: foldSchema.nullable().default(null),
    endFold: foldSchema.nullable().default(null),
  })
  .strict();
export type ClassWindowInput = z.output<typeof classWindowInputSchema>;

export const reminderLeadSchema = z
  .union(
    REMINDER_LEAD_MINUTES.map((lead) => z.literal(lead)) as [
      z.ZodLiteral<60>,
      z.ZodLiteral<180>,
      z.ZodLiteral<1440>,
    ],
  )
  .nullable();

/** A session's schedule as scheduled or rescheduled: a window and a reminder lead. */
export const sessionScheduleInputSchema = classWindowInputSchema
  .extend({ reminderLeadMinutes: reminderLeadSchema.default(null) })
  .strict();
export type SessionScheduleInput = z.output<typeof sessionScheduleInputSchema>;

/**
 * A reschedule: a new window, and the reminder lead ONLY when the form names
 * one. Absent keeps the session's current lead; an explicit `null` drops it.
 */
export const rescheduleInputSchema = classWindowInputSchema
  .extend({ reminderLeadMinutes: reminderLeadSchema.optional() })
  .strict();
export type RescheduleInput = z.output<typeof rescheduleInputSchema>;

/** A meeting address as entered; the provider abstraction canonicalises it. */
export const meetingInputSchema = z
  .object({
    provider: z.enum(MEETING_PROVIDERS),
    url: z.string().trim().min(1).max(200),
  })
  .strict();

export const attendanceStatusSchema = z.enum(ATTENDANCE_STATUSES);

/** The administrative class directory's filters. */
export const classAdminQuerySchema = z
  .object({
    offset: z.number().int().min(0).max(25_000).default(0),
    state: z.enum(SESSION_STATES).nullable().default(null),
    kind: z.enum(SESSION_KINDS).nullable().default(null),
    courseId: learningIdSchema.nullable().default(null),
  })
  .strict();
export type ClassAdminQuery = z.infer<typeof classAdminQuerySchema>;

/** The public teacher directory's availability vocabulary. */
export const TEACHER_AVAILABILITY_FILTERS = Object.freeze(['available'] as const);
export type TeacherAvailabilityFilter = (typeof TEACHER_AVAILABILITY_FILTERS)[number];

/** Identifiers and versions a mutation names. */
export const classIdSchema = learningIdSchema;
export const classVersionSchema = learningVersionSchema;

/* ===========================================================================
 * Records
 * ========================================================================= */

/**
 * A TYPED Course teaching scope: this account teaches this Course under this
 * exact Identity RoleAssignment. CURRENT while `endedAt` is null AND Identity
 * still reports that assignment live for `teaching.perform`; the row outlives
 * revocation as safe history and grants nothing on its own.
 */
export interface TeachingScopeRecord {
  readonly id: string;
  readonly courseId: string;
  readonly accountId: string;
  readonly roleAssignmentId: string;
  readonly grantedAt: Date;
  readonly endedAt: Date | null;
  readonly version: number;
}

export interface TeachingScopeView {
  readonly scope: TeachingScopeRecord;
  readonly course: CourseListing;
}

export interface TeachingScopePage {
  readonly items: readonly TeachingScopeView[];
  readonly hasMore: boolean;
}

/** One bookable window a teacher offers. A trial Booking claims it whole. */
export interface AvailabilityRecord {
  readonly id: string;
  readonly accountId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly timeZone: string;
  readonly startsLocal: string;
  readonly endsLocal: string;
  readonly state: AvailabilityState;
  /** A confirmed Booking holds this window. */
  readonly booked: boolean;
  readonly version: number;
}

/**
 * One class. NO MEETING ADDRESS: `meetingProvider` says one was entered and
 * `hasMeetingUrl` that it is still held; the address itself is read only
 * through the disclosure operation.
 */
export interface ClassSessionRecord {
  readonly id: string;
  readonly courseId: string;
  readonly kind: SessionKind;
  readonly teachingScopeId: string;
  readonly teacherAccountId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly timeZone: string;
  readonly startsLocal: string;
  readonly endsLocal: string;
  readonly state: SessionState;
  readonly meetingProvider: MeetingProviderKey | null;
  readonly hasMeetingUrl: boolean;
  readonly reminderAt: Date | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly closedAt: Date | null;
}

/** A class with its Course, as a teacher, a learner or an operator lists it. */
export interface ClassSessionView {
  readonly session: ClassSessionRecord;
  readonly course: CourseListing;
}

export interface ClassSessionPage {
  readonly items: readonly ClassSessionView[];
  readonly hasMore: boolean;
}

/** A confirmed trial: one request, one Course, one window, one single-participant session. */
export interface BookingRecord {
  readonly id: string;
  readonly requestId: string;
  readonly accountId: string;
  readonly courseId: string;
  readonly sessionId: string;
  readonly availabilityId: string;
  readonly state: BookingState;
  readonly confirmedAt: Date;
  readonly cancelledAt: Date | null;
  readonly version: number;
}

export interface AttendanceRecord {
  readonly sessionId: string;
  readonly accountId: string;
  readonly status: AttendanceStatus;
  readonly markedAt: Date;
}

/**
 * One durable service-mail intent Learning owns: safe identifiers, a purpose,
 * an instant and a locale-free key — never a body, an address or a meeting
 * link. Resolved to a recipient at dispatch by Identity, at Layer 4.
 */
export interface ClassCommunicationIntentRecord {
  readonly id: string;
  readonly purpose: ClassCommunicationPurpose;
  readonly sessionId: string;
  readonly accountId: string;
  readonly dueAt: Date;
  readonly state: IntentState;
  readonly idempotencyKey: string;
}

/* ---- Teacher views ---------------------------------------------------- */

/** A learner as their teacher may know them: Learning-owned facts only. */
export interface TeacherStudentSummary {
  readonly accountId: string;
  /** The Courses this teacher currently teaches that the learner is enrolled on. */
  readonly courses: readonly {
    readonly course: CourseListing;
    readonly enrolledAt: Date;
    readonly completedLessons: number;
  }[];
}

export interface TeacherStudentPage {
  readonly items: readonly TeacherStudentSummary[];
  readonly hasMore: boolean;
}

/** One learner's class history with this teacher, by typed identifier. */
export interface TeacherStudentDetail extends TeacherStudentSummary {
  readonly classes: readonly {
    readonly session: ClassSessionRecord;
    readonly course: CourseListing;
    readonly participation: 'enrolment' | 'booking';
    readonly attendance: AttendanceStatus | null;
  }[];
}

/** A session's participants, as its teacher marks attendance. */
export interface SessionParticipant {
  readonly accountId: string;
  readonly participation: 'enrolment' | 'booking';
  readonly attendance: AttendanceStatus | null;
}

export interface AttendanceReportRow {
  readonly session: ClassSessionRecord;
  readonly course: CourseListing;
  readonly present: number;
  readonly absent: number;
  readonly unmarked: number;
}

/* ---- Learner views ---------------------------------------------------- */

export interface LearnerClassView {
  readonly session: ClassSessionRecord;
  readonly course: CourseListing;
  readonly participation: 'enrolment' | 'booking';
  readonly booking: BookingRecord | null;
  readonly attendance: AttendanceStatus | null;
}

export interface LearnerClassPage {
  readonly items: readonly LearnerClassView[];
  readonly hasMore: boolean;
}

/** A teacher the learner genuinely has a relationship with — by account identifier. */
export interface LearnerTeacherView {
  readonly teacherAccountId: string;
  readonly courses: readonly CourseListing[];
  readonly upcoming: number;
  readonly lastClassAt: Date | null;
}

/* ---- Administrative views -------------------------------------------- */

/** A trial request as `learning.classes.read` sees it: WHO asked, and whether it is booked. */
export interface AdminTrialRequestView {
  readonly id: string;
  readonly accountId: string;
  readonly course: CourseListing;
  readonly requestedAt: Date;
  readonly booking: BookingRecord | null;
}

export interface AdminTrialRequestPage {
  readonly items: readonly AdminTrialRequestView[];
  readonly hasMore: boolean;
}

/** A confirmation names the request and the window; the Course and teacher follow from the window. */
export const trialConfirmationSchema = z
  .object({
    requestId: learningIdSchema,
    availabilityId: learningIdSchema,
    reminderLeadMinutes: reminderLeadSchema.default(null),
  })
  .strict();
export type TrialConfirmation = z.output<typeof trialConfirmationSchema>;

/* ---- Public views ----------------------------------------------------- */

/** An upcoming activated class as the public schedule shows it: nothing private. */
export interface PublicSessionView {
  readonly id: string;
  readonly course: CourseListing;
  readonly teacherAccountId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly timeZone: string;
  readonly startsLocal: string;
  readonly endsLocal: string;
}

export interface PublicSessionPage {
  readonly items: readonly PublicSessionView[];
  readonly hasMore: boolean;
}

/** An operational teacher as Learning knows them: an account and the Courses it currently teaches. */
export interface OperationalTeacher {
  readonly accountId: string;
  readonly courses: readonly CourseListing[];
  /** At least one future open window nobody has booked. */
  readonly available: boolean;
}

/* ===========================================================================
 * Export and disposition
 * ========================================================================= */

/** The person's own class data, by typed identifier — never a meeting address. */
export type ClassExport = Pick<
  LearningExport,
  'bookings' | 'classes' | 'attendance' | 'availability' | 'teachingScopes'
>;

/* ===========================================================================
 * Pure helpers
 * ========================================================================= */

/** Whether a session is still open to change: scheduled, and not yet started. */
export function sessionIsFuture(
  session: Pick<ClassSessionRecord, 'state' | 'startsAt'>,
  now: Date,
): boolean {
  return session.state === 'scheduled' && session.startsAt.getTime() > now.getTime();
}

/** The reminder instant for a start and a lead, or `null` for no reminder. */
export function reminderInstant(
  startsAt: Date,
  lead: ReminderLeadMinutes | null,
): Date | null {
  return lead === null ? null : new Date(startsAt.getTime() - lead * 60_000);
}

/** The lead a stored reminder instant encodes, or `null`. */
export function reminderLeadOf(
  startsAt: Date,
  reminderAt: Date | null,
): ReminderLeadMinutes | null {
  if (reminderAt === null) return null;
  const minutes = Math.round((startsAt.getTime() - reminderAt.getTime()) / 60_000);
  return (REMINDER_LEAD_MINUTES as readonly number[]).includes(minutes)
    ? (minutes as ReminderLeadMinutes)
    : null;
}

/**
 * The idempotency key of one intent: stable per purpose, session, recipient
 * and the session's version at commit, so a reschedule — which moves the
 * version — owes a NEW reminder and never resurrects the old one.
 */
export function intentKey(
  purpose: ClassCommunicationPurpose,
  sessionId: string,
  accountId: string,
  version: number,
): string {
  return `${purpose}:${sessionId}:${accountId}:${String(version)}`;
}
