import {
  CLASS_LIMITS,
  reminderInstant,
  type ClassWindowInput,
  type ReminderLeadMinutes,
  type ResolvedSchedule,
  type ResolvedWindow,
  type SessionScheduleInput,
} from '@minhaj/contracts/learning';
import { resolveLocalTime } from '@minhaj/contracts/platform';

import { LearningRefusal } from './refusal.ts';

/**
 * How a window a person states becomes the window the platform stores
 * (DOMAIN_MODEL.md §19.5) — PURE, so every rule is proved without a database.
 *
 * THE ZONE IS A FACT, THE INSTANT IS DERIVED. A teacher offering "Saturday
 * 19:00 to 20:00 in Asia/Karachi" means that wall-clock time; the UTC instants
 * are computed from it here, and both are stored, so a later daylight-saving
 * change in the zone cannot silently move the class. A wall time the zone
 * SKIPS resolves to nothing and is refused (`nonexistent-time`); one it
 * REPEATS has two instants and the person must say which (`ambiguous-time`)
 * — never a library default, never `Date`'s guess.
 *
 * BOUNDED. A window starts in the future, within the horizon, lasts between
 * the minimum and the maximum, and ends after it starts — each refused with
 * its own word, and each enforced again by a SQL CHECK beneath the adapter.
 */

const MINUTE = 60_000;

/** One local time in one zone as an instant, or the refusal it earns. */
function instantOf(local: string, zone: string, fold: 'earlier' | 'later' | null): Date {
  const resolved = resolveLocalTime(local, zone, fold);
  if (resolved.kind === 'nonexistent') throw new LearningRefusal('nonexistent-time');
  if (resolved.kind === 'ambiguous') throw new LearningRefusal('ambiguous-time');
  return resolved.instant;
}

/**
 * A window as a person stated it, resolved and bounded against `now`.
 *
 * `allowPast` is for a RESCHEDULE of a session that has not started: the new
 * time must still be in the future; nothing here ever admits a past start.
 */
export function resolveWindow(input: ClassWindowInput, now: Date): ResolvedWindow {
  const startsAt = instantOf(input.startsLocal, input.timeZone, input.startFold);
  const endsAt = instantOf(input.endsLocal, input.timeZone, input.endFold);
  if (endsAt.getTime() <= startsAt.getTime()) throw new LearningRefusal('invalid');
  const minutes = (endsAt.getTime() - startsAt.getTime()) / MINUTE;
  if (minutes < CLASS_LIMITS.minMinutes || minutes > CLASS_LIMITS.maxMinutes)
    throw new LearningRefusal('invalid');
  if (startsAt.getTime() <= now.getTime()) throw new LearningRefusal('past');
  const horizon = now.getTime() + CLASS_LIMITS.horizonDays * 24 * 60 * MINUTE;
  if (startsAt.getTime() > horizon) throw new LearningRefusal('past');
  return {
    startsAt,
    endsAt,
    timeZone: input.timeZone,
    startsLocal: input.startsLocal,
    endsLocal: input.endsLocal,
  };
}

/** A schedule: a window and the reminder instant its chosen lead implies. */
export function resolveSchedule(
  input: SessionScheduleInput,
  now: Date,
): ResolvedSchedule {
  const window = resolveWindow(input, now);
  return {
    ...window,
    reminderAt: reminderInstant(window.startsAt, input.reminderLeadMinutes),
  };
}

/**
 * A reschedule that keeps a session's existing lead when the caller names
 * none — a moved class keeps the reminder it had, recomputed for the new
 * start — and drops it when the caller explicitly passes `null`.
 */
export function reschedule(
  input: ClassWindowInput & {
    readonly reminderLeadMinutes?: ReminderLeadMinutes | null | undefined;
  },
  currentLead: ReminderLeadMinutes | null,
  now: Date,
): ResolvedSchedule {
  const window = resolveWindow(input, now);
  const lead =
    input.reminderLeadMinutes === undefined ? currentLead : input.reminderLeadMinutes;
  return { ...window, reminderAt: reminderInstant(window.startsAt, lead) };
}
