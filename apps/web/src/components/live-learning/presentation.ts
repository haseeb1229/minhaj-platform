import { learningLanguageCodeSchema } from '@minhaj/contracts/learning';
import { zonedIso } from '@minhaj/contracts/platform';
import { topicSlugSchema } from '@minhaj/contracts/taxonomy';

import { readAvailabilityFilter } from '@/contexts/learning';
import {
  learnPath,
  readLearnOffset,
  type Filter,
} from '@/components/learning/presentation';

/**
 * Presentation decisions for the public live-learning surfaces — `/learn/live`
 * and `/learn/teachers` — PURE and free of React (ROUTE_MAP.md §3.5;
 * DELIVERY_PLAN.md Phase 23).
 *
 * Which filters and offset a URL asks for, how one directory view is spelled,
 * and how a scheduled class states its time. Each has ONE implementation, so
 * the page, its pager and its "clear" link cannot spell a view two ways.
 *
 * AN UNKNOWN FILTER NEVER BROADENS. A subject, language or availability word
 * a visitor typed that does not parse is reported INVALID — the directory then
 * lists nothing and says why — never quietly dropped into the unfiltered
 * listing (the Phase-22 catalogue precedent).
 */

type Query = Record<string, string | string[] | undefined>;

/** One parameter as one string; a repeated parameter is its first value. */
function single(query: Query, name: string): string | null {
  const value = query[name];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? first : null;
}

/* ===========================================================================
 * Addresses
 * ========================================================================= */

export function liveSchedulePath(locale: string): string {
  return learnPath(locale, 'live');
}

export function teacherDirectoryPath(locale: string): string {
  return learnPath(locale, 'teachers');
}

/** The canonical public profile of a teacher, by their People slug. */
export function teacherProfileHref(locale: string, slug: string): string {
  return `/${locale}/people/${encodeURIComponent(slug)}`;
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

/** A slug exactly as the owner's grammar writes it — no trimming into validity. */
function slugFilter(raw: string | null): Filter<string> {
  if (raw === null || raw === '') return { state: 'none' };
  const parsed = topicSlugSchema.safeParse(raw);
  return parsed.success && parsed.data === raw
    ? { state: 'value', value: raw }
    : { state: 'invalid' };
}

function languageFilter(raw: string | null): Filter<string> {
  if (raw === null || raw === '') return { state: 'none' };
  return learningLanguageCodeSchema.safeParse(raw).success
    ? { state: 'value', value: raw }
    : { state: 'invalid' };
}

/** Everything `/learn/teachers` reads from its query string, and nothing else. */
export function readTeacherDirectoryQuery(query: Query): TeacherDirectoryQuery {
  return {
    subject: slugFilter(single(query, 'subject')),
    language: languageFilter(single(query, 'language')),
    availability: readAvailabilityFilter(single(query, 'availability')),
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
  const encoded = search.toString();
  const base = teacherDirectoryPath(locale);
  return encoded === '' ? base : `${base}?${encoded}`;
}

/* ===========================================================================
 * `/learn/live?offset=`
 * ========================================================================= */

/** The schedule's offset: the catalogue's reader bound applies to this reader too. */
export function readLiveOffset(query: Query): number {
  return readLearnOffset(query);
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
