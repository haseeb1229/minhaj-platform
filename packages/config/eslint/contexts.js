/**
 * Bounded-context dependency allowlist.
 *
 * This file is a TRANSCRIPTION of DOMAIN_MODEL.md §3.1 and §3.2, mirrored by
 * ARCHITECTURE.md §6.1 and §6.1.1. It is not an interpretation and must not be
 * edited to make a feature compile.
 *
 * An edge that does not appear in `contextAllowlist` DOES NOT EXIST
 * (ARCHITECTURE.md §6.3 rule 1). Adding one is an architecture decision requiring
 * review, never a convenience taken during feature work.
 *
 * Layer numbering is a readability aid. The allowlist is the specification.
 */

/**
 * Layer 0 — platform abstractions and adapters (DOMAIN_MODEL.md §1.1).
 *
 * These are NOT bounded contexts. They own no business invariants and are
 * consumed by every context through interfaces, so they are never enumerated
 * as individual edges in the allowlist.
 */
export const layerZeroModules = Object.freeze([
  'database',
  'storage',
  'search',
  'email',
  'logging',
  'auditing',
  'rate-limiting',
]);

/** The 16 bounded contexts of DOMAIN_MODEL.md §1, by directory slug. */
export const contextSlugs = Object.freeze([
  'identity-access',
  'people-contributors',
  'taxonomy',
  'editorial',
  'quran',
  'hadith',
  'library',
  'media',
  'fatwa',
  'learning',
  'personalisation-notifications',
  'messaging',
  'global-network',
  'membership',
  'donations',
  'migration-provenance',
]);

/**
 * The allowlist. Key = context, value = the ONLY other bounded contexts it may
 * import. Layer 0 is permitted to every context and is therefore not listed.
 *
 * Transcribed row-for-row from DOMAIN_MODEL.md §3.1.
 */
export const contextAllowlist = Object.freeze({
  // | Identity & Access | Layer 0 only |
  'identity-access': Object.freeze([]),

  // | People & Contributors | Layer 0; Identity & Access |
  'people-contributors': Object.freeze(['identity-access']),

  // | Taxonomy | Layer 0 only |
  taxonomy: Object.freeze([]),

  // | Editorial | Layer 0; Identity & Access; People & Contributors; Taxonomy |
  editorial: Object.freeze(['identity-access', 'people-contributors', 'taxonomy']),

  // | Quran | Layer 0; Identity & Access; People & Contributors; Taxonomy |
  quran: Object.freeze(['identity-access', 'people-contributors', 'taxonomy']),

  // | Hadith | Layer 0; Identity & Access; People & Contributors; Taxonomy |
  hadith: Object.freeze(['identity-access', 'people-contributors', 'taxonomy']),

  // | Library | Layer 0; Identity & Access; People & Contributors; Taxonomy |
  library: Object.freeze(['identity-access', 'people-contributors', 'taxonomy']),

  // | Media | Layer 0; Identity & Access; People & Contributors; Taxonomy |
  media: Object.freeze(['identity-access', 'people-contributors', 'taxonomy']),

  // | Fatwa | Layer 0; Identity & Access; People & Contributors; Taxonomy |
  fatwa: Object.freeze(['identity-access', 'people-contributors', 'taxonomy']),

  // | Global Network | Layer 0; Identity & Access; Taxonomy |
  'global-network': Object.freeze(['identity-access', 'taxonomy']),

  // | Learning | Layer 0; Layer 1; Media; Library; Global Network |
  learning: Object.freeze([
    'identity-access',
    'people-contributors',
    'taxonomy',
    'media',
    'library',
    'global-network',
  ]),

  // | Personalisation & Notifications | Layer 0; Identity & Access |
  // References content by typed identifier only; resolved at Layer 4 (§11.3).
  'personalisation-notifications': Object.freeze(['identity-access']),

  // | Messaging | Layer 0; Identity & Access; People & Contributors; Learning |
  // `messaging -> learning` is the ONLY permitted same-level edge (§3.2).
  // The reverse, `learning -> messaging`, is prohibited and its absence from
  // the `learning` row above is what keeps the graph acyclic.
  messaging: Object.freeze(['identity-access', 'people-contributors', 'learning']),

  // | Membership | Layer 0; Identity & Access; People & Contributors; Global Network |
  membership: Object.freeze(['identity-access', 'people-contributors', 'global-network']),

  // | Donations | Layer 0; Identity & Access |
  donations: Object.freeze(['identity-access']),

  // | Migration & Provenance | Layer 0; Identity & Access; Taxonomy — and no target content context |
  'migration-provenance': Object.freeze(['identity-access', 'taxonomy']),
});

