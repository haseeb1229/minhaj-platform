import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { repoRoot, validateRtl, type RtlViolation } from './architecture-harness.ts';

/**
 * Round 8 B8-1 — RTL discovery does not trust directory basenames.
 *
 * Review #8 planted authored production source at:
 *
 *     apps/app/src/dist/bad.tsx
 *     export const physicalDirectionStyle = { borderLeftWidth: 1 };
 *
 * Real `tsc` compiles it. The architecture gate includes it. And a DIRECT scan
 * of that directory reported `physical-inline-style` correctly — so the RTL
 * RULE was never the problem. DISCOVERY was:
 *
 *   - `check:rtl` walked past the directory (basename in `IGNORED_DIRECTORIES`)
 *     and checked ZERO files
 *   - ESLint answered "File ignored because of a matching ignore pattern",
 *     because `base.js` carried `**\/dist/**`
 *
 * Between them, an RTL violation shipped with no diagnostic from any gate,
 * purely because a parent directory was named `dist`.
 *
 * Round 6 established for the architecture analyser that generated output is
 * recognised by PATH IDENTITY and never by name. Applying that in one gate and
 * not the others is a coincidence, not a principle. Both gates now use the one
 * shared policy in `scripts/shared/generated-roots.mjs`.
 *
 * The conjunction is the claim: THE BUILD PASSES, ARCHITECTURE SEES THE FILE,
 * AND RTL NOW REPORTS IT.
 */

const fixture = 'tests/fixtures/rtl-generated-names';
const app = `${fixture}/apps/app`;

