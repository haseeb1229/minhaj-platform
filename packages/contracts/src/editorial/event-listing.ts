import { z } from 'zod';

import {
  EVENT_GEOGRAPHY_CENTRES,
  EVENT_LIMITS,
  EVENT_MAX_OFFSET,
  EVENT_PAGE,
  eventWhenSchema,
  type EventSummary,
  type EventWhen,
} from './event.ts';
import { editorialIdSchema } from './values.ts';

/**
 * NEWS & EVENTS PART 2 — `/events` AS ITS PUBLIC PAGE READS IT
 * (DOMAIN_MODEL.md §7.2.3; ROUTE_MAP.md §3.9): one bounded page of the
 * upcoming or past view with the view's total, and the counts its tabs and
 * filters are navigated by.
 *
 * THE ORDINARY PUBLIC PREDICATE THROUGHOUT. Only a PUBLISHED Event is listed or
 * counted, and only its CURRENT revision's occurrences, Topics and Centre are
 * read. Every filter only ever NARROWS that predicate.
 *
 * UPCOMING AND PAST ARE `eventTiming`'s, decided by the SERVER's clock: the
 * read service supplies `now`, never a visitor.
 *
 * A YEAR AND MONTH ARE THE INTENDED LOCAL START of an occurrence IN THE VIEW —
 * in the upcoming view an occurrence that has not ended, in the past view any
 * (every one has ended) — so an Event with dates in two months is found under
 * each, and an upcoming Event is never found under a month it has already
 * left behind. The month is the wall-clock month the editor stated in the
 * Event's own zone, never shifted by a reader's.
 *
 * PLACES ARE GLOBAL'S. Editorial answers a Centre IDENTIFIER and how many
 * Events of the view each holds; Global says, at Layer 4, which of them are
 * public, physical, and in which Country and City. A geography filter arrives
 * as the Centre identifiers Global resolved and only narrows.
 */

/** One page of `/events`. */
export const EVENT_LISTING_PAGE = EVENT_PAGE;

/** The Topic facet names at most this many Topics, the commonest first. */
export const EVENT_FACET_PAGE = 50;

/**
 * The Centre facet names at most this many Centres, the busiest first. With
 * more, the page offers its places uncounted rather than counting a subset.
 */
export const EVENT_FACET_CENTRES = 200;

export const eventListingQuerySchema = z
  .strictObject({
    when: eventWhenSchema,
    topic: editorialIdSchema.nullable().default(null),
    year: z
      .number()
      .int()
      .min(EVENT_LIMITS.earliestYear)
      .max(EVENT_LIMITS.latestYear)
      .nullable()
      .default(null),
    month: z.number().int().min(1).max(12).nullable().default(null),
    /** Centres Global resolved for a place; `null` is no place filter at all. */
    centreIds: z
      .array(editorialIdSchema)
      .max(EVENT_GEOGRAPHY_CENTRES)
      .nullable()
      .default(null),
    offset: z.number().int().min(0).max(EVENT_MAX_OFFSET).default(0),
    limit: z.number().int().min(1).max(EVENT_LISTING_PAGE).default(EVENT_LISTING_PAGE),
  })
  .refine((query) => query.month === null || query.year !== null, {
    message: 'A month needs its year.',
    path: ['month'],
  });
export type EventListingQuery = z.infer<typeof eventListingQuerySchema>;

/** What the port is asked: the validated view and the server's instant. */
export interface EventListingRead extends EventListingQuery {
  readonly now: Date;
}

export interface EventListingPage {
  readonly items: readonly EventSummary[];
  /** How many published Events the view admits in all. */
  readonly total: number;
  readonly hasMore: boolean;
}

/**
 * The listing's aggregates, each value counted UNDER EVERY OTHER FILTER, its
 * own left out:
 *
 *   `when`     upcoming and past under the Topic and place — the two tabs,
 *              which keep those and leave a period behind (a period belongs
 *              to one view);
 *   `topics`   under the view, period and place;
 *   `years`    under the view, Topic and place; `months` only once a year is
 *              chosen, within it;
 *   `centres`  under the view, Topic and period — never the place, which
 *              they are how the page counts.
 */
export interface EventListingFacets {
  readonly when: Readonly<Record<EventWhen, number>>;
  readonly topics: {
    readonly items: readonly { readonly id: string; readonly events: number }[];
    readonly hasMore: boolean;
  };
  readonly years: readonly { readonly year: number; readonly events: number }[];
  readonly months: readonly { readonly month: number; readonly events: number }[];
  readonly centres: {
    readonly items: readonly { readonly id: string; readonly events: number }[];
    readonly hasMore: boolean;
  };
}
