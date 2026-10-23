import 'server-only';

import {
  createMigrationProofOperator,
  removeMigrationProofOperator,
  runMigrationFixtureProof,
} from '../src/lifecycle/migration-proof-operator.ts';
import { STAGING_DATABASE } from '../src/lifecycle/staging-target.ts';
import {
  openAdminSession,
  openVerifiedMaster,
  runStagingCommand,
  runtimeConnection,
  startStagingCommand,
} from './staging-bootstrap.ts';

/**
 * `npm run staging:migration:proof` — the Phase-29 migration FIXTURE proof on
 * the staging database (`docker/staging/bin/migration-proof.sh` runs it in the
 * exact-SHA operations image).
 *
 * THREE STEPS, TWO PRINCIPALS:
 *
 *   1. the staging guard, whole — declared environment and instance, internal
 *      host and port, `MinhajStaging`, distinct principals, TLS posture, the
 *      SQL container's machine name and the database's fingerprint — then the
 *      synthetic operator written by the MIGRATION principal
 *      (`src/lifecycle/migration-proof-operator.ts`);
 *   2. the proof itself (`scripts/migration/staging-fixture-proof.ts`) in a
 *      child process as the RUNTIME principal, whose environment carries the
 *      runtime URL and nothing of the migration principal;
 *   3. the operator's authority removed — always, also when the proof failed —
 *      and proven gone.
 *
 * The final stdout line is one JSON object, as every staging command's is.
 * Nothing printed is a URL or a password.
 */

await runStagingCommand('staging:migration:proof', async () => {
  const command = startStagingCommand();
  const { master } = await openVerifiedMaster(command, { requireFingerprint: true });
  await master.close();

  const live = await openAdminSession(command, STAGING_DATABASE, 'live');
  try {
    const operator = await createMigrationProofOperator(live);
    let proof: Record<string, unknown> | null = null;
    try {
      proof = await runMigrationFixtureProof({
        runtime: runtimeConnection(command, STAGING_DATABASE, 'live'),
        operator,
        environment: command.values,
      });
    } finally {
      const removal = await removeMigrationProofOperator(live, operator.accountId);
      if (proof !== null) proof = { ...proof, operatorRemoved: removal };
    }
    return {
      environmentId: command.environmentId,
      database: STAGING_DATABASE,
      operator: operator.accountId,
      proof,
    };
  } finally {
    await live.close();
  }
});
