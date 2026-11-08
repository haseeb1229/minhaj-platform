import { displayTimeZone } from '@/components/personal/presentation';

/**
 * TIME IN THE PERSON'S OWN ZONE (R2) — PURE, so "today", "tomorrow" and the
 * time-zone list are proved by unit test.
 *
 * Every instant on My Minhaj is shown in the account's own IANA zone — UTC
 * when none is set, never the server's zone, which would differ between a
 * developer's machine and the deployment.
 */

/** A calendar day in `timeZone`, as `YYYY-MM-DD`. */
export function zonedDay(instant: Date, timeZone: string | null): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: displayTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** How many calendar days after `now`'s day `instant`'s day is, in `timeZone`. */
export function dayDistance(instant: Date, now: Date, timeZone: string | null): number {
  const toUtcMidnight = (day: string) => Date.parse(`${day}T00:00:00Z`);
  return Math.round(
    (toUtcMidnight(zonedDay(instant, timeZone)) -
      toUtcMidnight(zonedDay(now, timeZone))) /
      86_400_000,
  );
}

export type RelativeDay = 'today' | 'tomorrow' | 'later' | 'past';

/** Whether an instant falls today, tomorrow or later — in the person's zone. */
export function relativeDay(
  instant: Date,
  now: Date,
  timeZone: string | null,
): RelativeDay {
  const distance = dayDistance(instant, now, timeZone);
  if (distance < 0) return 'past';
  if (distance === 0) return 'today';
  if (distance === 1) return 'tomorrow';
  return 'later';
}

/** The date of an instant, in the interface locale and the person's zone. */
export function zonedDate(
  instant: Date,
  locale: string,
  timeZone: string | null,
): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: displayTimeZone(timeZone),
  }).format(instant);
}

/** The time of day of an instant, zone named, in the person's zone. */
export function zonedTime(
  instant: Date,
  locale: string,
  timeZone: string | null,
): string {
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: displayTimeZone(timeZone),
    timeZoneName: 'short',
  }).format(instant);
}

/** A short date — "7 Nov 2026" — for list metadata, in the person's zone. */
export function shortDate(
  instant: Date,
  locale: string,
  timeZone: string | null,
): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: displayTimeZone(timeZone),
  }).format(instant);
}
