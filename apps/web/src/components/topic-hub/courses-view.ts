import {
  COURSE_FORMATS,
  COURSE_LEVELS,
  TOPIC_COURSES_PAGE,
  type CourseFormat,
  type CourseLevel,
  type TopicCourseSort,
} from '@minhaj/contracts/learning';

import {
  hubHref,
  identifier,
  language,
  pageCount,
  pageRange,
  single,
  unlessCanonical,
  whole,
  type Query,
} from './address';

/**
 * A COURSES HUB'S RULES (Quran Part 13; any subject's since Hadith Part 1) —
 * pure, so the address a filter form submits, the address a tab, a chip or a
 * pager link builds and the query Learning is asked are ONE definition,
 * proved by unit test. The tolerant readers and the one-address rule are the
 * hubs' shared ones (`./address`).
 *
 * THE ADDRESS IS THE STATE. Every view of a hub — a format, a level, a
 * content language, a teacher, an order, a page — is a GET address that works
 * without script and can be shared; neutral values are omitted, so the
 * unfiltered hub has exactly one address (its scope's `path`), the canonical
 * one.
 *
 * TOLERANT, NEVER TRUSTING. A malformed or repeated parameter is dropped
 * rather than answered with an error page; what this produces is parsed again
 * by Learning's read service (`topicCourseQuerySchema`), the authoritative
 * boundary, and no parameter can widen what is public.
 */

export interface CoursesScope {
  /** The hub's locale-free path: `/quran/courses`, `/hadith/courses`. */
  readonly path: string;
}

/** The deepest page an address may name: Learning's offset bound, in pages. */
export const COURSES_MAX_PAGE = Math.floor(25_000 / TOPIC_COURSES_PAGE) + 1;

export interface CoursesQuery {
  readonly format: CourseFormat | null;
  readonly level: CourseLevel | null;
  readonly language: string | null;
  /** A People identifier attributed as a teacher. */
  readonly teacher: string | null;
  readonly sort: TopicCourseSort;
  /** 1-based. */
  readonly page: number;
}

export const DEFAULT_COURSES_QUERY: CoursesQuery = Object.freeze({
  format: null,
  level: null,
  language: null,
  teacher: null,
  sort: 'level',
  page: 1,
});

function oneOf<T extends string>(values: readonly T[], text: string | null): T | null {
  return text !== null && (values as readonly string[]).includes(text)
    ? (text as T)
    : null;
}

/** The hub's view from its address — every unknown or malformed value neutral. */
export function readCoursesQuery(query: Query): CoursesQuery {
  const sortText = single(query, 'sort', 16);
  return {
    format: oneOf(COURSE_FORMATS, single(query, 'format', 16)),
    level: oneOf(COURSE_LEVELS, single(query, 'level', 16)),
    language: language(query),
    teacher: identifier(query, 'teacher'),
    sort: sortText === 'newest' || sortText === 'title' ? sortText : 'level',
    page: whole(single(query, 'page', 5), 1, COURSES_MAX_PAGE) ?? 1,
  };
}

/** Whether anything narrows the hub — a format, a level, a language or a teacher. */
export function coursesFiltered(query: CoursesQuery): boolean {
  return (
    query.format !== null ||
    query.level !== null ||
    query.language !== null ||
    query.teacher !== null
  );
}

/**
 * The address of a view. Changing anything but the page returns to the
 * first page — page 7 of another result set means nothing.
 */
export function coursesHref(
  scope: CoursesScope,
  locale: string,
  query: CoursesQuery,
  change: Partial<CoursesQuery> = {},
): string {
  const next = { ...query, ...change };
  const page = change.page ?? (Object.keys(change).length === 0 ? query.page : 1);
  const search = new URLSearchParams();
  if (next.format !== null) search.set('format', next.format);
  if (next.level !== null) search.set('level', next.level);
  if (next.language !== null) search.set('language', next.language);
  if (next.teacher !== null) search.set('teacher', next.teacher);
  if (next.sort !== 'level') search.set('sort', next.sort);
  if (page > 1) search.set('page', String(page));
  return hubHref(locale, scope.path, search);
}

/** The parameters a view of the hub is spelled with. */
const VIEW_KEYS: ReadonlySet<string> = new Set([
  'format',
  'level',
  'language',
  'teacher',
  'sort',
  'page',
]);

/**
 * ONE ADDRESS PER VIEW. A filter form submits every control, so choosing a
 * teacher arrives as `?level=&language=&teacher=…&sort=level`; a typed or old
 * link may carry a malformed value or a different order. Each is answered
 * with ONE redirect to the view's canonical address (`coursesHref`), built
 * from the parsed view — never from the typed text — or `null` when the
 * request already is that address. Parameters the hub does not read (such as
 * the former related view's `?offset=`) are left alone unless a redirect
 * happens anyway.
 */
export function coursesCanonicalRedirect(
  scope: CoursesScope,
  locale: string,
  query: Query,
): string | null {
  return unlessCanonical(
    locale,
    scope.path,
    query,
    VIEW_KEYS,
    coursesHref(scope, locale, readCoursesQuery(query)),
  );
}

/** What Learning is asked for one view (the Topic resolved at Layer 4). */
export function coursesReadQuery(
  query: CoursesQuery,
  topic: string | null,
  titleLocale: string,
): Record<string, unknown> {
  return {
    topic,
    format: query.format,
    level: query.level,
    language: query.language,
    teacher: query.teacher,
    sort: query.sort,
    titleLocale,
    offset: (query.page - 1) * TOPIC_COURSES_PAGE,
    limit: TOPIC_COURSES_PAGE,
  };
}

/** How many pages a total fills; at least one. */
export function coursesPageCount(total: number): number {
  return pageCount(total, TOPIC_COURSES_PAGE);
}

/** "13–24" of a page, or null when the page holds nothing. */
export function coursesRange(
  page: number,
  shown: number,
): { readonly from: number; readonly to: number } | null {
  return pageRange(page, shown, TOPIC_COURSES_PAGE);
}

/**
 * A page of Courses grouped by level, in the order given (the hub's level
 * order): a new group each time the level changes, so the listing reads from
 * the first steps to the most advanced. Nothing is re-sorted; Courses whose
 * level is not stated form their own group, where the order put them.
 */
export function byLevel<T extends { readonly level: CourseLevel | null }>(
  items: readonly T[],
): { readonly level: CourseLevel | null; readonly items: readonly T[] }[] {
  const groups: { level: CourseLevel | null; items: T[] }[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last !== undefined && last.level === item.level) last.items.push(item);
    else groups.push({ level: item.level, items: [item] });
  }
  return groups;
}

/** How many of a level's steps a level fills, for its three-step mark. */
export function levelSteps(level: CourseLevel): number {
  return COURSE_LEVELS.indexOf(level) + 1;
}
