/**
 * THE build-context secret policy, and the evaluator that proves it.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * `.dockerignore` excludes `.env` at every depth. It then, ninety lines later,
 * re-includes fixture trees:
 *
 *     **\/.env                                 ← excludes tests/…/src/dist/.env
 *     !tests/fixtures/**\/src/dist/**          ← re-includes it again
 *
 * Docker applies the LAST matching pattern. The second line was written for an
 * entirely unrelated reason — authored fixtures living in directories called
 * `dist` — and it silently reopened the secret exclusion beneath itself. Every
 * individual line is defensible; the FILE was not.
 *
 * That is not a bug to patch by appending another line. It is a structural
 * property of an ordered ignore file: any future negation, written for any
 * reason, can undo any earlier exclusion, and nothing tells the author.
 *
 * So the policy is enforced OUT of the file:
 *
 *   1. `.dockerignore` ends with a final secret-deny block, so nothing in the
 *      file today overrides it.
 *   2. This module EVALUATES the file against a corpus of secret paths, and
 *      derives extra corpus entries FROM THE NEGATIONS THE FILE ACTUALLY
 *      CONTAINS. A negation added tomorrow generates its own adversarial
 *      candidates, so the check keeps working on a policy it has never seen.
 *   3. `scripts/check-docker-context.mjs` runs it in `verify` and in CI, so an
 *      unsafe edit fails before it can ship.
 *
 * It needs no Docker daemon: it reasons about the committed policy, which is
 * the thing that decides what a build context contains.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

/* ===========================================================================
 * Docker `.dockerignore` semantics.
 *
 * Modelled on moby's `patternmatcher`, deliberately faithfully. A checker that
 * is STRICTER than Docker is the dangerous kind: it would report a path as
 * excluded that a real build happily packages.
 * ========================================================================= */

/** One parsed pattern. */
function parsePattern(raw) {
  const negated = raw.startsWith('!');
  const body = negated ? raw.slice(1).trim() : raw.trim();

  // This evaluator intentionally models slash-separated Docker patterns. A
  // backslash is an escape on the Linux builder but a separator on Windows;
  // normalising it here would let a policy pass locally and behave differently
  // in CI. Character classes and embedded globstars are outside the supported
  // subset, so reject them rather than silently approximate Docker.
  if (body.includes('\\')) {
    throw new Error(
      `.dockerignore pattern '${raw}' uses a backslash; use Docker '/' separators`,
    );
  }
  if (body.includes('[') || body.includes(']')) {
    throw new Error(
      `.dockerignore pattern '${raw}' uses a character class this policy evaluator does not support`,
    );
  }
  if (body.split('/').some((segment) => segment.includes('**') && segment !== '**')) {
    throw new Error(
      `.dockerignore pattern '${raw}' uses '**' inside a path segment; keep globstars as whole segments`,
    );
  }

  // Docker cleans each pattern and drops a trailing separator, so `dir/` and
  // `dir` are one rule. Use POSIX cleaning deliberately: Docker patterns are
  // slash-separated even when this repository is checked from Windows.
  const slashSeparated = body.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  const cleaned = slashSeparated === '' ? '' : path.posix.normalize(slashSeparated);

  return { raw, negated, pattern: cleaned };
}

/**
 * Compiles a pattern to a regular expression over a slash-separated path.
 *
 * `**` crosses separators, `*` and `?` do not — moby's rule, and the reason
 * `**\/.env` reaches `docker/.env` while `.env.*` does not.
 */
function compilePattern(pattern) {
  let expression = '';

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];

    if (character === '*') {
      if (pattern[index + 1] === '*') {
        index += 1;
        if (pattern[index + 1] === '/') {
          index += 1;
          // `**/` matches any number of leading directories, including none.
          expression += '(?:.*\\/)?';
        } else if (index === pattern.length - 1) {
          expression += '.*';
        } else {
          expression += '.*';
        }
      } else {
        expression += '[^/]*';
      }
      continue;
    }

    if (character === '?') {
      expression += '[^/]';
      continue;
    }

    expression += character.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }

  return new RegExp(`^${expression}$`);
}

/**
 * Is `candidate` in the build context under `patterns`?
 *
 * This is moby's `MatchesUsingParentResult`: a path INHERITS its parent's
 * verdict, then every pattern matching the path itself is applied in order and
 * the last one wins. Inheritance is what makes `.github/*` exclude
 * `.github/ISSUE_TEMPLATE/bug.md`, which no pattern matches directly; the
 * override is what makes `!.github/workflows/ci.yml` work — and what let the
 * fixture negation reopen `**\/.env`.
 */
