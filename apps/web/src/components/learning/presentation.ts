import type { Locale } from '@minhaj/contracts';
import {
  COURSE_FORMATS,
  COURSE_LEVELS,
  learningLanguageCodeSchema,
  type CourseFormat,
  type CourseLabel,
  type CourseLevel,
  type OutlineLabel,
} from '@minhaj/contracts/learning';
import { personSlugSchema } from '@minhaj/contracts/people';
import { topicSlugSchema } from '@minhaj/contracts/taxonomy';

import { coursePath, learningPathPath } from '@/contexts/learning';

/**
 * Presentation decisions for the public Learn surfaces — PURE and free of React
 * (ROUTE_MAP.md §3.5; Phase 22).
 *
 * Which address a Course, a LearningPath or a catalogue view has; which filters
 * and offset a URL asks for; which label a page renders and which interface
 * locales a record genuinely has words in. Each has ONE implementation: the
 * pages, the sitemap, the redirect proxy and the related views all call these,
 * so no two can spell an address differently.
 *
 * AN UNKNOWN FILTER NEVER BROADENS. A topic, teacher, level, format or language
 * a visitor typed that does not parse is reported as INVALID — never quietly
 * dropped — so the catalogue shows an empty, explained result rather than
 * every Course (the Fatwa precedent, `@/components/fatwa/presentation`).
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

/** The Learn section address under a locale: `/{locale}/learn[/{section}]`. */
export function learnPath(locale: string, section = ''): string {
  return section === '' ? `/${locale}/learn` : `/${locale}/learn/${section}`;
}

/** The LOCALE-FREE canonical address of one published Course. */
export function coursePathOf(slug: string): string {
  return coursePath(slug);
}

export function courseHref(locale: string, slug: string): string {
  return `/${locale}${coursePathOf(slug)}`;
}

/** The LOCALE-FREE canonical address of one published LearningPath. */
export function learningPathPathOf(slug: string): string {
  return learningPathPath(slug);
}

export function learningPathHref(locale: string, slug: string): string {
  return `/${locale}${learningPathPathOf(slug)}`;
}

/** A paged listing address: the first page is the bare address. */
export function offsetHref(path: string, offset: number): string {
  return offset <= 0 ? path : `${path}?offset=${String(offset)}`;
}

/* ===========================================================================
 * Browsing — `/learn/courses?topic=&level=&language=&format=&teacher=&offset=`
 * ========================================================================= */

/** The deepest page a public Learning read accepts (`courseQuerySchema`). */
export const LEARNING_MAX_OFFSET = 25_000;

/**
 * One filter as a URL gives it: absent, a well-formed value, or malformed.
 * Malformed is kept distinct from absent so it can never broaden.
 */
export type Filter<T> =
  | { readonly state: 'none' }
  | { readonly state: 'value'; readonly value: T }
  | { readonly state: 'invalid' };

export interface CourseBrowseQuery {
  /** A Topic slug — Taxonomy resolves it, never Learning. */
  readonly topic: Filter<string>;
  readonly level: Filter<CourseLevel>;
  /** A Taxonomy content-language code, never an interface locale. */
  readonly language: Filter<string>;
  readonly format: Filter<CourseFormat>;
  /** A People slug — People resolves it, never Learning. */
  readonly teacher: Filter<string>;
  readonly offset: number;
}

function readFilter<T extends string>(
  query: Query,
  name: string,
  valid: (value: string) => value is T,
): Filter<T> {
  const raw = single(query, name);
  if (raw === null || raw === '') return { state: 'none' };
  return valid(raw) ? { state: 'value', value: raw } : { state: 'invalid' };
}

/** A slug exactly as the owner's grammar writes it — no trimming into validity. */
const slugOk =
  (schema: typeof topicSlugSchema) =>
  (value: string): value is string => {
    const parsed = schema.safeParse(value);
    return parsed.success && parsed.data === value;
  };

const levelOk = (value: string): value is CourseLevel =>
  (COURSE_LEVELS as readonly string[]).includes(value);

const formatOk = (value: string): value is CourseFormat =>
  (COURSE_FORMATS as readonly string[]).includes(value);

const languageOk = (value: string): value is string =>
  learningLanguageCodeSchema.safeParse(value).success;

/** A plain `?offset=`, bounded by the reader's ceiling; anything else is 0. */
export function readLearnOffset(query: Query): number {
  const raw = single(query, 'offset');
  if (raw === null || !/^\d{1,6}$/.test(raw)) return 0;
  const value = Number(raw);
  return value <= LEARNING_MAX_OFFSET ? value : 0;
}

