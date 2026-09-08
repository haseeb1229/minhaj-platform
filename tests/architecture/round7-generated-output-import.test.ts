import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  repoRoot,
  validateFixtureWorkspace,
  type ArchitectureViolation,
} from './architecture-harness.ts';

/**
 * Round 7 B3 — an authored import INTO generated output fails closed.
 *
 * Review #7 wrote, from authored Messaging source:
 *
 *     export { … } from '../../../dist/barrel.js';
 *
 * `dist` is the project's CONFIGURED `outDir`. TypeScript resolves that
 * specifier to the emitted declaration `dist/barrel.d.ts`, which re-exports a
 * Quran internal, and real `tsc` succeeds. The analyser resolved the target
 * correctly — and then discarded it, because it lived under a generated root.
 * Zero violations for an edge that genuinely crosses a context boundary.
 *
 * The generated-root exclusion is right for SEEDING and wrong for EDGES (§12).
 * Build output must not become an architecture node: it exists only after a
 * build, and seeding it made the analyser's verdict depend on whether someone
 * had run one. But IMPORTING build output is a different act from PRODUCING it,
 * and it is the import that is the finding.
 *
 * So generated output is still not a node (§16), and the authored edge into it
 * is now reported as `source-imports-generated-output`.
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

/** Repository-relative paths of every node in a fixture graph. */
async function nodePaths(fixtureRoot: string): Promise<string[]> {
  const { buildGraph } = await import('../../scripts/architecture/graph.mjs');
  const { discoverWorkspaces } = await import('../../scripts/shared/workspaces.mjs');

  const graph = buildGraph({
    workspaces: discoverWorkspaces(path.join(repoRoot, fixtureRoot)),
  }) as { nodes: Map<string, { relative: string }> };

  return [...graph.nodes.values()].map((node) => node.relative).sort();
}

// ===========================================================================
// B3 — the exact Review #7 reproduction
// ===========================================================================

describe('B3 — importing a configured outDir is a violation, not a silent drop', () => {
  const fixture = 'tests/fixtures/generated-output-import';
  const app = `${fixture}/apps/app`;

  it('real tsc accepts the import into generated output', () => {
    // The premise: the BUILD passes. Without this the fixture would prove
    // nothing about a bypass (§23).
    expect(() => typecheck(`${app}/tsconfig.json`)).not.toThrow();
  });

  it('resolves the specifier to the emitted declaration', async () => {
    const { buildGraph } = await import('../../scripts/architecture/graph.mjs');
    const { discoverWorkspaces } = await import('../../scripts/shared/workspaces.mjs');

    const graph = buildGraph({
      workspaces: discoverWorkspaces(path.join(repoRoot, fixture)),
    }) as {
      nodes: Map<
        string,
        {
          relative: string;
          imports: { specifier: string; generatedTarget: string | null }[];
        }
      >;
    };

    const messaging = [...graph.nodes.values()].find((node) =>
      node.relative.endsWith('contexts/messaging/index.ts'),
    );

    const entry = messaging?.imports.find(
      (candidate) => candidate.specifier === '../../../dist/barrel.js',
    );

    // The analyser's resolution is not the broken half — it correctly finds
    // `dist/barrel.d.ts`. What was broken was what it did next.
    expect(entry?.generatedTarget).toBe(`${app}/dist/barrel.d.ts`);
  });

  it('emits source-imports-generated-output for the authored edge', async () => {
    const violations = await validateFixtureWorkspace(fixture);
    const reported = ofRule(violations, 'source-imports-generated-output');

    expect(
      reported.some(
        (violation) =>
          violation.file === `${app}/src/contexts/messaging/index.ts` &&
          violation.specifier === '../../../dist/barrel.js',
      ),
    ).toBe(true);
  });

  it('names the resolved target and the generated root in the diagnostic', async () => {
    const violations = await validateFixtureWorkspace(fixture);
    const [reported] = ofRule(violations, 'source-imports-generated-output').filter(
      (violation) => violation.specifier === '../../../dist/barrel.js',
    );

    expect(reported).toBeDefined();
    // §13 — importing source, resolved generated target, generated root, and
    // the originating workspace.
    expect(reported?.message).toContain(`${app}/dist/barrel.d.ts`);
    expect(reported?.message).toContain(`${app}/dist`);
    expect(reported?.message).toContain('@fixture/generated-output-import');
  });

  it('never silently discards: the run is not clean', async () => {
    const violations = await validateFixtureWorkspace(fixture);

    // The precise shape of the defect was ZERO violations on a tree containing
    // a real laundered edge.
    expect(violations.length).toBeGreaterThan(0);
  });

  it('does NOT turn generated output into an architecture node (§16)', async () => {
    const files = await nodePaths(fixture);

    // The emitted declaration is the subject of a violation, never a governed
    // production source file. Making it a node is the other way to get this
    // wrong, and it would reintroduce clean-vs-built instability.
    expect(files.some((file) => file.includes('/dist/'))).toBe(false);
    expect(files.some((file) => file.includes('/types/'))).toBe(false);

    // Authored source is still analysed normally.
    expect(files).toContain(`${app}/src/contexts/messaging/index.ts`);
    expect(files).toContain(`${app}/src/contexts/quran/internal.ts`);
  });
});

