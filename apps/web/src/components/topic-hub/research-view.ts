import {
  PUBLISHED_RECORDS_PAGE,
  TOPIC_RESEARCH_PAGE,
  type PublishedRecordKind,
  type TopicResearchKind,
  type TopicResearchShelf,
  type TopicResearchSort,
} from '@minhaj/contracts/library';

import {
  hubHref,
  identifier,
  language,
  pageCount,
  pageRange,
  single,
  unlessCanonical,
  whole,
  type Query,
} from './address';

/**
 * A RESEARCH HUB'S RULES (Quran Part 12; any subject's since Hadith Part 1)
 * — pure, so the address a filter form submits, the address a tab, a chip or
 * a pager link builds and the query Library is asked are ONE definition,
 * proved by unit test. The tolerant readers and the one-address rule are the
 * hubs' shared ones (`./address`).
 *
 * THE ADDRESS IS THE STATE. Every view of a hub — a kind, a content
 * language, an author, a decade, "full text on the platform", an order, a
 * page — is a GET address that works without script and can be shared;
 * neutral values are omitted, so the unfiltered hub has exactly one address
 * (its scope's `path`), the canonical one.
 *
 * TOLERANT, NEVER TRUSTING. A malformed or repeated parameter is dropped
 * rather than answered with an error page; what this produces is parsed again
 * by Library's read service (`topicResearchQuerySchema`), the authoritative
 * boundary, and no parameter can widen what is public.
 *
 * LIBRARY PART 3 — THE WHOLE LIBRARY'S LISTINGS OF ONE KIND
 * (`/library/research`, `/library/research-papers`, `/library/publications`,
 * `/library/encyclopedias`) follow the same rules, as Library Part 1 made the
 * Books listing. Their scope names the kind, which the address therefore
 * never spells (each kind has its own listing), and adds the Topic as a
 * filter (`?topic=`, an identifier). Their former parameters (Phase 9) are
 * one redirect: `?offset=` (25 a page until now) to the page holding the
 * record it began with; `?from=`/`?to=` (a year range the listings no longer
 * take — the decade replaces it) dropped.
 */

/** The kinds the whole Library lists through these rules (Library Part 3). */
export type LibraryRecordKind = TopicResearchKind | PublishedRecordKind;

export interface ResearchScope {
  /** The hub's locale-free path: `/quran/research`, `/hadith/research`. */
  readonly path: string;
  /** Library Part 3: the whole Library's listing of this ONE kind. */
  readonly kind?: LibraryRecordKind;
}

/** The whole Library's listings of one kind (ROUTE_MAP.md §3.6). */
export const LIBRARY_RESEARCH: ResearchScope = Object.freeze({
  path: '/library/research',
  kind: 'research',
});
export const LIBRARY_RESEARCH_PAPERS: ResearchScope = Object.freeze({
  path: '/library/research-papers',
  kind: 'research-paper',
});
export const LIBRARY_PUBLICATIONS: ResearchScope = Object.freeze({
  path: '/library/publications',
  kind: 'publication',
});
export const LIBRARY_ENCYCLOPEDIAS: ResearchScope = Object.freeze({
  path: '/library/encyclopedias',
  kind: 'encyclopedia',
});

/** The whole Library's listing of a kind. */
export const LIBRARY_RECORD_SCOPES: Readonly<Record<LibraryRecordKind, ResearchScope>> =
  Object.freeze({
    research: LIBRARY_RESEARCH,
    'research-paper': LIBRARY_RESEARCH_PAPERS,
    publication: LIBRARY_PUBLICATIONS,
    encyclopedia: LIBRARY_ENCYCLOPEDIAS,
  });

/** Whether a kind is one of the two research aggregates. */
export function isResearchKind(kind: LibraryRecordKind): kind is TopicResearchKind {
  return kind === 'research' || kind === 'research-paper';
}

/** How many records one page of a scope holds. */
export function pageSizeOf(scope: ResearchScope): number {
  return scope.kind === undefined || isResearchKind(scope.kind)
    ? TOPIC_RESEARCH_PAGE
    : PUBLISHED_RECORDS_PAGE;
}

/** The deepest page an address may name: Library's offset bound, in pages. */
export const RESEARCH_MAX_PAGE = Math.floor(25_000 / TOPIC_RESEARCH_PAGE) + 1;

function maxPageOf(scope: ResearchScope | undefined): number {
  return scope === undefined
    ? RESEARCH_MAX_PAGE
    : Math.floor(25_000 / pageSizeOf(scope)) + 1;
}

