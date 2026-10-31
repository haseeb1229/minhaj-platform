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
  MINHAJ_ORG_ARCHIVE_TIDS,
  MINHAJ_ORG_COLLECTION_IDS,
  MINHAJ_ORG_PAGE_BINDINGS,
  MINHAJ_ORG_PROFILE_TIDS,
  authorisedSource,
} from '../../../scripts/migration/sources/catalogue.ts';
import { fakeSite, htmlPage, textFile } from './adapters/fake-site.ts';

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
    // Phase 30-RD: a curated archive carries no picture of its own, so its
    // registration reaches no image host at all.
    for (const source of minhajOrg)
      expect([...source.assetHosts].sort()).toEqual(
        source.contentKind === 'editorial.collection'
          ? []
          : ['minhaj.net', 'www.minhaj.net'],
      );
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

  it('names exactly the three owner-approved archives and their posts, each once (Phase 30-RD)', () => {
    expect([...MINHAJ_ORG_COLLECTION_IDS]).toEqual(['12', '1', '2']);
    expect(MINHAJ_ORG_ARCHIVE_TIDS).toHaveLength(114);
    expect(new Set(MINHAJ_ORG_ARCHIVE_TIDS).size).toBe(MINHAJ_ORG_ARCHIVE_TIDS.length);
    for (const tid of MINHAJ_ORG_ARCHIVE_TIDS) {
      expect(tid).toMatch(/^[1-9][0-9]{0,8}$/);
      // No page or profile is also an archive post: one address, one record.
      expect(Object.keys(MINHAJ_ORG_PAGE_BINDINGS)).not.toContain(tid);
      expect(MINHAJ_ORG_PROFILE_TIDS).not.toContain(tid);
    }
  });

  it('keeps every archive post out of the English news listing, which might otherwise take it', async () => {
    const cards = [
      '/english/tid/134/Archive-Post.html',
      '/english/tid/70001/Fresh-Post.html',
    ];
    const listing = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<section><div class="col"><h1 class="page_title">News</h1>
${cards
  .map(
    (href) =>
      `<div class="layout_post_2"><div class="item_content"><h4><a href="${href}">Synthetic</a></h4></div></div>`,
  )
  .join('')}
</div></section></body></html>`;
    const site = fakeSite({
      'https://www.minhaj.org/robots.txt': textFile('User-agent: *\nAllow: /\n'),
      'https://www.minhaj.org/english/News-Events/': htmlPage(listing),
    });
    const news = authorisedSource('minhaj-org-news-en');
    if (news === null) throw new Error('minhaj-org-news-en');
    const page = await news
      .adapter({ pages: 1, limit: 10, items: [] })
      .discover(null, site.fetcher);
    if (page.kind !== 'page') throw new Error('expected a page');
    expect(page.items.map((item) => item.legacyIdentifier)).toEqual(['tid-70001']);
    expect(authorisedSource('minhaj-org-archive-news-en')?.contentKind).toBe(
      'editorial.news',
    );
    expect(authorisedSource('minhaj-org-collections-en')?.contentKind).toBe(
      'editorial.collection',
    );
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