/**
 * The single permitted same-level edge (DOMAIN_MODEL.md §3.2), recorded
 * separately so tests can assert both its presence and the prohibition of its
 * reverse without re-deriving them from the table above.
 */
export const permittedSameLevelEdges = Object.freeze([
  Object.freeze({ from: 'messaging', to: 'learning' }),
]);

/**
 * The public interface file of a context. Cross-context imports may reach this
 * path and nothing deeper (ARCHITECTURE.md §6.3 rule 4).
 */
export const contextPublicEntry = 'index';

/** Directory under `apps/web/src` that holds the bounded contexts. */
export const contextRoot = 'contexts';

/**
 * Layer 0 packages a bounded context may consume, by workspace package name.
 *
 * DOMAIN_MODEL.md §1.1 and §2 rule 7: infrastructure is consumed through
 * abstractions only. `@minhaj/contracts` is Layer 0 shared contracts and types
 * (ARCHITECTURE.md §6.1) and is therefore reachable from every context.
 *
 * `@minhaj/server-core` is deliberately ABSENT: it is a host, not a layer
 * (ARCHITECTURE.md §3.1), and a context reaching it would invert ownership —
 * services hosted there belong to the contexts, not the other way round.
 */
export const layerZeroPackages = Object.freeze(['@minhaj/contracts']);

/**
 * Packages no bounded context may import directly, with the reason.
 *
 * "No context depends on Prisma, the filesystem, or a search engine directly"
 * (DOMAIN_MODEL.md §2 rule 7). Data access is confined to `packages/database`
 * and reached through an interface (ARCHITECTURE.md §4.1).
 */
export const prohibitedInContextPackages = Object.freeze({
  '@minhaj/database':
    'data access is confined to packages/database and reached through an ' +
    'interface, never imported by a context directly (ARCHITECTURE.md §4.1)',
  '@minhaj/server-core':
    'server-core hosts context-owned services; it is not a layer and a ' +
    'context never depends on it (ARCHITECTURE.md §3.1)',
  '@prisma/client': 'no context depends on Prisma directly (DOMAIN_MODEL.md §2 rule 7)',
  prisma: 'no context depends on Prisma directly (DOMAIN_MODEL.md §2 rule 7)',
});

/**
 * Packages `apps/realtime` may never import (ARCHITECTURE.md §3.1 rule 1,
 * §6.3 rule 8). The app is created in the Messaging phase; the rule is in
 * force from the day the directory appears.
 */
export const realtimeProhibitedPackages = Object.freeze([
  '@minhaj/database',
  '@prisma/client',
  'prisma',
]);

/**
 * ARCHITECTURAL ROLES — what a workspace IS, decided by the approved documents.
 *
 * Review #4 (B3) found the analyser inferring "not a bounded context" to mean
 * "Layer 0", and reporting `layer-zero-upward-dependency` for `apps/web`'s page
 * importing the PUBLIC Quran interface. That is backwards. DOMAIN_MODEL.md §3.3
 * is explicit:
 *
 *   "Pages that span contexts … are composed at **Layer 4**, which may call
 *    many contexts. Composition is an application-layer responsibility and
 *    never a licence for a Layer 2 context to import another."
 *
 * ARCHITECTURE.md §6.1 places the same layer at the TOP of the stack —
 * "Layer 4  Application composition · routes · layouts · pages · admin
 * surfaces · cross-context orchestration" — above every context, not beneath
 * them. Treating it as Layer 0 inverted the diagram and made the approved
 * architecture unimplementable.
 *
 * Absence of a role is NOT a role. A workspace the architecture has not
 * classified is reported as unclassified rather than defaulted into one, so a
 * new workspace cannot acquire either Layer 0's restrictions or Layer 4's
 * privileges by accident.
 */
export const ARCHITECTURAL_ROLES = Object.freeze({
  /** Layer 0 — platform abstractions consumed by every context from beneath. */
  PLATFORM: 'platform',
  /** Layer 4 — application composition: routes, layouts, pages, orchestration. */
  COMPOSITION: 'composition',
  /** The server-only HOST for context-owned services; a host, not a layer. */
  SERVICE_HOST: 'service-host',
  /** The realtime transport process (ARCHITECTURE.md §3.1). */
  REALTIME: 'realtime',
  /** Build tooling: linters, formatters, shared configuration. */
  TOOLING: 'tooling',
});

