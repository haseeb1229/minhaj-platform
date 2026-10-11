import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  contextAllowlist,
  contextSlugs,
  permittedSameLevelEdges,
} from '../../packages/config/eslint/contexts.js';
import { validateArchitecture, repoRoot } from './architecture-harness.ts';

/**
 * Bounded-context dependency enforcement (DOMAIN_MODEL.md §3.1, §3.2).
 *
 * The authoritative gate is `scripts/check-architecture.mjs`: it resolves every
 * import specifier to a real file path and runs as its own process, so neither
 * a syntactic disguise nor an inline ESLint directive can evade it.
 *
 * These tests drive that checker against adversarial fixtures. A negative test
 * PASSES by proving an invalid fixture is rejected; no intentionally broken
 * file exists in production source.
 */

const BYPASS = 'tests/fixtures/bypass';
const ALLOWED = 'tests/fixtures/allowed';

/**
 * Runs the real analyser over one fixture WORKSPACE tree.
 *
 * The fixture carries its own root manifest, so discovery, resolution and rule
 * evaluation all follow the production code path rather than a test shortcut.
 */
async function check(root: string) {
  const { violations } = await validateArchitecture(null, path.join(repoRoot, root));
  return violations;
}

/** Violations reported for one fixture file. */
async function violationsFor(root: string, fixtureFile: string) {
  const violations = await check(root);
  return violations.filter((violation) => violation.file.endsWith(fixtureFile));
}

describe('production source satisfies the architecture', () => {
  it('reports no violations for the real application and packages', async () => {
    const { violations } = await validateArchitecture();

    expect(violations).toEqual([]);
  });
});

describe('A — permitted dependencies pass in every import form', () => {
  it('accepts the allowlisted messaging -> learning, editorial -> global-network and editorial -> media edges as import, re-export and dynamic import', async () => {
    const violations = await check(ALLOWED);

    expect(violations).toEqual([]);
  });
});

describe('B1 — forbidden dependencies fail regardless of import syntax', () => {
  const cases: readonly (readonly [string, string, string])[] = [
    ['alias import', 'eslint-disable-bypass.ts', 'forbidden-context-dependency'],
    ['relative import', 'relative-bypass.ts', 'forbidden-context-dependency'],
    ['dynamic import()', 'dynamic-bypass.ts', 'forbidden-context-dependency'],
    ['export … from re-export', 'reexport-bypass.ts', 'forbidden-context-dependency'],
    ['explicit .js extension', 'js-extension-bypass.ts', 'forbidden-context-dependency'],
    ['require()', 'require-bypass.ts', 'forbidden-context-dependency'],
    [
      'deep relative traversal',
      'deep-relative-bypass.ts',
      'forbidden-context-dependency',
    ],
  ];

  for (const [form, fixture, rule] of cases) {
    it(`rejects a forbidden dependency written as a ${form}`, async () => {
      const violations = await violationsFor(BYPASS, fixture);

      expect(violations.length).toBeGreaterThan(0);
      expect(violations.map((violation) => violation.rule)).toContain(rule);
    });
  }

  it('rejects an unknown context root such as contexts/invented', async () => {
    const violations = await violationsFor(BYPASS, 'invented/service.ts');

    expect(violations.map((violation) => violation.rule)).toContain('unknown-context');
  });

  it('rejects reaching internals even of an allowlisted context, via a relative path', async () => {
    const violations = await violationsFor(BYPASS, 'internal-relative-bypass.ts');

    expect(violations.map((violation) => violation.rule)).toContain(
      'context-internal-import',
    );
  });
});

describe('B2 — an inline ESLint disable cannot defeat the architecture', () => {
  it('still rejects a forbidden dependency carrying eslint-disable comments', async () => {
    // The fixture carries BOTH `/* eslint-disable no-restricted-imports */`
    // and `// eslint-disable-next-line no-restricted-imports`. The checker is
    // a separate process and does not read ESLint directives at all.
    const violations = await violationsFor(BYPASS, 'eslint-disable-bypass.ts');

    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]?.message).toContain("'messaging' may not depend on 'quran'");
  });
});

describe('E — the reverse same-level edge remains prohibited', () => {
  it('rejects learning -> messaging even as a dynamic import', async () => {
    const violations = await violationsFor(BYPASS, 'reverse-dynamic-bypass.ts');

    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]?.message).toContain("'learning' may not depend on 'messaging'");
  });

  it('does not list messaging on the learning row of the allowlist', () => {
    expect(contextAllowlist.learning).not.toContain('messaging');
  });

  // Phase 16: Editorial names a Global-owned Centre; Global never reads News.
  it('rejects global-network -> editorial even as a dynamic import', async () => {
    const violations = await violationsFor(BYPASS, 'reverse-editorial-bypass.ts');

    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]?.message).toContain(
      "'global-network' may not depend on 'editorial'",
    );
  });

  it('rejects editorial reaching global-network internals through a relative path', async () => {
    const violations = await violationsFor(BYPASS, 'global-internal-bypass.ts');

    expect(violations.map((violation) => violation.rule)).toContain(
      'context-internal-import',
    );
  });

  it('does not list editorial on the global-network row of the allowlist', () => {
    expect(contextAllowlist['global-network']).not.toContain('editorial');
  });
});

