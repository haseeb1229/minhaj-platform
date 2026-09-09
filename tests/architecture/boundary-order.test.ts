import { describe, expect, it } from 'vitest';

import {
  validateFixtureWorkspace,
  type ArchitectureViolation,
} from './architecture-harness.ts';

/**
 * F2 — context boundary enforcement must not depend on import order.
 *
 * Transitive context reachability recorded only the FIRST file it reached for
 * each context slug. A context reached through both its legal public entry and
 * a forbidden internal file therefore produced ONE record, and which one it was
 * depended on the order the imports happened to be written in:
 *
 *     import { publicThing }  from '@/contexts/learning';          // legal
 *     import { privateThing } from '@/contexts/learning/internal/…';
 *
 * Declaring the public import first MASKED the internals breach entirely, and
 * swapping the two lines changed the verdict. A gate whose answer depends on
 * statement order is not enforcing anything — and worse, an innocent import
 * reorder, an auto-fixer, or a barrel that resolves a shade differently could
 * silently delete a real finding.
 *
 * The correction is semantic rather than cosmetic: every distinct boundary
 * ENTRY is recorded, keyed by the resolved target file, so the result is a set.
 * Sorting the imports would have hidden the bug; this removes it.
 */

function rulesFor(
  violations: readonly ArchitectureViolation[],
  suffix: string,
): string[] {
  return violations
    .filter((violation) => violation.file.endsWith(suffix))
    .map((violation) => violation.rule);
}

const FIXTURE = 'tests/fixtures/boundary-order';

describe('F2 — a legal public entry cannot mask a forbidden internal reach', () => {
  it('reports the internals breach when the PUBLIC entry is declared first', async () => {
    const violations = await validateFixtureWorkspace(FIXTURE);

    expect(rulesFor(violations, 'public-first.ts')).toContain('context-internal-import');
  });

  it('reports the internals breach when the PRIVATE entry is declared first', async () => {
    const violations = await validateFixtureWorkspace(FIXTURE);

    expect(rulesFor(violations, 'private-first.ts')).toContain('context-internal-import');
  });

  it('produces the SAME verdict for both orders', async () => {
    // The claim is not "both fail" but "both fail identically". Two files
    // differing only in the order of two import statements must be
    // indistinguishable to the gate.
    const violations = await validateFixtureWorkspace(FIXTURE);

    const publicFirst = rulesFor(violations, 'public-first.ts').sort();
    const privateFirst = rulesFor(violations, 'private-first.ts').sort();

    expect(publicFirst).toEqual(privateFirst);
    expect(publicFirst.length).toBeGreaterThan(0);
  });

  it('reports it when the public entry arrives through a BARREL', async () => {
    // The legal reach is now transitive and the illegal one direct, so the two
    // records have different trail lengths. Neither may discard the other.
    const violations = await validateFixtureWorkspace(FIXTURE);

    expect(rulesFor(violations, 'barrel-then-private.ts')).toContain(
      'context-internal-import',
    );
  });

  it('reports it when the internals arrive through a neutral WRAPPER', async () => {
    const violations = await validateFixtureWorkspace(FIXTURE);

    expect(rulesFor(violations, 'public-then-wrapper.ts')).toContain(
      'context-internal-import',
    );
  });

  it('keeps the same verdict when the private wrapper is declared before the public entry', async () => {
    // Adversarial permutation added by the independent review: the existing
    // matrix covered public-direct/private-wrapper in only one source order.
    const violations = await validateFixtureWorkspace(FIXTURE);

    expect(rulesFor(violations, 'wrapper-then-public.ts').sort()).toEqual(
      rulesFor(violations, 'public-then-wrapper.ts').sort(),
    );
    expect(rulesFor(violations, 'wrapper-then-public.ts')).toContain(
      'context-internal-import',
    );
  });

  it('names the internal file rather than the public entry beside it', async () => {
    // A finding that pointed at `contexts/learning/index.ts` would send the
    // reader to the legal import and tell them nothing.
    const violations = await validateFixtureWorkspace(FIXTURE);

    const found = violations.find(
      (violation) =>
        violation.file.endsWith('public-first.ts') &&
        violation.rule === 'context-internal-import',
    );

    expect(found?.message).toContain('enrolment-repository');
    expect(found?.specifier).toContain('enrolment-repository');
  });

  it('still PERMITS reaching only the allowlisted public entry', async () => {
    // The control. If this also failed, the fix would have been "report
    // everything", which is not enforcement either.
    const violations = await validateFixtureWorkspace(FIXTURE);

    expect(violations.filter((v) => v.file.endsWith('public-only.ts'))).toEqual([]);
  });
});

describe('F2 — the result is stable, not merely correct once', () => {
  it('produces byte-identical findings across repeated runs', async () => {
    // Order independence has to hold for the OUTPUT too: a gate that reports
    // the same violations in a different order on each run is one a reviewer
    // cannot diff, and a shortest-path tie broken arbitrarily would do exactly
    // that.
    const first = await validateFixtureWorkspace(FIXTURE);
    const second = await validateFixtureWorkspace(FIXTURE);

    expect(JSON.stringify(second)).toEqual(JSON.stringify(first));
  });

  it('reports each distinct internal path once, not once per route to it', async () => {
    // Order independence must not be bought with duplicate noise. The wrapper
    // case reaches ONE internal file, and reports it once.
    const violations = await validateFixtureWorkspace(FIXTURE);

    const internal = violations.filter(
      (violation) =>
        violation.file.endsWith('public-then-wrapper.ts') &&
        violation.rule === 'context-internal-import',
    );

    expect(internal).toHaveLength(1);
  });
});
