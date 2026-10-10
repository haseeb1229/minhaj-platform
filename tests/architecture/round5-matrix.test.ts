import { describe, expect, it } from 'vitest';

import {
  validateFixtureWorkspace,
  type ArchitectureViolation,
} from './architecture-harness.ts';

/**
 * Round 5 §27 — the adversarial matrix, asserted in one place.
 *
 * The individual suites prove each blocker in depth. This one states the whole
 * claim as a table, so a reader can see at a glance which shapes must FAIL and
 * which must PASS, and so a change that quietly flips one of them fails here
 * even if it satisfies the suite that was written around it.
 *
 * The CONTROLS matter as much as the attacks. A gate that rejects everything
 * is not a strict gate; it is a broken one, and the legitimate rows below are
 * what distinguish the two.
 */

/** Violations of one rule anywhere in a result. */
function ofRule(
  violations: readonly ArchitectureViolation[],
  rule: string,
): ArchitectureViolation[] {
  return violations.filter((violation) => violation.rule === rule);
}

describe('§27 — attacks that MUST fail', () => {
  const attacks = [
    {
      id: 'B-01',
      description:
        'included Messaging -> EXCLUDED declaration -> alias -> Quran internal',
      fixture: 'tests/fixtures/program-closure',
      rule: 'laundered-context-dependency',
      file: 'contexts/messaging/index.ts',
    },
    {
      id: 'B-02a',
      description: 'Messaging -> non-Next workspace-root next-env.d.ts -> Quran internal',
      fixture: 'tests/fixtures/root-declarations',
      rule: 'laundered-context-dependency',
      file: 'apps/plain/src/contexts/messaging/via-next-env.ts',
    },
    {
      id: 'B-02b',
      description: 'Messaging -> workspace-root types.d.ts -> Quran internal',
      fixture: 'tests/fixtures/root-declarations',
      rule: 'laundered-context-dependency',
      file: 'apps/plain/src/contexts/messaging/via-types.ts',
    },
    {
      id: 'B-03a',
      description: 'unknown apps/* workspace',
      fixture: 'tests/fixtures/workspace-roles',
      rule: 'unclassified-workspace-role',
      file: 'apps/unknown',
    },
    {
      id: 'B-03b',
      description: 'unknown packages/* workspace',
      fixture: 'tests/fixtures/workspace-roles',
      rule: 'unclassified-workspace-role',
      file: 'packages/unknown',
    },
  ] as const;

  for (const attack of attacks) {
    it(`${attack.id} — ${attack.description}`, async () => {
      const violations = await validateFixtureWorkspace(attack.fixture);
      const matching = ofRule(violations, attack.rule);

      // The EXACT rule against the EXACT file. An unrelated diagnostic must
      // not be allowed to satisfy the assertion (Review #5 §28).
      expect(
        matching.some((violation) => violation.file.endsWith(attack.file)),
        `expected ${attack.rule} against ${attack.file}, got: ` +
          violations.map((v) => `${v.rule} @ ${v.file}`).join('; '),
      ).toBe(true);
    });
  }
});

describe('§27 — controls that MUST pass', () => {
  it('registered composition -> PUBLIC Quran interface passes', async () => {
    const violations = await validateFixtureWorkspace('tests/fixtures/layer4');

    // `apps/web/src/app/page.ts` composes several contexts' public interfaces.
    // That is Layer 4 doing its job, and removing the directory-tier default
    // must not have broken it for the REGISTERED composition workspace.
    expect(violations.filter((v) => v.file.endsWith('app/page.ts'))).toEqual([]);
    expect(violations.filter((v) => v.file.endsWith('app/hub.ts'))).toEqual([]);
  });

  it('Messaging -> Learning passes in every import form', async () => {
    const violations = await validateFixtureWorkspace('tests/fixtures/allowed');

    // A permitted same-level edge (DOMAIN_MODEL.md §3.1).
    expect(violations).toEqual([]);
  });

  it('a workspace that DECLARES its role passes', async () => {
    const violations = await validateFixtureWorkspace('tests/fixtures/workspace-roles');

    expect(violations.filter((v) => v.file.includes('apps/declared'))).toEqual([]);
  });

  it('the genuine generated Next declaration stays out of the graph', async () => {
    const violations = await validateFixtureWorkspace('tests/fixtures/root-declarations');

    expect(violations.filter((v) => v.file.includes('apps/web'))).toEqual([]);
  });

  it('production source passes every rule', async () => {
    const { validateArchitecture } = await import('./architecture-harness.ts');
    const { violations } = await validateArchitecture();

    expect(violations).toEqual([]);
  });
});

describe('§27 — controls that MUST fail (the gate is not merely permissive)', () => {
  it('registered composition -> Quran INTERNAL fails', async () => {
    const violations = await validateFixtureWorkspace('tests/fixtures/layer4');

    expect(
      ofRule(violations, 'composition-internal-import').some((violation) =>
        violation.file.endsWith('app/deep.ts'),
      ),
    ).toBe(true);
  });

  it('contracts (Layer 0) -> a context fails', async () => {
    const violations = await validateFixtureWorkspace('tests/fixtures/layer4');

    expect(
      ofRule(violations, 'layer-zero-upward-dependency').some((violation) =>
        violation.file.endsWith('packages/contracts/src/index.ts'),
      ),
    ).toBe(true);
  });

  it('Messaging -> Quran fails', async () => {
    const violations = await validateFixtureWorkspace('tests/fixtures/layer4');

    expect(
      ofRule(violations, 'forbidden-context-dependency').some((violation) =>
        violation.file.endsWith('contexts/messaging/index.ts'),
      ),
    ).toBe(true);
  });
});
