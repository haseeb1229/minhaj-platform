#!/usr/bin/env node
/**
 * Architecture validation — the authoritative bounded-context gate.
 *
 * Runs as its own process, deliberately. ESLint matches import specifier
 * STRINGS and honours `// eslint-disable-next-line`; this analyser parses a
 * real TypeScript AST, resolves each specifier with real TypeScript module
 * resolution, canonicalises every result through `realpath`, and cannot be
 * suppressed by a comment. ARCHITECTURE.md §6.3 rule 12: architecture rules
 * take no exceptions.
 *
 * What it enforces:
 *   - the DOMAIN_MODEL.md §3.1 allowlist, TRANSITIVELY, so a dependency cannot
 *     be laundered through a neutral wrapper or a workspace package
 *   - interface-only cross-context imports (§6.3 rule 4)
 *   - unknown context roots and unclassified workspaces
 *   - Layer 0 direction: a shared package never depends upward on a context
 *   - concrete infrastructure prohibited to contexts (§2 rule 7)
 *   - `apps/realtime` database prohibition (§6.3 rule 8)
 *   - cycles in the real graph, file-level and workspace-level
 *   - TypeScript-only production source
 *
 * Source roots are DISCOVERED from the root `package.json` workspaces, so a
 * workspace added later is inspected the moment it exists.
 *
 * Usage:
 *   node scripts/check-architecture.mjs
 *   node scripts/check-architecture.mjs --roots a,b   # fixture trees
 *   node scripts/check-architecture.mjs --json
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { discoverWorkspaces, repoRoot } from './shared/workspaces.mjs';
import { buildGraph } from './architecture/graph.mjs';
import { checkGraph } from './architecture/rules.mjs';

/**
 * Validates the architecture.
 *
 * With no arguments it inspects every discovered workspace. `roots` lets tests
 * point the SAME code path at a fixture tree; `workspaces` lets a test supply
 * an isolated workspace manifest set.
 */
export async function validateArchitecture(roots = null, workspaceRoot = null) {
  const graph = buildGraph({
    workspaces: discoverWorkspaces(workspaceRoot ?? repoRoot),
    roots,
  });

  return { graph, violations: checkGraph(graph) };
}

function isMain() {
  const invoked = process.argv[1];
  return (
    invoked !== undefined &&
    path.resolve(invoked) === path.resolve(fileURLToPath(import.meta.url))
  );
}

if (isMain()) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');

  const rootsFlag = args.indexOf('--roots');
  const roots =
    rootsFlag === -1
      ? null
      : (args[rootsFlag + 1] ?? '')
          .split(',')
          .filter(Boolean)
          .map((entry) => path.resolve(repoRoot, entry));

  const workspaceRootFlag = args.indexOf('--workspace-root');
  const workspaceRoot =
    workspaceRootFlag === -1
      ? null
      : path.resolve(repoRoot, args[workspaceRootFlag + 1] ?? '');

  const { graph, violations } = await validateArchitecture(roots, workspaceRoot);

  if (json) {
    console.log(
      JSON.stringify(
        {
          violations,
          filesChecked: graph.nodes.size,
          workspaces: graph.workspaces.map((workspace) => workspace.name),
        },
        null,
        2,
      ),
    );
  } else if (violations.length === 0) {
    console.log(
      `Architecture OK — ${graph.nodes.size} source file(s) across ` +
        `${graph.workspaces.length} workspace(s) checked against the ` +
        `DOMAIN_MODEL.md §3.1 allowlist.`,
    );
  } else {
    console.error(
      `\nArchitecture validation FAILED — ${violations.length} violation(s):\n`,
    );
    for (const violation of violations) {
      const at = violation.line === undefined ? '' : `:${violation.line}`;
      console.error(`  [${violation.rule}] ${violation.file}${at}`);
      console.error(`    import: ${violation.specifier}`);
      console.error(`    ${violation.message}\n`);
    }
    console.error(
      'An architecture rule takes no exceptions. A genuinely needed edge is ' +
        'added to the allowlist by decision, never bypassed.\n',
    );
  }

  process.exit(violations.length === 0 ? 0 : 1);
}
