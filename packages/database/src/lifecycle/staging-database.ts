import 'server-only';

import {
  STAGING_BACKUP_NAMING,
  assertBackupPath,
  backupArtifactExists,
} from './backup.ts';
import { appliedMigrationNames, loadMigrations } from './migrations.ts';
import {
  inspectPrincipalAuthority,
  overreachingGrants,
  recordedPermissions,
} from './principal-authority.ts';
import { assertDatabaseAbsent } from './recovery-cleanup.ts';
import type { SqlSession } from './sql-connection.ts';
import {
  FINGERPRINT_ENVIRONMENT_ID_PROPERTY,
  FINGERPRINT_ENVIRONMENT_PROPERTY,
  STAGING_DATABASE,
  STAGING_ENVIRONMENT,
  StagingTargetError,
  assertStagingFingerprint,
  fingerprintRefusal,
  readDatabaseFingerprint,
} from './staging-target.ts';

/**
 * The staging database lifecycle: create with a fingerprint, drop, and the
 * checks that stand in front of a destructive reset (DELIVERY_PLAN.md
 * Phase 28: "staging database with restore-tested backups · seed and reset
 * procedures").
 *
 * Every function takes the sessions it needs as arguments. The commands in
 * `packages/database/scripts/staging-*.ts` open them only after
 * `./staging-target.ts` has positively identified the target, and the tests
 * drive the same functions with fake sessions.
 *
 * The only database name any statement here embeds is the constant
 * `MinhajStaging`, or the environment id the staging guard has already proven
 * to be a lowercase UUID — never a value a caller supplied unvalidated.
 */

/* ---------------------------------------------------------------------------
 * Create, fingerprint, drop
 * ------------------------------------------------------------------------- */

export interface CreateOutcome {
  /** `false` when the database already existed with this environment's fingerprint. */
  created: boolean;
}

/**
 * Creates `MinhajStaging` and writes its fingerprint — or proves it already
 * exists WITH this environment's fingerprint and changes nothing.
 *
 * NEVER ADOPTS. A database of that name without the matching fingerprint was
 * not created by this environment's tooling — a restored production copy, a
 * manual experiment, another staging instance's volume — and writing our
 * fingerprint onto it would launder an unknown database into a trusted one.
 *
 * `CREATE DATABASE` cannot run inside a transaction, so there is a window
 * between creation and the two property writes. A crash inside it leaves an
 * unfingerprinted `MinhajStaging`, which this function then refuses — the safe
 * direction. The refusal says how to resolve it.
 */
export async function createStagingDatabase(
  master: SqlSession,
  environmentId: string,
  openLive: () => Promise<SqlSession>,
): Promise<CreateOutcome> {
  assertEnvironmentId(environmentId);

  const existing = await readDatabaseFingerprint(master, STAGING_DATABASE);
  if (existing.exists) {
    const refusal = fingerprintRefusal(existing, environmentId);
    if (refusal !== undefined) {
      throw new StagingTargetError(
        'fingerprint',
        `${STAGING_DATABASE} already exists and is not this environment's ` +
          `(${refusal}). If an interrupted staging:db:create left it behind, ` +
          `inspect it and drop it deliberately before creating again`,
      );
    }
    return { created: false };
  }

  await master.query(`CREATE DATABASE [${STAGING_DATABASE}];`);

  const live = await openLive();
  try {
    await writeFingerprint(live, environmentId);
  } finally {
    await live.close();
  }

  // Read back through `master`, independently of the session that wrote it.
  await assertStagingFingerprint(master, STAGING_DATABASE, environmentId);

  return { created: true };
}

/**
 * Writes the two database-level extended properties through a session ON
 * `MinhajStaging`: with no level arguments, `sp_addextendedproperty` writes a
 * class-0 property of the CURRENT database, so the session's database is what
 * makes the fingerprint belong to `MinhajStaging` and not to `master`.
 */
