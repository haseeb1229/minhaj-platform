import { readFileSync } from 'node:fs';

/**
 * Asserts that the Phase-26 Membership proofs actually RAN.
 *
 * The real-SQL Membership suites skip when no database is configured — right
 * on a developer machine without SQL Server, wrong in the `Database
 * foundation` job, which exists to have one. They are the evidence that the
 * application lifecycle is enforced server-side and by the database, that an
 * approval creates exactly one Membership atomically, that one open
 * application and one active Membership per account and type hold under real
 * concurrency, that an applicant reaches only their own records, that service
 * mail is committed durably and exactly once, and that closing an account
 * withdraws open applications without resigning a Membership. A skipped run
 * would report all of that as a green tick while proving none of it, so this
 * fails on ANY non-passing result, a skip included, and on an empty run.
 */

const reportPath = process.argv[2];

if (reportPath === undefined) {
  console.error('Usage: node scripts/assert-membership-proofs.mjs <vitest-json-report>');
  process.exit(1);
}

let report;
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'));
} catch (error) {
  console.error(`Could not read the Membership proof report at ${reportPath}.`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const files = Array.isArray(report.testResults) ? report.testResults : [];
const tests = files.flatMap((file) =>
  Array.isArray(file.assertionResults) ? file.assertionResults : [],
);

/** Named explicitly, so deleting or renaming a proof fails here. */
const REQUIRED = [
  'membership/service',
  'membership/mail',
  'membership.integration',
  'concurrency.integration',
  'closure.integration',
];

const seen = files.map((file) => String(file.name ?? ''));
const missing = REQUIRED.filter(
  (required) => !seen.some((name) => name.includes(required)),
);

if (missing.length > 0) {
  console.error('Membership proof files are missing from the run:');
  for (const name of missing) console.error(`  - ${name}`);
  process.exit(1);
}

if (tests.length === 0) {
  console.error('The Membership proof run contained no tests at all.');
  process.exit(1);
}

const notPassed = tests.filter((test) => test.status !== 'passed');

if (notPassed.length > 0) {
  console.error('Membership proofs did not all run and pass:');
  for (const test of notPassed) {
    console.error(`  - ${test.status}: ${test.fullName ?? test.title}`);
  }
  process.exit(1);
}

console.log(
  `Membership proofs: ${tests.length} passed across ${files.length} file(s), none skipped.`,
);
