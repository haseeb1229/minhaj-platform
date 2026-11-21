import { CLASS_PAGE, TEACHING_OFFSET_MAX } from '@minhaj/contracts/learning';

import type { MyListPaging, MyListSpec } from '@/components/my/list-view';
import { readWeek, weekHref } from './week';

/**
 * ONE ADDRESS PER VIEW IN THE TEACHER AREA (R2) — PURE, so every rule is
 * proved by unit test.
 *
 * THE LISTS ARE MY MINHAJ'S. A teacher's learners, classes to mark, past
 * classes and availability windows are paged and filtered by the same rules
 * as a My Minhaj list (`@/components/my/list-view`): `?page=` (the first page
 * is the address without it), one filter parameter where the list has one,
 * the legacy `?offset=` read by the list's own page, every untidy spelling
 * ONE redirect after the session and the teacher's role are resolved, and an
 * unknown filter or a repeated parameter refused in place, never widened.
 * They page by Learning's own size (`CLASS_PAGE`) up to the teaching
 * service's offset bound (`TEACHING_OFFSET_MAX`).
 *
 * A FILTER IS A READ, NEVER AUTHORITY. `?course=` admits only the Courses the
 * teacher teaches NOW (the page passes them in); one they do not teach is
 * refused in place exactly like one that does not exist, and the service and
 * adapter re-check the scope on every read regardless.
 *
 * THE WEEK. `?week=` names a week by its Monday; the current week is the
 * address without it. Any other date of a week, the current week spelled out,
 * a date out of reach, a malformed or repeated value is ONE redirect to the
 * week's own address — a calendar has no "refused" view, only weeks.
 */

type Query = Record<string, string | string[] | undefined>;

/** How every Teacher-area list pages: Learning's page, the teaching service's bound. */
export const TEACHER_PAGING: MyListPaging = Object.freeze({
  size: CLASS_PAGE,
  offsetMax: TEACHING_OFFSET_MAX,
});

/** A Teacher-area list at `path`, optionally filtered by `param` over `filters`. */
export function teacherList<F extends string>(
  path: string,
  filter?: { readonly param: string; readonly values: readonly F[] },
): MyListSpec<F> {
  return {
    path,
    ...TEACHER_PAGING,
    ...(filter === undefined ? {} : { param: filter.param, filters: filter.values }),
  };
}

export type WeekRead =
  | { readonly outcome: 'view'; readonly weekStart: string; readonly path: string }
  | { readonly outcome: 'redirect'; readonly weekStart: string; readonly path: string };

/**
 * The week a request asks for and that week's canonical address (`path`), or
 * the one redirect to it. Parameters other than `week` are left alone.
 */
export function readWeekView(path: string, query: Query, today: string): WeekRead {
  const raw = query['week'];
  if (Array.isArray(raw)) {
    const weekStart = readWeek(null, today);
    return { outcome: 'redirect', weekStart, path: weekHref(path, weekStart, today) };
  }
  const weekStart = readWeek(raw ?? null, today);
  const canonical = weekHref(path, weekStart, today);
  const asked = raw === undefined ? path : `${path}?week=${raw}`;
  return asked === canonical
    ? { outcome: 'view', weekStart, path: canonical }
    : { outcome: 'redirect', weekStart, path: canonical };
}
