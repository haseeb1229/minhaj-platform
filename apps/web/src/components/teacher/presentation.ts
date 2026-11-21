import type { Locale } from '@minhaj/contracts';
import {
  REMINDER_LEAD_MINUTES,
  type ClassSessionRecord,
  type ReminderLeadMinutes,
} from '@minhaj/contracts/learning';

import { addDays, dateIn, dayStartIn } from './week';

/**
 * Presentation decisions for the Teacher area — PURE and free of React
 * (ROUTE_MAP.md §6; DELIVERY_PLAN.md Phase 23).
 *
 * Where one day starts and ends in the teacher's own zone, and how a class's
 * two times — the one it was scheduled in and the teacher's own — are
 * written. (What a list's address asks for is `list-view.ts`'s since the
 * Teacher area's R2 rebuild; the offset, Course and lesson readers that lived
 * here are gone with Phase 23's Previous/Next — historical.)
 * Each has ONE implementation, so every page reads them the same way.
 */

/* ===========================================================================
 * Time
 * ========================================================================= */

/** The teacher's display zone: the account's own when it is a real one, else UTC. */
export function ownZone(timeZone: string | null): string {
  if (timeZone === null || timeZone === '') return 'UTC';
  try {
    return Intl.DateTimeFormat('en', { timeZone }).resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

/**
 * The half-open instant range [start, end) of the calendar day that holds
 * `now` in `zone` — a 23-, 24- or 25-hour day, as the zone has it, beginning
 * where the clocks skip midnight at the moment they jump.
 */
export function dayBounds(
  now: Date,
  zone: string,
): { readonly from: Date; readonly to: Date } {
  const today = dateIn(now, zone);
  return { from: dayStartIn(today, zone), to: dayStartIn(addDays(today, 1), zone) };
}

/** One class's start and end as a range in one zone, in the interface locale. */
export function classRange(
  session: Pick<ClassSessionRecord, 'startsAt' | 'endsAt'>,
  zone: string,
  locale: Locale,
): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: zone,
  }).formatRange(session.startsAt, session.endsAt);
}

/** A zone's own localised name at an instant — how a reader sees daylight saving. */
export function zoneName(zone: string, instant: Date, locale: Locale): string {
  return (
    new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'long' })
      .formatToParts(instant)
      .find((part) => part.type === 'timeZoneName')?.value ?? zone
  );
}

/** The reminder leads a form offers, as select values. */
export const REMINDER_CHOICES: readonly ReminderLeadMinutes[] = REMINDER_LEAD_MINUTES;

/** Whether a scheduled class still lacks the one thing a learner needs to join. */
export function needsMeeting(session: ClassSessionRecord): boolean {
  return session.state === 'scheduled' && !session.hasMeetingUrl;
}
