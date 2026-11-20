import type { ReactNode } from 'react';

import { EmptyState } from '@/components/ui/feedback';
import { LinkTabs } from '@/components/ui/link-tabs';
import { Pager } from '@/components/ui/pager';
import { myListHref, myListPages, type MyListSpec, type MyListView } from './list-view';

/**
 * THE PARTS EVERY MY MINHAJ LIST SHARES (My Minhaj Part 1) — its counted
 * filters, the line that says what is shown, numbered pages, and the honest
 * states past the end and for a filter the list does not have.
 *
 * PRESENTATION ONLY. The figures are the server's: each list's own total and
 * per-kind counts, read for the signed-in account. The addresses come from
 * `list-view.ts`, so a filter, a page and the links between them are spelled
 * one way.
 *
 * LOGICAL PROPERTIES ONLY (`check:rtl`).
 */

/** The id of a list's status line — where focus goes when a change took the control away. */
export const MY_LIST_STATUS = 'my-list-status';

/** One counted filter: "Books 3". */
export interface MyFilterItem<F extends string> {
  readonly value: F | null;
  readonly text: string;
  readonly count: number;
}

/**
 * The list's counted filters as tabs (each its own address). A filter the
 * person holds nothing of is still offered when it is the one being shown, so
 * the current view is always named; otherwise it is left out.
 */
export function MyListFilters<F extends string>({
  label,
  spec,
  current,
  items,
  format,
  minimum = 3,
}: {
  readonly label: string;
  readonly spec: MyListSpec<F>;
  readonly current: F | null;
  readonly items: readonly MyFilterItem<F>[];
  readonly format: (count: number) => string;
  /** Fewer tabs than this, with no filter chosen, say nothing a reader needs. */
  readonly minimum?: number;
}) {
  const shown = items.filter(
    (item) => item.value === null || item.count > 0 || item.value === current,
  );
  if (shown.length < minimum && current === null) return null;
  return (
    <LinkTabs
      label={label}
      tabs={shown.map((item) => ({
        href: myListHref(spec, { page: 1, filter: item.value }),
        text: item.text,
        count: format(item.count),
        current: item.value === current,
      }))}
    />
  );
}

/**
 * "Showing 21–40 of 45 bookmarks" — the list's status line. Focusable from
 * script only (`tabIndex={-1}`), so a change that removed the pressed control
 * can put focus here.
 */
export function MyListStatus({ children }: { readonly children: ReactNode }) {
  return (
    <p
      id={MY_LIST_STATUS}
      tabIndex={-1}
      className="w-fit rounded-control text-sm text-foreground-muted tabular-nums"
    >
      {children}
    </p>
  );
}

/** Previous, numbered pages and next, for a list that knows its total. */
export function MyListPager<F extends string>({
  label,
  spec,
  view,
  total,
  words,
  locale,
}: {
  readonly label: string;
  readonly spec: MyListSpec<F>;
  readonly view: MyListView<F>;
  readonly total: number;
  readonly words: {
    readonly previous: string;
    readonly next: string;
    readonly page: (page: number) => string;
  };
  readonly locale: string;
}) {
  const pages = myListPages(total);
  // Past the end there is no current page to mark: `MyListBeyond` leads back.
  if (view.page > pages) return null;
  const at = (page: number) => myListHref(spec, { page, filter: view.filter });
  const number = new Intl.NumberFormat(locale);
  return (
    <Pager
      label={label}
      previous={view.page > 1 ? at(view.page - 1) : null}
      next={view.page < pages ? at(view.page + 1) : null}
      previousLabel={words.previous}
      nextLabel={words.next}
      pages={{
        current: view.page,
        total: pages,
        href: at,
        label: words.page,
        format: (page) => number.format(page),
      }}
    />
  );
}

/** A page past the end of the list: said, with the way back to its first page. */
export function MyListBeyond({
  text,
  first,
  firstText,
}: {
  readonly text: string;
  readonly first: string;
  readonly firstText: string;
}) {
  return (
    <EmptyState icon="list" action={{ href: first, text: firstText }}>
      {text}
    </EmptyState>
  );
}

/** A filter the list does not have: refused where it was asked, nothing listed. */
export function MyListRefused({
  title,
  text,
  all,
  allText,
}: {
  readonly title: string;
  readonly text: string;
  readonly all: string;
  readonly allText: string;
}) {
  return (
    <EmptyState icon="info" title={title} action={{ href: all, text: allText }}>
      {text}
    </EmptyState>
  );
}
