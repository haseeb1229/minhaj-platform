import { describe, expect, it } from 'vitest';

import {
  backupArtifactExists,
  newBackupTarget,
  newRestoreDatabaseName,
} from '../../packages/database/src/lifecycle/backup.ts';
import { cleanUpRecoveryResources } from '../../packages/database/src/lifecycle/recovery-cleanup.ts';
import {
  dropDisposableDatabase,
  newDisposableDatabaseName,
} from '../../packages/database/src/lifecycle/disposable-database.ts';
import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';

/**
 * F9 — a cleanup gate may claim "gone" only on POSITIVE evidence of absence.
 *
 * Both absence checks used to end in a coalesce: `Number(row?.fileExists ?? 0)`
 * and `Number(row?.present ?? 1)`. The first reads every inconclusive outcome —
 * no row, a NULL, a renamed column, a value that is neither 0 nor 1 — as "the
 * artifact is gone", which is the answer that lets `db:recovery:test` exit 0.
 * A broken inspection therefore became a passing cleanup gate.
 *
 * These cases are ones a healthy server will not produce on request, so they
 * are driven through the `SqlSession` seam the modules already take.
 */

const backupPath = newBackupTarget().path;
const restoreDatabase = newRestoreDatabaseName();

type Answer = (statement: string) => unknown[];

function fakeSession(answer: Answer, options: { throwOn?: RegExp } = {}): SqlSession {
  return {
    async query<Row>(statement: string): Promise<Row[]> {
      if (options.throwOn?.test(statement) === true) {
        throw new Error('the inspection query itself failed');
      }
      return answer(statement) as Row[];
    },
    async runScript(): Promise<void> {
      // Nothing under test runs a script; reaching this would mean the module
      // changed shape rather than that this fake is incomplete.
      throw new Error('runScript is not part of the path under test');
    },
    async close(): Promise<void> {
      // No connection to release.
    },
  };
}

/** Answers `xp_fileexist` with `rows`, and everything else with nothing. */
function fileExistsSession(rows: unknown[]): SqlSession {
  return fakeSession((statement) => (statement.includes('xp_fileexist') ? rows : []));
}

describe('F9 — backup artifact absence', () => {
  it('reports presence for an explicit file_exists = 1', async () => {
    await expect(
      backupArtifactExists(
        fileExistsSession([{ fileExists: 1, isDirectory: 0 }]),
        backupPath,
      ),
    ).resolves.toBe(true);
  });

  it('reports absence for an explicit file_exists = 0', async () => {
    await expect(
      backupArtifactExists(
        fileExistsSession([{ fileExists: 0, isDirectory: 0 }]),
        backupPath,
      ),
    ).resolves.toBe(false);
  });

  it.each([
    ['no row at all', []],
    ['more than one row', [{ fileExists: 0 }, { fileExists: 0 }]],
  ])('fails on %s rather than reporting absence', async (_label, rows) => {
    await expect(
      backupArtifactExists(fileExistsSession(rows), backupPath),
    ).rejects.toThrow(/not evidence that it is gone/);
  });

  it('fails on a NULL file_exists', async () => {
    await expect(
      backupArtifactExists(fileExistsSession([{ fileExists: null }]), backupPath),
    ).rejects.toThrow(/no file_exists value/);
  });

  it('fails on a missing file_exists column', async () => {
    // A renamed or absent column used to coalesce straight to "absent".
    await expect(
      backupArtifactExists(fileExistsSession([{ somethingElse: 0 }]), backupPath),
    ).rejects.toThrow(/no file_exists value/);
  });

  it.each([2, -1, 'yes', '0', '1', '', undefined])(
    'fails on the malformed value %s',
    async (value) => {
      await expect(
        backupArtifactExists(
          fileExistsSession([{ fileExists: value, isDirectory: 0 }]),
          backupPath,
        ),
      ).rejects.toThrow(/only 0 or 1 is an answer|no file_exists value/);
    },
  );

  it.each([null, undefined, 2, '0'])(
    'fails on malformed is_directory %s',
    async (value) => {
      await expect(
        backupArtifactExists(
          fileExistsSession([{ fileExists: 0, isDirectory: value }]),
          backupPath,
        ),
      ).rejects.toThrow(/no valid is_directory value/);
    },
  );

  it('fails when the path turns out to be a directory', async () => {
    await expect(
      backupArtifactExists(
        fileExistsSession([{ fileExists: 0, isDirectory: 1 }]),
        backupPath,
      ),
    ).rejects.toThrow(/is a directory, not a backup file/);
  });

  it('fails when the inspection query itself fails', async () => {
    await expect(
      backupArtifactExists(
        fakeSession(() => [], { throwOn: /xp_fileexist/ }),
        backupPath,
      ),
    ).rejects.toThrow(/the inspection query itself failed/);
  });

  it('still refuses a path outside the Phase 1 backup directory', async () => {
    await expect(
      backupArtifactExists(
        fileExistsSession([{ fileExists: 0 }]),
        '/var/opt/mssql/data/MinhajPlatform.mdf',
      ),
    ).rejects.toThrow(/not a Phase 1 backup artifact/);
  });
});

