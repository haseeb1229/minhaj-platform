import { describe, expect, it } from 'vitest';

import {
  AVAILABILITY_VIEWS,
  CLASS_PAGE,
  TEACHING_OFFSET_MAX,
  type AvailabilityView,
} from '../../packages/contracts/src/learning/index.ts';
import {
  myListHref,
  myListOffset,
  myListPageMax,
  myListPages,
  readMyList,
} from '../../apps/web/src/components/my/list-view.ts';
import {
  readWeekView,
  teacherList,
  TEACHER_PAGING,
} from '../../apps/web/src/components/teacher/list-view.ts';
import { meterPercent, meterWidthClass } from '../../apps/web/src/components/ui/meter.ts';

/**
 * The Teacher area's one address per view (R2) — PURE rules, proved here.
 *
 * WHAT IS PROVED: a teacher's lists page by Learning's own size up to the
 * teaching service's offset bound; the Course filter admits exactly the
 * Courses the page was handed (the teacher's current ones) and refuses every
 * other value — another teacher's Course, an unknown one, a malformed one,
 * a repeated one — in place, never widening to everyone; Phase 23's
 * `?offset=` and every untidy spelling are ONE redirect to the final address;
 * a week is named by its Monday, the current week by the bare address, and
 * every other spelling of a week is one redirect; a list kept on a page that
 * also shows a week carries the week in every address it builds; and a
 * meter's fill is a fixed class, never a style attribute.
 */

const STUDENTS = '/teacher/students';
const MINE = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
] as const;
const OTHER_TEACHERS = '00000000-0000-4000-8000-000000000099';

const students = teacherList(STUDENTS, { param: 'course', values: MINE });

describe('a teacher’s list pages by Learning’s own size, up to the service’s bound', () => {
  it('pages by CLASS_PAGE and stops where the teaching service stops', () => {
    expect(TEACHER_PAGING).toEqual({ size: CLASS_PAGE, offsetMax: TEACHING_OFFSET_MAX });
    expect(myListOffset(1, TEACHER_PAGING)).toBe(0);
    expect(myListOffset(3, TEACHER_PAGING)).toBe(2 * CLASS_PAGE);
    expect(myListPageMax(TEACHER_PAGING)).toBe(
      Math.floor(TEACHING_OFFSET_MAX / CLASS_PAGE) + 1,
    );
    expect(myListPages(0, TEACHER_PAGING)).toBe(1);
    expect(myListPages(CLASS_PAGE + 1, TEACHER_PAGING)).toBe(2);
    // Never more pages than the service will read.
    expect(myListPages(10_000_000, TEACHER_PAGING)).toBe(myListPageMax(TEACHER_PAGING));
  });

  it('reads canonical addresses as views', () => {
    expect(readMyList(students, {})).toEqual({
      outcome: 'view',
      view: { page: 1, filter: null },
    });
    expect(readMyList(students, { course: MINE[1], page: '2' })).toEqual({
      outcome: 'view',
      view: { page: 2, filter: MINE[1] },
    });
    expect(myListHref(students, { page: 2, filter: MINE[0] })).toBe(
      `${STUDENTS}?course=${MINE[0]}&page=2`,
    );
  });

  it.each([
    [{ page: '1' }, STUDENTS],
    [{ page: '0' }, STUDENTS],
    [{ page: 'two' }, STUDENTS],
    [{ page: '99999' }, STUDENTS],
    [{ course: '' }, STUDENTS],
    [{ course: '', page: '2' }, `${STUDENTS}?page=2`],
    [{ page: '2', course: MINE[0] }, `${STUDENTS}?course=${MINE[0]}&page=2`],
    // Phase 23's offset, read by Learning's own page.
    [{ offset: '0' }, STUDENTS],
    [{ offset: String(CLASS_PAGE) }, `${STUDENTS}?page=2`],
    [{ offset: String(CLASS_PAGE * 2 + 5) }, `${STUDENTS}?page=3`],
    [{ offset: String(TEACHING_OFFSET_MAX + 1) }, STUDENTS],
    [{ offset: 'x' }, STUDENTS],
  ])('tidies %o with ONE redirect to %s', (query, to) => {
    const first = readMyList(students, query);
    expect(first).toEqual({ outcome: 'redirect', to });
    // The redirect's target is final: it reads as a view, not another redirect.
    const search = Object.fromEntries(new URL(to, 'https://x.invalid').searchParams);
    expect(readMyList(students, search).outcome).toBe('view');
  });

  it.each([
    [{ course: OTHER_TEACHERS }, 'another teacher’s Course'],
    [{ course: 'not-a-course' }, 'a malformed Course'],
    [{ course: `${MINE[0]}0` }, 'a near-miss of one of theirs'],
    [{ course: [MINE[0], MINE[1]] }, 'a repeated Course'],
    [{ page: ['2', '3'] }, 'a repeated page'],
  ])('refuses %o (%s) in place, never widening to everyone', (query) => {
    expect(readMyList(students, query)).toEqual({ outcome: 'refused' });
  });

  it('leaves parameters the list does not read alone', () => {
    expect(readMyList(students, { utm: 'x' })).toEqual({
      outcome: 'view',
      view: { page: 1, filter: null },
    });
  });

  it('a list with no filter refuses nothing it does not read, and has no filter to choose', () => {
    const reports = teacherList<never>('/teacher/attendance/reports');
    expect(readMyList(reports, { course: MINE[0] }).outcome).toBe('view');
    expect(readMyList(reports, { page: '2' })).toEqual({
      outcome: 'view',
      view: { page: 2, filter: null },
    });
  });
});

