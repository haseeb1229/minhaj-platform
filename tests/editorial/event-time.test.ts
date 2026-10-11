import { describe, expect, it } from 'vitest';

import {
  EVENT_LIMITS,
  canonicalTimeZone,
  eventLocalTimeSchema,
  eventScheduleInputSchema,
  eventTimeZoneSchema,
  eventTiming,
  foldOf,
  instantsOf,
  occurrenceEnd,
  offsetMinutesOf,
  resolveEventSchedule,
  resolveLocalTime,
  zonedIso,
  type EventScheduleInput,
} from '../../packages/contracts/src/editorial/index.ts';

/**
 * Phase 14 — WHEN an Event occurs, as pure rules: which zone names are time
 * zones, how a local wall-clock time becomes its authoritative UTC instant
 * across daylight-saving changes, which schedules are refused and why, and how
 * an Event is classified upcoming, ongoing or past at the server's instant.
 *
 * Every instant below is written out as UTC so the expectation never depends on
 * the zone of the machine running the proof.
 */

const utc = (value: string) => new Date(value).toISOString();
const iso = (dates: readonly Date[]) => dates.map((date) => date.toISOString());

describe('a time zone is an IANA zone name, never an offset', () => {
  it('accepts UTC and real zones, stored under the runtime’s canonical spelling', () => {
    expect(canonicalTimeZone('UTC')).toBe('UTC');
    expect(canonicalTimeZone('Asia/Karachi')).toBe('Asia/Karachi');
    expect(canonicalTimeZone('America/New_York')).toBe('America/New_York');
    expect(canonicalTimeZone('Australia/Lord_Howe')).toBe('Australia/Lord_Howe');
    // An alias is stored ONCE, under the name the runtime treats as canonical.
    expect(canonicalTimeZone('US/Eastern')).toBe('America/New_York');
    expect(canonicalTimeZone('Etc/UTC')).toBe('UTC');
    const kolkata = canonicalTimeZone('Asia/Kolkata');
    expect(kolkata).not.toBeNull();
    expect(canonicalTimeZone('Asia/Calcutta')).toBe(kolkata);
    expect(Intl.supportedValuesOf('timeZone')).toContain(kolkata);
    // Case is normalised, not refused.
    expect(canonicalTimeZone('asia/karachi')).toBe('Asia/Karachi');
  });

  it.each([
    '+05:00',
    '-0400',
    'UTC+5',
    'GMT',
    'EST',
    'PST8PDT',
    'Etc/GMT+5',
    'Etc/GMT-14',
    'Mars/Olympus_Mons',
    'Asia/../Karachi',
    'Asia/Karachi ',
    '',
    `Asia/${'A'.repeat(70)}`,
  ])('refuses %j', (zone) => {
    expect(canonicalTimeZone(zone)).toBeNull();
  });

  it('parses a zone through its schema to the canonical name and refuses an offset', () => {
    expect(eventTimeZoneSchema.parse('  US/Eastern ')).toBe('America/New_York');
    expect(eventTimeZoneSchema.safeParse('+05:00').success).toBe(false);
    expect(eventTimeZoneSchema.safeParse('Etc/GMT+5').success).toBe(false);
  });
});

describe('a local wall-clock time', () => {
  it('is a real calendar minute within the accepted years', () => {
    for (const value of [
      '2026-11-14T19:00',
      '1900-01-01T00:00',
      '2199-12-31T23:59',
      '2028-02-29T12:00',
    ])
      expect(eventLocalTimeSchema.safeParse(value).success, value).toBe(true);
    for (const value of [
      '1899-12-31T23:59',
      '2200-01-01T00:00',
      '2026-02-29T12:00',
      '2026-02-30T12:00',
      '2026-13-01T12:00',
      '2026-00-10T12:00',
      '2026-04-31T12:00',
      '2026-11-14T24:00',
      '2026-11-14T19:60',
      '2026-11-14T19:00:00',
      '2026-11-14T19:00Z',
      '2026-11-14T19:00+05:00',
      '2026-11-14 19:00',
      '2026-11-14',
      '26-11-14T19:00',
      '',
    ])
      expect(eventLocalTimeSchema.safeParse(value).success, value).toBe(false);
  });
});

