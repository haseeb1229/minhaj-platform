import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  repoRoot,
  validateFixtureWorkspace,
  type ArchitectureViolation,
} from './architecture-harness.ts';

/**
 * Round 6 — the two blockers Independent Review #6 reproduced.
 *
 *   B1  A file ROOT-owned by one project and pulled into an INDEPENDENT
 *       project's Program CLOSURE was resolved with the ROOT project's
 *       options, purely because ROOT outranks CLOSURE. Both projects really
 *       compile, their `#target` mappings really differ, and the analyser
 *       answered for the build that was NOT introducing the violation — so a
 *       Messaging -> Quran-internal edge existed in `tsc -p apps/web` and was
 *       invisible to the gate.
 *
 *   B2  Generated output was recognised by DIRECTORY NAME. `src/dist/barrel.ts`
 *       is authored production source that real `tsc` compiles, but a path
 *       segment spelled `dist` deleted it from both the Program seed and the
 *       recursive worklist, taking its laundered edge with it.
 *
 * Both are tested against REAL `tsc` runs (§27): a fixture only proves
 * something if the compiler genuinely accepts it.
 */

/** Violations of one rule. */
function ofRule(
  violations: readonly ArchitectureViolation[],
  rule: string,
): ArchitectureViolation[] {
  return violations.filter((violation) => violation.rule === rule);
}

/**
 * Runs the real TypeScript compiler over a fixture project.
 *
 * Throws with the compiler's own output when the project does not build, so a
 * fixture that has stopped reproducing its defect fails loudly rather than
 * passing for the wrong reason.
 */
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

/** Where one specifier lands under one project's real options. */
async function resolveUnderProject(
  projectRelativePath: string,
  specifier: string,
  containingFileRelativePath: string,
): Promise<string> {
  const { ts } = await import('../../scripts/architecture/tsconfig.mjs');

  const configPath = path.join(repoRoot, projectRelativePath);
  const raw = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(
    raw.config,
    ts.sys,
    path.dirname(configPath),
  );

  const resolved = ts.resolveModuleName(
    specifier,
    path.join(repoRoot, containingFileRelativePath),
    parsed.options,
    ts.sys,
  ).resolvedModule;

  return resolved === undefined
    ? '(unresolved)'
    : path.relative(repoRoot, resolved.resolvedFileName).split(path.sep).join('/');
}

// ===========================================================================
// B1 — incompatible mixed ROOT/CLOSURE ownership
// ===========================================================================

describe('B1 — a ROOT claim does not silence an incompatible independent project', () => {
  const fixture = 'tests/fixtures/mixed-ownership';
  const contracts = `${fixture}/packages/contracts/tsconfig.json`;
  const web = `${fixture}/apps/web/tsconfig.json`;
  const contested = `${fixture}/packages/contracts/src/contested.ts`;

  it('compiles under the ROOT-owning project (real tsc)', () => {
    expect(() => typecheck(contracts)).not.toThrow();
  });

  it('compiles under the independent CLOSURE project too (real tsc)', () => {
    expect(() => typecheck(web)).not.toThrow();
  });

  it('resolves the contested import to DIFFERENT files in the two projects', async () => {
    // This is the whole defect: one file, two real builds, two answers.
    const underContracts = await resolveUnderProject(contracts, '#target', contested);
    const underWeb = await resolveUnderProject(web, '#target', contested);

    expect(underContracts).toContain('packages/contracts/src/safe/target.ts');
    expect(underWeb).toContain('apps/web/src/contexts/quran/internal.ts');
    expect(underContracts).not.toEqual(underWeb);
  });

  it('does NOT silently adopt the ROOT project and pass', async () => {
    const violations = await validateFixtureWorkspace(fixture);

    // Before Round 6 the gate resolved `#target` with the Contracts project,
    // saw a benign local type, and reported nothing at all about this file.
    expect(violations.length).toBeGreaterThan(0);
  });

  it('fails closed with `ambiguous-typescript-project-ownership`', async () => {
    const violations = await validateFixtureWorkspace(fixture);
    const ambiguous = ofRule(violations, 'ambiguous-typescript-project-ownership');

    expect(ambiguous).toHaveLength(1);
    expect(ambiguous[0]?.file).toContain('packages/contracts/src/contested.ts');
  });

  it('names BOTH competing project configs in the diagnostic', async () => {
    const violations = await validateFixtureWorkspace(fixture);
    const [ambiguous] = ofRule(violations, 'ambiguous-typescript-project-ownership');

    expect(ambiguous?.message).toContain('packages/contracts/tsconfig.json');
    expect(ambiguous?.message).toContain('apps/web/tsconfig.json');
  });
});

// ===========================================================================
// §8 — the same-semantics control: shared files stay usable
// ===========================================================================

describe('§8 — two projects that agree about a file raise no ambiguity', () => {
  const fixture = 'tests/fixtures/compatible-ownership';

  it('compiles under both projects (real tsc)', () => {
    expect(() => typecheck(`${fixture}/packages/shared/tsconfig.json`)).not.toThrow();
    expect(() => typecheck(`${fixture}/apps/web/tsconfig.json`)).not.toThrow();
  });

  it('reports no ambiguity merely because two projects load one file', async () => {
    // The two configs are spelled DIFFERENTLY — each expresses `#target` with
    // its own relative path — but they resolve it to the same file. A
    // serialized-options diff would call that ambiguous; effective resolution
    // correctly does not (§6).
    const violations = await validateFixtureWorkspace(fixture);

    expect(ofRule(violations, 'ambiguous-typescript-project-ownership')).toEqual([]);
  });

  it('still analyses the shared file normally', async () => {
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
// §9 — the referenced-project control: Review #5 behaviour is preserved
// ===========================================================================

describe('§9 — a genuinely REFERENCED child still governs its own source', () => {
  const fixture = 'tests/fixtures/referenced-ownership';

  it('compiles as parent and as child (real tsc)', () => {
    expect(() => typecheck(`${fixture}/apps/app/src/child/tsconfig.json`)).not.toThrow();
    expect(() => typecheck(`${fixture}/apps/app/tsconfig.json`)).not.toThrow();
  });

  it('raises no FALSE ambiguity for a reference relationship', async () => {
    // Parent and child map `#target` to different files, so their options are
    // materially different — but TypeScript's project-reference semantics say
    // whose options govern, so this is deterministic rather than ambiguous.
    const violations = await validateFixtureWorkspace(fixture);

    expect(ofRule(violations, 'ambiguous-typescript-project-ownership')).toEqual([]);
  });

  it('resolves the child alias with the CHILD options, not the parent ones', async () => {
    // The child's `#target` is a safe local type; the parent's is a Quran
    // internal. Reading the child's file with the parent's options would
    // invent a forbidden edge that `tsc --build` never compiles.
    const violations = await validateFixtureWorkspace(fixture);

    expect(ofRule(violations, 'context-internal-import')).toEqual([]);
    expect(ofRule(violations, 'laundered-context-dependency')).toEqual([]);
  });
});
