import { describe, expect, it } from 'vitest';

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
} from '../../packages/database/src/lifecycle/backup.ts';
import { isDisposableDatabaseName } from '../../packages/database/src/lifecycle/disposable-database.ts';

/**
 * The Chunk 3 destructive guards, as pure predicates.
 *
 * These run with no database and no configuration, so they execute on every
 * machine and in every CI job — including the ones that never start SQL
 * Server. That matters: `npm run db:restore:test` proves the same guards
 * against the live stack, but a check standing between a typo and a dropped
 * database should not be provable only where a database happens to exist.
 */

const HEX32 = 'a'.repeat(32);

describe('restore database name guard', () => {
  it.each([
    ['master', 'master'],
    ['tempdb', 'tempdb'],
    ['model', 'model'],
    ['msdb', 'msdb'],
    ['the live source database', BACKUP_SOURCE_DATABASE],
    ['an empty name', ''],
    ['whitespace', '   '],
    ['the bare prefix', RESTORE_PREFIX],
    ['a short suffix', `${RESTORE_PREFIX}abc`],
    ['a non-hex suffix', `${RESTORE_PREFIX}${'z'.repeat(32)}`],
    ['an over-long suffix', `${RESTORE_PREFIX}${'a'.repeat(33)}`],
    [
      'a trailing statement',
      `${RESTORE_PREFIX}${HEX32}; DROP DATABASE [MinhajPlatform];`,
    ],
    ['a bracket escape', `${RESTORE_PREFIX}${HEX32}]`],
    ['a comment terminator', `${RESTORE_PREFIX}${HEX32}--`],
    ['a batch separator', `${RESTORE_PREFIX}${HEX32}\nGO\nDROP DATABASE [master]`],
    ['leading whitespace', ` ${RESTORE_PREFIX}${HEX32}`],
    ['trailing whitespace', `${RESTORE_PREFIX}${HEX32} `],
    ['classic injection', "x'; DROP DATABASE MinhajPlatform; --"],
    ['a case-shifted prefix', `minhajphase1restore_${HEX32}`],
  ])('refuses %s', (_label, name) => {
    expect(() => assertRestoreDatabaseName(name)).toThrow();
    expect(isRestoreDatabaseName(name)).toBe(false);
  });

  it('accepts only a freshly generated name', () => {
    const name = newRestoreDatabaseName();
    expect(() => assertRestoreDatabaseName(name)).not.toThrow();
    expect(name).toMatch(/^MinhajPhase1Restore_[0-9a-f]{32}$/);
  });

  it('generates a distinct name per call', () => {
    expect(newRestoreDatabaseName()).not.toBe(newRestoreDatabaseName());
  });

  /**
   * The two disposable namespaces must not overlap. If either guard accepted
   * the other's names, a Chunk 3 cleanup could drop a Chunk 2 database, or the
   * reverse — and each would look correct in isolation.
   */
  it('does not overlap the Chunk 2 disposable namespace', () => {
    const restore = newRestoreDatabaseName();
    expect(isDisposableDatabaseName(restore)).toBe(false);
    expect(isRestoreDatabaseName(`MinhajPhase1Test_${HEX32}`)).toBe(false);
  });
});

describe('backup source guard', () => {
  it.each([
    ['master', 'master'],
    ['tempdb', 'tempdb'],
    ['model', 'model'],
    ['msdb', 'msdb'],
    ['an empty name', ''],
    ['an unknown database', 'SomeOtherDatabase'],
    ['a disposable restore database', `${RESTORE_PREFIX}${HEX32}`],
    ['a case-shifted source', 'minhajplatform'],
    ['a trailing statement', `${BACKUP_SOURCE_DATABASE}; DROP DATABASE [master];`],
  ])('refuses %s', (_label, name) => {
    expect(() => assertBackupSourceDatabase(name)).toThrow();
  });

  it('accepts only MinhajPlatform', () => {
    expect(() => assertBackupSourceDatabase(BACKUP_SOURCE_DATABASE)).not.toThrow();
  });
});

describe('backup artifact path guard', () => {
  it.each([
    ['a live data file', '/var/opt/mssql/data/MinhajPlatform.mdf'],
    ['a live log file', '/var/opt/mssql/data/MinhajPlatform_log.ldf'],
    ['the backup directory itself', BACKUP_DIRECTORY],
    ['an empty path', ''],
    ['a wildcard', `${BACKUP_DIRECTORY}/*.bak`],
    ['parent traversal', `${BACKUP_DIRECTORY}/../data/MinhajPlatform.mdf`],
    [
      'a correct name in the wrong directory',
      `/var/opt/mssql/data/minhaj-phase1-${HEX32}.bak`,
    ],
    ['a nested path', `${BACKUP_DIRECTORY}/nested/minhaj-phase1-${HEX32}.bak`],
    ['a foreign file name', `${BACKUP_DIRECTORY}/something-else.bak`],
    ['an unexpected extension', `${BACKUP_DIRECTORY}/minhaj-phase1-${HEX32}.mdf`],
    ['a non-hex identifier', `${BACKUP_DIRECTORY}/minhaj-phase1-${'z'.repeat(32)}.bak`],
  ])('refuses %s', (_label, path) => {
    expect(() => assertBackupPath(path)).toThrow();
  });

  it('accepts a generated target inside the backup directory', () => {
    const target = newBackupTarget();
    expect(() => assertBackupPath(target.path)).not.toThrow();
    expect(target.path.startsWith(`${BACKUP_DIRECTORY}/`)).toBe(true);
  });

  /**
   * The artifact name reaches logs, directory listings and error messages, so
   * it must be derived from randomness alone (SECURITY_BASELINE.md §18.1).
   */
  it('names artifacts from a random identifier only', () => {
    const first = newBackupTarget();
    const second = newBackupTarget();

    expect(first.fileName).not.toBe(second.fileName);
    expect(first.fileName).toMatch(/^minhaj-phase1-[0-9a-f]{32}\.bak$/);
  });

  /**
   * The backup directory is on the container volume, never under the working
   * tree — a backup binary must have no path into a commit.
   */
  it('writes outside the repository working tree', () => {
    expect(BACKUP_DIRECTORY.startsWith('/var/opt/mssql')).toBe(true);
    expect(BACKUP_DIRECTORY).not.toContain('packages');
  });
});
