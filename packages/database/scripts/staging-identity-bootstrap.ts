import 'server-only';

import { OPERATOR_PROCEDURES } from '../src/lifecycle/operator-principal.ts';
import { openSession } from '../src/lifecycle/sql-connection.ts';
import { parseOperatorArguments } from './operator-arguments.ts';
import {
  openVerifiedMaster,
  operatorConnection,
  runStagingCommand,
  startStagingCommand,
} from './staging-bootstrap.ts';

/**
 * `staging-identity-bootstrap --user <accountId> --ticket "<reason>"` — the
 * one-time initial privileged operator bootstrap ON STAGING
 * (SECURITY_BASELINE.md §8.3; `docker/staging/bin/identity-bootstrap.sh` runs
 * it in the exact-SHA operations image).
 *
 * The SAME procedure as `npm run identity:bootstrap`, behind the staging
 * guard rather than the local one: the declared environment and instance, the
 * internal host and port, `MinhajStaging`, distinct principals, TLS posture,
 * the SQL container's machine name and the database fingerprint are all
 * proven first. It runs as the OPERATOR principal — the only one granted the
 * procedure — and the procedure itself holds every rule in one transaction:
 * it refuses if any Platform Administrator already exists, if the account is
 * not eligible, or if the role is missing, and it writes the audit record.
 *
 * The account is named by its internal identifier, never by an address. It
 * holds the protected role at once and can exercise no high-consequence
 * capability until it enrols a second factor and confirms its recovery codes.
 * The final stdout line is one JSON object naming no credential.
 */

const USAGE = 'staging-identity-bootstrap --user <accountId> --ticket "<reason>"';

await runStagingCommand('staging:identity:bootstrap', async () => {
  const { targetUserId, ticket } = parseOperatorArguments(process.argv.slice(2), USAGE);

  const command = startStagingCommand();
  const { master } = await openVerifiedMaster(command, { requireFingerprint: true });
  await master.close();

  const session = await openSession(operatorConnection(command));
  try {
    await session.execute(OPERATOR_PROCEDURES[0], { targetUserId, ticket });
  } finally {
    await session.close();
  }
  return {
    environmentId: command.environmentId,
    targetUserId,
    bootstrapped: true,
    next: 'enrol a second factor and confirm recovery codes at /my/settings/security',
  };
});
