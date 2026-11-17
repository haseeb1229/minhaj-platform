'use client';

import { useSyncExternalStore } from 'react';

import { dayIn, noSubscription, readerZone } from '@/components/ui/reader-zone';

/**
 * AN EVENT'S TIME IN THE READER'S OWN ZONE (News & Events Part 2), as Learn
 * Part 2's live schedule adds it beside a class.
 *
 * THE DOCUMENT IS THE SAME FOR EVERYBODY. The server writes every occurrence
 * as the editor stated it, in the Event's own zone and named with it — the
 * fact, true for every reader. Only after hydration does this island ask the
 * BROWSER for its zone (nothing is sent anywhere) and, when the reader's clock
 * would read differently, add their own time beside it. Without script, or
 * where the two agree, it adds nothing.
 *
 * It always renders its element, marked `data-reader-time="pending"` until it
 * has asked and `"ready"` after, so a test can tell an island that has run
 * from one that has not; an element with nothing to say is `hidden`.
 */

const onServer = () => null;

/** The occurrence in the reader's zone, or `null` when it reads the same as the Event's own. */
function readerText(
  startsAt: string,
  endsAt: string | null,
  eventZone: string,
  reader: string,
  locale: string,
): string | null {
  try {
    const start = new Date(startsAt);
    const clock = (timeZone: string) =>
      new Intl.DateTimeFormat(locale, {
        timeZone,
        hour: 'numeric',
        minute: '2-digit',
      }).format(start);
    if (
      clock(reader) === clock(eventZone) &&
      dayIn(start.getTime(), reader) === dayIn(start.getTime(), eventZone)
    )
      return null;
    const format = new Intl.DateTimeFormat(locale, {
      timeZone: reader,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });
    return endsAt === null
      ? format.format(start)
      : format.formatRange(start, new Date(endsAt));
  } catch {
    return null;
  }
}

export function EventReaderTime({
  startsAt,
  endsAt,
  zone,
  locale,
  label,
}: {
  /** The occurrence's instants, ISO 8601. */
  readonly startsAt: string;
  readonly endsAt: string | null;
  /** The IANA zone the Event is held in. */
  readonly zone: string;
  readonly locale: string;
  /** "Your time: {time}", from the public message catalogue. */
  readonly label: string;
}) {
  const reader = useSyncExternalStore(noSubscription, readerZone, onServer);
  const text =
    reader === null ? null : readerText(startsAt, endsAt, zone, reader, locale);
  return (
    <span
      data-reader-time={reader === null ? 'pending' : 'ready'}
      hidden={text === null}
      className="text-sm font-medium"
    >
      {text === null ? null : label.replace('{time}', text)}
    </span>
  );
}
