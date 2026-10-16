import 'server-only';

import { randomUUID } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import {
  CLASS_LIMITS,
  intentKey,
  type AttendanceStatus,
  type ClassCommunicationPurpose,
  type ResolvedSchedule,
  type SessionParticipant,
} from '@minhaj/contracts/learning';

import { SESSION_VIEW_SELECT, type SessionViewRow } from './class-records.ts';
import { lockTeacher } from './locks.ts';
import { activated, LearningDataError, type Client } from './shared.ts';

/**
 * What a session's lifecycle means, written ONCE and used by the teacher's
 * surface, the operator's, the learner's own cancellation and a closed
 * account's disposition alike — so no two of them can disagree about who a
 * session's participants are, which intents a change owes, or what closing a
 * class does to its Booking and its address.
 *
 * EVERY HELPER RUNS INSIDE THE CALLER'S TRANSACTION, after the caller has
 * established the actor's right to the session (a teacher's current scope, an
 * operator's key, a learner's own Booking), and before it commits. Nothing
 * here decides authority; `where` narrows the session the caller may reach.
 *
 * THE VERSION IS THE LOCK: every change claims the session at the version the
 * person was shown and moves it on, so of two people acting on what they both
 * saw exactly one proceeds. The migration's triggers (51281, 51286, 51287) are
 * the floor beneath every claim.
 */

/** Participants one session may hold — a trial has one; a Course session its enrolled learners. */
const PARTICIPANT_LIMIT = 500;

/** A session as the caller is allowed to reach it: by id, narrowed further by the caller. */
export type SessionWhere = Prisma.ClassSessionWhereInput;

/* ===========================================================================
 * Reads
 * ========================================================================= */

export async function sessionView(
  tx: Client,
  sessionId: string,
  where: SessionWhere = {},
): Promise<SessionViewRow | null> {
  return tx.classSession.findFirst({
    where: { ...where, id: sessionId },
    select: SESSION_VIEW_SELECT,
  });
}

/** The session the caller may reach, or `not-found` — the same answer for another's. */
export async function requireSession(
  tx: Client,
  sessionId: string,
  where: SessionWhere = {},
): Promise<SessionViewRow> {
  const row = await sessionView(tx, sessionId, where);
  if (row === null) throw new LearningDataError('not-found');
  return row;
}

/**
 * WHO IS ELIGIBLE NOW, by the migration's own rule (51289): a trial session's
 * learner through their non-cancelled Booking; a Course session's currently
 * enrolled learners. With each one's mark, if any. In account order, bounded.
 */
export async function participantsOf(
  tx: Client,
  sessionId: string,
): Promise<readonly SessionParticipant[]> {
  return toParticipants(await participantRows(tx, sessionId));
}

export interface ParticipantRow {
  readonly userId: string;
  readonly participation: string;
  readonly status: string | null;
}

/** The participants as the query returns them; `toParticipants` shapes them for a port. */
export async function participantRows(
  tx: Client,
  sessionId: string,
): Promise<readonly ParticipantRow[]> {
  return tx.$queryRaw<ParticipantRow[]>`
    SELECT TOP (${PARTICIPANT_LIMIT}) p.[userId], p.[participation], a.[status]
    FROM (
      SELECT b.[userId], N'booking' AS [participation]
      FROM [dbo].[Booking] b
      JOIN [dbo].[ClassSession] cs ON cs.[id] = b.[sessionId]
      WHERE b.[sessionId] = ${sessionId} AND cs.[kind] = N'trial' AND b.[state] <> N'cancelled'
      UNION ALL
      SELECT e.[userId], N'enrolment'
      FROM [dbo].[Enrolment] e
      JOIN [dbo].[ClassSession] cs ON cs.[courseId] = e.[courseId]
      WHERE cs.[id] = ${sessionId} AND cs.[kind] = N'course'
    ) AS p
    LEFT JOIN [dbo].[Attendance] a ON a.[sessionId] = ${sessionId} AND a.[userId] = p.[userId]
    ORDER BY p.[userId]`;
}

export function toParticipants(rows: readonly ParticipantRow[]): SessionParticipant[] {
  return rows.map((row) => ({
    accountId: row.userId,
    participation: row.participation as SessionParticipant['participation'],
    attendance: row.status as AttendanceStatus | null,
  }));
}