describe('the availability windows, by what each has become', () => {
  const windows = teacherList<AvailabilityView>('/teacher/availability', {
    param: 'show',
    values: AVAILABILITY_VIEWS,
  });

  it('admits exactly open, booked and withdrawn', () => {
    expect(AVAILABILITY_VIEWS).toEqual(['open', 'booked', 'withdrawn']);
    for (const view of AVAILABILITY_VIEWS)
      expect(readMyList(windows, { show: view })).toEqual({
        outcome: 'view',
        view: { page: 1, filter: view },
      });
    for (const bad of ['Open', 'cancelled', 'all', 'open ', ['open', 'booked']])
      expect(readMyList(windows, { show: bad })).toEqual({ outcome: 'refused' });
  });
});

describe('a week is named by its Monday', () => {
  const PATH = '/teacher/calendar';
  // Saturday 21 November 2026: this week began on Monday the 16th.
  const today = '2026-11-21';

  it('reads the current week bare, and another week by its Monday', () => {
    expect(readWeekView(PATH, {}, today)).toEqual({
      outcome: 'view',
      weekStart: '2026-11-16',
      path: PATH,
    });
    expect(readWeekView(PATH, { week: '2026-11-23' }, today)).toEqual({
      outcome: 'view',
      weekStart: '2026-11-23',
      path: `${PATH}?week=2026-11-23`,
    });
  });

  it.each([
    [{ week: '2026-11-16' }, PATH, 'the current week spelled out'],
    [{ week: '2026-11-25' }, `${PATH}?week=2026-11-23`, 'another day of a week'],
    [{ week: '2026-02-30' }, PATH, 'a date that does not exist'],
    [{ week: 'next' }, PATH, 'a malformed week'],
    [{ week: '' }, PATH, 'an empty week'],
    [{ week: '2031-01-06' }, PATH, 'a week out of reach'],
    [{ week: ['2026-11-23', '2026-11-30'] }, PATH, 'a repeated week'],
  ])('tidies %o with ONE redirect to %s (%s)', (query, to) => {
    const read = readWeekView(PATH, query, today);
    expect(read).toMatchObject({ outcome: 'redirect', path: to });
    const again = Object.fromEntries(new URL(to, 'https://x.invalid').searchParams);
    expect(readWeekView(PATH, again, today).outcome).toBe('view');
  });

  it('keeps the week in every address a list on the same page builds', () => {
    const week = readWeekView('/teacher/availability', { week: '2026-11-23' }, today);
    const spec = teacherList<AvailabilityView>(week.path, {
      param: 'show',
      values: AVAILABILITY_VIEWS,
    });
    expect(myListHref(spec, { page: 2, filter: 'open' })).toBe(
      '/teacher/availability?week=2026-11-23&show=open&page=2',
    );
    expect(myListHref(spec, { page: 1, filter: null })).toBe(
      '/teacher/availability?week=2026-11-23',
    );
    expect(readMyList(spec, { week: '2026-11-23', show: 'open', page: '2' })).toEqual({
      outcome: 'view',
      view: { page: 2, filter: 'open' },
    });
    expect(readMyList(spec, { week: '2026-11-23', offset: '24' })).toEqual({
      outcome: 'redirect',
      to: '/teacher/availability?week=2026-11-23&page=2',
    });
  });
});

describe('a meter’s fill is a class from a fixed table', () => {
  it('rounds to the nearest five percent and clamps', () => {
    expect(meterWidthClass(0)).toBe('w-0');
    expect(meterWidthClass(100)).toBe('w-full');
    expect(meterWidthClass(42)).toBe('w-[40%]');
    expect(meterWidthClass(43)).toBe('w-[45%]');
    expect(meterWidthClass(-10)).toBe('w-0');
    expect(meterWidthClass(250)).toBe('w-full');
    expect(meterWidthClass(Number.NaN)).toBe('w-0');
  });

  it('says how far through something is, never past its whole', () => {
    expect(meterPercent(3, 10)).toBe(30);
    expect(meterPercent(12, 10)).toBe(100);
    expect(meterPercent(-1, 10)).toBe(0);
    expect(meterPercent(1, 0)).toBe(0);
  });
});
