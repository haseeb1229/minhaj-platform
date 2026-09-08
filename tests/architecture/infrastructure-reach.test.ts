import { describe, expect, it } from 'vitest';

import {
  validateFixtureWorkspace,
  type ArchitectureViolation,
} from './architecture-harness.ts';

/**
 * Review #3 blocker B5 — transitive infrastructure laundering.
 *
 * Both of these were ACCEPTED by the previous analyser:
 *
 *     messaging     -> @minhaj/contracts -> @minhaj/database
 *     apps/realtime -> @minhaj/contracts -> @minhaj/database
 *
 * Each hop is individually approved. `@minhaj/contracts` is Layer 0 and
 * reachable from every bounded context by design; that is exactly what makes it
 * dangerous as a tunnel. If it may reach `@minhaj/database`, then all sixteen
 * contexts have the database without one of them naming it, and DOMAIN_MODEL.md
 * §2 rule 7 holds only for direct imports — which is to say, not at all.
 *
 * For `apps/realtime` the rule is stronger still. ARCHITECTURE.md §3.1 rule 1:
 * "`apps/realtime` never imports `packages/database`, Prisma, or any table
 * access." A wrapper chain does not satisfy "never". The whole point of the
 * shared server boundary (§3) is that the realtime process does not become a
 * second business backend with its own data access.
 *
 * `apps/realtime` is NOT built in Phase 0B (ARCHITECTURE.md §1.2). These
 * fixtures are isolated trees, so the rule is proven before the app exists
 * rather than after it is too late.
 */

/**
 * The literal source of the architecture deny list.
 *
 * Read from the file rather than imported, because the constant is module-
 * private. The assertion is about what the list CONTAINS, and its authority is
 * the approved documents — so reading it as text is honest about what is being
 * checked.
 */
async function denyListSource(): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile('scripts/architecture/rules.mjs', 'utf8');

  const start = source.indexOf('const CONCRETE_INFRASTRUCTURE');

  return source.slice(start, source.indexOf('});', start));
}

/** Violations reported for one fixture file, by filename. */
function forFile(
  violations: readonly ArchitectureViolation[],
  filename: string,
): ArchitectureViolation[] {
  return violations.filter((violation) => violation.file.endsWith(filename));
}

const fixture = 'tests/fixtures/infrastructure-reach';

describe('B5 — a bounded context cannot reach the database through Layer 0', () => {
  it('rejects the exact messaging -> contracts -> database reproduction', async () => {
    const violations = await validateFixtureWorkspace(fixture);
    const laundered = forFile(violations, 'via-contracts.ts').find(
      (violation) => violation.rule === 'context-laundered-workspace',
    );

    expect(
      laundered,
      'an approved first hop must not legalise a prohibited destination',
    ).toBeDefined();
    expect(laundered?.message).toContain("'messaging' reaches workspace");
    expect(laundered?.message).toContain('@minhaj/database');
  });

  it('shows the full dependency path', async () => {
    // A finding that says only "this is wrong" is not actionable. The chain is
    // the explanation.
    const violations = await validateFixtureWorkspace(fixture);
    const laundered = forFile(violations, 'via-contracts.ts').find(
      (violation) => violation.rule === 'context-laundered-workspace',
    );

    expect(laundered?.message).toContain('contracts/src/index.ts');
    expect(laundered?.message).toContain('database/src/index.ts');
  });

  it('rejects the same reach with an extra neutral hop', async () => {
    // messaging -> local neutral -> contracts -> database. Chain length is not
    // a defence.
    const violations = await validateFixtureWorkspace(fixture);
    const laundered = forFile(violations, 'via-neutral.ts').find(
      (violation) => violation.rule === 'context-laundered-workspace',
    );

    expect(laundered).toBeDefined();
    expect(laundered?.message).toContain('shared/neutral.ts');
    expect(laundered?.message).toContain('@minhaj/database');
  });

  it('applies to a different bounded context through a different route', async () => {
    // library -> wrapper -> contracts -> database. The rule is a property of
    // the architecture, not a special case for Messaging.
    const violations = await validateFixtureWorkspace(fixture);
    const laundered = forFile(violations, 'via-wrapper.ts').find(
      (violation) => violation.rule === 'context-laundered-workspace',
    );

    expect(laundered).toBeDefined();
    expect(laundered?.message).toContain("'library' reaches workspace");
  });
});