/**
 * Whether another SCHEDULED session of the same teacher overlaps [startsAt,
 * endsAt) — asked under the teacher's lock, so the answer holds until commit.
 * The trigger (51287) is the floor beneath it.
 */
export async function teacherOverlaps(
  tx: Client,
  teacherId: string,
  window: { readonly startsAt: Date; readonly endsAt: Date },
  exceptSessionId: string | null,
): Promise<boolean> {
  const [row] = await tx.$queryRaw<{ total: number }[]>`
    SELECT COUNT_BIG(*) AS [total]
    FROM [dbo].[ClassSession] o
    JOIN [dbo].[CourseTeachingAssignment] os ON os.[id] = o.[scopeId]
    WHERE os.[userId] = ${teacherId}
      AND o.[state] = N'scheduled'
      AND o.[id] <> ${exceptSessionId ?? ''}
      AND o.[startsAt] < ${window.endsAt}
      AND o.[endsAt] > ${window.startsAt}`;
  return Number(row?.total ?? 0) > 0;
}

/**
 * The Course's state and format, read under a shared lock held to commit — so
 * a concurrent withdrawal, whose claim needs the exclusive lock on the same
 * row, waits until the act that read it has committed or seen the withdrawal.
 */
export async function lockedCourse(
  tx: Client,
  courseId: string,
): Promise<{ readonly state: string; readonly format: string } | null> {
  const [row] = await tx.$queryRaw<{ state: string; format: string }[]>`
    SELECT [state], [format] FROM [dbo].[Course] WITH (HOLDLOCK, ROWLOCK)
    WHERE [id] = ${courseId}`;
  return row ?? null;
}

export async function requireActivation(tx: Client): Promise<void> {
  if (!(await activated(tx))) throw new LearningDataError('not-activated');
}

/* ===========================================================================
 * Intents — durable owner mail, committed with the change they describe
 * ========================================================================= */

/**
 * One intent per recipient, keyed by `intentKey`, so a second commit of the
 * same purpose for the same session version is one row and never two.
 */
export async function commitIntents(
  tx: Client,
  input: {
    readonly purpose: ClassCommunicationPurpose;
    readonly sessionId: string;
    readonly accountIds: readonly string[];
    readonly dueAt: Date;
    readonly version: number;
  },
): Promise<void> {
  for (const accountId of new Set(input.accountIds)) {
    const key = intentKey(input.purpose, input.sessionId, accountId, input.version);
    await tx.$executeRaw`
      INSERT INTO [dbo].[ClassCommunicationIntent]
        ([id], [purpose], [sessionId], [userId], [dueAt], [state], [idempotencyKey])
      SELECT ${randomUUID()}, ${input.purpose}, ${input.sessionId}, ${accountId},
             ${input.dueAt}, N'pending', ${key}
      WHERE NOT EXISTS (
        SELECT 1 FROM [dbo].[ClassCommunicationIntent] WHERE [idempotencyKey] = ${key})`;
  }
}

/**
 * The same intent for EVERY learner enrolled on a Course session, in bounded
 * batches of `CLASS_LIMITS.reminderPage` — one INSERT … SELECT per batch over
 * the Enrolment table, so a popular Course never means one statement per
 * learner, and never an unbounded one.
 */
async function commitEnrolledIntents(
  tx: Client,
  input: {
    readonly purpose: ClassCommunicationPurpose;
    readonly sessionId: string;
    readonly courseId: string;
    readonly dueAt: Date;
    readonly version: number;
  },
): Promise<void> {
  const page = CLASS_LIMITS.reminderPage;
  const version = String(input.version);
  for (;;) {
    const inserted = await tx.$executeRaw`
      INSERT INTO [dbo].[ClassCommunicationIntent]
        ([id], [purpose], [sessionId], [userId], [dueAt], [state], [idempotencyKey])
      SELECT TOP (${page})
             LOWER(CONVERT(nvarchar(36), NEWID())), ${input.purpose}, ${input.sessionId},
             e.[userId], ${input.dueAt}, N'pending',
             ${input.purpose} + N':' + ${input.sessionId} + N':' + e.[userId] + N':' + ${version}
      FROM [dbo].[Enrolment] e
      WHERE e.[courseId] = ${input.courseId}
        AND NOT EXISTS (
          SELECT 1 FROM [dbo].[ClassCommunicationIntent] i
          WHERE i.[idempotencyKey] =
            ${input.purpose} + N':' + ${input.sessionId} + N':' + e.[userId] + N':' + ${version})
      ORDER BY e.[userId]`;
    if (inserted < page) return;
  }
}

