/**
 * Client-graph analysis.
 *
 * ARCHITECTURE.md §3.1 and §6.3 rule 9: `packages/server-core` is server-only
 * and must never be imported into a client bundle. SECURITY_BASELINE.md §18.1
 * says the same of server environment parsing.
 *
 * The previous check keyed off filenames — `*.client.tsx` — which is not how
 * Next.js decides anything. A Client Component is a module carrying the
 * `'use client'` directive, whatever it is called, and the client bundle is
 * everything REACHABLE from one. This walks that real graph.
 *
 * Because it operates on the resolved graph, a server-only module is caught
 * however it is reached: by package name, by package subpath, by relative
 * source path, through the `@/` alias, or through any chain of wrappers.
 */

import path from 'node:path';

import { toRepoRelative } from './resolver.mjs';

/**
 * Repository paths that must never appear in a client bundle.
 *
 * Expressed as path PREFIXES over canonical repository-relative paths, so the
 * whole source tree of each is covered rather than only its declared entry
 * points. `index.ts` is not special.
 */
export const SERVER_ONLY_SOURCE_PREFIXES = Object.freeze([
  {
    prefix: 'packages/database/',
    reason:
      "'packages/database' is server-only and contains Prisma/MSSQL data access " +
      '(ARCHITECTURE.md section 4.1)',
    exempt: ['packages/database/src/client-import-error.ts'],
  },
  {
    prefix: 'packages/server-core/src/',
    reason:
      "'packages/server-core' is server-only and hosts context-owned server " +
      'services (ARCHITECTURE.md §3.1, §6.3 rule 9)',
    // The browser guard is the module a client build is SUPPOSED to resolve to.
    // Reaching it is the boundary working, not a violation.
    exempt: ['packages/server-core/src/client-import-error.ts'],
  },
  {
    // Covers BOTH `env/server.ts` (the public entry point) and
    // `env/server-schema.ts` (the implementation), because the prefix has no
    // trailing slash. Both carry `import 'server-only'`, so a real bundler
    // already rejects them; this rule reports the same reach at the
    // architecture gate, by RESOLVED SOURCE PATH, so a violation is named
    // before anyone waits for a build.
    //
    // Review #3 reached a marker-free parser from a Client Component through
    // the then-public `@minhaj/contracts/env/schema` subpath. That subpath is
    // removed and the implementation is now marked; this rule is the third
    // defence, and the only one that survives a specifier nobody anticipated.
    prefix: 'packages/contracts/src/env/server',
    reason:
      'server environment parsing reads process.env and will describe secrets ' +
      '(SECURITY_BASELINE.md §18.1)',
    exempt: ['packages/contracts/src/env/server-in-client-error.ts'],
  },
]);

/** Does this repository-relative path name a server-only module? */
export function serverOnlyReason(relative) {
  for (const entry of SERVER_ONLY_SOURCE_PREFIXES) {
    if (entry.exempt.includes(relative)) continue;
    if (relative.startsWith(entry.prefix)) return entry.reason;
  }

  return null;
}

/**
 * Formats a trail of canonical paths as a readable chain.
 *
 * A hop may name a file outside the walked roots — a server-only module reached
 * from a fixture tree, say — so it falls back to the repository-relative form
 * rather than printing a raw absolute path.
 */
function formatTrail(trail, graph) {
  return trail
    .map((entry) => graph.nodes.get(entry)?.relative ?? toRepoRelative(entry))
    .join('\n       -> ');
}

/**
 * Every server-only module reachable from a Client Component entry point.
 *
 * Reports the shortest path to each, so a violation says exactly how the
 * client graph obtained the server module.
 */
export function checkClientGraph(graph) {
  const violations = [];

  const clientEntries = [...graph.nodes.values()].filter((node) => node.isClientEntry);

  /**
   * Edges followed here are NOT restricted to files the graph walked.
   *
   * A client file can reach `packages/server-core/src/...` by relative path
   * even when that package is outside the roots under inspection. Restricting
   * traversal to known nodes would drop exactly the edge being checked, so
   * every resolved file edge is followed and classified by its own path.
   */
  const edgesOf = (absolute) => {
    const node = graph.nodes.get(absolute);
    if (node === undefined) return [];

    return node.imports
      .filter((entry) => entry.resolved.kind === 'file')
      .map((entry) => ({
        to: entry.resolved.absolute,
        relative: entry.resolved.relative,
      }));
  };

  for (const entry of clientEntries) {
    const visited = new Set([entry.absolute]);
    const queue = [{ file: entry.absolute, trail: [entry.absolute] }];
    const reported = new Set();

    while (queue.length > 0) {
      const { file, trail } = queue.shift();

      for (const edge of edgesOf(file)) {
        if (visited.has(edge.to)) continue;
        visited.add(edge.to);

        const nextTrail = [...trail, edge.to];
        const reason = serverOnlyReason(edge.relative);

        // ---- A genuine Server Action boundary (§7 of the hardening gate) ---
        //
        // A module carrying the module-level `'use server'` directive is NOT
        // ordinary client-bundle reachability. Next.js replaces the import
        // with a callable REFERENCE: the action's implementation, and
        // everything that implementation imports — a context service, a
        // `server-core`-hosted service, a persistence adapter — stays on the
        // server and never enters the browser bundle. ARCHITECTURE.md §7 makes
        // Server Actions the sanctioned mutation path from the platform's own
        // UI, so treating one as a client leak would report the architecture
        // itself as a violation.
        //
        // Three things keep this from becoming a laundering marker:
        //
        //   1. The directive is read from the REAL module prologue
        //      (`parser.mjs`), so a commented-out directive, a directive in a
        //      string, one placed after another statement, and a function-level
        //      one all leave the module ordinary — and an ordinary module that
        //      reaches server-only code still fails, exactly as before.
        //   2. The boundary module is still classified itself. If the module
        //      carrying the directive IS server-only source, that is reported
        //      before the traversal stops, because a directive cannot relocate
        //      a file out of `packages/server-core`.
        //   3. Stopping the CLIENT-BUNDLE walk exempts the action from nothing
        //      else. Every context, layering, capability and server-side rule
        //      in `rules.mjs` still applies to it — this decides only what is
        //      bundled for the browser (§7.2).
        const target = graph.nodes.get(edge.to);

        if (reason === null && target?.isServerActionBoundary === true) continue;

        if (reason !== null) {
          if (reported.has(edge.relative)) continue;
          reported.add(edge.relative);

          violations.push({
            rule: 'server-only-in-client-graph',
            file: entry.relative,
            specifier: edge.relative,
            message:
              `Client Component '${entry.relative}' reaches server-only module ` +
              `'${edge.relative}'. ${reason}. Call it from a Server ` +
              `Component, Server Action or Route Handler and pass the result ` +
              `down as props.\n    path: ${formatTrail(nextTrail, graph)}`,
          });

          // Do not walk INTO the server module: its own dependencies are not
          // the client component's doing, and reporting them would be noise.
          continue;
        }

        queue.push({ file: edge.to, trail: nextTrail });
      }
    }
  }

  return violations;
}

export { path };
