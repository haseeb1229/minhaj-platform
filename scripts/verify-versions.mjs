#!/usr/bin/env node
/**
 * Locked-stack verification (TECH_STACK.md §16.3).
 *
 * Proves the locked stack from COMMITTED REPOSITORY STATE — the root manifest,
 * every workspace manifest and `package-lock.json` — because those three files
 * are what a clean `npm ci` installs. The previous revision asked
 * `require.resolve()` what was present instead, which made `node_modules` the
 * authority: a workspace could declare an out-of-policy version and pass on
 * hoisting alone, a manifest and the lockfile could disagree entirely and pass
 * because neither was read, and a deferred package could arrive at any version
 * in any phase with nothing to notice.
 *
 * `node_modules` is still consulted, but only as a CONSISTENCY check — it can
 * report that the working tree has drifted from the lockfile. It can no longer
 * be the reason anything passes, so the whole check holds on a fresh runner.
 *
 * On any discrepancy this exits non-zero. It does not substitute a version: the
 * policy is stop, investigate, report, and require an explicit architecture
 * decision (TECH_STACK.md §1.2).
 */

import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  deferredStack,
  evaluateVersionPolicy,
  lockedFamilies,
  lockedStack,
  requiredSecurityOverrides,
} from './shared/version-policy.mjs';
import { discoverWorkspaces, workspaceProblems } from './shared/workspaces.mjs';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Reads and parses JSON, or exits. Unreadable policy input is never a pass. */
function readJsonOrFail(file, description) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    console.error('\nLocked stack verification FAILED:\n');
    console.error(`  - ${description} could not be read or parsed: ${error.message}`);
    console.error(
      '\nThe locked stack is proved from committed repository state. Missing or ' +
        'malformed input is a failure, never a pass.',
    );
    process.exit(1);
  }
}

const rootManifest = readJsonOrFail(
  path.join(repoRoot, 'package.json'),
  'the root package.json',
);
const lock = readJsonOrFail(
  path.join(repoRoot, 'package-lock.json'),
  'package-lock.json',
);

// Workspace discovery reads the `workspaces` globs from the root manifest, so a
// package added later enters validation the moment it exists.
const discovered = discoverWorkspaces(repoRoot);
const problems = workspaceProblems(discovered);

if (problems.length > 0) {
  console.error('\nLocked stack verification FAILED:\n');
  for (const problem of problems) console.error(`  - ${problem.message ?? problem}`);
  console.error('\nA workspace manifest that cannot be read fails closed.');
  process.exit(1);
}

const workspaces = discovered.map((workspace) => ({
  name: workspace.name,
  directory: path.relative(repoRoot, workspace.directory).replaceAll('\\', '/'),
  manifest: workspace.manifest,
}));

/**
 * What `node_modules` actually holds, for the consistency check only.
 *
 * Deliberately best-effort: on a runner that has not installed yet, every
 * lookup returns null and the policy is still fully proved from source.
 */
function installedVersion(name) {
  try {
    return require(require.resolve(`${name}/package.json`, { paths: [repoRoot] }))
      .version;
  } catch {
    // Some packages expose their runtime entry but do not export package.json.
    try {
      let directory = path.dirname(require.resolve(name, { paths: [repoRoot] }));

      while (path.dirname(directory) !== directory) {
        const candidate = path.join(directory, 'package.json');

        if (existsSync(candidate)) {
          const manifest = JSON.parse(readFileSync(candidate, 'utf8'));
          if (manifest.name === name) return manifest.version ?? null;
        }

        directory = path.dirname(directory);
      }
    } catch {
      return null;
    }

    return null;
  }
}

const installed = {};

for (const { name } of [...lockedStack, ...deferredStack, ...requiredSecurityOverrides]) {
  installed[name] = installedVersion(name);
}

for (const { prefix } of lockedFamilies) {
  for (const manifest of [rootManifest, ...workspaces.map((w) => w.manifest)]) {
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      for (const name of Object.keys(manifest?.[field] ?? {})) {
        if (name.startsWith(prefix)) installed[name] = installedVersion(name);
      }
    }
  }
}

const { failures, rows } = evaluateVersionPolicy({
  rootManifest,
  workspaces,
  lock,
  nodeVersion: process.versions.node,
  installed,
});

console.table(rows);

if (failures.length > 0) {
  console.error('\nLocked stack verification FAILED:\n');
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error(
    '\nDo not substitute a version. Stop, investigate, report, and require an ' +
      'explicit architecture decision (TECH_STACK.md §1.2).',
  );
  process.exit(1);
}

console.log(
  '\nLocked stack verified against TECH_STACK.md §2, from the root manifest, ' +
    `${workspaces.length} workspace manifests and package-lock.json.`,
);
