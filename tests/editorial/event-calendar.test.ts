import { describe, expect, it } from 'vitest';

import {
  calendarInstant,
  calendarText,
  eventCalendar,
  foldLine,
} from '../../apps/web/src/components/editorial/event-calendar.ts';
import type { PublicEvent } from '../../packages/contracts/src/editorial/index.ts';

/**
 * News & Events Part 2 — an Event as an iCalendar file (RFC 5545), pure: one
 * VEVENT per occurrence with only what is recorded, every editor- or
 * Centre-written value escaped as TEXT so none can end its line or begin a
 * property, and lines folded at 75 octets without cutting a character.
 */

const WORDS = {
  title: 'Synthetic event',
  summary: 'A synthetic summary',
  location: 'Synthetic Centre, 1 Synthetic Street, Synthetic City',
  url: 'https://events.proof.invalid/events/synthetic-event',
  host: 'events.proof.invalid',
};

function record(overrides: Partial<PublicEvent> = {}): PublicEvent {
  return {
    slug: 'synthetic-event',
    primaryLanguage: 'en',
    translations: [],
    topicIds: [],
    contributors: [],
    schedule: {
      timezone: 'Asia/Karachi',
      occurrences: [
        {
          startsLocal: '2031-11-14T19:00',
          startsAt: new Date('2031-11-14T14:00:00Z'),
          endsLocal: '2031-11-14T21:00',
          endsAt: new Date('2031-11-14T16:00:00Z'),
        },
        {
          startsLocal: '2031-11-15T10:00',
          startsAt: new Date('2031-11-15T05:00:00Z'),
          endsLocal: null,
          endsAt: null,
        },
      ],
    },
    centreId: null,
    galleryIds: [],
    publishedAt: new Date('2031-01-01T00:00:00Z'),
    updatedAt: new Date('2031-01-02T03:04:05Z'),
    ...overrides,
  };
}

/** The file's logical lines: unfolded, CRLF-split. */
function lines(file: string): string[] {
  return file.replace(/\r\n /gu, '').replace(/\r\n$/u, '').split('\r\n');
}

describe('an Event as an iCalendar file', () => {
  it('writes one VEVENT per occurrence, with only the recorded facts', () => {
    const file = eventCalendar(record(), WORDS);
    expect(file.endsWith('\r\n')).toBe(true);
    // Every line ends in CRLF: no bare LF anywhere.
    expect(file.replace(/\r\n/gu, '')).not.toMatch(/[\r\n]/u);
    expect(lines(file)).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//One Minhaj//Events//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      'UID:event-synthetic-event-20311114T140000Z@events.proof.invalid',
      'DTSTAMP:20310102T030405Z',
      'DTSTART:20311114T140000Z',
      'DTEND:20311114T160000Z',
      'SUMMARY:Synthetic event',
      'DESCRIPTION:A synthetic summary',
      'LOCATION:Synthetic Centre\\, 1 Synthetic Street\\, Synthetic City',
      `URL:${WORDS.url}`,
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:event-synthetic-event-20311115T050000Z@events.proof.invalid',
      'DTSTAMP:20310102T030405Z',
      // No end is recorded, so none is claimed.
      'DTSTART:20311115T050000Z',
      'SUMMARY:Synthetic event',
      'DESCRIPTION:A synthetic summary',
      'LOCATION:Synthetic Centre\\, 1 Synthetic Street\\, Synthetic City',
      `URL:${WORDS.url}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ]);
  });

  it('claims no description or place it does not have', () => {
    const file = lines(
      eventCalendar(record(), { ...WORDS, summary: '', location: null }),
    );
    expect(file.some((line) => line.startsWith('DESCRIPTION'))).toBe(false);
    expect(file.some((line) => line.startsWith('LOCATION'))).toBe(false);
    for (const absent of ['ORGANIZER', 'ATTENDEE', 'VALARM', 'RRULE', 'STATUS'])
      expect(file.join('\n')).not.toContain(absent);
  });

  it('keeps every written value one TEXT value: no line or property can be injected', () => {
    const hostile =
      'Title\r\nEND:VEVENT\r\nBEGIN:VEVENT\nATTENDEE:mailto:x@y.invalid; a,b \\ c\u0007';
    const file = eventCalendar(record(), {
      ...WORDS,
      title: hostile,
      summary: hostile,
      location: hostile,
    });
    const all = lines(file);
    // Exactly the structure of the honest file: two VEVENTs, nothing added.
    expect(all.filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(2);
    expect(all.filter((line) => line === 'END:VEVENT')).toHaveLength(2);
    expect(all.some((line) => line.startsWith('ATTENDEE'))).toBe(false);
    expect(all).toContain(
      'SUMMARY:Title\\nEND:VEVENT\\nBEGIN:VEVENT\\nATTENDEE:mailto:x@y.invalid\\; a\\,b \\\\ c',
    );
    expect(file).not.toContain('\u0007');
  });

  it('escapes TEXT as RFC 5545 says', () => {
    expect(calendarText('a;b,c\\d\ne\r\nf\rg')).toBe('a\\;b\\,c\\\\d\\ne\\nf\\ng');
    expect(calendarText('tab\there\u0000')).toBe('tabhere');
    expect(calendarText('اردو، عربی')).toBe('اردو، عربی');
  });

  it('writes instants in UTC, to the second', () => {
    expect(calendarInstant(new Date('2027-06-15T22:00:00.123Z'))).toBe(
      '20270615T220000Z',
    );
  });

  it('folds at 75 octets without cutting a character', () => {
    const encoder = new TextEncoder();
    for (const text of [`SUMMARY:${'a'.repeat(200)}`, `SUMMARY:${'ع'.repeat(120)}`]) {
      const folded = foldLine(text);
      const parts = folded.split('\r\n');
      expect(parts.length).toBeGreaterThan(1);
      for (const [index, part] of parts.entries()) {
        expect(encoder.encode(part).length).toBeLessThanOrEqual(75);
        if (index > 0) expect(part.startsWith(' ')).toBe(true);
      }
      // Unfolding gives the line back exactly.
      expect(folded.replace(/\r\n /gu, '')).toBe(text);
    }
    expect(foldLine('SHORT:line')).toBe('SHORT:line');
  });
});
