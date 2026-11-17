import { localizedPath } from '@minhaj/contracts';
import {
  COLLECTION_HOLDS,
  COLLECTION_LANGUAGES,
  COLLECTION_LISTING_PAGE,
  COLLECTION_MAX_OFFSET,
  collectionPathOf,
  type CollectionHolds,
  type CollectionLanguage,
  type CollectionListingSort,
} from '@minhaj/contracts/editorial';

import {
  hubHref,
  identifier,
  single,
  unlessCanonical,
  whole,
  type Query,
} from '@/components/topic-hub/address';

/**
 * NEWS & EVENTS PART 2 — THE COLLECTION PAGES' ADDRESS RULES, pure, so the
 * address a filter form submits, a tab, a chip or a page link builds, and the
 * query Editorial is asked are ONE definition, proved by unit test
 * (`tests/editorial/collections-view.test.ts`). The tolerant readers and the
 * one-address rule are the topic hubs' shared ones, as the News listings read
 * them.
 *
 * `/collections` takes `?topic` (a Taxonomy identifier), `?holds` (article,
 * news, work or video), `?language` (en, ur or ar), `?sort=oldest` and
 * `?page` (20 a page). Neutral values are omitted, so the unfiltered listing
 * has exactly one address; Phase 15's `?offset=` is the page holding the
 * Collection it began with. A Collection's page takes `?order=newest|oldest`.
 *
 * TOLERANT, NEVER TRUSTING. A malformed or repeated parameter is dropped and
 * the request redirected once to the view's one address; what this produces is
 * parsed again by Editorial's read service, and nothing can widen what is
 * public.
 */

/** The deepest page an address may name: Editorial's offset bound, in pages. */
export const COLLECTIONS_MAX_PAGE =
  Math.floor(COLLECTION_MAX_OFFSET / COLLECTION_LISTING_PAGE) + 1;

const COLLECTIONS_PATH = '/collections';

export interface CollectionsView {
  /** A Taxonomy Topic identifier, in lower case. */
  readonly topic: string | null;
  readonly holds: CollectionHolds | null;
  readonly language: CollectionLanguage | null;
  readonly sort: CollectionListingSort;
  /** 1-based. */
  readonly page: number;
}

export const DEFAULT_COLLECTIONS_VIEW: CollectionsView = Object.freeze({
  topic: null,
  holds: null,
  language: null,
  sort: 'newest',
  page: 1,
});

/**
 * The page a former `?offset=` named — the page holding the first Collection
 * it showed — or null when there is none or it is not a plain bounded number.
 */
function legacyPage(query: Query): number | null {
  const text = single(query, 'offset', 6);
  if (text === null || !/^\d{1,6}$/u.test(text)) return null;
  const offset = Number(text);
  return offset <= COLLECTION_MAX_OFFSET
    ? Math.min(Math.floor(offset / COLLECTION_LISTING_PAGE) + 1, COLLECTIONS_MAX_PAGE)
    : null;
}

/** The listing's view from its address — every unknown or malformed value neutral. */
export function readCollectionsView(query: Query): CollectionsView {
  const holds = single(query, 'holds', 8);
  const language = single(query, 'language', 4);
  return {
    topic: identifier(query, 'topic'),
    holds: COLLECTION_HOLDS.find((kind) => kind === holds) ?? null,
    language: COLLECTION_LANGUAGES.find((code) => code === language) ?? null,
    sort: single(query, 'sort', 16) === 'oldest' ? 'oldest' : 'newest',
    page:
      whole(single(query, 'page', 5), 1, COLLECTIONS_MAX_PAGE) ?? legacyPage(query) ?? 1,
  };
}

/** Whether anything narrows the listing. An order is not a narrowing. */
export function collectionsFiltered(view: CollectionsView): boolean {
  return view.topic !== null || view.holds !== null || view.language !== null;
}

/**
 * The address of a view. Changing anything but the page returns to the first
 * page; identifiers are written in lower case, as an address reads them, so a
 * link never costs a redirect.
 */
export function collectionsHref(
  locale: string,
  view: CollectionsView,
  change: Partial<CollectionsView> = {},
): string {
  const next = { ...view, ...change };
  const page = change.page ?? (Object.keys(change).length === 0 ? view.page : 1);
  const search = new URLSearchParams();
  if (next.topic !== null) search.set('topic', next.topic.toLowerCase());
  if (next.holds !== null) search.set('holds', next.holds);
  if (next.language !== null) search.set('language', next.language);
  if (next.sort !== 'newest') search.set('sort', next.sort);
  if (page > 1) search.set('page', String(page));
  return hubHref(locale, COLLECTIONS_PATH, search);
}

/** The address of a view from the unfiltered first page — what another page links. */
export function collectionsListingHref(
  locale: string,
  change: Partial<Omit<CollectionsView, 'page'>> = {},
): string {
  return collectionsHref(locale, { ...DEFAULT_COLLECTIONS_VIEW, ...change, page: 1 });
}

const LISTING_KEYS: ReadonlySet<string> = new Set([
  'topic',
  'holds',
  'language',
  'sort',
  'page',
  'offset',
]);

/**
 * ONE ADDRESS PER VIEW. A filter form submits every control, so choosing a
 * Topic arrives as `?topic=…&language=&sort=newest`; an old link may carry
 * `?offset=`, a malformed value or another order of the same parameters. Each
 * is answered with ONE redirect to the view's address, built from the parsed
 * view — never from the typed text — or `null` when the request already is it.
 */
export function collectionsCanonicalRedirect(
  locale: string,
  query: Query,
): string | null {
  return unlessCanonical(
    locale,
    COLLECTIONS_PATH,
    query,
    LISTING_KEYS,
    collectionsHref(locale, readCollectionsView(query)),
  );
}

/** What Editorial is asked for one view. */
export function collectionsReadQuery(view: CollectionsView): Record<string, unknown> {
  return {
    topic: view.topic,
    holds: view.holds,
    language: view.language,
    sort: view.sort,
    offset: (view.page - 1) * COLLECTION_LISTING_PAGE,
    limit: COLLECTION_LISTING_PAGE,
  };
}

/* ===========================================================================
 * /collections/{slug}?order=
 * ========================================================================= */

/**
 * R2 — the order a Collection's members are read in (audit F51). `curated` is
 * the editor's saved order and the default; `newest` and `oldest` follow each
 * member's own date, as its owner states it. Anything else is the default.
 */
export const COLLECTION_ORDERS = ['curated', 'newest', 'oldest'] as const;
export type CollectionOrder = (typeof COLLECTION_ORDERS)[number];

export function readCollectionOrder(query: Query): CollectionOrder {
  const raw = query['order'];
  return raw === 'newest' || raw === 'oldest' ? raw : 'curated';
}

/** A Collection's address in an order; the curated order is the bare address. */
export function collectionOrderPath(
  locale: string,
  slug: string,
  order: CollectionOrder,
): string {
  return localizedPath(
    locale,
    `${collectionPathOf(slug)}${order === 'curated' ? '' : `?order=${order}`}`,
  );
}

/**
 * ONE ADDRESS PER ORDER (Part 2). `?order=curated`, an unknown or repeated
 * order and an empty one each name the curated order, whose address is the
 * bare one: ONE redirect there. Only `?order` is the page's own parameter.
 */
export function collectionOrderRedirect(
  locale: string,
  slug: string,
  query: Query,
): string | null {
  return unlessCanonical(
    locale,
    collectionPathOf(slug),
    query,
    new Set(['order']),
    collectionOrderPath(locale, slug, readCollectionOrder(query)),
  );
}
