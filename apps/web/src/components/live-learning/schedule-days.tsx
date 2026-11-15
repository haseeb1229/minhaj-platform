'use client';

import { useSyncExternalStore, type ReactNode } from 'react';

/**
 * THE PUBLIC SCHEDULE, DAY BY DAY, IN THE READER'S OWN TIME ZONE (Learn Part 2).
 *
 * THE DOCUMENT IS THE SAME FOR EVERYBODY. The server cannot know a reader's
 * zone and reads no session, so it groups the classes by the day each starts
 * on IN ITS OWN ZONE, which every class names beside its time. Only after the
 * page has hydrated does this island ask the BROWSER for its zone — nothing is
 * sent anywhere — and regroup the same classes by the reader's own calendar
 * day, naming today and tomorrow, and add the reader's own time beside any
 * class scheduled in another zone. Before then, or without script, the
 * server's grouping stands and is true.
 *
 * Each class card is the server's own markup, passed through untouched; this
 * island only orders, groups and annotates. Labels arrive from the public
 * message catalogue, with `{day}`, `{zone}` and `{time}` left in them.
 */

export interface ScheduleDayLabels {
  /** The region's name: "Upcoming classes". */
  readonly list: string;
  /** "Classes on {day}". */
  readonly dayList: string;
  readonly today: string;
  readonly tomorrow: string;
  /** "Days and your times are in your time zone, {zone}." */
  readonly yourZone: string;
  /** "Days follow each class's own time zone, named beside its time." */
  readonly classZones: string;
  /** "Your time: {time}". */
  readonly yourTime: string;
}

export interface ScheduleDayItem {
  readonly id: string;
  /** The start and end instants, ISO 8601 in UTC. */
  readonly startsAt: string;
  readonly endsAt: string;
  /** The zone the class was scheduled in. */
  readonly timeZone: string;
  /** The day it starts on in that zone, `YYYY-MM-DD`. */
  readonly classDay: string;
  readonly card: ReactNode;
}

/** The reader's zone and today's date in it, or `null` on the server and in the first render. */
interface ReaderClock {
  readonly zone: string;
  readonly today: string;
  readonly tomorrow: string;
}

/** `YYYY-MM-DD` of an instant in a zone, or `null` when the zone cannot be formatted. */
function dayIn(instant: number, zone: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(instant);
    const part = (type: string) => parts.find((entry) => entry.type === type)?.value;
    const [year, month, day] = [part('year'), part('month'), part('day')];
    return year === undefined || month === undefined || day === undefined
      ? null
      : `${year}-${month}-${day}`;
  } catch {
    return null;
  }
}

/* The browser's clock, as an external store: read once per snapshot, cached so
   React sees the same value until the reader's day changes. */
let cached: { readonly key: string; readonly value: ReaderClock } | null = null;

function readerClock(): ReaderClock | null {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = Date.now();
  const today = dayIn(now, zone);
  const tomorrow = dayIn(now + 86_400_000, zone);
  if (today === null || tomorrow === null) return null;
  const key = `${zone}|${today}|${tomorrow}`;
  if (cached?.key !== key) cached = { key, value: { zone, today, tomorrow } };
  return cached.value;
}

const noSubscription = () => () => undefined;
const onServer = () => null;

/** A `YYYY-MM-DD` day as words in the page's locale, the same on server and browser. */
function dayWords(day: string, locale: string): string {
  const [year, month, date] = day.split('-').map(Number);
  if (year === undefined || month === undefined || date === undefined) return day;
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: 'UTC',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(Date.UTC(year, month - 1, date));
  } catch {
    return day;
  }
}

/** A class's span in the reader's zone, or `null` when it reads the same as the class's own. */
function readerSpan(item: ScheduleDayItem, zone: string, locale: string): string | null {
  try {
    const start = new Date(item.startsAt);
    const end = new Date(item.endsAt);
    const time = (timeZone: string) =>
      new Intl.DateTimeFormat(locale, {
        timeZone,
        hour: 'numeric',
        minute: '2-digit',
      }).format(start);
    if (
      time(zone) === time(item.timeZone) &&
      dayIn(start.getTime(), zone) === item.classDay
    )
      return null;
    const span = new Intl.DateTimeFormat(locale, {
      timeZone: zone,
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });
    return `${span.format(start)} – ${span.format(end)}`;
  } catch {
    return null;
  }
}

export function ScheduleDays({
  items,
  locale,
  labels,
}: {
  readonly items: readonly ScheduleDayItem[];
  readonly locale: string;
  readonly labels: ScheduleDayLabels;
}) {
  const clock = useSyncExternalStore(noSubscription, readerClock, onServer);

  // Group in the order the schedule already holds (soonest first), by the
  // reader's day once known, else by each class's own day.
  const groups: { day: string; items: ScheduleDayItem[] }[] = [];
  for (const item of items) {
    const day =
      (clock === null ? null : dayIn(new Date(item.startsAt).getTime(), clock.zone)) ??
      item.classDay;
    const group = groups.find((entry) => entry.day === day);
    if (group === undefined) groups.push({ day, items: [item] });
    else group.items.push(item);
  }

  return (
    <section aria-label={labels.list} className="flex flex-col gap-8">
      <p className="text-sm text-foreground-muted">
        {clock === null
          ? labels.classZones
          : labels.yourZone.replace('{zone}', clock.zone)}
      </p>
      {groups.map((group) => {
        const words = dayWords(group.day, locale);
        const relative =
          clock === null
            ? null
            : group.day === clock.today
              ? labels.today
              : group.day === clock.tomorrow
                ? labels.tomorrow
                : null;
        return (
          <div key={group.day} className="flex flex-col gap-3">
            <h2 className="flex flex-wrap items-baseline gap-x-3 border-b border-border pb-2 text-subheading font-semibold">
              {relative === null ? null : <span className="text-accent">{relative}</span>}
              <span>{words}</span>
            </h2>
            <ol
              aria-label={labels.dayList.replace('{day}', words)}
              className="grid list-none grid-cols-1 gap-3 p-0 lg:grid-cols-2"
            >
              {group.items.map((item) => {
                const span = clock === null ? null : readerSpan(item, clock.zone, locale);
                return (
                  <li
                    key={item.id}
                    className="flex min-w-0 flex-col gap-3 rounded-panel border border-border bg-surface-raised p-4 sm:p-5"
                  >
                    {item.card}
                    {span === null ? null : (
                      <p className="border-t border-border pt-2 text-sm font-medium">
                        {labels.yourTime.replace('{time}', span)}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}
    </section>
  );
}
