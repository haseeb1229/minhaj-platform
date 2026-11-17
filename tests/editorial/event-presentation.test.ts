import { afterAll, describe, expect, it, vi } from 'vitest';

import type {
  EventOccurrence,
  PublicEvent,
} from '../../packages/contracts/src/editorial/index.ts';
import type { PublicCentreSummary } from '../../packages/contracts/src/global/index.ts';

/**
 * Phase 14 — the Event pages' pure presentation rules: how `/events` is
 * queried (an invalid query is REFUSED, never broadened), how an occurrence is
 * written for a reader (the stated LOCAL time, unchanged, in every interface
 * locale, with the real offset in the machine value), which occurrence a card
 * leads with, and what an Event page claims to search engines.
 *
 * THE INDEXING POSTURE IS SET PER TEST, as the News presentation proof does,
 * so canonical and alternate URLs are checked for what they say and the
 * fail-closed posture is asserted separately.
 */

const ORIGIN = 'https://events-seo.proof.invalid';

async function withIndexing(enabled: boolean) {
  vi.resetModules();
  process.env['MINHAJ_BUILD_PUBLIC_INDEXING_ENABLED'] = enabled ? 'true' : 'false';
  process.env['AUTH_BASE_URL'] = ORIGIN;
  return import('../../apps/web/src/components/editorial/event-presentation.ts');
}

afterAll(() => {
  delete process.env['MINHAJ_BUILD_PUBLIC_INDEXING_ENABLED'];
});

const translation = (languageCode: 'en' | 'ur' | 'ar', title: string, excerpt = '') => ({
  languageCode,
  title,
  excerpt,
  seoTitle: '',
  seoDescription: '',
  html: '<p>Synthetic</p>',
});

const karachi: EventOccurrence = {
  startsLocal: '2031-11-14T19:00',
  startsAt: new Date('2031-11-14T14:00:00Z'),
  endsLocal: '2031-11-14T21:00',
  endsAt: new Date('2031-11-14T16:00:00Z'),
};

function record(overrides: Partial<PublicEvent> = {}): PublicEvent {
  return {
    slug: 'synthetic-event',
    primaryLanguage: 'ur',
    translations: [
      translation('ur', 'آزمائشی تقریب'),
      translation('en', 'Synthetic event', 'A synthetic summary'),
    ],
    topicIds: [],
    contributors: [],
    schedule: { timezone: 'Asia/Karachi', occurrences: [karachi] },
    centreId: '00000000-0000-4000-8000-000000000001',
    galleryIds: [],
    publishedAt: new Date('2031-01-01T00:00:00Z'),
    updatedAt: new Date('2031-01-02T00:00:00Z'),
    ...overrides,
  };
}

const place = (slug: string, name: string) => ({
  id: `00000000-0000-4000-8000-${slug.length.toString().padStart(12, '0')}`,
  slug,
  primaryLocale: 'en' as const,
  labels: [{ locale: 'en' as const, name }],
});

function centre(overrides: Partial<PublicCentreSummary> = {}): PublicCentreSummary {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    slug: 'synthetic-centre',
    isVirtual: false,
    primaryLocale: 'en',
    labels: [
      {
        locale: 'en',
        name: 'Synthetic Centre',
        description: null,
        address: '1 Synthetic Street',
      },
    ],
    country: place('xa', 'Synthetic Country'),
    region: place('area', 'Synthetic Region'),
    city: place('town', 'Synthetic City'),
    ...overrides,
  };
}

// News & Events Part 2: `/events`' query rules moved to `./event-view.test.ts`
// with the address module they prove (`event-view.ts`).

