import 'server-only';

import {
  getApplicationPrincipalCredentials,
  getDatabaseMigrationUrl,
} from '../src/config.ts';
import { provisionApplicationPrincipal } from '../src/lifecycle/application-principal.ts';
import { openSession, parseSqlServerUrl } from '../src/lifecycle/sql-connection.ts';

/**
 * `npm run db:provision` — applies the reviewed least-privilege grant script to
 * the configured database.
 *
 * The lifecycle tests provision their own disposable databases; this is how a
 * developer brings their persistent local database to the same state. Run as
 * the migration principal, and idempotent: re-running keeps the login in step
 * with local configuration without dropping existing grants.
 */

const principal = getApplicationPrincipalCredentials();
const session = await openSession(parseSqlServerUrl(getDatabaseMigrationUrl()));

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