async function writeFingerprint(live: SqlSession, environmentId: string): Promise<void> {
  assertEnvironmentId(environmentId);

  const [current] = await live.query<{ name: string }>('SELECT DB_NAME() AS name;');
  if (current?.name !== STAGING_DATABASE) {
    throw new StagingTargetError(
      'fingerprint',
      `the fingerprint session is not on ${STAGING_DATABASE}`,
    );
  }

  await live.query(`
    EXEC sys.sp_addextendedproperty
      @name = N'${FINGERPRINT_ENVIRONMENT_PROPERTY}', @value = N'${STAGING_ENVIRONMENT}';
  `);
  await live.query(`
    EXEC sys.sp_addextendedproperty
      @name = N'${FINGERPRINT_ENVIRONMENT_ID_PROPERTY}', @value = N'${environmentId}';
  `);
}

/**
 * Drops `MinhajStaging` and proves it is gone.
 *
 * The name is the constant, never a parameter: there is no way to aim this at
 * another database. The caller is `staging:db:reset` alone, after its
 * confirmation, fingerprint and backup checks.
 */
export async function dropStagingDatabase(master: SqlSession): Promise<void> {
  await master.query(`
    IF DB_ID(N'${STAGING_DATABASE}') IS NOT NULL
    BEGIN
      ALTER DATABASE [${STAGING_DATABASE}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
      DROP DATABASE [${STAGING_DATABASE}];
    END;
  `);

  // A DROP that returned is not evidence of absence; the probe is.
  await assertDatabaseAbsent(master, STAGING_DATABASE);
}

function assertEnvironmentId(environmentId: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      environmentId,
    )
  ) {
    throw new StagingTargetError(
      'MINHAJ_STAGING_ENVIRONMENT_ID',
      'the staging environment id is not a lowercase UUID v4',
    );
  }
}

/* ---------------------------------------------------------------------------
 * Migration state
 * ------------------------------------------------------------------------- */

export interface MigrationReport {
  /** Finished, not rolled back. */
  appliedCount: number;
  latest: string | null;
  /** Started and never finished — a failed or interrupted deploy. */
  unfinished: number;
  /** In the repository, not applied here. */
  pending: string[];
  /** Applied here, unknown to this repository. */
  unknown: string[];
}

/**
 * Compares the database's Prisma history with this repository's migrations.
 *
 * Read from `_prisma_migrations` directly, exactly as the local gates do: this
 * observes what the CLI did and never creates or repairs that state.
 */
export async function migrationReport(session: SqlSession): Promise<MigrationReport> {
  const repository = (await loadMigrations()).map((migration) => migration.id);
  const applied = await appliedMigrationNames(session);

  const [unfinished] = await session.query<{ total: number }>(`
    SELECT COUNT_BIG(*) AS total FROM [dbo].[_prisma_migrations]
    WHERE [finished_at] IS NULL AND [rolled_back_at] IS NULL;
  `);

  return {
    appliedCount: applied.length,
    latest: applied.at(-1) ?? null,
    unfinished: Number(unfinished?.total ?? Number.NaN),
    pending: repository.filter((id) => !applied.includes(id)),
    unknown: applied.filter((id) => !repository.includes(id)),
  };
}

/** Throws unless the history is exactly this repository's, fully applied. */
export function assertMigrationsCurrent(report: MigrationReport): void {
  const problems = [
    ...(report.unfinished !== 0 ? [`${String(report.unfinished)} unfinished`] : []),
    ...(report.pending.length > 0 ? [`pending: ${report.pending.join(', ')}`] : []),
    ...(report.unknown.length > 0 ? [`unknown: ${report.unknown.join(', ')}`] : []),
  ];
  if (problems.length > 0) {
    throw new Error(
      `The migration history is not this repository's, fully applied (${problems.join('; ')}).`,
    );
  }
}

/* ---------------------------------------------------------------------------
 * Least privilege
 * ------------------------------------------------------------------------- */

export interface LeastPrivilegeSummary {
  login: string;
  roles: string[];
  broadRoles: string[];
  /** Broad database-scope permissions effectively held — must be empty. */
  heldDatabasePermissions: string[];
  /** Broad `dbo`-schema permissions effectively held — must be empty. */
  heldSchemaPermissions: string[];
  /** Recorded GRANTs outside the reviewed inventory — must be empty (runtime only). */
  overreachingGrants: string[];
}