export function isInContext(patterns, candidate) {
  const compiled = patterns.map((entry) => ({
    ...entry,
    expression: compilePattern(entry.pattern),
  }));

  const segments = candidate.replace(/\\/g, '/').replace(/^\/+/, '').split('/');
  let included = true;

  // Pattern order is authoritative. Docker evaluates each pattern against the
  // candidate (or any parent directory) before advancing to the next pattern;
  // therefore a later negation matching a parent overrides an earlier deny
  // matching the leaf. Walking ancestors first reverses that precedence and
  // can report a secret as excluded when Docker would include it.
  for (const entry of compiled) {
    const matchesCandidateOrParent = segments.some((_segment, depth) =>
      entry.expression.test(segments.slice(0, depth + 1).join('/')),
    );

    if (matchesCandidateOrParent) included = entry.negated;
  }

  return included;
}

/** The last pattern that decided a path's verdict — for a useful diagnostic. */
export function decidingPattern(patterns, candidate) {
  const compiled = patterns.map((entry) => ({
    ...entry,
    expression: compilePattern(entry.pattern),
  }));

  const segments = candidate.replace(/\\/g, '/').replace(/^\/+/, '').split('/');
  let deciding = null;

  for (const entry of compiled) {
    const matchesCandidateOrParent = segments.some((_segment, depth) =>
      entry.expression.test(segments.slice(0, depth + 1).join('/')),
    );

    if (matchesCandidateOrParent) deciding = entry.raw;
  }

  return deciding;
}

/* ===========================================================================
 * What counts as a secret.
 *
 * Derived from SECURITY_BASELINE.md §18.1 — "None in source control, client
 * code or logs … `.env` git-ignored with a valueless `.env.example`" — and from
 * the exclusions `.dockerignore` already carries.
 * ========================================================================= */

/**
 * File names that must never reach a build context, at any depth.
 *
 * `.env.example` is the single, explicit exception: §18.1 requires it, it is
 * asserted VALUELESS by `tests/config/env-example.test.ts`, and the test stage
 * reads it.
 */
export const secretBasenames = Object.freeze([
  '.env',
  '.env.local',
  '.env.development',
  '.env.development.local',
  '.env.production',
  '.env.production.local',
  '.env.test',
  '.env.ci',
  'server.key',
  'private.key',
  'tls.pem',
  'client.pfx',
  'store.p12',
  'server.crt',
  'ca.cer',
  'chain.der',
]);

/** Directories whose whole contents are credential material. */
export const secretDirectories = Object.freeze(['secrets', '.secrets']);

/** The one environment file that is deliberately admitted. */
export const permittedEnvironmentFile = '.env.example';

/**
 * Is this path secret material?
 *
 * Used both to build the corpus and to reject a negation that NAMES a secret
 * outright — `!docker/.env` would otherwise be a single legal-looking line.
 */
export function isSecretPath(candidate) {
  const normalised = candidate.replace(/\\/g, '/');
  const segments = normalised.split('/');
  const basename = segments.at(-1) ?? '';

  if (basename === permittedEnvironmentFile) return false;
  if (segments.some((segment) => secretDirectories.includes(segment))) return true;
  if (/^\.env(\..+)?$/.test(basename)) return true;

  return /\.(?:pem|key|pfx|p12|crt|cer|der)$/i.test(basename);
}

/* ===========================================================================
 * The adversarial corpus.
 * ========================================================================= */

/** Fixed candidates: root, nested, and deeply nested secret material. */
function fixedCorpus() {
  const directories = [
    '',
    'docker',
    'apps/web',
    'packages/database',
    'tests/fixtures',
    'a/b/c/d/e',
    'apps/web/src/app/[locale]',
  ];

  const candidates = [];

  for (const directory of directories) {
    for (const basename of secretBasenames) {
      candidates.push(directory === '' ? basename : `${directory}/${basename}`);
    }
  }

  for (const directory of secretDirectories) {
    candidates.push(`${directory}/service-account.json`);
    candidates.push(`packages/database/${directory}/credentials.json`);
  }

  return candidates;
}

/**
 * Candidates derived FROM THE FILE'S OWN NEGATIONS.
 *
 * This is the part that survives a policy nobody has written yet. Every `!`
 * line is a hole punched in the exclusions, so each one is expanded into
 * concrete paths and probed for secrets sitting in the hole it opens. A
 * developer who adds `!tools/**` tomorrow gets `tools/x/.env` tested tomorrow,
 * without editing this file.
 */
