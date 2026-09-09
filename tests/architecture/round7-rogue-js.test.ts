import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  repoRoot,
  validateFixtureWorkspace,
  type ArchitectureViolation,
} from './architecture-harness.ts';

/**
 * Round 7 B1 — the directory walk is AUTHORITATIVE for authored JavaScript.
 *
 * Review #7 planted authored production JavaScript in directories carrying
 * generated-looking names, under `allowJs: false`:
 *
 *     src/dist/rogue.js          src/build/rogue.jsx
 *     src/coverage/rogue.js      src/features/dist/rogue.jsx
 *
 * Real `tsc` exits 0, because with `allowJs` off TypeScript does not look at a
 * `.js` file at all. The analyser ALSO reported nothing, because its source
 * walk skipped any directory whose basename appeared in `IGNORED_DIRECTORIES`.
 * Between them, `production-must-be-typescript` could be switched off by
 * choosing a directory name.
 *
 * The skip was defended as a performance shortcut, safe because the Program
 * closure and the recursive worklist would catch anything real. That holds for
 * TypeScript and for nothing else: no Program contains a `.js` file when
 * `allowJs` is false, and nothing imports these files, so the walk is the ONLY
 * mechanism that can see them. It now descends everywhere except CANONICAL
 * generated roots (§4, §5).
 *
 * The conjunction is the whole point (§23): THE BUILD PASSES AND THE
 * ARCHITECTURE FAILS. A test asserting only the violation would still pass if
 * the fixture had stopped compiling for an unrelated reason.
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

// ===========================================================================
// B1 — rogue JS/JSX under generated-LOOKING directory names
// ===========================================================================

describe('B1 — authored JS/JSX cannot hide behind a generated-looking directory', () => {
  const fixture = 'tests/fixtures/rogue-js-generated-names';
  const project = `${fixture}/apps/app/tsconfig.json`;

  /**
   * Review #7's exact set. `cache` is included because it was the ONE name
   * absent from the old skip list — it was already caught, and it stays caught,
   * which is what makes the others' previous escape a defect rather than a
   * design (§6).
   */
  const rogueFiles = [
    'src/dist/rogue.js',
    'src/build/rogue.jsx',
    'src/coverage/rogue.js',
    'src/features/dist/rogue.jsx',
    'src/cache/rogue.js',
  ] as const;

  it('real tsc accepts the fixture: TypeScript ignores the rogue files', () => {
    // The premise of the whole reproduction. `allowJs` is false, so a compiler
    // that reported these files would mean the bypass never existed.
    expect(() => typecheck(project)).not.toThrow();
  });

  it('confirms the project really has allowJs disabled', async () => {
    const { ts } = await import('../../scripts/architecture/tsconfig.mjs');

    const configPath = path.join(repoRoot, project);
    const raw = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(
      raw.config,
      ts.sys,
      path.dirname(configPath),
    );

    expect(parsed.options.allowJs ?? false).toBe(false);

    // No Program input is JavaScript — so no Program closure can ever report
    // these files, and the directory walk is the only thing standing between
    // them and production.
    expect(parsed.fileNames.some((file) => file.endsWith('.js'))).toBe(false);
    expect(parsed.fileNames.some((file) => file.endsWith('.jsx'))).toBe(false);
  });

  it.each(rogueFiles)('reports production-must-be-typescript for %s', async (rogue) => {
    const violations = await validateFixtureWorkspace(fixture);
    const reported = ofRule(violations, 'production-must-be-typescript');

    // The EXACT offending path, not merely a larger violation count (§23).
    expect(reported.map((violation) => violation.file)).toContain(
      `${fixture}/apps/app/${rogue}`,
    );
  });

  it('reports every rogue file and nothing else', async () => {
    const violations = await validateFixtureWorkspace(fixture);

    expect(
      ofRule(violations, 'production-must-be-typescript')
        .map((v) => v.file)
        .sort(),
    ).toEqual(rogueFiles.map((rogue) => `${fixture}/apps/app/${rogue}`).sort());

    // The legitimate TypeScript in the same tree is untouched: the fix widens
    // discovery, it does not manufacture findings.
    expect(violations.filter((v) => v.rule !== 'production-must-be-typescript')).toEqual(
      [],
    );
  });

  it('puts the rogue files in the graph at all', async () => {
    const { buildGraph } = await import('../../scripts/architecture/graph.mjs');
    const { discoverWorkspaces } = await import('../../scripts/shared/workspaces.mjs');

    const graph = buildGraph({
      workspaces: discoverWorkspaces(path.join(repoRoot, fixture)),
    }) as { nodes: Map<string, { relative: string }> };

    const files = [...graph.nodes.values()].map((node) => node.relative);

    // Discovery is the half that was broken. A rule cannot fire for a file the
    // analyser never saw.
    for (const rogue of rogueFiles) {
      expect(files).toContain(`${fixture}/apps/app/${rogue}`);
    }
  });
});

// ===========================================================================
// §6 CONTROL — a genuine configured outDir is still not authored source
// ===========================================================================

describe('§6 — emitted JavaScript under a configured outDir is NOT a rogue file', () => {
  const fixture = 'tests/fixtures/generated-outdir';

  it('compiles with real tsc', () => {
    expect(() => typecheck(`${fixture}/apps/app/tsconfig.json`)).not.toThrow();
  });

  it('never reports generated JavaScript as production source', async () => {
    const violations = await validateFixtureWorkspace(fixture);

    // `generated/emitted.js` is real compiler output under the project's
    // configured `outDir`. It is JavaScript, it sits on disk, and the walk now
    // descends far more widely than before — so this is the control that proves
    // the fix distinguishes a configured output root from a directory merely
    // NAMED `dist`. Reporting it would make every built tree fail.
    expect(ofRule(violations, 'production-must-be-typescript')).toEqual([]);
    expect(violations).toEqual([]);
  });

  it('keeps generated output out of the graph', async () => {
    const { buildGraph } = await import('../../scripts/architecture/graph.mjs');
    const { discoverWorkspaces } = await import('../../scripts/shared/workspaces.mjs');

    const graph = buildGraph({
      workspaces: discoverWorkspaces(path.join(repoRoot, fixture)),
    }) as { nodes: Map<string, { relative: string }> };

    const files = [...graph.nodes.values()].map((node) => node.relative);

    expect(files.some((file) => file.includes('/generated/'))).toBe(false);
  });
});
