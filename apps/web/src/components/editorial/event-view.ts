import {
  EVENT_LIMITS,
  EVENT_LISTING_PAGE,
  EVENT_MAX_OFFSET,
  type EventWhen,
} from '@minhaj/contracts/editorial';
import { globalSlugSchema } from '@minhaj/contracts/global';

import {
  hubHref,
  identifier,
  single,
  unlessCanonical,
  whole,
  type Query,
} from '@/components/topic-hub/address';

/**
 * NEWS & EVENTS PART 2 — `/events`' ADDRESS RULES, pure, so the address the
 * filter form submits, the address a tab, chip, page or another page's link
 * builds, and the query Editorial is asked are ONE definition, proved by unit
 * test (`tests/editorial/event-view.test.ts`).
 *
 * `/events` takes `?when=past` (upcoming is the default), `?topic` (a Taxonomy
 * identifier), `?year` and `?month` (of an occurrence's intended local start,
 * a month only with its year), `?country`, `?city` (only with its Country),
 * `?centre` and `?page` (20 a page). Neutral values are omitted, so each view
 * has ONE address.
 *
 * TWO POSTURES, KEPT APART ON PURPOSE.
 *
 *   - A view or PLACE that cannot mean anything — an unknown `when`, a
 *     malformed place slug, a City without its Country, a repeated value — is
 *     REFUSED as Phase 14 refused it: the page says so and lists nothing,
 *     never quietly every Event (`invalid`). A place filter narrows by where an
 *     Event is held, so broadening a mistyped one would answer a different
 *     question as if it were the one asked.
 *   - Everything else is read tolerantly and, when it is not already the
 *     view's one spelling, answered with ONE redirect: a form's empty
 *     controls, another order of the parameters, a malformed Topic, year,
 *     month or page (dropped), and Phase 14's `?offset=` (the page holding the
 *     Event it began with).
 *
 * TOLERANT, NEVER TRUSTING. What this produces is parsed again by Editorial's
 * read service (`eventListingQuerySchema`), the authoritative boundary.
 */

/** The deepest page an address may name: Editorial's offset bound, in pages. */
export const EVENT_MAX_PAGE = Math.floor(EVENT_MAX_OFFSET / EVENT_LISTING_PAGE) + 1;

export const EVENTS_PATH = '/events';

export interface EventView {
  readonly when: EventWhen;
  /** A Taxonomy Topic identifier, in lower case. */
  readonly topic: string | null;
  readonly year: number | null;
  /** Only with a year. */
  readonly month: number | null;
  readonly country: string | null;
  /** Only with a Country. */
  readonly city: string | null;
  readonly centre: string | null;
  /** 1-based. */
  readonly page: number;
  /** The view or a place cannot mean anything: refused, never broadened. */
  readonly invalid: boolean;
}

export const DEFAULT_EVENT_VIEW: EventView = Object.freeze({
  when: 'upcoming',
  topic: null,
  year: null,
  month: null,
  country: null,
  city: null,
  centre: null,
  page: 1,
  invalid: false,
});

function yearOf(query: Query): number | null {
  const text = single(query, 'year', 4);
  return text !== null && /^\d{4}$/u.test(text)
    ? whole(text, EVENT_LIMITS.earliestYear, EVENT_LIMITS.latestYear)
    : null;
}

function monthOf(query: Query): number | null {
  const text = single(query, 'month', 2);
  return text !== null && /^\d{1,2}$/u.test(text) ? whole(text, 1, 12) : null;
}

/** The page a former `?offset=` named — the page holding the first Event it showed. */
function legacyPage(query: Query): number | null {
  const text = single(query, 'offset', 8);
  if (text === null || !/^\d{1,8}$/u.test(text)) return null;
  const offset = Number(text);
  return offset <= EVENT_MAX_OFFSET
    ? Math.min(Math.floor(offset / EVENT_LISTING_PAGE) + 1, EVENT_MAX_PAGE)
    : null;
}

