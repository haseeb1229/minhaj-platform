import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  repoRoot,
  validateFixtureWorkspace,
  type ArchitectureViolation,
} from './architecture-harness.ts';

/**
 * Review #4 blockers B1, B2, B3 and non-blocker N1.
 *
 * Three of the four are the same mistake in different clothes: the analyser
 * decided something SECURITY-RELEVANT from a cheap, attacker-controlled signal.
 *
 *   B1 — the governing tsconfig was the NEAREST one on disk, so dropping a
 *        `tsconfig.json` next to your code redefined how your imports resolved.
 *   B2 — a file was excluded from the graph by BASENAME, so naming a
 *        declaration barrel `next-env.d.ts` removed it from analysis.
 *   B3 — "not inside `contexts/`" was read as "Layer 0", so the application
 *        composition layer was judged by the rules for the layer beneath every
 *        context — the exact inverse of the approved architecture.
 *   N1 — the conditional-export retry passed an option TypeScript does not
 *        recognise, so it repeated the first attempt verbatim. Review #5 then
 *        rejected the retry entirely: a fixed retry resolved specifiers the
 *        real project cannot resolve, so the analyser modelled a project that
 *        does not exist. It is removed, and both directions are asserted below.
 *
 * Every test below asserts the SPECIFIC expected outcome — which rule, against
 * which file, resolving to which target. "Some violation occurred" would also
 * pass for a fixture with a typo in it and would prove nothing (Review #4 §11).
 */

/** Violations reported for one fixture file, by filename. */
function forFile(
  violations: readonly ArchitectureViolation[],
  filename: string,
): ArchitectureViolation[] {
  return violations.filter((violation) => violation.file.endsWith(filename));
}

/** Rules reported for one fixture file. */
function rulesFor(
  violations: readonly ArchitectureViolation[],
  filename: string,
): string[] {
  return forFile(violations, filename).map((violation) => violation.rule);
}

/**
 * What the analyser RESOLVED one specifier to, as a repository-relative path.
 *
 * The point of B1 is not merely that a violation appears; it is that the
 * analyser and `tsc -p` land on the SAME FILE. A test asserting only that
 * something failed would still pass if the analyser resolved to some third,
 * equally wrong target.
 */
async function resolvedTargetOf(
  fixtureRoot: string,
  sourceFile: string,
  specifier: string,
): Promise<string | null> {
  const { buildGraph } = await import('../../scripts/architecture/graph.mjs');
  const { discoverWorkspaces } = await import('../../scripts/shared/workspaces.mjs');

  const graph = buildGraph({
    workspaces: discoverWorkspaces(path.join(repoRoot, fixtureRoot)),
  }) as {
    nodes: Map<
      string,
      {
        relative: string;
        imports: { specifier: string; resolved: { kind: string; relative?: string } }[];
      }
    >;
  };

  for (const node of graph.nodes.values()) {
    if (!node.relative.endsWith(sourceFile)) continue;

    for (const entry of node.imports) {
      if (entry.specifier !== specifier) continue;
      return entry.resolved.kind === 'file' ? (entry.resolved.relative ?? null) : null;
    }
  }

  return null;
}

// ===========================================================================
// B1 — the analyser uses the project that ACTUALLY COMPILES the file
// ===========================================================================

