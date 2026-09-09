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
import {
  persistenceAdapterIndex,
  reachRawCapability,
  verifyEncapsulationSurface,
} from './persistence.mjs';

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
 * ORDER INDEPENDENCE — the F2 correction
 * --------------------------------------
 * `contexts` used to be a Map KEYED BY SLUG that kept the FIRST entry the walk
 * happened to reach. That made the verdict depend on import declaration order.
 * Given a file reaching Learning through both
 *
 *     import { publicThing }  from '@/contexts/learning';        // legal
 *     import { privateThing } from '@/contexts/learning/internal/store';
 *
 * whichever line came first was recorded and the other vanished. Declaring the
 * public import first therefore MASKED the internals breach, and simply
 * swapping the two lines changed the result — a gate whose answer depends on
 * the order of statements is not enforcing anything, and reordering imports
 * would have silenced a real finding.
 *
 * Every distinct BOUNDARY ENTRY is now recorded, keyed by the resolved target
 * FILE, so the result is a set rather than a race. Where the same target is
 * reached by several paths the SHORTEST is kept — with a deterministic
 * tie-break, so two equally short paths always produce the same diagnostic —
 * and the returned list is sorted, so the report reads identically whatever
 * order discovery or traversal happened to take.
 *
 * The same shortest-wins rule is applied to `workspaces`, which had the same
 * first-hit shape.
 *
 * Returns:
 *   - `packages`   external packages reached, each with the path that reached it
 *   - `workspaces` repository workspaces reached, each with the path
 *   - `contexts`   EVERY bounded-context boundary entry reached, one per target
 */
function reachFrom(
  startFile,
  graph,
  adjacency,
  { ownWorkspace = null, isEncapsulated = null } = {},
) {
  const packages = [];
  const workspaces = new Map();
  const contexts = new Map();

  /**
   * Is `candidate` the better record for an already-seen target?
   *
   * Shorter path wins; equal lengths are broken by comparing the paths
   * themselves, so the choice never depends on which was encountered first.
   */
  const better = (candidate, existing) => {
    if (existing === undefined) return true;
    if (candidate.trail.length !== existing.trail.length) {
      return candidate.trail.length < existing.trail.length;
    }
    return candidate.trail.join('|') < existing.trail.join('|');
  };

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
      if (targetWorkspace !== null && targetWorkspace !== ownWorkspace) {
        const candidate = {
          workspace: targetWorkspace,
          relative: target.relative,
          trail: nextTrail,
          direct: nextTrail.length === 2,
        };
        if (better(candidate, workspaces.get(targetWorkspace))) {
          workspaces.set(targetWorkspace, candidate);
        }
      }

      // An approved ENCAPSULATION BOUNDARY — a declared context-owned
      // persistence adapter's public entry — is stopped at for the same reason
      // a context boundary is: what it depends on is its own business, and
      // attributing it to a caller reports the wrong owner.
      //
      // Without this, `packages/database/src/index.ts` publishing a
      // context-owned adapter was reported as a Layer 0 package depending
      // UPWARD on that adapter's owning context — the arrangement
      // ARCHITECTURE.md §4.1 prescribes, reported as an inversion of the
      // layering. The workspace is still recorded above, before the stop, so a
      // prohibited reach INTO the database package is unaffected.
      if (isEncapsulated !== null && isEncapsulated(target)) continue;

      const targetContext = locateContext(target.relative);

      if (targetContext !== null) {
        // Keyed by the resolved TARGET FILE **and the module this file reached
        // it through**, so two things are both true:
        //
        //   - a public entry and an internals reach into the SAME context are
        //     two records rather than one (the whole of F2), and
        //   - two DIFFERENT laundering routes to the same target stay two
        //     findings. Six barrels re-exporting one Quran internal are six
        //     modules to fix, and collapsing them to one would send a reader
        //     round a whack-a-mole loop: fix the named barrel, re-run, discover
        //     the next.
        const via = nextTrail[1] ?? to;

        const candidate = {
          slug: targetContext.slug,
          withinContext: targetContext.withinContext,
          target: target.relative,
          via,
          trail: nextTrail,
          direct: nextTrail.length === 2,
        };

        const key = `${via} ${to}`;
        if (better(candidate, contexts.get(key))) contexts.set(key, candidate);

        // Stop: a context's internals are its own business.
        continue;
      }

      if (visited.has(to)) continue;
      visited.add(to);
      queue.push({ file: to, trail: nextTrail });
    }
  }

  // Sorted so a report is identical whatever order the graph was walked in.
  // Shortest trail first within a context, so the dedupe below reports the
  // most useful path rather than an arbitrary one.
  const reachedContexts = [...contexts.values()].sort(
    (a, b) =>
      a.slug.localeCompare(b.slug) ||
      a.trail.length - b.trail.length ||
      a.withinContext.localeCompare(b.withinContext) ||
      a.target.localeCompare(b.target) ||
      a.trail.join('|').localeCompare(b.trail.join('|')),
  );

  return { packages, workspaces, contexts: reachedContexts };
}

