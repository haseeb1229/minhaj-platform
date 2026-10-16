import { z } from 'zod';

import {
  canonicalTimeZone,
  foldOf,
  foldSchema,
  instantsOf,
  localTimeSchema,
  offsetMinutesOf,
  resolveLocalTime,
  supportedTimeZones,
  timeZoneSchema,
  zonedIso,
  type Fold,
  type ResolvedTime,
} from '../platform/time.ts';

/**
 * Event — Phase 14, inside Editorial (DOMAIN_MODEL.md §7.1).
 *
 * ITS OWN AGGREGATE, NOT A NEWS FAMILY. An Event occurs; News reports on it
 * (§18). It shares Editorial's workflow, translations, typed Topic and Person
 * references and slug history, and owns what is genuinely its own: WHEN it
 * occurs (its schedule), the Global Network Centre it is held at — or none —
 * and the Media Galleries that photograph it. There is no image, no venue text,
 * no registration, ticket, price, organiser or livestream, and no recurrence
 * rule: an Event that happens more than once lists each occurrence.
 *
 * EVENTSCHEDULE IS THE REVISION'S SCHEDULE. The occurrences belong to an
 * immutable Event revision, exactly like its translations and topics, so moving
 * an Event, retiming it or changing its zone is an ordinary edit: a new
 * revision, back to draft, the old approval and any publication schedule
 * cleared, fresh independent review. Nothing can retime a published Event
 * except that path.
 *
 * TWO DIFFERENT SCHEDULES, NEVER CONFUSED. Editorial's PUBLICATION schedule
 * ("publish this revision at that instant") is the shared workflow's and is
 * untouched here. This module is about the OCCURRENCE: when the Event itself
 * takes place in the world.
 *
 * TIME IS THE INTENDED LOCAL TIME, IN AN IANA ZONE (§19.5). An editor states a
 * wall-clock time in the zone the Event is held in; the authoritative UTC
 * instant is derived from it here, on the server, and both are stored. A local
 * time a daylight-saving change skips is refused; one it repeats must be
 * disambiguated by the editor — neither is ever silently shifted. A date-only
 * Event is not modelled, so no date is ever faked as midnight UTC.
 *
 * PURE. Nothing here reads a clock it was not given: classification takes
 * `now` from the server, never from a browser.
 */

/* ===========================================================================
 * Bounds and addresses
 * ========================================================================= */

export const EVENT_LIMITS = Object.freeze({
  /** Occurrences one revision may list. */
  occurrences: 12,
  /** Galleries one revision may associate, in order. */
  galleries: 12,
  /** The years an occurrence may fall in. */
  earliestYear: 1900,
  latestYear: 2199,
});

/** One page of a public Event listing. */
export const EVENT_PAGE = 20;
/** The deepest offset a public listing accepts. */
export const EVENT_MAX_OFFSET = 25_000;
/** A topic hub's or a Centre page's Event section previews at most this many. */
export const EVENT_PREVIEW = 6;
/**
 * How many public Centres a geography filter may resolve to. A Country or City
 * holding more than this is refused as unavailable rather than silently
 * narrowed to a subset.
 */
export const EVENT_GEOGRAPHY_CENTRES = 2000;

/** The locale-free canonical address of one Event. */
export function eventPathOf(slug: string): string {
  return `/events/${encodeURIComponent(slug)}`;
}

/** The locale-free address of an Event's gallery view. */
export function eventGalleryPathOf(slug: string): string {
  return `${eventPathOf(slug)}/gallery`;
}

/* ===========================================================================
 * Time zones and local wall-clock times — the shared Layer-0 rules
 * ========================================================================= */

/**
 * Events schedule by the platform-wide rules of `@minhaj/contracts/platform`
 * (DOMAIN_MODEL.md §19.5): a zone NAME never an offset, a wall-clock time kept
 * beside its instant, and a daylight-saving transition resolved deliberately.
 * Phase 14 proved them here first; Phase 23 moved the implementation beside
 * the other platform contracts so Learning schedules classes by the SAME code.
 * The Event names below are kept so nothing that reads an Event changes.
 */
export const eventTimeZones = supportedTimeZones;
export {
  canonicalTimeZone,
  foldOf,
  instantsOf,
  offsetMinutesOf,
  resolveLocalTime,
  zonedIso,
};
export type { ResolvedTime };
export const eventTimeZoneSchema = timeZoneSchema;

/** A real calendar date and minute, within the accepted years. */
export const eventLocalTimeSchema = localTimeSchema({
  earliestYear: EVENT_LIMITS.earliestYear,
  latestYear: EVENT_LIMITS.latestYear,
});

/** Which of the two instants an editor means when a local time repeats. */
export const eventFoldSchema = foldSchema;
export type EventFold = Fold;

/* ===========================================================================
 * The schedule an editor submits, and the schedule that is stored
 * ========================================================================= */

/**
 * One occurrence as an editor states it: a local start and, where it has one,
 * a local end, each with the editor's choice for a repeated hour.
 */
export const eventOccurrenceInputSchema = z.strictObject({
  start: eventLocalTimeSchema,
  startFold: eventFoldSchema.nullable().default(null),
  end: eventLocalTimeSchema.nullable().default(null),
  endFold: eventFoldSchema.nullable().default(null),
});

export type EventOccurrenceInput = z.input<typeof eventOccurrenceInputSchema>;

export const eventScheduleInputSchema = z.strictObject({
  timezone: eventTimeZoneSchema,
  occurrences: z.array(eventOccurrenceInputSchema).min(1).max(EVENT_LIMITS.occurrences),
});

export type EventScheduleInput = z.input<typeof eventScheduleInputSchema>;

