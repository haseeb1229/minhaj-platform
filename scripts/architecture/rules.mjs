/**
 * Architecture rules applied to the resolved module graph.
 *
 * The allowlist itself lives in `packages/config/eslint/contexts.js` and is a
 * transcription of DOMAIN_MODEL.md §3.1. Nothing here reinterprets it.
 *
 * The central change over the previous version is TRANSITIVE enforcement.
 * Checking only direct edges let a dependency be laundered through a neutral
 * module:
 *
 *     messaging/foo.ts -> shared/wrapper.ts -> quran/internal.ts
 *
 * Every hop there is individually innocent, yet Messaging has obtained Quran.
 * Reachability closes that: an importing context is judged by every context it
 * can REACH through non-context modules, not merely by what it names directly.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { repoRoot } from '../shared/workspaces.mjs';
import {
  ARCHITECTURAL_ROLES,
  contextAllowlist,
  contextPublicEntry,
  contextRoot,
  contextSlugs,
  layerZeroPackages,
  prohibitedInContextPackages,
  realtimeProhibitedPackages,
  declaredWorkspaceRole,
  expectedDirectoryForRole,
  workspaceRoles,
} from '../../packages/config/eslint/contexts.js';
import { checkClientGraph } from './client-graph.mjs';
import { fileAdjacency, findCycles } from './graph.mjs';

const knownContexts = new Set(contextSlugs);

/**
 * Extensions permitted in production application and package source (B6).
 *
 * `.d.ts` is included because a repository-local declaration file is TypeScript
 * — it is type-checked, and it now participates in the dependency graph (B3).
 * The rule exists to keep UNCHECKED JavaScript out of production source, and a
 * declaration file is the opposite of unchecked.
 */
const PRODUCTION_EXTENSIONS = new Set(['.ts', '.tsx', '.d.ts']);

/**
 * Concrete infrastructure a bounded context may not consume directly.
 *
 * DOMAIN_MODEL.md §2 rule 7, quoted in full: "Infrastructure is consumed
 * through abstractions only. No context depends on Prisma, the filesystem, or a
 * search engine directly."
 *
 * That sentence is the ENTIRE authority for this list, and every entry below
 * maps to one of its three named categories: Prisma and the database drivers
 * that are the same dependency by another name, the filesystem, and search
 * engines.
 *
 * Review #3 (N1) found `child_process`, `net` and `dgram` here as well. No
 * approved document prohibits them — not DOMAIN_MODEL.md, not
 * SECURITY_BASELINE.md, not ARCHITECTURE.md — so they were an undocumented
 * Node built-in blacklist wearing an architecture rule's clothing. They are
 * removed. An architecture checker that enforces unapproved rules is not
 * stricter than the architecture; it is a different architecture, and it
 * teaches the team to distrust the gate.
 *
 * Security linting over Node built-ins may be added later if a security
 * decision justifies it. It would be its own rule, citing its own authority,
 * not a silent expansion of this one.
 *
 * Scoped deliberately to bounded CONTEXTS: the platform packages that IMPLEMENT
 * these abstractions must of course use them.
 */
const CONCRETE_INFRASTRUCTURE = Object.freeze({
  // "the filesystem", named verbatim in the rule.
  'node:fs': 'the filesystem',
  'node:fs/promises': 'the filesystem',
  fs: 'the filesystem',
  'fs/promises': 'the filesystem',

  // Database drivers — the same dependency Prisma names, reached lower down.
  mssql: 'a database driver',
  tedious: 'a database driver',
  ioredis: 'a cache server',
  redis: 'a cache server',

  // "a search engine", named verbatim in the rule.
  '@elastic/elasticsearch': 'a search engine',
  meilisearch: 'a search engine',
});

/** Matches a specifier against the context package prohibition list. */
function prohibitedPackageReason(name) {
  const exact = prohibitedInContextPackages[name];
  if (exact) return exact;

  for (const [prohibited, reason] of Object.entries(prohibitedInContextPackages)) {
    if (name.startsWith(`${prohibited}/`)) return reason;
  }

  if (name === '@prisma' || name.startsWith('@prisma/')) {
    return 'no context depends on Prisma directly (DOMAIN_MODEL.md §2 rule 7)';
  }

  return null;
}

/** Matches a specifier against concrete infrastructure. */
function concreteInfrastructureReason(name) {
  return CONCRETE_INFRASTRUCTURE[name] ?? null;
}

/**
 * Infers the workspace package name from a repository path.
 *
 * A resolved file can sit in a workspace the CURRENT analysis root does not
 * enumerate — a fixture tree importing the real `packages/server-core`, most
 * commonly. Without this, such a target carries no workspace name and the
 * classification rules skip it silently, which is precisely the "unknown
 * workspace treated as harmless" failure mode.
 *
 * Reads the real manifest so the name is the package's own, never guessed from
 * the directory.
 */
function workspaceNameFromPath(relativePath) {
  const segments = relativePath.split('/');
  if (segments.length < 2) return null;
  if (segments[0] !== 'packages' && segments[0] !== 'apps') return null;

  const manifestPath = path.join(
    repoRoot,
    segments[0],
    segments[1] ?? '',
    'package.json',
  );

  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8')).name ?? null;
  } catch {
    return null;
  }
}

/**
 * Which bounded context a repository-relative path belongs to.
 *
 * Returns `{ slug, withinContext }`, `withinContext` being the path beneath the
 * context directory — '' meaning the context's own public entry point.
 */
export function locateContext(relativePath) {
  const marker = `/${contextRoot}/`;
  const index = relativePath.indexOf(marker);
  if (index === -1) return null;

  const remainder = relativePath.slice(index + marker.length);
  const [slug, ...rest] = remainder.split('/');
  if (!slug) return null;

  return { slug, withinContext: rest.join('/') };
}

/**
 * Extensions a context's public entry point may carry.
 *
 * `.d.ts` belongs here for the same reason declaration files now enter the
 * graph at all (B3): a context whose public interface is expressed as
 * declarations has a public interface. Omitting it would report every
 * legitimate type-only dependency as an internals breach — a rule that
 * rejects correct code is not a strict rule, it is a wrong one.
 */
const PUBLIC_ENTRY_EXTENSIONS = ['', '.ts', '.tsx', '.d.ts'];

/** Is this path a context's PUBLIC entry point rather than its internals? */
function isPublicEntry(withinContext) {
  if (withinContext === '') return true;

  return PUBLIC_ENTRY_EXTENSIONS.some(
    (extension) => withinContext === `${contextPublicEntry}${extension}`,
  );
}

