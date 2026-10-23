import { readFileSync } from 'node:fs';

/**
 * Asserts that the Phase-29 Migration & Provenance proofs actually RAN.
 *
 * The real-SQL Migration suites skip when no database is configured — right
 * on a developer machine without SQL Server, wrong in the `Database
 * foundation` job, which exists to have one. Together with the unit suites
 * they are the evidence that the framework holds against controlled fixtures
 * only: the SSRF and DNS-rebinding policy refuses every unsafe address and
 * re-validates after each redirect; ordinary 4xx are never retried and
 * Retry-After is respected; raw evidence is immutable and bound to its
 * checksum; imported markup is sanitised before staging; an interrupted run
 * resumes and a rerun duplicates nothing; reconciliation balances; publication
 * goes through the target's own public interface and is reversible; a resumed
 * promotion carries each entry once and stops when its approval is withdrawn;
 * identical bytes never merge two acquisitions' rights; and the end-to-end
 * staging fixture proof runs as the least-privilege runtime principal. A
 * skipped run would report all of that as a green tick while proving none of
 * it, so this fails on ANY non-passing result, a skip included, on a required
 * file that is missing or ran no tests, and on an empty run.
 */

const reportPath = process.argv[2];

if (reportPath === undefined) {
  console.error('Usage: node scripts/assert-migration-proofs.mjs <vitest-json-report>');
  process.exit(1);
}

let report;
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'));
} catch (error) {
  console.error(`Could not read the Migration proof report at ${reportPath}.`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const files = Array.isArray(report.testResults) ? report.testResults : [];
const tests = files.flatMap((file) =>
  Array.isArray(file.assertionResults) ? file.assertionResults : [],
);

/** Named explicitly, so deleting or renaming a proof fails here. */
const REQUIRED = [
  'migration/retry',
  'migration/reconciliation',
  'migration/normalize',
  'migration/links',
  'migration/video',
  'migration/service',
  'migration/composition',
  'migration/tooling/safe-fetch',
  'migration/tooling/fixture-video-adapter',
  'migration/tooling/export-adapter',
  'migration/tooling/promotion-bundle',
  'migration/persistence.integration',
  'migration/staging-fixture-proof.integration',
];

const named = (file) => String(file.name ?? '').replaceAll('\\', '/');
const filesFor = (required) => files.filter((file) => named(file).includes(required));

const missing = REQUIRED.filter((required) => filesFor(required).length === 0);
if (missing.length > 0) {
  console.error('Migration proof files are missing from the run:');
  for (const name of missing) console.error(`  - ${name}`);
  process.exit(1);
}

const empty = REQUIRED.filter((required) =>
  filesFor(required).every(
    (file) => !Array.isArray(file.assertionResults) || file.assertionResults.length === 0,
  ),
);
if (empty.length > 0) {
  console.error('Migration proof files ran no tests (a load failure or an empty suite):');
  for (const name of empty) console.error(`  - ${name}`);
  process.exit(1);
}

if (tests.length === 0) {
  console.error('The Migration proof run contained no tests at all.');
  process.exit(1);
}

const failedFiles = files.filter(
  (file) => file.status !== undefined && file.status !== 'passed',
);
const notPassed = tests.filter((test) => test.status !== 'passed');

if (notPassed.length > 0 || failedFiles.length > 0) {
  console.error('Migration proofs did not all run and pass:');
  for (const file of failedFiles)
    console.error(
      `  - file ${file.status}: ${named(file)}${file.message ? ` — ${file.message}` : ''}`,
    );
  for (const test of notPassed) {
    console.error(`  - ${test.status}: ${test.fullName ?? test.title}`);
  }
  process.exit(1);
}

console.log(
  `Migration proofs: ${tests.length} passed across ${files.length} file(s), none skipped.`,
);
