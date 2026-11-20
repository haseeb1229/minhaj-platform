import { describe, expect, it } from 'vitest';

import {
  WORLD_REGIONS,
  groupByWorldRegion,
  worldRegionOf,
} from '../../apps/web/src/components/global/world-region.ts';

/**
 * R2 — the Countries grid's world-region grouping: a fixed table applied to
 * the ISO code a public Country already carries. Pure; no database.
 */

describe('worldRegionOf', () => {
  it('places the countries of the organisation’s presence', () => {
    expect(worldRegionOf('PK')).toBe('south-asia');
    expect(worldRegionOf('GB')).toBe('europe-central-asia');
    expect(worldRegionOf('NO')).toBe('europe-central-asia');
    expect(worldRegionOf('AE')).toBe('middle-east-north-africa');
    expect(worldRegionOf('EG')).toBe('middle-east-north-africa');
    expect(worldRegionOf('US')).toBe('north-america');
    expect(worldRegionOf('BR')).toBe('latin-america-caribbean');
    expect(worldRegionOf('ZA')).toBe('sub-saharan-africa');
    expect(worldRegionOf('KR')).toBe('east-asia-pacific');
    expect(worldRegionOf('AU')).toBe('east-asia-pacific');
  });

  it('reads a code case-insensitively and trims it', () => {
    expect(worldRegionOf(' pk ')).toBe('south-asia');
  });

  it('keeps an unplaced or malformed code as `other`, never dropping it', () => {
    for (const code of ['', 'ZZ', 'PAK', '12', 'P K'])
      expect(worldRegionOf(code)).toBe('other');
  });

  it('places no code in two regions', () => {
    const seen = new Map<string, string>();
    for (const region of WORLD_REGIONS) {
      for (const code of ['PK', 'GB', 'AE', 'US', 'BR', 'ZA', 'KR'])
        if (worldRegionOf(code) === region) {
          expect(seen.has(code), code).toBe(false);
          seen.set(code, region);
        }
    }
    expect(seen.size).toBe(7);
  });
});

describe('groupByWorldRegion', () => {
  const country = (code: string, slug: string) => ({ code, slug });

  it('groups in the fixed region order, keeping the given order within a group', () => {
    const groups = groupByWorldRegion([
      country('NO', 'norway'),
      country('PK', 'pakistan'),
      country('GB', 'united-kingdom'),
      country('ZZ', 'elsewhere'),
      country('DK', 'denmark'),
    ]);
    expect(groups.map((group) => group.region)).toEqual([
      'south-asia',
      'europe-central-asia',
      'other',
    ]);
    expect(groups[1]?.countries.map((entry) => entry.slug)).toEqual([
      'norway',
      'united-kingdom',
      'denmark',
    ]);
  });

  it('returns nothing for no countries', () => {
    expect(groupByWorldRegion([])).toEqual([]);
  });
});