/**
 * The workspace a resolved graph node belongs to.
 *
 * Prefers the workspace recorded on the node during discovery, and falls back
 * to reading the owning manifest by path — a resolved file can sit in a
 * workspace the CURRENT analysis root does not enumerate, and a target with no
 * workspace name would otherwise escape every classification rule.
 */
function workspaceOfNode(node) {
  return node.workspace?.name ?? workspaceNameFromPath(node.relative);
}

/**
 * Everything a file can REACH through repository-local modules, transitively.
 *
 * This is the single traversal behind B5, and it is the correction Review #3
 * demanded. The previous walker stopped at context boundaries only, and never
 * looked at what a WORKSPACE it passed through went on to import. Both of
 * these were therefore accepted:
 *
 *     messaging/foo.ts -> @minhaj/contracts -> @minhaj/database
 *     apps/realtime/x  -> @minhaj/contracts -> @minhaj/database
 *
 * Every hop is individually legal. A legal Layer 0 package had become a tunnel
 * to concrete infrastructure, which is exactly what DOMAIN_MODEL.md §2 rule 7
 * and ARCHITECTURE.md §4.1 exist to prevent.
 *
 * The walk is transparent through NEUTRAL modules — shared helpers, barrels,
 * wrappers, and Layer 0 workspace packages — because that is what they are at
 * runtime. It stops at a bounded CONTEXT boundary, because a context's own
 * internal dependencies are its own business and attributing them to a caller
 * would report the wrong owner.
 *
 * Returns:
 *   - `packages`   external packages reached, each with the path that reached it
 *   - `workspaces` repository workspaces reached, each with the path
 *   - `contexts`   bounded contexts reached, keyed by slug
 */
function reachFrom(startFile, graph, adjacency, { ownWorkspace = null } = {}) {
  const packages = [];
  const workspaces = new Map();
  const contexts = new Map();

  const visited = new Set([startFile]);
  const queue = [{ file: startFile, trail: [startFile] }];

  while (queue.length > 0) {
    const { file, trail } = queue.shift();
    const node = graph.nodes.get(file);
    if (node === undefined) continue;

    // External packages named by this hop.
    for (const entry of node.imports) {
      if (entry.resolved.kind !== 'external') continue;

      packages.push({
        packageName: entry.resolved.packageName,
        specifier: entry.specifier,
        line: entry.line,
        trail,
        direct: trail.length === 1,
      });
    }

    for (const { to } of adjacency.get(file) ?? []) {
      const target = graph.nodes.get(to);
      if (target === undefined) continue;

      const nextTrail = [...trail, to];

      // A repository WORKSPACE reached along the way. Recorded whether or not
      // the walk continues through it, so `@minhaj/database` is seen even when
      // it is reached at the end of a chain of innocent packages.
      const targetWorkspace = workspaceOfNode(target);
      if (
        targetWorkspace !== null &&
        targetWorkspace !== ownWorkspace &&
        !workspaces.has(targetWorkspace)
      ) {
        workspaces.set(targetWorkspace, {
          workspace: targetWorkspace,
          relative: target.relative,
          trail: nextTrail,
          direct: nextTrail.length === 2,
        });
      }

      const targetContext = locateContext(target.relative);

      if (targetContext !== null) {
        if (!contexts.has(targetContext.slug)) {
          contexts.set(targetContext.slug, {
            slug: targetContext.slug,
            withinContext: targetContext.withinContext,
            trail: nextTrail,
            direct: nextTrail.length === 2,
          });
        }
        // Stop: a context's internals are its own business.
        continue;
      }

      if (visited.has(to)) continue;
      visited.add(to);
      queue.push({ file: to, trail: nextTrail });
    }
  }

  return { packages, workspaces, contexts };
}

/** Formats a trail of canonical paths as a readable dependency chain. */
function formatTrail(trail, graph) {
  return trail
    .map((entry) => graph.nodes.get(entry)?.relative ?? entry)
    .join('\n       -> ');
}

