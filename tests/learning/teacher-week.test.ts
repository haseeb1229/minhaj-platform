import { describe, expect, it } from 'vitest';

import {
  classControls,
  classStage,
} from '../../apps/web/src/components/teacher/class-stage.ts';
import {
  matchesLearner,
  progressStage,
} from '../../apps/web/src/components/teacher/student-progress.ts';
import {
  addDays,
  adjacentWeeks,
  buildWeek,
  dayStartIn,
  parseDate,
  readWeek,
  weekHref,
  weekSpan,
  weekStartOf,
  WEEKS_AHEAD,
  WEEKS_BACK,
} from '../../apps/web/src/components/teacher/week.ts';

/**
 * The Teacher area's week and class-stage rules (R2, audit F38): which seven
 * days a calendar shows, where each begins in the teacher's own zone across a
 * daylight-saving change, which day every class lands on, and which controls a
 * class's page may offer — never attendance before the class has begun.
 *
 * The stage rule mirrors the service's own refusal (`not-started`); the
 * integration suite proves the refusal, this proves the page never offers the
 * control in the first place.
 */

const at = (iso: string) => new Date(iso);
const view = (id: string, startsAt: string) => ({
  id,
  session: { startsAt: at(startsAt) },
});
const window = (id: string, startsAt: string) => ({ id, startsAt: at(startsAt) });

describe('a week is Monday to Sunday', () => {
  it('finds the Monday of any date, across month and year ends', () => {
    expect(weekStartOf('2026-11-08')).toBe('2026-11-02'); // a Sunday
    expect(weekStartOf('2026-11-09')).toBe('2026-11-09'); // a Monday
    expect(weekStartOf('2027-01-01')).toBe('2026-12-28'); // a Friday
    expect(weekStartOf('2024-03-01')).toBe('2024-02-26'); // after a leap day
  });

  it('accepts only real calendar dates, never repaired', () => {
    expect(parseDate('2026-11-08')).toBe('2026-11-08');
    expect(parseDate('2024-02-29')).toBe('2024-02-29');
    for (const bad of ['2026-02-30', '2026-13-01', '2026-1-01', '20261108', 'x', ''])
      expect(parseDate(bad), bad).toBeNull();
    expect(parseDate(null)).toBeNull();
  });

  it('reads ?week= as the week holding that date, and anything else as this week', () => {
    const today = '2026-11-08';
    expect(readWeek(null, today)).toBe('2026-11-02');
    expect(readWeek('2026-11-12', today)).toBe('2026-11-09');
    expect(readWeek('not-a-date', today)).toBe('2026-11-02');
    expect(readWeek('2026-02-31', today)).toBe('2026-11-02');
  });

  it('keeps ?week= within reach, either way', () => {
    const today = '2026-11-08';
    const current = '2026-11-02';
    const furthestBack = addDays(current, -7 * WEEKS_BACK);
    const furthestAhead = addDays(current, 7 * WEEKS_AHEAD);
    expect(readWeek(furthestBack, today)).toBe(furthestBack);
    expect(readWeek(addDays(furthestBack, -1), today)).toBe(current);
    expect(readWeek(furthestAhead, today)).toBe(furthestAhead);
    expect(readWeek(addDays(furthestAhead, 7), today)).toBe(current);
    expect(readWeek('9999-12-31', today)).toBe(current);
    expect(adjacentWeeks(furthestBack, today).previous).toBeNull();
    expect(adjacentWeeks(furthestAhead, today).next).toBeNull();
    expect(adjacentWeeks(current, today)).toEqual({
      previous: '2026-10-26',
      next: '2026-11-09',
    });
  });

  it('addresses the current week by its bare path, and every other by ?week=', () => {
    expect(weekHref('/teacher/calendar', '2026-11-02', '2026-11-08')).toBe(
      '/teacher/calendar',
    );
    expect(weekHref('/ur/teacher/calendar', '2026-11-09', '2026-11-08')).toBe(
      '/ur/teacher/calendar?week=2026-11-09',
    );
  });
});

describe('days begin at the teacher’s own midnight', () => {
  it('spans 169 hours in a week the clocks go back (London, October)', () => {
    const span = weekSpan('2026-10-19', 'Europe/London');
    expect(span.from.toISOString()).toBe('2026-10-18T23:00:00.000Z'); // BST midnight
    expect(span.to.toISOString()).toBe('2026-10-26T00:00:00.000Z'); // GMT midnight
    expect((span.to.getTime() - span.from.getTime()) / 3_600_000).toBe(169);
    expect(span.days).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
    ]);
  });

  it('begins a day at the jump where the clocks skip midnight itself', () => {
    // Santiago springs forward at 00:00 → 01:00; Beirut likewise in March.
    expect(dayStartIn('2026-09-06', 'America/Santiago').toISOString()).toBe(
      '2026-09-06T04:00:00.000Z',
    );
    expect(dayStartIn('2026-03-29', 'Asia/Beirut').toISOString()).toBe(
      '2026-03-28T22:00:00.000Z',
    );
  });

  it('places a class on the day it starts in the teacher’s zone, not in UTC', () => {
    const span = weekSpan('2026-11-09', 'Asia/Karachi');
    const days = buildWeek({
      span,
      zone: 'Asia/Karachi',
      today: '2026-11-10',
      // Both on Monday in UTC: 18:30 is 23:30 on Monday in Karachi, 20:30 is
      // 01:30 on Tuesday.
      sessions: [
        view('late', '2026-11-09T20:30:00Z'),
        view('early', '2026-11-09T18:30:00Z'),
      ],
      windows: [],
    });
    expect(days[0]?.sessions.map((entry) => entry.id)).toEqual(['early']);
    expect(days[1]?.sessions.map((entry) => entry.id)).toEqual(['late']);
  });

  it('puts the repeated hour of a fall-back Sunday on that Sunday', () => {
    const zone = 'Europe/London';
    const days = buildWeek({
      span: weekSpan('2026-10-19', zone),
      zone,
      today: '2026-10-25',
      // 01:30 happens twice on 25 October: once in BST, once in GMT.
      sessions: [
        view('second', '2026-10-25T01:30:00Z'),
        view('first', '2026-10-25T00:30:00Z'),
      ],
      windows: [],
    });
    expect(days[6]?.sessions.map((entry) => entry.id)).toEqual(['first', 'second']);
    expect(days[5]?.sessions).toEqual([]);
  });
});