export interface ResearchQuery {
  readonly kind: TopicResearchShelf;
  readonly language: string | null;
  readonly contributor: string | null;
  /** The first year of a decade (1990 is 1990–1999). */
  readonly decade: number | null;
  readonly fullText: boolean;
  readonly sort: TopicResearchSort;
  /** 1-based. */
  readonly page: number;
  /** Library Part 3: a Topic identifier — present on the whole Library's listings only. */
  readonly topic?: string | null;
}

export const DEFAULT_RESEARCH_QUERY: ResearchQuery = Object.freeze({
  kind: 'all',
  language: null,
  contributor: null,
  decade: null,
  fullText: false,
  sort: 'newest',
  page: 1,
});

/**
 * The kind as the address spells it: `paper` for a ResearchPaper, `research`
 * for Research — short words a visitor can read, mapped to Library's kinds
 * here and nowhere else.
 */
export const KIND_WORDS: Readonly<Record<Exclude<TopicResearchShelf, 'all'>, string>> =
  Object.freeze({ research: 'research', 'research-paper': 'paper' });

/** The kind a whole-Library scope fixes, as the view's kind ("all" for a published kind). */
function scopeShelf(kind: LibraryRecordKind): TopicResearchShelf {
  return isResearchKind(kind) ? kind : 'all';
}

/**
 * The view from its address — every unknown or malformed value neutral. On a
 * whole-Library scope the kind is the scope's, the Topic is read, and a
 * former `?offset=` names the page holding the record it began with.
 */
export function readResearchQuery(query: Query, scope?: ResearchScope): ResearchQuery {
  const kindText = single(query, 'kind', 16);
  const kind: TopicResearchShelf =
    scope?.kind !== undefined
      ? scopeShelf(scope.kind)
      : kindText === KIND_WORDS.research
        ? 'research'
        : kindText === KIND_WORDS['research-paper']
          ? 'research-paper'
          : 'all';
  const sortText = single(query, 'sort', 16);
  const sort: TopicResearchSort =
    sortText === 'oldest' || sortText === 'title' ? sortText : 'newest';
  const decade = whole(single(query, 'decade', 4), 0, 9990);
  const max = maxPageOf(scope);
  const page = whole(single(query, 'page', 5), 1, max);
  const view: ResearchQuery = {
    kind,
    language: language(query),
    contributor: identifier(query, 'contributor'),
    decade: decade !== null && decade % 10 === 0 ? decade : null,
    fullText: single(query, 'fulltext', 1) === '1',
    sort,
    page: page ?? 1,
  };
  if (scope?.kind === undefined) return view;
  const offset = page === null ? whole(single(query, 'offset', 5), 0, 25_000) : null;
  return {
    ...view,
    topic: identifier(query, 'topic'),
    page:
      offset === null
        ? view.page
        : Math.min(max, Math.floor(offset / pageSizeOf(scope)) + 1),
  };
}

/**
 * Whether anything narrows the view — a kind (on a hub; a whole-Library
 * listing's kind is its address), a language, an author, a decade, full text
 * or a Topic.
 */
export function researchFiltered(query: ResearchQuery, scope?: ResearchScope): boolean {
  return (
    (scope?.kind === undefined && query.kind !== 'all') ||
    query.language !== null ||
    query.contributor !== null ||
    query.decade !== null ||
    query.fullText ||
    (query.topic ?? null) !== null
  );
}

/**
 * The address of a view. Changing anything but the page returns to the
 * first page — page 7 of another result set means nothing. A whole-Library
 * scope never spells the kind (its path is the kind) and spells the Topic
 * first.
 */
export function researchHref(
  scope: ResearchScope,
  locale: string,
  query: ResearchQuery,
  change: Partial<ResearchQuery> = {},
): string {
  const next = { ...query, ...change };
  const page = change.page ?? (Object.keys(change).length === 0 ? query.page : 1);
  const search = new URLSearchParams();
  if (scope.kind !== undefined) {
    if ((next.topic ?? null) !== null) search.set('topic', next.topic ?? '');
  } else if (next.kind !== 'all') search.set('kind', KIND_WORDS[next.kind]);
  if (next.language !== null) search.set('language', next.language);
  if (next.contributor !== null) search.set('contributor', next.contributor);
  if (next.decade !== null) search.set('decade', String(next.decade));
  if (next.fullText) search.set('fulltext', '1');
  if (next.sort !== 'newest') search.set('sort', next.sort);
  if (page > 1) search.set('page', String(page));
  return hubHref(locale, scope.path, search);
}

/** The parameters a view of the hub is spelled with. */
const VIEW_KEYS: ReadonlySet<string> = new Set([
  'kind',
  'language',
  'contributor',
  'decade',
  'fulltext',
  'sort',
  'page',
]);

/**
 * A whole-Library listing's parameters: the hub's, its Topic, and the former
 * ones it answers with a redirect (`offset`, `from`, `to`). `kind` is not
 * among them: the listing ignores it, as any parameter it does not read.
 */