/** Checks one context file against the allowlist, directly and transitively. */
function checkContextFile(node, context, graph, adjacency, violations) {
  const permitted = contextAllowlist[context.slug] ?? [];

  // ---- Direct package dependencies -------------------------------------
  for (const entry of node.imports) {
    const { resolved } = entry;
    if (resolved.kind !== 'external') continue;

    const prohibited = prohibitedPackageReason(resolved.packageName);
    if (prohibited !== null) {
      violations.push({
        rule: 'context-prohibited-package',
        file: node.relative,
        specifier: entry.specifier,
        line: entry.line,
        message: `'${context.slug}' must not import '${resolved.packageName}': ${prohibited}.`,
      });
      continue;
    }

    const infrastructure = concreteInfrastructureReason(resolved.packageName);
    if (infrastructure !== null) {
      violations.push({
        rule: 'context-concrete-infrastructure',
        file: node.relative,
        specifier: entry.specifier,
        line: entry.line,
        message:
          `'${context.slug}' must not consume ${infrastructure} directly via ` +
          `'${resolved.packageName}'. Infrastructure is consumed through ` +
          `abstractions only (DOMAIN_MODEL.md §2 rule 7, ARCHITECTURE.md §4).`,
      });
    }
  }

  const reach = reachFrom(node.absolute, graph, adjacency, {
    ownWorkspace: node.workspace?.name ?? null,
  });

  // ---- Prohibited packages reached THROUGH a neutral wrapper ------------
  for (const reached of reach.packages) {
    if (reached.direct) continue; // Direct — already reported above.

    const prohibited = prohibitedPackageReason(reached.packageName);
    const infrastructure = concreteInfrastructureReason(reached.packageName);
    if (prohibited === null && infrastructure === null) continue;

    violations.push({
      rule: 'context-laundered-package',
      file: node.relative,
      specifier: reached.specifier,
      message:
        `'${context.slug}' reaches '${reached.packageName}' through an ` +
        `intermediate module. Routing a prohibited dependency through a ` +
        `neutral wrapper does not make it permitted.\n    path: ` +
        `${formatTrail(reached.trail, graph)}\n       -> ${reached.specifier}`,
    });
  }

  // ---- Prohibited WORKSPACES reached transitively (B5) ------------------
  //
  // Review #3 accepted `messaging -> @minhaj/contracts -> @minhaj/database`
  // because only the FIRST hop was classified, and it was legal. A Layer 0
  // package that can be traversed to reach concrete infrastructure IS a tunnel
  // to that infrastructure, and the context has obtained exactly what
  // DOMAIN_MODEL.md §2 rule 7 forbids it from having.
  for (const reached of reach.workspaces.values()) {
    if (reached.direct) continue; // Direct — reported by workspace usage below.

    const prohibited = prohibitedPackageReason(reached.workspace);
    if (prohibited === null) continue;

    violations.push({
      rule: 'context-laundered-workspace',
      file: node.relative,
      specifier: reached.relative,
      message:
        `'${context.slug}' reaches workspace '${reached.workspace}' through ` +
        `an intermediate package: ${prohibited}. A legal Layer 0 dependency ` +
        `does not become a tunnel to prohibited infrastructure merely because ` +
        `the first hop is approved.\n    path: ${formatTrail(reached.trail, graph)}`,
    });
  }

  // ---- Context dependencies, direct and transitive ----------------------
  for (const reached of reach.contexts.values()) {
    if (reached.slug === context.slug) continue;

    if (!knownContexts.has(reached.slug)) {
      violations.push({
        rule: 'unknown-context',
        file: node.relative,
        specifier: reached.slug,
        message:
          `'${reached.slug}' is not one of the 16 bounded contexts ` +
          `(DOMAIN_MODEL.md §1). A context is created by architecture ` +
          `decision, not by creating a directory.`,
      });
      continue;
    }

    if (!permitted.includes(reached.slug)) {
      const laundered = !reached.direct;

      violations.push({
        rule: laundered ? 'laundered-context-dependency' : 'forbidden-context-dependency',
        file: node.relative,
        specifier: graph.nodes.get(reached.trail[1])?.relative ?? reached.slug,
        message:
          `'${context.slug}' may not depend on '${reached.slug}'. The ` +
          `allowlist (DOMAIN_MODEL.md §3.1) permits only: ` +
          `${permitted.length > 0 ? permitted.join(', ') : 'Layer 0 only'}. ` +
          `An edge that is not listed does not exist.` +
          (laundered
            ? `\n    Reached through an intermediate module — laundering a ` +
              `dependency through a neutral wrapper does not legalise it.` +
              `\n    path: ${formatTrail(reached.trail, graph)}`
            : ''),
      });
      continue;
    }

    // Permitted edge — but interface-only (ARCHITECTURE.md §6.3 rule 4).
    if (!isPublicEntry(reached.withinContext)) {
      violations.push({
        rule: 'context-internal-import',
        file: node.relative,
        specifier: graph.nodes.get(reached.trail.at(-1))?.relative ?? reached.slug,
        message:
          `'${context.slug}' may depend on '${reached.slug}', but only ` +
          `through its public interface. Reaching ` +
          `'${reached.withinContext}' inside '${reached.slug}' is prohibited ` +
          `(ARCHITECTURE.md §6.3 rule 4).` +
          (reached.direct ? '' : `\n    path: ${formatTrail(reached.trail, graph)}`),
      });
    }
  }
}

/**
 * The ARCHITECTURAL ROLE of the workspace a file belongs to.
 *
 * Review #4 (B3): the analyser had no role model at all. It inferred
 * "not inside `contexts/`" to mean "Layer 0", so `apps/web/src/app/page.ts`
 * importing the PUBLIC Quran interface was reported as
 * `layer-zero-upward-dependency`. DOMAIN_MODEL.md §3.3 and ARCHITECTURE.md §6.1
 * put that file at Layer 4, ABOVE every context, where composing many contexts
 * is precisely its job. The rule was enforcing the inverse of the approved
 * architecture.
 *
 * Review #5 (B3) then broke the fix. The role model was real, but it kept a
 * DIRECTORY-TIER fallback — unknown `apps/*` became COMPOSITION, unknown
 * `packages/*` became PLATFORM — so an unregistered workspace acquired Layer 4
 * privilege by existing at the right path. `mkdir apps/foo` was an architecture
 * decision. That fallback is gone.
 *
 * Classification is now EXPLICIT and exhaustive, in exactly two forms:
 *
 *   1. `workspaceRoles` — the roster the approved documents fix, by package
 *      name. Authoritative, and never overridden.
 *   2. `minhaj.architecturalRole` in the workspace's own manifest, for
 *      workspaces that roster does not name. This is how an isolated fixture
 *      tree states what its workspaces are without a test-only privilege tier.
 *
 * Anything else is `null` — genuinely unclassified, reported, never defaulted.
 * A workspace does not become safe by importing nothing.
 */
function roleOfWorkspace(workspaceName, relativePath, manifest = null) {
  const declared = workspaceRoles[workspaceName];
  if (declared !== undefined) return declared;

  // `apps/realtime` is identified by POSITION as well as by name, because
  // ARCHITECTURE.md §3.1 names the DIRECTORY rather than a package, and the app
  // does not exist yet (§1.2). This is not a tier default: it recognises one
  // specific architected path, and it grants the realtime role — the most
  // RESTRICTED role there is, forbidden all database access — never a
  // privileged one. A workspace cannot gain anything by landing here.
  const segments = relativePath.split('/');
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index] === 'apps' && segments[index + 1] === 'realtime') {
      return ARCHITECTURAL_ROLES.REALTIME;
    }
  }

  // The workspace's own explicit declaration. Checked LAST so it can never
  // override the approved roster above.
  return declaredWorkspaceRole(manifest);
}

/** The architectural role governing one graph node. */
function roleOfNode(node) {
  return roleOfWorkspace(
    workspaceOfNode(node),
    node.relative,
    node.workspace?.manifest ?? null,
  );
}

/**
 * Layer 4 composition — routes, layouts, pages, cross-context orchestration.
 *
 * DOMAIN_MODEL.md §3.3: composition "may call many contexts", and
 * ARCHITECTURE.md §6.1 places Layer 4 above every context. So a page reaching
 * Quran AND Hadith AND Editorial is not a finding; it is the layer doing its
 * job, and the context-to-context DAG is not involved. A page importing Quran
 * creates no `messaging -> quran` edge, because a page is not Messaging.
 *
 * What Layer 4 does NOT receive is unlimited access. Two limits survive:
 *
 *   1. INTERFACE ONLY. ARCHITECTURE.md §6.3 rule 4 — "Interface-only
 *      cross-context imports, never `contexts/library/internal/...`" — is
 *      addressed to every consumer, not only to contexts. Composition permits
 *      many contexts' PUBLIC interfaces; it does not permit their internals.
 *
 *   2. INFRASTRUCTURE. The prohibitions of DOMAIN_MODEL.md §2 rule 7 are not
 *      suspended by being called from a page.
 */
