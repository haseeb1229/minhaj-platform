/**
 * MODEL A — encapsulated persistence through context-owned services.
 *
 * ARCHITECTURE.md §3.1.1 fixes the distinction this module implements:
 *
 *   "Access to an encapsulated service that internally persists is not
 *    possession of a raw database capability."
 *
 * Two different questions follow from that sentence, and conflating them is
 * exactly what a naive reachability rule does:
 *
 *   1. WHAT MAY A MODULE REACH?  Almost anything, through encapsulation. The
 *      approved path (§3.1.1, §4.1) is
 *
 *          composition / Server Action / Route Handler
 *              -> context public service
 *              -> owning-context persistence port
 *              -> context-owned persistence adapter (inside packages/database)
 *              -> private Prisma client
 *              -> SQL Server
 *
 *      and `apps/realtime` reaches the same implementation through an approved
 *      `server-core`-hosted service. A checker that rejected that architecture
 *      because database infrastructure exists further downstream would be
 *      enforcing the inverse of the approved design.
 *
 *   2. WHAT MAY A MODULE HOLD?  Never a Prisma client, a generated delegate, a
 *      transaction handle or a raw-query facility (§3.1.2, §6.3 rule 13) —
 *      "and a wrapper that launders one into the other violates this rule
 *      rather than satisfying it".
 *
 * So capability is followed as a TRANSITIVE property of the module graph, and
 * it stops at exactly one thing: an approved encapsulation boundary. Today that
 * means a DECLARED context-owned persistence adapter's public entry point, and
 * only where its exported surface has been SHOWN to expose no raw capability
 * (`./surface.mjs`). A boundary that cannot be shown narrow is not a boundary;
 * it is the laundering §6.3 rule 13 names.
 *
 * OWNERSHIP
 * ---------
 * §4.1 and §6.3 rule 14: "A persistence adapter's physical location never
 * determines its owner. An adapter inside `packages/database` is still owned by
 * its bounded context, and only that context may change its rules."
 *
 * Ownership is therefore read from an EXPLICIT declaration in the hosting
 * workspace's manifest (`persistenceAdapterPolicy` in
 * `packages/config/eslint/contexts.js`), never inferred from a directory name —
 * this repository has removed inference-by-spelling twice already, and a
 * directory name carries no authority. It fails closed both ways: source under
 * the declared adapter root that no entry claims is rejected, and an owner that
 * is not one of the sixteen bounded contexts is rejected.
 *
 * What ownership BUYS is the one thing the architecture requires and a Layer 0
 * rule would otherwise forbid: an adapter may depend on ITS OWN context's
 * public interface, because it implements that context's persistence port and
 * is semantically part of it. What ownership does NOT buy is any reach into a
 * second context, or into another context's adapter — §4.1 is explicit that
 * "one context may never use another context's persistence adapter as a
 * shortcut".
 */

import path from 'node:path';

import {
  contextSlugs,
  describeAdapterOwner,
  layerZeroPersistentConcerns,
  persistenceAdapterPolicy,
  rawDatabaseCapabilityReason,
} from '../../packages/config/eslint/contexts.js';
import { repoRoot } from '../shared/workspaces.mjs';
import { describeExportSurface, expandLocalTypes } from './surface.mjs';

const knownContexts = new Set(contextSlugs);

/**
 * How far a surface is followed through re-export chains.
 *
 * Generous enough for any real barrel arrangement, and bounded so a
 * pathological or cyclic one terminates. The visited sets already make
 * revisiting impossible; this is the belt to those braces.
 */
const MAX_SURFACE_DEPTH = 16;

/** Repository-relative POSIX path. */
export function toRelative(absolute) {
  return path.relative(repoRoot, absolute).split(path.sep).join('/');
}

/**
 * The persistence-adapter map for one graph.
 *
 * Built from the manifests of the workspaces under analysis. A workspace that
 * declares nothing contributes nothing — declaring the root is what brings a
 * package under the ownership rules at all, and the production
 * `packages/database` declares it with an empty owner map so the first adapter
 * cannot arrive unowned.
 */
