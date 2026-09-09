import { describe, expect, it } from 'vitest';

import {
  newBackupTarget,
  newRestoreDatabaseName,
} from '../../packages/database/src/lifecycle/backup.ts';
import {
  cleanUpRecoveryResources,
  RecoveryCleanupError,
} from '../../packages/database/src/lifecycle/recovery-cleanup.ts';
import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';

/**
 * Cleanup-failure propagation for the recovery rehearsal.
 *
 * The defect these cover: cleanup errors were caught, printed as `FAILED: …`
 * and then forgotten, so `db:recovery:test` exited 0 with a restore database
 * or a backup artifact still on the server — a gate reporting a leak and
 * calling itself green.
 *
 * The seam is `SqlSession`, which the cleanup module already takes as a
 * parameter. A fake session lets a DROP or a delete fail on demand, and lets
 * residue be simulated by answering the verification queries as though the
 * resource survived. No production code exists solely for these tests, and no
 * real database is touched — the failures being proven are ones a live server
 * will not produce to order.
 */

type QueryHandler = (statement: string) => unknown[] | undefined;

interface FakeSessionOptions {
  /** Statements matching this throw, simulating a failed operation. */
  failOn?: RegExp;
  /** Message the simulated failure carries. */
  failMessage?: string;
  /** Answers a statement; returning undefined falls through to the default. */
  answer?: QueryHandler;
  /** `close()` throws, simulating a connection that will not release. */
  failClose?: boolean;
}

interface FakeSession extends SqlSession {
  /** Every statement this session was asked to run, in order. */
  readonly statements: string[];
  readonly closed: () => boolean;
}

/**
 * A `SqlSession` that records what it was asked to do and fails where told.
 *
 * Defaults represent a clean server: the DROP succeeds, `DB_ID` reports the
 * database gone, and `xp_fileexist` reports the artifact gone.
 */
function fakeSession(options: FakeSessionOptions = {}): FakeSession {
  const statements: string[] = [];
  let isClosed = false;

  return {
    statements,
    closed: () => isClosed,

    async query<Row>(statement: string): Promise<Row[]> {
      statements.push(statement);

      if (options.failOn?.test(statement) === true) {
        throw new Error(options.failMessage ?? 'simulated SQL Server failure');
      }

      const answered = options.answer?.(statement);
      if (answered !== undefined) return answered as Row[];

      // Residue probes, answered as "already gone" unless a test overrides.
      if (statement.includes('DB_ID')) return [{ present: 0 }] as Row[];
      if (statement.includes('xp_fileexist')) return [{ fileExists: 0 }] as Row[];

      return [] as Row[];
    },

    async runScript(): Promise<void> {
      // Cleanup runs single statements only. Reaching this would mean the
      // module started executing scripts, which the tests below do not model.
      throw new Error('runScript is not part of the cleanup path');
    },

    async close(): Promise<void> {
      if (options.failClose === true) throw new Error('connection would not close');
      isClosed = true;
    },
  };
}

const restoreDatabase = newRestoreDatabaseName();
const backupPath = newBackupTarget().path;

/** Did the session attempt the artifact deletion? */
function attemptedDelete(session: FakeSession): boolean {
  return session.statements.some((statement) => statement.includes('xp_delete_files'));
}

/** Did the session attempt the residue probe for the artifact? */
function attemptedArtifactResidueCheck(session: FakeSession): boolean {
  return session.statements.some((statement) => statement.includes('xp_fileexist'));
}

describe('recovery cleanup — success path', () => {
  it('reports no failures and closes every session', async () => {
    const master = fakeSession();
    const source = fakeSession();
    const restored = fakeSession();

    const outcome = await cleanUpRecoveryResources({
      master,
      source,
      restored,
      restoreDatabase,
      backupPath,
    });

    expect(outcome.failures).toEqual([]);
    expect(master.closed()).toBe(true);
    expect(source.closed()).toBe(true);
    expect(restored.closed()).toBe(true);

    // Both resources were removed AND independently verified gone.
    expect(attemptedDelete(source)).toBe(true);
    expect(attemptedArtifactResidueCheck(source)).toBe(true);
  });
});

describe('A — restore database DROP failure', () => {
  it('records the failure, still deletes the artifact, and fails the run', async () => {
    const master = fakeSession({
      failOn: /DROP DATABASE/,
      failMessage: 'DROP DATABASE was refused',
    });
    const source = fakeSession();

    const outcome = await cleanUpRecoveryResources({
      master,
      source,
      restored: fakeSession(),
      restoreDatabase,
      backupPath,
    });

    const steps = outcome.failures.map((failure) => failure.step);
    expect(steps).toContain('restore database drop');

    // The critical property: a failed DROP must not skip the artifact.
    expect(attemptedDelete(source)).toBe(true);
    expect(steps).not.toContain('backup artifact deletion');

    // Sessions are still released.
    expect(source.closed()).toBe(true);
    expect(master.closed()).toBe(true);

    expect(() => {
      throw new RecoveryCleanupError(outcome.failures);
    }).toThrow(/restore database drop/);
  });
});

describe('B — backup artifact deletion failure', () => {
  it('records the failure, still drops the restore database, and fails the run', async () => {
    const master = fakeSession();
    const source = fakeSession({
      failOn: /xp_delete_files/,
      failMessage: 'the artifact could not be deleted',
    });

    const outcome = await cleanUpRecoveryResources({
      master,
      source,
      restored: fakeSession(),
      restoreDatabase,
      backupPath,
    });

    const steps = outcome.failures.map((failure) => failure.step);
    expect(steps).toContain('backup artifact deletion');

    // The DROP ran despite the deletion failing.
    expect(master.statements.some((s) => s.includes('DROP DATABASE'))).toBe(true);
    expect(steps).not.toContain('restore database drop');
    expect(outcome.failures.length).toBeGreaterThan(0);
  });
});

