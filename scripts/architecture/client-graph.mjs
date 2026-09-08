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
