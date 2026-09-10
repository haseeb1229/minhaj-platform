import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { repoRoot } from '../architecture/architecture-harness.ts';
// @ts-expect-error — the enforcement scripts are plain ESM, deliberately not
// part of a TypeScript project. The test consumes them exactly as the gate does.
import {
  decidingPattern,
  findPolicyViolations,
  isInContext,
  isSecretPath,
  readDockerignore,
  requiredContextPaths,
  secretCorpus,
} from '../../scripts/shared/docker-context.mjs';

/**
 * F7 — what the Docker build context EFFECTIVELY contains.
 *
 * `tests/config/docker-packaging.test.ts` already proves that specific patterns
 * are present, and that `.github` admits exactly one file. Both passed while
 * two secret classes reached the build context:
 *
 *   1. `*.pem`, `*.key`, `*.pfx`, `*.p12` are ROOT-ANCHORED — a single `*`
 *      never crosses a separator — so `apps/web/server.key` and
 *      `docker/tls.pem` were excluded by nothing at all.
 *
 *   2. The Round 6/7 fixture re-includes, written about generated-LOOKING
 *      directory names and nothing to do with secrets, reopened `**\/.env`
 *      beneath themselves. `tests/fixtures/a/src/dist/.env` was admitted by
 *      `!tests/fixtures/**\/src/dist/**` — the last pattern to match it.
 *
 * Neither is visible to a test that asserts a pattern is PRESENT. Both are
 * obvious to one that asks what a given path would actually do. So every
 * assertion here EVALUATES the committed policy, and the evaluator is the one
 * the enforcement gate uses — not a second implementation that could agree with
 * the file while disagreeing with the gate.
 *
 * No Docker daemon is required, deliberately. The committed policy decides what
 * a build context contains, so the policy is what is checked, on every platform
 * and in every job.
 */

const patterns = readDockerignore(repoRoot);

/** A throwaway repository root holding one `.dockerignore`, for the gate. */
const temporaryRoots: string[] = [];

function policyRoot(dockerignore: string): string {
  const root = mkdtempSync(path.join(tmpdir(), 'minhaj-dockerignore-'));
  temporaryRoots.push(root);
  writeFileSync(path.join(root, '.dockerignore'), dockerignore, 'utf8');
  return root;
}

