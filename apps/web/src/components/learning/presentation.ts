import { localizedPath } from '@minhaj/contracts';
import type { Locale } from '@minhaj/contracts';
import type { CourseLabel, OutlineLabel } from '@minhaj/contracts/learning';

import { coursePath, learningPathPath } from '@/contexts/learning';
import {
  DEFAULT_COURSES_QUERY,
  LEARN_COURSES,
  coursesHref,
  type CoursesQuery,
} from '@/components/topic-hub/courses-view';

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
 * every Course (the Fatwa precedent, `@/components/fatwa/presentation`). Since
 * Learn Part 1 the catalogue's own address rules are the Courses listing's
 * (`@/components/topic-hub/courses-view`, `readCatalogueQuery`), which keep
 * that rule; this module spells the links into it.
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
  return section === ''
    ? localizedPath(locale, '/learn')
    : localizedPath(locale, `/learn/${section}`);
}

/** The LOCALE-FREE canonical address of one published Course. */
export function coursePathOf(slug: string): string {
  return coursePath(slug);
}

export function courseHref(locale: string, slug: string): string {
  return localizedPath(locale, `${coursePathOf(slug)}`);
}

/** The LOCALE-FREE canonical address of one published LearningPath. */
export function learningPathPathOf(slug: string): string {
  return learningPathPath(slug);
}

export function learningPathHref(locale: string, slug: string): string {
  return localizedPath(locale, `${learningPathPathOf(slug)}`);
}

/** A paged listing address: the first page is the bare address. */
export function offsetHref(path: string, offset: number): string {
  return offset <= 0 ? path : `${path}?offset=${String(offset)}`;
}

/* ===========================================================================
 * Paged listings and filters
 * ========================================================================= */

/** The deepest page a public Learning read accepts (`courseQuerySchema`). */
export const LEARNING_MAX_OFFSET = 25_000;

/**
 * One filter as a URL gives it: absent, a well-formed value, or malformed.
 * Malformed is kept distinct from absent so it can never broaden (the live
 * directory's filters, `@/components/live-learning/presentation`).
 */
export type Filter<T> =
  | { readonly state: 'none' }
  | { readonly state: 'value'; readonly value: T }
  | { readonly state: 'invalid' };

/** A plain `?offset=`, bounded by the reader's ceiling; anything else is 0. */
export function readLearnOffset(query: Query): number {
  const raw = single(query, 'offset');
  if (raw === null || !/^\d{1,6}$/.test(raw)) return 0;
  const value = Number(raw);
  return value <= LEARNING_MAX_OFFSET ? value : 0;
}

/** The value a filter holds, or `null` when it holds none. */
export function filterValue<T>(filter: Filter<T>): T | null {
  return filter.state === 'value' ? filter.value : null;
}

/**
 * A view of the catalogue, `/learn/courses` — its ONE address, built by the
 * catalogue's own rule (`@/components/topic-hub/courses-view`, Learn Part
 * 1): a Topic and a teacher by slug, filters in one fixed order, neutral values
 * omitted. Every link into the catalogue is spelled here.
 */
export function courseBrowseHref(
  locale: string,
  change: Partial<CoursesQuery> = {},
): string {
  return coursesHref(LEARN_COURSES, locale, DEFAULT_COURSES_QUERY, change);
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