/**
 * Measures what `login` can ACTUALLY do, through a session opened AS that
 * login, plus — for the runtime principal — what the catalogue records against
 * it, read administratively. Reuses the Phase 1 authority inspection unchanged.
 */
export async function summariseLeastPrivilege(
  principal: SqlSession,
  admin: SqlSession,
  login: string,
  options: { checkObjectInventory: boolean },
): Promise<LeastPrivilegeSummary> {
  const authority = await inspectPrincipalAuthority(principal);
  const overreaching = options.checkObjectInventory
    ? overreachingGrants(await recordedPermissions(admin, login)).map(
        (entry) => `${entry.class} ${entry.object} ${entry.permission}`,
      )
    : [];

  return {
    login,
    roles: authority.roles,
    broadRoles: authority.broadRoles,
    heldDatabasePermissions: authority.databasePermissions
      .filter((entry) => entry.held)
      .map((entry) => entry.permission),
    heldSchemaPermissions: authority.schemaPermissions
      .filter((entry) => entry.held)
      .map((entry) => entry.permission),
    overreachingGrants: overreaching,
  };
}

/** Throws when a summary shows any broad authority. */
export function assertLeastPrivilege(summary: LeastPrivilegeSummary): void {
  const findings = [
    ...summary.broadRoles.map((role) => `role ${role}`),
    ...summary.heldDatabasePermissions.map((permission) => `DATABASE ${permission}`),
    ...summary.heldSchemaPermissions.map((permission) => `SCHEMA dbo ${permission}`),
    ...summary.overreachingGrants.map((grant) => `GRANT ${grant}`),
  ];
  if (findings.length > 0) {
    throw new Error(
      `'${summary.login}' holds broad authority it must not have: ${findings.join(', ')}`,
    );
  }
}

/* ---------------------------------------------------------------------------
 * Constraint trust
 * ------------------------------------------------------------------------- */

/**
 * Foreign keys and CHECK constraints that are disabled or untrusted.
 *
 * A restore copies constraint metadata faithfully, so an untrusted constraint
 * after restore means one was already untrusted in the source — data the
 * constraint never validated. Either way it is a finding, never a pass.
 */
export async function untrustedConstraints(session: SqlSession): Promise<string[]> {
  const rows = await session.query<{ name: string }>(`
    SELECT [name] FROM sys.foreign_keys WHERE is_disabled = 1 OR is_not_trusted = 1
    UNION ALL
    SELECT [name] FROM sys.check_constraints WHERE is_disabled = 1 OR is_not_trusted = 1
    ORDER BY [name];
  `);
  return rows.map((row) => row.name);
}

/* ---------------------------------------------------------------------------
 * Reset preconditions
 * ------------------------------------------------------------------------- */

/** The exact phrase that authorises one reset of one staging environment. */
export function resetConfirmationToken(environmentId: string): string {
  return `reset ${STAGING_DATABASE} ${environmentId}`;
}

/**
 * Throws unless `token` is EXACTLY the confirmation phrase for this
 * environment instance.
 *
 * Binding the phrase to the environment id means a phrase copied from another
 * staging environment's runbook, or typed from memory, authorises nothing
 * here. There is no "--yes" and no default: an absent token is a refusal.
 */
export function assertResetConfirmation(
  token: string | undefined,
  environmentId: string,
): void {
  if (token === undefined || token === '') {
    throw new StagingTargetError(
      'confirm',
      `staging:db:reset requires --confirm "${resetConfirmationToken('<environment-id>')}"`,
    );
  }
  if (token !== resetConfirmationToken(environmentId)) {
    throw new StagingTargetError(
      'confirm',
      `the confirmation phrase does not match this environment; it must be exactly ` +
        `"${resetConfirmationToken('<MINHAJ_STAGING_ENVIRONMENT_ID>')}"`,
    );
  }
}

