#!/usr/bin/env node
/**
 * Build-context secret gate (SECURITY_BASELINE.md §18.1).
 *
 * Proves that no secret artifact can reach the Docker build context under the
 * committed `.dockerignore`, that no negation re-opens one, and that the
 * legitimate build inputs still arrive.
 *
 * Runs in `npm run verify` and in CI, on every platform, with NO Docker daemon:
 * the committed policy is what decides the context, so the policy is what is
 * checked. A daemon-only proof would run in one job and nowhere else, which is
 * precisely how the fixture negation reopened `**\/.env` unnoticed.
 *
 * Fails closed. A missing, empty or malformed policy is a failure — never a
 * pass — because every one of those states sends the whole working tree.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { findPolicyViolations, readDockerignore } from './shared/docker-context.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let patterns;

try {
  patterns = readDockerignore(repoRoot);
} catch (error) {
  console.error('\nDocker build-context policy FAILED:\n');
  console.error(`  - ${error.message}`);
  process.exit(1);
}

const violations = findPolicyViolations(patterns);

const explanation = {
  'secret-in-context': 'SECRET REACHES THE BUILD CONTEXT',
  'negation-names-secret': 'A NEGATION RE-INCLUDES SECRET MATERIAL',
  'required-input-excluded': 'A REQUIRED BUILD INPUT IS EXCLUDED',
};

if (violations.length > 0) {
  console.error('\nDocker build-context policy FAILED:\n');

  for (const { kind, candidate, deciding } of violations) {
    console.error(`  - ${explanation[kind]}`);
    console.error(`      path:    ${candidate}`);
    console.error(`      decided by: ${deciding ?? '(inherited from an ancestor)'}`);
  }

  console.error(
    '\nDocker applies the LAST matching pattern, so a negation added anywhere ' +
      'below an exclusion overrides it. Keep the final secret-deny block at the ' +
      'end of `.dockerignore`, and scope any re-include so it cannot name or ' +
      'contain credential material.',
  );

  process.exit(1);
}

console.log(
  `Docker build-context policy verified: ${patterns.length} patterns, ` +
    'no secret artifact reachable, every required build input present.',
);
