import 'server-only';

import {
  assertBackupPath,
  assertRestoreDatabaseName,
  backupArtifactExists,
  deleteBackupArtifact,
  dropRestoreDatabase,
} from './backup.ts';
import type { SqlSession } from './sql-connection.ts';

/**
 * Cleanup of the disposable resources the recovery rehearsal creates, with
 * failures PROPAGATED rather than printed.
 *
 * The rehearsal's first revision caught each cleanup error, wrote `FAILED: …`
 * to stdout and carried on, so `db:recovery:test` exited 0 while a restore
 * database or a backup artifact was still on the server. A gate that reports a
 * leak and then declares success trains everyone to ignore the line — and in
 * CI, where nobody reads a passing job's log, the leak is invisible.
 *
 * Two properties are needed at once, and they pull against each other:
 *
 *   1. every cleanup step must be ATTEMPTED, even after an earlier one throws
 *      — a failed DROP must not leave the artifact behind as well;
 *   2. any failure must still FAIL the command.
 *
 * So each step runs under its own guard, failures accumulate in a list, and
 * the caller decides what to do once every step has had its turn. Nothing here
 * writes to stdout: reporting is the caller's job, and a cleanup module that
 * printed its own verdict would be the same mistake in a new place.
 */

/** One cleanup step that failed, named safely. */
export interface CleanupFailure {
  /** The step, e.g. `restore database drop`. Never a URL or a credential. */
  step: string;
  /** Why it failed: an error message, or the residue that survived. */
  detail: string;
}

export interface CleanupOutcome {
  failures: CleanupFailure[];
  /** Steps that completed and verified clean, for the caller's report. */
  succeeded: string[];
}

/**
 * Runs one cleanup step, converting a throw into a recorded failure.
 *
 * This is what keeps a failing step from cancelling the ones after it, and it
 * is deliberately the ONLY place a cleanup error is caught — swallowing one
 * anywhere else is the defect this module exists to prevent.
 */
async function attempt(
  outcome: CleanupOutcome,
  step: string,
  action: () => Promise<string>,
): Promise<void> {
  try {
    outcome.succeeded.push(`${step}: ${await action()}`);
  } catch (error) {
    outcome.failures.push({
      step,
      // The message only; no stack, no connection URL, no credential.
      detail: (error as Error).message.split('\n')[0] ?? 'unknown error',
    });
  }
}

/** Closes a session without letting a close failure abort the cleanup run. */
export async function closeQuietly(
  outcome: CleanupOutcome,
  step: string,
  session: SqlSession | undefined,
): Promise<void> {
  if (session === undefined) return;
  await attempt(outcome, step, async () => {
    await session.close();
    return 'closed';
  });
}

export interface RecoveryCleanupRequest {
  /** Administrative session on `master`, used to drop the restore database. */
  master: SqlSession;
  /** Session on the source database, used to delete the artifact. Optional:
   *  the run may have failed before it was opened. */
  source: SqlSession | undefined;
  /** Session on the restored database, closed before the DROP can succeed. */
  restored: SqlSession | undefined;
  restoreDatabase: string;
  backupPath: string;
}

/**
 * Attempts EVERY cleanup step, verifies no residue survives, and reports what
 * failed.
 *
 * Order is dependency-driven, not preference: the restored session is closed
 * before the DROP, because SQL Server cannot drop a database that this process
 * still holds a connection to. Beyond that, each step is independent and one
 * failing does not skip another.
 *
 * Residue is checked SEPARATELY from the operation that should have removed
 * it. A DROP or a delete that returns without throwing is not evidence the
 * resource is gone, and this gate exists precisely to distinguish the two.
 */
export async function cleanUpRecoveryResources(
  request: RecoveryCleanupRequest,
): Promise<CleanupOutcome> {
  const { master, source, restored, restoreDatabase, backupPath } = request;
  const outcome: CleanupOutcome = { failures: [], succeeded: [] };

  // Fail closed before touching anything, exactly as the destructive helpers
  // do. A malformed name reaching this far is a bug, not a cleanup problem.
  assertRestoreDatabaseName(restoreDatabase);
  assertBackupPath(backupPath);

  // The DROP cannot succeed while this process holds the connection.
  await closeQuietly(outcome, 'restored session close', restored);

  await attempt(outcome, 'restore database drop', async () => {
    await dropRestoreDatabase(master, restoreDatabase);
    return `${restoreDatabase} dropped`;
  });

  // Verified independently of the DROP above: this is the check that catches a
  // drop which reported success and left the database in place.
  await attempt(outcome, 'restore database residue', async () => {
    const rows = await master.query<{ present: number | null }>(
      `SELECT CASE WHEN DB_ID(N'${restoreDatabase}') IS NULL THEN 0 ELSE 1 END AS present;`,
    );

    // Absence must be POSITIVELY established. No row, a NULL, or a value that
    // is neither 0 nor 1 means the inspection did not answer — and an
    // unanswered inspection is a cleanup failure, never a clean result.
    if (rows.length !== 1) {
      throw new Error(
        `the residue inspection returned ${rows.length} rows; ${restoreDatabase} ` +
          `is in an unknown state`,
      );
    }
    const present = rows[0]?.present;
    if (present === null || present === undefined) {
      throw new Error(
        `the residue inspection returned no value; ${restoreDatabase} is in an ` +
          `unknown state`,
      );
    }
    if (present !== 0 && present !== 1) {
      throw new Error(
        `the residue inspection reported '${String(present)}'; only 0 or 1 is an ` +
          `answer about ${restoreDatabase}`,
      );
    }
    if (present !== 0) {
      throw new Error(`${restoreDatabase} still exists after the drop attempt`);
    }

    return `${restoreDatabase} absent, DB_ID is NULL`;
  });

  if (source === undefined) {
    // The artifact can only be removed through a session on the source, so if
    // the run never opened one, the artifact's state is unknown rather than
    // clean. Recording it keeps a missing session from reading as success.
    outcome.failures.push({
      step: 'backup artifact deletion',
      detail:
        'no session on the source database was available to delete the ' +
        'artifact; its state is unverified',
    });
  } else {
    await attempt(outcome, 'backup artifact deletion', async () => {
      await deleteBackupArtifact(source, backupPath);
      return `${backupPath} deleted`;
    });

    await attempt(outcome, 'backup artifact residue', async () => {
      if (await backupArtifactExists(source, backupPath)) {
        throw new Error(`${backupPath} still exists after the delete attempt`);
      }
      return `${backupPath} absent, xp_fileexist reports it gone`;
    });
  }

  // Sessions are closed last, and still under `attempt`, so a connection is
  // never left open merely because an earlier cleanup step failed.
  await closeQuietly(outcome, 'source session close', source);
  await closeQuietly(outcome, 'master session close', master);

  return outcome;
}

/**
 * Raised when cleanup left something behind, or could not confirm that it did
 * not.
 *
 * Carries every failure rather than only the first: a run whose DROP and
 * delete both failed has leaked two resources, and reporting one of them sends
 * whoever investigates to clean up half the mess.
 */
export class RecoveryCleanupError extends Error {
  readonly failures: readonly CleanupFailure[];

  constructor(failures: readonly CleanupFailure[]) {
    super(
      `Recovery cleanup did not complete: ${failures.length} step(s) failed.\n` +
        failures.map((failure) => `  - ${failure.step}: ${failure.detail}`).join('\n'),
    );
    this.name = 'RecoveryCleanupError';
    this.failures = failures;
  }
}