/**
 * One purpose owed to a session's CURRENT participants and its teacher: the
 * trial learner through their live Booking, or every enrolled learner of a
 * Course session.
 */
export async function commitSessionIntents(
  tx: Client,
  session: SessionViewRow,
  purpose: ClassCommunicationPurpose,
  dueAt: Date,
  version: number,
): Promise<void> {
  const recipients = [session.scope.userId];
  if (session.kind === 'trial') {
    const booking = await tx.booking.findFirst({
      where: { sessionId: session.id, state: { not: 'cancelled' } },
      select: { userId: true },
    });
    if (booking !== null) recipients.push(booking.userId);
  } else {
    await commitEnrolledIntents(tx, {
      purpose,
      sessionId: session.id,
      courseId: session.courseId,
      dueAt,
      version,
    });
  }
  await commitIntents(tx, {
    purpose,
    sessionId: session.id,
    accountIds: recipients,
    dueAt,
    version,
  });
}

/** Abandons the session's PENDING intents — all, one purpose's, or one recipient's. */
export async function abandonIntents(
  tx: Client,
  sessionId: string,
  narrow: {
    readonly purpose?: ClassCommunicationPurpose;
    readonly accountId?: string;
  } = {},
): Promise<number> {
  const result = await tx.classCommunicationIntent.updateMany({
    where: {
      sessionId,
      state: 'pending',
      ...(narrow.purpose === undefined ? {} : { purpose: narrow.purpose }),
      ...(narrow.accountId === undefined ? {} : { userId: narrow.accountId }),
    },
    data: { state: 'abandoned', claimedUntil: null },
  });
  return result.count;
}

/* ===========================================================================
 * Lifecycle
 * ========================================================================= */

/**
 * CLOSES a session — completed or cancelled — under its expected version, or
 * without one when the caller holds its own authority to (a learner's own
 * Booking; a closed account's disposition).
 *
 * IDEMPOTENT ON THE SAME ANSWER: a session already in the state asked for is
 * returned unchanged; one in the OTHER terminal state is `terminal`. Closing
 * clears the address and the reminder (the CHECK requires both), abandons
 * every pending intent, moves a live trial Booking with it, and — on a
 * cancellation — owes every current participant and the teacher one
 * `session-cancelled` intent, due now.
 */
export async function closeSession(
  tx: Client,
  input: {
    readonly sessionId: string;
    readonly expectedVersion: number | null;
    readonly state: 'completed' | 'cancelled';
    readonly actorId: string | null;
    readonly now: Date;
    readonly where?: SessionWhere;
  },
): Promise<SessionViewRow> {
  const current = await requireSession(tx, input.sessionId, input.where);
  if (current.state !== 'scheduled') {
    if (current.state === input.state) return current;
    throw new LearningDataError('terminal');
  }
  if (input.expectedVersion !== null && current.version !== input.expectedVersion)
    throw new LearningDataError('conflict');

  // The participants as they stand BEFORE the Booking moves: the learner whose
  // trial is being cancelled is exactly who must be told.
  const participants = await participantsOf(tx, input.sessionId);

  const claimed = await tx.classSession.updateMany({
    where: { id: input.sessionId, version: current.version, state: 'scheduled' },
    data: {
      state: input.state,
      closedAt: input.now,
      meetingUrl: null,
      meetingProvider: null,
      reminderAt: null,
      version: { increment: 1 },
      updatedAt: input.now,
    },
  });
  if (claimed.count !== 1) throw new LearningDataError('conflict');
  const version = current.version + 1;

  await abandonIntents(tx, input.sessionId);

  if (current.kind === 'trial')
    await tx.booking.updateMany({
      where: { sessionId: input.sessionId, state: 'confirmed' },
      data:
        input.state === 'cancelled'
          ? {
              state: 'cancelled',
              cancelledAt: input.now,
              cancelledById: input.actorId,
              version: { increment: 1 },
              updatedAt: input.now,
            }
          : { state: 'completed', version: { increment: 1 }, updatedAt: input.now },
    });

  if (input.state === 'cancelled')
    await commitIntents(tx, {
      purpose: 'learning.session-cancelled',
      sessionId: input.sessionId,
      accountIds: [...participants.map((p) => p.accountId), current.scope.userId],
      dueAt: input.now,
      version,
    });

  return requireSession(tx, input.sessionId);
}

