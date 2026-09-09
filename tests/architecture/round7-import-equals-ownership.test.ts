import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  repoRoot,
  validateFixtureWorkspace,
  type ArchitectureViolation,
} from './architecture-harness.ts';

/**
 * Round 7 B2 — ownership compatibility uses the ONE authoritative extractor.
 *
 * Review #7 reduced a contested file to a single dependency:
 *
 *     import target = require('#target');
 *
 * Two independent projects compile that file and map `#target` to different
 * places — one benign, one a Quran internal. Both `tsc -p` runs succeed. The
 * resolutions genuinely differ, which is the definition of the ROOT/CLOSURE
 * ambiguity Round 6 closed.
 *
 * It was not detected, because `materiallyDifferentForFile` asked a SECOND,
 * cut-down specifier extractor kept inside `tsconfig.mjs` — one that knew
 * `import`, `export … from`, `import()` and `require()`, but not
 * `ImportEqualsDeclaration`. It reported a file with no dependencies at all, so
 * the comparison concluded there was nothing to disagree about and waved the
 * file through.
 *
 * Two extractors means the WEAKER one silently sets the security policy (§8).
 * There is now exactly one, shared with the architecture graph.
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

/** Where one specifier lands under one project's REAL options. */
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

  return resolved === undefined ? '(unresolved)' : resolved.resolvedFileName;
}

// ===========================================================================
// B2 — the exact Review #7 reproduction
// ===========================================================================

describe('B2 — `import x = require(…)` participates in ownership compatibility', () => {
  const fixture = 'tests/fixtures/import-equals-ownership';
  const alpha = `${fixture}/apps/alpha/tsconfig.json`;
  const beta = `${fixture}/apps/beta/tsconfig.json`;
  const contested = `${fixture}/shared/contested.ts`;

  it('Project A compiles for real', () => {
    expect(() => typecheck(alpha)).not.toThrow();
  });

  it('Project B compiles for real', () => {
    expect(() => typecheck(beta)).not.toThrow();
  });

  it('the contested file uses ONLY an ImportEqualsDeclaration', async () => {
    const { extractModuleSpecifiers } =
      await import('../../scripts/architecture/parser.mjs');

    const entries = extractModuleSpecifiers(path.join(repoRoot, contested)) as {
      specifier: string;
      kind: string;
    }[];

    // If the fixture ever grows an ordinary `import`, it stops reproducing the
    // defect: the old extractor would have seen that one and found the
    // ambiguity for the wrong reason.
    expect(entries).toHaveLength(1);
    expect(entries[0]?.specifier).toBe('#target');
    expect(entries[0]?.kind).toBe('import-equals');
  });

  it('the two projects really resolve `#target` differently', async () => {
    const underA = await resolveUnderProject(alpha, '#target', contested);
    const underB = await resolveUnderProject(beta, '#target', contested);

    expect(underA).not.toBe(underB);
    expect(underA.replaceAll('\\', '/')).toContain('shared/safe/target.ts');
    expect(underB.replaceAll('\\', '/')).toContain('shared/quran/target.ts');
  });

  it('emits ambiguous-typescript-project-ownership for the contested file', async () => {
    const violations = await validateFixtureWorkspace(fixture);
    const ambiguous = ofRule(violations, 'ambiguous-typescript-project-ownership');

    expect(ambiguous.map((violation) => violation.file)).toContain(contested);
  });

  it('names BOTH competing project configs in the diagnostic', async () => {
    const violations = await validateFixtureWorkspace(fixture);
    const [ambiguity] = ofRule(violations, 'ambiguous-typescript-project-ownership');

    expect(ambiguity).toBeDefined();
    expect(ambiguity?.message).toContain('apps/alpha/tsconfig.json');
    expect(ambiguity?.message).toContain('apps/beta/tsconfig.json');
  });
});

// ===========================================================================
// §10 — every parser-supported dependency form participates
// ===========================================================================

describe('§10 — one authoritative extractor feeds ownership compatibility', () => {
  /**
   * A table so a dependency form the parser learns to see cannot silently drop
   * out of ownership analysis later. Each entry is a real snippet; the claim is
   * that the extractor the COMPATIBILITY CHECK uses returns the specifier.
   *
   * Deliberately small (§10). It proves the two code paths are the same path,
   * not that TypeScript's grammar is complete.
   */
  const forms = [
    ['normal import', `import x from '#target';\nexport const a = x;`],
    ['import type', `import type { T } from '#target';\nexport type A = T;`],
    ['export-from', `export { x } from '#target';`],
    ['export-star', `export * from '#target';`],
    ['import-equals', `import x = require('#target');\nexport type A = x.T;`],
    ['dynamic import', `export const a = () => import('#target');`],
    ['require', `const x = require('#target');\nexport const a = x;`],
  ] as const;

  it.each(forms)('the compatibility extractor sees a %s', async (_label, source) => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');

    const directory = mkdtempSync(path.join(tmpdir(), 'minhaj-specifiers-'));
    const file = path.join(directory, 'sample.ts');

    try {
      writeFileSync(file, source, 'utf8');

      // The SAME function `materiallyDifferentForFile` calls. Reaching through
      // the module's own export keeps the test honest: if ownership analysis
      // ever forks its own extractor again, this stops testing the real path
      // and the import fails loudly rather than passing quietly.
      const { specifiersForCompatibility } =
        await import('../../scripts/architecture/tsconfig.mjs');

      expect(specifiersForCompatibility(file) as string[]).toContain('#target');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
