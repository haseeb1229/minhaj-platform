import { describe, expect, it } from 'vitest';

import { PAGE_BINDINGS } from '@minhaj/contracts/editorial';
import {
  AUTHORISED_MIN_INTERVAL_MS,
  MIGRATION_LIMITS,
  authorisedScopeIsReal,
  isRealHostName,
} from '@minhaj/contracts/migration';

import {
  AUTHORISED_SOURCES,
  MINHAJ_BOOKS_LISTINGS,
  MINHAJ_ORG_PAGE_BINDINGS,
  MINHAJ_ORG_PROFILE_TIDS,
  authorisedSource,
} from '../../../scripts/migration/sources/catalogue.ts';

/**
 * THE AUTHORISED SOURCE CATALOGUE as data (Phases 30 and 30-R): every
 * registration a real scope with the politeness floor, its asset hosts exact
 * first-party names with recorded evidence, its organisational pages bound to
 * Editorial's own closed list of shell routes, and no legacy address claimed
 * by two registrations' records.
 */

describe('the authorised source catalogue', () => {
  it('keys each registration once, each a real https scope at the politeness floor', () => {
    const keys = AUTHORISED_SOURCES.map((source) => source.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const source of AUTHORISED_SOURCES) {
      expect(authorisedScopeIsReal(source.baseUrl, source.hosts)).toBe(true);
      expect(source.policy.minIntervalMs).toBeGreaterThanOrEqual(
        AUTHORISED_MIN_INTERVAL_MS,
      );
      expect(source.policy.maxConcurrency).toBe(1);
      expect(source.hosts.length + source.assetHosts.length).toBeLessThanOrEqual(
        MIGRATION_LIMITS.hosts,
      );
      expect(authorisedSource(source.key)).toBe(source);
    }
    expect(authorisedSource('no-such-source')).toBeNull();
  });

  it('names asset hosts only as exact real names, never a page host, always with evidence', () => {
    for (const source of AUTHORISED_SOURCES) {
      for (const host of source.assetHosts) {
        expect(isRealHostName(host)).toBe(true);
        expect(source.hosts).not.toContain(host);
      }
      if (source.assetHosts.length > 0) {
        expect(source.assetHostEvidence).not.toBeNull();
        expect(source.assetHostEvidence?.length).toBeGreaterThanOrEqual(10);
        expect(source.assetHostEvidence?.length).toBeLessThanOrEqual(1000);
      } else expect(source.assetHostEvidence).toBeNull();
    }
  });

  it('gives every minhaj.org registration exactly the organisation’s own image hosts', () => {
    const minhajOrg = AUTHORISED_SOURCES.filter((source) =>
      source.hosts.includes('www.minhaj.org'),
    );
    expect(minhajOrg.length).toBeGreaterThanOrEqual(3);
    for (const source of minhajOrg)
      expect([...source.assetHosts].sort()).toEqual(['minhaj.net', 'www.minhaj.net']);
    // No other registration reaches those hosts.
    for (const source of AUTHORISED_SOURCES.filter((entry) => !minhajOrg.includes(entry)))
      expect(source.assetHosts).toEqual([]);
  });

  it('binds each organisational page to one distinct route of Editorial’s closed list', () => {
    const bindings = Object.values(MINHAJ_ORG_PAGE_BINDINGS);
    expect(bindings.length).toBeGreaterThan(0);
    expect(new Set(bindings).size).toBe(bindings.length);
    for (const binding of bindings) {
      expect(PAGE_BINDINGS).toContain(binding);
      expect(binding.startsWith('/explore/')).toBe(true);
    }
    for (const tid of Object.keys(MINHAJ_ORG_PAGE_BINDINGS))
      expect(tid).toMatch(/^[1-9][0-9]{0,8}$/);
  });

  it('never lets a profile and a page claim one legacy address', () => {
    for (const tid of MINHAJ_ORG_PROFILE_TIDS) {
      expect(tid).toMatch(/^[1-9][0-9]{0,8}$/);
      expect(Object.keys(MINHAJ_ORG_PAGE_BINDINGS)).not.toContain(tid);
    }
    expect(new Set(MINHAJ_ORG_PROFILE_TIDS).size).toBe(MINHAJ_ORG_PROFILE_TIDS.length);
  });

  it('walks the Stage-1A Hadith category FIRST, so a wider run keeps its records', () => {
    expect(MINHAJ_BOOKS_LISTINGS[0]).toBe('/english/cat/The-Hadith/');
    expect(new Set(MINHAJ_BOOKS_LISTINGS).size).toBe(MINHAJ_BOOKS_LISTINGS.length);
  });

  it('builds every registration’s adapter, of the registration’s own kind', () => {
    const selection = { pages: 1, limit: 1, items: [] as string[] };
    for (const source of AUTHORISED_SOURCES) {
      // The Quran registrations need explicit surahs.
      const items = source.contentKind === 'quran.translation' ? ['1'] : [];
      const adapter = source.adapter({ ...selection, items });
      expect(adapter.contentKind).toBe(source.contentKind);
      expect(adapter.accessMethod).toBe('http');
    }
  });
});
