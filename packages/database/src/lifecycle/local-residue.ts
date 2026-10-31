import 'server-only';

import { dropRestoreDatabase, isRestoreDatabaseName } from './backup.ts';
import {
  dropDisposableDatabase,
  isDisposableDatabaseName,
} from './disposable-database.ts';
import { isDatabasePresent } from './recovery-cleanup.ts';
import type { SqlSession } from './sql-connection.ts';

/**
 * Removal of the disposable databases repository tooling leaves behind on the
 * approved LOCAL server when a run is interrupted before its own cleanup.
 *
 * Two generators, two shapes, and nothing else:
 *
 *   - `MinhajPhase1Restore_<32 hex>` — a recovery-rehearsal restore copy;
 *   - `MinhajPhase1Test_<32 hex>`    — a disposable lifecycle test database.
 *
 * A name is residue only when the generator's OWN guard accepts it, so this
 * module adds no pattern of its own to drift from them. Every other database —
 * `MinhajPlatform`, the staging names, the system databases, anything unknown
 * — is invisible to it.
 *
 * Each drop goes through that generator's guarded helper, which re-validates
 * the exact name, and absence is then proved by an independent `DB_ID` read.
 * A database something is still connected to is refused rather than forced:
 * the helpers' `ROLLBACK IMMEDIATE` exists to unstick a run's own cleanup, not
 * to evict a run that is still in progress.
 */

export type ResidueKind = 'restore' | 'test';

/** Classifies a database name; `null` means it is not ours to touch. */
export function residueKindOf(name: string): ResidueKind | null {
  if (isRestoreDatabaseName(name)) return 'restore';
  if (isDisposableDatabaseName(name)) return 'test';
  return null;
}

const DROP: Record<ResidueKind, (master: SqlSession, name: string) => Promise<void>> = {
  restore: (master, name) => dropRestoreDatabase(master, name),
  test: (master, name) => dropDisposableDatabase(master, name),
};

/** One residue database as the server reported it. */
export interface ResidueCandidate {
  name: string;
  kind: ResidueKind;
  /** `sys.databases.state_desc`. */
  state: string;
  /** Sessions whose current database is this one. */
  sessions: number;
}

export type ResidueVerdict = 'drop' | 'refused-sessions' | 'refused-state';

export type ResidueOutcome =
  'dropped' | 'refused-sessions' | 'refused-state' | 'not-proven-absent' | 'failed';

export interface ResidueResult {
  name: string;
  kind: ResidueKind;
  outcome: ResidueOutcome;
  /** One line of status. Database names and SQL Server messages only. */
  detail: string;
}

/** Only an ONLINE database nobody is connected to is dropped. */
export function residueVerdict(candidate: ResidueCandidate): ResidueVerdict {
  if (candidate.sessions !== 0) return 'refused-sessions';
  if (candidate.state !== 'ONLINE') return 'refused-state';
  return 'drop';
}

/** The result for a candidate its verdict refuses; `null` when it may be dropped. */
function refusalOf(candidate: ResidueCandidate): ResidueResult | null {
  const verdict = residueVerdict(candidate);
  if (verdict === 'drop') return null;
  return {
    name: candidate.name,
    kind: candidate.kind,
    outcome: verdict,
    detail:
      verdict === 'refused-sessions'
        ? `${candidate.sessions} session(s) connected`
        : `state ${candidate.state}`,
  };
}

function firstLine(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? '';
}

/**
 * Throws unless this principal can see EVERY session on the server.
 *
 * Without `VIEW SERVER STATE`, `sys.dm_exec_sessions` shows a principal only
 * its own sessions, so a session count of zero would be an answer about this
 * connection rather than about the database.
 */
async function assertSessionsVisible(master: SqlSession): Promise<void> {
  const rows = await master.query<{ visible: number | null }>(
    `SELECT HAS_PERMS_BY_NAME(NULL, NULL, N'VIEW SERVER STATE') AS visible;`,
  );
  if (rows.length !== 1 || rows[0]?.visible !== 1) {
    throw new Error(
      'this principal cannot see every session (VIEW SERVER STATE), so no ' +
        'database can be shown to be unused',
    );
  }
}

/**
 * Reads name, state and session count — for every database, or for one
 * already-classified name. Malformed rows throw: an inventory that cannot be
 * read is not an inventory of nothing.
 */
