import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from '../architecture/architecture-harness.ts';
import {
  EXPLORE_PAGES,
  EXPLORE_SECTIONS,
  ownerPathOf,
} from '../../apps/web/src/shell/explore.ts';
import {
  DOMAIN_MENUS,
  FOOTER_COLUMNS,
  FOOTER_UTILITY,
  domainMenus,
  footerColumns,
  footerUtility,
  headerUtility,
  resolveLink,
  shellLinkedKeys,
  type MenuLink,
} from '../../apps/web/src/shell/menus.ts';
import {
  LEGAL_DOCUMENTS,
  SHELL_ROUTES,
  type AvailableRoute,
} from '../../apps/web/src/shell/registry.ts';

/**
 * THE SHELL'S MENU GROUPING — the mega menus, the mobile sheet and the footer.
 *
 * UNCONDITIONAL (owner direction 2026-11-08): the header and footer render
 * every link this module names, on every public page, for every visitor,
 * whatever has been published. So each link must be one the registry stands
 * behind, must answer with an empty database, and must not depend on anything
 * only a request can know. These are the properties the browser suite then
 * observes as "every link resolves".
 */

/** The nine domains of the primary navigation, in the bar's order (§2.2). */
const DOMAINS = [
  'explore',
  'quran',
  'hadith',
  'learn',
  'library',
  'watch',
  'fatwa',
  'news-events',
  'global',
] as const;

/** Every link and linked column heading of one resolved menu. */
function routesOfMenu(menu: ReturnType<typeof domainMenus>[number]): AvailableRoute[] {
  return [
    menu.landing,
    ...menu.columns.flatMap((column) => [
      ...(column.heading.route === null ? [] : [column.heading.route]),
      ...column.links.map((link: MenuLink) => link.route),
    ]),
  ];
}

function everyMenuRoute(): AvailableRoute[] {
  return [
    ...domainMenus().flatMap(routesOfMenu),
    ...footerColumns().flatMap((column) => column.links.map((link) => link.route)),
    ...footerUtility().map((link) => link.route),
  ];
}

/**
 * Addresses that exist only at RUNTIME, or not at all. None may be a static
 * link in a prerendered shell (ROUTE_MAP.md §5.2).
 */
const NEVER_STATIC = [
  '/listen/recitations',
  '/people',
  '/library/collections',
  '/watch/audio',
  '/watch/galleries',
  '/global/events',
  '/media/downloads',
  '/quran/articles',
  '/quran/teachers',
  '/hadith/articles',
  '/hadith/scholars',
];

async function catalogue(locale: string): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(
      path.join(repoRoot, 'apps', 'web', 'messages', `${locale}.json`),
      'utf8',
    ),
  ) as Record<string, unknown>;
}

function messageAt(root: Record<string, unknown>, dotted: string): unknown {
  return dotted
    .split('.')
    .reduce<unknown>(
      (node, key) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[key]
          : undefined,
      root,
    );
}

describe('every menu link is a route the registry stands behind', () => {
  it('resolves, so nothing below passes vacuously', () => {
    expect(domainMenus()).toHaveLength(9);
    expect(everyMenuRoute().length).toBeGreaterThan(150);
  });

  it('links only delivered or reserved PUBLIC routes', () => {
    // `requireRoute` already throws on an unknown or deferred key; this states
    // the stronger property the shell relies on: nothing private, and nothing
    // that is not answering today.
    for (const route of everyMenuRoute()) {
      expect(['delivered', 'reserved'], route.key).toContain(route.availability);
      expect(route.visibility, route.key).toBe('public');
    }
  });

  it('refuses a key the registry does not name', () => {
    expect(() => resolveLink({ route: 'no-such-route' })).toThrow(/registered/);
  });

  it('never links a runtime-dependent, absent or query address', () => {
    for (const route of everyMenuRoute()) {
      expect(route.path, route.key).toMatch(/^(\/[a-z0-9-]+)*$/);
      expect(NEVER_STATIC, route.key).not.toContain(route.path);
      // A topic's address exists only while that topic does.
      expect(route.path.startsWith('/topics/'), route.key).toBe(false);
    }
  });

  it('leaves nothing deferred in the registry that a menu could have reached', () => {
    const deferred = SHELL_ROUTES.filter((route) => route.availability === 'deferred');
    const linked = new Set(everyMenuRoute().map((route) => route.key));

    for (const route of deferred) expect(linked.has(route.key), route.key).toBe(false);
  });
});

