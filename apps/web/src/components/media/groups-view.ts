import {
  MEDIA_GROUP_EPISODES_PAGE,
  type MediaCount,
  type MediaGroupEntry,
  type MediaGroupKind,
  type SpeakerDirectoryEntry,
} from '@minhaj/contracts/media';

import {
  hubHref,
  identifier,
  initialOf,
  language,
  letterOf,
  nameMatches,
  nameQuery,
  single,
  unlessCanonical,
  whole,
  type Query,
} from '@/components/topic-hub/address';

/**
 * WATCH PART 2 — THE GROUPINGS' AND THE SPEAKERS' RULES, pure, so the address
 * a filter form submits, the address a chip, a letter or a page link builds,
 * the view a page reads and what it shows of Media's directory are ONE
 * definition, proved by unit test.
 *
 * ONE ADDRESS PER VIEW, by the topic hubs' rules (`@/components/topic-hub/
 * address`): neutral values are omitted, so an unfiltered page has exactly one
 * address; a form's empty controls, another order of the same parameters and
 * a malformed or repeated value are each one redirect to the canonical
 * spelling, built from the parsed view — never from the typed text.
 *
 * WHAT IS COUNTED IS WHAT IS SHOWN. A directory's filter options count the
 * GROUPINGS (or speakers) choosing them would show, under every other filter;
 * Media's read says which languages, speakers and Topics a grouping's
 * published Videos have, and nothing here guesses one.
 */

/* ===========================================================================
 * The groupings' directories (`/watch/series`, `/watch/programs`, `/watch/playlists`)
 * ========================================================================= */

/** How many groupings one directory page shows. */
export const GROUPS_PAGE = 24;

/** The deepest page a directory address may name. */
const MAX_PAGE = 1000;

export const GROUP_SORTS = Object.freeze(['newest', 'title', 'videos'] as const);
export type GroupSort = (typeof GROUP_SORTS)[number];

export interface GroupsView {
  /** A content language: groupings with a published Video in it. */
  readonly language: string | null;
  /** A People identifier: groupings one of whose Videos they speak in. */
  readonly speaker: string | null;
  /** A Taxonomy Topic identifier: groupings with a Video filed under it. */
  readonly topic: string | null;
  /** A title search, its whitespace collapsed. */
  readonly q: string | null;
  readonly sort: GroupSort;
  /** 1-based. */
  readonly page: number;
}

export const DEFAULT_GROUPS_VIEW: GroupsView = Object.freeze({
  language: null,
  speaker: null,
  topic: null,
  q: null,
  sort: 'newest',
  page: 1,
});

/** A grouping kind's directory, as a locale-free path. */
export function groupsPathOf(kind: MediaGroupKind): string {
  return kind === 'program'
    ? '/watch/programs'
    : kind === 'playlist'
      ? '/watch/playlists'
      : '/watch/series';
}

/**
 * The parameters a directory reads — and its former `?offset=` pager, which
 * listed by slug: the order is not this one, so it is one redirect to the
 * first page rather than a guess at where its first grouping now stands.
 */
const GROUPS_KEYS: ReadonlySet<string> = new Set([
  'language',
  'speaker',
  'topic',
  'q',
  'sort',
  'page',
  'offset',
]);

export function readGroupsView(query: Query): GroupsView {
  const sort = single(query, 'sort', 16);
  return {
    language: language(query),
    speaker: identifier(query, 'speaker'),
    topic: identifier(query, 'topic'),
    q: nameQuery(query),
    sort: GROUP_SORTS.find((entry) => entry === sort) ?? 'newest',
    page: whole(single(query, 'page', 5), 1, MAX_PAGE) ?? 1,
  };
}

/**
 * The address of a view. Changing anything but the page returns to the first
 * page — page 7 of another result set means nothing.
 */
