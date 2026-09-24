import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from '../architecture/architecture-harness.ts';
import {
  EXPLORE_PAGES,
  EXPLORE_SECTIONS,
  exploreSlugsOf,
  isExplorePage,
} from '../../apps/web/src/shell/explore.ts';
import {
  LEGAL_DOCUMENTS,
  SHELL_ROUTES,
  indexableRoutes,
  isAvailable,
  isLegalDocument,
  linksIn,
  pathFor,
  requireRoute,
  routeByKey,
  routesIn,
  type ShellRoute,
} from '../../apps/web/src/shell/registry.ts';

/**
 * PHASE 4 — the shell route registry.
 *
 * ONE LIST DRIVES SIX SURFACES — header, mega menu, mobile drawer, footer,
 * human sitemap and the administrative status page — so a defect in it is a
 * defect in all six at once. These are the invariants those surfaces rely on
 * without checking: that a deferred capability cannot be linked, that a
 * placeholder cannot be advertised to a crawler, that a private route cannot
 * reach a public index, and that every label a navigation renders actually
 * exists in the catalogue.
 */

async function englishCatalogue(): Promise<Record<string, unknown>> {
  const raw = await readFile(
    path.join(repoRoot, 'apps', 'web', 'messages', 'en.json'),
    'utf8',
  );
  return JSON.parse(raw) as Record<string, unknown>;
}

/** Every application source file, concatenated — for reference scanning. */
async function appSource(): Promise<string> {
  const { readdir } = await import('node:fs/promises');
  const root = path.join(repoRoot, 'apps', 'web', 'src');
  const parts: string[] = [];

  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name);

      if (entry.isDirectory()) await visit(child);
      else if (/\.tsx?$/.test(entry.name)) {
        parts.push(await readFile(child, 'utf8'));
      }
    }
  };

  await visit(root);
  return parts.join('\n');
}

/** Resolves a dotted message path, or `undefined`. */
function messageAt(catalogue: Record<string, unknown>, dotted: string): unknown {
  return dotted
    .split('.')
    .reduce<unknown>(
      (node, key) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[key]
          : undefined,
      catalogue,
    );
}

describe('the registry describes routes, and nothing else', () => {
  it('declares at least one route, so nothing below passes vacuously', () => {
    expect(SHELL_ROUTES.length).toBeGreaterThan(0);
  });

  it('gives every route a unique key', () => {
    const keys = SHELL_ROUTES.map((route) => route.key);

    expect(new Set(keys).size, keys.join(', ')).toBe(keys.length);
  });

  it('carries no content field of any kind', () => {
    // The boundary DELIVERY_PLAN.md Phase 4 draws is about SUBSTANCE, not
    // storage: a registry entry may carry a label key, never a body. A field
    // holding prose would be an informal CMS whatever it was called, so the
    // permitted field set is asserted rather than described.
    const permitted = new Set([
      'key',
      'label',
      'path',
      'placements',
      'visibility',
      'availability',
      'indexing',
    ]);

    for (const route of SHELL_ROUTES) {
      for (const field of Object.keys(route)) {
        expect(permitted.has(field), `${route.key} declares "${field}"`).toBe(true);
      }
    }
  });
});