function checkCompositionFile(node, graph, adjacency, violations) {
  const workspaceName = workspaceOfNode(node);

  const reach = reachFrom(node.absolute, graph, adjacency, {
    ownWorkspace: workspaceName,
  });

  for (const reached of reach.contexts.values()) {
    if (!knownContexts.has(reached.slug)) {
      violations.push({
        rule: 'unknown-context',
        file: node.relative,
        specifier: reached.slug,
        message:
          `'${reached.slug}' is not one of the 16 bounded contexts ` +
          `(DOMAIN_MODEL.md §1). Layer 4 may compose many contexts, but only ` +
          `contexts the approved model contains.`,
      });
      continue;
    }

    // Composition may reach any context — but through its front door.
    if (isPublicEntry(reached.withinContext)) continue;

    violations.push({
      rule: 'composition-internal-import',
      file: node.relative,
      specifier: graph.nodes.get(reached.trail.at(-1))?.relative ?? reached.slug,
      message:
        `Layer 4 composition may compose many contexts, but only through ` +
        `their public interfaces. Reaching '${reached.withinContext}' inside ` +
        `'${reached.slug}' is prohibited (ARCHITECTURE.md §6.3 rule 4). ` +
        `Composition permits many contexts' PUBLIC interfaces, never their ` +
        `internals.` +
        (reached.direct
          ? ''
          : `
    path: ${formatTrail(reached.trail, graph)}`),
    });
  }

  // Infrastructure prohibitions are not suspended at Layer 4.
  for (const entry of node.imports) {
    if (entry.resolved.kind !== 'external') continue;

    const infrastructure = concreteInfrastructureReason(entry.resolved.packageName);
    if (infrastructure === null) continue;

    violations.push({
      rule: 'composition-concrete-infrastructure',
      file: node.relative,
      specifier: entry.specifier,
      line: entry.line,
      message:
        `Layer 4 composition must not consume ${infrastructure} directly via ` +
        `'${entry.resolved.packageName}'. Infrastructure is consumed through ` +
        `abstractions only (DOMAIN_MODEL.md §2 rule 7).`,
    });
  }
}

/**
 * A foundation/shared package must not depend upward into a feature or content
 * context.
 *
 * Layer 0 exists beneath every context (ARCHITECTURE.md §6.1). A Layer 0
 * package reaching a context would invert the layering and, worse, would turn
 * that package into a laundering route for every context that consumes it.
 */
function checkLayerZeroFile(node, graph, adjacency, violations) {
  const workspaceName = node.workspace?.name ?? workspaceNameFromPath(node.relative);

  const reach = reachFrom(node.absolute, graph, adjacency, {
    ownWorkspace: workspaceName,
  });

  // ---- Upward: a shared package must not reach a bounded context ---------
  for (const reached of reach.contexts.values()) {
    violations.push({
      rule: 'layer-zero-upward-dependency',
      file: node.relative,
      specifier: graph.nodes.get(reached.trail[1])?.relative ?? reached.slug,
      message:
        `'${workspaceName ?? node.relative}' is a Layer 0 shared ` +
        `package and must not depend upward on the '${reached.slug}' context ` +
        `(ARCHITECTURE.md §6.1). Doing so inverts the layering and turns this ` +
        `package into a route around the context allowlist.` +
        `\n    path: ${formatTrail(reached.trail, graph)}`,
    });
  }

  // ---- Downward: a Layer 0 package must not become an infrastructure ----
  //      tunnel (B5).
  //
  // This is the other half of the laundering defence. `@minhaj/contracts` is
  // reachable from every bounded context by design; if it may in turn reach
  // `@minhaj/database`, then every context has the database, and the rule
  // confining data access to `packages/database` behind an interface
  // (ARCHITECTURE.md §4.1) has been dissolved by composition rather than by
  // decision.
  //
  // The rule applies only to packages the architecture actually declares as
  // Layer 0 consumables. The packages that IMPLEMENT infrastructure must of
  // course use it, and `packages/database` reaching a driver is its job.
  if (workspaceName === null || !layerZeroPackages.includes(workspaceName)) return;

  for (const reached of reach.workspaces.values()) {
    const prohibited = prohibitedPackageReason(reached.workspace);
    if (prohibited === null) continue;

    violations.push({
      rule: 'layer-zero-infrastructure-tunnel',
      file: node.relative,
      specifier: reached.relative,
      message:
        `'${workspaceName}' is a Layer 0 package every bounded context may ` +
        `consume, so it must not depend on '${reached.workspace}': ` +
        `${prohibited}. Were it permitted, every context would obtain that ` +
        `dependency transitively and DOMAIN_MODEL.md §2 rule 7 would hold ` +
        `only for direct imports.` +
        `\n    path: ${formatTrail(reached.trail, graph)}`,
    });
  }

  for (const reached of reach.packages) {
    const infrastructure = concreteInfrastructureReason(reached.packageName);
    if (infrastructure === null) continue;

    violations.push({
      rule: 'layer-zero-infrastructure-tunnel',
      file: node.relative,
      specifier: reached.specifier,
      message:
        `'${workspaceName}' is a Layer 0 package every bounded context may ` +
        `consume, so it must not consume ${infrastructure} via ` +
        `'${reached.packageName}'. Every context would obtain it transitively ` +
        `(DOMAIN_MODEL.md §2 rule 7, ARCHITECTURE.md §4.1).` +
        `\n    path: ${formatTrail(reached.trail, graph)}\n       -> ${reached.specifier}`,
    });
  }
}

/**
 * `packages/server-core` — the server-only HOST for context-owned services.
 *
 * ARCHITECTURE.md §6.1: "(`packages/server-core` hosts context-owned services;
 * it is not a layer)". Hosting a context's service means depending on it, so
 * the Layer-0 upward prohibition would be wrong here — but the host must not
 * become an infrastructure tunnel for the contexts it hosts, and a context
 * reaching BACK into it stays prohibited (that half is enforced by
 * `prohibitedInContextPackages`).
 */
