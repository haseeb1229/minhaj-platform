import { localizedPath } from '@minhaj/contracts';
import {
  learningLanguageCodeSchema,
  learningSlugSchema,
} from '@minhaj/contracts/learning';
import { zonedIso } from '@minhaj/contracts/platform';
import { personSlugSchema } from '@minhaj/contracts/people';
import { topicSlugSchema } from '@minhaj/contracts/taxonomy';

import { readAvailabilityFilter } from '@/contexts/learning';
import {
  learnPath,
  readLearnOffset,
  type Filter,
} from '@/components/learning/presentation';
import { hubHref, unlessCanonical } from '@/components/topic-hub/address';

/**
 * Presentation decisions for the public live-learning surfaces — `/learn/live`
 * and `/learn/teachers` — PURE and free of React (ROUTE_MAP.md §3.5;
 * DELIVERY_PLAN.md Phase 23; Learn Part 2).
 *
 * Which filters and offset a URL asks for, how one view is spelled, and how a
 * scheduled class states its time. Each has ONE implementation, so the page,
 * its form, its pager, its chips and its "clear" link cannot spell a view two
 * ways.
 *
 * AN UNKNOWN FILTER NEVER BROADENS. A value a visitor typed that does not
 * parse — or a filter given twice — is reported INVALID: the page then lists
 * nothing and says why, and is answered where it was asked, never redirected
 * into the unfiltered listing (the Phase-22 catalogue precedent, kept by Learn
 * Part 1). A VALID view has ONE address (Learn Part 2): a form's empty
 * controls, another order of the same filters or a zero offset is one redirect
 * to the canonical spelling.
 */

type Query = Record<string, string | string[] | undefined>;

/**
 * One filter as the URL gives it: absent (or empty — a form's unchosen
 * control), a value the owner's grammar accepts exactly, or invalid — which a
 * repeated parameter always is.
 */
function filterOf(
  query: Query,
  name: string,
  accepts: (raw: string) => boolean,
): Filter<string> {
  const raw = query[name];
  if (raw === undefined || raw === '') return { state: 'none' };
  if (Array.isArray(raw)) return { state: 'invalid' };
  return accepts(raw) ? { state: 'value', value: raw } : { state: 'invalid' };
}

/** A grammar check that takes a value only exactly as written — no trimming into validity. */
function exactly(schema: {
  safeParse(raw: unknown): { success: boolean; data?: unknown };
}): (raw: string) => boolean {
  return (raw) => {
    const parsed = schema.safeParse(raw);
    return parsed.success && parsed.data === raw;
  };
}

/* ===========================================================================
 * Addresses
 * ========================================================================= */

/** The locale-free path of the public schedule. */
const LIVE = '/learn/live';
/** The locale-free path of the teacher directory. */
const TEACHERS = '/learn/teachers';

export function liveSchedulePath(locale: string): string {
  return learnPath(locale, 'live');
}

export function teacherDirectoryPath(locale: string): string {
  return learnPath(locale, 'teachers');
}

/** The canonical public profile of a teacher, by their People slug. */
export function teacherProfileHref(locale: string, slug: string): string {
  return localizedPath(locale, `/people/${encodeURIComponent(slug)}`);
}

/* ===========================================================================
 * `/learn/teachers?subject=&language=&availability=`
 * ========================================================================= */

export interface TeacherDirectoryQuery {
  /** A Topic slug — Taxonomy resolves it, never Learning. */
  readonly subject: Filter<string>;
  /** A Taxonomy content-language code, never an interface locale. */
  readonly language: Filter<string>;
  /** The one word Learning's vocabulary admits: `available`. */
  readonly availability: Filter<'available'>;
}

const TEACHER_KEYS: ReadonlySet<string> = new Set([
  'subject',
  'language',
  'availability',
]);

/** Everything `/learn/teachers` reads from its query string, and nothing else. */
export function readTeacherDirectoryQuery(query: Query): TeacherDirectoryQuery {
  const availability = query['availability'];
  return {
    subject: filterOf(query, 'subject', exactly(topicSlugSchema)),
    language: filterOf(query, 'language', exactly(learningLanguageCodeSchema)),
    availability: Array.isArray(availability)
      ? { state: 'invalid' }
      : readAvailabilityFilter(availability ?? null),
  };
}

/** Is any filter of this directory query malformed? Then nothing is listed. */
export function isInvalidTeacherDirectory(query: TeacherDirectoryQuery): boolean {
  return [query.subject, query.language, query.availability].some(
    (filter) => filter.state === 'invalid',
  );
}

/** Is any filter set? Decides which empty state is true. */
export function isFilteredTeacherDirectory(query: TeacherDirectoryQuery): boolean {
  return [query.subject, query.language, query.availability].some(
    (filter) => filter.state !== 'none',
  );
}

/** A directory view as the address names it — slugs and codes, never identifiers. */
export interface TeacherDirectoryView {
  readonly subject?: string | null;
  readonly language?: string | null;
  readonly availability?: 'available' | null;
}

/**
 * A directory view's address. Filters appear in one fixed order and only when
 * set, so one view has one spelling.
 */
export function teacherDirectoryHref(
  locale: string,
  view: TeacherDirectoryView = {},
): string {
  const search = new URLSearchParams();
  if (view.subject) search.set('subject', view.subject);
  if (view.language) search.set('language', view.language);
  if (view.availability) search.set('availability', view.availability);
  return hubHref(locale, TEACHERS, search);
}

