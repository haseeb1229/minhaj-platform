import { readFileSync } from 'node:fs';

/**
 * Asserts that the Phase-17 search proofs actually RAN.
 *
 * The live search suite is written to skip when its precondition genuinely
 * cannot exist — no configured database. That is the right behaviour on a
 * developer machine without one and the wrong outcome in CI, where the whole
 * reason these proofs live in the `Database foundation` job is that a real SQL
 * Server WITH Full-Text Search is present there.
 *
 * Without this check a skipped suite and a passing suite are the same green
 * tick. A database that was not configured, an engine image without FTS, or a
 * rename that quietly stopped matching the test glob would all report success
 * while proving nothing about tokenisation, the stale-index rule or rebuild.
 *
 * It therefore fails on ANY non-passing result, including a skip, and on an
 * empty run — the case where the glob matched no file at all.
 */

const reportPath = process.argv[2];

if (reportPath === undefined) {
  console.error('Usage: node scripts/assert-search-proofs.mjs <vitest-json-report>');
  process.exit(1);
}

let report;
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'));
} catch (error) {
  console.error(`Could not read the search proof report at ${reportPath}.`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const files = Array.isArray(report.testResults) ? report.testResults : [];
const tests = files.flatMap((file) =>
  Array.isArray(file.assertionResults) ? file.assertionResults : [],
);

/**
 * The suites that must be present.
 *
 * Named explicitly so that deleting a proof file fails here rather than
 * silently reducing what CI covers.
 */
const REQUIRED = [
  'text',
  'request',
  'service',
  'highlight',
  'wiring',
  'admission',
  'search.integration',
  // Phase 9: the scholarly and periodical kinds, their stale-index rule,
  // rebuild and reconciliation, and their rebuild after a real restore.
  'scholarly.integration',
  'scholarly-recovery.integration',
  // Phase 10: the video kind, its stale-index rule, rebuild and reconciliation,
  // and its rebuild after a real restore.
  'media.integration',
  'media-recovery.integration',
];

const seen = files.map((file) => String(file.name ?? ''));
const missing = REQUIRED.filter(
  (required) => !seen.some((name) => name.includes(`${required}.test.ts`)),
);

if (missing.length > 0) {
  console.error('Search proof files are missing from the run:');
  for (const name of missing) console.error(`  - ${name}`);
  process.exit(1);
}

if (tests.length === 0) {
  console.error('The search proof run contained no tests at all.');
  process.exit(1);
}

const notPassed = tests.filter((test) => test.status !== 'passed');

if (notPassed.length > 0) {
  console.error('Search proofs did not all run and pass:');
  for (const test of notPassed) {
    console.error(`  - ${test.status}: ${test.fullName ?? test.title}`);
  }
  process.exit(1);
}

console.log(
  `Search proofs: ${tests.length} passed across ${files.length} file(s), none skipped.`,
);
