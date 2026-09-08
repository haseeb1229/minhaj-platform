import { describe, expect, it } from 'vitest';

import {
  validateFixtureWorkspace,
  type ArchitectureViolation,
} from './architecture-harness.ts';

/**
 * A1 — transitive dependency laundering.
 *
 * The decisive defect of the previous analyser: it checked only DIRECT edges,
 * so a prohibited dependency became legal by passing through one innocent hop.
 *
 *     messaging/foo.ts -> shared/wrapper.ts -> quran/internal.ts
 *
 * Every hop is individually permitted; the composition is not. These tests
 * assert each laundering route is rejected AND that it is rejected for the
 * laundering reason rather than incidentally.
 */

/** Violations reported for one fixture file, by filename. */
function forFile(
  violations: readonly ArchitectureViolation[],
  filename: string,
): ArchitectureViolation[] {
  return violations.filter((violation) => violation.file.endsWith(filename));
}

describe('A1 — laundering through a neutral module', () => {
  it('rejects messaging -> shared wrapper -> quran internals', async () => {
    const violations = await validateFixtureWorkspace('tests/fixtures/laundering');
    const found = forFile(violations, 'neutral-laundering.ts');

    expect(found.length).toBeGreaterThan(0);

    // The reason must be laundering specifically — not an unrelated defect in
    // the fixture that happens to make the run fail.
    const laundered = found.find(
      (violation) => violation.rule === 'laundered-context-dependency',
    );

    expect(laundered, 'expected a laundered-context-dependency violation').toBeDefined();
    expect(laundered?.message).toContain("'messaging' may not depend on 'quran'");
    expect(laundered?.message).toContain('intermediate module');
  });

  it('reports the dependency path so the violation is understandable', async () => {
    const violations = await validateFixtureWorkspace('tests/fixtures/laundering');
    const laundered = forFile(violations, 'neutral-laundering.ts').find(
      (violation) => violation.rule === 'laundered-context-dependency',
    );

    // The chain must name every hop, not merely the endpoints.
    expect(laundered?.message).toContain('shared/wrapper.ts');
    expect(laundered?.message).toContain('quran/internal/repository.ts');
  });
});

describe('A1 — laundering through a workspace package', () => {
  it('rejects messaging -> workspace package -> quran', async () => {
    const violations = await validateFixtureWorkspace('tests/fixtures/laundering');
    const found = forFile(violations, 'workspace-laundering.ts');

    const laundered = found.find(
      (violation) => violation.rule === 'laundered-context-dependency',
    );

    expect(
      laundered,
      'a workspace package must not launder a context edge',
    ).toBeDefined();
    expect(laundered?.message).toContain("'messaging' may not depend on 'quran'");
  });
});

describe('A1 — laundering through a barrel', () => {
  it('rejects an `export *` barrel that fans out to a context', async () => {
    const violations = await validateFixtureWorkspace('tests/fixtures/laundering');
    const laundered = forFile(violations, 'barrel-laundering.ts').find(
      (violation) => violation.rule === 'laundered-context-dependency',
    );

    expect(laundered, 'a barrel must not launder a context edge').toBeDefined();
  });
});

describe('A1 — laundering through a path alias', () => {
  it('rejects the same route reached through the `@/` alias', async () => {
    // Alias resolution must feed the same graph as relative resolution, or the
    // alias becomes a bypass of everything.
    const violations = await validateFixtureWorkspace('tests/fixtures/laundering');
    const laundered = forFile(violations, 'alias-laundering.ts').find(
      (violation) => violation.rule === 'laundered-context-dependency',
    );

    expect(laundered, 'an alias must not launder a context edge').toBeDefined();
  });
});

describe('A1 — a shared package must not depend upward on a context', () => {
  it('rejects a Layer 0 module reaching into a content context', async () => {
    // This is the other half of the laundering defence: if a shared package may
    // depend on a context, it becomes a laundering route for every consumer.
    const violations = await validateFixtureWorkspace('tests/fixtures/laundering');
    const upward = violations.filter(
      (violation) => violation.rule === 'layer-zero-upward-dependency',
    );

    expect(upward.length).toBeGreaterThan(0);
    expect(upward[0]?.message).toContain('must not depend upward');
  });
});

describe('A3 — infrastructure and workspace discovery', () => {
  it('rejects a bounded context consuming the filesystem directly', async () => {
    // DOMAIN_MODEL.md §2 rule 7 names the filesystem explicitly.
    const violations = await validateFixtureWorkspace('tests/fixtures/infrastructure');
    const found = forFile(violations, 'filesystem.ts');

    expect(found.map((violation) => violation.rule)).toContain(
      'context-concrete-infrastructure',
    );
    expect(found[0]?.message).toContain('the filesystem');
  });

  it('rejects a relative reach into an architectural package', async () => {
    // Classification is by RESOLVED WORKSPACE, so climbing to
    // `packages/database/src` is the same violation as naming the package.
    const violations = await validateFixtureWorkspace('tests/fixtures/infrastructure');
    const found = forFile(violations, 'relative-into-database.ts');

    expect(found.map((violation) => violation.rule)).toContain(
      'context-prohibited-package',
    );
    expect(found[0]?.message).toContain('@minhaj/database');
  });

  it('inspects a workspace that did not exist when the checker was written', async () => {
    // `packages/database` is discovered from the fixture's root manifest. A
    // hard-coded root list would have skipped it entirely.
    const violations = await validateFixtureWorkspace('tests/fixtures/infrastructure');

    expect(violations.length).toBeGreaterThan(0);
  });

  it('rejects production JavaScript inside a discovered workspace', async () => {
    const violations = await validateFixtureWorkspace('tests/fixtures/infrastructure');
    const found = forFile(violations, 'production.js');

    expect(found.map((violation) => violation.rule)).toContain(
      'production-must-be-typescript',
    );
  });
});

describe('A2 — cycles in the real resolved graph', () => {
  it('rejects a cycle between two workspace packages', async () => {
    const violations = await validateFixtureWorkspace('tests/fixtures/wscycle');
    const cycles = violations.filter((violation) => violation.rule === 'workspace-cycle');

    expect(cycles.length).toBeGreaterThan(0);
    expect(cycles[0]?.message).toContain('@fixture/alpha');
    expect(cycles[0]?.message).toContain('@fixture/beta');
  });

  it('rejects a file-level cycle within one workspace', async () => {
    const violations = await validateFixtureWorkspace('tests/fixtures/cycle');
    const cycles = violations.filter((violation) => violation.rule === 'import-cycle');

    expect(cycles.length).toBeGreaterThan(0);
    expect(cycles[0]?.message).toContain('alpha');
    expect(cycles[0]?.message).toContain('beta');
  });
});
