import {
  SEARCH_KINDS,
  SEARCH_MAX_PAGE,
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_YEAR_MAX,
  SEARCH_YEAR_MIN,
  searchLanguageCodeSchema,
  type SearchKind,
} from '@minhaj/contracts/search';

import { queryTerms, type QueryIssue } from './text.ts';

/**
 * The public search request, parsed at the trust boundary.
 *
 * EVERY PARAMETER IS UNTRUSTED. `/search?q, type, topic, language, from, to,
 * page` (ROUTE_MAP.md §3.1) arrives from a URL anybody can write, so each one
 * is read as a single string, bounded, and validated before anything depends on
 * it (SECURITY_BASELINE.md §9.1). An array where a string is expected, an
 * unknown type, a page beyond the ceiling and a year that is not a year are all
 * named refusals the page can explain — never a thrown error and never a
 * silently different query.
 */

/** What the visitor typed, echoed back into the form — bounded, never trusted. */
export interface SearchFormState {
  readonly q: string;
  readonly type: string;
  readonly topic: string;
  readonly language: string;
  readonly from: string;
  readonly to: string;
}

export type SearchIssue =
  QueryIssue | 'type' | 'topic' | 'language' | 'year' | 'year-range' | 'page';

export interface ParsedSearch {
  readonly terms: readonly string[];
  readonly kind: SearchKind | null;
  readonly topicSlug: string | null;
  readonly contentLanguage: string | null;
  readonly fromYear: number | null;
  readonly toYear: number | null;
  readonly page: number;
}

export type SearchParse =
  | { readonly state: 'empty'; readonly form: SearchFormState }
  | {
      readonly state: 'invalid';
      readonly form: SearchFormState;
      readonly issues: readonly SearchIssue[];
    }
  | {
      readonly state: 'valid';
      readonly form: SearchFormState;
      readonly search: ParsedSearch;
    };

type RawQuery = Readonly<Record<string, string | readonly string[] | undefined>>;

/**
 * One parameter as one string.
 *
 * A REPEATED PARAMETER IS NOT A LIST. `?type=article&type=page` is not a request
 * for two types; taking the first keeps the query the visitor sees in the form
 * identical to the query that runs.
 */
function single(raw: RawQuery, name: string): string {
  const value = raw[name];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? first : '';
}

/**
 * Echo bound. Twice the accepted query length is enough to show a visitor what
 * was too long, and small enough that a crafted URL cannot make the page
 * reflect an arbitrary amount of text back.
 */
const ECHO_LIMIT = SEARCH_QUERY_MAX_LENGTH * 2;

/** Topic slugs are Taxonomy's; only their SHAPE is checked here. */
const TOPIC_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function year(value: string): number | null | 'invalid' {
  if (value === '') return null;
  if (!/^\d{1,4}$/.test(value)) return 'invalid';
  const parsed = Number(value);
  return parsed >= SEARCH_YEAR_MIN && parsed <= SEARCH_YEAR_MAX ? parsed : 'invalid';
}

export function parseSearchParams(raw: RawQuery): SearchParse {
  const form: SearchFormState = {
    q: single(raw, 'q').slice(0, ECHO_LIMIT),
    type: single(raw, 'type').slice(0, 32),
    topic: single(raw, 'topic').slice(0, 160),
    language: single(raw, 'language').slice(0, 16),
    from: single(raw, 'from').slice(0, 8),
    to: single(raw, 'to').slice(0, 8),
  };

  // NOTHING TYPED IS NOT AN ERROR. The page opens on its introduction and form,
  // costs no database round trip and consumes no rate-limit budget.
  if (form.q.trim() === '') return { state: 'empty', form };

  const issues: SearchIssue[] = [];

  const words = queryTerms(form.q);
  if ('issue' in words) issues.push(words.issue);

  const kind =
    form.type === ''
      ? null
      : (SEARCH_KINDS as readonly string[]).includes(form.type)
        ? (form.type as SearchKind)
        : null;
  if (form.type !== '' && kind === null) issues.push('type');

  if (form.topic !== '' && !TOPIC_SLUG.test(form.topic)) issues.push('topic');

  if (
    form.language !== '' &&
    !searchLanguageCodeSchema.safeParse(form.language).success
  ) {
    issues.push('language');
  }

  const fromYear = year(form.from);
  const toYear = year(form.to);
  if (fromYear === 'invalid' || toYear === 'invalid') issues.push('year');
  else if (fromYear !== null && toYear !== null && fromYear > toYear) {
    issues.push('year-range');
  }

  const pageText = single(raw, 'page');
  const page = pageText === '' ? 1 : /^\d{1,3}$/.test(pageText) ? Number(pageText) : NaN;
  if (!Number.isInteger(page) || page < 1 || page > SEARCH_MAX_PAGE) issues.push('page');

  if (issues.length > 0 || 'issue' in words) {
    return { state: 'invalid', form, issues };
  }

  return {
    state: 'valid',
    form,
    search: {
      terms: words.terms,
      kind,
      topicSlug: form.topic === '' ? null : form.topic,
      contentLanguage: form.language === '' ? null : form.language.toLowerCase(),
      fromYear: fromYear === 'invalid' ? null : fromYear,
      toYear: toYear === 'invalid' ? null : toYear,
      page,
    },
  };
}
