import { describe, expect, it } from 'vitest';

import {
  centreFinderSchema,
  tallyCentrePlaces,
  type CentrePlace,
} from '../../packages/contracts/src/global/index.ts';
import {
  centreEventsCanonicalRedirect,
  centreEventsHref,
  centresCanonicalRedirect,
  countriesCanonicalRedirect,
  countriesHref,
  finderCanonicalRedirect,
  finderHref,
  finderPlaceHref,
  finderReadQuery,
  GLOBAL_MAX_PAGE,
  NEWS_PAGING,
  placeCanonicalRedirect,
  readCentreEventsView,
  readCentresView,
  readCountriesView,
  readFinderView,
  readPlaceView,
} from '../../apps/web/src/components/global/global-view.ts';
import { centresAt } from '../../apps/web/src/components/global/presentation.ts';

/**
 * Global Network (R2) — the directory's address rules and its place counts,
 * pure: what a page reads from its address, the ONE address it writes for a
 * view, which spellings are one redirect, which are refused where they were
 * asked, and how a set of Centres is counted per place by the listing's rule.
 */

const COUNTRIES = '/ur/global/countries';
const CENTRES = '/global/centres';
const FINDER = '/ar/global/find-a-centre';
const COUNTRY = '/global/countries/xa-land';

describe('the Countries listing', () => {
  it('reads a world region and a page, and writes them back in one spelling', () => {
    const view = readCountriesView({ region: 'south-asia', page: '2' });
    expect(view).toEqual({ region: 'south-asia', page: 2, invalid: false });
    expect(countriesHref(COUNTRIES, view)).toBe(`${COUNTRIES}?region=south-asia&page=2`);
    // Changing the region returns to the first page.
    expect(countriesHref(COUNTRIES, view, { region: null })).toBe(COUNTRIES);
    expect(
      countriesCanonicalRedirect(COUNTRIES, { region: 'south-asia', page: '2' }),
    ).toBe(null);
  });

  it('answers every tidy-up and the former offset with one redirect to a final address', () => {
    for (const [query, target] of [
      [{ region: '' }, COUNTRIES],
      [{ page: '1' }, COUNTRIES],
      [{ page: 'abc' }, COUNTRIES],
      [{ offset: 'abc' }, COUNTRIES],
      [{ offset: '0' }, COUNTRIES],
      [{ offset: '48' }, `${COUNTRIES}?page=3`],
      [{ offset: '960' }, `${COUNTRIES}?page=41`],
      [{ page: '2', region: 'south-asia' }, `${COUNTRIES}?region=south-asia&page=2`],
    ] as const) {
      const redirect = countriesCanonicalRedirect(COUNTRIES, query);
      expect(redirect, JSON.stringify(query)).toBe(target);
      const final = Object.fromEntries(new URL(target, 'https://x.invalid').searchParams);
      expect(countriesCanonicalRedirect(COUNTRIES, final), target).toBeNull();
    }
  });

  it('refuses an unknown or repeated region where it was asked, never widening it', () => {
    for (const query of [
      { region: 'atlantis' },
      { region: 'SOUTH-ASIA' },
      { region: ['south-asia', 'other'] },
    ]) {
      expect(readCountriesView(query).invalid, JSON.stringify(query)).toBe(true);
      expect(countriesCanonicalRedirect(COUNTRIES, query)).toBeNull();
    }
  });
});

describe('the Centres listing', () => {
  it('reads a kind, refuses an unknown one, and pages by number', () => {
    expect(readCentresView({ kind: 'virtual' })).toEqual({
      kind: 'virtual',
      page: 1,
      invalid: false,
    });
    expect(readCentresView({ kind: 'online' }).invalid).toBe(true);
    expect(centresCanonicalRedirect(CENTRES, { kind: 'online' })).toBeNull();
    expect(centresCanonicalRedirect(CENTRES, { kind: 'physical', offset: '24' })).toBe(
      `${CENTRES}?kind=physical&page=2`,
    );
    expect(centresCanonicalRedirect(CENTRES, { kind: 'physical', page: '2' })).toBeNull();
  });
});

