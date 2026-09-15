import 'server-only';

import {
  assertBackupPath,
  assertBackupSourceDatabase,
  assertRestoreDatabaseName,
  BACKUP_DIRECTORY,
  BACKUP_SOURCE_DATABASE,
  isRestoreDatabaseName,
  newBackupTarget,
  newRestoreDatabaseName,
  RESTORE_PREFIX,
} from '../src/lifecycle/backup.ts';
import {
  DISPOSABLE_PREFIX,
  newDisposableDatabaseName,
} from '../src/lifecycle/disposable-database.ts';
import { resolveLocalDatabaseEnvironment } from '../src/lifecycle/local-environment.ts';

/**
 * `npm run db:restore:test` — proves the restore and cleanup guards FAIL
 * CLOSED, without touching a database.
 *
 * The end-to-end rehearsal (`npm run db:recovery:test`) proves the happy path:
 * that a real backup restores and the restored state is intact. This gate
 * proves the opposite and equally important half — that the destructive paths
 * refuse everything they should.
 *
 * It runs no SQL deliberately. These guards are the last thing standing
 * between a typo and a dropped database, so they are tested as pure
 * predicates: a test that had to create a database in order to prove a name is
 * rejected would be exercising the wrong code, and would need the very
 * authority the check exists to withhold.
 *
 * Every case below is a name that must NEVER be a restore target, a backup
 * source, or a deletion path.
 */

let failures = 0;

function pass(label: string, detail: string): void {
  process.stdout.write(`  PASS  ${label.padEnd(46)} ${detail}\n`);
}

function fail(label: string, detail: string): void {
  failures += 1;
  process.stdout.write(`  FAIL  ${label.padEnd(46)} ${detail}\n`);
}

/** Asserts `guard` throws for `value` — the guard failing closed. */
function expectRejected(
  label: string,
  value: string,
  guard: (value: string) => void,
): void {
  try {
    guard(value);
  } catch {
    pass(label, 'rejected');
    return;
  }
  fail(label, 'ACCEPTED but must be rejected');
}

function expectAccepted(
  label: string,
  value: string,
  guard: (value: string) => void,
): void {
  try {
    guard(value);
    pass(label, 'accepted');
  } catch (error) {
    fail(label, `rejected but must be accepted: ${(error as Error).message}`);
  }
}

process.stdout.write('Phase 1 restore-guard proof (no database is touched)\n');

// ---- restore targets that must always be refused ---------------------------
//
// System databases, the live source database, empty and malformed input, and
// names shaped like SQL injection. The guard identifies POSITIVELY, so this
// list is illustrative of the class rather than exhaustive of it.
const FORBIDDEN_RESTORE_TARGETS: readonly [string, string][] = [
  ['master', 'master'],
  ['tempdb', 'tempdb'],
  ['model', 'model'],
  ['msdb', 'msdb'],
  ['MinhajPlatform (the live source)', BACKUP_SOURCE_DATABASE],
  ['empty name', ''],
  ['whitespace only', '   '],
  ['the bare prefix', RESTORE_PREFIX],
  ['prefix with a short suffix', `${RESTORE_PREFIX}abc`],
  ['prefix with non-hex characters', `${RESTORE_PREFIX}${'z'.repeat(32)}`],
  ['prefix with an over-long suffix', `${RESTORE_PREFIX}${'a'.repeat(33)}`],
  [
    'a disposable name with a trailing statement',
    `${RESTORE_PREFIX}${'a'.repeat(32)}; DROP DATABASE [MinhajPlatform];`,
  ],
  ['statement separator', 'master]; DROP DATABASE [MinhajPlatform'],
  ['classic injection shape', "x'; DROP DATABASE MinhajPlatform; --"],
  ['comment terminator', `${RESTORE_PREFIX}${'a'.repeat(32)}--`],
  ['bracket escape', `${RESTORE_PREFIX}${'a'.repeat(32)}]`],
  ['batch separator', `${RESTORE_PREFIX}${'a'.repeat(32)}\nGO\nDROP DATABASE [master]`],
  ['leading whitespace', ` ${RESTORE_PREFIX}${'a'.repeat(32)}`],
  ['trailing whitespace', `${RESTORE_PREFIX}${'a'.repeat(32)} `],
  ['Chunk 2 disposable prefix', `MinhajPhase1Test_${'a'.repeat(32)}`],
  ['case-shifted prefix', `minhajphase1restore_${'a'.repeat(32)}`],
];

for (const [label, value] of FORBIDDEN_RESTORE_TARGETS) {
  expectRejected(`restore target refused: ${label}`, value, assertRestoreDatabaseName);
}

// ---- the one shape that IS a valid restore target --------------------------
const generated = newRestoreDatabaseName();
expectAccepted(
  'restore target accepted: generated name',
  generated,
  assertRestoreDatabaseName,
);

if (!isRestoreDatabaseName(generated)) {
  fail('generated restore name matches the guard', `'${generated}' does not match`);
} else {
  pass('generated restore name matches the guard', generated);
}

if (generated === newRestoreDatabaseName()) {
  fail('restore names are unique per call', 'two calls produced the same name');
} else {
  pass('restore names are unique per call', 'two calls differ');
}

