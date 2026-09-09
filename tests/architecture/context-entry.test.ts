import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

import { contextBoundaryConfigs } from '../../packages/config/eslint/boundaries.js';
import {
  validateFixtureWorkspace,
  type ArchitectureViolation,
} from './architecture-harness.ts';

/**
 * F3 — legal context import semantics.
 *
 * A boundary rule can fail in two directions, and only one of them is usually
 * noticed. These cases are the other one: APPROVED imports that the enforcement
 * rejected.
 *
 *   1. A module inside context X importing another module inside context X
 *      through a nested relative path. ESLint restricted `../*` and `../../**`
 *      wholesale — "a context never escapes its own directory" — so nesting a
 *      context's own modules was a lint error. The pressure that creates is to
 *      flatten the architecture or to disable the rule, and §6.3 rule 12
 *      forbids the second outright.
 *
 *   2. The explicit `@/contexts/x/index` spelling of an allowlisted context's
 *      PUBLIC entry. TypeScript resolves it to the same file as
 *      `@/contexts/x`, and the resolving analyser always accepted it — but the
 *      string-matching ESLint rule swallowed it in `@/contexts/x/*` and called
 *      the public interface an internals breach.
 *
 * A rule that rejects correct code is not a strict rule; it is a wrong one, and
 * it teaches the team to distrust the gate. So both gates are exercised here —
 * the authoritative resolving analyser AND the local ESLint feedback — and the
 * near-neighbour negatives are asserted alongside every positive, because
 * loosening a rule is only safe if what it still rejects is stated.
 */

const FIXTURE = 'tests/fixtures/context-entry';

function forFile(
  violations: readonly ArchitectureViolation[],
  suffix: string,
): ArchitectureViolation[] {
  return violations.filter((violation) => violation.file.endsWith(suffix));
}

// ---------------------------------------------------------------------------
// The authoritative gate: the resolving architecture analyser
// ---------------------------------------------------------------------------

describe('F3 — the analyser accepts legal context imports', () => {
  it('accepts a nested own-context relative import', async () => {
    const violations = await validateFixtureWorkspace(FIXTURE);

    expect(forFile(violations, 'internal/store/conversations.ts')).toEqual([]);
  });

  it('accepts a nested own-context module reaching sideways within the context', async () => {
    const violations = await validateFixtureWorkspace(FIXTURE);

    expect(forFile(violations, 'policy/authorisation.ts')).toEqual([]);
  });

  it('accepts the canonical cross-context public entry of an allowlisted edge', async () => {
    const violations = await validateFixtureWorkspace(FIXTURE);

    expect(forFile(violations, 'canonical-entry.ts')).toEqual([]);
  });

  it('accepts the explicit `/index` form of the same public entry', async () => {
    const violations = await validateFixtureWorkspace(FIXTURE);

    expect(forFile(violations, 'index-entry.ts')).toEqual([]);
  });
});

describe('F3 — the analyser still rejects the near neighbours', () => {
  const cases: readonly (readonly [string, string])[] = [
    ['a relative climb into another context’s internals', 'cross-internal-relative.ts'],
    ['the same internals through the `@/` alias', 'alias-internal.ts'],
    ['an explicit private subpath beside the public entry', 'private-subpath.ts'],
  ];

  for (const [description, fixture] of cases) {
    it(`rejects ${description}`, async () => {
      const violations = await validateFixtureWorkspace(FIXTURE);

      expect(forFile(violations, fixture).map((v) => v.rule)).toContain(
        'context-internal-import',
      );
    });
  }
});

// ---------------------------------------------------------------------------
// The local gate: ESLint must agree rather than encode a second architecture
// ---------------------------------------------------------------------------

/**
 * Lints one specifier as it would be seen from one production file path.
 *
 * The FILE PATH is what selects the per-context config block, so this exercises
 * the real configuration the repository ships rather than a reconstruction of
 * it. No fixture file is needed: the rule matches specifiers, and the path
 * decides which set applies.
 */
