import 'server-only';

import { randomUUID } from 'node:crypto';

import { DISPOSABLE_PREFIX, isDisposableDatabaseName } from './disposable-database.ts';
import type { SqlSession } from './sql-connection.ts';

/**
 * Genuine SQL Server BACKUP / RESTORE mechanics for the Phase 1 recovery proof
 * (DELIVERY_PLAN.md Phase 1: "backup and **tested restore** procedure";
 * ARCHITECTURE.md §10.4: "a backup that has never been restored is not a
 * backup").
 *
 * Everything here goes through SQL Server's own backup engine. There is no
 * row-copying, no migration replay, no JSON export and no schema-only
 * recreation: those reproduce a database that LOOKS restored while proving
 * nothing about the backup artifact, which is the single thing this chunk
 * exists to test.
 *
 * ## Where the artifact lives
 *
 * `BACKUP DATABASE ... TO DISK` is executed BY THE SERVER, so the path is
 * resolved inside the SQL Server container, never on the host running this
 * code. The artifact is therefore written to `BACKUP_DIRECTORY` on the
 * container's existing persistent volume — no bind mount, no new volume, and
 * no path under the repository working tree, so a backup binary cannot reach
 * a commit even by accident.
 *
 * ## Local Developer scope
 *
 * This is the local restore rehearsal that OPEN_DECISIONS.md §4.1 places under
 * engineering control. Production backup storage, retention, scheduling,
 * offsite copies and RPO/RTO targets are external decisions gating Phases 28
 * and 34 (§4.4) and are deliberately absent.
 *
 * Phase 28 reuses the SAME mechanics for staging through an explicit naming
 * policy (`STAGING_BACKUP_NAMING` below). That adds a second namespace, not a
 * second implementation, and still decides no retention or offsite policy.
 */

/**
 * Server-side directory for Phase 1 backup artifacts.
 *
 * Inside `/var/opt/mssql`, which is the container's persistent volume, but in
 * its own directory rather than beside the live `.mdf`/`.ldf` files: cleanup
 * here must never be able to enumerate a data file.
 */
export const BACKUP_DIRECTORY = '/var/opt/mssql/backup';

/** Restore targets are created here, alongside the instance's other data files. */
const RESTORE_DATA_DIRECTORY = '/var/opt/mssql/data';

/**
 * The ONLY database this tooling will ever back up.
 *
 * A blocklist of system databases would be the wrong shape: it fails open on
 * everything nobody thought to list, including the unrelated host SQLEXPRESS
 * databases. This is a positive identification, matching the disposable-name
 * discipline Chunk 2 established.
 */
export const BACKUP_SOURCE_DATABASE = 'MinhajPlatform';

/** `MinhajPhase1Restore_<32 hex>`; the only name that is ever restored over or dropped. */
const RESTORE_NAME = /^MinhajPhase1Restore_[0-9a-f]{32}$/;

export const RESTORE_PREFIX = 'MinhajPhase1Restore_';

/** `minhaj-phase1-<32 hex>.bak`; the only file name that is ever written or deleted. */
const BACKUP_FILE_NAME = /^minhaj-phase1-[0-9a-f]{32}\.bak$/;

/**
 * The names one environment's backup tooling may write, restore into and drop.
 *
 * ## Why the naming is a POLICY and not a parameter
 *
 * Phase 28 brings a second environment — staging — with its own source
 * database, its own artifact names and its own restore namespace. The
 * primitives below are the same SQL Server mechanics in both, and duplicating
 * them would be a second BACKUP/RESTORE implementation to keep correct. What
 * differs is exactly the set of names each destructive path may touch, so that
 * set is passed as one reviewed, frozen object — never as loose strings a
 * caller could assemble into a name nobody approved.
 *
 * The namespaces are DISJOINT by construction: a Phase 1 guard refuses every
 * staging name and the staging guard refuses every Phase 1 name, so a staging
 * cleanup can never drop a local rehearsal database or the reverse.
 *
 * Every function taking a policy defaults to `PHASE1_BACKUP_NAMING`, so the
 * local tooling and its tests behave exactly as before.
 */