/** Runs the RTL scanner over the fixture tree through NORMAL discovery. */
async function discoveredViolations(): Promise<RtlViolation[]> {
  const { violations } = await validateRtl(null, path.join(repoRoot, fixture));
  return violations;
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
// B8-1 — the exact Review #8 reproduction
// ===========================================================================

describe('B8-1 — authored source under src/dist is scanned for RTL', () => {
  it('real tsc compiles the fixture', () => {
    // The premise: this is legitimate, compiling production source, not a
    // stray artefact. Without this the fixture proves nothing about a bypass.
    expect(() => typecheck(`${app}/tsconfig.json`)).not.toThrow();
  });

  it('the architecture gate includes the file', async () => {
    const { buildGraph } = await import('../../scripts/architecture/graph.mjs');
    const { discoverWorkspaces } = await import('../../scripts/shared/workspaces.mjs');

    const graph = buildGraph({
      workspaces: discoverWorkspaces(path.join(repoRoot, fixture)),
    }) as { nodes: Map<string, { relative: string }> };

    const files = [...graph.nodes.values()].map((node) => node.relative);

    // Architecture already saw it in Round 7. The asymmetry between the gates
    // is precisely what made B8-1 a bypass rather than a shared blind spot.
    expect(files).toContain(`${app}/src/dist/bad.tsx`);
  });

  it('NORMAL RTL discovery reaches the file at all', async () => {
    const { filesChecked } = await validateRtl(null, path.join(repoRoot, fixture));

    // The defect was `filesChecked: 0`. A rule cannot fire for a file the
    // scanner never opened.
    expect(filesChecked).toBeGreaterThan(0);
  });

  it('reports physical-inline-style with the exact property and replacement', async () => {
    const violations = await discoveredViolations();

    const reported = violations.filter(
      (violation) => violation.file === `${app}/src/dist/bad.tsx`,
    );

    expect(reported.length).toBeGreaterThan(0);

    const offending = reported.find(
      (violation) => violation.detail === 'borderLeftWidth',
    );

    // The exact offending property and the exact recommended logical
    // replacement, not merely "some violation was found".
    expect(offending).toBeDefined();
    expect(offending?.rule).toBe('physical-inline-style');
    expect(offending?.message).toContain('borderLeftWidth');
    expect(offending?.message).toContain('borderInlineStartWidth');
  });
});

// ===========================================================================
// §3/§6 — every authored generated-LOOKING directory, and stylesheets too
// ===========================================================================

describe('§3 — the rule is about identity, not about one spelling', () => {
  /** Each authored file, with the exact property the scanner must report. */
  const authored = [
    ['src/dist/bad.tsx', 'physical-inline-style', 'borderLeftWidth'],
    ['src/build/bad.tsx', 'physical-inline-style', 'marginLeft'],
    ['src/coverage/bad.tsx', 'physical-inline-style', 'paddingRight'],
    ['src/features/dist/bad.tsx', 'physical-inline-style', 'borderRightWidth'],
    // §6 — the scanner supports .css/.scss, so authored stylesheets under a
    // generated-looking directory must be discovered on the same terms.
    ['src/dist/bad.css', 'physical-css-declaration', 'margin-left'],
    ['src/build/bad.scss', 'physical-css-declaration', 'padding-right'],
  ] as const;

  it.each(authored)('reports %s', async (file, rule, detail) => {
    const violations = await discoveredViolations();

    const reported = violations.filter(
      (violation) => violation.file === `${app}/${file}`,
    );

    expect(reported.length).toBeGreaterThan(0);
    expect(reported.some((violation) => violation.rule === rule)).toBe(true);
    expect(reported.some((violation) => violation.detail.includes(detail))).toBe(true);
  });

  it('finds every authored file and no others', async () => {
    const violations = await discoveredViolations();

    expect([...new Set(violations.map((violation) => violation.file))].sort()).toEqual(
      authored.map(([file]) => `${app}/${file}`).sort(),
    );
  });
});

// ===========================================================================
// §6 CONTROL — a genuine configured outDir stays excluded
// ===========================================================================

describe('§6 — a CONFIGURED outDir is still recognised as generated output', () => {
  it('never reports the emitted file under the configured outDir', async () => {
    const violations = await discoveredViolations();

    // `generated/emitted.tsx` is under this project's configured `outDir` and
    // carries the SAME physical-direction style as the authored file. Reporting
    // it would mean the fix had simply stopped excluding anything; excluding
    // `src/dist/bad.tsx` would mean the bypass was still open. Only the
    // identity test distinguishes them.
    expect(violations.some((violation) => violation.file.includes('/generated/'))).toBe(
      false,
    );
  });

  it('the emitted file really does contain a physical-direction style', async () => {
    const { readFileSync } = await import('node:fs');

    const source = readFileSync(
      path.join(repoRoot, app, 'generated', 'emitted.tsx'),
      'utf8',
    );

    // Guards the control itself: if the emitted file lost its physical style,
    // the test above would pass for the wrong reason.
    expect(source).toContain('borderLeftWidth');
  });
});

// ===========================================================================
// §7 — the real repository is unchanged by the wider walk
// ===========================================================================

describe('§7 — production RTL enforcement is stable', () => {
  it('still reports no RTL violation in real production source', async () => {
    const { violations } = await validateRtl();

    expect(violations).toEqual([]);
  });

  it('never scans a real generated root', async () => {
    const { violations } = await validateRtl();

    for (const violation of violations) {
      expect(violation.file).not.toContain('.next/');
      expect(violation.file).not.toContain('node_modules/');
    }
  });
});

// ===========================================================================
// §4 — ESLint applies the same principle
// ===========================================================================

describe('§4 — ESLint does not ignore authored source by directory name', () => {
  it('carries no bare **/dist, **/build or **/coverage wildcard', async () => {
    const { ignores } = (await import('../../packages/config/eslint/base.js')) as {
      ignores: string[];
    };

    // These are the exact patterns that made ESLint answer "File ignored
    // because of a matching ignore pattern" for authored `src/dist/bad.tsx`.
    // They match a name at ANY depth, which is the defect.
    expect(ignores).not.toContain('**/dist/**');
    expect(ignores).not.toContain('**/build/**');
    expect(ignores).not.toContain('**/coverage/**');
  });

  it('still ignores genuine build output and dependencies', async () => {
    const { ignores } = (await import('../../packages/config/eslint/base.js')) as {
      ignores: string[];
    };

    // Narrowing must not become "ignore nothing": real output stays out.
    expect(ignores).toContain('**/node_modules/**');
    expect(ignores).toContain('apps/web/.next/**');
    expect(ignores).toContain('**/*.tsbuildinfo');
  });

  it('anchors every remaining ignore to a real path rather than a bare name', async () => {
    const { ignores } = (await import('../../packages/config/eslint/base.js')) as {
      ignores: string[];
    };

    for (const pattern of ignores) {
      // A pattern of the shape `**/<name>/**` grants a directory NAME authority
      // at arbitrary depth. `node_modules` is the one legitimate case: npm may
      // genuinely nest it, and none of it is ever this repository's source.
      const isBareNameWildcard = /^\*\*\/[^*/]+\/\*\*$/.test(pattern);

      if (isBareNameWildcard) expect(pattern).toBe('**/node_modules/**');
    }
  });
});
