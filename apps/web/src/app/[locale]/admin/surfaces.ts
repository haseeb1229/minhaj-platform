import type { PermissionKey } from '@minhaj/contracts/identity';

/**
 * Every administrative surface, the permission that opens it, where it lives
 * and which group of the administration it is shown in.
 *
 * ONE LIST, read by both the administrative shell's navigation and the
 * dashboard, so the two can never disagree about what a person may reach. The
 * dashboard's policy is the same as the shell's: the union of the delivered
 * administrative read permissions.
 *
 * FILTERING IS PRESENTATION ONLY. Hiding an entry somebody cannot use is a
 * kindness, not a control: every page beneath re-checks its own permission
 * server-side and every action re-checks again, so a hand-typed URL reaches
 * exactly the same refusal (SECURITY_BASELINE.md §3.4 rule 1). A list of
 * permissions means ANY one of them opens the entry.
 *
 * THE GROUPS ARE WAYFINDING, NOT OWNERSHIP. They follow the admin hierarchy of
 * INFORMATION_ARCHITECTURE.md §7 — Identity & Access, Content, Religious
 * Content (§7.1), Communications and System are its own branches — and gather
 * its single-area branches (Media, Taxonomy, People, Global; Learning and
 * Messaging; Membership and Donations; Migration beside System) so an operator
 * scans seven headings rather than sixteen. Each area remains its own bounded
 * context with its own permissions, and no group confers anything.
 */

export const ADMIN_GROUPS = [
  'access',
  'content',
  'religious',
  'learning',
  'membership',
  'communications',
  'system',
] as const;

export type AdminGroup = (typeof ADMIN_GROUPS)[number];

export interface AdminSurface {
  readonly key: string;
  readonly permission: PermissionKey | readonly PermissionKey[];
  /** The entry's address below `/{locale}/admin/`. */
  readonly path: string;
  /** The address prefix the entry stands for, when wider than its own path. */
  readonly area?: string;
  readonly group: AdminGroup;
}

