import { describe, expect, it } from 'vitest';

import {
  validateFixtureWorkspace,
  type ArchitectureViolation,
} from './architecture-harness.ts';
import {
  ARCHITECTURAL_ROLES,
  workspaceRoles,
} from '../../packages/config/eslint/contexts.js';

/**
 * Review #5 blocker B3 — a role is DECLARED, never inherited from a path.
 *
 * The analyser carried a directory-tier fallback:
 *
 *     unknown apps/*      ->  COMPOSITION  (Layer 4 — may reach many contexts)
 *     unknown packages/*  ->  PLATFORM     (Layer 0)
 *
 * So `mkdir apps/foo` was an architecture decision. A workspace nobody
 * classified received the privileges of the layer that composes every bounded
 * context, and the explicit role registry it was supposed to enforce became
 * advisory. The fallback is gone; classification is explicit and fails closed.
 *
 * Every assertion below names the EXACT diagnostic. Review #5 §28 is specific
 * that an unrelated violation must not be allowed to satisfy these tests — a
 * fixture that fails for the wrong reason proves the wrong thing.
 */

/** Violations of one rule, anywhere in the result. */
function ofRule(
  violations: readonly ArchitectureViolation[],
  rule: string,
): ArchitectureViolation[] {
  return violations.filter((violation) => violation.rule === rule);
}

/** Violations reported against one path suffix. */
function forFile(
  violations: readonly ArchitectureViolation[],
  suffix: string,
): ArchitectureViolation[] {
  return violations.filter((violation) => violation.file.endsWith(suffix));
}

describe('B3 — an unknown workspace has no role and fails closed', () => {
  const fixture = 'tests/fixtures/workspace-roles';

  it('reports `unclassified-workspace-role` for an unknown apps/* workspace', async () => {
    const violations = await validateFixtureWorkspace(fixture);
    const unclassified = ofRule(violations, 'unclassified-workspace-role');

    expect(
      unclassified.some((violation) => violation.file.endsWith('apps/unknown')),
    ).toBe(true);
  });

  it('reports `unclassified-workspace-role` for an unknown packages/* workspace', async () => {
    const violations = await validateFixtureWorkspace(fixture);
    const unclassified = ofRule(violations, 'unclassified-workspace-role');

    expect(
      unclassified.some((violation) => violation.file.endsWith('packages/unknown')),
    ).toBe(true);
  });

  it('fails an unknown app even when it imports only a PUBLIC context interface', async () => {
    const violations = await validateFixtureWorkspace(fixture);
    const page = forFile(violations, 'apps/unknown/src/page.ts');

    // Composing a context's public interface is precisely Layer 4's job, so
    // this file is architecturally innocent. It fails anyway, because the
    // ROLE is missing — and the role failure is the one that must fire, not
    // some incidental other diagnostic.
    expect(page.map((violation) => violation.rule)).toEqual([
      'unclassified-workspace-role',
    ]);
  });

  it('fails an unknown package that imports NOTHING', async () => {
    const violations = await validateFixtureWorkspace(fixture);
    const isolated = forFile(violations, 'packages/unknown/src/index.ts');

    // A workspace does not become safe by importing nothing. Round 5's
    // workspace-level check exists precisely so an empty or context-only
    // workspace cannot slip past a per-file rule.
    expect(isolated.map((violation) => violation.rule)).toEqual([
      'unclassified-workspace-role',
    ]);
  });

  it('accepts a workspace that DECLARES its role explicitly', async () => {
    const violations = await validateFixtureWorkspace(fixture);

    // The supported route for a workspace the approved roster does not name:
    // `minhaj.architecturalRole` in its own manifest. Explicit, reviewable,
    // and unable to override the roster.
    expect(forFile(violations, 'apps/declared/src/page.ts')).toEqual([]);
    expect(
      ofRule(violations, 'unclassified-workspace-role').filter((violation) =>
        violation.file.includes('declared'),
      ),
    ).toEqual([]);
  });

  it('names the directory-grant mistake in the diagnostic', async () => {
    const violations = await validateFixtureWorkspace(fixture);
    const unclassified = ofRule(violations, 'unclassified-workspace-role').find(
      (violation) => violation.file.endsWith('apps/unknown'),
    );

    // The message has to tell a reader what to DO — classify the workspace —
    // and why the directory did not do it for them.
    expect(unclassified?.message).toContain('@attacker/unknown-app');
    expect(unclassified?.message).toContain('a directory name grants nothing');
    expect(unclassified?.message).toContain('workspaceRoles');
  });
});

describe('B3 — the approved roster classifies every production workspace', () => {
  /**
   * The roles the approved documents assign. These are read from the registry
   * rather than restated, so a test cannot drift from the thing it checks —
   * but the EXPECTED VALUE is written out, so silently changing a role in the
   * registry fails here rather than passing by tautology.
   */
  const expected = {
    '@minhaj/web': ARCHITECTURAL_ROLES.COMPOSITION,
    '@minhaj/contracts': ARCHITECTURAL_ROLES.PLATFORM,
    '@minhaj/database': ARCHITECTURAL_ROLES.PLATFORM,
    '@minhaj/storage': ARCHITECTURAL_ROLES.PLATFORM,
    '@minhaj/server-core': ARCHITECTURAL_ROLES.SERVICE_HOST,
    '@minhaj/config': ARCHITECTURAL_ROLES.TOOLING,
    '@minhaj/realtime': ARCHITECTURAL_ROLES.REALTIME,
  } as const;

  for (const [name, role] of Object.entries(expected)) {
    it(`classifies ${name} as ${role}`, () => {
      expect(workspaceRoles[name]).toBe(role);
    });
  }

  it('grants no role by directory tier', async () => {
    const contexts = (await import('../../packages/config/eslint/contexts.js')) as Record<
      string,
      unknown
    >;

    // The export that carried `{ apps: composition, packages: platform }` is
    // gone, not merely emptied. An empty object would be one edit away from
    // being repopulated by someone who did not read Review #5.
    expect(contexts.roleByWorkspaceDirectory).toBeUndefined();
  });
});

describe('B3 — the real repository is fully classified', () => {
  it('reports no unclassified workspace in production source', async () => {
    const { validateArchitecture } = await import('./architecture-harness.ts');
    const { violations } = await validateArchitecture();

    expect(ofRule(violations, 'unclassified-workspace-role')).toEqual([]);
    expect(ofRule(violations, 'workspace-role-location-mismatch')).toEqual([]);
  });
});