describe('local time to instant, across daylight saving', () => {
  it('resolves a zone without daylight saving exactly', () => {
    expect(iso(instantsOf('2026-11-14T19:00', 'Asia/Karachi'))).toEqual([
      utc('2026-11-14T14:00:00Z'),
    ]);
    expect(iso(instantsOf('2026-06-14T19:00', 'Asia/Karachi'))).toEqual([
      utc('2026-06-14T14:00:00Z'),
    ]);
    expect(resolveLocalTime('2026-11-14T19:00', 'Asia/Karachi', null)).toEqual({
      kind: 'exact',
      instant: new Date('2026-11-14T14:00:00Z'),
    });
    // A fold is meaningless where nothing repeats, and changes nothing.
    expect(resolveLocalTime('2026-11-14T19:00', 'Asia/Karachi', 'later')).toEqual({
      kind: 'exact',
      instant: new Date('2026-11-14T14:00:00Z'),
    });
    expect(
      foldOf('2026-11-14T19:00', 'Asia/Karachi', new Date('2026-11-14T14:00Z')),
    ).toBe(null);
    expect(iso(instantsOf('2026-11-14T19:00', 'UTC'))).toEqual([
      utc('2026-11-14T19:00:00Z'),
    ]);
  });

  it('refuses a New York spring-forward time as nonexistent, never shifting it', () => {
    // 2026-03-08: 02:00 EST becomes 03:00 EDT; 02:00–02:59 never happen.
    for (const local of ['2026-03-08T02:00', '2026-03-08T02:30', '2026-03-08T02:59']) {
      expect(instantsOf(local, 'America/New_York'), local).toEqual([]);
      for (const fold of [null, 'earlier', 'later'] as const)
        expect(resolveLocalTime(local, 'America/New_York', fold)).toEqual({
          kind: 'nonexistent',
        });
    }
    // Either side of the gap is exact.
    expect(iso(instantsOf('2026-03-08T01:59', 'America/New_York'))).toEqual([
      utc('2026-03-08T06:59:00Z'),
    ]);
    expect(iso(instantsOf('2026-03-08T03:00', 'America/New_York'))).toEqual([
      utc('2026-03-08T07:00:00Z'),
    ]);
  });

  it('requires a choice for a New York fall-back time and honours it exactly', () => {
    // 2026-11-01: 01:00–01:59 happen twice, first in EDT (-4) then in EST (-5).
    const local = '2026-11-01T01:30';
    expect(iso(instantsOf(local, 'America/New_York'))).toEqual([
      utc('2026-11-01T05:30:00Z'),
      utc('2026-11-01T06:30:00Z'),
    ]);
    expect(resolveLocalTime(local, 'America/New_York', null)).toEqual({
      kind: 'ambiguous',
    });
    const earlier = resolveLocalTime(local, 'America/New_York', 'earlier');
    const later = resolveLocalTime(local, 'America/New_York', 'later');
    expect(earlier).toEqual({ kind: 'exact', instant: new Date('2026-11-01T05:30:00Z') });
    expect(later).toEqual({ kind: 'exact', instant: new Date('2026-11-01T06:30:00Z') });
    // The stored instant says which repetition was meant, so re-opening the
    // Event shows the same choice.
    expect(foldOf(local, 'America/New_York', new Date('2026-11-01T05:30:00Z'))).toBe(
      'earlier',
    );
    expect(foldOf(local, 'America/New_York', new Date('2026-11-01T06:30:00Z'))).toBe(
      'later',
    );
    // And the offset each instant had is the real one.
    expect(zonedIso(local, new Date('2026-11-01T05:30:00Z'))).toBe(
      '2026-11-01T01:30:00-04:00',
    );
    expect(zonedIso(local, new Date('2026-11-01T06:30:00Z'))).toBe(
      '2026-11-01T01:30:00-05:00',
    );
  });

  it('does the same for London, on its own dates', () => {
    // 2026-03-29: 01:00 GMT becomes 02:00 BST.
    expect(resolveLocalTime('2026-03-29T01:30', 'Europe/London', null)).toEqual({
      kind: 'nonexistent',
    });
    // 2026-10-25: 01:00–01:59 happen in BST (+1) and then in GMT (+0).
    expect(iso(instantsOf('2026-10-25T01:30', 'Europe/London'))).toEqual([
      utc('2026-10-25T00:30:00Z'),
      utc('2026-10-25T01:30:00Z'),
    ]);
    expect(resolveLocalTime('2026-10-25T01:30', 'Europe/London', null).kind).toBe(
      'ambiguous',
    );
    // New York's fall-back hour is an ordinary hour in London.
    expect(iso(instantsOf('2026-11-01T01:30', 'Europe/London'))).toEqual([
      utc('2026-11-01T01:30:00Z'),
    ]);
  });

  it('handles a thirty-minute daylight-saving shift (Lord Howe Island)', () => {
    // 2026-10-04: 02:00 (+10:30) becomes 02:30 (+11) — a 30-minute gap.
    expect(resolveLocalTime('2026-10-04T02:15', 'Australia/Lord_Howe', null)).toEqual({
      kind: 'nonexistent',
    });
    expect(iso(instantsOf('2026-10-04T02:30', 'Australia/Lord_Howe'))).toEqual([
      utc('2026-10-03T15:30:00Z'),
    ]);
    // 2026-04-05: 02:00 (+11) becomes 01:30 (+10:30) — a repeated half hour.
    const local = '2026-04-05T01:45';
    expect(iso(instantsOf(local, 'Australia/Lord_Howe'))).toEqual([
      utc('2026-04-04T14:45:00Z'),
      utc('2026-04-04T15:15:00Z'),
    ]);
    const later = resolveLocalTime(local, 'Australia/Lord_Howe', 'later');
    if (later.kind !== 'exact') throw new Error('The later fold must resolve.');
    expect(offsetMinutesOf(local, later.instant)).toBe(630);
    expect(zonedIso(local, later.instant)).toBe('2026-04-05T01:45:00+10:30');
    expect(foldOf(local, 'Australia/Lord_Howe', later.instant)).toBe('later');
  });

  it('writes negative and fractional offsets in ISO form', () => {
    expect(zonedIso('2026-11-14T19:00', new Date('2026-11-14T14:00:00Z'))).toBe(
      '2026-11-14T19:00:00+05:00',
    );
    expect(zonedIso('2026-11-14T19:00', new Date('2026-11-14T19:00:00Z'))).toBe(
      '2026-11-14T19:00:00+00:00',
    );
    expect(zonedIso('2026-11-14T03:00', new Date('2026-11-14T06:30:00Z'))).toBe(
      '2026-11-14T03:00:00-03:30',
    );
  });
});