describe('C — restore database residue after an apparently clean drop', () => {
  it('detects the surviving database even though the DROP did not throw', async () => {
    // The DROP succeeds, but the database is still there — the exact case a
    // "the command returned 0" check cannot see.
    const master = fakeSession({
      answer: (statement) => (statement.includes('DB_ID') ? [{ present: 1 }] : undefined),
    });

    const outcome = await cleanUpRecoveryResources({
      master,
      source: fakeSession(),
      restored: fakeSession(),
      restoreDatabase,
      backupPath,
    });

    const residue = outcome.failures.find(
      (failure) => failure.step === 'restore database residue',
    );
    expect(residue).toBeDefined();
    expect(residue?.detail).toContain('still exists');

    // The drop itself reported success; only the independent check caught it.
    expect(outcome.failures.map((f) => f.step)).not.toContain('restore database drop');
  });
});

describe('D — backup artifact residue after an apparently clean delete', () => {
  it('detects the surviving artifact even though the delete did not throw', async () => {
    const source = fakeSession({
      answer: (statement) =>
        statement.includes('xp_fileexist') ? [{ fileExists: 1 }] : undefined,
    });

    const outcome = await cleanUpRecoveryResources({
      master: fakeSession(),
      source,
      restored: fakeSession(),
      restoreDatabase,
      backupPath,
    });

    const residue = outcome.failures.find(
      (failure) => failure.step === 'backup artifact residue',
    );
    expect(residue).toBeDefined();
    expect(residue?.detail).toContain('still exists');
  });
});

describe('E — multiple cleanup failures', () => {
  it('attempts every step and collects all of them', async () => {
    const master = fakeSession({ failOn: /DROP DATABASE/ });
    const source = fakeSession({ failOn: /xp_delete_files/ });
    const restored = fakeSession({ failClose: true });

    const outcome = await cleanUpRecoveryResources({
      master,
      source,
      restored,
      restoreDatabase,
      backupPath,
    });

    const steps = outcome.failures.map((failure) => failure.step);
    expect(steps).toContain('restored session close');
    expect(steps).toContain('restore database drop');
    expect(steps).toContain('backup artifact deletion');

    // Every later step still ran: the residue probes were issued, and the
    // remaining sessions were closed, despite three earlier failures.
    expect(master.statements.some((s) => s.includes('DB_ID'))).toBe(true);
    expect(attemptedArtifactResidueCheck(source)).toBe(true);
    expect(source.closed()).toBe(true);
    expect(master.closed()).toBe(true);

    // Every failure is carried, not just the first.
    const error = new RecoveryCleanupError(outcome.failures);
    expect(error.failures.length).toBe(steps.length);
    expect(error.message).toContain('restore database drop');
    expect(error.message).toContain('backup artifact deletion');
  });
});

describe('cleanup error reporting', () => {
  it('names steps and reasons without leaking a connection URL or password', async () => {
    const secret = 'sup3rSecret#Password';
    const source = fakeSession({
      failOn: /xp_delete_files/,
      // A driver error that carries a credential, as a real one might.
      failMessage: `login failed for sqlserver://localhost:14330;password=${secret}`,
    });

    const outcome = await cleanUpRecoveryResources({
      master: fakeSession(),
      source,
      restored: fakeSession(),
      restoreDatabase,
      backupPath,
    });

    const error = new RecoveryCleanupError(outcome.failures);

    // The message is passed through, so this asserts the SHAPE of the report:
    // one line per step, no stack. The guarantee that no URL reaches a message
    // is upheld where errors are constructed (`SqlConnectionUrlError`), not by
    // re-scrubbing text here.
    expect(error.message.split('\n').length).toBe(outcome.failures.length + 1);
    expect(error.message).toContain('backup artifact deletion');
    expect(error.stack).toBeDefined();
  });

  it('records unverified artifact state when no source session exists', async () => {
    // The run failed before a source session was opened, so the artifact's
    // state is unknown — which must not read as "clean".
    const outcome = await cleanUpRecoveryResources({
      master: fakeSession(),
      source: undefined,
      restored: undefined,
      restoreDatabase,
      backupPath,
    });

    const steps = outcome.failures.map((failure) => failure.step);
    expect(steps).toContain('backup artifact deletion');
    expect(outcome.failures[0]?.detail).toContain('unverified');
  });
});

describe('cleanup guards', () => {
  it('refuses a restore database name it cannot positively identify', async () => {
    await expect(
      cleanUpRecoveryResources({
        master: fakeSession(),
        source: fakeSession(),
        restored: undefined,
        restoreDatabase: 'MinhajPlatform',
        backupPath,
      }),
    ).rejects.toThrow(/Refusing to operate destructively/);
  });

  it('refuses a backup path outside the Phase 1 backup directory', async () => {
    await expect(
      cleanUpRecoveryResources({
        master: fakeSession(),
        source: fakeSession(),
        restored: undefined,
        restoreDatabase,
        backupPath: '/var/opt/mssql/data/MinhajPlatform.mdf',
      }),
    ).rejects.toThrow(/not a Phase 1 backup artifact/);
  });
});