describe('B1 — an unreferenced nested tsconfig cannot redefine resolution', () => {
  const fixture = 'tests/fixtures/project-config';

  /**
   * Review #4's reproduction, exactly.
   *
   *   apps/app/tsconfig.json                       ~/*  ->  ./src/*
   *   apps/app/src/contexts/messaging/tsconfig.json
   *                                ~/contexts/quran ->  learning/index.ts
   *
   * `npm run typecheck` runs `tsc --noEmit -p tsconfig.json` at the workspace
   * root. NOTHING selects the nested config — it is not referenced, and no
   * script names it — so `tsc -p` maps `~/contexts/quran` to
   * `contexts/quran/index.ts` and the import is a forbidden Messaging -> Quran
   * edge. The old analyser searched upward, found the nested file first,
   * resolved to Learning, and reported a clean workspace.
   */
  it('resolves to the SAME file `tsc -p` resolves to, not the nested remap', async () => {
    const target = await resolvedTargetOf(
      fixture,
      'nested-config-bypass.ts',
      '~/contexts/quran',
    );

    // The decisive assertion: the real Quran source, verified during
    // remediation against `tsc -p tsconfig.json --traceResolution`, which
    // reports exactly this file.
    expect(target).toContain('src/contexts/quran/index.ts');
    expect(target).not.toContain('learning');
  });

  it('reports the forbidden Messaging -> Quran edge the nested config hid', async () => {
    const violations = await validateFixtureWorkspace(fixture);

    expect(rulesFor(violations, 'nested-config-bypass.ts')).toContain(
      'forbidden-context-dependency',
    );

    const [found] = forFile(violations, 'nested-config-bypass.ts');
    expect(found?.message).toContain("'messaging' may not depend on 'quran'");
  });

  it('is not satisfied by an unrelated parse or config error', async () => {
    // A fixture that failed to parse would also produce "a violation". The
    // fixture must be healthy and the finding must be the architectural one.
    const violations = await validateFixtureWorkspace(fixture);

    expect(violations.map((violation) => violation.rule)).not.toContain(
      'unreadable-tsconfig',
    );
    expect(violations.map((violation) => violation.rule)).not.toContain(
      'source-outside-typescript-project',
    );
  });
});

describe('B1 — a GENUINELY referenced project uses its own options', () => {
  const fixture = 'tests/fixtures/project-config';

  /**
   * The other half of the rule. Proximity is not authority — but a real
   * TypeScript project reference IS. `src/referenced` is a composite project
   * named in the root config's `references`, and it declares its own `^/*`
   * alias. `tsc --build` compiles those files under that project, so the
   * analyser must too.
   *
   * Without this test the fix could have been "always use the workspace root
   * config", which would be a different wrong answer: it would break every
   * legitimate composite build.
   */
  it('resolves a referenced project`s own alias', async () => {
    const target = await resolvedTargetOf(fixture, 'uses-own-alias.ts', '^/learning');

    expect(target).toContain('src/referenced/contexts/learning/index.ts');
  });

  it('permits the allowlisted edge inside the referenced project', async () => {
    const violations = await validateFixtureWorkspace(fixture);

    // messaging -> learning is the one permitted same-level edge (§3.2).
    expect(forFile(violations, 'uses-own-alias.ts')).toEqual([]);
  });

  it('still enforces the allowlist inside the referenced project', async () => {
    const violations = await validateFixtureWorkspace(fixture);

    expect(rulesFor(violations, 'reaches-quran.ts')).toContain(
      'forbidden-context-dependency',
    );
  });
});

describe('B1 — an inherited (extends) alias resolves', () => {
  const fixture = 'tests/fixtures/project-config';

  /**
   * `apps/extended/tsconfig.json` carries no `paths` of its own; the `%/*`
   * mapping comes from `shared/tsconfig.base.json` through `extends`. The
   * effective options are what matter, so the inherited mapping must resolve
   * exactly as a locally declared one would.
   */
  it('permits an allowlisted edge through an inherited alias', async () => {
    const violations = await validateFixtureWorkspace(fixture);

    expect(forFile(violations, 'inherited-allowed.ts')).toEqual([]);
  });

  it('rejects a forbidden edge through an inherited alias', async () => {
    const violations = await validateFixtureWorkspace(fixture);

    expect(rulesFor(violations, 'inherited-forbidden.ts')).toContain(
      'forbidden-context-dependency',
    );
  });
});

// ===========================================================================
// B2 — no file leaves the graph because of its NAME
// ===========================================================================