describe('B5 — a Layer 0 package must not become an infrastructure tunnel', () => {
  it('rejects contracts depending on the database at its source', async () => {
    // The other half of the defence, and the more useful diagnostic: report the
    // problem where it was introduced, not only at each of the sixteen places
    // that inherit it.
    const violations = await validateFixtureWorkspace(fixture);
    const tunnel = violations.filter(
      (violation) => violation.rule === 'layer-zero-infrastructure-tunnel',
    );

    expect(tunnel.length).toBeGreaterThan(0);
    expect(tunnel[0]?.file).toContain('contracts/src/index.ts');
    expect(tunnel[0]?.message).toContain('every bounded context may consume');
  });
});

describe('B5 — apps/realtime never reaches the database, transitively', () => {
  it('rejects the exact realtime -> contracts -> database reproduction', async () => {
    const violations = await validateFixtureWorkspace(fixture);
    const laundered = forFile(violations, 'realtime/src/via-contracts.ts').find(
      (violation) => violation.rule === 'realtime-laundered-database-access',
    );

    expect(
      laundered,
      'the realtime prohibition is absolute and must be transitive',
    ).toBeDefined();
    expect(laundered?.message).toContain('@minhaj/database');
    expect(laundered?.message).toContain('ARCHITECTURE.md §3.1 rule 1');
  });

  it('rejects a multi-hop realtime reach', async () => {
    // realtime -> wrapper -> contracts -> database.
    const violations = await validateFixtureWorkspace(fixture);
    const laundered = forFile(violations, 'via-multi-hop.ts').find(
      (violation) => violation.rule === 'realtime-laundered-database-access',
    );

    expect(laundered).toBeDefined();
    expect(laundered?.message).toContain('wrapper/src/index.ts');
  });

  it('points at the architected alternative rather than only refusing', async () => {
    const violations = await validateFixtureWorkspace(fixture);
    const laundered = forFile(violations, 'realtime/src/via-contracts.ts').find(
      (violation) => violation.rule === 'realtime-laundered-database-access',
    );

    expect(laundered?.message).toContain('@minhaj/server-core');
  });
});

describe('B5 — the legitimate cases still pass', () => {
  it('PERMITS realtime consuming a shared package with no prohibited downstream', async () => {
    // The control that keeps this rule honest. `apps/realtime` calling
    // context-owned services hosted in a shared package is the ARCHITECTED
    // design (ARCHITECTURE.md §3.1). A rule that also blocked this would have
    // banned the architecture it is meant to enforce.
    const violations = await validateFixtureWorkspace(fixture);

    expect(forFile(violations, 'via-safe.ts')).toEqual([]);
  });

  it('reports nothing against the safe shared package itself', async () => {
    const violations = await validateFixtureWorkspace(fixture);

    expect(forFile(violations, 'safe/src/index.ts')).toEqual([]);
  });
});

describe('N1 — the deny list carries only what the documents prohibit', () => {
  it('does not prohibit Node built-ins the approved architecture never names', async () => {
    // Review #3 (N1) found `child_process`, `net` and `dgram` on the
    // architecture deny list. DOMAIN_MODEL.md §2 rule 7 names Prisma, the
    // filesystem and search engines — and no approved document names those
    // three anywhere.
    //
    // A checker that enforces unapproved rules is not stricter than the
    // architecture; it is a DIFFERENT architecture, and it teaches the team to
    // distrust the gate. Security linting over Node built-ins may be added
    // later, as its own rule citing its own authority.
    const denyList = await denyListSource();

    for (const builtin of ['child_process', 'dgram']) {
      expect(
        denyList,
        `${builtin} is prohibited by no approved document and must not be on ` +
          `the architecture deny list`,
      ).not.toContain(builtin);
    }
  });

  it('still prohibits every category the documents DO name', async () => {
    // Removing the undocumented entries must not have weakened the documented
    // ones. DOMAIN_MODEL.md §2 rule 7: Prisma, the filesystem, a search engine.
    const denyList = await denyListSource();

    expect(denyList).toContain('the filesystem');
    expect(denyList).toContain('a search engine');
    expect(denyList).toContain('a database driver');
  });

  it('still rejects a context consuming the filesystem', async () => {
    // The documented prohibition, proven end to end rather than by reading the
    // list.
    const violations = await validateFixtureWorkspace('tests/fixtures/infrastructure');
    const found = forFile(violations, 'filesystem.ts');

    expect(found.map((violation) => violation.rule)).toContain(
      'context-concrete-infrastructure',
    );
  });
});
