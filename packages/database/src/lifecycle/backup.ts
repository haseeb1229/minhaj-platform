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

export function isRestoreDatabaseName(name: string): boolean {
  return RESTORE_NAME.test(name);
}

export function newRestoreDatabaseName(): string {
  return `${RESTORE_PREFIX}${randomUUID().replaceAll('-', '')}`;
}

/**
 * Throws unless `name` is positively identified as a Chunk 3 disposable
 * restore database. Every destructive path calls this first.
 *
 * The rejected set deliberately includes `MinhajPlatform`: the source database
 * is never a restore target, because a restore that overwrites its own source
 * destroys the very data the test claims to be proving recoverable.
 */
export function assertRestoreDatabaseName(name: string): void {
  if (!isRestoreDatabaseName(name)) {
    throw new Error(
      `Refusing to operate destructively on '${name}': not a disposable Phase 1 ` +
        `restore database. Expected ${RESTORE_PREFIX}<32 hex characters>.`,
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
export function newBackupTarget(): BackupTarget {
  const fileName = `minhaj-phase1-${randomUUID().replaceAll('-', '')}.bak`;
  return { fileName, path: `${BACKUP_DIRECTORY}/${fileName}` };
}

/**
 * Throws unless `path` is a Phase 1 backup artifact in the Phase 1 backup
 * directory. Guards deletion, so no other file on the volume can be a target.
 */
export function assertBackupPath(path: string): void {
  const prefix = `${BACKUP_DIRECTORY}/`;
  const fileName = path.startsWith(prefix) ? path.slice(prefix.length) : '';

  if (!BACKUP_FILE_NAME.test(fileName)) {
    throw new Error(
      `Refusing to operate on '${path}': not a Phase 1 backup artifact. ` +
        `Expected ${prefix}minhaj-phase1-<32 hex characters>.bak`,
    );
  }
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
): Promise<BackupResult> {
  assertBackupSourceDatabase(database);
  assertBackupPath(target.path);

  // The server writes the artifact; the directory may not exist on a fresh
  // volume, and SQL Server does not create it. `xp_create_subdir` is the
  // supported server-side way to do so and is idempotent.
  await admin.query(`EXEC master.dbo.xp_create_subdir N'${BACKUP_DIRECTORY}';`);

  await admin.query(`
    BACKUP DATABASE [${database}]
    TO DISK = N'${target.path}'
    WITH FORMAT, INIT, CHECKSUM, STATS = 100,
         NAME = N'Minhaj Phase 1 recovery proof';
  `);

  // Re-reads the artifact and validates its checksums. A backup nobody can
  // read back is not evidence of anything.
  await admin.query(`RESTORE VERIFYONLY FROM DISK = N'${target.path}' WITH CHECKSUM;`);

  const header = await readBackupHeader(admin, target.path);
  const files = await readBackupFileList(admin, target.path);

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

/** Reads `RESTORE HEADERONLY` for an existing Phase 1 artifact. */
async function readBackupHeader(admin: SqlSession, path: string): Promise<BackupHeader> {
  assertBackupPath(path);

  const rows = await admin.query<{
    DatabaseName: string;
    BackupSize: number | string;
    BackupType: number;
    HasBackupChecksums: number | boolean;
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
): Promise<BackupFile[]> {
  assertBackupPath(path);

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
): Promise<void> {
  assertBackupPath(path);
  // Rejects the source database, the system databases, and malformed input.
  assertRestoreDatabaseName(restoreDatabase);

  const files = await readBackupFileList(master, path);
  if (files.length === 0) {
    throw new Error(`Backup artifact at ${path} lists no files to restore.`);
  }

  // Physical destinations are built from the VALIDATED restore name, so every
  // path below is `MinhajPhase1Restore_<hex>` — never a live data file.
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
): Promise<void> {
  assertRestoreDatabaseName(restoreDatabase);

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
): Promise<void> {
  assertBackupPath(path);

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
): Promise<boolean> {
  assertBackupPath(path);

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