describe('B2 — an arbitrary `next-env.d.ts` stays in the graph', () => {
  const fixture = 'tests/fixtures/next-env-bypass';

  /**
   * Review #4's reproduction. `src/shared/next-env.d.ts` re-exports a Quran
   * internal declaration; Messaging imports through it. `tsc` passes, because
   * the types are real. The old analyser dropped the node purely because of its
   * basename, so the laundered dependency was invisible.
   *
   * A basename is chosen by whoever writes the file. Excluding on one is a
   * filename-based security control, which is to say not a control.
   */
  it('reports the laundered Messaging -> Quran dependency', async () => {
    const violations = await validateFixtureWorkspace(fixture);

    expect(rulesFor(violations, 'via-next-env.ts')).toContain(
      'laundered-context-dependency',
    );
  });

  it('names the declaration barrel in the reported path', async () => {
    const violations = await validateFixtureWorkspace(fixture);
    const [found] = forFile(violations, 'via-next-env.ts');

    // The chain must be visible, or the diagnostic cannot be acted on.
    expect(found?.message).toContain('shared/next-env.d.ts');
    expect(found?.message).toContain('quran');
  });

  it('keeps the barrel itself under analysis', async () => {
    const violations = await validateFixtureWorkspace(fixture);

    // The barrel is a repository-local declaration reaching a context's
    // internals, and is judged on its own account too.
    expect(rulesFor(violations, 'shared/next-env.d.ts')).toContain(
      'composition-internal-import',
    );
  });
});

describe('B2 — the genuine Next-generated declaration is still excluded', () => {
  /**
   * The narrow, identity-anchored exclusion. `apps/web/next-env.d.ts` is
   * written by Next, sits at the ROOT of a workspace whose manifest depends on
   * `next`, and expresses no authored dependency.
   *
   * Asserted against the REAL repository rather than a fixture, because the
   * whole point is that the exclusion is anchored to a real workspace identity.
   */
  it('does not report the real repository`s generated declaration', async () => {
    const { validateArchitecture } = await import('./architecture-harness.ts');
    const { violations, graph } = await validateArchitecture();

    expect(violations).toEqual([]);

    const generated = [...graph.nodes.keys()].filter((file) =>
      String(file).replaceAll('\\', '/').endsWith('apps/web/next-env.d.ts'),
    );

    expect(generated, 'the generated root declaration is not walked').toEqual([]);
  });
});

// ===========================================================================
// B3 — Layer 4 composition is NOT Layer 0
// ===========================================================================

describe('B3 — Layer 4 composition may compose many contexts', () => {
  const fixture = 'tests/fixtures/layer4';

  /**
   * DOMAIN_MODEL.md §3.3: "Pages that span contexts … are composed at Layer 4,
   * which may call many contexts." ARCHITECTURE.md §6.1 places Layer 4 at the
   * TOP of the stack. The old rule reported `layer-zero-upward-dependency` for
   * exactly this, which made the approved architecture unimplementable.
   */
  it('PERMITS a page importing a context`s public interface', async () => {
    const violations = await validateFixtureWorkspace(fixture);

    expect(forFile(violations, 'app/page.ts')).toEqual([]);
  });

  it('PERMITS a page composing several contexts` public interfaces', async () => {
    const violations = await validateFixtureWorkspace(fixture);

    expect(forFile(violations, 'app/hub.ts')).toEqual([]);
  });

  it('never reports layer-zero-upward-dependency against composition', async () => {
    const violations = await validateFixtureWorkspace(fixture);

    expect(rulesFor(violations, 'app/page.ts')).not.toContain(
      'layer-zero-upward-dependency',
    );
    expect(rulesFor(violations, 'app/hub.ts')).not.toContain(
      'layer-zero-upward-dependency',
    );
  });
});