/**
 * NON-BLOCKING NOTE — service-host infrastructure (Review #5, N2).
 *
 * Review #5 observed that this rule checks prohibited WORKSPACES but never
 * inspects concrete infrastructure PACKAGES (`node:fs`, a database driver, a
 * search client) the way `checkContextFile` does for bounded contexts.
 *
 * That asymmetry is deliberate, and the approved documents are the reason.
 * DOMAIN_MODEL.md §2 rule 7 — "No context depends on Prisma, the filesystem,
 * or a search engine directly" — is addressed to CONTEXTS. ARCHITECTURE.md
 * §4.1 draws the sanctioned data path in the opposite direction:
 *
 *     Next.js / Node.js  ->  server-core  ->  Prisma ORM  ->  SQL Server 2022
 *
 * So `server-core` reaching data access is the ARCHITECTED route, not a
 * breach. Adding a prohibition here would enforce a rule no approved document
 * states — precisely the undocumented Node built-in blacklist that Review #3
 * (N1) removed from `CONCRETE_INFRASTRUCTURE` above, reintroduced one layer up.
 *
 * What DOES apply is enforced: the prohibited-workspace walk below is
 * transitive and exempts no intermediate package, and the client-bundle
 * prohibition (§6.3 rule 9) is proven by real Next builds in
 * `npm run check:server-only`.
 *
 * When hosted services and infrastructure ADAPTERS actually appear — the phase
 * that creates `packages/database` and the first `server-core` service — the
 * question to answer then is which infrastructure a HOST may touch directly
 * versus through an adapter. That is a design decision for that phase, taken
 * against a document, not a Phase 0B gate invented here.
 */
function checkServiceHostFile(node, graph, adjacency, violations) {
  const workspaceName = workspaceOfNode(node);

  const reach = reachFrom(node.absolute, graph, adjacency, {
    ownWorkspace: workspaceName,
  });

  for (const reached of reach.workspaces.values()) {
    const prohibited = prohibitedPackageReason(reached.workspace);
    if (prohibited === null) continue;
    if (reached.workspace === workspaceName) continue;

    violations.push({
      rule: 'service-host-prohibited-workspace',
      file: node.relative,
      specifier: reached.relative,
      message:
        `'${workspaceName}' hosts context-owned services and must not depend ` +
        `on '${reached.workspace}': ${prohibited}` +
        `
    path: ${formatTrail(reached.trail, graph)}`,
    });
  }
}

/** Is this name one `apps/realtime` may never reach? */
function realtimeProhibited(name) {
  return (
    realtimeProhibitedPackages.some(
      (prohibited) => name === prohibited || name.startsWith(`${prohibited}/`),
    ) || name.startsWith('@prisma/')
  );
}

/**
 * `apps/realtime` never reaches the database — TRANSITIVELY.
 *
 * ARCHITECTURE.md §3.1 rule 1 is unusually absolute: "`apps/realtime` never
 * imports `packages/database`, Prisma, or any table access. Enforced by lint;
 * the build fails." §1 states the same on the topology diagram: NO db access.
 *
 * Review #3 accepted `apps/realtime -> @minhaj/contracts -> @minhaj/database`
 * because only direct imports were examined. That is precisely the failure the
 * rule exists to prevent: the realtime process becoming a second business
 * backend with its own data access and its own divergent authorisation
 * (ARCHITECTURE.md §3).
 *
 * Reaching `@minhaj/server-core` remains legitimate — that is the ARCHITECTED
 * route (§3.1) — provided server-core does not itself expose raw database
 * access. That condition is enforced on every path, because this walk exempts
 * no intermediate package.
 *
 * `apps/realtime` is NOT created in Phase 0B (ARCHITECTURE.md §1.2). The rule is
 * in force from the day the directory appears, and is proven now against
 * isolated fixtures.
 */
function checkRealtimeFile(node, graph, adjacency, violations) {
  // ---- Direct imports ---------------------------------------------------
  for (const entry of node.imports) {
    const name =
      entry.resolved.kind === 'external' ? entry.resolved.packageName : entry.specifier;

    if (!realtimeProhibited(name)) continue;

    violations.push({
      rule: 'realtime-database-access',
      file: node.relative,
      specifier: entry.specifier,
      line: entry.line,
      message:
        `'apps/realtime' never accesses the database. It calls ` +
        `context-owned services hosted in '@minhaj/server-core' ` +
        `(ARCHITECTURE.md §3.1 rule 1).`,
    });
  }

  // ---- Reached through ANY chain of local modules (B5) -------------------
  const reach = reachFrom(node.absolute, graph, adjacency, {
    ownWorkspace: node.workspace?.name ?? null,
  });

  for (const reached of reach.workspaces.values()) {
    if (reached.direct) continue; // Direct — reported above.
    if (!realtimeProhibited(reached.workspace)) continue;

    violations.push({
      rule: 'realtime-laundered-database-access',
      file: node.relative,
      specifier: reached.relative,
      message:
        `'apps/realtime' reaches '${reached.workspace}' through an ` +
        `intermediate package. The prohibition is absolute — "never imports ` +
        `packages/database, Prisma, or any table access" (ARCHITECTURE.md ` +
        `§3.1 rule 1) — and a wrapper chain does not satisfy it. Call a ` +
        `context-owned service hosted in '@minhaj/server-core' instead.` +
        `\n    path: ${formatTrail(reached.trail, graph)}`,
    });
  }

  for (const reached of reach.packages) {
    if (reached.direct) continue;
    if (!realtimeProhibited(reached.packageName)) continue;

    violations.push({
      rule: 'realtime-laundered-database-access',
      file: node.relative,
      specifier: reached.specifier,
      message:
        `'apps/realtime' reaches '${reached.packageName}' through an ` +
        `intermediate module (ARCHITECTURE.md §3.1 rule 1).` +
        `\n    path: ${formatTrail(reached.trail, graph)}\n       -> ${reached.specifier}`,
    });
  }
}

/**
 * Workspace packages a bounded context may consume.
 *
 * Anything not on the Layer 0 roster and not otherwise classified is reported
 * rather than silently permitted, so a NEW workspace cannot enter the graph
 * unclassified.
 */