// ===========================================================================
// §14/§15 — declarationDir, and alias as well as relative specifiers
// ===========================================================================

describe('§14/§15 — every route into a canonical generated root fails closed', () => {
  const fixture = 'tests/fixtures/generated-output-import';
  const app = `${fixture}/apps/app`;

  /**
   * Three genuinely different routes to the same class of target. The check
   * runs on the RESOLVED path, so the specifier's own spelling — relative or
   * aliased — is irrelevant, which is exactly the property being asserted.
   */
  const routes = [
    [
      'relative into outDir',
      'src/contexts/messaging/index.ts',
      '../../../dist/barrel.js',
    ],
    ['alias into outDir', 'src/contexts/messaging/via-alias.ts', '#generated/barrel.js'],
    [
      'relative into declarationDir',
      'src/contexts/messaging/via-declaration-dir.ts',
      '../../../types/declared.js',
    ],
  ] as const;

  it('real tsc accepts all three routes', () => {
    expect(() => typecheck(`${app}/tsconfig.json`)).not.toThrow();
  });

  it.each(routes)('reports the %s', async (_label, file, specifier) => {
    const violations = await validateFixtureWorkspace(fixture);
    const reported = ofRule(violations, 'source-imports-generated-output');

    expect(
      reported.some(
        (violation) =>
          violation.file === `${app}/${file}` && violation.specifier === specifier,
      ),
    ).toBe(true);
  });

  it('reports the declarationDir root as itself, not as outDir', async () => {
    const violations = await validateFixtureWorkspace(fixture);
    const [reported] = ofRule(violations, 'source-imports-generated-output').filter(
      (violation) => violation.specifier === '../../../types/declared.js',
    );

    // `declarationDir` is configured separately from `outDir` (§14). Naming the
    // wrong root would send someone to the wrong place to fix it.
    expect(reported?.message).toContain(`${app}/types`);
  });
});

// ===========================================================================
// §14/§17 CONTROL — generated output that nobody imports changes nothing
// ===========================================================================

describe('§17 — generated output alone never affects the verdict', () => {
  const fixture = 'tests/fixtures/generated-outdir';

  it('compiles with real tsc', () => {
    expect(() => typecheck(`${fixture}/apps/app/tsconfig.json`)).not.toThrow();
  });

  it('stays clean when generated output exists but nothing imports it', async () => {
    const violations = await validateFixtureWorkspace(fixture);

    // This fixture has a populated `outDir` on disk and no authored edge into
    // it. Only a SOURCE EDGE may trigger the new rule; the mere existence of
    // build output must not, or a built tree and a clean checkout would
    // disagree (§17).
    expect(ofRule(violations, 'source-imports-generated-output')).toEqual([]);
    expect(violations).toEqual([]);
  });
});

// ===========================================================================
// §17 — the real repository is stable across a build
// ===========================================================================

describe('§17 — the production tree never imports its own build output', () => {
  it('reports no source-imports-generated-output in real production source', async () => {
    const { validateArchitecture } = await import('./architecture-harness.ts');
    const { violations } = await validateArchitecture();

    expect(ofRule(violations, 'source-imports-generated-output')).toEqual([]);
  });
});
