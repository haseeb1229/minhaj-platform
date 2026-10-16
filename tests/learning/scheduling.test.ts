import { describe, expect, it } from 'vitest';

import {
  classWindowInputSchema,
  reminderInstant,
  reminderLeadOf,
  sessionScheduleInputSchema,
} from '../../packages/contracts/src/learning/index.ts';
import {
  instantsOf,
  localTimeAt,
  resolveLocalTime,
} from '../../packages/contracts/src/platform/time.ts';
import {
  reschedule,
  resolveSchedule,
  resolveWindow,
} from '../../apps/web/src/contexts/learning/application/scheduling.ts';
import { learningFailure } from '../../apps/web/src/contexts/learning/index.ts';

/**
 * Phase 23 — scheduling rules, pure (DOMAIN_MODEL.md §19.5).
 *
 * A normal zone, a daylight-saving gap, a repeated hour, the bounds, and the
 * reminder lead that follows a moved class. No database, no clock but the one
 * handed in.
 */

const NOW = new Date('2026-10-01T12:00:00Z');

const refusal = (work: () => unknown) => {
  try {
    work();
  } catch (error) {
    return learningFailure(error);
  }
  return 'resolved';
};

describe('a window in a normal zone', () => {
  it('resolves Karachi wall-clock times to UTC instants and keeps the zone and the locals', () => {
    const window = resolveWindow(
      classWindowInputSchema.parse({
        timeZone: 'Asia/Karachi',
        startsLocal: '2026-10-10T19:00',
        endsLocal: '2026-10-10T20:00',
      }),
      NOW,
    );
    expect(window.startsAt.toISOString()).toBe('2026-10-10T14:00:00.000Z');
    expect(window.endsAt.toISOString()).toBe('2026-10-10T15:00:00.000Z');
    expect(window.timeZone).toBe('Asia/Karachi');
    expect(window.startsLocal).toBe('2026-10-10T19:00');
    // The stored instant reads back as the wall time it was scheduled from.
    expect(localTimeAt(window.startsAt, 'Asia/Karachi')).toBe('2026-10-10T19:00');
  });

  it('refuses an offset or an alias spelled as an offset, canonicalises a real alias', () => {
    expect(
      classWindowInputSchema.safeParse({
        timeZone: '+05:00',
        startsLocal: '2026-10-10T19:00',
        endsLocal: '2026-10-10T20:00',
      }).success,
    ).toBe(false);
    expect(
      classWindowInputSchema.safeParse({
        timeZone: 'EST',
        startsLocal: '2026-10-10T19:00',
        endsLocal: '2026-10-10T20:00',
      }).success,
    ).toBe(false);
    expect(
      classWindowInputSchema.parse({
        timeZone: 'Asia/Kolkata',
        startsLocal: '2026-10-10T19:00',
        endsLocal: '2026-10-10T20:00',
      }).timeZone,
    ).toBe('Asia/Calcutta');
  });
});

describe('daylight-saving transitions are handled deliberately', () => {
  // Europe/London springs forward on 2027-03-28: 01:00 → 02:00 does not exist.
  it('refuses a wall time the zone skips', () => {
    expect(instantsOf('2027-03-28T01:30', 'Europe/London')).toEqual([]);
    expect(resolveLocalTime('2027-03-28T01:30', 'Europe/London', null)).toEqual({
      kind: 'nonexistent',
    });
    expect(
      refusal(() =>
        resolveWindow(
          classWindowInputSchema.parse({
            timeZone: 'Europe/London',
            startsLocal: '2027-03-28T01:30',
            endsLocal: '2027-03-28T03:00',
          }),
          new Date('2027-03-01T00:00:00Z'),
        ),
      ),
    ).toBe('nonexistent-time');
  });

  // Europe/London falls back on 2026-10-25: 01:30 happens twice.
  it('refuses a repeated wall time without a choice, and honours the choice', () => {
    expect(instantsOf('2026-10-25T01:30', 'Europe/London')).toHaveLength(2);
    expect(resolveLocalTime('2026-10-25T01:30', 'Europe/London', null)).toEqual({
      kind: 'ambiguous',
    });
    expect(
      refusal(() =>
        resolveWindow(
          classWindowInputSchema.parse({
            timeZone: 'Europe/London',
            startsLocal: '2026-10-25T01:30',
            endsLocal: '2026-10-25T03:00',
          }),
          NOW,
        ),
      ),
    ).toBe('ambiguous-time');
    const earlier = resolveWindow(
      classWindowInputSchema.parse({
        timeZone: 'Europe/London',
        startsLocal: '2026-10-25T01:30',
        endsLocal: '2026-10-25T03:00',
        startFold: 'earlier',
      }),
      NOW,
    );
    const later = resolveWindow(
      classWindowInputSchema.parse({
        timeZone: 'Europe/London',
        startsLocal: '2026-10-25T01:30',
        endsLocal: '2026-10-25T03:00',
        startFold: 'later',
      }),
      NOW,
    );
    expect(earlier.startsAt.toISOString()).toBe('2026-10-25T00:30:00.000Z');
    expect(later.startsAt.toISOString()).toBe('2026-10-25T01:30:00.000Z');
    expect(later.startsAt.getTime() - earlier.startsAt.getTime()).toBe(3_600_000);
  });

  it('keeps the intended local time across a transition when a class is moved', () => {
    // Scheduled before the autumn change, moved to a week after it: the same
    // wall time, a different offset, and the lead preserved.
    const before = resolveSchedule(
      sessionScheduleInputSchema.parse({
        timeZone: 'Europe/London',
        startsLocal: '2026-10-20T19:00',
        endsLocal: '2026-10-20T20:00',
        reminderLeadMinutes: 60,
      }),
      NOW,
    );
    expect(before.startsAt.toISOString()).toBe('2026-10-20T18:00:00.000Z');
    const moved = reschedule(
      classWindowInputSchema.parse({
        timeZone: 'Europe/London',
        startsLocal: '2026-11-03T19:00',
        endsLocal: '2026-11-03T20:00',
      }),
      reminderLeadOf(before.startsAt, before.reminderAt),
      NOW,
    );
    expect(moved.startsAt.toISOString()).toBe('2026-11-03T19:00:00.000Z');
    expect(localTimeAt(moved.startsAt, 'Europe/London')).toBe('2026-11-03T19:00');
    expect(moved.reminderAt?.toISOString()).toBe('2026-11-03T18:00:00.000Z');
  });
});