export interface BackupNamingPolicy {
  /** How refusals name the environment: `Phase 1` or `staging`. */
  readonly label: string;
  /** The artifact file-name stem, before the 32 hex characters. */
  readonly fileStem: string;
  /** The ONLY artifact file names this policy writes, reads or deletes. */
  readonly fileName: RegExp;
  readonly restorePrefix: string;
  /** The ONLY database names this policy restores into or drops. */
  readonly restoreName: RegExp;
  /** `BACKUP ... WITH NAME`, recorded in `msdb.dbo.backupset`. */
  readonly backupSetName: string;
  /** Throws unless `database` is a source this policy may back up. */
  readonly assertSource: (database: string) => void;
}

export const PHASE1_BACKUP_NAMING: BackupNamingPolicy = Object.freeze({
  label: 'Phase 1',
  fileStem: 'minhaj-phase1-',
  fileName: BACKUP_FILE_NAME,
  restorePrefix: RESTORE_PREFIX,
  restoreName: RESTORE_NAME,
  backupSetName: 'Minhaj Phase 1 recovery proof',
  assertSource: (database: string) => assertBackupSourceDatabase(database),
});

/** The one staging source database (DELIVERY_PLAN.md Phase 28). */
export const STAGING_SOURCE_DATABASE = 'MinhajStaging';

export const STAGING_RESTORE_PREFIX = 'MinhajStagingRestore_';

/**
 * Staging: `minhaj-staging-<32 hex>.bak` artifacts of `MinhajStaging` only,
 * restored into `MinhajStagingRestore_<32 hex>` only.
 *
 * ONE source and no disposable alternative. Staging has no rehearsal-built
 * source database, so the only thing its tooling ever backs up is the live
 * staging database itself — and a restore is never written over it.
 */
export const STAGING_BACKUP_NAMING: BackupNamingPolicy = Object.freeze({
  label: 'staging',
  fileStem: 'minhaj-staging-',
  fileName: /^minhaj-staging-[0-9a-f]{32}\.bak$/,
  restorePrefix: STAGING_RESTORE_PREFIX,
  restoreName: /^MinhajStagingRestore_[0-9a-f]{32}$/,
  backupSetName: 'Minhaj staging backup',
  assertSource: (database: string) => {
    if (database !== STAGING_SOURCE_DATABASE) {
      throw new Error(
        `Refusing to back up '${database}': the only valid staging source is ` +
          `${STAGING_SOURCE_DATABASE}. System databases, restore targets, local ` +
          `databases and unknown databases are never valid sources.`,
      );
    }
  },
});

export function isRestoreDatabaseName(
  name: string,
  naming: BackupNamingPolicy = PHASE1_BACKUP_NAMING,
): boolean {
  return naming.restoreName.test(name);
}

export function newRestoreDatabaseName(
  naming: BackupNamingPolicy = PHASE1_BACKUP_NAMING,
): string {
  return `${naming.restorePrefix}${randomUUID().replaceAll('-', '')}`;
}

/**
 * Throws unless `name` is positively identified as a Chunk 3 disposable
 * restore database. Every destructive path calls this first.
 *
 * The rejected set deliberately includes `MinhajPlatform`: the source database
 * is never a restore target, because a restore that overwrites its own source
 * destroys the very data the test claims to be proving recoverable. The same
 * holds for `MinhajStaging` under the staging policy.
 */
export function assertRestoreDatabaseName(
  name: string,
  naming: BackupNamingPolicy = PHASE1_BACKUP_NAMING,
): void {
  if (!isRestoreDatabaseName(name, naming)) {
    throw new Error(
      `Refusing to operate destructively on '${name}': not a disposable ${naming.label} ` +
        `restore database. Expected ${naming.restorePrefix}<32 hex characters>.`,
    );
  }
}