function checkContextWorkspaceUsage(node, context, graph, violations) {
  for (const entry of node.imports) {
    if (entry.resolved.kind !== 'file') continue;

    const target = graph.nodes.get(entry.resolved.absolute) ?? {
      relative: entry.resolved.relative,
      workspace: null,
    };

    const targetWorkspace =
      target.workspace?.name ?? workspaceNameFromPath(target.relative);
    if (targetWorkspace === null) continue;
    if (targetWorkspace === node.workspace?.name) continue;
    if (locateContext(target.relative) !== null) continue;

    // Classification is by the RESOLVED WORKSPACE, never by the specifier
    // text. `import '@minhaj/database'` and a relative climb into
    // `packages/database/src/index.ts` are the same dependency, and the second
    // form must not evade the rule the first one triggers.
    const prohibited = prohibitedPackageReason(targetWorkspace);
    if (prohibited !== null) {
      violations.push({
        rule: 'context-prohibited-package',
        file: node.relative,
        specifier: entry.specifier,
        line: entry.line,
        message:
          `'${context.slug}' must not import '${targetWorkspace}': ${prohibited}. ` +
          `Reaching it by relative path rather than by package name does not ` +
          `change what it is.`,
      });
      continue;
    }

    if (!layerZeroPackages.includes(targetWorkspace)) {
      violations.push({
        rule: 'context-unclassified-workspace',
        file: node.relative,
        specifier: entry.specifier,
        line: entry.line,
        message:
          `'${context.slug}' imports workspace '${targetWorkspace}', which the ` +
          `approved architecture does not classify as a Layer 0 package. A new ` +
          `workspace must be classified by architecture decision before a ` +
          `context may consume it (DOMAIN_MODEL.md §1.1).`,
      });
    }
  }
}