export function groupsHref(
  kind: MediaGroupKind,
  locale: string,
  view: GroupsView,
  change: Partial<GroupsView> = {},
): string {
  const next = { ...view, ...change };
  const page = change.page ?? (Object.keys(change).length === 0 ? view.page : 1);
  const search = new URLSearchParams();
  if (next.q !== null) search.set('q', next.q);
  if (next.language !== null) search.set('language', next.language);
  if (next.speaker !== null) search.set('speaker', next.speaker.toLowerCase());
  if (next.topic !== null) search.set('topic', next.topic.toLowerCase());
  if (next.sort !== 'newest') search.set('sort', next.sort);
  if (page > 1) search.set('page', String(page));
  return hubHref(locale, groupsPathOf(kind), search);
}

/** The canonical address of the request's view, or `null` when it already is. */
export function groupsCanonicalRedirect(
  kind: MediaGroupKind,
  locale: string,
  query: Query,
): string | null {
  return unlessCanonical(
    locale,
    groupsPathOf(kind),
    query,
    GROUPS_KEYS,
    groupsHref(kind, locale, readGroupsView(query)),
  );
}

/** Whether anything narrows the directory. An order is not a narrowing. */
export function groupsFiltered(view: GroupsView): boolean {
  return (
    view.language !== null ||
    view.speaker !== null ||
    view.topic !== null ||
    view.q !== null
  );
}

/** One grouping as the directory works on it: Media's entry and the titles a reader may search. */
export interface GroupRow {
  readonly entry: MediaGroupEntry;
  /** The title the reader is shown. */
  readonly title: string;
}

type GroupFilter = 'language' | 'speaker' | 'topic' | 'q';

const holds = (counts: readonly MediaCount[], id: string) =>
  counts.some((entry) => entry.id.toLowerCase() === id.toLowerCase());

/** Whether a grouping passes the view's filters, `omit` excepted. */
export function groupMatches(
  row: GroupRow,
  view: GroupsView,
  omit?: GroupFilter,
): boolean {
  const { entry } = row;
  return (
    (omit === 'language' ||
      view.language === null ||
      holds(entry.languages, view.language)) &&
    (omit === 'speaker' ||
      view.speaker === null ||
      holds(entry.speakers, view.speaker)) &&
    (omit === 'topic' || view.topic === null || holds(entry.topics, view.topic)) &&
    (omit === 'q' ||
      view.q === null ||
      [row.title, ...entry.labels.map((label) => label.title)].some((title) =>
        nameMatches(title, view.q ?? ''),
      ))
  );
}

/**
 * Each filter's options with how many groupings choosing it would show —
 * counted under every OTHER filter — commonest first, then by identifier.
 */
export function groupFacets(
  rows: readonly GroupRow[],
  view: GroupsView,
): {
  readonly languages: readonly MediaCount[];
  readonly speakers: readonly MediaCount[];
  readonly topics: readonly MediaCount[];
} {
  const tally = (
    omit: 'language' | 'speaker' | 'topic',
    of: (entry: MediaGroupEntry) => readonly MediaCount[],
  ) => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (!groupMatches(row, view, omit)) continue;
      for (const value of of(row.entry)) {
        const id = omit === 'language' ? value.id : value.id.toLowerCase();
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    return [...counts]
      .map(([id, videos]) => ({ id, videos }))
      .sort((a, b) => b.videos - a.videos || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  };
  return {
    languages: tally('language', (entry) => entry.languages),
    speakers: tally('speaker', (entry) => entry.speakers),
    topics: tally('topic', (entry) => entry.topics),
  };
}

/**
 * A directory's order. `newest`: the latest provider date among a grouping's
 * Videos, a grouping with none dated after every dated one; `title`: A–Z by
 * the reader's collation; `videos`: the most Videos first. Every order ends on
 * the title and then the identifier, so a page never repeats or skips one.
 */
export function sortGroups(
  rows: readonly GroupRow[],
  sort: GroupSort,
  collator: Intl.Collator,
): GroupRow[] {
  const byTitle = (a: GroupRow, b: GroupRow) =>
    collator.compare(a.title, b.title) ||
    (a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0);
  return [...rows].sort((a, b) => {
    if (sort === 'videos') return b.entry.videos - a.entry.videos || byTitle(a, b);
    if (sort === 'newest') {
      const x = a.entry.lastOn;
      const y = b.entry.lastOn;
      if (x !== y) {
        if (x === null) return 1;
        if (y === null) return -1;
        return x < y ? 1 : -1;
      }
    }
    return byTitle(a, b);
  });
}

/**
 * WHAT ELSE TO WATCH, as the records state it: other groupings of the same
 * kind sharing a speaker or a Topic with this one — a shared speaker weighs
 * twice a shared Topic — with at least one published Video, most shared
 * first, then the latest, then the identifier. Never itself.
 */
export function relatedGroups(
  entry: MediaGroupEntry,
  candidates: readonly MediaGroupEntry[],
  max: number,
): MediaGroupEntry[] {
  const speakers = new Set(entry.speakers.map((value) => value.id.toLowerCase()));
  const topics = new Set(entry.topics.map((value) => value.id.toLowerCase()));
  return candidates
    .flatMap((other) => {
      if (other.id.toLowerCase() === entry.id.toLowerCase() || other.videos === 0)
        return [];
      const score =
        2 *
          other.speakers.filter((value) => speakers.has(value.id.toLowerCase())).length +
        other.topics.filter((value) => topics.has(value.id.toLowerCase())).length;
      return score === 0 ? [] : [{ other, score }];
    })
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      const x = a.other.lastOn ?? '';
      const y = b.other.lastOn ?? '';
      if (x !== y) return x < y ? 1 : -1;
      return a.other.id < b.other.id ? -1 : a.other.id > b.other.id ? 1 : 0;
    })
    .slice(0, max)
    .map(({ other }) => other);
}

