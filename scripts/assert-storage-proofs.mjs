import { readFileSync } from 'node:fs';

/**
 * Asserts that the Phase-7 storage proofs actually RAN.
 *
 * The storage suite is written to skip when its preconditions genuinely cannot
 * exist — no database, no scanner. That is the right behaviour on a developer
 * machine and the wrong outcome in CI, where the whole reason these tests live
 * in the `Database foundation` job is that both preconditions are present.
 *
 * Without this check a skipped suite and a passing suite are the same green
 * tick. A scanner that failed to start, a database that was not configured, or
 * a rename that quietly stopped matching the test glob would all report
 * success while proving nothing.
 *
 * It therefore fails on ANY non-passing result, including a skip, and on an
 * empty run — the case where the glob matched no file at all.
 */

const reportPath = process.argv[2];

if (reportPath === undefined) {
  console.error('Usage: node scripts/assert-storage-proofs.mjs <vitest-json-report>');
  process.exit(1);
}

let report;
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'));
} catch (error) {
  console.error(`Could not read the storage proof report at ${reportPath}.`);
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
  'keys',
  'sniff',
  'filesystem',
  'service',
  'scanner',
  'storage.integration',
  'recovery.integration',
  'clamav.integration',
  // Phase 11: the single-range parser, audio upload, serving and Range through
  // the real scanner and filesystem, and audio recovery of SQL AND bytes.
  'range',
  'media-audio.integration',
  'audio-recovery.integration',
  // Phase 12: still-image validation and metadata removal, photograph upload,
  // serving and withdrawal through the real scanner and filesystem, and
  // photograph recovery of SQL AND bytes.
  'image',
  'media-photo.integration',
  'photo-recovery.integration',
];

const seen = files.map((file) => String(file.name ?? ''));
const missing = REQUIRED.filter(
  (required) => !seen.some((name) => name.includes(required)),
);

if (missing.length > 0) {
  console.error('Storage proof files are missing from the run:');
  for (const name of missing) console.error(`  - ${name}`);
  process.exit(1);
}

if (tests.length === 0) {
  console.error('The storage proof run contained no tests at all.');
  process.exit(1);
}

const notPassed = tests.filter((test) => test.status !== 'passed');

if (notPassed.length > 0) {
  console.error('Storage proofs did not all run and pass:');
  for (const test of notPassed) {
    console.error(`  - ${test.status}: ${test.fullName ?? test.title}`);
  }
  process.exit(1);
}

console.log(
  `Storage proofs: ${tests.length} passed across ${files.length} file(s), none skipped.`,
);
