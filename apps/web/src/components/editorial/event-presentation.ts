import 'server-only';

import type { Locale } from '@minhaj/contracts';
import {
  EVENT_MAX_OFFSET,
  eventPathOf,
  zonedIso,
  type EventOccurrence,
  type EventWhen,
  type PublicEvent,
} from '@minhaj/contracts/editorial';
import {
  globalSlugSchema,
  labelFor,
  type PublicCentreSummary,
} from '@minhaj/contracts/global';

import { translationFor } from '@/components/editorial/presentation';
import { absoluteUrl } from '@/config/origin';
import { contentMetadata } from '@/seo/metadata';

/**
 * The PURE presentation rules of the Event pages (Phase 14): how `/events` is
 * queried, how an occurrence is written, what an Event page claims to search
 * engines. No read runtime and no rendering here, so each rule is proved on its
 * own (`tests/editorial/event-presentation.test.ts`).
 */

type Query = Record<string, string | string[] | undefined>;

/* ===========================================================================
 * /events?when=&country=&city=&centre=&offset=
 * ========================================================================= */

/**
 * The listing's query AS GIVEN, with `invalid` set when any part cannot mean
 * anything: an unknown `when`, a malformed slug, a City without its Country, a
 * repeated parameter. An invalid query is REFUSED, never broadened — the page
 * says so and lists nothing rather than quietly showing every Event.
 */
export interface EventQuery {
  readonly when: EventWhen;
  readonly country: string | null;
  readonly city: string | null;
  readonly centre: string | null;
  readonly offset: number;
  readonly invalid: boolean;
}

export function readEventQuery(query: Query): EventQuery {
  let invalid = false;
  const single = (key: string): string | null => {
    const raw = query[key];
    if (raw === undefined || raw === '') return null;
    if (typeof raw !== 'string') {
      invalid = true;
      return null;
    }
    return raw;
  };
  const slug = (key: string): string | null => {
    const raw = single(key);
    if (raw === null) return null;
    if (!globalSlugSchema.safeParse(raw).success) {
      invalid = true;
      return null;
    }
    return raw;
  };
  const whenRaw = single('when');
  if (whenRaw !== null && whenRaw !== 'upcoming' && whenRaw !== 'past') invalid = true;
  const when: EventWhen = whenRaw === 'past' ? 'past' : 'upcoming';
  const country = slug('country');
  const city = slug('city');
  const centre = slug('centre');
  if (city !== null && country === null) invalid = true;
  const offsetRaw = single('offset');
  let offset = 0;
  if (offsetRaw !== null) {
    if (/^\d{1,8}$/.test(offsetRaw) && Number(offsetRaw) <= EVENT_MAX_OFFSET)
      offset = Number(offsetRaw);
    else invalid = true;
  }
  return { when, country, city, centre, offset, invalid };
}

/**
 * The listing's address for a filter and an offset, neutral values omitted —
 * so the default view is the bare `/events` every filter canonicalises to.
 */
export function eventsPath(
  locale: string,
  filter: Pick<EventQuery, 'when' | 'country' | 'city' | 'centre'>,
  offset = 0,
): string {
  const search = new URLSearchParams();
  if (filter.when === 'past') search.set('when', 'past');
  if (filter.country !== null) search.set('country', filter.country);
  if (filter.country !== null && filter.city !== null) search.set('city', filter.city);
  if (filter.centre !== null) search.set('centre', filter.centre);
  if (offset > 0) search.set('offset', String(offset));
  const encoded = search.toString();
  return `/${locale}/events${encoded === '' ? '' : `?${encoded}`}`;
}

/* ===========================================================================
 * Occurrences, as a reader sees them
 * ========================================================================= */

/** A stored wall-clock time as a Date whose UTC fields ARE that wall clock. */
function wallDate(local: string): Date {
  return new Date(`${local}:00.000Z`);
}

/**
 * One occurrence in the interface locale: the INTENDED LOCAL date and time —
 * the fact the editor stated — formatted without any conversion, a same-day
 * end written as a range, and the zone's own localised name at that instant
 * (which is how a reader sees daylight saving). Machine-readable start and end
 * carry their real offsets.
 */
