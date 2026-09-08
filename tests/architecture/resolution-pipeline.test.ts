import { describe, expect, it } from 'vitest';

import {
  validateFixtureWorkspace,
  type ArchitectureViolation,
} from './architecture-harness.ts';

/**
 * Review #3 blockers B2, B3, B4 and N6.
 *
 * All four came from ONE root cause: the analyser ran a hand-written resolver
 * ALONGSIDE TypeScript rather than through it, so the two disagreed. Every
 * disagreement was a bypass:
 *
 *   B2 — only `@/*` was understood, because it was hard-coded.
 *   B3 — resolved `.d.ts` files were discarded before classification.
 *   B4 — package `exports` were matched by exact key, missing wildcards.
 *   N6 — a workspace whose manifest could not be parsed silently vanished.
 *
 * These tests drive the REAL analyser against isolated fixture workspaces, each
 * with its own root manifest, so the production discovery and resolution path
 * is what is under test rather than a copy of it.
 *
 * Every negative asserts the SPECIFIC rule it expects. "Something failed" would
 * also pass for a broken fixture and would prove nothing.
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

// ===========================================================================
// B2 — effective tsconfig drives resolution
// ===========================================================================

describe('B2 — a workspace resolves by its OWN tsconfig, not a hard-coded alias', () => {
  const fixture = 'tests/fixtures/tsconfig-aliases';

  it('rejects the exact Review #3 `~/*` custom alias reproduction', async () => {
    // The reproduction verbatim: a workspace declaring `"~/*": ["./src/*"]`
    // and Messaging importing `~/contexts/quran`. It resolved for TypeScript
    // and for the build, and the analyser saw nothing at all.
    const violations = await validateFixtureWorkspace(fixture);
    const found = forFile(violations, 'custom-alias.ts');

    const forbidden = found.find(
      (violation) => violation.rule === 'forbidden-context-dependency',
    );

    expect(forbidden, 'the `~/*` alias must resolve into the graph').toBeDefined();
    expect(forbidden?.message).toContain("'messaging' may not depend on 'quran'");
  });

  it('rejects an arbitrary `#domain/*` mapping inherited through `extends`', async () => {
    // Two things at once, deliberately: an alias shape nobody anticipated, and
    // one declared in a BASE config the workspace extends. Supporting only the
    // aliases someone thought of is the defect, not the fix.
    const violations = await validateFixtureWorkspace(fixture);

    expect(rulesFor(violations, 'hash-alias.ts')).toContain(
      'forbidden-context-dependency',
    );
  });

  it('still resolves the conventional `@/*` alias', async () => {
    // A regression guard: the rewrite must not have traded one alias for
    // another.
    const violations = await validateFixtureWorkspace(fixture);

    expect(rulesFor(violations, 'at-alias.ts')).toContain('forbidden-context-dependency');
  });

  it('applies public-interface policy to aliased routes', async () => {
    const violations = await validateFixtureWorkspace(fixture);
    const found = forFile(violations, 'alias-internals.ts');

    expect(found.length).toBeGreaterThan(0);
    expect(found[0]?.specifier).toContain('internal/repository');
  });

  it('detects a cycle expressed entirely through aliases', async () => {
    const violations = await validateFixtureWorkspace(fixture);
    const cycles = violations.filter((violation) => violation.rule === 'import-cycle');

    expect(cycles.length).toBeGreaterThan(0);
    expect(cycles[0]?.message).toContain('alpha');
    expect(cycles[0]?.message).toContain('beta');
  });

  it('PERMITS a legitimate aliased dependency', async () => {
    // `messaging -> learning` is the one permitted same-level edge (§3.2). A
    // checker that rejected this would be a wrong checker, not a strict one.
    const violations = await validateFixtureWorkspace(fixture);

    expect(forFile(violations, 'allowed-alias.ts')).toEqual([]);
  });
});

// ===========================================================================
// B3 — declaration files are architectural dependencies
// ===========================================================================

describe('B3 — repository-local `.d.ts` files participate in the graph', () => {
  const fixture = 'tests/fixtures/declarations';

  it('rejects the exact Messaging -> Quran `.d.ts` bypass', async () => {
    // The reproduction verbatim: `import type { CanonSecret } from
    // '../quran/secret'`, where the target is `secret.d.ts`. TypeScript
    // resolved it; the analyser discarded every declaration result.
    const violations = await validateFixtureWorkspace(fixture);
    const found = forFile(violations, 'dts-bypass.ts');

    const forbidden = found.find(
      (violation) => violation.rule === 'forbidden-context-dependency',
    );

    expect(
      forbidden,
      'a declaration-only dependency is still a compile-time dependency',
    ).toBeDefined();
    expect(forbidden?.message).toContain("'messaging' may not depend on 'quran'");
    // The diagnostic must name the real file, so the finding is actionable.
    expect(forbidden?.specifier).toContain('secret.d.ts');
  });

  it('rejects a cross-context `.d.ts` import through the public interface too', async () => {
    // Proves the finding is the ALLOWLIST rule, not merely an internals rule:
    // Messaging may not depend on Quran at all, publicly or otherwise.
    const violations = await validateFixtureWorkspace(fixture);

    expect(rulesFor(violations, 'dts-public.ts')).toContain(
      'forbidden-context-dependency',
    );
  });

  it('rejects laundering through a `.d.ts` barrel', async () => {
    const violations = await validateFixtureWorkspace(fixture);
    const laundered = forFile(violations, 'dts-reexport.ts').find(
      (violation) => violation.rule === 'laundered-context-dependency',
    );

    expect(laundered, 'a declaration barrel must not launder an edge').toBeDefined();
    expect(laundered?.message).toContain('dts-barrel.d.ts');
  });

  it('detects a cycle between declaration files', async () => {
    const violations = await validateFixtureWorkspace(fixture);
    const cycles = violations.filter((violation) => violation.rule === 'import-cycle');

    expect(cycles.length).toBeGreaterThan(0);
    expect(cycles[0]?.message).toContain('left.d.ts');
    expect(cycles[0]?.message).toContain('right.d.ts');
  });

  it('rejects a workspace dependency expressed only in declarations', async () => {
    // A type dependency on the database is still a dependency on the database.
    const violations = await validateFixtureWorkspace(fixture);
    const found = forFile(violations, 'dts-workspace.ts');

    expect(found.map((violation) => violation.rule)).toContain(
      'context-prohibited-package',
    );
    expect(found[0]?.message).toContain('@minhaj/database');
  });

  it('PERMITS a declaration dependency the allowlist allows', async () => {
    const violations = await validateFixtureWorkspace(fixture);

    expect(forFile(violations, 'dts-allowed.ts')).toEqual([]);
  });

  it('does NOT treat external package declarations as repository architecture', async () => {
    // `node:buffer` types come from an installed package. Node is not a bounded
    // context, and reporting it as one would make the checker unusable.
    const violations = await validateFixtureWorkspace(fixture);

    expect(forFile(violations, 'dts-external.ts')).toEqual([]);
  });
});

// ===========================================================================
// B4 — package export wildcards resolve through TypeScript
// ===========================================================================

describe('B4 — workspace package exports resolve through real TypeScript', () => {
  const fixture = 'tests/fixtures/package-exports';

  it('detects the exact Review #3 alpha/beta wildcard cycle', async () => {
    // The reproduction verbatim: two packages exporting `"./*": "./src/*.ts"`
    // and importing each other through a NESTED subpath. TypeScript resolved
    // both; the exact-key matcher resolved neither, so the cycle was invisible.
    const violations = await validateFixtureWorkspace(fixture);
    const cycles = violations.filter((violation) => violation.rule === 'workspace-cycle');

    expect(cycles.length, 'a wildcard-mediated cycle is still a cycle').toBeGreaterThan(
      0,
    );
    expect(cycles[0]?.message).toContain('@fixture/alpha');
    expect(cycles[0]?.message).toContain('@fixture/beta');
    // The nested subpath is what a pattern match — and only a pattern match —
    // resolves.
    expect(cycles[0]?.message).toContain('nested/deep.ts');
  });

  it('rejects a wildcard export that fans out into a prohibited context', async () => {
    const violations = await validateFixtureWorkspace(fixture);
    const laundered = forFile(violations, 'via-wildcard.ts').find(
      (violation) => violation.rule === 'laundered-context-dependency',
    );

    expect(laundered, 'a wildcard export must not launder a context edge').toBeDefined();
    expect(laundered?.message).toContain("'messaging' may not depend on 'quran'");
  });

  it('reports the package that carried the dependency', async () => {
    const violations = await validateFixtureWorkspace(fixture);
    const laundered = forFile(violations, 'via-wildcard.ts').find(
      (violation) => violation.rule === 'laundered-context-dependency',
    );

    expect(laundered?.message).toContain('gateway');
  });

  it('PERMITS exact, subpath and wildcard exports that break no rule', async () => {
    // The control. A resolver that rejected legitimate `exports` shapes would
    // be broken rather than strict, and `exports` is how every workspace
    // package in this repository is consumed.
    const violations = await validateFixtureWorkspace(fixture);

    expect(forFile(violations, 'consumer.ts')).toEqual([]);
  });
});

// ===========================================================================
// N6 — a matched workspace must never silently disappear
// ===========================================================================

describe('N6 — a workspace that cannot be understood fails loudly', () => {
  const fixture = 'tests/fixtures/broken-manifest';

  it('reports a malformed package.json rather than skipping the workspace', async () => {
    const violations = await validateFixtureWorkspace(fixture);
    const found = violations.filter(
      (violation) =>
        violation.rule === 'unreadable-workspace-manifest' &&
        violation.file.includes('malformed'),
    );

    expect(found.length, 'a broken manifest must be reported').toBeGreaterThan(0);
    expect(found[0]?.message).toContain('malformed package.json');
  });

  it('reports a workspace with no package name', async () => {
    // Classification — Layer 0, prohibited, unclassified — is BY NAME, so a
    // nameless workspace cannot be judged and must not be treated as harmless.
    const violations = await validateFixtureWorkspace(fixture);
    const found = violations.filter(
      (violation) =>
        violation.rule === 'unreadable-workspace-manifest' &&
        violation.file.includes('nameless'),
    );

    expect(found.length).toBeGreaterThan(0);
    expect(found[0]?.message).toContain('no package "name"');
  });

  it('names the directory so the finding is actionable', async () => {
    const violations = await validateFixtureWorkspace(fixture);
    const found = violations.filter(
      (violation) => violation.rule === 'unreadable-workspace-manifest',
    );

    for (const violation of found) {
      expect(violation.file).toContain('packages/');
    }
  });

  it('does not suppress the rest of the run', async () => {
    // One broken manifest must not blind the analyser to its well-formed
    // siblings, or a single typo would disable enforcement repository-wide.
    const violations = await validateFixtureWorkspace(fixture);
    const unreadable = violations.filter(
      (violation) => violation.rule === 'unreadable-workspace-manifest',
    );

    expect(unreadable.length).toBe(2);
    expect(violations.length).toBe(unreadable.length);
  });
});

// ===========================================================================
// B2 — a configuration the analyser cannot read is a FINDING
// ===========================================================================

describe('B2 — an unreadable tsconfig is reported, never worked around', () => {
  const fixture = 'tests/fixtures/broken-tsconfig';

  it('reports the file whose resolution cannot be reproduced', async () => {
    // Resolution is now driven by each workspace's EFFECTIVE TypeScript
    // configuration. When that configuration cannot be parsed, the analyser
    // would resolve differently from the build — so it must say so rather than
    // fall back to permissive defaults and report a clean workspace. A silent
    // pass is indistinguishable from the bypasses this remediation closed.
    const violations = await validateFixtureWorkspace(fixture);
    const found = violations.filter(
      (violation) => violation.rule === 'unreadable-tsconfig',
    );

    expect(found.length).toBeGreaterThan(0);
    expect(found[0]?.file).toContain('aliased.ts');
  });

  it('names the configuration and the real parse error', async () => {
    // The diagnostic must point at the tsconfig, not at TypeScript's internals.
    const violations = await validateFixtureWorkspace(fixture);
    const found = violations.find(
      (violation) => violation.rule === 'unreadable-tsconfig',
    );

    expect(found?.message).toContain('tsconfig.json');
    expect(found?.message).toContain('Cannot read TypeScript configuration');
    // A "Debug Failure" here would mean the analyser mishandled the path and
    // reported its own bug in place of the user's.
    expect(found?.message).not.toContain('Debug Failure');
  });

  it('reports the configuration path in POSIX form on every platform', async () => {
    const violations = await validateFixtureWorkspace(fixture);
    const found = violations.find(
      (violation) => violation.rule === 'unreadable-tsconfig',
    );

    expect(found?.message).toContain('tests/fixtures/broken-tsconfig');
    expect(found?.message).not.toContain(String.fromCharCode(92));
  });

  it('does not silently pass the aliased import', async () => {
    // The decisive assertion: the fixture must not come back clean.
    const violations = await validateFixtureWorkspace(fixture);

    expect(violations.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// Cross-platform resolution
// ===========================================================================

describe('the resolution pipeline behaves identically on Windows and Linux', () => {
  it('resolves a workspace package specifier to real repository source', async () => {
    // TypeScript hands its resolution host FORWARD-slash paths on every
    // platform, Windows included, while `path.sep` is a backslash there. The
    // virtual `node_modules` redirect normalises before comparing, so this
    // holds on both. A silent failure here would not break a build — it would
    // make the analyser resolve NOTHING and report a clean repository, which is
    // the worst outcome available.
    const { resolveSpecifier } = await import('../../scripts/architecture/resolver.mjs');
    const { discoverWorkspaces, workspacePackageMap, repoRoot } =
      await import('../../scripts/shared/workspaces.mjs');
    const path = await import('node:path');

    const workspacePackages = workspacePackageMap(discoverWorkspaces());

    const resolved = resolveSpecifier(
      '@minhaj/contracts/env/client',
      path.join(repoRoot, 'apps', 'web', 'src', 'app', 'page.tsx'),
      { workspacePackages },
    );

    expect(resolved.kind).toBe('file');
    // Repository-relative paths are reported in POSIX form on every platform,
    // so rule matching and diagnostics do not vary by operating system.
    expect(resolved.relative).toBe('packages/contracts/src/env/client.ts');
    expect(resolved.relative).not.toContain(String.fromCharCode(92));
  });

  it('reports every graph path in POSIX form', async () => {
    const { buildGraph } = await import('../../scripts/architecture/graph.mjs');
    const graph = buildGraph();

    expect(graph.nodes.size).toBeGreaterThan(0);

    for (const node of graph.nodes.values()) {
      expect(node.relative, `${node.relative} must use POSIX separators`).not.toContain(
        String.fromCharCode(92),
      );
    }
  });

  it('resolves the removed schema subpath to nothing', async () => {
    // The exact Review #3 specifier, checked at the RESOLVER level as well as
    // by the Next build, so the finding does not depend on one tool.
    const { resolveSpecifier } = await import('../../scripts/architecture/resolver.mjs');
    const { discoverWorkspaces, workspacePackageMap, repoRoot } =
      await import('../../scripts/shared/workspaces.mjs');
    const path = await import('node:path');

    const resolved = resolveSpecifier(
      '@minhaj/contracts/env/schema',
      path.join(repoRoot, 'apps', 'web', 'src', 'app', 'page.tsx'),
      { workspacePackages: workspacePackageMap(discoverWorkspaces()) },
    );

    // A known workspace with an unresolvable subpath — not a third-party
    // package, and certainly not a file.
    expect(resolved.kind).toBe('unresolved');
    expect(resolved.viaWorkspace).toBe('@minhaj/contracts');
  });
});
