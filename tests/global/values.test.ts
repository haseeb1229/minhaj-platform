import { describe, expect, it } from 'vitest';

import {
  applyContactChange,
  applyServedCityChange,
  centreFinderSchema,
  centreInputSchema,
  cityInputSchema,
  contactInputSchema,
  coordinatesSchema,
  countryCodeSchema,
  countryInputSchema,
  dialablePhone,
  globalPaths,
  labelFor,
  safeWebsiteHref,
  GLOBAL_LIMITS,
} from '../../packages/contracts/src/global/index.ts';

/**
 * Phase 16 — the Global Network contract's pure rules: what an operator may
 * save, what a visitor's filter may name, and how the public addresses are
 * built. No database; the same rules are refused again by SQL.
 */

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const centre = (overrides: Record<string, unknown> = {}) => ({
  countryId: id(1),
  regionId: null,
  cityId: null,
  isVirtual: false,
  coordinates: null,
  slug: 'synthetic-centre',
  primaryLocale: 'en',
  state: 'draft',
  labels: [{ locale: 'en', name: 'Synthetic Centre', description: null, address: null }],
  ...overrides,
});

describe('a Country', () => {
  it('takes an ISO 3166-1 alpha-2 code in either case and stores it upper case', () => {
    expect(countryCodeSchema.parse('xa')).toBe('XA');
    for (const bad of ['X', 'XAA', 'X1', 'éé', ''])
      expect(countryCodeSchema.safeParse(bad).success, bad).toBe(false);
  });

  it('needs a name in its primary locale, one per locale', () => {
    const value = {
      code: 'XA',
      slug: 'synthetic-country',
      primaryLocale: 'ur',
      state: 'published',
      labels: [{ locale: 'en', name: 'Synthetic' }],
    };
    expect(countryInputSchema.safeParse(value).success).toBe(false);
    expect(
      countryInputSchema.safeParse({
        ...value,
        labels: [
          { locale: 'ur', name: 'آزمائشی' },
          { locale: 'ur', name: 'دوسرا' },
        ],
      }).success,
    ).toBe(false);
    expect(
      countryInputSchema.safeParse({
        ...value,
        labels: [{ locale: 'ur', name: 'آزمائشی' }],
      }).success,
    ).toBe(true);
  });

  it('refuses a field nobody named', () => {
    expect(
      countryInputSchema.safeParse({
        code: 'XA',
        slug: 'synthetic-country',
        primaryLocale: 'en',
        state: 'draft',
        labels: [{ locale: 'en', name: 'Synthetic' }],
        name_en: 'parallel column',
      }).success,
    ).toBe(false);
  });
});

describe('a City', () => {
  it('may have no Region', () => {
    expect(
      cityInputSchema.safeParse({
        countryId: id(1),
        regionId: null,
        slug: 'synthetic-city',
        primaryLocale: 'en',
        state: 'draft',
        labels: [{ locale: 'en', name: 'Synthetic City' }],
      }).success,
    ).toBe(true);
  });
});

describe('a Centre', () => {
  it('holds at most one locality fact', () => {
    expect(centreInputSchema.safeParse(centre({ cityId: id(2) })).success).toBe(true);
    expect(centreInputSchema.safeParse(centre({ regionId: id(3) })).success).toBe(true);
    expect(
      centreInputSchema.safeParse(centre({ cityId: id(2), regionId: id(3) })).success,
    ).toBe(false);
  });

  it('is virtual only by saying so, and then has no physical place', () => {
    expect(centreInputSchema.parse(centre()).isVirtual).toBe(false);
    expect(centreInputSchema.safeParse(centre({ isVirtual: true })).success).toBe(true);
    for (const place of [
      { cityId: id(2) },
      { regionId: id(3) },
      { coordinates: { latitude: '1', longitude: '1' } },
      {
        labels: [
          {
            locale: 'en',
            name: 'Synthetic Centre',
            description: null,
            address: '1 Street',
          },
        ],
      },
    ])
      expect(
        centreInputSchema.safeParse(centre({ isVirtual: true, ...place })).success,
        JSON.stringify(place),
      ).toBe(false);
  });
});

describe('coordinates', () => {
  it('are exact six-place decimals, both or neither, inside the ranges', () => {
    expect(
      coordinatesSchema.parse({ latitude: '24.8607', longitude: '67.0011' }),
    ).toEqual({
      latitude: '24.860700',
      longitude: '67.001100',
    });
    expect(coordinatesSchema.parse({ latitude: '-90', longitude: '180' })).toEqual({
      latitude: '-90.000000',
      longitude: '180.000000',
    });
    expect(coordinatesSchema.parse({ latitude: '-0.0', longitude: '0' })).toEqual({
      latitude: '0.000000',
      longitude: '0.000000',
    });
    for (const [latitude, longitude] of [
      ['90.000001', '0'],
      ['-91', '0'],
      ['0', '180.1'],
      ['0', '-181'],
      ['1.1234567', '0'],
      ['1e2', '0'],
      ['', '0'],
      ['NaN', '0'],
    ])
      expect(
        coordinatesSchema.safeParse({ latitude, longitude }).success,
        `${String(latitude)},${String(longitude)}`,
      ).toBe(false);
    expect(coordinatesSchema.safeParse({ latitude: '1' }).success).toBe(false);
  });
});