describe('B3 — composition is public interfaces, never internals', () => {
  const fixture = 'tests/fixtures/layer4';

  /**
   * The limit that keeps the fix from becoming a new hole. "May compose many
   * contexts" is about BREADTH, not DEPTH: ARCHITECTURE.md §6.3 rule 4 —
   * "Interface-only cross-context imports" — is addressed to every consumer.
   */
  it('REJECTS a page reaching a context`s internal implementation', async () => {
    const violations = await validateFixtureWorkspace(fixture);

    expect(rulesFor(violations, 'app/deep.ts')).toContain('composition-internal-import');
  });

  it('names the internal path it refused', async () => {
    const violations = await validateFixtureWorkspace(fixture);
    const [found] = forFile(violations, 'app/deep.ts');

    expect(found?.message).toContain('internal/repository.ts');
    expect(found?.message).toContain('quran');
  });
});

describe('B3 — the context DAG and Layer 0 are untouched', () => {
  const fixture = 'tests/fixtures/layer4';

  /**
   * The regression guard. Layer 4 composing Quran must NOT have relaxed
   * anything else: `messaging -> quran` stays forbidden, and a genuine Layer 0
   * package reaching a context stays a layering inversion.
   *
   * The three findings also carry THREE DISTINCT rule codes, so a reader can
   * tell which rule fired without reading the prose (Review #4 §5.5).
   */
  it('still rejects Messaging -> Quran', async () => {
    const violations = await validateFixtureWorkspace(fixture);

    expect(rulesFor(violations, 'contexts/messaging/index.ts')).toContain(
      'forbidden-context-dependency',
    );
  });

  it('still rejects a Layer 0 package reaching a context', async () => {
    const violations = await validateFixtureWorkspace(fixture);

    expect(rulesFor(violations, 'packages/contracts/src/index.ts')).toContain(
      'layer-zero-upward-dependency',
    );
  });

  it('distinguishes the three findings by rule code', async () => {
    const violations = await validateFixtureWorkspace(fixture);
    const rules = new Set(violations.map((violation) => violation.rule));

    // Context dependency, deep/internal interface breach, and Layer-0 upward
    // dependency are three different architectural statements and must not be
    // reported under one code.
    expect(rules).toContain('forbidden-context-dependency');
    expect(rules).toContain('composition-internal-import');
    expect(rules).toContain('layer-zero-upward-dependency');
  });
});

// ===========================================================================
// N1 — conditional resolution matches the REAL project, in both directions
// ===========================================================================