/**
 * MOVES a scheduled session, under its expected version and its teacher's
 * lock: refused on overlap with another of their scheduled sessions. The old
 * reminder is abandoned and a new one committed under the new version — so a
 * moved class never fires yesterday's reminder (DOMAIN_MODEL.md §19.5) — and
 * every current participant and the teacher is owed a `session-rescheduled`
 * intent, due now.
 */
export async function rescheduleSession(
  tx: Client,
  input: {
    readonly sessionId: string;
    readonly expectedVersion: number;
    readonly schedule: ResolvedSchedule;
    readonly now: Date;
    readonly where?: SessionWhere;
  },
): Promise<SessionViewRow> {
  await requireActivation(tx);
  const current = await requireSession(tx, input.sessionId, input.where);
  if (current.state !== 'scheduled') throw new LearningDataError('terminal');
  if (current.version !== input.expectedVersion) throw new LearningDataError('conflict');

  await lockTeacher(tx, current.scope.userId);
  if (await teacherOverlaps(tx, current.scope.userId, input.schedule, input.sessionId))
    throw new LearningDataError('overlap');

  const claimed = await tx.classSession.updateMany({
    where: { id: input.sessionId, version: current.version, state: 'scheduled' },
    data: {
      startsAt: input.schedule.startsAt,
      endsAt: input.schedule.endsAt,
      timeZone: input.schedule.timeZone,
      startsLocal: input.schedule.startsLocal,
      endsLocal: input.schedule.endsLocal,
      reminderAt: input.schedule.reminderAt,
      version: { increment: 1 },
      updatedAt: input.now,
    },
  });
  if (claimed.count !== 1) throw new LearningDataError('conflict');
  const moved = await requireSession(tx, input.sessionId);

  await abandonIntents(tx, input.sessionId, { purpose: 'learning.class-reminder' });
  if (moved.reminderAt !== null)
    await commitSessionIntents(
      tx,
      moved,
      'learning.class-reminder',
      moved.reminderAt,
      moved.version,
    );
  await commitSessionIntents(
    tx,
    moved,
    'learning.session-rescheduled',
    input.now,
    moved.version,
  );
  return moved;
}

/**
 * MARKS one eligible participant of a session that is not cancelled, or
 * re-marks them: one row per session and participant, the latest mark kept.
 * Eligibility is the same question `participantsOf` answers; the trigger
 * (51289) is the floor beneath it.
 */
export async function markParticipant(
  tx: Client,
  input: {
    readonly sessionId: string;
    readonly accountId: string;
    readonly status: AttendanceStatus;
    readonly markedById: string;
    readonly now: Date;
    readonly where?: SessionWhere;
  },
): Promise<readonly SessionParticipant[]> {
  const session = await requireSession(tx, input.sessionId, input.where);
  if (session.state === 'cancelled') throw new LearningDataError('terminal');
  const participants = await participantsOf(tx, input.sessionId);
  if (!participants.some((p) => p.accountId === input.accountId))
    throw new LearningDataError('not-participant');

  const marked = await tx.attendance.updateMany({
    where: { sessionId: input.sessionId, userId: input.accountId },
    data: { status: input.status, markedAt: input.now, markedById: input.markedById },
  });
  if (marked.count === 0)
    await tx.attendance.create({
      data: {
        sessionId: input.sessionId,
        userId: input.accountId,
        status: input.status,
        markedAt: input.now,
        markedById: input.markedById,
      },
    });
  return participantsOf(tx, input.sessionId);
}

/** The disclosure floor for a stored address: HTTPS on exactly `meet.google.com`. */
export function meetingAcceptable(url: string): boolean {
  return url.startsWith('https://meet.google.com/');
}
