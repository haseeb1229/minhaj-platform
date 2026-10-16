import type { Locale } from '@minhaj/contracts';
import {
  CLASS_PAGE,
  learningIdSchema,
  REMINDER_LEAD_MINUTES,
  type ClassSessionRecord,
  type ClassSessionView,
  type ReminderLeadMinutes,
} from '@minhaj/contracts/learning';
import { instantsOf, localTimeAt } from '@minhaj/contracts/platform';

/**
 * Presentation decisions for the Teacher area — PURE and free of React
 * (ROUTE_MAP.md §6; DELIVERY_PLAN.md Phase 23).
 *
 * Which offset or Course a URL asks for, where one day starts and ends in the
 * teacher's own zone, how a page of classes groups by day, and how a class's
 * two times — the one it was scheduled in and the teacher's own — are written.
 * Each has ONE implementation, so every page reads them the same way.
 */

type Query = Record<string, string | string[] | undefined>;

/** The first value of one query parameter, or `null`. */
export function single(query: Query, name: string): string | null {
  const raw = query[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value ?? null;
}

/** A plain `?offset=` in whole pages' steps, bounded; anything else is 0. */
export function readOffset(query: Query): number {
  const raw = single(query, 'offset');
  if (raw === null || !/^\d{1,5}$/.test(raw)) return 0;
  const value = Number(raw);
  return value <= 25_000 ? value : 0;
}

/** A list page's address: the path alone for the first page. */
export function offsetHref(path: string, offset: number, extra = ''): string {
  const query = [offset <= 0 ? '' : `offset=${String(offset)}`, extra]
    .filter((part) => part !== '')
    .join('&');
  return query === '' ? path : `${path}?${query}`;
}

/** The previous and next page addresses of one list. */
export function pager(
  path: string,
  offset: number,
  hasMore: boolean,
  extra = '',
): { readonly previous: string | null; readonly next: string | null } {
  return {
    previous:
      offset === 0 ? null : offsetHref(path, Math.max(0, offset - CLASS_PAGE), extra),
    next: hasMore ? offsetHref(path, offset + CLASS_PAGE, extra) : null,
  };
}

/** A `?course=` that is a well-formed identifier, or `null`. Never repaired. */
export function readCourseFilter(query: Query): string | null {
  const parsed = learningIdSchema.safeParse(single(query, 'course'));
  return parsed.success ? parsed.data : null;
}

/** A `?lesson=` short enough to be an identifier, or `null`. */
export function readLesson(query: Query): string | null {
  const value = single(query, 'lesson');
  return value !== null && value.length <= 64 ? value : null;
}

/* ===========================================================================
 * Time
 * ========================================================================= */

const DAY = 86_400_000;

/** The teacher's display zone: the account's own when it is a real one, else UTC. */
export function ownZone(timeZone: string | null): string {
  if (timeZone === null || timeZone === '') return 'UTC';
  try {
    return Intl.DateTimeFormat('en', { timeZone }).resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

/** The calendar date, `YYYY-MM-DD`, of an instant in a zone. */
export function dateIn(instant: Date, zone: string): string {
  return localTimeAt(instant, zone).slice(0, 10);
}

/**
 * The half-open instant range [start, end) of the calendar day that holds
 * `now` in `zone` — a 23-, 24- or 25-hour day, as the zone has it. A midnight
 * a zone skips falls back to the UTC reading of that date, which is the only
 * honest approximation left.
 */
export function dayBounds(
  now: Date,
  zone: string,
): { readonly from: Date; readonly to: Date } {
  const today = dateIn(now, zone);
  const [year, month, day] = today.split('-').map(Number) as [number, number, number];
  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1))
    .toISOString()
    .slice(0, 10);
  const from =
    instantsOf(`${today}T00:00`, zone)[0] ?? new Date(Date.UTC(year, month - 1, day));
  const to = instantsOf(`${tomorrow}T00:00`, zone)[0] ?? new Date(from.getTime() + DAY);
  return { from, to };
}

/** A page of classes grouped by the calendar day each starts on, in `zone`. */
export function groupByDay(
  items: readonly ClassSessionView[],
  zone: string,
): readonly { readonly day: string; readonly items: readonly ClassSessionView[] }[] {
  const groups = new Map<string, ClassSessionView[]>();
  for (const item of items) {
    const day = dateIn(item.session.startsAt, zone);
    const group = groups.get(day);
    if (group === undefined) groups.set(day, [item]);
    else group.push(item);
  }
  return [...groups.entries()].map(([day, grouped]) => ({ day, items: grouped }));
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

/** A calendar day's heading in one zone. */
export function dayHeading(day: string, zone: string, locale: Locale): string {
  const instant = instantsOf(`${day}T12:00`, zone)[0];
  return instant === undefined
    ? day
    : new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: zone }).format(
        instant,
      );
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