/**
 * Throws unless `database` is a database this platform may back up.
 *
 * TWO POSITIVE SHAPES, and an allowlist rather than a denylist:
 *
 *   - `MinhajPlatform`, the engineering database the operational rehearsal
 *     reads;
 *   - a DISPOSABLE `MinhajPhase1Test_<32 hex>` database, which the populated
 *     recovery rehearsal creates, fills with synthetic rows and drops.
 *
 * The second was added because proving a restore of POPULATED Phase-2 state
 * requires a source holding that state, and writing account rows into the
 * engineering database to obtain one is the wrong trade: a rehearsal should
 * not leave synthetic people behind in a real database. A disposable source is
 * created by the run that uses it and destroyed by the same run.
 *
 * A RESTORE database (`MinhajPhase1Restore_*`) is deliberately NOT a valid
 * source. It is the output of a rehearsal, and backing it up would prove a
 * copy of a copy.
 *
 * Fails closed on the system databases, on an unknown name, on a name that
 * differs only in case, and on anything carrying SQL syntax.
 */
export function assertBackupSourceDatabase(database: string): void {
  if (database === BACKUP_SOURCE_DATABASE) return;
  if (isDisposableDatabaseName(database)) return;

  throw new Error(
    `Refusing to back up '${database}': the only valid sources are ` +
      `${BACKUP_SOURCE_DATABASE} and a disposable ${DISPOSABLE_PREFIX}<32 hex> ` +
      `database. System databases, restore targets, unknown databases and the ` +
      `host SQLEXPRESS instance are never valid sources.`,
  );
}

/** A deterministic, credential-free backup file name and its server-side path. */
export interface BackupTarget {
  fileName: string;
  /** Path as SQL Server resolves it, inside the database container. */
  path: string;
}

/**
 * Names one backup artifact.
 *
 * The name carries a random identifier and nothing else. It is deliberately
 * derived from neither the connection nor the principal: a file name reaches
 * logs, directory listings and error messages, so it must never be able to
 * carry a credential (SECURITY_BASELINE.md §18.1).
 */
export function newBackupTarget(
  naming: BackupNamingPolicy = PHASE1_BACKUP_NAMING,
): BackupTarget {
  const fileName = `${naming.fileStem}${randomUUID().replaceAll('-', '')}.bak`;
  return { fileName, path: `${BACKUP_DIRECTORY}/${fileName}` };
}

/**
 * Throws unless `path` is a backup artifact of this naming policy, directly in
 * the backup directory. Guards deletion, so no other file on the volume can be
 * a target — and a staging artifact is never a Phase 1 one, or the reverse.
 */
export function assertBackupPath(
  path: string,
  naming: BackupNamingPolicy = PHASE1_BACKUP_NAMING,
): void {
  const prefix = `${BACKUP_DIRECTORY}/`;
  const fileName = path.startsWith(prefix) ? path.slice(prefix.length) : '';

  if (!naming.fileName.test(fileName)) {
    throw new Error(
      `Refusing to operate on '${path}': not a ${naming.label} backup artifact. ` +
        `Expected ${prefix}${naming.fileStem}<32 hex characters>.bak`,
    );
  }
}

/**
 * The server-side path of a NAMED existing artifact, validated.
 *
 * For the commands that take a file name an operator typed (the staging
 * restore proof): the name is checked against the policy's exact grammar
 * before it is joined to anything, so it cannot carry a directory, a
 * traversal, a wildcard or a quote.
 */
export function backupTargetFor(
  fileName: string,
  naming: BackupNamingPolicy = PHASE1_BACKUP_NAMING,
): BackupTarget {
  if (!naming.fileName.test(fileName)) {
    throw new Error(
      `Refusing backup file name '${fileName}': not a ${naming.label} backup ` +
        `artifact. Expected ${naming.fileStem}<32 hex characters>.bak`,
    );
  }
  const target = { fileName, path: `${BACKUP_DIRECTORY}/${fileName}` };
  assertBackupPath(target.path, naming);
  return target;
}

