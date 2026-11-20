import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PAGE_BINDINGS } from '../../packages/contracts/src/editorial/routes.ts';
import {
  channelsOf,
  exploreItemKind,
  explorePath,
  exploreTally,
  isPageAddress,
  neighboursOf,
  onwardOf,
  publicationTally,
  sectionItems,
} from '../../apps/web/src/components/explore/explore-view.ts';
import {
  EXPLORE_PAGES,
  EXPLORE_SECTIONS,
  exploreSlugsOf,
  ownerPathOf,
} from '../../apps/web/src/shell/explore.ts';
import { OFFICIAL_CHANNELS } from '../../apps/web/src/shell/official-channels.ts';
import { requireRoute } from '../../apps/web/src/shell/registry.ts';

/**
 * Explore (R2) — the page model every Explore page decides by: what each
 * allowlisted address is, whether it is published, its place in its section,
 * and where a reader is served before it is published. Pure, so every rule is
 * held here rather than discovered in a browser.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const everyItem = Object.entries(EXPLORE_PAGES).flatMap(([section, slugs]) =>
  (slugs as readonly string[]).map((slug) => ({
    section: section as keyof typeof EXPLORE_PAGES,
    slug,
  })),
);

describe('what each Explore address is', () => {
  it('calls an address a Page exactly when an Editorial Page may be bound to it', () => {
    // The two lists cannot drift: a "page" no Page can fill would await
    // forever, and a bindable address called anything else would never show
    // its published Page.
    for (const { section, slug } of everyItem) {
      const path = explorePath(section, slug);
      const kind = exploreItemKind(section, slug);
      expect(kind === 'page', path).toBe(PAGE_BINDINGS.includes(path));
      expect(isPageAddress(path), path).toBe(kind === 'page');
    }
    for (const section of EXPLORE_SECTIONS)
      expect(isPageAddress(explorePath(section)), section).toBe(true);
  });

  it('names the four Shaykh-ul-Islam listings, the feeds page and the newsletter', () => {
    for (const slug of ['books', 'articles', 'lectures', 'collections'])
      expect(exploreItemKind('shaykh-ul-islam', slug), slug).toBe('listing');
    expect(exploreItemKind('digital-resources', 'rss')).toBe('feed');
    // Delivered by its owner, and only that one.
    expect(exploreItemKind('digital-resources', 'newsletter')).toBe('elsewhere');
    expect(
      everyItem.filter(
        ({ section, slug }) => exploreItemKind(section, slug) === 'elsewhere',
      ),
    ).toEqual([{ section: 'digital-resources', slug: 'newsletter' }]);
    expect(ownerPathOf('digital-resources', 'newsletter')).toBe('/newsletter');
  });

  it('keeps the four listings Page-free: no Person record identifies the Shaykh-ul-Islam', () => {
    // ROUTE_MAP.md §3.2: canonical to their domain collections, never an
    // organisational Page — and they stay awaiting until a contributor credit
    // exists to filter by (no Work, Video or Article carries one).
    for (const slug of ['books', 'articles', 'lectures', 'collections'])
      expect(PAGE_BINDINGS).not.toContain(`/explore/shaykh-ul-islam/${slug}`);
  });
});

describe('where an Explore address stands', () => {
  const published = new Set([
    '/explore/about/introduction',
    '/explore/about/global-impact',
    // A published Page at a listing's address cannot exist; even if one were
    // reported, the listing is never called published.
    '/explore/shaykh-ul-islam/books',
  ]);

  it('says published only of a published Page, awaiting of the rest', () => {
    const about = sectionItems('about', published);
    expect(about.map((item) => item.slug)).toEqual([...EXPLORE_PAGES.about]);
    expect(
      about.filter((item) => item.state === 'published').map((item) => item.slug),
    ).toEqual(['introduction', 'global-impact']);
    expect(about.filter((item) => item.state === 'awaiting')).toHaveLength(6);

    const books = sectionItems('shaykh-ul-islam', published).find(
      (item) => item.slug === 'books',
    );
    expect(books).toMatchObject({ kind: 'listing', state: 'awaiting' });
  });

  it('claims nothing when the published Pages could not be read', () => {
    const items = sectionItems('organization', null);
    expect(items.every((item) => item.state === null)).toBe(true);
    expect(publicationTally(items)).toBeNull();
    expect(exploreTally(null)).toBeNull();
    // The owner's page is still the owner's: that is code, not a read.
    expect(
      sectionItems('digital-resources', null).find((item) => item.slug === 'newsletter')
        ?.state,
    ).toBe('elsewhere');
  });

  it('counts a section over its own items, never the one delivered elsewhere', () => {
    expect(publicationTally(sectionItems('about', published))).toEqual({
      published: 2,
      total: EXPLORE_PAGES.about.length,
    });
    expect(publicationTally(sectionItems('digital-resources', new Set()))).toEqual({
      published: 0,
      total: 3,
    });
    // A section with no pages has nothing to count.
    expect(publicationTally(sectionItems('community', new Set()))).toEqual({
      published: 0,
      total: 0,
    });
    const all = everyItem.filter(
      ({ section, slug }) => exploreItemKind(section, slug) !== 'elsewhere',
    ).length;
    expect(exploreTally(published)).toEqual({ published: 2, total: all });
  });
});

describe('a page among its section', () => {
  it('steps through a section in the allowlist order, ends without a neighbour', () => {
    expect(neighboursOf('about', 'introduction')).toEqual({
      previous: null,
      next: 'vision',
    });
    expect(neighboursOf('about', 'history')).toEqual({
      previous: 'objectives',
      next: 'timeline',
    });
    expect(neighboursOf('about', 'global-impact')).toEqual({
      previous: 'timeline',
      next: null,
    });
  });

  it('steps over the item delivered elsewhere', () => {
    // mobile-apps · newsletter · rss · social-media
    expect(neighboursOf('digital-resources', 'mobile-apps')).toEqual({
      previous: null,
      next: 'rss',
    });
    expect(neighboursOf('digital-resources', 'rss')).toEqual({
      previous: 'mobile-apps',
      next: 'social-media',
    });
  });

  it('validates a slug against its own section', () => {
    // `education` belongs to two sections; in a third it has no neighbours.
    expect(neighboursOf('about', 'education')).toEqual({ previous: null, next: null });
    expect(neighboursOf('our-work', 'education').next).toBe('research');
    expect(neighboursOf('shaykh-ul-islam', 'education').previous).toBe('early-life');
  });
});

describe('where a reader is served now', () => {
  it('names only delivered, public routes, never twice on one page', () => {
    for (const section of EXPLORE_SECTIONS) {
      const keys = [
        onwardOf(section),
        ...exploreSlugsOf(section).map((slug) => onwardOf(section, slug)),
      ];
      for (const list of keys) {
        expect(list.length, section).toBeGreaterThan(0);
        expect(new Set(list).size, section).toBe(list.length);
        for (const key of list) {
          const route = requireRoute(key);
          expect(route.availability, key).toBe('delivered');
          expect(route.visibility, key).toBe('public');
          // Never back into Explore: these are the platform's open parts.
          expect(route.path.startsWith('/explore'), key).toBe(false);
        }
      }
    }
  });

  it('falls back to the section for a page without its own', () => {
    expect(onwardOf('about', 'vision')).toEqual(onwardOf('about'));
    expect(onwardOf('shaykh-ul-islam', 'books')).toContain('library.books');
    expect(onwardOf('shaykh-ul-islam', 'lectures')).toContain('watch.lectures');
    expect(onwardOf('our-work', 'education')).toContain('learn');
    expect(onwardOf('organization', 'institutions')).toContain('global');
  });

  it('names official channels only from the footer evidence, and only where asked', () => {
    const footer = new Set(OFFICIAL_CHANNELS.map((channel) => channel.href));
    expect(channelsOf('digital-resources', 'mobile-apps').map((c) => c.id)).toEqual([
      'app-store',
      'google-play',
    ]);
    expect(channelsOf('digital-resources', 'social-media').map((c) => c.id)).toEqual([
      'youtube',
      'facebook',
      'x',
    ]);
    expect(channelsOf('digital-resources', 'rss')).toEqual([]);
    expect(channelsOf('about')).toEqual([]);
    for (const channel of channelsOf('digital-resources'))
      expect(footer.has(channel.href)).toBe(true);
  });
});

describe('every page says what it will hold, in every language', () => {
  it('carries one sentence per page and per landing-only section', async () => {
    for (const locale of ['en', 'ur', 'ar']) {
      const catalogue = JSON.parse(
        await readFile(path.join(repoRoot, `apps/web/messages/${locale}.json`), 'utf8'),
      ) as { explore: { what: Record<string, unknown> } };
      const what = catalogue.explore.what;
      for (const section of EXPLORE_SECTIONS) {
        const slugs = exploreSlugsOf(section);
        if (slugs.length === 0) {
          expect(typeof what[section], `${locale} ${section}`).toBe('string');
          continue;
        }
        expect(
          Object.keys(what[section] as object).sort(),
          `${locale} ${section}`,
        ).toEqual([...slugs].sort());
      }
    }
  });
});