export function persistenceAdapterIndex(graph) {
  /** [{ workspaceName, workspaceRelative, rootRelative, malformed }] */
  const roots = [];
  /** [{ workspaceName, owner, ownerKnown, name, directoryRelative }] */
  const adapters = [];
  const seenDirectories = new Set();

  for (const workspace of graph.workspaces ?? []) {
    const relativeDirectory = toRelative(workspace.directory);
    if (seenDirectories.has(relativeDirectory)) continue;
    seenDirectories.add(relativeDirectory);

    const policy = persistenceAdapterPolicy(workspace.manifest ?? null);
    if (policy === null) continue;

    if (policy.malformed !== null && policy.malformed !== undefined) {
      roots.push({
        workspaceName: workspace.name,
        workspaceRelative: relativeDirectory,
        rootRelative: null,
        malformed: policy.malformed,
      });
      continue;
    }

    const rootRelative = `${relativeDirectory}/${policy.root}`;

    roots.push({
      workspaceName: workspace.name,
      workspaceRelative: relativeDirectory,
      rootRelative,
      malformed: null,
    });

    for (const [name, owner] of Object.entries(policy.owners)) {
      // `persistenceAdapterPolicy` has already normalised and rejected
      // anything it cannot read, so an owner arriving here is either a known
      // context or a known Layer-0 concern. `ownerKnown` stays as the single
      // place that decides, rather than trusting the normalisation twice.
      const ownerKnown =
        owner?.kind === 'context'
          ? knownContexts.has(owner.slug)
          : owner?.kind === 'layer0' &&
            layerZeroPersistentConcerns.includes(owner.concern);

      adapters.push({
        workspaceName: workspace.name,
        name,
        owner,
        ownerKind: owner?.kind ?? null,
        ownerSlug: owner?.kind === 'context' ? owner.slug : null,
        ownerLabel: describeAdapterOwner(owner),
        ownerKnown,
        directoryRelative: `${rootRelative}/${name}`,
      });
    }
  }

  /** The declared adapter containing a repository-relative path, or `null`. */
  const adapterFor = (relative) => {
    for (const adapter of adapters) {
      if (
        relative === adapter.directoryRelative ||
        relative.startsWith(`${adapter.directoryRelative}/`)
      ) {
        return adapter;
      }
    }
    return null;
  };

  /** The declared adapter ROOT containing a repository-relative path. */
  const rootFor = (relative) => {
    for (const entry of roots) {
      if (entry.rootRelative === null) continue;
      if (
        relative === entry.rootRelative ||
        relative.startsWith(`${entry.rootRelative}/`)
      ) {
        return entry;
      }
    }
    return null;
  };

  /**
   * Is this file an adapter's PUBLIC ENTRY?
   *
   * `<adapterDirectory>/index` and nothing else. Everything deeper is the
   * adapter's internals, which is where Prisma legitimately lives — so
   * internals must never be an encapsulation boundary. Reaching past the entry
   * point is reaching past the encapsulation, and the capability walk treats it
   * that way.
   */
  const isAdapterEntry = (relative) => {
    const adapter = adapterFor(relative);
    if (adapter === null) return null;

    const entry = `${adapter.directoryRelative}/index`;
    const matches =
      relative === entry ||
      relative === `${entry}.ts` ||
      relative === `${entry}.tsx` ||
      relative === `${entry}.d.ts`;

    return matches ? adapter : null;
  };

  return { roots, adapters, adapterFor, rootFor, isAdapterEntry };
}

