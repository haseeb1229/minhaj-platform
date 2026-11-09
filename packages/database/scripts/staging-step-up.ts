import 'server-only';

import {
  HOST_STEP_UP_TOOL_ENTRY,
  runMigrationTool,
} from '../src/lifecycle/migration-proof-operator.ts';
import {
  assertHostStepUpPosture,
  HOST_STEP_UP_DECISION,
  hostStepUpToolArguments,
  parseHostStepUpArguments,
} from '../src/lifecycle/staging-step-up.ts';
import { STAGING_DATABASE } from '../src/lifecycle/staging-target.ts';
import {
  openVerifiedMaster,
  runStagingCommand,
  runtimeConnection,
  startStagingCommand,
} from './staging-bootstrap.ts';

/**
 * `staging-step-up` — the staging HOST-ISSUED step-up
 * (OWNER-DECISION-2026-11-09-STAGING-HOST-STEP-UP; SECURITY_BASELINE.md §8.1).
 * `docker/staging/bin/step-up.sh` runs it in the exact-SHA operations image.
 *
 *   grant --account <accountId> --purpose <purpose> [--minutes <1-15>]
 *
 * Issues the SAME short-lived grant the browser step-up issues, for a named
 * administrator and purpose, bound to that account's most recent live
 * session — so the operator commands whose gates re-check the grant LIVE
 * (the Quran reference import, migration publication, …) can run unattended.
 * Production keeps every confirmation unchanged: it never runs this.
 *
 * REFUSED FIRST, BEFORE ANY CONNECTION: arguments of the wrong shape, an
 * unknown purpose, a lifetime outside 1–15 minutes, and anything but the
 * staging deployment with an explicitly non-indexable build. Then the whole
 * staging guard — declared environment and instance, internal host and port,
 * `MinhajStaging`, distinct principals, TLS posture, the SQL container's
 * machine name and the database's fingerprint.
 *
 * Then Identity's own tool, as the RUNTIME principal in a child process:
 * Identity's service refuses again outside a declared non-indexable staging
 * deployment, and reads the account's status, the permission the purpose's
 * gate demands, the complete second-factor posture and the live session
 * before writing one grant and the same audit record the browser writes,
 * marked host-issued. The owner principal is never opened: nothing here
 * needs schema authority.
 *
 * The final stdout line is one JSON object of identifiers, the purpose and
 * the expiry — never a token or a password.
 */

await runStagingCommand('staging:step-up', async () => {
  const args = parseHostStepUpArguments(process.argv.slice(2));
  assertHostStepUpPosture(process.env);

  const command = startStagingCommand();
  const { master } = await openVerifiedMaster(command, { requireFingerprint: true });
  await master.close();

  const result = await runMigrationTool({
    runtime: runtimeConnection(command, STAGING_DATABASE, 'live'),
    entry: HOST_STEP_UP_TOOL_ENTRY,
    args: hostStepUpToolArguments(args),
    environment: command.values,
    label: 'host step-up',
  });
  return {
    environmentId: command.environmentId,
    database: STAGING_DATABASE,
    decision: HOST_STEP_UP_DECISION,
    result,
  };
});