export const ADMIN_SURFACES = [
  // Phase 2 — identity and access.
  { key: 'users', permission: 'users.read', path: 'identity/users', group: 'access' },
  { key: 'roles', permission: 'roles.read', path: 'identity/roles', group: 'access' },
  {
    key: 'permissions',
    permission: 'permissions.read',
    path: 'identity/permissions',
    group: 'access',
  },
  {
    key: 'assignments',
    permission: 'assignments.read',
    path: 'identity/assignments',
    group: 'access',
  },
  {
    key: 'security',
    permission: 'security.read',
    path: 'identity/security',
    group: 'access',
  },
  // Phase 6 — Editorial, and its correspondence under a separate key.
  {
    key: 'editorial',
    permission: 'content.read',
    path: 'editorial/articles',
    area: 'editorial',
    group: 'content',
  },
  {
    key: 'correspondence',
    permission: 'correspondence.read',
    path: 'editorial/correspondence',
    group: 'content',
  },
  // Phase 3B. One entry for the taxonomy area: `taxonomy.read` opens all four
  // of its surfaces, and four entries for one permission would be four links
  // that appear and disappear together.
  {
    key: 'taxonomy',
    permission: 'taxonomy.read',
    path: 'taxonomy/topics',
    area: 'taxonomy',
    group: 'content',
  },
  // Phase 5. One entry for the People area, for the same reason.
  {
    key: 'people',
    permission: 'people.read',
    path: 'people/persons',
    area: 'people',
    group: 'content',
  },
  // Phase 8. One entry for the Library area: `library.read` opens all of its
  // surfaces — Phase 9's included.
  {
    key: 'library',
    permission: 'library.read',
    path: 'library/works',
    area: 'library',
    group: 'content',
  },
  // Phase 10. One entry for Media: `media.read` opens its surfaces, and every
  // action re-checks `media.administer`.
  {
    key: 'media',
    permission: 'media.read',
    path: 'media/videos',
    area: 'media',
    group: 'content',
  },
  // Phase 18. One entry for the Quran area: `quran.read` opens all of its
  // surfaces, every layered-work action re-checks `quran.administer`, and the
  // one canonical correction needs `quran.editCanonical` with its own step-up.
  {
    key: 'quran',
    permission: 'quran.read',
    path: 'quran/surahs',
    area: 'quran',
    group: 'religious',
  },
  // Phase 19. One entry for the Hadith area, never folded into the Quran's.
  {
    key: 'hadith',
    permission: 'hadith.read',
    path: 'hadith/records',
    area: 'hadith',
    group: 'religious',
  },
  // Phase 20. One entry for the Fatwa area, opened by ANY of its three stage
  // keys — none implies another, and no administrator key confers them. The
  // area's root sends each holder to the first stage their keys open.
  {
    key: 'fatwa',
    permission: ['question.receive', 'fatwa.answer', 'fatwa.publish'],
    path: 'fatwa',
    group: 'religious',
  },
  // Phase 22. One entry for Learning: `learning.read` opens its courses, paths
  // and the enrolment and trial-request COUNTS; Phase 23's class keys open the
  // same entry. The area root sends each holder to the first surface their
  // keys open.
  {
    key: 'learning',
    permission: ['learning.read', 'learning.classes.read'],
    path: 'learning',
    group: 'learning',
  },
  // Phase 24. One entry for Messaging, opened by EITHER of its two externally
  // gated keys — support staff and moderators are different people.
  {
    key: 'messaging',
    permission: ['messaging.support', 'messaging.moderate'],
    path: 'messaging',
    group: 'learning',
  },
  // Phase 16. One entry for the Global Network: `global.read` opens Countries,
  // Regions, Cities and Centres, and every action re-checks `global.administer`.
  {
    key: 'global',
    permission: 'global.read',
    path: 'global/countries',
    area: 'global',
    group: 'content',
  },
  // Phase 21. Newsletter subscription and suppression state. `newsletter.read`
  // opens the page; `newsletter.operate` alone opens nothing here.
  {
    key: 'newsletter',
    permission: 'newsletter.read',
    path: 'communications/newsletter',
    group: 'communications',
  },
  // Phase 26. One entry for Membership; every action re-checks
  // `membership.administer`.
  {
    key: 'membership',
    permission: 'membership.read',
    path: 'membership',
    group: 'membership',
  },
  // Phase 27. One entry for Donations; a refund needs the externally gated
  // `donations.refund`, which alone opens nothing here.
  {
    key: 'donations',
    permission: 'donations.read',
    path: 'donations',
    group: 'membership',
  },
  // Phase 29. One entry for Migration: `migration.read` opens all of its
  // surfaces; `migration.publish` alone opens nothing here.
  {
    key: 'migration',
    permission: 'migration.read',
    path: 'migration',
    group: 'system',
  },
  // Phase 4. A READ-ONLY view of the public shell's effective navigation.
  {
    key: 'navigation',
    permission: 'navigation.read',
    path: 'system/navigation',
    group: 'system',
  },
  { key: 'audit', permission: 'audit.read', path: 'system/audit', group: 'system' },
  {
    key: 'integrations',
    permission: 'integrations.read',
    path: 'system/integrations',
    group: 'system',
  },
  {
    key: 'delivery',
    permission: 'delivery.read',
    path: 'communications/delivery',
    group: 'communications',
  },
  // Phase 17. Indexing lag and failures; operating the indexer needs
  // `search.operate` as well, re-checked by every action.
  { key: 'search', permission: 'search.read', path: 'system/search', group: 'system' },
] as const satisfies readonly AdminSurface[];

export type AdminSurfaceKey = (typeof ADMIN_SURFACES)[number]['key'];

/** The surfaces a holder of `held` may open, in the list's own order. */
export function reachableSurfaces(
  held: ReadonlySet<string>,
): readonly (typeof ADMIN_SURFACES)[number][] {
  return ADMIN_SURFACES.filter((surface) =>
    typeof surface.permission === 'string'
      ? held.has(surface.permission)
      : surface.permission.some((permission) => held.has(permission)),
  );
}

/**
 * Surfaces arranged by group, in the groups' fixed order; a group with no
 * reachable surface is left out rather than shown empty.
 */
export function groupedSurfaces<Surface extends Pick<AdminSurface, 'group'>>(
  surfaces: readonly Surface[],
): readonly { readonly group: AdminGroup; readonly surfaces: readonly Surface[] }[] {
  return ADMIN_GROUPS.map((group) => ({
    group,
    surfaces: surfaces.filter((surface) => surface.group === group),
  })).filter((entry) => entry.surfaces.length > 0);
}
