import { readFileSync } from 'node:fs';

/**
 * Asserts that the Phase-25 realtime proofs actually RAN.
 *
 * The real-process realtime suites skip when no database is configured —
 * right on a developer machine without SQL Server, wrong in the `Database
 * foundation` job, which exists to have one. They are the evidence that the
 * REAL realtime process admits only a real session from the exact origin;
 * re-decides every event and every outbound frame for its person, now (a
 * revoked teacher, an ended scope, a withdrawn learner, a block, a
 * moderator's closure and a suspended account each receive nothing more);
 * commits before it announces; loses nothing to a SIGKILL and a restart;
 * never persists presence or typing; and works through the NGINX seam. A
 * skipped run would report all of that as a green tick while proving none of
 * it, so this fails on ANY non-passing result, a skip included, and on an
 * empty run.
 */

const reportPath = process.argv[2];

if (reportPath === undefined) {
  console.error('Usage: node scripts/assert-realtime-proofs.mjs <vitest-json-report>');
  process.exit(1);
}

let report;
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'));
} catch (error) {
  console.error(`Could not read the realtime proof report at ${reportPath}.`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const files = Array.isArray(report.testResults) ? report.testResults : [];
const tests = files.flatMap((file) =>
  Array.isArray(file.assertionResults) ? file.assertionResults : [],
);

/** Named explicitly, so deleting or renaming a proof fails here. */
const REQUIRED = [
  'process.integration',
  'delivery.integration',
  'durability.integration',
  'proxy.integration',
];

const seen = files.map((file) => String(file.name ?? ''));
const missing = REQUIRED.filter(
  (required) => !seen.some((name) => name.includes(required)),
);

if (missing.length > 0) {
  console.error('Realtime proof files are missing from the run:');
  for (const name of missing) console.error(`  - ${name}`);
  process.exit(1);
}

if (tests.length === 0) {
  console.error('The realtime proof run contained no tests at all.');
  process.exit(1);
}

const notPassed = tests.filter((test) => test.status !== 'passed');

if (notPassed.length > 0) {
  console.error('Realtime proofs did not all run and pass:');
  for (const test of notPassed) {
    console.error(`  - ${test.status}: ${test.fullName ?? test.title}`);
  }
  process.exit(1);
}

console.log(
  `Realtime proofs: ${tests.length} passed across ${files.length} file(s), none skipped.`,
);