/**
 * Tables whose rows the MIGRATIONS themselves insert: the permission catalogue,
 * the system roles and their bundles, the seeded topic tree and the language
 * registry. A freshly migrated database already holds these, so their rows are
 * not evidence that anybody has used the environment.
 *
 * Determined from the forward migrations' top-level `INSERT INTO` statements
 * (inserts inside stored procedures run only when called) and confirmed
 * against a freshly migrated and provisioned staging database. If a later
 * migration seeds another table and nobody adds it here, the effect is that a
 * freshly migrated staging database reads as holding material data and a reset
 * asks for a backup first — the safe direction.
 */
export const MIGRATION_SEEDED_TABLES: readonly string[] = Object.freeze([
  'Language',
  'Permission',
  'Role',
  'RolePermission',
  'Topic',
  'TopicTranslation',
]);

/**
 * `AuditLog` is NOT a seeded table, but migrations do write to it: each phase
 * that provisions permissions records that fact with `actorType = 'migration'`
 * (fifteen rows on a database migrated to Phase 27). Those rows say only that
 * the schema was built; every other audit row — a sign-in, an administrative
 * act, a system job — is evidence the environment was used, and counts.
 */
const MIGRATION_AUDIT_FILTER = ` WHERE [actorType] <> N'migration'`;

export interface MaterialDataReport {
  /** Tables holding rows beyond what the migrations insert. */
  tables: { table: string; rows: number }[];
}

/**
 * THE MATERIAL-DATA RULE for `staging:db:reset`.
 *
 * The staging database holds material data when ANY base table, other than
 * Prisma's own history and the migration-seeded catalogue tables above, holds
 * at least one row — counting `AuditLog` rows only when their actor is not the
 * migration itself. That covers what the reset brief names — `Asset` (and so
 * the bytes it describes) and Identity's `User` — and everything a person or a
 * process could have written without either: a guest donation, a contact
 * enquiry, a newsletter consent, an audit row.
 *
 * It is deliberately broader than "Asset or User". A narrower list fails OPEN
 * on every table nobody thought to name, which is the blocklist shape every
 * guard in this package refuses; this one fails CLOSED, and its only cost is
 * asking for a backup that turns out to have been unnecessary.
 *
 * Counts are exact (`COUNT_BIG`), not `sys.partitions` estimates, and a table
 * name that is not a plain identifier fails the inspection rather than being
 * skipped — an uncountable table is not an empty one.
 */
export async function materialData(live: SqlSession): Promise<MaterialDataReport> {
  const tables = await live.query<{ schemaName: string; tableName: string }>(`
    SELECT s.name AS schemaName, t.name AS tableName
    FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE t.is_ms_shipped = 0
    ORDER BY s.name, t.name;
  `);

  const counted = tables.filter(
    ({ schemaName, tableName }) =>
      !(
        schemaName === 'dbo' &&
        (tableName === '_prisma_migrations' ||
          MIGRATION_SEEDED_TABLES.includes(tableName))
      ),
  );
  if (counted.length === 0) return { tables: [] };

  for (const { schemaName, tableName } of counted) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schemaName + tableName)) {
      throw new Error(
        `Cannot count rows in a table whose name is not a plain identifier ` +
          `(schema '${schemaName}'); the material-data check cannot answer.`,
      );
    }
  }

  const rows = await live.query<{ tableName: string; total: number | string | null }>(
    counted
      .map(
        ({ schemaName, tableName }) =>
          `SELECT N'${schemaName}.${tableName}' AS tableName, COUNT_BIG(*) AS total ` +
          `FROM [${schemaName}].[${tableName}]` +
          (schemaName === 'dbo' && tableName === 'AuditLog'
            ? MIGRATION_AUDIT_FILTER
            : ''),
      )
      .join('\nUNION ALL\n') + ';',
  );
  if (rows.length !== counted.length) {
    throw new Error(
      `The material-data check counted ${rows.length} of ${counted.length} tables; ` +
        `an uncounted table is not an empty one.`,
    );
  }

  const populated: { table: string; rows: number }[] = [];
  for (const row of rows) {
    const total = Number(row.total);
    if (!Number.isSafeInteger(total) || total < 0) {
      throw new Error(`The row count for ${row.tableName} is not a valid answer.`);
    }
    if (total > 0) populated.push({ table: row.tableName, rows: total });
  }
  return { tables: populated };
}

