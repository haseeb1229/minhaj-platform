import { readFileSync } from 'node:fs';

/**
 * Asserts that the Phase-24 Messaging proofs actually RAN.
 *
 * The real-SQL Messaging suites skip when no database is configured — right on
 * a developer machine without SQL Server, wrong in the `Database foundation`
 * job, which exists to have one. They are the evidence that the current
 * relationship, not historical membership, decides every read and send; that
 * a revoked teacher, a withdrawn learner and another person's support thread
 * are refused; that ordering, idempotency and read state hold under real
 * concurrency; and that closure keeps the remaining participant's history.
 * A skipped run would report all of that as a green tick while proving none
 * of it, so this fails on ANY non-passing result, a skip included, and on an
 * empty run.
 */

const reportPath = process.argv[2];

if (reportPath === undefined) {
  console.error('Usage: node scripts/assert-messaging-proofs.mjs <vitest-json-report>');
  process.exit(1);
}

let report;
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'));
} catch (error) {
  console.error(`Could not read the Messaging proof report at ${reportPath}.`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const files = Array.isArray(report.testResults) ? report.testResults : [];
const tests = files.flatMap((file) =>
  Array.isArray(file.assertionResults) ? file.assertionResults : [],
);

/** Named explicitly, so deleting or renaming a proof fails here. */
const REQUIRED = [
  'service',
  'messaging.integration',
  'safety.integration',
  'closure.integration',
  'paging.integration',
];

const seen = files.map((file) => String(file.name ?? ''));
const missing = REQUIRED.filter(
  (required) => !seen.some((name) => name.includes(required)),
);

if (missing.length > 0) {
  console.error('Messaging proof files are missing from the run:');
  for (const name of missing) console.error(`  - ${name}`);
  process.exit(1);
}

if (tests.length === 0) {
  console.error('The Messaging proof run contained no tests at all.');
  process.exit(1);
}

const notPassed = tests.filter((test) => test.status !== 'passed');

if (notPassed.length > 0) {
  console.error('Messaging proofs did not all run and pass:');
  for (const test of notPassed) {
    console.error(`  - ${test.status}: ${test.fullName ?? test.title}`);
    // The first lines of the failure — the assertion and where it was raised —
    // so an intermittent failure is diagnosable from the log alone. Proof data
    // is synthetic sentinels only; nothing secret is in a test's message.
    const messages = Array.isArray(test.failureMessages) ? test.failureMessages : [];
    for (const message of messages.slice(0, 2))
      for (const line of String(message).split('\n').slice(0, 8))
        console.error(`      ${line.slice(0, 300)}`);
  }
  process.exit(1);
}

console.log(
  `Messaging proofs: ${tests.length} passed across ${files.length} file(s), none skipped.`,
);