/** Applies every rule to the graph. */
export function checkGraph(graph) {
  const violations = [];
  const adjacency = fileAdjacency(graph);

  // Workspaces that DECLARE a TypeScript project. A workspace with none is a
  // different finding from a file its project fails to include, and the two
  // must not be conflated — see `source-outside-typescript-project` below.
  const workspacesWithProjects = new Set(
    (graph.projects ?? []).map((project) => project.workspace?.name ?? null),
  );

  // ---- Every workspace needs an EXPLICIT architectural role (B3) --------
  //
  // Reported against the WORKSPACE, once, before any file is judged. Review #5
  // showed why this cannot be a per-file rule alone: an unregistered workspace
  // whose sources all sit inside `contexts/` never reached the role branch, and
  // one containing no source at all was never considered — so a workspace
  // became "safe" by importing nothing, or by being empty. A workspace is
  // classified or it is not; what it happens to contain is a separate question.
  for (const workspace of graph.workspaces ?? []) {
    const relative = path
      .relative(repoRoot, workspace.directory)
      .split(path.sep)
      .join('/');

    const role = roleOfWorkspace(workspace.name, `${relative}/`, workspace.manifest);

    if (role === null) {
      violations.push({
        rule: 'unclassified-workspace-role',
        file: relative,
        specifier: '(workspace role)',
        message:
          `Workspace '${workspace.name}' has no architectural role. A workspace ` +
          `is classified by architecture decision — Layer 0 platform, Layer 4 ` +
          `composition, service host, realtime, or tooling — before any of its ` +
          `source is judged, and a directory name grants nothing: creating ` +
          `'apps/<name>' is not a decision to place a workspace at Layer 4 ` +
          `(Review #5 B3). Classify it in one of the two ways that exist: add ` +
          `it to 'workspaceRoles' in packages/config/eslint/contexts.js citing ` +
          `the document that assigns the role, or — for a workspace that ` +
          `roster does not name — declare 'minhaj.architecturalRole' in the ` +
          `workspace's own package.json. An unclassified workspace fails ` +
          `whether or not it currently imports anything.`,
      });
      continue;
    }

    // Position may VALIDATE a role; it never grants one. A classified
    // workspace sitting somewhere unexpected is worth surfacing, because one
    // of the two — the role or the location — is wrong.
    const expected = expectedDirectoryForRole[role];
    const segments = relative.split('/');
    const tier = segments.at(-2) ?? '';

    if (expected !== undefined && tier !== '' && tier !== expected) {
      violations.push({
        rule: 'workspace-role-location-mismatch',
        file: relative,
        specifier: '(workspace role)',
        message:
          `Workspace '${workspace.name}' is classified '${role}', which belongs ` +
          `under '${expected}/', but it sits under '${tier}/'. The location does ` +
          `not change the role — classification is explicit — but one of the two ` +
          `is wrong and should be corrected rather than left to confuse a reader.`,
      });
    }
  }

  // ---- Workspaces that were matched but could not be understood (N6) ----
  //
  // A directory matching a root workspace glob whose manifest is malformed,
  // unreadable or nameless previously VANISHED from discovery. Silence is the
  // worst outcome available: the workspace is neither enforced nor reported.
  for (const problem of graph.workspaceProblems ?? []) {
    violations.push({
      rule: 'unreadable-workspace-manifest',
      file: path.relative(repoRoot, problem.directory).split(path.sep).join('/'),
      specifier: '(package.json)',
      message: problem.message,
    });
  }

  // ---- Project configurations that could not be parsed (B1) -------------
  //
  // The project index is the authority on how every file resolves. A project
  // config that cannot be read means the analyser cannot reproduce the build
  // for the SOURCES that project compiles — so the diagnostic is raised against
  // those sources. Reporting only against the tsconfig would leave a reader
  // unable to see which code went unverified, and unverified code that reports
  // nothing is the shape of every bypass this remediation closed.
  const projectProblems = graph.projectProblems ?? [];

  for (const problem of projectProblems) {
    const affected = [...graph.nodes.values()].filter(
      (node) =>
        node.projectUnreadable === true &&
        workspaceOfNode(node) === problem.workspaceName,
    );

    const configLabel =
      problem.configPath === undefined || problem.configPath === null
        ? '(tsconfig)'
        : path.relative(repoRoot, problem.configPath).split(path.sep).join('/');

    // No source affected — still report, against the configuration itself.
    if (affected.length === 0) {
      violations.push({
        rule: 'unreadable-tsconfig',
        file: configLabel,
        specifier: '(project configuration)',
        message: problem.message,
      });
      continue;
    }

    for (const node of affected) {
      violations.push({
        rule: 'unreadable-tsconfig',
        file: node.relative,
        specifier: configLabel,
        message:
          `${problem.message} Module resolution for this file cannot be ` +
          `reproduced, so its imports cannot be validated. An unverifiable ` +
          `file is not a passing file.`,
      });
    }
  }

  for (const node of graph.nodes.values()) {
    // ---- A specifier whose governing tsconfig could not be read ---------
    //
    // Resolution is driven by each workspace's EFFECTIVE TypeScript config
    // (B2). If that config cannot be parsed, the analyser would resolve
    // differently from the build — so it reports rather than guessing.
    for (const entry of node.imports) {
      if (entry.resolved.kind !== 'error') continue;

      violations.push({
        rule: 'unreadable-tsconfig',
        file: node.relative,
        specifier: entry.specifier,
        line: entry.line,
        message:
          `${entry.resolved.message} Module resolution for this file cannot be ` +
          `reproduced, so its imports cannot be validated. An unverifiable ` +
          `file is not a passing file.`,
      });
    }

    // ---- Two projects, two different resolutions (§6) -------------------
    //
    // A repository-local file can appear in more than one TypeScript Program.
    // That is usually harmless — the same file compiled twice with the same
    // resolution options means the same thing both times. It is NOT harmless
    // when the projects would resolve its imports differently: the file's
    // dependencies then genuinely differ by which build is running, and any
    // single answer the analyser picks is wrong for one of them.
    //
    // Ownership is deterministic where it can be (a referenced child project
    // wins; a declared root input beats a closure-only claim), and where it
    // genuinely cannot be, the gate fails closed rather than choosing the
    // convenient config — which is how every bypass in this remediation
    // began.
    if (node.ambiguousOwnership !== null && node.ambiguousOwnership !== undefined) {
      const configs = [...node.ambiguousOwnership]
        .map((configPath) =>
          path.relative(repoRoot, configPath).split(path.sep).join('/'),
        )
        .sort();

      violations.push({
        rule: 'ambiguous-typescript-project-ownership',
        file: node.relative,
        specifier: '(project ownership)',
        message:
          `This file is compiled by ${configs.length} independent TypeScript ` +
          `projects with materially different module-resolution options: ` +
          `${configs.join(', ')}. Its imports therefore resolve to different ` +
          `files depending on which project is building, so no single ` +
          `architectural answer is correct. Give the file one owning project — ` +
          `a project reference, or a shared base config — rather than leaving ` +
          `the analyser to pick.`,
      });
    }

    // ---- A specifier that resolves to nothing ---------------------------
    //
    // Reported only for RELATIVE paths and for specifiers naming a KNOWN
    // workspace — never for a bare third-party package, which legitimately
    // resolves nowhere in a tree with no `node_modules`.
    //
    // This became load-bearing when Round 5 removed the forced server-condition
    // retry (N1). That retry used to manufacture a resolution the project could
    // not produce; with it gone, the analyser resolves exactly what the project
    // resolves — and where the project resolves nothing, that is a real broken
    // import which `tsc -p` reports as TS2307. Staying silent about it would
    // trade one disagreement with the build for another.
    for (const entry of node.imports) {
      if (entry.resolved.kind !== 'unresolved') continue;

      const viaWorkspace = entry.resolved.viaWorkspace ?? null;

      violations.push({
        rule: 'unresolved-import',
        file: node.relative,
        specifier: entry.specifier,
        line: entry.line,
        message:
          (viaWorkspace === null
            ? `'${entry.specifier}' resolves to no file. `
            : `'${entry.specifier}' names workspace '${viaWorkspace}' but ` +
              `resolves to no file within it. `) +
          `The analyser resolves with the effective options of the TypeScript ` +
          `project that compiles this file, so a specifier it cannot resolve is ` +
          `one 'tsc -p' reports as TS2307 — a broken import, not a third-party ` +
          `package. An import whose target cannot be identified cannot be ` +
          `checked against any boundary rule.`,
      });
    }

    // ---- An authored import INTO generated output (Review #7, B3) -------
    //
    // Generated output is deliberately not a graph NODE: `.next/types/*.d.ts`
    // and a configured `outDir` are build artefacts that exist only after a
    // build, and seeding them would make the analyser's verdict depend on
    // whether someone had run one (§17). That exclusion is correct.
    //
    // What was NOT correct was applying it to an EDGE. Review #7 wrote, from
    // authored Messaging source:
    //
    //     export { … } from '../../../dist/barrel.js';
    //
    // TypeScript resolved it to `dist/barrel.d.ts` in the project's own
    // configured `outDir`, where the emitted declaration re-exports a Quran
    // internal. Real `tsc` succeeded and the analyser reported nothing at all,
    // because the resolved target was dropped for being generated — the
    // artefact rule quietly deleting a real cross-context dependency.
    //
    // Importing generated output is not the same act as producing it (§12).
    // The target still does not become production source; instead the import
    // itself is the finding. An authored module reaching into a build artefact
    // is unreviewable by construction — the file it depends on is not in the
    // repository, is rewritten by the next build, and carries whatever the
    // compiler last happened to emit — so it fails closed rather than
    // silently.
    for (const entry of node.imports) {
      if (entry.generatedRoot === null || entry.generatedRoot === undefined) continue;

      violations.push({
        rule: 'source-imports-generated-output',
        file: node.relative,
        specifier: entry.specifier,
        line: entry.line,
        message:
          `'${entry.specifier}' resolves to '${entry.generatedTarget}', which is ` +
          `generated output under '${entry.generatedRoot}'` +
          (node.workspace?.name === undefined
            ? '. '
            : ` (workspace '${node.workspace.name}'). `) +
          `Authored source must not import build output. The target is not ` +
          `authored code, is not in the repository, and is rewritten by the ` +
          `next build, so nothing it re-exports can be reviewed or governed by ` +
          `any boundary rule — a forbidden dependency laundered through an ` +
          `emitted declaration would be invisible. Import the SOURCE the ` +
          `artefact was compiled from instead.`,
      });
    }

    // ---- TypeScript-only production source (B6) -------------------------
    // Tooling workspaces are exempt from this rule ONLY: flat ESLint config
    // must be `.js` because ESLint loads it directly. They remain subject to
    // every dependency, cycle and layering rule below.
    //
    // Checked BEFORE project membership deliberately. A `.js` file is absent
    // from a TypeScript project's inputs precisely BECAUSE it is JavaScript, so
    // reporting "outside a project" here would name the symptom and hide the
    // cause the rule exists to state.
    if (!node.isTooling && !PRODUCTION_EXTENSIONS.has(node.extension)) {
      violations.push({
        rule: 'production-must-be-typescript',
        file: node.relative,
        specifier: '(file extension)',
        message:
          `Production source must be TypeScript: '${node.extension}' is not ` +
          `permitted here. A JavaScript file is neither type-checked nor ` +
          `covered by the architecture and RTL rules, so it bypasses both.`,
      });
      continue;
    }

    // ---- Production TypeScript no project compiles (B1 §3.3) ------------
    //
    // Membership is what makes resolution authoritative. A production source
    // outside every project's `files`/`include` is compiled by nothing, so its
    // aliases are unknown and the analyser cannot claim to reproduce the build
    // for it. Reporting is the only honest outcome: silently applying defaults
    // is how a file leaves enforcement while appearing to pass.
    //
    // Three exemptions, each narrow:
    //   - TOOLING, compiled by nobody by design.
    //   - DECLARATIONS, which legitimately sit outside an input list.
    //   - a workspace that declares NO project at all. That is a different
    //     finding — an unconfigured workspace — and is reported once against
    //     the workspace rather than once per file, so one missing tsconfig
    //     does not bury the run in noise.
    if (
      node.unownedByProject === true &&
      node.projectUnreadable !== true &&
      !node.isTooling &&
      !node.isDeclaration &&
      workspacesWithProjects.has(workspaceOfNode(node))
    ) {
      violations.push({
        rule: 'source-outside-typescript-project',
        file: node.relative,
        specifier: '(project membership)',
        message:
          `No TypeScript project compiles this file. Its workspace declares a ` +
          `project whose 'files'/'include' does not cover it, so ` +
          `'tsc -p' never type-checks it and the analyser cannot resolve its ` +
          `imports the way the build does. An unverifiable file is not a ` +
          `passing file.`,
      });
      continue;
    }

    const context = locateContext(node.relative);

    if (context === null) {
      // NOT a bounded-context implementation file. What it may do depends on
      // its ARCHITECTURAL ROLE, which is declared — never inferred from the
      // absence of a `contexts/` segment (B3).
      const role = roleOfNode(node);

      switch (role) {
        case ARCHITECTURAL_ROLES.COMPOSITION:
          // Layer 4. May compose many contexts' public interfaces
          // (DOMAIN_MODEL.md §3.3).
          checkCompositionFile(node, graph, adjacency, violations);
          break;

        case ARCHITECTURAL_ROLES.PLATFORM:
          // Layer 0. Sits beneath every context and must not reach upward.
          checkLayerZeroFile(node, graph, adjacency, violations);
          break;

        case ARCHITECTURAL_ROLES.SERVICE_HOST:
          // `packages/server-core` hosts context-owned services
          // (ARCHITECTURE.md §3.1). Hosting them means reaching them, so the
          // Layer-0 upward prohibition does not apply — but it is not Layer 0
          // and must not become an infrastructure tunnel either. The client
          // -bundle prohibition (§6.3 rule 9) is proven by the real Next build
          // in `npm run check:server-only`.
          checkServiceHostFile(node, graph, adjacency, violations);
          break;

        case ARCHITECTURAL_ROLES.TOOLING:
          // Build tooling ships in no bundle and implements no layer. It
          // remains subject to the cycle and TypeScript-only rules above.
          break;

        case ARCHITECTURAL_ROLES.REALTIME:
          checkRealtimeFile(node, graph, adjacency, violations);
          break;

        default: {
          const workspaceName = workspaceOfNode(node);

          // Two genuinely different findings, and conflating them tells a
          // reader the wrong thing to fix. Either the file belongs to a
          // workspace nobody classified, or it belongs to NO workspace at all
          // — repository-local source that some project compiles while
          // sitting outside every declared workspace, which the Round 5
          // Program closure made visible for the first time (§10).
          if (workspaceName === null) {
            violations.push({
              rule: 'source-outside-any-workspace',
              file: node.relative,
              specifier: '(workspace membership)',
              message:
                `This file is repository-local source that a TypeScript project ` +
                `compiles, but it lies outside every declared workspace, so no ` +
                `architectural role governs it and no workspace owns it. Move it ` +
                `into the workspace that uses it, or declare the directory as a ` +
                `workspace and classify it. Source that belongs to nobody is ` +
                `checked by nobody.`,
            });
            break;
          }

          violations.push({
            rule: 'unclassified-workspace-role',
            file: node.relative,
            specifier: '(workspace role)',
            message:
              `Workspace '${workspaceName}' has no architectural role. A ` +
              `workspace is classified by architecture decision — Layer 0 ` +
              `platform, Layer 4 composition, service host, realtime, or ` +
              `tooling — before its source is judged. Defaulting an ` +
              `unclassified workspace into a role is how Layer 4 was ` +
              `previously mistaken for Layer 0 (Review #4 B3), and granting ` +
              `one by directory name is how an unregistered workspace reached ` +
              `Layer 4 in Review #5.`,
          });
          break;
        }
      }

      continue;
    }

    if (!knownContexts.has(context.slug)) {
      violations.push({
        rule: 'unknown-context',
        file: node.relative,
        specifier: '(file location)',
        message:
          `'${context.slug}' is not one of the 16 bounded contexts ` +
          `(DOMAIN_MODEL.md §1). Production source may not define a context ` +
          `that the approved model does not contain.`,
      });
      continue;
    }

    checkContextFile(node, context, graph, adjacency, violations);
    checkContextWorkspaceUsage(node, context, graph, violations);
  }

  // ---- Cycles, file and workspace alike ---------------------------------
  //
  // A cycle spanning more than one workspace is reported as a WORKSPACE cycle,
  // because that is the more serious finding: two packages that cannot be
  // built, versioned or extracted independently. Membership is read from the
  // resolved graph node, not guessed from the path shape.
  const workspaceOf = new Map();
  for (const node of graph.nodes.values()) {
    workspaceOf.set(node.relative, node.workspace?.name ?? null);
  }

  for (const cycle of findCycles(graph)) {
    const workspaces = new Set(
      cycle.map((relative) => workspaceOf.get(relative)).filter((name) => name !== null),
    );

    violations.push({
      rule: workspaces.size > 1 ? 'workspace-cycle' : 'import-cycle',
      file: cycle[0] ?? '',
      specifier: '(cycle)',
      message:
        (workspaces.size > 1
          ? `Workspace dependency cycle across ${[...workspaces].join(' and ')} `
          : `Dependency cycle `) +
        `(ARCHITECTURE.md §6.3 rule 3):\n    ` +
        cycle.join('\n       -> '),
    });
  }

  // ---- Client bundle must not reach server-only source ------------------
  violations.push(...checkClientGraph(graph));

  return violations;
}

export { path };
