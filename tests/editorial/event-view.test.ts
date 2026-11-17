import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EVENT_VIEW,
  EVENT_MAX_PAGE,
  eventsCanonicalRedirect,
  eventsHref,
  eventsListingHref,
  eventsReadQuery,
  eventsWhenHref,
  readEventView,
} from '../../apps/web/src/components/editorial/event-view.ts';
import {
  EVENT_LISTING_PAGE,
  eventListingQuerySchema,
} from '../../packages/contracts/src/editorial/index.ts';

/**
 * News & Events Part 2 — `/events`' address rules, pure: how an address is
 * read (a view or place that cannot mean anything REFUSED, as Phase 14 refused
 * it; everything else read tolerantly), how every view is written, which
 * former spellings are ONE redirect to the view's one address, and that what
 * Editorial is asked is what its read service accepts. Phase 14's query proofs
 * (`event-presentation.test.ts`) moved here with the rules they prove.
 */

const TOPIC = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('reading a view', () => {
  it('reads a complete, valid view as given', () => {
    expect(
      readEventView({
        when: 'past',
        topic: TOPIC.toUpperCase(),
        year: '2031',
        month: '6',
        country: 'xa',
        city: 'synthetic-town',
        centre: 'synthetic-centre',
        page: '3',
      }),
    ).toEqual({
      when: 'past',
      topic: TOPIC,
      year: 2031,
      month: 6,
      country: 'xa',
      city: 'synthetic-town',
      centre: 'synthetic-centre',
      page: 3,
      invalid: false,
    });
    expect(readEventView({})).toEqual(DEFAULT_EVENT_VIEW);
    // An empty value is an absent one.
    expect(
      readEventView({ when: '', country: '', city: '', topic: '', page: '' }),
    ).toEqual(DEFAULT_EVENT_VIEW);
  });

  it.each([
    [{ when: 'later' }],
    [{ when: 'UPCOMING' }],
    [{ when: ['upcoming', 'past'] }],
    [{ country: 'Not A Slug' }],
    [{ country: '../xa' }],
    [{ centre: 'x' }],
    [{ centre: 'a'.repeat(121) }],
    [{ city: 'synthetic-town' }],
    [{ country: ['xa', 'xb'] }],
    [{ city: ['a-town', 'b-town'], country: 'xa' }],
  ])('refuses %j rather than broadening it', (query) => {
    expect(readEventView(query).invalid).toBe(true);
    // A refused view is answered where it was asked, never redirected.
    expect(eventsCanonicalRedirect('en', query)).toBeNull();
  });

  it('never widens the view of a refused query', () => {
    // The view is kept and the place refused — never silently dropped.
    expect(readEventView({ when: 'past', city: 'synthetic-town' })).toMatchObject({
      when: 'past',
      invalid: true,
    });
  });

  it.each([
    [{ topic: 'not-an-id' }, { topic: null }],
    [{ year: '31' }, { year: null }],
    [{ year: '1899' }, { year: null }],
    [{ year: '2200' }, { year: null }],
    [
      { year: '2031', month: '13' },
      { year: 2031, month: null },
    ],
    [{ month: '6' }, { year: null, month: null }],
    [{ page: '0' }, { page: 1 }],
    [{ page: '-2' }, { page: 1 }],
    [{ page: '1.5' }, { page: 1 }],
    [{ page: String(EVENT_MAX_PAGE + 1) }, { page: 1 }],
    [{ offset: '40' }, { page: 3 }],
    [{ offset: '45' }, { page: 3 }],
    [{ offset: '25001' }, { page: 1 }],
    [{ offset: 'x' }, { page: 1 }],
  ])('reads %j tolerantly as %j', (query, expected) => {
    expect(readEventView(query)).toMatchObject({ ...expected, invalid: false });
  });
});