/** One row of `RESTORE FILELISTONLY` — the backup's own record of its files. */
export interface BackupFile {
  logicalName: string;
  type: 'D' | 'L' | string;
}

/** `RESTORE HEADERONLY` facts worth asserting on and safe to print. */
export interface BackupHeader {
  databaseName: string;
  backupSize: number;
  /** 1 = full database backup. */
  backupType: number;
  hasBackupChecksums: boolean;
  /** When the server finished writing the set, ISO 8601; `null` if unreported. */
  backupFinishDate: string | null;
}

export interface BackupResult {
  target: BackupTarget;
  header: BackupHeader;
  files: BackupFile[];
}

/**
 * Takes a REAL full backup of the Phase 1 source database and verifies it.
 *
 * `CHECKSUM` makes the backup compute and store page checksums; `VERIFYONLY`
 * then re-reads the artifact and validates them. Without both, a "successful"
 * backup is only the assertion that a write did not fail — which is precisely
 * the assurance ARCHITECTURE.md §10.4 rejects.
 *
 * `FORMAT, INIT` write a fresh media set rather than appending, so the file is
 * exactly one backup and a restore cannot pick up an older set by position.
 *
 * Runs as the MIGRATION principal. `BACKUP DATABASE` requires membership of
 * `db_backupoperator` or higher, which the least-privilege runtime principal
 * deliberately does not hold and must never be granted to make this pass.
 */
export async function backupDatabase(
  admin: SqlSession,
  database: string,
  target: BackupTarget,
  naming: BackupNamingPolicy = PHASE1_BACKUP_NAMING,
): Promise<BackupResult> {
  naming.assertSource(database);
  assertBackupPath(target.path, naming);

  // The server writes the artifact; the directory may not exist on a fresh
  // volume, and SQL Server does not create it. `xp_create_subdir` is the
  // supported server-side way to do so and is idempotent.
  await admin.query(`EXEC master.dbo.xp_create_subdir N'${BACKUP_DIRECTORY}';`);

  await admin.query(`
    BACKUP DATABASE [${database}]
    TO DISK = N'${target.path}'
    WITH FORMAT, INIT, CHECKSUM, STATS = 100,
         NAME = N'${naming.backupSetName}';
  `);

  return verifyBackupArtifact(admin, database, target, naming);
}

/**
 * Re-reads an EXISTING artifact and proves it is one verified full backup of
 * `database`: `VERIFYONLY ... WITH CHECKSUM`, then `HEADERONLY` (exactly one
 * full set, of that database) and `FILELISTONLY`.
 *
 * Shared by the backup path, which runs it on what it just wrote, and by the
 * staging restore proof, which runs it on a named artifact before restoring —
 * an artifact nobody can read back is not evidence of anything.
 */
export async function verifyBackupArtifact(
  admin: SqlSession,
  database: string,
  target: BackupTarget,
  naming: BackupNamingPolicy = PHASE1_BACKUP_NAMING,
): Promise<BackupResult> {
  naming.assertSource(database);
  assertBackupPath(target.path, naming);

  // Re-reads the artifact and validates its checksums. A backup nobody can
  // read back is not evidence of anything.
  await admin.query(`RESTORE VERIFYONLY FROM DISK = N'${target.path}' WITH CHECKSUM;`);

  const header = await readBackupHeader(admin, target.path, naming);
  const files = await readBackupFileList(admin, target.path, naming);

  if (header.databaseName !== database) {
    throw new Error(
      `Backup header names '${header.databaseName}', expected '${database}'.`,
    );
  }
  if (header.backupType !== 1) {
    throw new Error(`Backup is not a full database backup (type ${header.backupType}).`);
  }

  return { target, header, files };
}