async function lintImport(filePath: string, specifier: string): Promise<string[]> {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      {
        languageOptions: {
          parser: tseslint.parser,
          ecmaVersion: 2023,
          sourceType: 'module',
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
      },
      ...contextBoundaryConfigs({ appRoot: 'apps/web/src' }),
    ],
  });

  const [result] = await eslint.lintText(
    `import x from '${specifier}';\nexport default x;\n`,
    {
      filePath,
    },
  );

  return (result?.messages ?? []).map((message) => message.message);
}

const MESSAGING = 'apps/web/src/contexts/messaging';

describe('F3 — ESLint accepts what the analyser accepts', () => {
  it('permits a nested own-context relative import', async () => {
    expect(
      await lintImport(`${MESSAGING}/internal/store/conversations.ts`, '../identifiers'),
    ).toEqual([]);
  });

  it('permits a deeper own-context relative import', async () => {
    expect(
      await lintImport(
        `${MESSAGING}/internal/store/deep/repository.ts`,
        '../../../shared/ids',
      ),
    ).toEqual([]);
  });

  it('permits the canonical cross-context public entry', async () => {
    expect(await lintImport(`${MESSAGING}/service.ts`, '@/contexts/learning')).toEqual(
      [],
    );
  });

  it('permits the explicit `/index` public entry', async () => {
    expect(
      await lintImport(`${MESSAGING}/service.ts`, '@/contexts/learning/index'),
    ).toEqual([]);
  });

  it('permits an allowlisted context reached by relative path at its public entry', async () => {
    expect(await lintImport(`${MESSAGING}/service.ts`, '../learning/index')).toEqual([]);
  });

  it('permits an own-context subdirectory whose name equals another context slug', async () => {
    // A string glob sees "quran" and cannot know this path resolves inside
    // Messaging. The local rule must judge the resolved physical context.
    expect(
      await lintImport(`${MESSAGING}/feature/service.ts`, '../quran/helper'),
    ).toEqual([]);
  });
});

describe('F3 — ESLint still rejects the near neighbours', () => {
  const rejected: readonly (readonly [string, string])[] = [
    ['an allowlisted context’s internals by alias', '@/contexts/learning/internal/store'],
    ['a private subpath beside the public entry', '@/contexts/learning/service'],
    ['a forbidden context’s public entry', '@/contexts/quran'],
    ['a forbidden context’s internals', '@/contexts/quran/internal/text'],
    ['a relative climb into a forbidden context', '../quran/internal/text'],
    ['a deeper relative climb into a forbidden context', '../../contexts/quran'],
    [
      'a relative climb into an allowlisted context’s internals',
      '../learning/internal/store',
    ],
  ];

  for (const [description, specifier] of rejected) {
    it(`rejects ${description}`, async () => {
      const messages = await lintImport(`${MESSAGING}/service.ts`, specifier);

      expect(messages.length, `'${specifier}' must be rejected`).toBeGreaterThan(0);
      expect(messages.join('\n')).toContain('Architecture:');
    });
  }
});

describe('F3 — the two gates do not encode different architectures', () => {
  it('agrees with the analyser on every form the fixture exercises', async () => {
    // The pairing that matters: the same specifier shapes, run through both
    // gates, with the same verdict. ESLint is local feedback and the analyser
    // is authoritative — but "advisory" is no excuse for disagreeing, because a
    // developer who is told to fix passing code will reach for the exception
    // §6.3 rule 12 forbids.
    const violations = await validateFixtureWorkspace(FIXTURE);

    const analyserAccepts = [
      'canonical-entry.ts',
      'index-entry.ts',
      'internal/store/conversations.ts',
      'policy/authorisation.ts',
    ].every((file) => forFile(violations, file).length === 0);

    const eslintAccepts = (
      await Promise.all([
        lintImport(`${MESSAGING}/service.ts`, '@/contexts/learning'),
        lintImport(`${MESSAGING}/service.ts`, '@/contexts/learning/index'),
        lintImport(`${MESSAGING}/internal/store/conversations.ts`, '../identifiers'),
        lintImport(
          `${MESSAGING}/policy/authorisation.ts`,
          '../internal/store/conversations',
        ),
      ])
    ).every((messages) => messages.length === 0);

    expect(analyserAccepts).toBe(true);
    expect(eslintAccepts).toBe(true);
  });
});
