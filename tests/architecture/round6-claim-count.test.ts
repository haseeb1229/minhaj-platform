import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  repoRoot,
  validateFixtureWorkspace,
  type ArchitectureViolation,
} from './architecture-harness.ts';

/**
 * Round 6 §10 — more than two ownership claims.
 *
 * Two questions the two-project case does not answer:
 *
 *   1. Do THREE compatible claims stay normal? A file loaded by many projects
 *      that all agree about it is ordinary shared code, and making it
 *      unanalysable would punish the correct pattern.
 *
 *   2. Does ONE incompatible claim among several compatible ones still fail
 *      closed? It must. Ownership is not a majority vote: the disagreeing
 *      project's build really happens, and its resolution really differs.
 *
 * And in both cases the answer must not depend on which project the analyser
 * happened to discover first (§10).
 */

/** Violations of one rule. */
function ofRule(
  violations: readonly ArchitectureViolation[],
  rule: string,
): ArchitectureViolation[] {
  return violations.filter((violation) => violation.rule === rule);
}

/** Runs the real TypeScript compiler over a fixture project. */
function typecheck(projectRelativePath: string): void {
  execFileSync(
    process.execPath,
    [
      path.join(repoRoot, 'node_modules', 'typescript', 'lib', 'tsc.js'),
      '--noEmit',
      '-p',
      path.join(repoRoot, projectRelativePath),
    ],
    { cwd: repoRoot, stdio: 'pipe' },
  );
}

/**
 * The files reported as ambiguously owned, with workspaces in a GIVEN order.
 *
 * Discovery order decides the order ownership claims arrive in, which is
 * exactly what must not change the verdict (§10). This drives the ownership
 * index directly rather than the whole checker, because claim ordering is a
 * property of the index and testing it there is what actually proves it.
 */
async function ambiguousFilesInOrder(
  fixtureRoot: string,
  reverse: boolean,
): Promise<string[]> {
  const { buildProjectIndex, resetProjectCaches } =
    await import('../../scripts/architecture/tsconfig.mjs');
  const { discoverWorkspaces } = await import('../../scripts/shared/workspaces.mjs');
  const { createWorkspaceRedirect } =
    await import('../../scripts/architecture/resolver.mjs');
  const { workspacePackageMap } = await import('../../scripts/shared/workspaces.mjs');

  const discovered = discoverWorkspaces(path.join(repoRoot, fixtureRoot)) as {
    name: string;
    directory: string;
  }[];

  const ordered = reverse ? [...discovered].reverse() : discovered;

  // `buildProjectIndex` caches on a SORTED workspace key, so the reversed run
  // would otherwise be served the forward run's cached answer and prove
  // nothing. Clearing the cache forces the claims to genuinely be collected
  // again in the new order.
  resetProjectCaches();

  const index = buildProjectIndex(
    ordered,
    createWorkspaceRedirect(workspacePackageMap(ordered)),
  ) as { ambiguous: Map<string, Set<string>> };

  return [...index.ambiguous.keys()]
    .map((file) => path.relative(repoRoot, file).split(path.sep).join('/'))
    .sort();
}

// ===========================================================================
// §10 — three compatible claims
// ===========================================================================

describe('§10 — many projects that AGREE about a file is not ambiguity', () => {
  const fixture = 'tests/fixtures/three-compatible';

  it('compiles under all four projects (real tsc)', () => {
    for (const project of [
      'packages/shared',
      'apps/one',
      'apps/two',
      'apps/three',
    ] as const) {
      expect(() => typecheck(`${fixture}/${project}/tsconfig.json`)).not.toThrow();
    }
  });

  it('reports no ambiguity for a file three independent projects load', async () => {
    const violations = await validateFixtureWorkspace(fixture);

    expect(ofRule(violations, 'ambiguous-typescript-project-ownership')).toEqual([]);
  });

  it('still analyses the shared file', async () => {
    const { buildGraph } = await import('../../scripts/architecture/graph.mjs');
    const { discoverWorkspaces } = await import('../../scripts/shared/workspaces.mjs');

    const graph = buildGraph({
      workspaces: discoverWorkspaces(path.join(repoRoot, fixture)),
    }) as { nodes: Map<string, { relative: string }> };

    const files = [...graph.nodes.values()].map((node) => node.relative);
    expect(files.some((file) => file.endsWith('packages/shared/src/contested.ts'))).toBe(
      true,
    );
  });
});

// ===========================================================================
// §10 — two compatible claims plus one incompatible claim
// ===========================================================================

describe('§10 — one incompatible claim among several is still a finding', () => {
  const fixture = 'tests/fixtures/mixed-claim-majority';

  it('compiles under all four projects (real tsc)', () => {
    for (const project of [
      'packages/shared',
      'apps/one',
      'apps/two',
      'apps/rogue',
    ] as const) {
      expect(() => typecheck(`${fixture}/${project}/tsconfig.json`)).not.toThrow();
    }
  });

  it('fails closed even though two of the three projects agree', async () => {
    const violations = await validateFixtureWorkspace(fixture);
    const ambiguous = ofRule(violations, 'ambiguous-typescript-project-ownership');

    expect(ambiguous).toHaveLength(1);
    expect(ambiguous[0]?.file).toContain('packages/shared/src/contested.ts');
  });

  it('names the disagreeing project in the diagnostic', async () => {
    const violations = await validateFixtureWorkspace(fixture);
    const [ambiguous] = ofRule(violations, 'ambiguous-typescript-project-ownership');

    expect(ambiguous?.message).toContain('apps/rogue/tsconfig.json');
  });
});

// ===========================================================================
// §10 — claim ORDER does not change the verdict
// ===========================================================================

describe('§10 — the outcome does not depend on discovery order', () => {
  it.each([
    ['tests/fixtures/mixed-ownership', 1],
    ['tests/fixtures/mixed-claim-majority', 1],
    ['tests/fixtures/three-compatible', 0],
    ['tests/fixtures/compatible-ownership', 0],
  ] as const)(
    'reports the same ambiguity for %s in either order',
    async (fixture, expected) => {
      const forward = await ambiguousFilesInOrder(fixture, false);
      const reverse = await ambiguousFilesInOrder(fixture, true);

      expect(forward).toHaveLength(expected);

      // Identical CONTENT, not merely an identical count: reversing discovery
      // must not move which file is reported either.
      expect(reverse).toEqual(forward);
    },
  );
});
