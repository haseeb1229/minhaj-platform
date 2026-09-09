import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Test harness bridging Vitest to the real architecture and RTL checkers.
 *
 * The tests drive the SAME modules the `npm run check:*` scripts and CI run.
 * A test that reimplemented the rules would prove only that the copy agrees
 * with itself.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '..', '..');

export interface ArchitectureViolation {
  readonly rule: string;
  readonly file: string;
  readonly specifier: string;
  readonly line?: number;
  readonly message: string;
}

export interface RtlViolation {
  readonly rule: string;
  readonly file: string;
  readonly detail: string;
  readonly message: string;
}

/**
 * Runs the architecture analyser.
 *
 * With no arguments it inspects real production source, exactly as CI does.
 * `workspaceRoot` points discovery at a fixture tree carrying its own root
 * manifest, so a fixture exercises the production discovery path rather than a
 * test-only shortcut.
 */
export async function validateArchitecture(
  roots?: readonly string[] | null,
  workspaceRoot?: string | null,
): Promise<{
  violations: ArchitectureViolation[];
  graph: { nodes: Map<string, unknown> };
}> {
  const checker = (await import('../../scripts/check-architecture.mjs')) as {
    validateArchitecture: (
      roots?: readonly string[] | null,
      workspaceRoot?: string | null,
    ) => Promise<{
      violations: ArchitectureViolation[];
      graph: { nodes: Map<string, unknown> };
    }>;
  };

  return checker.validateArchitecture(roots ?? null, workspaceRoot ?? null);
}

/** Runs the architecture analyser against a fixture workspace tree. */
export async function validateFixtureWorkspace(
  relativeRoot: string,
): Promise<ArchitectureViolation[]> {
  const { violations } = await validateArchitecture(
    null,
    path.join(repoRoot, relativeRoot),
  );
  return violations;
}

/** Runs the RTL checker over the given roots, or over discovered workspaces. */
export async function validateRtl(
  roots?: readonly string[] | null,
  workspaceRoot?: string | null,
): Promise<{ violations: RtlViolation[]; filesChecked: number }> {
  const checker = (await import('../../scripts/check-rtl.mjs')) as {
    validateRtl: (
      roots: readonly string[] | null,
      options?: { workspaceRoot?: string | null },
    ) => Promise<{ violations: RtlViolation[]; filesChecked: number }>;
  };

  return checker.validateRtl(roots ?? null, { workspaceRoot: workspaceRoot ?? null });
}

/**
 * Runs the REAL TypeScript compiler over a fixture project.
 *
 * Review #5 (§28) required this. Round 4's B1 test asserted that the analyser
 * reported a violation, but never established that `tsc -p` ACCEPTS the
 * fixture — so a fixture containing a genuine type error would have satisfied
 * the test while proving nothing about a bypass. The interesting claim is
 * always the conjunction: THE BUILD PASSES AND THE ARCHITECTURE FAILS.
 *
 * Invokes the repository's own pinned `typescript` through its JS entry point
 * rather than a shell wrapper, so it behaves identically on Windows and Linux.
 */
export function runTsc(projectPath: string): {
  ok: boolean;
  exitCode: number;
  output: string;
} {
  const tsc = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');

  const result = spawnSync(
    process.execPath,
    [tsc, '--noEmit', '-p', path.join(repoRoot, projectPath)],
    { encoding: 'utf8' },
  );

  return {
    ok: result.status === 0,
    exitCode: result.status ?? -1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}
