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
  MINHAJ_BOOKS_AUTHORS,
  MINHAJ_BOOKS_LISTINGS,
  MINHAJ_ORG_ARCHIVE_EXCLUSIONS,
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
      // An Explore route, or (R2) the contact route, which shows its Page above the form.
      expect(binding.startsWith('/explore/') || binding === '/contact').toBe(true);
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

  it('names the owner-approved archives and their posts, each once (Phase 30-RD, R2)', () => {
    // The three of Phase 30-RD first, then the eleven of the R2 extension of §3.8.
    expect([...MINHAJ_ORG_COLLECTION_IDS]).toEqual([
      '12',
      '1',
      '2',
      '9',
      '5',
      '4',
      '3',
      '11',
      '54',
      '7',
      '6',
      '13',
      '52',
      '67',
    ]);
    // 114 posts of the first three (in their original order), then 405 more.
    expect(MINHAJ_ORG_ARCHIVE_TIDS).toHaveLength(519);
    expect(MINHAJ_ORG_ARCHIVE_TIDS.slice(0, 2)).toEqual(['48059', '47265']);
    expect(MINHAJ_ORG_ARCHIVE_TIDS[113]).toBe('3804');
    // Exactly the two entries found unmigratable, each a listed post with a reason.
    expect(Object.keys(MINHAJ_ORG_ARCHIVE_EXCLUSIONS).sort()).toEqual(['3484', '41122']);
    for (const [tid, reason] of Object.entries(MINHAJ_ORG_ARCHIVE_EXCLUSIONS)) {
      expect(MINHAJ_ORG_ARCHIVE_TIDS).toContain(tid);
      expect(reason.length).toBeGreaterThan(20);
    }
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
    // R2: every English category, each a category path the adapter walks.
    expect(MINHAJ_BOOKS_LISTINGS).toHaveLength(33);
    for (const listing of MINHAJ_BOOKS_LISTINGS)
      expect(listing).toMatch(/^\/english\/cat\/[A-Za-z0-9][A-Za-z0-9-]*\/$/);
  });

  it('reads each Minhaj Books author once, never one already public as a profile (R2)', () => {
    expect(new Set(MINHAJ_BOOKS_AUTHORS).size).toBe(MINHAJ_BOOKS_AUTHORS.length);
    for (const already of [
      'Dr-Muhammad-Tahir-ul-Qadri',
      'Dr-Hassan-Mohi-ud-Din-Qadri',
      'Dr-Hussain-Mohi-ud-Din-Qadri',
      'Dr-Farid-ud-Din-Qadri',
    ])
      expect(MINHAJ_BOOKS_AUTHORS).not.toContain(already);
    const authors = authorisedSource('minhajbooks-authors');
    expect(authors).toMatchObject({
      contentKind: 'people.person',
      hosts: ['www.minhajbooks.com'],
      assetHosts: [],
    });
  });

  it('registers the R2 listings on hosts already registered, each with its own language', () => {
    const expected: Record<string, readonly [string, string | null, string]> = {
      'minhaj-org-press-releases-ur': ['editorial.press-release', 'ur', 'www.minhaj.org'],
      'minhaj-org-articles-ur': ['editorial.article', 'ur', 'www.minhaj.org'],
      'minhaj-info-issues-ulama': ['library.magazine-issue', 'ur', 'minhaj.info'],
      'minhaj-tv-videos-ur': ['media.video', 'ur', 'www.minhaj.tv'],
      'minhajbooks-authors': ['people.person', 'en', 'www.minhajbooks.com'],
    };
    const earlierHosts = new Set(
      AUTHORISED_SOURCES.filter((source) => !(source.key in expected)).flatMap(
        (source) => source.hosts,
      ),
    );
    for (const [key, [kind, language, host]] of Object.entries(expected)) {
      const source = authorisedSource(key);
      expect(source?.contentKind).toBe(kind);
      expect(source?.defaultLanguageCode).toBe(language);
      expect(source?.hosts).toEqual([host]);
      // No new host: every R2 source reads a site already registered.
      expect(earlierHosts.has(host)).toBe(true);
    }
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
