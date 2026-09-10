import 'server-only';

import { getApplicationPrincipalCredentials } from '../src/config.ts';
import { provisionApplicationPrincipal } from '../src/lifecycle/application-principal.ts';
import { openSession } from '../src/lifecycle/sql-connection.ts';
import { reportConfiguration, startLocalCommand } from './local-bootstrap.ts';

/**
 * `npm run db:provision` — applies the reviewed least-privilege grant script to
 * the local Phase 1 database.
 *
 * The lifecycle tests provision their own disposable databases; this is how a
 * developer brings their persistent local database to the same state. Run as
 * the migration principal, and idempotent: re-running keeps the login in step
 * with local configuration without dropping existing grants.
 *
 * ## What changed here
 *
 * Like `db:seed`, this command previously took its target from ambient shell
 * variables and validated nothing beyond URL syntax — while CREATING A LOGIN
 * and granting it rights. It now resolves `docker/.env` as the sole authority
 * and proves the target is the approved local server first.
 */

const command = startLocalCommand('source');
// Credentials come from the same resolved record as the connection, so the
// login being provisioned and the server it is provisioned on cannot come from
// two different configurations.
const principal = getApplicationPrincipalCredentials(command.environment.values);
const session = await openSession(command.connection);

process.stdout.write(
  `Provisioning the runtime principal on ${command.connection.database}\n`,
);
reportConfiguration(command);

try {
  await provisionApplicationPrincipal(
    session,
    principal.DATABASE_APP_LOGIN,
    principal.DATABASE_APP_PASSWORD,
  );
  process.stdout.write(
    `Application principal '${principal.DATABASE_APP_LOGIN}' provisioned with ` +
      `least-privilege grants.\n`,
  );
} finally {
  await session.close();
}