describe('an occurrence, as a reader sees it', () => {
  const reference = (locale: string, local: string, end: string | null = null) => {
    const format = new Intl.DateTimeFormat(locale, {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: 'UTC',
    });
    const start = new Date(`${local}:00Z`);
    return end === null
      ? format.format(start)
      : format.formatRange(start, new Date(`${end}:00Z`));
  };

  it('writes the stated LOCAL time unchanged in en, ur and ar', async () => {
    const { occurrenceWords } = await withIndexing(false);
    for (const locale of ['en', 'ur', 'ar'] as const) {
      const words = occurrenceWords(karachi, 'Asia/Karachi', locale);
      expect(words.text, locale).toBe(
        reference(locale, karachi.startsLocal, karachi.endsLocal),
      );
      // Never the UTC instant's wall clock, which is five hours earlier.
      expect(words.text, locale).not.toBe(
        reference(locale, '2031-11-14T14:00', '2031-11-14T16:00'),
      );
      expect(words.start).toBe('2031-11-14T19:00:00+05:00');
      expect(words.end).toBe('2031-11-14T21:00:00+05:00');
    }
    const english = occurrenceWords(karachi, 'Asia/Karachi', 'en');
    expect(english.text).toContain('November 14, 2031');
    expect(english.text).toContain('7:00');
    expect(english.text).toContain('9:00');
    expect(english.zoneName).toBe('Pakistan Standard Time');
  });

  it('carries no end where there is none', async () => {
    const { occurrenceWords } = await withIndexing(false);
    const moment = { ...karachi, endsLocal: null, endsAt: null };
    const words = occurrenceWords(moment, 'Asia/Karachi', 'ur');
    expect(words.end).toBeNull();
    expect(words.text).toBe(reference('ur', karachi.startsLocal));
  });

  it('names the zone as it was at that instant, so daylight saving shows', async () => {
    const { occurrenceWords } = await withIndexing(false);
    const repeated = '2031-11-02T01:30';
    const earlier = occurrenceWords(
      {
        startsLocal: repeated,
        startsAt: new Date('2031-11-02T05:30:00Z'),
        endsLocal: null,
        endsAt: null,
      },
      'America/New_York',
      'en',
    );
    const later = occurrenceWords(
      {
        startsLocal: repeated,
        startsAt: new Date('2031-11-02T06:30:00Z'),
        endsLocal: null,
        endsAt: null,
      },
      'America/New_York',
      'en',
    );
    // The same words for the same stated time…
    expect(earlier.text).toBe(later.text);
    // …and the zone and the machine value tell the two apart.
    expect(earlier.zoneName).toBe('Eastern Daylight Time');
    expect(later.zoneName).toBe('Eastern Standard Time');
    expect(earlier.start).toBe('2031-11-02T01:30:00-04:00');
    expect(later.start).toBe('2031-11-02T01:30:00-05:00');
  });
});

