import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  repoRoot,
  validateFixtureWorkspace,
  type ArchitectureViolation,
} from './architecture-harness.ts';

/**
 * Round 6 B2 — generated output is identified by CANONICAL ROOT, never by name.
 *
 * Review #6 planted authored production source at `src/dist/barrel.ts`:
 *
 *     src/contexts/messaging/index.ts -> src/dist/barrel.ts
 *                                     -> src/contexts/quran/internal.ts
 *
 * The workspace tsconfig includes every `.ts` under `src`, real `tsc` compiles
 * the barrel, and it is authored code by every honest reading. The analyser
 * nonetheless discarded it — from the Program seed AND from the recursive
 * worklist — because a path segment was spelled `dist`, and the forbidden
 * Messaging -> Quran edge vanished with it.
 *
 * A directory name is chosen by whoever writes the code. Granting it security
 * meaning is the same defect as trusting a basename, which Review #4 already
 * closed for `next-env.d.ts`. Generated output is now recognised only by
 * IDENTITY: a real `node_modules`, a real Next `.next`, or a project's
 * configured `outDir`/`declarationDir`.
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
// B2 — authored source in generated-LOOKING directories
// ===========================================================================

describe('B2 — a directory NAME does not make authored source generated', () => {
  const fixture = 'tests/fixtures/authored-generated-names';

  /**
   * Every barrel below is authored source that launders the same forbidden
   * edge. `dist` is Review #6's exact reproduction; the rest prove the fix is
   * about the RULE rather than about one spelling.
   */
  const barrels = [
    'src/dist/barrel.ts',
    'src/build/barrel.ts',
    'src/coverage/barrel.ts',
    'src/cache/barrel.ts',
    // §17 — the generated-looking segment nested deeper in the path.
    'src/features/dist/barrel.ts',
    'src/something/build/internal.ts',
  ] as const;

  it('compiles every authored barrel with real tsc', () => {
    // If this fails the fixture is not reproducing the defect: the whole
    // premise is that TypeScript genuinely compiles these files.
    expect(() => typecheck(`${fixture}/apps/app/tsconfig.json`)).not.toThrow();
  });

  it.each(barrels)('puts authored %s in the graph', async (barrel) => {
    const files = await nodePaths(fixture);

    expect(files.some((file) => file.endsWith(barrel))).toBe(true);
  });

  it.each(barrels)('rejects the prohibited dependency through %s', async (barrel) => {
    const violations = await validateFixtureWorkspace(fixture);
    const offending = violations.filter((violation) => violation.file.endsWith(barrel));

    // The barrel reaches `contexts/quran/internal.ts`, which no file outside
    // the Quran context may import.
    expect(offending.length).toBeGreaterThan(0);
    expect(offending.map((violation) => violation.specifier).join(' ')).toContain(
      'contexts/quran/internal',
    );
  });

  it('reproduces Review #6 exactly: src/dist/barrel.ts is caught', async () => {
    const violations = await validateFixtureWorkspace(fixture);
    const internalImports = ofRule(violations, 'composition-internal-import');

    expect(
      internalImports.some((violation) => violation.file.endsWith('src/dist/barrel.ts')),
    ).toBe(true);
  });

  it('sees the Messaging edge INTO the generated-looking barrel', async () => {
    const violations = await validateFixtureWorkspace(fixture);

    // Both halves of the laundering chain must be visible: the edge into the
    // barrel and the barrel's own forbidden import.
    expect(
      violations.some(
        (violation) =>
          violation.file.endsWith('contexts/messaging/index.ts') &&
          violation.specifier.includes('dist/barrel'),
      ),
    ).toBe(true);
  });
});

// ===========================================================================
// §18 — genuine generated roots stay excluded
// ===========================================================================

describe('§18 — a CONFIGURED outDir is still treated as generated output', () => {
  const fixture = 'tests/fixtures/generated-outdir';

  it('compiles with real tsc', () => {
    expect(() => typecheck(`${fixture}/apps/app/tsconfig.json`)).not.toThrow();
  });

  it('keeps emitted output out of the graph', async () => {
    const files = await nodePaths(fixture);

    // `generated/` is this project's configured `outDir`. Unlike `src/dist`,
    // it is genuinely compiler output and is excluded by IDENTITY.
    expect(files.some((file) => file.includes('/generated/'))).toBe(false);
  });

  it('still analyses the authored sources of the same workspace', async () => {
    const files = await nodePaths(fixture);

    expect(files.some((file) => file.endsWith('contexts/messaging/index.ts'))).toBe(true);
    expect(files.some((file) => file.endsWith('contexts/quran/internal.ts'))).toBe(true);
  });
});

// ===========================================================================
// §18/§28 — the real repository is stable across a build
// ===========================================================================

describe('§18 — real generated roots remain out of production architecture', () => {
  it('never carries a node from apps/web/.next', async () => {
    const { validateArchitecture } = await import('./architecture-harness.ts');
    const { graph } = (await validateArchitecture()) as {
      graph: { nodes: Map<string, { relative: string }> };
    };

    const files = [...graph.nodes.values()].map((node) => node.relative);

    // `next build` writes `.next/types/*.d.ts`, and the app's Program loads
    // it. Excluding it by canonical root is what keeps the analyser's own file
    // count identical on a clean checkout and on a built tree (§28).
    expect(files.some((file) => file.includes('.next/'))).toBe(false);
  });

  it('never carries a node from node_modules', async () => {
    const { validateArchitecture } = await import('./architecture-harness.ts');
    const { graph } = (await validateArchitecture()) as {
      graph: { nodes: Map<string, { relative: string }> };
    };

    const files = [...graph.nodes.values()].map((node) => node.relative);

    expect(files.some((file) => file.includes('node_modules/'))).toBe(false);
  });
});