/**
 * One occurrence as it is stored and read: the intended local times — the
 * fact — and the UTC instants derived from them when the revision was written.
 * An occurrence without an end has neither end value.
 */
export interface EventOccurrence {
  readonly startsLocal: string;
  readonly startsAt: Date;
  readonly endsLocal: string | null;
  readonly endsAt: Date | null;
}

export interface EventSchedule {
  /** The IANA zone the Event is held in, in its canonical spelling. */
  readonly timezone: string;
  /** In chronological order of their start instants. */
  readonly occurrences: readonly EventOccurrence[];
}

/** Why a schedule an editor submitted cannot be stored. */
export type EventScheduleRefusal =
  'nonexistent-time' | 'ambiguous-time' | 'schedule-order' | 'duplicate-occurrence';

export const EVENT_SCHEDULE_REFUSALS: readonly EventScheduleRefusal[] = Object.freeze([
  'nonexistent-time',
  'ambiguous-time',
  'schedule-order',
  'duplicate-occurrence',
]);

/**
 * The stored schedule for a parsed input, or the FIRST reason it cannot be.
 *
 * END AFTER START, STRICTLY. An occurrence that ends when it starts has no
 * duration and is refused, so "ongoing" always has a meaning; an occurrence
 * with no end is a moment. Two occurrences starting at the same instant are
 * one occurrence written twice, and refused. The result is ordered by start.
 */
export function resolveEventSchedule(
  input: z.output<typeof eventScheduleInputSchema>,
):
  | { readonly ok: true; readonly schedule: EventSchedule }
  | { readonly ok: false; readonly refusal: EventScheduleRefusal } {
  const unresolved = (resolved: { readonly kind: 'nonexistent' | 'ambiguous' }) =>
    ({
      ok: false,
      refusal: resolved.kind === 'nonexistent' ? 'nonexistent-time' : 'ambiguous-time',
    }) as const;
  const occurrences: EventOccurrence[] = [];
  for (const entry of input.occurrences) {
    const start = resolveLocalTime(entry.start, input.timezone, entry.startFold);
    if (start.kind !== 'exact') return unresolved(start);
    const end =
      entry.end === null
        ? null
        : resolveLocalTime(entry.end, input.timezone, entry.endFold);
    if (end !== null && end.kind !== 'exact') return unresolved(end);
    const endsAt = end === null ? null : end.instant;
    if (endsAt !== null && endsAt.getTime() <= start.instant.getTime())
      return { ok: false, refusal: 'schedule-order' };
    occurrences.push({
      startsLocal: entry.start,
      startsAt: start.instant,
      endsLocal: entry.end,
      endsAt,
    });
  }
  occurrences.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  for (let index = 1; index < occurrences.length; index += 1)
    if (
      occurrences[index]?.startsAt.getTime() ===
      occurrences[index - 1]?.startsAt.getTime()
    )
      return { ok: false, refusal: 'duplicate-occurrence' };
  return { ok: true, schedule: { timezone: input.timezone, occurrences } };
}

/* ===========================================================================
 * Upcoming, ongoing, past — defined ONCE
 * ========================================================================= */

/** Upcoming and past are the two public views; `upcoming` includes ongoing. */
export const EVENT_WHEN = Object.freeze(['upcoming', 'past'] as const);
export type EventWhen = (typeof EVENT_WHEN)[number];
export const eventWhenSchema = z.enum(EVENT_WHEN);

/** When an occurrence is over: its end, or — with no end — its start. */
export function occurrenceEnd(occurrence: {
  readonly startsAt: Date;
  readonly endsAt: Date | null;
}): Date {
  return occurrence.endsAt ?? occurrence.startsAt;
}

/**
 * Where an Event stands at `now`, the SERVER's instant.
 *
 * `ongoing` while some occurrence has started and not yet ended; `upcoming`
 * while some occurrence is still ahead; `past` only once EVERY occurrence is
 * over. An ongoing Event is listed with the upcoming ones, so it never falls
 * between the two views. The SQL listing applies the same rule: an Event is
 * upcoming while its latest occurrence end has not passed.
 */
export function eventTiming(
  occurrences: readonly { readonly startsAt: Date; readonly endsAt: Date | null }[],
  now: Date,
): 'upcoming' | 'ongoing' | 'past' {
  const at = now.getTime();
  if (
    occurrences.some((o) => o.startsAt.getTime() <= at && occurrenceEnd(o).getTime() > at)
  )
    return 'ongoing';
  return occurrences.some((o) => occurrenceEnd(o).getTime() >= at) ? 'upcoming' : 'past';
}

/* ===========================================================================
 * Public read models
 * ========================================================================= */

/** One card: what a listing, a Centre page and the topic hub show of an Event. */
export interface EventSummary {
  readonly slug: string;
  readonly primaryLanguage: 'en' | 'ur' | 'ar';
  readonly translations: readonly {
    readonly languageCode: 'en' | 'ur' | 'ar';
    readonly title: string;
    readonly excerpt: string;
  }[];
  readonly schedule: EventSchedule;
  /** The Centre it is held at, as an IDENTIFIER; Global decides what is shown. */
  readonly centreId: string | null;
  readonly topicIds: readonly string[];
}

export interface EventPage {
  readonly items: readonly EventSummary[];
  readonly more: boolean;
}

/**
 * One bounded page of published Events: upcoming soonest first (ongoing ones
 * at the front), or past latest first. `centreIds` NARROWS to Events held at
 * those Centres — resolved by Global at Layer 4 — and never widens.
 */
export interface EventListQuery {
  readonly when: EventWhen;
  readonly now: Date;
  readonly offset: number;
  readonly limit: number;
  readonly centreIds: readonly string[] | null;
  readonly topicId: string | null;
}