describe('the schedule an editor submits', () => {
  const schedule = (input: EventScheduleInput) =>
    resolveEventSchedule(eventScheduleInputSchema.parse(input));

  it('stores each local time with its derived instant, in start order', () => {
    const result = schedule({
      timezone: 'US/Eastern',
      occurrences: [
        { start: '2026-11-02T18:00', end: '2026-11-02T20:00' },
        { start: '2026-11-01T01:30', startFold: 'later' },
        { start: '2026-10-31T09:00', end: '2026-10-31T09:01' },
      ],
    });
    expect(result).toEqual({
      ok: true,
      schedule: {
        timezone: 'America/New_York',
        occurrences: [
          {
            startsLocal: '2026-10-31T09:00',
            startsAt: new Date('2026-10-31T13:00:00Z'),
            endsLocal: '2026-10-31T09:01',
            endsAt: new Date('2026-10-31T13:01:00Z'),
          },
          {
            startsLocal: '2026-11-01T01:30',
            startsAt: new Date('2026-11-01T06:30:00Z'),
            endsLocal: null,
            endsAt: null,
          },
          {
            startsLocal: '2026-11-02T18:00',
            startsAt: new Date('2026-11-02T23:00:00Z'),
            endsLocal: '2026-11-02T20:00',
            endsAt: new Date('2026-11-03T01:00:00Z'),
          },
        ],
      },
    });
  });

  it('orders by the INSTANT, not by the local text', () => {
    // 01:30 EDT (earlier) is before 01:10 EST (later), though "01:10" < "01:30".
    const result = schedule({
      timezone: 'America/New_York',
      occurrences: [
        { start: '2026-11-01T01:10', startFold: 'later' },
        { start: '2026-11-01T01:30', startFold: 'earlier' },
      ],
    });
    if (!result.ok) throw new Error('A valid schedule was refused.');
    expect(result.schedule.occurrences.map((o) => o.startsLocal)).toEqual([
      '2026-11-01T01:30',
      '2026-11-01T01:10',
    ]);
  });

  it('names the reason for every refusal, and the first one found', () => {
    const refusal = (input: EventScheduleInput) => {
      const result = schedule(input);
      return result.ok ? 'accepted' : result.refusal;
    };
    const zone = 'America/New_York';
    expect(
      refusal({ timezone: zone, occurrences: [{ start: '2026-03-08T02:30' }] }),
    ).toBe('nonexistent-time');
    expect(
      refusal({
        timezone: zone,
        occurrences: [{ start: '2026-03-08T01:00', end: '2026-03-08T02:15' }],
      }),
    ).toBe('nonexistent-time');
    expect(
      refusal({ timezone: zone, occurrences: [{ start: '2026-11-01T01:30' }] }),
    ).toBe('ambiguous-time');
    expect(
      refusal({
        timezone: zone,
        occurrences: [{ start: '2026-11-01T00:30', end: '2026-11-01T01:30' }],
      }),
    ).toBe('ambiguous-time');
    // An end must be strictly after its start.
    expect(
      refusal({
        timezone: zone,
        occurrences: [{ start: '2026-06-01T10:00', end: '2026-06-01T09:59' }],
      }),
    ).toBe('schedule-order');
    expect(
      refusal({
        timezone: zone,
        occurrences: [{ start: '2026-06-01T10:00', end: '2026-06-01T10:00' }],
      }),
    ).toBe('schedule-order');
    // Compared as instants: 01:50 EST is AFTER 01:10 EDT…
    expect(
      refusal({
        timezone: zone,
        occurrences: [
          {
            start: '2026-11-01T01:50',
            startFold: 'later',
            end: '2026-11-01T01:10',
            endFold: 'earlier',
          },
        ],
      }),
    ).toBe('schedule-order');
    // …and 01:10 EST is after 01:50 EDT, so this genuinely ends after it starts.
    expect(
      refusal({
        timezone: zone,
        occurrences: [
          {
            start: '2026-11-01T01:50',
            startFold: 'earlier',
            end: '2026-11-01T01:10',
            endFold: 'later',
          },
        ],
      }),
    ).toBe('accepted');
    // The same instant twice is one occurrence written twice.
    expect(
      refusal({
        timezone: zone,
        occurrences: [
          { start: '2026-06-01T10:00' },
          { start: '2026-06-02T10:00' },
          { start: '2026-06-01T10:00', end: '2026-06-01T11:00' },
        ],
      }),
    ).toBe('duplicate-occurrence');
    // The first refusal found is the one reported.
    expect(
      refusal({
        timezone: zone,
        occurrences: [{ start: '2026-11-01T01:30' }, { start: '2026-03-08T02:30' }],
      }),
    ).toBe('ambiguous-time');
  });

  it('is strict and bounded before any time is resolved', () => {
    const one = { start: '2026-06-01T10:00' };
    expect(
      eventScheduleInputSchema.safeParse({ timezone: 'UTC', occurrences: [] }).success,
    ).toBe(false);
    expect(
      eventScheduleInputSchema.safeParse({
        timezone: 'UTC',
        occurrences: Array.from({ length: EVENT_LIMITS.occurrences }, (_, i) => ({
          start: `2026-06-${String(i + 1).padStart(2, '0')}T10:00`,
        })),
      }).success,
    ).toBe(true);
    expect(
      eventScheduleInputSchema.safeParse({
        timezone: 'UTC',
        occurrences: Array.from({ length: EVENT_LIMITS.occurrences + 1 }, (_, i) => ({
          start: `2026-06-${String(i + 1).padStart(2, '0')}T10:00`,
        })),
      }).success,
    ).toBe(false);
    for (const extra of [
      { timezone: 'UTC', occurrences: [one], recurrence: 'weekly' },
      { timezone: 'UTC', occurrences: [{ ...one, venue: 'Hall' }] },
      { timezone: 'UTC', occurrences: [{ ...one, startsAt: '2026-06-01T10:00:00Z' }] },
      { timezone: '+05:00', occurrences: [one] },
      { timezone: 'UTC', occurrences: [{ ...one, startFold: 'middle' }] },
    ])
      expect(
        eventScheduleInputSchema.safeParse(extra).success,
        JSON.stringify(extra),
      ).toBe(false);
  });
});