/** A listing's view from its address. */
export function readEventView(query: Query): EventView {
  let invalid = false;
  /** One value, as given; empty is absent; a repeated value is refused. */
  const strict = (key: string): string | null => {
    const raw = query[key];
    if (raw === undefined || raw === '') return null;
    if (typeof raw !== 'string') {
      invalid = true;
      return null;
    }
    return raw;
  };
  const place = (key: string): string | null => {
    const raw = strict(key);
    if (raw === null) return null;
    if (!globalSlugSchema.safeParse(raw).success) {
      invalid = true;
      return null;
    }
    return raw;
  };
  const whenRaw = strict('when');
  if (whenRaw !== null && whenRaw !== 'upcoming' && whenRaw !== 'past') invalid = true;
  const country = place('country');
  const city = place('city');
  const centre = place('centre');
  if (city !== null && country === null) invalid = true;
  const year = yearOf(query);
  return {
    when: whenRaw === 'past' ? 'past' : 'upcoming',
    topic: identifier(query, 'topic'),
    year,
    month: year === null ? null : monthOf(query),
    country,
    city: country === null ? null : city,
    centre,
    page: whole(single(query, 'page', 5), 1, EVENT_MAX_PAGE) ?? legacyPage(query) ?? 1,
    invalid,
  };
}

/** Whether anything narrows the view. Upcoming or past is a view, not a narrowing. */
export function eventsFiltered(view: EventView): boolean {
  return (
    view.topic !== null ||
    view.year !== null ||
    view.country !== null ||
    view.centre !== null
  );
}

/** Whether a place narrows the view. */
export function eventsPlaced(view: EventView): boolean {
  return view.country !== null || view.centre !== null;
}

/**
 * The address of a view. Changing anything but the page returns to the first
 * page; a month goes with its year and a City with its Country. Identifiers
 * are written in lower case, as an address reads them.
 */
export function eventsHref(
  locale: string,
  view: Omit<EventView, 'invalid'>,
  change: Partial<Omit<EventView, 'invalid'>> = {},
): string {
  const next = { ...view, ...change };
  const page = change.page ?? (Object.keys(change).length === 0 ? view.page : 1);
  const search = new URLSearchParams();
  if (next.when === 'past') search.set('when', 'past');
  if (next.topic !== null) search.set('topic', next.topic.toLowerCase());
  if (next.year !== null) search.set('year', String(next.year));
  if (next.year !== null && next.month !== null) search.set('month', String(next.month));
  if (next.country !== null) search.set('country', next.country);
  if (next.country !== null && next.city !== null) search.set('city', next.city);
  if (next.centre !== null) search.set('centre', next.centre);
  if (page > 1) search.set('page', String(page));
  return hubHref(locale, EVENTS_PATH, search);
}

/** A view of `/events` from its unfiltered first page — what other pages link with. */
export function eventsListingHref(
  locale: string,
  change: Partial<Omit<EventView, 'invalid' | 'page'>> = {},
): string {
  return eventsHref(locale, { ...DEFAULT_EVENT_VIEW, ...change, page: 1 });
}

/**
 * The upcoming and past tabs: the other view keeping the Topic and the place.
 * A period belongs to one view — the months ahead are not the months held —
 * so it is left behind.
 */
export function eventsWhenHref(locale: string, view: EventView, when: EventWhen): string {
  return eventsListingHref(locale, {
    when,
    topic: view.topic,
    country: view.country,
    city: view.city,
    centre: view.centre,
  });
}

const LISTING_KEYS: ReadonlySet<string> = new Set([
  'when',
  'topic',
  'year',
  'month',
  'country',
  'city',
  'centre',
  'page',
  'offset',
]);

/**
 * ONE ADDRESS PER VIEW, for a view that means something. A refused view is
 * answered where it was asked — the page says why nothing is listed — so it is
 * never redirected into a broader one.
 */
export function eventsCanonicalRedirect(locale: string, query: Query): string | null {
  const view = readEventView(query);
  if (view.invalid) return null;
  return unlessCanonical(
    locale,
    EVENTS_PATH,
    query,
    LISTING_KEYS,
    eventsHref(locale, view),
  );
}

/** What Editorial is asked for one view, with the Centres a place resolved to. */
export function eventsReadQuery(
  view: EventView,
  centreIds: readonly string[] | null,
): Record<string, unknown> {
  return {
    when: view.when,
    topic: view.topic,
    year: view.year,
    month: view.month,
    centreIds,
    offset: (view.page - 1) * EVENT_LISTING_PAGE,
    limit: EVENT_LISTING_PAGE,
  };
}
