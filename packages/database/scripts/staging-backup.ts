import 'server-only';

import {
  backupArtifactExists,
  backupDatabase,
  newBackupTarget,
  STAGING_BACKUP_NAMING,
} from '../src/lifecycle/backup.ts';
import { STAGING_DATABASE } from '../src/lifecycle/staging-target.ts';
import {
  openVerifiedMaster,
  runStagingCommand,
  startStagingCommand,
} from './staging-bootstrap.ts';

/**
 * `npm run staging:db:backup` — one REAL, verified full backup of
 * `MinhajStaging`: `BACKUP DATABASE ... WITH CHECKSUM` to a new
 * `/var/opt/mssql/backup/minhaj-staging-<32 hex>.bak`, then
 * `RESTORE VERIFYONLY ... WITH CHECKSUM`, `HEADERONLY` and `FILELISTONLY`
 * through the same primitives the Phase 1 rehearsal uses, under the staging
 * naming policy.
 *
 * The artifact is LEFT in place: the host script moves it out of the SQL
 * container's backup directory to off-server storage. This command never
 * deletes a backup.
 *
 * `sizeBytes` is the backup set size SQL Server records in the artifact's own
 * header (`RESTORE HEADERONLY` BackupSize).
 */

await runStagingCommand('staging:db:backup', async () => {
  const command = startStagingCommand();
  const { master } = await openVerifiedMaster(command, { requireFingerprint: true });

  try {
    const target = newBackupTarget(STAGING_BACKUP_NAMING);
    const result = await backupDatabase(
      master,
      STAGING_DATABASE,
      target,
      STAGING_BACKUP_NAMING,
    );

    if (!(await backupArtifactExists(master, target.path, STAGING_BACKUP_NAMING))) {
      throw new Error('BACKUP reported success but the server cannot see the artifact.');
    }
    if (!result.header.hasBackupChecksums) {
      throw new Error('The backup set does not carry page checksums.');
    }

    return {
      environmentId: command.environmentId,
      database: STAGING_DATABASE,
      fileName: result.target.fileName,
      path: result.target.path,
      sizeBytes: result.header.backupSize,
      backupFinishDate: result.header.backupFinishDate,
      checksums: true,
      verified: 'RESTORE VERIFYONLY WITH CHECKSUM',
      logicalFiles: result.files.map((file) => `${file.logicalName} (${file.type})`),
    };
  } finally {
    await master.close();
  }
});