describe('a deferred capability cannot be linked', () => {
  it('gives a deferred route no path at all', () => {
    // Not "an empty path" — no field. There is no string for a link to be
    // built from, which is what makes dead navigation a type error rather than
    // a review finding (ROUTE_MAP.md §5.2).
    for (const route of SHELL_ROUTES.filter((entry) => !isAvailable(entry))) {
      expect(route, route.key).not.toHaveProperty('path');
    }
  });

  it('never returns a deferred route from a navigation view', () => {
    const placements = [
      'primary',
      'utility',
      'footer-explore',
      'footer-legal',
      'footer-utility',
    ] as const;

    for (const placement of placements) {
      for (const route of linksIn(placement)) {
        expect(route.availability, `${route.key} in ${placement}`).not.toBe('deferred');
      }
    }
  });

  it('records the seven deferred domains rather than forgetting them', () => {
    // Recording them is what lets the administrative status surface tell the
    // truth about the roadmap, and what lets the assertions above range over
    // the whole set instead of over whatever somebody remembered to add.
    //
    // `library` LEFT THIS LIST IN PHASE 8, `search` IN PHASE 17 and `watch` IN
    // PHASE 10, when each was delivered. Each is asserted delivered below
    // rather than silently dropped.
    for (const key of [
      'quran',
      'hadith',
      'learn',
      'fatwa',
      'news-events',
      'global',
      'donate',
    ]) {
      const route = routeByKey(key);

      expect(route, key).not.toBeNull();
      expect(route?.availability, key).toBe('deferred');
    }
  });

  it('delivers Search with a path, public and never indexable', () => {
    // A results page is a view of a query, not a resource: `noindex` and never
    // a sitemap entry, whatever the indexing posture (ROUTE_MAP.md §9.5).
    const route = requireRoute('search');

    expect(route.path).toBe('/search');
    expect(route.visibility).toBe('public');
    expect(route.indexing).toBe('excluded');
    expect(route.placements).toContain('primary');
  });

  it('delivers the canonical Topics browser, public and eligible', () => {
    // Phase 17: Topic search results must be navigable into `/topics/{slug}`.
    const route = requireRoute('topics');

    expect(route.path).toBe('/topics');
    expect(route.visibility).toBe('public');
    expect(route.indexing).toBe('eligible');
  });

  it('delivers Library with a path, and only the delivered Library surfaces', () => {
    expect(requireRoute('library').path).toBe('/library');

    const surfaces = SHELL_ROUTES.filter((route) => route.key.startsWith('library.'))
      .map((route) => route.key)
      .sort();

    // Phases 8 and 9. Phase 15's collections are ABSENT, not reserved: they have
    // no entry, so no link to them can be built.
    expect(surfaces).toEqual([
      'library.authors',
      'library.books',
      'library.downloads',
      'library.encyclopedias',
      'library.languages',
      'library.magazines',
      'library.publications',
      'library.research',
      'library.research-papers',
      'library.resources',
      'library.sale-points',
      'library.topics',
    ]);
    expect(routeByKey('library.collections')).toBeNull();
  });

  it('delivers Watch with a path, and only the Phase-10 Watch surfaces', () => {
    const watch = requireRoute('watch');
    expect(watch.path).toBe('/watch');
    expect(watch.placements).toContain('primary');
    expect(watch.indexing).toBe('eligible');

    const surfaces = SHELL_ROUTES.filter((route) => route.key.startsWith('watch.'))
      .map((route) => route.key)
      .sort();

    // Video, Series and Playlist. Audio is Listen's, a SIBLING family with its
    // own entries (Phase 11), never a Watch surface; galleries (Phase 12) are
    // ABSENT, not reserved, and a topic view is a filtered view canonical to
    // the topic hub, so it has no entry either.
    expect(surfaces).toEqual([
      'watch.documentaries',
      'watch.events',
      'watch.highlights',
      'watch.interviews',
      'watch.lectures',
      'watch.playlists',
      'watch.programs',
      'watch.series',
      'watch.speakers',
      'watch.videos',
    ]);
    for (const absent of ['watch.audio', 'watch.galleries', 'watch.topics']) {
      expect(routeByKey(absent), absent).toBeNull();
    }
  });

  it('delivers Listen beside Watch, and no recitation catalogue', () => {
    // Phase 11: the landing, the track listing and audio series — reached from
    // Watch, so none has a placement of its own. `/listen/recitations` is the
    // Quran-owned catalogue projection, and Quran has not shipped: it has no
    // entry of any kind, reserved or otherwise.
    const listen = SHELL_ROUTES.filter(
      (route) => route.key === 'listen' || route.key.startsWith('listen.'),
    );
    expect(listen.map((route) => route.key).sort()).toEqual([
      'listen',
      'listen.lectures',
      'listen.series',
    ]);
    for (const route of listen) {
      expect(isAvailable(route) && route.availability, route.key).toBe('delivered');
      expect(route.placements, route.key).toEqual([]);
    }
    expect(routeByKey('listen')).toMatchObject({ path: '/listen' });
    for (const absent of ['listen.recitations', 'listen.podcasts', 'listen.tracks']) {
      expect(routeByKey(absent), absent).toBeNull();
    }
  });

  it('refuses to resolve a deferred route as a renderable one', () => {
    expect(() => requireRoute('quran')).toThrow(/deferred/);
    expect(() => requireRoute('no-such-route')).toThrow(/registered/);
  });

  it('keeps the primary navigation in the accepted order', () => {
    // INFORMATION_ARCHITECTURE.md §2.2, in full. Later phases turn entries on;
    // none of them may quietly reorder the IA while doing it.
    expect(routesIn('primary').map((route) => route.key)).toEqual([
      'explore',
      'quran',
      'hadith',
      'learn',
      'library',
      'watch',
      'fatwa',
      'news-events',
      'global',
      'search',
      'my-minhaj',
      'donate',
    ]);
  });
});