describe('Find a Centre', () => {
  it('reads a Country with a Region or a City, and writes the form’s submission once', () => {
    // The GET form submits every control, empty ones included.
    expect(
      finderCanonicalRedirect(FINDER, { country: 'xa-land', region: '', city: '' }),
    ).toBe(`${FINDER}?country=xa-land`);
    expect(
      finderCanonicalRedirect(FINDER, { country: 'xa-land', region: 'north', city: '' }),
    ).toBe(`${FINDER}?country=xa-land&region=north`);
    expect(finderCanonicalRedirect(FINDER, { city: 'town', country: 'xa-land' })).toBe(
      `${FINDER}?country=xa-land&city=town`,
    );
    expect(finderCanonicalRedirect(FINDER, { country: '', region: '', city: '' })).toBe(
      FINDER,
    );
    expect(finderCanonicalRedirect(FINDER, { country: 'xa-land', offset: '24' })).toBe(
      `${FINDER}?country=xa-land&page=2`,
    );
    expect(finderCanonicalRedirect(FINDER, { country: 'xa-land', page: '2' })).toBeNull();
  });

  it('refuses a place that cannot mean anything, where it was asked', () => {
    for (const query of [
      { city: 'town' },
      { region: 'north' },
      { country: 'xa-land', region: 'north', city: 'town' },
      { country: 'Not A Slug' },
      { country: ' xa-land' },
      { country: ['xa-land', 'xb-land'] },
      { country: 'xa-land', city: ['a', 'b'] },
    ]) {
      expect(readFinderView(query).invalid, JSON.stringify(query)).toBe(true);
      expect(finderCanonicalRedirect(FINDER, query), JSON.stringify(query)).toBeNull();
    }
  });

  it('asks Global exactly what its finder schema accepts, at the page’s offset', () => {
    const view = readFinderView({ country: 'xa-land', city: 'town', page: '3' });
    const query = finderReadQuery(view);
    expect(query).toEqual({ country: 'xa-land', region: null, city: 'town', offset: 48 });
    expect(centreFinderSchema.safeParse(query).success).toBe(true);
    const deepest = finderReadQuery(
      readFinderView({ country: 'xa-land', page: String(GLOBAL_MAX_PAGE) }),
    );
    expect(centreFinderSchema.safeParse(deepest).success).toBe(true);
  });

  it('links a place into the finder, a Region taking precedence over a City', () => {
    expect(finderPlaceHref(FINDER, { country: 'xa-land' })).toBe(
      `${FINDER}?country=xa-land`,
    );
    expect(
      finderPlaceHref(FINDER, { country: 'xa-land', region: 'north', city: 'x' }),
    ).toBe(`${FINDER}?country=xa-land&region=north`);
    const view = readFinderView({ country: 'xa-land', region: 'north', page: '4' });
    expect(finderHref(FINDER, view, { region: null })).toBe(`${FINDER}?country=xa-land`);
  });
});

describe('a place page and a Centre’s News', () => {
  it('pages Centres by ?page and Cities by ?cityPage, redirecting Phase 16’s offsets once', () => {
    expect(readPlaceView({ offset: '24', cities: '48' }, true)).toEqual({
      page: 2,
      cityPage: 3,
    });
    expect(placeCanonicalRedirect(COUNTRY, { offset: '24', cities: '48' }, true)).toBe(
      `${COUNTRY}?page=2&cityPage=3`,
    );
    expect(
      placeCanonicalRedirect(COUNTRY, { page: '2', cityPage: '3' }, true),
    ).toBeNull();
    expect(placeCanonicalRedirect(COUNTRY, { cityPage: '3', page: '2' }, true)).toBe(
      `${COUNTRY}?page=2&cityPage=3`,
    );
    expect(placeCanonicalRedirect(COUNTRY, {}, true)).toBeNull();
    // A page with no Cities of its own does not read ?cityPage at all.
    expect(readPlaceView({ cityPage: '3' }, false)).toEqual({ page: 1, cityPage: 1 });
    expect(placeCanonicalRedirect(COUNTRY, { cityPage: '3' }, false)).toBeNull();
    expect(placeCanonicalRedirect(COUNTRY, { page: '0' }, false)).toBe(COUNTRY);
    expect(placeCanonicalRedirect(COUNTRY, { page: '99999' }, false)).toBe(COUNTRY);
  });

  it('reads a Centre’s former News offset by Editorial’s page of 20, not the directory’s 24', () => {
    const NEWS = '/global/centres/xa-centre/news';
    expect(readPlaceView({ offset: '40' }, false, NEWS_PAGING).page).toBe(3);
    expect(placeCanonicalRedirect(NEWS, { offset: '40' }, false, NEWS_PAGING)).toBe(
      `${NEWS}?page=3`,
    );
    // The deepest page still reads within Editorial's offset bound.
    const deepest = readPlaceView({ page: '99999' }, false, NEWS_PAGING);
    expect(deepest.page).toBe(1);
    expect(readPlaceView({ page: '1251' }, false, NEWS_PAGING).page).toBe(1251);
    expect((1251 - 1) * NEWS_PAGING.size).toBeLessThanOrEqual(NEWS_PAGING.maxOffset);
  });
});

