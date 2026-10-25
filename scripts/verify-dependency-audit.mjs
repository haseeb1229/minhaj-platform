#!/usr/bin/env node
/**
 * Dependency audit gate (SECURITY_BASELINE.md §18.3).
 *
 * Runs the real `npm audit --json` over the committed lockfile and fails on
 * every Critical and every High finding, except the reviewed exceptions in
 * `shared/dependency-audit-policy.mjs`, each of which is proved still to need
 * an exception (the advisory is still reported), still to sit on its reviewed
 * dependency chain, and still to be unused by committed source.
 *
 * An audit that cannot run, or a report it cannot read, fails. It never
 * passes by default.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  auditExceptions,
  evaluateAuditReport,
  evaluateExceptionChain,
  findAzureIdentityExposure,
} from './shared/dependency-audit-policy.mjs';
import { discoverWorkspaces, workspaceProblems } from './shared/workspaces.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(reasons) {
  console.error('\nDependency audit FAILED:\n');
  for (const reason of reasons) console.error(`  - ${reason}`);
  console.error(
    '\nEvery Critical and every High finding fails. Do not add an exception to make ' +
      'this pass: patch the dependency, or record a reviewed decision ' +
      '(SECURITY_BASELINE.md §18.3).',
  );
  process.exit(1);
}

/* The real audit. npm exits 1 when it finds anything; any other status, or
 * output that is not a report, is a failure to audit. */
// A fixed command line, so the shell (needed to find npm on every platform)
// is never handed anything to interpolate.
const audit = spawnSync('npm audit --json', {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  shell: true,
});

if (audit.error !== undefined || (audit.status !== 0 && audit.status !== 1)) {
  fail([`npm audit did not run (status ${String(audit.status)})`]);
}

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  fail(['npm audit did not produce a JSON report']);
}

/* Committed manifests and lockfile, read as the version gate reads them. */
let lock;
let rootManifest;
try {
  lock = JSON.parse(readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8'));
  rootManifest = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
} catch (error) {
  fail([`package.json or package-lock.json could not be read: ${error.message}`]);
}

const discovered = discoverWorkspaces(repoRoot);
const problems = workspaceProblems(discovered);
if (problems.length > 0)
  fail(problems.map((problem) => problem.message ?? String(problem)));

const manifests = [
  { directory: '', manifest: rootManifest },
  ...discovered.map((workspace) => ({
    directory: path.relative(repoRoot, workspace.directory).replaceAll('\\', '/'),
    manifest: workspace.manifest,
  })),
];

/* Committed source and configuration. Documentation describes the exception
 * and the policy names the patterns it searches for, so both are out of scope;
 * the lockfile is checked structurally by the chain proof instead. */
const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' });
if (tracked.status !== 0) fail(['git ls-files failed; source exposure cannot be proved']);

const excluded = new Set([
  'package-lock.json',
  'scripts/shared/dependency-audit-policy.mjs',
  'tests/config/dependency-audit-policy.test.ts',
]);
const scanned =
  /\.(?:[cm]?[jt]sx?|json|ya?ml|sh|ps1|env|example|toml|sql|prisma)$|(?:^|\/)Dockerfile$|\.Dockerfile$/;

const files = tracked.stdout
  .split('\0')
  .filter((file) => file !== '' && !file.startsWith('docs/') && !excluded.has(file))
  .filter((file) => scanned.test(file))
  .map((file) => ({ path: file, text: readFileSync(path.join(repoRoot, file), 'utf8') }));

if (files.length === 0) fail(['no committed source was found to scan']);

const result = evaluateAuditReport(report);
const failures = [
  ...result.failures,
  ...evaluateExceptionChain({ lock, manifests }),
  ...findAzureIdentityExposure(files),
];

if (result.findings.length > 0) console.table(result.findings);
console.log(
  `npm audit: ${JSON.stringify(report.metadata?.vulnerabilities ?? {})}; ` +
    `${files.length} committed files scanned for Azure Identity use.`,
);

if (failures.length > 0) fail(failures);

console.log(
  `\nDependency audit passed: no Critical findings and no High findings beyond the ` +
    `reviewed exception${auditExceptions.length === 1 ? '' : 's'} ` +
    `${result.excepted.join(', ')}, each still reported, on its reviewed chain and unused.`,
);
