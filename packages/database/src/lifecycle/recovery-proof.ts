import 'server-only';

import { randomUUID } from 'node:crypto';

import type { SqlSession } from './sql-connection.ts';

/**
 * The evidence half of the Chunk 3 recovery proof: what is written before a
 * backup, and what must be found in the restored database afterwards.
 *
 * A restore that recreates only SCHEMA proves very little — a migration replay
 * would produce the same tables. What distinguishes a genuine restore is that
 * DATA written before the backup, and never written to the restore target,
 * reappears there with unchanged values. That is what the marker row below is
 * for.
 *
 * The marker is a synthetic `AuditLog` row. It uses the audit foundation the
 * approved Phase 1 design already ships rather than introducing a table, which
 * DELIVERY_PLAN.md forbids ("domain tables arrive with their owning slice"),
 * and it carries no personal, user or domain data: a deterministic marker
 * identifier and the fixed strings below, nothing else.
 */

/** Marks the row as recovery-proof machinery rather than a real audit event. */
const PROOF_ACTION = 'phase1.recovery.proof';
const PROOF_ACTOR_TYPE = 'system';
const PROOF_TARGET_TYPE = 'DatabaseRecovery';
const PROOF_AUTHORISING_SOURCE = 'db:recovery:test';

/** One marker row, as written before backup and as expected after restore. */
export interface RecoveryMarker {
  id: string;
  targetId: string;
}

/**
 * Mints a marker. The identifier is random per run, so a restored row can only
 * have arrived from THIS run's backup — a leftover row from an earlier
 * rehearsal cannot satisfy the assertion.
 */
export function newRecoveryMarker(): RecoveryMarker {
  return {
    id: randomUUID(),
    targetId: `phase1-recovery-${randomUUID().replaceAll('-', '')}`,
  };
}

/** Rejects anything that is not a plain marker identifier before it reaches SQL. */
function assertSafeMarker(marker: RecoveryMarker): void {
  if (!/^[0-9a-fA-F-]{36}$/.test(marker.id)) {
    throw new Error('Recovery marker id is not a UUID.');
  }
  if (!/^phase1-recovery-[0-9a-f]{32}$/.test(marker.targetId)) {
    throw new Error('Recovery marker targetId does not match the expected pattern.');
  }
}

/**
 * Writes the marker row into the SOURCE database, before the backup is taken.
 *
 * Written with the MIGRATION principal. The runtime principal's INSERT right
 * would also suffice, but the recovery rehearsal is administrative work and
 * runs under administrative authority throughout — the runtime credentials are
 * never used by this tooling (SECURITY_BASELINE.md §18.2).
 *
 * `INSERT` only. Nothing here updates or deletes an audit row, so the
 * append-only model the permission design enforces is not weakened to make the
 * proof convenient.
 */
export async function writeRecoveryMarker(
  admin: SqlSession,
  marker: RecoveryMarker,
): Promise<void> {
  assertSafeMarker(marker);

  await admin.query(`
    INSERT INTO [dbo].[AuditLog]
      ([id], [actorType], [action], [targetType], [targetId], [authorisingSource])
    VALUES
      (N'${marker.id}', N'${PROOF_ACTOR_TYPE}', N'${PROOF_ACTION}',
       N'${PROOF_TARGET_TYPE}', N'${marker.targetId}', N'${PROOF_AUTHORISING_SOURCE}');
  `);
}

/** The marker row as it was actually found in the restored database. */
export interface RestoredMarker {
  id: string;
  actorType: string;
  action: string;
  targetType: string;
  targetId: string;
  authorisingSource: string | null;
  occurredAt: Date | string;
}

/**
 * Reads the marker back out of the RESTORED database and checks every field.
 *
 * Finding a row with the right id is not sufficient: a restore that recovered
 * an identifier but corrupted the payload would pass such a check. Each value
 * written before the backup is compared to what came back.
 */
export async function verifyRestoredMarker(
  restored: SqlSession,
  marker: RecoveryMarker,
): Promise<RestoredMarker> {
  assertSafeMarker(marker);

  const rows = await restored.query<RestoredMarker>(`
    SELECT [id], [actorType], [action], [targetType], [targetId],
           [authorisingSource], [occurredAt]
    FROM [dbo].[AuditLog]
    WHERE [id] = N'${marker.id}';
  `);

  const [row] = rows;
  if (row === undefined) {
    throw new Error(
      `Restored database does not contain the recovery marker ${marker.targetId}. ` +
        `The restore recovered no data, or did not come from this run's backup.`,
    );
  }
  if (rows.length !== 1) {
    throw new Error(`Restored database contains ${rows.length} rows for the marker id.`);
  }

  // `id` is UNIQUEIDENTIFIER; SQL Server returns it upper-cased.
  if (row.id.toLowerCase() !== marker.id.toLowerCase()) {
    throw new Error(`Restored marker id is '${row.id}', expected '${marker.id}'.`);
  }
  if (row.targetId !== marker.targetId) {
    throw new Error(
      `Restored marker targetId is '${row.targetId}', expected '${marker.targetId}'.`,
    );
  }
  if (row.action !== PROOF_ACTION) {
    throw new Error(`Restored marker action is '${row.action}', expected PROOF_ACTION.`);
  }
  if (row.actorType !== PROOF_ACTOR_TYPE) {
    throw new Error(`Restored marker actorType is '${row.actorType}'.`);
  }
  if (row.targetType !== PROOF_TARGET_TYPE) {
    throw new Error(`Restored marker targetType is '${row.targetType}'.`);
  }
  if (row.authorisingSource !== PROOF_AUTHORISING_SOURCE) {
    throw new Error(
      `Restored marker authorisingSource is '${row.authorisingSource ?? '(null)'}'.`,
    );
  }

  return row;
}

/**
 * Note on cleanup: there is deliberately no function here that deletes the
 * marker from the source database.
 *
 * The marker is an audit row, and audit rows are append-only
 * (SECURITY_BASELINE.md §13.1). Providing a "tidy up the proof rows" helper
 * would model precisely the behaviour the permission design exists to prevent,
 * and it would need authority the runtime principal is denied. The rows are
 * tiny, synthetic and self-identifying, and they stay.
 *
 * Disposable RESTORE databases and backup artifacts are a different matter:
 * those are created by the rehearsal and are removed by it (`backup.ts`).
 */