afterAll(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

describe('F7.1 — secrets are excluded at the root and at every depth', () => {
  it.each([
    ['the root environment file', '.env'],
    ['the ignored local compose environment', 'docker/.env'],
    ['a workspace environment file', 'apps/web/.env'],
    ['a local override', '.env.local'],
    ['a nested local override', 'packages/database/.env.local'],
    ['a production environment file', 'apps/web/.env.production'],
    ['a deeply nested environment file', 'a/b/c/d/e/.env'],
    ['a deeply nested variant', 'a/b/c/d/e/.env.production.local'],
    ['a nested private key', 'apps/web/server.key'],
    ['a nested certificate bundle', 'docker/tls.pem'],
    ['a nested PKCS#12 store', 'packages/database/store.p12'],
    ['a credentials directory', 'secrets/service-account.json'],
    ['a nested credentials directory', 'packages/database/.secrets/credentials.json'],
  ])('excludes %s', (_label, candidate) => {
    expect(isInContext(patterns, candidate)).toBe(false);
  });

  /**
   * The root-anchored forms were the whole defect in class 1. Naming them
   * separately means a future edit that deletes the recursive `**\/*.key`
   * family fails HERE, with the reason attached, rather than in a corpus loop.
   */
  it.each(['apps/web/private.key', 'docker/server.crt', 'a/b/c/client.pfx'])(
    'excludes %s recursively, which a single `*` never could',
    (candidate) => {
      expect(isInContext(patterns, candidate)).toBe(false);
    },
  );
});

describe('F7.2 — a later negation cannot restore a secret', () => {
  /**
   * The exact leak, at the exact paths the committed re-includes opened. These
   * assertions FAILED against the policy this replaced.
   */
  it.each([
    'tests/fixtures/a/src/dist/.env',
    'tests/fixtures/a/src/build/.env',
    'tests/fixtures/a/src/coverage/.env.local',
    'tests/fixtures/a/src/features/dist/.env',
    'tests/fixtures/generated-output-import/apps/app/dist/.env',
    'tests/fixtures/generated-output-import/apps/app/types/.env.production',
  ])('keeps %s out despite the fixture re-include above it', (candidate) => {
    expect(isInContext(patterns, candidate)).toBe(false);
  });

  it('decides those paths by the final deny block, not by the negation', () => {
    const deciding = decidingPattern(patterns, 'tests/fixtures/a/src/dist/.env');

    expect(deciding).not.toMatch(/^!/);
    expect(deciding).toMatch(/\.env/);
  });

  /** No negation anywhere in the file may NAME secret material. */
  it('carries no negation that re-includes a secret path', () => {
    const offending = patterns
      .filter((entry: { negated: boolean }) => entry.negated)
      .map((entry: { pattern: string }) =>
        entry.pattern.replaceAll('**/', '').replaceAll('*', 'w'),
      )
      .filter((concrete: string) => isSecretPath(concrete));

    expect(offending).toEqual([]);
  });

  it('admits `.env.example` — the one deliberate exception — at any depth', () => {
    expect(isInContext(patterns, '.env.example')).toBe(true);
    expect(isInContext(patterns, 'apps/web/.env.example')).toBe(true);
    // …and admitting it must not admit anything beside it.
    expect(isInContext(patterns, '.env.example/server.key')).toBe(false);
    expect(isInContext(patterns, 'apps/web/.env.example/.env')).toBe(false);
  });
});

describe('F7.3 — the corpus is derived from the policy, not hard-coded', () => {
  /**
   * The property that makes this survive an edit nobody has made yet: every
   * `!` line is a hole in the exclusions, so each one generates its own
   * adversarial candidates. A negation added next year is probed next year.
   */
  it('derives candidates beneath every negation the file contains', () => {
    const corpus: string[] = secretCorpus(patterns);

    expect(corpus.length).toBeGreaterThan(50);
    expect(corpus).toContain('tests/fixtures/w/src/dist/.env');
    expect(corpus.every((candidate) => isSecretPath(candidate))).toBe(true);
  });

  it('probes a negation that does not exist in the committed file', () => {
    // A hypothetical future re-include. The corpus must grow to cover it
    // without anyone editing the checker.
    const withNewNegation = [
      ...patterns,
      { raw: '!tools/**', negated: true, pattern: 'tools/**' },
    ];

    expect(secretCorpus(withNewNegation)).toContain('tools/.env');
  });

  it('reports every corpus path as excluded under the committed policy', () => {
    const admitted = secretCorpus(patterns).filter((candidate: string) =>
      isInContext(patterns, candidate),
    );

    expect(admitted).toEqual([]);
  });
});

describe('F7.4 — legitimate build inputs are preserved', () => {
  it.each(requiredContextPaths as readonly string[])(
    'keeps %s in the context',
    (required) => {
      expect(isInContext(patterns, required)).toBe(true);
    },
  );

  it.each([
    ['ordinary application source', 'apps/web/src/app/[locale]/layout.tsx'],
    ['an interface message catalogue', 'apps/web/messages/en.json'],
    ['package source', 'packages/contracts/src/index.ts'],
    ['a migration', 'packages/database/prisma/migrations/0001_init/migration.sql'],
    ['the Prisma schema', 'packages/database/prisma/schema.prisma'],
    [
      'a Round 6 fixture whose directory name looks generated',
      'tests/fixtures/a/src/dist/thing.ts',
    ],
    [
      'a Round 7 fixture carrying genuine emitted output',
      'tests/fixtures/generated-output-import/apps/app/types/index.d.ts',
    ],
  ])('keeps %s available', (_label, candidate) => {
    expect(isInContext(patterns, candidate)).toBe(true);
  });

  it('still excludes host node_modules and build output', () => {
    // The other half of what `.dockerignore` is for. A secret policy that
    // quietly re-admitted Windows-host binaries would break the image.
    for (const candidate of [
      'node_modules/react/index.js',
      'apps/web/node_modules/x/index.js',
      'apps/web/.next/BUILD_ID',
      '.git/config',
    ]) {
      expect(isInContext(patterns, candidate), candidate).toBe(false);
    }
  });
});

describe('F7.5 — the evaluator is capable of failing', () => {
  /**
   * A green check proves nothing unless the checker can go red. Each policy
   * below is a real mistake someone could make, and every one must be caught.
   */
  it('detects the fixture-negation leak this change fixed', () => {
    const unsafe = readDockerignore(
      policyRoot(['**/.env', '!tests/fixtures/**/src/dist/**'].join('\n')),
    );

    expect(isInContext(unsafe, 'tests/fixtures/a/src/dist/.env')).toBe(true);
    expect(
      findPolicyViolations(unsafe).some(
        (violation: { kind: string }) => violation.kind === 'secret-in-context',
      ),
    ).toBe(true);
  });

  it('detects root-anchored key patterns leaving nested keys exposed', () => {
    const unsafe = readDockerignore(policyRoot(['.env', '*.key', '*.pem'].join('\n')));

    expect(isInContext(unsafe, 'apps/web/server.key')).toBe(true);
    expect(findPolicyViolations(unsafe).length).toBeGreaterThan(0);
  });

  it('detects a deliberate secret re-include, even one that names a file', () => {
    const unsafe = readDockerignore(
      policyRoot(['**/.env', '**/.env.*', '!docker/.env'].join('\n')),
    );

    const violations = findPolicyViolations(unsafe);

    expect(
      violations.some(
        (violation: { kind: string }) => violation.kind === 'negation-names-secret',
      ),
    ).toBe(true);
    expect(isInContext(unsafe, 'docker/.env')).toBe(true);
  });

  it('detects a policy that excludes a required build input', () => {
    const unsafe = readDockerignore(
      policyRoot(
        [
          '**/.env',
          '**/.env.*',
          '**/*.key',
          '**/*.pem',
          '**/*.pfx',
          '**/*.p12',
          '**/*.crt',
          '**/*.cer',
          '**/*.der',
          '**/secrets/',
          '**/.secrets/',
          'package.json',
        ].join('\n'),
      ),
    );

    expect(
      findPolicyViolations(unsafe).some(
        (violation: { kind: string }) => violation.kind === 'required-input-excluded',
      ),
    ).toBe(true);
  });
});

describe('F7.6 — the evaluator matches Docker’s own precedence rules', () => {
  /**
   * The model is moby's `MatchesUsingParentResult`: a path inherits its
   * parent's verdict, then the LAST pattern matching the path itself decides.
   *
   * Being stricter than Docker would be the dangerous error — it would report a
   * path as excluded that a real build packages — so the accepted `.github`
   * expectations are re-derived here through this evaluator. Both suites must
   * describe the same Docker.
   */
  it('re-includes a single file beneath an excluded directory', () => {
    expect(isInContext(patterns, '.github/workflows/ci.yml')).toBe(true);
  });

  it.each([
    '.github/UNRELATED_SENTINEL',
    '.github/CODEOWNERS',
    '.github/ISSUE_TEMPLATE/bug.md',
    '.github/actions/setup/action.yml',
    '.github/workflows/deploy.yml',
  ])('excludes %s, which no negation names', (candidate) => {
    expect(isInContext(patterns, candidate)).toBe(false);
  });

  it('treats `**` as crossing separators and `*` as not', () => {
    const single = readDockerignore(policyRoot('*.key'));
    const double = readDockerignore(policyRoot('**/*.key'));

    expect(isInContext(single, 'server.key')).toBe(false);
    expect(isInContext(single, 'apps/server.key')).toBe(true);
    expect(isInContext(double, 'server.key')).toBe(false);
    expect(isInContext(double, 'apps/web/server.key')).toBe(false);
  });

  it('lets a later parent negation override an earlier leaf exclusion', () => {
    // Docker evaluates patterns in file order and tests each against the path
    // and its parents. An ancestor-first evaluator gets this backwards: it
    // sees `!apps` at the parent, then re-applies `**/.env` at the leaf and
    // incorrectly reports the secret as excluded.
    const unsafe = readDockerignore(policyRoot(['**/.env', '!apps'].join('\n')));

    expect(isInContext(unsafe, 'apps/web/.env')).toBe(true);
    expect(
      findPolicyViolations(unsafe).some(
        (violation: { kind: string; candidate: string }) =>
          violation.kind === 'secret-in-context' &&
          violation.candidate === 'apps/web/.env',
      ),
    ).toBe(true);
  });

  it('cleans parent traversal in patterns before applying precedence', () => {
    const unsafe = readDockerignore(policyRoot(['**/.env', '!safe/../apps'].join('\n')));

    expect(isInContext(unsafe, 'apps/web/.env')).toBe(true);
    expect(findPolicyViolations(unsafe).length).toBeGreaterThan(0);
  });
});

describe('F7.7 — the gate fails closed and runs in the normal path', () => {
  function runGate(cwd: string) {
    return spawnSync(
      process.execPath,
      [path.join(repoRoot, 'scripts', 'check-docker-context.mjs')],
      { cwd, encoding: 'utf8' },
    );
  }

  it('passes against the committed policy', () => {
    const result = runGate(repoRoot);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('no secret artifact reachable');
  });

  it('rejects a missing policy rather than reporting success', () => {
    // The worst possible input: with no `.dockerignore`, the ENTIRE working
    // tree — every `.env` included — is sent to the daemon. Absent evidence
    // must never read as a pass.
    const empty = mkdtempSync(path.join(tmpdir(), 'minhaj-no-dockerignore-'));
    temporaryRoots.push(empty);

    expect(() => readDockerignore(empty)).toThrow(/could not be read/);
  });

  it('rejects an empty policy', () => {
    expect(() => readDockerignore(policyRoot('# only a comment\n\n'))).toThrow(
      /no patterns/,
    );
  });

  it('rejects a malformed pattern rather than skipping it', () => {
    expect(() => readDockerignore(policyRoot(['**/.env', '!'].join('\n')))).toThrow(
      /malformed/,
    );
  });

  it('rejects platform-ambiguous or unsupported patterns rather than approximating them', () => {
    expect(() => readDockerignore(policyRoot('**\\.env'))).toThrow(/backslash/);
    expect(() => readDockerignore(policyRoot('secret[0-9].key'))).toThrow(
      /character class/,
    );
    expect(() => readDockerignore(policyRoot('apps/**secret/.env'))).toThrow(
      /whole segments/,
    );
  });

  it('is wired into `verify`, so an unsafe edit cannot reach CI unchecked', async () => {
    const { readFile } = await import('node:fs/promises');
    const manifest = JSON.parse(
      await readFile(path.join(repoRoot, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };

    expect(manifest.scripts['check:docker-context']).toBe(
      'node scripts/check-docker-context.mjs',
    );
    expect(manifest.scripts['verify']).toContain('check:docker-context');
  });
});