/**
 * A span of provider dates as a reader says it: one year, or the first and
 * last years — `null` when nothing is dated.
 */
export function yearSpan(
  firstOn: string | null,
  lastOn: string | null,
): { readonly from: number; readonly to: number } | null {
  if (firstOn === null || lastOn === null) return null;
  return { from: Number(firstOn.slice(0, 4)), to: Number(lastOn.slice(0, 4)) };
}

/* ===========================================================================
 * One grouping's page (`/watch/series/{slug}` …)
 * ========================================================================= */

/** The deepest page of a grouping's Videos: Media's offset bound, in pages. */
export const GROUP_MAX_PAGE = Math.floor(25_000 / MEDIA_GROUP_EPISODES_PAGE) + 1;

/**
 * The page of a grouping's Videos an address names: `?page`, or — its former
 * pager, in the same order and the same 24 a page — the page holding the
 * Video a `?offset=` began with.
 */
export function readGroupPage(query: Query): number {
  const page = whole(single(query, 'page', 5), 1, GROUP_MAX_PAGE);
  if (page !== null) return page;
  const offset = single(query, 'offset', 6);
  if (offset === null || !/^\d{1,6}$/u.test(offset) || Number(offset) > 25_000) return 1;
  return Math.min(
    Math.floor(Number(offset) / MEDIA_GROUP_EPISODES_PAGE) + 1,
    GROUP_MAX_PAGE,
  );
}

/** A grouping's address at a page; the first page is the bare address. */
export function groupPageHref(path: string, page: number): string {
  return page > 1 ? `${path}?page=${String(page)}` : path;
}

const GROUP_PAGE_KEYS: ReadonlySet<string> = new Set(['page', 'offset']);

/**
 * One address per page of a grouping: a malformed, repeated or first-page
 * `?page` and a former `?offset=` are one redirect. `path` is the grouping's
 * locale-prefixed address.
 */
export function groupPageCanonicalRedirect(path: string, query: Query): string | null {
  const requested = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (!GROUP_PAGE_KEYS.has(key)) continue;
    for (const entry of typeof value === 'string' ? [value] : (value ?? []))
      requested.append(key, entry);
  }
  const text = requested.toString();
  const asked = text === '' ? path : `${path}?${text}`;
  const canonical = groupPageHref(path, readGroupPage(query));
  return asked === canonical ? null : canonical;
}

/* ===========================================================================
 * The speakers' directory (`/watch/speakers`)
 * ========================================================================= */

export const SPEAKERS_PATH = '/watch/speakers';
/** How many speakers one directory page shows — the Library authors' page. */
export const SPEAKERS_PAGE = 48;