describe('upcoming, ongoing and past, at the server’s instant', () => {
  const at = (value: string) => new Date(value);
  const span = (start: string, end: string | null) => ({
    startsAt: at(start),
    endsAt: end === null ? null : at(end),
  });

  it('classifies one occurrence with an end, at each boundary', () => {
    const one = [span('2030-01-01T10:00Z', '2030-01-01T12:00Z')];
    expect(eventTiming(one, at('2030-01-01T09:59Z'))).toBe('upcoming');
    expect(eventTiming(one, at('2030-01-01T10:00Z'))).toBe('ongoing');
    expect(eventTiming(one, at('2030-01-01T11:59Z'))).toBe('ongoing');
    // At its end it is no longer under way, but not yet past: the SQL listing's
    // `MAX(end) >= now` rule draws the same line.
    expect(eventTiming(one, at('2030-01-01T12:00Z'))).toBe('upcoming');
    expect(eventTiming(one, at('2030-01-01T12:00:00.001Z'))).toBe('past');
  });

  it('treats an occurrence without an end as a moment, never as ongoing', () => {
    const moment = [span('2030-01-01T10:00Z', null)];
    expect(occurrenceEnd(moment[0]!)).toEqual(at('2030-01-01T10:00Z'));
    expect(eventTiming(moment, at('2030-01-01T09:00Z'))).toBe('upcoming');
    expect(eventTiming(moment, at('2030-01-01T10:00Z'))).toBe('upcoming');
    expect(eventTiming(moment, at('2030-01-01T10:00:00.001Z'))).toBe('past');
  });

  it('is past only once EVERY occurrence is over', () => {
    const several = [
      span('2030-01-01T10:00Z', '2030-01-01T12:00Z'),
      span('2030-02-01T10:00Z', null),
      span('2030-03-01T10:00Z', '2030-03-03T10:00Z'),
    ];
    expect(eventTiming(several, at('2029-12-31T00:00Z'))).toBe('upcoming');
    expect(eventTiming(several, at('2030-01-01T11:00Z'))).toBe('ongoing');
    // Between occurrences: some are over, one is still ahead.
    expect(eventTiming(several, at('2030-01-15T00:00Z'))).toBe('upcoming');
    expect(eventTiming(several, at('2030-02-01T10:00:00.001Z'))).toBe('upcoming');
    expect(eventTiming(several, at('2030-03-02T00:00Z'))).toBe('ongoing');
    expect(eventTiming(several, at('2030-03-03T10:00:00.001Z'))).toBe('past');
  });

  it('classifies an occurrence spanning another one as ongoing throughout', () => {
    const overlapping = [
      span('2030-01-01T00:00Z', '2030-01-10T00:00Z'),
      span('2030-01-02T00:00Z', '2030-01-03T00:00Z'),
    ];
    expect(eventTiming(overlapping, at('2030-01-05T00:00Z'))).toBe('ongoing');
  });
});
