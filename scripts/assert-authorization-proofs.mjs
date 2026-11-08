import { readFileSync } from 'node:fs';

/**
 * Asserts that the permission-catalogue authorisation proofs actually RAN.
 *
 * The identity and taxonomy authorisation suites read the live permission
 * catalogue and step-up vocabulary from a real SQL Server and skip when no
 * database is configured. Before they ran in the `Database foundation` job,
 * they drifted silently behind Phase 30-RD's `migration.clearPersonalData`
 * key and `migration-personal-data` purpose. A skipped run would report a
 * green tick while proving nothing, so this fails on ANY non-passing result,
 * a skip included, and on an empty run.
 */

const reportPath = process.argv[2];

if (reportPath === undefined) {
  console.error(
    'Usage: node scripts/assert-authorization-proofs.mjs <vitest-json-report>',
  );
  process.exit(1);
}

let report;
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'));
} catch (error) {
  console.error(`Could not read the authorisation proof report at ${reportPath}.`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const files = Array.isArray(report.testResults) ? report.testResults : [];
const tests = files.flatMap((file) =>
  Array.isArray(file.assertionResults) ? file.assertionResults : [],
);

/** Named explicitly, so deleting or renaming a proof fails here. */
const REQUIRED = [
  'identity/authorization.integration',
  'taxonomy/authorization.integration',
];

const seen = files.map((file) => String(file.name ?? '').replaceAll('\\', '/'));
const missing = REQUIRED.filter(
  (required) => !seen.some((name) => name.includes(required)),
);

if (missing.length > 0) {
  console.error('Authorisation proof files are missing from the run:');
  for (const name of missing) console.error(`  - ${name}`);
  process.exit(1);
}

if (tests.length === 0) {
  console.error('The authorisation proof run contained no tests at all.');
  process.exit(1);
}

const notPassed = tests.filter((test) => test.status !== 'passed');

if (notPassed.length > 0) {
  console.error('Authorisation proofs did not all run and pass:');
  for (const test of notPassed) {
    console.error(`  - ${test.status}: ${test.fullName ?? test.title}`);
  }
  process.exit(1);
}

console.log(
  `Authorisation proofs: ${tests.length} passed across ${files.length} file(s), none skipped.`,
);