describe('the occurrence a card leads with', () => {
  const occurrence = (start: string, end: string | null): EventOccurrence => ({
    startsLocal: start.slice(0, 16),
    startsAt: new Date(start),
    endsLocal: end === null ? null : end.slice(0, 16),
    endsAt: end === null ? null : new Date(end),
  });
  const first = occurrence('2031-01-01T10:00:00Z', '2031-01-01T12:00:00Z');
  const second = occurrence('2031-02-01T10:00:00Z', null);
  const third = occurrence('2031-03-01T10:00:00Z', '2031-03-02T10:00:00Z');
  const all = [first, second, third];

  it('is the next one not yet over in the upcoming view', async () => {
    const { leadingOccurrence } = await withIndexing(false);
    expect(leadingOccurrence(all, 'upcoming', new Date('2030-12-01T00:00Z'))).toBe(first);
    // Under way still leads.
    expect(leadingOccurrence(all, 'upcoming', new Date('2031-01-01T11:00Z'))).toBe(first);
    expect(leadingOccurrence(all, 'upcoming', new Date('2031-01-01T12:00:01Z'))).toBe(
      second,
    );
    expect(leadingOccurrence(all, 'upcoming', new Date('2031-02-01T10:00:00Z'))).toBe(
      second,
    );
    expect(leadingOccurrence(all, 'upcoming', new Date('2031-02-01T10:00:01Z'))).toBe(
      third,
    );
    // Never undefined while any occurrence exists.
    expect(leadingOccurrence(all, 'upcoming', new Date('2032-01-01T00:00Z'))).toBe(third);
  });

  it('is the last one in the past view', async () => {
    const { leadingOccurrence } = await withIndexing(false);
    expect(leadingOccurrence(all, 'past', new Date('2040-01-01T00:00Z'))).toBe(third);
    expect(leadingOccurrence([], 'past', new Date())).toBeUndefined();
  });

  it('leads, within a chosen year or month, with an occurrence there (News & Events Part 2)', async () => {
    const { leadingOccurrence } = await withIndexing(false);
    const before = new Date('2030-12-01T00:00Z');
    // February is asked for: February leads, though January comes first.
    expect(leadingOccurrence(all, 'upcoming', before, { year: 2031, month: 2 })).toBe(
      second,
    );
    expect(
      leadingOccurrence(all, 'past', new Date('2040-01-01T00:00Z'), {
        year: 2031,
        month: 1,
      }),
    ).toBe(first);
    // A year alone: the first not yet over within it.
    expect(
      leadingOccurrence(all, 'upcoming', new Date('2031-01-01T12:00:01Z'), {
        year: 2031,
        month: null,
      }),
    ).toBe(second);
    // A period none falls in changes nothing.
    expect(leadingOccurrence(all, 'upcoming', before, { year: 2035, month: null })).toBe(
      first,
    );
  });

  it('places an occurrence in the month of its STATED local start', async () => {
    const { inEventPeriod, monthOfLocal } = await withIndexing(false);
    expect(monthOfLocal('2040-08-01T02:00')).toEqual({ year: 2040, month: 8 });
    expect(inEventPeriod('2040-08-01T02:00', { year: 2040, month: 8 })).toBe(true);
    expect(inEventPeriod('2040-08-01T02:00', { year: 2040, month: 7 })).toBe(false);
    expect(inEventPeriod('2040-08-01T02:00', { year: 2040, month: null })).toBe(true);
    expect(inEventPeriod('2040-08-01T02:00', { year: 2039, month: null })).toBe(false);
  });
});

describe('where an Event is held, for a calendar file', () => {
  it('names a physical Centre with its address, City and Country, in the shown language', async () => {
    const { calendarLocation } = await withIndexing(false);
    expect(calendarLocation(record(), 'en', centre())).toBe(
      'Synthetic Centre, 1 Synthetic Street, Synthetic City, Synthetic Country',
    );
    // A virtual Centre is its name alone; no Centre, or no label, is nothing.
    expect(calendarLocation(record(), 'en', centre({ isVirtual: true }))).toBe(
      'Synthetic Centre',
    );
    expect(calendarLocation(record(), 'en', null)).toBeNull();
    expect(
      calendarLocation(
        record(),
        'en',
        centre({
          city: null,
          labels: [
            { locale: 'en', name: 'Synthetic Centre', description: null, address: null },
          ],
        }),
      ),
    ).toBe('Synthetic Centre, Synthetic Country');
  });
});