describe('contacts — public directory facts, never correspondence', () => {
  it('accepts only an absolute HTTPS website with no credentials, normalised', () => {
    expect(safeWebsiteHref('https://Centre.Example.invalid')).toBe(
      'https://centre.example.invalid/',
    );
    for (const bad of [
      'http://centre.example.invalid/',
      'javascript:alert(1)',
      'data:text/html,hi',
      'file:///etc/passwd',
      '//centre.example.invalid/',
      '/relative',
      'https://user:pass@centre.example.invalid/',
      'https://localhost/',
    ])
      expect(safeWebsiteHref(bad), bad).toBeNull();
  });

  it('keeps a phone as displayed and derives a dialable address only from its digits', () => {
    expect(dialablePhone('+00 000 000 0000')).toBe('tel:+000000000000');
    expect(dialablePhone('(000) 000-0000')).toBe('tel:0000000000');
    for (const bad of ['123', 'call me', '+00 000<script>', 'javascript:1'])
      expect(dialablePhone(bad), bad).toBeNull();
    expect(
      contactInputSchema.parse({ channel: 'phone', value: ' +00  000 0000 ' }).value,
    ).toBe('+00 000 0000');
  });

  it('validates an email at the boundary and refuses an unknown channel', () => {
    expect(
      contactInputSchema.safeParse({ channel: 'email', value: 'proof@example.invalid' })
        .success,
    ).toBe(true);
    expect(
      contactInputSchema.safeParse({ channel: 'email', value: 'not an email' }).success,
    ).toBe(false);
    expect(
      contactInputSchema.safeParse({ channel: 'whatsapp', value: '+00 000 0000' })
        .success,
    ).toBe(false);
  });

  it('applies one named change to the list the operator was shown', () => {
    const phone = { channel: 'phone' as const, value: '+00 000 0000' };
    const email = { channel: 'email' as const, value: 'proof@example.invalid' };
    const added = applyContactChange([phone], { op: 'add', contact: email });
    expect(added).toEqual({ contacts: [phone, email] });
    expect(applyContactChange([phone], { op: 'add', contact: phone })).toEqual({
      refusal: 'duplicate-contact',
    });
    expect(
      applyContactChange([phone, email], {
        op: 'move',
        position: 1,
        direction: 'earlier',
      }),
    ).toEqual({ contacts: [email, phone] });
    expect(
      applyContactChange([phone], { op: 'move', position: 0, direction: 'earlier' }),
    ).toEqual({ refusal: 'invalid' });
    expect(applyContactChange([phone], { op: 'remove', position: 3 })).toEqual({
      refusal: 'invalid',
    });
    const full = Array.from({ length: GLOBAL_LIMITS.contacts }, (_, n) => ({
      channel: 'phone' as const,
      value: `+00 000 ${String(n).padStart(4, '0')}`,
    }));
    expect(applyContactChange(full, { op: 'add', contact: email })).toEqual({
      refusal: 'limit',
    });
  });

  it('adds a served City once and only within the bound', () => {
    expect(applyServedCityChange([id(1)], { op: 'add', cityId: id(1) })).toEqual({
      refusal: 'duplicate-city',
    });
    expect(applyServedCityChange([id(1)], { op: 'remove', cityId: id(2) })).toEqual({
      refusal: 'invalid',
    });
    const full = Array.from({ length: GLOBAL_LIMITS.servedCities }, (_, n) => id(n + 10));
    expect(applyServedCityChange(full, { op: 'add', cityId: id(1) })).toEqual({
      refusal: 'limit',
    });
  });
});

describe('Find a Centre', () => {
  it('needs a Country for a Region or City, and never both a Region and a City', () => {
    expect(centreFinderSchema.safeParse({}).success).toBe(true);
    expect(centreFinderSchema.safeParse({ country: 'xa', city: 'town' }).success).toBe(
      true,
    );
    expect(centreFinderSchema.safeParse({ city: 'town' }).success).toBe(false);
    expect(
      centreFinderSchema.safeParse({ country: 'xa', region: 'area', city: 'town' })
        .success,
    ).toBe(false);
    expect(centreFinderSchema.safeParse({ country: "x' OR 1=1" }).success).toBe(false);
    expect(centreFinderSchema.safeParse({ country: 'xa', offset: 25_001 }).success).toBe(
      false,
    );
  });
});

describe('words and addresses', () => {
  it('shows the reader’s locale, then the primary one, never a fabricated translation', () => {
    const record = {
      primaryLocale: 'ur' as const,
      labels: [
        { locale: 'ur' as const, name: 'آزمائشی' },
        { locale: 'en' as const, name: 'Synthetic' },
      ],
    };
    expect(labelFor(record, 'en')?.name).toBe('Synthetic');
    expect(labelFor(record, 'ar')).toEqual({ locale: 'ur', name: 'آزمائشی' });
  });

  it('builds every canonical address under its own locale and encodes each slug', () => {
    expect(globalPaths.city('ur', 'xa', 'town')).toBe(
      '/ur/global/countries/xa/cities/town',
    );
    expect(globalPaths.region('ar', 'xa', 'area')).toBe(
      '/ar/global/countries/xa/regions/area',
    );
    expect(globalPaths.centreContact('en', 'a b')).toBe(
      '/en/global/centres/a%20b/contact',
    );
    // Phase 14: a Centre's Events page sits beside its News and Contact pages.
    expect(globalPaths.centreEvents('ur', 'a b')).toBe('/ur/global/centres/a%20b/events');
    expect(globalPaths.centreNews('ar', 'xa')).toBe('/ar/global/centres/xa/news');
  });
});