export function occurrenceWords(
  occurrence: EventOccurrence,
  zone: string,
  locale: Locale,
): {
  readonly text: string;
  readonly zoneName: string;
  readonly start: string;
  readonly end: string | null;
} {
  const format = new Intl.DateTimeFormat(locale, {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'UTC',
  });
  const start = wallDate(occurrence.startsLocal);
  const text =
    occurrence.endsLocal === null
      ? format.format(start)
      : format.formatRange(start, wallDate(occurrence.endsLocal));
  const zoneName =
    new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'long' })
      .formatToParts(occurrence.startsAt)
      .find((part) => part.type === 'timeZoneName')?.value ?? zone;
  return {
    text,
    zoneName,
    start: zonedIso(occurrence.startsLocal, occurrence.startsAt),
    end:
      occurrence.endsLocal === null || occurrence.endsAt === null
        ? null
        : zonedIso(occurrence.endsLocal, occurrence.endsAt),
  };
}

/**
 * The occurrence a card leads with: in the upcoming view the next one that has
 * not ended, in the past view the last one. Never an arbitrary one.
 */
export function leadingOccurrence(
  occurrences: readonly EventOccurrence[],
  when: EventWhen,
  now: Date,
): EventOccurrence | undefined {
  if (when === 'past') return occurrences[occurrences.length - 1];
  return (
    occurrences.find((o) => (o.endsAt ?? o.startsAt).getTime() >= now.getTime()) ??
    occurrences[occurrences.length - 1]
  );
}

/* ===========================================================================
 * Metadata and structured data
 * ========================================================================= */

/** Canonical, `hreflang` and `x-default` from the Event's own languages. */
export function eventMetadata(record: PublicEvent, locale: Locale) {
  const translation = translationFor(record, locale);
  const description = translation.seoDescription || translation.excerpt;
  return contentMetadata({
    locale,
    contentLocales: record.translations.map((row) => row.languageCode),
    primaryLocale: record.primaryLanguage,
    pathFor: (language) => `/${language}${eventPathOf(record.slug)}`,
    title: translation.seoTitle || translation.title,
    ...(description ? { description } : {}),
  });
}

/**
 * STRUCTURED DATA, ONLY WHAT IS TRUE (ROUTE_MAP.md §9.6): `Event` with a
 * genuine date AND a genuine location — or nothing.
 *
 * The location is the public Centre the Event is held at, as Global states it
 * NOW: a physical Centre with a City or an address. A virtual Centre, a Centre
 * no longer public, or no Centre at all means no location is known, so no
 * `Event` is claimed — the page keeps its BreadcrumbList alone.
 *
 * ONE `Event` PER OCCURRENCE, each with its own start and, where there is one,
 * end, in local time with its offset — never one invented span from the first
 * start to the last end, and never one arbitrary occurrence standing for the
 * rest. No image, organiser, performer, offer, status or attendance mode is
 * claimed: none is recorded.
 */
export function eventStructuredData(
  record: PublicEvent,
  locale: Locale,
  centre: PublicCentreSummary | null,
): Record<string, unknown> | null {
  if (centre === null || centre.isVirtual) return null;
  const translation = translationFor(record, locale);
  // The place is named in the language the Event's own words are in, so one
  // structured-data object never mixes two languages under one `inLanguage`.
  const language = translation.languageCode;
  const words = labelFor(centre, language);
  const city = centre.city === null ? null : labelFor(centre.city, language);
  const region = centre.region === null ? null : labelFor(centre.region, language);
  const country = labelFor(centre.country, language);
  const address = words?.address ?? null;
  if (words === null || (city === null && address === null)) return null;
  const url = absoluteUrl(`/${language}${eventPathOf(record.slug)}`);
  const place = {
    '@type': 'Place',
    name: words.name,
    address: {
      '@type': 'PostalAddress',
      ...(address === null ? {} : { streetAddress: address }),
      ...(city === null ? {} : { addressLocality: city.name }),
      ...(region === null ? {} : { addressRegion: region.name }),
      ...(country === null ? {} : { addressCountry: country.name }),
    },
  };
  const events = record.schedule.occurrences.map((occurrence) => ({
    '@type': 'Event',
    name: translation.title,
    ...(translation.excerpt === '' ? {} : { description: translation.excerpt }),
    inLanguage: language,
    url,
    startDate: zonedIso(occurrence.startsLocal, occurrence.startsAt),
    ...(occurrence.endsLocal === null || occurrence.endsAt === null
      ? {}
      : { endDate: zonedIso(occurrence.endsLocal, occurrence.endsAt) }),
    location: place,
  }));
  return events.length === 1
    ? { '@context': 'https://schema.org', ...events[0] }
    : { '@context': 'https://schema.org', '@graph': events };
}
