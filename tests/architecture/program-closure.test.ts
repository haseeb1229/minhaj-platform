import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  repoRoot,
  runTsc,
  validateFixtureWorkspace,
  type ArchitectureViolation,
} from './architecture-harness.ts';

/**
 * Review #5 blockers B1 and B2 — the TypeScript PROGRAM is the authority.
 *
 * Both blockers are one mistake wearing two hats: the analyser decided which
 * files TypeScript compiles, instead of asking TypeScript.
 *
 *   B1 — ownership came from `parseJsonConfigFileContent().fileNames`, the
 *        project's ROOT list. `tsc -p` follows imports out of those roots and
 *        compiles what it finds, `exclude` notwithstanding. An excluded
 *        declaration reached from an included source was called "unowned",
 *        resolved with alias-free fallback options, and its `@/*` import of a
 *        Quran internal evaporated — while `tsc` passed.
 *
 *   B2 — graph membership came from walking preferred `src/` roots. A
 *        declaration at a WORKSPACE ROOT that TypeScript genuinely compiles
 *        was simply not a node, so the laundered edge through it did not exist
 *        as far as the analyser was concerned.
 *
 * The tests below assert the SPECIFIC outcome — which rule, against which
 * file, reaching which context — never merely that "something failed". A
 * fixture with a typo in it would satisfy a weaker assertion and prove nothing
 * (Review #4 §11, Review #5 §28).
 */

/** Violations reported for one fixture file, by path suffix. */
function forFile(
  violations: readonly ArchitectureViolation[],
  suffix: string,
): ArchitectureViolation[] {
  return violations.filter((violation) => violation.file.endsWith(suffix));
}

/** Rules reported for one fixture file. */
function rulesFor(
  violations: readonly ArchitectureViolation[],
  suffix: string,
): string[] {
  return forFile(violations, suffix).map((violation) => violation.rule);
}

/** The graph the analyser built for a fixture tree. */
async function graphFor(fixtureRoot: string): Promise<{
  nodes: Map<
    string,
    {
      relative: string;
      unownedByProject: boolean;
      imports: {
        specifier: string;
        resolved: { kind: string; relative?: string; configPath?: string | null };
      }[];
    }
  >;
}> {
  const { buildGraph } = await import('../../scripts/architecture/graph.mjs');
  const { discoverWorkspaces } = await import('../../scripts/shared/workspaces.mjs');

  return buildGraph({
    workspaces: discoverWorkspaces(path.join(repoRoot, fixtureRoot)),
  }) as never;
}

/** One node from a fixture graph, by path suffix. */
async function nodeFor(fixtureRoot: string, suffix: string) {
  const graph = await graphFor(fixtureRoot);

  for (const node of graph.nodes.values()) {
    if (node.relative.endsWith(suffix)) return node;
  }

  return null;
}

// ===========================================================================
// B1 — a file the Program loads is owned by the project that loaded it
// ===========================================================================

describe('B1 — an imported, EXCLUDED declaration keeps the real project config', () => {
  const fixture = 'tests/fixtures/program-closure';
  const project = `${fixture}/apps/app`;

  /**
   * Review #5's reproduction, exactly:
   *
   *   tsconfig    paths `@/*` -> ./src/*
   *               include src/**\/*.ts     exclude src/shared/**\/*
   *   messaging   imports ../../shared/barrel.d.ts   (an EXCLUDED file)
   *   barrel.d.ts imports @/contexts/quran/internal/repository
   */

  it('compiles for real — the bypass is only interesting if the build passes', () => {
    const tsc = runTsc(`${project}/tsconfig.json`);

    // This assertion was the one missing in Round 4 (Review #5 §28). Without
    // it, a fixture containing a plain type error would satisfy every
    // architecture assertion below while demonstrating no bypass at all.
    expect(tsc.ok, `tsc must succeed but reported:\n${tsc.output}`).toBe(true);
  });

  it('puts the excluded declaration in the graph', async () => {
    const node = await nodeFor(fixture, 'src/shared/barrel.d.ts');

    expect(node).not.toBeNull();
  });

  it('associates the excluded declaration with the SAME project config', async () => {
    const node = await nodeFor(fixture, 'src/shared/barrel.d.ts');

    // Not merely "some config" — the file must not be unowned, because being
    // unowned is exactly what stripped its aliases in Review #5.
    expect(node?.unownedByProject).toBe(false);

    const aliased = node?.imports.find((entry) =>
      entry.specifier.startsWith('@/contexts/quran'),
    );

    expect(aliased?.resolved.configPath).toContain(
      path.join('apps', 'app', 'tsconfig.json'),
    );
  });

  it("resolves the declaration's alias to the Quran INTERNAL, as tsc does", async () => {
    const node = await nodeFor(fixture, 'src/shared/barrel.d.ts');
    const aliased = node?.imports.find((entry) =>
      entry.specifier.startsWith('@/contexts/quran'),
    );

    expect(aliased?.resolved.kind).toBe('file');
    expect(aliased?.resolved.relative).toContain(
      'src/contexts/quran/internal/repository.ts',
    );
  });

  it('reports the laundered Messaging -> Quran dependency by name', async () => {
    const violations = await validateFixtureWorkspace(fixture);
    const laundered = forFile(violations, 'contexts/messaging/index.ts').find(
      (violation) => violation.rule === 'laundered-context-dependency',
    );

    expect(laundered).toBeDefined();

    // The exact contexts, the exact intermediary, the exact target. "Some
    // violation occurred" would pass for an unrelated defect.
    expect(laundered?.message).toContain("'messaging' may not depend on 'quran'");
    expect(laundered?.specifier).toContain('src/shared/barrel.d.ts');
    expect(laundered?.message).toContain('contexts/quran/internal/repository.ts');
  });

  it('reports the internals breach against the declaration itself', async () => {
    const violations = await validateFixtureWorkspace(fixture);

    expect(rulesFor(violations, 'src/shared/barrel.d.ts')).toContain(
      'composition-internal-import',
    );
  });
});