/**
 * Every raw database capability a file can REACH.
 *
 * Transparent through neutral modules, wrappers, barrels and workspace
 * packages, because that is what they are at runtime — §3.1.2 prohibits
 * laundering "through any intermediate package", and chain length is not a
 * defence.
 *
 * It stops at an approved encapsulation boundary, and there only. That is the
 * whole of Model A: everything above a context-owned adapter's narrow entry
 * point causes persistence without possessing the means to perform it.
 *
 * Returns `[{ packageName, reason, specifier, line, trail, direct }]`, one entry
 * per distinct capability source, carrying the SHORTEST path that reached it so
 * the diagnostic can show how.
 */
export function reachRawCapability(startFile, graph, adjacency, isBoundary) {
  const found = new Map();

  const record = (key, entry) => {
    const existing = found.get(key);
    if (existing === undefined || entry.trail.length < existing.trail.length) {
      found.set(key, entry);
    }
  };

  const visited = new Set([startFile]);
  const queue = [{ file: startFile, trail: [startFile] }];

  while (queue.length > 0) {
    const { file, trail } = queue.shift();
    const node = graph.nodes.get(file);
    if (node === undefined) continue;

    for (const entry of node.imports) {
      if (entry.resolved.kind !== 'external') continue;

      const reason = rawDatabaseCapabilityReason(entry.resolved.packageName);
      if (reason === null) continue;

      record(entry.resolved.packageName, {
        packageName: entry.resolved.packageName,
        reason,
        specifier: entry.specifier,
        line: entry.line,
        trail,
        direct: trail.length === 1,
      });
    }

    for (const { to } of adjacency.get(file) ?? []) {
      const target = graph.nodes.get(to);
      if (target === undefined) continue;

      // An approved encapsulation boundary invokes persistence on the caller's
      // behalf and hands back domain values (§3.1.1). Capability stops here —
      // and the boundary's own surface is verified separately, so being
      // declared a boundary is never enough on its own.
      if (isBoundary(target)) continue;

      if (visited.has(to)) continue;
      visited.add(to);
      queue.push({ file: to, trail: [...trail, to] });
    }
  }

  return [...found.values()].sort((a, b) => a.packageName.localeCompare(b.packageName));
}

/**
 * Verifies that an encapsulation boundary's EXPORTED SURFACE is narrow.
 *
 * Walks every exported name to the declaration that actually produces it —
 * through named re-exports, star re-exports, local re-exports of imported
 * bindings, and type annotations that name a type imported from elsewhere — and
 * reports two things:
 *
 *   - `raw`          the surface names a raw-capability type: a Prisma client,
 *                    a generated delegate, a transaction handle, a raw-query
 *                    facility, or anything that resolves to one
 *   - `unverifiable` an exported value with no explicit type annotation, whose
 *                    inferred type no syntactic analysis can see
 *
 * FOLLOWING, NOT GUESSING
 * -----------------------
 * The judgement is made at the DECLARATION, never at the module a name
 * travelled through. A context-owned adapter's internals legitimately hold
 * Prisma — that is what an adapter is — so
 *
 *     import { createMessageStore } from './message-store';   // uses Prisma
 *     export { createMessageStore };
 *
 * must PASS, while
 *
 *     export { getDatabaseClient } from '../../client';       // also uses Prisma
 *
 * must FAIL. Nothing about the SOURCE MODULE separates those two; the
 * declarations do. The first returns a `MessageStore` port; the second returns
 * a `DatabaseClient`, which is `PrismaClient` one alias away. So each name is
 * followed to where it is declared and judged on what that declaration says it
 * hands back.
 *
 * Both findings fail closed, and they are the same finding in substance: a
 * boundary whose surface cannot be shown to be narrow is not encapsulating
 * anything, and §6.3 rule 13 does not accept a wrapper as a substitute.
 */