/** Everything `/learn/courses` reads from its query string, and nothing else. */
export function readCourseBrowse(query: Query): CourseBrowseQuery {
  return {
    topic: readFilter(query, 'topic', slugOk(topicSlugSchema)),
    level: readFilter(query, 'level', levelOk),
    language: readFilter(query, 'language', languageOk),
    format: readFilter(query, 'format', formatOk),
    teacher: readFilter(query, 'teacher', slugOk(personSlugSchema)),
    offset: readLearnOffset(query),
  };
}

/** Is any filter of this browse query malformed? Then nothing is listed. */
export function isInvalidCourseBrowse(query: CourseBrowseQuery): boolean {
  return [query.topic, query.level, query.language, query.format, query.teacher].some(
    (filter) => filter.state === 'invalid',
  );
}

/** Is any filter set? Decides which empty state is true. */
export function isFilteredCourseBrowse(query: CourseBrowseQuery): boolean {
  return [query.topic, query.level, query.language, query.format, query.teacher].some(
    (filter) => filter.state !== 'none',
  );
}

/** The value a filter holds, or `null` when it holds none. */
export function filterValue<T>(filter: Filter<T>): T | null {
  return filter.state === 'value' ? filter.value : null;
}

/** A catalogue view as the address names it — slugs and codes, never identifiers. */
export interface CourseView {
  readonly topic?: string | null;
  readonly level?: CourseLevel | null;
  readonly language?: string | null;
  readonly format?: CourseFormat | null;
  readonly teacher?: string | null;
  readonly offset?: number;
}

/**
 * A catalogue view's address. Filters appear in one fixed order and only when
 * set, and the offset only past the first page, so one view has one spelling.
 */
export function courseBrowseHref(locale: string, view: CourseView = {}): string {
  const search = new URLSearchParams();
  if (view.topic) search.set('topic', view.topic);
  if (view.level) search.set('level', view.level);
  if (view.language) search.set('language', view.language);
  if (view.format) search.set('format', view.format);
  if (view.teacher) search.set('teacher', view.teacher);
  if (view.offset !== undefined && view.offset > 0)
    search.set('offset', String(view.offset));
  const encoded = search.toString();
  const base = learnPath(locale, 'courses');
  return encoded === '' ? base : `${base}?${encoded}`;
}

/** The previous and next page offsets of a bounded page, or `null` at an end. */
export function learnPageLinks(
  offset: number,
  size: number,
  hasMore: boolean,
): { readonly previous: number | null; readonly next: number | null } {
  return {
    previous: offset > 0 ? Math.max(0, offset - size) : null,
    next: hasMore && offset + size <= LEARNING_MAX_OFFSET ? offset + size : null,
  };
}

/* ===========================================================================
 * Labels
 * ========================================================================= */

/**
 * The words a page renders: the reader's interface locale, then the record's
 * primary locale, then the first label. Presentation, never translation — and
 * the resolved locale travels with it so the element is marked with the
 * language it is actually in (WCAG 3.1.2).
 */
export function outlineLabel(
  labels: readonly OutlineLabel[],
  locale: Locale,
  primaryLocale: Locale,
): OutlineLabel {
  return (
    labels.find((label) => label.locale === locale) ??
    labels.find((label) => label.locale === primaryLocale) ??
    labels[0] ?? { locale: primaryLocale, title: '', summary: '' }
  );
}

/** The same for a Course's or a LearningPath's full words. */
export function courseLabel(
  record: { readonly labels: readonly CourseLabel[]; readonly primaryLocale: Locale },
  locale: Locale,
): CourseLabel {
  return (
    record.labels.find((label) => label.locale === locale) ??
    record.labels.find((label) => label.locale === record.primaryLocale) ??
    record.labels[0] ?? {
      locale: record.primaryLocale,
      title: '',
      summary: '',
      description: '',
    }
  );
}

/**
 * The interface locales a record GENUINELY has words in — never widened by a
 * fallback, so a Course described only in Urdu has one language version
 * (ROUTE_MAP.md §9.2, §9.3).
 */
export function learningLocales(record: {
  readonly labels: readonly { readonly locale: Locale }[];
}): Locale[] {
  return record.labels.map((label) => label.locale);
}

/** A page description: whitespace folded, cut by code point, absent when empty. */
export function learningDescription(text: string, max = 160): string | undefined {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat === '') return undefined;
  const points = [...flat];
  return points.length <= max ? flat : `${points.slice(0, max).join('').trimEnd()}…`;
}
