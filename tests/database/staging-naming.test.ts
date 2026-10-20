import { describe, expect, it } from 'vitest';

import {
  assertBackupPath,
  assertBackupSourceDatabase,
  assertRestoreDatabaseName,
  BACKUP_DIRECTORY,
  backupArtifactExists,
  backupTargetFor,
  isRestoreDatabaseName,
  newBackupTarget,
  newRestoreDatabaseName,
  PHASE1_BACKUP_NAMING,
  STAGING_BACKUP_NAMING,
  STAGING_SOURCE_DATABASE,
} from '../../packages/database/src/lifecycle/backup.ts';
import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';

/**
 * Phase 28 — the staging backup/restore NAMING POLICY.
 *
 * The backup primitives are shared with the Phase 1 rehearsal; what differs is
 * the exact set of names each destructive path may touch. These prove the
 * staging set is as strict as the Phase 1 one, and that the two namespaces
 * are disjoint, so a staging cleanup can never drop a local rehearsal database
 * or delete a local artifact — or the reverse.
 */

const HEX32 = 'c'.repeat(32);
const staging = STAGING_BACKUP_NAMING;

describe('staging backup artifacts', () => {
  it('generates minhaj-staging-<32 hex>.bak in the backup directory', () => {
    const target = newBackupTarget(staging);
    expect(target.fileName).toMatch(/^minhaj-staging-[0-9a-f]{32}\.bak$/);
    expect(target.path).toBe(`${BACKUP_DIRECTORY}/${target.fileName}`);
    expect(() => assertBackupPath(target.path, staging)).not.toThrow();
    expect(newBackupTarget(staging).fileName).not.toBe(target.fileName);
  });

  it.each([
    ['a Phase 1 artifact', `${BACKUP_DIRECTORY}/minhaj-phase1-${HEX32}.bak`],
    ['a live data file', '/var/opt/mssql/data/MinhajStaging.mdf'],
    ['the directory itself', BACKUP_DIRECTORY],
    ['a wildcard', `${BACKUP_DIRECTORY}/minhaj-staging-*.bak`],
    ['traversal', `${BACKUP_DIRECTORY}/../data/minhaj-staging-${HEX32}.bak`],
    ['a nested path', `${BACKUP_DIRECTORY}/x/minhaj-staging-${HEX32}.bak`],
    ['the wrong directory', `/tmp/minhaj-staging-${HEX32}.bak`],
    ['upper-case hex', `${BACKUP_DIRECTORY}/minhaj-staging-${'C'.repeat(32)}.bak`],
    ['a short identifier', `${BACKUP_DIRECTORY}/minhaj-staging-${'c'.repeat(31)}.bak`],
    ['a trailing statement', `${BACKUP_DIRECTORY}/minhaj-staging-${HEX32}.bak'; --`],
  ])('refuses %s', (_label, path) => {
    expect(() => assertBackupPath(path, staging)).toThrow(
      /not a staging backup artifact/,
    );
  });

  it('keeps the Phase 1 policy refusing staging artifacts', () => {
    const target = newBackupTarget(staging);
    expect(() => assertBackupPath(target.path)).toThrow(/not a Phase 1 backup artifact/);
    expect(() => assertBackupPath(target.path, PHASE1_BACKUP_NAMING)).toThrow();
  });

  it.each([
    '',
    'minhaj-staging-.bak',
    `minhaj-phase1-${HEX32}.bak`,
    `../minhaj-staging-${HEX32}.bak`,
    `backup/minhaj-staging-${HEX32}.bak`,
    `minhaj-staging-${HEX32}.bak `,
  ])('refuses the operator-supplied file name %j', (fileName) => {
    expect(() => backupTargetFor(fileName, staging)).toThrow(/Refusing backup file name/);
  });

  it('resolves a valid operator-supplied file name to the backup directory', () => {
    expect(backupTargetFor(`minhaj-staging-${HEX32}.bak`, staging)).toEqual({
      fileName: `minhaj-staging-${HEX32}.bak`,
      path: `${BACKUP_DIRECTORY}/minhaj-staging-${HEX32}.bak`,
    });
  });

  it('applies the staging policy to the artifact probe too', async () => {
    const session: SqlSession = {
      query: async <Row>() => [{ fileExists: 1, isDirectory: 0 }] as Row[],
      runScript: async () => undefined,
      execute: async () => undefined,
      close: async () => undefined,
    };
    await expect(
      backupArtifactExists(
        session,
        `${BACKUP_DIRECTORY}/minhaj-staging-${HEX32}.bak`,
        staging,
      ),
    ).resolves.toBe(true);
    await expect(
      backupArtifactExists(
        session,
        `${BACKUP_DIRECTORY}/minhaj-phase1-${HEX32}.bak`,
        staging,
      ),
    ).rejects.toThrow(/not a staging backup artifact/);
  });
});

describe('staging restore targets', () => {
  it('generates MinhajStagingRestore_<32 hex>', () => {
    const name = newRestoreDatabaseName(staging);
    expect(name).toMatch(/^MinhajStagingRestore_[0-9a-f]{32}$/);
    expect(() => assertRestoreDatabaseName(name, staging)).not.toThrow();
  });

  it.each([
    ['the live staging database', STAGING_SOURCE_DATABASE],
    ['the local source', 'MinhajPlatform'],
    ['a Phase 1 restore target', `MinhajPhase1Restore_${HEX32}`],
    ['a Phase 1 disposable database', `MinhajPhase1Test_${HEX32}`],
    ['master', 'master'],
    ['a case-shifted prefix', `minhajstagingrestore_${HEX32}`],
    [
      'a trailing statement',
      `MinhajStagingRestore_${HEX32}]; DROP DATABASE [MinhajStaging`,
    ],
  ])('refuses %s', (_label, name) => {
    expect(() => assertRestoreDatabaseName(name, staging)).toThrow(
      /not a disposable staging restore database/,
    );
  });

  it('keeps the two restore namespaces disjoint', () => {
    expect(isRestoreDatabaseName(newRestoreDatabaseName(staging))).toBe(false);
    expect(isRestoreDatabaseName(newRestoreDatabaseName(), staging)).toBe(false);
  });
});

describe('staging backup source', () => {
  it('accepts only MinhajStaging', () => {
    expect(() => staging.assertSource(STAGING_SOURCE_DATABASE)).not.toThrow();
    for (const database of [
      'MinhajPlatform',
      `MinhajPhase1Test_${HEX32}`,
      `MinhajStagingRestore_${HEX32}`,
      'minhajstaging',
      'master',
      '',
    ]) {
      expect(() => staging.assertSource(database)).toThrow(/only valid staging source/);
    }
  });

  it('leaves the Phase 1 source rule exactly as it was', () => {
    expect(() => assertBackupSourceDatabase('MinhajPlatform')).not.toThrow();
    expect(() => assertBackupSourceDatabase(`MinhajPhase1Test_${HEX32}`)).not.toThrow();
    expect(() => assertBackupSourceDatabase(STAGING_SOURCE_DATABASE)).toThrow(
      /Refusing to back up/,
    );
    expect(newBackupTarget().fileName).toMatch(/^minhaj-phase1-[0-9a-f]{32}\.bak$/);
    expect(newRestoreDatabaseName()).toMatch(/^MinhajPhase1Restore_[0-9a-f]{32}$/);
  });
});
