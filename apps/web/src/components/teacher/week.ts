import { instantsOf, localTimeAt } from '@minhaj/contracts/platform';

/**
 * THE TEACHER'S WEEK (R2) — which seven days a calendar page shows, where each
 * begins and ends in the teacher's own zone, and which day every class and
 * availability window belongs to. PURE: the caller supplies "today" and the
 * records; nothing here reads a clock, a session or a store.
 *
 * A WEEK RUNS MONDAY TO SUNDAY (ISO 8601) in every interface language, so one
 * `?week=` address names the same seven days for every reader.
 *
 * DAYS ARE CALENDAR DAYS IN THE TEACHER'S ZONE. A day is 23, 24 or 25 hours
 * long as that zone has it; where the clocks skip midnight itself (Santiago,
 * Beirut), the day begins at the first minute that exists.
 *
 * CHRONOLOGICAL, NEVER MIRRORED. The days and each day's entries are returned
 * earliest first in every locale. The grid lays them out along the inline
 * axis, so Urdu and Arabic read the same week from the right — the order is
 * the layout's job, never the data's.
 */

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** How far back and ahead a `?week=` may reach from this week, in weeks. */
export const WEEKS_BACK = 53;
export const WEEKS_AHEAD = 27;

/** A real calendar date, `YYYY-MM-DD`, or `null`. Never repaired. */
export function parseDate(value: string | null): string | null {
  if (value === null) return null;
  const match = DATE.exec(value);
  if (match === null) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? value
    : null;
}

/** The date `days` after (or before) a date. */
export function addDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

/** The Monday of the week holding a date. */
export function weekStartOf(day: string): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(year, month - 1, date)).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

/** The calendar date, `YYYY-MM-DD`, of an instant in a zone. */
export function dateIn(instant: Date, zone: string): string {
  return localTimeAt(instant, zone).slice(0, 10);
}

/**
 * The first instant of a calendar day in a zone: its midnight, or — where the
 * clocks skip midnight — the first half-hour of the day that exists, which is
 * the moment the clocks jumped.
 */
export function dayStartIn(day: string, zone: string): Date {
  for (let minute = 0; minute <= 180; minute += 30) {
    const hours = String(Math.floor(minute / 60)).padStart(2, '0');
    const minutes = String(minute % 60).padStart(2, '0');
    const instant = instantsOf(`${day}T${hours}:${minutes}`, zone)[0];
    if (instant !== undefined) return instant;
  }
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date));
}

/**
 * The week a `?week=` names: any real date within the reachable span, as the
 * Monday of its week. Anything else — absent, malformed, out of reach — is
 * this week, never an error page.
 */
export function readWeek(raw: string | null, today: string): string {
  const current = weekStartOf(today);
  const asked = parseDate(raw);
  if (asked === null) return current;
  const start = weekStartOf(asked);
  return start < addDays(current, -7 * WEEKS_BACK) ||
    start > addDays(current, 7 * WEEKS_AHEAD)
    ? current
    : start;
}

/** The address of one week's page: the bare path for the current week. */
export function weekHref(path: string, weekStart: string, today: string): string {
  return weekStart === weekStartOf(today) ? path : `${path}?week=${weekStart}`;
}

/** The weeks either side of one, where still within reach. */
export function adjacentWeeks(
  weekStart: string,
  today: string,
): { readonly previous: string | null; readonly next: string | null } {
  const current = weekStartOf(today);
  const previous = addDays(weekStart, -7);
  const next = addDays(weekStart, 7);
  return {
    previous: previous < addDays(current, -7 * WEEKS_BACK) ? null : previous,
    next: next > addDays(current, 7 * WEEKS_AHEAD) ? null : next,
  };
}

/** One week in a zone: its seven dates and the half-open instant range [from, to). */
export interface WeekSpan {
  readonly start: string;
  readonly days: readonly string[];
  readonly from: Date;
  readonly to: Date;
}

export function weekSpan(weekStart: string, zone: string): WeekSpan {
  return {
    start: weekStart,
    days: Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    from: dayStartIn(weekStart, zone),
    to: dayStartIn(addDays(weekStart, 7), zone),
  };
}

interface Timed {
  readonly startsAt: Date;
}

export interface WeekDay<S, W> {
  readonly date: string;
  readonly today: boolean;
  readonly past: boolean;
  readonly sessions: readonly S[];
  readonly windows: readonly W[];
}

/**
 * The seven days of a week with the classes and windows that START on each,
 * in the teacher's zone, earliest first. Anything starting outside the week is
 * left out — a read that reached past it is not this week's business.
 */
export function buildWeek<S extends { readonly session: Timed }, W extends Timed>(input: {
  readonly span: WeekSpan;
  readonly zone: string;
  readonly today: string;
  /** Classes, placed by their session's start. */
  readonly sessions: readonly S[];
  readonly windows: readonly W[];
}): readonly WeekDay<S, W>[] {
  const place = <T>(items: readonly T[], start: (item: T) => Date) => {
    const inWeek = items.filter(
      (item) =>
        start(item).getTime() >= input.span.from.getTime() &&
        start(item).getTime() < input.span.to.getTime(),
    );
    return (date: string) =>
      inWeek
        .filter((item) => dateIn(start(item), input.zone) === date)
        .sort((a, b) => start(a).getTime() - start(b).getTime());
  };
  const sessionsOn = place(input.sessions, (view) => view.session.startsAt);
  const windowsOn = place(input.windows, (window) => window.startsAt);
  return input.span.days.map((date) => ({
    date,
    today: date === input.today,
    past: date < input.today,
    sessions: sessionsOn(date),
    windows: windowsOn(date),
  }));
}