describe('the mega menus follow INFORMATION_ARCHITECTURE.md §3', () => {
  it('gives all nine domains a menu, in the primary order the registry records', () => {
    expect(DOMAIN_MENUS.map((menu) => menu.key)).toEqual([...DOMAINS]);

    // Search, My Minhaj and Donate are destinations, not mega menus (§2.2).
    const order = SHELL_ROUTES.map((route) => route.key).filter((key) =>
      (DOMAINS as readonly string[]).includes(key),
    );
    expect(order).toEqual([...DOMAINS]);
  });

  it('leads each menu from its own public landing', () => {
    for (const menu of domainMenus()) {
      expect(menu.landing.key).toBe(menu.key);
      expect(menu.landing.visibility).toBe('public');
    }
  });

  it('gives every column at least one link, and repeats nothing within a menu', () => {
    for (const menu of domainMenus()) {
      expect(menu.columns.length, menu.key).toBeGreaterThan(0);
      for (const column of menu.columns) {
        expect(column.links.length, `${menu.key} ${column.key}`).toBeGreaterThan(0);
      }

      const keys = routesOfMenu(menu).map((route) => route.key);
      expect(new Set(keys).size, `${menu.key}: ${keys.join(', ')}`).toBe(keys.length);
    }
  });

  it('reaches every Explore section and page from the Explore menu', () => {
    const explore = domainMenus().find((menu) => menu.key === 'explore');
    expect(explore).toBeDefined();

    const paths = new Set(routesOfMenu(explore!).map((route) => route.path));

    for (const section of EXPLORE_SECTIONS) {
      expect(paths.has(`/explore/${section}`), section).toBe(true);
    }
    for (const [section, pages] of Object.entries(EXPLORE_PAGES)) {
      for (const page of pages) {
        // An item its owner delivered elsewhere is linked at the owner's route.
        const expected = ownerPathOf(section, page) ?? `/explore/${section}/${page}`;
        expect(paths.has(expected), `${section}/${page}`).toBe(true);
      }
    }

    // The browser suite requires more than twenty links in the open panel.
    expect(explore!.columns.flatMap((column) => column.links).length).toBeGreaterThan(20);
  });

  it('opens the Explore panel on a section page, never on the bare landing', () => {
    // The keyboard proof tabs once into the panel and expects an
    // `/explore/{section}` address: the first column heading must be one.
    const [first] = domainMenus()[0]!.columns;
    expect(first?.heading.route?.path).toMatch(/^\/explore\/[a-z-]+$/);
  });

  it('keeps Listen inside Watch, so audio is not lost behind a video label', () => {
    const watch = domainMenus().find((menu) => menu.key === 'watch')!;
    const paths = routesOfMenu(watch).map((route) => route.path);

    expect(paths).toContain('/listen');
    expect(paths).toContain('/listen/lectures');
  });
});

