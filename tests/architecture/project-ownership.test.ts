import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  repoRoot,
  validateFixtureWorkspace,
  type ArchitectureViolation,
} from './architecture-harness.ts';

/**
 * Round 5 §6 and §10 — ownership is deterministic, and nothing disappears.
 *
 * Taking ownership from a real `ts.Program` raised two questions the root-file
 * list never had to answer:
 *
 *   §6  A file can appear in more than one Program. Which project owns it?
 *       Deterministically: a referenced child project first, then a declared
 *       root input, then a closure-only claim. And where two INDEPENDENT
 *       projects would resolve the file's imports DIFFERENTLY, no answer is
 *       correct — so the gate fails closed rather than picking the convenient
 *       one, which is how every bypass in this remediation started.
 *
 *   §10 A resolved repository-local target must never simply vanish. It either
 *       becomes a node with a project identity, or it becomes a node that is
 *       REPORTED as outside known ownership. What it may not do is be treated
 *       like an external npm package because discovery did not reach it.
 */

/** Violations of one rule. */
function ofRule(
  violations: readonly ArchitectureViolation[],
  rule: string,
): ArchitectureViolation[] {
  return violations.filter((violation) => violation.rule === rule);
}

/** The graph the analyser built for a fixture tree. */
async function graphFor(fixtureRoot: string): Promise<{
  nodes: Map<string, { relative: string; unownedByProject: boolean }>;
}> {
  const { buildGraph } = await import('../../scripts/architecture/graph.mjs');
  const { discoverWorkspaces } = await import('../../scripts/shared/workspaces.mjs');

  return buildGraph({
    workspaces: discoverWorkspaces(path.join(repoRoot, fixtureRoot)),
  }) as never;
}

/** Repository-relative paths of every node in a fixture graph. */
async function nodePaths(fixtureRoot: string): Promise<string[]> {
  const graph = await graphFor(fixtureRoot);
  return [...graph.nodes.values()].map((node) => node.relative).sort();
}

// ===========================================================================
// §6 — ambiguous ownership fails closed
// ===========================================================================

describe('§6 — two projects that resolve one file differently is a finding', () => {
  const fixture = 'tests/fixtures/ambiguous-ownership';

  /**
   * `shared/contested.ts` is compiled by `apps/alpha` AND `apps/beta`, which
   * map the same `#shared/*` alias to different directories. Its single import
   * resolves to two different files depending on which project is building.
   */

  it('reports `ambiguous-typescript-project-ownership` against the contested file', async () => {
    const violations = await validateFixtureWorkspace(fixture);
    const ambiguous = ofRule(violations, 'ambiguous-typescript-project-ownership');

    expect(ambiguous).toHaveLength(1);
    expect(ambiguous[0]?.file).toContain('shared/contested.ts');
  });

  it('names both competing projects, so the reader can fix it', async () => {
    const violations = await validateFixtureWorkspace(fixture);
    const [ambiguous] = ofRule(violations, 'ambiguous-typescript-project-ownership');

    expect(ambiguous?.message).toContain('apps/alpha/tsconfig.json');
    expect(ambiguous?.message).toContain('apps/beta/tsconfig.json');
  });

  it('does NOT report ambiguity where two projects agree', async () => {
    // `project-config` has a parent and a genuinely REFERENCED child. Both
    // compile overlapping sources, and ownership there is deterministic — the
    // referenced child wins — so no ambiguity may be reported.
    const violations = await validateFixtureWorkspace('tests/fixtures/project-config');

    expect(ofRule(violations, 'ambiguous-typescript-project-ownership')).toEqual([]);
  });

  it('does not report ambiguity anywhere in production source', async () => {
    const { validateArchitecture } = await import('./architecture-harness.ts');
    const { violations } = await validateArchitecture();

    expect(ofRule(violations, 'ambiguous-typescript-project-ownership')).toEqual([]);
  });
});

// ===========================================================================
// §10 — a resolved repository-local target never disappears
// ===========================================================================

describe('§10 — a local module outside every workspace is reported, not dropped', () => {
  const fixture = 'tests/fixtures/ambiguous-ownership';

  it('puts the shared out-of-workspace module in the graph', async () => {
    const paths = await nodePaths(fixture);

    // Sitting beside `apps/` rather than inside it, this file belongs to no
    // workspace — and is compiled by two projects. Before Round 5 it was
    // silently absent, and the edges into it did not exist.
    expect(paths.some((file) => file.endsWith('shared/contested.ts'))).toBe(true);
    expect(paths.some((file) => file.endsWith('shared/alias-a/target.ts'))).toBe(true);
  });

  it('reports it as `source-outside-any-workspace` rather than passing it', async () => {
    const violations = await validateFixtureWorkspace(fixture);
    const orphaned = ofRule(violations, 'source-outside-any-workspace');

    expect(orphaned.map((violation) => violation.file).sort()).toEqual([
      'tests/fixtures/ambiguous-ownership/shared/alias-a/target.ts',
      'tests/fixtures/ambiguous-ownership/shared/alias-b/target.ts',
      'tests/fixtures/ambiguous-ownership/shared/contested.ts',
    ]);
  });

  it('distinguishes "no workspace" from "workspace with no role"', async () => {
    const violations = await validateFixtureWorkspace(fixture);

    // Two different problems with two different fixes. Reporting the first as
    // the second told a reader to classify a workspace that does not exist.
    expect(ofRule(violations, 'unclassified-workspace-role')).toEqual([]);
    expect(ofRule(violations, 'source-outside-any-workspace').length).toBeGreaterThan(0);
  });

  it('excludes GENERATED output from the Program closure', async () => {
    const { validateArchitecture } = await import('./architecture-harness.ts');
    const { graph } = await validateArchitecture();

    const generated = [...graph.nodes.keys()].filter((file) =>
      file.split(path.sep).includes('.next'),
    );

    // `apps/web/.next/types/*.d.ts` is written by `next build` and genuinely
    // enters the application's Program, so the closure offers it. It is build
    // OUTPUT, not authored source, and it exists only on a machine that has
    // run a build — so including it made the analyser see a different number
    // of files in a developer's tree than in a clean CI checkout. A gate whose
    // inputs depend on whether someone happened to build locally is not a gate.
    expect(generated).toEqual([]);
  });

  it('reports no orphaned source in production', async () => {
    const { validateArchitecture } = await import('./architecture-harness.ts');
    const { violations } = await validateArchitecture();

    expect(ofRule(violations, 'source-outside-any-workspace')).toEqual([]);
  });
});