/** Runs cleanup with a master session that answers the residue probe as told. */
async function cleanupWithResidueAnswer(
  rows: unknown[],
  options: { throwOnProbe?: boolean } = {},
): Promise<string[]> {
  const master = fakeSession(
    (statement) => (statement.includes('DB_ID') ? rows : []),
    options.throwOnProbe === true ? { throwOn: /CASE WHEN DB_ID/ } : {},
  );

  const source = fakeSession((statement) =>
    statement.includes('xp_fileexist') ? [{ fileExists: 0, isDirectory: 0 }] : [],
  );

  const outcome = await cleanUpRecoveryResources({
    master,
    source,
    restored: undefined,
    restoreDatabase,
    backupPath,
  });

  return outcome.failures
    .filter((failure) => failure.step === 'restore database residue')
    .map((failure) => failure.detail);
}

describe('F9 — restore database absence', () => {
  it('passes only on an explicit "absent"', async () => {
    expect(await cleanupWithResidueAnswer([{ present: 0 }])).toEqual([]);
  });

  it('fails when the database is explicitly still present', async () => {
    expect(await cleanupWithResidueAnswer([{ present: 1 }])).toEqual([
      expect.stringContaining('still exists'),
    ]);
  });

  it('fails on an empty inspection result', async () => {
    expect(await cleanupWithResidueAnswer([])).toEqual([
      expect.stringContaining('returned 0 rows'),
    ]);
  });

  it('fails on more rows than it asked for', async () => {
    expect(await cleanupWithResidueAnswer([{ present: 0 }, { present: 0 }])).toEqual([
      expect.stringContaining('returned 2 rows'),
    ]);
  });

  it('fails on a NULL result', async () => {
    expect(await cleanupWithResidueAnswer([{ present: null }])).toEqual([
      expect.stringContaining('returned no value'),
    ]);
  });

  it('fails on a missing column', async () => {
    expect(await cleanupWithResidueAnswer([{ somethingElse: 0 }])).toEqual([
      expect.stringContaining('returned no value'),
    ]);
  });

  it.each([2, 'no', '0', '1', '', undefined])(
    'fails on the malformed value %s',
    async (value) => {
      const failures = await cleanupWithResidueAnswer([{ present: value }]);
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatch(/only 0 or 1 is an answer|returned no value/);
    },
  );

  it('fails when the inspection query itself fails', async () => {
    expect(
      await cleanupWithResidueAnswer([{ present: 0 }], { throwOnProbe: true }),
    ).toEqual([expect.stringContaining('the inspection query itself failed')]);
  });
});

describe('F9 — an unanswerable artifact probe fails the cleanup', () => {
  it.each([
    ['no row', []],
    ['a NULL', [{ fileExists: null }]],
    ['a malformed value', [{ fileExists: 2 }]],
  ])('records %s as a cleanup failure, never as clean', async (_label, rows) => {
    const source = fakeSession((statement) =>
      statement.includes('xp_fileexist') ? rows : [],
    );

    const outcome = await cleanUpRecoveryResources({
      master: fakeSession((statement) =>
        statement.includes('DB_ID') ? [{ present: 0 }] : [],
      ),
      source,
      restored: undefined,
      restoreDatabase,
      backupPath,
    });

    expect(outcome.failures.map((failure) => failure.step)).toContain(
      'backup artifact residue',
    );
    expect(outcome.succeeded).not.toContain(
      expect.stringContaining('backup artifact residue'),
    );
  });
});

describe('F9 - disposable database cleanup proves absence', () => {
  const database = newDisposableDatabaseName();

  function disposableSession(rows: unknown[]): SqlSession {
    let calls = 0;
    return fakeSession(() => (++calls === 1 ? [] : rows));
  }

  it('passes only after DB_ID explicitly reports absence', async () => {
    await expect(
      dropDisposableDatabase(disposableSession([{ present: 0 }]), database),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['no row', []],
    ['multiple rows', [{ present: 0 }, { present: 0 }]],
    ['NULL', [{ present: null }]],
    ['missing value', [{}]],
    ['malformed value', [{ present: '0' }]],
    ['residue', [{ present: 1 }]],
  ])('fails on %s', async (_label, rows) => {
    await expect(
      dropDisposableDatabase(disposableSession(rows), database),
    ).rejects.toThrow(/unknown|still exists/);
  });
});
