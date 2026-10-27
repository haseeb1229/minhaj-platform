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
  resolveLink,
  type MenuLink,
} from '../../apps/web/src/shell/menus.ts';
import {
  SHELL_ROUTES,
  routesIn,
  type AvailableRoute,
} from '../../apps/web/src/shell/registry.ts';

/**
 * THE SHELL'S MENU GROUPING — the mega menus, the mobile drawer and the footer.
 *
 * The header and footer render every link this module names, on every public
 * page, from a PRERENDERED shell that holds no runtime data. So each link must
 * be one the registry stands behind, must answer with an empty database, and
 * must not depend on anything only a request can know. These are the
 * properties the browser suite then observes as "every link resolves".
 */

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
  it('gives every mega-menu domain of the primary navigation a menu, in order', () => {
    const primary = routesIn('primary').map((route) => route.key);
    const menus = DOMAIN_MENUS.map((menu) => menu.key);

    // Search, My Minhaj and Donate are destinations, not mega menus (§2.2).
    expect(menus).toEqual(
      primary.filter((key) => !['search', 'my-minhaj', 'donate'].includes(key)),
    );
  });

  it('leads each menu from its own primary landing', () => {
    for (const menu of domainMenus()) {
      expect(menu.landing.key).toBe(menu.key);
      expect(menu.landing.placements).toContain('primary');
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

  it('places every route the registry assigns to the footer', () => {
    // The registry's footer placements stay meaningful: every route placed in
    // the footer is rendered there, and the legal documents and the sitemap
    // sit in the utility bar.
    const columns = new Set(
      footerColumns().flatMap((column) => column.links.map((link) => link.key)),
    );
    const utility = new Set(footerUtility().map((link) => link.key));

    for (const route of routesIn('footer-explore')) {
      expect(columns.has(route.key), route.key).toBe(true);
    }
    for (const route of routesIn('footer-legal')) {
      expect(utility.has(route.key), route.key).toBe(true);
    }
    for (const route of routesIn('footer-utility')) {
      expect(columns.has(route.key) || utility.has(route.key), route.key).toBe(true);
    }
    expect([...utility]).toEqual(FOOTER_UTILITY.map((link) => link.route));
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
      'menu.toggle',
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

    // The two templated labels carry their placeholder in every language.
    expect(messageAt(shell, 'menu.overview')).toContain('{section}');
    expect(messageAt(shell, 'menu.toggle')).toContain('{section}');
  });

  it('names no disclosure button with a word another control is pinned by', async () => {
    // Browser specs find the Explore, Menu and Close buttons and the not-found
    // search by accessible-name SUBSTRING. A domain's disclosure button is
    // named by `menu.toggle`, so no rendering of it may contain those words.
    const shell = messageAt(await catalogue('en'), 'shell') as Record<string, unknown>;
    const toggle = String(messageAt(shell, 'menu.toggle'));

    for (const menu of domainMenus().filter((entry) => entry.key !== 'explore')) {
      const name = toggle
        .replace('{section}', String(messageAt(shell, menu.landing.label)))
        .toLowerCase();
      for (const pinned of ['explore', 'menu', 'close', 'search']) {
        expect(name, menu.key).not.toContain(pinned);
      }
    }
  });
});
