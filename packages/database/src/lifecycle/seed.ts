import 'server-only';

import { appliedMigrationNames, loadMigrations } from './migrations.ts';
import type { SqlSession } from './sql-connection.ts';

/**
 * Phase 1 seed mechanism.
 *
 * Phase 1 has no data to seed. Business tables do not exist and inventing rows
 * for them is exactly what DELIVERY_PLAN.md forbids, so seeding here is a
 * deterministic verification pass: it confirms the database is in the state
 * migrations claim, and reports what it found.
 *
 * The point is to establish and prove the MECHANISM — a stable command, safe to
 * run repeatedly, that later phases extend with their own data. Idempotence is
 * therefore structural rather than achieved by careful upserts: the seed makes
 * no writes at all, so a second run cannot diverge from the first.
 */

export interface SeedResult {
  appliedMigrations: string[];
  auditRowCount: number;
  seededRecords: number;
}

export async function runSeed(session: SqlSession): Promise<SeedResult> {
  const migrations = await loadMigrations();
  const applied = await appliedMigrationNames(session);

  const missing = migrations
    .map((migration) => migration.id)
    .filter((id) => !applied.includes(id));

  if (missing.length > 0) {
    throw new Error(
      `Cannot seed: migrations not applied: ${missing.join(', ')}. ` +
        `Run the migration workflow first.`,
    );
  }

  const [row] = await session.query<{ total: number }>(
    'SELECT COUNT_BIG(*) AS total FROM [dbo].[AuditLog];',
  );

  return {
    appliedMigrations: applied,
    auditRowCount: Number(row?.total ?? 0),
    // Phase 1 seeds no rows. Stated explicitly so a later phase adding data
    // has an obvious place to change, and so "0" is an asserted outcome
    // rather than an absence nobody checked.
    seededRecords: 0,
  };
}
