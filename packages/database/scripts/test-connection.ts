import 'server-only';

import { getDatabaseRuntimeUrl } from '../src/config.ts';
import {
  applyResolvedEnvironment,
  describeConnection,
  formatConnectionMetadata,
  resolveLocalDatabaseEnvironment,
} from '../src/lifecycle/local-environment.ts';
import {
  assertApprovedLocalTarget,
  localTargetPolicy,
} from '../src/lifecycle/local-target.ts';

/**
 * `npm run db:test:connection` — proves the local stack is reachable AS THE
 * RUNTIME PRINCIPAL, and is the SQL Server 2022 Developer edition Phase 1
 * targets.
 *
 * This is the one local command that exercises the RUNTIME path rather than the
 * migration one, so its guard is the mirror image: the connection must be the
 * configured `DATABASE_APP_LOGIN` and not a migration account.
 *
 * `src/test-connection.ts` does the actual work through the Prisma client,
 * which resolves `DATABASE_URL` from `process.env` at import time. That is the
 * one place a resolved record cannot be threaded through, so the resolved
 * values are applied to `process.env` HERE, explicitly and after validation,
 * rather than as a side effect of some module import ordering.
 */

const environment = resolveLocalDatabaseEnvironment({ requireLocalFile: true });
const runtimeUrl = getDatabaseRuntimeUrl(environment.values);

const connection = assertApprovedLocalTarget(
  runtimeUrl,
  localTargetPolicy(environment.values, 'source', 'runtime'),
);

process.stdout.write(
  `  ${'configuration'.padEnd(20)} ` +
    `${formatConnectionMetadata(describeConnection(connection, 'docker/.env'))}\n`,
);
if (environment.overridden.length > 0) {
  process.stdout.write(
    `  ${'shell override'.padEnd(20)} ` +
      `docker/.env took precedence over ${environment.overridden.join(', ')}\n`,
  );
}

applyResolvedEnvironment(environment);

// Imported only after the target is proven and the environment is applied.
await import('../src/test-connection.ts');
