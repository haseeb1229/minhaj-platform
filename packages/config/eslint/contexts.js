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
/**
 * Third-party PROVIDER SDKs, which a bounded context may never name.
 *
 * The same rule as Prisma, for the same reason and a different resource:
 * infrastructure is consumed through an abstraction (DOMAIN_MODEL.md §2 rule
 * 7), and ARCHITECTURE.md §4.6 puts email behind an `EmailProvider` interface
 * so the first adapter can be replaced without a context noticing.
 *
 * The failure this prevents is specific. A context that imports the mail SDK
 * directly acquires the decision of WHETHER to send, WHAT to say and WHERE to
 * send it, in a place that has no delivery record, no suppression check, no
 * idempotency key and no retry — and it does so while looking like ordinary
 * business code. By the time a second provider is needed, the call sites are
 * spread across contexts that were never supposed to know a provider exists.
 *
 * Kept as its own table so the reason reads correctly for each package rather
 * than being filed under a database rule it has nothing to do with.
 */
export const providerSdkPackages = Object.freeze({
  resend:
    'the email provider SDK — a context sends through the EmailProvider ' +
    'abstraction, never a provider directly (ARCHITECTURE.md §4.6, §4.6.1)',
  'better-auth':
    'the authentication library — Identity reaches its mechanics through the ' +
    'auth port, and the instance itself is private to the adapter that holds ' +
    'the Prisma client (ARCHITECTURE.md §3.1.2, §4.1)',
});