function corpusFromNegations(patterns) {
  const candidates = [];

  for (const { negated, pattern } of patterns) {
    if (!negated || pattern === '') continue;

    // Expand wildcards into concrete segments. `**` is expanded at several
    // depths because a re-include can open a subtree, not merely a directory.
    for (const depth of ['', 'w', 'w/x']) {
      const concrete = pattern
        .replaceAll('**', depth === '' ? '' : depth)
        .replaceAll('*', 'w')
        .split('/')
        .filter((segment) => segment !== '')
        .join('/');

      if (concrete === '') continue;

      const parent = concrete.includes('/')
        ? concrete.slice(0, concrete.lastIndexOf('/'))
        : '';

      for (const basename of secretBasenames) {
        // A secret sitting BESIDE what the negation admits.
        candidates.push(parent === '' ? basename : `${parent}/${basename}`);
        // A secret sitting BENEATH it, if it names a directory.
        candidates.push(`${concrete}/${basename}`);
      }
    }
  }

  return candidates;
}

/** The whole corpus: fixed adversarial paths plus everything the file invites. */
export function secretCorpus(patterns) {
  return [...new Set([...fixedCorpus(), ...corpusFromNegations(patterns)])].filter(
    (candidate) => isSecretPath(candidate),
  );
}

/* ===========================================================================
 * Required build inputs.
 *
 * A fail-closed secret policy that also excluded the source would be a broken
 * build wearing a security badge. These are the paths the Dockerfile's `COPY`
 * lines and the suites running inside the test stage genuinely need.
 * ========================================================================= */
export const requiredContextPaths = Object.freeze([
  'package.json',
  'package-lock.json',
  'apps/web/package.json',
  'packages/database/package.json',
  'packages/server-core/src/logging/redaction.ts',
  'packages/server-core/src/logging/logger.ts',
  'scripts/verify-versions.mjs',
  'scripts/check-architecture.mjs',
  'scripts/shared/docker-context.mjs',
  'scripts/check-docker-context.mjs',
  'tests/config/logging.test.ts',
  'tests/config/docker-packaging.test.ts',
  'tests/config/docker-context.test.ts',
  'eslint.config.js',
  'prettier.config.js',
  'vitest.config.ts',
  '.prettierignore',
  '.env.example',
  '.dockerignore',
  'docker/web.Dockerfile',
  'docker/compose.yaml',
  '.github/workflows/ci.yml',
  // The Round 6 and Round 7 fixture trees, whose whole point is that their
  // directory names look generated. The re-includes that admit them are the
  // very negations this module probes for secrets — both properties have to
  // hold at once.
  'tests/fixtures/generated-output-import/apps/app/dist/index.js',
]);

/* ===========================================================================
 * The policy check.
 * ========================================================================= */

/** Reads and parses `.dockerignore`. Throws — fails closed — if it cannot. */
export function readDockerignore(repoRoot) {
  const file = path.join(repoRoot, '.dockerignore');
  let source;

  try {
    source = readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(
      `.dockerignore could not be read (${error.code ?? 'unknown error'}). ` +
        'Without it the ENTIRE working tree — including every .env — is sent ' +
        'to the daemon, so a missing policy is a failure, never a pass.',
      { cause: error },
    );
  }

  const lines = source.split('\n');
  const patterns = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const parsed = parsePattern(trimmed);

    if (parsed.pattern === '') {
      throw new Error(
        `.dockerignore contains the malformed pattern '${trimmed}'. A pattern ` +
          'that resolves to nothing cannot be reasoned about, so it fails closed.',
      );
    }

    patterns.push(parsed);
  }

  if (patterns.length === 0) {
    throw new Error('.dockerignore declares no patterns; the policy is empty.');
  }

  return patterns;
}

/**
 * Evaluates the policy. Returns every violation found; an empty array is a pass.
 *
 * Three independent classes, because they fail in different ways:
 *   - a secret that reaches the context (the effective-behaviour check)
 *   - a negation that NAMES secret material (a structural check, so the intent
 *     is rejected even where the corpus happens not to reach it)
 *   - a required build input that the policy excludes
 */
export function findPolicyViolations(patterns) {
  const violations = [];

  for (const candidate of secretCorpus(patterns)) {
    if (isInContext(patterns, candidate)) {
      violations.push({
        kind: 'secret-in-context',
        candidate,
        deciding: decidingPattern(patterns, candidate),
      });
    }
  }

  for (const entry of patterns) {
    if (!entry.negated) continue;

    const concrete = entry.pattern.replaceAll('**/', '').replaceAll('*', 'w');
    if (isSecretPath(concrete)) {
      violations.push({
        kind: 'negation-names-secret',
        candidate: entry.raw,
        deciding: entry.raw,
      });
    }
  }

  for (const required of requiredContextPaths) {
    if (!isInContext(patterns, required)) {
      violations.push({
        kind: 'required-input-excluded',
        candidate: required,
        deciding: decidingPattern(patterns, required),
      });
    }
  }

  return violations;
}
