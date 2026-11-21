import 'server-only';

import {
  CLASS_PAGE,
  type ClassSessionView,
  type LearningActor,
} from '@minhaj/contracts/learning';

import { learningRuntime } from '@/composition/learning';

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

/**
 * The meeting addresses of TODAY's scheduled classes that hold one, by class
 * (Teacher area, R2) — each read by the one disclosure operation, as My
 * Classes reads a learner's, so the day's agenda can offer "Join". Only for
 * the classes a page is already listing for today; never logged, never
 * written as text.
 */
export async function todaysJoinLinks(
  actor: LearningActor,
  views: readonly ClassSessionView[],
): Promise<ReadonlyMap<string, string>> {
  const { teaching } = learningRuntime();
  const held = views.filter(
    (view) => view.session.state === 'scheduled' && view.session.hasMeetingUrl,
  );
  const entries = await Promise.all(
    held.map(
      async (view) =>
        [view.session.id, await teaching.meetingUrl(actor, view.session.id)] as const,
    ),
  );
  return new Map(
    entries.flatMap(([id, url]) => (url === null ? [] : [[id, url] as const])),
  );
}