describe('an arbitrary path cannot be injected from the registry', () => {
  it('builds every path from lowercase, hyphenated, locale-free segments', () => {
    // ROUTE_MAP.md §10 rule 5, and the reason it is enforced here: every shell
    // URL in the application is assembled by `pathFor` from these strings, so
    // a stray `//evil.test`, an uppercase segment or an embedded query would
    // become a link on every page at once.
    for (const route of SHELL_ROUTES.filter(isAvailable)) {
      expect(route.path, route.key).toMatch(/^(\/[a-z0-9-]+)*$/);
    }
  });

  it('never embeds a locale in a registry path', () => {
    for (const route of SHELL_ROUTES.filter(isAvailable)) {
      expect(route.path.startsWith('/en'), route.key).toBe(false);
      expect(route.path.startsWith('/ur'), route.key).toBe(false);
      expect(route.path.startsWith('/ar'), route.key).toBe(false);
    }
  });

  it('prefixes the locale exactly once', () => {
    expect(pathFor('ur', requireRoute('explore'))).toBe('/ur/explore');
    expect(pathFor('ar', requireRoute('home'))).toBe('/ar');
  });
});

describe('indexing eligibility is honest', () => {
  it('never makes a placeholder eligible', () => {
    // A reserved route renders a "not yet published" notice and no body.
    // Advertising it in a sitemap would be advertising a page with nothing on
    // it (ROUTE_MAP.md §9.4).
    for (const route of SHELL_ROUTES.filter(isAvailable)) {
      if (route.availability === 'reserved') {
        expect(route.indexing, route.key).toBe('excluded');
      }
    }
  });

  it('never makes a private route eligible', () => {
    for (const route of SHELL_ROUTES.filter(isAvailable)) {
      if (route.visibility === 'private') {
        expect(route.indexing, route.key).toBe('excluded');
      }
    }
  });

  it('marks exactly the delivered public shell routes eligible', () => {
    expect(
      indexableRoutes()
        .map((route) => route.key)
        .sort(),
    ).toEqual([
      'explore',
      'home',
      // Phase 8: the Library landing page and its seven delivered surfaces;
      // Phase 9: five scholarly and periodical listings.
      'library',
      'library.authors',
      'library.books',
      'library.downloads',
      'library.encyclopedias',
      'library.languages',
      'library.magazines',
      'library.publications',
      'library.research',
      'library.research-papers',
      'library.resources',
      'library.sale-points',
      'library.topics',
      // Phase 11: the Listen landing and its two delivered surfaces.
      'listen',
      'listen.lectures',
      'listen.series',
      'sitemap',
      // Phase 17: the canonical Topics browser. `search` is delivered too, and
      // is deliberately NOT here.
      'topics',
      // Phase 10: the Watch landing page and its ten delivered surfaces.
      'watch',
      'watch.documentaries',
      'watch.events',
      'watch.highlights',
      'watch.interviews',
      'watch.lectures',
      'watch.playlists',
      'watch.programs',
      'watch.series',
      'watch.speakers',
      'watch.videos',
    ]);
  });

  it('keeps `/my` linked but excluded', () => {
    // The account entry point is in the primary navigation and must stay
    // there; everything beneath it is private and `noindex`, so it must never
    // reach a sitemap (ROUTE_MAP.md §9.5).
    const route = requireRoute('my-minhaj');

    expect(route.availability).toBe('delivered');
    expect(route.visibility).toBe('private');
    expect(route.indexing).toBe('excluded');
    expect(route.placements).toContain('primary');
  });
});

describe('the registry and the Explore allowlists cannot drift', () => {
  it('registers exactly one landing per section', () => {
    const registered = SHELL_ROUTES.filter(
      (route) => route.key.startsWith('explore.') && route.key.split('.').length === 2,
    ).map((route) => route.key.slice('explore.'.length));

    expect(registered.sort()).toEqual([...EXPLORE_SECTIONS].sort());
  });

  it('registers exactly the reserved pages, and no others', () => {
    const registered = SHELL_ROUTES.filter(
      (route) => route.key.startsWith('explore.') && route.key.split('.').length === 3,
    )
      .map((route) => route.key.slice('explore.'.length))
      .sort();

    const expected = Object.entries(EXPLORE_PAGES)
      .flatMap(([section, pages]) => pages.map((page) => `${section}.${page}`))
      .sort();

    expect(registered).toEqual(expected);
  });

  it('gives a leaf section no pages at all', () => {
    // `/explore/community/anything` must be a 404, and it is because the data
    // produces no parameter for it — not because a guard remembered to refuse.
    expect(exploreSlugsOf('community')).toEqual([]);
    expect(exploreSlugsOf('leadership')).toEqual([]);
  });

  it('validates a page against ITS OWN section', () => {
    // `education` is reserved by two different sections, which is exactly why
    // a slug is never validated on its own.
    expect(isExplorePage('our-work', 'education')).toBe(true);
    expect(isExplorePage('shaykh-ul-islam', 'education')).toBe(true);
    expect(isExplorePage('about', 'education')).toBe(false);
    expect(isExplorePage('about', 'vision')).toBe(true);
  });

  it('registers exactly the four legal documents', () => {
    const registered = SHELL_ROUTES.filter((route) => route.key.startsWith('legal.')).map(
      (route) => route.key.slice('legal.'.length),
    );

    expect(registered.sort()).toEqual([...LEGAL_DOCUMENTS].sort());
    expect(isLegalDocument('privacy')).toBe(true);
    expect(isLegalDocument('refunds')).toBe(false);
  });
});

