import { readFileSync } from 'node:fs';

/**
 * Asserts that the Phase-27 Donations proofs actually RAN.
 *
 * The real-SQL Donations suites skip when no database is configured — right
 * on a developer machine without SQL Server, wrong in the `Database
 * foundation` job, which exists to have one. They are the evidence that money
 * is exact end to end, that only provider truth read server-to-server moves a
 * donation, that a signed webhook is applied exactly once however it arrives
 * and an unsigned, stale or tampered one writes nothing, that an ambiguous
 * create or an unanswered refund resolves under its original idempotency key
 * and never twice, that refunds stay within the captured amount under
 * authority the database re-checks, that one donation per operation and one
 * dedup record per event hold under real concurrency, and that closing an
 * account releases the donor link while keeping the financial record. A
 * skipped run would report all of that as a green tick while proving none of
 * it, so this fails on ANY non-passing result, a skip included, on a required
 * file that is missing or ran no tests, and on an empty run.
 */

const reportPath = process.argv[2];

if (reportPath === undefined) {
  console.error('Usage: node scripts/assert-donations-proofs.mjs <vitest-json-report>');
  process.exit(1);
}

let report;
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'));
} catch (error) {
  console.error(`Could not read the Donations proof report at ${reportPath}.`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const files = Array.isArray(report.testResults) ? report.testResults : [];
const tests = files.flatMap((file) =>
  Array.isArray(file.assertionResults) ? file.assertionResults : [],
);

/** Named explicitly, so deleting or renaming a proof fails here. */
const REQUIRED = [
  'donations/service',
  'donations/mail',
  'donations/stripe-protocol',
  'donations/webhook-signature',
  'donations/donations.integration',
  'donations/concurrency.integration',
  'donations/closure.integration',
  'donations/webhook.integration',
];

const named = (file) => String(file.name ?? '').replaceAll('\\', '/');
const filesFor = (required) => files.filter((file) => named(file).includes(required));

const missing = REQUIRED.filter((required) => filesFor(required).length === 0);
if (missing.length > 0) {
  console.error('Donations proof files are missing from the run:');
  for (const name of missing) console.error(`  - ${name}`);
  process.exit(1);
}

const empty = REQUIRED.filter((required) =>
  filesFor(required).every(
    (file) => !Array.isArray(file.assertionResults) || file.assertionResults.length === 0,
  ),
);
if (empty.length > 0) {
  console.error('Donations proof files ran no tests (a load failure or an empty suite):');
  for (const name of empty) console.error(`  - ${name}`);
  process.exit(1);
}

if (tests.length === 0) {
  console.error('The Donations proof run contained no tests at all.');
  process.exit(1);
}

const failedFiles = files.filter(
  (file) => file.status !== undefined && file.status !== 'passed',
);
const notPassed = tests.filter((test) => test.status !== 'passed');

if (notPassed.length > 0 || failedFiles.length > 0) {
  console.error('Donations proofs did not all run and pass:');
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
  `Donations proofs: ${tests.length} passed across ${files.length} file(s), none skipped.`,
);
