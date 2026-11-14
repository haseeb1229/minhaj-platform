import {
  COURSE_FORMATS,
  COURSE_LEVELS,
  TOPIC_COURSES_PAGE,
  type CourseFormat,
  type CourseLevel,
  type TopicCourseSort,
} from '@minhaj/contracts/learning';
import { personSlugSchema } from '@minhaj/contracts/people';
import { topicSlugSchema } from '@minhaj/contracts/taxonomy';

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
 *
 * LEARN PART 1 — THE CATALOGUE IS THE SAME LISTING WITHOUT A TOPIC SCOPE
 * (`/learn/courses`, `LEARN_COURSES`). Its address keeps what Learning's
 * catalogue has always taken (ROUTE_MAP.md §3.5): `?topic` a Topic SLUG and
 * `?teacher` a People SLUG — slugs, never identifiers, resolved at Layer 4 —
 * and it keeps the catalogue's own rule that an unknown filter NEVER
 * BROADENS: a malformed or repeated filter is not dropped but reported
 * (`readCatalogueQuery`), so the page explains an empty result rather than
 * redirecting to every Course. A former `?offset=` (24 Courses a page until
 * Learn Part 1) is one redirect to the page holding the Course it began with.
 */

export interface CoursesScope {
  /** The listing's locale-free path: `/quran/courses`, `/hadith/courses`, `/learn/courses`. */
  readonly path: string;
  /** The whole catalogue (Learn Part 1): the Topic a filter, slugs in the address. */
  readonly catalogue?: true;
}

/** Learning's own catalogue (ROUTE_MAP.md §3.5). */
export const LEARN_COURSES: CoursesScope = Object.freeze({
  path: '/learn/courses',
  catalogue: true,
});

/** The deepest page an address may name: Learning's offset bound, in pages. */
export const COURSES_MAX_PAGE = Math.floor(25_000 / TOPIC_COURSES_PAGE) + 1;

export interface CoursesQuery {
  readonly format: CourseFormat | null;
  /** The catalogue's Topic filter, a Topic slug; always null on a hub. */
  readonly topic: string | null;
  readonly level: CourseLevel | null;
  readonly language: string | null;
  /**
   * Attributed as a teacher: a People identifier on a hub, a People slug in
   * the catalogue (its address's long-standing form).
   */
  readonly teacher: string | null;
  readonly sort: TopicCourseSort;
  /** 1-based. */
  readonly page: number;
}