describe('a week of days', () => {
  const zone = 'UTC';
  const span = weekSpan('2026-11-09', zone);

  it('is chronological in every locale: the layout, never the data, mirrors it', () => {
    const days = buildWeek({
      span,
      zone,
      today: '2026-11-11',
      sessions: [],
      windows: [],
    });
    expect(days.map((day) => day.date)).toEqual([...span.days]);
    expect([...days.map((day) => day.date)].sort()).toEqual(days.map((day) => day.date));
    // Nothing in the builder takes a locale or a direction.
    expect(buildWeek.length).toBe(1);
  });

  it('marks today, and the days before it as past', () => {
    const days = buildWeek({
      span,
      zone,
      today: '2026-11-11',
      sessions: [],
      windows: [],
    });
    expect(days.map((day) => day.today)).toEqual([
      false,
      false,
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(days.map((day) => day.past)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it('sorts each day earliest first and leaves out what starts outside the week', () => {
    const days = buildWeek({
      span,
      zone,
      today: '2026-11-09',
      sessions: [
        view('b', '2026-11-10T15:00:00Z'),
        view('a', '2026-11-10T09:00:00Z'),
        view('before', '2026-11-08T23:59:00Z'),
        view('after', '2026-11-16T00:00:00Z'),
      ],
      windows: [
        window('w2', '2026-11-12T18:00:00Z'),
        window('w1', '2026-11-12T08:00:00Z'),
      ],
    });
    expect(days[1]?.sessions.map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(days[3]?.windows.map((entry) => entry.id)).toEqual(['w1', 'w2']);
    expect(days.flatMap((day) => day.sessions).map((entry) => entry.id)).not.toContain(
      'before',
    );
    expect(days.flatMap((day) => day.sessions).map((entry) => entry.id)).not.toContain(
      'after',
    );
  });
});

describe('what a class’s page may offer (F38)', () => {
  const starts = at('2026-11-10T18:00:00Z');
  const ends = at('2026-11-10T19:00:00Z');
  const scheduled = { state: 'scheduled' as const, startsAt: starts, endsAt: ends };

  it('offers no attendance and no "held" before the class starts', () => {
    const before = at('2026-11-10T17:59:59Z');
    expect(classStage(scheduled, before)).toBe('upcoming');
    expect(classControls(scheduled, before)).toEqual({
      attendance: false,
      complete: false,
      change: true,
    });
  });

  it('opens both at the very start, as the service does', () => {
    expect(classStage(scheduled, starts)).toBe('live');
    expect(classControls(scheduled, starts)).toEqual({
      attendance: true,
      complete: true,
      change: true,
    });
  });

  it('keeps them open after the end until the class is marked held', () => {
    const later = at('2026-11-10T21:00:00Z');
    expect(classStage(scheduled, later)).toBe('ended');
    expect(classControls(scheduled, later).attendance).toBe(true);
    expect(classControls(scheduled, later).complete).toBe(true);
  });

  it('lets a held class keep its marks but change nothing else', () => {
    const held = { ...scheduled, state: 'completed' as const };
    expect(classStage(held, at('2026-11-11T00:00:00Z'))).toBe('completed');
    expect(classControls(held, at('2026-11-11T00:00:00Z'))).toEqual({
      attendance: true,
      complete: false,
      change: false,
    });
  });

  it('offers nothing at all on a cancelled class, before or after its time', () => {
    const cancelled = { ...scheduled, state: 'cancelled' as const };
    for (const now of [at('2026-11-09T00:00:00Z'), at('2026-11-12T00:00:00Z')]) {
      expect(classStage(cancelled, now)).toBe('cancelled');
      expect(classControls(cancelled, now)).toEqual({
        attendance: false,
        complete: false,
        change: false,
      });
    }
  });
});

describe('learner progress, as the directory filters it', () => {
  it('has three stages, from lessons completed alone', () => {
    expect(progressStage(0, 10)).toBe('not-started');
    expect(progressStage(3, 10)).toBe('in-progress');
    expect(progressStage(10, 10)).toBe('completed');
    expect(progressStage(12, 10)).toBe('completed');
    // A Course with no lessons yet cannot be completed.
    expect(progressStage(0, 0)).toBe('not-started');
  });

  it('matches a name ignoring case and diacritics, and any Course at the stage', () => {
    const learner = {
      name: 'Amina Éxample',
      stages: ['in-progress', 'not-started'] as const,
    };
    expect(matchesLearner(learner, '', 'all')).toBe(true);
    expect(matchesLearner(learner, 'exam', 'all')).toBe(true);
    expect(matchesLearner(learner, '  AMINA ', 'not-started')).toBe(true);
    expect(matchesLearner(learner, 'bilal', 'all')).toBe(false);
    expect(matchesLearner(learner, '', 'completed')).toBe(false);
    // Arabic-script names match without their short vowels.
    expect(
      matchesLearner({ name: 'مُحَمَّد', stages: ['completed'] }, 'محمد', 'all'),
    ).toBe(true);
  });
});