export const prohibitedInContextPackages = Object.freeze({
  '@minhaj/database':
    'data access is confined to packages/database and reached through an ' +
    'interface, never imported by a context directly (ARCHITECTURE.md §4.1)',
  '@minhaj/server-core':
    'server-core hosts context-owned services; it is not a layer and a ' +
    'context never depends on it (ARCHITECTURE.md §3.1)',
  '@minhaj/storage':
    'the storage foundation holds the storage root, the filesystem and the ' +
    'scanner socket. A context receives a storage port from composition and ' +
    'never the implementation, exactly as with the database ' +
    '(DOMAIN_MODEL.md §2 rule 7, ARCHITECTURE.md §6.1)',
  '@minhaj/search':
    'the search foundation holds the index and every owner projection source. ' +
    'A context supplies its own projection to Layer-4 composition and never ' +
    'reaches the search implementation (DOMAIN_MODEL.md §2 rule 7, ARCHITECTURE.md §4.3)',
  '@prisma/client': 'no context depends on Prisma directly (DOMAIN_MODEL.md §2 rule 7)',
  prisma: 'no context depends on Prisma directly (DOMAIN_MODEL.md §2 rule 7)',
  ...providerSdkPackages,
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
 * RAW DATABASE CAPABILITY — the concrete things that ARE the capability.
 *
 * ARCHITECTURE.md §3.1.1 states the distinction the whole persistence model
 * rests on:
 *
 *   "Access to an encapsulated service that internally persists is not
 *    possession of a raw database capability."
 *
 * A caller that invokes a context's public service may CAUSE persistence. It
 * does not thereby HOLD database access, "because it never receives a client, a
 * delegate, a transaction handle or a raw-query facility". This list names the
 * packages that hand out exactly those things, and §3.1.2 enumerates the
 * prohibition: no wrapper, re-export or intermediate package makes possession
 * of one of them permitted.
 *
 * This is deliberately NOT the same list as `prohibitedInContextPackages`.
 * That list is about which WORKSPACES a bounded context may name.  This one is
 * about a CAPABILITY that travels: it is followed transitively through every
 * neutral module, and it stops only at an approved encapsulation boundary
 * (§3.1.1) — a context-owned persistence adapter whose exported surface has
 * been proven narrow.
 *
 * `@minhaj/database` is absent on purpose. The package is where raw capability
 * is CONSTRUCTED and confined (§4.1); the capability itself is the Prisma and
 * MSSQL surface below it, and it is that surface, not the package name, that
 * must not escape.
 */
export const rawDatabaseCapabilityPackages = Object.freeze({
  '@prisma/client':
    'the Prisma client, its generated delegates and its transaction handles',
  '@prisma/adapter-mssql': 'the Prisma driver adapter for Microsoft SQL Server',
  prisma: 'the Prisma toolkit',
  mssql: 'the MSSQL driver — connection pools, requests and transactions',
  tedious: 'the TDS driver beneath the MSSQL client',
});

/**
 * Does this package name hand out raw database capability? Returns the reason
 * or `null`.
 *
 * Matched by package name and by scope, so `@prisma/anything` counts: the
 * generated client is published under that scope and a new member of it is
 * still Prisma.
 */
export function rawDatabaseCapabilityReason(name) {
  const exact = rawDatabaseCapabilityPackages[name];
  if (exact !== undefined) return exact;

  if (name === '@prisma' || name.startsWith('@prisma/')) {
    return 'the Prisma client, its generated delegates and its transaction handles';
  }

  for (const [prohibited, reason] of Object.entries(rawDatabaseCapabilityPackages)) {
    if (name.startsWith(`${prohibited}/`)) return reason;
  }

  return null;
}

/**
 * CONTEXT-OWNED PERSISTENCE ADAPTERS, declared by the workspace that hosts them.
 *
 * ARCHITECTURE.md §4.1 and §6.3 rule 14:
 *
 *   "Context-owned persistence adapters may physically reside inside
 *    `packages/database`. Each persistence adapter has one explicit semantic
 *    owning context. Physical placement transfers no business ownership to
 *    `packages/database`."
 *
 * "Explicit" is the operative word, and it is why ownership is DECLARED rather
 * than inferred. A directory name is chosen by whoever writes the code and
 * carries no authority (this repository has removed inference-by-spelling twice
 * already — Review #4's `next-env.d.ts` basename and Review #6's `dist`
 * directories). So the hosting workspace states, in its own manifest, both
 * where adapters live and which single bounded context owns each one:
 *
 *     "minhaj": {
 *       "persistenceAdapters": {
 *         "root": "src/adapters",
 *         "owners": { "messaging": "messaging" }
 *       }
 *     }
 *
 * `root` is where adapters are permitted to live, relative to the workspace.
 * `owners` maps a directory NAME beneath that root to its ONE semantic owner.
 *
 * TWO KINDS OF OWNER, because the architecture has two kinds of persistent
 * state and only one of them belongs to a bounded context.
 *
 *   1. A BOUNDED CONTEXT, written as its slug:
 *
 *          "owners": { "identity-access": "identity-access" }
 *
 *   2. A LAYER-0 PLATFORM CONCERN, written explicitly:
 *
 *          "owners": { "email": { "kind": "layer0", "concern": "email" } }
 *
 * The second kind exists because DOMAIN_MODEL.md §1.1 is explicit that
 * `email`, `auditing` and `rate limiting` are "platform/infrastructure
 * services exposed through abstractions", NOT bounded contexts — while
 * ARCHITECTURE.md §4.6.1 equally clearly gives the shared email concern
 * "delivery metadata", which is persistent state. Under a context-only
 * vocabulary that state could not be declared at all, and the only way to ship
 * it would have been to file it under whichever context happened to need it
 * first — making Identity & Access the owner of Learning's booking mail and
 * Membership's application mail. That would be false, and unpicking it later
 * would be a migration.
 *
 * This adds NO seventeenth bounded context, NO dependency edge and NO change
 * to the sixteen. It makes an ownership relation the accepted documents
 * already describe expressible to the analyser, and it BUYS LESS than context
 * ownership does: a context-owned adapter may reach its own context's public
 * interface, whereas a Layer-0 adapter may reach NO bounded context at all
 * (enforced in `scripts/architecture/rules.mjs`).
 *
 * The declaration fails closed in every direction: source under `root` that no
 * entry claims is an undeclared adapter and is rejected; an owner slug that is
 * not one of the sixteen bounded contexts is rejected; a `layer0` owner whose
 * concern is not one of the enumerated Layer-0 modules is rejected; and any
 * other shape is rejected rather than guessed at. Declaring the root
 * predeclares no schema and names no future table — it only makes the
 * convention authoritative before the first adapter exists, so an adapter
 * cannot arrive unowned.
 *
 * Returns `null` when the workspace declares nothing, `{ root, owners }`
 * otherwise, where each owner is normalised to `{ kind: 'context', slug }` or
 * `{ kind: 'layer0', concern }`. A malformed declaration returns
 * `{ root, owners, malformed }` so the caller reports it rather than treating
 * it as absent.
 */
export function persistenceAdapterPolicy(manifest) {
  const declared = manifest?.minhaj?.persistenceAdapters;
  if (declared === undefined || declared === null) return null;

  if (typeof declared !== 'object' || Array.isArray(declared)) {
    return { root: null, owners: {}, malformed: 'must be an object' };
  }

  const { root, owners } = declared;

  if (typeof root !== 'string' || root === '') {
    return {
      root: null,
      owners: {},
      malformed: "must declare a string 'root' naming where adapters live",
    };
  }

  if (owners !== undefined && (typeof owners !== 'object' || Array.isArray(owners))) {
    return {
      root,
      owners: {},
      malformed: "'owners' must be an object mapping adapter directory to its owner",
    };
  }

  // An owner this policy cannot read is recorded as `null`, NOT as a malformed
  // declaration.
  //
  // The distinction matters. `malformed` describes the DECLARATION — no root,
  // `owners` not an object — and disables every adapter in the workspace,
  // which is right when the declaration itself cannot be parsed. A single
  // unreadable owner is a different fault: it makes ONE adapter unowned, and
  // the caller reports exactly that against exactly that adapter. Treating it
  // as malformed would take every other adapter's boundary down with it, and
  // an adapter that stops being a recognised boundary stops stopping the
  // capability walk — so one bad entry would turn into raw capability leaking
  // through every OTHER adapter in the package.
  const normalised = {};

  for (const [directory, declared] of Object.entries(owners ?? {})) {
    normalised[directory] = normaliseAdapterOwner(declared);
  }

  return {
    root: root.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, ''),
    owners: Object.freeze(normalised),
    malformed: null,
  };
}

/**
 * Layer-0 concerns that may legitimately OWN persistent state.
 *
 * A strict subset of `layerZeroModules`. `database` is the package this all
 * lives in and cannot own an adapter within itself, and `logging` writes a log
 * rather than rows. Listing only what genuinely owns rows keeps this from
 * becoming a back door into Layer 0 for anything that wants a table.
 *
 * `storage` owns its custody metadata (Phase 7). `search` owns DERIVED rows
 * (Phase 17): a rebuildable projection and the durable indexing intent that
 * keeps it current (ARCHITECTURE.md §8.5). Neither is authoritative for any
 * business fact — the owners are — but both are relational state that must be
 * owned by something, and filing it under whichever context happened to be
 * indexed first would make that context the owner of every other context's
 * search projection.
 */
export const layerZeroPersistentConcerns = Object.freeze([
  'email',
  'rate-limiting',
  'auditing',
  'storage',
  'search',
]);

/**
 * Reads one declared owner into its normalised form, or `null` when the
 * declaration is not one this policy recognises.
 *
 * Fails closed on every unknown shape. An owner nobody can identify is an
 * unowned adapter, which is the state the declaration exists to prevent.
 */
export function normaliseAdapterOwner(declared) {
  if (typeof declared === 'string') {
    return contextSlugs.includes(declared) ? { kind: 'context', slug: declared } : null;
  }

  if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) {
    return null;
  }

  if (declared.kind !== 'layer0') return null;

  return layerZeroPersistentConcerns.includes(declared.concern)
    ? { kind: 'layer0', concern: declared.concern }
    : null;
}

/** A human-readable name for an owner, for analyser messages. */
export function describeAdapterOwner(owner) {
  if (owner === null || owner === undefined) return '(unowned)';
  if (owner.kind === 'context') return owner.slug;
  return `Layer 0 '${owner.concern}'`;
}

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

  // Database is Layer 0 platform infrastructure, not a bounded context.
  '@minhaj/database': ARCHITECTURAL_ROLES.PLATFORM,

  // ARCHITECTURE.md §6.1 names `storage` at Layer 0, beside database, search,
  // email, logging, auditing and rate limiting. It is infrastructure holding
  // untrusted bytes, not a bounded context, and it depends on none.
  '@minhaj/storage': ARCHITECTURAL_ROLES.PLATFORM,

  // ARCHITECTURE.md §4.3 and §6.1 name `search` at Layer 0. It holds a derived,
  // rebuildable projection and the SearchService over it; it is not a bounded
  // context and depends on none — owners are supplied to it by composition.
  '@minhaj/search': ARCHITECTURAL_ROLES.PLATFORM,

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