// ---- backup sources that must always be refused ----------------------------
const FORBIDDEN_BACKUP_SOURCES: readonly [string, string][] = [
  ['master', 'master'],
  ['tempdb', 'tempdb'],
  ['model', 'model'],
  ['msdb', 'msdb'],
  ['empty name', ''],
  ['an unknown database', 'SomeOtherDatabase'],
  ['a host SQLEXPRESS database', 'ParaforceDb'],
  ['a disposable restore database', generated],
  ['case-shifted source', 'minhajplatform'],
  [
    'source with a trailing statement',
    `${BACKUP_SOURCE_DATABASE}; DROP DATABASE [master];`,
  ],
  ['source with a bracket escape', `${BACKUP_SOURCE_DATABASE}]`],
];

for (const [label, value] of FORBIDDEN_BACKUP_SOURCES) {
  expectRejected(`backup source refused: ${label}`, value, assertBackupSourceDatabase);
}

expectAccepted(
  'backup source accepted: MinhajPlatform',
  BACKUP_SOURCE_DATABASE,
  assertBackupSourceDatabase,
);

// The POPULATED rehearsal builds its own source rather than writing synthetic
// accounts into the engineering database, so a disposable name is a valid
// source — and only in the generated shape. A restore target never is, which
// the forbidden list above still proves.
expectAccepted(
  'backup source accepted: a disposable rehearsal source',
  newDisposableDatabaseName(),
  assertBackupSourceDatabase,
);

for (const [label, value] of [
  ['disposable prefix with no suffix', DISPOSABLE_PREFIX],
  ['disposable prefix with a short suffix', `${DISPOSABLE_PREFIX}abc`],
  ['disposable prefix with non-hex', `${DISPOSABLE_PREFIX}${'g'.repeat(32)}`],
  ['disposable name with a trailing statement', `${DISPOSABLE_PREFIX}${'a'.repeat(32)};`],
] as const) {
  expectRejected(`backup source refused: ${label}`, value, assertBackupSourceDatabase);
}

// ---- artifact paths that must always be refused -----------------------------
//
// `assertBackupPath` guards DELETION, so a path escaping the backup directory
// or naming a data file is the failure that matters most here.
const FORBIDDEN_PATHS: readonly [string, string][] = [
  ['a live data file', '/var/opt/mssql/data/MinhajPlatform.mdf'],
  ['a live log file', '/var/opt/mssql/data/MinhajPlatform_log.ldf'],
  ['the data directory', '/var/opt/mssql/data'],
  ['the backup directory itself', BACKUP_DIRECTORY],
  ['empty path', ''],
  ['a wildcard', `${BACKUP_DIRECTORY}/*.bak`],
  ['a wildcard for everything', `${BACKUP_DIRECTORY}/*`],
  ['parent traversal', `${BACKUP_DIRECTORY}/../data/MinhajPlatform.mdf`],
  ['traversal inside the file name', `${BACKUP_DIRECTORY}/../../etc/passwd`],
  ['a foreign .bak elsewhere', '/tmp/minhaj-phase1-' + 'a'.repeat(32) + '.bak'],
  [
    'a correct name in the wrong directory',
    `/var/opt/mssql/data/minhaj-phase1-${'a'.repeat(32)}.bak`,
  ],
  [
    'a nested path under the backup directory',
    `${BACKUP_DIRECTORY}/nested/minhaj-phase1-${'a'.repeat(32)}.bak`,
  ],
  ['an unexpected extension', `${BACKUP_DIRECTORY}/minhaj-phase1-${'a'.repeat(32)}.mdf`],
  ['no extension', `${BACKUP_DIRECTORY}/minhaj-phase1-${'a'.repeat(32)}`],
  ['a foreign file name', `${BACKUP_DIRECTORY}/something-else.bak`],
  ['non-hex identifier', `${BACKUP_DIRECTORY}/minhaj-phase1-${'z'.repeat(32)}.bak`],
  [
    'a trailing statement',
    `${BACKUP_DIRECTORY}/minhaj-phase1-${'a'.repeat(32)}.bak'; DROP DATABASE [MinhajPlatform]; --`,
  ],
];

for (const [label, value] of FORBIDDEN_PATHS) {
  expectRejected(`artifact path refused: ${label}`, value, assertBackupPath);
}

const artifact = newBackupTarget();
expectAccepted(
  'artifact path accepted: generated target',
  artifact.path,
  assertBackupPath,
);

if (!artifact.path.startsWith(`${BACKUP_DIRECTORY}/`)) {
  fail('artifact is written inside the backup directory', artifact.path);
} else {
  pass('artifact is written inside the backup directory', artifact.path);
}

// The artifact name must not be derivable from, or able to carry, a credential.
// `db:restore:test` opens no connection, so the local file is optional here;
// it is read only to obtain the value this assertion must NOT find.
const password =
  resolveLocalDatabaseEnvironment({ requireLocalFile: false }).values[
    'DATABASE_APP_PASSWORD'
  ] ?? '';
if (password !== '' && artifact.fileName.includes(password)) {
  fail('artifact name carries no credential', 'the file name contains a password');
} else {
  pass('artifact name carries no credential', 'random identifier only');
}

if (failures > 0) {
  process.stdout.write(`\n${failures} restore-guard check(s) FAILED.\n`);
  process.exit(1);
}

process.stdout.write(
  '\nRestore, backup-source and artifact-path guards all fail closed.\n',
);
