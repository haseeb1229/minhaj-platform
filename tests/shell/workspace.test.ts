import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from '../architecture/architecture-harness.ts';
import {
  ADMIN_GROUPS,
  ADMIN_SURFACES,
  groupedSurfaces,
  reachableSurfaces,
} from '../../apps/web/src/app/[locale]/admin/surfaces.ts';
import {
  currentLinkKey,
  type WorkspaceLink,
} from '../../apps/web/src/components/workspace/nav-match.ts';

/**
 * The private workspaces' navigation rules: which entry of an area's
 * navigation is current, and which administrative surfaces a holder of a set
 * of permissions is shown, in which group.
 *
 * Both are presentation — a page re-checks its own permission whatever the
 * navigation showed — but a wrong answer is still a lie on screen: a current
 * marker on the wrong entry, a dashboard card leading to a 404, or an entry
 * for an area the person cannot open.
 */

const link = (key: string, href: string, extra: Partial<WorkspaceLink> = {}) => ({
  key,
  href,
  text: key,
  ...extra,
});

describe('the current workspace entry', () => {
  const ADMIN: readonly WorkspaceLink[] = [
    link('dashboard', '/admin', { exact: true }),
    link('editorial', '/admin/editorial/articles', { also: ['/admin/editorial'] }),
    link('correspondence', '/admin/editorial/correspondence'),
    link('donations', '/admin/donations'),
    link('campaigns', '/admin/donations/campaigns'),
  ];

  it('marks an area root only on the root itself', () => {
    expect(currentLinkKey('/admin', ADMIN)).toBe('dashboard');
    expect(currentLinkKey('/admin/', ADMIN)).toBe('dashboard');
    // A page no entry claims has no current entry — never the root by default.
    expect(currentLinkKey('/admin/identity/users', ADMIN)).toBeNull();
  });

  it('prefers the deepest entry the path sits under', () => {
    expect(currentLinkKey('/admin/editorial/correspondence', ADMIN)).toBe(
      'correspondence',
    );
    expect(currentLinkKey('/admin/editorial/news', ADMIN)).toBe('editorial');
    expect(currentLinkKey('/admin/editorial/articles/new', ADMIN)).toBe('editorial');
    expect(currentLinkKey('/admin/donations/campaigns', ADMIN)).toBe('campaigns');
    expect(currentLinkKey('/admin/donations/0000-record', ADMIN)).toBe('donations');
  });

  it('matches a prefixed Urdu workspace the same way, and never across locales', () => {
    // English is unprefixed (ROUTE_MAP.md §1.1, R1); Urdu and Arabic carry
    // their prefix, so their navigation is built — and matched — prefixed.
    const urdu = [
      link('dashboard', '/ur/admin', { exact: true }),
      link('donations', '/ur/admin/donations'),
    ];
    expect(currentLinkKey('/ur/admin', urdu)).toBe('dashboard');
    expect(currentLinkKey('/ur/admin/donations/0000-record', urdu)).toBe('donations');
    expect(currentLinkKey('/admin/donations', urdu)).toBeNull();
    expect(currentLinkKey('/ur/admin/donations', ADMIN)).toBeNull();
  });

  it('respects segment boundaries', () => {
    const links = [link('saved', '/my/saved'), link('save', '/my/save')];
    expect(currentLinkKey('/my/saved/notes', links)).toBe('saved');
    expect(currentLinkKey('/my/savedx', links)).toBeNull();
    expect(currentLinkKey('/my/save', links)).toBe('save');
  });

  it('ignores a query or fragment on an entry', () => {
    const links = [link('audit', '/admin/system/audit?action=x#top')];
    expect(currentLinkKey('/admin/system/audit', links)).toBe('audit');
  });

  it('never lets an exact entry claim by an extra prefix', () => {
    const links = [link('overview', '/my', { exact: true, also: ['/my/settings'] })];
    expect(currentLinkKey('/my/settings/profile', links)).toBeNull();
  });

  it('answers nothing without a path', () => {
    expect(currentLinkKey(null, ADMIN)).toBeNull();
    expect(currentLinkKey('', ADMIN)).toBeNull();
  });

  it('does not confuse locales', () => {
    expect(currentLinkKey('/ur/admin', ADMIN)).toBeNull();
  });
});

