import 'server-only';

import { CLASS_PAGE } from '@minhaj/contracts/learning';

/**
 * Several pages of one bounded Learning read, gathered for a view the port
 * does not page by itself — a Course's own classes, the classes still
 * needing a mark, one week of the calendar. BOUNDED TWICE: the port's page,
 * and the number of pages a single render may ask for. `truncated` says when
 * the bound was hit, so the page can say "more exist" rather than imply the
 * list is complete.
 *
 * `enough` stops early for an ordered read: once a page ends on an item the
 * view no longer needs (a class after the week shown), later pages cannot hold
 * one it does.
 */
export async function collectPages<T>(
  read: (
    offset: number,
  ) => Promise<{ readonly items: readonly T[]; readonly hasMore: boolean }>,
  maxPages: number,
  enough?: (item: T) => boolean,
): Promise<{ readonly items: readonly T[]; readonly truncated: boolean }> {
  const items: T[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const result = await read(page * CLASS_PAGE);
    items.push(...result.items);
    const last = result.items[result.items.length - 1];
    if (!result.hasMore || (enough !== undefined && last !== undefined && enough(last)))
      return { items, truncated: false };
  }
  return { items, truncated: true };
}