export const DEFAULT_COURSES_QUERY: CoursesQuery = Object.freeze({
  format: null,
  topic: null,
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

function sortOf(query: Query): TopicCourseSort {
  const sortText = single(query, 'sort', 16);
  return sortText === 'newest' || sortText === 'title' ? sortText : 'level';
}

/** The hub's view from its address — every unknown or malformed value neutral. */
export function readCoursesQuery(query: Query): CoursesQuery {
  return {
    format: oneOf(COURSE_FORMATS, single(query, 'format', 16)),
    topic: null,
    level: oneOf(COURSE_LEVELS, single(query, 'level', 16)),
    language: language(query),
    teacher: identifier(query, 'teacher'),
    sort: sortOf(query),
    page: whole(single(query, 'page', 5), 1, COURSES_MAX_PAGE) ?? 1,
  };
}

/** A slug exactly as its owner's grammar writes it — never trimmed into validity. */
function slugOf(
  schema: typeof topicSlugSchema | typeof personSlugSchema,
  text: string,
): string | null {
  const parsed = schema.safeParse(text);
  return parsed.success && parsed.data === text ? text : null;
}

/** The deepest former `?offset=` an address may carry (Learning's offset bound). */
const LEGACY_MAX_OFFSET = 25_000;

/**
 * The page a former `?offset=` named — the page holding the first Course it
 * showed — or null when there is none or it is not a plain bounded number.
 */
function legacyPage(query: Query): number | null {
  const text = single(query, 'offset', 6);
  if (text === null || !/^\d{1,6}$/u.test(text)) return null;
  const offset = Number(text);
  return offset <= LEGACY_MAX_OFFSET ? Math.floor(offset / TOPIC_COURSES_PAGE) + 1 : null;
}

/**
 * The catalogue's view from its address, and whether a filter in it is
 * malformed or repeated — which the page answers with an explained empty
 * result, never by dropping the filter (an unknown filter never broadens).
 * The order and the page stay tolerant, as on a hub: a wrong one is neutral.
 */
export function readCatalogueQuery(query: Query): {
  readonly query: CoursesQuery;
  readonly invalid: boolean;
} {
  let invalid = false;
  /** One filter: absent (or empty, as a form submits it), a value, or invalid. */
  const filter = <T>(key: string, parse: (text: string) => T | null): T | null => {
    const raw = query[key];
    if (raw === undefined || raw === '') return null;
    const value = typeof raw === 'string' ? parse(raw) : null;
    if (value === null) invalid = true;
    return value;
  };
  const view: CoursesQuery = {
    format: filter('format', (text) => oneOf(COURSE_FORMATS, text)),
    topic: filter('topic', (text) => slugOf(topicSlugSchema, text)),
    level: filter('level', (text) => oneOf(COURSE_LEVELS, text)),
    language: filter('language', (text) => language({ language: text })),
    teacher: filter('teacher', (text) => slugOf(personSlugSchema, text)),
    sort: sortOf(query),
    page:
      whole(single(query, 'page', 5), 1, COURSES_MAX_PAGE) ??
      Math.min(legacyPage(query) ?? 1, COURSES_MAX_PAGE),
  };
  return { query: view, invalid };
}

/** Whether anything narrows the view — a format, a Topic, a level, a language or a teacher. */
export function coursesFiltered(query: CoursesQuery): boolean {
  return (
    query.format !== null ||
    query.topic !== null ||
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
  if (next.topic !== null) search.set('topic', next.topic);
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

/** …and of the catalogue, which also reads its Topic and its former offset. */
const CATALOGUE_KEYS: ReadonlySet<string> = new Set([...VIEW_KEYS, 'topic', 'offset']);

/**
 * ONE ADDRESS PER VIEW. A filter form submits every control, so choosing a
 * teacher arrives as `?level=&language=&teacher=…&sort=level`; a typed or old
 * link may carry a malformed value or a different order. Each is answered
 * with ONE redirect to the view's canonical address (`coursesHref`), built
 * from the parsed view — never from the typed text — or `null` when the
 * request already is that address. Parameters the hub does not read (such as
 * the former related view's `?offset=`) are left alone unless a redirect
 * happens anyway.
 *
 * In the catalogue a view naming a malformed filter is NOT redirected — it
 * stays where it was asked and says why it lists nothing — and its former
 * `?offset=` is one of its own parameters, answered with the page.
 */
export function coursesCanonicalRedirect(
  scope: CoursesScope,
  locale: string,
  query: Query,
): string | null {
  if (scope.catalogue === true) {
    const read = readCatalogueQuery(query);
    return read.invalid
      ? null
      : unlessCanonical(
          locale,
          scope.path,
          query,
          CATALOGUE_KEYS,
          coursesHref(scope, locale, read.query),
        );
  }
  return unlessCanonical(
    locale,
    scope.path,
    query,
    VIEW_KEYS,
    coursesHref(scope, locale, readCoursesQuery(query)),
  );
}

/** What Learning is asked for one hub view (the Topic resolved at Layer 4). */
export function coursesReadQuery(
  query: CoursesQuery,
  topic: string | null,
  titleLocale: string,
): Record<string, unknown> {
  return {
    scope: 'topic',
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

/**
 * What Learning is asked for one CATALOGUE view: the Topic and the teacher
 * are the identifiers their owners resolved the address's slugs to at
 * Layer 4 — never the slugs themselves.
 */
export function catalogueReadQuery(
  query: CoursesQuery,
  resolved: { readonly topic: string | null; readonly teacher: string | null },
  titleLocale: string,
): Record<string, unknown> {
  return {
    ...coursesReadQuery(query, resolved.topic, titleLocale),
    scope: 'catalogue',
    teacher: resolved.teacher,
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