describe('the footer follows INFORMATION_ARCHITECTURE.md §4', () => {
  it('has the six columns, each with links, repeating no link', () => {
    expect(FOOTER_COLUMNS.map((column) => column.heading)).toEqual([
      'footer.columns.about',
      'footer.columns.knowledge',
      'footer.columns.libraryMedia',
      'footer.columns.learnParticipate',
      'footer.columns.ourWork',
      'footer.columns.globalContact',
    ]);

    const keys = [
      ...footerColumns().flatMap((column) => {
        expect(column.links.length, column.heading).toBeGreaterThan(0);
        return column.links.map((link) => link.key);
      }),
      ...footerUtility().map((link) => link.key),
    ];
    expect(new Set(keys).size, keys.join(', ')).toBe(keys.length);
  });

  it('indexes every Explore section, then the legal documents and the sitemap', () => {
    const columns = new Set(
      footerColumns().flatMap((column) => column.links.map((link) => link.key)),
    );
    for (const section of EXPLORE_SECTIONS) {
      expect(columns.has(`explore.${section}`), section).toBe(true);
    }
    for (const key of ['articles', 'contact', 'feedback', 'newsletter', 'topics']) {
      expect(columns.has(key), key).toBe(true);
    }

    // Every legal document ALWAYS — not only once it is published — then the
    // human sitemap.
    expect(footerUtility().map((link) => link.key)).toEqual([
      ...LEGAL_DOCUMENTS.map((document) => `legal.${document}`),
      'sitemap',
    ]);
    expect(FOOTER_UTILITY.map((link) => link.route)).toEqual(
      footerUtility().map((link) => link.key),
    );
  });

  it('carries every delivered link the browser suite requires of a public page', () => {
    // tests/browser/shell.spec.ts requires these on /en, /en/explore,
    // /en/sitemap and /en/legal/terms; the footer is on all four, so it alone
    // guarantees the ones the header does not.
    const paths = new Set(
      [...footerColumns().flatMap((column) => column.links), ...footerUtility()].map(
        (link) => link.route.path,
      ),
    );
    for (const required of [
      '/contact',
      '/help',
      '/feedback',
      '/library/articles',
      '/topics',
      '/global',
      '/global/find-a-centre',
      '/newsletter',
      '/membership',
      '/donate',
    ]) {
      expect(paths.has(required), required).toBe(true);
    }
  });
});

describe('every label the menus render exists in every catalogue', () => {
  it.each(['en', 'ur', 'ar'])('resolves in %s', async (locale) => {
    const root = await catalogue(locale);
    const shell = messageAt(root, 'shell') as Record<string, unknown>;

    const labels = [
      'menu.overview',
      ...DOMAINS.map((key) => `nav.intros.${key === 'news-events' ? 'newsEvents' : key}`),
      ...headerUtility().map((link) => link.label),
      ...domainMenus().flatMap((menu) => [
        menu.landing.label,
        ...menu.columns.flatMap((column) => [
          column.heading.label,
          ...column.links.map((link) => link.label),
        ]),
      ]),
      ...FOOTER_COLUMNS.map((column) => column.heading),
      ...footerColumns().flatMap((column) => column.links.map((link) => link.label)),
      ...footerUtility().map((link) => link.label),
    ];

    for (const label of labels) {
      const value = messageAt(shell, label);
      expect(typeof value, `${locale}: shell.${label}`).toBe('string');
      expect(String(value).trim(), `${locale}: shell.${label}`).not.toBe('');
    }

    // The templated label carries its placeholder in every language.
    expect(messageAt(shell, 'menu.overview')).toContain('{section}');
  });

  it.each(['en', 'ur', 'ar'])(
    'names no domain button in %s with the words another control is found by',
    async (locale) => {
      // Browser specs find the Menu, Close and Search buttons by accessible-name
      // SUBSTRING. A domain's disclosure button is named by its label alone, so
      // no label may contain those controls' names.
      const shell = messageAt(await catalogue(locale), 'shell') as Record<
        string,
        unknown
      >;
      const pinned = ['nav.openMenu', 'nav.closeMenu', 'nav.search'].map((key) =>
        String(messageAt(shell, key)).toLowerCase(),
      );
      for (const menu of domainMenus()) {
        const name = String(messageAt(shell, menu.landing.label)).toLowerCase();
        for (const word of pinned)
          expect(name, `${locale} ${menu.key}`).not.toContain(word);
      }
    },
  );
});

describe('the header and footer links are unconditional', () => {
  it('links the utility strip to Find a Centre, Membership and Contact & Help', () => {
    expect(headerUtility().map((link) => link.route.path)).toEqual([
      '/global/find-a-centre',
      '/membership',
      '/help',
    ]);
  });

  it('always links Donate, My Minhaj, Search and every domain landing', () => {
    const linked = shellLinkedKeys();
    for (const key of ['home', 'search', 'my-minhaj', 'donate', ...DOMAINS]) {
      expect(linked.has(key), key).toBe(true);
    }
  });

  it('keeps the full breadth: over a hundred header links, over seventy in the footer', () => {
    const header = domainMenus().flatMap((menu) =>
      menu.columns.flatMap((column) => column.links),
    );
    expect(header.length).toBeGreaterThan(100);
    expect(footerColumns().flatMap((column) => column.links).length).toBeGreaterThan(70);
  });
});