describe('a Centre’s Events', () => {
  const EVENTS = '/global/centres/xa-centre/events';

  it('writes upcoming as the bare address and past as ?when=past', () => {
    expect(centreEventsCanonicalRedirect(EVENTS, { when: 'upcoming' })).toBe(EVENTS);
    expect(centreEventsCanonicalRedirect(EVENTS, { when: 'past', offset: '20' })).toBe(
      `${EVENTS}?when=past&page=2`,
    );
    const view = readCentreEventsView({ when: 'past', page: '2' });
    expect(centreEventsHref(EVENTS, view, { when: 'upcoming', page: 1 })).toBe(EVENTS);
  });

  it('refuses a view that is neither upcoming nor past, or repeated', () => {
    for (const query of [{ when: 'soon' }, { when: ['past', 'upcoming'] }]) {
      expect(readCentreEventsView(query).invalid).toBe(true);
      expect(centreEventsCanonicalRedirect(EVENTS, query)).toBeNull();
    }
  });
});

describe('counting Centres by place', () => {
  const rows: CentrePlace[] = [
    // In a City of Region R, and also serving that same City: counted once.
    {
      id: 'in-town',
      countryId: 'C',
      regionId: 'R',
      cityId: 'T',
      isVirtual: false,
      served: [{ cityId: 'T', regionId: 'R' }],
    },
    // Virtual, serving a City of Region R and a City with no Region.
    {
      id: 'online',
      countryId: 'C',
      regionId: null,
      cityId: null,
      isVirtual: true,
      served: [
        { cityId: 'T', regionId: 'R' },
        { cityId: 'U', regionId: null },
      ],
    },
    // Directly in Region S, with no City.
    {
      id: 'south',
      countryId: 'C',
      regionId: 'S',
      cityId: null,
      isVirtual: false,
      served: [],
    },
    {
      id: 'abroad',
      countryId: 'D',
      regionId: null,
      cityId: null,
      isVirtual: false,
      served: [],
    },
  ];

  it('counts each Centre once per place, by the listing’s rule', () => {
    const tally = tallyCentrePlaces(rows);
    expect(Object.fromEntries(tally.countries)).toEqual({ C: 3, D: 1 });
    expect(Object.fromEntries(tally.regions)).toEqual({ R: 2, S: 1 });
    expect(Object.fromEntries(tally.cities)).toEqual({ T: 2, U: 1 });
    expect(tally.kinds).toEqual({ physical: 3, virtual: 1 });
  });

  it('names the Centres a place holds, or only those physically there', () => {
    expect(centresAt(rows, { cityId: 'T' }).sort()).toEqual(['in-town', 'online']);
    expect(centresAt(rows, { cityId: 'T' }, true)).toEqual(['in-town']);
    expect(centresAt(rows, { regionId: 'R' }).sort()).toEqual(['in-town', 'online']);
    expect(centresAt(rows, { regionId: 'S' }, true)).toEqual(['south']);
    expect(centresAt(rows, {}, true).sort()).toEqual(['abroad', 'in-town', 'south']);
    expect(tallyCentrePlaces([]).kinds).toEqual({ physical: 0, virtual: 0 });
  });
});
