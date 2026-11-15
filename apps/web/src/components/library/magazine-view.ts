import { MAGAZINE_ISSUE_PAGE } from '@minhaj/contracts/library';

import {
  hubHref,
  identifier,
  pageCount,
  single,
  unlessCanonical,
  whole,
  type Query,
} from '@/components/topic-hub/address';
import { scholarlyPathOf } from './scholarly-presentation';

/**
 * LIBRARY PART 3 — THE PERIODICALS' ADDRESS RULES, pure, so the address a
 * year chip, a Topic chip or a page link builds and the view a page reads are
 * ONE definition, proved by unit test — by the topic hubs' rules
 * (`@/components/topic-hub/address`): neutral values omitted, so an unfiltered
 * page has exactly one address; another spelling of a view (a malformed or
 * repeated value dropped, another order, a former parameter) is ONE redirect
 * to the canonical address built from the parsed view.
 *
 *   `/library/magazines`          `?topic` — the Magazines filed under a
 *                                 Topic. Its former `?offset=`, `?language=`,
 *                                 `?from=` and `?to=` (Phase 9; a Magazine has
 *                                 no language or date of its own) are dropped.
 *   `/library/magazines/{slug}`   `?year` (one publication year's issues) or
 *                                 `?undated=1` (the issues with no year) —
 *                                 never both — and `?page` (24 a page). Its
 *                                 former `?offset=` (25 a page) is the page
 *                                 holding the issue it began with.
 */

export const MAGAZINES_PATH = '/library/magazines';

const DIRECTORY_KEYS: ReadonlySet<string> = new Set([
  'topic',
  'offset',
  'language',
  'from',
  'to',
]);

/** The periodicals directory's view: an optional Topic. */
export function readMagazinesTopic(query: Query): string | null {
  return identifier(query, 'topic');
}

/** The directory's address, under a Topic or none. */
export function magazinesHref(locale: string, topic: string | null): string {
  const search = new URLSearchParams();
  if (topic !== null) search.set('topic', topic.toLowerCase());
  return hubHref(locale, MAGAZINES_PATH, search);
}

export function magazinesCanonicalRedirect(locale: string, query: Query): string | null {
  return unlessCanonical(
    locale,
    MAGAZINES_PATH,
    query,
    DIRECTORY_KEYS,
    magazinesHref(locale, readMagazinesTopic(query)),
  );
}

/* ===========================================================================
 * One Magazine's issues
 * ========================================================================= */

export interface MagazineView {
  /** One publication year, or null. */
  readonly year: number | null;
  /** The issues with no recorded year; never beside a year. */
  readonly undated: boolean;
  /** 1-based. */
  readonly page: number;
}

export const DEFAULT_MAGAZINE_VIEW: MagazineView = Object.freeze({
  year: null,
  undated: false,
  page: 1,
});

/** The deepest page an address may name: Library's offset bound, in pages. */
export const MAGAZINE_MAX_PAGE = Math.floor(25_000 / MAGAZINE_ISSUE_PAGE) + 1;

const ISSUE_KEYS: ReadonlySet<string> = new Set(['year', 'undated', 'page', 'offset']);

/** A Magazine page's view from its address — every unknown or malformed value neutral. */
export function readMagazineView(query: Query): MagazineView {
  const year = whole(single(query, 'year', 4), 1, 9999);
  const undated = year === null && single(query, 'undated', 1) === '1';
  const page = whole(single(query, 'page', 5), 1, MAGAZINE_MAX_PAGE);
  const offset = page === null ? whole(single(query, 'offset', 5), 0, 25_000) : null;
  return {
    year,
    undated,
    page:
      page ??
      (offset === null
        ? 1
        : Math.min(MAGAZINE_MAX_PAGE, Math.floor(offset / MAGAZINE_ISSUE_PAGE) + 1)),
  };
}

/**
 * The address of a view of one Magazine. Choosing a year (or "undated")
 * returns to the first page.
 */
export function magazineHref(
  locale: string,
  slug: string,
  view: MagazineView,
  change: Partial<MagazineView> = {},
): string {
  const next = { ...view, ...change };
  const page = change.page ?? (Object.keys(change).length === 0 ? view.page : 1);
  const search = new URLSearchParams();
  if (next.year !== null) search.set('year', String(next.year));
  else if (next.undated) search.set('undated', '1');
  if (page > 1) search.set('page', String(page));
  return hubHref(locale, scholarlyPathOf('magazine', slug, null), search);
}

export function magazineCanonicalRedirect(
  locale: string,
  slug: string,
  query: Query,
): string | null {
  return unlessCanonical(
    locale,
    scholarlyPathOf('magazine', slug, null),
    query,
    ISSUE_KEYS,
    magazineHref(locale, slug, readMagazineView(query)),
  );
}

/** What Library is asked for one view of a Magazine's issues. */
export function magazineIssuesRead(magazineId: string, view: MagazineView) {
  return {
    magazineId,
    year: view.year,
    undated: view.undated,
    offset: (view.page - 1) * MAGAZINE_ISSUE_PAGE,
    limit: MAGAZINE_ISSUE_PAGE,
  };
}

export function magazinePageCount(total: number): number {
  return pageCount(total, MAGAZINE_ISSUE_PAGE);
}