async function readDatabases(
  master: SqlSession,
  name?: string,
): Promise<{ name: string; state: string; sessions: number }[]> {
  if (name !== undefined && residueKindOf(name) === null) {
    throw new Error(`refusing to inspect '${name}': not a residue database name`);
  }
  // Embedded only after the exact-name check above, which admits no quote.
  const filter = name === undefined ? '' : `WHERE d.name = N'${name}'`;

  const rows = await master.query<{ name: unknown; state: unknown; sessions: unknown }>(`
    SELECT d.name AS name,
           d.state_desc AS state,
           (SELECT COUNT(*) FROM sys.dm_exec_sessions AS s
             WHERE s.database_id = d.database_id) AS sessions
    FROM sys.databases AS d
    ${filter}
    ORDER BY d.name;
  `);

  return rows.map((row) => {
    if (
      typeof row.name !== 'string' ||
      typeof row.state !== 'string' ||
      typeof row.sessions !== 'number' ||
      !Number.isInteger(row.sessions) ||
      row.sessions < 0
    ) {
      throw new Error('the database inventory returned a malformed row');
    }
    return { name: row.name, state: row.state, sessions: row.sessions };
  });
}

/**
 * Lists the residue on the server the session is connected to. Read-only:
 * this is the whole of a dry run.
 *
 * The caller owns proving the server is the approved local one; this module
 * takes an already-open `master` session and never chooses a target.
 */
export async function planLocalResidue(master: SqlSession): Promise<ResidueCandidate[]> {
  await assertSessionsVisible(master);

  const candidates: ResidueCandidate[] = [];
  for (const row of await readDatabases(master)) {
    const kind = residueKindOf(row.name);
    if (kind !== null) candidates.push({ ...row, kind });
  }
  return candidates;
}

/**
 * Drops one residue database and proves it is gone.
 *
 * The state and session count are read AGAIN immediately before the DROP: the
 * plan may be minutes old by the time a long list reaches this entry.
 */
async function dropCandidate(
  master: SqlSession,
  candidate: ResidueCandidate,
): Promise<ResidueResult> {
  const { name, kind } = candidate;
  const result = (outcome: ResidueOutcome, detail: string): ResidueResult => ({
    name,
    kind,
    outcome,
    detail,
  });

  let current: ResidueCandidate;
  try {
    const rows = await readDatabases(master, name);
    if (rows.length !== 1 || rows[0] === undefined) {
      return result('failed', `the re-inspection returned ${rows.length} rows`);
    }
    current = { ...rows[0], kind };
  } catch (error) {
    return result('failed', `re-inspection failed: ${firstLine(error)}`);
  }

  const refusal = refusalOf(current);
  if (refusal !== null) return refusal;

  // A throw from the helper is remembered, not final: whether the database is
  // still there is answered by the probe below, not by the DROP's own outcome.
  let dropError: string | undefined;
  try {
    await DROP[kind](master, name);
  } catch (error) {
    dropError = firstLine(error);
  }
  const reported = dropError === undefined ? '' : `; drop reported: ${dropError}`;

  let present: boolean;
  try {
    present = await isDatabasePresent(master, name);
  } catch (error) {
    return result(
      'failed',
      `absence could not be established: ${firstLine(error)}${reported}`,
    );
  }

  if (present) {
    return result('not-proven-absent', `DB_ID still reports the database${reported}`);
  }
  if (dropError !== undefined) {
    // Gone, but by a path that reported an error: not a clean drop.
    return result('failed', `DB_ID is NULL${reported}`);
  }
  return result('dropped', 'absent, DB_ID is NULL');
}

/**
 * Plans, then drops every eligible residue database, one at a time, so one
 * failure never skips the rest.
 *
 * Throws only when the plan itself cannot be read. Per-database refusals and
 * failures are RESULTS, and the caller must treat any outcome other than
 * `dropped` as a failed run.
 */
export async function cleanUpLocalResidue(master: SqlSession): Promise<ResidueResult[]> {
  const results: ResidueResult[] = [];
  for (const candidate of await planLocalResidue(master)) {
    results.push(refusalOf(candidate) ?? (await dropCandidate(master, candidate)));
  }
  return results;
}
