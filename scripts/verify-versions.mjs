#!/usr/bin/env node
/**
 * Locked-stack compatibility verification (TECH_STACK.md §16.3).
 *
 * Reads the versions actually installed and compares them against the locked
 * stack. Exact pins must match exactly; `x` ranges must resolve to a stable
 * patch inside the range. A prerelease is a failure regardless of range —
 * canary, beta, RC, preview and experimental packages are excluded
 * (TECH_STACK.md §15, SECURITY_BASELINE.md §18.3).
 *
 * On any discrepancy this exits non-zero. It does not substitute a version:
 * the policy is stop, investigate, report, and require an explicit architecture
 * decision (TECH_STACK.md §1.2).
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The locked stack, transcribed from TECH_STACK.md §2. */
const locked = [
  { name: 'next', kind: 'exact', expected: '16.3.3' },
  { name: 'react', kind: 'exact', expected: '19.2.8' },
  { name: 'react-dom', kind: 'exact', expected: '19.2.8' },
  { name: 'tailwindcss', kind: 'exact', expected: '4.3.3' },
  { name: 'pino', kind: 'exact', expected: '10.3.1' },
  { name: 'typescript', kind: 'range', expected: '5.9' },
  { name: 'zod', kind: 'range', expected: '4.5' },
  { name: 'vitest', kind: 'range', expected: '4.1' },
  { name: 'eslint', kind: 'range', expected: '10' },
  { name: 'prettier', kind: 'range', expected: '3' },
];

/** The locked Node runtime. */
const lockedNode = '24.20.0';

function installedVersion(name) {
  try {
    const manifestPath = require.resolve(`${name}/package.json`, {
      paths: [repoRoot],
    });
    return require(manifestPath).version;
  } catch {
    return null;
  }
}

function isPrerelease(version) {
  return version.includes('-');
}

function withinRange(version, range) {
  const versionParts = version.split('.');
  const rangeParts = range.split('.');

  return rangeParts.every((part, index) => versionParts[index] === part);
}

const failures = [];
const rows = [];

for (const { name, kind, expected } of locked) {
  const actual = installedVersion(name);

  if (actual === null) {
    failures.push(`${name}: not installed (locked ${expected})`);
    rows.push({ package: name, locked: expected, resolved: '—', status: 'MISSING' });
    continue;
  }

  let status = 'ok';

  if (isPrerelease(actual)) {
    failures.push(`${name}: ${actual} is a prerelease; prereleases are excluded`);
    status = 'PRERELEASE';
  } else if (kind === 'exact' && actual !== expected) {
    failures.push(`${name}: resolved ${actual}, locked exactly ${expected}`);
    status = 'MISMATCH';
  } else if (kind === 'range' && !withinRange(actual, expected)) {
    failures.push(`${name}: resolved ${actual}, outside locked range ${expected}.x`);
    status = 'OUT OF RANGE';
  }

  rows.push({
    package: name,
    locked: kind === 'exact' ? expected : `${expected}.x`,
    resolved: actual,
    status,
  });
}

// The Node runtime. A mismatch is a HARD FAILURE everywhere — locally exactly
// as in CI. Validating the locked stack on a different runtime proves nothing
// about the runtime that actually ships, so this must never report success.
const nodeActual = process.versions.node;
const nodeMatches = nodeActual === lockedNode;

rows.push({
  package: 'node (runtime)',
  locked: lockedNode,
  resolved: nodeActual,
  status: nodeMatches ? 'ok' : 'MISMATCH',
});

console.table(rows);

if (!nodeMatches) {
  failures.push(
    `node: running ${nodeActual}, locked ${lockedNode}. The locked runtime is ` +
      `an architecture decision (TECH_STACK.md §3) — align the workstation ` +
      `rather than validating against a different runtime.`,
  );
}

if (failures.length > 0) {
  console.error('\nLocked stack verification FAILED:\n');
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error(
    '\nDo not substitute a version. Stop, investigate, report, and require an ' +
      'explicit architecture decision (TECH_STACK.md §1.2).',
  );
  process.exit(1);
}

console.log('\nLocked stack verified against TECH_STACK.md §2.');