/** The value of each filter the directory query holds. */
function teacherViewOf(query: TeacherDirectoryQuery): TeacherDirectoryView {
  const value = <T>(filter: Filter<T>): T | null =>
    filter.state === 'value' ? filter.value : null;
  return {
    subject: value(query.subject),
    language: value(query.language),
    availability: value(query.availability),
  };
}

/**
 * The ONE redirect a directory address may need: to its canonical spelling,
 * or `null` when it already is — and always `null` while a filter is invalid,
 * which is answered in place.
 */
export function teacherDirectoryCanonicalRedirect(
  locale: string,
  query: Query,
): string | null {
  const read = readTeacherDirectoryQuery(query);
  if (isInvalidTeacherDirectory(read)) return null;
  return unlessCanonical(
    locale,
    TEACHERS,
    query,
    TEACHER_KEYS,
    teacherDirectoryHref(locale, teacherViewOf(read)),
  );
}

/* ===========================================================================
 * `/learn/live?course=&teacher=&language=&offset=` (Learn Part 2)
 * ========================================================================= */

export interface ScheduleQuery {
  /** A Course's current slug — Learning resolves it. */
  readonly course: Filter<string>;
  /** A teacher's People slug — never an account identifier. */
  readonly teacher: Filter<string>;
  /** A Taxonomy content-language code: the Course's, never the interface locale. */
  readonly language: Filter<string>;
  readonly offset: number;
}

const SCHEDULE_KEYS: ReadonlySet<string> = new Set([
  'course',
  'teacher',
  'language',
  'offset',
]);

/** Everything `/learn/live` reads from its query string, and nothing else. */
export function readScheduleQuery(query: Query): ScheduleQuery {
  return {
    course: filterOf(query, 'course', exactly(learningSlugSchema)),
    teacher: filterOf(query, 'teacher', exactly(personSlugSchema)),
    language: filterOf(query, 'language', exactly(learningLanguageCodeSchema)),
    offset: readLearnOffset(query),
  };
}

/** Is any filter of this schedule query malformed? Then nothing is listed. */
export function isInvalidSchedule(query: ScheduleQuery): boolean {
  return [query.course, query.teacher, query.language].some(
    (filter) => filter.state === 'invalid',
  );
}

/** Is any filter set? Decides which empty state is true and what the figures say. */
export function isFilteredSchedule(query: ScheduleQuery): boolean {
  return [query.course, query.teacher, query.language].some(
    (filter) => filter.state !== 'none',
  );
}

/** A schedule view as the address names it — slugs and codes, never identifiers. */
export interface ScheduleView {
  readonly course?: string | null;
  readonly teacher?: string | null;
  readonly language?: string | null;
  readonly offset?: number;
}

/**
 * A schedule view's address: the filters in one fixed order, each only when
 * set, and the offset only past the first page — so one view has one spelling.
 */
export function scheduleHref(locale: string, view: ScheduleView = {}): string {
  const search = new URLSearchParams();
  if (view.course) search.set('course', view.course);
  if (view.teacher) search.set('teacher', view.teacher);
  if (view.language) search.set('language', view.language);
  if (view.offset !== undefined && view.offset > 0)
    search.set('offset', String(view.offset));
  return hubHref(locale, LIVE, search);
}

/** The view a schedule query names, its invalid filters left out. */
export function scheduleViewOf(query: ScheduleQuery): Required<ScheduleView> {
  const value = (filter: Filter<string>): string | null =>
    filter.state === 'value' ? filter.value : null;
  return {
    course: value(query.course),
    teacher: value(query.teacher),
    language: value(query.language),
    offset: query.offset,
  };
}

/**
 * The ONE redirect a schedule address may need: to its canonical spelling, or
 * `null` when it already is — and always `null` while a filter is invalid,
 * which is answered in place.
 */
export function scheduleCanonicalRedirect(locale: string, query: Query): string | null {
  const read = readScheduleQuery(query);
  if (isInvalidSchedule(read)) return null;
  return unlessCanonical(
    locale,
    LIVE,
    query,
    SCHEDULE_KEYS,
    scheduleHref(locale, scheduleViewOf(read)),
  );
}

/* ===========================================================================
 * A class's time, as a page states it
 * ========================================================================= */

/**
 * The `dateTime` of a `<time>` for a scheduled class: its stored LOCAL time in
 * its scheduling zone with that zone's offset at the instant — so the machine
 * reading and the words beside it name the same wall-clock time.
 */
export function classTimeIso(local: string, instant: Date): string {
  return zonedIso(local, instant);
}

/**
 * The words for one instant in one zone, for the reader's locale — with the
 * zone NAMED, because a time without its zone is a guess for a reader in
 * another one. `null` when the zone is one this runtime cannot format, which
 * never throws a page.
 */
export function formatClassTime(
  instant: Date,
  timeZone: string,
  locale: string,
  options: { readonly date: boolean } = { date: true },
): string | null {
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone,
      ...(options.date ? { year: 'numeric', month: 'long', day: 'numeric' } : {}),
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(instant);
  } catch {
    return null;
  }
}

/**
 * The calendar day a class starts on IN ITS OWN ZONE, `YYYY-MM-DD` — the
 * stored wall-clock start's date, so the server groups a schedule without
 * guessing a reader's zone.
 */
export function classDay(local: string): string {
  return local.slice(0, 10);
}