/** Formats a trail of canonical paths as a readable dependency chain. */
function formatTrail(trail, graph) {
  return trail
    .map((entry) => graph.nodes.get(entry)?.relative ?? entry)
    .join('\n       -> ');
}

/** Checks one context file against the allowlist, directly and transitively. */
function checkContextFile(node, context, graph, adjacency, capability, violations) {
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
    isEncapsulated: capability.isBoundary,
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
  //
  // EVERY boundary entry is judged (F2). A context reached through both its
  // legal public interface and a forbidden internal file produces two records,
  // and the internals breach is reported whichever of the two the traversal met
  // first. Noise is controlled by deduplicating on the FINDING — one report per
  // forbidden context, one per distinct internal path — never by discarding a
  // reach before it has been judged, which is what masked the breach before.
  const reportedUnknown = new Set();
  const reportedForbidden = new Set();
  const reportedInternal = new Set();

  for (const reached of reach.contexts) {
    if (reached.slug === context.slug) continue;

    if (!knownContexts.has(reached.slug)) {
      if (reportedUnknown.has(reached.slug)) continue;
      reportedUnknown.add(reached.slug);

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
      // Deduplicated per ROUTE. The forbidden edge is one architectural fact,
      // but each intermediate that carries it is its own module to remove.
      const route = `${reached.slug} ${reached.via}`;
      if (reportedForbidden.has(route)) continue;
      reportedForbidden.add(route);

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
      const key = `${reached.slug}/${reached.withinContext}`;
      if (reportedInternal.has(key)) continue;
      reportedInternal.add(key);

      violations.push({
        rule: 'context-internal-import',
        file: node.relative,
        specifier: reached.target,
        message:
          `'${context.slug}' may depend on '${reached.slug}', but only ` +
          `through its public interface. Reaching ` +
          `'${reached.withinContext}' inside '${reached.slug}' is prohibited ` +
          `(ARCHITECTURE.md §6.3 rule 4). Reaching the same context's public ` +
          `entry elsewhere in this file does not excuse it — every boundary ` +
          `entry is judged on its own.` +
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
function checkCompositionFile(node, graph, adjacency, capability, violations) {
  const workspaceName = workspaceOfNode(node);

  const reach = reachFrom(node.absolute, graph, adjacency, {
    ownWorkspace: workspaceName,
    isEncapsulated: capability.isBoundary,
  });

  const reportedUnknown = new Set();
  const reportedInternal = new Set();

  for (const reached of reach.contexts) {
    if (!knownContexts.has(reached.slug)) {
      if (reportedUnknown.has(reached.slug)) continue;
      reportedUnknown.add(reached.slug);

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

    const key = `${reached.slug}/${reached.withinContext}`;
    if (reportedInternal.has(key)) continue;
    reportedInternal.add(key);

    violations.push({
      rule: 'composition-internal-import',
      file: node.relative,
      specifier: reached.target,
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

  // ---- Layer 4 never HOLDS raw database capability (Model A) -------------
  //
  // ARCHITECTURE.md §3.2 states it for both processes in one row: "Raw database
  // capability | never held — persistence happens inside context-owned services
  // (§3.1.1) | never held (§3.1.2)". The left-hand column is `apps/web`.
  //
  // This is the half of Model A that a context-only rule cannot express.
  // Composition is exactly where a context service is wired to its adapter, so
  // it MAY reach `packages/database` and reach it legitimately — what it may
  // not do is come away holding a client, a delegate, a transaction handle or a
  // raw-query facility. Reaching a narrow context-owned adapter's entry point
  // is invocation; reaching past it, or reaching a wrapper that renames the
  // capability, is possession (§3.1.2, §6.3 rule 13).
  reportRawCapability(node, graph, adjacency, capability, violations, {
    rule: 'composition-raw-database-capability',
    subject: 'Layer 4 composition',
    remedy:
      'Call a bounded context’s public service, or wire a narrow ' +
      'context-owned persistence adapter, and let persistence happen inside it.',
  });
}

/**
 * Reports every raw database capability one file can reach.
 *
 * The shared half of ARCHITECTURE.md §3.1.2 and §6.3 rule 13, used wherever the
 * approved documents say a role never HOLDS database capability. The walk is
 * transitive and exempts no intermediate module, so a wrapper chain is not a
 * defence — and it stops at an approved encapsulation boundary, so invoking a
 * service that persists internally is not mistaken for possessing what it uses.
 */
function reportRawCapability(
  node,
  graph,
  adjacency,
  capability,
  violations,
  { rule, subject, remedy },
) {
  for (const found of reachRawCapability(
    node.absolute,
    graph,
    adjacency,
    capability.isBoundary,
  )) {
    violations.push({
      rule,
      file: node.relative,
      specifier: found.specifier,
      ...(found.direct ? { line: found.line } : {}),
      message:
        `${subject} must never hold raw database capability, and this file ` +
        `${found.direct ? 'imports' : 'reaches'} '${found.packageName}' — ` +
        `${found.reason} (ARCHITECTURE.md §3.1.2, §6.3 rule 13). Invoking an ` +
        `encapsulated service that persists internally is permitted; ` +
        `receiving a client, delegate, transaction handle or raw-query ` +
        `facility is not, and no wrapper, barrel or re-export converts the ` +
        `second into the first. ${remedy}` +
        (found.direct
          ? ''
          : `\n    path: ${formatTrail(found.trail, graph)}\n       -> ${found.specifier}`),
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
function checkLayerZeroFile(node, graph, adjacency, capability, violations) {
  const workspaceName = node.workspace?.name ?? workspaceNameFromPath(node.relative);

  const reach = reachFrom(node.absolute, graph, adjacency, {
    ownWorkspace: workspaceName,
    isEncapsulated: capability.isBoundary,
  });

  // ---- Upward: a shared package must not reach a bounded context ---------
  const reportedUpward = new Set();

  for (const reached of reach.contexts) {
    if (reportedUpward.has(reached.slug)) continue;
    reportedUpward.add(reached.slug);

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

  // ---- ...nor a tunnel to raw database CAPABILITY -----------------------
  //
  // The tunnel rules above are expressed over prohibited WORKSPACES and over
  // `CONCRETE_INFRASTRUCTURE`, which between them do not name `@prisma/client`
  // — the Prisma deny list lives on the CONTEXT rule, and a Layer 0 package is
  // not a context. So a shared package every context consumes could import the
  // Prisma client directly and be reported by nothing, which is the same defect
  // as B5 with the first hop removed. Capability closes it by name.
  reportRawCapability(node, graph, adjacency, capability, violations, {
    rule: 'layer-zero-raw-database-capability',
    subject: `'${workspaceName}' is a Layer 0 package every bounded context may consume, so it`,
    remedy:
      'Data access is confined to packages/database and reached through a ' +
      'context-owned port (ARCHITECTURE.md §4.1).',
  });
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
 * THE SUPERSEDED NOTE — service-host infrastructure (Review #5, N2).
 *
 * A long-standing note here defended the absence of any infrastructure check on
 * `server-core`, on the authority of the then-current ARCHITECTURE.md §4.1 data
 * path:
 *
 *     Next.js / Node.js  ->  server-core  ->  Prisma ORM  ->  SQL Server 2022
 *
 * If that is the architected route, then `server-core` reaching Prisma is the
 * design rather than a breach, and adding a prohibition would have been the
 * checker inventing a rule — which is a defect this repository has corrected
 * before (Review #3's undocumented Node built-in deny list).
 *
 * The accepted architecture no longer draws that path. §4.1 now reads:
 *
 *     server-core  ->  the SAME context-owned service  ->  the same path beneath it
 *
 * and §3.1 rule 4 states it directly: "Each hosted service reaches data only
 * through its owning context's interface, exactly as it would if it were called
 * from within `apps/web`." §3.1.2 then prohibits "`server-core` public APIs
 * returning raw persistence capability" and "exposing repositories as
 * unrestricted database capability".
 *
 * So the note's premise is gone, and with it the reason for the gap. The
 * prohibited-workspace walk below is joined by a capability walk, for exactly
 * the sentence that now authorises it — not because stricter felt safer.
 */
function checkServiceHostFile(node, graph, adjacency, capability, violations) {
  const workspaceName = workspaceOfNode(node);

  const reach = reachFrom(node.absolute, graph, adjacency, {
    ownWorkspace: workspaceName,
    isEncapsulated: capability.isBoundary,
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

  // ---- Hosting a service is not bypassing its context's front door -------
  //
  // ARCHITECTURE.md §3.1: the host "performs no uncontrolled cross-context
  // table access" and "never bypasses a bounded context's public interface",
  // and rule 4 says a hosted service "reaches data only through its owning
  // context's interface". Hosting a context's service means depending on that
  // context — which is why the Layer-0 upward prohibition does not apply here —
  // but it is the context's PUBLIC interface that is hosted, never its
  // internals. Every boundary entry is judged, so a legal public reach in one
  // import cannot mask an internals reach in another (F2).
  const reportedInternal = new Set();

  for (const reached of reach.contexts) {
    if (isPublicEntry(reached.withinContext)) continue;

    const key = `${reached.slug}/${reached.withinContext}`;
    if (reportedInternal.has(key)) continue;
    reportedInternal.add(key);

    violations.push({
      rule: 'service-host-context-internal-import',
      file: node.relative,
      specifier: reached.target,
      message:
        `'${workspaceName}' hosts context-owned services, so it may depend on ` +
        `'${reached.slug}' — but only through that context's public ` +
        `interface. Reaching '${reached.withinContext}' inside it bypasses the ` +
        `boundary the host exists to preserve (ARCHITECTURE.md §3.1, §3.1 ` +
        `rule 4). Placing an implementation here changes where it is exported ` +
        `from, never who owns it.` +
        (reached.direct ? '' : `\n    path: ${formatTrail(reached.trail, graph)}`),
    });
  }

  // ---- The host never holds raw database capability ---------------------
  reportRawCapability(node, graph, adjacency, capability, violations, {
    rule: 'service-host-raw-database-capability',
    subject: `'${workspaceName}' hosts context-owned services and`,
    remedy:
      'A hosted service persists through its OWN context’s port and adapter, ' +
      'exactly as it would when called from apps/web (ARCHITECTURE.md §3.1 ' +
      'rule 4, §4.1).',
  });
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
function checkRealtimeFile(node, graph, adjacency, capability, violations) {
  // ---- Direct imports ---------------------------------------------------
  //
  // Classified by RESOLVED WORKSPACE, never by the specifier text. A relative
  // climb into `packages/database/src/adapters/...` is the same dependency as
  // naming `@minhaj/database`, and the previous specifier-string test saw only
  // the second: the first matched no prohibited NAME here, and the transitive
  // walk below skips reaches it considers direct, so a one-hop relative import
  // of the database package was reported by neither. `checkContextWorkspaceUsage`
  // has classified by resolved workspace since Review #3 for exactly this
  // reason; the realtime rule had not caught up.
  //
  // The raw specifier is still tested as well, so a specifier that NAMES a
  // prohibited package but resolves to nothing is caught rather than excused by
  // being broken.
  for (const entry of node.imports) {
    let name = entry.specifier;

    if (entry.resolved.kind === 'external') {
      name = entry.resolved.packageName;
    } else if (entry.resolved.kind === 'file') {
      const target = graph.nodes.get(entry.resolved.absolute);
      name =
        (target === undefined
          ? workspaceNameFromPath(entry.resolved.relative)
          : workspaceOfNode(target)) ?? entry.specifier;
    }

    if (!realtimeProhibited(name) && !realtimeProhibited(entry.specifier)) continue;

    violations.push({
      rule: 'realtime-database-access',
      file: node.relative,
      specifier: entry.specifier,
      line: entry.line,
      message:
        `'apps/realtime' never acquires raw database capability — not ` +
        `'${name}', by package name or by relative path. It calls ` +
        `context-owned services hosted in '@minhaj/server-core', which ` +
        `persist internally through their own context's port ` +
        `(ARCHITECTURE.md §3.1 rule 1, §3.1.2).`,
    });
  }

  // ---- Reached through ANY chain of local modules (B5) -------------------
  const reach = reachFrom(node.absolute, graph, adjacency, {
    ownWorkspace: node.workspace?.name ?? null,
    isEncapsulated: capability.isBoundary,
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

  // ---- Capability, by any name ------------------------------------------
  //
  // `realtimeProhibitedPackages` names `@minhaj/database`, `@prisma/client` and
  // `prisma`. It does NOT name `mssql` or `tedious`, so the driver beneath
  // Prisma — the same capability one layer down, and exactly the substitution
  // §3.1.2 anticipates by listing "an MSSQL driver" separately — went
  // unreported. The capability walk closes that, and closes it transitively.
  //
  // What it deliberately does NOT close is the architected route. The walk
  // stops at an approved encapsulation boundary, so
  //
  //     apps/realtime -> server-core-hosted context service
  //                   -> the same context service -> its adapter -> Prisma
  //
  // reports nothing: the realtime process caused persistence without ever
  // holding the means to perform it (§3.1.1, §3.2). Rejecting that would ban
  // the design the shared server boundary exists to provide.
  reportRawCapability(node, graph, adjacency, capability, violations, {
    rule: 'realtime-raw-database-capability',
    subject: "'apps/realtime'",
    remedy:
      'Call an approved context-owned service hosted in @minhaj/server-core ' +
      '(ARCHITECTURE.md §3.1 rule 1, §3.3).',
  });
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

/**
 * A CONTEXT-OWNED PERSISTENCE ADAPTER, physically inside `packages/database`.
 *
 * ARCHITECTURE.md §6.3 rule 14: "A persistence adapter's physical location
 * never determines its owner. An adapter inside `packages/database` is still
 * owned by its bounded context, and only that context may change its rules."
 *
 * This is the one place the analyser must NOT apply the Layer 0 rules. An
 * adapter implements its owning context's persistence port, so it depends on
 * that context — and `layer-zero-upward-dependency`, applied here, would report
 * the architecture itself as an inversion. The declared ownership is what makes
 * the difference expressible: the adapter is not a Layer 0 module reaching
 * upward, it is part of a context that happens to be implemented here.
 *
 * What ownership grants is narrow and nothing more:
 *
 *   - the OWNER context's PUBLIC interface, and only the public one
 *   - private Prisma/MSSQL capability, which is the adapter's whole job (§4.1)
 *
 * What it does not grant, in the words of §4.1: "Cross-context model/table use
 * is prohibited, and one context may never use another context's persistence
 * adapter as a shortcut — it calls that context's public interface."
 *
 * And an adapter's PUBLIC ENTRY must expose narrow persistence operations,
 * never raw Prisma. That is verified rather than assumed, in `surface.mjs`,
 * because otherwise "declare a directory an adapter" would be a way to switch
 * the capability walk off — the laundering §6.3 rule 13 explicitly names.
 */
function checkPersistenceAdapterFile(
  node,
  adapter,
  graph,
  adjacency,
  capability,
  violations,
) {
  const reach = reachFrom(node.absolute, graph, adjacency, {
    ownWorkspace: workspaceOfNode(node),
    isEncapsulated: capability.isBoundary,
  });

  // ---- Contexts: the owner's public interface, and nothing else ----------
  const reportedCross = new Set();
  const reportedInternal = new Set();

  for (const reached of reach.contexts) {
    if (reached.slug !== adapter.owner) {
      if (reportedCross.has(reached.slug)) continue;
      reportedCross.add(reached.slug);

      violations.push({
        rule: 'persistence-adapter-cross-context-dependency',
        file: node.relative,
        specifier: reached.target,
        message:
          `This persistence adapter is semantically owned by ` +
          `'${adapter.owner}' (declared in ` +
          `'${adapter.workspaceName}'), so it must not depend on ` +
          `'${reached.slug}'. Physical placement inside a platform package ` +
          `transfers no ownership and grants no cross-context access ` +
          `(ARCHITECTURE.md §4.1, §6.3 rule 14; DOMAIN_MODEL.md §3.1). An ` +
          `adapter serves one context's port; a second context is reached ` +
          `through its own public interface, by the service that needs it.` +
          `\n    path: ${formatTrail(reached.trail, graph)}`,
      });
      continue;
    }

    if (isPublicEntry(reached.withinContext)) continue;

    const key = reached.withinContext;
    if (reportedInternal.has(key)) continue;
    reportedInternal.add(key);

    violations.push({
      rule: 'persistence-adapter-context-internal-import',
      file: node.relative,
      specifier: reached.target,
      message:
        `This adapter is owned by '${adapter.owner}' and may depend on it — ` +
        `but through its public interface. Reaching ` +
        `'${reached.withinContext}' inside '${adapter.owner}' is prohibited ` +
        `(ARCHITECTURE.md §6.3 rule 4). The adapter implements the context's ` +
        `PORT; it does not reach into the context's internals.` +
        (reached.direct ? '' : `\n    path: ${formatTrail(reached.trail, graph)}`),
    });
  }

  // ---- Another context's adapter is never a shortcut --------------------
  //
  // The case declared ownership uniquely makes visible. Two adapters sitting
  // side by side in the same platform package are two DIFFERENT contexts'
  // persistence, and one reading the other is cross-context table access with
  // the boundary removed — reachable without ever naming a context, so no
  // context rule would see it.
  const reportedAdapters = new Set();
  const visited = new Set([node.absolute]);
  const queue = [{ file: node.absolute, trail: [node.absolute] }];

  while (queue.length > 0) {
    const { file, trail } = queue.shift();

    for (const { to } of adjacency.get(file) ?? []) {
      const target = graph.nodes.get(to);
      if (target === undefined) continue;

      const nextTrail = [...trail, to];
      const other = capability.adapterIndex.adapterFor(target.relative);

      if (other !== null) {
        if (other.directoryRelative === adapter.directoryRelative) continue;
        if (reportedAdapters.has(other.directoryRelative)) continue;
        reportedAdapters.add(other.directoryRelative);

        violations.push({
          rule: 'persistence-adapter-cross-adapter-dependency',
          file: node.relative,
          specifier: target.relative,
          message:
            `A persistence adapter owned by '${adapter.owner}' must not reach ` +
            `the adapter owned by '${other.owner}'. "One context may never use ` +
            `another context's persistence adapter as a shortcut — it calls ` +
            `that context's public interface" (ARCHITECTURE.md §4.1). Sharing ` +
            `a platform package is a physical fact and grants nothing.` +
            `\n    path: ${formatTrail(nextTrail, graph)}`,
        });
        continue;
      }

      // A context boundary is handled above; do not attribute a context's own
      // dependencies to the adapter that called it.
      if (locateContext(target.relative) !== null) continue;

      if (visited.has(to)) continue;
      visited.add(to);
      queue.push({ file: to, trail: nextTrail });
    }
  }

  // ---- The adapter's PUBLIC SURFACE must be narrow ----------------------
  if (capability.adapterIndex.isAdapterEntry(node.relative) !== null) {
    for (const finding of verifyEncapsulationSurface(node.absolute, graph)) {
      violations.push({
        rule:
          finding.kind === 'raw'
            ? 'persistence-adapter-exposes-raw-capability'
            : 'persistence-adapter-unverifiable-surface',
        file: node.relative,
        specifier: `${finding.module}#${finding.exportName}`,
        message:
          (finding.kind === 'raw'
            ? `This adapter's public entry exposes raw database capability: ` +
              `${finding.detail}. An adapter exposes "narrow persistence ` +
              `operations, never raw Prisma" (ARCHITECTURE.md §4.1), and a ` +
              `wrapper that renames a client, delegate, transaction handle or ` +
              `raw-query facility violates §6.3 rule 13 rather than satisfying ` +
              `it. Being declared an adapter is not what makes a boundary — ` +
              `having a surface that can be shown to be narrow is.`
            : `This adapter's public entry cannot be shown to be narrow: ` +
              `${finding.detail}. An encapsulation boundary states its contract ` +
              `explicitly, because the capability walk stops here and an ` +
              `inferred type is invisible to it. Annotate the export with the ` +
              `context-owned port it implements (ARCHITECTURE.md §4.1).`) +
          `\n    surface: ${finding.module}`,
      });
    }
  }
}

/**
 * No workspace's PUBLIC API hands out raw database capability.
 *
 * ARCHITECTURE.md §4.1: "Raw Prisma client, delegate, transaction handle and
 * raw-query capability are never part of an ordinary application package's
 * public API", and §3.1.2 adds "neutral or shared packages exposing
 * unrestricted database capability" to the prohibition list.
 *
 * Checked against the package's OWN public entry points — the targets its
 * `exports` map actually resolves to — rather than only where a consumer is
 * caught holding the result. A package that publishes `getDatabaseClient` has
 * already broken the boundary whether or not anything imports it yet, and the
 * finding belongs where it was introduced. `packages/database` is not exempt:
 * it is where raw capability is CONSTRUCTED and confined (§4.1), which is
 * precisely why its front door must not hand it out.
 */
function checkPublicSurfaces(graph, adjacency, capability, violations) {
  for (const workspace of graph.workspaces ?? []) {
    const directory = path
      .relative(repoRoot, workspace.directory)
      .split(path.sep)
      .join('/');

    for (const entry of publicEntryTargets(workspace)) {
      const relative = `${directory}/${entry.replace(/^\.\//, '')}`;
      const absolute = path.resolve(repoRoot, relative);

      const node =
        graph.nodes.get(absolute) ??
        [...graph.nodes.values()].find((candidate) => candidate.relative === relative);

      if (node === undefined) continue;

      for (const found of reachRawCapability(
        node.absolute,
        graph,
        adjacency,
        capability.isBoundary,
      )) {
        violations.push({
          rule: 'public-surface-raw-database-capability',
          file: node.relative,
          specifier: found.specifier,
          message:
            `'${workspace.name}' publishes this file as a public entry point, ` +
            `and it ${found.direct ? 'imports' : 'reaches'} ` +
            `'${found.packageName}' — ${found.reason}. Raw Prisma client, ` +
            `delegate, transaction handle and raw-query capability are never ` +
            `part of a package's public API (ARCHITECTURE.md §4.1, §3.1.2). ` +
            `Keep the capability private to the package and publish a narrow ` +
            `context-owned persistence adapter instead.` +
            `\n    path: ${formatTrail(found.trail, graph)}\n       -> ${found.specifier}`,
        });
      }
    }
  }
}

/**
 * Every file a workspace's `exports` map publishes, as workspace-relative paths.
 *
 * Read from the manifest rather than assumed, so a conditional export, a
 * subpath and a nested condition object are all covered — the `exports` map is
 * the package's actual public interface, and any branch of it is a front door.
 * A workspace declaring no `exports` falls back to the repository's `src/index`
 * convention, which is what a bare `import '<package>'` would resolve to.
 */
function publicEntryTargets(workspace) {
  const declared = workspace.manifest?.exports;
  const targets = new Set();

  const collect = (value) => {
    if (typeof value === 'string') {
      if (value.startsWith('./')) targets.add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) collect(item);
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const item of Object.values(value)) collect(item);
    }
  };

  collect(declared);

  if (targets.size === 0) {
    for (const fallback of ['./src/index.ts', './src/index.tsx', './src/index.d.ts']) {
      targets.add(fallback);
    }
  }

  return [...targets];
}

/**
 * The capability model for one graph: what encapsulates, and what holds.
 *
 * Built once per run and threaded through the rules, so every rule agrees about
 * which modules are approved encapsulation boundaries and which hold raw
 * capability. Two independent answers to that question would be two
 * architectures.
 */
function capabilityModelFor(graph) {
  const adapterIndex = persistenceAdapterIndex(graph);

  const isBoundary = (node) => adapterIndex.isAdapterEntry(node.relative) !== null;

  return { adapterIndex, isBoundary };
}

/** Applies every rule to the graph. */
export function checkGraph(graph) {
  const violations = [];
  const adjacency = fileAdjacency(graph);
  const capability = capabilityModelFor(graph);

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

  // ---- A persistence-adapter declaration that cannot be understood ------
  //
  // The declaration is the ONLY thing that establishes adapter ownership
  // (ARCHITECTURE.md §4.1). One that cannot be read is not "no adapters" — it
  // is an unknown number of unowned ones, so it is reported rather than
  // treated as absent.
  for (const root of capability.adapterIndex.roots) {
    if (root.malformed === null || root.malformed === undefined) continue;

    violations.push({
      rule: 'malformed-persistence-adapter-declaration',
      file: `${root.workspaceRelative}/package.json`,
      specifier: '(minhaj.persistenceAdapters)',
      message:
        `Workspace '${root.workspaceName}' declares ` +
        `'minhaj.persistenceAdapters' but it ${root.malformed}. Adapter ` +
        `ownership is explicit or it does not exist (ARCHITECTURE.md §4.1, ` +
        `§6.3 rule 14), and a declaration that cannot be parsed must not be ` +
        `read as "this workspace hosts no adapters".`,
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
      // ---- A context-owned persistence adapter (§4.1, §6.3 rule 14) -----
      //
      // Checked BEFORE the architectural role, because an adapter is precisely
      // the file whose role its LOCATION does not describe: it sits inside a
      // Layer 0 platform package and is semantically owned by a bounded
      // context. Applying the Layer 0 rules here would report the approved
      // architecture as an inversion.
      //
      // Fails closed in the other direction too: source beneath a declared
      // adapter root that no `owners` entry claims is an adapter nobody owns,
      // and an unowned adapter is exactly what the declaration exists to
      // prevent.
      const adapter = capability.adapterIndex.adapterFor(node.relative);
      const adapterRoot = capability.adapterIndex.rootFor(node.relative);

      if (adapter === null && adapterRoot !== null) {
        violations.push({
          rule: 'undeclared-persistence-adapter',
          file: node.relative,
          specifier: '(adapter ownership)',
          message:
            `This file sits under the declared persistence-adapter root ` +
            `'${adapterRoot.rootRelative}', but no adapter declared by ` +
            `'${adapterRoot.workspaceName}' owns it. "Each persistence adapter ` +
            `has one explicit semantic owning context" (ARCHITECTURE.md §4.1), ` +
            `and ownership is DECLARED — a directory name grants nothing. Add ` +
            `the adapter to 'minhaj.persistenceAdapters.owners' in that ` +
            `workspace's package.json, naming the one bounded context that ` +
            `owns it, or move the file out of the adapter root. An adapter ` +
            `nobody owns is data access with no boundary attached.`,
        });
        continue;
      }

      if (adapter !== null) {
        if (!adapter.ownerKnown) {
          violations.push({
            rule: 'persistence-adapter-unknown-owner',
            file: node.relative,
            specifier: '(adapter ownership)',
            message:
              `The adapter '${adapter.name}' declares '${adapter.owner}' as its ` +
              `owning context, which is not one of the 16 bounded contexts ` +
              `(DOMAIN_MODEL.md §1). A context is created by architecture ` +
              `decision; naming one in a manifest does not create it, and an ` +
              `adapter whose owner cannot be identified is unowned.`,
          });
          continue;
        }

        checkPersistenceAdapterFile(
          node,
          adapter,
          graph,
          adjacency,
          capability,
          violations,
        );
        continue;
      }

      // NOT a bounded-context implementation file. What it may do depends on
      // its ARCHITECTURAL ROLE, which is declared — never inferred from the
      // absence of a `contexts/` segment (B3).
      const role = roleOfNode(node);

      switch (role) {
        case ARCHITECTURAL_ROLES.COMPOSITION:
          // Layer 4. May compose many contexts' public interfaces
          // (DOMAIN_MODEL.md §3.3).
          checkCompositionFile(node, graph, adjacency, capability, violations);
          break;

        case ARCHITECTURAL_ROLES.PLATFORM:
          // Layer 0. Sits beneath every context and must not reach upward.
          checkLayerZeroFile(node, graph, adjacency, capability, violations);
          break;

        case ARCHITECTURAL_ROLES.SERVICE_HOST:
          // `packages/server-core` hosts context-owned services
          // (ARCHITECTURE.md §3.1). Hosting them means reaching them, so the
          // Layer-0 upward prohibition does not apply — but it is not Layer 0
          // and must not become an infrastructure tunnel either. The client
          // -bundle prohibition (§6.3 rule 9) is proven by the real Next build
          // in `npm run check:server-only`.
          checkServiceHostFile(node, graph, adjacency, capability, violations);
          break;

        case ARCHITECTURAL_ROLES.TOOLING:
          // Build tooling ships in no bundle and implements no layer. It
          // remains subject to the cycle and TypeScript-only rules above.
          break;

        case ARCHITECTURAL_ROLES.REALTIME:
          checkRealtimeFile(node, graph, adjacency, capability, violations);
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

    checkContextFile(node, context, graph, adjacency, capability, violations);
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

  // ---- No package's public API hands out raw database capability --------
  checkPublicSurfaces(graph, adjacency, capability, violations);

  // ---- Client bundle must not reach server-only source ------------------
  violations.push(...checkClientGraph(graph));

  return violations;
}

export { path };