export function verifyEncapsulationSurface(entryAbsolute, graph) {
  const findings = [];
  const visitedModules = new Set();
  const visitedNames = new Set();
  const visitedValues = new Set();

  /** Resolution of one specifier as the graph recorded it for this module. */
  const resolutionOf = (moduleAbsolute, specifier) => {
    const node = graph.nodes.get(moduleAbsolute);
    if (node === undefined) return null;

    for (const entry of node.imports) {
      if (entry.specifier === specifier) return entry.resolved;
    }
    return null;
  };

  /** Does this specifier name a package that IS raw database capability? */
  const rawPackageReason = (moduleAbsolute, specifier) => {
    const resolved = resolutionOf(moduleAbsolute, specifier);

    // Unresolved here: judged by the specifier NAME rather than ignored, so a
    // broken import of Prisma is not quietly excused for being broken.
    if (resolved === null) return rawDatabaseCapabilityReason(specifier);

    return resolved.kind === 'external'
      ? rawDatabaseCapabilityReason(resolved.packageName)
      : null;
  };

  const localTargetOf = (moduleAbsolute, specifier) => {
    const resolved = resolutionOf(moduleAbsolute, specifier);
    return resolved !== null && resolved.kind === 'file' ? resolved.absolute : null;
  };

  const report = (kind, moduleAbsolute, exportName, detail) => {
    findings.push({ kind, module: toRelative(moduleAbsolute), exportName, detail });
  };

  /** Follows an imported binding to the module that declares it. */
  const followBinding = (moduleAbsolute, binding, local, origin, depth) => {
    const reason = rawPackageReason(moduleAbsolute, binding.specifier);
    if (reason !== null) {
      report(
        'raw',
        moduleAbsolute,
        origin,
        `'${local}' comes from '${binding.specifier}' — ${reason}`,
      );
      return;
    }

    const target = localTargetOf(moduleAbsolute, binding.specifier);
    if (target === null) return;

    // A namespace binding exposes the WHOLE target module, so the whole target
    // module is the surface.
    if (binding.imported === '*') {
      verifyModule(target, origin, depth + 1);
      return;
    }

    verifyName(target, binding.imported ?? local, origin, depth + 1);
  };

  /**
   * Checks one declaration: it must SAY what it hands back, and what it says
   * must not resolve to raw database capability.
   */
  const verifyDeclaration = (moduleAbsolute, surface, declaration, origin, depth) => {
    if (!declaration.annotated) {
      report(
        'unverifiable',
        moduleAbsolute,
        origin,
        `'${declaration.name}' is exported as a ${declaration.kind} with no ` +
          `explicit type annotation, so what it hands the caller is known only ` +
          `to the compiler's inference`,
      );
      return;
    }

    for (const reference of declaration.valueReferences ?? []) {
      const key = `${moduleAbsolute}#value:${reference}`;
      if (visitedValues.has(key)) continue;
      visitedValues.add(key);

      const binding = surface.importBindings.get(reference);
      if (binding !== undefined) {
        followBinding(moduleAbsolute, binding, reference, origin, depth);
        continue;
      }

      const local = surface.declarations?.get(reference);
      if (local !== undefined) {
        verifyDeclaration(moduleAbsolute, surface, local, origin, depth + 1);
      }
    }

    const identifiers = expandLocalTypes(declaration.identifiers, surface.localTypes);
    const broadTypes = new Set(declaration.broadTypes ?? []);

    // A local alias can erase the useful shape just as effectively as writing
    // `unknown` at the exported declaration. `expandLocalTypes` already gives
    // us the transitive alias closure, so collect broad markers from that same
    // closure before deciding the surface is narrow.
    for (const identifier of identifiers) {
      for (const reason of surface.localBroadTypes?.get(identifier) ?? []) {
        broadTypes.add(reason);
      }
    }

    if (broadTypes.size > 0) {
      report(
        'unverifiable',
        moduleAbsolute,
        origin,
        `'${declaration.name}' uses ${[...broadTypes].join(', ')}, which can ` +
          `erase a raw client, delegate, transaction handle or raw-query ` +
          `facility instead of proving a narrow context-owned contract`,
      );
      return;
    }

    for (const identifier of identifiers) {
      const binding = surface.importBindings.get(identifier);
      if (binding === undefined) continue;

      followBinding(moduleAbsolute, binding, identifier, origin, depth);
    }
  };

  /**
   * Verifies one exported NAME of one module, following it to its declaration.
   *
   * `origin` is the name the BOUNDARY publishes it under, so a finding several
   * re-exports deep still says which part of the boundary's surface it belongs
   * to.
   */
  const verifyName = (moduleAbsolute, name, origin, depth) => {
    if (depth > MAX_SURFACE_DEPTH) return;

    const key = `${moduleAbsolute}#${name}`;
    if (visitedNames.has(key)) return;
    visitedNames.add(key);

    const surface = describeExportSurface(moduleAbsolute);
    if (surface.unreadable) return;

    const matches = surface.exports.filter((entry) => entry.name === name);

    // Not declared here by that name — it can only have arrived through a star
    // re-export, so follow those.
    if (matches.length === 0) {
      for (const star of surface.starReexports) {
        const reason = rawPackageReason(moduleAbsolute, star.specifier);
        if (reason !== null) {
          report(
            'raw',
            moduleAbsolute,
            origin,
            `'${name}' arrives through a star re-export of ` +
              `'${star.specifier}' — ${reason}`,
          );
          continue;
        }

        const target = localTargetOf(moduleAbsolute, star.specifier);
        if (target !== null) verifyName(target, name, origin, depth + 1);
      }
      return;
    }

    for (const entry of matches) {
      // `export { a } from './b'` — the declaration lives in './b'.
      if (entry.kind === 'reexport') {
        const reason = rawPackageReason(moduleAbsolute, entry.from);
        if (reason !== null) {
          report(
            'raw',
            moduleAbsolute,
            origin,
            `'${name}' is re-exported straight out of '${entry.from}' — ${reason}`,
          );
          continue;
        }

        const target = localTargetOf(moduleAbsolute, entry.from);
        if (target !== null) {
          verifyName(target, entry.sourceName ?? name, origin, depth + 1);
        }
        continue;
      }

      if (entry.kind === 'local-export' || entry.kind === 'default-expression') {
        const local = entry.localName;

        if (local === null) {
          report(
            'unverifiable',
            moduleAbsolute,
            origin,
            'a default export of an expression declares no type of its own',
          );
          continue;
        }

        // `import { a } from './b'; export { a };` — follow to './b'.
        const binding = surface.importBindings.get(local);
        if (binding !== undefined) {
          followBinding(moduleAbsolute, binding, local, origin, depth);
          continue;
        }

        const declaration = surface.declarations?.get(local);
        if (declaration === undefined) {
          report(
            'unverifiable',
            moduleAbsolute,
            origin,
            `'${local}' is exported but its declaration could not be identified`,
          );
          continue;
        }

        verifyDeclaration(moduleAbsolute, surface, declaration, origin, depth);
        continue;
      }

      verifyDeclaration(moduleAbsolute, surface, entry, origin, depth);
    }
  };

  /** Verifies every exported name of one module. */
  const verifyModule = (moduleAbsolute, origin, depth) => {
    if (depth > MAX_SURFACE_DEPTH) return;
    if (visitedModules.has(moduleAbsolute)) return;
    visitedModules.add(moduleAbsolute);

    const surface = describeExportSurface(moduleAbsolute);
    if (surface.unreadable) return;

    for (const star of surface.starReexports) {
      const reason = rawPackageReason(moduleAbsolute, star.specifier);
      if (reason !== null) {
        report(
          'raw',
          moduleAbsolute,
          origin,
          `a star re-export of '${star.specifier}' republishes ${reason} as ` +
            `part of this surface`,
        );
        continue;
      }

      const target = localTargetOf(moduleAbsolute, star.specifier);
      if (target !== null) verifyModule(target, origin, depth + 1);
    }

    for (const entry of surface.exports) {
      verifyName(moduleAbsolute, entry.name, origin, depth + 1);
    }
  };

  verifyModule(entryAbsolute, '(entry point)', 0);

  return findings;
}
