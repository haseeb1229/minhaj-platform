import 'server-only';

import type { Prisma } from '@prisma/client';

import {
  CLASS_PAGE,
  type AvailabilityRecord,
  type AvailabilityState,
  type BookingRecord,
  type BookingState,
  type ClassSessionPage,
  type ClassSessionRecord,
  type ClassSessionView,
  type MeetingProviderKey,
  type SessionKind,
  type SessionState,
  type TeachingScopeRecord,
  type TeachingScopeView,
} from '@minhaj/contracts/learning';

import {
  COURSE_LISTING_SELECT,
  toCourseListing,
  type CourseListingRow,
} from './records.ts';
import type { Client } from './shared.ts';

/**
 * How Learning's class records are read and shaped — one definition of a
 * session, a Booking, a window and a scope, used by the teacher's surface,
 * the operator's, the learner's and the public reader alike.
 *
 * NO MEETING ADDRESS IS SELECTED HERE. `SESSION_SELECT` carries the provider
 * and never the address, so a list or a view cannot leak one by forgetting a
 * field; the address is read by exactly three named disclosure operations,
 * each a raw statement with the whole disclosure rule in its WHERE
 * (SECURITY_BASELINE.md §11). `hasMeetingUrl` is derived from the provider:
 * the session CHECK admits a provider only with an address and an address
 * only with a provider, so the two are one fact.
 */

/* ===========================================================================
 * Query fragments
 * ========================================================================= */

/** A session's own facts, the teacher's account through its scope — and NO address. */
export const SESSION_SELECT = {
  id: true,
  courseId: true,
  kind: true,
  scopeId: true,
  startsAt: true,
  endsAt: true,
  timeZone: true,
  startsLocal: true,
  endsLocal: true,
  state: true,
  meetingProvider: true,
  reminderAt: true,
  version: true,
  createdAt: true,
  closedAt: true,
  scope: { select: { userId: true, endedAt: true } },
} satisfies Prisma.ClassSessionSelect;

/** A session with its Course card. */
export const SESSION_VIEW_SELECT = {
  ...SESSION_SELECT,
  course: { select: COURSE_LISTING_SELECT },
} satisfies Prisma.ClassSessionSelect;

export const BOOKING_SELECT = {
  id: true,
  requestId: true,
  userId: true,
  courseId: true,
  sessionId: true,
  availabilityId: true,
  state: true,
  confirmedAt: true,
  cancelledAt: true,
  version: true,
} satisfies Prisma.BookingSelect;

/** A window with whether a live Booking holds it. */
export const AVAILABILITY_SELECT = {
  id: true,
  userId: true,
  startsAt: true,
  endsAt: true,
  timeZone: true,
  startsLocal: true,
  endsLocal: true,
  state: true,
  version: true,
  bookings: { where: { state: { not: 'cancelled' } }, select: { id: true } },
} satisfies Prisma.AvailabilitySelect;

export const SCOPE_SELECT = {
  id: true,
  courseId: true,
  userId: true,
  roleAssignmentId: true,
  grantedAt: true,
  endedAt: true,
  version: true,
} satisfies Prisma.CourseTeachingAssignmentSelect;

export const SCOPE_VIEW_SELECT = {
  ...SCOPE_SELECT,
  course: { select: COURSE_LISTING_SELECT },
} satisfies Prisma.CourseTeachingAssignmentSelect;

/** Soonest first; the id makes the order total. */
export const BY_START = [{ startsAt: 'asc' }, { id: 'asc' }] as const;
export const BY_START_DESC = [{ startsAt: 'desc' }, { id: 'asc' }] as const;

/* ===========================================================================
 * Row shapes — stated structurally, so no Prisma type crosses a boundary
 * ========================================================================= */

export interface SessionRow {
  readonly id: string;
  readonly courseId: string;
  readonly kind: string;
  readonly scopeId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly timeZone: string;
  readonly startsLocal: string;
  readonly endsLocal: string;
  readonly state: string;
  readonly meetingProvider: string | null;
  readonly reminderAt: Date | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly closedAt: Date | null;
  readonly scope: { readonly userId: string; readonly endedAt: Date | null };
}

