import 'server-only';

import { getOperatorPrincipalCredentials } from '../src/config.ts';
import { provisionOperatorPrincipal } from '../src/lifecycle/operator-principal.ts';
import { openSession } from '../src/lifecycle/sql-connection.ts';
import { reportConfiguration, startLocalCommand } from './local-bootstrap.ts';

/**
 * `npm run db:provision:operator` — provisions the dedicated
 * privileged-operations principal against the local Phase 2 database.
 *
 * Run as the MIGRATION principal, and idempotent, exactly like
 * `db:provision` for the runtime login.
 *
 * WHAT IT DOES NOT DO. It grants nothing itself. The capability — EXECUTE on
 * the two host-only procedures — belongs to the `minhaj_operator` role the
 * AUTHORISATION MIGRATION creates, so a change to what an operator may do is a
 * reviewed migration rather than an edit to a provisioning script
 * (SECURITY_BASELINE.md §8.3).
 */

const command = startLocalCommand('source');
const credentials = getOperatorPrincipalCredentials(command.environment.values);
const session = await openSession(command.connection);

process.stdout.write(
  `Provisioning the operator principal on ${command.connection.database}\n`,
);
reportConfiguration(command);

try {
  await provisionOperatorPrincipal(
    session,
    credentials.DATABASE_OPERATOR_LOGIN,
    credentials.DATABASE_OPERATOR_PASSWORD,
  );
  process.stdout.write(
    `Operator principal '${credentials.DATABASE_OPERATOR_LOGIN}' provisioned with ` +
      `EXECUTE on the two host-only procedures and nothing else.\n`,
  );
} finally {
  await session.close();
}