describe('N1 — architecture resolution mirrors the project, never invents conditions', () => {
  /**
   * Review #5 (N1) found the analyser disagreeing with the build:
   *
   *   real project options  ->  TS2307, nothing resolves
   *   analyser              ->  retries with forced server conditions and
   *                             finds `server-branch.ts`
   *
   * The retry was well-intentioned — "the graph should see what the server
   * loads" — but it modelled a project that does not exist. It is gone. The
   * rule is now unconditional: architecture resolution uses the effective
   * options of the real TypeScript project and nothing else.
   *
   * Both directions are asserted, because either alone is satisfiable by an
   * analyser that is simply broken: one fixture's project DECLARES
   * `customConditions` and must resolve, the other declares none and must
   * resolve nothing.
   *
   * The oracle is TypeScript itself — `ts.resolveModuleName` under the
   * project's own parsed options, through the same workspace redirect the
   * analyser uses. Shelling out to `tsc -p` cannot serve here: these fixture
   * packages are reached by package NAME and an isolated fixture tree has no
   * `node_modules` links, so real `tsc` fails on both fixtures for a reason
   * that has nothing to do with conditions. (`runTsc` is used where it IS the
   * right oracle — see the B-01 suite, where every import is relative or
   * aliased and `tsc -p` genuinely compiles the tree.)
   */

  /** What TypeScript resolves a specifier to under a project's real options. */
  async function projectResolves(
    fixtureRoot: string,
    sourceFile: string,
    specifier: string,
  ): Promise<string | null> {
    const ts = (await import('typescript')).default;
    const { discoverWorkspaces, workspacePackageMap } =
      await import('../../scripts/shared/workspaces.mjs');
    const { createWorkspaceRedirect } =
      await import('../../scripts/architecture/resolver.mjs');
    const { buildProjectIndex, effectiveOptionsFor } =
      await import('../../scripts/architecture/tsconfig.mjs');

    const absoluteRoot = path.join(repoRoot, fixtureRoot);
    const workspaces = discoverWorkspaces(absoluteRoot);
    const redirect = createWorkspaceRedirect(workspacePackageMap(workspaces));
    const projectIndex = buildProjectIndex(workspaces, redirect);

    const importer = path.join(absoluteRoot, sourceFile);
    const { options } = effectiveOptionsFor(importer, { projectIndex }) as {
      options: Record<string, unknown>;
    };

    const host = {
      fileExists: (file: string) => ts.sys.fileExists(redirect(file)),
      readFile: (file: string) => ts.sys.readFile(redirect(file)),
      directoryExists: (dir: string) => ts.sys.directoryExists(redirect(dir)),
      getDirectories: (dir: string) => ts.sys.getDirectories(redirect(dir)),
      getCurrentDirectory: () => repoRoot,
      realpath: (file: string) => redirect(file),
    };

    const resolved = ts.resolveModuleName(
      specifier,
      importer,
      options as never,
      host,
      undefined,
      undefined,
      ts.ModuleKind.ESNext,
    );

    const file = resolved.resolvedModule?.resolvedFileName;
    return file === undefined
      ? null
      : path.relative(repoRoot, file).split(path.sep).join('/');
  }

  describe('a project that DECLARES customConditions', () => {
    const fixture = 'tests/fixtures/conditional-exports';
    const source = 'apps/app/src/contexts/messaging/via-conditional.ts';

    it('agrees with the project: both resolve the server branch', async () => {
      const project = await projectResolves(fixture, source, '@fixture/dual');
      const analyser = await resolvedTargetOf(
        fixture,
        'via-conditional.ts',
        '@fixture/dual',
      );

      // `react-server` is the condition the PROJECT declares, so this is the
      // build's own answer rather than one the analyser supplied.
      expect(project).toContain('packages/dual/src/server-branch.ts');
      expect(analyser).toBe(project);
      expect(analyser).not.toContain('browser-branch');
    });

    it('classifies the resolved workspace rather than losing the edge', async () => {
      const violations = await validateFixtureWorkspace(fixture);

      expect(rulesFor(violations, 'via-conditional.ts')).toContain(
        'context-unclassified-workspace',
      );
    });
  });

  describe('a project that declares NO customConditions', () => {
    const fixture = 'tests/fixtures/conditional-unset';
    const source = 'apps/app/src/contexts/messaging/via-conditional.ts';

    /**
     * The same package and the same import, with no `default` branch — but
     * this project sets no conditions, so TypeScript resolves nothing.
     */
    it('agrees with the project: neither resolves anything', async () => {
      const project = await projectResolves(fixture, source, '@fixture/dual');
      const analyser = await resolvedTargetOf(
        fixture,
        'via-conditional.ts',
        '@fixture/dual',
      );

      expect(project).toBeNull();

      // Before Round 5 this returned `packages/dual/src/server-branch.ts` —
      // the analyser resolving under conditions the project never set.
      expect(analyser).toBeNull();
    });

    it('reports the unresolved workspace specifier rather than ignoring it', async () => {
      const violations = await validateFixtureWorkspace(fixture);

      // Removing the retry means the analyser now resolves nothing here, just
      // as `tsc -p` resolves nothing. Silence would be a different
      // disagreement with the build, so the broken import is reported — and a
      // specifier naming a KNOWN workspace is never written off as an ordinary
      // third-party package.
      expect(rulesFor(violations, 'via-conditional.ts')).toEqual(['unresolved-import']);
    });
  });
});