/** Recent backups older than this do not authorise a reset. */
export const RESET_BACKUP_MAX_AGE_MINUTES = 60;

export interface RecentBackup {
  fileName: string;
  backupFinishDate: string;
  ageMinutes: number;
}

/**
 * The most recent qualifying staging backup, or `null`.
 *
 * Qualifying means ALL of: a FULL backup (`type = 'D'`) of `MinhajStaging`,
 * written WITH CHECKSUM, of the CURRENT incarnation of the database (the
 * backup's `database_guid` equals the live one — a backup of an earlier
 * database that merely had the same name protects nothing), to a staging
 * artifact path (`/var/opt/mssql/backup/minhaj-staging-<32 hex>.bak`, so only
 * `staging:db:backup` output counts), finished within the last 60 minutes by
 * the SERVER's clock, and whose file the server can still see.
 */
export async function recentStagingBackup(
  master: SqlSession,
  options: { maxAgeMinutes: number } = { maxAgeMinutes: RESET_BACKUP_MAX_AGE_MINUTES },
): Promise<RecentBackup | null> {
  const rows = await master.query<{
    physicalDeviceName: string;
    backupFinishDate: Date | string;
    ageSeconds: number;
  }>(`
    SELECT TOP (20)
      mf.physical_device_name                                   AS physicalDeviceName,
      bs.backup_finish_date                                     AS backupFinishDate,
      DATEDIFF(SECOND, bs.backup_finish_date, GETDATE())        AS ageSeconds
    FROM msdb.dbo.backupset bs
    JOIN msdb.dbo.backupmediafamily mf ON mf.media_set_id = bs.media_set_id
    WHERE bs.database_name = N'${STAGING_DATABASE}'
      AND bs.type = 'D'
      AND bs.has_backup_checksums = 1
      AND bs.backup_finish_date IS NOT NULL
      AND bs.database_guid = (
        SELECT database_guid FROM sys.database_recovery_status
        WHERE database_id = DB_ID(N'${STAGING_DATABASE}')
      )
      AND DATEDIFF(SECOND, bs.backup_finish_date, GETDATE()) BETWEEN 0 AND ${String(
        Math.trunc(options.maxAgeMinutes * 60),
      )}
    ORDER BY bs.backup_finish_date DESC;
  `);

  for (const row of rows) {
    try {
      assertBackupPath(row.physicalDeviceName, STAGING_BACKUP_NAMING);
    } catch {
      // Not a staging artifact (a manual backup elsewhere): it does not count.
      continue;
    }
    // A recorded backup whose file has gone is a record, not a backup.
    if (
      !(await backupArtifactExists(master, row.physicalDeviceName, STAGING_BACKUP_NAMING))
    ) {
      continue;
    }
    return {
      fileName: row.physicalDeviceName.slice(row.physicalDeviceName.lastIndexOf('/') + 1),
      backupFinishDate: new Date(row.backupFinishDate).toISOString(),
      ageMinutes: Math.floor(Number(row.ageSeconds) / 60),
    };
  }
  return null;
}

export interface ResetSafety {
  material: MaterialDataReport;
  backup: RecentBackup | null;
}

/**
 * Throws unless dropping `MinhajStaging` loses nothing unrecoverable: either
 * it holds no material data, or a qualifying backup of it finished within the
 * last 60 minutes.
 */
export async function assertResetSafe(
  master: SqlSession,
  live: SqlSession,
): Promise<ResetSafety> {
  const material = await materialData(live);
  if (material.tables.length === 0) return { material, backup: null };

  const backup = await recentStagingBackup(master);
  if (backup === null) {
    const sample = material.tables
      .slice(0, 5)
      .map((entry) => `${entry.table} (${entry.rows})`)
      .join(', ');
    throw new StagingTargetError(
      'backup',
      `${STAGING_DATABASE} holds material data (${sample}${
        material.tables.length > 5 ? ', …' : ''
      }) and no verified staging backup of it finished in the last ` +
        `${RESET_BACKUP_MAX_AGE_MINUTES} minutes. Run "npm run staging:db:backup" ` +
        `(and copy the artifact off the server) first, then repeat the reset`,
    );
  }
  return { material, backup };
}