export interface SessionViewRow extends SessionRow {
  readonly course: CourseListingRow;
}

export interface BookingRow {
  readonly id: string;
  readonly requestId: string;
  readonly userId: string;
  readonly courseId: string;
  readonly sessionId: string;
  readonly availabilityId: string;
  readonly state: string;
  readonly confirmedAt: Date;
  readonly cancelledAt: Date | null;
  readonly version: number;
}

export interface AvailabilityRow {
  readonly id: string;
  readonly userId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly timeZone: string;
  readonly startsLocal: string;
  readonly endsLocal: string;
  readonly state: string;
  readonly version: number;
  readonly bookings: readonly { readonly id: string }[];
}

export interface ScopeRow {
  readonly id: string;
  readonly courseId: string;
  readonly userId: string;
  readonly roleAssignmentId: string;
  readonly grantedAt: Date;
  readonly endedAt: Date | null;
  readonly version: number;
}

export interface ScopeViewRow extends ScopeRow {
  readonly course: CourseListingRow;
}

/* ===========================================================================
 * Mapping
 * ========================================================================= */

export function toSessionRecord(row: SessionRow): ClassSessionRecord {
  return {
    id: row.id,
    courseId: row.courseId,
    kind: row.kind as SessionKind,
    teachingScopeId: row.scopeId,
    teacherAccountId: row.scope.userId,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    timeZone: row.timeZone,
    startsLocal: row.startsLocal,
    endsLocal: row.endsLocal,
    state: row.state as SessionState,
    meetingProvider: row.meetingProvider as MeetingProviderKey | null,
    // One fact by CHECK: a provider stands only beside an address.
    hasMeetingUrl: row.meetingProvider !== null,
    reminderAt: row.reminderAt,
    version: row.version,
    createdAt: row.createdAt,
    closedAt: row.closedAt,
  };
}

export function toSessionView(row: SessionViewRow): ClassSessionView {
  return { session: toSessionRecord(row), course: toCourseListing(row.course) };
}

/** One page of sessions from a read of `CLASS_PAGE + 1` rows. */
export function sessionPage(rows: readonly SessionViewRow[]): ClassSessionPage {
  return {
    items: rows.slice(0, CLASS_PAGE).map(toSessionView),
    hasMore: rows.length > CLASS_PAGE,
  };
}

export function toBookingRecord(row: BookingRow): BookingRecord {
  return {
    id: row.id,
    requestId: row.requestId,
    accountId: row.userId,
    courseId: row.courseId,
    sessionId: row.sessionId,
    availabilityId: row.availabilityId,
    state: row.state as BookingState,
    confirmedAt: row.confirmedAt,
    cancelledAt: row.cancelledAt,
    version: row.version,
  };
}

export function toAvailabilityRecord(row: AvailabilityRow): AvailabilityRecord {
  return {
    id: row.id,
    accountId: row.userId,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    timeZone: row.timeZone,
    startsLocal: row.startsLocal,
    endsLocal: row.endsLocal,
    state: row.state as AvailabilityState,
    booked: row.bookings.length > 0,
    version: row.version,
  };
}

export function toScopeRecord(row: ScopeRow): TeachingScopeRecord {
  return {
    id: row.id,
    courseId: row.courseId,
    accountId: row.userId,
    roleAssignmentId: row.roleAssignmentId,
    grantedAt: row.grantedAt,
    endedAt: row.endedAt,
    version: row.version,
  };
}

export function toScopeView(row: ScopeViewRow): TeachingScopeView {
  return { scope: toScopeRecord(row), course: toCourseListing(row.course) };
}

/* ===========================================================================
 * Shared reads
 * ========================================================================= */

/**
 * Session views for a set of identifiers, keyed by identifier — the ONE query
 * a raw listing needs for every session it named, whatever order it chose.
 */
export async function sessionViewsByIds(
  db: Client,
  ids: readonly string[],
): Promise<Map<string, ClassSessionView>> {
  if (ids.length === 0) return new Map();
  const rows = await db.classSession.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: SESSION_VIEW_SELECT,
  });
  return new Map(rows.map((row) => [row.id, toSessionView(row)]));
}
