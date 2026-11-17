import type { PublicEvent } from '@minhaj/contracts/editorial';

/**
 * NEWS & EVENTS PART 2 — AN EVENT AS AN iCALENDAR FILE (RFC 5545), so a reader
 * can add it to their own calendar. PURE: the route handler
 * (`/{locale}/events/{slug}/calendar`) reads the published Event and its
 * public Centre and passes them here; nothing in this module reads, writes or
 * remembers anything (`tests/editorial/event-calendar.test.ts`).
 *
 * ONLY WHAT IS RECORDED. One VEVENT per occurrence, each with its own start
 * and — only where one exists — its own end, written as the UTC instants the
 * server derived from the editor's local times, so every calendar shows them
 * in its owner's zone without a VTIMEZONE to trust; the title and summary in
 * the language the page shows; where it is held only as the public Centre
 * says now; and the Event's own address. No organiser, attendee, alarm,
 * status or recurrence is claimed: none is recorded.
 *
 * TEXT IS DATA, NEVER STRUCTURE. Every value an editor or a Centre wrote is
 * escaped as RFC 5545 TEXT — backslash, semicolon and comma escaped, a line
 * break written as `\n`, every other control character dropped — so no value
 * can end its line or begin a property of its own. Lines are folded at 75
 * octets without splitting a character, and end in CRLF.
 */

export interface CalendarWords {
  /** The title and summary in the language the page shows. */
  readonly title: string;
  readonly summary: string;
  /** Where it is held, in words, or `null` when no public Centre says so. */
  readonly location: string | null;
  /** The Event's absolute address. */
  readonly url: string;
  /** The host the identifiers are scoped to. */
  readonly host: string;
}

/** Whether a character is a control character other than the line break. */
function isControl(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return (code < 0x20 && character !== '\n') || code === 0x7f;
}

/** RFC 5545 TEXT: escaped, one logical line, no control characters. */
export function calendarText(value: string): string {
  // Every control character but the line break is dropped, never kept raw.
  const plain = [...value.replace(/\r\n?/gu, '\n')]
    .filter((character) => !isControl(character))
    .join('');
  return plain
    .replace(/\\/gu, '\\\\')
    .replace(/;/gu, '\\;')
    .replace(/,/gu, '\\,')
    .replace(/\n/gu, '\\n');
}

/** A UTC instant as an iCalendar DATE-TIME: `20270615T220000Z`. */
export function calendarInstant(instant: Date): string {
  return instant
    .toISOString()
    .replace(/\.\d{3}Z$/u, 'Z')
    .replace(/[-:]/gu, '');
}

const encoder = new TextEncoder();

/**
 * One content line folded at 75 octets: each continuation begins with a
 * space, and no UTF-8 character is cut in two.
 */
export function foldLine(line: string): string {
  const parts: string[] = [];
  let current = '';
  let octets = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (octets + size > limit) {
      parts.push(current);
      current = '';
      octets = 0;
    }
    current += character;
    octets += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/** The whole file for one published Event. */
export function eventCalendar(record: PublicEvent, words: CalendarWords): string {
  const stamp = calendarInstant(record.updatedAt);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//One Minhaj//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...record.schedule.occurrences.flatMap((occurrence) => {
      const start = calendarInstant(occurrence.startsAt);
      return [
        'BEGIN:VEVENT',
        `UID:${calendarText(`event-${record.slug}-${start}@${words.host}`)}`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${start}`,
        ...(occurrence.endsAt === null
          ? []
          : [`DTEND:${calendarInstant(occurrence.endsAt)}`]),
        `SUMMARY:${calendarText(words.title)}`,
        ...(words.summary === '' ? [] : [`DESCRIPTION:${calendarText(words.summary)}`]),
        ...(words.location === null ? [] : [`LOCATION:${calendarText(words.location)}`]),
        `URL:${words.url}`,
        'END:VEVENT',
      ];
    }),
    'END:VCALENDAR',
  ];
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
