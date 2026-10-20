import 'server-only';

import { STAGING_DATABASE } from '../src/lifecycle/staging-target.ts';
import {
  openVerifiedMaster,
  provisionStaging,
  runStagingCommand,
  startStagingCommand,
} from './staging-bootstrap.ts';

/**
 * `npm run staging:db:provision` — provisions the runtime and operator
 * principals on `MinhajStaging` from the reviewed grant scripts, idempotently,
 * then PROVES least privilege: each principal's effective authority is
 * measured through a session opened as that principal (no `db_owner`,
 * `db_ddladmin`, `db_datareader`, … and no database- or schema-wide rights),
 * and the runtime principal's recorded grants are compared with the reviewed
 * inventory. Any finding fails the command.
 *
 * Login names are printed; passwords never are.
 */

await runStagingCommand('staging:db:provision', async () => {
  const command = startStagingCommand();
  const { master } = await openVerifiedMaster(command, { requireFingerprint: true });
  await master.close();

  const result = await provisionStaging(command);

  return {
    environmentId: command.environmentId,
    database: STAGING_DATABASE,
    runtime: result.runtime,
    operator: result.operator,
    leastPrivilege: 'proven',
  };
});