describe('writing a view', () => {
  it('omits every neutral value, so each view has ONE address', () => {
    expect(eventsHref('en', DEFAULT_EVENT_VIEW)).toBe('/events');
    expect(eventsHref('ur', DEFAULT_EVENT_VIEW)).toBe('/ur/events');
    expect(eventsListingHref('ar', { when: 'past' })).toBe('/ar/events?when=past');
    expect(
      eventsHref('en', {
        ...DEFAULT_EVENT_VIEW,
        when: 'past',
        topic: TOPIC.toUpperCase(),
        year: 2031,
        month: 6,
        country: 'xa',
        city: 'town',
        centre: 'synthetic-centre',
        page: 2,
      }),
    ).toBe(
      `/events?when=past&topic=${TOPIC}&year=2031&month=6&country=xa&city=town&centre=synthetic-centre&page=2`,
    );
    // A City is never written without its Country, nor a month without its year.
    expect(eventsListingHref('en', { city: 'town', month: 6 })).toBe('/events');
  });

  it('returns to the first page when anything but the page changes', () => {
    const view = { ...DEFAULT_EVENT_VIEW, year: 2031, page: 4 };
    expect(eventsHref('en', view)).toBe('/events?year=2031&page=4');
    expect(eventsHref('en', view, { page: 5 })).toBe('/events?year=2031&page=5');
    expect(eventsHref('en', view, { month: 6 })).toBe('/events?year=2031&month=6');
    expect(eventsHref('en', view, { year: null, month: null })).toBe('/events');
  });

  it('keeps the Topic and the place across the tabs, and leaves the period behind', () => {
    const view = readEventView({
      topic: TOPIC,
      year: '2031',
      month: '6',
      country: 'xa',
      city: 'town',
      page: '2',
    });
    expect(eventsWhenHref('en', view, 'past')).toBe(
      `/events?when=past&topic=${TOPIC}&country=xa&city=town`,
    );
    expect(eventsWhenHref('ur', view, 'upcoming')).toBe(
      `/ur/events?topic=${TOPIC}&country=xa&city=town`,
    );
  });
});

describe('one address per view', () => {
  it.each([
    // A form's empty controls.
    [{ topic: '', year: '', month: '', country: '', city: '' }, '/events'],
    [
      { when: 'past', topic: '', year: '2031', month: '', country: '' },
      '/events?when=past&year=2031',
    ],
    // Another order of the same parameters.
    [{ country: 'xa', when: 'past' }, '/events?when=past&country=xa'],
    // The default view spelled out.
    [{ when: 'upcoming' }, '/events'],
    [{ page: '1' }, '/events'],
    // Phase 14's offset: the page holding the Event it began with.
    [{ offset: '20' }, '/events?page=2'],
    [
      { when: 'past', offset: '40', centre: 'synthetic-centre' },
      '/events?when=past&centre=synthetic-centre&page=3',
    ],
    // Malformed tolerant values are dropped.
    [{ topic: 'not-an-id', year: '2031' }, '/events?year=2031'],
    [{ month: '6' }, '/events'],
    // An identifier in upper case is written in lower case.
    [{ topic: TOPIC.toUpperCase() }, `/events?topic=${TOPIC}`],
  ])('answers %j with one redirect to %s', (query, target) => {
    const redirect = eventsCanonicalRedirect('en', query);
    expect(redirect).toBe(target);
    // The target is final: no second hop.
    const next = Object.fromEntries(new URL(target, 'https://x.invalid').searchParams);
    expect(eventsCanonicalRedirect('en', next)).toBeNull();
  });

  it('leaves an address that already is the view alone, and keeps the locale', () => {
    for (const query of [
      {},
      { when: 'past' },
      { country: 'xa', city: 'town' },
      { topic: TOPIC, year: '2031', month: '6', page: '2' },
    ])
      expect(eventsCanonicalRedirect('en', query)).toBeNull();
    expect(eventsCanonicalRedirect('ar', { offset: '20' })).toBe('/ar/events?page=2');
  });
});

describe('what Editorial is asked', () => {
  it('is what Editorial’s read service accepts, page by page', () => {
    const view = readEventView({
      when: 'past',
      topic: TOPIC,
      year: '2031',
      month: '6',
      page: '3',
    });
    const centreIds = ['8c3e5a1b-6f2d-4a9b-8c1d-2e3f4a5b6c7d'];
    const query = eventsReadQuery(view, centreIds);
    expect(query).toEqual({
      when: 'past',
      topic: TOPIC,
      year: 2031,
      month: 6,
      centreIds,
      offset: 2 * EVENT_LISTING_PAGE,
      limit: EVENT_LISTING_PAGE,
    });
    expect(eventListingQuerySchema.safeParse(query).success).toBe(true);
    expect(
      eventListingQuerySchema.safeParse(
        eventsReadQuery(readEventView({ page: String(EVENT_MAX_PAGE) }), null),
      ).success,
    ).toBe(true);
  });
});
