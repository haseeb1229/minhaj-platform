import {
  AUDIO_LISTING_PAGE,
  type AudioListingSort,
  type TopicVideoLength,
} from '@minhaj/contracts/media';

import {
  hubHref,
  identifier,
  language,
  single,
  unlessCanonical,
  whole,
  type Query,
} from '@/components/topic-hub/address';

/**
 * WATCH PART 3 — THE AUDIO LECTURES LISTING'S RULES (`/listen/lectures`), pure,
 * so the address a filter form submits, the address a chip, a page or a link
 * from another Listen page builds, and the query Media is asked are ONE
 * definition, proved by unit test. The tolerant readers and the one-address
 * rule are the topic hubs' shared ones (`@/components/topic-hub/address`), as
 * Watch's Videos listing reads them.
 *
 * THE ADDRESS IS THE STATE. A Topic, a content language, a speaker, an audio
 * series, a length, an order and a page are each a GET parameter; neutral
 * values are omitted, so the unfiltered listing has exactly one address. The
 * listing keeps every parameter it has always taken (`?topic`, `?speaker`,
 * `?series` identifiers and `?language`, ROUTE_MAP.md §3.7) and adds
 * `?length`, `?sort` and `?page`; a former `?offset=` (24 a page, as now) is
 * one redirect to the page holding the recording it began with.
 *
 * TOLERANT, NEVER TRUSTING. A malformed or repeated parameter is dropped
 * rather than answered with an error page; what this produces is parsed again
 * by Media's read service (`audioListingQuerySchema`), the authoritative
 * boundary, and no parameter can widen what is public.
 */

export const LECTURES_PATH = '/listen/lectures';

/** The deepest page an address may name: Media's offset bound, in pages. */
export const LECTURES_MAX_PAGE = Math.floor(25_000 / AUDIO_LISTING_PAGE) + 1;

export interface LecturesView {
  /** A Taxonomy Topic identifier. */
  readonly topic: string | null;
  /** A content-language code. */
  readonly language: string | null;
  /** A People identifier. */
  readonly speaker: string | null;
  /** A published AudioSeries' identifier. */
  readonly series: string | null;
  readonly length: TopicVideoLength | null;
  readonly sort: AudioListingSort;
  /** 1-based. */
  readonly page: number;
}

export const DEFAULT_LECTURES_VIEW: LecturesView = Object.freeze({
  topic: null,
  language: null,
  speaker: null,
  series: null,
  length: null,
  sort: 'newest',
  page: 1,
});

/** The deepest former `?offset=` an address may carry (Media's offset bound). */
const LEGACY_MAX_OFFSET = 25_000;

/**
 * The page a former `?offset=` named — the page holding the first recording
 * it showed — or null when there is none or it is not a plain bounded number.
 */
function legacyPage(query: Query): number | null {
  const text = single(query, 'offset', 6);
  if (text === null || !/^\d{1,6}$/u.test(text)) return null;
  const offset = Number(text);
  return offset <= LEGACY_MAX_OFFSET
    ? Math.min(Math.floor(offset / AUDIO_LISTING_PAGE) + 1, LECTURES_MAX_PAGE)
    : null;
}

/** The listing's view from its address — every unknown or malformed value neutral. */
export function readLecturesView(query: Query): LecturesView {
  const lengthText = single(query, 'length', 16);
  return {
    topic: identifier(query, 'topic'),
    language: language(query),
    speaker: identifier(query, 'speaker'),
    series: identifier(query, 'series'),
    length:
      lengthText === 'short' || lengthText === 'medium' || lengthText === 'long'
        ? lengthText
        : null,
    sort: single(query, 'sort', 16) === 'title' ? 'title' : 'newest',
    page: whole(single(query, 'page', 5), 1, LECTURES_MAX_PAGE) ?? legacyPage(query) ?? 1,
  };
}

/** Whether anything narrows the listing. An order is not a narrowing. */
export function lecturesFiltered(view: LecturesView): boolean {
  return (
    view.topic !== null ||
    view.language !== null ||
    view.speaker !== null ||
    view.series !== null ||
    view.length !== null
  );
}

/**
 * The address of a view. Changing anything but the page returns to the first
 * page — page 7 of another result set means nothing. Identifiers are written
 * in lower case, as an address reads them, so a link never costs a redirect.
 */
export function lecturesHref(
  locale: string,
  view: LecturesView,
  change: Partial<LecturesView> = {},
): string {
  const next = { ...view, ...change };
  const page = change.page ?? (Object.keys(change).length === 0 ? view.page : 1);
  const search = new URLSearchParams();
  if (next.topic !== null) search.set('topic', next.topic.toLowerCase());
  if (next.language !== null) search.set('language', next.language);
  if (next.speaker !== null) search.set('speaker', next.speaker.toLowerCase());
  if (next.series !== null) search.set('series', next.series.toLowerCase());
  if (next.length !== null) search.set('length', next.length);
  if (next.sort !== 'newest') search.set('sort', next.sort);
  if (page > 1) search.set('page', String(page));
  return hubHref(locale, LECTURES_PATH, search);
}

/**
 * The address of one view from the unfiltered first page — what every Listen
 * page that links into the listing (a Topic, a speaker, a series, a language)
 * builds, so no two spell one view differently.
 */
export function listenLecturesHref(
  locale: string,
  change: Partial<Omit<LecturesView, 'page'>> = {},
): string {
  return lecturesHref(locale, { ...DEFAULT_LECTURES_VIEW, ...change, page: 1 });
}

/** The parameters a view is spelled with, and the former pager's offset. */
const LECTURES_KEYS: ReadonlySet<string> = new Set([
  'topic',
  'language',
  'speaker',
  'series',
  'length',
  'sort',
  'page',
  'offset',
]);

/**
 * ONE ADDRESS PER VIEW. A filter form submits every control, so choosing a
 * speaker arrives as `?topic=&language=&speaker=…&length=&sort=newest`; a
 * typed or old link may carry a malformed value, a former `?offset=` or a
 * different order. Each is answered with ONE redirect to the view's canonical
 * address, built from the parsed view — never from the typed text — or `null`
 * when the request already is that address.
 */
export function lecturesCanonicalRedirect(locale: string, query: Query): string | null {
  return unlessCanonical(
    locale,
    LECTURES_PATH,
    query,
    LECTURES_KEYS,
    lecturesHref(locale, readLecturesView(query)),
  );
}

/** What Media is asked for one view. */
export function lecturesReadQuery(
  view: LecturesView,
  titleLocale: string,
): Record<string, unknown> {
  return {
    topic: view.topic,
    language: view.language,
    speaker: view.speaker,
    series: view.series,
    length: view.length,
    sort: view.sort,
    titleLocale,
    offset: (view.page - 1) * AUDIO_LISTING_PAGE,
    limit: AUDIO_LISTING_PAGE,
  };
}