describe('the administrative surfaces', () => {
  it('lists every surface once, at a distinct address', () => {
    const keys = ADMIN_SURFACES.map((surface) => surface.key);
    const paths = ADMIN_SURFACES.map((surface) => surface.path);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('leads every entry to a route that exists', async () => {
    // No dead navigation (ROUTE_MAP.md §5.2): a card or a link to a path with
    // no page would be a 404 the dashboard itself promised.
    for (const surface of ADMIN_SURFACES) {
      const page = path.join(
        repoRoot,
        'apps/web/src/app/[locale]/admin',
        surface.path,
        'page.tsx',
      );
      await expect(stat(page), surface.path).resolves.toBeTruthy();
    }
  });

  it('names and describes every surface and group in the catalogue', async () => {
    const en = JSON.parse(
      await readFile(path.join(repoRoot, 'apps/web/messages/en.json'), 'utf8'),
    ) as {
      admin: {
        nav: Record<string, string>;
        summary: Record<string, string>;
        groups: Record<string, string>;
      };
    };
    for (const surface of ADMIN_SURFACES) {
      expect(en.admin.nav[surface.key], surface.key).toBeTruthy();
      expect(en.admin.summary[surface.key], surface.key).toBeTruthy();
    }
    expect(Object.keys(en.admin.summary).sort()).toEqual(
      ADMIN_SURFACES.map((surface) => surface.key).sort(),
    );
    expect(Object.keys(en.admin.groups).sort()).toEqual([...ADMIN_GROUPS].sort());
  });

  it('uses every group, so no heading can stand empty for everyone', () => {
    for (const group of ADMIN_GROUPS)
      expect(
        ADMIN_SURFACES.some((surface) => surface.group === group),
        group,
      ).toBe(true);
  });

  it('shows nothing to an account with no administrative key', () => {
    expect(reachableSurfaces(new Set())).toEqual([]);
    expect(reachableSurfaces(new Set(['teaching.perform']))).toEqual([]);
  });

  it('never shows an entry for a key that alone opens nothing', () => {
    // Each of these is checked by actions only; holding it alone reaches no page.
    for (const key of [
      'donations.refund',
      'migration.publish',
      'newsletter.operate',
      'search.operate',
      'media.administer',
    ])
      expect(reachableSurfaces(new Set([key])), key).toEqual([]);
  });

  it('opens a shared entry with ANY of its keys', () => {
    const keys = (held: readonly string[]) =>
      reachableSurfaces(new Set(held)).map((surface) => surface.key);
    expect(keys(['learning.classes.read'])).toEqual(['learning']);
    expect(keys(['fatwa.publish'])).toEqual(['fatwa']);
    expect(keys(['messaging.moderate'])).toEqual(['messaging']);
    expect(keys(['content.read', 'correspondence.read'])).toEqual([
      'editorial',
      'correspondence',
    ]);
  });

  it('groups reachable surfaces in the fixed order and leaves empty groups out', () => {
    const grouped = groupedSurfaces(
      reachableSurfaces(new Set(['audit.read', 'users.read', 'quran.read'])),
    );
    expect(grouped.map((entry) => entry.group)).toEqual([
      'access',
      'religious',
      'system',
    ]);
    expect(grouped.map((entry) => entry.surfaces.map((surface) => surface.key))).toEqual([
      ['users'],
      ['quran'],
      ['audit'],
    ]);
  });

  it('groups every surface exactly once when everything is held', () => {
    const everything = new Set(
      ADMIN_SURFACES.flatMap((surface) =>
        typeof surface.permission === 'string'
          ? [surface.permission]
          : surface.permission,
      ),
    );
    const grouped = groupedSurfaces(reachableSurfaces(everything));
    expect(grouped.map((entry) => entry.group)).toEqual([...ADMIN_GROUPS]);
    expect(grouped.flatMap((entry) => entry.surfaces).length).toBe(ADMIN_SURFACES.length);
  });
});