describe('B3 — Layer 0 rules are enforced against real source', () => {
  it('rejects a context importing Prisma directly', async () => {
    const violations = await violationsFor(BYPASS, 'prohibited-package.ts');

    expect(violations.map((violation) => violation.rule)).toContain(
      'context-prohibited-package',
    );
    expect(violations[0]?.message).toContain('Prisma');
  });

  it('rejects a context importing server-core, which is a host and not a layer', async () => {
    const violations = await violationsFor(BYPASS, 'server-core-from-context.ts');

    expect(violations.map((violation) => violation.rule)).toContain(
      'context-prohibited-package',
    );
  });
});

describe('B3 — cycles in the real import graph are detected', () => {
  it('rejects a genuine module-level cycle', async () => {
    const violations = await check('tests/fixtures/cycle');
    const cycles = violations.filter((violation) => violation.rule === 'import-cycle');

    expect(cycles.length).toBeGreaterThan(0);
    expect(cycles[0]?.message).toContain('alpha');
    expect(cycles[0]?.message).toContain('beta');
  });
});

describe('B6 — production JavaScript cannot bypass the rules', () => {
  it('rejects a .js file in production source', async () => {
    const violations = await violationsFor(BYPASS, 'js-production-file.js');

    expect(violations.map((violation) => violation.rule)).toContain(
      'production-must-be-typescript',
    );
  });

  it('rejects a .jsx file in production source', async () => {
    const violations = await violationsFor(BYPASS, 'jsx-production-file.jsx');

    expect(violations.map((violation) => violation.rule)).toContain(
      'production-must-be-typescript',
    );
  });
});

describe('D — the allowlist itself matches DOMAIN_MODEL.md §3.1', () => {
  it('records exactly the three permitted same-level edges, each in its allowlist row', () => {
    expect(permittedSameLevelEdges).toEqual([
      { from: 'messaging', to: 'learning' },
      { from: 'editorial', to: 'global-network' },
      // Phase 14: an Event owns its typed association to Media-owned Galleries.
      { from: 'editorial', to: 'media' },
    ]);
    for (const edge of permittedSameLevelEdges) {
      expect(contextAllowlist[edge.from]).toContain(edge.to);
      expect(contextAllowlist[edge.to]).not.toContain(edge.from);
    }
  });

  it('has an allowlist row for every one of the 16 contexts', () => {
    expect(Object.keys(contextAllowlist).sort()).toEqual([...contextSlugs].sort());
  });

  it('names every target explicitly rather than permitting a wildcard', () => {
    for (const [slug, permitted] of Object.entries(contextAllowlist)) {
      for (const target of permitted) {
        expect(contextSlugs).toContain(target);
        expect(target).not.toBe(slug);
      }
    }
  });

  it('is acyclic', () => {
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const cycles: string[] = [];

    const walk = (slug: string, trail: readonly string[]): void => {
      if (visiting.has(slug)) {
        cycles.push([...trail, slug].join(' -> '));
        return;
      }
      if (visited.has(slug)) return;

      visiting.add(slug);
      for (const next of contextAllowlist[slug] ?? []) walk(next, [...trail, slug]);
      visiting.delete(slug);
      visited.add(slug);
    };

    for (const slug of contextSlugs) walk(slug, []);

    expect(cycles).toEqual([]);
  });

  it('keeps Quran and Hadith out of every other context dependency list', () => {
    for (const [slug, permitted] of Object.entries(contextAllowlist)) {
      expect(permitted, `${slug} must not depend on quran`).not.toContain('quran');
      expect(permitted, `${slug} must not depend on hadith`).not.toContain('hadith');
    }
  });

  it('gives Migration & Provenance no target content context', () => {
    for (const target of [
      'editorial',
      'quran',
      'hadith',
      'library',
      'media',
      'fatwa',
      'global-network',
    ]) {
      expect(contextAllowlist['migration-provenance']).not.toContain(target);
    }
  });

  it('gives Personalisation no content-context dependency', () => {
    expect(contextAllowlist['personalisation-notifications']).toEqual([
      'identity-access',
    ]);
  });

  it('leaves Identity & Access and Taxonomy on Layer 0 only', () => {
    expect(contextAllowlist['identity-access']).toEqual([]);
    expect(contextAllowlist.taxonomy).toEqual([]);
  });
});
