import type { Locale } from '@minhaj/contracts';
import {
  FATWA_DEFAULT_SORT,
  FATWA_MAX_OFFSET,
  FATWA_SORTS,
  fatwaCategorySlugSchema,
  fatwaIdSchema,
  fatwaSlugSchema,
  type FatwaSort,
} from '@minhaj/contracts/fatwa';
import { topicSlugSchema } from '@minhaj/contracts/taxonomy';

import { isSupportedLocale } from '@/config/locale';
import { fatwaPath } from '@/contexts/fatwa';

/**
 * Presentation decisions for the public Fatwa surfaces and the asker's own
 * questions — PURE and free of React (ROUTE_MAP.md §2.3, §3.8; Phase 20).
 *
 * Which address a ruling, a category or a browse view has; which sort, filter
 * and offset a URL asks for; which direction a ruling's text is set in; which
 * interface locale a ruling's content genuinely exists in. Each has ONE
 * implementation: the pages, the sitemap and the search results all call these.
 *
 * SORTS ARE QUERIES, NEVER PATHS. `/fatwa?sort=latest` and
 * `/fatwa?sort=popular` are derived views of one collection, canonical to
 * `/fatwa`; no function here can produce `/fatwa/latest` or `/fatwa/popular`
 * (ROUTE_MAP.md §2.3).
 *
 * AN UNKNOWN FILTER NEVER BROADENS. A sort, category or topic a visitor typed
 * that does not parse is reported as INVALID — never quietly dropped — so the
 * page shows an empty, explained result rather than everything.
 *
 * NOTHING HERE KNOWS WHAT ANY RULING SAYS, and nothing here ever handles a
 * private question: an asker's question is addressed by its opaque id only.
 */

type Query = Record<string, string | string[] | undefined>;

/** One parameter as one string; a repeated parameter is its first value. */
function single(query: Query, name: string): string | null {
  const value = query[name];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? first : null;
}

const part = (value: string) => encodeURIComponent(value);

/* ===========================================================================
 * Addresses
 * ========================================================================= */

/** The Fatwa section address under a locale: `/{locale}/fatwa[/{section}]`. */
export function fatwaSectionPath(locale: string, section = ''): string {
  return section === '' ? `/${locale}/fatwa` : `/${locale}/fatwa/${section}`;
}

/** The LOCALE-FREE canonical address of one published ruling. */
export function rulingPathOf(slug: string): string {
  return fatwaPath({ slug });
}

export function rulingHref(locale: string, slug: string): string {
  return `/${locale}${rulingPathOf(slug)}`;
}

export function categoryPathOf(slug: string): string {
  return `/fatwa/categories/${part(slug)}`;
}

export function categoryHref(locale: string, slug: string): string {
  return `/${locale}${categoryPathOf(slug)}`;
}

/** The Fatwa topic view — a filtered view canonical to the topic hub. */
export function fatwaTopicHref(locale: string, topicSlug: string): string {
  return `/${locale}/fatwa/topics/${part(topicSlug)}`;
}

/** The asker's own question, by its opaque id — never by anything it says. */
export function ownQuestionHref(locale: string, id: string): string {
  return `/${locale}/my/questions/${part(id)}`;
}

/* ===========================================================================
 * Browsing — `/fatwa?sort=&category=&topic=&offset=`
 * ========================================================================= */

/**
 * A slug filter as a URL gives it: absent, a well-formed slug to resolve, or
 * malformed. Malformed is kept distinct from absent so it can never broaden.
 */
export type SlugFilter =
  | { readonly state: 'none' }
  | { readonly state: 'slug'; readonly slug: string }
  | { readonly state: 'invalid' };

export interface FatwaBrowseQuery {
  /** `null` when the URL names a sort that does not exist. */
  readonly sort: FatwaSort | null;
  readonly category: SlugFilter;
  readonly topic: SlugFilter;
  readonly offset: number;
}

/** `?sort=`: the default when absent or empty, `null` for anything unknown. */
export function readFatwaSort(query: Query): FatwaSort | null {
  const raw = single(query, 'sort');
  if (raw === null || raw === '') return FATWA_DEFAULT_SORT;
  return (FATWA_SORTS as readonly string[]).includes(raw) ? (raw as FatwaSort) : null;
}

/** A plain `?offset=`, bounded by the listing's ceiling; anything else is 0. */
export function readFatwaOffset(query: Query): number {
  const raw = single(query, 'offset');
  if (raw === null || !/^\d{1,6}$/.test(raw)) return 0;
  const value = Number(raw);
  return value <= FATWA_MAX_OFFSET ? value : 0;
}