describe('bounds', () => {
  const at = (startsLocal: string, endsLocal: string, now = NOW) =>
    refusal(() =>
      resolveWindow(
        classWindowInputSchema.parse({ timeZone: 'UTC', startsLocal, endsLocal }),
        now,
      ),
    );

  it('refuses an end at or before the start, too short, too long, past and beyond the horizon', () => {
    expect(at('2026-10-10T19:00', '2026-10-10T19:00')).toBe('invalid');
    expect(at('2026-10-10T19:00', '2026-10-10T18:00')).toBe('invalid');
    expect(at('2026-10-10T19:00', '2026-10-10T19:10')).toBe('invalid');
    expect(at('2026-10-10T09:00', '2026-10-10T18:00')).toBe('invalid');
    expect(at('2026-09-10T19:00', '2026-09-10T20:00')).toBe('past');
    expect(at('2027-09-10T19:00', '2027-09-10T20:00')).toBe('past');
    expect(at('2026-10-10T19:00', '2026-10-10T20:00')).toBe('resolved');
  });

  it('refuses a calendar date that does not exist', () => {
    expect(
      classWindowInputSchema.safeParse({
        timeZone: 'UTC',
        startsLocal: '2026-02-30T19:00',
        endsLocal: '2026-02-30T20:00',
      }).success,
    ).toBe(false);
  });
});

describe('reminder leads', () => {
  it('derive an instant from a chosen lead, and the lead back from the instant', () => {
    const start = new Date('2026-10-10T14:00:00Z');
    expect(reminderInstant(start, null)).toBeNull();
    expect(reminderInstant(start, 1440)?.toISOString()).toBe('2026-10-09T14:00:00.000Z');
    expect(reminderLeadOf(start, reminderInstant(start, 180))).toBe(180);
    expect(reminderLeadOf(start, new Date('2026-10-10T13:17:00Z'))).toBeNull();
  });

  it('a reschedule keeps the lead unless the form names one, and drops it on an explicit null', () => {
    const window = {
      timeZone: 'UTC',
      startsLocal: '2026-10-12T19:00',
      endsLocal: '2026-10-12T20:00',
    };
    expect(
      reschedule(classWindowInputSchema.parse(window), 60, NOW).reminderAt?.toISOString(),
    ).toBe('2026-10-12T18:00:00.000Z');
    expect(
      reschedule(
        { ...classWindowInputSchema.parse(window), reminderLeadMinutes: 1440 },
        60,
        NOW,
      ).reminderAt?.toISOString(),
    ).toBe('2026-10-11T19:00:00.000Z');
    expect(
      reschedule(
        { ...classWindowInputSchema.parse(window), reminderLeadMinutes: null },
        60,
        NOW,
      ).reminderAt,
    ).toBeNull();
    expect(
      sessionScheduleInputSchema.safeParse({ ...window, reminderLeadMinutes: 45 })
        .success,
    ).toBe(false);
  });
});