// ===========================================================================
// B2 — every repository-local module TypeScript compiles is a graph node
// ===========================================================================

describe('B2 — a workspace-ROOT declaration is an ordinary architecture node', () => {
  const fixture = 'tests/fixtures/root-declarations';

  /**
   * Four laundering chains, identical but for WHERE the declaration lives and
   * WHAT it is called. All four must fail, because none of those two facts is
   * an architectural property.
   */
  const cases = [
    {
      name: 'A — non-Next workspace root, named next-env.d.ts',
      workspace: 'plain',
      declaration: 'apps/plain/next-env.d.ts',
      consumer: 'contexts/messaging/via-next-env.ts',
    },
    {
      name: 'B — workspace root, ordinary name types.d.ts',
      workspace: 'plain',
      declaration: 'apps/plain/types.d.ts',
      consumer: 'contexts/messaging/via-types.ts',
    },
    {
      name: 'C — workspace root, listed in tsconfig `files`',
      workspace: 'listed',
      declaration: 'apps/listed/ambient.d.ts',
      consumer: 'apps/listed/src/contexts/messaging/consumer.ts',
    },
    {
      name: 'D — workspace root, EXCLUDED yet imported',
      workspace: 'excluded',
      declaration: 'apps/excluded/ambient.d.ts',
      consumer: 'apps/excluded/src/contexts/messaging/consumer.ts',
    },
  ] as const;

  for (const scenario of cases) {
    describe(scenario.name, () => {
      it('compiles for real', () => {
        const tsc = runTsc(`${fixture}/apps/${scenario.workspace}/tsconfig.json`);

        expect(tsc.ok, `tsc must succeed but reported:\n${tsc.output}`).toBe(true);
      });

      it('is present in the graph', async () => {
        const node = await nodeFor(fixture, scenario.declaration);

        // Review #5's B2: this node did not exist, so the edge through it did
        // not exist either, and the chain was invisible.
        expect(node, `${scenario.declaration} must be a graph node`).not.toBeNull();
      });

      it('reports the laundered Messaging -> Quran dependency', async () => {
        const violations = await validateFixtureWorkspace(fixture);
        const laundered = forFile(violations, scenario.consumer).find(
          (violation) => violation.rule === 'laundered-context-dependency',
        );

        expect(laundered).toBeDefined();
        expect(laundered?.message).toContain("'messaging' may not depend on 'quran'");
        expect(laundered?.message).toContain('contexts/quran/internal/repository.ts');
      });

      it('reports the internals breach against the declaration', async () => {
        const violations = await validateFixtureWorkspace(fixture);

        expect(rulesFor(violations, scenario.declaration)).toContain(
          'composition-internal-import',
        );
      });
    });
  }

  describe('E — the genuine generated Next declaration stays excluded', () => {
    it('compiles for real', () => {
      const tsc = runTsc(`${fixture}/apps/web/tsconfig.json`);

      expect(tsc.ok, `tsc must succeed but reported:\n${tsc.output}`).toBe(true);
    });

    it('is NOT a graph node', async () => {
      const node = await nodeFor(fixture, 'apps/web/next-env.d.ts');

      // The narrow exception (§11): workspace ROOT, and the workspace really
      // depends on `next`. Both halves are required, and the fixture above
      // proves the name alone buys nothing.
      expect(node).toBeNull();
    });

    it('reports nothing against the Next workspace', async () => {
      const violations = await validateFixtureWorkspace(fixture);

      expect(forFile(violations, 'apps/web/next-env.d.ts')).toEqual([]);
      expect(forFile(violations, 'apps/web/src/contexts/messaging/ordinary.ts')).toEqual(
        [],
      );
    });
  });
});