describe('Event structured data claims only what is true', () => {
  it('claims one Event at a public physical Centre, with only recorded facts', async () => {
    const { eventStructuredData } = await withIndexing(true);
    const data = eventStructuredData(record(), 'en', centre());
    expect(data).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: 'Synthetic event',
      description: 'A synthetic summary',
      inLanguage: 'en',
      url: `${ORIGIN}/events/synthetic-event`,
      startDate: '2031-11-14T19:00:00+05:00',
      endDate: '2031-11-14T21:00:00+05:00',
      location: {
        '@type': 'Place',
        name: 'Synthetic Centre',
        address: {
          '@type': 'PostalAddress',
          streetAddress: '1 Synthetic Street',
          addressLocality: 'Synthetic City',
          addressRegion: 'Synthetic Region',
          addressCountry: 'Synthetic Country',
        },
      },
    });
    const text = JSON.stringify(data);
    for (const claim of [
      'image',
      'organizer',
      'performer',
      'offers',
      'eventStatus',
      'eventAttendanceMode',
      'Organization',
    ])
      expect(text).not.toContain(claim);
  });

  it('claims nothing without a Centre, at a virtual one, or without a City or address', async () => {
    const { eventStructuredData } = await withIndexing(true);
    expect(eventStructuredData(record({ centreId: null }), 'en', null)).toBeNull();
    expect(eventStructuredData(record(), 'en', centre({ isVirtual: true }))).toBeNull();
    expect(
      eventStructuredData(
        record(),
        'en',
        centre({
          city: null,
          labels: [
            { locale: 'en', name: 'Synthetic Centre', description: null, address: null },
          ],
        }),
      ),
    ).toBeNull();
    // A City alone, or an address alone, is a genuine location.
    expect(
      eventStructuredData(
        record(),
        'en',
        centre({
          labels: [
            { locale: 'en', name: 'Synthetic Centre', description: null, address: null },
          ],
        }),
      ),
    ).toMatchObject({
      location: { address: { addressLocality: 'Synthetic City' } },
    });
    const addressOnly = eventStructuredData(
      record(),
      'en',
      centre({ city: null, region: null }),
    );
    expect(addressOnly).toMatchObject({
      location: { address: { streetAddress: '1 Synthetic Street' } },
    });
    expect(JSON.stringify(addressOnly)).not.toContain('addressLocality');
  });

  it('claims one Event per occurrence as a graph, endDate only where an end exists', async () => {
    const { eventStructuredData } = await withIndexing(true);
    const second: EventOccurrence = {
      startsLocal: '2031-11-15T10:00',
      startsAt: new Date('2031-11-15T05:00:00Z'),
      endsLocal: null,
      endsAt: null,
    };
    const data = eventStructuredData(
      record({
        schedule: { timezone: 'Asia/Karachi', occurrences: [karachi, second] },
      }),
      'en',
      centre(),
    );
    expect(data).not.toHaveProperty('@type');
    const graph = (data as { '@graph': Record<string, unknown>[] })['@graph'];
    expect(data?.['@context']).toBe('https://schema.org');
    expect(graph).toHaveLength(2);
    expect(graph.map((event) => event['@type'])).toEqual(['Event', 'Event']);
    expect(graph.map((event) => event['startDate'])).toEqual([
      '2031-11-14T19:00:00+05:00',
      '2031-11-15T10:00:00+05:00',
    ]);
    expect(graph[0]).toHaveProperty('endDate', '2031-11-14T21:00:00+05:00');
    expect(graph[1]).not.toHaveProperty('endDate');
  });

  it('describes the language actually shown, at that language’s address', async () => {
    const { eventStructuredData } = await withIndexing(true);
    // No Arabic exists: the reader sees the Urdu original, and the claim says so.
    const data = eventStructuredData(record(), 'ar', centre());
    expect(data).toMatchObject({
      name: 'آزمائشی تقریب',
      inLanguage: 'ur',
      url: `${ORIGIN}/ur/events/synthetic-event`,
    });
    // The Urdu translation has no excerpt, so no description is claimed.
    expect(data).not.toHaveProperty('description');
  });
});

describe('canonical and hreflang', () => {
  it('lists only the languages the Event genuinely exists in', async () => {
    const { eventMetadata } = await withIndexing(true);
    const metadata = eventMetadata(record(), 'ar');
    expect(metadata.robots).toEqual({ index: true, follow: true });
    expect(metadata.alternates?.canonical).toBe(`${ORIGIN}/ur/events/synthetic-event`);
    expect(metadata.alternates?.languages).toEqual({
      en: `${ORIGIN}/events/synthetic-event`,
      ur: `${ORIGIN}/ur/events/synthetic-event`,
      'x-default': `${ORIGIN}/events/synthetic-event`,
    });
  });

  it('claims nothing on the pre-adoption origin', async () => {
    const { eventMetadata } = await withIndexing(false);
    const metadata = eventMetadata(record(), 'en');
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.alternates).toBeUndefined();
  });
});