/** Reads `RESTORE HEADERONLY` for an existing artifact of this policy. */
async function readBackupHeader(
  admin: SqlSession,
  path: string,
  naming: BackupNamingPolicy,
): Promise<BackupHeader> {
  assertBackupPath(path, naming);

  const rows = await admin.query<{
    DatabaseName: string;
    BackupSize: number | string;
    BackupType: number;
    HasBackupChecksums: number | boolean;
    BackupFinishDate: Date | string | null;
  }>(`RESTORE HEADERONLY FROM DISK = N'${path}';`);

  const [row] = rows;
  if (row === undefined) {
    throw new Error(`Backup artifact at ${path} contains no backup set.`);
  }
  if (rows.length !== 1) {
    throw new Error(
      `Backup artifact at ${path} contains ${rows.length} backup sets; expected exactly 1.`,
    );
  }

  return {
    databaseName: row.DatabaseName,
    backupSize: Number(row.BackupSize),
    backupType: Number(row.BackupType),
    hasBackupChecksums: Boolean(row.HasBackupChecksums),
    backupFinishDate:
      row.BackupFinishDate === null || row.BackupFinishDate === undefined
        ? null
        : new Date(row.BackupFinishDate).toISOString(),
  };
}

/**
 * Reads the backup's own list of logical files.
 *
 * This is why restore does not guess. The Phase 1 source database has logical
 * names `MinhajPlatform` and `MinhajPlatform_log`, which do NOT match the
 * disposable restore database's name — assuming otherwise produces RESTORE
 * error 3234 ("Logical file is not part of database"). The authority is the
 * artifact's own metadata, read here.
 */
async function readBackupFileList(
  admin: SqlSession,
  path: string,
  naming: BackupNamingPolicy,
): Promise<BackupFile[]> {
  assertBackupPath(path, naming);

  const rows = await admin.query<{ LogicalName: string; Type: string }>(
    `RESTORE FILELISTONLY FROM DISK = N'${path}';`,
  );

  return rows.map((row) => ({ logicalName: row.LogicalName, type: row.Type }));
}

/**
 * Restores a Phase 1 backup into a NEW disposable database.
 *
 * Every logical file in the artifact is MOVEd to a physical path derived from
 * the restore database's own name, so the restore cannot collide with — let
 * alone overwrite — the source database's live `.mdf`/`.ldf`. That collision
 * is the mechanism by which a careless restore destroys the database it was
 * meant to protect, so it is closed structurally rather than by convention.
 *
 * `WITH REPLACE` is deliberately NOT used: the restore must fail if a database
 * of that name somehow exists, rather than silently overwriting it.
 */
export async function restoreDatabaseFromBackup(
  master: SqlSession,
  path: string,
  restoreDatabase: string,
  naming: BackupNamingPolicy = PHASE1_BACKUP_NAMING,
): Promise<void> {
  assertBackupPath(path, naming);
  // Rejects the source database, the system databases, and malformed input.
  assertRestoreDatabaseName(restoreDatabase, naming);

  const files = await readBackupFileList(master, path, naming);
  if (files.length === 0) {
    throw new Error(`Backup artifact at ${path} lists no files to restore.`);
  }

  // Physical destinations are built from the VALIDATED restore name, so every
  // path below is `<restore prefix><hex>` — never a live data file.
  const moves = files.map((file, index) => {
    const extension = file.type === 'L' ? 'ldf' : 'mdf';
    const suffix = index === 0 ? '' : `_${index}`;
    const physical = `${RESTORE_DATA_DIRECTORY}/${restoreDatabase}${suffix}.${extension}`;

    // Logical names come from the artifact, not from a guess at the database
    // name. They are bracket-quoted against a name containing `]`.
    return `MOVE N'${file.logicalName.replaceAll("'", "''")}' TO N'${physical}'`;
  });

  await master.query(`
    RESTORE DATABASE [${restoreDatabase}]
    FROM DISK = N'${path}'
    WITH ${moves.join(', ')},
         CHECKSUM, RECOVERY, STATS = 100;
  `);
}

/**
 * Drops a disposable restore database.
 *
 * Mirrors `dropDisposableDatabase` from Chunk 2, including the `SINGLE_USER`
 * rollback so cleanup cannot hang on a stray session and leave the database
 * behind. The name is re-validated here rather than trusted from the caller:
 * this is the last point before a DROP.
 */