const LIBRARY_VIEW_KEYS: ReadonlySet<string> = new Set([
  'topic',
  'language',
  'contributor',
  'decade',
  'fulltext',
  'sort',
  'page',
  'offset',
  'from',
  'to',
]);

/**
 * ONE ADDRESS PER VIEW. A filter form submits every control, so choosing an
 * author arrives as `?language=&contributor=…&decade=&sort=newest`; a typed
 * or old link may carry a malformed value or a different order. Each is
 * answered with ONE redirect to the view's canonical address
 * (`researchHref`), built from the parsed view — never from the typed text —
 * or `null` when the request already is that address. Parameters the hub
 * does not read (such as the former related view's `?offset=`) are left alone
 * unless a redirect happens anyway.
 */
export function researchCanonicalRedirect(
  scope: ResearchScope,
  locale: string,
  query: Query,
): string | null {
  return unlessCanonical(
    locale,
    scope.path,
    query,
    scope.kind === undefined ? VIEW_KEYS : LIBRARY_VIEW_KEYS,
    researchHref(scope, locale, readResearchQuery(query, scope)),
  );
}

/** What Library is asked for one view (the Topic resolved at Layer 4). */
export function researchReadQuery(
  query: ResearchQuery,
  topic: string | null,
  titleLocale: string,
): Record<string, unknown> {
  return {
    topic,
    kind: query.kind,
    language: query.language,
    contributor: query.contributor,
    decade: query.decade,
    fullText: query.fullText,
    sort: query.sort,
    titleLocale,
    offset: (query.page - 1) * TOPIC_RESEARCH_PAGE,
    limit: TOPIC_RESEARCH_PAGE,
  };
}

/**
 * What Library is asked for one view of a whole-Library listing: the research
 * read with `scope: 'library'` and the scope's kind, or the published-records
 * read of the scope's kind — the view's own Topic filter in either.
 */
export function libraryRecordsReadQuery(
  scope: ResearchScope & { readonly kind: LibraryRecordKind },
  query: ResearchQuery,
  titleLocale: string,
): Record<string, unknown> {
  const size = pageSizeOf(scope);
  const common = {
    topic: query.topic ?? null,
    language: query.language,
    contributor: query.contributor,
    decade: query.decade,
    fullText: query.fullText,
    sort: query.sort,
    titleLocale,
    offset: (query.page - 1) * size,
    limit: size,
  };
  return isResearchKind(scope.kind)
    ? { ...common, scope: 'library', kind: scope.kind }
    : { ...common, kind: scope.kind };
}

/** How many pages a total fills; at least one. */
export function researchPageCount(total: number, scope?: ResearchScope): number {
  return pageCount(total, scope === undefined ? TOPIC_RESEARCH_PAGE : pageSizeOf(scope));
}

/** "21–40" of a page, or null when the page holds nothing. */
export function researchRange(
  page: number,
  shown: number,
  scope?: ResearchScope,
): { readonly from: number; readonly to: number } | null {
  return pageRange(
    page,
    shown,
    scope === undefined ? TOPIC_RESEARCH_PAGE : pageSizeOf(scope),
  );
}

/** The decade a year falls in, or null for an undated record. */
export function decadeOf(year: number | null): number | null {
  return year === null ? null : Math.floor(year / 10) * 10;
}

/**
 * A page of records grouped by decade, in the order given (the hub's
 * chronological orders): a new group each time the decade changes, so the
 * listing reads as a timeline. Nothing is re-sorted; undated records form
 * their own group, where the order put them.
 */
export function byDecade<T extends { readonly publicationYear: number | null }>(
  items: readonly T[],
): { readonly decade: number | null; readonly items: readonly T[] }[] {
  const groups: { decade: number | null; items: T[] }[] = [];
  for (const item of items) {
    const decade = decadeOf(item.publicationYear);
    const last = groups.at(-1);
    if (last !== undefined && last.decade === decade) last.items.push(item);
    else groups.push({ decade, items: [item] });
  }
  return groups;
}

/** How long an abstract's excerpt on a card may be, in characters. */
export const EXCERPT = 320;

/**
 * THE OPENING OF AN ABSTRACT for a card: its first paragraph, whitespace
 * collapsed, cut at the last space before `max` characters with an
 * ellipsis — never in the middle of a word, and the words themselves never
 * changed. `null` for an absent or blank text.
 */
export function excerptOf(text: string | null, max = EXCERPT): string | null {
  if (text === null) return null;
  const first = text
    .replaceAll('\r\n', '\n')
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.replace(/\s+/gu, ' ').trim())
    .find((paragraph) => paragraph !== '');
  if (first === undefined) return null;
  if (first.length <= max) return first;
  const cut = first.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
