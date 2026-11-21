import { PERSONAL_LIMITS } from '@minhaj/contracts/personalisation';

/**
 * ONE ADDRESS PER VIEW OF A MY MINHAJ LIST (My Minhaj Part 1) — PURE, so every
 * rule is proved by unit test.
 *
 * A list page is `path`, `path?{filter}=value`, `path?page=n` or
 * `path?{filter}=value&page=n`, in that order. The first page and "every kind"
 * are the address without the parameter. Each list knows its own filter
 * parameter (`kind` for bookmarks and reading history, `show` for
 * notifications) and the values it admits.
 *
 * TIDIED ONCE, OR REFUSED IN PLACE — the public listings' posture, kept:
 *
 * - a malformed or out-of-range page, `page=1`, an empty filter, another
 *   order of the parameters, and the legacy `?offset=` (Phase 21's, by the
 *   list's own page — Part 2 lists page by their owner's size) are each ONE
 *   redirect to the final address;
 * - a filter value the list does not admit, or a repeated parameter, cannot
 *   mean anything and is refused where it was asked — the page says so and
 *   lists nothing. It is never widened to the whole list.
 *
 * A FILTER IS A READ, NEVER AUTHORITY. It narrows the signed-in person's own
 * list; whose list it is comes from the session, and the service validates the
 * value again before the adapter sees it.
 */

type Query = Record<string, string | string[] | undefined>;

/** Rows in one page of a list — Personalisation's own page. */
export const MY_LIST_PAGE = PERSONAL_LIMITS.page;

/** The furthest page a list may be asked for: the lists never walk past `offsetMax`. */
export const MY_LIST_PAGE_MAX = Math.floor(PERSONAL_LIMITS.offsetMax / MY_LIST_PAGE) + 1;

export interface MyListView<F extends string> {
  readonly page: number;
  readonly filter: F | null;
}

export type MyListRead<F extends string> =
  | { readonly outcome: 'view'; readonly view: MyListView<F> }
  | { readonly outcome: 'redirect'; readonly to: string }
  | { readonly outcome: 'refused' };

export interface MyListSpec<F extends string> {
  /** The list's own address, already localised. */
  readonly path: string;
  /** The filter's parameter name, if the list has one. */
  readonly param?: string;
  /** The values that parameter admits. */
  readonly filters?: readonly F[];
  /**
   * My Minhaj Part 2: rows in one page, and the furthest offset the list's
   * owner reads, when that owner is not Personalisation (Learning pages by 24,
   * Fatwa by 20). Personalisation's page and bound when absent.
   */
  readonly size?: number;
  readonly offsetMax?: number;
}

/** How a list pages: its rows per page and its owner's offset bound. */
export type MyListPaging = Pick<MyListSpec<string>, 'size' | 'offsetMax'>;

function sizeOf(spec: MyListPaging | undefined): number {
  return spec?.size ?? MY_LIST_PAGE;
}

/** The furthest page a list may be asked for: never past its owner's offset bound. */
export function myListPageMax(spec?: MyListPaging): number {
  return Math.floor((spec?.offsetMax ?? PERSONAL_LIMITS.offsetMax) / sizeOf(spec)) + 1;
}

/**
 * A list's own parameters after its path. The Teacher area (R2) keeps a list
 * on a page that also shows a week (`/teacher/availability?week=…`): that
 * page passes the week's canonical address as the list's `path`, and the
 * list's parameters follow it.
 */
function withSearch(path: string, text: string): string {
  if (text === '') return path;
  return `${path}${path.includes('?') ? '&' : '?'}${text}`;
}

/** The address of one view, in canonical form. */
export function myListHref<F extends string>(
  spec: MyListSpec<F>,
  view: MyListView<F>,
): string {
  const search = new URLSearchParams();
  if (spec.param !== undefined && view.filter !== null)
    search.set(spec.param, view.filter);
  if (view.page > 1) search.set('page', String(view.page));
  return withSearch(spec.path, search.toString());
}

const PAGE_PATTERN = /^[1-9][0-9]{0,3}$/;
const OFFSET_PATTERN = /^[0-9]{1,5}$/;

/**
 * The view a request asks for, the one redirect that tidies it, or a refusal.
 * Parameters the list does not read are left alone.
 */
export function readMyList<F extends string>(
  spec: MyListSpec<F>,
  query: Query,
): MyListRead<F> {
  const keys = ['page', 'offset', ...(spec.param === undefined ? [] : [spec.param])];
  if (keys.some((key) => Array.isArray(query[key]))) return { outcome: 'refused' };
  const single = (key: string): string | undefined => {
    const value = query[key];
    return typeof value === 'string' ? value : undefined;
  };

  // The filter: absent, one admitted value, or empty (a form's blank control).
  const rawFilter = spec.param === undefined ? undefined : single(spec.param);
  let filter: F | null = null;
  if (rawFilter !== undefined && rawFilter !== '') {
    const admitted = (spec.filters ?? []).find((value) => value === rawFilter);
    if (admitted === undefined) return { outcome: 'refused' };
    filter = admitted;
  }

  // The page: `?page=`, else the legacy `?offset=`, read by the list's own page.
  const rawPage = single('page');
  const rawOffset = single('offset');
  let page = 1;
  if (rawPage !== undefined) {
    page =
      PAGE_PATTERN.test(rawPage) && Number(rawPage) <= myListPageMax(spec)
        ? Number(rawPage)
        : 1;
  } else if (rawOffset !== undefined) {
    const offset = OFFSET_PATTERN.test(rawOffset) ? Number(rawOffset) : 0;
    page =
      offset <= (spec.offsetMax ?? PERSONAL_LIMITS.offsetMax)
        ? Math.floor(offset / sizeOf(spec)) + 1
        : 1;
  }

  const view: MyListView<F> = { page, filter };
  const canonical = myListHref(spec, view);
  const requested = new URLSearchParams();
  for (const key of Object.keys(query)) {
    const value = single(key);
    if (keys.includes(key) && value !== undefined) requested.append(key, value);
  }
  const askedHref = withSearch(spec.path, requested.toString());
  return askedHref === canonical
    ? { outcome: 'view', view }
    : { outcome: 'redirect', to: canonical };
}

/** Where a page starts in the list. */
export function myListOffset(page: number, spec?: MyListPaging): number {
  return (page - 1) * sizeOf(spec);
}

/** How many pages a total fills; at least one. */
export function myListPages(total: number, spec?: MyListPaging): number {
  return Math.min(myListPageMax(spec), Math.max(1, Math.ceil(total / sizeOf(spec))));
}

/** "21–40" of a page, or null when the page holds nothing. */
export function myListRange(
  page: number,
  shown: number,
  spec?: MyListPaging,
): { readonly from: number; readonly to: number } | null {
  if (shown <= 0) return null;
  const from = myListOffset(page, spec) + 1;
  return { from, to: from + shown - 1 };
}