export async function dropRestoreDatabase(
  master: SqlSession,
  restoreDatabase: string,
  naming: BackupNamingPolicy = PHASE1_BACKUP_NAMING,
): Promise<void> {
  assertRestoreDatabaseName(restoreDatabase, naming);

  await master.query(`
    IF DB_ID(N'${restoreDatabase}') IS NOT NULL
    BEGIN
      ALTER DATABASE [${restoreDatabase}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
      DROP DATABASE [${restoreDatabase}];
    END;
  `);
}

/**
 * Deletes a Phase 1 backup artifact from the server-side directory.
 *
 * Scoped to one validated file path. There is no directory sweep and no
 * wildcard: a cleanup routine that enumerates a directory is one bad path
 * away from deleting a data file.
 */
export async function deleteBackupArtifact(
  admin: SqlSession,
  path: string,
  naming: BackupNamingPolicy = PHASE1_BACKUP_NAMING,
): Promise<void> {
  assertBackupPath(path, naming);

  // `xp_delete_files` is the supported server-side deletion for backup
  // artifacts and refuses anything that is not a backup file.
  await admin.query(`EXEC master.sys.xp_delete_files N'${path}';`);
}

/**
 * Reports whether the server can still see the artifact — cleanup EVIDENCE.
 *
 * ## Why this is strict to the point of rudeness
 *
 * The previous revision ended `Number(row?.fileExists ?? 0) === 1`, which reads
 * every inconclusive outcome as "the file is gone": no row returned, a NULL,
 * a renamed column, a value that is neither 0 nor 1. Absence is the answer that
 * lets `db:recovery:test` exit 0, so a broken inspection silently became a
 * passing cleanup gate — precisely the failure the gate exists to catch.
 *
 * Only two results are answers. `file_exists = 1` proves presence,
 * `file_exists = 0` proves absence, and EVERYTHING else throws, because
 * "I could not tell" is not evidence of anything.
 */
export async function backupArtifactExists(
  admin: SqlSession,
  path: string,
  naming: BackupNamingPolicy = PHASE1_BACKUP_NAMING,
): Promise<boolean> {
  assertBackupPath(path, naming);

  const rows = await admin.query<{
    fileExists: number | null;
    isDirectory: number | null;
  }>(`
    DECLARE @result TABLE (
      file_exists BIT, is_directory BIT, parent_directory_exists BIT
    );
    INSERT INTO @result EXEC master.dbo.xp_fileexist N'${path}';
    SELECT CAST(file_exists AS INT) AS fileExists,
           CAST(is_directory AS INT) AS isDirectory
    FROM @result;
  `);

  if (rows.length !== 1) {
    throw new Error(
      `xp_fileexist returned ${rows.length} rows for ${path}; expected exactly 1. ` +
        `The artifact's state is unknown, which is not evidence that it is gone.`,
    );
  }

  const row = rows[0];
  const fileExists = row?.fileExists;
  if (fileExists === null || fileExists === undefined) {
    throw new Error(
      `xp_fileexist returned no file_exists value for ${path}. The artifact's ` +
        `state is unknown, which is not evidence that it is gone.`,
    );
  }

  if (fileExists !== 0 && fileExists !== 1) {
    throw new Error(
      `xp_fileexist reported file_exists=${String(fileExists)} for ${path}; only ` +
        `0 or 1 is an answer.`,
    );
  }

  // A directory where the artifact should be is not the artifact, and deleting
  // it is not what cleanup verified. Treated as an unknown state, not absence.
  if (row?.isDirectory !== 0 && row?.isDirectory !== 1) {
    throw new Error(
      `xp_fileexist returned no valid is_directory value for ${path}. The ` +
        `artifact's state is unknown.`,
    );
  }
  if (row.isDirectory === 1) {
    throw new Error(`xp_fileexist reports ${path} is a directory, not a backup file.`);
  }

  return fileExists === 1;
}