describe('every label the shell renders exists', () => {
  it('resolves each registry label to a string in the English catalogue', async () => {
    // A missing key is not a crash: next-intl renders the key path. On a
    // navigation bar that is a menu item reading `nav.quran`, which is the kind
    // of defect a person notices only in a language they cannot read.
    const catalogue = await englishCatalogue();

    for (const route of SHELL_ROUTES) {
      const value = messageAt(catalogue, `shell.${route.label}`);

      expect(typeof value, `shell.${route.label} (${route.key})`).toBe('string');
    }
  });

  it('resolves every Explore summary the landing and home page render', async () => {
    const catalogue = await englishCatalogue();

    for (const section of EXPLORE_SECTIONS) {
      expect(
        typeof messageAt(catalogue, `shell.explore.${section}.summary`),
        section,
      ).toBe('string');
    }
  });

  it('leaves no orphaned Explore message behind a retired route', async () => {
    // The other direction: a catalogue entry for a section or page the
    // allowlist no longer names is a translated string nobody can reach, and
    // three catalogues quietly maintaining it.
    const catalogue = await englishCatalogue();
    const explore = messageAt(catalogue, 'shell.explore') as Record<string, unknown>;

    const structural = new Set(['title', 'description']);
    const sections = Object.keys(explore).filter((key) => !structural.has(key));

    expect(sections.sort()).toEqual([...EXPLORE_SECTIONS].sort());

    for (const section of EXPLORE_SECTIONS) {
      const pages = messageAt(catalogue, `shell.explore.${section}.pages`);
      const declared = exploreSlugsOf(section);

      if (declared.length === 0) {
        expect(pages, `${section} must declare no pages`).toBeUndefined();
        continue;
      }

      expect(Object.keys(pages as Record<string, unknown>).sort()).toEqual(
        [...declared].sort(),
      );
    }
  });
});

describe('no shell message is carried without a consumer', () => {
  it('references every `shell.*` key from the application source', async () => {
    // THE DIRECTION THE TYPE SYSTEM CANNOT SEE. `t('home.lede')` is checked
    // against the catalogue at compile time, so a key that does not exist is a
    // build error. A key that exists and is used by nothing is invisible — and
    // it is three catalogues' worth of translated string that somebody will
    // keep updating for a surface that was deleted.
    const catalogue = await englishCatalogue();
    const shell = messageAt(catalogue, 'shell') as Record<string, unknown>;

    const keys: string[] = [];
    const walk = (node: unknown, prefix: string): void => {
      if (typeof node === 'object' && node !== null) {
        for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
          walk(child, prefix === '' ? key : `${prefix}.${key}`);
        }
      } else {
        keys.push(prefix);
      }
    };
    walk(shell, '');

    expect(keys.length).toBeGreaterThan(50);

    const source =
      (await appSource()) +
      (await readFile(
        path.join(repoRoot, 'packages/contracts/src/editorial/routes.ts'),
        'utf8',
      ));

    const unused = keys.filter((key) => {
      const last = key.split('.').at(-1) ?? key;

      // A literal `t('nav.explore')`, or a key the shell builds from a
      // registry label or an allowlist slug — `explore.${section}.title` and
      // `explore.${section}.pages.${slug}` are assembled at the call site, so
      // the final segment is what appears in source.
      return !(
        source.includes(key) ||
        source.includes(`'${last}'`) ||
        source.includes(`${last}\``)
      );
    });

    expect(unused, `unused shell messages: ${unused.join(', ')}`).toEqual([]);
  });
});

describe('placement views agree with the registry', () => {
  it('returns a route in every placement it declares', () => {
    for (const route of SHELL_ROUTES) {
      for (const placement of route.placements) {
        expect(
          routesIn(placement).some((entry: ShellRoute) => entry.key === route.key),
          `${route.key} in ${placement}`,
        ).toBe(true);
      }
    }
  });

  it('puts every reserved legal and Explore route somewhere a visitor can find it', () => {
    // A reserved route nothing links to is a page that exists and cannot be
    // reached — the mirror image of dead navigation. Explore pages are reached
    // through their section landing and the mega menu rather than the footer,
    // so the check is that a section or document is placed, not every leaf.
    for (const document of LEGAL_DOCUMENTS) {
      expect(requireRoute(`legal.${document}`).placements).toContain('footer-legal');
    }

    for (const section of EXPLORE_SECTIONS) {
      expect(requireRoute(`explore.${section}`).placements).toContain('footer-explore');
    }
  });
});
