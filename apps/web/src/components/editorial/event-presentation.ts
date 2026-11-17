import { localizedPath } from '@minhaj/contracts';
import 'server-only';

import type { Locale } from '@minhaj/contracts';
import {
  eventPathOf,
  zonedIso,
  type EventOccurrence,
  type EventWhen,
  type PublicEvent,
} from '@minhaj/contracts/editorial';
import { labelFor, type PublicCentreSummary } from '@minhaj/contracts/global';

import { translationFor } from '@/components/editorial/presentation';
import { absoluteUrl } from '@/config/origin';
import { contentMetadata } from '@/seo/metadata';

/**
 * The PURE presentation rules of the Event pages (Phase 14): how an occurrence
 * is written, which one a card leads with and under which month it is listed,
 * and what an Event page claims to search engines. `/events`' address rules
 * are `./event-view` (News & Events Part 2). No read runtime and no rendering
 * here, so each rule is proved on its own
 * (`tests/editorial/event-presentation.test.ts`).
 */

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
  period: EventPeriod | null = null,
): EventOccurrence | undefined {
  // Within a chosen year or month, the card leads with an occurrence there —
  // the one the reader asked about — whenever the view has one.
  const inPeriod =
    period === null
      ? occurrences
      : occurrences.filter((o) => inEventPeriod(o.startsLocal, period));
  const pool = inPeriod.length === 0 ? occurrences : inPeriod;
  if (when === 'past') return pool[pool.length - 1];
  return (
    pool.find((o) => (o.endsAt ?? o.startsAt).getTime() >= now.getTime()) ??
    pool[pool.length - 1]
  );
}

/** A chosen year, and month within it, of the intended local start. */
export interface EventPeriod {
  readonly year: number;
  readonly month: number | null;
}

/** Whether a stated local start (`YYYY-MM-DDTHH:mm`) falls in a period. */
export function inEventPeriod(local: string, period: EventPeriod): boolean {
  const { year, month } = monthOfLocal(local);
  return year === period.year && (period.month === null || month === period.month);
}

/**
 * The calendar month a stated local start falls in — the month the listing
 * groups an Event under, read from the wall clock the editor stated in the
 * Event's own zone and never shifted by a reader's.
 */
export function monthOfLocal(local: string): {
  readonly year: number;
  readonly month: number;
} {
  return { year: Number(local.slice(0, 4)), month: Number(local.slice(5, 7)) };
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
    pathFor: (language) => localizedPath(language, `${eventPathOf(record.slug)}`),
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
  const url = absoluteUrl(localizedPath(language, `${eventPathOf(record.slug)}`));
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

/**
 * Where an Event is held, as one line for a calendar file (News & Events Part
 * 2): the public Centre's name, then — for a physical Centre — its address,
 * City and Country, in the language the Event's words are shown in, exactly as
 * the structured data names the place. Nothing without a public Centre.
 */
export function calendarLocation(
  record: PublicEvent,
  locale: Locale,
  centre: PublicCentreSummary | null,
): string | null {
  if (centre === null) return null;
  const language = translationFor(record, locale).languageCode;
  const words = labelFor(centre, language);
  if (words === null) return null;
  if (centre.isVirtual) return words.name;
  const city = centre.city === null ? null : labelFor(centre.city, language);
  const country = labelFor(centre.country, language);
  return [words.name, words.address ?? null, city?.name ?? null, country?.name ?? null]
    .filter((part): part is string => part !== null && part !== '')
    .join(', ');
}