function readSlugFilter(
  query: Query,
  name: string,
  valid: (value: string) => boolean,
): SlugFilter {
  const raw = single(query, name);
  if (raw === null || raw === '') return { state: 'none' };
  return valid(raw) ? { state: 'slug', slug: raw } : { state: 'invalid' };
}

const categorySlugOk = (value: string) =>
  fatwaCategorySlugSchema.safeParse(value).success;
const topicSlugOk = (value: string) => {
  const parsed = topicSlugSchema.safeParse(value);
  return parsed.success && parsed.data === value;
};

/** Everything `/fatwa` reads from its query string, and nothing else. */
export function readFatwaBrowse(query: Query): FatwaBrowseQuery {
  return {
    sort: readFatwaSort(query),
    category: readSlugFilter(query, 'category', categorySlugOk),
    topic: readSlugFilter(query, 'topic', topicSlugOk),
    offset: readFatwaOffset(query),
  };
}

/** Is any part of this browse query malformed? Then nothing is listed. */
export function isInvalidBrowse(query: FatwaBrowseQuery): boolean {
  return (
    query.sort === null ||
    query.category.state === 'invalid' ||
    query.topic.state === 'invalid'
  );
}

/**
 * A browse view's address. The sort is ALWAYS a query parameter; filters and a
 * non-zero offset are added only when set.
 */
export function fatwaBrowseHref(
  locale: string,
  view: {
    readonly sort: FatwaSort;
    readonly category?: string | null;
    readonly topic?: string | null;
    readonly offset?: number;
  },
): string {
  const search = new URLSearchParams({ sort: view.sort });
  if (view.category) search.set('category', view.category);
  if (view.topic) search.set('topic', view.topic);
  if (view.offset !== undefined && view.offset > 0)
    search.set('offset', String(view.offset));
  return `${fatwaSectionPath(locale)}?${search.toString()}`;
}

/** A paged listing address: the first page is the bare address. */
export function offsetHref(path: string, offset: number): string {
  return offset <= 0 ? path : `${path}?offset=${String(offset)}`;
}

/** Is this an asker's question id? Anything else names nothing. */
export function readQuestionId(value: string): string | null {
  return fatwaIdSchema.safeParse(value).success ? value : null;
}

/** A ruling slug from a path segment, or `null`. */
export function readRulingSegment(value: string): string | null {
  return fatwaSlugSchema.safeParse(value).success ? value : null;
}

/** A category slug from a path segment, or `null`. */
export function readCategorySegment(value: string): string | null {
  return categorySlugOk(value) ? value : null;
}

/* ===========================================================================
 * Language
 * ========================================================================= */

/**
 * The direction a ruling's text is set in: right-to-left for Urdu and Arabic,
 * and otherwise left to the browser's first-strong-character rule, so a ruling
 * in a language this list does not name is never forced the wrong way.
 */
export function fatwaTextDirection(language: string): 'rtl' | 'auto' {
  const primary = language.split('-')[0]?.toLowerCase() ?? '';
  return primary === 'ur' || primary === 'ar' ? 'rtl' : 'auto';
}

/**
 * The interface locales a ruling GENUINELY exists in: exactly its own content
 * language when that is one of the interface locales, and none otherwise.
 * A ruling is written once, in one language — never listed as a translation it
 * does not have (ROUTE_MAP.md §9.2, §9.3).
 */
export function fatwaContentLocales(language: string): Locale[] {
  return isSupportedLocale(language) ? [language] : [];
}

/** The description a ruling page may carry: the PUBLIC question's opening, cut by code point. */
export function rulingDescription(publicQuestion: string, max = 150): string {
  const flat = publicQuestion.replace(/\s+/g, ' ').trim();
  const points = [...flat];
  return points.length <= max ? flat : `${points.slice(0, max).join('').trimEnd()}…`;
}

/* ===========================================================================
 * Fatwa search — what is passed to the shared Search service
 * ========================================================================= */

/** The only parameters `/fatwa/search` passes to Search — and the type, fixed. */
export function fatwaSearchRequest(query: Query): Record<string, string> {
  const q = single(query, 'q') ?? '';
  const page = single(query, 'page') ?? '';
  return {
    q,
    type: 'fatwa',
    ...(page === '' ? {} : { page }),
  };
}