/**
 * Workspace package name -> architectural role.
 *
 * Every entry cites the document that assigns it. Adding a row is an
 * architecture decision, exactly as adding an allowlist edge is.
 *
 * Only workspaces that EXIST or are named by the approved architecture appear.
 * Nothing here invents a future product package: `apps/realtime` is named by
 * ARCHITECTURE.md §3.1 and created in the Messaging phase, and its rule is in
 * force from the day the directory appears.
 */
export const workspaceRoles = Object.freeze({
  // ARCHITECTURE.md §6.1: "Layer 4  Application composition — routes · layouts
  // · pages · admin surfaces · cross-context orchestration".
  '@minhaj/web': ARCHITECTURAL_ROLES.COMPOSITION,

  // ARCHITECTURE.md §6.1: "shared contracts and types" at Layer 0.
  '@minhaj/contracts': ARCHITECTURAL_ROLES.PLATFORM,

  // ARCHITECTURE.md §6.1: "(`packages/server-core` hosts context-owned
  // services; it is not a layer)".
  '@minhaj/server-core': ARCHITECTURAL_ROLES.SERVICE_HOST,

  // Shared ESLint/Prettier/TypeScript configuration — build tooling.
  '@minhaj/config': ARCHITECTURAL_ROLES.TOOLING,

  // ARCHITECTURE.md §3.1. Created in the Messaging phase; classified now so the
  // rule is in force the day the directory appears rather than the day after.
  '@minhaj/realtime': ARCHITECTURAL_ROLES.REALTIME,
});

/**
 * NO DIRECTORY-TIER ROLE DEFAULTS — Review #5 (B3).
 *
 * This module previously carried:
 *
 *     roleByWorkspaceDirectory = { apps: COMPOSITION, packages: PLATFORM }
 *
 * so an unregistered workspace acquired an architectural role from its PATH.
 * Review #5 created `apps/foo` with an ordinary manifest and it was granted
 * Layer 4 composition — the tier permitted to reach many bounded contexts —
 * having been classified by nobody. `packages/foo` was granted Layer 0 the
 * same way. Creating a directory is not an architecture decision, and a role
 * obtained by `mkdir` is not a role.
 *
 * That fallback existed to let isolated FIXTURE trees exercise the real Layer 4
 * rules. It bought test convenience with production authority, which is the
 * wrong trade in both directions: fixtures now declare their roles explicitly
 * through `fixtureWorkspaceRoles` below, and production classification is
 * exhaustive and fails closed.
 *
 * Directory position may still VALIDATE a role — a COMPOSITION workspace
 * belongs under `apps/` — but it may never GRANT one. An unregistered
 * workspace is reported as `unclassified-workspace-role` and the gate fails,
 * whatever it imports and whether or not it imports anything at all.
 */

/**
 * Where a role is EXPECTED to live, for consistency validation only.
 *
 * This grants nothing. A workspace already classified by `workspaceRoles` that
 * sits somewhere unexpected is a finding worth surfacing; a workspace that is
 * not classified gets no role from appearing in the right directory.
 */
export const expectedDirectoryForRole = Object.freeze({
  [ARCHITECTURAL_ROLES.COMPOSITION]: 'apps',
  [ARCHITECTURAL_ROLES.REALTIME]: 'apps',
  [ARCHITECTURAL_ROLES.PLATFORM]: 'packages',
  [ARCHITECTURAL_ROLES.SERVICE_HOST]: 'packages',
  [ARCHITECTURAL_ROLES.TOOLING]: 'packages',
});

/** Every role name that may be DECLARED by a workspace manifest. */
const DECLARABLE_ROLES = new Set(Object.values(ARCHITECTURAL_ROLES));

/**
 * The architectural role a workspace DECLARES in its own manifest.
 *
 * Read from `minhaj.architecturalRole`. This is how an isolated fixture tree
 * states what its workspaces are, now that a role can no longer be inherited
 * from a directory name (B3). It is deliberately available to production code
 * as well: a workspace declaring its own role is making the classification
 * explicit and reviewable in the one file that already describes the package.
 *
 * It is NOT an escape hatch. `workspaceRoles` — the roster the approved
 * documents fix — always wins, so a package cannot rename itself into Layer 4
 * by editing its own manifest. It only covers workspaces the approved
 * architecture has not classified, which in production is none of them: the
 * production roster is exhaustive, and a workspace outside it fails closed
 * whether or not it declares anything.
 *
 * An UNRECOGNISED value returns `null` rather than passing through, so a typo
 * fails closed as an unclassified workspace instead of quietly meaning nothing.
 */
export function declaredWorkspaceRole(manifest) {
  const declared = manifest?.minhaj?.architecturalRole;
  if (typeof declared !== 'string') return null;
  return DECLARABLE_ROLES.has(declared) ? declared : null;
}