export const SPEAKER_SORTS = Object.freeze(['name', 'videos'] as const);
export type SpeakerSort = (typeof SPEAKER_SORTS)[number];

export interface SpeakersView {
  /** One initial (upper case), or `#` for a name that starts with no letter. */
  readonly letter: string | null;
  /** A content language they speak in. */
  readonly language: string | null;
  /** A name search, its whitespace collapsed. */
  readonly q: string | null;
  readonly sort: SpeakerSort;
  /** 1-based. */
  readonly page: number;
}

export const DEFAULT_SPEAKERS_VIEW: SpeakersView = Object.freeze({
  letter: null,
  language: null,
  q: null,
  sort: 'name',
  page: 1,
});

/**
 * Its parameters — and the former `?offset=` (fifty a page, by count): the
 * order is not this one, so it is one redirect to the first page.
 */
const SPEAKERS_KEYS: ReadonlySet<string> = new Set([
  'letter',
  'language',
  'q',
  'sort',
  'page',
  'offset',
]);

export function readSpeakersView(query: Query, locale: string): SpeakersView {
  const sort = single(query, 'sort', 16);
  return {
    letter: letterOf(query, locale),
    language: language(query),
    q: nameQuery(query),
    sort: SPEAKER_SORTS.find((entry) => entry === sort) ?? 'name',
    page: whole(single(query, 'page', 5), 1, MAX_PAGE) ?? 1,
  };
}

export function speakersHref(
  locale: string,
  view: SpeakersView,
  change: Partial<SpeakersView> = {},
): string {
  const next = { ...view, ...change };
  const page = change.page ?? (Object.keys(change).length === 0 ? view.page : 1);
  const search = new URLSearchParams();
  if (next.letter !== null) search.set('letter', next.letter);
  if (next.q !== null) search.set('q', next.q);
  if (next.language !== null) search.set('language', next.language);
  if (next.sort !== 'name') search.set('sort', next.sort);
  if (page > 1) search.set('page', String(page));
  return hubHref(locale, SPEAKERS_PATH, search);
}

export function speakersCanonicalRedirect(locale: string, query: Query): string | null {
  return unlessCanonical(
    locale,
    SPEAKERS_PATH,
    query,
    SPEAKERS_KEYS,
    speakersHref(locale, readSpeakersView(query, locale)),
  );
}

/** One speaker as the directory works on them: Media's entry and People's name. */
export interface SpeakerRow {
  readonly entry: SpeakerDirectoryEntry;
  readonly slug: string;
  readonly name: string;
  readonly letter: string;
}

/** A speaker named by People, with the initial they are indexed under. */
export function speakerRow(
  entry: SpeakerDirectoryEntry,
  person: { readonly slug: string; readonly name: string },
  locale: string,
): SpeakerRow {
  return {
    entry,
    slug: person.slug,
    name: person.name,
    letter: initialOf(person.name, locale),
  };
}

type SpeakerFilter = 'letter' | 'language' | 'q';

export function speakerMatches(
  row: SpeakerRow,
  view: SpeakersView,
  omit?: SpeakerFilter,
): boolean {
  return (
    (omit === 'letter' || view.letter === null || row.letter === view.letter) &&
    (omit === 'language' ||
      view.language === null ||
      holds(row.entry.languages, view.language)) &&
    (omit === 'q' || view.q === null || nameMatches(row.name, view.q))
  );
}

/** The speakers' order: by name in the reader's collation, or the most Videos first. */
export function sortSpeakers(
  rows: readonly SpeakerRow[],
  sort: SpeakerSort,
  collator: Intl.Collator,
): SpeakerRow[] {
  const byName = (a: SpeakerRow, b: SpeakerRow) =>
    collator.compare(a.name, b.name) ||
    (a.entry.personId < b.entry.personId
      ? -1
      : a.entry.personId > b.entry.personId
        ? 1
        : 0);
  return [...rows].sort((a, b) =>
    sort === 'videos' ? b.entry.videos - a.entry.videos || byName(a, b) : byName(a, b),
  );
}
